---
title: Cross-model transfer protocol — eval-suite gate for Steward improvement proposals
created: 2026-05-10
status: shipped (Sprint LR.7)
applies_to: any PR that modifies `prompts/**`, `standards/**`, `profiles/**`, or Steward `action_kinds`
based_on:
  - DGM cross-model transfer finding (sprint-brief-10-5.md §"Cross-model transfer test")
  - Operator brief P1.3 directive (`docs/research/cortex-x-sprint-brief-10-5.md` §P1.3)
  - Honest weakness #4 in `docs/positioning.md` § 4 (Anthropic / OpenRouter shape lock-in)
---

# Cross-model transfer protocol

> **Single-sentence rule.** Any cortex-x improvement proposal whose acceptance depends on eval scores MUST be evaluated on at least two models, and the transfer ratio MUST be ≥ 1.0 on the secondary model before the proposal can merge.

## Why this gate exists

Phase 5 self-improvement (`prompts/cortex-evolve.md`) opens PRs that propose changes to prompts, standards, or action_kind specs. Without a cross-model gate, "improvement" can mean *"this prompt now scores higher on the one model we tested it on"*, which is overfit, not progress.

The DGM paper measured this directly: a discovered agent improvement lifted o3-mini from 23 % → 33 % on Aider Polyglot AND lifted Claude 3.7 Sonnet from 19 % → 59.5 %. Improvements that transfer are real; improvements that don't are model-specific tuning hiding behind a higher number.

cortex-x ships against OpenRouter today (default model `deepseek/deepseek-v4-flash`) and the engine seam supports `mock / openrouter / claude-sdk / claude-cli`. The honest weakness in [`docs/positioning.md`](./positioning.md) §4 acknowledges that spec verifier + edit-ops format implicitly assume Claude-style structured output. This protocol is the regression test for that lock-in.

## Definition — transfer ratio

```
transfer_ratio = score_model_B_with_proposal / score_model_B_baseline
```

Where:

- `score_model_B_baseline` = eval suite score on model B against `main` (or the merge base) BEFORE the proposed change is applied.
- `score_model_B_with_proposal` = eval suite score on model B against the proposal branch AFTER the change is applied.
- Both runs use identical eval rubrics, identical step limits (`MIN_STEPS = 30` per [`evals/runner.md`](../evals/runner.md) § Aider-Polyglot lift discipline), and identical adversarial probes.

**Gate:** `transfer_ratio ≥ 1.0` on every secondary model in the required set. A proposal that lifts model A by 0.20 but drops model B by 0.05 is REJECTED — it is overfit to model A.

## Required model set

Every protocol-gated proposal MUST evaluate on at least:

| Slot | Model | Provider | Role |
|---|---|---|---|
| **A — baseline** | `deepseek/deepseek-v4-flash` | OpenRouter | The model cortex-x's Steward defaults to. Score on A is what users will actually experience. |
| **B — secondary** | `anthropic/claude-sonnet-4-6` | OpenRouter or Anthropic direct | Detects Claude-shape lock-in (positioning §4). |
| **B fallback** | `openai/gpt-5-mini` | OpenRouter | Acceptable substitute when Claude quota is exhausted. |

A proposal that runs only on model A is NOT eval-gated. It can ship as `experimental:` with a banner, but cannot claim "validated improvement."

### Why exactly these two architectures

- **DeepSeek + Anthropic** = different training corpora, different RLHF signals, different structured-output shapes. A proposal that works on both is unlikely to be lock-in.
- **DeepSeek + OpenAI** = same dynamic, different vendor. Acceptable second-best.
- **Two Anthropic models** (e.g. Sonnet + Opus) = NOT acceptable. Same family, same shape, defeats the purpose of the test.

## When this protocol applies

GATE-MANDATORY for proposals touching:

- `prompts/**` (the `human_only` paths in [`config/evolve.yaml`](../config/evolve.yaml) `human_only`)
- `standards/**`
- `profiles/**`
- `agents/**`
- Steward action_kind specs in `bin/steward/_lib/action-kinds.cjs`
- LLM-judge schemas in `bin/steward/_lib/llm-judge-schema.cjs`

GATE-OPTIONAL for:

- `templates/**` — text-only output; eval suite doesn't measure these.
- `tools/**` — internal tooling; eval-orthogonal.
- `tests/**` — eval suite IS the test, no recursion.
- `docs/**` — protocol regulates code/spec proposals, not documentation.

GATE-WAIVED (with explicit `eval_waiver:` block in the PR description) for:

- Hot-fixes for security vulnerabilities (waive eval, ship, eval after-the-fact within 7 days).
- Trivial typo / formatting edits with zero semantic effect.
- Schema migrations where the schema itself is the change (eval suite would compare apples to oranges).

## Cost budget

A full eval suite run on one model is ~$10-15 (per [`evals/runner.md`](../evals/runner.md) § Mode 2). Two models = ~$20-30 per gated proposal.

Monthly cadence (per `config/evolve.yaml` `cadence.monthly`) → 1 full cross-model run per month at ~$20-30. Quarterly checkpoint = $60-90/year. Acceptable.

For weekly Phase B insight proposals that touch human_only paths (rare): use the **DGM tiered approach** to manage cost — run on a 3-task subset first; if the subset transfer_ratio is ≥ 1.0, expand to full 10-task suite. If subset transfer_ratio < 1.0, reject without expanding (the proposal is already failing).

## Result schema additions

Extend [`evals/runner.md`](../evals/runner.md) § "Result file schema" with a `cross_model_transfer:` block:

```json
{
  "schema_version": "1.1",
  "type": "real-execution-cross-model",
  "models_evaluated": [
    "deepseek/deepseek-v4-flash",
    "anthropic/claude-sonnet-4-6"
  ],
  "tasks": {
    "eval-001": {
      "scores_per_model": {
        "deepseek/deepseek-v4-flash": 0.85,
        "anthropic/claude-sonnet-4-6": 0.78
      },
      "baselines_per_model": {
        "deepseek/deepseek-v4-flash": 0.80,
        "anthropic/claude-sonnet-4-6": 0.75
      },
      "transfer_ratios": {
        "deepseek/deepseek-v4-flash": 1.0625,
        "anthropic/claude-sonnet-4-6": 1.04
      }
    }
  },
  "cross_model_transfer": {
    "min_transfer_ratio": 1.04,
    "min_observed_on": "anthropic/claude-sonnet-4-6",
    "decision": "merge_allowed",
    "subset_first": false
  }
}
```

Decision values:
- `merge_allowed` — every secondary model has `transfer_ratio ≥ 1.0`.
- `merge_blocked` — at least one secondary model has `transfer_ratio < 1.0`.
- `merge_blocked_missing_run` — required secondary model was not evaluated. Fail-closed.
- `merge_allowed_subset` — DGM tier-1 subset passed; full suite not run; ship-ready only with explicit `subset_acceptance:` in PR.

## Failure modes

### Missing run = block (fail-closed)

If the result file lacks an entry for any required model, the gate is `merge_blocked_missing_run`. The PR is NOT mergeable. There is no implicit pass. This is the same posture as `eval_suite.required_score_threshold` in `config/evolve.yaml`.

### Quota exhaustion mid-run

If model B run fails partway (rate limit, provider outage), the result file MUST record `partial_run: true` and the PR gate stays `merge_blocked_missing_run` until completion. Do NOT extrapolate from completed tasks; transfer ratio is a per-suite measure.

### Score-only, no rubric

A run that produces a number but cannot tie it to the rubric (e.g., the LLM judge in `evals/senior-tester` errored out per Sprint 2.11.2 fail-closed contract) is treated as `merge_blocked_missing_run`, NOT as score 0. There is a difference between "the model failed the eval" and "we don't know what the model did."

## Integration with cortex-evolve

`prompts/cortex-evolve.md` § Phase C ("Monthly Refinement") § C.6 runs the gate on every refinement proposal that touches a GATE-MANDATORY path (above). A proposal failing the gate stays in `insights/proposals/` with `transfer_blocked: true` annotation, NOT auto-merged.

Phase B (weekly) proposals touching human_only paths are rare; when they happen, the gate fires there too, using the subset-first cost discipline.

## Operational checklist (per gated PR)

1. Identify model-A baseline result against the merge base. If absent, run baseline first.
2. Apply the proposal on the proposal branch.
3. Run eval suite on model A.
4. Run eval suite on model B (default: claude-sonnet-4-6; fallback: gpt-5-mini).
5. Compute per-task transfer ratios → take the minimum.
6. Write `evals/results/<date>-<commit>-cross-model.json` with the schema above.
7. Reference the result file in the PR description under § "Cross-model gate."
8. CI / human reviewer gates on `decision: merge_allowed`.

## What this protocol does NOT do

- It does NOT measure absolute capability — it measures whether a change is genuinely cross-model or model-specific.
- It does NOT replace [`evals/runner.md`](../evals/runner.md) — it stacks on top.
- It does NOT apply to Steward action runs themselves (those are gated by spec-verifier + runNpmTest at action time, not at proposal time).
- It does NOT eliminate Anthropic-shape lock-in — it surfaces it. Removing the lock-in is roadmap (Sprint 3.x onward).

## References

- DGM transfer test: [`docs/research/cortex-x-sprint-brief-10-5.md`](./research/cortex-x-sprint-brief-10-5.md) § "Cross-model transfer test" + § P1.3.
- Aider-Polyglot lift discipline (step limit + test-execution-before-scoring) — [`evals/runner.md`](../evals/runner.md) § "Aider-Polyglot lift discipline (Sprint LR.1.1)".
- Lock-in honest weakness: [`docs/positioning.md`](./positioning.md) § 4, weakness #4.
- Eval suite SSOT config: [`config/evolve.yaml`](../config/evolve.yaml) § `eval_suite`.
- Engine seam (mock / openrouter / claude-sdk / claude-cli): [`docs/steward-runtime.md`](./steward-runtime.md).
