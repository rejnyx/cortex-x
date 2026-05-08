# cortex-hermes.ps1 — Sprint 4.7 backward-compat shim.
#
# Renamed to cortex-steward.ps1 in Sprint 4.7. Forwards every invocation to the
# new entrypoint and emits a one-line deprecation warning. Removed in v0.2.0.
#
# Set $env:STEWARD_SUPPRESS_DEPRECATION='1' to silence the warning.

if ($env:STEWARD_SUPPRESS_DEPRECATION -ne '1') {
    Write-Host "[steward:deprecation] cortex-hermes.ps1 was renamed to cortex-steward.ps1 in Sprint 4.7. This shim is removed in v0.2.0 — please update your scripts." -ForegroundColor Yellow
}

$ScriptDir = $PSScriptRoot
$Target = Join-Path $ScriptDir "cortex-steward.ps1"
& $Target @args
exit $LASTEXITCODE
