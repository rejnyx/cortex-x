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

- **PreToolUse hook** (`shared/hooks/pre-tool-use.cjs`) records start timestamp per tool call to `os.tmpdir()` — used purely to compute `duration_ms`.
- **PostToolUse hook** (`shared/hooks/post-tool-use.cjs`) appends one JSONL entry per tool call, paired with the pre-hook's timestamp. Writes to `{cortex_root}/journal/YYYY-MM-DD-<project-slug>.jsonl`.
- **Silent by design:** if cortex-x isn't installed (no `~/cortex-x`, no `~/Desktop/APPs/cortex-x`), hooks silently no-op. Never blocks Claude's flow.
- **Failure observability:** when hooks catch an internal error they append one line to `{cortex_root}/.hook-errors.log` (mode 0600, self-rotating at 16KB → 4KB tail). Check this file if journal stops populating. Gitignored via global `*.log`.

### Redaction guarantees (enforced in post-tool-use.cjs)

Before writing, the hook scrubs:
- `password|token|secret|api_key|authorization|bearer=VALUE` → `<redacted>`
- OpenAI/Anthropic keys (`sk-…`), GitHub tokens (`ghp_…`, `ghs_…`), Slack tokens (`xox[bapr]-…`)
- JWTs (`eyJ…`)
- Long hex tokens (32+ chars)

Per-tool summary captures only high-signal metadata:
- `Bash` → command (redacted, ≤120 chars)
- `Edit`/`Write`/`Read` → file path only, no old_string/new_string/content
- `Grep`/`Glob` → pattern
- `WebFetch` → URL only (not the prompt)
- `WebSearch` → query (redacted)
- `Agent`/`Task` → description only (not the prompt)

## Anti-patterns

- ❌ Log every keystroke (too noisy)
- ❌ Log file contents (privacy + size)
- ❌ Log Dave's prompts (privacy)
- ❌ Log LLM responses (cost + noise)
- ❌ Infinite retention (prune aggressively)
