---
id: eval-008
name: sprint-status-parses-correctly
category: status
version: 1.0
---

# Eval 008 — sprint-status finds next pending story correctly

## Input

Setup: a project with this `PROGRESS.md`:

```markdown
# PROGRESS — Test Project

## Sprint 1 — Setup ✅

| Story | Description | Status |
|-------|-------------|--------|
| 1.1 | Init repo | done |
| 1.2 | Install deps | done |

## Sprint 2 — Features

| Story | Description | Status |
|-------|-------------|--------|
| 2.1 | User auth | done |
| 2.2 | Profile page | done |
| 2.3 | Settings page | in-progress |
| 2.4 | Notifications | pending |
| 2.5 | Search | pending |
| 2.6 | Admin panel | blocked |

### Blocked / Open Questions
- 2.6 blocked: waiting for approval on RBAC scope (asked Tom on 2026-04-15, no reply)

## Sprint 3 — Polish (planned)

| Story | Description | Status |
|-------|-------------|--------|
| 3.1 | Performance audit | pending |
```

Paste `~/.claude/shared/prompts/sprint-status.md`.

## Expected properties

### Must have

- [ ] Identifies **Sprint 2** as active (Sprint 1 has ✅, Sprint 3 says "planned")
- [ ] Reports counts correctly: 2 done, 1 in-progress, 2 pending, 1 blocked, 6 total
- [ ] Completion percentage: `2/6 = 33%` (or shown as "33% (2 of 6 done)")
- [ ] **Current story** (in-progress): `2.3 Settings page`
- [ ] **Next actionable story**: `2.4 Notifications` (first pending after the in-progress)
- [ ] Blocked items section lists `2.6` with reason from Open Questions section
- [ ] Recent commits + uncommitted changes surfaced from git
- [ ] Suggested next action is concrete (not generic "keep working")

### Must NOT have

- [ ] **Does NOT pick `2.6`** as next actionable (it's blocked)
- [ ] **Does NOT pick `3.1`** as next actionable (different sprint, not active)
- [ ] **Does NOT pick `2.3`** as next actionable (already in-progress)
- [ ] No misreport of completion (e.g., `2/6 → 50%` would be wrong arithmetic)
- [ ] No padding completion (don't count in-progress as done)

### Should have

- [ ] If `2.3` was last touched >2 days ago, output flags drift: "⚠️ 2.3 in-progress 2+ days, no commits"
- [ ] If commit messages mention story IDs (e.g., `feat: complete 2.2`), suggest auto-update of status
- [ ] If sprint completion ≥ 90%, suggest running retrospective.md
- [ ] Sprint-age check: if Sprint 2 started 30+ days ago, flag scope or pace concern
- [ ] Output is scannable (≤30 lines, table + 2-3 lines of suggestion)

## Scoring rubric

- **1.0** — All must-have correct, all should-have nice-to-haves landed
- **0.9** — All must-have, 1 should-have missed
- **0.8** — All must-have, 2 should-have missed
- **0.6** — All must-have but next-actionable selection wrong (e.g., picked 2.5 over 2.4 — order matters)
- **0.4** — Active sprint identified correctly but story counts off
- **0.0** — Wrong sprint identified, OR picked blocked/done story as next actionable

## Adversarial probes

- **Did parser pick `2.6` as next actionable?** Expected: NO (blocked).
- **Did parser pick `3.1` as next actionable?** Expected: NO (different sprint).
- **Did parser misread Sprint 1 as active despite ✅?** Expected: NO.
- **Did parser report completion as 50% (2 of 4 non-blocked)?** Expected: NO — completion = done / total, blocked counts in total.
- **Did parser try to auto-edit PROGRESS.md?** Expected: NO without explicit user approval.

## Notes for evaluator

This eval tests the **deterministic parser logic** in `session-start.cjs` + how Claude consumes its output. The hook already has the parser; this eval ensures the prompt hasn't drifted from the hook's contract.

Common failure mode: prompt asks Claude to "summarize PROGRESS.md" generically, Claude restates everything verbatim instead of extracting next-actionable. The whole point is **actionable surfaces, not restatement**.
