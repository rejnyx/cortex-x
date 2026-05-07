# Migrations

> Per-version migration notes. Empty until first breaking change.
>
> When a tag introduces a breaking change (config schema, hook contract, prompt path, standard that existing projects depended on), add a section here keyed by the target version. `cortex doctor --migrate` (when implemented) reads this file to guide users.

## Format

```markdown
## vX.Y.Z (YYYY-MM-DD)

### Breaking
- [WHAT changed] — [WHY]
- **Migrate:** [concrete steps]
- **Rollback:** [if applicable]

### Deprecated
- [WHAT is scheduled for removal] — [target version]
```

## Current

### Sprint 1.6.5 — QA infrastructure (Tier 0-3, 2026-05-07)

#### Non-breaking (additive — no migration required for existing installs)

- **What landed:** cortex-x own QA infrastructure across 4 commits (Tier 0-3 of an 8-tier architecture):
  - **Tier 0** (commit `a5a5f57`) — `node --test` foundation, `tests/` layout, `c8` coverage, helpers (`fixture-utils.cjs`, `run-detector.cjs`, `snapshot-helpers.cjs`), `tools/lib/resolve-cortex-home.cjs` (SSOT extracted from `session-start.cjs`)
  - **Tier 1** (commit `3d7980a`) — `tests/smoke/verify-install.cjs` (single source of truth for "is install correct"). `install.sh` + `install.ps1` refactored to delegate (~70 LOC of duplicate verification deleted). `.github/workflows/install-smoke.yml` 5-lane matrix (ubuntu/macos bash + windows gitbash/pwsh7/ps5.1). `tests/integration/install-roundtrip.test.cjs` (idempotent re-install + backup rotation).
  - **Tier 2** (commit `a067a53`) — 50 schema-invariant tests across 10 profile YAMLs, 11 real-shape fixtures (10 profiles + monorepo-edge), 3 stage fixtures (greenfield 0c, prototype 30c, mvp 100c), detect-profile/stage/sister-env tests (71/71 pass). Caught and fixed 2 production bugs in same commit:
    - `parseProfileYaml` init-mismatch (`{}` vs `[]` for files/config_files/negative_signals) — meant `browser-agent.yaml` was silently dropped from candidates since it shipped 2026-04-20 (17 days)
    - `tauri-desktop.yaml` had `files:` containing config-file paths — meant the profile would never match a real Tauri project in production
  - **Tier 3** (commit `e20ffb9`) — `tools/verify-audit-output.cjs` (zero-dep CLI, 10 structural checks, plain/JSON/TAP modes, exit 0/1/2). 5 audit fixtures (good + 4 bad cases). 9 validator tests. `cortex-doctor.md` §13.5 wired to invoke validator. `install.{sh,ps1}` extended to copy `tools/` → `~/.claude/shared/tools/`.

- **Why:** field tests #4–#8 surfaced regression clusters across install, detection, and audit-output paths. Manual field testing as primary QA doesn't scale beyond ~10 tests/week. Tier 0-3 closes the three highest-impact failure surfaces (install, detector, audit output) before Hermes runtime layer lands. Tier 4-5 (hooks + prompts) are pre-Hermes hard gates; Tier 6-8 are pre-launch gates.

- **Migrate:** none — purely additive. Existing installs gain `~/.claude/shared/tools/` on next install run; old installs continue working without it (validator checks are warning-severity in `verify-install.cjs` for backward compat).

- **Rollback:** revert commits `e20ffb9` `a067a53` `3d7980a` `a5a5f57`. Inline verification block in `install.{sh,ps1}` is preserved in pre-Tier-1 git history.

#### Deprecated

- **Inline 70-LOC verification block in `install.sh` + `install.ps1`** — removed in Tier 1, replaced with single-line `node verify-install.cjs` delegation. SSOT now in `tests/smoke/verify-install.cjs`. Anyone who copy-pasted those blocks for their own forks: switch to invoking the verifier directly.

- **`detect-profile.cjs` `parseProfileYaml` `{}`-only init** — pre-Tier-2 form silently failed on `config_files:` / `negative_signals:` blocks (TypeError caught + swallowed by load-time fail-open). Post-Tier-2 it discriminates by subsection name. Profile YAML authors no longer need to avoid `config_files:` — it now works.

#### Coverage thresholds

Coverage is informational at Sprint 1.6.5. The plan ("measure first, ratchet later" per `standards/testing.md`) is to wait 2-3 sprints for a baseline, then ratchet thresholds upward. Don't add hard gates to CI until Tier 4+5 land.

### Sprint 1.6 — `$CORTEX_DATA_HOME` separation (2026-05-06)

#### Breaking (for pre-Sprint-1.6 dev installs only — no released version yet)
- **What changed:** user-personal data dirs (`research/`, `projects/`, `insights/`, `journal/`, `evals/`) moved out of the cortex-x source repo into `$CORTEX_DATA_HOME` (default `~/.cortex/`). Path placeholders changed across all prompts/agents from `$CORTEX_HOME/<dir>/` to `$CORTEX_DATA_HOME/<dir>/`.
- **Why:** field test #5 (osvc-tax-helper, then test-phase-5) surfaced that mixing framework distribution with user data violates SoC. For other users post-public-flip the design breaks: `git status` permanently dirty, `git pull` conflicts with their own data, reinstall = data loss, multi-machine sync impossible. Fix: three independent path roots — `cortex_root` (source), `cortex_assets_root` (installed read-only), `cortex_data_home` (user read-write).
- **Migrate:**
  ```bash
  bash $CORTEX_HOME/install.sh         # creates ~/.cortex/{research,projects,insights/proposals,journal,evals}
  bash $CORTEX_HOME/bin/cortex-migrate-data.sh    # moves existing dirs
  # or on Windows:
  & "$Env:CORTEX_HOME\install.ps1"
  & "$Env:CORTEX_HOME\bin\cortex-migrate-data.ps1"
  ```
  Migration script is idempotent (safe to re-run), skips empty dirs, renames conflicts to `<file>.pre-sprint-1-6` instead of overwriting.
- **Verify:** `ls ~/.cortex/{research,projects}/` should contain previously-accumulated `*.md` files. `git status` in cortex-x source should show clean (or only your own dev changes).
- **Rollback:** `mv ~/.cortex/research/*.md $CORTEX_HOME/research/` (etc.) — but you'd then need to revert path placeholders in prompts/agents too.

#### Deprecated
- Legacy `~/cortex-x/projects/` fallback in `shared/hooks/session-start.cjs` — kept for one release cycle, removable after Sprint 1.7. Targets pre-Sprint-1.6 installs that haven't run the migration script.

---

_Released migrations land below this line at first `v*` tag._

---

## Pre-public-tag debt (MUST resolve before first `v*` tag on a public repo)

These items are **intentionally not fixed** in working-tree commits — they require one-time destructive git operations or signing infrastructure that needs separate approval.

### D-1. Git history purge (third-party PII + private project data)

**Status:** OPEN. Last review pipeline flagged as 🔴 Critical (security-auditor C1).

Commits before 2026-04-19 contain these files in blob history:
- `projects/relo.md` — **contains a third-party personal identifier** (real name + role; mapping held only in gitignored `scripts/sanitize-rules.json`, never in source-tree narrative docs) plus stakeholder counts + business context
- `projects/amd-hackathon-2026.md` — hackathon strategy, prize target, infrastructure plan
- `insights/2026-04-17-amd-retrofit-gaps.md` — framework meta-analysis with private project references
- `docs/framework-rfc.md` — original design doc citing private client repos (back-office-bot, custom-chatbot, kiosek-main)
- `research/amd-hackathon-2026-2026-04-17.md` — project-specific research cache
- `research/food-banner-builder-2026-04-17.md` — project-specific research cache

HEAD working tree is clean (all 6 are gitignored + `git rm --cached`-ed). But `git log -p` / `git show <old-commit>:projects/relo.md` on any clone reveals the content.

**Fix before first public `v*` tag:**

```bash
# Step 1: Backup
git branch main-pre-filter-backup

# Step 2: Purge (git-filter-repo recommended; git filter-branch deprecated but built-in)
git filter-branch --force --prune-empty --index-filter \
  'git rm --cached --ignore-unmatch \
     projects/relo.md \
     projects/amd-hackathon-2026.md \
     insights/2026-04-17-amd-retrofit-gaps.md \
     docs/framework-rfc.md \
     research/amd-hackathon-2026-2026-04-17.md \
     research/food-banner-builder-2026-04-17.md' \
  --tag-name-filter cat -- --all

# Step 3: Verify tree + hooks still work
node shared/hooks/_lib/redact.test.cjs

# Step 4: Force-push (destroys remote history — only safe because no external clones)
git push --force origin main

# Step 5: Tell any local clones to re-clone (if there are any) — their commits are now orphaned
```

**Why deferred:** history rewrite is one-way destructive. Repo is currently private, closed-beta, no external clones — so waiting doesn't increase blast radius. Must happen before the first invited tester clones OR before flipping the repo to public, whichever comes first.

### D-2. Signed-tag verification in install scripts

**Status:** OPEN. security-auditor M1 finding.

`install.sh` / `install.ps1` with `CORTEX_CHANNEL=stable` run `git checkout $LATEST_TAG` without `git tag -v`. If the maintainer's GitHub account is compromised (phish / stolen token / device theft), an attacker can push `v99.0.0` containing a malicious hook; every beta tester on stable pulls it on next install.

**Fix before first public `v*` tag:**
1. Generate GPG signing key, publish fingerprint in `SECURITY.md`
2. Sign all `v*` tags: `git tag -s v0.1.0 -m "..."`
3. Add to `install.sh` / `install.ps1` before `git checkout`:
   ```bash
   git tag -v "$LATEST" || { echo "ERROR: tag signature invalid"; exit 1; }
   ```

**Why deferred:** needs signing infrastructure + documented key rotation policy. v0.1 scope.

### D-4. Residual `~/cortex-x/` refs in source docs/prompts (non-user-facing)

**Status:** RESOLVED 2026-05-06. Mechanical rewrite via `scripts/fix-d4-paths.mjs` — 14 files, 55 lines, single commit "path convention normalized."

Path convention enforced:
- `~/.claude/shared/<subdir>/` — **installed read-only assets** (`prompts`, `standards`, `agents`, `profiles`, `templates`, `shared`, `skills`, `detectors`, `hooks`) after `install.sh`/`install.ps1`
- `$CORTEX_HOME/<subdir>/` — **live source dir** (`projects`, `insights`, `research`, `journal`, `evals`, `config`, `docs`)

Files rewritten: `README.md`, `projects/README.md`, `config/evolve.yaml`, `prompts/{sprint-status,cortex-sync,cortex-evolve,cortex-load,cortex-reflect,project-scan,retrospective,code-review,cortex-doctor}.md`, `evals/eval-001-scaffold-nextjs-saas.md`, `evals/README.md`.

Files intentionally NOT rewritten — they document the migration or contain legacy diagnostic mentions: `MIGRATIONS.md` (this file), `CHANGELOG.md`, `docs/public-launch-plan.md`, `evals/results/2026-05-01-01d9013-paper-baseline.json`, and the four lines in `prompts/cortex-doctor.md` that describe the legacy-broken-prefix detector (preserved by the script's `doctorPreserveLines` allow-list).

**Pre-resolution context:** original 2026-04-19 fix landed in `templates/CLAUDE.md.hbs`, `agents/cortex-thinker.md`, `agents/security-auditor.md`, `prompts/new-project.md`, partial `prompts/cortex-doctor.md`, `install.sh`, `install.ps1`. The 14 source files above were missed in that pass; without this rewrite, fresh-install users with no `~/cortex-x/` directory would have hit runtime path-resolution failures (e.g. cortex-sync trying to write `~/cortex-x/insights/`).

---

### D-3. Windows ACL on `.hook-errors.log`

**Status:** OPEN. security-auditor M3, documented as advisory.

`fs.writeFileSync(...mode: 0o600)` is a no-op on Windows. If cortex-x is cloned under a world-readable path (e.g., `C:\Users\Public\`, a shared OneDrive folder, network share), the error log inherits parent ACL which may be readable by other accounts on the host.

**Fix before first public `v*` tag:** add to `SECURITY.md`:

> **Windows users:** do not install cortex-x under `C:\Users\Public\` or any world-readable shared directory. `.hook-errors.log` mode 0o600 is honored only on Unix; on Windows it inherits the parent directory's ACL. Install under `$HOME` (typically `C:\Users\<you>\`) to keep error logs private.

Optional: detect + refuse install under problematic paths.
