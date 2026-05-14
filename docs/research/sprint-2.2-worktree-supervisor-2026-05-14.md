# Sprint 2.2 — Worktree supervisor + agent-as-judge ensemble R1 memo (fresh 2026-05-14)

> Refresh of 2026-05-08 anthill memo. Captured 2026-05-14. Scope: MVP only —
> 1 supervisor + 1 spawned worker for the new `recommendation_harvest_parallel`
> capability. Anything beyond v0 is captured in "deferred uncertainty."

## Findings

### 1. Claude Agent SDK orchestrator-worker (2026 state)

The official API hardened around `AgentDefinition` since the May 2026 docs
refresh ([Subagents in the SDK][1]). Key fields cortex-x must honor verbatim:

- `description` (required) — what the subagent does, drives auto-delegation
- `prompt` (required) — system prompt, **not** inherited from parent
- `tools` / `disallowedTools` — restriction list; **omit to inherit all**
- `model` — accepts alias `'sonnet'|'opus'|'haiku'|'inherit'` or full model ID
- `maxTurns` — hard cap on agentic turns inside the subagent
- `effort` — `'low'|'medium'|'high'|'xhigh'|'max'|number` (reasoning budget)
- `permissionMode` — `PermissionMode` enum, scopes tool exec
- `background: boolean` — non-blocking spawn (new in v2026)
- `skills: string[]` — explicit preload list; unlisted skills remain invocable
  via the Skill tool

Two non-negotiable invariants for Sprint 2.2:

1. **Subagents cannot spawn subagents.** "Don't include `Agent` in a subagent's
   `tools` array." This is the SDK's built-in depth-cap=2 — no env knob needed
   on our side. The cortex-x worker spawned by supervisor inherits this floor.
2. **Only the final message returns to parent.** Parent never sees worker tool
   calls or intermediate reasoning. The supervisor must therefore demand a
   structured worker payload (JSON schema with rationale + diff + cost),
   not free-form prose, otherwise the judge has nothing to compare.

The tool was renamed `Task` → `Agent` in Claude Code v2.1.63; the SDK still
emits `Task` in `system:init` and `permission_denials`, so detection code must
match both strings ([SDK docs][1]).

### 2. Parallel multi-agent patterns 2026

Three live reference implementations to study, in order of relevance:

- **Cursor 2.0 Parallel Agents** ([Cursor worktree docs][2]) — auto-creates
  one worktree per agent, isolated index, branch per agent, `/multitask` slash
  command. May 2026 added "Build in Parallel" auto-detecting independent
  subtasks. **Reference point for filesystem layout, not for judge semantics
  (Cursor does not ship a judge — operator picks the winning tree manually).**
- **Composio Agent Orchestrator** ([ComposioHQ/agent-orchestrator][3]) — 7-plugin
  architecture (runtime, agent, workspace, tracker, SCM, notifier, terminal),
  one worktree + one branch + one PR per agent, supervisor-worker over MCP with
  three primitives: `handoff`, `assign`, `send_message`. 7k★ as of May 2026,
  active. **Reference for supervisor↔worker protocol semantics.** Public repo
  does NOT document per-worker budget enforcement or judge selection — implies
  even mature OSS isn't solving cortex-x's full ask.
- **Anthropic's own multi-agent research system** ([Anthropic engineering][4])
  — Opus 4 lead + 3-5 Sonnet 4 subagents in parallel; +90.2% over single-Opus
  on Anthropic's internal research eval. **Token usage explained 80% of the
  variance**, tool-call count ~10%, model choice ~5%. That ratio is the load-
  bearing finding: parallelism wins because it *spends more tokens*, not
  because the topology is magic. Sprint 2.2 should treat token budget as the
  primary independent variable.

The Anthropic +90.2% number is reproducible *within their evaluation framework*
(BrowseComp-style retrieval) but the paper does not publish the eval, so
external replication is partial. Treat as directional, not load-bearing.

### 3. Git worktree cost incidents + mitigations

The canonical published incident is the **$47K LangChain loop postmortem**
([Anhaia 2026-03][5]). Four agents, no step cap, no budget cap, two of them
entered a clarification ping-pong, ran 11 straight days. Cost curve:
`Week 1 $127 → Week 2 $891 → Week 3 $6,240 → Week 4 $18,400`. The defenses
the author recommends and that cortex-x already partially implements:

1. **SHA-256 hash of tool inputs** — "two is the smallest number that
   distinguishes a one-shot tool call from a loop." cortex-x already has
   `detectCriterionLoop` (5x same criterion id in 7 days) in
   `bin/steward/_lib/cost-safety.cjs:detectCriterionLoop` — but it keys on
   `criterion_id`, not on `tool_input_hash`. For Sprint 2.2 we should add a
   *per-tree* hash-of-last-3-tool-inputs gate; same hash twice in one tree =
   `WORKER_LOOP_DETECTED`, halt that tree only (not the supervisor).
2. **Per-conversation USD budget** — "even a $50 cap would have stopped the
   bleeding at week 1." cortex-x already has daily/weekly/monthly via
   `cost-safety.cjs`; per-tree is the gap.
3. **Step caps + OTel** — cortex-x has neither per-tree step caps nor OTel
   spans tagged with `worktree_id` yet. Phoenix emitter from Sprint 2.0 has
   the transport; we just need the attribute.

The postmortem explicitly notes its scope is sequential; cross-tree
amplification is mentioned only as "the hash approach generalizes." So
cortex-x must invent the cross-tree key (project_slug + worktree_id +
tool_input_hash) — no canonical pattern to copy.

### 4. Judge LLM prompting (best-of-N selection)

The 2026 consensus pattern is **"Chairman"** (term from Blackbox AI, popularized
mid-2026): dispatch task to N workers, judge LLM scores all outputs side-by-
side, picks one. Key findings worth honoring:

- **Position bias is real.** ([Monte Carlo LLM-as-Judge best practices][6])
  "Always evaluate with candidate orders randomized to detect and mitigate
  position bias. If judgments change based solely on position, treat the
  evaluation as low confidence." For 2-worker MVP this means the judge prompt
  must randomize which output is "A" vs "B" per run.
- **Ensemble of 3-5 judges for high-stakes**, single judge for routine. For
  Sprint 2.2 MVP, single judge is fine; flag ensemble as Sprint 2.3 extension.
- **Agent-as-Judge agreement with 5-expert human majority is near-perfect for
  code generation** ([arxiv 2508.02994][7]) — but only when the judge is given
  evaluator scaffolding (rubric, test outputs, diff context), not raw output.
  This is the *key prompting decision*: cortex-x supervisor MUST pass the
  rubric (typically the `acceptance_criteria[]` from the action_kind itself)
  to the judge, not just the two worker payloads.
- **Cost-effective inversion: smaller-as-judge.** Anthropic Opus-lead +
  Sonnet-workers pattern + Haiku-as-judge is plausible but unvalidated for
  *coding selection* specifically. Existing evals (Verdict, evidentlyai) tend
  to use same-tier or stronger judge. For Sprint 2.2 MVP recommend
  **same-tier judge** (Sonnet workers + Sonnet judge) — defer Haiku-judge
  experiment to Sprint 2.3 with explicit eval gate.

### 5. Per-tree token cap implementations

No standard OSS implementation found. The closest available patterns:

- **OneUptime OpenTelemetry token tracking** ([blog post 2026-02][8]) — emits
  `llm.usage.input_tokens` + `llm.usage.output_tokens` + `llm.cost.usd` as
  span attributes per LLM call. Aggregation is done in the tracing backend
  (Tempo/Jaeger/Phoenix), NOT in the calling code. **Implication for
  cortex-x: per-tree cap enforcement cannot rely on Phoenix round-trip;
  must be in-process.**
- **agentgateway LLM cost tracking** ([agentgateway docs][9]) — runtime
  gateway tracks tokens at proxy layer, blocks at limit. Useful pattern for
  the seam: cost is accumulated on a *context object passed through the
  agent loop*, not queried from an observability backend.

Recommendation: cortex-x adds a `WorkerBudget` object passed by reference
into each tree's agent loop. Every LLM call adds `cost_usd` to it
synchronously after `extractUsage`. Pre-flight check before every LLM call:
`if (budget.spent + estimated > budget.cap) throw WORKER_TREE_CAP_HIT`.
The journal emitter still ships to Phoenix in parallel for post-hoc audit —
but enforcement is *local*. This matches Anhaia's $47K postmortem
recommendation ("convert tokens to dollars at invocation time").

### 6. N-mutex lock manager patterns

cortex-x already has `bin/steward/_lib/lock.cjs` (single mutex,
`fs.writeFileSync(..., { flag: 'wx' })` + stale recovery on
`mtime > 2× action_timeout_ms`). For N-mutex generalization in Sprint 2.2:

- **`proper-lockfile`** ([npm proper-lockfile][10]) — gold standard; updates
  mtime periodically, configurable stale threshold. Zero-deps cortex-x can't
  adopt it directly, but the pattern is identical to what `lock.cjs` already
  does. Generalization is mechanical: change `lockPath()` from
  `<slug>/.lock` to `<slug>/.locks/<worktree_id>.lock`, hold an array of
  acquired paths, release all on exit/error.
- **Orphan cleanup discipline**: on supervisor crash, worker tree locks are
  abandoned. Stale recovery via mtime catches this, BUT the worktree itself
  is also orphaned. Sprint 2.2 MUST add a `cortex-doctor` check that GCs
  worktrees whose lock is stale AND no PID exists (cross-check via
  `process.kill(pid, 0)` returning ESRCH). Bin already has
  `bin/steward/_lib/worktree-guard.cjs` — extend it.

### 7. DeepMind error amplification — context

The paper is **"Towards a Science of Scaling Agent Systems"** (Google
DeepMind, December 2025, [arxiv 2512.08296][11], [Google Research blog][12]).
Validated:

- **Independent topology amplifies errors 17.2×** vs single-agent baseline
  (no orchestrator, agents work parallel without communication).
- **Centralized topology contains amplification to 4.4×** — orchestrator acts
  as validation bottleneck.
- **180 configurations tested, 5 architectures** (Single, Independent,
  Centralized, Decentralized, Hybrid), 3 LLM families.

Critical nuance the 2026-05-08 anthill memo glossed:

- **Multi-agent HELPS on parallelizable tasks** (Finance-Agent: +80.9% over
  single via centralized). Cortex-x's `recommendation_harvest_parallel` is
  explicitly parallelizable-breadth-first — this is exactly the regime
  where the study found gains, NOT amplification.
- **Multi-agent HURTS on sequential reasoning** (PlanCraft: -39% to -70%
  across all multi-agent variants). Sprint 2.2 must NEVER apply
  worktree-supervisor to a sequential capability like
  `tech_debt_audit` or `senior_tester_review`.
- The "4-agent saturation threshold" cited in 2026-05-08 anthill memo
  appears in derived commentary ([Towards Data Science Jan 2026][13]) but
  I could not find it in the arxiv paper itself. **Treat as folklore until
  re-verified.** Sprint 2.2 ships with N=2, which is comfortably under any
  reasonable threshold regardless.

The paper's predictive model identifies the right architecture for 87% of
unseen tasks via task properties (tool count, decomposability) — this is
the lever for action_kind classification at runtime: cortex-x's
`action-kinds.cjs` registry should grow a `topology_safe: 'parallel' |
'centralized' | 'sequential_only'` field per kind.

## Decisions for Sprint 2.2 v0 implementation (MVP scope only)

- **Workers count: 2 for v0.** Anthropic's +90.2% used 3-5 but cost-per-run
  scales linearly; 2 establishes the pattern, validates judge prompt,
  exposes lock contention with minimal blast radius. Bump to 4 in Sprint
  2.3 only after observing 2-worker stability for 7 nightly runs.
- **Judge: same model as worker (Sonnet 4).** Smaller-as-judge unvalidated
  for code selection; same-tier is the published baseline.
- **Per-tree USD cap: $1.50.** Anthill memo proposed this; reaffirmed by
  the $47K incident's "$50 conversation cap" framing (cortex-x runs are
  ~10x cheaper than LangChain agents per turn). Two trees × $1.50 = $3
  max per supervisor invocation, fits inside existing $5 daily cap with
  margin for ≥1 retry.
- **Loop detector window: 3× repeat in 24h** for the *cross-tree* gate
  (new), in addition to keeping the existing 5x-in-7-days criterion_id
  gate untouched. Tighter window for parallel because amplification is
  faster (cf. $47K curve: week 1 → week 4 = 145× spend growth).
- **Topology field on action_kind registry:** add `topology_safe` field;
  only `recommendation_harvest_parallel` ships with `'parallel'` initially.
  All 16 existing kinds default to `'sequential_only'`.

## Recommendations for implementation (12 bullets)

1. **HARD: Worker payload schema is load-bearing.** Workers must return JSON
   `{ rationale, diff, cost_usd, test_result, criterion_evaluations[] }` —
   not free prose. Judge cannot compare apples to apples otherwise. Define
   the Zod schema in `bin/steward/_lib/llm-judge-schema.cjs` (file already
   exists; extend it).

2. **HARD: Cross-tree loop key.** The hash must be
   `sha256(action_kind + criterion_id + tool_input_canonicalized)` —
   canonicalization (sort keys, normalize whitespace, strip volatile fields
   like timestamps) is where this goes wrong. Reuse pattern from
   `bin/steward/_lib/recommendations.cjs` if present.

3. **HARD: Orphan worktree cleanup on crash.** Supervisor MUST install a
   `process.on('SIGTERM'|'SIGINT'|'uncaughtException')` handler that
   iterates acquired tree locks, `git worktree remove --force` each,
   release locks, then re-throws. Without this, a crashed supervisor
   leaves N orphans + N stale locks. `worktree-guard.cjs` is the right
   home.

4. **HARD: Judge position-bias randomization.** Shuffle worker outputs
   before prompting judge; record the mapping in journal. R2 reviewer
   will flag this if missed.

5. **HARD: Per-tree budget is enforced in-process.** Pass `WorkerBudget`
   by reference into the agent loop; post-call `addCostFields` increments
   it; pre-call check throws `WORKER_TREE_CAP_HIT`. Do not rely on Phoenix
   roundtrip.

6. **EASY TO GET WRONG: Worker `tools` array.** Omit `Agent` (SDK enforces
   depth-cap=2 only if absent). Forgetting this enables nested spawning
   and bypasses the protection.

7. **EASY TO GET WRONG: Supervisor system prompt leakage.** Subagents do
   NOT inherit parent system prompt. The worker prompt must self-contain
   everything (rubric, file paths, error context). Treat the supervisor →
   worker prompt as a hand-off contract.

8. **EASY TO GET WRONG: Judge sees worker rationale, not just diffs.**
   Code-judge agreement with humans peaks when judge has rubric + test
   results + rationale, not just code. Don't strip rationale to save
   tokens — that's exactly the field that drives correct selection.

9. **DEFER: Smaller-as-judge experiment.** Sprint 2.3 with explicit eval
   gate on a 20-task suite. Sprint 2.2 ships same-tier only.

10. **DEFER: Worker count > 2.** Reassess after 7 nightly runs of N=2.

11. **DEFER: `topology_safe` migration of existing 16 kinds.** v0 ships
    with field present but defaulted; subsequent sprints opt kinds in
    after task-property analysis.

12. **DEFER: Phoenix `worktree_id` span attribute.** Out of scope for v0
    MVP; Sprint 2.3 adds OTel tagging once supervisor↔worker is stable.

## Honest deferred uncertainty

- The DeepMind "4-agent saturation threshold" cited in 2026-05-08 memo is
  not in the arxiv paper I retrieved. Folklore, not load-bearing. N=2
  ships regardless.
- Per-tree USD cap of $1.50 has no published prior art; it's a synthesis
  of cortex-x's $5 daily cap and the $47K postmortem's "any cap" advice.
  First nightly week of data will reveal if it's too tight (workers fail
  on Sonnet-with-tools at $1.50) or too loose.
- The Anthropic +90.2% number is plausible but their internal eval is
  not public; treat as directional. cortex-x's own benefit will land
  somewhere between 0 and +90% on the `recommendation_harvest_parallel`
  task class; eval suite from Sprint 2.11.2 should measure it.

## Sources

- [1]: https://code.claude.com/docs/en/agent-sdk/subagents
- [2]: https://cursor.com/docs/configuration/worktrees
- [3]: https://github.com/ComposioHQ/agent-orchestrator
- [4]: https://www.anthropic.com/engineering/multi-agent-research-system
- [5]: https://dev.to/gabrielanhaia/the-agent-that-spent-47k-on-itself-an-autonomous-loop-postmortem-3313
- [6]: https://www.montecarlodata.com/blog-llm-as-judge/
- [7]: https://arxiv.org/html/2508.02994v1
- [8]: https://oneuptime.com/blog/post/2026-02-06-track-token-usage-prompt-costs-model-latency-opentelemetry/view
- [9]: https://agentgateway.dev/docs/kubernetes/main/llm/cost-tracking/
- [10]: https://www.npmjs.com/package/proper-lockfile
- [11]: https://arxiv.org/html/2512.08296v1
- [12]: https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/
- [13]: https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/
