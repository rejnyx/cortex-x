---
name: cortex-init
description: Initialize cortex-x in the current project — interactively pick mode (New / Existing / Framework-only) via Claude's native AskUserQuestion, write the .cortex-bootstrap-pending marker, and immediately chain to the appropriate cortex-x workflow (/start for new, /audit for existing). RECOMMENDED entry point after running install.sh; replaces the shell-level cortex-bootstrap CLI for the most-common flow. Auto-discovered from ~/.claude/skills/cortex-init/SKILL.md (user-level), so it works in any project directory without per-project setup. Use this when the user says "let's start", "set up cortex", "init this project", "/cortex-init", or after a fresh install.
disable-model-invocation: false
---

# /cortex-init — cortex-x project initializer

You are running the cortex-x initialization flow. The user has installed cortex-x and pasted `/cortex-init` (or invoked it implicitly via "let's start"). Your job: pick a mode, persist the marker, and chain to the correct workflow — all in this session.

## Step 1 — Detect existing context

Before asking, do a quick read-only scan of `$PWD`:

- Does `cortex/discovery.md`, `cortex/proposal.md`, or `cortex/AUDIT.md` exist? → cortex-x already initialized in this directory. STOP, ask the user: *"Cortex je už inicializovaný v této složce (našel jsem `<file>`). Chceš: [r]e-run init / [s]ync session / [d]octor healthcheck / [c]ancel?"* Branch accordingly. Do not silently re-init.
- Is there a `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `Gemfile` / source tree? → existing project signal (default to "Existing project" in Step 2).
- Is the directory empty or near-empty (only `.git/`, `README.md`, `.gitignore` at most)? → new-project signal (default to "New project").

## Step 2 — Ask via AskUserQuestion

Use the `AskUserQuestion` tool (it gives Claude Code's native UI with arrow-key + Enter selection — much nicer than a shell prompt). Present three choices:

| Option | When |
|---|---|
| **New project** | Empty / near-empty folder. Walk through brief → research → architect → scaffold → adapt. |
| **Existing project** | Established codebase. Deep 12-dimension audit + recommendations. |
| **Framework only** | I'll paste prompts manually as needed. No auto-flow. |

The default-highlighted choice should match what Step 1 detected. Make the question Czech if user's earlier turns were Czech, English otherwise (read the language signal — don't ask explicitly).

## Step 3 — Branch on the choice

### Path resolution contract (read this first)

The chained prompts live at `~/.claude/shared/prompts/<name>.md`. Some Claude Code versions don't auto-expand `~` for the Read tool — resolve to an **absolute path** before calling Read:

- **Unix/macOS/WSL/Git Bash:** `/home/<user>/.claude/shared/prompts/<name>.md` (or use `$HOME`)
- **Windows native:** `C:\Users\<user>\.claude\shared\prompts\<name>.md`

**Do NOT** fall back to the cortex-x source repo (`$CORTEX_HOME/prompts/`) if the installed path is missing — that masks an install regression. If Read fails on the installed path, **stop and tell the user**:

> ⚠ *"`~/.claude/shared/prompts/<name>.md` is missing. The cortex-x install is incomplete. Run `/doctor` to diagnose, or re-run `install.sh` / `install.ps1` from `$CORTEX_HOME`."*

Then exit `/cortex-init`. Do not continue with stale assets.

### If "New project"

1. Use the `Write` tool to create `.cortex-bootstrap-pending` in `$PWD` with content:
   ```
   mode=new
   at=<current ISO timestamp, e.g. 2026-05-06T20:30:00Z>
   ```
2. Read `~/.claude/shared/prompts/new-project.md` (resolved to absolute path per contract above) and execute it from Phase 1 (Discover). Do not ask the user "do you want to start?" — they already chose; just begin Phase 1's first question.

### If "Existing project"

1. Write `.cortex-bootstrap-pending` with `mode=existing` + timestamp.
2. Read `~/.claude/shared/prompts/existing-project-audit.md` (resolved to absolute path per contract above) and execute from Phase 0 (Detect). Begin immediately.

### If "Framework only"

1. Do **not** write a marker file.
2. Print the available prompt list:
   - `/start` — new-project bootstrap (Discover → Research → Architect → Scaffold → Adapt)
   - `/audit` — existing-project deep audit (12 dimensions)
   - `/sync` — end-of-session knowledge capture
   - `/doctor` — healthcheck (cortex-x install integrity, drift detection)
   - `/retrofit` — apply cortex-x patterns to an existing project (after `/audit`)
3. End the turn. The user can paste any prompt next.

## Step 4 — Cleanup contract

The chained prompt (`new-project.md` Phase 5 §5.5 / `existing-project-audit.md` final section) is responsible for deleting `.cortex-bootstrap-pending` on completion. You do NOT delete it from `/cortex-init` itself — the marker has to survive across phase boundaries inside the chained prompt.

## Step 5 — On_complete

After the chained workflow finishes (Phase 5 finalize / Phase 7 audit final), the chained prompt prints its own closing instructions. `/cortex-init` is done after Step 3 has handed control to the chained prompt; you do NOT need to print anything else.

## Edge cases

**User invoked `/cortex-init` in cortex-x source repo itself.** Detect by checking whether `$PWD/CLAUDE.md` exists AND its first line says "AI-Agentic-First Claude Code Framework". Tell the user: *"You're inside the cortex-x source repository. `/cortex-init` is for end-user projects, not for hacking on cortex-x itself. Try `/doctor` for installation drift checks, or paste `~/.claude/shared/prompts/cortex-evolve.md` if you want to run the self-improvement loop."*

**User invoked `/cortex-init` mid-session in a project that already has CLAUDE.md.** This means they want to ADD cortex-x to a project that previously bootstrapped without it. Default to "Existing project" (deep audit) — the audit is non-destructive and `/retrofit` afterwards is the additive-apply step.

**`AskUserQuestion` not available (older Claude Code).** Fall back to a plain-text question: *"Píšeš [N]ew / [E]xisting / [F]ramework-only? (1 písmeno)"* — wait for the user's reply, branch the same way.

**Marker file already exists from a previous run.** Read it. If `mode` matches the new choice, ask: *"Marker už existuje pro mode=<X>. Pokračovat / přepsat / zrušit?"*. If different mode, propose overwriting and confirm.

## When NOT to use

- The user is already in a running cortex-x workflow (Phase 1-5 in progress). They should NOT paste `/cortex-init` again — they should answer the current phase's question.
- Debug / development of cortex-x itself — use `/doctor` instead.
- Mid-implementation of a story (PROGRESS.md item in progress). Resume the story; don't re-init.

## Reference

- Full design: `$CORTEX_HOME/docs/sprint-1.5-design.md` §2.1, §2.2, §2.3
- Shell-level alternative: `~/.claude/shared/bin/cortex-bootstrap` — same semantics but invoked from terminal before launching Claude. Useful for scripts / CI / users who prefer terminal flow.
- Marker contract: `cortex/.adapt-pending` (recovery if Phase 5 was interrupted) is separate; SessionStart hook surfaces it on next session.
