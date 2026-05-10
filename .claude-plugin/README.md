# Claude Code plugin manifest

This directory exposes cortex-x as a **Claude Code plugin** so it can be installed via the Claude Code marketplace (in addition to the existing `install.sh` / `install.ps1` curl one-liner).

## Status

**Closed beta.** The plugin manifest is shipped for forward-compat with Claude Code's plugin distribution path; the marketplace listing itself is gated behind the public v0.1.0 launch.

External users today should install via:

```bash
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
# or PowerShell
iwr -useb https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex
```

## Files

- `plugin.json` — marketplace manifest (name, skills, hooks, agents, commands).
- `README.md` — this file.

## What the manifest declares

| Surface | Count | Source of truth |
|---|---|---|
| Skills | 2 | `shared/skills/cortex-init/`, `shared/skills/test-audit/` |
| Hooks | 4 | `shared/hooks/` (SessionStart, PreToolUse, PreCompact, PostToolUse) |
| Agents | 9 | `agents/` (cortex-thinker, security-auditor, …) |
| Commands | 3 | `bin/cortex-steward`, `bin/cortex-bootstrap`, `bin/cortex-gap-report` |

## Why a plugin manifest matters

Until v0.1.0 public flip, the curl installer is the canonical install surface. Once cortex-x flips public, the plugin manifest opens a second distribution channel through the Claude Code marketplace — lower friction for users who already have Claude Code installed and want to discover community frameworks rather than running a one-liner.

This is a forward-compat artefact. Filling it in early means the v0.1.0 launch can flip the marketplace listing without engineering work.

## Validation

The manifest is JSON. To validate locally:

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); console.log('ok')"
```

A future Tier 7 standards-link integrity test will assert that every path in `plugin.json` resolves to an existing file in the repo.
