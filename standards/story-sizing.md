# Story Sizing — Rule 3

> One story = one context window. If it doesn't fit, split it.

Cortex-x scaffolds projects whose recommendation backlogs are consumed by autonomous agents (Steward, manual `/audit`, Ralph-style loops). Action items must be sized so an LLM can complete one in a single context window without losing track. Oversized stories are the single largest cause of false-success commits.

## Right-sized stories (one context window each)

- Add a database column + migration + type regen
- Add a UI component to an existing page
- Update a server action with new validation logic
- Add a filter dropdown to a list view
- Add a unit test for a single function
- Backfill missing JSDoc on one module
- Bump a single dependency + adjust 1–3 broken call sites
- Add one row of E2E coverage for an existing flow

## Too big — split before queueing

- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"
- "Migrate to TypeScript"
- "Add tests" (without scope qualifier)
- "Improve performance"
- "Modernize the codebase"

If a recommendation reads like a sprint goal, it's too big. Decompose into 5–15 right-sized stories before letting Steward (or any autonomous loop) touch it.

## Why this matters

LLM context windows are finite, and compaction is lossy. Geoffrey Huntley's Ralph pattern (2026) makes the case explicit: each iteration runs in a **fresh** context, so the prompt + state files must encode everything needed. If a story exceeds what fits, the agent partial-applies, hallucinates the rest, and emits a false success.

cortex-x enforces this in three places:

1. **Audit phase** — `prompts/existing-project-audit.md` Phase 5 generates recommendations explicitly bounded to single-context completion.
2. **Recommendations parser** — `bin/steward/_lib/recommendations.cjs` accepts items at `### N. Title` granularity; over-broad titles are an upstream defect.
3. **Acceptance verifier** — `bin/steward/_lib/spec-verifier.cjs` enforces per-kind acceptance criteria (`action-kinds.cjs`); criteria fail when a story attempts changes outside its declared scope.

## Sizing checklist (before adding to recommendations.md)

- [ ] Does it name **one** specific file or feature, not a whole subsystem?
- [ ] Can a senior dev describe the diff in **one sentence**?
- [ ] Does it pass tests after **one round** of edits, not multi-step interleaving?
- [ ] Is the verifier bounded (npm test on this file, not the whole suite re-architecture)?
- [ ] If split, are the pieces still meaningful on their own (each shippable as separate PR)?

A "no" on any item is a signal to split.

## When sizing is ambiguous

Default to splitting smaller. A 3-story chain that lands cleanly is always cheaper than one fat story that fails partial-applied and needs human untangling. Steward's atomic commit pipeline rolls back failed verifications, but the cost of the failed run (LLM tokens + human review of the noop branch) is non-zero.

## Reference

- Geoffrey Huntley — *Everything is a Ralph loop* (2026): explicit context-window-as-budget framing.
- snarktank/ralph README — concrete examples of right-sized vs oversized stories.
- `bin/steward/_lib/action-kinds.cjs` — per-kind acceptance criteria registry.
- `prompts/existing-project-audit.md` — Phase 5 recommendation generation prompt.
