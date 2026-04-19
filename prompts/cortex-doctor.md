# Cortex Doctor — Self-Healthcheck

> **How to use:** Paste when cortex-x feels broken, after system migration, or weekly as sanity check. Claude diagnoses cortex-x installation and suggests fixes.

---

## Your task

Run a systematic healthcheck of the user's cortex-x setup. Identify what's missing, broken, or drifted. Report with actionable fixes.

## Check matrix

### 1. Installation integrity

- [ ] `$CORTEX_HOME` (default `~/cortex-x/` or `~/.cortex-x/`) exists
- [ ] `cortex-x/shared/hooks/block-destructive.cjs` exists
- [ ] `cortex-x/shared/hooks/session-start.cjs` exists
- [ ] `cortex-x/shared/hooks/pre-compact.cjs` exists
- [ ] `~/.claude/shared/hooks/*` are synced from cortex-x (copies or symlinks)
- [ ] `~/.claude/settings.json` has global hooks registered
- [ ] `~/.claude/CLAUDE.md` references cortex-x

**If missing:** run `~/cortex-x/install.sh` or `install.ps1`.

### 2. Profiles health

```bash
ls ~/cortex-x/profiles/*.yaml
```

- [ ] At least `nextjs-saas.yaml` + `minimal.yaml` present
- [ ] Each profile has valid YAML (no syntax errors)
- [ ] Each profile has required keys: `name`, `stack`, `structure`, `agents`

**If broken:** report which profile, which key missing.

### 3. Standards accessibility

- [ ] `cortex-x/standards/README.md` exists
- [ ] All 11 standards present (or documented as intentionally removed in 3-month audit)
- [ ] No standards file is empty

### 4. Prompts health

- [ ] `prompts/new-project.md` exists and has Discovery + Research + Scaffold phases
- [ ] `prompts/project-scan.md` uses slim 5-section schema (post-SSOT fix)
- [ ] `prompts/cortex-load.md` has mental model cheat sheet
- [ ] `prompts/code-review.md` exists
- [ ] `prompts/cortex-doctor.md` exists (meta — this file)

### 5. Agents registration

- [ ] `agents/cortex-thinker.md` (meta-reflection)
- [ ] `agents/blind-hunter.md` (review)
- [ ] `agents/edge-case-hunter.md` (review)
- [ ] `agents/acceptance-auditor.md` (review)
- [ ] `agents/security-auditor.md` (review)
- [ ] `agents/ssot-enforcer.md` (review)

### 6. Git state

```bash
cd ~/cortex-x && git status
```

- [ ] No uncommitted changes (or intentional WIP)
- [ ] Remote origin set to `github.com/Rejnyx/cortex-x`
- [ ] Behind main? (suggest `git pull`)

### 7. Projects library freshness

```bash
ls -la ~/cortex-x/projects/
```

- [ ] At least 1 project scanned
- [ ] No project file is older than 90 days (suggest re-scan)
- [ ] Scan version >= 2 (post-SSOT fix)

### 8. Insights hygiene

- [ ] `insights/` directory exists
- [ ] If insights/ has files, they have required frontmatter (date, project, confidence, type)
- [ ] No orphaned insights (referencing deleted projects)

### 9. Research cache hygiene (TTL per topic)

- [ ] `research/` directory exists
- [ ] Every research file respects its per-topic TTL (see [`standards/auto-orchestration.md`](../standards/auto-orchestration.md) § Research cache TTL):
  - Hot frameworks (Next, React, Vercel, AI SDKs, Supabase, Tailwind, shadcn, Astro, Tone) → **30 days**
  - Specific APIs that deprecate often → 60 days
  - Regulations (tax, GDPR, HIPAA, legal, compliance) → 180 days
  - Architecture patterns / design principles → 365 days
  - Default / unclassified → 180 days
- [ ] Frontmatter `ttl_days: N` override is respected when present
- [ ] No file older than its effective TTL (warn, don't critical)

**Auto-prune action (when stale research found):**
Research files older than 6 months are archived, not silently kept. Run:

```bash
# macOS/Linux
find "$CORTEX_HOME/research" -maxdepth 1 -name '*.md' -type f -mtime +180 \
  -exec sh -c 'mkdir -p "$(dirname "$1")/archive/$(date -r "$1" +%Y)" && mv "$1" "$(dirname "$1")/archive/$(date -r "$1" +%Y)/"' _ {} \;

# Windows PowerShell
Get-ChildItem "$env:CORTEX_HOME\research\*.md" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-180) } | ForEach-Object {
  $year = $_.LastWriteTime.Year
  $dst = Join-Path $_.DirectoryName "archive\$year"
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  Move-Item $_.FullName $dst
}
```

Archive (not delete) because stale research still has historical value for `cortex-reflect` / `cortex-evolve` retrospectives — just shouldn't be cited as current in new scaffolds. Doctor prompts user before running the prune (never silent delete).

### 10. Session-start hook liveness

Run a test: check if `node ~/cortex-x/shared/hooks/session-start.cjs` outputs valid JSON when run from any project directory.

- [ ] Hook executes without error
- [ ] Output is valid JSON with `hookSpecificOutput` field
- [ ] Hook detects cortex-x presence and mentions it

### 11. Cross-platform compatibility

- [ ] `.gitattributes` has LF for `.sh` and CRLF for `.ps1`
- [ ] `install.sh` exists
- [ ] `install.ps1` exists
- [ ] No hardcoded paths (should use `os.homedir()`, `$HOME`, `$PSScriptRoot`)

### 12. Scaffolded project cross-refs resolve

For each scaffolded project's `CLAUDE.md` (discoverable via `git log`/user-told paths), verify that every `~/.claude/shared/...` and `<cortex_source>/...` path reference actually resolves on disk. Old scaffolds from before the 2026-04-19 path-fix may contain `~/cortex-x/` refs that are **broken** (that path never existed on the filesystem).

**How to check (for a given project path `$P`):**
```bash
# 1. Extract path refs from the scaffolded CLAUDE.md
grep -oE '(~/\.claude/shared/[^`]+|~/cortex-x/[^`]+)' "$P/CLAUDE.md" | sort -u

# 2. For each, resolve and test existence.
#    `~/cortex-x/...` = known-broken → flag for re-render.
#    `~/.claude/shared/...` = should exist after install.
```

- [ ] No scaffolded `CLAUDE.md` contains `~/cortex-x/` (legacy broken prefix)
- [ ] All `~/.claude/shared/*` refs resolve (warn if missing → suggest `install.sh`)
- [ ] All absolute-path refs to source dirs exist (warn if dir moved → suggest re-anchor)

**Fix when broken:** re-render scaffolded `CLAUDE.md` from current template with project-specific data preserved (or patch in-place — Claude can do section-by-section Edit).

### 13. Audit scheduling

- [ ] `docs/3-month-audit.md` exists
- [ ] Audit date is in future (not overdue)
- [ ] If overdue: 🟡 suggest running audit NOW

**Note — renumbering:** pre-2026-04-19 the Audit scheduling section was #12. Now #13 (#12 is Scaffolded project cross-refs). Reports from older doctor runs may show the old numbering; treat as informational.

## Output format

```markdown
# cortex-x Health Report — <date>

## Summary

- ✅ <X> checks passed
- 🟡 <Y> warnings
- 🔴 <Z> critical issues

## Passed ✅

<list of passing checks, brief>

## Warnings 🟡

### <category>
**Issue:** <what's wrong>
**Impact:** <why it matters>
**Fix:** <concrete action>

## Critical 🔴

### <category>
**Issue:** <critical problem>
**Impact:** cortex-x may not work correctly
**Fix:** <immediate action>

## Recommendations

1. <priority action 1>
2. <priority action 2>

## Statistics

- Total files: <count>
- Scanned projects: <count>
- Active insights: <count>
- Last audit: <date or "never">
- Last cortex-sync: <derived from git log>

## Next audit due

`docs/3-month-audit.md` scheduled: <date>
- If <30 days away: plan it
- If overdue: run it TODAY

## Overall verdict

- 🟢 **Healthy** — no issues, ship it
- 🟡 **Needs attention** — <N> warnings, not blocking
- 🔴 **Broken** — <N> critical, fix before using cortex-x
```

## Rules

- **Check, don't lecture.** Report findings, don't explain why SSOT matters.
- **Actionable fixes.** Every issue has a concrete "run this command" or "edit this file".
- **Severity matters.** Missing hook = critical. Outdated research = warning.
- **Honest count.** If there are 12 warnings, list all 12. Don't hide.

## Anti-patterns

- ❌ Running doctor every session (check occasionally)
- ❌ Auto-fixing without asking (show fixes, let the user decide)
- ❌ Philosophical "consider improvements" (concrete or omit)

## When to run

- **Weekly** — sanity check
- **After system migration** (new laptop, new OS)
- **After major cortex-x update** (pull from GitHub)
- **When cortex-x feels broken** (something's off)
- **Before sharing with a friend** (ensure clean state)

## Self-diagnostic

Doctor should diagnose itself too:
- Is `prompts/cortex-doctor.md` (this file) up to date with recent cortex-x changes?
- Are there new check categories I'm missing?

Add `META` section to report if self-check finds gaps.
