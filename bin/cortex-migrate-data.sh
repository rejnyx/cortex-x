#!/usr/bin/env bash
# cortex-migrate-data — Sprint 1.6 one-shot migration
#
# Pre-Sprint-1.6 cortex-x kept user-personal data inside the source repo:
#   $CORTEX_HOME/research/    — research caches per project
#   $CORTEX_HOME/projects/    — cross-project library
#   $CORTEX_HOME/insights/    — accumulated wisdom
#   $CORTEX_HOME/journal/     — tool-call journal
#   $CORTEX_HOME/evals/       — eval results
#
# Sprint 1.6 separates user data from framework distribution. This script moves
# those dirs to $CORTEX_DATA_HOME (default ~/.cortex/) so the cortex-x source
# repo stays clean for `git pull` workflows + multi-user public release.
#
# Idempotent: safe to re-run. Skips missing source dirs. Errors out instead of
# overwriting if target already has files.
#
# Usage:
#   bash cortex-migrate-data.sh                  # auto-detect $CORTEX_HOME
#   CORTEX_HOME=~/work/cortex-x cortex-migrate-data.sh
#   CORTEX_DATA_HOME=~/data/cortex cortex-migrate-data.sh
#   cortex-migrate-data.sh --dry-run             # show what would move

set -e

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Resolve CORTEX_HOME (source repo)
if [ -z "${CORTEX_HOME:-}" ]; then
  for c in "$HOME/cortex-x" "$HOME/Desktop/APPs/cortex-x" "$HOME/.cortex-x"; do
    [ -d "$c/.git" ] && [ -f "$c/install.sh" ] && CORTEX_HOME="$c" && break
  done
fi
if [ -z "${CORTEX_HOME:-}" ] || [ ! -d "$CORTEX_HOME" ]; then
  echo "ERROR: cannot find cortex-x source repo. Set \$CORTEX_HOME or run from inside it." >&2
  exit 1
fi

# Resolve CORTEX_DATA_HOME (target)
CORTEX_DATA_HOME="${CORTEX_DATA_HOME:-$HOME/.cortex}"

echo "cortex-x data migration (Sprint 1.6)"
echo "  source: $CORTEX_HOME"
echo "  target: $CORTEX_DATA_HOME"
[ "$DRY_RUN" = "1" ] && echo "  mode:   DRY RUN (no changes)"
echo

mkdir -p "$CORTEX_DATA_HOME"/{research,projects,insights/proposals,journal,evals}

migrated=0
skipped=0
errors=0

migrate_dir() {
  local subdir="$1"
  local src="$CORTEX_HOME/$subdir"
  local dst="$CORTEX_DATA_HOME/$subdir"

  if [ ! -d "$src" ]; then
    echo "  ↷ $subdir/  (no source dir, skip)"
    skipped=$((skipped + 1))
    return
  fi

  # Count files (excluding README.md which ships with framework)
  local count
  count=$(find "$src" -maxdepth 2 -type f -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')

  if [ "$count" = "0" ]; then
    echo "  ↷ $subdir/  (empty user data, skip)"
    skipped=$((skipped + 1))
    return
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "  → would move $count file(s) from $src/ to $dst/"
    migrated=$((migrated + count))
    return
  fi

  # Move .md files (preserve subdirs like insights/proposals/) — skip README.md
  local moved_here=0
  while IFS= read -r f; do
    local rel="${f#$src/}"
    local target="$dst/$rel"
    mkdir -p "$(dirname "$target")"
    if [ -e "$target" ]; then
      # Conflict: append .pre-sprint-1-6 suffix to incoming, don't overwrite
      target="${target}.pre-sprint-1-6"
      echo "    ⚠ conflict — saving as $(basename "$target")"
    fi
    mv "$f" "$target"
    moved_here=$((moved_here + 1))
  done < <(find "$src" -maxdepth 2 -type f -name '*.md' ! -name 'README.md' 2>/dev/null)

  echo "  ✓ $subdir/  $moved_here file(s) moved"
  migrated=$((migrated + moved_here))
}

# Sprint 1.6 migrates only research/ + projects/ — these are unambiguously
# user-data per project (slug-keyed, accumulated by use). insights/, journal/,
# evals/ are deferred to Sprint 1.7 because they may contain framework-shipped
# canonical content (eval task definitions, pattern docs) mixed with user
# accumulation. Manual user review needed before bulk move.
migrate_dir research
migrate_dir projects

echo
echo "summary: $migrated file(s) moved, $skipped dir(s) skipped, $errors error(s)"

if [ "$DRY_RUN" = "0" ] && [ "$migrated" -gt 0 ]; then
  echo
  echo "next steps:"
  echo "  1. Verify: ls $CORTEX_DATA_HOME/{research,projects}/"
  echo "  2. Commit cortex-x source (the now-empty user-data dirs are git-tracked):"
  echo "     cd $CORTEX_HOME && git status"
  echo "  3. If anything mis-moved, .pre-sprint-1-6 suffixed files preserve the original"
fi
