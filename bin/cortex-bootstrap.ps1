# cortex-bootstrap.ps1 — per-project mode selector for cortex-x onboarding (PowerShell).
#
# Run this in your TARGET project directory (not in cortex-x source). It asks
# what you're doing here, writes a one-shot marker file (.cortex-bootstrap-pending),
# and tells you to launch claude. The cortex-x SessionStart hook reads the
# marker on the next claude session and primes the appropriate skill.
#
# Usage:
#   cd ~/my-new-project
#   cortex-bootstrap
#
# Non-interactive (CI / scripts):
#   $env:CORTEX_BOOTSTRAP_MODE = "new"
#   cortex-bootstrap

param(
    [string]$Mode = $env:CORTEX_BOOTSTRAP_MODE
)

$Marker = Join-Path (Get-Location) ".cortex-bootstrap-pending"

if (-not $Mode) {
    if (-not [Environment]::UserInteractive) {
        Write-Host "Non-interactive shell. Set `$env:CORTEX_BOOTSTRAP_MODE = 'new|existing|framework' and re-run."
        exit 2
    }
    Write-Host ""
    Write-Host "cortex-bootstrap — what are you doing in this directory?"
    Write-Host ""
    Write-Host "  [N]  New project        — empty / near-empty folder; walk through brief -> architect -> scaffold"
    Write-Host "  [E]  Existing project   — established codebase; deep audit + recommendations"
    Write-Host "  [F]  Framework only     — I'll paste prompts manually as needed (no marker, no auto-prime)"
    Write-Host ""
    Write-Host "Marker file: $Marker"
    Write-Host ""
    $Choice = Read-Host "Choice [N/E/F]"
    switch -Regex ($Choice) {
        '^[Nn]'  { $Mode = 'new' }
        '^[Ee]'  { $Mode = 'existing' }
        '^[Ff]'  { $Mode = 'framework' }
        default {
            Write-Host "Unknown choice. Run again and pick N, E, or F."
            exit 2
        }
    }
}

switch ($Mode) {
    'new' {
        $Now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        @"
mode=new
at=$Now
"@ | Out-File -FilePath $Marker -Encoding utf8 -NoNewline
        Write-Host ""
        Write-Host "Wrote: $Marker"
        Write-Host "  mode=new"
        Write-Host "  at=$Now (1h TTL)"
        Write-Host ""
        Write-Host "Next: run 'claude' in this directory."
        Write-Host "  cortex-x will auto-prime the /start skill (new-project bootstrap)."
    }
    'existing' {
        $Now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        @"
mode=existing
at=$Now
"@ | Out-File -FilePath $Marker -Encoding utf8 -NoNewline
        Write-Host ""
        Write-Host "Wrote: $Marker"
        Write-Host "  mode=existing"
        Write-Host "  at=$Now (1h TTL)"
        Write-Host ""
        Write-Host "Next: run 'claude' in this directory."
        Write-Host "  cortex-x will auto-prime the /audit skill (12-dimension existing-project audit)."
    }
    'framework' {
        Write-Host ""
        Write-Host "Framework-only mode — no marker written."
        Write-Host "Available prompts when you launch claude:"
        Write-Host "  /start          new-project bootstrap (Discover -> Research -> Architect -> Scaffold -> Adapt)"
        Write-Host "  /audit          existing-project deep audit (12 dimensions)"
        Write-Host "  /sync           end-of-session knowledge capture"
        Write-Host "  /doctor         healthcheck"
        Write-Host "  /retrofit       apply cortex-x patterns to an existing project (after /audit)"
    }
    default {
        Write-Host "Unknown mode '$Mode'. Use new|existing|framework."
        exit 2
    }
}
