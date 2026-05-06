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

# Force UTF-8 console output so non-ASCII strings (em-dash, čeština, français,
# español) render correctly on Windows PowerShell 5.1 — its default OEM codepage
# would otherwise mangle them. PS Core 7+ already defaults to UTF-8.
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }

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

# Skills already copied via "shared\*" above (shared/skills/ is the canonical
# location). Root-level skills/ is reserved for future top-level cortex-x skills
# and currently empty — no separate copy needed.

# Detectors directory — deterministic profile/stack/stage classifiers (auto-optimization).
# Read by session-start hook + cortex-doctor prompt. Fail-open contract.
$DetectorsSrc = Join-Path $CortexRoot "detectors"
if (Test-Path $DetectorsSrc) {
    Copy-Item -Recurse -Path $DetectorsSrc -Destination $SharedTarget -ErrorAction SilentlyContinue
}

# Record cortex-x source dir for {{cortex_source}} placeholder resolution at scaffold time.
# Templates reference installed assets via ~/.claude/shared/; dynamic user-data dirs (research,
# projects, insights, journal, evals) live in $CortexDataHome (default ~/.cortex).
#
# Sprint 1.6: introduce cortex_data_home — user-personal data NEVER inside cortex-x source repo.
# See MIGRATIONS.md Sprint 1.6 entry.
$CortexDataHome = if ($env:CORTEX_DATA_HOME) { $env:CORTEX_DATA_HOME } else { Join-Path $HOME ".cortex" }
foreach ($sub in @("research", "projects", "insights/proposals", "journal", "evals")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $CortexDataHome $sub) | Out-Null
}
@"
cortex_source: $CortexRoot
cortex_data_home: $CortexDataHome
"@ | Set-Content -Path (Join-Path $SharedTarget "cortex-source.yaml") -Encoding UTF8

# Write/update module.local.yaml with user preference (gitignored).
$ModuleLocal = Join-Path $CortexRoot "module.local.yaml"
@"
# Per-user override (gitignored). See module.yaml for defaults.
# Regenerated by install.ps1 — edit freely after install.
config:
  communication_language: $Language
"@ | Set-Content -Path $ModuleLocal -Encoding UTF8

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
# Files installed:
#   cortex-bootstrap        — bash shim (calls node)
#   cortex-bootstrap.ps1    — pwsh shim (calls node)
#   cortex-bootstrap.cjs    — actual Node implementation with arrow-key TUI
#   _lib/select.cjs         — zero-dep arrow-key select prompt utility
$BinTarget = Join-Path $SharedTarget "bin"
$BinLibTarget = Join-Path $BinTarget "_lib"
New-Item -ItemType Directory -Force -Path $BinTarget | Out-Null
New-Item -ItemType Directory -Force -Path $BinLibTarget | Out-Null

$BootstrapFiles = @(
    @{ Src = "bin/cortex-bootstrap";       Dst = "cortex-bootstrap" }
    @{ Src = "bin/cortex-bootstrap.ps1";   Dst = "cortex-bootstrap.ps1" }
    @{ Src = "bin/cortex-bootstrap.cjs";   Dst = "cortex-bootstrap.cjs" }
)
foreach ($f in $BootstrapFiles) {
    $srcPath = Join-Path $CortexRoot $f.Src
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination (Join-Path $BinTarget $f.Dst) -Force
    }
}

$LibSelectSrc = Join-Path $CortexRoot "bin/_lib/select.cjs"
if (Test-Path $LibSelectSrc) {
    Copy-Item -Path $LibSelectSrc -Destination (Join-Path $BinLibTarget "select.cjs") -Force
}

# Install user-level slash-skill /cortex-init at ~/.claude/skills/cortex-init/.
# This is the RECOMMENDED post-install entry point — user just opens claude in
# any project dir and types /cortex-init. The skill asks N/E/F via Claude's
# native AskUserQuestion tool, writes the marker, chains to /start or /audit.
$UserSkillsDir = Join-Path $ClaudeHome "skills/cortex-init"
New-Item -ItemType Directory -Force -Path $UserSkillsDir | Out-Null
$CortexInitSkillSrc = Join-Path $CortexRoot "shared/skills/cortex-init/SKILL.md"
if (Test-Path $CortexInitSkillSrc) {
    Copy-Item -Path $CortexInitSkillSrc -Destination (Join-Path $UserSkillsDir "SKILL.md") -Force
}

# Generate INSTALL_NOTES.md with all the verbose detail. Keep terminal output
# tight — users who want detail can read the file.
$InstallNotes = Join-Path $SharedTarget "INSTALL_NOTES.md"
$LangName = switch ($Language) {
    "cs" { "Czech (čeština)" }
    "de" { "German (Deutsch)" }
    "fr" { "French (français)" }
    "es" { "Spanish (español)" }
    default { "English" }
}
$Now = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
$NotesContent = @"
# cortex-x install notes

Generated by `install.ps1` on $Now.

- Source:    $CortexRoot
- Installed: $SharedTarget
- Channel:   $Channel
- Language:  $LangName (``$Language``)

## Hooks (in ``hooks/``)

| File | Event |
|---|---|
| ``block-destructive.cjs`` | PreToolUse matcher:Bash |
| ``session-start.cjs`` | SessionStart — sprint state, git context, budget surface, bootstrap-marker reader |
| ``pre-compact.cjs`` | PreCompact |
| ``pre-tool-use.cjs`` | PreToolUse all tools — journal companion |
| ``post-tool-use.cjs`` | PostToolUse all tools — journal + budget writer |
| ``auto-orchestrate.cjs`` | UserPromptSubmit — 3-fronta hint + budget warn |
| ``tirith-scan.cjs`` | SessionStart — optional, no-op if tirith binary absent |
| ``_lib/redact.cjs`` | Shared secret-scrubbing library |
| ``_lib/budget.cjs`` | Shared token-cost tracking library |

## Register hooks in ``~/.claude/settings.json``

``````json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node \"`$HOME/.claude/shared/hooks/block-destructive.cjs\"", "timeout": 5 }] },
    { "hooks": [{ "type": "command", "command": "node \"`$HOME/.claude/shared/hooks/pre-tool-use.cjs\"", "timeout": 3 }] }
  ],
  "PostToolUse": [
    { "hooks": [{ "type": "command", "command": "node \"`$HOME/.claude/shared/hooks/post-tool-use.cjs\"", "timeout": 5 }] }
  ],
  "UserPromptSubmit": [
    { "hooks": [{ "type": "command", "command": "node \"`$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"", "timeout": 3 }] }
  ],
  "SessionStart": [
    { "hooks": [{ "type": "command", "command": "node \"`$HOME/.claude/shared/hooks/session-start.cjs\"", "timeout": 5 }] }
  ]
}
``````

## Language preference (optional)

Add this block to ``~/.claude/CLAUDE.md`` so Claude responds in $LangName for cortex-x sessions:

``````markdown
<!-- BEGIN cortex-x — communication language -->
## cortex-x language
When working in a cortex-x-scaffolded project or invoking cortex-x prompts,
respond in: **$LangName** (code: ``$Language``). Never switch languages mid-reply.
<!-- END cortex-x -->
``````

cortex-x will not auto-edit your global ``~/.claude/CLAUDE.md`` (Principle 1 from standards/coding-behavior.md).

## Budget cap

Set ``CORTEX_SESSION_BUDGET_USD`` env var (default ``\$5.00``). Spend log: ``\$CORTEX_DATA_HOME/journal/.budget.jsonl``.
Set ``CORTEX_BUDGET_DISABLED=1`` to suppress budget output entirely (e.g. flat-subscription installs).

## Optional: Tirith (context-file prompt-injection scanner)

``````bash
cargo install tirith
# or download from https://github.com/NousResearch/tirith/releases
``````

``tirith-scan.cjs`` hook auto-detects once installed.

## Re-running

Re-run ``install.ps1`` after pulling cortex-x updates. Existing ``~/.claude/shared/`` is backed up to ``shared.backup-yyyyMMdd-HHmmss``. Only the most recent backup is kept.

## See also

- ``standards/ship-ready.md`` — ``CORTEX_HOME`` / ``CORTEX_CHANNEL`` semantics
- ``docs/sprint-1.5-design.md`` — onboarding architecture
- ``MIGRATIONS.md`` — pre-public-tag debt and version migrations
"@
$NotesContent | Set-Content -Path $InstallNotes -Encoding UTF8

# ── Post-copy verification — fail loudly if critical assets missing.
# Catches: partial copies (network/perm), stale source repo state, file-locking,
# bugs in Copy-Item expansion. Runs ALL checks before exiting so the user sees
# the full failure surface, not just the first miss.
$VerifyOk = $true
function Test-Required-File {
    param([string]$Path)
    if (-not (Test-Path $Path -PathType Leaf)) {
        Write-Host "  $([char]0x2717) MISSING file: $Path" -ForegroundColor Red
        $script:VerifyOk = $false
    }
}
function Test-Required-Count {
    param([string]$Dir, [int]$Min, [string]$Label)
    if (-not (Test-Path $Dir -PathType Container)) {
        Write-Host "  $([char]0x2717) MISSING dir: $Dir" -ForegroundColor Red
        $script:VerifyOk = $false
        return
    }
    $actual = (Get-ChildItem -Path $Dir -Force | Measure-Object).Count
    if ($actual -lt $Min) {
        Write-Host "  $([char]0x2717) ${Label}: $actual items in $Dir (expected $([char]0x2265) $Min)" -ForegroundColor Red
        $script:VerifyOk = $false
    }
}
Test-Required-File (Join-Path $SharedTarget "cortex-source.yaml")
Test-Required-File (Join-Path $SharedTarget "prompts/new-project.md")
Test-Required-File (Join-Path $SharedTarget "prompts/existing-project-audit.md")
Test-Required-File (Join-Path $SharedTarget "prompts/cortex-doctor.md")
Test-Required-File (Join-Path $SharedTarget "skills/cortex-init/SKILL.md")
Test-Required-File (Join-Path $ClaudeHome "skills/cortex-init/SKILL.md")
Test-Required-File (Join-Path $SharedTarget "standards/RULE-1.md")
Test-Required-File (Join-Path $SharedTarget "agents/synthesizer.md")
Test-Required-File (Join-Path $SharedTarget "agents/planner.md")
Test-Required-File (Join-Path $SharedTarget "hooks/session-start.cjs")
Test-Required-Count (Join-Path $SharedTarget "standards") 20 "standards"
Test-Required-Count (Join-Path $SharedTarget "prompts")   10 "prompts"
Test-Required-Count (Join-Path $SharedTarget "agents")     5 "agents"
Test-Required-Count (Join-Path $SharedTarget "hooks")      5 "hooks"
Test-Required-Count (Join-Path $SharedTarget "skills")     3 "skills"

# Sprint 1.6: verify CORTEX_DATA_HOME structure exists (5 user-data dirs).
function Test-Required-Dir {
    param([string]$Path)
    if (-not (Test-Path $Path -PathType Container)) {
        Write-Host "  $([char]0x2717) MISSING dir: $Path" -ForegroundColor Red
        $script:VerifyOk = $false
    }
}
Test-Required-Dir (Join-Path $CortexDataHome "research")
Test-Required-Dir (Join-Path $CortexDataHome "projects")
Test-Required-Dir (Join-Path $CortexDataHome "insights/proposals")
Test-Required-Dir (Join-Path $CortexDataHome "journal")
Test-Required-Dir (Join-Path $CortexDataHome "evals")

if (-not $VerifyOk) {
    Write-Host ""
    Write-Host "  $([char]0x2717) Install verification FAILED. Critical assets are missing above." -ForegroundColor Red
    Write-Host "    Try: re-run install.ps1, or open an issue at" -ForegroundColor Red
    Write-Host "         https://github.com/Rejnyx/cortex-x/issues" -ForegroundColor Red
    exit 1
}

# Compact final summary — model: Bun, uv, Rustup. Detail in INSTALL_NOTES.md.
$BinDir = Join-Path $SharedTarget "bin"
$PathEntries = $env:PATH -split [IO.Path]::PathSeparator
$PathHasBin = $PathEntries -contains $BinDir

Write-Host ""
Write-Host "  ✓ cortex-x installed"
Write-Host "    framework  ~/.claude/shared/      (hooks · agents · prompts · skills · standards)"
Write-Host "    skill      ~/.claude/skills/cortex-init/  (RECOMMENDED entry point)"
Write-Host "    user data  $CortexDataHome/      (research · projects · insights · journal · evals)"
Write-Host "    bootstrap  ~/.claude/shared/bin/cortex-bootstrap"
Write-Host "    language   $LangName ($Language)"
Write-Host "    notes      $InstallNotes"
Write-Host ""
Write-Host "  Next step (recommended) — open Claude Code in any project dir:"
Write-Host ""
Write-Host "    claude"
Write-Host "    /cortex-init"
Write-Host ""
Write-Host "  ↳ /cortex-init asks New / Existing / Framework-only via arrow keys,"
Write-Host "    writes the marker, chains to the right cortex-x workflow."
Write-Host ""
Write-Host "  Shell-only alternative (power users / scripts):"
if ($PathHasBin) {
    Write-Host "    cortex-bootstrap     # already on PATH"
} else {
    Write-Host "    & '$BinDir\cortex-bootstrap.ps1'"
    Write-Host ""
    Write-Host "  Add bin/ to PATH (one-time, optional):"
    Write-Host "    Add-Content `$PROFILE '`$env:PATH = `"$BinDir;`" + `$env:PATH'"
}
Write-Host ""
