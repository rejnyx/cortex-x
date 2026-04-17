#!/usr/bin/env bash
# cortex-x installer
# Installs shared framework to ~/.claude/ for global use across projects.
# Safe: backs up existing ~/.claude/shared/ before overwriting.

set -e

CORTEX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"

echo "cortex-x installer"
echo "  from: $CORTEX_ROOT"
echo "  to:   $CLAUDE_HOME/shared"
echo

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
