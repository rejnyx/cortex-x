# shared/hooks/

Universal Claude Code hooks shipped to `~/.claude/shared/hooks/` by the installer. They activate when registered in `~/.claude/settings.json` (the installer prints the JSON block — paste it in).

## Hook roster

| File | Hook event | Purpose |
|---|---|---|
| [`session-start.cjs`](./session-start.cjs) | `SessionStart` | Inject cortex context (project entry, branch, recent commits, doctor hints). Reads `cortex/projects/<slug>.md` if present. |
| [`block-destructive.cjs`](./block-destructive.cjs) | `PreToolUse` | Refuse `rm -rf /`, `git push --force` to main, `DROP TABLE`, `supabase db reset`, `--no-verify`, and similar destructive patterns unless an explicit operator override env var is set. |
| [`pre-tool-use.cjs`](./pre-tool-use.cjs) | `PreToolUse` | Per-tool guards (logs start ts for duration correlation, runs tirith-scan on context injections if `cortex-tirith` is installed). |
| [`post-tool-use.cjs`](./post-tool-use.cjs) | `PostToolUse` | Append one redacted JSONL entry per tool call to `~/.cortex/journal/YYYY-MM-DD-<slug>.jsonl`. Privacy contract: never logs file contents, user input, API responses, or secrets — only metadata. |
| [`pre-compact.cjs`](./pre-compact.cjs) | `PreCompact` | Save recovery state to `.claude/compact-state.md` before Claude Code compresses history. Lets the post-compact session resume without losing decision context. |
| [`auto-orchestrate.cjs`](./auto-orchestrate.cjs) | `Stop` | Trigger parallel subagent dispatch when stop conditions match the auto-orchestrate prompt's recipe. |
| [`tirith-scan.cjs`](./tirith-scan.cjs) | `PreToolUse` (Read) | Optional wrapper around the MIT Rust binary `cortex-tirith` — scans Read tool inputs for context-file injection attacks. Fails open if `cortex-tirith` isn't installed. |

## Fail-open contract

Every hook is **failure-isolated**: all errors are caught and swallowed, hook always exits 0. A broken hook MUST NOT crash a Claude Code session. Errors are written to `~/.cortex/.hook-errors.log` (redacted, rotated at 16 KB) so you can diagnose later without disrupting the session.

## Registration

The installer prints the canonical block. Manually:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/session-start.cjs\"", "timeout": 5 }] }],
    "PreToolUse":    [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/block-destructive.cjs\"", "timeout": 5 }] },
                       { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/pre-tool-use.cjs\"", "timeout": 3 }] }],
    "PostToolUse":   [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/post-tool-use.cjs\"", "timeout": 3 }] }],
    "PreCompact":    [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/pre-compact.cjs\"", "timeout": 5 }] }],
    "Stop":          [{ "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"", "timeout": 5 }] }]
  }
}
```

## Disabling

Set `CORTEX_HOOKS_DISABLED=1` to no-op every hook (still exits 0). Useful for debugging without uninstalling.

## Contract tests

Hook contracts are verified in [`tests/contract/`](../../tests/contract/) — each hook has an input-shape fixture and an output-shape assertion. Tier-4 hard gate.
