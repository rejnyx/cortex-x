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

_No migrations. First entry will land with v0.1.0 or the first breaking-change tag, whichever comes first._

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
