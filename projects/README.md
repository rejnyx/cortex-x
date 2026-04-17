# Dave's Project Library

> **What is this?** The "Wikipedia" of Dave's projects. Every project scanned once, summarized here, referenced by future Claude sessions for instant cross-project context.

## How to use

**To scan a new project:** paste `~/cortex-x/prompts/project-scan.md` into a Claude Code session at project root.

**To update after work:** paste `~/cortex-x/prompts/cortex-sync.md` at end of session when something notable happened.

**To load context at start of session:** project's `CLAUDE.md` references `~/cortex-x/prompts/cortex-load.md`.

## Index

| Project | Slug | Status | Tech | Last Scanned |
|---------|------|--------|------|--------------|
| [RELO (Back Office Bot)](./relo.md) | relo | production | Next.js 16 + Supabase + OpenAI | 2026-04-17 |
| *(awaiting: chatbot-platform)* | chatbot-platform | production | Next.js + Supabase + 5 adapters | — |
| *(awaiting: waas-template)* | waas-template | production | Next.js 16 + Tailwind 4 + GSAP | — |
| *(awaiting: kiosek)* | kiosek | active-dev | Next.js + React | — |
| *(awaiting: portfolio)* | portfolio | active | Next.js | — |
| *(awaiting: cortex-x)* | cortex-x | active-dev | Node.js + Markdown + Handlebars | — |

## Project graph (cross-dependencies)

```
(populated as projects are scanned)

Example edges:
  RELO ──(shares)──> safe-tool.ts pattern ──(shares)──> Chatbot Platform
  Chatbot Platform ──(inspired)──> RELO's adapter pattern
  WaaS ──(design system)──> Portfolio
```

## Status legend

- **production** — live, serving users
- **active-dev** — actively developed, not yet in production
- **paused** — deprioritized, not abandoned
- **archived** — done, read-only

## Scan versioning

Each project file has `scan_version` in frontmatter. Bump when:
- Major tech stack change
- Architectural refactor
- After review pipeline / hardening sprint

Re-scans preserve hand-curated sections (Lessons Learned, Key Decisions) and regenerate auto-generated sections (Tech Stack, Commands, Stats).

## Cross-project queries

Future cortex features:
- **`cortex search <pattern>`** — find which projects use pattern X
- **`cortex graph`** — visualize cross-project dependencies
- **`cortex diff <a> <b>`** — compare two projects
- **`cortex transferable`** — list all [TRANSFERABLE] insights across projects

For now: grep across `~/cortex-x/projects/*.md`.

## Philosophy

**Negative knowledge is gold.** Document what was TRIED and didn't work. Future sessions save hours by not re-running failed experiments.

**Explicit opt-in.** Don't auto-inject cross-project context into every session — use `@project:<slug>` mentions when relevant. Avoids "wrong project hallucination".

**Curated + generated.** Auto-generated sections (stack, stats, commands) stay fresh via scans. Hand-curated sections (lessons, decisions) preserve institutional knowledge.
