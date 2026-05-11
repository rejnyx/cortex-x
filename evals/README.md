# cortex-x Eval Suite

> **Aider-style benchmark** pro cortex-x framework. 10 canonical tasks, scored per commit, reproducible. Změna prompt/standard/profile = rerun eval → check regression.

## Proč

Research (Aider benchmark, Paul Gauthier 2024-2026) dokázal že **jediný legitimní pattern pro solo-dev self-improvement je eval-driven**. Bez evals jsou změny promptu vibes. S evals jsou data.

## Anatomie tasku

Každý `eval-XXX-<slug>.md` má frontmatter + strukturu:

```markdown
---
id: eval-001
name: scaffold-nextjs-saas
category: bootstrap | review | sync | reflect | ...
version: 1.0
---

## Input
<exact prompt the operator would paste>

## Expected properties
- Scaffolded directory contains: CLAUDE.md, PROGRESS.md, MEMORY.md, .claude/
- PROGRESS.md has ≥3 stories
- README.md has stack-appropriate intro
- No generic placeholders (e.g. "TODO: describe your project")

## Scoring rubric
- 1.0 — all properties satisfied
- 0.8 — all critical properties, 1-2 minor missing
- 0.5 — core intent achieved but missing critical properties
- 0.0 — failed to produce valid scaffold

## Adversarial probes (what shouldn't happen)
- Should NOT scaffold without Phase 1 discovery (if ≥80 words not triggered)
- Should NOT skip research phase
- Should NOT use hardcoded paths
```

## Task catalog (10 canonical)

| ID | Name | What it tests |
|---|---|---|
| 001 | `scaffold-nextjs-saas` | new-project.md full flow, Phase 1-4 |
| 002 | `scaffold-minimal-skip` | bail mode trigger + quick scaffold |
| 003 | `project-scan-existing` | scan produces exactly 5 sections, no Tech Stack duplication |
| 004 | `cortex-sync-captures-decision` | sync extracts architectural decision from session |
| 005 | `code-review-catches-ssot-violation` | 5-agent pipeline flags planted duplicate |
| 006 | `code-review-catches-security` | security-auditor flags planted SQL injection |
| 007 | `doctor-detects-missing-hooks` | healthcheck identifies unregistered hook |
| 008 | `sprint-status-parses-correctly` | PROGRESS.md parser finds next pending story |
| 009 | `retrospective-distills-transferable` | extracts pattern applicable beyond current project |
| 010 | `evolve-respects-min-support` | evolve prompt rejects pattern with <3 citations |

## Running

### Full suite
Manually, as part of monthly cadence:
```
Paste ~/.claude/shared/prompts/cortex-evolve.md with "monthly" arg
```

### Single task
```
Paste $CORTEX_DATA_HOME/evals/eval-001-scaffold-nextjs-saas.md
Execute task
Score manually against rubric
Record to evals/results/<date>-<commit>.json
```

## Results schema

`evals/results/<YYYY-MM-DD>-<commit_sha>.json`:
```json
{
  "date": "2026-04-17",
  "commit": "abc123",
  "model": "claude-opus-4-7",
  "tasks": {
    "eval-001": { "score": 0.9, "notes": "minor: missing stack-appropriate README intro" },
    "eval-002": { "score": 1.0, "notes": "" },
    ...
  },
  "summary": {
    "total_score": 8.7,
    "max_score": 10.0,
    "delta_from_baseline": "+0.3",
    "delta_from_last": "+0.1"
  }
}
```

## Anti-patterns

- ❌ Writing evals that check exact string matches (framework output varies — score properties, not strings)
- ❌ 50+ tasks (maintenance burden kills eval discipline — 10 is ceiling)
- ❌ Evals without rollback (score drop → identify which prompt change → revert)
- ❌ Running evals on every commit (expensive, noise) — monthly cadence per [`config/evolve.yaml`](../config/evolve.yaml)

## Baseline

First run: **TBD** — will be recorded first time cortex-evolve monthly runs.

Until baseline exists, eval suite is advisory. After baseline, PR merges are gated.
