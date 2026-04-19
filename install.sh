#!/usr/bin/env bash
# cortex-x installer
# Installs shared framework to ~/.claude/ for global use across projects.
# Safe: backs up existing ~/.claude/shared/ before overwriting.
#
# Env vars honored (see standards/ship-ready.md):
#   CORTEX_CHANNEL=beta|stable  — beta = track main HEAD (default for now);
#                                 stable = checkout highest semver tag.
#   CORTEX_HOME=<path>          — override cortex-x source directory
#                                 (default: script location).
#   CORTEX_NO_UPDATE=1          — skip checkout step even if CHANNEL=stable.

set -e

# Resolve cortex-x source directory.
# Precedence: $CORTEX_HOME → script location.
if [ -n "$CORTEX_HOME" ] && [ -d "$CORTEX_HOME" ]; then
  CORTEX_ROOT="$CORTEX_HOME"
else
  CORTEX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
CLAUDE_HOME="${HOME}/.claude"
CHANNEL="${CORTEX_CHANNEL:-beta}"

echo "cortex-x installer"
echo "  from:    $CORTEX_ROOT"
echo "  to:      $CLAUDE_HOME/shared"
echo "  channel: $CHANNEL"
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
fi

mkdir -p "$CLAUDE_HOME/shared"

# Copy shared content (hooks, skills, agents, standards)
cp -r "$CORTEX_ROOT/shared/." "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/standards" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/templates" "$CLAUDE_HOME/shared/"
cp -r "$CORTEX_ROOT/profiles" "$CLAUDE_HOME/shared/"

echo "Done."
echo
echo "Hooks copied to ~/.claude/shared/hooks/:"
echo "  block-destructive.cjs   (PreToolUse matcher:Bash)"
echo "  session-start.cjs       (SessionStart)"
echo "  pre-compact.cjs         (PreCompact)"
echo "  pre-tool-use.cjs        (PreToolUse all tools — journal companion)"
echo "  post-tool-use.cjs       (PostToolUse all tools — journal writer)"
echo "  _lib/redact.cjs         (shared secret-scrubbing library)"
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
  ]
JSON
echo
echo "Journal will be written to: $CORTEX_ROOT/journal/YYYY-MM-DD-<project-slug>.jsonl"
echo "See journal/README.md for schema + privacy contract."
echo "See standards/ship-ready.md for CORTEX_HOME / CORTEX_CHANNEL semantics."
