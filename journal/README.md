# cortex-x Session Journal

> Append-only log of tool-use traces per session. Used by cortex-thinker to detect repeated mistakes, stuck patterns, and effectiveness of suggestions.

## Format

`YYYY-MM-DD-<project-slug>.jsonl` — one session per file, one event per line:

```json
{"ts":"2026-04-17T14:32:01Z","project":"relo","tool":"Bash","duration_ms":340,"ok":true,"summary":"git status"}
{"ts":"2026-04-17T14:32:05Z","project":"relo","tool":"Edit","duration_ms":45,"ok":true,"file":"src/app/page.tsx"}
{"ts":"2026-04-17T14:32:12Z","project":"relo","tool":"Bash","duration_ms":8200,"ok":false,"summary":"npm test","error":"Cannot find module './foo'"}
```

## Privacy

Journals never contain:
- File contents
- User input
- API responses
- Credentials

Only metadata: timestamps, tool names, durations, success/failure, short summaries.

## Retention

- Keep last 30 days active
- Archive older to `archived/` (compress monthly)
- Purge > 1 year

## Use cases

1. **Repeated mistake detection** — same tool + same error 3+ times = insight
2. **Efficiency analysis** — which tasks take longest, where does Claude rerun?
3. **Cortex effectiveness** — did insights reduce errors? compare before/after
4. **Pattern mining** — cross-project: what's typical vs anomalous?

## How it gets populated

- **Stop hook** (future) writes session summary
- **PostToolUse hook** (future) appends per-tool entries
- For now: manually appended by cortex-thinker when session has notable events

## Anti-patterns

- ❌ Log every keystroke (too noisy)
- ❌ Log file contents (privacy + size)
- ❌ Log Dave's prompts (privacy)
- ❌ Log LLM responses (cost + noise)
- ❌ Infinite retention (prune aggressively)
