---
title: Steward / cortex-x roadmap — v0.8 → v1.0 → enterprise-adjacent
status: living document — updated as sprints land
created: 2026-05-09
last_review: 2026-05-09
scope: Single source of truth for the post-Sprint-1.8.13 trajectory. Captures all directions surfaced in the 2026-05-08 SOTA brainstorm + the 4-repo inspection (NousResearch hermes-agent, agent0ai/agent-zero, browser-use/browser-harness) + Karpathy autoresearch. Every sprint here is a hypothesis to refine, not a commitment to ship as-written.
based_on:
  - Brainstorm research dispatch 2026-05-08 (SOTA autonomous agent techniques)
  - Inspection research dispatch 2026-05-08 (4 inspiration sources)
  - Sprint 1.8.12 + 1.8.13 incident loop (real validation gap demonstration)
  - VentureBeat Karpathy autoresearch piece (March 9, 2026, 8.6M views)
---

# Steward / cortex-x roadmap

## 0. North Star

> **Cortex-x evolves from "senior dev compressed into a repo" to "self-extending agent ecosystem that runs while the operator sleeps."** Every sprint must demonstrably move us closer to one of three north-star metrics:
>
> 1. **Verification fidelity** — % of agent edits that don't introduce regressions undetected by `npm test`.
> 2. **Throughput per operator-hour** — net useful PRs Steward opens per hour of operator review time.
> 3. **Self-evolution rate** — # of new capabilities/skills/strategies the agent itself contributes per week.

We currently score: ~70% / ~1 PR per 5 review-min / 0 self-contributions per week.
Frontier (2026-05): ~95% / ~5 PRs per 5 review-min / measurable self-evolution.

## 1. Operating principles for this roadmap

These rules are non-negotiable. Each sprint must satisfy all of them before merge.

| # | Principle | Enforcement |
|---|---|---|
| **R1** | **Research-before-implement.** Every sprint kicks off with a focused web-research dispatch (general-purpose agent, ~600-1200 word brief) on the SOTA for that specific direction *as of the day work starts*. The 2026 frontier shifts in weeks; the cached 2026-05 research expires fast. | Sprint cannot move from "planned" to "in-progress" without a `docs/research/<sprint>-<topic>-<date>.md` decision memo committed. |
| **R2** | **Review pipeline mandatory.** Every sprint that touches `bin/steward/_lib/` or any Rule 1/2 module gets the 6-agent parallel review (acceptance + blind + correctness + security + ssot + edge-case) before commit lands on main. Pattern proven in Sprint 1.6.18 + reused continuously. | `cortex-evolve` review pipeline run, all blocker-severity findings closed. |
| **R3** | **One incident class = one defense layer = one regression test.** Sprint 1.8.12/1.8.13 set the precedent: every real failure mode shipped today produced a code defense + a regression test. No class is fully closed without both. | Test count grows monotonically. Today: 790. After v1.0: ≥1500. |
| **R4** | **Cost ceiling preserved.** Current full-cadence Steward spend is ~$0.024/month. Multi-agent / overnight burst sprints will raise this — but never above $5/month at full cadence per project. Anything bigger needs explicit operator authorization. | `HERMES_DAILY_USD_CAP` enforcement + monthly journal cost rollup. |
| **R5** | **No human-only edits become Steward-able.** `standards/`, `prompts/`, `profiles/`, `agents/`, top-level `CLAUDE.md`/`README.md`/`module.yaml` are human-only forever. Any sprint extending Steward capability that wants to relax this is automatically rejected. | `bin/steward/_lib/policy-check.cjs` HUMAN_ONLY_PATH + HUMAN_ONLY_TOPLEVEL rules. |
| **R6** | **Backward-compatible by default.** Existing 9 action_kinds keep working through every sprint. New capabilities are additive. Breaking changes are reserved for explicit `vN.0.0` major bumps. | `MIGRATIONS.md` entry per sprint + tests for all 9 existing kinds stay green. |

## 2. Current state (post Sprint 1.8.13)

| Layer | Status |
|---|---|
| 9-kind action palette | ✅ shipped (v0.8) |
| Safety: halt-check + lock + journal + denylist + policy-check | ✅ shipped |
| Pre-LLM defenses: apiKey trim + KEY_MALFORMED reject | ✅ Sprint 1.8.12b |
| Post-LLM defenses: AUTH_REJECTED distinct + content-preservation | ✅ Sprint 1.8.12c + 1.8.13 |
| Verification: `npm test` boolean gate | ⚠️ insufficient (proven by Sprint 1.8.13 incidents) |
| Multi-agent: parallel workers / supervisor | ❌ single-agent only |
| Self-improvement: ReasoningBank-lite via lessons.jsonl | ⚠️ lessons recorded but not used as training signal |
| Observability: file-based journal + status CLI | ⚠️ no dashboards / regression diffs |
| Cron coverage | ✅ daily 03:00 harvester + 04:00 recommendation, weekly Sunday dep-patch, monthly 1st todo-triage |
| Auto-PR creation | ✅ verified (PR #5, 2026-05-08) |
| Tests | 790/790 ✅ |
| CI grid | test ✅ install-smoke ✅ no-pii ✅ |

## 3. Tier 1 — Foundation for v1.0 (next 6 weeks, Sprint 1.9 → 2.3)

**Goal**: close the verification gap, enable multi-agent throughput, get measurable observability. Each Tier 1 sprint is a hard prerequisite for at least one Tier 2 sprint.

### Sprint 1.9 — Spec-driven verification ✅ SHIPPED 2026-05-09

**Status**: ✅ Shipped 2026-05-09 (commit `c5d0c8f`). 871/871 → 900/900 tests across all 3 CI lanes. R1 decision memo: [`docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md`](research/sprint-1.9-spec-driven-verification-2026-05-09.md). Operator approved Option D with all 5 default answers.

**What shipped (vs original scope)**:
- ❌ NOT `cortex/specs/<kind>.spec.yaml` — operator-approved memo Option D rejected the YAML schema for in-registry declaration. SSOT = `bin/steward/_lib/action-kinds.cjs acceptance_criteria[]`. cortex/specs/ kept as extension-spec archive (markdown narrative + plan-override examples).
- ✅ New module `bin/steward/_lib/spec-verifier.cjs` (~530 LoC) — 5 criterion kinds (shell, file_predicate, regex, ears_text, llm_judge), runs BEFORE `npm test` (Q5 default).
- ✅ 8 new error codes: `SPEC_VIOLATION`, `SPEC_WARNING`, `SPEC_MALFORMED`, `SPEC_PREDICATE_THREW`, `SPEC_SHELL_TIMEOUT`, `SPEC_REGEX_NO_MATCH`, `SPEC_OVERRIDE_REJECTED`, `SPEC_LLM_JUDGE_NOT_IMPLEMENTED`.
- ✅ Sprint 1.8.13's hardcoded `EDIT_DESTRUCTIVE_REWRITE` removed from action-engine.cjs; lives only as `recommendation` kind's `no_destructive_rewrite` criterion.
- ✅ Defense-in-depth: `PREDICATE_DENYLIST` blocks `process|require|globalThis|Function|eval|child_process|...` tokens at validateCriterion time.
- ✅ 81 new tests (69 unit + 6 contract + 7 integration; old 1.8.13 tests migrated).
- ✅ `cortex-steward status` renders `spec_violations` rollup (by_criterion_id + recent failures).
- ✅ R2 review pipeline ran 5/6 agents (blind-hunter blocked on path); 9 must-fix items applied before commit (partial-write rollback, Promise predicate detection, ENOENT vs SHELL_TIMEOUT, applies_to:[] semantics, runChecks try/catch, system prompt SSOT, EARS doc 4→5 patterns, lessons root_cause encoding, status spec_failures rendering).

**Follow-up sprints unlocked**: 2.0 (Langfuse), 2.0b (model routing — see PIVOT below), 2.1 (autoresearch fitness signal feeds spec-verifier), 2.3 (mutation testing of spec-verifier itself), 5.1 (souls have their own acceptance_criteria).

**Sprint 1.9.1 backlog**: ears_text runtime semantics, render `spec_failures` block in PR body, EISDIR + symlink hardening in applyEditsToFilesystem, property tests for spec-verifier invariants.

---

### Sprint 1.9.1 — Multi-window cost safety + cross-session loop detector (S effort, ⭐ PRE-2.x POJISTKA)

**Why before Sprint 2.x**: today we have `HERMES_DAILY_USD_CAP` $5/day + `HERMES_FAILURE_BREAKER` 3 fails/1h per-action_key. Mid-week burst (Sprint 2.1 autoresearch overnight) or month-long slow drift (Sprint 2.0 Langfuse instrumentation that hits provider's hot path every action) can quietly accumulate $150/month before any single day trips the daily cap. Real-incident anchor: April 2026 dev's $437 retry-loop bill. Lower-effort sprint with high blast-radius reduction; ship before unleashing autoresearch.

**Scope**:
- `HERMES_WEEKLY_USD_CAP` (default $25) — sliding 7-day journal window sum.
- `HERMES_MONTHLY_USD_CAP` (default $80) — calendar-month journal window sum.
- `HERMES_TOKEN_VELOCITY_CAP` (default 50K tokens / 5min sliding window) — burst protection for ensemble + autoresearch.
- **Cross-session loop detector**: same `spec_failures[0].id` fires ≥ 5x in last 7 days for same action_key → write `.cortex/HERMES_HALT` with reason `LOOP_DETECTED:<criterion_id>:<action_key>`. Halt is operator-cleared (manual `rm` per existing kill-switch UX).
- **Budget warnings**: when current spend reaches 80% of daily/weekly/monthly cap, journal a `budget_warning` event (not blocking) so `cortex-steward status` shows the operator they're approaching the cap.
- `cortex-steward status --forecast` flag: extrapolate current rate × days remaining in window → projected end-of-window spend. JSON + human modes both expose forecast block.

**New error codes**:
- `BUDGET_WEEKLY_CAP_REACHED` (parallel to existing `BUDGET_CAP_REACHED` for daily)
- `BUDGET_MONTHLY_CAP_REACHED`
- `TOKEN_VELOCITY_CAP_REACHED`
- `LOOP_DETECTED` (halt reason in HERMES_HALT)

**Acceptance criteria for the sprint itself**:
- [ ] All 3 caps work in the existing pre-flight gate location (before lock acquisition, like daily cap).
- [ ] Token velocity gate has 5-min sliding window precision.
- [ ] Loop detector triggers on simulated 5x same-criterion failure pattern (integration test).
- [ ] Forecast shown when spend > 50% of any cap.
- [ ] Existing daily cap behaviour unchanged (regression).
- [ ] ≥ 15 new tests, full suite stays green.

**Implementation files**:
- New `bin/steward/_lib/cost-safety.cjs` (~200 LoC) — window-sum + velocity computation.
- `bin/steward/execute.cjs` — hook the new gates in pre-flight order: daily → weekly → monthly → velocity → loop.
- `bin/steward/status.cjs` — render new caps + forecast block.
- New `tests/unit/steward/cost-safety.test.cjs` (~12 tests) + `tests/integration/cost-safety-pipeline.test.cjs` (~5 tests).

**Out of scope**: alerting (email/Telegram). Operator reads status output during normal cadence; alert pipeline waits for Sprint 2.0 (Langfuse handles it).

**Stolen from**: industry incident response patterns + cortex-x's own R3 principle (one incident = one defense layer + one regression test). Audit-of-the-audit: the absence of monthly/velocity gates was flagged by operator's intuition during 2026-05-09 review, validated by web research showing Anthropic OAuth restrictions + similar runaway-cost incidents.

---

### Sprint 2.0 — Observability-as-a-service (S effort, easy win)

**Why second**: zero meaningful evolution without measurement. Current journal is fine for forensics but useless for "did week-over-week prompt change improve recommendation quality?" Self-hosted Langfuse runs in Docker, OpenLLMetry-compatible, no telemetry leak.

**Scope**:
- Self-hosted Langfuse via `docker compose` in `infra/observability/` (new dir, not in main repo — separate `ops/` repo or maintainer-private compose file).
- Wrap OpenRouter `fetch()` call in `action-engine.cjs` with OpenLLMetry tracer.
- Mirror `journal.cjs` writes to Langfuse traces.
- Dashboards: cost per kind / week, prompt regression diff, action_key failure cluster, latency p50/p95.

**Pre-implementation research dispatch**:
- "Langfuse vs Phoenix vs Helicone (RIP) for self-hosted agent observability 2026-05. OpenLLMetry semantic conventions for tool-calling agents. Single-developer setup constraints."

**Stolen from**: Langfuse self-hosted reference architecture.

---

### Sprint 2.0b — Action-kind-based model routing (S effort, PIVOT 2026-05-09)

**PIVOT rationale (2026-05-09 web research)**: original scope was RouteLLM-style query-difficulty classification. 2026 SOTA literature converges on **role/task-type routing**: Augment Code (Opus coordinate / Sonnet implement / Haiku navigate / GPT-5.2 review), Anthropic multi-agent research (role-routed +90.2% over single-Opus on retrieval), Karpathy compound-systems framing. NousResearch hermes-agent's 4-mode pattern (`cheap` / `fix` / `code` / `plan`) is the same idea.

**Cortex-x has the taxonomy for free**: 9 `action_kinds` are already a clean role taxonomy. RouteLLM-style classifier training is unnecessary.

**Scope**:
- Per-`action_kind` model mapping in `bin/steward/_lib/action-kinds.cjs` (or sibling `model-routing.cjs` to keep registry focused on contracts):
  - **cheap tier** (no LLM): `recommendation_harvest`, `dep_update_patch`, `flaky_test_repair`, `doc_drift`, `todo_triage`, `test_coverage_gap`, `lint_fix_shipper`, `pr_review_responder` — already deterministic, no model call.
  - **balanced tier**: `recommendation` → `deepseek/deepseek-v4-flash` (today's default).
  - **premium tier**: future `architecture_review`, `release_notes_drafter` → `claude-opus-4-7` or `gpt-5.3`.
  - **ensemble tier** (optional): `recommendation` can route to 3-cheap-model ensemble + agent-as-judge consensus before applying — kept as opt-in `HERMES_ROUTING_PROFILE=ensemble`.
- New env knob: `HERMES_ROUTING_PROFILE=cheap|balanced|premium|ensemble` (default: `balanced`).
- New CLI flag: `--mode plan|code|fix|cheap` (NousResearch hermes-agent UX surface) — ergonomic override that maps to balanced/balanced/cheap/cheap.
- `extractUsage` already accepts array shape (Sprint pre-2.0 housekeeping) — ensemble tier ready to use without further refactor.

**Pre-implementation research dispatch (R1)**:
- "Q2 2026 update on Augment Code role-based routing + Anthropic multi-agent research. Specific model pairings for 9 action_kinds × 4 routing profiles. Cost/latency reality of DeepSeek V4 Flash vs Qwen3 Coder Flash vs GPT-5.2 Mini for code-edit + judge use."

**Stolen from**: Augment Code routing guide 2026 + Anthropic multi-agent research stack + NousResearch hermes-agent mode UX.

**Effort drop**: was M (RouteLLM training + classifier serving), now S (mapping table + env knob + CLI flag).

---

### Sprint 2.1 — Steward autoresearch / overnight burst mode (M effort, ⭐ TRANSFORMATIVE)

**Why third (after 1.9 + 2.0)**: Karpathy autoresearch has 8.6M views in 2 days. The pattern is mainstream as of 2026-03. We are running 1 experiment per night while frontier runs 100+. Order-of-magnitude throughput delta.

**Scope**:
- New mode: `node bin/cortex-steward.cjs autoresearch --max-actions=20 --max-budget-usd=2 --max-time-min=300 --diverge-strategies=3`.
- New workflow `.github/workflows/hermes-autoresearch.yml` cron `0 22 * * *` (22:00 UTC = 00:00 CEST, true overnight).
- For each picked action: generate 3 candidate strategies (3 LLM calls), apply each, run npm test + spec criteria (Sprint 1.9), judge picks best, others rollback.
- After 20 actions / $2 / 5h, opens a single master draft PR with N atomic commits.
- Cost: ~$2/month at full cadence (still 100× under Devin/Codex).

**Pre-implementation research dispatch**:
- "Karpathy autoresearch follow-ups May-June 2026. Hyperspace AI distributed variants. Failure modes (validation set spoilage, over-fitting). What's the actual best-practice for run-budget shaping + judge prompts in 2026-Q2?"

**Stolen from**: Karpathy's 630-line script (MIT) + Hyperspace AI distributed pattern + AlphaEvolve / OpenEvolve.

---

### Sprint 2.2 — Worktree supervisor + agent-as-judge ensemble (L effort)

**Why after 2.1**: 2.1 proves the multi-strategy pattern serial; 2.2 makes it parallel via git worktrees. Composio Agent Orchestrator is the open-source reference.

**Scope**:
- Split `runExecute()` into `runSupervisor()` + `runWorker(N)`.
- `git worktree add cortex/hermes-run-{N}` per worker.
- Lock manager generalized from 1-mutex to N-mutex.
- Judge agent prompt evaluates N branches against spec criteria + commit clarity + cost.
- 4 workers in parallel = 4× throughput at ~4× cost (still <$10/month full cadence).

**Pre-implementation research dispatch**:
- "Composio Agent Orchestrator + Cursor Parallel Agents + Claude Code Agent Teams + Grok Build worktree patterns. State-of-the-art supervisor↔worker protocols 2026-05. Conflict resolution + judge prompting techniques."

**Stolen from**: Composio AO + agent-zero subordinate hierarchy + Team Atlanta ensemble patching.

---

### Sprint 2.3 — Mutation testing as fitness signal (S-M effort)

**Why round out Tier 1**: makes verification *more* rigorous than just "tests pass". If LLM patch passes tests but mutation score regresses, reject — the existing tests aren't actually exercising the diff.

**Scope**:
- Stryker (JS mutation testing) integrated into `verifier.cjs` as a post-`npm test` gate (only for `recommendation` kind initially, since deterministic kinds don't change code logic).
- Pre-edit baseline mutation score captured to journal.
- Post-edit mutation score must be ≥ baseline; if lower → `EDIT_MUTATION_REGRESSION`.

**Pre-implementation research dispatch**:
- "Stryker for JS in 2026 + Property-Generated Solver (arXiv 2506.18315) + Meta FSE 2026 mutation-guided LLM test gen. Performance budget for incremental mutation testing."

**Stolen from**: Stryker Mutator + Meta FSE 2026 paper.

---

## 4. Tier 2 — Compound learners (weeks 7-12, Sprint 3.0 → 3.3)

**Goal**: turn cortex-x into a self-evolving system. After Tier 2, prompts/strategies/skills get measurably better every week without operator intervention.

### Sprint 3.0 — AlphaEvolve-style prompt evolution (L effort, ⭐ MOONSHOT)

**Why**: this is the only direction that compounds. After 50 generations, Steward prompts will beat your hand-tuned baselines by measurable margin — and you didn't write any of them.

**Scope**:
- New module `bin/steward/_lib/prompt-evolver.cjs`.
- For each kind: generate 3 candidate prompts → run on held-out fixture set (`tests/fixtures/`) → score via Sprint 1.9 spec criteria → keep top-1, archive rest.
- After N=50 generations, promote winning prompt to `prompts/<kind>.md`.
- Held-out fixtures rotated periodically to prevent overfitting (Sprint 1.9 + 2.1 community concern flagged).

**Pre-implementation research dispatch**:
- "OpenEvolve / CodeEvolve (arXiv 2510.14150) / AlphaEvolve (arXiv 2506.13131) implementation patterns 2026. Mutation operators for prompt evolution. Validation-set spoilage countermeasures."

**Stolen from**: AlphaEvolve + OpenEvolve + Karpathy autoresearch loop.

---

### Sprint 3.1 — Self-extending capabilities (`skill-experiments/`) (L effort, ⭐ MOONSHOT)

**Why**: from browser-use/browser-harness — agent writes its own missing helpers during execution. Most ambitious of the lot.

**Scope**:
- New dir `cortex/agent-workspace/skill-experiments/<slug>/<kind>.cjs`.
- When LLM identifies a missing capability mid-action, it generates a candidate helper, sandboxes execution, evaluates against test fixtures, commits to skill-experiments if useful.
- After N successful uses (≥ 5), helper graduates to `bin/steward/_lib/skills/<name>.cjs` via human-reviewed PR.
- Constraint: skills can only `require()` Node built-ins + already-shipped cortex-x modules. No new npm deps.

**Pre-implementation research dispatch**:
- "browser-use/browser-harness self-extending pattern detailed implementation 2026. Sandbox execution for agent-generated code. Promotion criteria from experimental to stable. Security implications of agent-authored helpers."

**Stolen from**: browser-use/browser-harness + Karpathy autoresearch + agent-zero plugin pattern.

---

### Sprint 3.2 — FTS5 skill index + cross-project lesson sharing (M effort)

**Why**: lessons.jsonl is linear-scan, fine for one project. Cross-project federated learning needs indexed query. NousResearch's hermes-agent has FTS5 in production at 139k-star scale.

**Scope**:
- SQLite FTS5 index over `cortex/hermes-lessons.jsonl` (per-project) + `~/.cortex/lessons.federated.jsonl` (cross-project).
- New helpers `lessons.searchByText()` + `lessons.searchByActionKind()` + `lessons.searchByErrorCode()`.
- Action-engine recall step (Sprint 1.8.3) uses FTS lookup instead of scoring full archive.
- Cross-project sync: opt-in via `cortex/cortex-source.yaml` flag, signed entries to prevent poisoning.

**Pre-implementation research dispatch**:
- "SQLite FTS5 patterns for agent memory 2026. NousResearch hermes-agent skill curation implementation. Cross-tenant memory poisoning defenses + signing patterns."

**Stolen from**: NousResearch/hermes-agent skill curation + ReasoningBank federated angle.

---

### Sprint 3.3 — GraphRAG codebase context (M effort)

**Why**: single LLM call sees ~5 files of context. GitNexus reports 6.8× fewer tokens / 49× more capability with Tree-sitter knowledge graph. Critical for client projects (RELO has thousands of files).

**Scope**:
- Tree-sitter parse on `npm install` + on-demand refresh.
- Local SQLite-backed graph (FalkorDB later if needed).
- New helper `codeGraph.findCallSites(symbol)` + `codeGraph.findImporters(file)`.
- Per-kind retrieval: `dep_update_patch` queries call sites of breaking symbol, `recommendation` queries importers of mentioned files.

**Pre-implementation research dispatch**:
- "GitNexus + code-review-graph + AST GraphRAG (arXiv 2601.08773) + FalkorDB 2026 patterns. Tree-sitter incremental update strategies. Semantic search on top of AST graphs."

**Stolen from**: GitNexus + GraphRAG papers.

---

## 5. Tier 3 — Productization + enterprise-adjacent (weeks 13-20)

**Goal**: cortex-x stops being "Dave's personal tool" and becomes "distributable senior-engineer-as-a-service." Each Tier 3 sprint is an independent revenue/positioning lever.

### Sprint 4.0 — Capability marketplace (S-M effort)

**Why**: agentskills.io spec is already shipped. cortex-x can be the npm-of-skills. Drag-drop new action_kind into a project, instant capability.

**Scope**:
- Public registry of community-contributed action_kinds.
- `cortex add-skill <name>` CLI command.
- Sandbox + signing + lint gates before a community skill can land.
- Initial seed: contribute 3-5 community skills cortex-x already has (e.g. publish `dep_update_patch` as standalone skill).

**Stolen from**: agentskills.io spec + npm registry model.

---

### Sprint 4.1 — WaaS angle for clients (M-L effort, $$$ lever)

**Why**: Champions Barber, Amici, Objedname — Dave's existing clients. Each gets own Steward instance. $50/month per client = recurring revenue + tangible AI value-add.

**Scope**:
- Per-client cortex-x deployment template.
- Client-facing dashboard (Langfuse-derived) showing weekly autonomous improvements.
- Service tier model: starter (deps + lint only), pro (full palette), enterprise (custom kinds).

**Stolen from**: agency / SaaS service-tier conventions.

---

### Sprint 4.2 — Recommendation auto-sourcing (M effort)

**Why**: humans are the bottleneck on recommendations.md curation. Slack message → auto-recommendation. GitHub issue mentioned in Discord → auto-recommendation.

**Scope**:
- Slack/Discord webhook listeners.
- LLM filter: "is this an actionable recommendation, or noise?"
- Auto-append to `cortex/recommendations.md` if filter passes.
- Operator daily digest of new auto-sourced items.

**Stolen from**: Linear / Notion auto-capture patterns.

---

### Sprint 4.3 — Voice → recommendation (S effort, fun)

**Why**: Dave dictates while driving / walking. Telegram bot → voice → Whisper → recommendations.md.

**Scope**:
- Telegram bot endpoint, voice-message receiver, Whisper transcription.
- Same LLM filter as 4.2.
- Operator confirmation step before commit.

---

### Sprint 4.4 — Coding identity transfer / LoRA (XL effort, ambitious)

**Why**: extract Dave's style from his git history (RELO + Chatbot Platform + WaaS + cortex-x), train lightweight LoRA, Steward adopts. Other Dave projects inherit your voice.

**Scope**:
- Git history → diff samples → instruction-tuning dataset.
- LoRA training (small model, fine-tune on Dave-PR pairs).
- Inference seam in action-engine (LoRA-adapted model as routing option).

**Stolen from**: standard LoRA + RLHF-from-PRs research.

---

### Sprint 4.5 — Cross-repo federated lesson bank (S-M effort)

**Why**: complement to Sprint 3.2. RELO Steward learns from Kiosek Steward failures.

**Scope**:
- Shared `~/.cortex/lessons.federated.jsonl` synced via private Supabase row or signed Gist.
- Each entry signed with source-repo SHA to prevent poisoning.
- Opt-in per-project.

---

### Sprint 4.6 — Playwright-MCP UI verification (M effort, client-project unlock)

**Why**: relevant for RELO/Kiosek/portfolio runs where Steward touches React components.

**Scope**:
- Playwright MCP server in CI.
- Per-project `cortex/ui-checks.yaml` defines acceptance flows.
- Post-edit Steward runs flows + screenshot-diffs against baseline.

**Stolen from**: Playwright MCP + Agent Wars spec-driven verification.

---

### Sprint 4.7 — Rebrand "Steward" → **Steward** (S-M effort, ⭐ PRE-PUBLIC-TAG MUST)

**Status**: 🔴 PROMOTED 2026-05-09 from "deferred decision" to **PRE-PUBLIC-TAG MUST**. Web research confirmed NousResearch/hermes-agent: **139k stars, MIT, Feb 2026, active domains `hermes-agent.nousresearch.com/.org/.ai`, $5 VPS deploy, 5 backends, DSPy + GEPA self-evolution loop**. The collision is unrecoverable — top-tier dominant production project + dedicated `.com/.org/.ai` namespace = cortex-x cannot win SEO, community awareness, or any tag-search query for "hermes agent." Operator approved 2026-05-09: rebrand to **Steward**.

**Why "Steward"**: matches "senior engineer compressed" + "persistent agent that curates the operator's code/knowledge/life" framing. Translates cleanly to Czech as "správce." Passes the "could you say it on a podcast without explanation" test. Available as GitHub org/repo handle, npm package name, domain TLDs.

**Scope**:
- `bin/steward/` → `bin/steward/`
- `bin/steward/_lib/` → `bin/steward/_lib/`
- `bin/cortex-steward.cjs` → `bin/cortex-steward.cjs` (keep `cortex-steward` as deprecation shim until v0.2.0)
- `prompts/steward-setup.md` → `prompts/steward-setup.md` (ditto shim)
- `standards/steward-policy.md` → `standards/steward-policy.md` (ditto shim)
- `docs/steward-runtime.md` → `docs/steward-runtime.md` (ditto shim)
- `docs/steward-usage.md` → `docs/steward-usage.md` (ditto shim)
- `docs/steward-roadmap.md` → `docs/steward-roadmap.md` (THIS file; ditto shim)
- `.github/workflows/hermes*.yml` → `.github/workflows/steward*.yml`
- Env vars: `HERMES_*` → `STEWARD_*` (with backward-compat alias for one minor release: read both; emit deprecation log when `HERMES_*` is set)
- Memory entries: keep historical names ("Steward v0.5b", "Steward' first PR #5") — they're snapshots, not live identifiers.
- README.md / CLAUDE.md / project_cortex_*.md: search-and-replace `Steward` → `Steward` for PRESENT-TENSE descriptions; keep past-tense incident references intact.
- Test files: `tests/unit/steward/` → `tests/unit/steward/`; rename test descriptions.
- Action_kind names: keep verbatim (`recommendation`, `dep_update_patch`, etc.) — they're not Steward-branded.

**Backward compat (v0.1.0 → v0.2.0)**:
- Old `bin/cortex-steward.cjs` + `prompts/steward-setup.md` etc. exist as 1-line shim files: `require('./cortex-steward.cjs')` + emit deprecation warning to stderr.
- Old `HERMES_*` env vars read with deprecation log; documented to be removed in v0.2.0.
- Old `.github/workflows/hermes*.yml` kept for one minor release as redirects.

**Effort**: S-M (1-2 days focused). Most is mechanical search-and-replace + git mv. Risk: missing references in templates/.cjs that get baked into freshly-scaffolded projects.

**Acceptance criteria for the rebrand sprint itself**:
- [ ] All NEW project scaffolds (via `prompts/new-project.md` flow) emit `Steward`, not `Steward`.
- [ ] Existing user installations (operator + future RELO) continue to work with `HERMES_*` env vars + `bin/cortex-steward` shim, with deprecation warning.
- [ ] Full suite green at ≥900 tests.
- [ ] No `bin/steward/` / `bin/cortex-steward.cjs` paths in any active runtime code path; only deprecation shim points back.
- [ ] CHANGELOG.md `## [Unreleased]` documents the rename + v0.2.0 removal target.

**Why before public launch**: 139k-star NousResearch with active `.com/.org/.ai` means our v0.1.0 GitHub release would compete in search + tag-discovery against a project that's already the established meaning of "hermes agent." Anyone seeing cortex-x v0.1.0 with a `bin/steward/` directory will assume fork-or-derivative. The rebrand cost is multi-day mechanical refactor today; cost in 6 months is the same refactor PLUS undoing brand confusion in user docs/blog posts/community.

**Stolen from**: NousResearch hermes-agent's existence convinced us to move. Steward as a name is operator-original.

---

### Sprint 4.8 — BIOS-style health dashboard (M effort, ergonomic upgrade)

**Status**: idea logged 2026-05-09. Pitched by operator: "udělat něco jako health dashboard s UI ... něco jako když existuje BIOS a je k němu grafický přístup ovládání, tak něco takového pro Cortex."

**Why now (in Tier 3, not earlier)**: Steward has 9-kind palette + journal + lessons + cost ledger + halt + (1.9) spec_failures + (2.1) autoresearch signals + (2.2) judge verdicts + (2.3) mutation scores. CLI `cortex-steward status` is server-grade access. Dashboard is the ergonomic-grade surface — like UEFI is over a motherboard. **Building before Tier 1+2 schemas stabilize = rework.** Wait until 1.9 / 2.1 / 2.2 / 2.3 ship.

**Scope (v1)**:
- **Local-first.** Next.js dev server `localhost:3737`, reads filesystem only, no backend.
- **Sibling repo** `cortex-dashboard` — not a folder in cortex-x. Scaffolded by cortex-x's own profile system (new profile `cortex-dashboard`).
- **Read-only first.** Live journal viewer rolled by date / kind / outcome; spec_failures drill-down (per criterion id, expected vs actual, file affected); lessons.jsonl explorer; cost ledger vs `HERMES_DAILY_USD_CAP`; halt status; recommendations.md preview with detector-match overlay; cron run timeline (`gh run list --json`).
- **v2 control**: halt button (writes `.cortex/HERMES_HALT` with reason), lesson edit/dismiss.

**Architecture**:
- Reads documented contracts: journal entry shape, lessons.jsonl shape, `cortex-steward status --json`, `gh run list --json`.
- Zero database. Filesystem IS the database. Defends "cortex-x stays zero-deps" — dashboard is sibling project with its own deps.
- **Tier 4 evolution**: when Sprint 5.0 awakens cortex-x on home NAS, dashboard becomes always-on UI. Add WebSocket for live cron progress, voice-issue widget (post-Sprint 4.3), federated multi-project view (post-Sprint 4.5).

**Acceptance criteria**:
- [ ] `cortex-dashboard` repo scaffolded via cortex-x init flow.
- [ ] Reads `cortex/journal/*.jsonl` from a configured cortex-x repo path.
- [ ] Renders 5 panels: journal timeline, spec failures, cost ledger, lessons, halt status.
- [ ] CLI parity check: every field shown in `cortex-steward status --json` is reachable via dashboard.
- [ ] No reverse coupling — cortex-x runtime has zero awareness of dashboard's existence.

**Why sibling, not nested**: UI/UX is operator's domain expertise (17 years graphics). Belongs in its own session, own repo, own iteration cadence. cortex-x stays zero-deps; dashboard is free to use shadcn/Tailwind/whatever fits.

---

## 5b. Tier 4 — Personal AI entity / Living cortex-x (weeks 21+, ⭐ VISION)

**Status**: vision tier, not commitment. Surfaced 2026-05-09 by Dave (operator) after seeing a "Personal AI Wiki System" diagram (UGREEN NAS + Obsidian Vault + Steward + multi-agent worker stack). The diagram resonated because cortex-x already has 80% of the components — just running in GHA cron context, not on a home always-on host.

**Goal**: cortex-x stops being "code maintenance tool" and becomes "personal AI entity that lives on Dave's home NAS, curates knowledge across all life domains (code + meetings + notes + health + LinkedIn), responds to ambient events, persists identity across years."

**This is post-v1.0 territory.** Tier 1+2+3 must ship before this is even proposed. But tracking it here so it's on the radar.

### Sprint 5.0 — Self-hosted always-on Steward + adopt Khoj as knowledge layer (M-L effort)

**Why first in this tier**: GHA cron is "1 run per scheduled tick." Home NAS is "24/7 responsive listener." Voice memo at 3pm → recommendation harvested by 3:01pm. GitHub issue commented at 11am → cortex-x considers + drafts response by 11:05.

**Hardware**: UGREEN NAS / Beelink SER9 / Mac Mini M4 (~$500-1200 one-time).

**Software architecture (decided 2026-05-09 via web research)**: cortex-x is the *agentic* layer; **Khoj** is the adopted *knowledge* layer. Sprint 5.2 Obsidian sync becomes a Khoj plugin (it has Obsidian native integration), saving 2-3 sprints of from-scratch wiki + Obsidian bridge work. cortex-x packaged as systemd / launchd service alongside Khoj's Docker compose. Local LLM via Ollama (Qwen 3 32B or Llama 3.3 70B quantized) shared between Steward + Khoj. Hybrid routing — local for sensitive, OpenRouter for premium.

**Why Khoj over alternatives** (2026-05-09 web research):
- **Mature** in 2026-Q2: Obsidian/Emacs/desktop/phone/WhatsApp clients, self-hostable, supports any LLM.
- **Karpathy llm-wiki gist (2026-04-04)** white-hot momentum; Khoj's wiki-curation pattern matches the Personal AI Wiki diagram operator showed 2026-05-09.
- AnythingLLM = broader/less Obsidian-tight; Reor = less mature; Open WebUI + Ollama = generic chat, not wiki-curating.

**Steward's role vs Khoj's role**:
- **Khoj**: knowledge curator (notes, PDFs, meetings, LinkedIn, health) → topic pages + summaries + index. Continuous ingestion.
- **Steward**: action executor (recommendations.md → edits → PR / draft response). Reads Khoj's curated knowledge as additional context.

**Deployment templates** (no formal packaging spec exists in 2026; de facto = systemd + Ollama-style one-liner):
- Hetzner $5 VPS recipe (community standard for $5 VPS deploy, NousResearch hermes-agent's installer is the canonical Python+uv+systemd analog for our zero-deps Node).
- Local Mac Mini M4 launchd plist.
- UGREEN NAS Docker compose alongside Khoj's compose.

**Pre-implementation research dispatch (R1)**:
- "Khoj plugin model + extension API in 2026-Q3 (we'll be building cortex-x as a Khoj sibling agent). systemd unit hardening for self-hosted personal AI 2026 SOTA. Network-isolated agent security patterns. Mac Mini M4 vs UGREEN NAS vs Beelink SER9 thermal/inference benchmarks for 32B-70B local LLM."

**Documentation**: dedicated migration guide for "from cortex-x cron to home Steward" — 30-min setup recipe.

---

### Sprint 5.1 — Soul abstraction (S-M effort, ⭐ NOVEL)

**Why**: insight from the 2026-05-09 diagram inspection — `souls.md` per agent. Today cortex-x has framework-level identity (`standards/`) but no agent-level identity. Each agent has values, voice, constraints, memory priorities encoded as a "soul" that the agent reads before each action.

**Scope**:
- New dir `cortex/souls/<agent>.md` (frontmatter + structured fields).
- Action engine prepends soul to system prompt.
- Soul mutations are human-only edits (like `standards/`).
- Initial souls: `hermes.md`, `harvester.md`, `judge.md`.

**Why not Tier 1**: cortex-x with single hardcoded `HERMES_SYSTEM_PROMPT` still works. Soul abstraction is real value-add only when multiple agents (worktree workers, judge, harvester, supervisor) coexist with distinct roles. Sprint 2.2 (worktree supervisor) is the prerequisite that makes this matter.

---

### Sprint 5.2 — Obsidian Vault as second SSOT via Khoj (M → S effort, PIVOT 2026-05-09)

**PIVOT (2026-05-09 web research)**: Khoj has native Obsidian plugin + Obsidian sync. Sprint 5.0 adopts Khoj as the knowledge layer; Sprint 5.2 becomes "configure Khoj to bridge Obsidian ↔ cortex/recommendations.md ↔ Steward harvester." Effort dropped from M to S — most of the integration work is Khoj configuration, not custom code.

**Why**: Dave's life knowledge isn't in `cortex/recommendations.md` — it's in Obsidian (notes, meetings, ideas). Khoj indexes Obsidian content; Steward's recommendation_harvest detector reads Khoj's curated topic pages as additional signal alongside gh PR/issue/CI signals.

**Scope**:
- Configure Khoj's Obsidian plugin for the operator's vault (read-only access by default).
- Steward's `detectors/recommendation-harvest.cjs` extends to read Khoj's "actionable" topic pages alongside gh signals (Khoj exposes a local API).
- Two-way: Steward's merged PRs become "shipped this week" entries that Khoj surfaces back into Obsidian daily-note rollup.
- Privacy: Khoj indexes locally; Obsidian content never leaves the home server (Khoj uses Ollama by default for ingestion).

**Stolen from**: Khoj's Obsidian integration. We're not building, we're configuring + writing one detector adapter.

---

### Sprint 5.3 — Multi-source life ingest (L effort)

**Why**: voice memos + email + Slack + calendar + health data → all flow into cortex-x as recommendation signals. The diagram's "Data Sources" arrows.

**Scope**: webhook listeners for each source, LLM filter (actionable vs noise), routing into `cortex/recommendations.md` or domain-specific markdown.

**Privacy critical**: all sensitive data routes through local LLM only. No leak to OpenRouter for personal/health domains.

---

### Sprint 5.4 — "Live entity" UX (XL effort, vision)

**Why**: cortex-x as something Dave can talk to, not just CLI invocation. Voice interface, ambient memory, conversational recall.

**Scope**: Telegram + Whisper + local Steward inference. "Hej cortex, co jsme řešili minulý týden o RELO?" → Steward recall + response in operator's voice/style (post Sprint 4.4 LoRA).

**Deferred until**: Tier 1+2+3 fully shipped, Sprint 5.0+5.1+5.2+5.3 stable. This is the moonshot of moonshots.

---

## 6. What we are NOT doing (explicit non-goals)

| Direction | Why not |
|---|---|
| Multi-platform messaging gateway (NousResearch pattern) | cortex-x surface is GHA cron + CLI. Telegram/Discord = scope creep beyond agent — dev tool boundary. |
| Real-time visual workspace (agent-zero Universal Canvas) | Steward is headless cron, no human in the loop during execution. Demo value, zero operational value for our usecase. |
| Full Linux container in Docker (agent-zero) | GitHub Actions ephemeral runners are already our Linux. Adding Docker = ops complexity for no capability gain. |
| Browser-specific abstractions (browser-harness CDP) | cortex-x is code-first, not UI-first. Tier 3 Sprint 4.6 covers UI verification narrowly via Playwright-MCP — that's enough. |
| Auto-merge Steward PRs | MUST-H6 hardcoded forever. Humans always merge. |
| Self-modification of `bin/steward/` core | EDIT_DENYLISTED catches this. Self-extending capabilities (Sprint 3.1) live in `cortex/agent-workspace/skill-experiments/`, not in `bin/steward/_lib/`. Brain ≠ scratch pad. |

## 7. Per-sprint workflow (the ritual)

For every sprint above, the path from "planned" → "shipped on main" follows this ritual:

```
1. Pick sprint from roadmap (operator-initiated or harvester-suggested).
2. Dispatch focused web-research agent (R1) for SOTA-as-of-today.
3. Save research output to docs/research/<sprint>-<topic>-<date>.md (R1 evidence).
4. Operator + Claude-Code review research, decide go/no-go.
5. If go: Claude implements scope per spec.
6. Tests written WITH each module (no shipped code without test gate).
7. Full suite green locally.
8. Commit to feature branch.
9. Run 6-agent review pipeline (R2): acceptance + blind + correctness + security + ssot + edge-case.
10. All blocker findings closed.
11. Squash-merge to main with sprint commit message + MIGRATIONS.md entry.
12. Auto-memory entry capturing strategic state shift.
13. Roadmap updated: sprint marked ✅ shipped, downstream sprints unblocked.
```

This ritual is the **single most important rule of this roadmap**. Skipping any step turns the roadmap from "trustworthy plan" into "wish-list."

## 7b. 90-day implementation plan — hardware-independent first, then awaken

**Constraint check (2026-05-09):** operator is saving toward $500-1500 home server hardware (UGREEN NAS / Beelink SER9 / Mac Mini M4). Hardware likely arrives ~week 8-12. Until then, all software work happens on existing GHA cron infrastructure + operator's current dev machine.

**Fortunate reality**: of the 21 sprints in this roadmap, **17 are hardware-independent** and ship fine on GHA + local dev machine. Only Sprint 5.0 (self-hosted always-on Steward) and Sprint 5.4 (live-entity voice UX) genuinely need the home box. Everything else can be developed and validated in current infra.

This means: **no waiting period**. Velocity continues 6-12 weeks before "awakening" the entity on home hardware.

### Week-by-week sequencing (recommended)

| Week | Sprint | Hardware needed? | Why this order |
|---|---|---|---|
| **1** | **1.9 — Spec-driven verification** ⭐ | No (GHA) | Fixes Sprint 1.8.13 incident class. Unblocks 2.1 + 2.2 + 3.0 (richer fitness signal). |
| **2** | 2.0 + 2.0b — Langfuse self-hosted + RouteLLM | No (Langfuse on dev machine, migrate to NAS later) | Both small (S). Observability + cost-routing both feed downstream sprints. Parallelizable. |
| **3-4** | **2.1 — Steward autoresearch overnight burst** | No (GHA, longer cron window) | Karpathy pattern. 1× → N× experiments per night. Order-of-magnitude throughput. Needs spec-criteria from 1.9. |
| **5-6** | 2.2 — Worktree supervisor + judge ensemble | No (GHA worktrees natively) | Multi-agent. Each worker verifies against same spec from 1.9. |
| **7** | 2.3 — Mutation testing as fitness signal | No (Stryker on GHA) | Closes verification gap further. After 2.2 because workers benefit too. |
| **8** | **5.1 — "Soul" abstraction** (early Tier 4 prep) | No (just markdown + code) | Deliberately moved up. Multi-agent Steward (Sprint 2.2 already shipped) needs distinct identities for supervisor / worker / judge / harvester. Souls.md cheap + impactful + ready for hardware moment. |
| **9-10** | 3.0 — AlphaEvolve prompt evolution | No (GHA + held-out fixtures) | The compound moonshot. Needs spec-criteria (1.9) + autoresearch budget (2.1) + souls (5.1). |
| **11** | 3.1 — Self-extending capabilities (`skill-experiments/`) | No (sandbox in GHA) | Browser-harness pattern. Steward writes own micro-helpers. |
| **12** | **HARDWARE LIKELY ARRIVES + retro week** | — | Decompress. Order Beelink/NAS. Retro on weeks 1-11. |
| **13-14** | **5.0 — Awaken the entity** | YES (NAS / Beelink) | Migrate cortex-x from GHA-only to home-server always-on. Steward daemon, not cron. |

### Logical sequencing rationale

- **1.9 first because** it produces the richer fitness signal that 2.1, 2.2, 3.0 all depend on. Without spec criteria, "did this run improve anything?" is just `npm test boolean`.
- **2.0 + 2.0b parallel because** they're both small (S), independent, and feed observability into every later sprint.
- **2.1 before 2.2 because** Karpathy autoresearch (multi-strategy serial within one run) is the conceptual prerequisite for worktree parallel — supervisor needs to know how multi-strategy works in single context first.
- **5.1 (souls.md) deliberately moved up to week 8** because by then Steward has ≥4 distinct agents (supervisor, worker, judge, harvester), each needs identity. Cheap to implement (markdown + a load step in action-engine) and lets us "have it ready" for hardware activation.
- **3.0 (prompt evolution) before 3.1 (self-extending capabilities)** because evolution refines what we have; self-extension creates new things — refining first makes generation more reliable.
- **3.2 (FTS5 + federated lessons) and 3.3 (GraphRAG) deferred to weeks 13-16** because they're high-effort and only become critical when (a) cross-project deployments happen and (b) codebase context is the bottleneck. Today neither is true.

### What awakening looks like (week 13+)

Once home hardware arrives, Sprint 5.0 is a **migration sprint**, not a build sprint:
1. Install Beelink/NAS, set up Linux environment.
2. Install Ollama + pick local model (Qwen 3 32B as default starting point).
3. Package cortex-x as `systemd` service (Linux) or `launchd` agent (Mac).
4. Migrate `~/.cortex/` data dir to NAS, sync from operator's dev machines.
5. Switch one project (cortex-x dogfood first, then RELO) from GHA-cron to home-daemon.
6. **Hybrid routing**: sensitive paths → local Ollama. Premium paths → OpenRouter. Configured per action_kind in `cortex/souls/<agent>.md`.
7. Verify: 1 week of home-daemon Steward runs, no regressions vs GHA-cron equivalent week.

After that single sprint, the entity is "alive" — and every Tier 2/3 sprint already shipped becomes immediately more powerful because it now lives on always-on infra.

### What NOT to do during weeks 1-12

- **Don't** start Sprint 5.0+ before hardware. Pre-staging Linux config in a VM works for dry-runs but isn't real validation.
- **Don't** skip the R1 research dispatch on each sprint just because the roadmap "already covers it." The 2026-05 cached research expires; SOTA shifts in weeks.
- **Don't** ship more than 1-2 sprints in parallel. Each sprint has its own review pipeline (R2). Concurrent review pipelines = cognitive overload + missed findings.
- **Don't** add new sprints to the roadmap mid-tier without operator explicit approval. The roadmap is SSOT; conversations propose, roadmap commits.



- **Week 4** (after Sprint 1.9 + 2.0 + 2.0b): observability dashboards live, spec-driven verification operational. Question: is the verification gap measurably closed?
- **Week 8** (after Sprint 2.1 + 2.2 + 2.3): multi-agent overnight burst running. Question: are we shipping ≥3 PRs/night reliably?
- **Week 12** (after Sprint 3.0 + 3.1 + 3.2 + 3.3): self-evolution operational. Question: are agent-authored prompts/skills measurably better than hand-tuned?
- **Week 20** (after Tier 3): client revenue + capability marketplace live. Question: is this distributable beyond Dave?

Miss a milestone? **Pause new sprints, do a retro, fix the ritual** before continuing.

## 9. References

- 2026-05-08 SOTA brainstorm research dispatch (in conversation context, archive recommended)
- 2026-05-08 4-source inspection research dispatch (in conversation context)
- VentureBeat Karpathy autoresearch (March 9, 2026): https://venturebeat.com/programming-development/andrej-karpathys-new-open-source-autoresearch
- GitHub Spec Kit: https://github.com/github/spec-kit
- AWS Kiro: https://kiro.dev/docs/specs/
- EvalAgent paper: https://arxiv.org/html/2510.24358v1
- Composio Agent Orchestrator: https://github.com/ComposioHQ/agent-orchestrator
- AlphaEvolve paper: https://arxiv.org/abs/2506.13131
- OpenEvolve: https://github.com/algorithmicsuperintelligence/openevolve
- ReasoningBank: https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/
- NousResearch/hermes-agent: https://github.com/nousresearch/hermes-agent
- agent0ai/agent-zero: https://github.com/agent0ai/agent-zero
- browser-use/browser-harness: https://github.com/browser-use/browser-harness

---

**This document is a living artifact. Update it on every sprint transition. Older versions live in git history.**
