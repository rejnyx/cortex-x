---
location: $CORTEX_DATA_HOME/insights/
---

# `~/.cortex/insights/` — your knowledge accumulation

This directory holds **your own** observations, lessons, and signal logs. Nothing in here ships with cortex-x; nothing leaves your machine unless you explicitly share it.

## Files cortex-x writes

### `gap-log.jsonl` (Phase 1.5 of new-project.md)

One JSON line per greenfield run where the best-fit profile scored < 0.8 against your Q1+Q4+Q7 brief. Surfaces **uncovered tech-stack signal** so future profile additions are driven by real demand.

Schema:
```json
{
  "date": "2026-05-08T22:30:00Z",
  "slug": "hono-bun-api",
  "best_match": "minimal",
  "best_score": 0.55,
  "runner_up": [
    {"name": "nextjs-saas", "score": 0.4},
    {"name": "cli-tool",    "score": 0.45}
  ],
  "q1_summary": "REST API for Slack notifications",
  "q4_keywords": ["bun", "hono", "drizzle"],
  "q7": "b",
  "missing_signals": ["bun-runtime", "hono-framework"]
}
```

Aggregate: `cortex-gap-report` (in `~/.claude/shared/bin/` after install). Outputs top fallback profiles + top missing signals across the last 90 days. After ~30 entries the empirical picture replaces speculation about which profile to add.

**Privacy:** local file, never uploaded. If you want to send it back upstream as cortex-x roadmap input, paste manually into a GitHub issue.

### Other files (manual capture)

`prompts/cortex-reflect.md` and `prompts/cortex-sync.md` may write here when you explicitly capture lessons. Format depends on the prompt that wrote them — typically frontmatter + freeform.

## Pruning

Files older than 6 months without a touch may be safe to archive — but check before deleting; some lessons stay relevant for years. `cortex-doctor` will flag stale entries (planned: Sprint 1.7).
