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
    git clone --quiet https://github.com/Rejnyx/cortex-x "$CORTEX_CLONE_DIR" || {
      echo "ERROR: git clone failed" >&2
      exit 1
    }
    echo "  cloned successfully"
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

# Skills directory — agentskills.io-compatible SKILL.md files.
# Only copy if source exists (cortex-x Phase 2 may scaffold these later).
if [ -d "$CORTEX_ROOT/skills" ]; then
  cp -r "$CORTEX_ROOT/skills" "$CLAUDE_HOME/shared/" 2>/dev/null || true
fi

# Detectors directory — deterministic profile/stack/stage classifiers (auto-optimization).
# Read by session-start hook + cortex-doctor prompt. Fail-open contract.
if [ -d "$CORTEX_ROOT/detectors" ]; then
  cp -r "$CORTEX_ROOT/detectors" "$CLAUDE_HOME/shared/" 2>/dev/null || true
fi

# Record cortex-x source dir for {{cortex_source}} placeholder resolution at scaffold time.
# Templates reference installed assets via ~/.claude/shared/; dynamic dirs (projects/, research/)
# stay in source and need an absolute path baked into scaffolded files.
printf 'cortex_source: %s\n' "$CORTEX_ROOT" > "$CLAUDE_HOME/shared/cortex-source.yaml"

echo "Done."
echo

# Write/update module.local.yaml with user preference
# (gitignored — user-specific overrides)
MODULE_LOCAL="$CORTEX_ROOT/module.local.yaml"
cat > "$MODULE_LOCAL" <<YAML
# Per-user override (gitignored). See module.yaml for defaults.
# Regenerated by install.sh — edit freely after install, won't be overwritten
# unless you re-run install.
config:
  communication_language: $CORTEX_LANGUAGE
YAML
echo "Wrote user prefs to: $MODULE_LOCAL (gitignored)"

# Print language directive for user to add to their ~/.claude/CLAUDE.md
# (we don't auto-edit the user's global CLAUDE.md — Principle 1 "ask, don't
#  silently modify user files" per standards/coding-behavior.md §1)
case "$CORTEX_LANGUAGE" in
  cs) LANG_NAME="Czech (čeština)" ;;
  de) LANG_NAME="German (Deutsch)" ;;
  fr) LANG_NAME="French (français)" ;;
  es) LANG_NAME="Spanish (español)" ;;
  *)  LANG_NAME="English" ;;
esac
echo
echo "To enforce the language preference, add this block to ~/.claude/CLAUDE.md:"
echo
echo "---"
echo "<!-- BEGIN cortex-x — communication language -->"
echo "## cortex-x language"
echo "When working in a cortex-x-scaffolded project or invoking cortex-x prompts,"
echo "respond in: **$LANG_NAME** (code: $CORTEX_LANGUAGE). Never switch languages mid-reply."
echo "<!-- END cortex-x -->"
echo "---"
echo

# Install cortex-bootstrap helper to ~/.claude/shared/bin/ (per-project mode selector).
# This is the second-step UX: install.sh installs the framework once,
# cortex-bootstrap is run in each TARGET project to write the marker file
# that primes the SessionStart hook to auto-launch /start or /audit.
mkdir -p "$CLAUDE_HOME/shared/bin"
if [ -f "$CORTEX_ROOT/bin/cortex-bootstrap" ]; then
  cp "$CORTEX_ROOT/bin/cortex-bootstrap" "$CLAUDE_HOME/shared/bin/cortex-bootstrap"
  chmod +x "$CLAUDE_HOME/shared/bin/cortex-bootstrap"
fi
if [ -f "$CORTEX_ROOT/bin/cortex-bootstrap.ps1" ]; then
  cp "$CORTEX_ROOT/bin/cortex-bootstrap.ps1" "$CLAUDE_HOME/shared/bin/cortex-bootstrap.ps1"
fi

echo
echo "============================================================"
echo "cortex-bootstrap helper installed to: $CLAUDE_HOME/shared/bin/"
echo
echo "NEXT STEP — go to your TARGET project directory and run:"
echo
echo "  $CLAUDE_HOME/shared/bin/cortex-bootstrap"
echo
echo "It asks:  [N]ew / [E]xisting / [F]ramework-only — writes a one-shot"
echo "marker file. Then 'claude' in the same dir auto-primes the right skill"
echo "(/start for new, /audit for existing). Marker has 1h TTL."
echo
echo "Add to PATH for convenience:"
echo "  export PATH=\"\$HOME/.claude/shared/bin:\$PATH\""
echo "============================================================"
echo

echo "Hooks copied to ~/.claude/shared/hooks/:"
echo "  block-destructive.cjs   (PreToolUse matcher:Bash)"
echo "  session-start.cjs       (SessionStart — also surfaces recent budget)"
echo "  pre-compact.cjs         (PreCompact)"
echo "  pre-tool-use.cjs        (PreToolUse all tools — journal companion)"
echo "  post-tool-use.cjs       (PostToolUse all tools — journal + budget writer)"
echo "  auto-orchestrate.cjs    (UserPromptSubmit — 3-fronta hint + budget warn)"
echo "  tirith-scan.cjs         (SessionStart — optional, no-op if tirith binary absent)"
echo "  _lib/redact.cjs         (shared secret-scrubbing library)"
echo "  _lib/budget.cjs         (shared token-cost tracking library)"

# Optional Tirith detection hint — context-file injection scanner from Hermes Agent stack (MIT).
if ! command -v tirith > /dev/null 2>&1; then
  echo
  echo "Optional: install Tirith (https://tirith.sh/) for context-file prompt-injection scanning:"
  echo "  cargo install tirith"
  echo "  # or download from https://github.com/NousResearch/tirith/releases"
  echo "tirith-scan.cjs hook will auto-detect once installed. Skip if not doing agentic work."
fi
echo
echo "Register them in ~/.claude/settings.json under \"hooks\". Example snippet:"
cat <<'JSON'
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/block-destructive.cjs\"","timeout":5}] },
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/pre-tool-use.cjs\"","timeout":3}] }
  ],
  "PostToolUse": [
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/post-tool-use.cjs\"","timeout":5}] }
  ],
  "UserPromptSubmit": [
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"","timeout":3}] }
  ]
JSON
echo
echo "Budget cap: set CORTEX_SESSION_BUDGET_USD (default \$5.00). Spend log: \$CORTEX_HOME/journal/.budget.jsonl"
echo
echo "Journal will be written to: $CORTEX_ROOT/journal/YYYY-MM-DD-<project-slug>.jsonl"
echo "See journal/README.md for schema + privacy contract."
echo "See standards/ship-ready.md for CORTEX_HOME / CORTEX_CHANNEL semantics."

# Final PATH-add advice — surface this AFTER all the hook detail so it's the
# last thing the user sees. Auto-detect shell + propose the right rcfile line.
echo
echo "============================================================"
echo "FINAL STEP — add cortex-bootstrap to your PATH"
echo "============================================================"
SHELL_NAME="$(basename "${SHELL:-bash}")"
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
  *)    RC_FILE="$HOME/.profile" ;;
esac

if echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.claude/shared/bin"; then
  echo "PATH already contains $HOME/.claude/shared/bin — you're set."
else
  echo "Run this once to add bin/ to PATH:"
  echo
  if [ "$SHELL_NAME" = "fish" ]; then
    echo "  fish_add_path \"\$HOME/.claude/shared/bin\""
  else
    echo "  echo 'export PATH=\"\$HOME/.claude/shared/bin:\$PATH\"' >> $RC_FILE"
    echo "  source $RC_FILE   # or open a new terminal"
  fi
fi
echo
echo "Then per-project:"
echo "  cd ~/your-project"
echo "  cortex-bootstrap     # interactive [N]ew / [E]xisting / [F]ramework"
echo "  claude               # auto-primes /start (new) or /audit (existing)"
echo "============================================================"
