#!/usr/bin/env bash
# bin/test-install-docker.sh
# Test cortex-x install across multiple Linux distros via Docker.
#
# Two modes:
#   --local  (default) — mounts the local repo at /cortex-source, sets
#                        CORTEX_HOME, runs the local install.sh. Tests the
#                        WORKING-COPY install flow.
#   --remote           — runs the exact public one-liner: curl the published
#                        install.sh from main and pipe it to bash. install.sh
#                        detects pipe execution and self-clones to ~/cortex-x,
#                        so the pipe is load-bearing — it must NOT be replaced
#                        with download-then-run (that makes install.sh think
#                        it is a local-mode install). A curl failure is caught
#                        by the chained verify-install.cjs step failing.
#
# Scope: this harness covers Linux-distro breadth that the CI matrix's single
# ubuntu lane does not. The Windows (Git Bash / PowerShell 7 / PS 5.1) and
# macOS install paths are covered separately by the 5-lane GitHub Actions CI
# matrix in .github/workflows/install-smoke.yml.
#
# Usage:
#   ./bin/test-install-docker.sh                       # all distros, local mode
#   ./bin/test-install-docker.sh --remote              # public install flow
#   ./bin/test-install-docker.sh --distro ubuntu       # one distro only
#   ./bin/test-install-docker.sh --distro alpine --remote
#   ./bin/test-install-docker.sh --keep-logs           # retain logs on success
#   ./bin/test-install-docker.sh --help
#
# Distros covered:
#   ubuntu  — ubuntu:22.04   (Node 22 via NodeSource)
#   debian  — debian:12      (Node 22 via NodeSource)
#   fedora  — fedora:42      (Node 22 in default repo; F40/F41 ship Node 20)
#   alpine  — alpine:3.21    (Node 22 in main; musl libc — catches glibc-only bugs;
#                             3.19/3.20 ship Node 20)
#
# The container entrypoint runs `sh` (not bash) for portability — alpine ships
# only ash, and the per-distro prep is the step that installs bash where
# install.sh needs it. install.sh itself is always invoked explicitly via bash.
#
# Windows Git Bash note: this script prepends MSYS_NO_PATHCONV=1 to the docker
# run command to prevent MSYS rewriting the container-side path /cortex-source
# to C:\Program Files\Git\cortex-source. Harmless no-op on Linux/macOS.
#
# Exit codes:
#   0 — every selected distro passed
#   1 — one or more distros failed (logs retained under $LOG_DIR)
#   2 — Docker not available or daemon unreachable

set -euo pipefail

usage() {
  cat <<'EOF'
test-install-docker.sh — verify cortex-x install across Linux distros via Docker

Usage:
  ./bin/test-install-docker.sh                  all distros, local mode
  ./bin/test-install-docker.sh --remote         public curl-pipe-bash flow
  ./bin/test-install-docker.sh --distro ubuntu  single distro
  ./bin/test-install-docker.sh --keep-logs      retain logs on success
  ./bin/test-install-docker.sh --help

Modes:
  --local   (default) mount the working copy, run the local install.sh
  --remote  run the public one-liner: curl install.sh from main | bash

Distros: ubuntu (22.04) · debian (12) · fedora (42) · alpine (3.21)

Exit codes: 0 all pass · 1 one+ failed · 2 docker unavailable
EOF
}

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$(mktemp -d -t cortex-install-docker.XXXXXX)"

MODE="local"
DISTROS_FILTER=""
KEEP_LOGS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --remote) MODE="remote"; shift ;;
    --local)  MODE="local";  shift ;;
    --distro) DISTROS_FILTER="$2"; shift 2 ;;
    --keep-logs) KEEP_LOGS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1 — try --help"; exit 1 ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not in PATH. Install Docker Desktop and retry."
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: docker daemon not reachable. Start Docker Desktop and retry."
  exit 2
fi

# Distro registry: name → "image|prep_command"
# prep_command must end with node (>=22), git, curl, ca-certificates in PATH.
# bash is needed by install.sh itself and is installed by prep where the base
# image lacks it (alpine); the container entrypoint uses sh, not bash.
declare -A DISTROS=(
  [ubuntu]="ubuntu:22.04|apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs"
  [debian]="debian:12|apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git ca-certificates && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs"
  [fedora]="fedora:42|dnf install -y -q curl git nodejs ca-certificates"
  [alpine]="alpine:3.21|apk add --no-cache curl git bash nodejs npm ca-certificates"
)

# Apply --distro filter, if provided.
if [[ -n "$DISTROS_FILTER" ]]; then
  if [[ -z "${DISTROS[$DISTROS_FILTER]:-}" ]]; then
    echo "ERROR: unknown distro '$DISTROS_FILTER'. Available: ${!DISTROS[*]}"
    exit 1
  fi
  ONLY="${DISTROS[$DISTROS_FILTER]}"
  unset DISTROS
  declare -A DISTROS=( ["$DISTROS_FILTER"]="$ONLY" )
fi

# Build the install + verify command for the chosen mode.
# --local: source is mounted read-only at /cortex-source. install.sh writes
#   module.local.yaml + may git-fetch, so we copy to a writable /tmp/cortex
#   inside the container before installing. This preserves host isolation
#   (no writes leak back) while letting install.sh do its in-place work.
# --remote: the exact public one-liner — curl install.sh | bash. install.sh's
#   pipe-detection self-clones cortex-x to ~/cortex-x and re-execs from there,
#   so the pipe must be preserved (download-then-run would make install.sh
#   treat /tmp as a local checkout and fail). A failed curl pipes empty input
#   into bash (exit 0), but the chained verify-install.cjs then fails because
#   nothing was installed — so the run still reports FAIL, never a false PASS.
if [[ "$MODE" == "local" ]]; then
  INSTALL_CMD='cp -r /cortex-source /tmp/cortex && export CORTEX_HOME=/tmp/cortex && bash /tmp/cortex/install.sh && node /tmp/cortex/tests/smoke/verify-install.cjs --strict'
  DOCKER_MOUNT=(-v "$REPO_ROOT:/cortex-source:ro")
else
  INSTALL_CMD='curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash && node "$HOME/cortex-x/tests/smoke/verify-install.cjs" --strict'
  DOCKER_MOUNT=()
fi

echo "── cortex-x install test ────────────────────────────────────────"
echo "  Mode:    $MODE"
echo "  Distros: ${!DISTROS[*]}"
echo "  Logs:    $LOG_DIR"
echo "─────────────────────────────────────────────────────────────────"
echo

PASS_COUNT=0
FAIL_COUNT=0
declare -A RESULTS

for distro in "${!DISTROS[@]}"; do
  entry="${DISTROS[$distro]}"
  image="${entry%%|*}"
  prep="${entry#*|}"
  log_file="$LOG_DIR/$distro.log"

  printf "  %-10s · %-20s · " "$distro" "$image"

  start=$(date +%s)

  # Container entrypoint is `sh` (POSIX) — works on alpine's ash too. set -e
  # plus the && chain aborts on any failed step; the discrete curl -o in
  # --remote mode means a download failure is caught without needing pipefail
  # (which is not POSIX and unavailable under dash/ash).
  if MSYS_NO_PATHCONV=1 docker run --rm "${DOCKER_MOUNT[@]}" "$image" \
       sh -c "set -e; $prep && $INSTALL_CMD" \
       >"$log_file" 2>&1; then
    elapsed=$(($(date +%s) - start))
    printf "PASS in %3ds\n" "$elapsed"
    RESULTS[$distro]="PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    elapsed=$(($(date +%s) - start))
    printf "FAIL in %3ds — log: %s\n" "$elapsed" "$log_file"
    RESULTS[$distro]="FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo
echo "── Summary ──────────────────────────────────────────────────────"
printf "  %d passed · %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"
echo "─────────────────────────────────────────────────────────────────"

if [[ "$KEEP_LOGS" == false && $FAIL_COUNT -eq 0 ]]; then
  rm -rf "$LOG_DIR"
  echo "  (logs cleaned; pass --keep-logs to retain)"
else
  echo "  Logs retained at: $LOG_DIR"
fi

[[ $FAIL_COUNT -eq 0 ]]
