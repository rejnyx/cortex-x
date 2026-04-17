# Cortex Load — The Mental Model

> **One rule:** cortex-x holds institutional wisdom (lessons, decisions, dependencies, glossary). Project `CLAUDE.md` holds current state (tech stack, architecture, commands). **Never duplicate. Always trust CLAUDE.md for anything that changes.**

---

## When working in any Dave's project

Before starting work:

1. **Read the project's own `CLAUDE.md` live** — this is the source of truth for:
   - Tech stack + versions
   - Architecture diagrams
   - Directory structure
   - Commands (npm scripts, DB commands, deploy)
   - Environment variables
   - Key files
   - Stats

2. **Read `~/cortex-x/projects/<slug>.md` for institutional wisdom** — this holds:
   - Identity (one-liner + URL + stakeholders)
   - Key Decisions (ADR-lite, why things are the way they are)
   - Lessons Learned (what was tried, what failed, what transfers)
   - Cross-Project Dependencies
   - Glossary (domain terms)

   **Note:** If `<slug>.md` doesn't exist, suggest running `~/cortex-x/prompts/project-scan.md`.

3. **Trust CLAUDE.md for current state, cortex for institutional memory.** If they ever conflict, CLAUDE.md wins — it's the live code truth. Update cortex on next re-scan.

## When to reference cortex during work

Use **explicit** mentions only when relevant:

- "I remember `@project:chatbot-platform` solved similar issue — see its Lessons Learned"
- "Per `@project:relo` Key Decision 2026-01, we prefer Chat Completions over Responses API"

**Don't auto-inject cross-project context.** Wrong project hallucination > silence.

## When to update cortex

After work sessions where something notable happened — paste `~/cortex-x/prompts/cortex-sync.md`. Updates go to Lessons Learned, Key Decisions, or Cross-Project Dependencies. **Never** tech stack or commands (those live in project CLAUDE.md).

## SSOT guarantee

If you find yourself writing **Tech Stack**, **Architecture**, **Commands**, **Env Vars**, or **Stats** to a cortex file — stop. That belongs in CLAUDE.md, not cortex. Keeping it in cortex creates drift and lying cortex entries.

Cortex stays valid for years. CLAUDE.md stays valid for weeks. Respect the split.
