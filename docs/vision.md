# cortex-x — Vision & trajectory

> The long-form companion to README. README answers *"what does it do today"*. This file answers *"why does it exist and where is it going"*. Read this if you want the mission, the four-tier roadmap, and the sprint-level archeology. Skip it if you just want to install.

## Why cortex-x exists

Most AI coding tools optimize for the next chat turn. cortex-x optimizes for **the next year of an operator's repos** — what survives, what compounds, what doesn't get re-typed every Monday.

That changes three things in how the framework is shaped:

1. **Project memory is a first-class artifact.** `CLAUDE.md`, `PROGRESS.md`, `MEMORY.md`, `cortex/recommendations.md` aren't templates — they are the persistent state that turns a new Claude Code session into a senior teammate who already read the codebase.
2. **Standards travel between repos.** A SaaS app, a kiosk PWA, a CLI tool, and a static portfolio all inherit the same 26-standard tier system the day they are scaffolded. The author's lessons from project N show up on day 1 of project N+1.
3. **Maintenance is autonomous.** Once a repo has tests + a recommendations file + an LLM key, the Steward runtime can run nightly on it — branch, edit, gate on `npm test`, open a draft PR, roll back atomically on failure. The operator reviews the diff over coffee; the agent did the typing while they slept.

## Four-tier trajectory

cortex-x is not "done at v1.0." The roadmap below is the trajectory from *excellent dev tool* to *persistent operator-side entity*. Tier numbers map to `docs/steward-roadmap.md` sprint blocks.

| Tier | Status | Theme | What it produces |
|---|---|---|---|
| 0 — Foundation | ✅ shipped | Scaffold + capability palette + safety mechanics + 6-kind spec-driven verification | One-command install, 11 profiles, 26 standards, 16 action kinds, 6 criterion kinds |
| 1 — Verification + multi-agent | ✅ mostly shipped (2.3b deferred) | Spec-driven verification, OTLP observability, autoresearch, edit_ops primitive, mutation-testing foundation, read-coverage proof | Steward runtime that gates every edit on a typed acceptance criterion |
| 2 — Compound learners | ⏳ Sprint 3.0–3.3 | AlphaEvolve prompt evolution, self-extending capabilities, FTS5 skills, GraphRAG | Framework that adds capabilities to itself with eval-gated proposals |
| 3 — Productization | ⏳ Sprint 4.0–4.7 | Capability marketplace, WaaS for clients, voice → recommendation, identity LoRA | cortex-x runs for operator's clients, not just operator's repos |
| 4 — Persistent entity | 🔮 Sprint 5.0+ | Self-hosted home server, soul abstraction, Obsidian SSOT, multi-source life ingest | Operator-owned second brain that curates code + knowledge + life across years |

Every sprint is gated by six operating principles (R1–R6) covering research-before-implement, review-pipeline-mandatory, one-incident-one-defense, cost ceilings, human-only paths, and backward compatibility. The authoritative enforcement detail lives in [`docs/steward-roadmap.md`](./steward-roadmap.md) §1 — read that before opening a sprint.

## North-star metrics

Every sprint moves at least one of these:

1. **Verification fidelity** — % of agent edits that don't introduce regressions undetected by `npm test`
2. **Throughput per operator-hour** — net useful PRs Steward opens per hour of operator review time
3. **Self-evolution rate** — # of new capabilities/skills/strategies the agent itself contributes per week

The third metric is currently zero by design — Phase 5 (`prompts/cortex-evolve.md`) is specified, gates are codified, the runtime is awaiting Phase 7 cron enablement.

## Core mental model

The framework's institutional-wisdom vs project-current-state split is the load-bearing decision that lets cortex live for years without drifting. The authoritative explanation lives in [`prompts/cortex-load.md`](../prompts/cortex-load.md) — read that before any work that touches `CLAUDE.md` content or cortex library entries.

## Detailed phase status (Phases 1–7)

> **Shipped infra vs designed patterns.** Items below split by *what runs today* (✅) vs *what's specified but awaits Phase 7 runtime* (⏳ designed). Read the status mark before betting on a feature.

### Phase 1 — Foundation ✅ shipped

- 7 universal hooks (block-destructive, session-start, pre-compact, pre-tool-use, post-tool-use, tirith-scan, auto-orchestrate) — Tier 4 contract-tested
- 11 project profiles — schema-validated, full list in [README § Available profiles](../README.md#available-profiles)
- 26 standards across Rule 0 / 1 / 1.5 / 2 / 3 tiers — full list in [`standards/README.md`](../standards/README.md)
- Templates: CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md, SKILL.md (agentskills.io spec)
- Cross-platform install scripts — 5-lane CI matrix (ubuntu-bash, macos-bash, windows-gitbash, windows-pwsh7, windows-ps5.1)
- Tier 0–8 QA infrastructure — started at 207 tests 2026-05-07, growing test count tracked in CLAUDE.md, hook contract + prompt regression as hard gates
- `detectors/` deterministic profile + stage classifiers (<100ms, fail-open) feeding session-start hook and cortex-doctor drift flow

### Phase 2 — Bootstrap skill ⚠️ partial

Prompt-driven scaffold (`prompts/new-project.md`) shipped — three questions, 3 minutes to a scaffolded project. Clack-based interactive CLI deferred.

### Phase 3 — Multi-agent ✅ shipped

5-agent parallel code-review pipeline (`prompts/code-review.md` → blind-hunter, edge-case-hunter, acceptance-auditor, security-auditor, ssot-enforcer) shipped. 9 specialized subagents total — adds planner, synthesizer, correctness-auditor, cortex-thinker. Standalone orchestrator agent deferred (currently the prompt-side orchestration suffices).

### Phase 4 — Web research ✅ shipped

`prompts/new-project.md` Phase 5 dispatches 3–5 parallel research agents. `research-protocol.md` defines the contract. Results cached at `$CORTEX_DATA_HOME/research/<slug>-<date>.md` with per-topic TTL (tech 90d, security 60d, competitive 180d, domain 365d). Three-hop citation traceability mandatory.

### Phase 5 — Self-improvement loop ✅ Phase A daily Dreaming cron shipped Sprint 2.19 · ⏳ Phase B+C runtime via Phase 7

**Industry slovník** (May 2026): the same primitive ships as "Dreaming" in OpenClaw (nightly 3 AM cron), "Auto Dream" in Anthropic's Claude Code Memory, and "NREM+REM consolidation" in ICLM 2026's *Language Models Need Sleep* paper. cortex-x's internal name is `cortex-evolve` — same shape, aligned with industry vocabulary.

- 4-cadence architecture (daily ingest / weekly mining / monthly eval / quarterly audit) specified in `config/evolve.yaml`. **Daily (Phase A) is now cron-wired via `evolve_daily` action_kind (Sprint 2.19); weekly + monthly + quarterly remain manual-trigger pending Phase B LLM runtime.**
- Hard anti-hallucination gates (`min_support=3`, `≥2 projects`, `>7d spread`, Bonferroni correction, citations required) — enforced when `prompts/cortex-evolve.md` is manually invoked
- Aider-style eval suite — 10 canonical task rubrics shipped in `evals/`; `evals/results/` empty pending first automated run
- PR-only mutations — framework never auto-edits its own source of truth, discipline encoded
- Meta-loop: every 30 insights → effectiveness review → threshold tuning — designed, awaits Steward enablement

See `docs/self-improvement-rfc.md`.

### Phase 6 — Memory upgrades ⏳ designed (awaits Phase 7)

6-signal scoring for autoDream promotion, graph expansion (2-hop) over memories, `DREAMS.md` human-readable consolidation output.

### Phase 7 — Steward runtime ✅ v0.5b shipped · ✅ cortex-x own cron triggers shipped · ⏳ operator-fork enablement pending

- ✅ All 5 pre-launch RFC gates closed (Tier 4 hook contract + Tier 5 prompt regression + steward-policy.md + steward-runtime.md design + fixture)
- ✅ 6 zero-dep CJS primitives in `bin/steward/_lib/` (halt-check, lock, journal, recommendations parser, git-trailer builder, policy denylist)
- ✅ `bin/steward/dry-run.cjs` orchestrator — reads recommendations.md, picks next action, builds Conventional-Commits-shaped commit message with Git trailers, journals run, releases lock
- ✅ `bin/steward/status.cjs` observability CLI — reports halt + lock + recommendations + journal rollup with cost ledger
- ✅ `bin/steward/execute.cjs` (v0.5a) — async runtime: dry-run plan → branch → engine apply → npm test gate → atomic commit → rollback on failure → journal cost
- ✅ OpenRouter engine (v0.5b) — real LLM via `fetch()` (Node ≥18), zero-deps preserved. 8 distinct error codes, configurable timeout, JSON-mode response_format, default `deepseek/deepseek-v4-flash` (~$0.0008/run). Pluggable seam: `mock` / `openrouter` / `claude-sdk`
- ✅ First real OpenRouter call validated end-to-end (Sprint 1.6.13 dogfood): LLM → JSON → edits → test gate → atomic rollback proven safe by reality
- ✅ Sprint 1.6.14–1.6.18 hardening from real-world signal + 6-agent review pipeline: `STEWARD_MAX_TOKENS`, cost capture on all failure paths, JSON-fence stripping for cross-model robustness, tightened path-traversal (NUL byte + flag-injection + realpath containment), editPlan shape gate, null-body guard, default-model SSOT alignment, MIGRATIONS.md backfill
- ✅ Sprint 1.9.0 spec-driven verification — generalizes hardcoded `EDIT_DESTRUCTIVE_REWRITE` into per-kind `acceptance_criteria[]` with 6 criterion kinds (shell / file_predicate / regex / ears_text / llm_judge / read_set), 8 error codes from `SPEC_VIOLATION` through `SPEC_LLM_JUDGE_NOT_IMPLEMENTED`
- ✅ Sprint 1.9.1 multi-window cost safety + loop detector — `STEWARD_WEEKLY_USD_CAP` ($25 default), `STEWARD_MONTHLY_USD_CAP` ($80), `STEWARD_TOKEN_VELOCITY_CAP` (50K/5min), cross-session loop detector (5x same criterion id in 7 days → write `STEWARD_HALT`), `cortex-steward status --forecast`
- ✅ v0.5b finalization (Sprint 1.6.19): `gh pr create --draft` integration in execute.cjs (push + PR open), daily spend cap + consecutive-failure circuit breaker
- ✅ **15 active cron workflows** in `.github/workflows/steward-*.yml` — daily harvest, weekly dep-patch / flaky-test / coverage / lint / tech-debt / workflow-hardener / secret-sweep, monthly senior-tester / doc-drift / todo-triage, every-4-hours pr-review-responder. Real nightly cron PRs producing commits since 2026-05-09
- ⏳ **v1 enablement on your own repo**: workflow files exist as templates. Set `OPENROUTER_API_KEY` (or Anthropic Max sub via `claude-cli` engine) + per-workflow secrets, then enable on your fork. Manual `cortex-steward dry-run` works today without cron
- ⏳ **v1.5+ hardening backlog** (Sprint 1.6.20+ + 1.9.1+): hardcode endpoint, extractUsage string coercion + multi-call ensemble shape (RouteLLM blocker), detached HEAD pre-flight, timeoutMs/maxTokens upper-bound clamps, `<untrusted>` delimiters around prompt-injected content, eval suite + property tests + stateful simulation per `standards/correctness.md`; `kind: ears_text` runtime semantics, render `spec_failures` block in PR body, EISDIR + symlink hardening in applyEditsToFilesystem

See [`docs/steward-rfc.md`](./steward-rfc.md), [`docs/steward-runtime.md`](./steward-runtime.md), [`docs/steward-usage.md`](./steward-usage.md), [`standards/steward-policy.md`](../standards/steward-policy.md).

## The thinking layer

cortex-x isn't just templates — it observes.

- **SessionStart hook** auto-detects whether the current project has a cortex library entry, mentions it once per session
- **cortex-thinker subagent** reflects on cross-project patterns, grounds every insight in concrete file paths
- **`insights/` directory** captures proactive observations (standard violations, transferable patterns, repeated mistakes, stale entries, security regressions)
- **`journal/` directory** tracks tool-use traces (privacy-safe metadata only) for repeat-mistake detection
- **Budget cap**: max 1 insight per session, max 3 per week — silence beats noise

Cortex acts as a senior-engineer partner — catches what the operator misses, politely, once, moves on.

## Phase 5 evidence base — honest disclaimer (Sprint LR.3, refreshed 2026-05-12)

The statistical gates above (`min_support=3`, `≥2 projects`, `>7d spread`, Bonferroni correction, citations required) are **specified in code + prose**.

Empirical state as of 2026-05-12:

- **Pipeline-component baseline** at [`evals/results/2026-05-12-2802a90-real-baseline.json`](../evals/results/) — full test suite green, 5-lane install-smoke green, capability registry auto-refreshes, cost-safety multi-window caps active, OpenRouter inference seam verified architecturally (smoke-call recovery path documented in the baseline JSON).
- **Paper baseline** at [`evals/results/2026-05-01-01d9013-paper-baseline.json`](../evals/results/) — per-task scores predicted from prompt + standard review at commit `01d9013`.
- **Full manual eval suite** (10 canonical tasks per `evals/runner.md` §2) remains operator-run, ~$10–15 + 2 hours per pass, targeted post-launch monthly cadence.

**Claims of "framework improves itself" are designed but not yet measured by a real Claude-session execution score.** Sprint LR.1 closes once one full manual eval pass is captured. Track in [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](./research/cortex-x-housekeeping-audit-2026-05-10.md) §1 Sprint LR track.

## The endgame

Tier 4 (sprint 5.0+) is intentionally aspirational. The shape is a self-hosted home-server instance that ingests operator's repos, voice memos, calendar, journal — keeps a markdown-shaped second brain — proposes weekly diffs to operator's life surfaces (Obsidian SSOT, billing, scheduling) — and reviews itself monthly against captured outcomes.

That tier is years out and shouldn't influence anyone's decision to install cortex-x today. It's named here so the design choices visible in tiers 0–3 (operator-owned data, atomic rollback, zero-trust LLM output, evals gate every promotion) read as foundation rather than overengineering.

If you only want a scaffolder + a nightly maintenance bot, tiers 0 and 1 are already what you'd get from cortex-x today. The rest is direction, not promise.
