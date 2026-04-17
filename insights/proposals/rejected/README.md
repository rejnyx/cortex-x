# Rejected Proposals — Learning Material

> **Neshromažďuj zamítnuté návrhy do koše — shromažďuj je do archivu.** Rejected proposals jsou training data pro meta-review (vidíme co filter pustil vs neměl).

## Proč tento folder existuje

Research (Anthropic constitutional AI): self-improvement bez retrospekce na failures → konverguje k "add more tests" genericitě. Držení rejected proposals se třemi důvody:

1. **Audit trail** — proč jsme něco odmítli
2. **Pattern learning** — když stejný typ návrhu přichází 10× a vždy se odmítne, je to bug v mining promptu
3. **Meta-review input** — každých 30 insights cortex-thinker čte rejected/ aby tuning evidence gates

## Kdy se sem ukládá

- cortex-evolve Phase B.2 discards kandidáta (min_support/projects/citations fail)
- cortex-evolve Phase B.3 LLM verdict = noise
- Dave closes PR s reason
- Proposal prošel 7d SLA bez review → auto-close

## Format

```markdown
---
original_date: 2026-04-20
rejected_date: 2026-04-20
rejection_reason: min_support_fail | bonferroni_fail | no_citations | llm_noise | dave_dismissed | stale_sla
rejection_detail: "Only 2 events, threshold is 3"
---

<original proposal content>

## Rejection notes
<specifics — why it didn't clear the gate>
```

## Meta-review trigger

Když folder má ≥10 rejected proposals, cortex-thinker čte je a píše `insights/META-rejections-<date>.md`:
- Top 3 rejection reasons
- Patterns v tom co se odmítá (často = bug v mining promptu)
- Suggested tuning for `config/evolve.yaml`
