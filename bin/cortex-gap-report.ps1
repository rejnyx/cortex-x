# cortex-gap-report.ps1 — thin PowerShell shim invoking the Node aggregator.
# Real implementation: bin/cortex-gap-report.cjs

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node is required but not found on PATH." -ForegroundColor Red
    exit 1
}

$ScriptDir = $PSScriptRoot
$NodeScript = Join-Path $ScriptDir "cortex-gap-report.cjs"
& node $NodeScript @args
exit $LASTEXITCODE
