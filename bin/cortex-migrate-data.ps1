# cortex-migrate-data.ps1 — Sprint 1.6 one-shot migration (Windows)
#
# Pre-Sprint-1.6 cortex-x kept user-personal data inside the source repo:
#   $CortexHome/research/    — research caches per project
#   $CortexHome/projects/    — cross-project library
#   $CortexHome/insights/    — accumulated wisdom
#   $CortexHome/journal/     — tool-call journal
#   $CortexHome/evals/       — eval results
#
# Sprint 1.6 separates user data from framework distribution. This script moves
# those dirs to $CortexDataHome (default ~/.cortex/) so the cortex-x source repo
# stays clean for `git pull` workflows + multi-user public release.
#
# Idempotent: safe to re-run. Skips missing source dirs. Renames conflicts with
# .pre-sprint-1-6 suffix instead of overwriting.
#
# Usage:
#   .\cortex-migrate-data.ps1                    # auto-detect $CORTEX_HOME
#   $env:CORTEX_HOME="$HOME\work\cortex-x"; .\cortex-migrate-data.ps1
#   .\cortex-migrate-data.ps1 -DryRun

param([switch]$DryRun)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }

# Resolve CortexHome (source repo)
$CortexHome = $env:CORTEX_HOME
if (-not $CortexHome) {
    foreach ($c in @(
        (Join-Path $HOME "cortex-x"),
        (Join-Path $HOME "Desktop\APPs\cortex-x"),
        (Join-Path $HOME ".cortex-x")
    )) {
        if ((Test-Path (Join-Path $c ".git")) -and (Test-Path (Join-Path $c "install.ps1"))) {
            $CortexHome = $c
            break
        }
    }
}
if (-not $CortexHome -or -not (Test-Path $CortexHome)) {
    Write-Host "ERROR: cannot find cortex-x source repo. Set CORTEX_HOME or run from inside it." -ForegroundColor Red
    exit 1
}

# Resolve CortexDataHome (target)
$CortexDataHome = if ($env:CORTEX_DATA_HOME) { $env:CORTEX_DATA_HOME } else { Join-Path $HOME ".cortex" }

Write-Host "cortex-x data migration (Sprint 1.6)"
Write-Host "  source: $CortexHome"
Write-Host "  target: $CortexDataHome"
if ($DryRun) { Write-Host "  mode:   DRY RUN (no changes)" }
Write-Host ""

foreach ($sub in @("research", "projects", "insights/proposals", "journal", "evals")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $CortexDataHome $sub) | Out-Null
}

$migrated = 0
$skipped = 0

function Migrate-SubDir {
    param([string]$Subdir)
    $src = Join-Path $CortexHome $Subdir
    $dst = Join-Path $CortexDataHome $Subdir

    if (-not (Test-Path $src)) {
        Write-Host "  $([char]0x21B7) $Subdir/  (no source dir, skip)"
        $script:skipped++
        return
    }

    # Count user files (.md, excluding README.md)
    $files = Get-ChildItem -Path $src -Recurse -Filter "*.md" -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne "README.md" -and $_.FullName -notlike "*\node_modules\*" }

    if ($files.Count -eq 0) {
        Write-Host "  $([char]0x21B7) $Subdir/  (empty user data, skip)"
        $script:skipped++
        return
    }

    if ($DryRun) {
        Write-Host "  $([char]0x2192) would move $($files.Count) file(s) from $src to $dst"
        $script:migrated += $files.Count
        return
    }

    $movedHere = 0
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($src.Length).TrimStart('\', '/')
        $target = Join-Path $dst $rel
        $targetDir = Split-Path -Parent $target
        if ($targetDir) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }
        if (Test-Path $target) {
            $target = "$target.pre-sprint-1-6"
            Write-Host "    $([char]0x26A0) conflict $(Split-Path -Leaf $target)"
        }
        Move-Item -Path $f.FullName -Destination $target -Force
        $movedHere++
    }
    Write-Host "  $([char]0x2713) $Subdir/  $movedHere file(s) moved"
    $script:migrated += $movedHere
}

# Sprint 1.6 migrates only research/ + projects/ — these are unambiguously
# user-data per project (slug-keyed, accumulated by use). insights/, journal/,
# evals/ are deferred to Sprint 1.7 because they may contain framework-shipped
# canonical content (eval task definitions, pattern docs) mixed with user
# accumulation. Manual user review needed before bulk move.
Migrate-SubDir "research"
Migrate-SubDir "projects"

Write-Host ""
Write-Host "summary: $migrated file(s) moved, $skipped dir(s) skipped"

if (-not $DryRun -and $migrated -gt 0) {
    Write-Host ""
    Write-Host "next steps:"
    Write-Host "  1. Verify: Get-ChildItem $CortexDataHome\research, $CortexDataHome\projects"
    Write-Host "  2. Commit cortex-x source (the now-empty user-data dirs are git-tracked):"
    Write-Host "     cd $CortexHome; git status"
    Write-Host "  3. If anything mis-moved, .pre-sprint-1-6 suffixed files preserve the original"
}
