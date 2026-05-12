# Web Research — Rule 3 standard

> **R1 "Research-before-implement" codified as a written standard.** Previously a social contract in `docs/steward-roadmap.md` §1 and an operator-memory discipline; this file makes it harness-enforceable.

## Why this is Rule 3

cortex-x assumes Claude's training cutoff is **older than the relevant external state** for most non-trivial tasks. Framework versions, library APIs, CVEs, regulatory thresholds, and design trends move faster than any model release. **Implementing against stale assumptions = the dominant correctness failure for AI-assisted dev work.**

The fix is not "model with newer cutoff." The fix is **always dispatch web research before committing to an implementation path** when external state matters.

## The contract

1. **Dispatch a parallel research subagent BEFORE implementation** when the task touches any of:
   - Framework version, library API, package manager, CLI tool
   - Security advisory, CVE, vulnerability scanner output
   - Regulatory threshold (privacy law, accessibility law, financial rule)
   - Industry best practice or design trend
   - Standards / specs that evolve (WCAG, ECMAScript, HTTP, OWASP)
   - Anything where "what does X do today?" might differ from training data

2. **Cache the result** under `$CORTEX_DATA_HOME/research/<topic>-<YYYY-MM-DD>.md` with three-hop citation traceability (claim → finding ID → source URL).

3. **Cite URLs** in the implementation diff or research memo. No "based on what I recall from training."

4. **Respect budget caps** in `~/.claude/shared/config/research.yaml`: max 3 parallel research agents per session, max 10 web fetches per agent, per-topic TTL 14 days for cached results.

## When research does NOT fire (anti-triggers)

- Pure refactoring inside the current repo (no external dependency change)
- One-line bug fix with reproducer
- Operator says `--no-research` or sets `CORTEX_OFFLINE=1`
- Already-cached recent result exists (`$CORTEX_DATA_HOME/research/`) — `--force-research` to bypass
- Task is entirely about cortex-x itself (cortex-x knows its own state)

## Where this is wired

| Surface | Behavior |
|---|---|
| `templates/CLAUDE.md.hbs` § Web research | Every scaffolded project gets the default-research teach |
| `~/.claude/CLAUDE.md` (global) | Same paragraph injected into the user's global Claude memory |
| `shared/hooks/auto-orchestrate.cjs` | Detects implementation-keyword prompts (`build`, `implement`, `add`, `create`, `refactor`, `migrate`) and emits a 3-phase research-reminder if no cached result is found |
| `shared/hooks/session-start.cjs` | Surfaces capability tip (incl. web research) on first session per 18h |
| `prompts/new-project.md` Phase 2 + 5 | Mandatory research dispatch |
| `prompts/existing-project-audit.md` Phase 4 | Mandatory research dispatch |
| `prompts/qa-retrofit.md` Phase 4 + per-gap | Mandatory research dispatch |
| `prompts/retrofit.md` Phase 0.5 | **Mandatory research dispatch for non-`/audit` chained invocations** (added Sprint LR.B+) |
| `shared/skills/designer/SKILL.md` Phase 0.5 | Research current design trends + a11y standards before generating variations (added Sprint LR.B+) |
| `shared/skills/cortex-help/SKILL.md` | Web research listed as discoverable capability (added Sprint LR.B+) |
| `bin/steward/_lib/research-trigger.cjs` | Steward nightly cron triggers research before risky `dep_update_patch` or security-touching edits |

## Discovery surface for end users

When a fresh user asks Claude "what can cortex-x do?", the response should mention web research as a **default behavior**, not an obscure capability. Three reinforcing surfaces:

1. **`/cortex-help`** lists web research as an invokable capability with the line "*cortex defaults to dispatching research subagents on external-state tasks*"
2. **Session-start nudge** (once per 18h) mentions web research alongside `/cortex-help` and `capabilities.md`
3. **Scaffolded project CLAUDE.md** has its own § Web research section so the teach travels into every cortex-x-bootstrapped repo

## Enforcement (R2 review pipeline)

The `correctness-auditor` agent flags any PR that:
- Implements against a library version without citing a research memo
- References a "best practice" without a URL
- Changes a security-touching path without consulting CVE feeds

Severity: **HIGH** when the audit catches a missing research dispatch on a touched-by-time-decay surface.

## Cost / budget

| Surface | Default cap | Enforcement |
|---|---|---|
| Per-session web research budget | 3 parallel agents × 10 fetches = 30 web hits | **operator discipline** (Sprint 3.X will harness) |
| Per-week budget | 10 research dispatches | **operator discipline** |
| Cache TTL | 14 days per topic | **operator discipline** (filename mtime is the contract) |
| Bypass | `--force-research` flag · `CORTEX_RESEARCH_BUDGET_DISABLED=1` env | reserved keywords; no enforcement layer yet |

> **Honesty note:** these caps are **documented expectations**, not harness-enforced limits. The `~/.claude/shared/config/research.yaml` knobs live in the repo (Sprint 2.14 R1) but no runtime loader consumes them yet. Sprint 3.X `web_research_dispatch` action_kind will wire the budget gate end-to-end. Until then: the operator is the gate. Token-cost guardrails for *all* Steward agentic spend (multi-window cost-safety, Sprint 1.9.1) still apply globally and will surface high research-spend in the daily cap.

## Related

- Original motivation memo: `docs/research/sprint-research-self-invoking-and-research-default-2026-05-10.md`
- Protocol details: `shared/research-protocol.md`
- Trigger detector library: `bin/steward/_lib/research-trigger.cjs`
- Action_kind for nightly cron dispatch: planned Sprint 3.X `web_research_dispatch`
