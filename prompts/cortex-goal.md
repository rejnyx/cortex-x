# /cortex-goal — plan-first wrapper for Claude Code's native `/goal`

> You are operating inside cortex-x, a Claude Code framework. This prompt produces a structured plan that the operator hands to Claude Code's native `/goal` command. **Do not run the goal loop yourself.** Claude Code provides the haiku verifier; cortex-x provides the plan.

## What this prompt does (and explicitly does not)

| ✅ This prompt | ❌ This prompt |
|---|---|
| Interviews operator (3 questions: goal, scope, budget) | Reimplements `/goal` loop |
| Renders structured plan to `cortex/goal-<slug>.md` | Invokes `/goal` itself |
| Embeds R1 (research) + R2 (review pipeline) as DoD acceptance criteria | Triggers haiku evaluation |
| References cortex spec-verifier 6 criterion kinds | Cron-schedules /goal (use Steward for cron) |

When the plan file is written, **the prompt's job is done.** Tell the operator the exact `/goal` command to copy-paste, and exit.

## Voice charter

[`standards/voice.md`](standards/voice.md). No greetings, no emoji, no emotion words. Mirror operator's language (Czech / English). One sentence of identity at top, never re-asserted.

## Phase 1 — Three-question interview

Ask exactly three questions, one at a time, in operator's language. Wait for each answer before the next.

1. **Goal** — "Co má `/goal` vyřešit? Stručně, jako kdyby to byla zadávací věta v issue trackeru." / "What is the goal? Phrase it like a Linear ticket title + one-line scope."
   - If answer >4000 chars total, ask operator to compress (Claude Code's native `/goal` caps the condition at 4000 chars).

2. **Scope edges** — "Co JE v rozsahu a co NENÍ? Aspoň 2 in-scope, 2 out-of-scope položky." / "What's in scope, what's out? At least 2 in-scope, 2 out-of-scope items."
   - Operator can answer "use detected defaults" → infer from current branch + git log + recommendations.md.

3. **Turn budget** — "Kolik turn-ů max? (default 30 pro M task, 60 pro L, 100 pro overnight)" / "Turn budget cap? (default 30 / M, 60 / L, 100 / overnight)"
   - Hard ceiling: 200 turns. Above that, suggest breaking into multiple `/goal` sessions.

Apply the cortex 95%-confidence prompt fragment ([`prompts/95-confidence.md`](prompts/95-confidence.md)) — if you're <95% confident on any answer's interpretation, ask one clarifying follow-up before proceeding.

## Phase 2 — Render plan

Hydrate [`templates/cortex-goal-plan.md.hbs`](templates/cortex-goal-plan.md.hbs) with:

- `title` — Title-Case of goal (≤60 chars).
- `slug` — kebab-case of title (≤40 chars, no special chars).
- `date` — `YYYY-MM-DD` (today's date in operator's locale).
- `brief` — verbatim Phase-1 Question-1 answer.
- `stack` — detected from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` via cortex detectors (or "TODO: stack" if detection fails).
- `in_scope` / `out_of_scope` — Phase-1 Question-2 answer, normalized to bullet items.
- `dod` — derive 3-6 concrete verifiable conditions from `brief`. Each MUST be checkable by reading code or running a single command. Forbid "improve X", "make X better", "X feels right" — those are aspirational, not DoD.
- `acceptance_criteria` — translate each DoD into a cortex spec-verifier `kind`:
  - File exists / matches pattern → `file_predicate`
  - Test passes / command exits 0 → `shell`
  - Source contains specific identifier / lacks anti-pattern → `regex` or `read_set`
  - Behavior matches EARS spec ("When X, the system shall Y") → `ears_text`
  - Quality dimension Claude can read but not regex → `llm_judge`
- `turn_budget` — Phase-1 Question-3 answer (clamp to [10, 200]).
- `risks` — name 2-4 risks from your read of the brief + stack. Examples: "test suite has flakies that cap iteration speed", "RLS policies for new tables not auto-generated", "GUI verification requires Chrome DevTools MCP not installed".
- `open_questions` — anything Phase 1 left ambiguous. If none, write `- None — proceed.`
- `references` — populate from:
  - Existing `$CORTEX_DATA_HOME/research/*.md` related to topic (last 30 days)
  - Standards that bind the goal (e.g., touching API → `standards/security.md`)
  - Claude Code `/goal` docs: https://code.claude.com/docs/en/goal
  - Optional Ralph Loop reference if the goal is long-running: https://claude.com/plugins/ralph-loop

## Phase 3 — Default acceptance criteria (R1+R2 discipline)

The template auto-includes 4 default acceptance criteria (R1.web-research, R2.review-pipeline, R3.tests-green, R4.no-secrets). **Do not remove them** unless operator explicitly opts out. Their presence is what makes a cortex `/goal` plan different from a vanilla `/goal` plan — the haiku verifier checks these every turn, so the long-running loop never drifts off-discipline.

If operator wants to opt out of any default criterion, ask once: "you want to suppress R<N>; reason?". Capture the reason in the `risks` block so it's auditable.

## Phase 4 — Write the file and exit

1. Write the rendered plan to `cortex/goal-<slug>.md` (create `cortex/` if missing).
2. Surface the exact `/goal` invocation:
   ```bash
   claude -p "/goal execute plan at cortex/goal-<slug>.md until all DoD items pass and acceptance criteria all verify green. Resume on /goal evaluation."
   ```
3. Optional addendum if turn_budget ≥ 60:
   "Tato session poběží řádově hodiny. Zvaž `/loop 30m claude -p '/goal ...'` pro průběžný cache-refresh, nebo nech to běžet v jednom `--continue` řetězci."
4. Report file path + line count + next-step. Done.

## Anti-patterns (what NOT to do)

- ❌ Don't fire `/goal` yourself. The operator types it.
- ❌ Don't run the haiku evaluation loop. Claude Code does that.
- ❌ Don't write a plan ≤3 DoD items — too vague to verify. Re-interview.
- ❌ Don't write a plan ≥10 DoD items — too broad; suggest splitting into 2 goals.
- ❌ Don't omit references. Even if "no R1 needed", cite the official `/goal` docs.
- ❌ Don't substitute `--no-research` defaults for actual references when external state matters (lib versions, CVE dates, API behavior).

## When this prompt is the wrong tool

- **Cron / unattended overnight maintenance** — use [Steward](docs/steward-runtime.md). `/goal` is session-scoped; Steward is cron-scoped.
- **Quick one-off question** — just answer it directly; don't write a goal plan.
- **Tight feature scope, <30 min estimate** — operator probably wants `/start` (Phase 1-3 plan) not `/goal`. Save `/goal` for long autonomous runs.

## Composes with

- [`prompts/95-confidence.md`](prompts/95-confidence.md) — interview discipline (Phase 1 follow-ups)
- [`prompts/cortex-load.md`](prompts/cortex-load.md) — cortex mental model the plan inherits
- [`prompts/code-review.md`](prompts/code-review.md) — R2 review pipeline the plan references
- [`templates/cortex-goal-plan.md.hbs`](templates/cortex-goal-plan.md.hbs) — SSOT for what a cortex `/goal` plan looks like
- [`standards/coding-behavior.md`](standards/coding-behavior.md) §Goal-Driven Execution — Rule 1.5 binding

## References (R1 sources)

- [Claude Code `/goal` docs](https://code.claude.com/docs/en/goal) — official spec, haiku evaluator + Stop hook composition
- [Ralph Loop plugin](https://claude.com/plugins/ralph-loop) — Anthropic's prior implementation
- [Ralph Wiggum technique](https://awesomeclaude.ai/ralph-wiggum) — pattern origin
- [Running Claude Code in a Loop (Fernando de la Rosa)](https://www.jfdelarosa.dev/blog/running-claude-code-in-a-loop/) — community pattern guide
- [goalkeeper (itsuzef)](https://github.com/itsuzef/goalkeeper) — contract-driven variant with subagent judge
- [continuous-claude (AnandChowdhary)](https://github.com/AnandChowdhary/continuous-claude) — Ralph loop with PR automation
- [Claude Code Ralph Loop overnight builds](https://newsletter.claudecodemasterclass.com/p/claude-code-ralph-loop-from-basic) — long-running session guide
- [`docs/transcripts/goals-for-claude-code.md`](docs/transcripts/goals-for-claude-code.md) — operator-captured transcript
