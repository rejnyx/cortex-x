---
title: Steward / cortex-x roadmap — v0.8 → v1.0 → enterprise-adjacent
status: living document — updated as sprints land
created: 2026-05-09
last_review: 2026-05-08 (5-agent research dispatch + Tier 1 expansion: 2.0.1 + 2.4-2.8)
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
| **R4** | **Cost ceiling preserved.** Current full-cadence Steward spend is ~$0.024/month. Multi-agent / overnight burst sprints will raise this — but never above $5/month at full cadence per project. Anything bigger needs explicit operator authorization. | `STEWARD_DAILY_USD_CAP` enforcement + monthly journal cost rollup. |
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

### Sprint 1.9.1 — Multi-window cost safety + cross-session loop detector ✅ SHIPPED 2026-05-09

**Status**: ✅ Shipped 2026-05-09. `bin/steward/_lib/cost-safety.cjs` adds `STEWARD_WEEKLY_USD_CAP` ($25 default), `STEWARD_MONTHLY_USD_CAP` ($80), `STEWARD_TOKEN_VELOCITY_CAP` (50K/5min), cross-session loop detector (5x same criterion id in 7 days → write `STEWARD_HALT`), `cortex-steward status --forecast` flag. 4 new error codes. Operator-suggested gap analysis after 2026-05-09 audit ("daily $5 × 30 = $150/month would have passed without alarm").

**Why before Sprint 2.x**: today we have `STEWARD_DAILY_USD_CAP` $5/day + `STEWARD_FAILURE_BREAKER` 3 fails/1h per-action_key. Mid-week burst (Sprint 2.1 autoresearch overnight) or month-long slow drift (Sprint 2.0 Langfuse instrumentation that hits provider's hot path every action) can quietly accumulate $150/month before any single day trips the daily cap. Real-incident anchor: April 2026 dev's $437 retry-loop bill. Lower-effort sprint with high blast-radius reduction; ship before unleashing autoresearch.

**Scope**:
- `STEWARD_WEEKLY_USD_CAP` (default $25) — sliding 7-day journal window sum.
- `STEWARD_MONTHLY_USD_CAP` (default $80) — calendar-month journal window sum.
- `STEWARD_TOKEN_VELOCITY_CAP` (default 50K tokens / 5min sliding window) — burst protection for ensemble + autoresearch.
- **Cross-session loop detector**: same `spec_failures[0].id` fires ≥ 5x in last 7 days for same action_key → write `.cortex/STEWARD_HALT` with reason `LOOP_DETECTED:<criterion_id>:<action_key>`. Halt is operator-cleared (manual `rm` per existing kill-switch UX).
- **Budget warnings**: when current spend reaches 80% of daily/weekly/monthly cap, journal a `budget_warning` event (not blocking) so `cortex-steward status` shows the operator they're approaching the cap.
- `cortex-steward status --forecast` flag: extrapolate current rate × days remaining in window → projected end-of-window spend. JSON + human modes both expose forecast block.

**New error codes**:
- `BUDGET_WEEKLY_CAP_REACHED` (parallel to existing `BUDGET_CAP_REACHED` for daily)
- `BUDGET_MONTHLY_CAP_REACHED`
- `TOKEN_VELOCITY_CAP_REACHED`
- `LOOP_DETECTED` (halt reason in STEWARD_HALT)

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

### Sprint 2.0 — Observability-as-a-service ✅ SHIPPED 2026-05-08 (commit `aadeef4`)

**Status**: ✅ Shipped 2026-05-08. Phoenix self-hosted single-container observability + zero-deps OTLP/JSON emitter (~530 LoC). 12 must-fix items from 6-agent R2 review applied pre-commit. **Followup Sprint 2.0.1 below addresses Phoenix protobuf-only constraint discovered in manual dogfood.**

**REFINED 2026-05-08 (Sprint 2.0 R1 memo)** — see [`docs/research/sprint-2.0-langfuse-observability-2026-05-08.md`](./research/sprint-2.0-langfuse-observability-2026-05-08.md). Original plan was Langfuse self-hosted; **research flipped this to Phoenix (Arize)** as the default, Langfuse parked as a documented opt-in upgrade for Tier 3. Five findings drove the flip:

1. **Langfuse v3 is a 6-container stack** (postgres + clickhouse + redis + minio + 2× pods) with documented unbounded ClickHouse log-table growth — fresh installs filling 100 GB/day at zero activity unless TTLs pre-tuned. Footgun for single-dev ops.
2. **Phoenix is `docker run -p 6006:6006 arizephoenix/phoenix:latest`** — single container, SQLite persistence, native OpenInference + native OpenRouter integration. Zero ops drama for ~1 trace/night.
3. **Langfuse paywalls** the Tier 2 features Steward's prompt-evolution roadmap actually wants (Prompt Playground, LLM-as-Judge evals, prompt experiments, annotation queues are EE-only on self-host). Phoenix has them open.
4. **Helicone is RIP** (Mintlify acquisition 2026-03-03, self-host code untouched, dropped from candidate list).
5. **Langfuse's built-in cost tracking** doesn't cover DeepSeek/V4-Flash (Steward's default model) — would need community sync script. Steward's own `addCostFields` is already authoritative; Langfuse UI just wouldn't display correct numbers.

**Why second** (unchanged): zero meaningful evolution without measurement. Current journal is fine for forensics but useless for "did week-over-week prompt change improve recommendation quality?"

**Scope (refined)**:
- Self-hosted **Phoenix** via `templates/observability/docker-compose.phoenix.yml` (single container, SQLite at `PHOENIX_WORKING_DIR`, OTLP receiver on `:4317`).
- Land `bin/steward/_lib/otel-emitter.cjs` — zero-deps hand-rolled OTLP HTTP POST against the OpenInference attribute set. Honors Steward's "zero runtime deps" principle (no `@opentelemetry/api`).
- Plumb emitter through `execute.cjs` Phase boundaries: AGENT root span (workflow=steward-nightly) → LLM child (provider=openrouter, model=...) → TOOL children (npm_test, spec_verifier, git_commit_and_pr).
- Journal stays SSOT — Phoenix is **additive**, never replaces JSONL. Both write on every run.
- Fail-open: with `STEWARD_OTEL_ENDPOINT` unset or unreachable, Steward must complete normally and log a single warning per run (not per span).

**Acceptance criteria** (full list in memo §6):
- `docker compose -f templates/observability/docker-compose.phoenix.yml up` starts Phoenix in <30 s on a clean machine.
- A Steward dry-run with `STEWARD_OTEL_ENDPOINT` set produces a parent AGENT span with ≥1 LLM child and ≥1 TOOL child, viewable at `localhost:6006`.
- Cost numbers from `gen_ai.usage.input_tokens`/`output_tokens` match `addCostFields` output to rounding error on 5 dogfood runs.
- Journal still writes (SSOT preserved).

**Stolen from**: Phoenix (Arize) self-hosted reference deployment + OpenInference semantic-conventions spec + OTel `gen_ai.*` semconv. Langfuse path documented as Tier 3 upgrade for prompt-evolution sprints.

---

### Sprint 2.0.1 — OTLP protobuf encoder for Phoenix compatibility ✅ SHIPPED 2026-05-08 (commit `2981ea7`)

**Status**: ✅ Shipped 2026-05-08. Manual end-to-end dogfood revealed Phoenix 15.5.1 returns HTTP 415 on `Content-Type: application/json` even though OTLP HTTP spec permits both encodings. Zero-deps OTLP protobuf encoder (~370 LoC, `bin/steward/_lib/otel-protobuf.cjs`) replaces Sprint 2.0's JSON path. R2 review pipeline (2 focused agents) found 2 BLOCKER (negative BigInt zero-coerce, hex traceId/spanId truncation) + 8 MAJOR (type-tag corruption on negative Number, Number-above-2^53 precision loss, etc.) — all fixed pre-commit. Trace `aa105a439194024f65a0531befd82c53` validated end-to-end in live Phoenix UI with full AGENT→TOOL hierarchy + Sprint 2.0b routing tags. Tests 1095 → 1134.

**Lesson for future cortex-x sprints (added to ritual §7 as 13th step)**: **Spec-permissive ≠ receiver-permissive.** When a spec allows N encodings and we ship 1, manual integration smoke is the only thing that catches "real receiver only accepts the OTHER N-1." Unit tests with mocked transport will always pass. Every cortex-x sprint with new transport/wire format must include a manual end-to-end smoke gate against the real production receiver before declaring done.

**Out of scope (deferred to Sprint 2.0.2)**: protobufjs round-trip property test for mutation-survival on `encodeVarint` loop. Would add devDependency. Current hand-computed byte vectors + real-Phoenix integration smoke provide floor coverage.

---

### Sprint 2.0b — Action-kind-based model routing ✅ SHIPPED 2026-05-08 (commit `79c101a`)

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

### Sprint 2.1 — Steward autoresearch / overnight burst mode ✅ SHIPPED 2026-05-08 (commit `b3e6656`, ⭐ TRANSFORMATIVE)

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

**REFINED 2026-05-08 (anthill R1 memo)** — see [`docs/research/swarm-self-spawning-agents-2026-05-08.md`](./research/swarm-self-spawning-agents-2026-05-08.md). Operator's "anthill" intuition is real (+90.2% on Anthropic research evals via role-routed sub-agents) but comes with three hard constraints: **15× token overhead, multi-agent is wrong for shared-context coding tasks** (so ~6 of our 9 capability kinds stay single-process), and the **DeepMind Dec-2025 finding shows unstructured agent networks amplify errors up to 17.2×** vs single-agent baseline. The memo's verdict: **verifier > spawner**. Our 1.9.0 spec-verifier is the architectural moat. Sprint 2.2 ships **MVP only** — 1 supervisor + 1 spawned worker, **`recommendation_harvest_parallel` only** (breadth-first kind, ideal shape) — not "all 9 kinds become multi-agent."

**Why after 2.1**: 2.1 proves the multi-strategy pattern serial; 2.2 makes it parallel via git worktrees. Claude Agent SDK's orchestrator-worker primitive is the reference (depth-cap=2 built-in, per-sub-agent maxTurns/effort/model/permissionMode, but **no built-in per-tree token cap — we must implement**).

**Scope (refined)**:
- New capability kind `recommendation_harvest_parallel` (does NOT replace 1.8.2c kind — coexists, opt-in).
- Split `runExecute()` into `runSupervisor()` + `runWorker(N)`.
- `git worktree add cortex/steward-run-{N}` per worker.
- Lock manager generalized from 1-mutex to N-mutex.
- Judge agent prompt evaluates N branches against spec criteria + commit clarity + cost.
- 4 workers in parallel = ~4× throughput at ~4× cost; per-tree cap keeps total <$10/month at full cadence.

**Pre-work (must land before 2.2 implementation)**:
- **Per-tree token cap**: new env `STEWARD_TREE_USD_CAP` ($1.50 default, ~2× single-call dogfood). Cap enforced at supervisor *before* spawning; running tally from `extractUsage` on every sub-agent return. Adds 4th window alongside daily/weekly/monthly (1.9.1).
- **Cross-tree loop detector**: 1.9.1 detector operates on single-agent fingerprints — wouldn't catch the public **$47K runaway-loop incident** (2-agent ping-pong, 11 days, no useful output). Extend detector to write criterion-id × parent-tree-id fingerprints; 3× repeat in 24h → `STEWARD_HALT`.
- **Per-worker spec-verifier gate**: spec-verifier runs *per worker output* AND once on synthesized plan. Both must pass before `applyAction`.

**Acceptance criteria (10 items)** — see anthill memo §10. Includes failure-injection test (single worker returns garbage JSON → supervisor completes with N-1 workers, no retry-storm) + cost-cap test (artificial cost spike mid-fan-out → supervisor halts cleanly, journals `STEWARD_TREE_CAP_EXCEEDED`).

**Pre-implementation research dispatch**:
- "Composio Agent Orchestrator + Cursor Parallel Agents + Claude Code Agent Teams + Grok Build worktree patterns. State-of-the-art supervisor↔worker protocols 2026-05. Conflict resolution + judge prompting techniques."

**Stolen from**: Anthropic multi-agent research stack (orchestrator-Opus + worker-Sonnet + Haiku-navigator) + Claude Agent SDK orchestrator-worker primitive + Composio AO + agent-zero subordinate hierarchy + Team Atlanta ensemble patching.

**Where multi-agent is WRONG for cortex-x**: `dep_update_patch`, `lint_fix_shipper`, `flaky_test_repair`, `test_coverage_gap`, `doc_drift`, `todo_triage` — all need shared context with the codebase mutation. Single-agent + spec-verifier (1.9.0 architecture) stays the right shape. Don't multi-agent these. Memo §10 lists explicit kinds that DO benefit (recommendation_harvest, future whole_repo_security_audit, pr_review_responder).

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

### Sprint 2.4 — Anthropic `claude-cli` engine via Max subscription (S effort, ⭐ COST PIVOT)

**Why**: research dispatch 2026-05-08 (R3 — see [`docs/research/sprint-2.4-anthropic-max-routing-2026-05-08.md`](./research/sprint-2.4-anthropic-max-routing-2026-05-08.md) when written) confirmed that Anthropic Max x20 subscription is **programmatically reachable via `claude -p` non-interactive CLI** with `CLAUDE_CODE_OAUTH_TOKEN` set + `ANTHROPIC_API_KEY` unset. ToS explicitly permits this for personal autonomous agents on operator's own repos (Green Tier per claudefa.st safe-use guide). Anthropic April 2026 OpenClaw crackdown was specifically token-extraction in third-party harnesses — not legitimate `claude` subprocess invocation.

**Strategic impact**: this is the **cost-economy pivot** of Tier 1. Today Steward calls OpenRouter at ~$0.0008/run avg ($0.024/month full cadence). After 2.4, the LLM-driven action_kinds (`recommendation` + autoresearch judge + future `pattern_transfer`) become **zero marginal cost** under the operator's existing Max sub. OpenRouter stays as overflow only (when Max weekly cap exhausted or `claude -p` returns auth error). Hardware decision (lokální 30k CZK box) deferred until this is validated and remaining spend is measured.

**Scope**:
- New engine file `bin/steward/_lib/engine-claude-cli.cjs` (~80 LoC, zero new deps) — spawns `claude -p "<prompt>" --output-format json`, parses stdout JSON, returns same shape as `engine-openrouter.cjs`.
- **Cost guard (critical)**: assert `result.total_cost_usd === 0` after each invocation. Nonzero means OAuth degraded silently to API mode (issue #43333, #37686 — $1,800 incident); halt with new error code `CLAUDE_CLI_BILLING_LEAK` + write `STEWARD_HALT`.
- Engine seam wiring in `bin/steward/_lib/action-engine.cjs` — `STEWARD_ENGINE=claude-cli` env or `--engine claude-cli` CLI flag selects this path; existing `mock`/`openrouter` paths unchanged (R6 backward-compat).
- Routing-table integration: `cheap`/`balanced`/`premium`/`ensemble` profiles get a parallel `_via_max` variant that prefers `claude-cli` when `CLAUDE_CODE_OAUTH_TOKEN` is set, falls back to `openrouter` engine on auth/cap-reached errors.
- `STEWARD_CLAUDE_CLI_PATH` env (default: resolve `claude` from PATH) for portable testing.
- Subprocess hardening: `child_process.spawn` (not `exec`), 120s timeout (configurable via `STEWARD_CLAUDE_CLI_TIMEOUT_MS`), explicit env scrubbing (delete `ANTHROPIC_API_KEY` from spawned env to prevent the leak class), kill on parent process exit.

**New error codes**:
- `CLAUDE_CLI_NOT_FOUND` (PATH lookup or env var path miss)
- `CLAUDE_CLI_AUTH_REJECTED` (401/403 from Anthropic — Max cap exhausted or OAuth expired)
- `CLAUDE_CLI_BILLING_LEAK` (`total_cost_usd > 0` post-invocation; halts via STEWARD_HALT)
- `CLAUDE_CLI_OUTPUT_MALFORMED` (JSON parse fail)
- `CLAUDE_CLI_TIMEOUT`

**Acceptance criteria**:
- [ ] `STEWARD_ENGINE=claude-cli node bin/cortex-steward.cjs execute` completes a `recommendation` action end-to-end with `total_cost_usd: 0` recorded in journal.
- [ ] When `CLAUDE_CODE_OAUTH_TOKEN` unset → engine returns `CLAUDE_CLI_AUTH_REJECTED` cleanly without crash.
- [ ] When subprocess returns nonzero `total_cost_usd` → halt with `CLAUDE_CLI_BILLING_LEAK` + `STEWARD_HALT` written.
- [ ] OpenRouter engine path unchanged (regression test).
- [ ] ≥ 12 new tests; full suite stays green.

**Pre-implementation research dispatch (R1)**:
- "Anthropic Claude Code CLI `-p` non-interactive headless mode 2026-Q3 status. Max subscription billing-tier behaviors confirmed via official docs + operator dogfood. Concurrent `claude -p` invocations from same OAuth token — rate limit + concurrency expectations. Validate `total_cost_usd === 0` reliability across recent versions."

**Out of scope**: Claude Agent SDK migration (still API-key only per GH issue #559), Claude Code Routines cloud cron (Sprint 5.0 evaluates), browser-based Anthropic SDK (premature). Telegram/Discord forwarding moved to Sprint 2.6.

**Stolen from**: claudefa.st safe-use guide + claude-ollama-dual repo (smart-orchestrator pattern) + Anthropic headless docs + cortex-x's existing engine seam (Sprint 1.6.13).

---

### Sprint 2.5 — `tech_debt_audit` action_kind (M effort, deterministic)

**Why**: research dispatch 2026-05-08 (R5) flagged "nightly janitor" as high-payoff deterministic kind. Compounds with autoresearch (Sprint 2.1) — every overnight run optionally surfaces tech-debt drift before agent productivity work begins. Zero LLM cost (pure heuristics + qlty CLI), so it can run on every cron tick.

**Scope**:
- New action_kind `tech_debt_audit` in `bin/steward/_lib/action-kinds.cjs` (10th kind, deterministic). Acceptance criteria: snapshot file produced, no false halt, drift below threshold = no PR opened.
- Tool: **qlty** (Rust CLI, Apache + BSL/DOSP, free for commercial) installed once via `qlty init` → `.qlty/qlty.toml`. Polyglot, 70+ analyzers, `qlty metrics` subcommand for code-health rollup.
- Heuristics aggregated nightly:
  - File LoC growth rate (>20% w/w on a single file = flag)
  - Cyclomatic complexity drift (qlty metrics, threshold 10)
  - Duplication % trend (qlty CPD)
  - Test:source ratio drop
  - Dead-code count (`ts-prune` / `knip` for TS, language-specific equivalents)
- Snapshot stored at `.cortex/debt-snapshot.json`, diffed against prior week.
- Drift threshold (default: 10% degradation in any single metric) → opens advisory PR with the diff. Below threshold → silent journal entry only.
- Halt criterion: never. This kind is read + report; no edits. PR is review-only for operator.

**New error codes**:
- `TECH_DEBT_QLTY_MISSING` (qlty not installed)
- `TECH_DEBT_SNAPSHOT_CORRUPT` (prior snapshot unreadable; silently regenerates baseline)
- `TECH_DEBT_THRESHOLD_EXCEEDED` (advisory, not blocking)

**Acceptance criteria**:
- [ ] First nightly run produces `.cortex/debt-snapshot.json` baseline.
- [ ] Second run produces a diff. If above threshold → draft advisory PR opened.
- [ ] Zero LLM cost recorded in journal (no engine call).
- [ ] ≥ 10 new tests + 1 fixture-based integration test (synthetic snapshot pair).
- [ ] Fail-open: missing qlty installer → kind skipped with single warn line, doesn't halt cron.

**Pre-implementation research dispatch (R1)**:
- "qlty vs CodeScene CLI vs SonarQube CLI 2026-Q3 maturity. Heuristic vs ML tech-debt detection state-of-art. Best practices for snapshot drift detection (sliding window vs week-over-week vs since-last-release)."

**Out of scope**: AI-generated remediation suggestions (Sprint 3.0 prompt evolution can build on the snapshot data later), per-file ownership routing (no team in single-operator scope), license-compliance audits (`qlty` doesn't cover; separate kind if needed).

**Stolen from**: qlty CLI + ksimback `tech-debt-skill` for Claude Code + general "tech debt as deterministic linter" pattern.

---

### Sprint 2.6 — Discord remote control (S/M effort, mobile UX)

**Why**: research dispatch 2026-05-08 (R5) compared Telegram vs Discord vs Slack vs email for single-operator mobile control. **Discord wins on channel organization** (`#alerts` / `#research` / `#failures` / `#cost`) which is the right shape as cortex-x adds more capabilities. Telegram has higher 4K char limit but no native channel structure for one operator — turns into a single chat scroll fast. Email is YAGNI (Mailgun free 1-route only solves async batch ingest, not interactive control). Slack is B2B-shaped — wrong tool. **Operator confirmed Discord 2026-05-08 conversation.**

**Scope**:
- New module `bin/steward/_lib/remote-discord.cjs` (~150 LoC) using **discord.js** (most mature 2026 library, used by majority of agent integrations).
- 4-channel default layout: `#steward-alerts` (cron failures, halt events), `#steward-research` (autoresearch winner summaries), `#steward-failures` (spec_failures rollup), `#steward-cost` (daily/weekly/monthly cap status).
- Long-polling (no webhook) — operator runs from home network, no inbound TLS surface.
- 4-layer security per R5:
  1. Whitelist `from.id` middleware via env `STEWARD_DISCORD_ALLOWED_USER_IDS=<comma-list>`.
  2. HMAC-signed action confirmations for destructive ops (push, deploy) — operator replies with token derived from `action_id + STEWARD_DISCORD_SECRET`.
  3. Bot token rotation reminder (calendar entry, 90-day cadence).
  4. Read-only commands by default; mutating commands explicit `/!` prefix.
- Slash commands (mobile-friendly):
  - `/status` — `cortex-steward status --json` summary
  - `/forecast` — Sprint 1.9.1 cap forecast block
  - `/halt <reason>` — write `STEWARD_HALT` (HMAC-confirmed)
  - `/resume` — clear halt (HMAC-confirmed)
  - `/recommend <text>` — append voice/text recommendation to `recommendations.md` via authorized commit (Sprint 4.3 unblock)
  - `/why <commit-sha>` — Steward's commit trailer + journal entry rendered to Discord embed

**Acceptance criteria**:
- [ ] Bot connects to single Discord guild, registers 6 slash commands.
- [ ] Whitelist rejects non-allowed user_id silently (logs + drops; no acknowledgment to attacker).
- [ ] HMAC token mechanism prevents replay across 90s window.
- [ ] All 6 commands work from Discord mobile app.
- [ ] Bot crash-recovery: `systemd` (Linux dev box) / launchd (macOS) keeps it running; long-polling reconnects on network blip.
- [ ] ≥ 15 new tests + 1 e2e fixture-bot test.

**Pre-implementation research dispatch (R1)**:
- "discord.js v14 + slash command + HMAC pattern 2026-Q3. Discord rate limits for personal-bot use. Long-polling vs gateway intent caveats. Persistent process supervision options (systemd vs pm2 vs launchd) for single-operator use."

**Out of scope (Tier 2/3 follow-ups)**: voice-message → Whisper → recommendation pipeline (Sprint 4.3 dedicated), Telegram parallel surface (deferred unless Discord painful), web-based dashboard (Sprint 4.8 covers).

**Stolen from**: discord.js docs + grammy-guard whitelist pattern (adapted) + Telegram bot 4-layer security best-practices (carried over from 2026 ZeroClaw guide).

---

### Sprint 2.7 — Cross-project `pattern_transfer` action_kind (M effort, ⭐ FEDERATION SEED)

**Why**: research dispatch 2026-05-08 (R5) confirmed cross-project pattern transfer is a **known 2026 pattern** (repowise, meta-repo pattern, Karpathy LLM-wiki). Operator-pitched: cortex-x reads from `c:\Users\david\Desktop\APPs\amd-hackathon-2026`, `back-office-bot`, `kiosek-main`, `portfolio` for pattern inspiration without write access. **R5 strong recommendation: don't build full repowise; build narrow allowlist + read-only + new LLM action_kind.**

**Scope**:
- New config `cortex/sibling-projects.yaml` — explicit allowlist with per-repo `read_only: true`, `purpose: pattern-transfer`, `paths_allowed: [src/, docs/]`, `paths_denied: [.env*, secrets/, node_modules/]`.
- New helper `bin/steward/_lib/sibling-read.cjs` — wraps existing `clampPath` + `realpath` containment, refuses writes, refuses symlink-following outside allowlist. Defense in depth: invokes `node --permission --allow-fs-read=<each allowed root>` for the LLM call (built-in stable since Node v22.13.0 / v24.0.0).
- New action_kind `pattern_transfer` (LLM, premium tier — needs deep code understanding): reads sibling project, writes recommendation into *current* project's `lessons-learned.jsonl`. **Never edits sibling.**
- Acceptance criteria for the kind: output entry has `source_repo` field with absolute path; no `applyEdits` call paths to non-current-repo locations; spec-verifier rejects if any edit would land outside `process.cwd()`.
- Hardening per CVE-2025-55130 (Node.js fs permission symlink bypass): every read goes through `realpath`-then-validate, never raw path.
- Initial allowlist seed (operator-confirmed 2026-05-08): `amd-hackathon-2026`, `back-office-bot`, `kiosek-main`, `portfolio`.

**New error codes**:
- `SIBLING_NOT_ALLOWLISTED` (path outside `sibling-projects.yaml` roots)
- `SIBLING_REALPATH_OUTSIDE_ROOT` (symlink escape attempt)
- `SIBLING_WRITE_ATTEMPTED` (LLM tried to edit sibling — halt + STEWARD_HALT)
- `SIBLING_DENIED_PATH` (matched `paths_denied` pattern)

**Acceptance criteria**:
- [ ] `cortex/sibling-projects.yaml` validates against contract test schema.
- [ ] Read-helper refuses writes (test: open `O_RDWR` to sibling file → throws `SIBLING_WRITE_ATTEMPTED`).
- [ ] Realpath escape test: symlink in sibling pointing to operator home → blocked by `SIBLING_REALPATH_OUTSIDE_ROOT`.
- [ ] First `pattern_transfer` run produces a recommendation in current project's `lessons-learned.jsonl` with `source_repo: "<sibling-path>"`.
- [ ] When `--engine claude-cli` (Sprint 2.4) selected, this kind runs zero-cost under Max sub.
- [ ] ≥ 18 new tests including fixture-based sibling-tree integration.

**Pre-implementation research dispatch (R1)**:
- "Node.js fs permission model `--allow-fs-read` 2026-Q3 stability + CVE remediation status. repowise / meta-repo patterns 2026-Q3 evolution. Cross-repo agent context safety patterns from Anthropic + Cursor + Cline ecosystems."

**Out of scope (Tier 2/3 follow-ups)**: full federated lesson sync (Sprint 4.5), GraphRAG over allowlist roots (Sprint 3.3), cross-repo refactoring with edits (deliberately forever-out — defeats SSOT containment).

**Stolen from**: repowise multi-repo MCP pattern + meta-repo pattern (seylox blog) + Karpathy LLM-wiki + cortex-x's existing `clampPath` (Sprint 1.6.18).

---

### Sprint 2.8 — Memory Foundation: Anthropic Memory Tool + ReasoningBank failures + decay (M effort, ⭐ MEMORY GATE)

**Why before Tier 2**: Tier 2's Sprint 3.0 (AlphaEvolve prompt evolution) needs a *reliable* memory + lessons substrate to evolve against. Research dispatch 2026-05-08 (R1 + R4 converged independently): three changes give **+39% (Anthropic memory tool) + +34% (ReasoningBank failures) + +10% (importance-weighted decay)** with **zero new runtime deps**. Doing AlphaEvolve before this = evolving against rotting markdown.

**Scope** (3 stacked upgrades):

1. **Migrate to Anthropic native `memory_20250818` tool**:
   - Map existing `~/.claude/projects/.../memory/` directory to memory tool's filesystem API (file-based, client-side, fully cortex-x-controlled).
   - Steward's existing markdown layout becomes the memory tool's working dir — no new schema, no migration.
   - `bin/steward/_lib/memory-tool.cjs` (~120 LoC) — thin wrapper exposing `read/write/delete/list` to action-engine, hooked into Claude API requests via `tools: [{ type: "memory_20250818" }]`.
   - Free +29-39% per Anthropic internal evals when combined with context-editing tool (`tool_clear_at_least` 1024 tokens default).
   - Backward-compat: works with or without memory tool; `STEWARD_MEMORY_TOOL=off` disables and falls back to current "stuff lessons into system prompt" path.

2. **Extend ReasoningBank-lite (Sprint 1.8.3) → ingest failures**:
   - Currently captures successful trajectories only. Paper (arXiv 2509.25140) shows **+34% effectiveness, –16% steps** when failures are distilled with same fidelity as successes.
   - New journal-side hook in `bin/steward/_lib/lessons.cjs`: on `spec_failures.length > 0` OR `execute.cjs` error code → distill into title + one-line description + actionable principle (LLM call, ~$0.0002/op, batched at end of nightly run).
   - Preserve provenance: `failure_origin: "spec_failures[N].id" | "error_code:<code>"` field for future analysis.
   - Retrieval-at-decision-time (paper's MaTTS pattern): action-engine queries lessons WHERE `applies_to.includes(actionKind)` BEFORE generating prompt, not just at boot.

3. **Importance-weighted memory decay** (replaces 2026-07-17 audit's "3 months unused → delete" rule):
   - Score: `U(item, t) = (w_freq × frequency + w_impact × impact) × e^(−λ × age)`. Frequency = retrieval count; impact = `0.0` for advisory, `0.5` for warning, `1.0` for blocker; λ tuned for ~30-day half-life on advisory entries, ~120-day on blockers.
   - Nightly cron tick: scores all entries, archives bottom 5% to `cortex/memory-archive/<year>-<week>/` (recoverable), deletes only after 12 weeks in archive.
   - Per Mem0's State-of-AI-Agent-Memory 2026 warning: append-only memory rots. Decay is non-optional before more tiers.

**New error codes**:
- `MEMORY_TOOL_INIT_FAILED` (memory dir unwritable)
- `LESSON_DISTILL_FAILED` (LLM call for failure-distillation timed out — fail-open, store raw failure + retry next run)
- `MEMORY_DECAY_LOCK_HELD` (concurrent decay run; skip and log)

**Acceptance criteria**:
- [ ] `STEWARD_MEMORY_TOOL=on` → first action with memory tool produces same outcome as without; journal records `memory_tool_used: true`.
- [ ] `spec_failures` from a forced action produce a distilled lesson within 60s of journal flush.
- [ ] Lessons retrieved per `actionKind` in next run's system prompt (test: assert lesson text appears in API request body).
- [ ] After 30 simulated daily ticks, decay correctly archives lowest-scoring 5% of advisory lessons and zero blocker lessons.
- [ ] Decay archive is recoverable (fixture-based test: archived file in week N → restored manually → next nightly tick respects restoration).
- [ ] Tier 1 backward-compat: `STEWARD_MEMORY_TOOL=off` (default) preserves all existing behavior. Zero regressions.
- [ ] ≥ 25 new tests (10 memory-tool + 8 failure-distill + 7 decay).

**Pre-implementation research dispatch (R1)**:
- "Anthropic memory_20250818 + context-editing tool API 2026-Q3 production-readiness. ReasoningBank failure-distillation prompt patterns + retrieval-at-decision-time integration 2026-Q3. Importance-weighted memory decay parameters + Mem0/A-MEM/Letta production tradeoffs as of 2026-Q3."

**Out of scope (Sprint 3.x territory)**: vector DB (sqlite-vec triggered at ~100 memory files), knowledge graph (Tier 4), per-agent personal memory (R1 said no at <12 specialists), memory exchange between agents (premature; pull-based shared kb is right primitive).

**Stolen from**: Anthropic Memory Tool docs (Sept 2025 release) + Anthropic context-editing docs + ReasoningBank paper (arXiv 2509.25140) + Google ReasoningBank blog + Mem0 State-of-AI-Agent-Memory 2026 + cortex-x's existing Sprint 1.8.3 lessons machinery.

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

### Sprint 4.7 — Rebrand Hermes → **Steward** ✅ SHIPPED 2026-05-08 (commit `8064b34` + v0.2.0 hardening `6477eab`)

**Status**: ✅ Shipped 2026-05-08. Initial rename in `8064b34` kept 1-week backward-compat shims; same-day operator-pivot to clean break shipped in `6477eab` (v0.2.0 platform hardening — deleted 10 hermes-prefix shim files + stripped runtime backward-compat). 953→973 tests after migration. All 3 CI lanes green.

**(Original sprint memo retained below for historical context — promotion rationale.)** 🔴 PROMOTED 2026-05-09 from "deferred decision" to **PRE-PUBLIC-TAG MUST**. Web research confirmed NousResearch/hermes-agent: **139k stars, MIT, Feb 2026, active domains `hermes-agent.nousresearch.com/.org/.ai`, $5 VPS deploy, 5 backends, DSPy + GEPA self-evolution loop**. The collision is unrecoverable — top-tier dominant production project + dedicated `.com/.org/.ai` namespace = cortex-x cannot win SEO, community awareness, or any tag-search query for "hermes agent." Operator approved 2026-05-09: rebrand to **Steward**.

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
- **Read-only first.** Live journal viewer rolled by date / kind / outcome; spec_failures drill-down (per criterion id, expected vs actual, file affected); lessons.jsonl explorer; cost ledger vs `STEWARD_DAILY_USD_CAP` / `STEWARD_TREE_USD_CAP` (post-2.2); halt status; recommendations.md preview with detector-match overlay; cron run timeline (`gh run list --json`).
- **Anthill view (post-2.2 / 2.3 — operator-pitched 2026-05-08).** When Sprint 2.2 ships supervisor + worker spawning, dashboard wraps the OTLP traces from Sprint 2.0 (Phoenix/Langfuse) and renders the live tree: supervisor at root, N workers as children, per-node cost + token + status, fan-out/fan-in animation. **Don't reinvent the trace store** — Phoenix already has the OTLP HTTP API; dashboard is just the Steward-flavored UI. See [`docs/research/swarm-self-spawning-agents-2026-05-08.md`](./research/swarm-self-spawning-agents-2026-05-08.md) §9 for visualization options surveyed.
- **v2 control**: halt button (writes `.cortex/STEWARD_HALT` with reason; legacy `STEWARD_HALT` filename also honored through v0.2.0), lesson edit/dismiss.

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
| Multi-platform messaging gateway (NousResearch pattern) | Sprint 2.6 narrows to **Discord-only**. No SMS/Slack/Email/Telegram parallel surface unless Discord proves painful in 90+ days of use. |
| Real-time visual workspace (agent-zero Universal Canvas) | Steward is headless cron, no human in the loop during execution. Demo value, zero operational value for our usecase. |
| Full Linux container in Docker (agent-zero) | GitHub Actions ephemeral runners are already our Linux. Adding Docker = ops complexity for no capability gain. |
| Browser-specific abstractions (browser-harness CDP) | cortex-x is code-first, not UI-first. Tier 3 Sprint 4.6 covers UI verification narrowly via Playwright-MCP — that's enough. |
| Auto-merge Steward PRs | MUST-H6 hardcoded forever. Humans always merge. |
| Self-modification of `bin/steward/` core | EDIT_DENYLISTED catches this. Self-extending capabilities (Sprint 3.1) live in `cortex/agent-workspace/skill-experiments/`, not in `bin/steward/_lib/`. Brain ≠ scratch pad. |
| **"City of agents" metaphor** | Considered 2026-05-08; **rejected**. Empirical evidence (25k-task experiment, [Multi-Agent Trap](https://towardsdatascience.com/the-multi-agent-trap/)) shows hierarchical society metaphors *amplify errors up to 17.2×* once the underlying model is strong enough to use freedom. Supervisor / review-pipeline framing is tighter for cortex-x's shape. |
| **Per-agent personal memory + cross-agent random exchange** | R1+R4 research dispatch 2026-05-08 converged: at ≤6 specialist agents the fragmentation tax > benefit. Agents overlap heavily in reasoning; shared `lessons.jsonl` with `agent_id` tag wins. Re-evaluate at ≥12 specialist agents (post-Sprint 3.1 self-extension territory). |
| **Random / async memory broadcast between agents** | [GitHub multi-agent-failures blog](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/): async broadcast is *the* failure mode. Use typed schemas at handoff boundaries (cortex-x review pipeline already does this), not pubsub. |
| **OpenSwarm by VRSEN as inspiration** | Inspected 2026-05-08: hub-and-spoke around Agency Swarm, no inter-agent peer messaging or shared memory. cortex-x's review pipeline is architecturally tighter. Borrowing would be a downgrade. |
| **NAS / VPS / "AI second brain" rebrand of cortex-x** | The metaphor lands for Tier 4 vision, but premature for Tier 0–2 surface positioning. Keep "developer OS for the AI era" framing until Sprint 5.0 self-hosted entity actually ships. |
| **Letta / Mem0 / MemGPT runtime adoption** | All require Docker + Postgres + (often) Neo4j + (often) Qdrant. Violates cortex-x's zero-runtime-dep CJS posture. Architectural inspiration only — concrete primitives via Anthropic Memory Tool (Sprint 2.8). |
| **Vector DB / pgvector / Weaviate at current scale** | <100 memory files; BM25 / grep + tag filter is sufficient. Trigger for `sqlite-vec` adoption: MEMORY.md index reaches ~100 files OR grep returns >10 candidates for typical queries. Until then = premature optimization. |
| **Knowledge graph DB (kuzu / neo4j-embedded)** | Kuzu archived 2025-10-10. Embedded KG ecosystem isn't mature. Tier 4 (Sprint 5.x Obsidian SSOT + life ingest) re-evaluates. |
| **Second Anthropic Max subscription "for cortex"** | Single Max x20 (~900 messages / 5h) has trivial headroom for current Steward cadence (~1 LLM call/night). Buying second sub is premature spend; April 2026 OpenClaw crackdown puts "agent-as-second-beneficiary" in grey zone. Re-evaluate only if Sprint 2.1 autoresearch fan-out × multiple worktrees genuinely starves the cap. |
| **Local LLM hardware purchase before Sprint 2.4 + 2.7 ship** | Sprint 2.4 (`claude-cli` engine via Max sub) reduces marginal Anthropic spend to $0 for most action_kinds. Hardware decision waits until 60-day data shows residual OpenRouter spend > 800 CZK/month. Otherwise the 30k CZK box solves a non-problem. |
| **Random / "weekly meeting" agent reflection cron** | "Sleep-time compute" / agent dreaming is currently hype-leaning per R4 research. Validated wins (5x compute reduction, Letta paper) only on pre-computing predictable queries. Steward's existing nightly cron + Sprint 2.8 ReasoningBank distillation already does the pragmatic version. |

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

**Fortunate reality**: of the 26 sprints in this roadmap (after 2026-05-08 expansion: 2.0.1 + 2.4-2.8), **22 are hardware-independent** and ship fine on GHA + local dev machine. Only Sprint 5.0 (self-hosted always-on Steward) and Sprint 5.4 (live-entity voice UX) genuinely need the home box. Everything else can be developed and validated in current infra.

This means: **no waiting period**. Velocity continues 6-12 weeks before "awakening" the entity on home hardware. Hardware purchase decision deferred to **post-Sprint 2.7** — by then we'll have 60+ days of `claude-cli`-via-Max-sub data to know whether residual OpenRouter spend justifies the 30k CZK box.

### Week-by-week sequencing (recommended, post-2026-05-08 update)

| Week | Sprint | Hardware needed? | Why this order |
|---|---|---|---|
| 1 | **1.9 — Spec-driven verification** ⭐ ✅ | No | Shipped 2026-05-09. Unblocked 2.1 + 2.2 + 3.0 (richer fitness signal). |
| 1 | 1.9.1 — Multi-window cost safety + loop detector ✅ | No | Shipped 2026-05-09. Pre-2.x pojistka. |
| 1 | 2.0 — Phoenix observability ✅ | No | Shipped 2026-05-08. |
| 1 | 2.0.1 — OTLP protobuf encoder ✅ | No | Shipped 2026-05-08. Manual-dogfood-driven fix. |
| 1 | 2.0b — Action-kind model routing ✅ | No | Shipped 2026-05-08. |
| 1 | 2.1 — Autoresearch overnight burst ✅ | No | Shipped 2026-05-08. |
| 1 | 4.7 — Steward rebrand ✅ | No | Shipped 2026-05-08. NousResearch hermes-agent collision. |
| **2-3** | 2.2 — Worktree supervisor + judge ensemble | No (GHA worktrees natively) | Multi-agent MVP. Each worker verifies against spec from 1.9. |
| **3** | 2.3 — Mutation testing as fitness signal | No (Stryker on GHA) | Closes verification gap further. After 2.2 because workers benefit too. |
| **4** | **2.4 — `claude-cli` engine via Max sub** ⭐ COST PIVOT | No | Shifts most LLM cost to $0. Decisive input for hardware decision. Should land *before* 2.7 so pattern_transfer is free. |
| **4-5** | 2.5 — `tech_debt_audit` action_kind | No | Pure deterministic, low risk, compounds with autoresearch. |
| **5** | 2.6 — Discord remote control | No | Mobile UX for halt/status/recommendations. Operator confirmed Discord 2026-05-08. |
| **6** | 2.7 — Cross-project `pattern_transfer` | No | Allowlisted sibling-project read access. Free under 2.4 Max sub. |
| **6-7** | 2.8 — Memory Foundation (Memory Tool + ReasoningBank failures + decay) | No | **Memory gate before Tier 2.** +29-39% Anthropic native + +34% failure-distillation + +10% decay. |
| **7** | **HARDWARE DECISION POINT** (60-day data on residual OpenRouter spend) | — | If spend > 800 CZK/mo → buy 3090 box; else defer to GLM-4.7-Air-class fitting 24GB (Q3-Q4 2026). |
| **8** | **5.1 — "Soul" abstraction** (early Tier 4 prep) | No | Multi-agent Steward (post-2.2) needs distinct identities. Souls.md cheap + impactful + ready for hardware moment. |
| **9-10** | 3.0 — AlphaEvolve prompt evolution | No | The compound moonshot. Needs 1.9 spec criteria + 2.1 autoresearch budget + 2.8 memory + 5.1 souls. |
| **11** | 3.1 — Self-extending capabilities (`skill-experiments/`) | No | Browser-harness pattern. Steward writes own micro-helpers. |
| **12** | **HARDWARE LIKELY ARRIVES + retro week** | — | Decompress. Order Beelink/NAS. Retro on weeks 1-11. |
| **13-14** | **5.0 — Awaken the entity** | YES (NAS / Beelink) | Migrate cortex-x from GHA-only to home-server always-on. Steward daemon, not cron. |

### Logical sequencing rationale

- **1.9 first because** it produces the richer fitness signal that 2.1, 2.2, 3.0 all depend on. Without spec criteria, "did this run improve anything?" is just `npm test boolean`.
- **2.0 + 2.0b parallel because** they're both small (S), independent, and feed observability into every later sprint.
- **2.1 before 2.2 because** Karpathy autoresearch (multi-strategy serial within one run) is the conceptual prerequisite for worktree parallel — supervisor needs to know how multi-strategy works in single context first.
- **5.1 (souls.md) deliberately moved up to week 8** because by then Steward has ≥4 distinct agents (supervisor, worker, judge, harvester), each needs identity. Cheap to implement (markdown + a load step in action-engine) and lets us "have it ready" for hardware activation.
- **2.4 (claude-cli engine) intentionally before 2.5/2.6/2.7** because it's the cost-economy pivot. Once `claude -p` Max-sub billing is validated with $0 marginal cost guard, all subsequent LLM-touching sprints (2.7 pattern_transfer, 3.0 AlphaEvolve) ride free. Anything before 2.4 keeps paying OpenRouter; anything after rides Max sub.
- **2.8 (memory foundation) before 3.0 (AlphaEvolve)** because evolving prompts against rotting memory = noise. Decay + failure-distillation + native memory-tool make the substrate stable enough for evolutionary signal to be meaningful.
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
- **2026-05-08 5-agent research dispatch** (Tier 1 expansion driver, in conversation context — should land in docs/research/ as a synthesis memo when Sprint 2.4 R1 work begins). Five parallel topics: (a) multi-agent memory + city metaphor + OpenSwarm, (b) local LLM hardware + Qwen3-Coder for 24GB VRAM, (c) Anthropic Max sub via `claude -p`, (d) infinite memory + compact windows, (e) Discord/email + tech-debt + cross-project + multi-session.
- VentureBeat Karpathy autoresearch (March 9, 2026): https://venturebeat.com/programming-development/andrej-karpathys-new-open-source-autoresearch
- GitHub Spec Kit: https://github.com/github/spec-kit
- AWS Kiro: https://kiro.dev/docs/specs/
- EvalAgent paper: https://arxiv.org/html/2510.24358v1
- Composio Agent Orchestrator: https://github.com/ComposioHQ/agent-orchestrator
- AlphaEvolve paper: https://arxiv.org/abs/2506.13131
- OpenEvolve: https://github.com/algorithmicsuperintelligence/openevolve
- ReasoningBank: https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/ + paper https://arxiv.org/abs/2509.25140
- A-MEM (NeurIPS 2025): https://arxiv.org/abs/2502.12110
- Anthropic Memory Tool docs (Sept 2025): https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic context-editing tool docs: https://platform.claude.com/docs/en/build-with-claude/context-editing
- Claude Code headless docs: https://code.claude.com/docs/en/headless
- Claude Code routines docs: https://code.claude.com/docs/en/routines
- Claude Agent SDK ≠ Max billing (issue #559): https://github.com/anthropics/claude-agent-sdk-python/issues/559
- claudefa.st safe-use guide: https://claudefa.st/blog/guide/development/claude-code-subscription
- claude-ollama-dual smart-orchestrator: https://github.com/krishnenduk95/claude-ollama-dual
- OpenClaw ban (VentureBeat April 2026): https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and
- Multi-Agent Trap (Towards Data Science): https://towardsdatascience.com/the-multi-agent-trap/
- GitHub blog: multi-agent workflows often fail: https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/
- HF Qwen3-Coder-30B-A3B model card: https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct
- Red Hat: vLLM vs llama.cpp: https://developers.redhat.com/articles/2025/09/30/vllm-or-llamacpp-choosing-right-llm-inference-engine-your-use-case
- LocalAIMaster SWE-bench leaderboard: https://localaimaster.com/models/swe-bench-explained-ai-benchmarks
- qlty CLI: https://github.com/qltysh/qlty
- discord.js v14 docs: https://discord.js.org/
- repowise multi-repo MCP: https://github.com/repowise-dev/repowise
- Node.js permission model: https://nodejs.org/api/permissions.html
- CVE-2025-55130 Node fs symlink bypass: https://research.jfrog.com/vulnerabilities/nodejs-fs-permissions-bypass-cve-2025-55130/
- Claude Code worktrees v2.1.50: https://code.claude.com/docs/en/worktrees
- Mem0 State of AI Agent Memory 2026: https://mem0.ai/blog/state-of-ai-agent-memory-2026
- sqlite-vec: https://github.com/asg017/sqlite-vec
- Kuzu archived (cautionary tale): https://ai.plainenglish.io/the-disappearance-of-kuzu-a-cautionary-tale-for-ai-and-knowledge-graph-development-5daffcaebcd8
- NousResearch/hermes-agent: https://github.com/nousresearch/hermes-agent
- agent0ai/agent-zero: https://github.com/agent0ai/agent-zero
- browser-use/browser-harness: https://github.com/browser-use/browser-harness

---

**This document is a living artifact. Update it on every sprint transition. Older versions live in git history.**
