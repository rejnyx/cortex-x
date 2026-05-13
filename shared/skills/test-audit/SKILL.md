---
name: test-audit
description: Deep QA-focused audit of an EXISTING codebase via cortex-x qa-retrofit prompt (P0 detect → P1 inventory → P2 4-agent ISO 25010:2023 + cortex extras → P3 human gate → P4 QA-specific research → P5 synthesis → P6 sample-test seeding opt-in). Produces senior-QA-consultant-grade testing strategy + prioritized gap backlog. Pairs with /audit (general 12-dim) but with a testing lens. Triggers (CZ+EN): "/test-audit", "test strategy review", "ohodnoť testy", "jak na tom jsou testy", "QA audit", "test coverage assessment", "review my tests".
disable-model-invocation: false
---

# /test-audit — Deep QA retrofit (cortex-x)

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words, counts-not-praise. Quality model grounded in `standards/testing.md` + `standards/correctness.md`.

You are running the cortex-x QA retrofit. Read and execute the prompt at `~/.claude/shared/prompts/qa-retrofit.md` from start to finish.

## Phase summary

| Phase | Goal | Output |
|---|---|---|
| P0 — Detect | Project type + test surface | `cortex/qa-context.md` |
| P1 — Test inventory | What tests exist + smell catalog | `cortex/qa/test-inventory.md` |
| P2 — Quality-model audit (4 parallel agents) | 9 ISO 25010:2023 chars + 3 cortex extras | `cortex/qa/AUDIT.md` |
| P3 — Human gate | 5 irreducible questions (business risk, incidents, compliance, off-limits, tester capacity) | folded into AUDIT.md |
| P4 — Auto-research | What does 2026 say about testing THIS stack? | `$CORTEX_DATA_HOME/research/<slug>-qa-<date>.md` |
| P5 — Synthesis | Strategy + prioritized gap backlog | `cortex/qa/testing-strategy.md` + `cortex/qa/testing-gaps.md` |
| P6 — Sample-test seeding (opt-in) | Top 3 P0 gaps as runnable tests | `tests/qa-retrofit/<gap-id>.test.*` |

## Flags

- `--seed-tests` → run Phase 6 (opt-in; otherwise skipped, summary surfaces top-3 candidates)
- `--no-research` → skip Phase 4 (use only audit + Phase 3 input for synthesis)
- `--asvs-level=N` → override compliance target (default: derived from Phase 3 Q3)
- `--token-budget=NNN` → repo-map renderer token budget (passes through to detector)

## Don't confuse with

- `/audit` (existing-project-audit) — general 12-dim audit (topology, security, observability, etc). Run BOTH for a comprehensive engagement; `/test-audit` is the testing lens specifically.
- `/start` (new-project) — green-field scaffold; testing is part of the initial sprint, not a retrofit
- `/scan` (project-scan) — quick 5-section institutional summary, NOT a deep audit

## Philosophy — AI-augmented tester, not replacement

The audit produces evidence (file:line, mutation scores, smell flags); a human QA evaluates which evidence maps to real business risk. Phase 3 asks 5 questions ONLY a human can answer. Phase 5 outputs a backlog, not a fix — the tester decides which P0 to tackle first.

Position: **a tester walks into a new project with a senior consultant's first-2-weeks deliverable already on disk.** They review it on day 1, not build it.

## On completion

- Print Phase 7 closing instructions per the prompt
- Suggest next: tackle P0 items in `cortex/qa/testing-gaps.md`, or paste prompt with `--seed-tests` to get sample tests for top 3 gaps

## Reference

- Full prompt: `~/.claude/shared/prompts/qa-retrofit.md`
- Profile: `~/.claude/shared/profiles/qa-engineer.yaml`
- Templates: `~/.claude/shared/templates/testing-strategy.md.hbs`, `~/.claude/shared/templates/testing-gaps.md.hbs`
- Sprint 2.10 R1 memo: `docs/research/sprint-2.10-qa-retrofit-2026-05-09.md` (rationale + cited research)
