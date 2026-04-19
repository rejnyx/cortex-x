# Ship-Ready — Governance Invariants for Distribution

> **Tier-0 invariant.** Governance pillar that precedes Rule 1. Rule 1 answers "is the code correct for its job?"; Ship-Ready answers "is the code fit for an audience beyond the author?"
>
> Violations don't break the framework — they leak private data, strand legal ambiguity, or ship unattributable artifacts. Harder to fix later than before, per the same "retrofit = rewrite" logic as Rule 1.

---

## The three pillars

### 1. No personal data in generic code
Anything a stranger would never need to know about the maintainer must not live in templates, prompts, standards, profiles, hooks, or install scripts. Includes:

- Full paths scoped to the maintainer's machine (e.g. `<home>/path/to/repo`, absolute Windows paths)
- Personal email addresses, phone numbers, social handles
- Project names the maintainer owns privately (their other client or personal projects)
- Internal URLs (company Slack, private Notion, private GitHub projects)

**Allowed in designated personal files** (gitignored from the shipped bundle): `projects/<slug>.md` entries for the maintainer's private projects, `insights/<dated>.md` sessions, `journal/*.jsonl`, `research/<slug>-<date>.md` caches, `module.local.yaml` (if adopted).

### 2. Clear licensing + attribution
- `LICENSE` names a specific license with SPDX identifier
- `Proprietary`/`All Rights Reserved` blocks all beta distribution — either clearly OSS (MIT/Apache-2.0/etc.) or **source-available** (PolyForm Noncommercial 1.0.0, Elastic License 2.0)
- `Required Notice` (PolyForm) or copyright header present on copy-redistributable files
- Third-party dependencies listed with their licenses (when we add any)

### 3. Stranger can reproduce the install
- `README.md` onboarding tested fresh: unfamiliar user gets from clone → working hook in ≤10 minutes
- `install.sh` + `install.ps1` make no Dave-specific assumptions (tested on macOS + Ubuntu in addition to Dave's Windows)
- `CORTEX_HOME` env var honored for side-by-side installs
- `CONTRIBUTING.md` states the beta posture (currently closed, how to reach maintainer)
- `SECURITY.md` states disclosure contact

---

## Staging / prod architecture

**Single repo. Two channels. Promote by tagging.**

Grounded in research ([`research/beta-distribution-2026-04-17.md`](../research/beta-distribution-2026-04-17.md)) — Claude Code's `autoUpdatesChannel: latest|stable` model + GitHub native `--prerelease` flag. BMAD's dual-npm-channel is overkill at Dave's scale; Aider's single-stream too coarse once breaking changes ship.

| Channel | Branch / Tag | Purpose | Audience |
|---|---|---|---|
| **`beta`** | `main` HEAD | Rolling latest. Breaking changes possible between day 1 and day 7. | Beta testers who explicitly opt in |
| **`stable`** | semver tag `vX.Y.Z` | Reproducible release. No changes after tag is cut. | Default for new installs |

**Install resolution:**

```bash
CORTEX_CHANNEL=beta   ./install.sh   # tracks main
CORTEX_CHANNEL=stable ./install.sh   # checks out highest non-prerelease tag (default)
```

**Update flow:**
- `beta`: `git fetch origin && git reset --hard origin/main` (Dave's control plane for beta iteration)
- `stable`: `git fetch --tags && git checkout $(git tag -l "v*" --sort=-v:refname | grep -v beta | head -1)`

**Version scheme:**
- `v0.x.y` — pre-first-stable; every tag can have breaking changes
- `v0.x.y-beta.N` — pre-release snapshots pushed while testing next tag
- `v1.0.0` — first contract-stable tag (everything tagged after this respects semver)

---

## Required artifacts (before first beta ship)

- [ ] `LICENSE` — specific license, SPDX identifier, not "Proprietary"
- [ ] `README.md` — no personal email; install → first journal entry in ≤10 min
- [ ] `CONTRIBUTING.md` — beta posture + contact channel
- [ ] `SECURITY.md` — disclosure contact
- [ ] `MIGRATIONS.md` — empty but present (becomes v-keyed log on first breaking change)
- [ ] `CHANGELOG.md` — empty but present
- [ ] `.gitignore` — personal data dirs excluded
- [ ] CI grep gate (can be shell script for v0) blocking commits containing personal identifiers

---

## Reserved environment variables (document now, use later)

Even if unimplemented, reserve names so the future opt-in doesn't collide:

| Var | Purpose | v0 behavior |
|---|---|---|
| `CORTEX_HOME` | Override cortex-x install root (where framework lives) | Honored — hook `resolveCortexRoot()` checks this first + validates via signature file + `$HOME` containment |
| `CORTEX_HOME_ALLOW_EXTERNAL` | Opt-out of `$HOME` containment check for `CORTEX_HOME` | Reserved — set to `1` only if you deliberately run cortex-x from outside your home dir |
| `CORTEX_CHANNEL` | `beta` \| `stable` — chooses rolling vs tagged install | Honored by `install.sh` / `install.ps1` |
| `CORTEX_LANGUAGE` | `en` \| `cs` \| `de` \| `fr` \| `es` — preferred communication language | Honored by installers; non-interactive installs must set it |
| `CORTEX_TELEMETRY_DISABLED` | Opt-out of future telemetry | Reserved, unused |
| `CORTEX_OFFLINE` | Skip auto-research network calls | Already honored ([config/research.yaml](../config/research.yaml)) |
| `CORTEX_NO_UPDATE` | Block self-update nag | Reserved |

Distinction: `CORTEX_HOME` = framework source directory (`<home>/cortex-x` by default, where you cloned the repo). `~/.claude/shared/` = install target that install scripts copy hooks into; not user-overridable today.

---

## Telemetry stance (opinionated)

**v0: zero telemetry.** No counters, no events, no phone-home. Journal stays strictly local.

**v0.3+ (if adopted): opt-IN, never opt-out.** Per research ([`research/beta-distribution-2026-04-17.md`](../research/beta-distribution-2026-04-17.md)) the 2026 baseline is Supabase/Vercel-style: env-var + CLI-command disable + public schema doc + DEBUG inspect mode. Vercel's Claude Code plugin that injected telemetry via prompt context was publicly shamed ([akshaychugh.xyz/vercel-plugin-telemetry](https://akshaychugh.xyz/writings/png/vercel-plugin-telemetry)) — **never ship that pattern**.

If telemetry ever lands: explicit opt-in at first run, never default-on. Schema doc at `docs/telemetry-schema.md`. Inspection mode via `CORTEX_TELEMETRY_DEBUG=1`.

---

## Pre-ship grep gate (the bright line)

Before any `v*` tag, this command must return zero matches in shipped dirs. The regex **lives in [`config/ship-ready-denylist.txt`](../config/ship-ready-denylist.txt)** so this doc doesn't contain the literal tokens it forbids (which would self-trigger the gate):

```bash
# Gate reads shipped (generic) + local (maintainer-specific) denylists.
# Excludes self-documenting files + maintainer-private dirs.
DENYLIST=$(mktemp)
cat config/ship-ready-denylist.txt config/ship-ready-denylist.local.txt 2>/dev/null > "$DENYLIST"
git ls-files -co --exclude-standard | \
  grep -vE '^(standards/ship-ready\.md|standards/coding-behavior(-examples)?\.md|config/ship-ready-denylist(\.local)?(\.txt|\.local\.txt\.example)|CHANGELOG\.md|MIGRATIONS\.md|research/|insights/|projects/|journal/)' | \
  xargs -r grep -nEf "$DENYLIST" \
  && echo "BLOCK: personal identifier leak" && rm -f "$DENYLIST" && exit 1
rm -f "$DENYLIST"
```

Shipped `config/ship-ready-denylist.txt` contains ONLY generic patterns (no maintainer-specific slugs). Maintainer's real patterns live in the gitignored sibling `config/ship-ready-denylist.local.txt` — copy `config/ship-ready-denylist.local.txt.example` to start.

Exceptions (by design — not leaks):
- `CLAUDE.md` Identity line may name the framework author if authorship matters to users — but never email, paths, or names of other private projects.
- `projects/cortex-x.md` is the framework's self-entry and OK as-is.
- `LICENSE` `Required Notice` line intentionally names the licensor per PolyForm `§Notices`.
- `standards/ship-ready.md` (this file) and `CHANGELOG.md` / `MIGRATIONS.md` are excluded because they discuss the denylist abstractly.

Forkers: update `config/ship-ready-denylist.txt` with your own private project slugs + personal email pattern. Do not edit this standard to hardcode them.

---

## Enforcement

### A) At distribution time
Pre-ship grep gate (above). If CI grows, this becomes a GitHub Actions check on `main` + all tags.

### B) At scaffold time ([prompts/new-project.md](../prompts/new-project.md) Phase 4.4)
When cortex scaffolds a new project, the scaffolded output must itself satisfy ship-ready: `CLAUDE.md` has no hardcoded user-scoped paths, `.env.example` present, `LICENSE` stub written with user's choice, not "Proprietary" by default.

### C) At review time ([prompts/code-review.md](../prompts/code-review.md))
`ssot-enforcer` already detects duplication; extend its scope (or add `ship-ready-auditor` as 6th pipeline agent) to grep new diffs for personal identifiers. Any leak → 🔴 block.

### D) At evolve time ([prompts/cortex-evolve.md](../prompts/cortex-evolve.md))
Weekly mining surfaces ship-ready regressions as priority insights. A new commit containing `davidrajnoha@` in a template is a Rule-0 violation (higher than Rule 1).

---

## What ship-ready is NOT

- ❌ **Open source by default.** Ship-ready = distributable, not OSS. PolyForm Noncommercial is source-available. Dave can relicense to MIT later if scope changes.
- ❌ **Multi-tenant architecture.** Beta testers run local, own their data, never share with Dave's install. No SaaS machinery required at v0.
- ❌ **Full CI/CD from day 1.** One `install.sh`, one grep gate, semver tags. Automation arrives when manual work bites.
- ❌ **`cortex` CLI binary mandatory.** Paste-prompt UX works for v0. CLI is v0.2+ quality-of-life.
- ❌ **i18n.** UI is Czech in Dave's own install per his preference; shipped docs/prompts in English is the baseline.

---

## Tier relationship

```
Rule 0   — Ship-Ready              (governance — for whom is this code?)
Rule 1   — SSOT+Modular+Scalable   (technical invariants — is the code fit for purpose?)
Rule 1.5 — Coding Behavior         (how the LLM produces code — think first, surgical, goal-driven)
Rule 2   — Security+Testing+Obs    (quality-critical)
Rule 3   — Process standards       (should-haves)
```

Ship-ready doesn't outrank Rule 1 technically — it precedes it. Before we ask "is this SSOT-clean?" we first ask "is this distributable at all?" A perfectly SSOT-clean file with a hardcoded maintainer email fails Rule 0 before Rule 1 even runs.

---

## Audit results (2026-04-17, initial pass)

## Known deferred debt (accepted for closed-beta, must resolve before public tag)

Two items identified by the review pipeline are intentionally not fixed in working-tree commits — they require one-time destructive operations or signing infrastructure:

1. **Git history residue.** Commits before 2026-04-19 contain `projects/relo.md` (which names a non-consenting third party), `projects/amd-hackathon-2026.md`, `insights/2026-04-17-amd-retrofit-gaps.md`, `docs/framework-rfc.md` in blob history. Working tree is clean. **Fix before first public `git clone`-able tag:** `git filter-repo --invert-paths --path projects/relo.md --path projects/amd-hackathon-2026.md --path insights/2026-04-17-amd-retrofit-gaps.md --path docs/framework-rfc.md` + force-push (acceptable only because no external clones exist yet). Alternative: squash the repo into a fresh one at v0.0.0-beta.1 tag time.

2. **Signed tags not enforced by install.sh/.ps1.** `CORTEX_CHANNEL=stable` auto-checkouts the highest semver tag. If the maintainer's GitHub account is compromised, a malicious tag ships to every beta tester on stable on their next `install.sh` run. **Fix before tag:** require `git tag -v "$LATEST" || exit 1` in install scripts; document the signing key fingerprint in `SECURITY.md`.

Also flagged but NOT blockers:
- `.hook-errors.log` mode 0600 is a no-op on Windows. Document in `SECURITY.md` that cortex-x should not be cloned under world-readable paths like `C:\Users\Public\`.

## Audit trail

Initial pass state → final state (2026-04-19):

| Artifact | Was | Fix | Status |
|---|---|---|---|
| `LICENSE` | `Proprietary` blocks beta | PolyForm Noncommercial 1.0.0 | ✅ done |
| `README.md` | Personal email in public docs | Link to GitHub contact | ✅ done |
| `projects/relo.md`, other private project entries | Private data shipped | Gitignored + `git rm --cached` | ✅ done |
| `insights/20*-*.md` at top level | Private insights shipped | Gitignore pattern | ✅ done |
| `prompts/new-project.md`, `prompts/cortex-doctor.md` | Hardcoded maintainer paths | `{cortex_root}` / `$CORTEX_HOME` | ✅ done |
| `module.yaml` config.user_name / author | Maintainer name as default | Empty default + `module.local.yaml` override pattern | ✅ done |
| `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATIONS.md`, `CHANGELOG.md` | Missing | Stubs added | ✅ done |
| Denylist in this standard itself | Self-triggering grep gate | Extracted to `config/ship-ready-denylist.txt` | ✅ done (2026-04-19) |
| `CORTEX_HOME`/`CORTEX_CHANNEL` docs | Claimed "Honored" but unimplemented | Implemented in install scripts + `resolveCortexRoot()` | ✅ done (2026-04-19) |
| `logErr()` in hooks | Error messages unredacted → secrets leak | Redacted via shared `_lib/redact.cjs` | ✅ done (2026-04-19) |
| `module.yaml:44 default_license: proprietary` | Scaffolds `Proprietary` into new projects | Empty → user chooses at scaffold | ✅ done (2026-04-19) |

Post-remediation grep gate passes. See `CHANGELOG.md` for commit hashes.
