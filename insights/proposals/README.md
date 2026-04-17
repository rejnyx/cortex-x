# cortex-x Auto-Generated Proposals

> **Inbox pro auto-navrhované změny.** cortex-evolve zapisuje sem. Dave review-uje. Nic se nemerguje samo.

## Workflow

1. **Weekly cron** (Sunday 04:00 UTC) spouští `prompts/cortex-evolve.md`
2. Mining najde patterns → hard evidence gate → LLM validation → top 3
3. Pro každý accepted insight: proposal file zde + PR do `main`
4. Dave projde PR, merge nebo close
5. Closed proposals → `insights/rejected/` (learning material pro příští loop)

## Struktura

```
insights/proposals/
├── README.md                    (this file)
├── 2026-04-20-transfer-safe-tool-pattern.md
├── 2026-04-20-stale-entry-kiosek.md
├── schema-violations-2026-04-17.md  (Phase A output)
├── rejected/
│   ├── README.md
│   └── 2026-04-13-spurious-pattern.md
└── skills/
    └── 2026-04-20-new-skill-candidate.md  (Voyager-style)
```

## SLA

Per `config/evolve.yaml`:
- **7 dní** — Dave review-uje nebo auto-close jako stale
- Rejected proposals zůstávají pro audit trail

## Co proposal MUSÍ obsahovat

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

Body (všechny sekce povinné):
- **Problem statement** — 1 odstavec
- **Evidence citations** — ≥3 citations ve formátu `journal/<file>:<line>`
- **Proposed change** — konkrétní diff nebo edit target
- **Expected impact** — měřitelné ("reduce X by Y%")
- **Rollback plan** — jak to revertovat

**Chybí sekce → proposal se discardne** (cortex-evolve to doplní nebo PR zůstane draft).

## Anti-patterns

- ❌ Proposal bez citations (hallucinated)
- ❌ Vague impact ("improve quality")
- ❌ No rollback plan (means we can't safely experiment)
- ❌ Direct edit to `standards/` / `prompts/` / `profiles/` (human-only per config)
