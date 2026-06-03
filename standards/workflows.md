# Standard Workflows (dynamic multi-agent orchestration)

> Rule 3 process standard. cortex-x uses the Claude Agent SDK's dynamic Workflows
> primitive (`workflow.js` / `workflow.ts`) to compose multi-agent fan-out + fan-in
> patterns that go beyond what a single message of parallel `Agent` calls can express
> cleanly. This document specifies WHEN to reach for a workflow, when NOT to, how
> workflows compose with cortex hooks/Steward/Skills, the cost model, and the five
> authoring patterns that cover ~95% of cortex use cases.
>
> Status: shipped Sprint 2.44. Canonical examples live in `shared/workflows/`.
> Verified Sprint 2.44 — see `docs/sprint-2.44-hook-probes.md` for hook composition
> probes (the specific YES/PROBABLY-YES verdicts below are grounded in that probe
> matrix, not speculation).

## When to use

Decision tree — pick the orchestration primitive that fits the shape of the task,
not the one that "sounds powerful". Workflows are heavier than a single-message
fan-out; choose them only when the savings justify the overhead.

```
                          ┌─────────────────────────────────────┐
                          │  How many parallel agents do I need?│
                          └─────────────────────────────────────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
        N ≤ 6 agents              N > 6 agents              Multi-stage with
        AND task < 5 min          OR multi-stage with       explicit fan-in
        wall-clock                explicit fan-in           barrier required
              │                   barrier                           │
              ▼                           │                           ▼
   ┌──────────────────────┐               ▼                ┌──────────────────────┐
   │ Single-message Agent │      ┌──────────────────┐      │       WORKFLOW        │
   │ dispatch (parallel)  │      │     WORKFLOW      │     │  shared/workflows/*.js │
   │ ── less overhead ──  │      └──────────────────┘     └──────────────────────┘
   └──────────────────────┘
              │
              ▼
        Need autonomous nightly run + cron + commits?
              │
              ▼
        ┌──────────────────────┐
        │      STEWARD          │  workflows are session-bound, Steward isn't
        │  bin/steward/         │  (workflow = ephemeral, Steward = persistent)
        └──────────────────────┘
              │
              ▼
        Need interactive user-driven flow with state persistence?
              │
              ▼
        ┌──────────────────────┐
        │        SKILL          │  shared/skills/<name>/SKILL.md
        │ ── stateful, paused ─ │  workflows pause-resume, skills are user-paced
        └──────────────────────┘
```

Concrete numerical thresholds (R1.4 cost synthesis):

- **N ≤ 6 parallel agents AND total wall-clock < 5 min** → single-message
  multi-`Agent` dispatch in one assistant turn. The 6-agent R2 review pipeline as
  it shipped pre-2.44 is the canonical case: cost $3–20, wall-clock ~2–4 min,
  no fan-in barrier needed because the operator reads all six outputs directly.
- **N > 6 agents OR multi-stage with an explicit fan-in barrier** → workflow.
  Example: `/audit` (P0 detect → P1 repo-map → P2 4-lens parallel audit → P3
  human gate → P4 research → P5 synthesis → P6 ADR backfill) — six pipeline
  stages with fan-out at P2 and required barriers between every stage. Cannot
  be expressed as a single message because P2 cannot start until P1 returns.
- **Autonomous nightly + cron + commits** → Steward (`bin/steward/execute.cjs`).
  Workflows die when the session ends; Steward writes to disk, opens PRs, and
  resumes the next cron tick. Cron + dirty-tree-refusal + journal are
  Steward-shaped requirements, not workflow-shaped.
- **Interactive user-driven flow with state across multiple operator turns** →
  Skill (`shared/skills/<name>/SKILL.md`). Skills are paced by the operator
  ("phase 1 ok, continue"); workflows run to completion in one orchestrator
  turn (with optional pause-resume but not multi-day operator dialog).

## When NOT to use

Workflows have non-zero overhead — context plumbing, schema validation, the
orchestrator's own token cost, the runtime's worker-pool warmup. Skip them when:

- **Tight feedback loop on a single file.** If you're iterating on one file with
  one agent ("fix this bug → re-run test → fix the next bug"), workflow overhead
  dominates the work itself. Just call the agent directly in a normal turn. The
  orchestrator's schema validation and fan-in barriers add nothing here.
- **Mid-run user input required.** Workflows do not support `AskUserQuestion`
  mid-stream — once dispatched, they run to completion (or to a pause point you
  encoded as a phase boundary). If the agent needs the operator to choose
  between two paths halfway through, use a Skill (operator paces it) or break
  the work into two separate operator turns.
- **Fewer than 2 agents total.** A single agent in a single phase is just an
  `Agent` call. Wrapping it in workflow boilerplate is cargo-cult parallelism.
- **Persistent multi-day state.** Workflows are session-bound: when the Claude
  Code process exits, the workflow run is gone. If you need "harvest
  recommendations Monday, apply Wednesday, verify Friday," that's Steward
  (`bin/steward/execute.cjs`) with `recommendations.jsonl` as the persistent
  state ledger. See `docs/steward-runtime.md`.

## Composition with cortex hooks

**Critical empirical finding (Sprint 2.44):** workflow subagent dispatches DO
NOT trigger `~/.claude/settings.json` PostToolUse / PreToolUse hooks. This was
verified empirically — workflow run `wf_d2f0c3a4-2c7` ran 22 subagents on
2026-06-02; the cortex journal at `journal/2026-06-02-cortex-x.jsonl` shows
305 entries from main-session tool calls but ZERO entries with `tool=Task`
from the workflow dispatches. The cortex hook layer is correctly wired
(`post-tool-use.cjs:112` handles `tool_name=Task`; isolated probe test
T1–T4 all pass — see `docs/sprint-2.44-hook-probes.md`), but Claude Code's
workflow runtime uses an internal dispatch path that bypasses the hook
matchers in settings.json. This matches the R1.2 web-research evidence
(4 open GH issues: #34692, #45427, #54898, #5812).

| Cortex hook | Fires inside workflow? | Notes |
|---|---|---|
| `post-tool-use.cjs` (PostToolUse) | **NO — empirically verified Sprint 2.44** | Hook code path correctly handles `tool_name=Task` (probe T1–T4 pass against synthesized fixtures), but workflow runtime does not dispatch through the PostToolUse pathway. Journal blind to workflow tool calls. `cortex-usage` blind to workflow runs. |
| `block-destructive.cjs` (PreToolUse) | **NO — consequence of above** | Hook fires on Bash matcher only when settings.json hook stack receives the call. Workflow agent Bash bypasses this. Security gap — workflow agents could in principle run `rm -rf` without interception. Mitigation: never dispatch a workflow agent with raw destructive Bash; rely on `validateTargetDir`-style validation INSIDE workflow scripts. |
| `pre-commit-review-gate.cjs` | **NO marker propagation — workflow-driven R2 cannot satisfy the gate** | Marker is written by `post-tool-use` based on Task subagent_type, but Task calls don't reach PostToolUse from workflows. Workflow-driven commits should use `[skip-review]` in the commit message OR `CORTEX_REVIEW_GATE=0` env, with clear rationale that R2 ran via workflow not via main-session Agent dispatch. |
| `session-start.cjs` | **N/A** | Session-scoped, fires once before any workflow dispatch is possible. Workflows inherit session context. |
| `tirith-scan.cjs` | **N/A inside workflow agent Read** | Same bypass — workflow Read calls don't surface to PreToolUse. Operator must validate untrusted content INSIDE the workflow agent prompt (fence with `<untrusted>` tags + closing-tag-strip). |
| `auto-orchestrate.cjs` | **N/A inside a workflow** | UserPromptSubmit fires once before the workflow starts. The 3-fronta rule still applies to the workflow's *own* design (no >3 parallel branches without an explicit fan-in), but the hook does not re-trigger inside a running workflow. |

**Implication: workflows REQUIRE in-workflow safety discipline.** Cannot
rely on the cortex hook safety floor for workflow subagent operations. Author
workflows defensively:

1. **Path containment** — validate every path-like arg via string predicate
   (reject `..`, NUL, UNC, absolute outside target) BEFORE interpolation into
   agent prompts (`audit.js:validateTargetDir` pattern).
2. **Untrusted content fencing** — wrap every operator-supplied OR LLM-output
   string in `<untrusted source="...">...</untrusted>` delimiters before
   embedding in agent prompts (`r2-review.js:fenceUntrusted` pattern).
3. **Schema-validated returns** — every `agent()` call sites `schema:` option
   so malformed LLM returns surface as errors not silent UB.
4. **Operator-explicit commit gate bypass** — when committing workflow-driven
   diffs use `[skip-review]` + commit message rationale.

**Sprint 2.44.1 backlog:** Anthropic ticket / cortex workaround for hook
propagation. Until resolved, workflows are operationally a separate
trust domain from main-session tool calls.

## Cost economics

The token cost of a workflow is the sum of:

1. **Orchestrator context overhead** — the workflow script itself plus the
   meta/phase descriptors get sent to the model that runs the orchestrator (set
   by `meta.model`, default `sonnet` or `opus` per `~/.claude/settings.json`).
   Per-run baseline: 5K–15K tokens.
2. **Per-agent context** — each child `agent()` call has its own context window
   with the prompt + shared bundle + tools. There is no context sharing between
   parallel agents — each one re-pays the system-prompt cost. For the 6-agent
   R2 reviewer pipeline: ~10K–30K tokens per agent × 6 = 60K–180K total.
3. **Schema validation overhead** — Zod boundary on each agent return; cheap
   (<100ms wall-clock, 0 model tokens) but contributes to wall-clock if many
   agents return at once.
4. **Synthesis/judge phase** — fan-in agent receives all N child outputs. Cost
   scales linearly with N: 6 lens outputs × ~3K each = 18K judge input.

**Context-isolation benefit:** each workflow agent's context window is
independent, so workflows save *main session* tokens for downstream operator
work. If the main session already has 100K tokens of context, dispatching 6
review agents in a single message adds 60K–180K to the main session's
implicit context (the agent results come back into main context). A workflow
keeps that out of main — the orchestrator script summarizes and main only sees
the final `{findings:[...]}` payload.

**Fan-out vs barrier-free pipeline economics:**

- **Pipeline cheaper than parallel when stages are independent** (no idle wait).
  P0 → P1 → P2 with each stage taking ~30s = 90s wall-clock; running all three
  in parallel would still take 30s (best case) but if P1 depends on P0 output
  you cannot run them in parallel. Pipeline is the only correct shape there.
- **Parallel cheaper than pipeline when stages are independent but the operator
  needs all outputs simultaneously** (e.g. the 4-lens audit at P2 of `/audit` —
  architecture, security, testing, observability all read the same repo-map and
  produce independent findings). Parallel: max(t1, t2, t3, t4) ≈ 2 min.
  Pipeline: t1 + t2 + t3 + t4 ≈ 8 min.

**Concrete: 6 R2 review agents.**

- Via single-message multi-`Agent` dispatch: ~60K–180K total tokens, $3–20,
  wall-clock 2–4 min. Cost is paid against the main session's context limit.
- Via workflow (`shared/workflows/r2-review.js`): ~60K–180K total tokens (same
  cost — agents are the same), but the main session only re-ingests the synthesized
  findings payload (~5K tokens). Wall-clock is identical (~2–4 min).
- **Verdict:** for N=6 review agents the costs are approximately equal. Workflow
  wins when **N > 6** OR when **keeping main context clean for downstream work
  is critical** (e.g. you'll need 50K of free main context after the review to
  apply the fixes).

## Authoring patterns

Five canonical skeletons cover ~95% of cortex use cases. All five are
implemented in `shared/workflows/` and serve as starting points.

### Pattern 1 — Adversarial fan-out (R2 review)

Parallel over a reviewer roster + judge-based dedupe. Canonical example:
`shared/workflows/r2-review.js`.

```js
// shared/workflows/r2-review.js
export const meta = {
  name: 'r2-review',
  description: '6-lens parallel review + evidence-weighted judge + pass-2 dissent',
  whenToUse: 'non-trivial diffs (≥3 files, public API, security-adjacent)',
  phases: [
    { title: 'fan-out',    model: 'sonnet' },
    { title: 'synthesize', model: 'opus'   },
    { title: 'dissent',    model: 'opus'   },
  ],
  model: 'sonnet',
};

export default async function r2Review({ agent, parallel, context }) {
  const lenses = [
    { agentType: 'security-auditor',    prompt: securityPrompt    },
    { agentType: 'correctness-auditor', prompt: correctnessPrompt },
    { agentType: 'acceptance-auditor',  prompt: acceptancePrompt  },
    { agentType: 'ssot-enforcer',       prompt: ssotPrompt        },
    { agentType: 'blind-hunter',        prompt: blindPrompt       },
    { agentType: 'edge-case-hunter',    prompt: edgeCasePrompt    },
  ];

  // Phase 1 — fan-out (barrier required, judge needs all 6)
  const findings = await parallel(
    lenses.map(({ agentType, prompt }) => () =>
      agent(prompt(context), {
        label: agentType,
        phase: 'fan-out',
        schema: findingSchema,   // Zod boundary — R1.1
        agentType,
        // isolation:'worktree' NOT set — review agents are read-only
      })
    )
  );

  // Phase 2 — evidence-weighted judge (rank by read_set citations + reproducers,
  // NOT by majority count — avoids the Consensus Trap)
  const ranked = await agent(judgePrompt(findings), {
    label: 'consensus-judge',
    phase: 'synthesize',
    schema: judgeSchema,
    model: 'opus',
  });

  // Phase 3 — pass-2 dissent on HIGH findings with confidence < 0.80
  const uncertain = ranked.findings.filter(
    (f) => f.severity === 'high' && f.confidence < 0.80
  );
  const confirmed = await parallel(
    uncertain.map((f) => () =>
      agent(dissentPrompt(f), {
        label: 'dissent-critic',
        phase: 'dissent',
        model: 'opus',
      })
    )
  );

  return { findings: ranked.findings, dissent: confirmed, applied: false };
}
```

### Pattern 2 — Judge panel (parallel candidates + parallel judges + synthesis)

For decisions where you want N candidates and M judges scoring each. Example:
designer skill's "pick a hero variant" gate.

```js
export default async function judgePanel({ agent, parallel }) {
  // Stage A — produce N candidates in parallel
  const candidates = await parallel(
    ['variant-a', 'variant-b', 'variant-c'].map((variant) => () =>
      agent(candidatePrompt(variant), {
        label: `candidate-${variant}`,
        phase: 'generate',
        schema: candidateSchema,
      })
    )
  );

  // Stage B — score every candidate against every judge (N×M fan-out)
  const scores = await parallel(
    candidates.flatMap((cand) =>
      ['ds-conformance', 'visual-taste', 'a11y'].map((judge) => () =>
        agent(judgePrompt(cand, judge), {
          label: `${judge}-${cand.id}`,
          phase: 'judge',
          schema: scoreSchema,
        })
      )
    )
  );

  // Stage C — synthesis: aggregate scores per candidate, return winner
  return agent(synthPrompt(candidates, scores), {
    label: 'synthesis',
    phase: 'synthesize',
    schema: winnerSchema,
    model: 'opus',
  });
}
```

### Pattern 3 — Loop-until-dry (with dedup-vs-seen)

Iterative discovery: keep finding new items until the worker returns nothing new.
Used by `recommendation_harvest_parallel` action_kind.

```js
export default async function loopUntilDry({ agent }) {
  const seen = new Set();
  const all  = [];
  let round  = 0;

  // Workflows don't support unbounded loops well — cap by round count, not
  // by emptiness alone (R1.3 LangGraph turn-cap discipline).
  while (round++ < 8) {
    const batch = await agent(harvestPrompt(seen), {
      label: `harvest-round-${round}`,
      phase: 'harvest',
      schema: batchSchema,
    });

    const fresh = batch.items.filter((item) => !seen.has(item.id));
    if (fresh.length === 0) break;     // dry — stop

    fresh.forEach((item) => seen.add(item.id));
    all.push(...fresh);
  }

  return { rounds: round, items: all };
}
```

### Pattern 4 — Multi-modal sweep (different lenses per agent)

Each parallel branch attacks the same input with a different methodology. Used
by `/test-audit` (ISO 25010 + Bach HTSM + cortex extras as parallel lenses).

```js
export default async function multiModalSweep({ agent, parallel, context }) {
  const lenses = [
    { lens: 'iso-25010',     prompt: iso25010Prompt,    agentType: 'qa-auditor' },
    { lens: 'bach-htsm',     prompt: htsmPrompt,        agentType: 'qa-auditor' },
    { lens: 'tsdetect-fse20',prompt: tsDetectPrompt,    agentType: 'qa-auditor' },
    { lens: 'mutation',      prompt: mutationPrompt,    agentType: 'qa-auditor' },
  ];

  const reports = await parallel(
    lenses.map(({ lens, prompt, agentType }) => () =>
      agent(prompt(context), {
        label: `lens-${lens}`,
        phase: 'sweep',
        schema: lensReportSchema,
        agentType,
      })
    )
  );

  return agent(rollupPrompt(reports), {
    label: 'rollup',
    phase: 'synthesize',
    schema: rollupSchema,
    model: 'opus',
  });
}
```

### Pattern 5 — Pipelined fan-out (per-stage independence)

When stages depend on each other but within a stage agents are independent.
Canonical example: `shared/workflows/audit.js` (P0 → P1 → P2 fan-out → P3 → P4 → P5 → P6).

```js
export default async function audit({ agent, parallel, pipeline, context }) {
  // P0 — cheap classifier
  const detect = await agent(detectorPrompt, {
    label: 'p0-detect',
    schema: detectSchema,
    model: 'haiku',
  });

  // P1 — repo-map (single agent, depends on P0)
  const repoMap = await agent(mapPrompt(detect), {
    label: 'p1-repo-map',
    schema: repoMapSchema,
    model: 'sonnet',
  });

  // P2 — 4-dimension parallel audit (depends on P1 — fan-in barrier)
  const dimensions = ['architecture', 'security', 'testing', 'observability'];
  const dimReports = await parallel(
    dimensions.map((d) => () =>
      agent(auditPrompt(d, repoMap), {
        label: `p2-${d}`,
        phase: 'audit',
        schema: auditDimSchema,
        agentType: `${d}-auditor`,
        isolation: 'worktree',     // R1.5 EnterWorktree parity
      })
    )
  );

  // P3 — human gate (workflow pauses)
  const gate = await agent(gateSummaryPrompt(dimReports), {
    label: 'p3-human-gate',
    phase: 'pause',
    schema: gateSummarySchema,
  });

  // P4-P6 elided — see shared/workflows/audit.js
  return { detect, repoMap, dimReports, gate };
}
```

## Compatibility caveats

- **Deterministic-forbidden APIs.** `Date.now()`, `Math.random()`, and the
  `crypto.randomUUID()` family are unavailable inside workflow scripts (the
  runtime sandboxes them for replay determinism). Design around them: pass
  timestamps in via `context`, derive IDs from agent outputs, or use the
  workflow's own `run_id`.
- **Nesting depth limit = 1.** A workflow can dispatch agents, but a workflow
  cannot dispatch a child workflow that dispatches another workflow. The
  runtime throws at second-level nesting. If you need deeper composition,
  flatten to a single workflow with more phases.
- **Concurrent agent cap.** Empirically safe ceiling is ~`min(16, cpu_cores - 2)`
  concurrent agents. Design for ≤8 parallel branches to stay safe on
  typical operator laptops (8-core M-series, 16-core threadrippers). Past 8,
  scheduler contention and OpenRouter rate limits start dominating wall-clock.
- **Total agent cap per run.** 1000 agents per workflow run is the hard cap
  imposed by the runtime. Practical cortex workflows stay well under
  (largest current: `/audit` peaks at ~12 agents across all phases).

## Vendored workflow attribution

Per the Sprint 2.40 taste-skill pattern, every workflow file vendored from the
Anthropic SDK examples carries a license header and is enumerated in the
repo-root `NOTICE`. Paths and identifiers were translated to cortex-x naming
conventions during the vendor step (e.g. `anthropic.review` →
`cortex.r2-review`). Per-file header template:

```js
/*!
 * Adapted from Anthropic's Claude Agent SDK workflow examples.
 * Original: https://docs.claude.com/en/api/agent-sdk/workflows
 * License: MIT
 *
 * Cortex modifications: agentType roster mapped to shared/agents/, schemas
 * replaced with cortex-specific Zod boundaries, model defaults aligned with
 * Sprint 2.44 routing (sonnet for workers, opus for judge/synthesis).
 *
 * cortex-x changes: Apache-2.0 (see LICENSE).
 */
```

## Cross-references

- **`standards/sprint-pipeline.md`** — canonical 8-step sprint pipeline
  and the 5-phase workflow contract (Research → Synthesize → Implement →
  Review → Confidence). The phase shape that the cortex-sprint skill
  dispatches is owned there; this document only specifies the workflow
  primitive itself. See
  [standards/sprint-pipeline.md § Phase contract](./sprint-pipeline.md#phase-contract)
  for the canonical definition.
- **`standards/auto-orchestration.md`** — the 3-fronta rule (≤3 parallel
  branches without explicit fan-in) applies WITHIN workflow design too. A
  workflow with 8 parallel branches and no judge phase is still a 3-fronta
  violation even though it's "just one workflow file".
- **`standards/multi-agent-supervisor.md`** — the 6 safety contracts
  (turn-cap, context-bundle parity, schema validation, idempotency, halt
  propagation, journal-writing) apply to workflow orchestrators as
  unmodified contracts. A workflow is a multi-agent supervisor by another
  name.
- **`shared/workflows/r2-review.js`** — canonical adversarial-fan-out example.
- **`shared/workflows/audit.js`** — canonical pipelined-fan-out example.
- **Anthropic docs**: <https://docs.claude.com/en/api/agent-sdk/workflows>
- **Design synthesis**: `docs/sprint-2.44-workflows-design-synthesis.md`
- **Hook probes**: `docs/sprint-2.44-hook-probes.md` (the source of the
  YES/PROBABLY-YES verdicts in the hooks table above).
