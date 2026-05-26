# fix_plan — {{USECASE}}

> The Ralph loop reads this file at the start of every iteration. Don't restructure it during a run — only operator edits between iterations are safe. The model adds/closes items via the contract in `PROMPT.md`.

## How the model reads this

- Highest-priority item = first `- [ ]` unchecked checkbox encountered top-to-bottom
- Each item ends at the next `- [ ]` or `- [x]` or end-of-file
- `> blocker:` / `> human-needed:` / `> auto-added:` lines are notes, not new items
- `[x]` items stay in the file as a closed worklog — never delete them

## Priority tags (optional, in title)

- `[P0]` — blocking the whole run, do first
- `[P1]` — important, do soon
- `[P2]` — nice-to-have, defer if cost pressure
- No tag = treat as P1

The loop picks top-down within the priority class.

---

## Worklist

- [ ] [P0] {{Item 1 title — what's broken / missing}}
  - **Files**: `path/to/file.cjs`, `path/to/test.cjs`
  - **Acceptance**: `npm test` exits 0 AND the new behavior is exercised by a test in the affected suite (not just absent)
  - **Context**: 1-3 lines of why this is needed; cite the source if it came from an audit / recommendations.md
  - **Spec**: see `specs/item-1.md` (optional)

- [ ] [P1] {{Item 2 title}}
  - **Files**: ...
  - **Acceptance**: ...
  - **Context**: ...

- [ ] [P1] {{Item 3 title}}
  - **Files**: ...
  - **Acceptance**: ...
  - **Context**: ...

---

## Worked example (DELETE before running)

- [ ] [P0] Add integration test for steward-tech-debt-audit detector
  - **Files**: `tests/integration/steward-tech-debt-audit.test.cjs` (new), `bin/steward/actions/tech-debt-audit.cjs`
  - **Acceptance**: `npm test -- tests/integration/steward-tech-debt-audit.test.cjs` exits 0; test mocks qlty output and asserts that the snapshot-drift detector fires on changed metrics
  - **Context**: Sprint 2.9.7a flagged a security HIGH (pipe-to-shell removed from qlty.sh invocation). The fail-open path is currently untested. From cron-survey.md punch list item #1.

- [x] [P0] Reproduce the cron failure locally
  - **Files**: `bin/steward/actions/tech-debt-audit.cjs`
  - **Acceptance**: `node bin/steward/actions/tech-debt-audit.cjs --dry-run` exits 0 against current main
  - **Context**: Baseline before adding the test — closed in commit abc123.

---

## Auto-added items (loop appends here mid-run)

The loop may discover sub-tasks while working an item. It adds them as `- [ ] > auto-added` below this divider. Operator reviews between iterations or post-run.

<!-- AUTO-ADDED BELOW -->
