# cortex-x installer (PowerShell)
# Installs shared framework to ~/.claude/ for global use across projects.
#
# Env vars honored (see standards/ship-ready.md):
#   $env:CORTEX_CHANNEL = 'beta' | 'stable'  — beta = track main HEAD (default);
#                                              stable = checkout highest semver tag.
#   $env:CORTEX_HOME    = <path>             — override cortex-x source directory.
#   $env:CORTEX_NO_UPDATE = '1'              — skip checkout even if CHANNEL=stable.

$ErrorActionPreference = "Stop"

# Resolve cortex-x source directory.
if ($env:CORTEX_HOME -and (Test-Path $env:CORTEX_HOME)) {
    $CortexRoot = $env:CORTEX_HOME
} else {
    $CortexRoot = $PSScriptRoot
}
$ClaudeHome   = Join-Path $HOME ".claude"
$SharedTarget = Join-Path $ClaudeHome "shared"
$Channel      = if ($env:CORTEX_CHANNEL) { $env:CORTEX_CHANNEL } else { "beta" }

Write-Host "cortex-x installer"
Write-Host "  from:    $CortexRoot"
Write-Host "  to:      $SharedTarget"
Write-Host "  channel: $Channel"
Write-Host ""

# Channel resolution.
$GitDir = Join-Path $CortexRoot ".git"
if ((Test-Path $GitDir) -and (-not $env:CORTEX_NO_UPDATE)) {
    Push-Location $CortexRoot
    try {
        if ($Channel -eq "stable") {
            git fetch --tags --quiet
            $Tags = git tag -l "v*" --sort=-v:refname 2>$null | Where-Object { $_ -notmatch "-(alpha|beta|rc)" }
            $Latest = $Tags | Select-Object -First 1
            if ($Latest) {
                Write-Host "Checking out stable tag: $Latest"
                git checkout --quiet $Latest
            } else {
                Write-Host "No stable tag found (no v*.*.* yet); staying on current branch."
            }
        } elseif ($Channel -eq "beta") {
            # Capture each exit code explicitly — `$Clean = ... -and ...` captures stdout, not codes.
            # Relax ErrorActionPreference around git so non-zero exits from --quiet don't throw.
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            git diff --quiet 2>$null;        $unstagedDirty = $LASTEXITCODE
            git diff --cached --quiet 2>$null; $stagedDirty   = $LASTEXITCODE
            if ($unstagedDirty -eq 0 -and $stagedDirty -eq 0) {
                git fetch --quiet 2>$null | Out-Null
                git checkout --quiet main 2>$null | Out-Null
            } else {
                Write-Host "Local changes detected — skipping beta auto-update. Commit or stash to resume."
            }
            $ErrorActionPreference = $prevEAP
        }
    } finally { Pop-Location }
}

if (Test-Path $SharedTarget) {
    $backup = Join-Path $ClaudeHome "shared.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "Existing ~/.claude/shared/ found. Backing up to: $backup"
    Move-Item $SharedTarget $backup
}

New-Item -ItemType Directory -Path $SharedTarget -Force | Out-Null

# Copy shared content
Copy-Item -Recurse -Path (Join-Path $CortexRoot "shared\*") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "standards") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "templates") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "profiles") -Destination $SharedTarget

Write-Host "Done."
Write-Host ""
Write-Host "Hooks copied to ~/.claude/shared/hooks/:"
Write-Host "  block-destructive.cjs   (PreToolUse matcher:Bash)"
Write-Host "  session-start.cjs       (SessionStart)"
Write-Host "  pre-compact.cjs         (PreCompact)"
Write-Host "  pre-tool-use.cjs        (PreToolUse all tools — journal companion)"
Write-Host "  post-tool-use.cjs       (PostToolUse all tools — journal writer)"
Write-Host "  _lib/redact.cjs         (shared secret-scrubbing library)"
Write-Host ""
Write-Host "Register them in ~/.claude/settings.json under ""hooks"". Example snippet:"
@'
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/block-destructive.cjs\"","timeout":5}] },
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/pre-tool-use.cjs\"","timeout":3}] }
  ],
  "PostToolUse": [
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/post-tool-use.cjs\"","timeout":5}] }
  ]
'@ | Write-Host
Write-Host ""
Write-Host "Journal will be written to: $CortexRoot/journal/YYYY-MM-DD-<project-slug>.jsonl"
Write-Host "See journal/README.md for schema + privacy contract."
Write-Host "See standards/ship-ready.md for CORTEX_HOME / CORTEX_CHANNEL semantics."
