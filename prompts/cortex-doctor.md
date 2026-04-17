# Cortex Doctor — Self-Healthcheck

> **How to use:** Paste when cortex-x feels broken, after system migration, or weekly as sanity check. Claude diagnoses cortex-x installation and suggests fixes.

---

## Your task

Run a systematic healthcheck of Dave's cortex-x setup. Identify what's missing, broken, or drifted. Report with actionable fixes.

## Check matrix

### 1. Installation integrity

- [ ] `~/cortex-x/` or `~/Desktop/APPs/cortex-x/` exists
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

### 9. Research cache hygiene

- [ ] `research/` directory exists
- [ ] No research file older than 6 months (research rots)

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

### 12. Audit scheduling

- [ ] `docs/3-month-audit.md` exists
- [ ] Audit date is in future (not overdue)
- [ ] If overdue: 🟡 suggest running audit NOW

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
- ❌ Auto-fixing without asking (show fixes, let Dave decide)
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
