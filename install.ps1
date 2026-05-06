# cortex-x installer (PowerShell)
# Installs shared framework to ~/.claude/ for global use across projects.
#
# Two execution modes:
#
#   1) iwr | iex (recommended for fresh users):
#        iwr https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex
#      The script self-detects pipe execution and clones cortex-x to ~/cortex-x
#      (or $env:CORTEX_HOME), then re-executes the local install.ps1.
#
#   2) Local execution (after manual git clone):
#        git clone https://github.com/Rejnyx/cortex-x ~/cortex-x
#        ~/cortex-x/install.ps1
#      Standard install path; copies framework assets to ~/.claude/shared/.
#
# Env vars honored (see standards/ship-ready.md):
#   $env:CORTEX_CHANNEL = 'beta' | 'stable'  — beta = track main HEAD (default);
#                                              stable = checkout highest semver tag.
#   $env:CORTEX_HOME    = <path>             — override cortex-x source directory.
#   $env:CORTEX_NO_UPDATE = '1'              — skip checkout even if CHANNEL=stable.

$ErrorActionPreference = "Stop"

# Stream detection — when invoked via `iwr | iex`, $PSScriptRoot is empty
# because there is no script file on disk. Self-clone the repo first, then
# re-execute the local install.ps1 from the clone. Same pattern as the
# bash install.sh self-clone block; matches Bun, Deno, Rustup install UX.
if (-not $PSScriptRoot -or -not (Test-Path $PSScriptRoot)) {
    $CortexCloneDir = if ($env:CORTEX_HOME) { $env:CORTEX_HOME } else { Join-Path $HOME "cortex-x" }
    Write-Host "cortex-x bootstrap (iwr | iex mode)"
    Write-Host "  source: https://github.com/Rejnyx/cortex-x"
    Write-Host "  clone:  $CortexCloneDir"
    Write-Host ""
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: git is required but not found on PATH." -ForegroundColor Red
        Write-Host "  Install git first, then re-run." -ForegroundColor Red
        exit 1
    }
    $ExistingGitDir = Join-Path $CortexCloneDir ".git"
    if (Test-Path $ExistingGitDir) {
        Write-Host "  existing clone found — fetching origin/main"
        Push-Location $CortexCloneDir
        try {
            git diff --quiet 2>$null
            $unstaged = $LASTEXITCODE -ne 0
            git diff --cached --quiet 2>$null
            $staged = $LASTEXITCODE -ne 0
            if (-not $unstaged -and -not $staged) {
                git fetch --quiet origin main 2>$null
                git checkout --quiet main 2>$null
                git pull --ff-only --quiet origin main 2>$null
            } else {
                Write-Host "  local changes detected in $CortexCloneDir — skipping update"
                Write-Host "  to manually update: cd $CortexCloneDir; git pull --ff-only origin main"
            }
        } finally {
            Pop-Location
        }
    } else {
        $ParentDir = Split-Path -Parent $CortexCloneDir
        if ($ParentDir -and -not (Test-Path $ParentDir)) {
            New-Item -ItemType Directory -Force -Path $ParentDir | Out-Null
        }
        # Clone strategy: anonymous HTTPS first (works for public repos), then
        # GITHUB_TOKEN-authenticated HTTPS, then gh-cli for private-repo
        # closed-beta access.
        $cloned = $false
        git clone --quiet https://github.com/Rejnyx/cortex-x $CortexCloneDir 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  cloned successfully (public)"
            $cloned = $true
        } elseif ($env:GITHUB_TOKEN) {
            git clone --quiet "https://x-access-token:$($env:GITHUB_TOKEN)@github.com/Rejnyx/cortex-x" $CortexCloneDir 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  cloned successfully (GITHUB_TOKEN)"
                $cloned = $true
            }
        }
        if (-not $cloned -and (Get-Command gh -ErrorAction SilentlyContinue)) {
            gh auth status 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                gh repo clone Rejnyx/cortex-x $CortexCloneDir -- --quiet 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  cloned successfully (gh-cli)"
                    $cloned = $true
                }
            }
        }
        if (-not $cloned) {
            Write-Host "ERROR: git clone failed." -ForegroundColor Red
            Write-Host "  If cortex-x is still in closed beta, you need either:" -ForegroundColor Red
            Write-Host "    1) gh CLI authenticated:  gh auth login" -ForegroundColor Red
            Write-Host "    2) a GITHUB_TOKEN env var with read access to Rejnyx/cortex-x" -ForegroundColor Red
            Write-Host "  Then re-run this installer." -ForegroundColor Red
            exit 1
        }
    }
    $LocalInstaller = Join-Path $CortexCloneDir "install.ps1"
    Write-Host "  re-executing $LocalInstaller"
    Write-Host "============================================================"
    & $LocalInstaller
    exit $LASTEXITCODE
}

# Resolve cortex-x source directory.
if ($env:CORTEX_HOME -and (Test-Path $env:CORTEX_HOME)) {
    $CortexRoot = $env:CORTEX_HOME
} else {
    $CortexRoot = $PSScriptRoot
}
$ClaudeHome   = Join-Path $HOME ".claude"
$SharedTarget = Join-Path $ClaudeHome "shared"
$Channel      = if ($env:CORTEX_CHANNEL) { $env:CORTEX_CHANNEL } else { "beta" }

# Language preference — interactive prompt unless $env:CORTEX_LANGUAGE is set.
$Language = $env:CORTEX_LANGUAGE
if (-not $Language -and [Environment]::UserInteractive) {
    Write-Host "Communication language for Claude in cortex-x sessions?"
    Write-Host "  en  — English (default)"
    Write-Host "  cs  — Czech (čeština)"
    Write-Host "  de  — German (Deutsch)"
    Write-Host "  fr  — French (français)"
    Write-Host "  es  — Spanish (español)"
    $Language = Read-Host "Language code [en]"
}
if (-not $Language) { $Language = "en" }

Write-Host "cortex-x installer"
Write-Host "  from:     $CortexRoot"
Write-Host "  to:       $SharedTarget"
Write-Host "  channel:  $Channel"
Write-Host "  language: $Language"
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
    # Rotate: keep only the most recent backup. The cortex-x source repo at
    # $CortexRoot (with full git history + remote) is the canonical backup;
    # this snapshot is just last-install rollback safety, not deep history.
    # Without rotation these accumulate forever and pollute ~/.claude/ git status
    # (10 backups x ~74 files = 700+ untracked observed in field 2026-05-01).
    Get-ChildItem -Path $ClaudeHome -Directory -Filter 'shared.backup-*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 1 |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Path $SharedTarget -Force | Out-Null

# Copy shared content (hooks, skills, standards, templates, profiles, prompts, review agents)
Copy-Item -Recurse -Path (Join-Path $CortexRoot "shared\*") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "standards") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "templates") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "profiles") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "prompts") -Destination $SharedTarget
Copy-Item -Recurse -Path (Join-Path $CortexRoot "agents") -Destination $SharedTarget

# Skills directory — agentskills.io-compatible SKILL.md files.
# Only copy if source exists (cortex-x Phase 2 may scaffold these later).
$SkillsSrc = Join-Path $CortexRoot "skills"
if (Test-Path $SkillsSrc) {
    Copy-Item -Recurse -Path $SkillsSrc -Destination $SharedTarget -ErrorAction SilentlyContinue
}

# Detectors directory — deterministic profile/stack/stage classifiers (auto-optimization).
# Read by session-start hook + cortex-doctor prompt. Fail-open contract.
$DetectorsSrc = Join-Path $CortexRoot "detectors"
if (Test-Path $DetectorsSrc) {
    Copy-Item -Recurse -Path $DetectorsSrc -Destination $SharedTarget -ErrorAction SilentlyContinue
}

# Record cortex-x source dir for {{cortex_source}} placeholder resolution at scaffold time.
# Templates reference installed assets via ~/.claude/shared/; dynamic dirs (projects/, research/)
# stay in source and need an absolute path baked into scaffolded files.
"cortex_source: $CortexRoot" | Set-Content -Path (Join-Path $SharedTarget "cortex-source.yaml") -Encoding UTF8

Write-Host "Done."
Write-Host ""

# Write/update module.local.yaml with user preference (gitignored)
$ModuleLocal = Join-Path $CortexRoot "module.local.yaml"
@"
# Per-user override (gitignored). See module.yaml for defaults.
# Regenerated by install.ps1 — edit freely after install.
config:
  communication_language: $Language
"@ | Set-Content -Path $ModuleLocal -Encoding UTF8
Write-Host "Wrote user prefs to: $ModuleLocal (gitignored)"

# Print directive for user to add to ~/.claude/CLAUDE.md
# (don't auto-edit user's global file — Principle 1 from coding-behavior.md)
$LangName = switch ($Language) {
    "cs" { "Czech (čeština)" }
    "de" { "German (Deutsch)" }
    "fr" { "French (français)" }
    "es" { "Spanish (español)" }
    default { "English" }
}
Write-Host ""
Write-Host "To enforce the language preference, add this block to ~/.claude/CLAUDE.md:"
Write-Host ""
Write-Host "---"
Write-Host "<!-- BEGIN cortex-x — communication language -->"
Write-Host "## cortex-x language"
Write-Host "When working in a cortex-x-scaffolded project or invoking cortex-x prompts,"
Write-Host "respond in: **$LangName** (code: $Language). Never switch languages mid-reply."
Write-Host "<!-- END cortex-x -->"
Write-Host "---"
Write-Host ""

# Install cortex-bootstrap helper to ~/.claude/shared/bin/ (per-project mode selector).
$BinTarget = Join-Path $SharedTarget "bin"
New-Item -ItemType Directory -Force -Path $BinTarget | Out-Null
$BootstrapPs = Join-Path $CortexRoot "bin/cortex-bootstrap.ps1"
$BootstrapSh = Join-Path $CortexRoot "bin/cortex-bootstrap"
if (Test-Path $BootstrapPs) {
    Copy-Item -Path $BootstrapPs -Destination (Join-Path $BinTarget "cortex-bootstrap.ps1") -Force
}
if (Test-Path $BootstrapSh) {
    Copy-Item -Path $BootstrapSh -Destination (Join-Path $BinTarget "cortex-bootstrap") -Force
}

Write-Host ""
Write-Host "============================================================"
Write-Host "cortex-bootstrap helper installed to: $BinTarget"
Write-Host ""
Write-Host "NEXT STEP -- go to your TARGET project directory and run:"
Write-Host ""
Write-Host "  & '$BinTarget\cortex-bootstrap.ps1'"
Write-Host ""
Write-Host "It asks:  [N]ew / [E]xisting / [F]ramework-only -- writes a one-shot"
Write-Host "marker file. Then 'claude' in the same dir auto-primes the right skill"
Write-Host "(/start for new, /audit for existing). Marker has 1h TTL."
Write-Host ""
Write-Host "Add to PATH for convenience (in `$PROFILE):"
Write-Host "  `$env:PATH = `"`$HOME\.claude\shared\bin;`$env:PATH`""
Write-Host "============================================================"
Write-Host ""

Write-Host "Hooks copied to ~/.claude/shared/hooks/:"
Write-Host "  block-destructive.cjs   (PreToolUse matcher:Bash)"
Write-Host "  session-start.cjs       (SessionStart — also surfaces recent budget)"
Write-Host "  pre-compact.cjs         (PreCompact)"
Write-Host "  pre-tool-use.cjs        (PreToolUse all tools — journal companion)"
Write-Host "  post-tool-use.cjs       (PostToolUse all tools — journal + budget writer)"
Write-Host "  auto-orchestrate.cjs    (UserPromptSubmit — 3-fronta hint + budget warn)"
Write-Host "  tirith-scan.cjs         (SessionStart — optional, no-op if tirith binary absent)"
Write-Host "  _lib/redact.cjs         (shared secret-scrubbing library)"
Write-Host "  _lib/budget.cjs         (shared token-cost tracking library)"

# Optional Tirith detection hint — context-file prompt-injection scanner from Hermes Agent stack (MIT).
$tirithCheck = Get-Command tirith -ErrorAction SilentlyContinue
if (-not $tirithCheck) {
    Write-Host ""
    Write-Host "Optional: install Tirith (https://tirith.sh/) for context-file prompt-injection scanning:"
    Write-Host "  cargo install tirith"
    Write-Host "  # or download from https://github.com/NousResearch/tirith/releases"
    Write-Host "tirith-scan.cjs hook will auto-detect once installed. Skip if not doing agentic work."
}
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
  ],
  "UserPromptSubmit": [
    { "hooks": [{"type":"command","command":"node \"$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"","timeout":3}] }
  ]
'@ | Write-Host
Write-Host ""
Write-Host "Budget cap: set CORTEX_SESSION_BUDGET_USD (default `$5.00). Spend log: `$CORTEX_HOME/journal/.budget.jsonl"
Write-Host ""
Write-Host "Journal will be written to: $CortexRoot/journal/YYYY-MM-DD-<project-slug>.jsonl"
Write-Host "See journal/README.md for schema + privacy contract."
Write-Host "See standards/ship-ready.md for CORTEX_HOME / CORTEX_CHANNEL semantics."

# Final PATH-add advice — surface this AFTER all the hook detail so it's the
# last thing the user sees. PowerShell profile location varies by host.
Write-Host ""
Write-Host "============================================================"
Write-Host "FINAL STEP -- add cortex-bootstrap to your PATH"
Write-Host "============================================================"
$BinDir = Join-Path $SharedTarget "bin"
$PathEntries = $env:PATH -split [IO.Path]::PathSeparator
if ($PathEntries -contains $BinDir) {
    Write-Host "PATH already contains $BinDir -- you're set."
} else {
    Write-Host "Run this once to add bin/ to PATH (in PowerShell `$PROFILE):"
    Write-Host ""
    Write-Host "  Add-Content `$PROFILE '`$env:PATH = `"$BinDir;`" + `$env:PATH'"
    Write-Host "  . `$PROFILE   # or open a new PowerShell window"
    Write-Host ""
    Write-Host "If `$PROFILE doesn't exist yet:"
    Write-Host "  New-Item -ItemType File -Path `$PROFILE -Force"
}
Write-Host ""
Write-Host "Then per-project:"
Write-Host "  Set-Location ~\your-project"
Write-Host "  cortex-bootstrap     # interactive [N]ew / [E]xisting / [F]ramework"
Write-Host "  claude               # auto-primes /start (new) or /audit (existing)"
Write-Host "============================================================"
