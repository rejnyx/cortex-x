---
title: Anthropic Memory Tool — Deferred to Sprint 3.X
date: 2026-05-11
sprint: deferred (originally proposed 2.8.1)
status: NOT SHIPPED — roadmap entry only
dispatched_by: autonomous research while operator away
---

# Anthropic Memory Tool — Research + Defer Verdict

## TL;DR verdict (defer to Sprint 3.X)

Sprint 2.8.1 (initially considered for autonomous ship) is DEFERRED to
**Sprint 3.X — Anthropic-native context plane bundle**.

Three blockers:
1. **claude-cli engine collision.** Memory Tool requires direct `/v1/messages`
   HTTP with `betas: ["context-management-2025-06-27"]`. claude-cli engine
   (Sprint 2.4) bills against Max subscription via OAuth — using Memory Tool
   would re-introduce API-key cost line, reversing Sprint 2.4's cost pivot.
2. **Sprint 2.8 Memory Foundation schema gate.** Per memory log + roadmap §
   Sprint 2.8 was the "MEMORY GATE." Adding Anthropic Memory Tool before
   deciding durable schema risks design drift — would either build hasty
   mapping then re-do it, or skip schema gate.
3. **Value/ceremony ratio mismatch.** The 84% token reduction + 39% perf
   wins come from Memory Tool + context-editing (`clear_tool_uses_20250919`)
   **combined**, not Memory Tool alone. cortex-x doesn't yet wire
   context-editing. Doing both at once (Sprint 3.X) gets full upside;
   Memory Tool alone now = 20% of value at 80% of integration cost.

## What it is (May 2026)

Client-side, file-based primitive Anthropic shipped Sep 29 2025 alongside
context-management beta.

- **Tool type:** `"memory_20250818"` (versioned string)
- **Beta header required:** `anthropic-beta: context-management-2025-06-27`
- **Six commands** Claude emits as `tool_use`: `view`, `create`,
  `str_replace`, `insert`, `delete`, `rename` — all addressed by `path`
  strings prefixed `/memories/...`
- **Auto-injected system prompt:** *"IMPORTANT: ALWAYS VIEW YOUR MEMORY
  DIRECTORY BEFORE DOING ANYTHING ELSE. ASSUME INTERRUPTION..."* — Anthropic
  inserts whenever tool enabled.
- **Storage:** entirely client-managed. Anthropic does NOT host files. The
  `/memories` prefix is virtual namespace, not real path.
- **Sandbox:** docs put burden on caller. Required defenses:
  `pathlib.Path.resolve()` + `relative_to('/memories')`, reject `../`,
  `..\\`, URL-encoded `%2e%2e%2f`, NUL bytes. CVE-2026-39861 (Claude Code
  sandbox escape via symlink-out-of-workspace, fixed 2.1.64) proves
  attack class is real.
- **Pricing:** standard input/output tokens. Every tool call sits in
  context window, paid at conversation's model rate.

## Best-practice patterns 2026

1. **Progress-log + feature-checklist bootstrap** — first session writes
   `progress.md` + `checklist.md`, subsequent sessions `view` them first.
   Mirrors how cortex-x already uses PROGRESS.md.
2. **Pair with context editing** (`clear_tool_uses_20250919`) — bulk of
   measured wins (29%→39% perf, 84% token cut) come from the **combo**,
   not memory alone.
3. **Extract facts, never store transcripts** — Files = facts/decisions/rules;
   conversation flow goes to compaction.
4. **Periodic compaction of memory files** — Otherwise files monotonically
   grow.
5. **Hybrid is the default, not the exception** — Complement rather than
   replace existing memory architectures (Shloked / orchestrator.dev).

**Anti-patterns:**
- Storing PII / secrets — Claude usually refuses but docs explicitly say
  "implement stricter validation."
- Letting files grow unbounded.
- Trusting Claude's path argument — prompt injection through poisoned file
  contents can re-aim subsequent tool calls.

## claude-cli + Memory Tool — combo blocker

**Does NOT work today via claude-cli engine.** Claude Code CLI ships its
OWN memory layer, distinct from `memory_20250818`:

- **CLAUDE.md** — human-authored, loaded every session.
- **Auto Memory** (`~/.claude/projects/<project>/memory/MEMORY.md`) — Claude
  writes autonomously since v2.1.59.
- **Subagent Memory** (v2.1.33+, Feb 2026) — `~/.claude/agent-memory/`,
  per-named-subagent.

The API-level `memory_20250818` tool is **not exposed as a CLI flag** in
Claude Code. Direct API access required, which means API key billing,
which negates Sprint 2.4 cost pivot.

## Memory Tool vs cortex-x ReasoningBank — coexistence

Different layers:

| | Memory Tool (`/memories`) | cortex-x ReasoningBank (`lessons.jsonl`) |
|---|---|---|
| Audience | Claude reads autonomously in-session | Steward orchestrator + future analysis |
| Format | Markdown/XML files | JSONL records with importance + decay |
| Authority | Claude decides what to write | Spec-verifier + capability decides |
| Lifecycle | Per-action session, then archived | Importance-weighted decay, durable |
| Trust model | Model-curated, can drift | Code-curated, deterministic |

**Recommended layering (for future Sprint 3.X):**
- Memory Tool = volatile within-action working memory
- ReasoningBank/lessons.jsonl = durable cross-action long-term memory

## Sprint 3.X — "Anthropic-native context plane" bundle

When this gets prioritized:

**Scope:**
- New module `bin/steward/_lib/memory-tool.cjs` (~180 LoC) — 6-command
  dispatcher, path-traversal hardened.
- New module `bin/steward/_lib/memory-store-fs.cjs` (~120 LoC) — filesystem
  backend rooted at `.steward/memories/<action-id>/`.
- Engine seam in OpenRouter/Anthropic-API engine (~80 LoC) — add beta
  header, register tool, route `tool_use` blocks.
- Optional: pair with `clear_tool_uses_20250919` context-editing (+40 LoC)
  to capture 84% token win.

**Tests:**
- Unit (~12): six commands × happy path + error case, path-traversal denial
  (`../`, NUL, `%2e%2e`, symlink escape), max-line-length.
- Contract (~4): tool_use JSON shape matches schema, tool_result format,
  beta header sent.
- Integration (~3): mock engine round-trip view→create→str_replace, lifecycle
  archive at action-end, double-engine guard (memory tool NOT enabled on
  claude-cli engine).

**Total estimate:** ~420 LoC, ~19 tests, 1-2 working days for MVP.

**Constraint:** ship AFTER Sprint 2.8 Memory Foundation lands its
ReasoningBank v2 schema. Memory Tool becomes "ephemeral working layer" the
operator's roadmap-planning research already called out, with
schema-discipline already in place.

## Smaller bite NOW — lessons.jsonl → MEMORY.md exporter

Sprint 2.8.1 alternative considered: write `lessons.jsonl` periodically to
`~/.claude/projects/<project>/memory/MEMORY.md` topic file, feeding
claude-cli auto-memory from cortex-x's durable store. ~80 LoC, zero API-key
dependency, same architectural insight.

**Decision: parked for now** — operator may want to design the
write-format manually (per-topic file vs single MEMORY.md), and the
auto-memory pipeline interaction needs investigation. Roadmap entry
added.

## References

- [Memory tool — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Managing context on the Claude Developer Platform](https://claude.com/blog/context-management)
- [TypeScript SDK memory example](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools-helpers-memory.ts)
- [CVE-2026-39861 Claude Code sandbox escape](https://www.sentinelone.com/vulnerability-database/cve-2026-39861/)
- [Exploring Anthropic's Memory Tool — Leonie Monigatti](https://www.leoniemonigatti.com/blog/claude-memory-tool.html)
- [Anthropic's Opinionated Memory Bet — Shlok Khemani](https://www.shloked.com/writing/claude-memory-tool)
- [Claude Code & Agent Memory: Best Practices for 2026 — orchestrator.dev](https://orchestrator.dev/blog/2026-04-06--claude-code-agent-memory-2026/)
- [Context editing — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)
