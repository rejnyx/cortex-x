# bin/

CLI entry points shipped to `~/.claude/shared/bin/` (or `~/.cortex/bin/` depending on XDG layout) by the installer. Each tool is a thin cross-platform wrapper around a `.cjs` implementation; the `.cjs` does the work, the shell/PowerShell shims delegate to it via `cortex-source.yaml`.

## CLI roster

| Command | Shim | Implementation | Purpose |
|---|---|---|---|
| `cortex-bootstrap` | `cortex-bootstrap`, `cortex-bootstrap.ps1` | `cortex-bootstrap.cjs` | Non-interactive CI fallback for `/cortex-init` + bootstrap-pending-marker writer. The `/cortex-init` skill is the interactive path. |
| `cortex-steward` | `cortex-steward`, `cortex-steward.ps1` | `cortex-steward.cjs` → `steward/dry-run.cjs` / `steward/execute.cjs` / `steward/status.cjs` | Autonomous maintenance agent — dry-run, execute, status. See [`steward/README.md`](./steward/README.md). |
| `cortex-update` | _(direct)_ | `cortex-update.cjs` | `bun upgrade` / `uv self update` style — fetch source clone, fast-forward, re-run installer. Flags: `--check`, `--reinstall`, `--json`. |
| `cortex-uninstall` | _(direct)_ | `cortex-uninstall.cjs` | Conservative removal — preserves `$CORTEX_DATA_HOME` by default. Flags: `--dry-run`, `--purge` (DESTRUCTIVE), `--backup`, `--keep-source`, `--yes`. |
| `cortex-capabilities` | _(direct)_ | `cortex-capabilities.cjs` | Regenerate `cortex/capabilities.{md,json}` registry from filesystem scan. |
| `cortex-gap-report` | `cortex-gap-report`, `cortex-gap-report.ps1` | `cortex-gap-report.cjs` | One-shot completeness check for a retrofit (which standards / hooks / templates are missing). |
| `cortex-migrate-data` | `cortex-migrate-data.sh`, `cortex-migrate-data.ps1` | `bin/_lib/cortex-migrate.cjs` | Migrate operator data from legacy install location to current `$CORTEX_DATA_HOME`. |
| `cortex-wiki-consolidate` | _(direct)_ | `cortex-wiki-consolidate.cjs` | Group lessons into Obsidian-compatible wiki articles. Flags: `--slug`, `--max-kinds`, `--top-k`, `--dry-run`. |
| `cortex-propose-skill` | _(direct)_ | `cortex-propose-skill.cjs` | LLM-scaffold skill candidates from journal mining (Sprint 3.1 v0). Subcmds: `list`, `scaffold`. Promotion remains operator-only. |
| `cortex-lessons-search` | _(direct)_ | `cortex-lessons-search.cjs` | FTS5 search over per-slug `lessons.jsonl`. Subcmds: `build`, `text`, `kind`, `code`. |
| `cortex-evolve-ab` | _(direct)_ | `cortex-evolve-ab.cjs` | A/B prompt champion-vs-challenger eval harness. Subcmds: `run`, `compare`. |
| `cortex-export-lessons` | _(direct)_ | `cortex-export-lessons.cjs` | Export top-K lessons to Claude Code auto-memory directory. |
| `cortex-doc-audit` | _(direct)_ | `cortex-doc-audit.cjs` | Score markdown docs for agent-readability (Sprint 2.8.3 agent-first docs scorer). |
| `cortex-hooks-register` | _(direct)_ | `cortex-hooks-register.cjs` | Opt-in idempotent JSON merge of cortex hooks into `~/.claude/settings.json` with timestamped backup. Identity rule: entries with `hooks[].command` path under `.claude/shared/hooks/` are cortex-owned; user entries on same event preserved. Flags: `--apply` (default), `--remove`, `--status`, `--dry-run`, `--yes`, `--json`. Sprint 2.21. |
| `cortex-claude-md-augment` | _(direct)_ | `cortex-claude-md-augment.cjs` | Opt-in BEGIN/END-marker append of cortex discipline block to `~/.claude/CLAUDE.md` (R1+R2+TodoWrite+voice+surgical). v2 block (Sprint 2.21.1). Refuses on orphan markers or non-UTF8 content (Sprint 2.21.2 R2 hardening). Flags: `--apply`, `--remove`, `--status`, `--dry-run`, `--yes`, `--json`. |
| `cortex-permissions-register` | _(direct)_ | `cortex-permissions-register.cjs` | Opt-in idempotent merge of safety-floor permissions into `~/.claude/settings.json` with timestamped backup (mode 0o600). Curated deny floor (destructive ops) + allow baseline (common-safe ops). Replaces `--dangerously-skip-permissions`: same speed, `deny > ask > allow > defaultMode` precedence floor. Identity rule: exact-string match against CORTEX_PERMISSIONS manifest. Flags: `--apply` (default), `--remove`, `--status`, `--dry-run`, `--yes`, `--json`. Sprint 2.28 + 2.28.1 hardening. |
| `cortex-doctor` | `/cortex-doctor` skill | `cortex-doctor.cjs` | Health-check + drift detection: node version, source clone, data home subdirs, shared/ subdirs, required+recommended skills, agents count, hooks registered, permissions registered (incl. user catch-all `Bash(*)` warn), CLAUDE.md block, git remote. Flags: `--json`, `--fix-suggestions`. Exit 0 if no errors, 1 if any. Sprint 2.21 + 2.28. |

## Subdirectories

| Dir | Contents |
|---|---|
| [`steward/`](./steward/) | Steward autonomous-maintenance runtime (dry-run + execute + status orchestrators + `_lib/` primitives). |
| [`cortex/`](./cortex/) | Skill-side tools invoked by `/cortex-init`, `/cortex-help`, etc. |
| [`discord-bridge/`](./discord-bridge/) | Discord remote-control surface (Sprint 2.6 — optional). |
| [`_lib/`](./_lib/) | Helpers shared across bin/ entry points (file moves on install, version probes, etc.). |

## Shim contract

Every shim is a 5-10 line script that:

1. Locates `$CORTEX_ROOT` from `cortex-source.yaml` (written by installer).
2. Resolves the matching `.cjs` under `$CORTEX_ROOT/bin/`.
3. Invokes `node "$CORTEX_ROOT/bin/<tool>.cjs" "$@"`.

This keeps the install footprint at `~/.claude/shared/bin/` tiny + stable; the real runtime stays in the source repo and benefits from `git pull` updates without touching install state.
