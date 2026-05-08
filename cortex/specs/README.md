# cortex/specs/ — per-action_kind acceptance criteria

**Status**: scaffolded 2026-05-09 (placeholder), populated by Sprint 1.9.

## Purpose

Each shipped action_kind in [`bin/hermes/_lib/action-kinds.cjs`](../../bin/hermes/_lib/action-kinds.cjs) gets a paired `<kind>.spec.yaml` here. The spec declares **acceptance criteria** that must hold post-edit for the action to be considered successful.

`bin/hermes/_lib/eval-agent.cjs` (Sprint 1.9) loads the relevant spec at runtime and evaluates each criterion **after `npm test` passes**. Any criterion failure → `EDIT_SPEC_VIOLATION` → atomic rollback.

This generalizes Sprint 1.8.13's hardcoded content-preservation guardrail (`new content < 50% of existing → reject`) into a per-kind, per-criterion declarative pattern.

## Schema (provisional, finalized by Sprint 1.9 R1 research dispatch)

The exact YAML schema is **TBD pending R1 research dispatch on 2026-05-09** comparing GitHub Spec Kit, AWS Kiro, and EvalAgent (arXiv 2510.24358). Once decision memo lands at `docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md`, this README will be updated with the chosen schema.

Provisional shape:

```yaml
# cortex/specs/<kind>.spec.yaml
kind: recommendation
description: Standard cortex/recommendations.md item, LLM produces edits, gates on npm test, atomic commit, draft PR.

acceptance_criteria:
  - id: existing-file-not-truncated
    description: Edits targeting an existing file >= 200 bytes must not shrink it below 50% of original size.
    type: predicate
    runner: js
    code: |
      ({ existingSize, newSize }) => existingSize < 200 || newSize >= existingSize * 0.5

  - id: no-fabricated-history
    description: New content must not contain fabricated dates, sprint numbers, or version references that don't exist in git history.
    type: llm_judge
    judge_model: deepseek/deepseek-v4-flash
    prompt: |
      Given the diff below, identify any references to dates, sprint numbers, or
      versions that do not exist in the prior file content. Output JSON
      { "fabricated": boolean, "examples": string[] }.
    fail_on:
      - fabricated == true

  # ... per-kind criteria here
```

## Directory layout (post Sprint 1.9)

```
cortex/specs/
├── README.md                       (this file)
├── recommendation.spec.yaml        (LLM-driven file edits)
├── recommendation_harvest.spec.yaml
├── dep_update_patch.spec.yaml
├── todo_triage.spec.yaml
├── flaky_test_repair.spec.yaml
├── doc_drift.spec.yaml
├── lint_fix_shipper.spec.yaml
├── test_coverage_gap.spec.yaml
├── pr_review_responder.spec.yaml
└── _common.spec.yaml               (criteria shared across all kinds)
```

## Reference

- [`docs/hermes-roadmap.md`](../../docs/hermes-roadmap.md) § 3 Sprint 1.9 scope
- [`docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md`](../../docs/research/) — R1 decision memo (pending)
- [`bin/hermes/_lib/action-engine.cjs`](../../bin/hermes/_lib/action-engine.cjs) — current Sprint 1.8.13 hardcoded guardrail (will be replaced by spec criterion in Sprint 1.9)
