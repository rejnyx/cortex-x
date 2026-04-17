# Cortex Sync Prompt

> **How to use:** Paste this at the END of a work session when something notable happened (major decision, failed experiment, pattern worth remembering). Claude will update `~/cortex-x/projects/<slug>.md` with the fresh insight.

---

## Your task

This session produced new knowledge about the current project. Update the corresponding `~/cortex-x/projects/<slug>.md` entry so future sessions (and other projects) can benefit.

## What to capture

Ask yourself:

1. **Did we make an architectural decision?** → add to "Key Decisions" with reason + date
2. **Did we try something and it failed?** → add to "Lessons Learned" (negative knowledge is gold)
3. **Did we find a new pattern that works?** → add to "Lessons Learned" as positive insight
4. **Did we discover a cross-project dependency?** → add to "Cross-Project Dependencies"
5. **Did we change the tech stack?** → update "Tech Stack"
6. **Did we hit a bug/limitation that's a known issue?** → add to "Known Issues / Tech Debt"
7. **Did we learn something transferable to other projects?** → flag it explicitly

## Rules

- **Append, don't overwrite** — preserve history
- **Date everything** — use today's date (ISO format)
- **Be specific** — "retry with exponential backoff worked" > "retries worked"
- **Include context** — future-you needs to know why, not just what
- **Mark transferable insights** — start with `[TRANSFERABLE]` prefix

## Format for each entry

```markdown
### <Short title> — <YYYY-MM-DD>

**What happened:** <1-2 sentences>

**Decision/Lesson:** <the insight>

**Why it matters:** <transferable to other projects? which ones? what future situation?>

**Evidence:** <commit SHA, issue number, test file, or session ID>
```

## After updating

1. Commit to cortex-x repo:
   ```bash
   cd ~/cortex-x
   git add projects/<slug>.md
   git commit -m "knowledge: <slug> — <short description>"
   git push
   ```
2. Report summary to the user — what was captured, what was skipped

## Anti-patterns

- ❌ Capturing every small change (signal dies in noise)
- ❌ Cross-referencing specific line numbers (they rot)
- ❌ Personal emotional context ("the user was tired") — keep it technical
- ❌ Redundant with git history ("added a function") — cortex tracks INSIGHTS not DIFFS
- ❌ Speculation about future work (that's what PROGRESS.md is for)

## Recurrence

Run this at these checkpoints:
- End of sprint/milestone
- After completed review pipeline
- After incident resolution
- After significant refactor
- After switching model provider / tech stack
- When deciding "not to do something" (negative decision is also knowledge)
