<!--
cortex-x is closed beta (pre-1.0). External PRs are NOT yet accepted —
see CONTRIBUTING.md. This template exists for the maintainer's own work
and any future opening of the contribution surface.
-->

## Summary

<!-- 1-3 bullets. WHY, not WHAT — the diff already shows what. -->

-
-

## Acceptance criteria

<!-- Link to spec / sprint memo / recommendation row. Steward-driven PRs auto-fill this. -->

-

## Test plan

<!-- Markdown checklist. Reviewer checks each box manually before approving. -->

- [ ] `npm test` green (or explain regression)
- [ ] New behavior covered by ≥ 1 test (unit / contract / integration as appropriate)
- [ ] No new dependencies (cortex-x is zero-runtime-deps — only dev `c8` allowed)
- [ ] No personal-data leaks (PII scanner workflow will block)
- [ ] No `--no-verify` / `--force` on git operations
- [ ] No `replace_all: true` on edits that should preserve existing content

## R2 review pipeline (mandatory for non-trivial diffs)

Run the 6-agent parallel review (acceptance + blind + correctness + security + ssot + edge-case) on the diff before requesting merge. Paste a 1-line summary per reviewer (severity + finding count) below:

- acceptance: <approved | findings>
- blind: <findings>
- correctness: <findings>
- security: <findings>
- ssot: <findings>
- edge-case: <findings>

## Linked issues / sprints

<!-- "Closes #N", "Sprint 2.X memo: docs/research/...". -->
