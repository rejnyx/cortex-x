# cortex-bootstrap.ps1 — thin PowerShell shim that invokes the Node
# implementation at bin/cortex-bootstrap.cjs (real arrow-key TUI lives there).
#
# Why a Node implementation? cortex-x already requires Node for hooks (.cjs).
# Using Node here gives us @clack/prompts-class arrow-key UX with zero
# additional dependencies (no `npm install` step).

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node is required but not found on PATH." -ForegroundColor Red
    Write-Host "  cortex-x's hooks and bootstrap UI both require Node 18+." -ForegroundColor Red
    Write-Host "  Install Node first, then re-run." -ForegroundColor Red
    exit 1
}

$ScriptDir = $PSScriptRoot
$NodeScript = Join-Path $ScriptDir "cortex-bootstrap.cjs"
& node $NodeScript @args
exit $LASTEXITCODE
