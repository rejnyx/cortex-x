# cortex-x Insights

> Auto-generated + manually-triggered insights from cortex-thinker agent. Each file = one observation grounded in evidence.

## What lives here

- `<YYYY-MM-DD>-<slug>.md` — individual insights
- `META-<YYYY-MM-DD>.md` — meta-reflection on cortex-thinker effectiveness
- Each file has frontmatter: `date`, `project`, `confidence`, `type`

## Insight types

- **standard-violation** — current project breaks a cortex-x standard other projects respect
- **transferable-pattern** — proven pattern from other project not yet applied here
- **repeated-mistake** — journal shows same error 3+ times in a session
- **stale-entry** — cortex library entry older than recent major changes
- **security** — potential security regression (missing RLS, leaked secret, etc.)

## Review cadence

Weekly (Friday?) — the operator reviews all insights, marks:
- ✅ Acted on
- 🔄 In progress
- ❌ Dismissed (with reason)
- 📌 Saved for later

## Budget

- **Max 1 proactive insight per session** (spam kills trust)
- **Max 3 insights per week across all projects** (curated, not exhaustive)

## Meta-reflection

Every ~30 insights (or monthly), cortex-thinker writes `META-<date>.md` reviewing:
- How many insights were acted on vs dismissed
- False positive rate by type
- Adjustments to detection rules

This is cortex's self-improvement loop.

## No insight is also insight

Silence means cortex has nothing grounded to surface. That's a feature. Don't force insights — force value.
