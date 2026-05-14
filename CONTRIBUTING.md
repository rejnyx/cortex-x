# Contributing to cortex-x

cortex-x is **public preview (v0.3-pre)** under Apache License 2.0. The `main` branch is the rolling channel; tagged `vX.Y.Z` releases are stable snapshots.

## Posture

- **Issues + Discussions welcome.** Bug reports, feature ideas, and feedback via GitHub Issues on the [cortex-x repo](https://github.com/Rejnyx/cortex-x) — prefix with `[beta]` to flag known-rough-edge reports. Questions and design discussion → GitHub Discussions.
- **External code contributions: opening soon.** Until `v0.3` is tagged, the maintainer is doing a final architecture-stabilization pass and is not accepting external PRs. After `v0.3` cut: PRs welcome under Apache 2.0 §5 (contributions implicitly licensed under the same terms; no separate CLA).
- **Security issues** → see [SECURITY.md](./SECURITY.md). Use GitHub Private Vulnerability Reporting; do not open a public issue for vulns.

## Expectations

- **Pre-`v0.3` PR posture**: external code PRs paused. Open an issue first; if it's a one-line fix or doc improvement, the maintainer may take it as a patch reference. Substantial changes wait for `v0.3` cut.
- **No warranty.** Per Apache 2.0 §7 (Disclaimer of Warranty) and §8 (Limitation of Liability). This is pre-1.0 software; expect rough edges.
- **Your data stays local.** The framework collects zero telemetry. See [standards/ship-ready.md](./standards/ship-ready.md#telemetry-stance-opinionated) for the stance.

## Beta tester checklist

Before your first install, please:

1. Read [LICENSE](./LICENSE) — Apache License 2.0 permits commercial use, requires attribution + NOTICE preservation, includes patent grant.
2. Read [SECURITY.md](./SECURITY.md) — disclosure process matters.
3. Run `./install.sh` (or `.ps1` on Windows). Hooks land in `~/.claude/shared/`.
4. Paste the snippet from the install output into `~/.claude/settings.json` to register hooks.
5. Report back: what worked, what broke, what was confusing.

---

## Code contributors (when PRs open up)

When this section becomes relevant, the rules below apply.

### Pre-PR checklist

1. **Tests pass locally** — run before pushing:
   ```bash
   npm test                  # full suite (unit + contract + integration), ~28 sec at 2955 tests
   npm run test:smoke        # post-install verification (after install.sh has run)
   ```
2. **Cross-platform sanity** (if your change touches `install.{sh,ps1}`, hooks, or detectors):
   ```bash
   npm run test:integration  # exercises bash install end-to-end in isolated $HOME
   ```
   GitHub Actions matrix (`.github/workflows/install-smoke.yml`) covers Windows pwsh + ps5.1 lanes — you don't need to run those locally.
3. **No secrets, no PII, no `console.log` debug spam** in committed code.
4. **No dependencies added without justification.** cortex-x ships zero runtime deps. Dev deps require a written reason in the commit message.

### When to add what (8-tier QA architecture)

The 8-tier mapping (see [tests/README.md](./tests/README.md) § Tier mapping) governs where new tests go:

| You changed... | Add tests under... |
|---|---|
| `install.sh` / `install.ps1` | `tests/smoke/` (verifier post-conditions) + `tests/integration/install-roundtrip.test.cjs` |
| `profiles/<name>.yaml` | `tests/fixtures/<name>-mini/` (real-shape) + expectation in `tests/unit/detect-profile.test.cjs` |
| `detectors/*.cjs` | `tests/unit/detect-*.test.cjs` (logic) + `tests/contract/profile-yaml-schema.test.cjs` (parser invariants) |
| `tools/verify-audit-output.cjs` | `tests/unit/audit-validator.test.cjs` + new fixture if a new failure class |
| `prompts/*.md` | (Tier 5 — landing pre-Steward) |
| `shared/hooks/*.cjs` | (Tier 4 — landing pre-Steward) |
| `bin/*.cjs` | (Tier 6 — landing pre-launch) |
| `standards/*.md` | (Tier 7 — landing pre-launch) |
| `shared/skills/*/SKILL.md` | (Tier 8 — landing pre-launch) |

### Adding a new profile

1. Add real-shape fixture under `tests/fixtures/<my-profile>-mini/` (smallest tree that satisfies your `detect:` block — package.json + 1-3 auxiliary files; not a JSON stub).
2. Add an expectation row to `EXPECTATIONS` in `tests/unit/detect-profile.test.cjs`:
   ```js
   { fixture: '<my-profile>-mini', topMatch: '<my-profile>', minScore: 0.8, minConfidence: 'medium' },
   ```
3. Run `npm run test:detectors` — the schema test catches broken YAML, the detector test catches "fixture doesn't actually match my profile".

### What NOT to do

- ❌ **Don't `--no-verify`.** If a CI lane fails, fix the cause — don't bypass.
- ❌ **Don't `git push --force` to main.**
- ❌ **Don't add `vitest`/`jest`/`mocha`.** `node --test` is the floor; needs > floor → open a discussion first.
- ❌ **Don't commit `.git/` inside `tests/fixtures/<name>/`.** Stage fixtures generate transient `.git/` at test runtime; `.gitignore` excludes them. If `git add` complains "does not have a commit checked out," run `node -e 'require("./tests/_helpers/fixture-utils.cjs").ensureFixtureClean("<name>")'` first.

### Local development tips

```bash
# Watch a single test while iterating
node --test --watch tests/unit/detect-profile.test.cjs

# Run a specific test by name pattern
node --test --test-name-pattern='nextjs-saas'

# Update snapshots after a deliberate behavior change
npm run test:update-snapshots
git diff tests/snapshots/   # always eyeball the diff before staging
```

### Commit messages

Conventional commit prefix (`feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`). Body explains the **why**. For bug-fix commits, name the failure mode and how the test catches future regressions. Co-author trailer welcome:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
