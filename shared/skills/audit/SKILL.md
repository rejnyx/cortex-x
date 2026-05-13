---
name: audit
description: Deep 12-dimension audit of an EXISTING codebase via cortex-x existing-project-audit prompt (P0 detect → P1 repo-map → P2 4-agent audit → P3 human gate → P4 research → P5 synthesis → P6 ADR backfill opt-in). Saves AUDIT.md, recommendations.md, repo-map.md, and optional retroactive ADRs to cortex/ in the project. Auto-primed by SessionStart hook when .cortex-bootstrap-pending marker is mode=existing. Triggers (CZ+EN): "/audit", "audit my project", "audituj projekt", "co je v tomhle projektu", "prozkoumej kódbázi", "review this repo", "what does this codebase do".
disable-model-invocation: false
---

# /audit — Deep existing-project audit (cortex-x)

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words, counts-not-praise. Phase 4 research follows `standards/web-research.md` citation discipline; AUDIT.md uses `[cortex/recall]` + `[^cN]` footnotes when grounded in cortex memory.

You are running the cortex-x existing-project deep audit. Read and execute the
prompt at `~/.claude/shared/prompts/existing-project-audit.md` from start to
finish.

## Phase summary

| Phase | Goal | Output |
|---|---|---|
| P0 — Detect | What kind of project is this? | `cortex/audit-context.md` |
| P1 — Repo map | What's the symbol-level shape? | `cortex/MEMORY/repo-map.md` |
| P2 — Audit (4 parallel agents, 12 dims) | Where are the bones, hot spots, gaps? | `cortex/AUDIT.md` |
| P3 — Human gate | What CAN'T be derived from code | 5 questions, folded into AUDIT.md |
| P4 — Auto-research | What does 2026 say about this stack? | `$CORTEX_DATA_HOME/research/<slug>-audit-<date>.md` |
| P5 — Synthesis | What should we DO? | `cortex/recommendations.md` + CLAUDE.md patches |
| P6 — ADR backfill (opt-in) | What past decisions deserve documentation? | `cortex/decisions/ADR-*.md` |

## Flags

- `--backfill-adrs` → run Phase 6 (otherwise skipped, audit summary surfaces detected count)
- `--token-budget=NNN` → repo-map renderer token budget (default 1500)
- `--no-research` → skip Phase 4

## On completion

- Delete `.cortex-bootstrap-pending` marker (if present)
- Print Phase 7 closing instructions per the prompt
- Suggest `/retrofit` as the natural next step (apply cortex-x patterns informed by the audit)

## Don't confuse with

- `~/.claude/shared/prompts/project-scan.md` — quick 5-section institutional summary, populates `$CORTEX_DATA_HOME/projects/<slug>.md`. Different scope.
- `~/.claude/shared/prompts/retrofit.md` — APPLIES cortex-x patterns. Best run AFTER `/audit` so it has `cortex/AUDIT.md` to ground decisions.

## Reference

Full prompt: `~/.claude/shared/prompts/existing-project-audit.md`
Sprint 1.5 design rationale: `$CORTEX_HOME/docs/sprint-1.5-design.md` §2.3
