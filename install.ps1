# cortex-x installer (PowerShell)
# Installs shared framework to ~/.claude/ for global use across projects.

$ErrorActionPreference = "Stop"

$CortexRoot = $PSScriptRoot
$ClaudeHome = Join-Path $HOME ".claude"
$SharedTarget = Join-Path $ClaudeHome "shared"

Write-Host "cortex-x installer"
Write-Host "  from: $CortexRoot"
Write-Host "  to:   $SharedTarget"
Write-Host ""

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
Write-Host "Next: ensure ~/.claude/settings.json references hooks at:"
Write-Host "  ~/.claude/shared/hooks/block-destructive.cjs"
Write-Host "  ~/.claude/shared/hooks/session-start.cjs"
Write-Host "  ~/.claude/shared/hooks/pre-compact.cjs"
