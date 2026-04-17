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
Write-Host "Hooks copied to ~/.claude/shared/hooks/:"
Write-Host "  block-destructive.cjs   (PreToolUse matcher:Bash)"
Write-Host "  session-start.cjs       (SessionStart)"
Write-Host "  pre-compact.cjs         (PreCompact)"
Write-Host "  pre-tool-use.cjs        (PreToolUse all tools — journal companion)"
Write-Host "  post-tool-use.cjs       (PostToolUse all tools — journal writer)"
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
