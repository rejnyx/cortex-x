# cortex-steward.ps1 — PowerShell shim for the Steward runtime CLI
# (renamed from cortex-hermes.ps1 in Sprint 4.7).
#
# Resolves the cortex-x source directory via two strategies:
#   1) Repo-local: if $PSScriptRoot/cortex-steward.cjs exists, use it directly
#      (developer mode — running from a cortex-x clone).
#   2) Installed: read $HOME/.claude/shared/cortex-source.yaml to find
#      cortex_source, then delegate to $cortex_source/bin/cortex-steward.cjs.
#
# Mirrors the bash shim (bin/cortex-steward). See that file for design notes.

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node is required but not found on PATH." -ForegroundColor Red
    Write-Host "  cortex-x's hooks and Steward runtime both require Node 22+." -ForegroundColor Red
    exit 1
}

$ScriptDir = $PSScriptRoot

# Strategy 1: repo-local
$RepoEntry = Join-Path $ScriptDir "cortex-steward.cjs"
$RepoStewardDir = Join-Path $ScriptDir "steward"
if ((Test-Path $RepoEntry) -and (Test-Path $RepoStewardDir)) {
    & node $RepoEntry @args
    exit $LASTEXITCODE
}

# Strategy 2: installed shim — read cortex-source.yaml
$SourceYaml = Join-Path $HOME ".claude\shared\cortex-source.yaml"
if (-not (Test-Path $SourceYaml)) {
    Write-Host "ERROR: cortex-x not installed (missing $SourceYaml)." -ForegroundColor Red
    Write-Host "  Run install.ps1 first, or invoke from a cortex-x clone." -ForegroundColor Red
    exit 1
}

# Flat-yaml parse — cortex_source: <path>. Strip CR, drop surrounding quotes.
$CortexSource = $null
foreach ($line in Get-Content $SourceYaml) {
    if ($line -match '^cortex_source:\s*(.*)$') {
        $CortexSource = $matches[1].Trim().TrimEnd("`r").Trim('"')
        break
    }
}

if (-not $CortexSource) {
    Write-Host "ERROR: cortex_source: missing in $SourceYaml." -ForegroundColor Red
    exit 1
}

$StewardEntry = Join-Path $CortexSource "bin\cortex-steward.cjs"
if (-not (Test-Path $StewardEntry)) {
    Write-Host "ERROR: $StewardEntry not found." -ForegroundColor Red
    Write-Host "  Re-run install.ps1, or fix cortex_source: in $SourceYaml." -ForegroundColor Red
    exit 1
}

& node $StewardEntry @args
exit $LASTEXITCODE
