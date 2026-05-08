# docs/research/ — per-sprint R1 decision memos

**Status**: scaffolded 2026-05-09. Populated by per-sprint R1 research dispatches.

## Purpose

`docs/steward-roadmap.md` Operating Principle **R1** mandates a focused web-research dispatch before every sprint moves from "planned" to "in-progress." Each dispatch produces a structured **decision memo** that lives here.

The memo:
- Captures SOTA-as-of-the-day for the sprint's domain
- Compares 2-4 implementation options
- Recommends one with explicit rationale
- Lists open questions for operator decision
- Becomes the binding spec for that sprint's scope

**The 2026 frontier shifts in weeks.** Cached research from a month ago is unreliable. R1 ensures every sprint starts from current SOTA.

## File naming convention

```
docs/research/sprint-<num>-<topic-kebab>-<YYYY-MM-DD>.md
```

Examples (some pending, some shipped):

```
sprint-1.9-spec-driven-verification-2026-05-09.md      (pending — running)
sprint-2.0-langfuse-self-hosted-2026-05-XX.md
sprint-2.0b-routellm-cheap-ensembles-2026-05-XX.md
sprint-2.1-hermes-autoresearch-overnight-2026-05-XX.md
sprint-2.2-worktree-supervisor-judge-2026-05-XX.md
sprint-2.3-mutation-testing-fitness-2026-05-XX.md
sprint-5.1-soul-abstraction-2026-XX-XX.md
sprint-3.0-alphaevolve-prompt-evolution-2026-XX-XX.md
sprint-3.1-self-extending-capabilities-2026-XX-XX.md
```

## Memo template

```markdown
# Decision Memo: Sprint X.Y — <Topic>

## Question
[One sentence: what decision must be made?]

## Context
[Why does this matter for cortex-x specifically? Reference incident, capability gap, or roadmap dependency.]

## Sources Checked
- [URL with brief description]
- [URL with brief description]
- ...

## Options Considered

### Option A: <Name>
[Pros, cons, fit with cortex-x architecture.]

### Option B: <Name>
[Pros, cons, fit.]

### Option C: <Name>
[Pros, cons, fit.]

### Option D: Bespoke / hybrid
[Pros, cons.]

## Decision (recommended)
[Concrete recommendation. Single option or hybrid. Rationale grounded in sources + architecture fit.]

## Tradeoffs
[What we gain, what we lose vs each rejected option.]

## Implementation Impact
- Files to add: [list]
- Files to modify: [list]
- New module/class names: [list]
- Test file count estimate: [N]
- Effort confirmation: [S/M/L/XL T-shirt]

## Failure Mode Taxonomy
[List of error codes the sprint should add, with when each fires.]

## Acceptance Criteria for the Sprint Itself
[Bullet list. What must be true for this sprint to be "done"?]

## Follow-up Tasks
[Subsequent sprints unlocked by this one. API surface promises that downstream sprints depend on.]

## Open Questions for Operator
[Numbered yes/no or A/B questions that operator must answer before implementation begins.]
```

## Reference

- [`docs/steward-roadmap.md`](../hermes-roadmap.md) § 1 Operating Principle R1
- [`docs/steward-roadmap.md`](../hermes-roadmap.md) § 7 Per-sprint workflow ritual
