---
name: cortex-update
description: Update the cortex-x install on this machine — fetch latest source, fast-forward if possible, re-run installer. Wraps the bin/cortex-update.cjs CLI. Useful weekly or when CHANGELOG mentions a new version. Triggers (EN+CZ) "/cortex-update", "update cortex", "upgrade cortex", "cortex je staré", "aktualizuj cortex", "what's new in cortex", "is there a cortex update", "máš novou verzi cortexu". Safe by default — refuses on dirty tree, only fast-forwards (never rewrites history), aborts cleanly on network failure. After update finishes, recommends `claude` session restart so Claude Code reloads the refreshed `~/.claude/shared/`.
disable-model-invocation: false
---

# /cortex-update — fetch latest + re-install on top

You are running the cortex-x updater. Goal: report whether the local install is behind, offer to update, and explain the session-restart implication AFTER the update finishes.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words. Counts not praise.

## Why this skill is thin

`cortex-update` is a real CLI shipped at `~/.claude/shared/bin/cortex-update` (and `bin/cortex-update.cjs` in source). This skill exists for discoverability — running the CLI directly in terminal is functionally identical. The only thing the skill adds: the session-restart explanation + a Czech/English UX wrapper.

## Step 1 — language signal

Read prior-turn language. If Czech, answer in Czech. Otherwise English.

## Step 2 — check first, never auto-pull

Run the CLI in `--check` mode via Bash tool — this is read-only (fetch + compare, no pull, no installer run):

```bash
cortex-update --check
```

Fallback if shim isn't on PATH:

```bash
node ~/.claude/shared/bin/cortex-update.cjs --check
```

Or in `--json` mode for structured parsing:

```bash
cortex-update --json
```

The JSON schema is:

```json
{
  "ok": true|false,
  "status": "up_to_date" | "behind" | "ahead" | "diverged" | "dirty" | "no_remote" | "offline",
  "behind_by": N,
  "ahead_by": N,
  "current_sha": "<short>",
  "remote_sha": "<short>",
  "source_path": "<abs>",
  "channel": "stable" | "beta"
}
```

## Step 3 — report status compactly

Render counts, not prose. Examples:

- `status: up_to_date` → "cortex-x je aktuální (HEAD `<sha>`, channel `<channel>`)." Stop here.
- `status: behind` → "cortex-x je 4 commit(y) za origin. Latest remote: `<sha>`." Continue to Step 4.
- `status: ahead` → "Lokálně máš 22 commitů, které ještě nejsou na origin. Update odmítl ff (nepřepisuje historii). Push first, nebo `--reinstall` aby přeskočil git pull." Stop here.
- `status: diverged` → "Lokální a remote se rozcházejí — manuální merge nebo rebase. Update odmítl pokračovat." Stop here.
- `status: dirty` → "Working tree má nestaged changes. Commit nebo stash a re-run." Stop here.
- `status: offline` → "Git fetch selhal (offline?). Install zůstává beze změny."

## Step 4 — ask before pulling

Use `AskUserQuestion` with three options:

- **Update now** — run `cortex-update --yes` (skips the CLI's own interactive prompt; the skill is providing the confirmation gate)
- **Just reinstall current source** — run `cortex-update --reinstall --yes` (no git pull, just re-runs `install.sh` / `install.ps1` from current HEAD; useful if install script changed but you don't want new source commits)
- **Skip** — note the available updates + exit

If operator picks "Update now":

```bash
cortex-update --yes
```

If "Just reinstall":

```bash
cortex-update --reinstall --yes
```

Show output. Exit code 0 = success. Anything else = surface the error to operator.

## Step 5 — session restart advisory (always)

After ANY successful update or reinstall, surface this line in Czech (or English):

> **`~/.claude/shared/` se právě přepsalo.** Claude Code načítá hooks/skills/agents/standards při startu session. Aktuální session má **starou kopii v paměti**. Doporučení: ukončit + spustit `claude` znovu, aby se nahrály nové verze.

This is non-negotiable — every cortex-update changes files Claude Code is currently reading. Without restart, new skills / hooks / standards stay invisible until next session.

## What `cortex-update` does NOT do

- ❌ Modify `~/.cortex/` (operator data — research, projects, journal, insights — never touched)
- ❌ Modify `~/.claude/CLAUDE.md` (operator-owned)
- ❌ Modify `~/.claude/settings.json` (only `cortex-hooks-register` writes that, never `cortex-update`)
- ❌ Run on a dirty working tree (refuses to start)
- ❌ Force-push or rewrite history (only fast-forwards)
- ❌ Run on a detached HEAD (refuses to start)

## Composes with

- `/cortex-doctor` — verifies install integrity AFTER update finishes. Recommended sequence: update → restart `claude` → `/cortex-doctor`.
- `cortex-hooks-register --status` — if update added new hooks, register them.
- `cortex-permissions-register --status` — if update tightened safety floor, sync permissions.
