# cortex-x Research Cache

> Auto-generated research dumps from `new-project.md` Phase 2. Cached per project to avoid duplicate web calls.

## Format

`<project-slug>-<YYYY-MM-DD>.md` — one file per research run.

Structure:
```markdown
---
project: <slug>
date: <YYYY-MM-DD>
agents: [domain, technical, competitive]
queries: [...]
---

# Research: <project name>

## Domain (2026 best practices)
<from Agent 1>

## Technical (<stack> patterns)
<from Agent 2>

## Competitive landscape
<from Agent 3>

## Key insights
- ...
```

## When research runs

**Automatically during:**
- `prompts/new-project.md` Phase 2 (after discovery, before proposal)

**Manually on demand:**
- User: "Research the current state of X" → spawn single-query agent

## Cache invalidation

Research rots faster than institutional wisdom. Rules:
- **2026 best practices** — refresh every 6 months
- **Technical patterns** — refresh when stack major version bumps
- **Competitive landscape** — refresh every 3 months (markets move)

## Why cache

Web research costs tokens + latency. Per-project cache:
- Lets the operator re-read "what was found" when adding features 3 months later
- Avoids re-querying for same project
- Provides audit trail: "why did we pick X?" → point to research file

## Don't commit to git if...

Research may contain URLs to private competitors, pricing info, or other sensitive context. If research for a client project, add to `.gitignore` of cortex-x OR move to project's private space.
