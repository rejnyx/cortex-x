# New Project — Discovery + Auto-Research + Architect + Scaffold + Adapt

> **How to use:** Create empty (or near-empty) folder, open Claude Code, paste this prompt. Claude vede the user through five explicit phases:
>
> 1. **Discover** — 6 questions, save to `cortex/discovery.md`
> 2. **Research** — 3-4 parallel agents, save to `$CORTEX_HOME/research/<slug>-<date>.md`
> 3. **Architect** — proposal saved to `cortex/proposal.md` with structured approval gate
> 4. **Scaffold** — generate filesystem (CLAUDE.md, PROGRESS.md, MEMORY.md, .claude/{hooks,agents,skills})
> 5. **Adapt** — post-scaffold auto-research on actually-realized stack → `cortex/recommendations.md` + `## Stack reality check` in CLAUDE.md
>
> Total flow: ~15 min. Each phase persists an artifact the user can review/edit.

---

## Mode auto-detect

**BAIL → QUICK SCAFFOLD** (the user already knows everything):
- Initial message contains name + description + profile ("3 questions answered")
- Or contains the word `skip` / `quick`
- Or the initial message has ≥80 words (the user already thought it through)
→ Skip Phase 1, jump to Phase 2 (research) and Phase 3 (proposal). Phase 1 artifact gets a stub `cortex/discovery.md` with whatever was extractable from the initial message.

**BOOTSTRAP MARKER → AUTO-START** (set by `install.sh` mode = new):
- A file `.cortex-bootstrap-pending` exists in `$PWD` with `mode=new`
- Auto-start at Phase 1 with greeting that acknowledges the install just ran
- Skill itself deletes the marker file after Phase 4 completes (one-shot semantics)

**FULL FLOW (default):** Phase 1 → 2 → 3 → 4 → 5

---

## Phase 1 — Discover (6 questions, conversational, in user's preferred language)

> **Principle 1 — Think Before Coding** ([`standards/coding-behavior.md`](../standards/coding-behavior.md)) applied: surface assumptions BEFORE scaffolding. Don't silently pick a stack; ask.

**Opener:**
> "Pojď si to rozmyslet. Projdu tě 6 otázkama — když na něco neznáš odpověď, řekni 'nevím' a jedu dál. Když už víš všechno a chceš scaffoldovat, napiš **skip** a přeskočím na konec."

### Q1 — Seed (always)
> "Popiš mi jednou větou, co ten projekt dělá. Klidně syrově — 'appka co X', 'nástroj pro Y'."

### Q2 — Pain (Mom Test, past-tense)
> "Kdy naposled jsi narazil na ten problém ty osobně (nebo někdo, kdo ti ho řekl)? Co jsi v tu chvíli udělal místo toho?"
> *Skip if* Q1 already names concrete user + event.

### Q3 — User (singular, not persona)
> "Kdo je ten JEDEN člověk, pro kterýho to primárně stavíš? Jméno, role, nebo 'já sám' — ne 'malé firmy v ČR'."

### Q4 — Scope (MVP boundary, Levels-style)
> "Kdyby sis za víkend měl postavit nejošklivější fungující verzi — co je to ONO jádro? Všechno ostatní je v2."

### Q5 — Not-doing list (explicit OUT)
> "Co tenhle projekt vědomě NEBUDE řešit? Napiš 2-3 věci, co by ses mohl nechat svést udělat, ale teď nechceš."
> *Skip if* Q4 gave tight scope (≤15 words + specific feature).

### Q6 — Success signal (validation, not vanity)
> "Jak poznáš za 2 týdny, že to má smysl pokračovat? Reálný metric — ne 'je to hezký', ale 'X lidí použilo' / 'mám prvního platícího' / 'ušetřilo mi to 2h týdně'."

### Q7 — AI integration (2026 default, not optional)
> "Jak AI zapadne do tohoto projektu? 3 možnosti:
> a) **AI-heavy** — je to agentic tool / chatbot / AI-powered feature jako core value prop (použij profil `ai-agent` nebo `chatbot-platform`)
> b) **AI-ready** — MVP bez AI, ale struktura připravená na budoucí AI features (safe-tool wrapper, memory scaffold, /api/chat endpoint reserved) — **tohle je 2026 default pro SaaS**
> c) **No AI** — skutečně nepotřebuje AI (static blog, landing page, portfolio) — použij profil `astro-static` nebo `minimal`
>
> Výchozí hodnota: **b) AI-ready**. Pokud řekneš 'nevím', default je b."

**Skip if:** Q1 + Q3 clearly indicates AI-heavy (e.g., "AI assistant", "chatbot", "autonomous agent") → auto-assume `a) AI-heavy`.
**Skip if:** profile is already `astro-static` / `minimal` → auto-assume `c) No AI`.

### Branching rules

| Trigger | Action |
|---|---|
| User typed `skip` at any Q | Jump to Phase 2 with current info |
| User answered `nevím` at Q6 | Propose 2 measurable criteria, user picks |
| Q3 = "já sám" | Tag as `dogfood`, raise bar on Q6 |

### Phase 1 hand-off — save `cortex/discovery.md`

**This is the new contract — do not skip.** Before transitioning to Phase 2, write `cortex/discovery.md` (create the `cortex/` directory if missing). Format:

```markdown
---
phase: 1-discovery
date: <YYYY-MM-DD>
slug: <kebab-case-from-Q1>
mode: <full|bail|bootstrap>
---

# Discovery — <project name draft>

## Q1 — Seed
<verbatim answer>

## Q2 — Pain
<verbatim answer or "skipped: covered by Q1">

## Q3 — User
<verbatim answer>

## Q4 — MVP scope
<verbatim answer>

## Q5 — Not-doing
<verbatim answer or "skipped: tight scope from Q4">

## Q6 — Success signal
<verbatim answer or "proposed: <criterion>" if user said nevím>

## Q7 — AI integration
**Choice:** <a | b | c>
**Reasoning:** <one sentence why>

## One-line vision
<single sentence the user (or you, if user gave 'nevím') would put on a landing page>
```

The user can edit this file before Phase 2 fires. After save, hand off: *"Saved discovery to `cortex/discovery.md`. Spouštím research na pozadí — research běží 2-3 min, mezitím sepíšu architect proposal."*

---

## Phase 2 — Auto-Research (parallel agents, 2-3 min)

**NEVER ask "do you want research?" — always do it.** Research is cortex-x's killer feature, silent by default.

**Protocol:** [`shared/research-protocol.md`](../shared/research-protocol.md). Config: [`config/research.yaml`](../config/research.yaml). Cache: `$CORTEX_HOME/research/<slug>-<date>.md`. Opt-out: `--no-research` in initial prompt.

Spawn **3 parallel research agents** (subagent_type: general-purpose) via the Agent tool. Add a 4th agent if Q7 ≠ `c) No AI`. Queries derived from `cortex/discovery.md`:

### Agent 1 — Domain research
Query based on Q1 + Q3:
> "Research 2026 best practices for `<Q1 project type>` targeting `<Q3 user>`. What are the common features, architectural patterns, pitfalls to avoid? Top 3 existing products and what they do well/poorly. 300-word report with URLs."

### Agent 2 — Technical research
Query based on pre-selected profile (derived from Q1):
> "Research 2026 implementation patterns for `<type>` using `<stack>`. Key libraries, architectural decisions, recent gotchas. Cite specific resources from anthropic.com, vercel.com, supabase.com, github.com trending. 300-word report."

### Agent 3 — Competitive/differentiator research
Query based on Q4 + Q5 (MVP + out-of-scope):
> "Research existing solutions that do `<Q4 MVP core>` specifically NOT doing `<Q5 out-of-scope>`. Who's in this space? What's their weakness the user could exploit as differentiator? 300-word report with URLs."

### Agent 4 — AI integration research (skipped only when Q7 = c)
Query based on Q1 + Q7:
> "Research AI integration points for `<Q1 project type>` in 2026. What AI features are:
> - **Table stakes** (competitors have them, users expect them) — must-have for parity
> - **Differentiator** (nobody does well yet) — opportunity for unique value
> - **Over-hyped** (sounds good, doesn't ship) — skip traps
> - **Technical patterns** specific to this project type (memory architecture, tool design, streaming UX)
> 300-word report with specific model recommendations (OpenAI/Anthropic/Gemini/local) and agentic architecture suggestions. Cite 2026 examples."

**While agents run:** Phase 3 drafting in parallel; merge research findings as they arrive.

### Cache research

Save to `$CORTEX_HOME/research/<slug>-<YYYY-MM-DD>.md`:

```markdown
---
project: <slug>
date: <YYYY-MM-DD>
agents: [domain, technical, competitive, ai]
---

# Research: <project name>

## Domain (2026 best practices)
<300 words from Agent 1 + URLs>

## Technical (<stack> patterns)
<300 words from Agent 2 + URLs>

## Competitive landscape
<300 words from Agent 3 + URLs>

## AI integration (skipped if Q7 = c)
<300 words from Agent 4 + URLs>

## Key insights (1-3 bullets synthesizing all agents)
- ...
```

---

## Phase 3 — Architect proposal (saved to `cortex/proposal.md`, structured approval gate)

**Before asking the user anything, write the full proposal to `cortex/proposal.md`.** The user can open it in their editor in parallel — that's the BMAD-spirit "review the artifact, not the chat scrollback" pattern.

```markdown
---
phase: 3-architect
date: <YYYY-MM-DD>
slug: <kebab-case>
sources:
  discovery: cortex/discovery.md
  research: $CORTEX_HOME/research/<slug>-<YYYY-MM-DD>.md
---

# Architect proposal — <project name>

## Shrnutí

**PROJEKT:** <3 name candidates, kebab-case>
**UŽIVATEL:** <Q3, one sentence>
**PROBLÉM:** <Q2, one sentence>
**MVP JÁDRO:** <Q4, max 5 bullets>
**EXPLICITNĚ MIMO:** <Q5>
**DEFINITION OF DONE (sprint 1):** <Q6, measurable>

## Doporučený stack (profile: <cortex-x profile name>)

<one-line reason for the profile choice>
- Framework: <e.g., Next.js 16>
- DB: <e.g., Supabase>
- Styling: <e.g., Tailwind 4 + shadcn/ui>
- Testing: <e.g., Vitest + Playwright>
- Deploy: <e.g., Vercel>

## Co říká research (CRITICAL)

**Domain:**
- <insight 1 from Agent 1, with citation>
- <insight 2 from Agent 1>

**Technical:**
- <insight 1 from Agent 2>
- <insight 2 from Agent 2>

**Competitive:**
- <insight 1 from Agent 3>
- <differentiator — what to leverage>

**AI integration (if Q7 ≠ c):**
- <insight 1 from Agent 4>
- <insight 2 from Agent 4>

**→ Concrete recommendations from research:**
- <action item 1 — e.g., "add feature X from day 1, it's table stakes [src: …]">
- <action item 2 — e.g., "avoid common mistake Y [src: …]">

## Risks (Cagan 4 big risks)

Tag only **real** risks (not all 4):
- 🟡 **VALUE:** <if value proposition unclear — from Q2>
- 🟡 **USABILITY:** <if UX is risky — from Q3>
- 🟡 **FEASIBILITY:** <if tech is risky — from research>
- 🟡 **VIABILITY:** <if business model is risky — from Q6>

## First sprint (5 stories, each ≤1 day)

| # | Description | Status |
|---|-------------|--------|
| 1.1 | <foundation story> | pending |
| 1.2 | <...> | pending |
| 1.3 | <...> | pending |
| 1.4 | <...> | pending |
| 1.5 | <first measurable outcome from Q6> | pending |
```

### Approval gate (structured, not free-form)

After saving, ask:

> "**Proposal je v `cortex/proposal.md`** — otevři si v editoru, zkontroluj.
>
> Co dál?
> - **`a`** — accept; jdu na Phase 4 Scaffold
> - **`e`** — edit; otevři proposal v editoru, řekni 'hotovo' až dopíšeš, načtu znovu a pokračuju
> - **`r`** — rewrite; co konkrétně zarazit / přeformulovat (chci feedback, ne celý nový brief)
> - **`q`** — quit; nech `cortex/discovery.md` a `cortex/proposal.md` na disku, vrátíme se příště"

**Behavior per choice:**
- `a` → proceed to Phase 4 with current `cortex/proposal.md`
- `e` → wait for the user; on resume, re-read `cortex/proposal.md` (it may have been edited externally), proceed to Phase 4
- `r` → take the user's feedback as a delta, regenerate proposal, write again, ask again
- `q` → save state, exit cleanly (artifacts persist; user can re-paste this prompt later and skip Phases 1-2)

**Free-form input handling:** if the user types something other than `a`/`e`/`r`/`q` (e.g. "ano scaffold ale change DB to PostgreSQL not Supabase"), interpret as **`r` with delta** and regenerate the proposal with that change baked in.

---

## Phase 4 — Scaffold (when `a` confirmed)

### 4.0 Resolve `$CORTEX_HOME` (BEFORE rendering any template)

Templates reference two kinds of paths:
- **Installed assets** (`~/.claude/shared/standards/`, `~/.claude/shared/prompts/`, `~/.claude/shared/agents/`, `~/.claude/shared/hooks/`) — resolved after `install.sh`/`install.ps1` runs. Use as-is in scaffolded files; tilde resolved by Claude/IDE.
- **Live source dirs** (`$CORTEX_HOME/projects/`, `$CORTEX_HOME/research/`, `$CORTEX_HOME/insights/`) — stay in the cortex-x source repo. Bake the absolute resolved path into scaffolded output.

**Resolution precedence (pick first that resolves to existing dir):**
1. `$CORTEX_HOME` / `$env:CORTEX_HOME` env var
2. `~/.claude/shared/cortex-source.yaml` (written by `install.sh`/`install.ps1`)
3. The directory where this `new-project.md` currently lives (the `prompts/` sibling's parent)

Bake the absolute resolved path into scaffolded output. If Dave later moves cortex-x source, the user re-runs `cortex-doctor` to detect and re-anchor.

### 4.1 Render scaffold
1. Scaffold per `profiles/<selected>.yaml` (structure, package.json, configs, Next.js/Astro/etc.)
2. Render templates with **data from `cortex/discovery.md` + `cortex/proposal.md`** (not generic placeholders):
   - `CLAUDE.md` — project-specific description, stack, architecture from proposal — **dual-link standards** per §4.1a below
   - `PROGRESS.md` — 5 stories from proposal §First sprint, project-specific
   - `MEMORY.md` + `memory/user_profile.md` + `memory/project_overview.md` with Q1-Q7 answers
   - `README.md` — one-sentence description from Q1

#### 4.1a Dual-link standards in scaffolded `CLAUDE.md`

Standards live upstream in cortex-x repo (canonical SSOT). Projects carry POINTERS, not copies. Render this section in CLAUDE.md:

```markdown
## Standards (read before non-trivial work)

These are pointers. Local path is what Claude Code reads at runtime; canonical
URL is the upstream SSOT for human readers and `cortex-doctor` freshness checks.

- **Security:** ~/.claude/shared/standards/security.md
  ↳ canonical: https://github.com/Rejnyx/cortex-x/blob/main/standards/security.md
- **Testing:** ~/.claude/shared/standards/testing.md
  ↳ canonical: https://github.com/Rejnyx/cortex-x/blob/main/standards/testing.md
- **Observability:** ~/.claude/shared/standards/observability.md
  ↳ canonical: https://github.com/Rejnyx/cortex-x/blob/main/standards/observability.md
- **Correctness:** ~/.claude/shared/standards/correctness.md
  ↳ canonical: https://github.com/Rejnyx/cortex-x/blob/main/standards/correctness.md
- **AI patterns:** ~/.claude/shared/standards/ai-patterns.md  (relevant when AI is part of the value prop)
  ↳ canonical: https://github.com/Rejnyx/cortex-x/blob/main/standards/ai-patterns.md

Skip pointers a project doesn't need. `astro-static` projects can drop AI patterns;
`hermes-agent` profile adds `~/.claude/shared/standards/agentic-security.md`.
```

`cortex-doctor` periodically compares each local file's hash to the canonical URL's content hash; warns if drift > 30 days.

### 4.2 Copy DEFAULT hooks + agents (baseline)
3. Copy hooks from `~/.claude/shared/hooks/` (block-destructive, session-start, pre-compact, post-tool-use, post-scaffold)
4. Copy agents from `~/.claude/shared/agents/*.md` → `.claude/agents/` (set from profile YAML `agents:` list)
   - Default: `cortex-thinker`, `blind-hunter`, `edge-case-hunter`, `acceptance-auditor`, `security-auditor`, `ssot-enforcer`

### 4.3 SYNTHESIZE project-specific agents + hooks (research-driven)

**This is the killer feature.** Default agents cover generic risks. This step adds **PROJECT-SPECIFIC guardians** based on research findings from Phase 2 and the proposal from Phase 3.

#### 4.3.1 Gap analysis
Read:
- Phase 2 research (domain/technical/competitive/AI outputs)
- Phase 3 proposal (stack, risks, MVP core)
- `~/.claude/shared/agents/*.md` (what default agents already cover)
- `~/.claude/shared/hooks/*.cjs` (what default hooks already cover)

Identify **gaps** — project-specific invariants the default set does NOT cover. Examples:

| Project type | Research finding | Synthesize |
|---|---|---|
| Deterministic agent runtime | "same seed must produce same output byte-exactly" | `determinism-auditor` agent + `pre-commit-seed-check` hook |
| Fraud detection | "PII must never leak into logs or traces" | `pii-leak-auditor` agent + `block-pii-in-commit` hook |
| Website-as-a-Service multi-tenant | "tenant isolation is business-critical" | `tenant-isolation-auditor` agent + `rls-policy-validator` hook |
| Restaurant kiosk PWA | "must work offline; service worker critical" | `offline-first-auditor` agent + `sw-registration-validator` hook |
| AMD ROCm workload | "ROCm + Ubuntu 22.04, not 24.04" | `rocm-env-validator` hook (pre-deploy check) |
| CLI tool on npm | "supply chain security (postinstall scripts)" | `postinstall-audit` hook |

**Rule:** Synthesize **ONLY** when:
- Research explicitly identified a constraint/risk
- Default set does not cover it
- The constraint is domain-specific (not generic)

Minimum: 0 new agents/hooks (if research yielded nothing beyond defaults).
Maximum: 3 new agents + 2 new hooks (more = overengineered).

#### 4.3.2 Agent synthesis (gap = behavioral audit)

Per agent gap, generate `.claude/agents/<slug>.md` using the frontmatter pattern from `~/.claude/shared/agents/blind-hunter.md` (template):

```markdown
---
name: <slug>
description: One-sentence purpose. Invoke via Task tool when <trigger>.
model: sonnet  # default; opus for critical audits
---

# <Name>

## Role
<What this agent checks — specific to this project>

## Context needed
<Files/dirs to read before auditing>

## Detection rules
1. <Concrete rule 1 with example>
2. <Concrete rule 2 with example>
…

## Evidence requirements
<Every finding must cite: file:line, expected vs actual, severity (blocker/warning/info)>

## Output format
<Structured markdown with verdict + findings list>

## Grounded in
- Phase 2 research: {URL from research cache}
- Phase 3 decision: {ADR reference}
```

#### 4.3.3 Hook synthesis (gap = deterministic pre/post-check)

Per hook gap, generate `.claude/hooks/<slug>.cjs`. Pattern from `~/.claude/shared/hooks/block-destructive.cjs`:
- CommonJS, cross-platform (use `os.homedir()`, `path.join()`)
- Return hook JSON output with the correct `hookEventName`
- Log decision (allow/deny/warn) to stderr
- **Never** block without a clear reason — research citation in the comment

Register in `.claude/settings.json` under the right event name (PreToolUse, PostToolUse, SessionStart, …).

#### 4.3.4 Documentation
Create `.claude/README.md`:
```markdown
# .claude — Project-specific Claude Code config

## Agents (default + synthesized)
- **Default** (from cortex-x/agents/): cortex-thinker, blind-hunter, …
- **Synthesized** (project-specific, based on Phase 2 research):
  - `<name>` — <one-liner>. Grounded in: <research citation>

## Hooks
- **Default** (from ~/.claude/shared/hooks/): block-destructive, session-start, …
- **Synthesized**:
  - `<name>` — <one-liner>. Grounded in: <research citation>
```

### 4.4 Rule 1 validation (BLOCKER — scaffold fails if violated)

Before finalizing, verify scaffold against [`standards/RULE-1.md`](../standards/RULE-1.md) checklist. If **any** check fails → regenerate, do not push forward.

**SSOT gate:**
- [ ] One `config/` only (not `src/config/` + `src/settings/` + `app/config/`)
- [ ] Design tokens have an SSOT file (`config/design-tokens.ts` or equivalent)
- [ ] No string literal duplicated ≥2× in scaffold (labels, URLs, constants)
- [ ] DB schema is SSOT (migrations) — no hand-written types that drift

**Modular gate:**
- [ ] Feature folder structure `src/features/<slug>/` or clear module boundary
- [ ] Adapter folder for external SDKs (`src/lib/<service>/`, no direct imports in UI)
- [ ] No circular imports (grep or dep-cruiser check)

**Scalable gate (for profiles with backend):**
- [ ] RLS enabled on all user-facing tables (even in MVP)
- [ ] Indexes on FK + query predicates in initial migration
- [ ] Rate-limit stub exists (`src/lib/rate-limit.ts`)
- [ ] Pagination pattern in API route template (don't return everything)

If **any gate** fails:
1. Log detail to stdout (which gate, why)
2. Regenerate the affected part
3. Re-validate
4. **Never** proceed to §4.5 with a violation

### 4.5 Finalize
8. Link research: in `CLAUDE.md` add reference to `$CORTEX_HOME/research/<slug>-<date>.md` (absolute path after §4.0 resolution)
9. **Auto-capture to cortex-x projects library.** Write `$CORTEX_HOME/projects/<slug>.md` (do NOT ask the user, write silently):

   ```markdown
   ---
   project: <slug>
   created: <YYYY-MM-DD>
   profile: <profile name>
   status: new
   ---

   # <Project name>

   ## Overview
   <Q1 description, one sentence>

   ## Stack
   <framework> · <database or "n/a"> · <AI provider or "n/a">

   ## MVP core
   <Q4 answer verbatim>

   ## Out of scope (not-doing)
   <Q5 bullets>

   ## Success signal
   <Q6 measurable metric>

   ## Research cache
   - <absolute path to $CORTEX_HOME/research/<slug>-<date>.md>

   ## Synthesized reviewers
   <list of project-specific agents from §4.3, or "none — default set covers all findings">

   ## Synthesized hooks
   <list of project-specific hooks from §4.3, or "none">
   ```

   This ensures `session-start.cjs` doesn't flag "project not in cortex library" on the very first boot.

10. `git init` + first commit with message reflecting vision (not generic)
11. **Delete `.cortex-bootstrap-pending`** if it exists in `$PWD` (one-shot semantics — install marker is consumed).
12. **Write `cortex/.adapt-pending`** with one line `phase=5 at=<ISO timestamp>` to mark scaffold-done-but-Phase-5-not-yet. This is a recovery marker for the SessionStart hook in case the session is interrupted before Phase 5 completes. Phase 5 §5.5 deletes it on completion.

### 4.6 Audit output

```
Scaffold done. Created:
- N files total
- K default agents + L synthesized agents (grounded in research)
- M default hooks + P synthesized hooks (grounded in research)

Synthesized artifacts:
- .claude/agents/<name>.md — "<purpose>" (from research finding: <cite>)
- .claude/hooks/<name>.cjs — "<purpose>" (from research finding: <cite>)
```

The user reviews; if a synthesized agent/hook looks overengineered → "remove `<name>`" → delete + log to `$CORTEX_HOME/insights/` what didn't fit (learning material for next scaffold).

---

## Phase 5 — Adapt (post-install auto-research, NEW)

After §4.5 finalize, **before** §4.6 audit output, fire the post-scaffold auto-research engine. This catches the gap between *predicted-stack* research (Phase 2 — based on user's intention) and *actually-realized-stack* findings (Phase 5 — based on what scaffold installed: package.json versions, profile-locked libraries, profile-default deploy target).

### 5.1 Trigger

The prompt drives Phase 5 directly (Claude Code does not expose a PostScaffold hook event — keeping this in-prompt avoids fictional hook dependencies). Sequence:

1. Phase 4 §4.5 step 12 (`Write cortex/.adapt-pending`) marks the project as "scaffold done, Phase 5 not yet run." This is a **recovery marker**: if the session is interrupted between Phase 4 and 5, on the next SessionStart the hook surfaces the marker so Claude can offer to resume.
2. The prompt then proceeds to §5.2 in the SAME session — dispatch planner agent immediately. The user sees scaffold complete + research kicked off as one continuous flow.
3. After §5.4 synthesizer writes both artifacts, §5.5 deletes `cortex/.adapt-pending`.

### 5.2 Planner agent

The `planner` agent (`~/.claude/shared/agents/planner.md`) reads:
- Realized `package.json` (versions matter — Next.js 16.0.3 vs 16.1.0 may have different gotchas)
- Selected profile YAML
- Phase 1 `cortex/discovery.md` (domain words for context)

It computes `topic_matrix = {profile_or_stack} × {concern}` where concerns ∈ `{security, performance, testing, observability, deployment, ecosystem-gotchas}`. It picks **3-5 most relevant** topics for THIS project — not all 6 concerns × all stack components, just the ones with non-trivial 2026 surface area.

Example output (planner emits a JSON list):
```json
[
  {"topic": "nextjs16-server-actions-csrf-2026", "concern": "security", "priority": 1},
  {"topic": "supabase-rls-pitfalls-2026", "concern": "security", "priority": 2},
  {"topic": "vercel-ai-sdk-v6-streaming-perf-2026", "concern": "performance", "priority": 3},
  {"topic": "tailwind4-migration-traps-2026", "concern": "ecosystem-gotchas", "priority": 4}
]
```

### 5.3 Parallel dispatch

Spawn the picked topics as **parallel** general-purpose agents (max 5, matches `config/research.yaml: max_count: 5`). Each agent: 300-word report with citations, write to a per-topic finding file `$CORTEX_HOME/research/<slug>-stack-<date>.md` (single file with all findings concatenated, frontmatter `phase: 5-adapt`).

Each finding must satisfy `min_sources_per_claim: 2`. Verify each cited URL via a HEAD request — 404 → reject the claim.

### 5.4 Synthesizer agent

The `synthesizer` agent (`~/.claude/shared/agents/synthesizer.md`) reads all findings and writes **two artifacts**:

**a) `cortex/recommendations.md`** (this is the per-project AI output):

```markdown
---
phase: 5-adapt
date: <YYYY-MM-DD>
based_on: $CORTEX_HOME/research/<slug>-stack-<date>.md
---

# For YOUR project — <project name>, <date>

Stack: <detected from package.json>
Domain context: <one sentence from discovery>

## DO (cited)
- <action item> [src: <URL>]
- <action item> [src: <URL>]

## SKIP (cited)
- <"don't do X for your stack/scale, here's why"> [src: <URL>]

## OPEN QUESTION (sources disagree)
- <"two authoritative sources contradict on X — decide before MVP"> [src A] vs [src B]
```

**b) Append `## Stack reality check` to the project's `CLAUDE.md`:**

```markdown
## Stack reality check (Phase 5 Adapt, <date>)

cortex auto-researched your realized stack. Top items:

- ✅ <key positive finding>
- ⚠️ <key caution finding>
- 🔍 <one open question to resolve>

Full report: cortex/recommendations.md
Raw sources: $CORTEX_HOME/research/<slug>-stack-<date>.md
```

### 5.5 Cleanup

- Delete `cortex/.adapt-pending` marker (one-shot)
- Run cortex-doctor's three-hop citation check on `CLAUDE.md` § Stack reality check — fail loud if any claim has no traceable URL

### 5.6 Skip conditions

- `--no-research` flag in initial prompt
- Profile is `astro-static` or `minimal` (no AI, lightweight stacks; auto-research over-delivers)
- `cortex/.adapt-pending` already exists from a previous run that completed (idempotent guard)

---

## Phase 6 — Final on_complete

After Phase 5 (or after §4.6 if Phase 5 was skipped), end with this exact closing line so the user knows what's next:

```
Hotovo. Co dál?
- Začít první story: otevři PROGRESS.md, vyber 1.1
- Cortex sync na konci sezení: paste ~/.claude/shared/prompts/cortex-sync.md
- Pokud začneš modifikovat existující codebase mimo scaffold (např. v existujícím projektu): paste ~/.claude/shared/prompts/audit-existing.md (skill /audit)
- Něco se zamotá: paste ~/.claude/shared/prompts/cortex-doctor.md
```

This is the BMAD-spirit `on_complete` instruction — every prompt should end by telling the user what comes next.

---

## Rules

- **Never skip discovery** unless auto-bail triggers (user explicit skip / already has all 3 questions / ≥80 word first message).
- **Never ask "do you want research?"** — always run Phase 2 in parallel. Research is silent + automatic.
- **Never use generic placeholders** — every file must be personalized by Phase 1 answers.
- **Never skip cortex-x standards** — every project inherits via dual-link.
- **Always save phase artifacts** — `cortex/discovery.md` (P1), `$CORTEX_HOME/research/<slug>-<date>.md` (P2), `cortex/proposal.md` (P3), `cortex/recommendations.md` (P5). The chat is not the source of truth; the files are.
- **Respect SSOT** — CLAUDE.md holds current state, research is a pointer not a duplicate.
- **Czech in Q1-Q6 + proposal** — user's language.
- **Synthesis is evidence-gated** — new agent/hook only with research citation. No citation = no synthesis.
- **Synthesis budget** — max 3 agents + 2 hooks beyond the default set. More = overengineered.
- **Structured architect approval** — `[a]ccept` / `[e]dit` / `[r]ewrite` / `[q]uit`. Free-form drifts.
- **Three-hop citation traceability** — every claim in CLAUDE.md § Stack reality check links to a finding ID in research cache, which links to a source URL. cortex-doctor enforces.

## Anti-patterns

- ❌ Scaffold without discovery → generic output, the user has to rewrite everything
- ❌ Asking "do you want research?" → slows flow, research should be default
- ❌ Research AFTER scaffold ONLY (no pre-scaffold research) → too late, decisions already made; cortex does BOTH (Phase 2 pre-scaffold prediction, Phase 5 post-scaffold reality check)
- ❌ 10+ questions → completion rate drops past 7 (research)
- ❌ Persona thinking → "small businesses in country X" = useless, "a specific named user at a specific role" = actionable
- ❌ Future-tense questions → "would you use?" useless, "kdy naposled?" actionable (Mom Test)
- ❌ Synthesizing agents/hooks "for completeness" → generic `code-quality-auditor` = default set already has it. Synthesize only when research says "this project needs something specific that defaults don't cover."
- ❌ Generating an agent without a research citation → hallucination, delete.
- ❌ Inline proposal only (no `cortex/proposal.md` file) → user can't edit before scaffold; chat scrollback is not a review surface.
- ❌ Free-form approval gate ("ok ale...") → drifts; structured choices are explicit hand-off.

## Philosophy

Each new project starts with **6 questions that force the user to think** + **auto-research that saves 2 hours of googling** + **research-backed scaffold that's personalized** + **post-scaffold reality check on the actually-realized stack**.

cortex-x is a senior product partner, not a template engine. Phase 1 captures intention, Phase 2 grounds intention in 2026 best practice, Phase 3 architects the proposal, Phase 4 builds it, Phase 5 corrects course before the first commit. Five phases, five saved artifacts, zero magic.

## Research methodology reference

Flow design grounded in:
- Mom Test (Rob Fitzpatrick) — past-tense questions
- Lean Canvas (Ash Maurya) — 1-pager validation
- Cagan 4 big risks (SVPG) — risk tagging framework
- Pieter Levels indie hacker workflow — MVP boundary thinking
- Teresa Torres opportunity solution tree — user-problem-solution mapping
- BMAD-METHOD — handoff artifacts pattern (analyst → architect → dev), pre-implementation readiness gate
- Aider architect mode — saved-artifact + reasoner/executor split
- Anthropic multi-agent research paper — parallel dispatch, 90.2% lift on breadth-first queries (capped at 5 to keep cost rational)
