---
title: cortex-x install walkthrough — what happens, where things land
date: 2026-05-12
audience: first-time user about to install cortex-x
---

# What happens when you install cortex-x

Concrete scenario: Anna has a project folder `~/Projects/random/` (any name, doesn't matter), Node 22 installed, Claude Code CLI installed. She wants to try cortex-x.

She types **one command**:

```bash
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
```

(On Windows PowerShell: `iwr -useb https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex`)

What follows, in order.

---

## Phase 1 — installer self-clones cortex-x source

The installer is a 600-line bash script. The first thing it does is **clone the cortex-x source repo** to a known location so the rest of the install has files to copy from.

**Default:** `~/cortex-x/` (override with `CORTEX_HOME=/somewhere/else`)

```
~/cortex-x/                          ← cortex-x source clone (the framework code)
├── bin/                             — CLI tools (cortex-bootstrap, cortex-steward, ...)
├── shared/                          — hooks, skills, agents stage
├── standards/                       — 25 standards docs (SSOT, security, testing, ...)
├── profiles/                        — 11 project archetypes
├── prompts/                         — 16 reusable prompts
├── agents/                          — 9 review-pipeline subagents
├── detectors/                       — auto-profile + auto-stage classifiers
├── templates/                       — Handlebars templates for scaffold output
├── tests/                           — 2339 tests across 8 tier gates
├── docs/                            — long-form docs + research memos
└── install.{sh,ps1}
```

This stays on Anna's disk **permanently**. The `cortex-steward` CLI later delegates to files in this dir via `cortex-source.yaml`. `git pull` here = framework upgrade for Anna.

---

## Phase 2 — interactive prompts (or env-var defaults)

In a real terminal Anna sees:

```
Language for cortex-x output? [1] English (default) [2] Czech (čeština) ...
Profile (cortex-x init flavor)? [1] dev (default) [2] qa-tester [3] ai-engineer [4] minimal
```

If she's in a non-TTY context (CI, curl-pipe-bash), defaults kick in: `en` + `dev`.

She picks `[1] English` + `[1] dev`. The installer captures her **identity** (name + email) automatically from `git config` if present, asks once to confirm, and writes it to:

```
~/.claude/cortex/user.yaml         ← Anna's identity (name, email, locale, profile)
```

This is only consulted by session-start to greet her by name.

---

## Phase 3 — copy framework assets into ~/.claude/shared/

Claude Code looks for hooks, skills, agents, and shared resources under `~/.claude/`. cortex-x installs everything there:

```
~/.claude/                          ← Claude Code's user directory (pre-existing, may have Anna's other tools)
├── settings.json                   ← UNTOUCHED — Anna's existing hooks/MCP config preserved
├── CLAUDE.md                       ← UNTOUCHED — Anna's global memory preserved
├── agents/                         ← 9 cortex-x review agents copied here (Claude Code only auto-loads from this exact path)
│   ├── acceptance-auditor.md
│   ├── blind-hunter.md
│   ├── correctness-auditor.md
│   ├── cortex-thinker.md
│   ├── edge-case-hunter.md
│   ├── planner.md
│   ├── security-auditor.md
│   ├── ssot-enforcer.md
│   └── synthesizer.md
├── skills/                         ← 6 cortex-x slash commands promoted here
│   ├── cortex-init/SKILL.md        ← /cortex-init
│   ├── cortex-help/SKILL.md        ← /cortex-help
│   ├── start/SKILL.md              ← /start (new-project flow)
│   ├── audit/SKILL.md              ← /audit (existing-project deep audit)
│   ├── designer/SKILL.md           ← /designer (design flow)
│   └── test-audit/SKILL.md         ← /test-audit (ONLY if profile=qa-tester)
├── cortex/
│   └── user.yaml                   ← identity (from Phase 2)
└── shared/                         ← cortex-x runtime assets (WIPED + re-copied on every re-install)
    ├── hooks/                      ← 7 universal hooks (block-destructive, session-start, ...)
    ├── standards/                  ← 25 standards copied
    ├── templates/                  ← Handlebars templates
    ├── profiles/                   ← 11 YAMLs
    ├── prompts/                    ← 16 prompts
    ├── agents/                     ← (staging — Claude Code reads from ~/.claude/agents/ instead)
    ├── skills/                     ← (staging — Claude Code reads from ~/.claude/skills/ instead)
    ├── detectors/                  ← deterministic classifiers
    ├── tools/                      ← validators
    ├── bin/                        ← user-callable CLI shims
    │   ├── cortex-bootstrap{,.ps1,.cjs}
    │   ├── cortex-steward{,.ps1}
    │   ├── cortex-capabilities{,.ps1}
    │   ├── cortex-gap-report{,.ps1}
    │   └── cortex-migrate-data.{sh,ps1}
    ├── cortex-source.yaml          ← points back at ~/cortex-x/ (SSOT for runtime)
    ├── INSTALL_NOTES.md            ← verbose post-install detail + hook-registration JSON snippet
    └── shared.backup-2026-05-12T...  ← previous shared/ contents on re-install (one rotation kept)
```

**The key thing Anna needs to know:** `settings.json` and `CLAUDE.md` are **never auto-overwritten**. The installer prints a JSON snippet at the end and Anna pastes it into her `~/.claude/settings.json` manually — preserving her existing hooks.

---

## Phase 4 — personal data lives in ~/.cortex/ (NOT in source repo)

Sprint 1.6 (XDG separation): user-generated data is intentionally separated from framework code.

```
~/.cortex/                          ← Anna's personal cortex data (gitignored if she ever inits git here)
├── projects/                       ← Anna's per-project library entries (one .md per project)
│   └── README.md
├── insights/                       ← cortex-thinker observations
│   ├── proposals/
│   └── README.md
├── journal/                        ← tool-use traces (one .jsonl per project per day)
├── research/                       ← cached web-research outputs (TTL 14d)
└── evals/                          ← eval suite results
```

This dir is **persistent** across re-installs. Anna's accumulated knowledge survives framework upgrades.

---

## Phase 5 — verify install + summary

Installer runs `tests/smoke/verify-install.cjs` (~38 assertions: every component class lands at expected path, min counts validated, mirror checks). On green:

```
=========================================
 ✓ cortex-x installed successfully
=========================================

Source:    ~/cortex-x
Installed: ~/.claude/shared
Profile:   dev
Language:  English
Tests:     2339 pass

Next steps:
  1. (optional) Add to PATH: export PATH="$HOME/.claude/shared/bin:$PATH"
  2. Open Claude Code in any project: claude
  3. Type /cortex-init to bootstrap, or /cortex-help to see all commands
  4. (Optional) Wire hooks: paste the block from ~/.claude/shared/INSTALL_NOTES.md
     into ~/.claude/settings.json (preserves your existing hooks)
=========================================
```

---

## Phase 6 — Anna's first project

She `cd ~/Projects/random/` (her empty folder), opens Claude Code:

```bash
cd ~/Projects/random/
claude
```

**SessionStart hook fires** (if she pasted the hooks block in Phase 5). Output injected into Claude's context:

```
=== random — Session Context ===

Hello, Anna.

Git Branch: (none)
Recent commits: (none — empty folder)

cortex-x library: no entry for 'random'
  Suggest: paste ~/.claude/shared/prompts/project-scan.md to populate

cortex-x discovery (tip shown once / 18h):
  • Type /cortex-help inside Claude Code for one-screen capability menu
  • Machine-readable inventory: cortex/capabilities.md (16 action_kinds, 25 standards, 11 profiles, 7 hooks, 17 workflows)
  • Web research: cortex defaults to dispatching WebSearch+WebFetch on external-state tasks
```

She types `/cortex-init`. The skill detects her folder is empty → suggests `/start` for new-project bootstrap. She picks it. cortex-x asks 3 questions (project type, stack, intent), dispatches 3-5 parallel research agents on her chosen stack, writes a research memo to `~/.cortex/research/`, scaffolds a CLAUDE.md tailored to her profile + stack, writes PROGRESS.md, suggests the first sprint.

**That's the install + first project flow.** Total: ~3 minutes of installer + ~5 minutes of first project. No `settings.json` was overwritten. Anna's existing tools still work.

---

## Re-install behavior

She runs `install.sh` again next week. What happens:

1. `~/.claude/shared/` is moved to `~/.claude/shared.backup-<timestamp>/` (only most-recent backup kept)
2. Fresh copy of cortex-x source is rsynced into `~/.claude/shared/`
3. Personal data in `~/.cortex/` is **never touched**
4. `~/.claude/settings.json` is **never touched**
5. `~/.claude/CLAUDE.md` is **never touched**
6. Smoke test re-runs, fails loud if anything regressed

If Anna pulled `~/cortex-x/` via `git pull` first, she gets the latest framework. Otherwise the installer fetches main if the worktree is clean.

---

## Uninstall

cortex-x doesn't ship an uninstall script (yet). To remove:

```bash
# Remove framework code
rm -rf ~/cortex-x/

# Remove installed assets
rm -rf ~/.claude/shared/
rm -rf ~/.claude/agents/
rm -rf ~/.claude/skills/cortex-*
rm -rf ~/.claude/skills/{start,audit,designer,test-audit}/
rm -rf ~/.claude/cortex/user.yaml

# Keep personal data (recommended) OR remove it
# rm -rf ~/.cortex/           # ← deletes Anna's per-project entries, insights, journal

# Manually edit ~/.claude/settings.json to remove cortex-x hooks block
```

---

## What if Anna's project is in a weird location?

Doesn't matter. cortex-x is **CWD-aware**: every hook, skill, and prompt reads the current working directory and adapts. The framework lives in `~/cortex-x/` + `~/.claude/shared/`; the user's project can be anywhere (`~/Projects/random/`, `D:\code\myapp\`, `~/dev/2026/q2/secret-thing/`).

If Anna wants per-project cortex-x state (e.g. a project-level `.claude/agents/` override), she creates `<project>/.claude/agents/` and cortex-x respects it — project-level files take precedence over `~/.claude/`-level files.

---

## TL;DR

| Path | Purpose | Touched? |
|---|---|---|
| `~/cortex-x/` | Framework source clone | Created by installer, updated by `git pull` |
| `~/.claude/shared/` | Runtime assets (hooks, prompts, etc.) | Wiped + re-copied on every install |
| `~/.claude/agents/` | 9 review agents | Copied (overwrites only matching names) |
| `~/.claude/skills/` | 6 cortex-x slash commands | Created/refreshed |
| `~/.claude/cortex/user.yaml` | Anna's identity | Written once (overwrite on `--reset-identity`) |
| `~/.claude/settings.json` | **Anna's hook config** | **NEVER auto-touched** — paste manually from INSTALL_NOTES.md |
| `~/.claude/CLAUDE.md` | **Anna's global memory** | **NEVER auto-touched** |
| `~/.cortex/` | Anna's personal cortex data | Created on first run, persistent across re-installs |

The whole install is "deposit framework code in two places, ask permission for everything else."
