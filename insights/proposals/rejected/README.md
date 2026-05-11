# Rejected proposals — learning material

> **Don't dump rejected proposals into a trash bin — collect them into an archive.** Rejected proposals are training data for meta-review (we see what the filter let through vs. what it shouldn't have).

## Why this folder exists

Research (Anthropic constitutional AI): self-improvement without retrospection on failures converges to "add more tests" genericity. We keep rejected proposals for three reasons:

1. **Audit trail** — why we rejected something
2. **Pattern learning** — when the same kind of proposal arrives 10× and is always rejected, that's a bug in the mining prompt
3. **Meta-review input** — every 30 insights, `cortex-thinker` reads `rejected/` to tune the evidence gates

## When proposals land here

- `cortex-evolve` Phase B.2 discards a candidate (min_support / projects / citations fail)
- `cortex-evolve` Phase B.3 LLM verdict = noise
- Operator closes PR with a reason
- Proposal exceeds the 7-day SLA without review → auto-close

## Format

```markdown
---
original_date: 2026-04-20
rejected_date: 2026-04-20
rejection_reason: min_support_fail | bonferroni_fail | no_citations | llm_noise | operator_dismissed | stale_sla
rejection_detail: "Only 2 events, threshold is 3"
---

<original proposal content>

## Rejection notes
<specifics — why it didn't clear the gate>
```

## Meta-review trigger

When this folder holds ≥10 rejected proposals, `cortex-thinker` reads them and writes `insights/META-rejections-<date>.md`:
- Top 3 rejection reasons
- Patterns in what gets rejected (often a bug in the mining prompt)
- Suggested tuning for `config/evolve.yaml`
