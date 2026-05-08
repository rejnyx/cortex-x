# steward-dryrun fixture

> Fixture project for the Steward runtime (Phase 7).
>
> **Not a real project.** This is a deterministic, network-free target that
> Steward will eventually run against during dry-run testing. Lives at
> `tests/fixtures/steward-dryrun/` so the contract test in
> `tests/contract/steward-fixture-shape.test.cjs` can verify the shape stays
> intact as Steward evolves.

## Purpose

Steward (per [`docs/steward-runtime.md`](../../../docs/steward-runtime.md)) needs a
project to run against that:

1. Has a `cortex/recommendations.md` with a parseable "DO this week" section
2. Has a `CLAUDE.md` Steward can read for project context
3. Has a `package.json` with an `npm test` command Steward can verify against
4. Has at least one editable file (`src/index.js`) Steward can target with an
   atomic-commit-per-action change
5. Has at least one test that proves `npm test` returns exit 0

This fixture provides all five, in the smallest possible form.

## Layout

```
steward-dryrun/
├── README.md              this file
├── CLAUDE.md              minimal project doc
├── package.json           one test script, zero dependencies
├── cortex/
│   └── recommendations.md DO-this-week + DO-this-sprint sections
├── src/
│   └── index.js           trivial target file Steward can edit
└── tests/
    └── smoke.test.cjs     one passing node:test test
```

## What Steward does against this fixture (when v0 ships)

The `recommendations.md` file lists 3 actionable items. Steward (v0) will:

1. Read `cortex/recommendations.md` "DO this week"
2. Pick the first item not yet processed (per local journal)
3. Make the surgical edit specified in the action item
4. Run `npm test` (must stay green)
5. Commit on `hermes/<YYYY-MM-DD>-<slug>-<id>` branch with Git trailers
6. (In dry-run mode: skip `git push` + `gh pr create`; emit a structured plan
   instead)
7. Append a journal entry to `~/.cortex/journal/steward-dryrun/<date>.jsonl`

The fixture is **deliberately small** so Steward's atomic-commit contract
(MUST-H1) is easy to verify: one action = one file touched = one commit.

## Why a fixture instead of a real project

- **Deterministic** — same input → same output, every CI run
- **Network-free** — no external dependencies, no API calls
- **Fast** — `npm test` is a no-op-ish smoke
- **Reproducible** — Steward regressions caught in seconds, not minutes
- **No PII** — no real project paths, no real env vars, no real secrets

## Contract verified by `tests/contract/steward-fixture-shape.test.cjs`

The contract test asserts:

- Fixture root contains all 5 expected files (README, CLAUDE.md, package.json,
  cortex/recommendations.md, src/index.js, tests/smoke.test.cjs)
- `cortex/recommendations.md` parses as YAML-frontmatter + Markdown
- `cortex/recommendations.md` has at least one "## DO this week" section
- "## DO this week" section has ≥1 action item (heading `### N.`)
- `package.json` has a `scripts.test` field
- `tests/smoke.test.cjs` references `node:test`
- No PII paths under `~/`, no personal email markers, no maintainer-specific paths
- No `process.env.HOME` / `os.homedir()` interpolation in fixture files

If Steward's runtime contract changes (e.g. a new MUST-Hn pattern requires a
`cortex/hermes.yaml` per-project config), update the fixture **first**, then
the contract test, then the runtime — never the other way.

## How to extend (when Steward v0 implementation lands)

When the first Steward implementation PR adds runtime code:

1. Add `cortex/hermes.yaml` with per-project overrides (cost ceilings, target
   recommendations section)
2. Add `cortex/journal/steward-dryrun/.gitkeep` so the journal dir exists
   pre-first-run
3. Add a second action item to `cortex/recommendations.md` that requires more
   than one file edit, to prove Steward's atomic-commit contract on multi-file
   actions
4. Update `tests/contract/steward-fixture-shape.test.cjs` to assert the new
   shape

Do not add runtime code (Steward itself, scheduler, webhook receiver) inside
the fixture — those live in `bin/steward/` and are tested separately.
