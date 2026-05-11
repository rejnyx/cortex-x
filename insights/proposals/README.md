# cortex-x auto-generated proposals

> **Inbox for auto-proposed changes.** `cortex-evolve` writes here. The operator reviews. Nothing auto-merges.

## Workflow

1. **Weekly cron** (Sunday 04:00 UTC) runs `prompts/cortex-evolve.md`
2. Mining finds patterns → hard evidence gate → LLM validation → top 3
3. Per accepted insight: proposal file lands here + PR opened against `main`
4. Operator reviews PR, merges or closes
5. Closed proposals → `insights/rejected/` (learning material for the next loop)

## Layout

```
insights/proposals/
├── README.md                    (this file)
├── 2026-04-20-transfer-safe-tool-pattern.md
├── 2026-04-20-stale-entry-<slug>.md
├── schema-violations-2026-04-17.md  (Phase A output)
├── rejected/
│   ├── README.md
│   └── 2026-04-13-spurious-pattern.md
└── skills/
    └── 2026-04-20-new-skill-candidate.md  (Voyager-style)
```

## SLA

Per `config/evolve.yaml`:
- **7 days** — operator reviews or the proposal auto-closes as stale
- Rejected proposals remain for audit trail

## What a proposal MUST contain

Frontmatter:
```yaml
---
date: YYYY-MM-DD
type: transferable-pattern | repeated-mistake | stale-entry | standard-violation | skill-candidate
confidence: 0.0–1.0
evidence_count: N
projects: [list]
---
```

Body (every section is mandatory):
- **Problem statement** — 1 paragraph
- **Evidence citations** — ≥3 citations in the format `journal/<file>:<line>`
- **Proposed change** — concrete diff or edit target
- **Expected impact** — measurable ("reduce X by Y%")
- **Rollback plan** — how to revert it

**Section missing → proposal is discarded** (`cortex-evolve` fills the gap or the PR stays draft).

## Anti-patterns

- ❌ Proposal without citations (hallucinated)
- ❌ Vague impact ("improve quality")
- ❌ No rollback plan (means we can't safely experiment)
- ❌ Direct edit to `standards/` / `prompts/` / `profiles/` (human-only per config)
