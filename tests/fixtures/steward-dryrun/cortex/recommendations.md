---
phase: 5-synthesis
date: 2026-05-07
slug: steward-dryrun
based_on:
  audit: cortex/AUDIT.md
  research: none
---

# Recommendations — steward-dryrun fixture

This is a fixture for Steward dry-run testing. The action items below are
deliberately trivial so Steward's atomic-commit contract (MUST-H1) is easy
to verify in CI.

## DO this week (cited)

### 1. Add a `subtract` function to `src/index.js`
Steward should add a `subtract(a, b)` export and a corresponding test in
`tests/smoke.test.cjs` asserting `subtract(5, 3) === 2`.
[audit: §1] [src: fixture-only]

### 2. Add a `multiply` function to `src/index.js`
Steward should add a `multiply(a, b)` export and a corresponding test in
`tests/smoke.test.cjs` asserting `multiply(3, 4) === 12`.
[audit: §2] [src: fixture-only]

### 3. Add a JSDoc comment to `src/index.js` `add` export
Steward should add a one-line JSDoc above the `add` export documenting
"Returns the sum of two numbers."
[audit: §3] [src: fixture-only]

## DO this sprint (cited)

### 4. Extend test coverage to negative numbers
Add a `tests/smoke.test.cjs` case asserting `add(-1, 1) === 0`.
[audit: §4] [src: fixture-only]
