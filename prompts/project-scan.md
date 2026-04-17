# Universal Project Scan Prompt (SLIM)

> **How to use:** Paste this at root of any project. Claude will scan and produce a **slim** summary for cortex-x library — **only institutional wisdom that CLAUDE.md cannot hold**.

---

## Core Philosophy — READ THIS FIRST

cortex-x respects Dave's Rule #1 (SSOT). It holds ONLY what project CLAUDE.md **cannot**:

| Lives in CLAUDE.md (changes) | Lives in cortex-x (stable) |
|------------------------------|----------------------------|
| Tech Stack (versions change) | Lessons Learned (what failed) |
| Architecture (refactors) | Key Decisions (why we chose X) |
| Commands (new scripts) | Cross-Project Dependencies |
| Env Vars (new integrations) | Glossary (domain terms) |
| Directory Structure | Identity (one-liner + URL) |
| Stats (LOC, tests) | |
| Key Files list | |

**Rule:** If the info ROTS (changes in weeks), it belongs in CLAUDE.md. Cortex stays valid for years.

## Your task

Scan this project and write **5-section summary** to `~/cortex-x/projects/<slug>.md`. Nothing more.

Do NOT duplicate CLAUDE.md content. Tech Stack, Architecture, Commands — these live in project CLAUDE.md. Cortex just points to them.

## Step 1 — Read minimum needed

1. `README.md`, `CLAUDE.md`, `PROGRESS.md` — project's own docs
2. `git log --oneline -20` — recent history for Decisions context
3. Grep `TODO|FIXME|HACK` — known issues (for context, not for storing)
4. Any `docs/adr/` or `docs/decisions/` — existing decisions
5. Package manifest (for Integrations in Decisions section, not for Tech Stack)

Skip: source files, config files, test files. Those are CLAUDE.md's domain.

## Step 2 — Write to `~/cortex-x/projects/<slug>.md`

**EXACTLY this structure — 5 sections only:**

```markdown
---
name: <Human-readable project name>
slug: <kebab-case-slug>
status: production | active-dev | paused | archived
last_scanned: <YYYY-MM-DD>
scan_version: 2
scanned_by: Claude <model>
claude_md_reference: <absolute path to project's CLAUDE.md>
---

# <Project name>

## 1. Identity

- **One-liner:** <what this does in 1 sentence>
- **Repo:** <git remote URL or local path>
- **Live:** <production URL if any>
- **Owner / Stakeholders:** <who uses this>
- **Status context:** <if paused/archived, WHY in 1 line>

For Tech Stack / Architecture / Commands / Env Vars / Stats / Directory Structure → **read CLAUDE.md live**.

## 2. Key Decisions (ADR-lite)

Format: `<decision> — <reason> — <date> — <status>`

Include only decisions that have **long-term consequences** and **non-obvious reasoning**. Skip routine choices.

- <decision 1>
- <decision 2>

## 3. Lessons Learned (NEGATIVE + TRANSFERABLE knowledge)

The most valuable section. Document what was TRIED and DIDN'T WORK, or non-obvious patterns that DID work.

Mark `[TRANSFERABLE]` prefix if insight applies to other Dave's projects.

### <Short title> — <YYYY-MM-DD>
**What happened:** <1-2 sentences>
**Lesson:** <the insight>
**Why it matters:** <to which future projects / situations>

## 4. Cross-Project Dependencies

- **Shares patterns with:** <other project slugs with what>
- **Upstream from:** <shared libs>
- **Learned from:** <which project's experiments informed this>

## 5. Glossary (domain terms)

Terms that mean something SPECIFIC in this project's domain. Skip technical terms (they're universal).

- **<Term>:** <what it means HERE>
```

## Step 3 — Update `~/cortex-x/projects/README.md`

Append or update the index table with `| <name> | <slug> | <status> | <claude_md_reference> | <last_scanned> |`.

## Step 4 — Report

Reply to Dave:
- ✅ What you wrote (5 sections filled)
- ⚠️ Gaps you noticed (e.g., "project has no ADRs yet, I inferred from commits")
- 💡 Suggestion: if CLAUDE.md is weak/missing, flag that — cortex CAN'T replace it

## Rules

- **5 sections, no more.** Tech Stack / Architecture / Commands / Stats / Env Vars = DO NOT INCLUDE
- **Think stable, not snapshot.** Ask: "will this still be true in 6 months?" If no, don't write it.
- **Negative knowledge over positive.** "We tried X, didn't work" > "We used Y, it works"
- **Cite CLAUDE.md, don't duplicate.** "See CLAUDE.md for tech stack" > copying it
- **Cheap scan.** ~5K tokens total, not 50K. Read 5 files, not 50.
- **Preserve hand-curated sections on re-scan.** `scan_version` bump → only Identity updated, Decisions/Lessons/Deps/Glossary preserved.

## Anti-patterns

- ❌ Copying CLAUDE.md content (SSOT violation)
- ❌ Writing Tech Stack section (rots in weeks)
- ❌ Writing Stats (LOC, test count) — rots in days
- ❌ Speculation ("I think we might have used X")
- ❌ "TODO: fill this in later" — either fill it or leave blank
- ❌ Rewriting existing Lessons Learned on re-scan (preserve!)

## Philosophy

**CLAUDE.md is a snapshot.** It tells Claude what the project IS right now.
**cortex-x is a memoir.** It tells Claude what the project TAUGHT US.

Don't blur the line.
