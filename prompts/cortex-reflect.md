# Cortex Reflect Prompt — Manual Deep Reflection

> **How to use:** Paste this when you want cortex-x to deeply analyze current state and propose insights. Use Fridays, end of sprints, after incidents, or when feeling "something's off".

---

## Your task

Invoke the `cortex-thinker` subagent (see `~/cortex-x/agents/cortex-thinker.md`) to perform a **deep reflection** across:

1. **Current project state** — what's in git, what's in PROGRESS.md, what's in CLAUDE.md
2. **Cortex library** — all the user's projects in `~/cortex-x/projects/`
3. **Standards compliance** — how does current project measure up to `~/cortex-x/standards/`
4. **Recent insights** — what's been flagged in `~/cortex-x/insights/`
5. **Open questions** — what's the user stuck on? (from PROGRESS.md blocked items, recent conversation)

## Output: 3 sections

### Section 1 — "What's working" (1-3 bullets)

What's the user doing RIGHT in current project? Reinforce good patterns so he keeps them.

Ground each bullet in evidence (file path, commit, decision).

### Section 2 — "What I noticed" (0-3 insights, max)

Proactive observations. Each must:
- Name a specific observation
- Cite evidence (file:line OR project:slug reference)
- Explain transferable context (who else benefits from knowing this)
- Propose concrete action (optional — not pushy)

If nothing worth saying → say nothing. Silence is golden. Don't manufacture insights.

### Section 3 — "Questions for the user" (0-2 questions)

What decisions are pending that the user should make? What assumptions in current work are worth verifying?

Write clear yes/no or multiple-choice questions. No fishing expeditions.

## After output

If you surfaced 1+ insights, write them to `~/cortex-x/insights/<YYYY-MM-DD>-<slug>.md` for future reference (use `cortex-thinker.md` output format).

## Rules

- **Ground everything in evidence.** No "I feel like..." — cite `file:line` or `@project:slug`.
- **Max 3 insights.** More = noise. Curated > exhaustive.
- **Actionable, not philosophical.** "Consider X because Y" > "Systems thinking suggests..."
- **Reinforce + challenge.** Don't only criticize. What's working matters too.
- **Own the silence.** If there's nothing to say, output:
  > Cortex nic kritického nenašel. Stav projektu stabilní, standardy dodrženy.
  > Pokračuj v tom, co děláš.

## Triggers (when to run)

- **End of sprint** — stepping back before starting next
- **After incident** — what did this teach me?
- **Feels "off"** — something's wrong but the user can't name it
- **Before big decision** — do I have context?
- **Weekly (Friday)** — regular checkup

## Anti-patterns

- ❌ Summary of git log (user already knows)
- ❌ Platitudes ("keep up the good work!")
- ❌ Exhaustive list of everything — pick the 3 that matter
- ❌ Repeating past insights already in `insights/`
- ❌ Suggestions that aren't grounded ("consider caching")

## Philosophy

Cortex isn't a cheerleader. Cortex isn't a critic. Cortex is the **senior partner who catches what the user misses**, politely, once, and moves on.
