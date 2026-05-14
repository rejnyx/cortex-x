---
name: cortex-uninstall
description: Remove cortex-x from this machine — framework, shims, skills, agents. Wraps the bin/cortex-uninstall.cjs CLI. Safe-by-default — preserves $CORTEX_DATA_HOME (~/.cortex/) which holds research/projects/journal/insights (months of work). Triggers (EN+CZ) "/cortex-uninstall", "uninstall cortex", "remove cortex", "smaž cortex", "odinstaluj cortex", "wipe cortex", "i don't want cortex anymore". Refuses to act without explicit operator confirmation. The --purge flag (deletes ~/.cortex/ too) is DESTRUCTIVE and requires a second confirmation step on top of the first. Always runs --dry-run first so the operator sees the exact path list before any deletion happens.
disable-model-invocation: false
---

# /cortex-uninstall — clean removal of cortex-x

You are running the cortex-x uninstaller. Goal: surface the exact removal plan in a dry-run pass FIRST, then ask the operator twice (once for the framework, again separately if they want `--purge`) before any destructive action. Never auto-elevate to `--purge`.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words. Counts not praise.

**Destructive-action policy** (operator's MUST rule, global CLAUDE.md): NEVER `rm -rf`, `git reset --hard`, `supabase db reset`, etc. without explicit operator confirmation. Uninstall is precisely this class. This skill enforces the policy at the skill layer; the underlying CLI also enforces it, but skill-layer enforcement is the visible-to-operator gate.

## Step 1 — language signal

Read prior-turn language. If Czech, answer in Czech. Otherwise English.

## Step 2 — dry-run FIRST, never destructive on entry

Always invoke the CLI in `--dry-run` mode first via Bash tool — this lists what would be removed without removing anything:

```bash
cortex-uninstall --dry-run --json
```

Fallback if shim isn't on PATH:

```bash
node ~/.claude/shared/bin/cortex-uninstall.cjs --dry-run --json
```

JSON schema (key fields):

```json
{
  "plan": {
    "framework": {
      "shared_dir": "<abs path, will be removed>",
      "shims_count": N,
      "skills_remove": ["cortex-init", "cortex-help", ...],
      "agents_remove": N
    },
    "source_clone": "<abs path, will be removed unless --keep-source>",
    "data_home": {
      "path": "<abs path>",
      "preserved": true,
      "size_bytes": N,
      "would_remove_with_purge": true
    }
  }
}
```

## Step 3 — present the plan compactly

Surface as a checklist, NOT prose. Example:

```
cortex-uninstall plán (DRY RUN — nic se nemaže):

Framework (vždy smazáno):
  • ~/.claude/shared/                           — celá složka
  • ~/.claude/shared/bin/cortex-*               — 18 shims
  • ~/.claude/skills/{cortex-init,cortex-help,...} — 8 skills
  • ~/.claude/agents/{cortex-thinker,blind-hunter,...} — 9 agents

Source clone:
  • ~/cortex-x                                  — bude smazán (--keep-source aby zůstal)

Operátorská data (NIKDY se nesmaže defaultně):
  • ~/.cortex/                                  — 47 MB · projects · journal · insights · research · evals
  • smaže se POUZE pokud opt-in --purge      
```

Counts not emotion. "8 skills" not "8 milých skillů".

## Step 4 — first confirmation gate (framework removal)

Use `AskUserQuestion` with three options:

- **Yes, remove framework** — runs `cortex-uninstall --yes` (preserves `~/.cortex/`)
- **Yes, also keep source clone** — runs `cortex-uninstall --keep-source --yes` (leaves `~/cortex-x/` intact so operator can re-install later without re-cloning)
- **Cancel** — exit without action

If operator picks Cancel: stop here. Print "Uninstall zrušen. Nic se nezměnilo." and end.

If operator picks one of the Yes options:

```bash
cortex-uninstall --yes               # or with --keep-source
```

Show output. Verify success.

## Step 5 — second confirmation gate (--purge, separately, OPT-IN ONLY)

ONLY after framework removal succeeded, ask SEPARATELY about `~/.cortex/`. NEVER bundle this into Step 4. Use `AskUserQuestion`:

> **`~/.cortex/` zůstalo** (47 MB — projects · journal · insights · research · evals — měsíce práce).
> Smazat i tohle? Pokud cortex-x už nikdy nepoužiješ.

Options:

- **Keep ~/.cortex/** — STRONGLY RECOMMENDED default. Done; nothing else to do.
- **Backup + purge** — runs `cortex-uninstall --backup --purge --yes` (creates `~/cortex-data-backup-<ts>.tar.gz` first, then removes `~/.cortex/`)
- **Purge without backup** — DESTRUCTIVE. Runs `cortex-uninstall --purge --yes`. Operator data lost permanently. Surface this exact text before running: "Tohle smaže `~/.cortex/` bez zálohy. Nelze undo. Last chance — pokračovat? [y/N]" and read the response. Only proceed on literal `y` or `yes`.

After purge (with or without backup): print summary of what was removed + recommend next steps.

## Step 6 — final summary

Always print at the end:

```
Uninstall complete.
  Framework:    REMOVED (~/.claude/shared/ + shims + skills + agents)
  Source clone: REMOVED / KEPT at ~/cortex-x
  Data home:    PRESERVED at ~/.cortex/ / BACKED UP at ~/cortex-data-backup-<ts>.tar.gz / PURGED

Claude Code's ~/.claude/CLAUDE.md, settings.json, and projects/ — untouched.
Re-install anytime: curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
```

## What `cortex-uninstall` does NOT touch (ever)

- `~/.claude/CLAUDE.md` — operator's global memory (cortex never wrote it)
- `~/.claude/settings.json` — operator's Claude Code config (cortex-hooks-register wrote into it but uninstall delegates removal to that script's `--remove`)
- `~/.claude/projects/` — Claude Code's per-project state (auto-memory, threads, etc.)
- Any file outside `~/.claude/` + `~/.cortex/` + the source clone path

## Composes with

- `cortex-hooks-register --remove` — runs automatically inside uninstall to roll back the SessionStart/PreToolUse/PreCompact/PostToolUse hook entries from `~/.claude/settings.json`
- `cortex-claude-md-augment --remove` — runs automatically to remove the cortex discipline block from `~/.claude/CLAUDE.md` (the augment block is the ONLY thing cortex writes there)
- `cortex-permissions-register --remove` — runs automatically to remove the safety-floor permission entries
