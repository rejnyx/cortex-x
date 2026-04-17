# Sprint Status — Parse PROGRESS.md and Report

> **How to use:** Paste at start of session to get instant sprint status, or anytime you want to check progress. Claude parses PROGRESS.md and surfaces state + next action.

---

## Your task

Parse current project's `PROGRESS.md` + recent git activity, produce actionable sprint status.

## Step 1 — Read PROGRESS.md

```bash
cat PROGRESS.md 2>/dev/null
```

If missing: "⚠️ No PROGRESS.md found. Run `~/cortex-x/prompts/new-project.md` or create manually."

## Step 2 — Identify active sprint

Find the first `### Fáze N:` / `### Sprint N:` / `### Phase N:` that is NOT marked done (no ✅, no "done" in title).

If all are done: "🎉 All sprints complete. Time to plan next or ship."

## Step 3 — Parse stories in active sprint

For each story row in the table (`| X.Y | Description | Status |`):
- Count: pending, in-progress, done, blocked
- Identify next actionable: first `pending` after last `in-progress` (or first `pending` if none in-progress)

## Step 4 — Git context

```bash
git log --oneline -10
git status --short
```

- Match recent commits to stories (commit message mentions story ID?)
- Identify uncommitted work that might belong to an in-progress story

## Step 5 — Output

```markdown
# Sprint Status — <project name>

## Active Sprint
**<sprint name>**

### Progress

| Metric | Count |
|--------|-------|
| Done | <N> |
| In progress | <N> |
| Pending | <N> |
| Blocked | <N> |
| **Total** | <N> |

**Completion: <percent>%**

### Current story (in progress)
- `<ID>`: <description>
  - Last commit touching this: <commit SHA + message>
  - Uncommitted files matching: <list>

### Next actionable story
- `<ID>`: <description>
- Estimated effort: <from profile if available>

### Blocked items
- `<ID>`: <description>
  - **Reason:** <from PROGRESS.md "Blocked / Open Questions">

## Recent commits
<last 5 commits, oneline>

## Uncommitted changes
<count and brief list>

## Suggested next action
Based on current state:

- **If story in-progress + recent commits:** "Pokračuj v `<ID>`. Uncommitted work vypadá related."
- **If story in-progress + NO recent commits (>2 days):** "⚠️ `<ID>` je in-progress ale 2+ dny bez commitu. Pokračuj nebo revert status na pending."
- **If all pending + no in-progress:** "Začni `<next ID>`. Mark as in-progress v PROGRESS.md."
- **If sprint ~90% done:** "🎉 Sprint téměř hotov. Plan retrospective?"
- **If sprint >30 days old:** "⚠️ Sprint trvá 30+ dní. Časté přeplánování nebo zúžení scope?"
```

## Rules

- **Fast.** This runs at session start often. Under 5 seconds.
- **Actionable.** Not "here's status" but "here's what to do next."
- **Honest.** Don't pad completion percentage. If 30% done, say 30%.
- **Detect drift.** If story was "in-progress" 5 days ago and nothing changed, flag it.

## Anti-patterns

- ❌ Summarizing every story verbatim (the user can read PROGRESS.md)
- ❌ Burying next-actionable in long list
- ❌ Ignoring git context (commits that complete stories should auto-suggest status update)
- ❌ Over-formatting (keep it scannable)

## Auto-update PROGRESS.md?

If a commit message clearly completes a story (e.g., `feat: complete story 1.3 — user login`):
- Suggest updating PROGRESS.md: "Move `1.3` from in-progress to done?"
- Don't auto-commit without asking.

## When to run

- Start of every coding session (quick check)
- End of day (what did I do? what's next?)
- After returning from break (orientation)
- As part of `cortex-doctor` (broader health check)

## Integration with cortex-sync

If sprint completion triggers a retrospective moment:

```
🎉 Sprint 1 completed. Chceš spustit prompts/retrospective.md?
```

Retrospective captures what worked/didn't into cortex library.
