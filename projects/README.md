# Project library — contract + storage layout

> **What is this?** The cortex-x **project library** — a per-machine catalog of every project the operator has scanned with cortex-x. Each entry is a 5-section summary that future Claude Code sessions reference for instant cross-project context.

## Where the data lives

The repo-tracked `projects/` directory holds **only this README** (the contract). The actual entries are written per-machine to `$CORTEX_DATA_HOME/projects/` (defaults to `~/.cortex/projects/`) — XDG-separated since Sprint 1.6, gitignored by design.

```
$CORTEX_DATA_HOME/projects/
├── <slug>.md            # one file per scanned project (5-section summary)
└── _index.md            # optional, per-machine, lists what's been scanned
```

## How to use

**To scan a project for the first time:** open Claude Code at the project root, paste `~/.claude/shared/prompts/project-scan.md`. Claude scans the codebase, writes `$CORTEX_DATA_HOME/projects/<slug>.md`.

**To update an existing entry after a notable work session:** paste `~/.claude/shared/prompts/cortex-sync.md` at end of session.

**To load context at start of an ongoing session:** the project's `CLAUDE.md` references `~/.claude/shared/prompts/cortex-load.md`.

## Entry format

Each `<slug>.md` follows the 5-section template:

1. **Identity** — name, slug, status, repo URL (if public)
2. **Tech Stack** — auto-detected, refreshed on each scan
3. **Architecture** — hand-curated, preserved across scans
4. **Lessons Learned** — what failed, what worked, what's transferable
5. **Cross-project edges** — patterns shared with sibling projects

Auto-generated sections (1, 2) refresh on every scan. Hand-curated sections (3, 4, 5) are preserved.

## Status legend

- **production** — live, serving users
- **active-dev** — actively developed, not yet in production
- **paused** — deprioritized, not abandoned
- **archived** — done, read-only

## Scan versioning

Each entry has `scan_version` in frontmatter. Bump when:
- Major tech-stack change (framework upgrade, primary language swap)
- Architectural refactor (monolith → service split, etc.)
- After a review-pipeline or hardening sprint that changes the project's posture

## Cross-project queries

Today: `grep` across `$CORTEX_DATA_HOME/projects/*.md`.

Roadmapped (Sprint 3.2 / 4.5):
- `cortex search <pattern>` — find projects using a given pattern / library
- `cortex graph` — visualize cross-project dependencies
- `cortex diff <a> <b>` — compare two projects
- `cortex transferable` — list every `[TRANSFERABLE]` insight across the library

## Philosophy

**Negative knowledge is gold.** Document what was *tried* and didn't work. Future sessions save hours by not re-running failed experiments.

**Explicit opt-in.** Don't auto-inject cross-project context into every session — use `@project:<slug>` mentions when relevant. Avoids "wrong project hallucination."

**Curated + generated.** Auto-generated sections (stack, stats, commands) stay fresh via scans. Hand-curated sections (lessons, decisions, edges) preserve institutional knowledge across years.

## Why the public repo doesn't ship live entries

Two reasons:
1. **Privacy.** Most operators have private client projects in their library — those slugs and architectures shouldn't leak.
2. **Drift.** Project state changes weekly; institutional knowledge (in cortex-x standards/) stays valid for years. Mixing the two breaks the SSOT contract documented in [../CLAUDE.md](../CLAUDE.md) § Core Mental Model.

If you fork cortex-x and want to share a project library publicly, add a `projects/cortex-x.md` (or similar) and explicitly stage it — the `.gitignore` excludes everything under `projects/` *except* `README.md` (this file) and `cortex-x.md` (the framework's own dogfood entry, when present).
