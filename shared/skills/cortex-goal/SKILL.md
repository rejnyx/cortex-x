---
name: cortex-goal
description: Plan-first wrapper for Claude Code's native /goal slash command. Produces a structured cortex-disciplined plan (brief · scope · DoD · acceptance criteria mirroring cortex spec-verifier kinds · R1+R2 discipline embedded) that the operator hands to native /goal. Useful for autonomous overnight runs, multi-hour focused sessions, weekly-token-frontload before rate-limit reset, and any task with a clear acceptance frontier and turn budget. Triggers (EN+CZ) "/cortex-goal", "cortex goal", "run long task", "autonomous session", "overnight", "use my unused tokens", "execute this overnight", "weekend run", "vyřeš to autonomně", "dělej dokud nehotovo", "běhej v noci", "dlouhá session", "úkol na celý víkend". Composes with /goal native, not replaces it — cortex authors the plan, Claude Code runs the haiku verifier loop.
disable-model-invocation: false
---

# /cortex-goal — plan-first wrapper for Claude Code's native `/goal`

You are operating inside cortex-x. Goal: interview the operator (3 questions), render a structured plan, write it to `cortex/goal-<slug>.md`, and surface the exact `/goal` command for the operator to paste. **Do not run the haiku-verified loop yourself** — that's Claude Code's native feature.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words. Counts not praise. Match operator's language (Czech/English) from prior turns.

## Step 1 — language signal

Read prior-turn language. Czech → answer Czech. English → answer English. Mixed → default to operator's mother tongue (Czech if ambiguous in cortex-x context).

## Step 2 — read the full prompt

The interview discipline + 4 phases + template hydration rules + anti-patterns are codified in [`prompts/cortex-goal.md`](../../../prompts/cortex-goal.md). Read it once before Phase 1. The prompt is the SSOT; this SKILL.md just routes you there.

## Step 3 — execute phases per the prompt

Phase 1 (3 questions: goal, scope, turn budget) → Phase 2 (render template) → Phase 3 (default R1+R2 acceptance criteria) → Phase 4 (write file + report).

The template lives at [`templates/cortex-goal-plan.md.hbs`](../../../templates/cortex-goal-plan.md.hbs). Hydrate it with detected stack + operator answers.

## Step 4 — exit

When the file is written, you're done. Report:

- Path (`cortex/goal-<slug>.md`)
- Line count of the rendered plan
- Exact `/goal` invocation to paste

Do not invoke `/goal` yourself.

## When NOT to use this skill

- **Cron / unattended overnight maintenance** — use Steward (`docs/steward-runtime.md`). `/goal` is session-scoped; Steward is cron-scoped.
- **Quick one-off task <30 min** — use `/start` (Phase 1-3 plan) not `/cortex-goal`.
- **Just asking a question** — answer directly, no plan needed.

## Composes with

- [`prompts/cortex-goal.md`](../../../prompts/cortex-goal.md) — full interview + render logic (SSOT)
- [`templates/cortex-goal-plan.md.hbs`](../../../templates/cortex-goal-plan.md.hbs) — plan template
- [`prompts/95-confidence.md`](../../../prompts/95-confidence.md) — Phase 1 interview discipline
- [`standards/coding-behavior.md`](../../../standards/coding-behavior.md) §Goal-Driven Execution — Rule 1.5 binding
- [Claude Code `/goal` docs](https://code.claude.com/docs/en/goal) — native command this wraps
