# cortex-x test suite

> Eight tiers, organized by what they protect. Tier 0-3 land in the initial QA push; Tier 4-5 gate Steward; Tier 6-8 gate public launch. See `CLAUDE.md` § Roadmap and `CONTRIBUTING.md` for the gate matrix.

## Why `node --test` and not vitest

cortex-x ships as a git repo + install scripts to `~/.claude/shared/`. Every dependency we add is a dependency we shove onto contributors and CI runners. Node 22+ has a built-in test runner with snapshot support, mock fns, coverage, and TAP/spec/dot reporters. The only dev dep we add is `c8` for richer coverage reporting (V8-native, no transpile, ~150 KB).

If you've used vitest/jest, the API maps:

| vitest        | node --test       |
|---------------|-------------------|
| `describe()`  | `describe()` or nest `t.test()` |
| `it()`        | `it()` or `t.test()` |
| `expect(x).toBe(y)` | `assert.strictEqual(x, y)` |
| `expect.toMatchSnapshot()` | `t.assert.snapshot(value)` (Node 22.3+) |
| `vi.fn()`     | `mock.fn()` |
| `vi.mock()`   | `mock.method(obj, 'name', impl)` |
| `--watch`     | `--watch` (Node 22+) |
| `--coverage`  | `--experimental-test-coverage` OR `c8 npm test` |

## Layout

```
tests/
├── README.md                    you're here
├── _helpers/                    shared test utilities (not test files themselves)
│   ├── fixture-utils.cjs        create synthetic git history, write fixture trees
│   ├── run-detector.cjs         invoke a detector against a fixture path, return JSON
│   └── update-snapshots.cjs     `npm run test:update-snapshots`
├── fixtures/                    real-shape mini projects, NOT json stubs
│   ├── nextjs-saas-mini/        package.json + src/app/page.tsx + minimum to match the profile
│   ├── ai-agent-mini/
│   ├── astro-static-mini/
│   ├── waas-template-mini/
│   ├── cli-tool-mini/
│   ├── chatbot-platform-mini/
│   ├── browser-agent-mini/
│   ├── kiosek-mini/
│   ├── tauri-desktop-mini/
│   ├── minimal-mini/
│   ├── monorepo-edge/           pnpm-workspace + 2 packages — stresses single-pkg vs monorepo classifier
│   ├── stage-greenfield/        0 commits
│   ├── stage-prototype/         30 synthetic commits
│   ├── stage-mature/            500+ synthetic commits
│   ├── audit-good/              valid 12-dim audit output (cortex/AUDIT.md, recommendations.md, projects-library entry)
│   ├── audit-bad-missing-recs/
│   ├── audit-bad-orphan-citation/
│   ├── audit-bad-missing-projects-entry/
│   └── audit-bad-broken-frontmatter/
├── snapshots/                   committed expected outputs, regenerable
│   ├── detect-profile.json
│   ├── detect-stage.json
│   └── detect-sister-env.json
├── unit/                        single-component tests (Tier 2-6)
│   ├── detect-profile.test.cjs
│   ├── detect-stage.test.cjs
│   ├── detect-sister-env.test.cjs
│   └── audit-validator.test.cjs
├── contract/                    cross-component invariants (Tier 2, 5, 7, 8)
│   ├── profile-yaml-schema.test.cjs   each profiles/*.yaml has required fields
│   ├── prompt-shape.test.cjs          each prompts/*.md has phases + on_complete
│   ├── standards-links.test.cjs       internal links in standards/ resolve
│   └── skill-schema.test.cjs          each shared/skills/*/SKILL.md follows agentskills.io spec
├── integration/                 end-to-end across multiple components (Tier 1, 3)
│   ├── install-roundtrip.test.cjs     install → verify → re-install → verify (idempotent)
│   └── audit-flow.test.cjs            given fixture, validator catches expected failures
└── smoke/                       fastest-feedback CI gates (Tier 1)
    └── verify-install.cjs       called both standalone and from install.{sh,ps1}
```

## How to add a profile fixture

A profile fixture is the smallest project structure that should match the profile's `detect:` block in `profiles/<profile>.yaml`. Reverse-engineer from the YAML.

1. **Read** `profiles/<profile>.yaml` — note required deps, file patterns, anti-deps.
2. **Create** `tests/fixtures/<profile>-mini/package.json` with the matched deps. Add other matched files (`astro.config.mjs`, `src/app/page.tsx`, etc.).
3. **Add expectation** to `tests/snapshots/detect-profile.json`:
   ```json
   {
     "<profile>-mini": { "top_match": "<profile>", "min_score": 0.7 }
   }
   ```
4. **Run** `npm run test:detectors` to confirm the fixture matches as expected.

## How to add a stage fixture

Stage fixtures need synthetic git history. Use `tests/_helpers/fixture-utils.cjs` `buildStageFixture(name, commitCount)`:

```js
const { buildStageFixture } = require('../_helpers/fixture-utils.cjs');
buildStageFixture('stage-prototype', 30);
```

This idempotently creates `tests/fixtures/stage-prototype/.git/` with N commits via low-level git plumbing (avoids `git config user.email` global state mutation in CI).

## How to update a snapshot intentionally

If you changed a detector and the new behavior is correct:

```bash
npm run test:update-snapshots
git diff tests/snapshots/   # eyeball the diff before committing
git add tests/snapshots/
```

Snapshots are committed deliberate expectations, not test detritus. If a diff surprises you, the detector regressed — don't `--update` past it without thinking.

## How to run

```bash
npm test                  # full suite (unit + contract + integration), spec reporter
npm run test:fast         # unit + contract only, dot reporter, ~ <5s
npm run test:smoke        # post-install verification (called by install.{sh,ps1})
npm run test:detectors    # detector unit + profile YAML schema
npm run test:audit        # audit output validator unit
npm run test:integration  # roundtrip + audit-flow
npm run test:coverage     # c8 → coverage/ (HTML + lcov + text)
```

## CI matrix

- **`.github/workflows/test.yml`** — fast lane: linux only, full suite + coverage, on every PR + push to main.
- **`.github/workflows/install-smoke.yml`** — slow lane: ubuntu + windows + macos matrix, `bash install.sh` (or `pwsh install.ps1` on Windows), then `npm run test:smoke`. PR + push + nightly cron.
- **`.github/workflows/no-pii.yml`** — pre-existing PII scanner, runs in parallel.

## Tier mapping (which test goes where)

| Tier | Path | What it protects |
|---|---|---|
| 1 | `tests/smoke/`, `tests/integration/install-roundtrip.test.cjs` | distribution boundary — install doesn't damage `~/.claude/` |
| 2 | `tests/unit/detect-*.test.cjs`, `tests/contract/profile-yaml-schema.test.cjs` | adding profile #11 doesn't break profile #1's matching |
| 3 | `tests/unit/audit-validator.test.cjs`, `tests/integration/audit-flow.test.cjs` | `/audit` outputs hold the 3-hop citation contract |
| 4 | `tests/unit/hooks/*.test.cjs` (next session) | block-destructive can't be regressed; runtime safety |
| 5 | `tests/contract/prompt-shape.test.cjs` (next session) | every prompt has phases, valid paths, no PII leak |
| 6 | `tests/unit/bin/*.test.cjs` (pre-launch) | bin/ tools don't silently corrupt user data |
| 7 | `tests/contract/standards-links.test.cjs` (pre-launch) | broken internal links surface before user hits them |
| 8 | `tests/contract/skill-schema.test.cjs` (pre-launch) | SKILL.md files comply with agentskills.io |

## Anti-patterns (don't)

- ❌ JSON stub fixtures — detectors look at file shape, not just deps. Use real-shape projects.
- ❌ One fixture per test case — fixtures are reused across detector tests; one fixture, multiple assertions.
- ❌ Hardcoded `/c/Users/david/...` in fixtures or tests — use `os.tmpdir()` or `path.join(__dirname, ...)`. CI is Linux.
- ❌ Network calls in unit tests — mock `node:fetch` via `mock.method(global, 'fetch', ...)`. Network OK in `--strict` integration with explicit timeout + skip-on-offline.
- ❌ `process.exit()` in test files — use `assert` + `throw`. `node --test` reports failures correctly.
- ❌ Skipping tests with no comment — `it.skip()` requires a TODO with date + reason or it gets deleted.
