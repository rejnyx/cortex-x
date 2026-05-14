# Multi-agent supervisor + agent-as-judge ensemble — when, why, how to gate

> **Tier:** Rule 2 (Critical). Sprint 2.2 v0 standard. Companion to [`correctness.md`](./correctness.md) §Practice 5 (stateful simulation) and [`security.md`](./security.md) §Agentic Pattern 5 (HITL on destructive ops).

cortex-x Steward runs LLM-driven actions serially by default — one process, one prompt, one verified outcome. **Multi-agent parallelism is the wrong default** for shared-context coding tasks because (a) it amplifies errors when topology is unstructured (DeepMind 2026, [arXiv 2512.08296](https://arxiv.org/html/2512.08296v1)), (b) it 15×s token cost without 15×ing quality, (c) it makes failure modes harder to verify.

But for **breadth-first parallelizable tasks** with a clear rubric, multi-agent with a judge LLM can produce strictly better outcomes than serial. This standard codifies when cortex-x opts into parallelism and the safety primitives that make it survivable.

## When parallel is the right shape

The action_kind registry uses an explicit `topology_safe` field:

```js
// bin/steward/_lib/action-kinds.cjs
some_action: {
  // ...
  topology_safe: 'serial',  // default — single-process, shared context
}

recommendation_harvest_parallel: {
  // ...
  topology_safe: 'parallel', // opt-in for breadth-first divergent kinds
}
```

**`'parallel'` is justified ONLY when ALL of these hold:**

1. **Independent worker outputs.** Each worker's edit can be evaluated against the same spec criteria without knowing what other workers did. Breadth-first generation, not collaborative refinement.
2. **A judge LLM can pick the best output.** The rubric is verifiable on the worker's output alone — not "best in some subjective sense" but "passes the most spec criteria + lowest cost + clearest commit message."
3. **The task is parallelizable, not sequential.** DeepMind 2026 §"Topology" shows multi-agent gains apply to parallelizable tasks; sequential tasks under independent topology see up to 17.2× error amplification.
4. **Outputs are mergeable or selectable.** Either the supervisor picks ONE worker output (selection) or merges N outputs into one combined edit (combination). cortex-x v0 ships selection-only.

**Where multi-agent is WRONG** (these action_kinds MUST stay `topology_safe: 'serial'` per anthill memo §10):
- `dep_update_patch`, `lint_fix_shipper`, `flaky_test_repair`, `test_coverage_gap`, `doc_drift`, `todo_triage` — all need shared context with the codebase mutation. Single-agent + spec-verifier (Sprint 1.9.0 architecture) is the correct shape.

## Sprint 2.2 v0 ships FOUNDATION (not spawner)

This standard documents the contracts. The actual spawner — `runSupervisor()` + `runWorker(N)` + git worktree add/remove + per-worker spec-verifier gate + judge LLM invocation — is **Sprint 2.2.1** territory. Shipping the contracts first lets the operator review the safety primitives before any worker process spawns.

### What's in v0 ([`bin/steward/_lib/topology.cjs`](../bin/steward/_lib/topology.cjs))

1. **`parseTreeBudgetCap(env)`** — STEWARD_TREE_USD_CAP parsing with clamp `[0.10, 10.00]` USD per tree. Default $1.50 (R1 anthill memo: ~2× single-call dogfood). 4th budget window alongside D/W/M USD caps from Sprint 1.9.1.
2. **`canonicalizeWorkerInput(plan, criterionId)`** — deterministic SHA-256 fingerprint of normalized worker input. Two workers reaching the same fingerprint in 24h = cross-tree-ping-pong signal. NFKC-normalizes strings (Sprint 2.25.1 pattern). Stable object key ordering. The primitive the $47K LangChain incident (Sept 2025) would have caught.
3. **`randomizeJudgeOrder(workerOutputs, rng)`** — Fisher-Yates shuffle of worker outputs before sending to judge LLM. Position bias is real (per Liu et al 2024 + Monte Carlo 2026 — LLM judges over-weight the first option). NEVER mutates input; returns `{shuffled, originalIndexAt}` so caller maps the judge's pick back.
4. **`validateTopologySafe(actionKind, kindEntry)`** — asserts the action_kind registry entry's `topology_safe` field is `'serial'` (default) or `'parallel'` (opt-in). Missing field = back-compat default of `'serial'`. Invalid value = ok:false + safe fallback to `'serial'`.

### What's deferred to v1 (Sprint 2.2.1+)

- `runSupervisor()` — orchestrator that selects workers, distributes input, collects outputs, runs the judge.
- `runWorker(N)` — child-process spawner via git worktree.
- Per-worker spec-verifier gate — every worker output runs through `spec-verifier.cjs` independently; only outputs passing ALL criteria reach the judge.
- Judge LLM invocation — same-tier Sonnet judge with rubric = spec criteria + commit clarity + cost (R1 fresh memo: judge MUST receive rubric + test results + rationale, not just diffs).
- Cross-tree loop detector wiring — `cost-safety.cjs:detectCriterionLoop` extended with `(criterionId, sha256)` cache (the SHA from `canonicalizeWorkerInput`); 3× repeat in 24h → `STEWARD_HALT`.
- Orphan cleanup on supervisor crash — `git worktree list --porcelain` enumeration + `git worktree remove --force` for any prefix-match orphans.
- OTel tagging on worker spans.

## Safety contracts (binding for v1 spawner)

When the v1 spawner ships, it MUST respect these contracts:

### S1 — Per-tree budget cap is enforced AT THE SUPERVISOR

The supervisor computes `cap = parseTreeBudgetCap(process.env)`. Before each worker spawn, supervisor checks `currentSpend + estimatedNextSpend <= cap`. If exceeded, abort spawn with `STEWARD_TREE_CAP_EXCEEDED`. Workers themselves don't trust their own self-reported spend — supervisor is the truth.

### S2 — Workers cannot spawn workers (process-level + tool-list, both required)

Claude Agent SDK enforces depth-cap=2 natively (per fresh R1 §1: "subagents cannot spawn subagents"). cortex-x's spawner MUST omit `Agent` / spawn primitives from the worker's allowed-tools list. **R2 security HIGH-3 (2026-05-14) amendment**: tool-list omission alone is INSUFFICIENT — any MCP server the worker can reach may expose a `spawn`-equivalent (shell, write-file → systemd unit, http-fetch → external orchestrator); Bash with `--allowed-tools Bash` lets a worker `npx claude-code` recursively. Required additional controls:

1. **Explicit MCP allow-list per worker** — no inheritance from supervisor's MCP config; worker receives an explicitly-named subset (or empty list) of MCP servers.
2. **Bash/Shell tool stripped or denylist-wrapped** — if Bash is granted, wrap it with a denylist refusing `claude`/`claude-code`/`npx`/`anthropic` substring matches.
3. **Process-level enforcement** — supervisor sets `STEWARD_WORKER_DEPTH=1` env on every spawned worker; worker's pre-tool-use hook reads this env and refuses ANY spawn-shaped call when depth ≥ 1.

Without **all three** layers, S2 is documentation, not a control.

### S3 — Judge LLM input is order-randomized + carries rationale

Judge prompts MUST:
- Receive outputs via `randomizeJudgeOrder` (position-bias mitigation).
- Include each worker's stated rationale + per-worker spec-verifier result + per-worker token spend.
- Use SAME-TIER model as workers (Sonnet judge over Sonnet workers, NOT haiku-as-judge). R1 fresh memo §4: smaller-as-judge for code selection is unvalidated; same-tier is safer.

**R2 security HIGH-2 (2026-05-14) amendment**: the `rng` parameter to `randomizeJudgeOrder` is a **test-only injection seam**. In production, callers MUST omit it (default Math.random) OR provide a `crypto.randomInt`-based RNG. A caller passing `rng = () => 0.999999` defeats the bias mitigation invisibly (every unit test still passes). The v1 spawner MUST refuse to invoke the judge if the supervisor's runtime detects a non-default RNG outside of test environments. Sprint 2.2.1 will add the production guard: throw when `rng` provided and `process.env.NODE_ENV !== 'test'`.

### S4 — Cross-tree loop detector writes STEWARD_HALT, not just logs

Three-strikes window: `(criterionId, sha256)` repeat 3× in `LOOP_DETECTOR_WINDOW_HOURS` (24h) triggers `STEWARD_HALT` sentinel write — same mechanism as Sprint 1.9.1 single-agent loop detector. Operator-cleared only.

**R2 security caveat (2026-05-14)**: this primitive catches *identical-input ping-pong* (e.g. agent A asks "fix X" repeatedly). It does NOT catch *delta-accumulating ping-pong* where two agents alternate with shifting prompt context — each iteration's canonical input is distinct so fingerprints diverge. For that class, Sprint 2.2.1+ should add a near-duplicate mode (Jaccard or simhash over plan diff) as a follow-up; v0 documents this limitation here so the operator can decide when the gap matters.

### S5 — Orphan worktrees cleaned up on every supervisor exit

`process.on('exit')` + signal handlers ensure `git worktree remove --force` runs for all spawned worktrees. R1 fresh memo §HARD-3: "orphan cleanup on supervisor crash" is one of the 5 hardest items to get right.

### S6 — Spec-verifier runs per worker AND on the supervisor's final synthesized plan

Both gates must pass. Per-worker spec-verifier kills bad workers before judge wastes tokens; final-plan spec-verifier kills bad combined outputs before they reach the filesystem mutation step.

## References

- [Sprint 2.2 R1 fresh memo (2026-05-14)](../docs/research/sprint-2.2-worktree-supervisor-2026-05-14.md) — 13 cited URLs, decision matrix, 12 implementation recommendations split into HARD / EASY-TO-GET-WRONG / DEFER
- [Sprint 2.2 R1 anthill memo (2026-05-08)](../docs/research/swarm-self-spawning-agents-2026-05-08.md) — original architecture analysis
- [Claude Agent SDK — Subagents](https://code.claude.com/docs/en/agent-sdk/subagents) — orchestrator-worker primitive (depth-cap=2 native)
- [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — +90.2% gain (parallelism wins primarily by spending more tokens)
- [Cursor 2.0 Worktrees](https://cursor.com/docs/configuration/worktrees) — OSS reference for worktree-per-agent
- [Composio Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator) — OSS supervisor pattern reference
- [The $47K agent loop postmortem](https://dev.to/gabrielanhaia/the-agent-that-spent-47k-on-itself-an-autonomous-loop-postmortem-3313) — the canonical published incident this standard's primitives prevent
- [Towards a Science of Scaling Agent Systems — arXiv 2512.08296](https://arxiv.org/html/2512.08296v1) — DeepMind 2026: gain regime vs error-amplification regime per topology + task type
- [Agent-as-Judge survey arXiv 2508.02994](https://arxiv.org/html/2508.02994v1)
- [Monte Carlo — LLM-as-Judge best practices](https://www.montecarlodata.com/blog-llm-as-judge/) — position bias + randomization rationale
