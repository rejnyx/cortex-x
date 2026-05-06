# Existing Project Audit — Deep 12-Dimension Analysis + Auto-Research + Retrofit

> **How to use:** Open Claude Code at the root of an established project, paste this prompt (or run the `/audit` skill, which is auto-loaded after `install.sh` mode `[E]`). Claude does a senior-consultant-grade audit before proposing any cortex-x patterns. ~30-45 min for a typical 30K-LOC repo.
>
> This prompt is the **deep** audit. For a quick 5-section institutional summary (used to populate `$CORTEX_HOME/projects/<slug>.md`), use `~/.claude/shared/prompts/project-scan.md` instead — different scope.

---

## When to use this prompt

✅ **Use `/audit` (this prompt) when:**
- You just installed cortex-x into an existing project that's already running
- You inherited a codebase and need to understand it before changing anything
- You suspect the project has accumulated tech debt and want it inventoried with citations
- You want to retrofit cortex-x patterns (CLAUDE.md, hooks, agents, standards) but only WHERE they fit — not blindly overwrite

🚫 **Don't use `/audit` when:**
- The project is empty or near-empty (< 5 source files) → use `~/.claude/shared/prompts/new-project.md` (`/start`) instead
- You only need a 5-section summary for the cortex library → use `~/.claude/shared/prompts/project-scan.md`
- You want to capture a single architectural decision or lesson → use `cortex-sync.md`

---

## Phases (six)

| Phase | Goal | Output |
|---|---|---|
| **P0 — Detect** | What kind of project is this? | `cortex/audit-context.md` (profile, stage, monorepo, sister-env) |
| **P1 — Repo map** | What's the symbol-level shape? | `cortex/MEMORY/repo-map.md` (top-N ranked symbols, token-budgeted) |
| **P2 — Audit (4 parallel agents, 12 dims)** | Where are the bones, hot spots, gaps? | `cortex/AUDIT.md` (12-section senior consultant deliverable) |
| **P3 — Human gate** | What CAN'T be derived from code | 5 questions, answers folded into `cortex/AUDIT.md` |
| **P4 — Auto-research** | What does 2026 say about this stack? | `$CORTEX_HOME/research/<slug>-audit-<date>.md` |
| **P5 — Synthesis** | What should we DO? | `cortex/recommendations.md` + `CLAUDE.md` patches |
| **P6 — ADR backfill (opt-in)** | What past decisions deserve documentation? | `cortex/decisions/ADR-NNN-*.md` |

---

## Phase 0 — Detect

Run cortex-x's deterministic detectors:

```bash
node ~/.claude/shared/detectors/detect-profile.cjs   # nextjs-saas | ai-agent | astro-static | …
node ~/.claude/shared/detectors/detect-stage.cjs     # greenfield | mvp | growth | mature | legacy
node ~/.claude/shared/detectors/detect-sister-env.cjs # monorepo | single-pkg | polyglot
```

If any detector fails-open (`{ ok: false, …}`), record the failure and proceed with reasonable defaults — never block.

Write `cortex/audit-context.md`:

```markdown
---
phase: 0-detect
date: <YYYY-MM-DD>
slug: <derived from package.json:name or folder name>
---

# Audit context

## Detected
- **Profile:** <profile>
- **Stage:** <stage>
- **Sister-env:** <env>
- **Monorepo:** <yes/no, manager (pnpm/turbo/nx/lerna) if yes>
- **Languages:** <ts, js, rust, py, … from file extensions sample>
- **Detected stack:** <Next.js 16.0.3, Supabase 2.45, Vercel AI SDK 6.1, Tailwind 4, …>

## Detector failures (if any)
- `<detector-name>`: <reason>; defaulted to `<default>`
```

---

## Phase 1 — Repo map

The repo-map detector renders a ranked symbol summary, token-budgeted, modeled on Aider's RepoMap (tree-sitter + personalized PageRank).

```bash
node ~/.claude/shared/detectors/repo-map.cjs --token-budget 1500 --output cortex/MEMORY/repo-map.md
```

If `detectors/repo-map.cjs` is unavailable (e.g. tree-sitter binding failed to install on Windows), **fall back to a degraded repo map**: walk the `src/` (or equivalent) tree, list top-level files + exported symbols via `Glob` + `Grep`, write a flat index:

```markdown
# Repo map (degraded, no tree-sitter)
> tree-sitter unavailable; this is a flat file/symbol index, not PageRank-ranked.

## Top files by recent commits
<git log output, top 20>

## Exported symbols by file (flat)
<file:line — symbol — kind>
```

The degraded mode is intentionally lossy — it's better than nothing for the audit but should warn the user that ranking quality is degraded.

`cortex-doctor` will re-run repo-map on demand after the user fixes the tree-sitter install.

---

## Phase 2 — Audit (4 parallel agents, 12 dimensions)

**This is the load-bearing phase.** Spawn four parallel general-purpose agents via the Agent tool, each owning 3 of the 12 audit dimensions. Each agent reads its assigned files + tools, returns a 400-word section. Total audit: ~1500 words structured into 12 dims.

> **Why parallel:** anthropic's multi-agent paper showed 90.2% lift on breadth-first queries vs. single-agent. Audit is breadth-first by definition. Cap at 4 agents (matches `config/research.yaml: max_count: 5` with planner included).

### Agent A — Topology + symbol map + hot spots (dims 1-3)

Reads:
- `package.json`, `pnpm-workspace.yaml`/`turbo.json`/`nx.json`/`lerna.json`
- `cortex/MEMORY/repo-map.md` (output of Phase 1)
- `git log --pretty=format:'%H %an %as' --numstat` (last 12 months)

Produces sections:
1. **Repo topology + build graph** — package layout, build orchestration, dep graph (use `dependency-cruiser` if installed; otherwise `import` walk via Grep)
2. **Symbol-level repo map** — top 30 symbols by PageRank score (from §1), grouped by module
3. **Hot spots** — file-level churn × complexity (Adam Tornhill method): `git log --numstat | sort | head` × LOC-deltas-per-file as complexity proxy. Surface top 10 hot spots with bug-likelihood ranking.

### Agent B — Conventions + tests + CI/CD (dims 4-6)

Reads:
- `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `.editorconfig`, `CONTRIBUTING.md` (if present)
- 30-file random sample for de-facto patterns
- `.github/workflows/`, `.gitlab-ci.yml`, `vercel.json`, `netlify.toml`
- Test file glob (`**/*.{test,spec}.{ts,tsx,js,jsx}`)
- `package.json` scripts

Produces sections:
4. **Conventions / style / naming** — declared (configs) vs. de facto (sample); call out drift
5. **Test posture** — runner, coverage estimate, integration-vs-unit ratio, flake history if `gh api` accessible
6. **CI/CD state** — pipelines, deploy targets, secret handling, branch protections (via `gh api` if accessible)

### Agent C — Observability + security + data model (dims 7-9)

Reads:
- Source tree for logger/sentry/posthog/otel imports
- `prisma/schema.prisma`, `supabase/migrations/`, Drizzle schemas, `db/` dirs
- AuthN/Z code paths (route handlers, middleware)
- `package.json` deps (run `npm audit --json` if accessible; otherwise list deps and mention "run osv-scanner V2 manually for live CVE check")
- `.env.example`, env-var usage patterns

Produces sections:
7. **Observability surface** — what's logged, where it goes, structured-vs-print, dashboards mentioned
8. **Security posture** — CVE surface (from npm audit / osv-scanner V2), AuthN/Z map, secret-handling, lethal-trifecta presence (read+exec+exfil; per `standards/security.md` § Agentic Security)
9. **Data model + migrations** — schema layout, drift between code types and DB, RLS policy presence (Supabase) or row-security equivalents

### Agent D — Implicit ADRs + tech debt + performance (dims 10-12)

Reads:
- `git log --all` for major refactor/migration commits (look for "migrate", "switch", "rewrite", "replace" verbs)
- 9-dim tech-debt scan per `tech-debt-skill` pattern: architectural decay, consistency rot, type/contract debt, test debt, dependency debt, performance hygiene, error handling, security hygiene, doc drift
- Bundle output if `dist/` or `.next/` available; lighthouse CI history if `gh api` shows it
- N+1 AST patterns (basic regex on ORM call patterns inside loops)

Produces sections:
10. **Implicit ADRs** — 5-7 past decisions inferred from code+commit archaeology ("why is auth on Clerk not Supabase?"). Each: decision, evidence (commit hashes), consequences observed, ADR backfill candidacy (yes/no). This is the input for opt-in P6.
11. **Tech-debt inventory** — 9 dims, each with file:line citations + severity (blocker/warning/info)
12. **Performance hygiene** — bundle size if measurable, top-3 latency suspects from code (N+1, missing indexes per §9, unmemoized expensive components)

### Synthesis into `cortex/AUDIT.md`

Once all four agents return, write `cortex/AUDIT.md`:

```markdown
---
phase: 2-audit
date: <YYYY-MM-DD>
slug: <slug>
agents: [topology, conventions, security-data, debt-perf]
---

# Project Audit — <project name>

> Generated by cortex-x `/audit` on <date>. 12 dimensions. Citations are
> file:line + commit hash. This is a deliverable, not a chat scrollback —
> open in your editor, edit, share.

## Executive summary (5 bullets)
- <strongest signal #1>
- <strongest signal #2>
- <strongest signal #3>
- <biggest risk>
- <biggest opportunity>

## 1. Repo topology + build graph
…

## 2. Symbol-level map (top 30)
…

## 3. Hot spots (top 10, ranked)
…

## 4. Conventions
…

## 5. Test posture
…

## 6. CI/CD state
…

## 7. Observability surface
…

## 8. Security posture
…

## 9. Data model + migrations
…

## 10. Implicit ADRs (P6 candidates)
…

## 11. Tech-debt inventory (9 dims)
…

## 12. Performance hygiene
…

## Cross-dimension patterns (top 3)
- <pattern that shows up in multiple dims, with citations>

## Open questions (handed to Phase 3)
- <thing the audit can't answer; needs human>
```

---

## Phase 3 — Human gate (the 5 irreducible questions)

After P2, ask the user the 5 questions no amount of code reading can derive. Update `cortex/AUDIT.md` § "Open questions (handed to Phase 3)" with the answers.

> "Audit je hotov v `cortex/AUDIT.md` — projdi si ho. 5 otázek, co kód neumí říct:"

### Q1 — Business priority
> "Kdyby ses měl tenhle týden rozhodnout, kterou jednu věc opravit / přidat — co je to a proč PRÁVĚ to?"

### Q2 — Threat model
> "Kdo je tvůj hlavní attacker? (uživatel zlomyslný, konkurence, supply chain, insider, …) Co je tvůj nejcennější asset?"

### Q3 — Production access map
> "Kdo má přístup do produkce? (full ACL list není potřeba, ale: 'já + jeden devops' / 'celý 5-člen tým' / 'jen CI'.) A: kdo manuálně spouští deploy v případě nouze?"

### Q4 — Social map
> "Co je v projektu, čeho se nemám dotýkat bez svolení? Modul, soubor, oblast — typicky: 'billing patří Bobovi', 'auth je legacy z 2022, neopravujeme'."

### Q5 — Success metric
> "Jak za měsíc poznáš, že tenhle audit dal smysl? Konkrétní metrika — `commits per week`, `test coverage`, `deploy frequency`, `incident count`, `velocity`. Ne 'je to lepší'."

Append answers to `cortex/AUDIT.md` § "Phase 3 — Human input":

```markdown
## Phase 3 — Human input

**Business priority:** <Q1 answer>
**Threat model:** <Q2 — attacker, asset>
**Prod access:** <Q3 — who, manual deploy fallback>
**Social map:** <Q4 — areas off-limits without permission>
**Success metric:** <Q5 — concrete metric, baseline now>
```

---

## Phase 4 — Auto-research (planner-driven, parallel)

**The planner agent** (`~/.claude/shared/agents/planner.md`) reads `cortex/AUDIT.md` § Executive summary + § Phase 3 answers, computes `topic_matrix = {detected_stack} × {concerns}` where concerns are weighted by P2 findings + P3 priorities, picks **3-5 most relevant** topics.

Topic naming: `{stack-or-profile}-{concern}-{year}`. Examples:
- `nextjs16-server-actions-csrf-2026`
- `supabase-rls-pitfalls-2026`
- `vercel-ai-sdk-v6-streaming-perf-2026`

Spawn the picked topics as parallel general-purpose agents (max 5). Each: 300-word report, citations, write to `$CORTEX_HOME/research/<slug>-audit-<date>.md` (single concatenated file, frontmatter `phase: 4-research`).

**Hallucination guards (mandatory):**
- `min_sources_per_claim: 2` (already in `config/research.yaml`)
- HEAD-request verification of every cited URL — 404 → reject the claim
- Recency: prefer sources from last 12 months for fast-moving stacks; explicit "as of <date>" in each finding

---

## Phase 5 — Synthesis

The synthesizer agent (`~/.claude/shared/agents/synthesizer.md`) reads:
- `cortex/AUDIT.md` (12 dims + human input)
- `$CORTEX_HOME/research/<slug>-audit-<date>.md` (P4 findings)

Writes **three artifacts**:

### 5a) `cortex/recommendations.md`

```markdown
---
phase: 5-synthesis
date: <YYYY-MM-DD>
based_on:
  audit: cortex/AUDIT.md
  research: $CORTEX_HOME/research/<slug>-audit-<date>.md
---

# Recommendations — <project name>, <date>

Stack: <detected>
Priority signal (from Q1): <user's stated priority>
Threat model (from Q2): <attacker / asset>
Success metric (from Q5): <metric, baseline>

## DO this week (cited)
- <action item, est. effort> [audit: §<X>] [src: <URL>]
- <action item, est. effort> [audit: §<X>] [src: <URL>]

## DO this sprint (cited)
- <action item> [audit: §<X>] [src: <URL>]

## SKIP (cited reasoning for NOT doing something tempting)
- <"don't migrate to X yet because Y"> [audit: §<X>] [src: <URL>]

## OPEN QUESTIONS (sources disagree or context-specific)
- <question> [src A] vs [src B]
```

### 5b) `CLAUDE.md` patches (proposed, not auto-applied)

If the project doesn't have `CLAUDE.md`, propose creating one from `~/.claude/shared/templates/CLAUDE.md.hbs`, hydrated with audit findings. If it has one, propose **diffs** (not rewrites):
- Add `## Standards (read before non-trivial work)` dual-link section per `new-project.md` §4.1a
- Add `## Audit reality check` section pointing to `cortex/AUDIT.md` and `cortex/recommendations.md`
- Add `## Stack reality check` if research surfaced material findings
- Update `## Tech Stack` if detected stack differs from declared

The user reviews via `[a]ccept all` / `[s]elect changes` / `[r]eject all`.

### 5c) Synthesized agents/hooks (project-specific)

Same `§4.3` synthesis pattern as `new-project.md`: per gap identified in audit, propose a project-specific agent or hook with research citation. Apply the SAME budget (max 3 agents + 2 hooks). Write proposals to `cortex/agents-proposed/` and `cortex/hooks-proposed/` — **do NOT install into `.claude/` automatically.** User reviews + moves the ones they accept.

---

## Phase 6 — ADR backfill (OPT-IN, requires `--backfill-adrs` flag)

Skip Phase 6 unless the user invoked the prompt with `--backfill-adrs` or explicitly asks "spusť ADR backfill" after Phase 5.

If skipped: surface in the closing summary the count of P2 §10 implicit-ADR candidates, with the explicit hint *"Detekoval jsem N implicitních rozhodnutí, spusť `/audit --backfill-adrs` pro draft."*

If invoked:

For each P6 candidate (typically 3-7 per project), generate `cortex/decisions/ADR-NNN-<slug>.md` from `~/.claude/shared/templates/ADR-retro.md.hbs`:

```markdown
---
adr: NNN
date: <YYYY-MM-DD>
status: retroactive
slug: <slug>
---

# ADR-NNN: <Title — e.g., "Auth on Clerk, not Supabase">

## Context (inferred from code+git)
<2-3 sentences from §10 audit>

## Decision (inferred)
<what was chosen>

## Consequences (observed in code)
- ✅ <positive observed>
- ❌ <negative observed>
- 🤔 <ambiguous / TBD>

## Evidence
- Commits: <hashes>
- Files: <file:line citations>
- Discussion (if any): <PR or issue link>

## Confidence
<low | medium | high — based on how much evidence exists>

> **This ADR is retroactive — generated by cortex-x `/audit` on <date>. The original decision was not documented at the time. Edit freely if you have additional context.**
```

After all candidates written, ask the user to review + delete any that aren't worth keeping.

---

## Phase 7 — Final on_complete

```
Existing-project audit done. Created in this directory:
- cortex/AUDIT.md             — 12-dimension senior-consultant audit
- cortex/recommendations.md   — DO this week / sprint, SKIP, OPEN questions
- cortex/MEMORY/repo-map.md   — token-budgeted symbol map
- cortex/decisions/ADR-*.md   — retroactive ADRs (only if --backfill-adrs)

Plus in cortex source:
- $CORTEX_HOME/research/<slug>-audit-<date>.md — raw research cache

Co dál?
- Začni s `DO this week` v cortex/recommendations.md
- Přijmi/zamítni navrhované patches v CLAUDE.md (Phase 5b)
- Přijmi/zamítni navrhované agenty v cortex/agents-proposed/ (Phase 5c)
- Pokud chybí ADR backfill: paste tento prompt s flagem `--backfill-adrs`
- Sync na konci sezení: paste ~/.claude/shared/prompts/cortex-sync.md
```

---

## Rules

- **Never overwrite the user's existing files** without explicit approval. CLAUDE.md, .claude/agents/, .claude/hooks/, package.json — all propose-don't-apply.
- **Never block on detector failure** — fail-open and proceed with degraded mode.
- **Always cite findings** — file:line, commit hash, or research URL. Findings without citations are invalid.
- **Three-hop traceability** — every claim in `cortex/recommendations.md` traces to a finding in `cortex/AUDIT.md` (or `$CORTEX_HOME/research/`), which traces to a source URL or commit hash. cortex-doctor enforces.
- **Respect the social map** — if the user said in Q4 that area X is off-limits, do not propose changes there even if the audit found issues. Surface as "FYI: <issues> in off-limits area X — flagged but not actionable per Phase 3 Q4."
- **Synthesis is evidence-gated** — same rule as `new-project.md` §4.3. No citation = no synthesis.

## Anti-patterns

- ❌ Skip the audit and go straight to "here are recommendations" → recommendations without grounding hallucinate
- ❌ Apply CLAUDE.md changes silently → breaks the user's existing project layout
- ❌ Run audit on a 5-file project → wrong tool; use `/start` (new-project) instead
- ❌ Force-install all default cortex-x agents/hooks → existing project may have its own; merge, don't replace
- ❌ Generate ADRs by default → 4-6h of LLM time per audit; opt-in only
- ❌ Treat `project-scan.md` and this prompt as interchangeable → project-scan is a 5-section institutional summary; this is a 12-dimension senior consultant deliverable

## Philosophy

cortex-x's audit is what a senior consultant would document on day 1 of an engagement: the bones (topology, repo map, hot spots), the patterns (conventions, tests, CI), the surfaces (observability, security, data), the history (implicit ADRs, tech debt, perf), the irreducibles (5 human questions), and the recommendations (with citations). All saved to disk as deliverables, not as chat scrollback.

The user can take `cortex/AUDIT.md` to a stakeholder, a co-founder, or to themselves three months later and read it cold. That's the bar.
