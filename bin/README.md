# bin/

CLI entry points shipped to `~/.claude/shared/bin/` (or `~/.cortex/bin/` depending on XDG layout) by the installer. Each tool is a thin cross-platform wrapper around a `.cjs` implementation; the `.cjs` does the work, the shell/PowerShell shims delegate to it via `cortex-source.yaml`.

## CLI roster

| Command | Shim | Implementation | Purpose |
|---|---|---|---|
| `cortex-bootstrap` | `cortex-bootstrap`, `cortex-bootstrap.ps1` | `cortex-bootstrap.cjs` | Scaffold a new project (`/cortex-init` skill is the preferred entry; this is the low-level alternative). |
| `cortex-steward` | `cortex-steward`, `cortex-steward.ps1` | `cortex-steward.cjs` → `steward/dry-run.cjs` / `steward/execute.cjs` / `steward/status.cjs` | Autonomous maintenance agent — dry-run, execute, status. See [`steward/README.md`](./steward/README.md). |
| `cortex-capabilities` | _(direct)_ | `cortex-capabilities.cjs` | Regenerate `cortex/capabilities.{md,json}` registry from filesystem scan. |
| `cortex-gap-report` | `cortex-gap-report`, `cortex-gap-report.ps1` | `cortex-gap-report.cjs` | One-shot completeness check for a retrofit (which standards / hooks / templates are missing). |
| `cortex-migrate-data` | `cortex-migrate-data.sh`, `cortex-migrate-data.ps1` | `bin/_lib/cortex-migrate.cjs` | Migrate operator data from legacy install location to current `$CORTEX_DATA_HOME`. |

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
