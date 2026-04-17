# Cortex Load Prompt — Paste at start of every new project session

> **How to use:** Add this to every project's `CLAUDE.md` under a "Cross-project context" section. Claude will load relevant context from the cortex library before starting work.

---

## Cross-project context (cortex-x)

Before starting work in this project, load relevant context from Dave's project library:

1. **Read index:** `~/cortex-x/projects/README.md` — see all Dave's projects at a glance
2. **Read THIS project's entry:** `~/cortex-x/projects/<slug>.md` — full history, decisions, lessons
3. **Identify adjacent projects:** Based on this project's stack and "Cross-Project Dependencies" section, identify 1-2 related projects
4. **Read adjacent entries** but DON'T load their full content into context — just note their patterns/decisions for reference

## When to consult cortex during work

Use explicit `@project:<slug>` mentions when relevant:

- "I remember in `@project:chatbot-platform` we solved similar issue with adapter pattern"
- "Let me check if `@project:relo` has this pattern already — avoiding duplicate work"

## When to UPDATE cortex (using cortex-sync.md prompt)

- After architectural decisions (add to Key Decisions)
- After failed experiments (add to Lessons Learned — this is most valuable!)
- After cross-project insights (add to Cross-Project Dependencies)
- After significant refactors

## Rules

- **Explicit opt-in** — only reference cortex when relevant, not in every response
- **Don't leak cross-project context unprompted** — Kiosek patterns don't belong in RELO suggestions unless relevant
- **Trust but verify** — cortex entries are snapshots, check git history for latest truth
- **Scan version matters** — if `scan_version` is old, note potential staleness

## Fallback

If `~/cortex-x/projects/<slug>.md` doesn't exist:
1. Inform Dave: "I don't see this project in cortex library — want me to run `prompts/project-scan.md`?"
2. Continue work using existing project docs (CLAUDE.md, README.md)
3. Suggest running project-scan at end of session to populate cortex
