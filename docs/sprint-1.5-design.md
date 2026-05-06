# Sprint 1.5 — Onboarding upgrade + retrofit audit + auto-bootstrap + auto-research

> **Status:** Design draft v1, 2026-05-06
> **Owner:** David Rajnoha (Rejnyx)
> **Decision needed:** Dave reviews + approves architecture before any code lands.
> **Branch this lives on:** `main`
> **Source-of-truth for blockers:** [`MIGRATIONS.md`](../MIGRATIONS.md) + [`docs/public-launch-plan.md`](./public-launch-plan.md) §4 Sprint 1

This doc captures the **architecture** for Sprint 1.5 — the gap between "Sprint 1 ships a public-installable v0.1.0" and "cortex-x is a category-defining onboarding/retrofit framework." Sprint 1.5 is what the maintainer means by **"fakt origo"**.

The doc is grounded in two research passes run 2026-05-06 (BMAD-METHOD architecture + 2026 onboarding patterns; retrofit-audit best practices + auto-research dispatch).

---

## 1. Honest assessment first

**cortex-x is already top-tier in its mental model.** Institutional wisdom (cortex) vs current state (project CLAUDE.md) is cleaner than BMAD's `_bmad/` + `_bmad-output/` + 4-file TOML override stack. The existing Phase 5 self-improvement loop, Rule 1.5 wizard philosophy, detectors/ classifiers, and config/research.yaml with topic-aware TTL are further than BMAD goes.

**Where the gap is real:**

1. **Onboarding flow is good, not great.** `prompts/new-project.md` (~451 lines) does discovery → research → scaffold in one voice. BMAD splits that across analyst → PM → architect → UX → SM with explicit handoff artifacts. The win isn't the role names, it's the **persisted intermediate artifact** (`proposal.md` saved to disk, reviewable, editable, before scaffold writes any source). Today the proposal lives only in chat scrollback.
2. **Audit/retrofit flow is intentionally SLIM** (5 sections, ~5K tokens) — correct for *populating the cortex library*, **wrong for actually understanding a 50K-LOC project on day 1**. There's no equivalent of "senior consultant audit": no repo map, no hot spots × complexity, no implicit-ADR archaeology, no 12-dimension tech-debt inventory.
3. **Install branching doesn't exist.** A user runs `install.sh` and gets the framework. They don't get walked into "are you starting fresh or retrofitting?" at install time — the choice happens later when they paste a prompt. That's a decision-point with no UX.
4. **No auto-bootstrap.** `install.sh` copies framework assets to `~/.claude/shared/`. It does NOT generate `CLAUDE.md` / `MEMORY.md` / `PROGRESS.md` / `.claude/{hooks,agents,settings.json}` for the project the user just landed in. The user must paste `prompts/new-project.md` manually.
5. **No auto-research after install.** Auto-research-as-trigger exists in `config/research.yaml`, but only fires inside the new-project prompt. After install (greenfield or retrofit) there's no automatic adaptation pass that reads detected stack and merges 2026-current findings into CLAUDE.md.

**The "fakt origo" combo** is *agentic-ready scaffold + deep retrofit audit + parallel auto-research + auto-bootstrap + Hermes profile* — that combo has no peer in 2026. **It does NOT come from adopting BMAD wholesale.** BMAD's own v6.3 consolidation (3 agents merged into Amelia) is BMAD admitting its earlier fragmentation went too far. Cortex-x should take BMAD's *spirit* (handoff artifacts, pre-implementation readiness gate, `on_complete` "what's next") plus Aider/OpenHands' *single-session two-mode flow*, not BMAD's 6 personas + 34 workflows + fresh-chat-per-workflow ceremony.

---

## 2. Recommended Sprint 1.5 architecture

### 2.1 Install-time mode question (the missing UX)

**Constraint discovered via Claude Code CLI research (2026-05-06):** Claude Code does not expose a `--skill` or `--invoke` CLI flag. There is no way for `install.sh` to subprocess-launch `claude` *with a skill pre-armed*. Hooks also cannot directly prompt the user for input mid-session — interactive elicitation only works while Claude is already running, and even then via the `AskUserQuestion` tool, not from hooks.

**Correct pattern: shell asks → marker file + env var → SessionStart hook reads → primes Claude.**

Add an interactive prompt to `install.sh` / `install.ps1` (after asset copy, before exit):

```
cortex-x installed.

What are you doing in your CURRENT directory?

  [N] New project        — empty / near-empty folder; walk me through brief → architect → scaffold
  [R] Retrofit existing  — established codebase; deep audit then propose fits
  [F] Framework only     — I'll paste prompts manually (legacy default)

Choice [N/R/F]:
```

**Branching behavior:**
- **N** → write `$PWD/.cortex-bootstrap-pending` containing `mode=new\nat=<ISO timestamp>\n`; emit hint: `Now run: claude` (in this directory).
- **R** → write `$PWD/.cortex-bootstrap-pending` with `mode=retrofit\n…`; emit same hint.
- **F** → no marker file written; emit the README "available prompts" list. Identical to today's behavior.

**SessionStart hook integration** (extends existing `~/.claude/shared/hooks/session-start.cjs`):
- On every session start, check `$PWD/.cortex-bootstrap-pending`. If present, parse mode + timestamp.
- If mode is `new` and timestamp is < 1 hour old: append additional context to the SessionStart hook output: *"User just ran `cortex-x install` and selected NEW PROJECT. The skill `/start` (cortex new-project) is available — invoke it after greeting the user, unless they say otherwise."*
- If mode is `retrofit`: same pattern with `/audit` (deep-retrofit-audit).
- After the bootstrap skill runs to completion, the skill itself deletes `.cortex-bootstrap-pending` (one-shot semantics).

**Skill discovery:** per Claude Code docs, skills in `.claude/skills/<name>/SKILL.md` are auto-discovered — no allowlist needed. Cortex-x ships `start.skill.md` and `audit.skill.md` as part of the install (copied by install.sh from the source repo into `.claude/skills/` of the **target project**, not into the framework's own dir). The skills carry `disable-model-invocation: false` so Claude can both auto-invoke (when the SessionStart hook primes them) and respond to explicit `/start` / `/audit`.

**Cross-platform fallback:** if the user's shell can't read input (non-tty, e.g. `curl … | bash` piped install), the installer prints the three modes + how to set `CORTEX_BOOTSTRAP_MODE=new|retrofit` env var manually, then exits. SessionStart hook also reads the env var as alternative source.

**Implementation:** ~3 hours. install.sh + install.ps1 input loop (~1h), SessionStart hook extension (~1h), `.cortex-bootstrap-pending` parser + skill registration (~1h). All testable on Win11 PowerShell + Git Bash + Linux/macOS.

**Why not subprocess `claude`?** Because there's no flag to auto-load a skill. Subprocessing Claude Code from a script gives a session that does nothing until the user types — strictly worse UX than the marker-file pattern (which gives Claude *real context* about what just happened so it can volunteer the next step naturally).

### 2.2 Greenfield onboarding upgrade — 5 phases, NOT 6 personas

Take BMAD's *artifact pattern*, leave its persona ceremony. Reorganize `prompts/new-project.md` into 5 explicit phases with each phase outputting a **saved file**, not just inline output:

| # | Phase | Input | Output (saved) | Hand-off |
|---|---|---|---|---|
| 1 | **Discover** | Empty folder + initial user message | `_cortex/discovery.md` (Q1–Q7 answers + 1-line vision) | → P2 |
| 2 | **Research** | `_cortex/discovery.md` + chosen profile | `research/<slug>-<date>.md` (4 parallel agents per existing pattern) | → P3 |
| 3 | **Architect** | discovery + research cache | `_cortex/proposal.md` (stack decision, MVP scope, 5 risks, 5-story sprint) — **REVIEW GATE** | user `[y]` → P4 |
| 4 | **Scaffold** | All planning artifacts | Filesystem: `CLAUDE.md`, `PROGRESS.md`, `MEMORY.md`, `.claude/{hooks,agents,settings.json}`, profile files | → P5 |
| 5 | **Adapt** | Filesystem + first commit | `research/<slug>-stack-<date>.md` + appended `## Stack reality check` in `CLAUDE.md` | done |

**Key delta vs today:**
- Phase 1's output is a *file* the user can review/edit before research dispatches.
- Phase 3's `_cortex/proposal.md` is a **review gate** — user reads it, edits if needed, types `[y]` before scaffold writes any `src/`. This is the BMAD-style pre-implementation readiness gate adapted to single-session.
- Phase 5 is **new** — auto-research-after-install per §2.5.

**Skip logic preserved:** existing BAIL flow (≥80-word brief skips Q1–Q6) still applies. `astro-static` and `minimal` profiles skip Phase 5.

**Implementation:** restructure existing `prompts/new-project.md` (don't write a new prompt — that splits SSOT). ~6 hours.

### 2.3 Retrofit audit — new prompt, deep by design

The existing `prompts/project-scan.md` is *correct as-is* for populating `$CORTEX_HOME/projects/<slug>.md` (5-section institutional summary). It is **wrong** for retrofit. Retrofit needs a **separate, deeper prompt**: `prompts/deep-retrofit-audit.md`.

**12-dimension audit** (grounded in research §1; ranked by load-bearing weight):

| # | Dimension | Auto-extracted | Human-only |
|---|---|---|---|
| 1 | Repo topology + build graph | package.json/turbo.json/nx.json walk; dependency-cruiser/skott | — |
| 2 | Symbol-level repo map | tree-sitter + PageRank (Aider pattern) | — |
| 3 | Hot spots (churn × complexity) | `git log --numstat` × cyclomatic; Tornhill method | which periods to exclude |
| 4 | Conventions / style | .eslintrc, .prettierrc, sample 30 files | *why* a convention exists |
| 5 | Test posture | runner detection + coverage + flake list | which tests are load-bearing |
| 6 | CI/CD state | parse workflow files; `gh api` for branch protections | who has prod access |
| 7 | Observability surface | grep logger/sentry/posthog/otel imports | which metrics matter |
| 8 | Security posture | `osv-scanner V2` + `socket.dev` + `gitleaks` | threat model |
| 9 | Data model + migrations | walk Prisma/Supabase/Drizzle | which tables are PII/regulated |
| 10 | Implicit ADRs | code+commit archaeology (`blueprint-derive-adr` pattern) | the *why* behind past choices |
| 11 | Tech-debt inventory | 9-dim scan (architectural decay, type rot, doc drift, …) | business priority |
| 12 | Performance hygiene | bundle analyzer, lighthouse CI, N+1 AST patterns | SLO targets |

**Phase order inside `deep-retrofit-audit.md`:**

```
P0  detect    profile / stage / sister-env / monorepo  (existing detectors/, fail-open)
P1  repo-map  tree-sitter + PageRank → MEMORY/repo-map.md
P2  audit     4 parallel agents owning 12 dims (3 each)
P3  human     ask 5 irreducible questions (priorities, threat model, prod access, social map, success metric)
P4  research  planner reads audit → topic_matrix → 3-5 parallel WebSearch+WebFetch
P5  synth     write AUDIT.md + recommendations.md + CLAUDE.md patches
P6  ADR       propose 3-7 retroactive ADRs (opt-in via flag --backfill-adrs)
```

**New files to add:**
- `prompts/deep-retrofit-audit.md`
- `detectors/repo-map.cjs` (tree-sitter wrapper, fail-open if binding unavailable)
- `detectors/hotspots.cjs` (`git log --numstat` parser + complexity sampler)
- `templates/AUDIT.md.hbs`
- `templates/recommendations.md.hbs`
- `templates/ADR-retro-NNN.md.hbs`
- `standards/repo-map.md` (explains the artifact)

**Files to modify:**
- `prompts/retrofit.md` — add gate "if `MEMORY/repo-map.md` not present, run `/audit` first."
- `config/research.yaml` — add `mode: dynamic|static` + planner role
- `shared/hooks/session-start.cjs` — auto-load `MEMORY/repo-map.md` if present

**Implementation:** ~22 hours total (M1 repo-map 8h, M2 audit prompt + 4-agent split 6h, M3 hot-spots 4h, M4 ADR backfill 4h).

### 2.4 Auto-bootstrap of project artifacts

The user's request: *"after install, cortex should automatically create all needed things — CLAUDE.md, MEMORY.md, PROGRESS.md, hooks, agents."* That is **two layers of work**, not one:

**Layer A — shell-time skeleton (install.sh):** when the user picks mode **N** or **R**, install.sh writes *non-AI-generated skeletons* into `$PWD` immediately:
- `CLAUDE.md` — minimal placeholder ("Filled by `/start` or `/audit`. Project type: pending.") + tech-stack section as `<!-- pending -->`.
- `PROGRESS.md` — Sprint-0 placeholder per `templates/PROGRESS.md.hbs`.
- `MEMORY.md` — empty index per `templates/MEMORY.md.hbs`.
- `.claude/settings.json` — copies `templates/settings.json.hbs` (hooks already point to `~/.claude/shared/hooks/*.cjs`; nothing project-specific).
- `.claude/hooks/` — empty dir; project-level hooks (if any) added later by `/start` Phase 4 based on profile.
- `.claude/agents/` — empty dir; same logic.
- `.claude/skills/start.skill.md` + `.claude/skills/audit.skill.md` — copied from cortex source so the slash-commands resolve from session 1.
- `.cortex-bootstrap-pending` — marker file per §2.1.

This means: **after `install.sh` returns control, the project already has structure on disk.** No "empty folder" feeling. Files exist, even if they say "pending."

**Layer B — first-session AI fill (greenfield Phase 4 / retrofit Phase 5):** when Claude opens and the SessionStart hook detects `.cortex-bootstrap-pending`, it primes Claude to invoke `/start` (or `/audit`). The skill's Phase 4/5 then *replaces* the skeleton CLAUDE.md/MEMORY.md/PROGRESS.md with profile-aware, research-aware content, AND populates `.claude/agents/` and any project-specific hooks.

**Why two layers?** Because the shell installer cannot reason about "what profile is this, what tech stack, what AI-readiness." It can only emit deterministic skeletons. The intelligent fill is Claude's job. But splitting these means: (a) the user sees structure immediately (= trust signal), (b) if the user *never* runs `/start`, the skeletons are still useful starting points (not bare repo).

**What does NOT get auto-bootstrapped at install time:**
- `package.json` / build config / dependency installs — profile-driven, comes from Phase 4 Scaffold
- Any code under `src/` — same
- README.md — Phase 4 writes one based on profile + discovery answers; install.sh leaves it alone if it exists, generates a stub if not
- Tests, eslint, etc. — Phase 4

**Implementation:** ~3 hours for install.sh to drop skeletons + copy skill files + write marker file. Cross-platform: PowerShell version of install.ps1 mirrors the same logic (`New-Item`, `Copy-Item`).

**Risk:** if user already has `CLAUDE.md` (e.g. they're retrofitting a project that already has cortex-x or similar), don't overwrite. install.sh should detect existence and skip OR back-up-then-replace based on mode (`R` retrofit always preserves; `N` new should never see existing files anyway because the folder is supposed to be empty/near-empty).

### 2.5 Auto-research after install (the differentiator)

This is **Phase 5 of greenfield** and **Phase 4 of retrofit** in the design above. Same engine, same caching, same merger, different trigger.

**Decision tree (detectors → topic list):**

```
detect-profile  → {nextjs-saas, ai-agent, browser-agent, cli-tool, astro-static, ...}
detect-stage    → {greenfield, mvp, growth, mature, legacy}
detect-sister   → {monorepo, single-pkg, polyglot}
        ↓
topic_matrix = profile × concern_dimensions
            (concerns = {security, performance, testing, observability, deployment, ecosystem-gotchas})
        ↓
planner agent (LLM) prunes topic_matrix to 3-5 most relevant for THIS project
        ↓
parallel dispatch (3-5 agents, 3-min budget per existing config/research.yaml)
        ↓
synthesizer agent merges → research/<slug>-stack-<date>.md (cache, immutable)
                       → recommendations.md (action items, mutable)
                       → CLAUDE.md `## Stack reality check` (one section appended)
```

**Topic taxonomy (standardize):** `{stack-or-profile}-{concern}-{year}`. Examples for `nextjs-saas` retrofit:
- `nextjs16-security-2026` (Server Actions CSRF, RSC data leaks)
- `supabase-rls-pitfalls-2026`
- `vercel-ai-sdk-v6-migration-2026`
- `tailwind4-breaking-changes-2026`
- `pnpm-workspace-cve-2026`

**Conflict resolution:**
- Recency wins, with 60-day grace period
- Domain authority weighting (already in `config/research.yaml prefer_domains`)
- Disagreement surfacing: when two authoritative recent sources contradict, write both as `OPEN QUESTION:` in `recommendations.md` with citations — let the user decide
- Hallucination guard: `min_sources_per_claim: 2` (already configured) + verification fetch of every cited URL (404 → reject)

**Citation discipline:** every claim in `CLAUDE.md` § Stack reality check links to a finding ID in `research/<slug>-stack-<date>.md`, which links to a source URL. **Three-hop traceability.** If chain breaks, `cortex-doctor` flags as drift. This is the existing SSOT principle applied to research.

**Trigger config addition** (extends existing `config/research.yaml`):

```yaml
- name: post_install_adaptation
  when: scaffold_just_finished AND research/<slug>-stack-*.md not present
  agents: 3-5  # planner picks count
  required: true
  budget_override:
    max_research_per_session: 2  # this is the 2nd of session
  output:
    cache: research/<slug>-stack-<YYYY-MM-DD>.md
    actions: recommendations.md
    summary: append-to-CLAUDE-stack-reality-check
```

**Async dispatch via post-scaffold hook:** add `shared/hooks/post-scaffold.cjs`. Fires after Phase 4 of greenfield or Phase 5 of retrofit. Spawns research **in background** so the user sees scaffold complete *immediately*; then a SessionStart message on next reopen: *"Stack research finished — N findings merged into CLAUDE.md."*

**Implementation:** ~10 hours (planner agent 4h, post-scaffold hook 2h, synthesizer agent 2h, conflict-resolution policy + cortex-doctor drift check 2h).

---

## 3. What Sprint 1.5 does NOT include

**Explicitly declined** (BMAD-style overhead with no proportional payoff for solo work):

- Six named persona agents (Mary/John/Sally/Winston/Amelia/Paige). Cortex-x already has `cortex-thinker`, `blind-hunter`, `security-auditor`, `ssot-enforcer`, `acceptance-auditor`, `edge-case-hunter`. The function names are clearer than persona names for code-review work.
- Fresh-chat-per-workflow rule. Opus 4.7 1M context makes this ceremony redundant.
- TOML 4-file customization stack (`config.toml` + `config.user.toml` + `custom/config.toml` + `custom/config.user.toml`). cortex-x's `module.yaml` + `module.local.yaml` already does the job.
- Separate UX-Designer agent. Greenfield Phase 3 (Architect) folds UX considerations into the proposal where they matter; for AI-heavy profiles the existing `ai-patterns.md` carries the load.
- PRFAQ workflow. The existing 6-question elicitation in `prompts/new-project.md` does the same job in 5 minutes.
- Enterprise track (full PRD + Arch + Security + DevOps docs). Wrong audience for v0.1; revisit if a 100+ employee org adopts cortex-x.
- `_bmad/` and `_bmad-output/` folders. Project root + `.claude/` is cleaner.

---

## 4. Concrete file plan

### 4.1 New files (Sprint 1.5 commits)

```
prompts/deep-retrofit-audit.md              ← retrofit entry point
detectors/repo-map.cjs                       ← tree-sitter + PageRank, fail-open
detectors/hotspots.cjs                       ← git churn × complexity
templates/AUDIT.md.hbs                       ← 12-dim audit output
templates/recommendations.md.hbs             ← research → action items
templates/ADR-retro-NNN.md.hbs               ← retroactive ADR template
standards/repo-map.md                        ← artifact contract
shared/hooks/post-scaffold.cjs               ← async auto-research trigger
agents/planner.md                            ← topic_matrix → dispatch list
agents/synthesizer.md                        ← merge research → CLAUDE.md patch
docs/install-mode-ux.md                      ← install.sh branching spec
```

### 4.2 Modified files

```
install.sh / install.ps1                     ← mode question + Claude-CLI auto-launch
prompts/new-project.md                       ← 5-phase restructure with saved artifacts
prompts/retrofit.md                          ← gate to deep-retrofit-audit
config/research.yaml                         ← +planner role, +mode dynamic|static, +post_install_adaptation trigger
shared/hooks/session-start.cjs               ← auto-load MEMORY/repo-map.md
prompts/cortex-doctor.md                     ← +three-hop citation traceability check
.claude/skills/start.skill.json              ← if exists, point to new-project; else create
.claude/skills/audit.skill.json              ← new, points to deep-retrofit-audit
```

### 4.3 Files NOT touched (don't break working flow)

```
prompts/project-scan.md     ← keep slim 5-section, different scope from retrofit-audit
prompts/cortex-load.md      ← orthogonal (mental model for ongoing sessions)
prompts/cortex-sync.md      ← orthogonal (post-session knowledge capture)
prompts/cortex-evolve.md    ← orthogonal (self-improvement loop)
prompts/cortex-reflect.md   ← orthogonal
standards/RULE-1.md         ← Rule 1 invariants are stable
standards/security.md, testing.md, observability.md, correctness.md  ← Rule 2, stable
```

---

## 5. Milestones (~45 hours total, can run partially in parallel)

| # | Milestone | Hours | Depends on | Validates with |
|---|---|---|---|---|
| M1 | Install-mode question + Claude-CLI auto-launch | 3 | — | manual on Win/Mac/Linux |
| M2 | `prompts/new-project.md` 5-phase restructure with `_cortex/proposal.md` review gate | 6 | — | eval-001 re-run, baseline delta |
| M3 | `detectors/repo-map.cjs` (tree-sitter + PageRank) | 8 | — | dogfood on cortex-x repo itself |
| M4 | `detectors/hotspots.cjs` (churn × complexity) | 4 | — | dogfood on RELO repo |
| M5 | `prompts/deep-retrofit-audit.md` (P0–P5, ADR backfill optional) | 8 | M3, M4 | dogfood on portfolio + RELO |
| M6 | `agents/planner.md` + `agents/synthesizer.md` (auto-research engine) | 8 | M2 | unit test against frozen `nextjs-saas` topic_matrix |
| M7 | `shared/hooks/post-scaffold.cjs` async trigger | 4 | M6 | end-to-end: install → scaffold → auto-research → CLAUDE.md patched |
| M8 | `cortex-doctor` three-hop citation drift check | 2 | M7 | unit test |
| M9 | Field-test on real project (RELO retrofit + new portfolio scaffold) | 6 | M1–M8 | written field-test report |

**Critical path:** M1 ‖ (M3 → M5) ‖ (M2 → M6 → M7 → M8) → M9.

**Parallelizable bundles:**
- Bundle A (independent): M1 (install UX) ‖ M3 (repo-map) ‖ M4 (hotspots)
- Bundle B (sequential): M2 → M6 → M7 → M8
- Bundle C (gated): M5 (needs M3+M4), M9 (needs everything)

---

## 6. Risks + mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Tree-sitter binding breaks on Windows | Medium | High | Fail-open in `detectors/repo-map.cjs`; degrade to file-list-only mode; document in `standards/repo-map.md` |
| Auto-research hallucinates, writes wrong recommendations | Medium | High | `min_sources_per_claim: 2` + URL-verification fetch + `recommendations.md` cited line-by-line; `cortex-doctor` flags drift |
| `.cortex-bootstrap-pending` marker not consumed (skill never runs) | Medium | Low | Marker has timestamp; SessionStart hook ignores markers > 1h old. Doctor command flags stale markers. |
| User runs `claude` from wrong directory after install (marker not in $PWD) | Medium | Low | Install hint explicitly says "now run `claude` in **this directory**." SessionStart hook walks up 3 parent dirs as fallback; if no marker found, no-op. |
| 5-phase restructure regresses existing eval-001 score | Low | Medium | Re-run eval-001 after M2; if regress, revert to single-phase prompt |
| Auto-research blows the token budget on retrofit of huge repos | Medium | Medium | `max_research_per_session: 1` cap (already configured); RepoMap PageRank O(V+E) is fine; audit agents fan-out is the cost driver — cap at 5 |
| Repo-map staleness on every doctor run | Low | Low | Cursor's chunk-hash cache pattern: hash file mtimes; only re-parse changed files |
| BMAD-style ceremony creeps in beyond what's planned | Low | Medium | This doc is the contract; PR review gate enforces it |

---

## 7. Open questions (decide before M1 starts)

1. **Repo-map producer: in-process Node tree-sitter (slower, zero-deps) vs. shell-out to Rust binary like `RepoMapper` (faster, optional dep)?**
   - **Recommendation:** start with in-process Node (`tree-sitter` + per-language `tags.scm` from Aider, MIT-forkable). Allow `RepoMapper` as opt-in for projects > 50k LOC via a `repo_map.engine: rust|node` config in `module.yaml`.

2. **`recommendations.md` location: project root (visible) or `cortex/` subdir (out-of-the-way)?**
   - **Recommendation:** `cortex/recommendations.md` with a one-line pointer in `CLAUDE.md`. Visible enough to find; doesn't pollute project root with framework artifacts.

3. **Retrofit ADR backfill (Phase 6): opt-in or mandatory?**
   - **Recommendation:** opt-in via `--backfill-adrs` flag, but ALWAYS surface in the audit summary: "We detected N implicit decisions worth documenting. Run `/audit --backfill-adrs` to draft them." User chooses; never silent.

4. **`_cortex/` directory name: keep it, or use `cortex/` (no underscore)?**
   - **Recommendation:** `cortex/` (no underscore). Cleaner. Prefix-free. The `_cortex/` underscore is a BMAD pattern for "internal/hidden" — cortex-x doesn't need to hide; it should be visible and editable by the user.

5. **Phase 3 Architect step UX: structured Y/N prompt or free-form approval?**
   - **Recommendation:** structured. Output `_cortex/proposal.md` then ask: "Review proposal at `cortex/proposal.md`. Type `[a]ccept` / `[e]dit` / `[r]ewrite` / `[q]uit`." Free-form approval drifts.

6. **Hermes profile (Sprint 2) — ship before or after Sprint 1.5?**
   - **Recommendation:** **after**. Sprint 1.5 makes cortex-x adopt-able for greenfield + retrofit *without* Hermes. Hermes is the "agentic-heavy" multiplier on top of an already-strong base. Shipping Hermes first means people install cortex-x for Hermes and discover the onboarding is meh — wrong order.

---

## 8. Definition of done (Sprint 1.5)

- [ ] M1–M8 merged to main, each with green review pipeline
- [ ] M9 field-test report committed to `journal/` showing measurable improvement vs Sprint 1 baseline (eval-001 score, retrofit-audit dogfood time, auto-research output quality)
- [ ] `docs/public-launch-plan.md` §4 Sprint 1.5 updated with results
- [ ] `cortex-doctor --check-clean-install` passes for a fresh user (separate test, listed in launch plan)
- [ ] Launch plan §2 audit table updated with Sprint 1.5 deltas

---

## 9. What this doc does not yet decide

- Hermes Agent profile (Sprint 2) — covered in launch plan §4 Sprint 2; Sprint 1.5 does not block on it
- D-1 / D-2 (destructive history purge + GPG key) — user-executed, Sprint 1 work
- Eval-001 baseline re-run — Sprint 1 work, will inform M2 regression check
- Marketing / landing page (Sprint 4) — out of scope here

---

## 10. Decision log for this design session

- **2026-05-06** — BMAD-METHOD researched (commit reference: BMAD repo state at session time). Decision: take the *spirit* (handoff artifacts, pre-impl readiness gate, on_complete instructions); decline the *ceremony* (6 personas, 34 workflows, fresh-chat-per-workflow, TOML 4-file overrides). Grounded in BMAD's own v6.3 consolidation evidence (Barry+Quinn+Bob → Amelia).
- **2026-05-06** — Aider RepoMap chosen over Cursor indexing for cortex-x retrofit. Reason: zero-infra (tree-sitter portable, no embedding service, no vector DB). Aider's `tags.scm` files are MIT-licensed.
- **2026-05-06** — Auto-research will use existing `config/research.yaml` infrastructure plus a new `post_install_adaptation` trigger. Anthropic multi-agent paper cited: 90.2% lift on breadth-first queries, 15× cost — cap at 5 agents (matches existing `max_count: 5`).
- **2026-05-06** — Three-hop citation traceability adopted as SSOT extension: claim → finding ID → source URL. `cortex-doctor` enforces.
- **2026-05-06** — Claude Code CLI primitives researched (third pass). Confirmed: no `--skill` / `--invoke` flag for auto-launching skills; hooks cannot prompt user mid-session; skills auto-discover from `.claude/skills/` (no allowlist). §2.1 + §2.4 revised to use the **marker-file + env-var + SessionStart-hook** pattern instead of subprocess invocation. Lower magic, more robust, reuses primitives Claude Code already documents.
