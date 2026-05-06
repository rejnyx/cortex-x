# Cortex Doctor — Self-Healthcheck + Drift Detection

> **How to use:** Paste when cortex-x feels broken, after system migration, weekly as sanity check, OR when you want to know **if the project has outgrown its scaffold profile** and should be upgraded. Claude runs the deterministic detectors, compares current state vs originally scaffolded profile, surfaces drift + upgrade options.

## Part 0 — Drift detection (NEW 2026-04-20)

**Run this FIRST** — before the installation-integrity section below. Takes <1s.

### 0.1 Deterministic scan

Spawn a silent check:

```bash
node ~/.claude/shared/detectors/detect-profile.cjs --json
node ~/.claude/shared/detectors/detect-stage.cjs --json
```

Read the JSON outputs. You now have:
- `currentProfile.top.name` + `score` + `confidence`
- `currentStage.stage` + `evidence` + `suggestions`

### 0.2 Compare with scaffolded profile (SSOT for intent)

Look up the project's scaffolded profile from `$CORTEX_DATA_HOME/projects/<slug>.md` frontmatter (this file is written at scaffold time by `new-project.md` §4.5).

Three possible states:

**✅ No drift** (currentProfile.name === scaffolded.profile AND confidence ≥0.8):
- Report "Project matches scaffolded profile. No drift."
- Optionally surface stage upgrade suggestions (e.g., "you're in MVP stage, consider adding eval suite")

**🟡 Drift detected** (currentProfile.name !== scaffolded.profile AND currentProfile.confidence ≥0.8):
- Report: "Scaffolded as `<scaffolded.profile>` on `<date>`, project now looks like `<currentProfile.name>` (confidence `<score>`)."
- List evidence for the drift (new deps, new folder patterns)
- Propose upgrade: "Want to apply `<new profile>`? This adds: `<diff summary — new agents, new standards, new hooks>`"
- Wait for `y`/`n`. On `y`, apply additively (never overwrite user code) — same contract as `retrofit.md` (non-destructive).

**🟠 Ambiguous state** (confidence <0.6):
- Report: "Unclear profile — candidates: `<top 3 with scores>`"
- Ask user: "What are you building now? Pick from: `<top 3>` or type a different profile name."

### 0.3 Stage-based upgrade suggestions

After profile resolution, surface upgrade suggestions from `currentStage.suggestions` — but **filter to relevant-only**:

- Skip suggestions the project has already adopted (detectable via signals)
- Order by blast-radius of the gap (monitoring > tests > memory system)
- Cap at 3 top suggestions to avoid noise

Example output:
```
Stage: mvp (127 commits, tests:yes, ci:yes)
Suggested upgrades (2):
  • add evals/ directory — new cortex-x correctness.md pillar (2026-04-20)
  • add monitoring (observability.md § Runtime SLOs)
```

### 0.4 Detector health sanity

If `detect-profile.cjs` itself failed or returned `elapsed_ms > 200`, note it:
- "Detectors took 247ms — investigate (profile YAML malformed?)"
- "`detect-profile.cjs` not installed — re-run `install.ps1` / `install.sh`"

Never block on detector failure — it's augmentation, not a blocker.

---

## Part 1 — Installation integrity (existing flow)

> **How to use:** Paste when cortex-x feels broken, after system migration, or weekly as sanity check. Claude diagnoses cortex-x installation and suggests fixes.

---

## Your task

Run a systematic healthcheck of the user's cortex-x setup. Identify what's missing, broken, or drifted. Report with actionable fixes.

## Check matrix

### 1. Installation integrity

Run this **first** — it's the most common failure mode. The install scripts copy
~150 files from `$CORTEX_HOME/` to `~/.claude/shared/` and `~/.claude/skills/`.
A partial copy (network/perm/locking) leaves `/cortex-init` broken in subtle ways
that look like skill-discovery bugs but are install regressions.

**Source repo (`$CORTEX_HOME` defaults to `~/cortex-x/` or `~/.cortex-x/`):**
- [ ] `$CORTEX_HOME` exists and contains `install.sh` + `install.ps1`
- [ ] `$CORTEX_HOME/shared/hooks/{block-destructive,session-start,pre-compact}.cjs` exist
- [ ] `$CORTEX_HOME/shared/skills/cortex-init/SKILL.md` exists (source of user-skill)

**Installed assets (`~/.claude/shared/`):**
- [ ] `~/.claude/shared/cortex-source.yaml` exists (records source repo path)
- [ ] `~/.claude/shared/hooks/{block-destructive,session-start,pre-compact}.cjs` synced
- [ ] `~/.claude/shared/prompts/{new-project,existing-project-audit,cortex-doctor}.md` exist
- [ ] `~/.claude/shared/standards/RULE-1.md` exists
- [ ] `~/.claude/shared/agents/{synthesizer,planner}.md` exist (Phase 5 Adapt prerequisites)
- [ ] `~/.claude/shared/skills/{cortex-init,start,audit}/SKILL.md` all three present
- [ ] `~/.claude/shared/bin/cortex-bootstrap{,.cjs,.ps1}` + `_lib/select.cjs` present

**User-level slash-skill (RECOMMENDED entry point — most-fragile install step):**
- [ ] `~/.claude/skills/cortex-init/SKILL.md` exists (auto-discovered by Claude Code)
  > ⚠ If missing, `/cortex-init` will silently fall through to default behavior.
  > This was the root cause of the 2026-05-06 field-test failure.

**User-level default agents (Claude Code discovers from `~/.claude/agents/`):**
- [ ] `~/.claude/agents/` exists with ≥ 5 `*.md` files
- [ ] `~/.claude/agents/blind-hunter.md` + `security-auditor.md` + `cortex-thinker.md` present
  > ⚠ If missing, every cortex-x project has empty default adversarial pipeline at runtime.
  > `~/.claude/shared/agents/` (cortex-x staging) is NOT in Claude Code's discovery path —
  > the user-level copy is mandatory. Field-test #5 (2026-05-07) caught this: scaffolded
  > project's `.claude/agents/` had only the 1 synthesized agent, defaults invisible.

**Asset count gates** (catch partial-copy regressions):
- [ ] `~/.claude/shared/standards/` has ≥ 20 files
- [ ] `~/.claude/shared/prompts/` has ≥ 10 files
- [ ] `~/.claude/shared/agents/` has ≥ 5 files
- [ ] `~/.claude/shared/hooks/` has ≥ 5 files
- [ ] `~/.claude/shared/skills/` has ≥ 3 directories

**Settings + CLAUDE.md wiring:**
- [ ] `~/.claude/settings.json` has global hooks registered
- [ ] `~/.claude/CLAUDE.md` references cortex-x

**install.ps1 sanity (Windows-only):**
- [ ] First 3 bytes of `$CORTEX_HOME/install.ps1` are UTF-8 BOM (`EF BB BF`) — Windows PowerShell 5.1 misreads non-ASCII without BOM and breaks the parser.

**If anything missing:** run `$CORTEX_HOME/install.sh` or `install.ps1`. Both have a built-in verification block that fails loudly with the missing list.

### 2. Profiles health

```bash
ls ~/.claude/shared/profiles/*.yaml
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
ls -la $CORTEX_DATA_HOME/projects/
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
find "$CORTEX_DATA_HOME/research" -maxdepth 1 -name '*.md' -type f -mtime +180 \
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

Run a test: check if `node ~/.claude/shared/shared/hooks/session-start.cjs` outputs valid JSON when run from any project directory.

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

### 14. Three-hop citation drift (NEW 2026-05-06)

This check enforces the SSOT-extension rule from `docs/sprint-1.5-design.md` §10: every claim in `CLAUDE.md` § "Stack reality check" or `cortex/recommendations.md` MUST trace through three hops:

1. **Claim** in synthesized doc (CLAUDE.md or cortex/recommendations.md)
2. → **Finding ID** in raw research file (matched by topic name from planner output)
3. → **Source URL** in the finding (HTTP-fetchable; HEAD-verify)

Procedure for each scaffolded project's `CLAUDE.md` (discoverable via `git log` / user-told paths):

```
For each project P with $P/CLAUDE.md and $P/cortex/recommendations.md:
  1. Extract every "[src: <URL>]" and "[research: <topic>]" reference.
  2. For each [research: <topic>], verify the topic name appears in
     $CORTEX_DATA_HOME/research/<P-slug>-stack-*.md OR -audit-*.md.
     - Missing topic → 🔴 broken hop 2.
  3. For each [src: <URL>], do a HEAD request (fail-open on offline).
     - 404 → 🔴 broken hop 3.
     - 4xx/5xx other than 404 → 🟡 warning (server-side issue, claim
       might still be valid).
     - 2xx → ✅ chain intact.
  4. If raw research file is missing entirely → 🔴 P5 Adapt never ran;
     suggest paste new-project.md or /audit again.
```

Report format:
- ✅ All claims in N projects trace cleanly through three hops
- 🟡 K claims have unverifiable sources (offline / 4xx other than 404)
- 🔴 J claims have broken hop 2 (missing topic in research) or hop 3 (404)

If 🔴 found: list project + claim + which hop broke. Recommend re-running Phase 5 (greenfield) or `/audit` (existing) to refresh the research cache.

### 15. Canonical-references freshness (NEW 2026-05-06)

Standards live upstream in cortex-x repo. Projects carry POINTERS in CLAUDE.md (per `prompts/new-project.md` §4.1a dual-link pattern):

```
Local path:    ~/.claude/shared/standards/<file>.md       (read at runtime)
Canonical URL: https://github.com/Rejnyx/cortex-x/blob/main/standards/<file>.md
```

This check verifies the local file hasn't drifted significantly behind upstream:

```
For each standards/* pointer in any scaffolded project's CLAUDE.md:
  1. Compute SHA-256 of the local file (~/.claude/shared/standards/<file>.md).
  2. WebFetch the GitHub raw URL → SHA-256 of upstream.
  3. If hashes match: ✅
  4. If hashes differ: WebFetch the file's most recent commit date via
     gh api or by parsing GitHub's HTML "last updated" indicator.
     - Upstream changed within last 30 days: 🟡 (likely just an update;
       suggest re-running install.sh to refresh local).
     - Upstream changed > 30 days ago and local still differs: 🔴
       (local has drifted long-term; install.sh hasn't been run since).
  5. Offline / GitHub unreachable: skip (fail-open; this is augmentation).
```

Report format:
- ✅ N standards files in sync with upstream
- 🟡 K files differ but upstream changed recently (run install.sh to refresh)
- 🔴 J files have stale local copies (run install.sh; consider reading the upstream changelog before re-installing if you've made local edits)

**Exclude `module.local.yaml` and other gitignored override files** — those are user-customized by design.

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
