#!/usr/bin/env bash
# cortex-x installer
# Installs shared framework to ~/.claude/ for global use across projects.
# Safe: backs up existing ~/.claude/shared/ before overwriting.
#
# Two execution modes:
#
#   1) curl | bash (recommended for fresh users):
#        curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
#      The script self-detects pipe execution and clones cortex-x to ~/cortex-x
#      (or $CORTEX_HOME), then re-execs the local install.sh from that clone.
#
#   2) Local execution (after manual git clone):
#        git clone https://github.com/Rejnyx/cortex-x ~/cortex-x
#        ~/cortex-x/install.sh
#      Standard install path; copies framework assets to ~/.claude/shared/.
#
# Env vars honored (see standards/ship-ready.md):
#   CORTEX_CHANNEL=beta|stable  — beta = track main HEAD (default for now);
#                                 stable = checkout highest semver tag.
#   CORTEX_HOME=<path>          — override cortex-x source directory
#                                 (default: script location, or ~/cortex-x in
#                                 curl|bash mode).
#   CORTEX_NO_UPDATE=1          — skip checkout step even if CHANNEL=stable.

set -e

# Stream detection — when invoked via `curl | bash`, $BASH_SOURCE is empty or
# points to a non-existent location. Self-clone the repo first, then re-exec
# the local install.sh from the clone. This is the modern install pattern
# used by Bun, Deno, Rustup, uv, fnm, mise, oh-my-zsh, Homebrew.
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -z "$SCRIPT_PATH" ] || [ ! -f "$SCRIPT_PATH" ]; then
  CORTEX_CLONE_DIR="${CORTEX_HOME:-$HOME/cortex-x}"
  echo "cortex-x bootstrap (curl | bash mode)"
  echo "  source: https://github.com/Rejnyx/cortex-x"
  echo "  clone:  $CORTEX_CLONE_DIR"
  echo
  if ! command -v git > /dev/null 2>&1; then
    echo "ERROR: git is required but not found on PATH." >&2
    echo "  Install git first, then re-run." >&2
    exit 1
  fi
  if [ -d "$CORTEX_CLONE_DIR/.git" ]; then
    echo "  existing clone found — fetching origin/main"
    cd "$CORTEX_CLONE_DIR"
    if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
      git fetch --quiet origin main 2>/dev/null || echo "  warning: fetch failed (offline?), using current HEAD"
      git checkout --quiet main 2>/dev/null || true
      git pull --ff-only --quiet origin main 2>/dev/null || echo "  warning: pull failed, using current HEAD"
    else
      echo "  local changes detected in $CORTEX_CLONE_DIR — skipping update"
      echo "  to manually update: cd $CORTEX_CLONE_DIR && git pull --ff-only origin main"
    fi
    cd - > /dev/null
  else
    mkdir -p "$(dirname "$CORTEX_CLONE_DIR")"
    # Clone strategy: try anonymous HTTPS first (works for public repos).
    # Fall back to gh-cli (works for private repos when user is gh-auth'd) or
    # to GITHUB_TOKEN-authenticated HTTPS.
    if git clone --quiet https://github.com/Rejnyx/cortex-x "$CORTEX_CLONE_DIR" 2>/dev/null; then
      echo "  cloned successfully (public)"
    elif [ -n "$GITHUB_TOKEN" ] && git clone --quiet "https://x-access-token:${GITHUB_TOKEN}@github.com/Rejnyx/cortex-x" "$CORTEX_CLONE_DIR" 2>/dev/null; then
      echo "  cloned successfully (GITHUB_TOKEN)"
    elif command -v gh > /dev/null 2>&1 && gh auth status > /dev/null 2>&1 && gh repo clone Rejnyx/cortex-x "$CORTEX_CLONE_DIR" -- --quiet 2>/dev/null; then
      echo "  cloned successfully (gh-cli)"
    else
      echo "ERROR: git clone failed." >&2
      echo "  If cortex-x is still in closed beta, you need either:" >&2
      echo "    1) gh CLI authenticated:  gh auth login" >&2
      echo "    2) a GITHUB_TOKEN env var with read access to Rejnyx/cortex-x" >&2
      echo "  Then re-run this installer." >&2
      exit 1
    fi
  fi
  echo "  re-executing $CORTEX_CLONE_DIR/install.sh"
  echo "============================================================"
  exec bash "$CORTEX_CLONE_DIR/install.sh" "$@"
fi

# Resolve cortex-x source directory.
# Precedence: $CORTEX_HOME → script location.
if [ -n "$CORTEX_HOME" ] && [ -d "$CORTEX_HOME" ]; then
  CORTEX_ROOT="$CORTEX_HOME"
else
  CORTEX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
CLAUDE_HOME="${HOME}/.claude"
CHANNEL="${CORTEX_CHANNEL:-beta}"

# Language preference — interactive prompt unless CORTEX_LANGUAGE is set
# or stdin is not a TTY (for CI/non-interactive runs).
if [ -z "$CORTEX_LANGUAGE" ] && [ -t 0 ]; then
  echo "Communication language for Claude in cortex-x sessions?"
  echo "  en  — English (default)"
  echo "  cs  — Czech (čeština)"
  echo "  de  — German (Deutsch)"
  echo "  fr  — French (français)"
  echo "  es  — Spanish (español)"
  printf "Language code [en]: "
  read -r CORTEX_LANGUAGE || true
fi
CORTEX_LANGUAGE="${CORTEX_LANGUAGE:-en}"

echo "cortex-x installer"
echo "  from:     $CORTEX_ROOT"
echo "  to:       $CLAUDE_HOME/shared"
echo "  channel:  $CHANNEL"
echo "  language: $CORTEX_LANGUAGE"
echo

# Channel resolution — check out appropriate ref before copying.
if [ "$CHANNEL" = "stable" ] && [ -z "$CORTEX_NO_UPDATE" ]; then
  if [ -d "$CORTEX_ROOT/.git" ]; then
    cd "$CORTEX_ROOT"
    git fetch --tags --quiet || echo "Warning: git fetch failed (offline?); using local tags."
    LATEST="$(git tag -l 'v*' --sort=-v:refname | grep -vE -- '-(alpha|beta|rc)' | head -1 || true)"
    if [ -n "$LATEST" ]; then
      echo "Checking out stable tag: $LATEST"
      git checkout --quiet "$LATEST"
    else
      echo "No stable tag found (no v*.*.* yet); staying on current branch."
    fi
    cd - > /dev/null
  else
    echo "Note: $CORTEX_ROOT is not a git repo; cannot resolve stable tag."
  fi
elif [ "$CHANNEL" = "beta" ] && [ -z "$CORTEX_NO_UPDATE" ]; then
  if [ -d "$CORTEX_ROOT/.git" ]; then
    cd "$CORTEX_ROOT"
    if git diff --quiet && git diff --cached --quiet; then
      git fetch --quiet || echo "Warning: git fetch failed (offline?); using local main."
      git checkout --quiet main 2>/dev/null || true
    else
      echo "Local changes detected — skipping beta auto-update. Commit or stash to resume."
    fi
    cd - > /dev/null
  fi
fi

if [ -d "$CLAUDE_HOME/shared" ]; then
  BACKUP="$CLAUDE_HOME/shared.backup-$(date +%Y%m%d-%H%M%S)"
  echo "Existing ~/.claude/shared/ found. Backing up to: $BACKUP"
  mv "$CLAUDE_HOME/shared" "$BACKUP"
  # Rotate: keep only the most recent backup. The cortex-x source repo at
  # $CORTEX_ROOT (with full git history + remote) is the canonical backup;
  # this snapshot is just last-install rollback safety, not deep history.
  # Without rotation these accumulate forever and pollute ~/.claude/ git status
  # (10 backups × ~74 files = 700+ untracked observed in field 2026-05-01).
  ls -1dt "$CLAUDE_HOME"/shared.backup-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
fi

mkdir -p "$CLAUDE_HOME/shared"

# Copy shared content (hooks, skills, agents, standards, prompts, review agents)
cp -r "$CORTEX_ROOT/shared/." "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/standards" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/templates" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/profiles" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/prompts" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/agents" "$CLAUDE_HOME/shared/"

# Skills already copied via $CORTEX_ROOT/shared/. above (shared/skills/ is the
# canonical location). Root-level $CORTEX_ROOT/skills/ is reserved for future
# top-level cortex-x skills and currently empty — no separate copy needed.

# Detectors directory — deterministic profile/stack/stage classifiers (auto-optimization).
# Read by session-start hook + cortex-doctor prompt. Fail-open contract.
if [ -d "$CORTEX_ROOT/detectors" ]; then
  cp -r "$CORTEX_ROOT/detectors" "$CLAUDE_HOME/shared/" 2>/dev/null || true
fi

# Tools directory — Node CLIs invoked by cortex-doctor + ad-hoc by users.
# Currently: verify-audit-output.cjs (Tier 3 QA). Includes lib/ for shared
# helpers like resolve-cortex-home.cjs (SSOT).
if [ -d "$CORTEX_ROOT/tools" ]; then
  cp -r "$CORTEX_ROOT/tools" "$CLAUDE_HOME/shared/" 2>/dev/null || true
fi

# Record cortex-x source dir for {{cortex_source}} placeholder resolution at scaffold time.
# Templates reference installed assets via ~/.claude/shared/; dynamic dirs (projects/, research/)
# stay in source and need an absolute path baked into scaffolded files.
#
# Sprint 1.6: also record CORTEX_DATA_HOME (default ~/.cortex). User-personal
# data — research caches, projects library, insights, journal, evals — lives
# here, NOT inside the cortex-x source repo. See MIGRATIONS.md Sprint 1.6.
CORTEX_DATA_HOME="${CORTEX_DATA_HOME:-$HOME/.cortex}"
mkdir -p "$CORTEX_DATA_HOME"/{research,projects,insights/proposals,journal,evals}

# Seed insights/README.md on first install only — never overwrite user content.
if [ ! -f "$CORTEX_DATA_HOME/insights/README.md" ] && [ -f "$CORTEX_ROOT/templates/cortex-data-insights-readme.md" ]; then
  cp "$CORTEX_ROOT/templates/cortex-data-insights-readme.md" "$CORTEX_DATA_HOME/insights/README.md"
fi

# Convert MSYS/Git-Bash paths (/c/Users/...) to Windows mixed-style (C:/Users/...)
# so Windows-native Node — used by hooks and bin/cortex-bootstrap.cjs — can
# resolve them via path.join. Native Linux/macOS paths pass through unchanged.
to_node_path() {
  if command -v cygpath > /dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}
CORTEX_ROOT_NP=$(to_node_path "$CORTEX_ROOT")
CORTEX_DATA_HOME_NP=$(to_node_path "$CORTEX_DATA_HOME")
printf 'cortex_source: %s\ncortex_data_home: %s\n' \
  "$CORTEX_ROOT_NP" "$CORTEX_DATA_HOME_NP" \
  > "$CLAUDE_HOME/shared/cortex-source.yaml"

# Write/update module.local.yaml with user preference (gitignored).
MODULE_LOCAL="$CORTEX_ROOT/module.local.yaml"
cat > "$MODULE_LOCAL" <<YAML
# Per-user override (gitignored). See module.yaml for defaults.
# Regenerated by install.sh — edit freely after install, won't be overwritten
# unless you re-run install.
config:
  communication_language: $CORTEX_LANGUAGE
YAML

case "$CORTEX_LANGUAGE" in
  cs) LANG_NAME="Czech (čeština)" ;;
  de) LANG_NAME="German (Deutsch)" ;;
  fr) LANG_NAME="French (français)" ;;
  es) LANG_NAME="Spanish (español)" ;;
  *)  LANG_NAME="English" ;;
esac

# Install cortex-bootstrap helper to ~/.claude/shared/bin/.
mkdir -p "$CLAUDE_HOME/shared/bin/_lib"
[ -f "$CORTEX_ROOT/bin/cortex-bootstrap" ]      && { cp "$CORTEX_ROOT/bin/cortex-bootstrap"      "$CLAUDE_HOME/shared/bin/"; chmod +x "$CLAUDE_HOME/shared/bin/cortex-bootstrap"; }
[ -f "$CORTEX_ROOT/bin/cortex-bootstrap.ps1" ]  && cp "$CORTEX_ROOT/bin/cortex-bootstrap.ps1"   "$CLAUDE_HOME/shared/bin/"
[ -f "$CORTEX_ROOT/bin/cortex-bootstrap.cjs" ]  && cp "$CORTEX_ROOT/bin/cortex-bootstrap.cjs"   "$CLAUDE_HOME/shared/bin/"
[ -f "$CORTEX_ROOT/bin/_lib/select.cjs" ]       && cp "$CORTEX_ROOT/bin/_lib/select.cjs"        "$CLAUDE_HOME/shared/bin/_lib/"
[ -f "$CORTEX_ROOT/bin/cortex-gap-report" ]     && { cp "$CORTEX_ROOT/bin/cortex-gap-report"     "$CLAUDE_HOME/shared/bin/"; chmod +x "$CLAUDE_HOME/shared/bin/cortex-gap-report"; }
[ -f "$CORTEX_ROOT/bin/cortex-gap-report.ps1" ] && cp "$CORTEX_ROOT/bin/cortex-gap-report.ps1"  "$CLAUDE_HOME/shared/bin/"
[ -f "$CORTEX_ROOT/bin/cortex-gap-report.cjs" ] && cp "$CORTEX_ROOT/bin/cortex-gap-report.cjs"  "$CLAUDE_HOME/shared/bin/"
[ -f "$CORTEX_ROOT/bin/cortex-migrate-data" ]   && { cp "$CORTEX_ROOT/bin/cortex-migrate-data"   "$CLAUDE_HOME/shared/bin/" 2>/dev/null || true; }
[ -f "$CORTEX_ROOT/bin/cortex-migrate-data.sh" ] && { cp "$CORTEX_ROOT/bin/cortex-migrate-data.sh" "$CLAUDE_HOME/shared/bin/"; chmod +x "$CLAUDE_HOME/shared/bin/cortex-migrate-data.sh"; }
[ -f "$CORTEX_ROOT/bin/cortex-migrate-data.ps1" ] && cp "$CORTEX_ROOT/bin/cortex-migrate-data.ps1" "$CLAUDE_HOME/shared/bin/"

# Install default agents to ~/.claude/agents/ for Claude Code discovery.
#
# Claude Code's agent discovery checks ~/.claude/agents/ (user-level) and
# .claude/agents/ (project-level). It does NOT check ~/.claude/shared/agents/
# — that path is cortex-x-internal staging. Without this copy, every cortex-x
# project's default adversarial pipeline (cortex-thinker, blind-hunter,
# edge-case-hunter, acceptance-auditor, security-auditor, ssot-enforcer,
# correctness-auditor, planner, synthesizer) is invisible at runtime.
#
# Field test #5 (interview-brief, 2026-05-07) caught this: scaffolded project
# wired hooks via settings.json but had only 1 synthesized agent in
# .claude/agents/, leaving the project agent-less for the default pipeline.
#
# Per-project .claude/agents/ remains for synthesized + project overrides only.
mkdir -p "$CLAUDE_HOME/agents"
if [ -d "$CORTEX_ROOT/agents" ]; then
  cp -f "$CORTEX_ROOT"/agents/*.md "$CLAUDE_HOME/agents/" 2>/dev/null || true
fi

# Install user-level slash-skill /cortex-init at ~/.claude/skills/cortex-init/.
# This is the RECOMMENDED post-install entry point — user just opens claude in
# any project dir and types /cortex-init. The skill asks N/E/F via Claude's
# native AskUserQuestion tool, writes the marker, chains to /start or /audit.
mkdir -p "$CLAUDE_HOME/skills/cortex-init"
if [ -f "$CORTEX_ROOT/shared/skills/cortex-init/SKILL.md" ]; then
  cp "$CORTEX_ROOT/shared/skills/cortex-init/SKILL.md" "$CLAUDE_HOME/skills/cortex-init/SKILL.md"
fi

# Generate INSTALL_NOTES.md with all the verbose detail. Keep terminal output
# tight — users who want detail can read the file. (Pattern from Bun, Deno.)
INSTALL_NOTES="$CLAUDE_HOME/shared/INSTALL_NOTES.md"
cat > "$INSTALL_NOTES" <<NOTES
# cortex-x install notes

Generated by \`install.sh\` on $(date '+%Y-%m-%d %H:%M:%S').

- Source:    $CORTEX_ROOT
- Installed: $CLAUDE_HOME/shared/
- Channel:   $CHANNEL
- Language:  $LANG_NAME (\`$CORTEX_LANGUAGE\`)

## Hooks (in \`hooks/\`)

| File | Event |
|---|---|
| \`block-destructive.cjs\` | PreToolUse matcher:Bash |
| \`session-start.cjs\` | SessionStart — sprint state, git context, budget surface, bootstrap-marker reader |
| \`pre-compact.cjs\` | PreCompact |
| \`pre-tool-use.cjs\` | PreToolUse all tools — journal companion |
| \`post-tool-use.cjs\` | PostToolUse all tools — journal + budget writer |
| \`auto-orchestrate.cjs\` | UserPromptSubmit — 3-fronta hint + budget warn |
| \`tirith-scan.cjs\` | SessionStart — optional, no-op if tirith binary absent |
| \`_lib/redact.cjs\` | Shared secret-scrubbing library |
| \`_lib/budget.cjs\` | Shared token-cost tracking library |

## Register hooks in \`~/.claude/settings.json\`

\`\`\`json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node \"\$HOME/.claude/shared/hooks/block-destructive.cjs\"", "timeout": 5 }] },
    { "hooks": [{ "type": "command", "command": "node \"\$HOME/.claude/shared/hooks/pre-tool-use.cjs\"", "timeout": 3 }] }
  ],
  "PostToolUse": [
    { "hooks": [{ "type": "command", "command": "node \"\$HOME/.claude/shared/hooks/post-tool-use.cjs\"", "timeout": 5 }] }
  ],
  "UserPromptSubmit": [
    { "hooks": [{ "type": "command", "command": "node \"\$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"", "timeout": 3 }] }
  ],
  "SessionStart": [
    { "hooks": [{ "type": "command", "command": "node \"\$HOME/.claude/shared/hooks/session-start.cjs\"", "timeout": 5 }] }
  ]
}
\`\`\`

## Language preference (optional)

Add this block to \`~/.claude/CLAUDE.md\` so Claude responds in \`$LANG_NAME\` for cortex-x sessions:

\`\`\`markdown
<!-- BEGIN cortex-x — communication language -->
## cortex-x language
When working in a cortex-x-scaffolded project or invoking cortex-x prompts,
respond in: **$LANG_NAME** (code: \`$CORTEX_LANGUAGE\`). Never switch languages mid-reply.
<!-- END cortex-x -->
\`\`\`

cortex-x will not auto-edit your global \`~/.claude/CLAUDE.md\` (Principle 1 from standards/coding-behavior.md).

## Budget cap

Set \`CORTEX_SESSION_BUDGET_USD\` env var (default \$5.00). Spend log: \`\$CORTEX_DATA_HOME/journal/.budget.jsonl\`.
Set \`CORTEX_BUDGET_DISABLED=1\` to suppress budget output entirely (e.g. for flat-subscription installs).

## Journal

Tool-call traces (privacy-redacted) write to: \`$CORTEX_ROOT/journal/YYYY-MM-DD-<project-slug>.jsonl\`. See \`journal/README.md\` for schema + privacy contract.

## Optional: Tirith (context-file prompt-injection scanner)

\`\`\`bash
cargo install tirith
# or download from https://github.com/NousResearch/tirith/releases
\`\`\`

\`tirith-scan.cjs\` hook auto-detects once installed. Skip if not doing agentic work.

## Re-running

Re-run \`install.sh\` after pulling cortex-x updates. Existing \`~/.claude/shared/\` is backed up to \`shared.backup-YYYYMMDD-HHMMSS\`. Only the most recent backup is kept.

## See also

- \`standards/ship-ready.md\` — \`CORTEX_HOME\` / \`CORTEX_CHANNEL\` semantics
- \`docs/sprint-1.5-design.md\` — onboarding architecture
- \`MIGRATIONS.md\` — pre-public-tag debt and version migrations
NOTES

# ── Post-copy verification — delegated to tests/smoke/verify-install.cjs.
# Runs all 30 post-condition checks (file existence, dir counts, source-to-
# installed mirror, cortex-source.yaml integrity, $CORTEX_DATA_HOME structure).
# Single source of truth — same script runs from install.sh, install.ps1, CI
# matrix, and integration tests. Exit codes: 0 OK / 1 validation fail / 2 bug.
VERIFIER="$CORTEX_ROOT/tests/smoke/verify-install.cjs"
if [ ! -f "$VERIFIER" ]; then
  echo >&2
  echo "  ✗ Verifier not found: $VERIFIER" >&2
  echo "    Your cortex-x clone is incomplete. Re-clone from origin and re-run." >&2
  exit 1
fi
if ! command -v node > /dev/null 2>&1; then
  echo >&2
  echo "  ✗ node is required to verify install but not found on PATH." >&2
  echo "    Install Node.js >=22 (Active LTS) and re-run." >&2
  exit 1
fi
if ! node "$VERIFIER"; then
  echo >&2
  echo "  ✗ Install verification FAILED — see output above." >&2
  echo "    Try: re-run install.sh, or open an issue at" >&2
  echo "         https://github.com/Rejnyx/cortex-x/issues" >&2
  exit 1
fi

# Detect shell + PATH state for the final action line.
SHELL_NAME="$(basename "${SHELL:-bash}")"
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
  *)    RC_FILE="$HOME/.profile" ;;
esac
PATH_HAS_BIN=0
echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.claude/shared/bin" && PATH_HAS_BIN=1

# Compact final summary — model: Bun, uv, Rustup. Detail lives in INSTALL_NOTES.md.
echo
AGENT_COUNT=$(ls -1 "$CLAUDE_HOME/agents"/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "  ✓ cortex-x installed"
echo "    framework  ~/.claude/shared/                  (cortex-x assets · prompts · standards · skills · staging)"
echo "    agents     ~/.claude/agents/                  ($AGENT_COUNT default agents — auto-discovered by Claude Code)"
echo "    skill      ~/.claude/skills/cortex-init/      (RECOMMENDED entry point — type /cortex-init in any project)"
echo "    user data  $CORTEX_DATA_HOME/                  (research · projects · insights · journal · evals — your own knowledge graph)"
echo "    bootstrap  ~/.claude/shared/bin/cortex-bootstrap"
echo "    language   $LANG_NAME ($CORTEX_LANGUAGE)"
echo "    notes      $INSTALL_NOTES"
echo
echo "  Next step (recommended) — open Claude Code in any project dir:"
echo
echo "    claude"
echo "    /cortex-init"
echo
echo "  ↳ /cortex-init asks New / Existing / Framework-only via arrow keys,"
echo "    writes the marker, chains to the right cortex-x workflow."
echo
echo "  Shell-only alternative (power users / scripts):"
if [ "$PATH_HAS_BIN" = "1" ]; then
  echo "    cortex-bootstrap     # already on PATH"
else
  echo "    ~/.claude/shared/bin/cortex-bootstrap"
  echo
  echo "  Add bin/ to PATH (one-time, optional):"
  if [ "$SHELL_NAME" = "fish" ]; then
    echo "    fish_add_path \"\$HOME/.claude/shared/bin\""
  else
    echo "    echo 'export PATH=\"\$HOME/.claude/shared/bin:\$PATH\"' >> $RC_FILE && source $RC_FILE"
  fi
fi
echo
