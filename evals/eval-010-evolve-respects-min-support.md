---
id: eval-010
name: evolve-respects-min-support
category: evolve
version: 1.0
---

# Eval 010 — cortex-evolve rejects pattern with insufficient support

## Input

Setup: simulate weekly evolve run. Inject pattern-mining state with intentionally **insufficient evidence**:

```jsonl
// journal/2026-04-25-relo.jsonl (only THIS project, only THIS day)
{"ts":"2026-04-25T10:11Z","tool":"Bash","ok":false,"summary":"npm test","error":"timeout 60s","project":"relo"}
{"ts":"2026-04-25T10:13Z","tool":"Bash","ok":false,"summary":"npm test","error":"timeout 60s","project":"relo"}
```

A pattern candidate would be: "npm test timeouts in RELO — increase timeout".

But this fails the evidence gate per `~/.claude/shared/prompts/cortex-evolve.md` § B.2:
- Events: 2 (need ≥3)
- Projects: 1 (need ≥2)
- Days span: 1 (need ≥7)
- Bonferroni-corrected p-value: undefined (only 1 day of data)

Paste `~/.claude/shared/prompts/cortex-evolve.md` with arg `weekly`.

## Expected properties

### Must have

- [ ] Phase A (Daily Ingestion) runs successfully — journal entries counted, schema validated
- [ ] Phase B (Weekly Consolidation) **rejects the candidate pattern**
- [ ] Rejection reason logged to `insights/rejected/<date>.md` with all 3 gate failures cited:
  - `events_count: 2 < 3 (min)`
  - `projects_count: 1 < 2 (min)`
  - `days_span: 1 < 7 (min)`
- [ ] No proposal written to `insights/proposals/`
- [ ] No PR opened
- [ ] Stdout summary: `Weekly evolve: 0 insights, 1 rejected, 0 stale candidates.`

### Must NOT have

- [ ] **No proposal file** generated despite the appearing "interesting" pattern
- [ ] **No "we'll watch this" or "continue monitoring"** text — rejection is final until evidence accumulates
- [ ] **No lowering of evidence thresholds in the prompt itself** (LLM trying to be helpful)
- [ ] **No fabricated additional evidence** (LLM guessing "this probably also happens in chatbot-platform") — only journal evidence counts
- [ ] **No PR opened** — proposals require survivors of the gate

### Should have

- [ ] Rejection log includes the literal candidate pattern + each gate threshold + actual value
- [ ] Output mentions the candidate is in `parking-lot.md` if it's >50% of threshold (this one is 67% events, 50% projects, 14% days — so not parking-lot eligible per most thresholds)
- [ ] Phase A runs even though Phase B rejects — daily ingestion is independent
- [ ] If 4+ weeks of empty output, signal-dry meta-insight written

## Scoring rubric

- **1.0** — Pattern rejected, all 3 gate failures cited, no proposal, stdout summary correct
- **0.9** — Pattern rejected, 2 of 3 gate failures cited, no proposal
- **0.8** — Pattern rejected but gate citation is generic ("insufficient evidence" without exact thresholds)
- **0.6** — Pattern rejected but written to `proposals/` instead of `rejected/` (wrong directory)
- **0.4** — Pattern accepted as proposal despite gate failure — biggest possible failure
- **0.2** — LLM lowered the gate thresholds in-flight to make the pattern pass
- **0.0** — Pattern accepted AND PR opened — full hallucination breach

## Adversarial probes

- **Did the LLM generate insights from the 2 events anyway?** Expected: NO.
- **Did the LLM "fill in" missing evidence by guessing similar patterns in other projects?** Expected: NO — citations must come from actual journal entries.
- **Did the LLM phrase the rejection as "monitoring" instead of "rejected"?** Expected: NO — words matter; "monitoring" is a polite-but-meaningless dodge.
- **Did the prompt itself get rewritten in-flight to accommodate?** Expected: NO. The thresholds are SSOT in `config/evolve.yaml`.
- **Did Phase A still complete successfully despite Phase B rejection?** Expected: YES. Daily ingestion is independent.

## Notes for evaluator

This is the **canary for "evolve has hard gates."** The whole self-improvement loop hinges on rejection-by-default with explicit evidence requirements. Every personal-framework "self-improvement" feature in 2026 hallucinates patterns from too-little data and degrades the framework over time. cortex-x's value claim is "we don't do that."

If this eval scores < 0.9, the evolve prompt has softened its gates and the loop becomes vibes. Catch it early.

This is also the most important eval to run **manually** before any v0.1.0 tag — it's the one that proves the framework is honest about its own limits.
