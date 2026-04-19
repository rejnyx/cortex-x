---
project: cortex-x
topic: beta-distribution
date: 2026-04-17
trigger: major_decision — the maintainer plans to ship cortex-x to ~5-20 beta testers. Needs staging/prod architecture + ship-ready blockers.
agents: [competitive, technical, security]
cache_ttl_days: 180
cost_estimate: "~$0.25"
---

# Research: Beta distribution for a solo-dev Claude Code framework

## Trigger

the maintainer wants to share cortex-x with a small circle of beta testers (solo devs / friends). No fixed timeline. He explicitly requested "staging and prod phases" and "as little tech debt as possible now so shipping doesn't require rewrite." Research commissioned before writing `standards/ship-ready.md`.

## TL;DR

- **Pattern:** GitHub tagged releases + `--prerelease` flag. One repo, one `main` branch as rolling beta, semver tags `vX.Y.Z` as stable. `install.sh/.ps1` reads `CORTEX_CHANNEL` env var. No npm, no platform, no separate repo.
- **Biggest risk:** personal identifiers (email, full paths, private project names) leaking into templates/prompts/profiles. They embed on every user's machine permanently after install.
- **First concrete step:** audit-grep `davidrajnoha@`, `C:\Users\david`, `project-a`, `project A`, `project-b`, `project-c` across `templates/`, `profiles/`, `standards/`, `prompts/`. Add CI gate.

## Key findings

### 1. Release channels (solo-dev reality)
- BMAD-METHOD ships dual-channel npm (`@latest` + `@next`) via GitHub Actions — overkill for 20 users, but proof-of-pattern ([deepwiki BMAD 11.5](https://deepwiki.com/bmad-code-org/BMAD-METHOD/11.5-release-process-and-cicd))
- Aider uses single PyPI stream + `pip install --pre` for early versions ([aider PyPI](https://pypi.org/project/aider-chat/))
- Claude Code itself exposes `autoUpdatesChannel` with only `latest`/`stable` ([code.claude.com/setup](https://code.claude.com/docs/en/setup))
- **Lightest pattern = Claude Code's: two channels, not three.** GitHub's native `--prerelease` flag supports this with zero CI

### 2. Telemetry opt-in (ethical baseline 2026)
- Supabase CLI + Vercel CLI converged on same pattern: on-by-default, disable via `<TOOL>_TELEMETRY_DISABLED=1` env var OR `<tool> telemetry disable` command, **public schema doc** listing exactly what's collected, explicit exclusion of file paths/contents/env vars ([Supabase](https://supabase.com/docs/guides/telemetry), [Vercel](https://vercel.com/docs/cli/about-telemetry))
- Vercel adds `VERCEL_TELEMETRY_DEBUG=1` for local inspection — this is the ethical baseline
- **Cautionary tale:** Vercel's Claude Code plugin injected telemetry via prompt context rather than CLI → publicly shamed ([akshaychugh.xyz](https://akshaychugh.xyz/writings/png/vercel-plugin-telemetry), [vercel/vercel-plugin#34](https://github.com/vercel/vercel-plugin/issues/34)). Do NOT replicate
- **Recommendation for cortex-x v0:** ship with ZERO telemetry. Reserve `CORTEX_TELEMETRY_DISABLED=1` env-var name now so default-on opt-out later doesn't surprise

### 3. Version isolation (`CORTEX_HOME` pattern)
- Neither fnm/asdf/volta expose "side-by-side same tool" patterns — they version managed runtimes, not themselves
- Convention that works: respect `XDG_CONFIG_HOME` + expose `<TOOL>_HOME` override (npm `npm_config_prefix`, Volta `VOLTA_HOME`) ([honeybadger](https://www.honeybadger.io/blog/node-environment-managers/))
- **For cortex-x:** default `~/.claude/shared/`, override via `CORTEX_HOME=~/.cortex-beta`

### 4. Feedback collection (<50 users)
- Lowest-friction 2026 pattern: `gh issue create -t "…" -b "…"` invoked from a `cortex feedback` command, prefilled with `cortex doctor` output (OS, channel, version, last error)
- gh CLI `-T <template>` still prompts non-interactively ([cli/cli#7405](https://github.com/cli/cli/issues/7405), [cli/cli#7856](https://github.com/cli/cli/issues/7856))
- **Skip Discord at this scale** — signal-to-noise terrible, fragments the archive

### 5. Update mechanism (git-clone install)
- `git fetch --tags && git checkout <latest-matching-tag>` beats `git pull main` — tags = reproducible rollback
- Aider's `pip install -U` only clean because PyPI enforces immutability ([aider install](https://aider.chat/docs/install.html))
- Claude Code does delta-binary self-update — not achievable for git-based distribution ([Claude Code changelog](https://claudefa.st/blog/guide/changelog))
- For breaking changes: `MIGRATIONS.md` keyed by version + `cortex doctor --migrate` check on first launch after update

### 6. Staging-vs-prod semantic for a 4-hrs/week maintainer
- BMAD's "bleeding-edge bundle from main + tagged stable release" is right shape but too much CI ([deepwiki BMAD release](https://deepwiki.com/bmad-code-org/BMAD-METHOD/11.3-release-process))
- **Solo-dev model:** `main` = staging (beta testers track HEAD), semver tags = prod. No separate repo. Promote by tagging, nothing else ([semantic-release pre-releases](https://github.com/semantic-release/semantic-release/blob/master/docs/recipes/release-workflow/pre-releases.md))

### 7. Actual ship-ready blockers (not nice-to-have)
- **LICENSE:** `Proprietary` blocks beta testers legally. Switch to **PolyForm Noncommercial 1.0.0** — SPDX-registered, plain-English, lets testers use it without you granting OSS freedoms ([polyformproject.org](https://polyformproject.org/licenses/))
- **Grep gate** for `<maintainer-email>`, `C:\Users\david`, `Rejnyx`, `project A`, `project-a`, `project-b`, `project-c` across all shipped dirs
- **`CONTRIBUTING.md`** stub (even "closed beta, email the maintainer") — GitHub surfaces a warning without one
- **`SECURITY.md`** with 1-line disclosure contact
- **`install.sh`/`.ps1`** must not assume Windows-specific paths — test on macOS
- **Reserve** `CORTEX_TELEMETRY_DISABLED=1` name in docs so future default-on doesn't surprise users

## Recommended approach (decision matrix)

| Axis | Decision |
|---|---|
| Repo structure | **Single repo**, no separate staging repo |
| Channels | `main` = beta (HEAD), tagged semver `vX.Y.Z` = stable |
| Versioning | semver, `v0.x.y` until first stable, `-beta.N` suffix for pre-tags |
| Install | `CORTEX_CHANNEL=beta\|stable` env var, `CORTEX_HOME` override |
| Update | `cortex update` = `git fetch --tags && git checkout <tag>`; stable resolves highest non-prerelease tag |
| Feedback | `cortex feedback` → `gh issue create` with doctor output prefilled |
| Telemetry | **NONE at v0.** Reserve env-var name. Add opt-IN (not opt-out) in v0.3 with public schema doc |
| License | **PolyForm Noncommercial 1.0.0** |
| Pre-ship gate | CI grep for personal identifiers + path separators |

## Sources

- [GitHub: Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) — `--prerelease` flag semantics
- [Claude Code advanced setup](https://code.claude.com/docs/en/setup) — two-channel `autoUpdatesChannel` model
- [BMAD release process](https://deepwiki.com/bmad-code-org/BMAD-METHOD/11.5-release-process-and-cicd) — dual-channel npm reference
- [Supabase telemetry](https://supabase.com/docs/guides/telemetry) — env-var + CLI-command opt-out baseline
- [Vercel CLI telemetry](https://vercel.com/docs/cli/about-telemetry) — public schema + DEBUG inspect mode
- [Vercel plugin telemetry controversy](https://akshaychugh.xyz/writings/png/vercel-plugin-telemetry) — what NOT to do
- [cli/cli issue #7405](https://github.com/cli/cli/issues/7405) — gh non-interactive template limitations
- [semantic-release pre-releases](https://github.com/semantic-release/semantic-release/blob/master/docs/recipes/release-workflow/pre-releases.md) — branch-to-channel mapping
- [PolyForm Licenses](https://polyformproject.org/licenses/) — source-available for non-OSS beta
- [Node version manager comparison](https://www.honeybadger.io/blog/node-environment-managers/) — XDG / `*_HOME` env conventions

## Synthesis

For cortex-x at beta scale (~5-20 users, 4 hrs/week maintainer): **one repo, two channels, zero telemetry, grep gate, PolyForm Noncommercial license.** Everything else (CI automation, `cortex` CLI binary, telemetry opt-in, migrations) is v0.1+ scope. `standards/ship-ready.md` encodes these decisions as invariants; `docs/beta-distribution-rfc.md` captures the rationale.

## Recommended actions

1. Replace LICENSE with PolyForm Noncommercial 1.0.0
2. Strip personal email from public README
3. Gitignore personal data paths (projects/*.md except cortex-x.md, insights/, journal/, research/ dated entries) + `git rm --cached`
4. Fix hardcoded `~/Desktop/APPs/cortex-x/` in 2 prompts
5. Add CONTRIBUTING.md + SECURITY.md stubs
6. Write `standards/ship-ready.md` with staging/prod invariants
7. Add env-var reservation + placeholder `MIGRATIONS.md` to docs
8. Defer: `cortex` CLI binary, CI grep gate, telemetry opt-in — v0.1
