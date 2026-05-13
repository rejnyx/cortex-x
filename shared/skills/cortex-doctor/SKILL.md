---
name: cortex-doctor
description: Health check + drift detection for the cortex-x install on this machine. Runs the bin/cortex-doctor.cjs CLI, parses findings, and offers interactive auto-fix for each non-ok check (Y/n per finding). Useful weekly, after a fresh install, after a migration to a new machine, or when cortex behavior feels off. Triggers (EN+CZ) "/cortex-doctor", "/doctor", "doctor", "healthcheck cortex", "co je rozbité na cortexu", "is cortex healthy", "cortex není v pořádku", "cortex broken". Surfaces hooks-registered status, CLAUDE.md discipline block status, source clone state, data home subdirs, skills + agents discovery. Composes with cortex-hooks-register and cortex-claude-md-augment for one-tap remediation.
disable-model-invocation: false
---

# /cortex-doctor — health check + drift detection

You are running the cortex-x healthcheck. Goal: report install state in plain language, offer to fix anything that's broken, NEVER make destructive changes without consent.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words. Counts not praise.

## Step 1 — language signal

Read prior-turn language. If Czech, answer in Czech. Otherwise English.

## Step 2 — run the CLI

Invoke the CLI via Bash tool:

```bash
cortex-doctor --json
```

If the `cortex-doctor` shim isn't on PATH (fresh install where PATH wasn't updated), fall back to:

```bash
node ~/.claude/shared/bin/cortex-doctor.cjs --json
```

Or in absolute Windows form:

```bash
node "$HOME/.claude/shared/bin/cortex-doctor.cjs" --json
```

Parse the JSON. The schema is:

```json
{
  "ok": true | false,
  "counts": { "ok": N, "info": N, "warn": N, "error": N },
  "findings": [{ "id": "<check-id>", "severity": "ok|info|warn|error", "message": "<text>", "fix": "<command>|null" }],
  "cortex_data_home": "<path>",
  "cortex_source": "<path>"
}
```

## Step 3 — present a compact report

Group findings by severity. ALWAYS surface error + warn first, ok last. Use a table or list — never prose paragraphs. Example output structure (Czech):

```
cortex-doctor:
  ✗ ERRORS (1)
    • <id>: <message>
      Fix: <command>
  ! WARNINGS (2)
    • <id>: <message>
      Fix: <command>
  ✓ OK (6)  [collapsed list of ids]

  Co je v pořádku · 6 čeků · 0 chyb · 2 varování.
```

Voice charter compliance: counts, not emotion. "1 chyba, 2 varování" not "ouvej, máš problémy".

## Step 4 — offer auto-fix per non-ok finding

For EACH finding with severity ∈ {error, warn} AND non-null `fix` field, ask the operator if they want to run the fix command now. Use `AskUserQuestion` with two options per fix:

- **Fix now** — execute the `fix` command via Bash tool. Show output. Re-run cortex-doctor afterward to confirm the finding is gone.
- **Skip** — note + move to next finding.

Order findings by severity descending (errors first). Process one at a time so the operator can see each fix's effect before continuing.

For the most common fixes — DO NOT fabricate commands; use the exact `fix` field from the JSON. Examples:

- `cortex-hooks-register` — registers cortex hooks in `~/.claude/settings.json` with backup.
- `cortex-claude-md-augment` — appends discipline block to `~/.claude/CLAUDE.md` with backup.
- `bash ~/cortex-x/install.sh` (or `pwsh ~/cortex-x/install.ps1`) — re-runs installer.
- `mkdir -p <path>` — creates missing data home subdirs.

**Safety rule:** never run a `fix` command that wasn't surfaced by cortex-doctor's JSON output. The CLI is the SSOT for what's broken AND how to fix it.

## Step 5 — final summary

After all fixes attempted, re-run `cortex-doctor --json` once more and print the final counts:

```
After fixes: 8 ok · 0 warn · 0 error.
cortex-x is healthy.
```

If errors remain after the fix attempts, point the operator at:

- `~/.claude/shared/INSTALL_NOTES.md` for manual setup details
- `https://github.com/Rejnyx/cortex-x/issues` to file a bug if the fix didn't help

## When NOT to use

- Mid-workflow (during `/start`, `/audit`, `/designer` flow) — that's not a doctor moment, it's a feature-flow moment. Resume the original task.
- Right after `install.sh` succeeded with the in-installer prompts (hooks + CLAUDE.md were just configured) — wait at least one Claude session before running doctor so SessionStart context can demonstrate they work.

## Composes with

- `cortex-hooks-register` — most common error fix
- `cortex-claude-md-augment` — second most common info finding
- `cortex-update --check` — separate command for upgrade availability (cortex-doctor only verifies CURRENT install)
