# docs/transcripts/ — supplementary documentation from external sources

> Operator's drop folder for YouTube video transcripts, podcast notes, conference talk excerpts, blog summaries, etc. Anything that adds context the framework should be aware of without becoming a hard dependency.

## What goes here

- **YouTube transcripts** with operator-curated key takeaways (e.g. talks on agentic patterns, observability, multi-agent orchestration).
- **Conference / talk notes** when a slide deck isn't public.
- **Long-form blog summaries** the operator wants to preserve in case the source rots.
- **Anything that informs cortex-x design but isn't a primary R1 web-research artifact.**

## What does NOT go here

- **R1 research memos** — those live in `docs/research/<sprint-or-topic>-<date>.md` with three-hop citation traceability. Transcripts are background reading; R1 memos are decision-grade artifacts.
- **Sprint design docs** — `docs/<sprint>-design.md` or `docs/<feature>-rfc.md`.
- **Operational logs** — those go through the journal under `~/.cortex/journal/<slug>/`.
- **Memory entries** — those live under `~/.claude/projects/<project>/memory/`. Memory is for facts the agent should always know; transcripts are for "if a sprint touches X, here's prior art."

## File naming convention

```
<short-slug>-<source>-<YYYY-MM-DD>.md

Examples:
  hermes-explained-yt-2026-05-08.md
  self-evolve-agent-yt-2026-05-08.md
  karpathy-agent-design-podcast-2026-04-12.md
```

Date is when the operator dropped it here, not when the source was published (that goes in the file body). One source per file — easier to delete or rotate later.

## Front matter (recommended, not required)

```markdown
---
source_url: https://www.youtube.com/watch?v=...
source_title: "..."
source_date: 2026-05-01            # when the video was published
captured_date: 2026-05-08          # when the operator dropped it here
relevance: ["sprint-2.1", "tier-2-multi-agent"]   # optional sprint/tier tags
operator_notes: "Watched while exploring autoresearch patterns; key insight is X"
---
```

If you skip the frontmatter the file still works — Steward / Claude Code reads anything markdown-shaped.

## How Steward / Claude Code uses this

- **Claude Code (interactive).** When the operator references "I watched a video on X, see `docs/transcripts/`", Claude can grep this folder for prior art before asking external research agents.
- **Steward (autonomous).** When a sprint memo cites a transcript ("see `docs/transcripts/hermes-explained-yt-2026-05-08.md`"), the autonomous runtime treats it as untrusted input — same handling as external recommendation text. Transcripts never become directives.
- **Audit trail.** R1 memos may cite transcripts as a finding source ("operator notes from `docs/transcripts/X.md`"); citation traceability still holds because the file path is reproducible.

## Lifecycle

- Files here are **not append-only.** Operator may delete a transcript when the source is no longer relevant or the video is taken down.
- No PII scanner runs against this folder by default — operator is the curator and responsible for what lands here. Don't paste videos that contain client names, API keys, or other sensitive material.
- Transcripts that turn out to be load-bearing for a sprint should be *cited from* the sprint memo, not *moved into* it. Keep this folder as the "I want this nearby" zone.
