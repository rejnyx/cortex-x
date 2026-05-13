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

### Sprint 2.2.5 — `edit.position` primitive in action-engine (M effort) — ✅ SHIPPED 2026-05-10 (v0/v1)

**Status**: ✅ Shipped 2026-05-10. Action-engine now supports `edit_ops[]` shape with `append` / `create` / `insert` / `str_replace` operations + `expectedSha256` SHA pinning gate. R1 memo: [`docs/research/sprint-2.3-edit-position-2026-05-10.md`](research/sprint-2.3-edit-position-2026-05-10.md) (filename intentionally `2.3-` for chronological order; sprint label is 2.2.5). Three-stage validation: LLM emits op + SHA → engine validates SHA matches pre-edit content → engine applies op → spec-verifier gates result.

**Why before mutation testing**: 2026-05-10 dogfood proved that current LLMs (DeepSeek V4 Flash + likely all current production models) cannot reliably return full-file content for "insert N bytes into existing >200 B file" tasks. Today's edit shape is `{ path, content, replace_all? }`. LLM either returns empty response or partial-content rewrite — `no_destructive_rewrite` correctly blocks 100 % of these. **Result**: 3 of 7 cortex-x recommendations had to be marked `[HUMAN-ONLY]` as same-incident-class. Most production cortex-x recommendations will hit the same wall until we ship a richer edit primitive.

**Without 2.2.5, autoresearch + nightly produce zero LLM-driven value on edit-existing-file tasks**, regardless of model quality. With 2.2.5, the same recommendations become Steward-actionable.

**Scope (pending R1 finalization)**:
- Extend edit shape: `{ path, content, position?: 'append' | 'before_line:N' | 'after_pattern:X' | 'replace_all' }`. Default stays `replace_all: false` for backward-compat with existing edits.
- `applyEditsToFilesystem` honors `position`; for `append` uses `fs.appendFile`; for `before_line`/`after_line` does line-array splice; for `after_pattern` does single-occurrence regex match (uniqueness validated).
- Update LLM system prompt: "PŘI insert tasks, vrať `position` + chunk, NE celý file."
- Spec-verifier alignment: `no_destructive_rewrite` fires only when `position === 'replace_all'` or unset (backstop preserved). New criteria added per R1 safety memo: anchor uniqueness, line-bound check, post-edit-grows-when-append.
- Property tests: `position: 'append'` MUST grow file size; `before_line:N` MUST preserve all pre-edit lines; anchor with N matches MUST throw rather than randomly pick.

**Stolen from**: Aider search-replace blocks, Claude Code Edit tool's `old_string` uniqueness, GitHub apply_patch unified-diff format. R1 will rank.

**Unblocks**: re-trigger autoresearch / nightly on currently `[HUMAN-ONLY]`-marked recommendations (#5 docs append, #6 JSDoc insert, #7 constant insert) without operator intervention. Sprint 2.3 mutation testing benefits indirectly (mutation scoring on *edited* code requires reliable edits).

**Risk**: low. Backward-compat: missing `position` = current behavior. Deletion of feature = revert single commit + spec-verifier criterion → no data corruption.

---

### Sprint 2.3 — Mutation testing as fitness signal (S-M effort) — R1 ✅ DONE 2026-05-09

**Status**: 📋 R1 research complete 2026-05-09 (autonomous evening session). Implementation awaiting operator approval. R1 memo: [`docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md`](research/sprint-2.3-mutation-testing-fitness-2026-05-09.md) — 10 sources cited.

**Why round out Tier 1**: makes verification *more* rigorous than just "tests pass". If LLM patch passes tests but mutation score regresses, reject — the existing tests aren't actually exercising the diff.

**R1 recommendation (from web research dispatch)**: StrykerJS 9.6 incremental mode + risk-tiered thresholds (80% `bin/steward/_lib`, 70% orchestrators, 75% `bin/cortex/tools`, 60% advisory `detectors/`). Companion fast-check property tests (Sprint 2.9.7b already established the pattern). Defer Meta ACH (FSE 2025) LLM mutation generation to Sprint 3.x. GHA quota burn flagged HIGH; mitigation = weekly-only nightly OR self-hosted runner.

**Scope (R1 §4)**:
- Stryker (JS mutation testing) integrated into `verifier.cjs` as a post-`npm test` gate (only for `recommendation` kind initially, since deterministic kinds don't change code logic).
- Pre-edit baseline mutation score captured to journal.
- Post-edit mutation score must be ≥ baseline; if lower → `EDIT_MUTATION_REGRESSION`.
- New action_kind `mutation_score_drift` (Sprint 2.5 tech_debt_audit pattern) — files gh issue when nightly mutation score drops > 5pp.

**Companion: Property-Generated Solver pattern** — fast-check + hand-rolled property tests for halt-check, cost-safety, spec-verifier, action-engine, path-safety. Sprint 2.9.7b shipped the first wave (78 hand-rolled property tests).

**Open questions for operator (R1 §8)**:
1. Cadence: per-PR incremental + nightly full, OR weekly-only full (GHA quota concern)?
2. Self-hosted runner for full mutation runs?
3. Initial threshold: 80% hard from day 1 OR measure-only mode 2 weeks → ratchet?

**Stolen from**: StrykerJS 9.6 incremental mode + Property-Generated Solver (arXiv 2506.18315) + Meta ACH (arXiv 2501.12862, FSE 2025).

---

### Sprint 2.4 — Anthropic `claude-cli` engine via Max subscription ✅ SHIPPED 2026-05-09 (commit `3f9575d`, ⭐ COST PIVOT)

**Status**: ✅ Shipped 2026-05-09. New `claudeCliEngine` inline in `bin/steward/_lib/action-engine.cjs` (~470 LoC including helpers). Three-layer billing-leak defense: env scrub + `total_cost_usd === 0` assert + fleet `STEWARD_HALT` write. Auth via `CLAUDE_CODE_OAUTH_TOKEN` only; `--bare` hard-prohibited via `CLAUDE_CLI_FORBIDDEN_FLAGS` freeze-list. R2 review pipeline (6 agents in parallel) found 1 BLOCKER + 3 HIGH + 11 MAJOR + 14 MINOR; 13 must-fix items applied pre-commit. R1 memo: [`docs/research/sprint-2.4-anthropic-claude-cli-engine-2026-05-08.md`](research/sprint-2.4-anthropic-claude-cli-engine-2026-05-08.md). 1158 → 1164 tests (29 new).

### Sprint 2.4.1 — Per-action_kind effort tuning ✅ SHIPPED 2026-05-11

Grounded in: [`docs/research/sprint-2.4.1-extended-thinking-research-2026-05-11.md`](./research/sprint-2.4.1-extended-thinking-research-2026-05-11.md). Anthropic effort parameter (`low`/`medium`/`high`/`xhigh`/`max`) bifurcated from legacy `budget_tokens` in Opus 4.7. Claude Code v2.1.117+ defaults to `xhigh` — every cortex-x action was silently paying for xhigh-tier thinking before this fix. Sprint 2.4.1 adds `effort` field per LLM-requiring action_kind (recommendation/pattern_transfer → `high`; senior_tester_review/release_notes_drafter → `medium`) + `resolveEffortLevel()` precedence (env > opts > action_kind > default `medium`) + `--effort <level>` arg injection into claudeCliEngine + journal capture for retro analysis. Test enforces NO default `xhigh`/`max` (anti-overthinking; community reports max-effort looping behavior). ~80 LoC, 16 tests. Operator escape hatch: `CLAUDE_CODE_EFFORT_LEVEL` env var.

**(Original sprint memo retained below for design context.)**



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

### Sprint 2.5 — `tech_debt_audit` action_kind ✅ SHIPPED 2026-05-09 (commit `b9d25b5`)

**Status**: ✅ Shipped 2026-05-09. 10th action_kind, deterministic (zero LLM cost), runs nightly, snapshots code-health to `cortex/debt-snapshot.json` (committed audit trail). qlty + knip toolchain. Fail-open on missing tools. R2 review pipeline (6 agents) found 2 BLOCKER + 3 HIGH + 11 MAJOR + many MINOR; 14 must-fix items applied pre-commit (dispatcher wire, scrubEnv, byte-cap, parser hardening, fs walk symlink protection, error-code reconciliation, 3 fixture-based integration tests). R1 memo: [`docs/research/sprint-2.5-tech-debt-audit-2026-05-08.md`](research/sprint-2.5-tech-debt-audit-2026-05-08.md). 1187 → 1199 tests (35 new).

**(Original sprint memo retained below for design context.)**



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
- Snapshot stored at `cortex/debt-snapshot.json`, diffed against prior week.
- Drift threshold (default: 10% degradation in any single metric) → opens advisory PR with the diff. Below threshold → silent journal entry only.
- Halt criterion: never. This kind is read + report; no edits. PR is review-only for operator.

**New error codes**:
- `TECH_DEBT_QLTY_MISSING` (qlty not installed)
- `TECH_DEBT_SNAPSHOT_CORRUPT` (prior snapshot unreadable; silently regenerates baseline)
- `TECH_DEBT_THRESHOLD_EXCEEDED` (advisory, not blocking)

**Acceptance criteria**:
- [ ] First nightly run produces `cortex/debt-snapshot.json` baseline.
- [ ] Second run produces a diff. If above threshold → draft advisory PR opened.
- [ ] Zero LLM cost recorded in journal (no engine call).
- [ ] ≥ 10 new tests + 1 fixture-based integration test (synthetic snapshot pair).
- [ ] Fail-open: missing qlty installer → kind skipped with single warn line, doesn't halt cron.

**Pre-implementation research dispatch (R1)**:
- "qlty vs CodeScene CLI vs SonarQube CLI 2026-Q3 maturity. Heuristic vs ML tech-debt detection state-of-art. Best practices for snapshot drift detection (sliding window vs week-over-week vs since-last-release)."

**Out of scope**: AI-generated remediation suggestions (Sprint 3.0 prompt evolution can build on the snapshot data later), per-file ownership routing (no team in single-operator scope), license-compliance audits (`qlty` doesn't cover; separate kind if needed).

**Stolen from**: qlty CLI + ksimback `tech-debt-skill` for Claude Code + general "tech debt as deterministic linter" pattern.

---

### Sprint 2.6 — Discord remote control ✅ SHIPPED 2026-05-09 (commit `27c3529`, v0 alpha; hardening 2.6.1 follow-up)

**Status**: ✅ Shipped 2026-05-09. `bin/discord-bridge/` sibling-folder pattern preserves zero-deps Steward core; bridge has its own `package.json` with `discord.js` 14.x. v0 ships testable zero-deps parts (auth + commands + journal-tail); Gateway WebSocket wiring deferred to operator setup. R2 retro review found 2 BLOCKER + 5 HIGH + 5 MAJOR; all BLOCKERs and most HIGHs landed in same-day Sprint 2.6.1 hardening commit (HMAC token reuse defense via consumed-tokens Set, SECRET ≥32 enforcement, ephemeral:true on all mutation embeds, `crypto.randomBytes` actionId, `!` prefix removed from Discord-side names per API spec, `appendRecommendation` mkdirSync + symlink TOCTOU defense). R1 memo: [`docs/research/sprint-2.6-discord-remote-control-2026-05-08.md`](research/sprint-2.6-discord-remote-control-2026-05-08.md). 1262 → ~1276 tests.

**(Original sprint memo retained below for design context.)**



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

### Sprint 2.7 — Cross-project `pattern_transfer` action_kind ✅ SHIPPED 2026-05-09 (commit `b80ebdf`, v0; hardening 2.7.1 follow-up)

**Status**: ✅ Shipped 2026-05-09. 11th action_kind, LLM-driven, journal-only. v0 ships testable zero-deps parts (manifest validator + sibling-reader path safety + glob matcher + assertEditWithinCwd); LLM dispatch deferred to Sprint 2.7.1 (needs operator-populated `cortex/sibling-projects.json`). R2 retro review found 2 BLOCKER + 4 HIGH + 3 MAJOR; both BLOCKERs landed in same-day Sprint 2.7.1 hardening commit (acceptance predicate now rejects UNC paths `\\server\share`, dispatcher returns `ACTION_KIND_NOT_DISPATCHABLE` until LLM wiring lands so cron operators see the gap explicitly). `assertEditWithinCwd` documented as wired-but-dormant pending dispatcher wiring. R1 memo: [`docs/research/sprint-2.7-pattern-transfer-2026-05-08.md`](research/sprint-2.7-pattern-transfer-2026-05-08.md). 1307 → ~1315 tests.

**(Original sprint memo retained below for design context.)**



**Why**: research dispatch 2026-05-08 (R5) confirmed cross-project pattern transfer is a **known 2026 pattern** (repowise, meta-repo pattern, Karpathy LLM-wiki). Pitched: cortex-x reads from a maintainer-curated allowlist of sibling project paths (e.g. `${HOME}/dev/<project-slug>`) for pattern inspiration without write access. **R5 strong recommendation: don't build full repowise; build narrow allowlist + read-only + new LLM action_kind.**

**Scope**:
- New config `cortex/sibling-projects.yaml` — explicit allowlist with per-repo `read_only: true`, `purpose: pattern-transfer`, `paths_allowed: [src/, docs/]`, `paths_denied: [.env*, secrets/, node_modules/]`.
- New helper `bin/steward/_lib/sibling-read.cjs` — wraps existing `clampPath` + `realpath` containment, refuses writes, refuses symlink-following outside allowlist. Defense in depth: invokes `node --permission --allow-fs-read=<each allowed root>` for the LLM call (built-in stable since Node v22.13.0 / v24.0.0).
- New action_kind `pattern_transfer` (LLM, premium tier — needs deep code understanding): reads sibling project, writes recommendation into *current* project's `lessons-learned.jsonl`. **Never edits sibling.**
- Acceptance criteria for the kind: output entry has `source_repo` field with absolute path; no `applyEdits` call paths to non-current-repo locations; spec-verifier rejects if any edit would land outside `process.cwd()`.
- Hardening per CVE-2025-55130 (Node.js fs permission symlink bypass): every read goes through `realpath`-then-validate, never raw path.
- Initial allowlist seed: maintainer-curated per-machine in gitignored `cortex/sibling-projects.json`; example with placeholder slugs ships in `cortex/sibling-projects.example.json`.

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

### Sprint 2.8 — Memory Foundation v0 ✅ SHIPPED 2026-05-09 (commit `86b2472`, ⭐ MEMORY GATE; hardening 2.8.1 follow-up)

**Status**: ✅ Shipped 2026-05-09. v0 ships zero-deps memory-decay primitive (`bin/steward/_lib/memory-decay.cjs`, ~150 LoC) + lessons.cjs schema extension (agent_id, failure_origin, impact, frequency forward-compat fields). Anthropic Memory Tool migration + retrieval-at-decision-time MaTTS + LLM failure-distillation deferred to Sprint 2.8.1 (operator-cost-validated). R2 retro review found 0 BLOCKER + 5 HIGH + 4 MAJOR + 4 MINOR; key HIGHs landed in same-day Sprint 2.8.1 hardening commit (decay floor at 1e-12 to prevent ancient-item underflow ranking loss, SSOT impact classifier covering all CLAUDE_CLI_* + TECH_DEBT_* + SIBLING_* error codes, small-list archive policy avoids decay-shock under 10 items, malformed ts → score 0 instead of fresh). R1 memo: [`docs/research/sprint-2.8-memory-foundation-2026-05-08.md`](research/sprint-2.8-memory-foundation-2026-05-08.md). 1337 → ~1345 tests.

**(Original sprint memo retained below for design context.)**



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

### Sprint 2.10 — QA Retrofit infrastructure ✅ SHIPPED 2026-05-09 (M effort, operator-targeted dogfood)

**Status**: ✅ Shipped 2026-05-09 late evening. Operator request: "udělej cortex master of testing guru pro novou kolegyni testerku — projet jak červ celý projekt, najít všechny slabiny, ale opravdu hluboké a dávající smysl." Field-test target: `<colleague-storefront-repo>` + `<colleague-admin-repo>`. R1 memo: [`docs/research/sprint-2.10-qa-retrofit-2026-05-09.md`](research/sprint-2.10-qa-retrofit-2026-05-09.md) — 38 cited sources via 4 parallel research agents.

**Why**: 75% of orgs target AI-driven testing, only 16% successfully adopt — differentiator is starting with audit baseline before automating (testdevlab 2026). cortex-x already has audit infra (existing-project-audit, planner, synthesizer, research dispatch); the QA lens closes the gap with a senior-consultant deliverable on day 1.

**Position**: "AI-augmented tester" not "tester replacement". 2026 industry consensus = QA → Quality Architect / SDET-AI; AI handles regression + maintenance, humans own exploratory + business-intent + risk decisions.

**What shipped**:
- `prompts/qa-retrofit.md` — 7-phase audit (P0 detect → P1 inventory + tsDetect 5-detector smell scan → P2 4-agent ISO 25010:2023 9-char + 3 cortex extras with Bach HTSM SFDPOT depth traversal → P3 5-Q human gate → P4 QA-specific 10-concern research → P5 testing-strategy.md + testing-gaps.md synthesis → P6 sample-test seeding opt-in)
- `profiles/qa-engineer.yaml` — framework-agnostic lens; risk-tiered quality gates (high-risk: 80% line + 70% branch + 75% mutation, mid: 70/60/60, low: advisory); ASVS L1/L2/L3 compliance mappings
- `templates/testing-strategy.md.hbs` + `templates/testing-gaps.md.hbs` — Handlebars templates with full 3-hop citation traceability slots; 9 ISO 25010:2023 char target rows; pyramid plan; P0/P1/P2/SKIP/OPEN/off-limits backlog format
- `shared/skills/test-audit/SKILL.md` — `/test-audit` slash command, auto-distributed via existing `install.{sh,ps1}` `shared/*` recursive copy
- `agents/planner.md` — extended with QA-engineer profile override (10 QA-specific concerns); topic naming `{stack-or-profile}-qa-{concern}-{year}`

**Grounded in**: ISO/IEC 25010:2023 (9 chars including new Safety, promoted from sub-char), OWASP ASVS 5.0 (May 2025), Bach HTSM SFDPOT, Feathers characterization tests + seams, Gregory/Crispin Agile Testing Quadrants, Peruma et al. tsDetect FSE'20 (5-detector starter at 85-100% precision), Trail of Bits 2026 mutation-testing-for-the-agentic-era, Anthropic Claude Code best-practices doc.

**Tests**: +46 — `tests/unit/qa-retrofit-structure.test.cjs` (artifact existence + 7-phase prompt structure + grounded-references + risk-tiered profile + template hbs slots + skill cross-references + planner override + R1 memo 30+ sources + 3-hop traceability tags).

**Field-test plan**: colleague clones cortex-x → `./install.ps1` → in her duplicate of `<colleague-storefront-repo>` invokes `/cortex-init` (general retrofit) then `/test-audit` (QA lens) → 30-min audit produces 6 deliverables in `cortex/qa/`. Optional `--seed-tests` materializes top 3 P0 gaps as runnable test files. Repeat for `<colleague-admin-repo>`. Expected wow moment: she walks in day 2 with a senior-consultant deliverable already done; reviews + executes, doesn't build.

**Out of scope** (explicit non-goals): auto-running mutation testing in `qa-retrofit` (recommended in P5, not executed; Stryker integration = Sprint 2.3 work); auto-generating > 3 sample tests; replacing `/audit` (siblings, not overlap); profile auto-detection (qa-engineer is invoked explicitly).

---

### Sprint 2.9.7 + 2.9.7a + 2.9.7b — All-green cron + R2 hardening + property tests ✅ SHIPPED 2026-05-09 (S-M effort)

**Status**: ✅ Shipped 2026-05-09 across 3 commits (`dec9acf` + `47cc2a7` + `2c8a290`). Tests 1517 → 1601 (+84). Closes "all crons green" goal modulo GHA billing.

**Sprint 2.9.7 (`dec9acf`)** — three coordinated tracks:
- **Track 1**: 3 fresh LLM-able items in `cortex/recommendations.md` (TROUBLESHOOTING append, JSDoc, version constant). Append-only, well under spec-verifier shrink threshold.
- **Track 2**: Surgical `exitCode:0` fix — SPEC_VIOLATION + `STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED` (defense layers fired correctly) now exit clean. Result shape stays `ok:false + code:SPEC_VIOLATION` (existing test contract intact); only process exit code changes 1 → 0. Other SPEC_* codes (MALFORMED, PREDICATE_THREW, etc.) still exit 1.
- **Track 3**: 6 new cron YAMLs (`steward-{doc-drift,test-coverage-gap,pr-review-responder,flaky-test-repair,lint-fix,tech-debt-audit}.yml`) with staggered schedules.

**Sprint 2.9.7a (`47cc2a7`)** — R2 hardening (3 reviewers in parallel: blind + security + edge-case):
- HIGH NaN/Infinity exitCode validation: `validExitCodeOrDefault` helper, `Number.isInteger(x) && 0 ≤ x ≤ 255`.
- HIGH qlty pipe-to-shell removed from tech-debt-audit YAML (compromised qlty.sh + `contents:write` was a real supply-chain risk; detector fail-opens cleanly).
- MEDIUM flaky_test_repair path allow-list: regex restricts edits to `*.test.* / *.spec.* / __tests__ / tests / test` paths; production source with misplaced markers is skipped.
- Cost-cap env block on deterministic skip_commit workflows (shared-ledger gate against prior LLM spend).

**Sprint 2.9.7b (`2c8a290`)** — property-based tests + bug fix:
- 78 new hand-rolled property tests (zero-deps): annotation-routing 16-perm sweep, bash forbidden-pattern 32 known-bad + 24 known-safe + idempotency, glob.globToRegex invariants, memory-decay scoring monotonicity + impact ordering + decay floor + partition completeness.
- **Real bug surfaced + fixed**: `bin/steward/_lib/memory-decay.cjs decayPass()` now actually enforces Sprint 2.8 R1 acceptance criterion "zero blocker lessons archived". Old behavior took bottom N% scored items irrespective of impact (could archive blockers if very old + low frequency). New: filter into nonBlockers + blockers; archive ONLY from nonBlockers pool capped at nonBlockers.length.

**Companion R1 memos (autonomous evening session)** — awaiting operator approval:
- `docs/research/sprint-2.7.1-pattern-transfer-llm-dispatch-2026-05-09.md` — design for closing pattern_transfer ACTION_KIND_NOT_DISPATCHABLE gap.
- `docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md` — web-research-backed (10 sources) Stryker integration design.

**Final cron verification BLOCKED by GHA billing** (NOT a code regression). All 11 manually-triggered workflows died at job-start with GitHub error: *"recent account payments have failed or your spending limit needs to be increased."* (Maintainer handover notes captured under gitignored `docs/dogfood/`.)

---

### Sprint 2.9.6 — dry-run dispatcher gap + cron infrastructure complete ✅ SHIPPED 2026-05-09 (S effort)

**Status**: ✅ Shipped 2026-05-09 across 5 micro-commits (`17ad518` 2.9.6 dispatcher branches, `e5bf7cb` 2.9.6b skip_commit validation, `0ae1084` 2.9.6c skip Phase 5 checkout + early probe, `c267ca2` 2.9.6d NO_CANDIDATES whitelist, `6861c7b` 2.9.6e CLI formatter, `15e671f` Sprint 4.7 rebrand finishing).

**Why**: "Turn on all crons" session-trigger surfaced a pre-existing v0.7-era bug — `bin/steward/dry-run.cjs` only handled `recommendation` + `recommendation_harvest`. Cron workflows for `todo_triage` (Sprint 1.8.7) and `dep_update_patch` (Sprint 1.8.4) had been registered for months but never ran successfully end-to-end. Each kind fell through to the default LLM path and either crashed on `OPENROUTER_API_KEY` requirement or wasted daily cap on irrelevant recommendations.

**What shipped**:
- `buildDeterministicPlan` helper in dry-run.cjs.
- Dispatch branches for all 9 deterministic kinds: `todo_triage`, `dep_update_patch`, `flaky_test_repair`, `doc_drift`, `lint_fix_shipper`, `test_coverage_gap`, `pr_review_responder`, `tech_debt_audit`, `pattern_transfer` (last hard-fails per Sprint 2.7.1 status).
- `recommendations.md` parse + slug-check gated to kinds that need it (`recommendation` + `recommendation_harvest`); deterministic kinds run on bare repos cleanly.
- Early detector probes for `todo_triage` + `dep_update_patch` at dry-run time → clean `no_actionable_step` exits.
- `execute.cjs` Phase 5 (checkoutNewBranch) gated on `!plan.skip_commit` — skip_commit kinds (todo_triage, doc_drift, etc.) don't need a branch.
- `execute.cjs` plan validation: `branch + commit_message` only required when `!skip_commit`.
- `NO_CANDIDATES_CODES` whitelist — detector "scanned, nothing to do" exits as success-shape `no_action: true` instead of failure.
- CLI formatter defensive on skip_commit results (no more "Cannot read properties of undefined (reading 'join')" on success).

**Sprint 4.7 rebrand finishing** (15e671f): cron workflow YAML `name:`, step names, concurrency groups, git identity, journal artifact prefixes, branch-prefix comments, gh issue label all renamed `hermes/Hermes` → `steward/Steward`. 2 historical references preserved (migration trace + backward-compat doc).

**End-to-end cron verification 2026-05-09**:
- ✅ steward harvest (recommendation_harvest)
- ✅ steward todo-triage (todo_triage) — first successful run ever
- ✅ steward dep-patch (dep_update_patch) — first successful run ever
- ⚠️ steward nightly (recommendation) — spec-verifier `no_destructive_rewrite` blocks unsafe LLM rewrites; expected behavior given current `cortex/recommendations.md` only has HUMAN-ONLY items
- ⚠️ steward autoresearch — same root cause; ensemble of 3 candidates all spec-verifier-blocked

**Tests**: 1502 → 1513 (+11 dispatcher tests + 1 cross-platform bash regex test).

**Follow-up needed**: operator adds fresh LLM-able items to `cortex/recommendations.md` so nightly + autoresearch produce real PRs. Current items are HUMAN-ONLY (D-1 git history purge, MIGRATIONS append) by design.

---

### Sprint 2.9 — Tools Foundation v0 ✅ SHIPPED 2026-05-09 (M effort, ⭐ STRATEGIC)

**Status**: ✅ Shipped 2026-05-09. New `bin/cortex/tools/` module tree (~2k LoC): descriptor spec + validator + 6 reference tools (read/write/edit/glob/grep/bash) + 4 runtime adapters (toMcpServer primary, toClaudeAgentSdk, toOpenAiAgents, toVercelAiSdk-stub) + annotation routing + 2 shared libs (`_lib/path-safety.cjs` + `_lib/limits.cjs`). 6-agent R2 review pipeline (acceptance + blind + correctness + security + ssot + edge-case) surfaced 6 BLOCKER + 18 HIGH + 9 MEDIUM findings; all BLOCKERs and key HIGHs fixed in hardening pass before merge. 1349 → 1502 tests (+153). R1 memo: [`docs/research/sprint-2.9-tools-foundation-2026-05-09.md`](research/sprint-2.9-tools-foundation-2026-05-09.md).

**Hardening pass shipped (R2 closed-out)**:
- Extracted `_lib/path-safety.cjs` (5 duplicates → 1 SSOT) with fail-closed semantics + UNC/device-prefix rejection + Windows case-insensitive containment + parent-mode for `write`.
- Extracted `_lib/limits.cjs` (4 duplicates of MAX_FILE_BYTES + 2 of MAX_DEPTH/MAX_RESULTS → 1 SSOT).
- TOCTOU symlink-swap defense in `write` + `edit` via `O_NOFOLLOW` on POSIX (Windows: lstat-only fallback).
- Bash forbidden-token list rewritten as REGEX patterns: rm -rf `[/home, /etc, /var, /usr, /opt, /]`, disk-device writes (`> /dev/sd*` / `nvme*` / `hd*` / `vd*` / `xvd*`), pipe-to-shell (curl/wget/fetch | sh/bash/zsh/ksh/fish/python/ruby/perl/node), process-substitution `bash <(curl …)`, eval/source curl, halt with full trailing context, Windows-specific `del /F /S /Q`, `format X: /Y`, `Remove-Item -Recurse -Force`.
- Bash env scrub: switched from denylist (5 keys) → ALLOWLIST (PATH, HOME, USER, USERPROFILE, LANG, TZ, SHELL, TEMP, TMP, SystemRoot, COMSPEC + STEWARD_BASH_ENV_PASSTHROUGH).
- Bash output-cap: track Buffer arrays not string concat (UTF-8 multibyte truncation defense).
- Bash empty `STEWARD_BASH_ALLOWLIST` (after trim) now FAIL-CLOSED instead of silent-disable.
- Bash spawn null-check stdout/stderr + sync-error handler.
- Bash `\s` Unicode whitespace + `/u` flag for NBSP/NNBSP/MMSP/IDEOGRAPHIC bypass defense.
- `read.cjs` magic-byte sniff for binary files (NUL byte in first 8 KiB → `TOOL_READ_BINARY`).
- `read.cjs` EOL detection (lf/crlf/mixed) for round-trip fidelity.
- `edit.cjs` non-overlapping count (`aa` in `aaaa` counts 2, not 3 — Sprint 1.6.18 lesson class).
- `edit.cjs` shrink defense applied unconditionally (was inverted boolean — replace_all=true is MORE destructive, not less).
- `edit.cjs` directory-target rejection + `not-a-file` rejection.
- `write.cjs` directory-target rejection + parent-not-directory rejection.
- `glob.cjs` recursive alternative translation (`{*.cjs,*.js}` no longer crashes).
- `glob.cjs` Windows-friendly `dev:ino==0:0` path-key fallback.
- `grep.cjs` per-line regex deadline (`GREP_PER_LINE_REGEX_DEADLINE_MS=50` → ReDoS defense).
- `grep.cjs` count-mode `total_matches` accurate (was hardcoded 0).
- `grep.cjs` default-exclude `node_modules / .git / dist / build / .next / target / .venv / __pycache__ / .cache / coverage / .nyc_output / .turbo / .parcel-cache / .svelte-kit` (opt-in via `include_noise=true`).
- `validate-descriptor.cjs` strict `AsyncFunction.constructor.name` check (was tautology accepting any function).
- `validate-descriptor.cjs` `$ref` walker (was `JSON.stringify().includes('"$ref"')` — false-positive on enum values).
- `validate-descriptor.cjs` filename-match enforced via `index.cjs` `FILENAME_BY_TOOL` map at load-time.
- `toMcpServer.cjs` proto-pollution defense: reject `__proto__` / `constructor` / `prototype` keys recursively in `validateArgs`; `Object.create(null)` for tool lookup.
- `toMcpServer.cjs` buffer cap (`MCP_MAX_LINE_BYTES=10MiB`) → JSON-RPC `-32700` parse error response on overflow.
- `toMcpServer.cjs` parse-error response (was stderr-only, leaving client hanging).
- `toMcpServer.cjs` notifications (no `id`) get NO response per JSON-RPC spec.
- `toMcpServer.cjs` `additionalProperties: false` enforced even when `properties` is empty.
- New tests: 153 (validator + 6 tool handlers + 4 adapters + annotation routing + path-safety + Tier 5 catalog hash regression).
- New SKILL.md template: `templates/skills/example-using-cortex-tools.md`.

**Out-of-v0-scope findings (deferred to Sprint 2.9.5+ or operator-acknowledged)**:
- Full Pattern 2 architectural split (reader-only + writer-only MCP servers) — Sprint 4.0 marketplace concern.
- Pattern 5 HITL gate on raw MCP for destructive tools — Sprint 2.9.5 (when MCP server exposed beyond Steward internal use).
- Pattern 1 `<untrusted>` markers around tool output — Sprint 2.9.5.
- Property-based tests (fast-check on globToRegex + annotation 16-perm sweep + edit invariants) — Sprint 2.3 + 2.9.5 territory.
- Stryker mutation testing config — Sprint 2.3 territory.
- Vercel AI SDK adapter actual TS implementation with Zod re-wrap — Sprint 2.9.5.
- WebFetch + WebSearch tools with `openWorldHint` cost-window integration — Sprint 2.9.5.
- Annotation-routing → action-engine integration — Sprint 2.9.5 (currently dead code from Steward POV; routing helpers + tests verify contract holds).
- Lethal-trifecta architectural verdict (reader + writer + bash in one session) — accepted as v0 limit; Steward upstream gates (acceptance criteria + spec-verifier + halt-check + cost-windows) compensate for internal use.

**Why now**: operator-instinct dispatch 2026-05-09 confirmed that Claude Code's curated tool palette (Read / Write / Edit / Glob / Grep / Bash + ~18 others) is the right set of names to borrow, BUT the right *spec format* is **MCP** (Model Context Protocol — donated to Linux Foundation Dec 2025, governed by Anthropic + OpenAI + Google + MSFT + AWS, embedded in Claude Agent SDK as the lingua franca). Sprint 2.9 ships a neutral tool-descriptor spec (MCP-shaped JSON Schema + annotation taxonomy) + 6 reference tools + 4 runtime adapters. **Strategic moat**: tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) integrate **for free** with Steward's existing safety mechanics — Sprint 1.9.0 spec-verifier, halt-check, journal write-trailers, cost-windows. No other framework's tool catalog wires into a verifier-driven autonomous runtime.

**Strategic impact**: this is the **interoperability pivot** of Tier 1 → Tier 2. After 2.9, every cortex-x skill ships with a portable tool descriptor that runs unchanged in Steward (CJS), Claude Agent SDK, Vercel AI SDK projects, OpenAI Agents SDK, and any MCP client (Cursor, Codex, Aider, Windsurf). Combined with SKILL.md (already supported by 12 runtimes), cortex-x becomes the only framework where the *same tool* can power both a Claude Code session and an autonomous Steward run with **zero code changes** — and the same descriptor automatically gates destructive ops through the spec-verifier.

**Scope**:
- New module tree `bin/cortex/tools/` — descriptor spec + 6 reference tools + validator + 4 adapters.
- `bin/cortex/tools/_spec.md` — human-readable descriptor spec (JSON Schema + annotation taxonomy + naming regex `^[a-z0-9_-]{1,32}$`).
- `bin/cortex/tools/_lib/validate-descriptor.cjs` — runtime validator with cross-checks (e.g. `readOnlyHint=true` rejected if handler invokes `assertEditWithinCwd`).
- 6 reference tools as CJS: `read`, `write`, `edit`, `glob`, `grep`, `bash` — borrowed taxonomy from Claude Code, expressed in MCP-shaped descriptors.
- `_adapters/toMcpServer.cjs` (primary, stdio JSON-RPC) + `toClaudeAgentSdk.cjs` + `toVercelAiSdk.cjs` (TS) + `toOpenAiAgents.cjs`.
- Steward `action-engine.cjs` consumes descriptors and routes through annotations:
  - `destructiveHint=true` → mandatory `acceptance_criteria[]` (Sprint 1.9.0).
  - `readOnlyHint=true` → skip halt-check pre-condition + skip journal write-trailer.
  - `idempotentHint=true` → safe-to-retry hint for cost-safety.
  - `openWorldHint=true` (network) → daily/weekly/monthly windows from Sprint 1.9.1 apply.
- Sample SKILL.md in `templates/skills/example.md` references the new palette.
- Tier 4 contract test — descriptor roundtrips losslessly through all 4 adapters.
- Tier 5 prompt-regression test — stable hash of tool catalog detects drift.
- Defense-in-depth: `bash.cjs` reuses Sprint 2.7 path-traversal hardening + Sprint 2.4 `containsShellMetacharacters` + `_FORBIDDEN_FLAGS`; `read`/`write` reuse `assertEditWithinCwd`.

**Out of scope (Sprint 2.9.5 / 3.x)**:
- `webfetch` / `websearch` tools — need `openWorldHint` cost wiring + `STEWARD_DAILY_USD_CAP` integration (Sprint 2.9.5).
- Tool marketplace / registry (Sprint 4.0).
- `NotebookEdit` / `Task` / `TodoWrite` / `Plan` tools — don't fit autonomous Steward runtime.
- Standalone MCP server binary (Sprint 4.0 marketplace concern).

**New error codes**:
- `TOOL_DESCRIPTOR_MALFORMED` — validator rejected at load time.
- `TOOL_ANNOTATION_INCONSISTENT` — `readOnlyHint=true` declared but handler signature implies destructive op.
- `TOOL_HANDLER_MISSING` — descriptor without `handler` export.
- `TOOL_ADAPTER_ROUNDTRIP_DIVERGENCE` — descriptor lost data through adapter (contract-test only).

**Acceptance criteria (10)** — see [`docs/research/sprint-2.9-tools-foundation-2026-05-09.md`](research/sprint-2.9-tools-foundation-2026-05-09.md) §4.

**Pre-implementation research dispatch (R1)** — ✅ DONE 2026-05-09. Memo: [`docs/research/sprint-2.9-tools-foundation-2026-05-09.md`](research/sprint-2.9-tools-foundation-2026-05-09.md). 14 sources cited; recommendation = Option (b) neutral spec + adapters with MCP as the spec format.

**Open questions for operator** (R1 §8):
1. Tool naming: lowercase per MCP regex (`read` / `write` / `edit`) or capitalized like Claude Code (`Read` / `Write` / `Edit`)? Memo recommends lowercase + document the mapping.
2. Ship `bash` from day 1 or punt to 2.9.5? Memo recommends ship with hardened policy-check.
3. CJS + TS adapters together or CJS-first? Memo recommends CJS-first.
4. MCP transport: stdio only or stdio + SSE? Memo recommends stdio-only for v0.

**Stolen from**: Claude Code tool catalog (taxonomy) + MCP spec (descriptor format + annotations) + Claude Agent SDK `createSdkMcpServer` (proof MCP is lingua franca at Anthropic) + Vercel AI SDK v6 `tool()` (TS surface) + OpenAI Agents SDK `FunctionTool` (strict_json_schema discipline) + agentskills.io / SKILL.md (distribution format) + cortex-x Sprint 1.9.0 spec-verifier (integration anchor).

---

### Sprint 2.5b — `workflow_hardener` action_kind (S effort) ✅ SHIPPED 2026-05-10 (commit `213ea72`)

**Status**: 📋 Proposed 2026-05-10 from housekeeping audit synthesis. R1 memo: [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](research/cortex-x-housekeeping-audit-2026-05-10.md) §3 + [`sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md`](research/sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md). Awaiting operator approval.

**Why**: GitHub's [Aug 2025 policy](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/) enforces SHA pinning; the [2026 roadmap](https://github.com/orgs/community/discussions/190621) adds workflow lockfiles. cortex-x's `dep_update_patch` covers version drift, but not workflow security hardening (missing `permissions:`/`concurrency:`/`timeout-minutes:` blocks, branch-protection drift). Direct precedent = [StepSecurity Secure-Repo](https://github.com/step-security/secure-repo); Renovate-Mend explicitly does NOT cover this niche. Pre-public-launch ship gate.

**Scope (deterministic, zero LLM cost)**:
- Replace `uses: actions/checkout@v4` with `uses: actions/checkout@<sha> # v4` via `gh api repos/:o/:r/git/refs/tags/<v>` resolution.
- Inject missing `permissions: { contents: read }` at workflow root if absent.
- Inject missing `concurrency:` and `timeout-minutes:` defaults.
- Audit `gh api repos/:o/:r/branches/main/protection` against committed SSOT `.github/branch-protection.json`; diff = file gh issue.
- PR-only output for workflow file edits; gh-issue for branch-protection drift.

**Cadence**: weekly cron `0 03 * * 0` (Sunday 03:00 UTC, before existing dep-patch 04:00).

**Acceptance criteria**:
- [ ] All workflow `uses:` references SHA-pinned with version comment after Sprint 2.5b first run.
- [ ] All workflows have `permissions:`, `concurrency:`, `timeout-minutes:`.
- [ ] Branch-protection drift detected when SSOT file diverges from live config.
- [ ] Touched files restricted to `.github/workflows/*.yml` + `.github/branch-protection.json` (acceptance criterion).
- [ ] Zero LLM cost recorded in journal.
- [ ] ≥ 12 new tests + 1 fixture-based integration test.

**New error codes**:
- `WORKFLOW_GH_API_FAILED` (SHA resolution failed; fail-open, log warning)
- `BRANCH_PROTECTION_DRIFT` (advisory, not blocking)

**Stolen from**: StepSecurity Secure-Repo logic, but in zero-dep CJS.

**Out of scope**: SBOM generation (no shipped artifact), license compliance (Dependabot covers), CODEOWNERS sync (single-maintainer repo).

---

### Sprint 2.6b — `secret_history_sweep` action_kind (S effort) ✅ SHIPPED 2026-05-10 (commit `213ea72`)

**Status**: 📋 Proposed 2026-05-10 from housekeeping audit synthesis. R1 memo: [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](research/cortex-x-housekeeping-audit-2026-05-10.md) §3. Awaiting operator approval.

**Why**: Pre-public-flip MUST. cortex-x has `no-pii.yml` (regex-only at HEAD) + `policy-check.cjs` `NO_SECRET_READ` (Sprint pre-2.0). Neither covers **rotated-but-leaked keys, encoded blobs, deep history**. [TruffleHog](https://github.com/trufflesecurity/trufflehog) full-history with `--only-verified` covers 800+ secret types and verifies them as currently-active. The moment cortex-x flips public, any verified credential in history is exposed; this sweep catches it the week before.

**Scope (deterministic, zero LLM cost)**:
- `trufflehog git file://. --only-verified --json --since-commit=<last-sweep-sha>`
- On verified hit: open `gh issue` with severity LABEL.
- **NO auto-PR** — secret revocation requires human (rotate key, then commit-history rewrite is destructive + governed by R5 human-only).
- Update journal with last-swept-sha.

**Cadence**: weekly cron `0 02 * * 0` (Sunday 02:00 UTC, before workflow_hardener 03:00).

**Acceptance criteria**:
- [ ] First sweep produces `journal/secret-sweep-<date>.jsonl` with `last_swept_sha` baseline.
- [ ] Subsequent sweeps run incrementally `--since-commit=<last_swept_sha>`.
- [ ] Verified hit opens gh issue; non-verified hit logged but not surfaced.
- [ ] Read-only against working tree; only writes are journal entries + `gh issue create`.
- [ ] Zero LLM cost recorded in journal.
- [ ] Fail-open: missing `trufflehog` installer → kind skipped with single warn line.
- [ ] ≥ 10 new tests + 1 fixture-based integration test (synthetic dirty-history repo).

**New error codes**:
- `TRUFFLEHOG_NOT_FOUND` (PATH lookup miss; fail-open)
- `SECRET_HISTORY_HIT` (advisory, not blocking — issue is the surface)

**Stolen from**: TruffleHog Apache-2.0 CLI direct integration; weekly-verified-history pattern from [appsecsanta.com gitleaks-vs-trufflehog](https://appsecsanta.com/sast-tools/gitleaks-vs-trufflehog).

**Out of scope**: pre-commit hooks (Steward doesn't enforce dev config), SaaS GitGuardian / TruffleHog Enterprise (Apache-2.0 OSS CLI is sufficient).

---

### Sprint 2.5c — `tech_debt_audit` test_count delta extension (XS effort) — ✅ SHIPPED

**Status**: ✅ Shipped (verified 2026-05-12). `test_count` field threaded through `fallbackTestSourceRatio()` in `bin/steward/_lib/tech-debt-audit.cjs:277-322`; added to `metrics` envelope; `DEFAULT_TRIGGERS` in `bin/steward/_lib/snapshot-diff.cjs:120` includes `{ metric: 'test_count', kind: 'pct_drop', threshold: 5 }`. Test coverage in `tests/unit/steward/tech-debt-audit.test.cjs:106-138`. No new infra; folds into existing nightly cron via `tech_debt_audit` action_kind.

**Scope**: Add `test_count` field to `cortex/debt-snapshot.json`; alarm if month-over-month delta < -5 %. No new action_kind; folds into existing nightly cron.

**Why**: Catches regression where tests get deleted or skipped en-masse without operator awareness. Zero new infra; ~10 LoC.

---

### Sprint 2.11 — `senior_tester_review` action_kind (M effort, ⭐ DIFFERENTIATOR) ✅ SHIPPED 2026-05-10 (commit `e3829a3`)

**Status**: 📋 Proposed 2026-05-10 from housekeeping audit synthesis. R1 memo: [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](research/cortex-x-housekeeping-audit-2026-05-10.md) §2 + [`sprint-2.11-senior-tester-research-2026-05-10.md`](research/sprint-2.11-senior-tester-research-2026-05-10.md). Awaiting operator approval.

**Why**: **Open niche, real research lane (2024Q4-2025Q4)**. UTRefactor (FSE'25, [arxiv:2409.16739](https://arxiv.org/abs/2409.16739)) — 89% smell reduction. Agentic-LMs (IEEE Software, [arxiv:2504.07277](https://arxiv.org/abs/2504.07277)) — Phi-4-14B pass@5 75.3% within 5% of frontier. ESE 2025 ([DOI 10.1007/s10664-025-10718-x](https://link.springer.com/article/10.1007/s10664-025-10718-x)) — 13 new test smells in 4 categories, explicit tsDetect extension for AI-generated tests. **No SaaS or GitHub App ships cron-driven "audit existing tests" mode** — Diffblue Cover (Test Review/Test Asset Insights) generates new tests rather than auditing existing quality. Mabl/Functionize/TestSprite/Applitools/Virtuoso all sit in authoring lane. cortex-x positioning: "AI-augmented tester, not replacement" (already in Sprint 2.10 framing) — this kind makes that real on a cron.

**Distinct from existing kinds** (no overlap):
- ≠ `flaky_test_repair` (runtime symptom, not static smell)
- ≠ `test_coverage_gap` (coverage delta, not quality at fixed coverage)
- ≠ `mutation_score_drift` (oracle strength via mutation, not broader suite-quality)
- ≠ `tech_debt_audit` (non-test code-quality)
- ≠ Sprint 2.10 `/test-audit` (one-shot retrofit lens; this is monthly cron with different deliverables)

**Architecture**: 2-stage hybrid (deterministic detector + LLM judge).

```
PHASE A — DETECT (deterministic, $0)
  ├─ tsDetect / JNose                     (Java)
  ├─ PyNose                               (Python)
  ├─ cortex-x-owned JS/TS pattern grep    (Tier-1 audience)
  └─ Layer-balance: count tests per layer; flag pyramid skew (target 70/20/10 unit/integration/e2e)

PHASE B — JUDGE (LLM, single call)
  ├─ Input: ranked smell list (top 20) + 3-5 redacted test files +
  │         project profile + ISO 25010 + Bach HTSM lens
  ├─ Output (JSON-mode): {findings[], layer_balance_assessment,
  │                       top_3_strategic_gaps, est_npm_test_pass_after_fixes}
  └─ Default model: deepseek-v4-flash (~$0.005/run); escalate to
       claude-sonnet for ≥10 findings (per Sprint 2.0b routing)

PHASE C — DELIVER (deterministic)
  ├─ Write journal/senior-tester-YYYY-MM.md
  ├─ Open ONE GitHub issue with checklist (don't fragment into 20)
  ├─ Emit OTLP trace span (Sprint 2.0)
  └─ DO NOT auto-refactor in v1 — refactor = separate v1.5, gated on
     mutation_score_drift baseline + delta ≥ 0
```

**Cadence**: monthly cron `0 04 1 * *` (1st of month, 04:00 UTC). Auto-trigger when `tech_debt_audit` flags test-folder hotspot.

**Cost ceiling (R4)**: ~$0.25/month at full cadence × 5 active projects. Well under Sprint 1.9.1 caps.

**Acceptance criteria**:
- [ ] Phase A deterministic detection runs zero-cost on Java + Python + JS/TS.
- [ ] Phase B LLM judge produces structured JSON with findings + layer-balance + strategic gaps.
- [ ] One gh issue opened per run with checklist (not N issues).
- [ ] OTLP span emitted to Phoenix.
- [ ] DO NOT auto-edit source/test files (acceptance criterion: `touchedFiles.every((p) => p.startsWith("journal/"))`)
- [ ] ≥ 18 new tests + 1 fixture-based integration test (5 fixture repos with known-bad test suites).

**Pre-ship gates**:
1. Encode tsDetect 21 + ESE'25 13 = **34-smell registry** as cortex-x SSOT JSON.
2. Wire JS/TS pattern detectors first; Java/Python next.
3. Eval suite entry: 5 fixture repos with expected findings.
4. R2 review pipeline (acceptance + correctness + security + ssot + edge-case).
5. Document in `docs/steward-runtime.md` § action_kinds.

**Open question for operator**: v1 = **review-only** OR review + propose-PR-with-refactor? Recommendation: **review-only v1**, refactor in v1.5 gated on mutation_score baseline existing AND delta ≥ 0 post-refactor. Rationale: [arxiv:2506.07594](https://arxiv.org/abs/2506.07594) shows LLM refactors *introduce new smells* in non-trivial fraction of cases; R5 (human-only paths inviolate) reinforces.

**Stolen from**: UTRefactor DSL refactor rules + Agentic-LMs multi-agent loop pattern + tsDetect 21-smell taxonomy + ESE 2025 13-smell extension + cortex-x Sprint 2.10 qa-engineer profile + qa-retrofit prompt (different cadence, same grounding sources).

---

### Sprint 2.15 — cortex-capabilities auto-generated registry ✅ SHIPPED 2026-05-11

**Status**: ✅ Shipped 2026-05-11 (commit `59a91a8`; R2 hardening Sprint 2.15.1 follow-up). Operator-facing answer to *"I do not even know what we have anymore."* `bin/cortex-capabilities.cjs` walks the repo filesystem and produces SSOT `cortex/capabilities.md` + `cortex/capabilities.json` listing every action_kind, Steward primitive, universal hook, standard, profile, prompt, review-pipeline agent, GitHub workflow, and test count. Current counts live in the auto-generated [`cortex/capabilities.md`](../cortex/capabilities.md) TL;DR — referencing them here would drift the moment a category gains an entry. Header comments are SSOT — each module owns its description; script aggregates. Zero-deps, fail-open, side-effect-free without `--write`. npm script `npm run capabilities`. Contract tests cover shape, idempotency, markdown validity.

**Future**: Sprint 3.X may inject capability summary into Steward system prompt so the autonomous runtime knows its own toolset (currently the registry is operator-facing only).

---

### Sprint 2.18 — `read_set` acceptance-criterion kind (read-coverage proof) — ✅ SHIPPED 2026-05-12

**Status**: ✅ Shipped 2026-05-12. R1 → R2 → review pipeline → R2 hardening all same day. 6-agent parallel review (acceptance + blind + correctness + security + ssot + edge-case) found 1 HIGH symlink termination, 1 HIGH expected_glob path-traversal, 1 HIGH padding bypass via expected_count, 1 HIGH mergeCriteria override weakening, 4 MED (NFC normalize, excludes merge-vs-replace, rootMissing → SPEC_MALFORMED, min_coverage=0 contradiction) — all fixed pre-commit. 2270 → 2338 tests (+68 read_set + R2 regression). R1 memo: [`docs/research/sprint-2.18-read-coverage-proof-research-2026-05-12.md`](research/sprint-2.18-read-coverage-proof-research-2026-05-12.md). Operator-flagged after a 2026-05-12 Facebook incident discussion: agent for API doc generation read 64/278 methods and confabulated the remaining 214. Class of failure invisible to every current Steward gate because the edit-side artifact is internally consistent — it's just wrong about coverage of the input set.

**Why this is one criterion-kind, not a new architectural layer**:
- Current spec-verifier (Sprint 1.9) gates the **edit side** via 5 criterion kinds (shell, file_predicate, regex, ears_text, llm_judge). Sprint 2.18 adds a **6th kind: `read_set`** — folds into the existing dispatcher, no new top-level subsystem.
- Claude Agent SDK already exposes `PostToolUse` hook with `tool_input.file_path` for every Read invocation ([code.claude.com/docs/en/agent-sdk/hooks](https://code.claude.com/docs/en/agent-sdk/hooks)) — the host harness can build an authoritative read manifest the agent **cannot lie about** because the SDK boundary captures every Read call independently of agent self-report. cortex-x just needs to log + verify the manifest.
- GitNexus has already proven the architectural pattern at the indexed-codebase level ([github.com/abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)) — `gitnexus status` + PostToolUse stale-index hook is structurally identical to "declared-scope coverage check."

**Scope** (~150 LoC verifier + ~80 LoC hook + 1 error code + ~12 tests, half-day to one day):
- `kind: read_set` criterion handler in `bin/steward/_lib/spec-verifier.cjs` — declarative fields:
  - `expected_glob: '<glob>'` — file set the action claims to fully cover
  - `expected_count: <N>` (optional) — pinned method/file/entity count from plan
  - `min_coverage: 1.0` — fraction of `expected_glob` that must appear in read manifest (default = 1.0)
- PostToolUse hook handler `shared/hooks/post-tool-use-read-manifest.cjs` — writes JSONL entry per Read invocation to `$CORTEX_DATA_HOME/journal/read-manifest-<action_key>.jsonl`. Hook is event-driven, no polling, no overhead when not gating.
- New error code: `SPEC_READ_SET_INCOMPLETE` — fires when manifest count < expected_count OR manifest set ∩ expected_glob enumeration < min_coverage.
- Plan-side schema extension: `acceptance_criteria` array can include `{ kind: 'read_set', expected_glob, min_coverage, expected_count? }`.

**Action_kinds that benefit immediately** (3 candidates already in current registry):
- `pattern_transfer` — reads sibling repos read-only. Without read_set, agent can claim "I read all 5 allowlisted siblings" while having only read 2. Sprint 2.7 ✅ shipped + Sprint 2.18 closes the read-coverage gap.
- `release_notes_drafter` — reads merged PRs since last tag. Read_set ensures the draft notes actually cover the full PR range.
- `senior_tester_review` (Sprint 2.11 📋 in flight) — reads test files + source. Sprint 2.18 is the natural co-ship gate ("the senior tester actually read what it claims to have read").

**R1 grounding**:
- No 2026 framework ships a first-class read-coverage primitive — confirmed against Letta, AutoGen, LangGraph, CrewAI, OpenAI Agents SDK, Cursor, Devin, Replit Agent in the R1 memo. Terminology hasn't crystallized ("completion proof", "coverage attestation", "read-set verification" return no canonical hits).
- CloudAPIBench ([arxiv.org/abs/2407.09726](https://arxiv.org/abs/2407.09726)) quantifies the doc-generation hallucination class — not a one-off anecdote.
- "Execution Hallucination" taxonomy ([arxiv.org/html/2509.18970v1](https://arxiv.org/html/2509.18970v1)) scopes only tool-invocation claims, not read-side claims — leaving cortex-x to ship a **named differentiator**, not a me-too.
- TheAgentCompany checkpoint pattern ([arxiv.org/html/2412.14161v2](https://arxiv.org/html/2412.14161v2)) — programmatic evaluators baked into task definition, structurally similar to acceptance_criteria. Best frontier model autonomous completion = 30.3%, meaning the agent-claimed vs agent-achieved gap **is** the dominant signal in production.

**Acceptance criteria for the sprint itself** (recursive defense — read_set criterion gates the sprint's own ship):
- [ ] `spec-verifier.cjs` handles `kind: read_set` for all 3 candidate action_kinds without breaking existing tests
- [ ] PostToolUse hook writes manifest JSONL per Read invocation; survives concurrent action runs (mutex via Sprint 2.7 lock primitive)
- [ ] `SPEC_READ_SET_INCOMPLETE` error fires when agent claim > manifest reality
- [ ] Property test: random `expected_glob` × random partial-read manifest → verifier correctly detects under-coverage
- [ ] Manual dogfood: `pattern_transfer` action with read_set criterion catches simulated 60% partial-read

**Anti-scope** (deliberately excluded — narrow scope per R1 recommendation):
- ❌ No new top-level capability layer. Folds into existing Sprint 1.9 verifier dispatcher.
- ❌ No retroactive read-set criteria on existing 16 action_kinds — opt-in per kind, ship 3 candidates only.
- ❌ No edit-side coverage proof — Sprint 2.2.5 `expectedSha256` on str_replace/insert already covers that.
- ❌ No OTel export of manifest in v0 — Sprint 2.0 Phoenix path can consume it later if needed.

**Stolen from**: GitNexus PostToolUse hook architecture + Claude Agent SDK hooks-as-audit-boundary + TheAgentCompany checkpoint pattern + CloudAPIBench failure-class quantification.

**Co-ship candidate**: when Sprint 2.11 `senior_tester_review` lands, add `read_set` criterion to its acceptance_criteria as the first real production usage. Read-heavy reviewer is the perfect first beneficiary.

---

### Sprint 2.17 — `/cortex-help` skill (one-screen capability menu) ✅ SHIPPED 2026-05-11

**Status**: ✅ Shipped 2026-05-11. `shared/skills/cortex-help/SKILL.md` — auto-discovered after `install.{sh,ps1}` sync, invokable as `/cortex-help` or via natural language ("co umíš?", "what can cortex do?"). Lightweight user-facing menu of invokable slash commands, complementing the machine-readable `cortex/capabilities.md` registry from Sprint 2.15. **Namespaced as `/cortex-help` because `/help` is a Claude Code built-in slash command** — initial Sprint 2.17 shipped as `/help` and collided with the built-in (Claude Code rejected loading the custom skill); same-day fix renames to `/cortex-help` matching the existing `cortex-*` prefix convention (`cortex-init`, `cortex-doctor`, `cortex-reflect`, `cortex-sync`).

**Why**: the capability registry (Sprint 2.15) answers *"what IS in cortex-x?"* exhaustively. But after install, a new user doesn't want a wall of categories — they want a 60-second answer to *"what can I type next?"* The `/cortex-help` skill is that menu: 10 invokable slash commands, one line each, plus a project-state-aware "default next" nudge (`.cortex-bootstrap-pending` → resume; `cortex/AUDIT.md` → `/retrofit`; empty folder → `/cortex-init`).

**Composition**:
- Reads existing capability metadata via the published `cortex/capabilities.md` link; never duplicates the registry. Counts stay SSOT in the auto-generated file.
- 5 quick filesystem peeks for project-state detection — fail-open if any fail.
- Czech / English language-aware (reads prior-turn signal, defaults to English).
- Print → nudge → stop. No auto-invocation.

**Scope**: SKILL.md only (~120 LoC markdown). Zero runtime code added.

---

### Sprint 2.16 — `/designer` skill (Claude Design-style flow inside Claude Code) ✅ SHIPPED 2026-05-11

**Status**: ✅ Shipped 2026-05-11. `shared/skills/designer/SKILL.md` — auto-discovered after `install.{sh,ps1}` sync, invokable as `/designer` or via natural language ("navrhni mi landing page"). Reproduces the public Claude Design recipe: intake questioning flow + library-palette decision (shadcn / Aceternity / Hero UI + GSAP / Lenis / Framer Motion) + parallel worktree exploration (3-4 variations, operator picks winner, rest discarded) + iteration loop + handoff to `cortex/STYLE.md`.

**Why**: Claude Design is Claude Code + a skill + Opus 4.7's vision upgrade (1.15 → 3.75 MP). The weekly limit and design-to-code handoff are the actual user-facing pains in the standalone product. Inside Claude Code we have:
- Real code output (not a throwaway prototype)
- Git-integrated iteration (revert, branch, worktree)
- No design-budget cliff (same Max sub, same effort budget as everything else)
- Parallel subagent worktrees for variation exploration — feature Claude Design doesn't have

**Scope**: SKILL.md only (~280 LoC markdown). Zero runtime code added. Composes with existing `senior_tester_review` (a11y / motion-overuse review) and roadmapped Sprint 4.6 (Playwright-MCP UI verification).

**Source-recipe analysis**: [docs/transcripts/Claude Design Is Actually A Trap.txt](./transcripts/Claude%20Design%20Is%20Actually%20A%20Trap.txt) public Claude Design post-mortem.

**Future**: when Sprint 4.6 (Playwright-MCP) lands, designer flow auto-runs visual-regression check on the chosen variation before merge.

---

### Sprint 3.4 — External tool capability adapters (M effort, ⭐ ECOSYSTEM) — 📋 PROPOSED 2026-05-11 · R1 ✅ DONE

**Status**: 📋 Proposed 2026-05-11. R1 research dispatch completed same day — [`docs/research/sprint-3.4-external-adapters-research-2026-05-11.md`](research/sprint-3.4-external-adapters-research-2026-05-11.md). Formalizes the architectural shape for "cortex-x knows how to drive external repos" — Hyperframes (HTML → video, agent-native), Remotion (React programmatic video, licensed), Lottie generators, Figma plugins, Playwright codegen, etc. Gated on Sprint 2.8 Memory Foundation (so adapter usage records into lessons.jsonl) and complementary to Sprint 3.1 (self-extending capabilities — adapters are first-class skill targets).

**Why this is one sprint, not 50 per-tool skills**:
- The HARD part is the **invocation contract** (sandboxing, output discovery, error normalization, cost attribution, license/secret scoping) — not the specific tool wrapper.
- Per-tool skills are Sprint 4.0 (capability marketplace) — that's the distribution layer once the adapter pattern is proven.
- R1 confirmed CLI-based agent adapters are **10-32× cheaper on tokens than MCP** for identical tasks ([Firecrawl 2026 CLI roundup](https://www.firecrawl.dev/blog/best-cli-tools)) — pattern direction is validated by external data before we ship.
- Named precedent to cite: `claude-agent-acp` (Zed Industries) wraps Claude Code CLI as ACP provider. Microsoft Agent Framework v1.0 (2026-04-02) bakes "clone repo + prepare deps + invoke CLI" into its contract ([microsoft/agent-framework](https://github.com/microsoft/agent-framework)).

**Scope**:
- New SKILL.md schema extension: `external_dependency:` block declaring repo URL, install command, version constraint, **license tier** (`oss-permissive` / `license_required` / `seat_metered` / `per_invocation_metered`), secret requirements.
- New helper `bin/steward/_lib/external-adapter.cjs` — clones/symlinks external repo into `~/.cortex/external/<slug>/`, runs install, exposes invocation handle.
- **Sandbox**: Docker-per-action-kind for first slice (matches existing `bin/steward/execute.cjs` mutex model, no new auth surface). E2B upgrade path reserved for Sprint 4.0 marketplace (multi-tenant) — see [Letta E2B usage](https://docs.letta.com/quickstart/docker), [Docker AI sandboxes](https://docs.docker.com/ai/sandboxes/).
- Cost attribution: external-tool invocations bill against the adapter's own `cost_envelope` field + license tier; rolls up via existing journal. `license_required` adapters refuse to run when `STEWARD_LICENSE_AUTHORIZED=<adapter-slug>` env unset (R4 budget gate).
- **First adapter (proof-of-concept): Hyperframes** — [github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), 17.2k★, Apache-2.0, v0.5.7 (2026-05-10), tagline literally "Built for agents." Already ships agentskills.io-aligned skill bundle (`npx skills add heygen-com/hyperframes` registers `/hyperframes`, `/hyperframes-cli`, `/website-to-hyperframes`, etc.) consumable by Claude Code / Cursor / Codex out of the box. No per-render fees, no seat caps, deterministic ("same input = identical output"). Node ≥ 22 + FFmpeg + Puppeteer-driven Chrome headless. Adapter is **thinner than expected** — we wire into capability registry + action_kind dispatcher, not invent a translation layer.
- **Second adapter: Remotion** — forces design of license/cost-meter axis. NOT permissive OSS: Automators tier $0.01/render with **$100/mo floor** ([Remotion license](https://www.remotion.dev/docs/license), [pricing](https://www.remotion.pro/license)). Real R4 budget item. Programmatic surface: `getCompositions() → selectComposition() → renderMedia()`. Docker image 1.2-1.8 GB. **Windows-shell `--props` quirk**: inline JSON broken on Windows, must use file (operator dogfoods on Win11 — Steward Linux cron unaffected, but operator-invoked path must use file-mode).
- Failure mode: external tool absent → adapter records `EXTERNAL_TOOL_MISSING` + tells operator how to install, never silently degrades.

**Acceptance criteria for v0**:
- [ ] SKILL.md extension schema documented + linted by `bin/cortex-capabilities.cjs`
- [ ] Hyperframes adapter renders a 5-second test composition end-to-end (Linux CI + Win11 dogfood)
- [ ] Remotion adapter scaffold present but gated on `STEWARD_LICENSE_AUTHORIZED=remotion` env — proves the license-tier gate works without paying yet
- [ ] Docker sandbox: external-adapter actions run in container, never on host filesystem
- [ ] Existing 16 action_kinds unaffected (R6 backward-compat)
- [ ] Cost attribution validated — adapter invocations show in `cortex-steward status` journal with license_tier annotation

**Pre-ship verifications (from R1 § Unverified)**:
- [ ] Hyperframes maintenance signal stable through 2026-Q3 (commit cadence check before ship date)
- [ ] Hyperframes Windows-shell smoke test (operator dogfoods on Win11 — Puppeteer + FFmpeg path needs verification)
- [ ] agentskills.io spec stability re-check at ship time (skill-bundle advantage evaporates if spec drifts)

**Why this is "promote Sprint 3.1's substrate, don't pre-multiply"**: the operator's intuition that cortex-x should orchestrate Hyperframes / Remotion / project-X is correct — R1 confirms the pattern direction is winning over MCP by 10-32× cost margin. The trap is shipping 50 wrappers. The right unit is the ADAPTER PROTOCOL. Once that ships, the operator (and Steward via Sprint 3.1 self-extending) can author new adapters in a single SKILL.md without runtime changes.

---

### Sprint 3.5 — SaaS-unit positioning (app + web + media as one delivered artifact) — 📋 ROADMAP-ADD 2026-05-11

**Status**: 📋 Roadmap-add 2026-05-11. This is **positioning**, not a single feature — it composes Sprint 2.16 (designer) + Sprint 3.4 (external adapters) + existing `waas-template` profile + existing `pattern_transfer` action_kind into a single delivery flow.

**Why**: operator's 2026-05-11 brainstorm — "cortex-x by mohl být totální SaaS builder, kde z jednoho promptu vyleze app + web + animace na promo + designové variace." Each piece exists separately today. The positioning shift is **explicit composition** + a single entry point that orchestrates them.

**Competitive landscape (R1-grounded, [research memo §4](research/sprint-3.4-external-adapters-research-2026-05-11.md))**: nobody is shipping the **full** composite under one brand in 2026, but four adjacent quadrants exist —
- [Flatlogic](https://flatlogic.com/generator) and [Fuzen](https://www.fuzen.io/posts/ai-saas-website-builder) own "text → working SaaS app"
- [WeWeb](https://www.weweb.io/blog/best-saas-website-builder-tools) owns "best SaaS website builder, no-code"
- [Agent Opus / Opus.pro](https://www.opus.pro/agent/workflows/saas-product-video-maker) owns "URL → promo video"

**Nobody glues both halves under one operator-grade autonomous-agent shell.** That's the cortex-x white space — and Sprint 2.16 (designer) + 3.4 (Hyperframes adapter) + existing `waas-template` profile + `pattern_transfer` already cover all four quadrants individually. Sprint 3.5 = compose them under one entry point.

**Scope (composition, not new runtime)**:
- New prompt `prompts/saas-unit.md` — multi-phase flow: `/start` (app scaffold) → `/designer` (web hero + landing) → `external-adapter:remotion` (promo video) → optional `external-adapter:hyperframes` (avatar pitch) → `pattern_transfer` from previously-shipped the operator projects (a Next.js SaaS project patterns into new project).
- Updated `waas-template` profile — declares `composes_with: [designer, external-adapters, pattern_transfer]`.
- Positioning update in `README.md` + landing copy: cortex-x as "the agentic-first **SaaS-unit builder** — one entry point produces production-grade app, marketing site, design variations, and promo media, all as real shippable code."

**Why this isn't a feature sprint**: nothing here requires new runtime. Sprint 2.16 + 3.4 + existing `waas-template` + `pattern_transfer` already cover the substrate. This sprint **wires the pieces into one operator-facing flow** + updates positioning. Effort lives in writing + integration testing, not core engineering.

**Gated on**: Sprint 3.4 v0 (need at least 1 external adapter for the "media" leg) + Sprint 2.16 (need designer skill landed — ✅ done).

**Anti-scope** (out of this sprint, in case the temptation is to bundle):
- ❌ Phone control / Discord remote — Sprint 2.6 already shipped (Discord) and Sprint 4.3 covers voice (Telegram).
- ❌ Local LLM as primary engine — Sprint 5.0 (self-hosted Steward) covers this; orthogonal axis.
- ❌ Whole-PC manipulation — R5 (human-only paths inviolate) holds; cross-project READ is fine, cross-project WRITE stays scoped per action_kind policy.

---

### Sprint 2.8.1 — lessons.jsonl → MEMORY.md exporter (S effort) — ✅ SHIPPED 2026-05-13 (v0)

**v0 shipped 2026-05-13**:
- `bin/steward/_lib/lessons-exporter.cjs` (~180 LoC) — pure-deterministic exporter: scores lessons via memory-decay.cjs, groups by action_kind, writes top-K per kind to `lessons-<kind>.md` topic files in target memory dir, emits MEMORY.md index.
- `bin/cortex-export-lessons.cjs` — operator-facing CLI (`--slug`, `--memory-dir`, `--data-home`, `--top-k`, `--min-score`, `--json`, `--dry-run`).
- 9 tests (tests/unit/lessons-exporter.test.cjs).
- Default target: `~/.claude/projects/<slug>/memory/` — Claude Code's native auto-memory directory.
- Topic file frontmatter: `name`, `description`, `type: feedback`, `last_updated` — matches Claude Code auto-memory contract from CLAUDE.md scaffold.
- v0 design decisions (resolves 3 open questions from original proposal): (a) **per-topic files** (one per action_kind), not single MEMORY.md — better claude-cli auto-load scoping; (b) **decay-aware top-K**, default 10 per kind; (c) **uni-directional write** — claude-cli does not write back (per CLAUDE.md auto-memory spec).

**Original proposal (2026-05-11)**: 📋 Proposed 2026-05-11 as smaller-bite alternative to full Anthropic Memory Tool integration (Sprint 3.X).

**Status**: 📋 Proposed 2026-05-11 as smaller-bite alternative to full Anthropic Memory Tool integration (Sprint 3.X). Decision deferred from autonomous-ship to operator review because schema design needs review.

**Why**: Sprint 2.4 claude-cli engine doesn't expose Anthropic's native Memory Tool (`memory_20250818`) — that's API-only and would re-introduce API-key billing that Sprint 2.4 deliberately killed. ALE Claude Code has its own auto-memory pipeline at `~/.claude/projects/<project>/memory/`. cortex-x's `lessons.jsonl` (Sprint 1.8.3 ReasoningBank-lite) already captures durable failure-distilled lessons — exposing them as topic files under auto-memory's directory makes them visible to claude-cli sessions automatically.

**Scope**: ~80 LoC, zero API-key dependency. Periodically writes lessons.jsonl entries as topic files. Open design questions:
- Per-topic file (e.g. `lessons-recommendation.md`, `lessons-pattern_transfer.md`) vs single MEMORY.md?
- Decay-aware write — only top-K by importance score?
- Bidirectional sync — does claude-cli's auto-memory write back? (Probably not — but verify.)

**Defer reason**: operator may want to design the write-format before this lands; the auto-memory pipeline interaction needs investigation.

**R1 memo**: [`docs/research/anthropic-memory-tool-deferred-research-2026-05-11.md`](./research/anthropic-memory-tool-deferred-research-2026-05-11.md) (covers full Anthropic Memory Tool research + why this smaller bite is the right shape).

---

### Sprint 3.X — Anthropic-native context plane (Memory Tool + context-editing) — 📋 ROADMAP 2026-05-11

**Status**: 📋 Roadmap-add 2026-05-11. Deferred from autonomous-ship after R1 research dispatch identified three blockers. Gated on Sprint 2.8 Memory Foundation schema work.

**Why deferred** (3 blockers from [`docs/research/anthropic-memory-tool-deferred-research-2026-05-11.md`](./research/anthropic-memory-tool-deferred-research-2026-05-11.md)):
1. **claude-cli engine collision** — Memory Tool requires direct `/v1/messages` HTTP with `betas: ["context-management-2025-06-27"]`. claude-cli bills against Max subscription via OAuth — using Memory Tool would re-introduce API-key cost line, reversing Sprint 2.4's cost pivot.
2. **Sprint 2.8 Memory Foundation schema gate** — adding Anthropic Memory Tool before deciding durable schema risks design drift.
3. **Value/ceremony ratio** — the 84% token / +39% perf wins come from Memory Tool + `clear_tool_uses_20250919` context-editing **combined**, not Memory Tool alone. Doing both at once (Sprint 3.X) gets full upside.

**Scope when prioritized**: `bin/steward/_lib/memory-tool.cjs` (~180 LoC, 6-command dispatcher, path-traversal hardened) + `bin/steward/_lib/memory-store-fs.cjs` (~120 LoC) + engine seam in OpenRouter engine (~80 LoC) + context-editing pairing (~40 LoC). Total ~420 LoC, ~19 tests, 1-2 working days. Memory Tool becomes "ephemeral within-action working memory" while `lessons.jsonl` remains "durable cross-action long-term memory." Coexistence pattern documented in research memo.

**Engine constraint**: Memory Tool enabled ONLY on OpenRouter / Anthropic-API engines, NEVER on claude-cli engine (would re-introduce API billing). Test enforces this.

---

### Sprint 2.19 — Phase 5 cortex-evolve cron wiring + "Dreaming" terminology alignment (S-M effort) — 📋 PROPOSED 2026-05-13

**Status**: 📋 Proposed 2026-05-13 from brain-kit research synthesis ([`docs/research/brain-kit-landscape-2026-05-13.md`](./research/brain-kit-landscape-2026-05-13.md)). Pull-forward from "Phase 5 self-improvement loop ⏳ designed, awaits Phase 7" — industry has shipped the same primitive (OpenClaw "Dreaming" cron, Anthropic "Auto Dream", ICLM 2026 "Language Models Need Sleep", arXiv SCM Sleep-Consolidated Memory), cortex-x is now behind on what was a designed-but-runtime-dormant capability.

**Scope**:
- 4 new GitHub Actions workflows wrapping existing prompts: `cortex-evolve-daily.yml` (ingest), `-weekly.yml` (mining), `-monthly.yml` (eval), `-quarterly.yml` (audit). Reuse Steward cron + skip-commit pattern shipped today (bash-e tolerance + JSON-validity gate).
- Terminology alignment: rename evolve-cycle outputs to "dream-cycle" / "consolidation" in user-facing docs (README, capabilities.md, prompts/cortex-evolve.md). Industry slovník is now `Auto Dream` (Anthropic), `Dreaming` (OpenClaw) — cortex-x sjednocuje, neimprovizuje terminology.
- Hard anti-hallucination gates (min_support=3, ≥2 projects, >7d spread, Bonferroni) already in `config/evolve.yaml` — wire them into the cron workflow as workflow-level gates.
- Outputs land in `$CORTEX_DATA_HOME/insights/proposals/` as PRs (already designed pattern), Steward never auto-merges.

**Effort**: S-M (1-2 days). Mostly workflow yaml + small dispatcher in `bin/cortex-evolve.cjs` + doc rewording. Real code already exists in `prompts/cortex-evolve.md` + `config/evolve.yaml`.

**Why now, not later**: Sprint LR.1 statistical disclaimer in README currently says "framework improves itself" is **designed but not yet measured**. Wiring the cron + capturing one weekly-mining cycle closes that disclaimer with empirical evidence. Also: closes the perception gap vs OpenClaw Dreaming / Anthropic Auto Dream which a reviewer comparing cortex-x will notice within 60 seconds.

**Stolen from**: OpenClaw Dreaming nightly cron, Anthropic Auto Dream natively-shipped primitive, ICLM 2026 NREM+REM consolidation model.

---

### Sprint 2.20 — Memory-system competitor lens in positioning.md (XS effort) — 📋 PROPOSED 2026-05-13

**Status**: 📋 Proposed 2026-05-13. `docs/positioning.md` compares vs Devin/Cursor/Replit/Aider (autonomous-coding lens). Brain-kit research surfaced a second relevant competitor axis (agent-memory category) where reviewers will ask "vs Mem0 / Zep / Letta / MAF+Neo4j / OpenClaw Dreaming". Currently we have no answer.

**Scope**:
- Second comparison matrix in `docs/positioning.md` (or new `docs/positioning-vs-memory-systems.md`) with rows for: persistent KV memory, structured KG / entity relationships, temporal graph (Zep/Graphiti), MCP-native, atomic-rollback safety, multi-window USD caps, draft-PR human approval, OSS license, typical operator cost.
- Verdict paragraph: cortex-x is *adjacent* to memory-SaaS category, not competing — Mem0 dominates with 47K★, Zep wins LongMemEval. cortex-x's lane is "maintenance autopilot WITH a memory layer," not "memory-SaaS for agents." Lean on safety primitives that no memory-SaaS ships.

**Effort**: XS (1-2 hours including R1 memo capture from today's brain-kit-landscape research). Pure docs work, no code.

**Why now**: closes a reviewer's first-90-seconds question post-launch. The brain-kit research is already in context — capture it as a reusable research memo + competitor matrix while the synthesis is fresh.

**Stolen from**: today's brain-kit research synthesis (Mem0 / Zep / Letta / Cognee / Supermemory benchmarks, MAF+Neo4j launch).

---

### Sprint 4.9 — Ambient morning-briefing PWA + email-draft surface (M-L effort, ⭐ DEFENSIBLE WHITESPACE) — 📋 PROPOSED 2026-05-13

**Status**: 📋 Proposed 2026-05-13 from brain-kit research synthesis. Lindy.ai (7 AM SMS briefing) is the recognized commercial leader; **no OSS template exists** for "Claude Code morning briefing" / "agentic PWA dashboard". Tier 3 productization defensible whitespace, not a launch-blocker.

**Scope**:
- PWA frontend (Next.js, installable on iOS/Android home screen, push notifications via Web Push API) — single screen: overnight Steward activity rollup + drafts requiring approval + flagged anomalies + next-action nudge.
- Steward `morning_briefing` action_kind that compiles journal-entries-since-yesterday + open draft PRs + spec_failures + budget-cap warnings into a single markdown doc + dispatches push notification at operator-configured local time.
- Email-draft surface (optional): Steward action_kind `email_draft` reading operator-tagged "drafts" inbox folder, drafting reply via OpenRouter, leaving draft in `Drafts/` for human review (never auto-send).

**Effort**: M-L (1-2 sprints). PWA + push infrastructure is the heavy chunk; the action_kinds reuse existing Steward primitives.

**Why this is the right shape**: every component the brain-kit poster described (KG memory, sleep cycles, 24/7 fleet) overlaps something we already have or have planned. The morning briefing PWA is the **one piece that's genuinely novel** in the OSS landscape and would distinguish cortex-x from "yet another maintenance autopilot". Defer to Tier 3 (post v1.0) — not launch-critical.

**Stolen from**: Lindy.ai 7 AM SMS, Cassidy, the brain-kit poster's PWA approach. Differentiator: ours is operator-self-hosted (Vercel/Cloudflare Workers), not vendor SaaS.

---

### Sprint LR (Launch Readiness) track — 📋 PROPOSED 2026-05-10

**Status**: 📋 Proposed 2026-05-10 from operator brief audit ([`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](research/cortex-x-housekeeping-audit-2026-05-10.md) §1). Distinct track from Tier 1 engineering — these are publish-readiness items that should never block engineering momentum.

| ID | Item | Effort | Operator-only? | Status |
|---|---|---|---|---|
| LR.1 | Real-run eval baseline (5 runs × 3 canonical tasks, ~$0.05) | XS | no — I can run | ✅ pipeline-component baseline shipped 2026-05-12 ([`evals/results/2026-05-12-2802a90-real-baseline.json`](../evals/results/)). Real-LLM smoke flagged operator's OpenRouter key as provisioning-only — full 10-eval manual suite remains operator-paced post-launch. |
| LR.2 | README "Built by" + "Why not Devin/Copilot/Replit" comparison | S | partial — operator fills personal bits | ✅ shipped 2026-05-13 (commit `acec014`). README rewrite 410→175 lines + 5-competitor matrix + "Built by David Rajnoha" attribution + docs/vision.md split for long-form trajectory. |
| LR.3 | Statistical disclaimer in README (Phase 5 evidence empty) | XS | no — 10 min, ship-able now | ✅ shipped (README §Phase 5 disclaimer, refreshed 2026-05-12 to cite both baselines) |
| LR.4 | launch checklist (now tracked under gitignored `docs/dogfood/`) | XS | partial | ✅ shipped (`docs/dogfood/launch-checklist.md`) |
| LR.5 | **Naming decision** (`cortex-x` rename — kolize w/ Cortex Labs et al.) | M | yes — strategic | ✅ resolved 2026-05-12 — operator decided to keep `cortex-x` (personal touch matching Rejnyx_x gamer nick); kolize acknowledged + documented as acceptable. |
| LR.6 | **License decision** (PolyForm NC → MIT/Apache/BSL/dual?) | M | yes — strategic | ✅ shipped 2026-05-12 — Apache License 2.0 (commit `1235f62`). Patent grant + permissive commercial use + corporate-legal-friendly default. |
| LR.7 | Demo asset (asciinema/MP4 scaffold + Steward dry-run) | S | yes — operator-recorded | ⏳ awaiting operator video recording (post-LR.5/LR.6 unblock confirmed) |

**Sequencing**: LR.1/LR.3/LR.4/LR.5/LR.6 all shipped 2026-05-10 → 2026-05-12. **LR.2 (README compare table) + LR.7 (demo asset) remain** — both operator-side. Public-launch blockers cleared.

---

## 4. Tier 2 — Compound learners (weeks 7-12, Sprint 3.0 → 3.3)

**Goal**: turn cortex-x into a self-evolving system. After Tier 2, prompts/strategies/skills get measurably better every week without operator intervention.

### Sprint 3.0 — AlphaEvolve-style prompt evolution (L effort, ⭐ MOONSHOT) — ✅ v0 SHIPPED 2026-05-13

**v0 shipped 2026-05-13** — measurement harness, NOT full evolution engine:
- `bin/steward/_lib/eval-scorer.cjs` (~210 LoC) — pure-math bootstrap CI (mulberry32-seeded for determinism), 3-rule champion-vs-challenger decision (point delta + lower-CI gate + validation spec_pass_rate non-regression).
- `bin/steward/_lib/eval-runner.cjs` (~170 LoC) — eval-task discovery via frontmatter parse, pluggable executor (mock + future real-LLM), train/validation split via `validation: true` frontmatter, results JSON writer.
- `bin/cortex-evolve-ab.cjs` — operator CLI with `run` (execute variant) + `compare` (apply decision rule) subcommands.
- 29 tests (`tests/unit/eval-scorer.test.cjs` + `tests/unit/eval-runner.test.cjs`).
- **Honest disclaimer baked into CLI output**: N=10 << N=400-600 published threshold for 5% delta at 95% confidence; v0 results are directional, not statistical verdict.

**Deferred to v1+** (operator decision): population search + island models (OpenEvolve pattern), real-LLM executor wiring (operator-paced cost ceiling), cross-action_kind generalization, DSPy MIPROv2 integration, eval-suite growth toward N=400.

**R1 memo**: [`docs/research/sprint-3.0-prompt-evolution-2026-05-13.md`](./research/sprint-3.0-prompt-evolution-2026-05-13.md) — AlphaEvolve May 2026 impact, Sakana DGM state, DSPy / Langfuse production patterns, eval-suite-size statistical thresholds, mode-collapse + metric-overfit defense.

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

### Sprint 3.2 — FTS5 skill index + cross-project lesson sharing + LLM Wiki layer (M effort) — ✅ v0 SHIPPED 2026-05-13 (first Tier 2 sprint)

**v0 shipped 2026-05-13**:
- `bin/steward/_lib/lessons-search.cjs` (~220 LoC) — node:sqlite FTS5 index over `$CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl`. Zero npm deps (built-in `node:sqlite`, Node ≥22.5). Feature-detected at module load; gracefully reports `SQLITE_UNAVAILABLE` on older Node patches.
- 3 search helpers: `searchByText` (bm25-ranked full-text), `searchByActionKind` (exact filter), `searchByErrorCode` (root_cause MATCH).
- `bin/cortex-lessons-search.cjs` — operator CLI with 4 subcommands (`build`, `text`, `kind`, `code`).
- 13 tests (`tests/unit/lessons-search.test.cjs`) — build idempotency, bm25 ranking, no-match path, INDEX_NOT_BUILT guard, FTS5 quote escaping, slug safety.
- v0 contract: per-project index only, full rebuild each call (safe for <10K-entry lessons.jsonl), opts.dataHome propagates through both read + write paths.

**Deferred to Sprint 3.2 v1+**:
- Cross-project federated index at `~/.cortex/lessons.federated.jsonl` + signed-entries poisoning defense
- Action-engine recall integration (Sprint 1.8.3 pre-prompt step) — replaces linear scan with FTS lookup
- `[[wikilink]]` regex extractor over `cortex/projects/*.md` + orphan-page surfacing
- `prompts/wiki-curator.md` — Karpathy-gist-style nightly curator

**Why**: lessons.jsonl is linear-scan, fine for one project. Cross-project federated learning needs indexed query. NousResearch's hermes-agent has FTS5 in production at 139k-star scale. **Sprint 3.6 R1 (2026-05-11)** folded the Karpathy LLM Wiki pattern into this sprint instead of creating a new one — cortex-x already does what Karpathy describes (institutional wisdom in markdown), it just doesn't enforce `[[wikilink]]` syntax or run a curation pass.

**Scope (FTS5 — original)**:
- SQLite FTS5 index over `cortex/hermes-lessons.jsonl` (per-project) + `~/.cortex/lessons.federated.jsonl` (cross-project).
- New helpers `lessons.searchByText()` + `lessons.searchByActionKind()` + `lessons.searchByErrorCode()`.
- Action-engine recall step (Sprint 1.8.3) uses FTS lookup instead of scoring full archive.
- Cross-project sync: opt-in via `cortex/cortex-source.yaml` flag, signed entries to prevent poisoning.

**Scope (LLM Wiki extension — Sprint 3.6 fold-in)**:
- `[[wikilink]]` regex extractor over `cortex/projects/*.md` + `lessons.jsonl` topic entries. Surfaces orphan pages (linked-to but not yet written) + dangling references (page exists but never linked).
- `prompts/wiki-curator.md` — Karpathy gist (`karpathy/442a6bf555914893e9891c11519de94f`) parameterized over `$CORTEX_DATA_HOME/projects/`. Invokable nightly via existing Steward cron lane. Output: per-run report flagging contradictions across `lessons.jsonl` + `cortex/projects/*.md`, missing entity pages, stale entries.
- Curator runs **on-read, not on-index** (LazyGraphRAG-style economics — see Sprint 3.3 deferral note). No DB beyond FTS5; corpus stays plain markdown.

**Pre-implementation research dispatch (R1 ✅ done)**:
- ✅ R1 memo: [`docs/research/sprint-3.6-llm-wiki-research-2026-05-11.md`](./research/sprint-3.6-llm-wiki-research-2026-05-11.md) — Karpathy gist primary source, 2026 GraphRAG state of the art, Anthropic Memory Tool comparison, Letta / GitNexus / Obsidian-second-brain landscape.

**Why this is "one sprint extension, not a new sprint"** (per R1 §5 recommendation):
- Karpathy ships **no reference implementation** — gist is explicitly abstract, meant to be copy-pasted as a pattern prompt (F2).
- Anthropic Memory Tool (`memory_20250818`) is already file-based + markdown-based, shipped BEFORE Karpathy's post (F9) — confirms the file-based shape is the durable primitive.
- cortex-x's existing `lessons.jsonl` + `cortex/projects/<slug>.md` already implements the Karpathy 3-layer split (raw sources / wiki / schema). Adding wikilink-lint + curator prompt completes the pattern without architectural change (T2, T3).
- Graph DB (Neo4j / FalkorDB / Memgraph) **rejected** for Tier 1-2 — violates zero-deps invariant, indexing-cost premium 10-40x without LazyGraphRAG.

**Stolen from**: NousResearch/hermes-agent skill curation + ReasoningBank federated angle + Karpathy llm-wiki gist (2026-04-03) + `obsidian-second-brain` skill (eugeniughelbur) + Anthropic memory-tool file-based design.

---

### Sprint 3.3 — GraphRAG codebase context (M effort) — ⏸️ DEFERRED 2026-05-11 (pending LazyGraphRAG + buy-vs-build)

**Status**: ⏸️ Deferred 2026-05-11 per Sprint 3.6 R1 research ([`docs/research/sprint-3.6-llm-wiki-research-2026-05-11.md`](./research/sprint-3.6-llm-wiki-research-2026-05-11.md)). Two reasons:

1. **LazyGraphRAG cost cliff** (R1 F6) — Microsoft's LazyGraphRAG (Q1-Q2 2026 release, currently in cleanup at [microsoft/graphrag](https://github.com/microsoft/graphrag)) cuts indexing cost to **0.1% of full GraphRAG** + **700× lower query cost** for global queries. Production deployments report 70-97% cost reduction ([graph-praxis cliff analysis](https://medium.com/graph-praxis/the-graphrag-cost-cliff-how-33-000-became-33-in-eighteen-months-be1b0fbe37e4)). Building on full-fat GraphRAG now = amortizing yesterday's economics.
2. **Buy-vs-build re-evaluation** (R1 F10) — **GitNexus** (10k+ stars, MCP-native, [github.com/CodeGraphContext/CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext)) + **Nomik** ([nomik.co](https://nomik.co/)) already ship the wiki-shaped codebase pattern we planned to build. Both are MCP-native and already work with Claude Code / Cursor. Re-evaluate whether cortex-x writes its own Tree-sitter pipeline or wires the existing MCP server as an external adapter (Sprint 3.4).

**Original scope** (kept for reference, revisit at Q2 2026 when LazyGraphRAG ships):
- Tree-sitter parse on `npm install` + on-demand refresh.
- Local SQLite-backed graph (FalkorDB later if needed).
- New helper `codeGraph.findCallSites(symbol)` + `codeGraph.findImporters(file)`.
- Per-kind retrieval: `dep_update_patch` queries call sites of breaking symbol, `recommendation` queries importers of mentioned files.

**Re-eval gate**: when LazyGraphRAG hits stable release OR when an action_kind genuinely needs multi-hop code-graph traversal (Sprint 3.3 R1 §5 trade-off T1: graph DB violates zero-deps invariant for Tier 1-2; reconsider only post-Tier 3).

**2026-05-13 update from brain-kit research** ([`docs/research/brain-kit-landscape-2026-05-13.md`](./research/brain-kit-landscape-2026-05-13.md)): **Microsoft Agent Framework v1.0 ships Neo4j as a first-party memory + GraphRAG provider** ("Neo4j Aura Agent", "Create Context Graph" end-to-end deployment paths). GraphRAG-V benchmark: +11pp recall over vector baselines on MultiHopRAG, indexing cost 10–40× pgvector. Implications: (a) buy-vs-build option C added — adopt Neo4j as external service (violates zero-deps but is now the industry reference impl), (b) cortex-x's "roll-our-own SQLite graph" path remains defensible on zero-deps + cost grounds, (c) when LazyGraphRAG ships, we have a clear A/B to run.

**Interim**: if structural code awareness is needed before LazyGraphRAG ships, evaluate GitNexus MCP as a drop-in (matches Sprint 3.4 External Tool Capability Adapters pattern).

**Stolen from**: GitNexus + GraphRAG papers + LazyGraphRAG cost analysis.

---

## 5. Tier 3 — Productization + enterprise-adjacent (weeks 13-20)

**Goal**: cortex-x stops being "the operator's personal tool" and becomes "distributable senior-engineer-as-a-service." Each Tier 3 sprint is an independent revenue/positioning lever.

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

**Why**: a barbershop WaaS client, an e-commerce chatbot client, a booking-platform client — the operator's existing clients. Each gets own Steward instance. $50/month per client = recurring revenue + tangible AI value-add.

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

**Why**: the operator dictates while driving / walking. Telegram bot → voice → Whisper → recommendations.md.

**Scope**:
- Telegram bot endpoint, voice-message receiver, Whisper transcription.
- Same LLM filter as 4.2.
- Operator confirmation step before commit.

---

### Sprint 4.4 — Coding identity transfer / LoRA (XL effort, ambitious)

**Why**: extract the operator's style from his git history (a Next.js SaaS project + Chatbot Platform + WaaS + cortex-x), train lightweight LoRA, Steward adopts. Other the operator projects inherit your voice.

**Scope**:
- Git history → diff samples → instruction-tuning dataset.
- LoRA training (small model, fine-tune on the operator-PR pairs).
- Inference seam in action-engine (LoRA-adapted model as routing option).

**Stolen from**: standard LoRA + RLHF-from-PRs research.

---

### Sprint 4.5 — Cross-repo federated lesson bank (S-M effort)

**Why**: complement to Sprint 3.2. a Next.js SaaS project Steward learns from Kiosek Steward failures.

**Scope**:
- Shared `~/.cortex/lessons.federated.jsonl` synced via private Supabase row or signed Gist.
- Each entry signed with source-repo SHA to prevent poisoning.
- Opt-in per-project.

---

### Sprint 4.6 — Playwright-MCP UI verification (M effort, client-project unlock)

**Why**: relevant for a Next.js SaaS project/Kiosek/portfolio runs where Steward touches React components.

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
- [ ] Existing user installations (operator + future a Next.js SaaS project) continue to work with `HERMES_*` env vars + `bin/cortex-steward` shim, with deprecation warning.
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

**Status**: vision tier, not commitment. Surfaced 2026-05-09 by the operator (operator) after seeing a "Personal AI Wiki System" diagram (UGREEN NAS + Obsidian Vault + Steward + multi-agent worker stack). The diagram resonated because cortex-x already has 80% of the components — just running in GHA cron context, not on a home always-on host.

**Goal**: cortex-x stops being "code maintenance tool" and becomes "personal AI entity that lives on the operator's home NAS, curates knowledge across all life domains (code + meetings + notes + health + LinkedIn), responds to ambient events, persists identity across years."

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

**Why**: the operator's life knowledge isn't in `cortex/recommendations.md` — it's in Obsidian (notes, meetings, ideas). Khoj indexes Obsidian content; Steward's recommendation_harvest detector reads Khoj's curated topic pages as additional signal alongside gh PR/issue/CI signals.

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

**Why**: cortex-x as something the operator can talk to, not just CLI invocation. Voice interface, ambient memory, conversational recall.

**Scope**: Telegram + Whisper + local Steward inference. "Hej cortex, co jsme řešili minulý týden o a Next.js SaaS project?" → Steward recall + response in operator's voice/style (post Sprint 4.4 LoRA).

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
5. Switch one project (cortex-x dogfood first, then a Next.js SaaS project) from GHA-cron to home-daemon.
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
- **Week 20** (after Tier 3): client revenue + capability marketplace live. Question: is this distributable beyond the operator?

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
