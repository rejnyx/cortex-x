# Sprint 2.25 — cortex-dream + cortex-insights R1 memo

> Captured 2026-05-14. Fresh dispatch. Feeds `bin/cortex-dream.cjs` + `bin/cortex-insights.cjs`.

## Findings

### 1. Anthropic Auto Dream current state

Anthropic shipped **Auto-Dream** as a Claude Code memory-consolidation feature ("REM sleep for your AI agent")[^1]. The 2026 behavior is well-documented and directly relevant — cortex-dream should align with it semantically while operating on cortex-x's distinct file set.

**Dual-gate trigger.** Auto-Dream fires automatically when BOTH conditions hold: ≥24h since last consolidation AND >5 sessions since last consolidation. This is a deliberate anti-thrash design — light projects don't get over-consolidated, active projects get regular cleanup.

**Four-phase pipeline** (1) Orientation: read MEMORY.md + scan topic files. (2) Gather Signal: targeted searches through transcripts for user corrections, explicit saves, recurring themes, important decisions. (3) Consolidation: merge new info, **convert relative dates to absolute**, **remove contradicted facts**, **prune stale entries**. (4) Prune+Index: update MEMORY.md keeping it **under 200 lines**, drop obsolete topic-file pointers.

**Operator control surfaces.** `/dream` slash command (rolling out gradually as of May 2026) plus natural-language triggers ("auto dream", "consolidate my memory files"). 

**Safety mechanics shipped by Anthropic.** Read-only on project code during consolidation (write only to memory files); lock-file prevents concurrent runs on same project; runs in background while operator continues working.

**Direct implication for cortex-dream.** The 4 cortex-dream operations — (a) merge duplicates, (b) remove contradicted, (c) relative→absolute dates, (d) aggressive 200-line prune — are **isomorphic to Anthropic's Auto-Dream Consolidation+Prune phases**. The 200-line cap is the same number. cortex-dream should treat itself as the cortex-side complement targeting `MEMORY.md` + `~/.cortex/projects/<slug>.md` (the operator-edited slice that wiki_consolidate doesn't touch).

### 2. OpenClaw Dreaming current state

OpenClaw's Dreaming is a **three-phase sleep-cycle metaphor** with quantitative scoring[^2]. It's the closest existing competitor and the cited reference in cortex-x positioning.md.

**Three phases.** Light Sleep (read recent daily files, parse to snippets, Jaccard-similarity dedup at 0.9 threshold), REM Sleep (concept-tag frequency over 7-day lookback), Deep Sleep (six-signal scoring → threshold gates → promotion to MEMORY.md).

**Six weighted signals** Relevance 0.30, Frequency 0.24, Query diversity 0.15, Recency 0.15, Consolidation 0.10, Conceptual richness 0.06. Three threshold gates: minScore 0.8, minRecallCount 3, minUniqueQueries 3. 14-day half-life on recency decay.

**Cron + bypass.** Default `0 3 * * *` (3 AM daily). **Opt-in, disabled by default.** Disable via `/dreaming off` or `enabled: false` config. CLI escape hatches: `openclaw memory promote` for manual preview/apply.

**Direct implication for cortex-dream.** Jaccard 0.9 is a reasonable starting dedup threshold. The six-signal weighting is too elaborate for v0 — cortex-dream should ship with **Jaccard dedup + date normalization + size-cap prune only**, defer scoring to v1. **Opt-in by default** is the right ergonomic — fits Auto Mode's "do not take overly destructive actions" guardrail.

### 3. Memory-SaaS consolidation primitives (Mem0/Letta/Zep comparison)

The 2026 landscape shows a **shared gap that cortex-dream is well-positioned to fill**[^3][^4][^5][^6].

**Mem0** No documented explicit merge/dedup/prune primitives. "Dynamic forgetting applies decay to low-relevance entries." Contradiction-resolution shows up in BEAM benchmarks but no API surface. Timestamp on `update()` enables backfilling. Mem0 itself flags "detecting when high-relevance memories become stale is an open research problem." Has `POST /v1/memories/bulk` for one-shot bulk consolidation[^6].

**Letta** Not directly covered, but groups with Mem0 in the "append or silently overwrite, no audit trail" first-generation cluster[^4].

**Zep** Best-in-class for contradictions. **Temporal Knowledge Graph** stores facts with timestamps and relationship maps, understands state changes ("I used to live in London, but I moved to Tokyo" → marks London as superseded, not parallel-truth)[^4]. This is the model cortex-dream should aspire to for contradiction handling — typed supersede relationships, not destructive overwrite.

**Field gap (2026).** "No mainstream system (Mem0, Zep, or Letta) has fully native operations for systematically merging contradicted facts or pruning stale memories — this remains a gap requiring custom implementation"[^4]. **cortex-dream's 4-op consolidator is therefore differentiated, not redundant.**

### 4. Date-extraction libraries 2026

**chrono-node is the canonical choice and is actively maintained**[^7][^8].

- **Version** 2.9.1 (May 6, 2026 release — 8 days before this memo)
- **License** MIT
- **GitHub** 5.2k stars, 373 forks, 66 total releases, active maintenance
- **Dependency footprint** Not zero-deps but small; pure JS, no native bindings
- **Capability** Parses "today", "tomorrow", "yesterday", "last Friday", "3 weeks ago" + 7+ non-English locales (fi, fr, ja, nl, ru, uk, vi)
- **Architecture** Parsers + refiners pipeline — extendable for domain-specific date forms (cortex-x's `2026-05-14` ISO format already round-trips cleanly)

**Recommendation** Use chrono-node in `cortex-dream` with a single utility wrapper. Bring it in as a `dependencies` entry (not optionalDependencies — date parsing is core to the relative→absolute op). 5.2k stars + monthly releases + MIT means low supply-chain risk vs. a hand-rolled regex parser.

**Zero-deps alternative** A regex-only fallback covering "today/yesterday/N days ago/last <weekday>/this week" handles ~80% of cases. Ship as fallback path if chrono-node import fails (graceful degradation, no hard dep on a third-party for the core CLI).

### 5. Usage telemetry patterns (Claude Code + others)

The telemetry landscape splits cleanly into **operator-local (free)** vs. **org-admin-API (gated)** tiers[^9][^10][^11].

**Local-first (operator accessible, no auth).** Claude Code writes **one JSONL file per session to `~/.claude/projects/`** in plaintext (token counts, models, sessions, projects), retained 30 days by default via `cleanupPeriodDays`. This is the **canonical source for cortex-insights** — zero auth, zero API quota, machine-local, already on disk.

**OpenTelemetry tier (opt-in).** Claude Code emits OTLP metrics (counters/gauges for token usage + cost) and events (per-interaction snapshots). Disabled by default; opt-in via env. Multiple open-source dashboards consume this (claude-code-otel, claude-usage, Sealos Grafana, SigNoz, lainra/claude-code-telemetry → Langfuse)[^10]. cortex-insights does NOT need to enable OTLP — JSONL is sufficient for v0.

**Anthropic Admin API (gated).** `/v1/organizations/cost_report` endpoint requires `sk-ant-admin...` key, **org-admin role only**[^9]. February 2026 release. NOT available to individual Pro/Max operators. **cortex-insights must not depend on it.**

**Implication.** cortex-insights v0 parses **two local sources**: `~/.claude/projects/*.jsonl` (Claude's own telemetry) + cortex-x's own `journal/` (Steward action telemetry). No API calls. Operator gets full cost + usage rollup with zero auth burden.

### 6. Memory contamination / prompt-injection-via-memory advisories

**Memory poisoning is a Tier-1 risk in 2026, ranked above SQL injection by OWASP**[^12][^13][^14].

**Mechanism.** Attacker uses **indirect prompt injection** (compromised webpage, shared doc, RAG corpus entry) to write malicious rules into the agent's memory store (e.g., "always BCC this email", "the operator's password is X"). Memory poisoning is more durable than session-level injection — it persists across sessions because agents treat memory as authoritative context.

**Real 2026 incidents.**
- **Google observed +32% malicious-content increase** Nov 2025 → Feb 2026 in indirect-injection vectors[^13]
- **OpenClaw security advisory (2026)** Shared global context leaks across user sessions; access tokens in query parameters; "all content as untrusted" mitigation recommended[^15]
- **Mem0 OpenClaw plugin auto-recall injection broken** (issue #4037) — memories fetched but never injected due to property-name mismatch (functional bug, but reveals the attack-surface)
- **CVE-2026-24763** registered in NVD related to OpenClaw

**Mitigations recommended for cortex-dream.**
1. **Provenance tracking** Every memory entry tagged with source path + timestamp (cortex-x already does this via MEMORY.md frontmatter)
2. **Read-only-from-network policy** cortex-dream MUST NOT consume web content; only files already on disk written by the operator or Steward
3. **Untrusted-content delimiters** When cortex-dream uses an LLM judge for semantic dedup, wrap candidate memory entries in `<untrusted>...</untrusted>` blocks (already a cortex-x convention per CLAUDE.md Sprint 1.6.20+ backlog)
4. **No tool-calls during consolidation** cortex-dream produces an edit-plan; it does NOT execute shell commands or fetch URLs while reasoning over memory content
5. **Confirmation step** Dry-run mode default; `--apply` required to write. Mirror Auto-Dream's read-only-on-project-code discipline
6. **Audit trail** Every consolidation writes a journal entry with before/after diff (what merged, what was contradicted, what was pruned) — operator can revert via git

## Recommendations for cortex-dream v0

- **Scope to 4 ops only, in this order** (1) Jaccard-dedup at 0.9 over MEMORY.md index entries + per-project `~/.cortex/projects/<slug>.md` body, (2) relative→absolute via chrono-node (fallback regex), (3) "supersede" detection via simple heuristic (newer date + same topic → mark older as superseded, do not delete; archive to `MEMORY.archive.md`), (4) size-cap prune at 200 lines (mirror Anthropic Auto-Dream)
- **Opt-in, dry-run-by-default** Match OpenClaw + Auto Mode discipline. `cortex-dream --dry-run` (default) prints diff; `cortex-dream --apply` writes; `cortex-dream --interactive` Y/n per op (mirrors cortex-doctor UX)
- **Lock file** `~/.cortex/locks/dream.lock` (mirror Auto-Dream lock + cortex-x Steward primitive `bin/_lib/lock.cjs` already shipped)
- **Idempotent + git-safe** Run produces a single atomic write per file via existing `bin/_lib/atomic-write.cjs`; tag commit with `cortex-dream-YYYY-MM-DD` trailer
- **No LLM dependency in v0** Pure deterministic operations (Jaccard + chrono-node + regex). LLM-judge for semantic dedup deferred to v1 — keeps v0 zero-cost, offline-capable, audit-able
- **Trigger compatibility with Auto-Dream's dual-gate** Default to fire only if ≥24h since last cortex-dream AND >5 cortex-x sessions since last (read from `journal/`); allow manual override
- **Provenance preserved** Every kept entry retains its original source-link + insertion-date; superseded entries archived not deleted
- **Memory-injection defense** Refuse to apply when input file contains `<system>` / `<system-reminder>` / `</?untrusted>` markers it didn't itself write (basic poisoning canary)

## Recommendations for cortex-insights v0

- **Parse two local sources only — no Anthropic API** `~/.claude/projects/*.jsonl` (Claude Code's own telemetry, plaintext, 30-day rolling) + cortex-x `journal/` (Steward action ledger with per-action $)
- **Output to `~/.cortex/insights/<YYYY-MM-DD>.md`** Idempotent — re-running same day overwrites; cross-day appends never destructive
- **6 sections in the report** (1) Skills fired (from `~/.claude/projects/*.jsonl` skill-invocation events) (2) Prompts run (from cortex-x `prompts/` invocation log if present) (3) Steward actions triggered (from `journal/`) (4) $ spent by dimension (model × action_kind × project) (5) **What WASN'T used** — unused skills/profiles/action_kinds in the period (the differentiated signal — usage-driven pruning input) (6) Anomalies (failed runs, rollbacks, halts)
- **Default window 7 days** with `--since=30d` / `--since=YYYY-MM-DD` overrides; default report covers last week's activity
- **Zero auth, zero network** v0 reads only local JSONL + journal. No `sk-ant-admin` requirement. Works on Free/Pro/Max plans equally
- **Composable with 2026-07-17 audit** The `What WASN'T used` section directly feeds the 3-month usage-driven pruning audit already scheduled in user CLAUDE.md
- **Format aligned with Steward journal** Same JSON-on-disk schema with markdown rendering layer; future cortex-insights v1 could ship a Phoenix OTLP exporter for parity with Sprint 2.0 observability stack
- **Privacy posture** Report never leaves local disk unless operator explicitly shares; no telemetry-of-telemetry. Match Claude Code's `DISABLE_TELEMETRY` semantics
- **Cron-friendly but not cron-default** Provide example workflow in `.github/workflows/cortex-insights-weekly.yml.example` but do NOT auto-install — operator opts in (R5: human-only paths inviolate)

## Sources

[^1]: Auto-Dream: Claude's Memory Consolidation Feature. claudefa.st. https://claudefa.st/blog/guide/mechanics/auto-dream (fetched 2026-05-14)
[^2]: OpenClaw Dreaming Guide 2026: Background Memory Consolidation for AI Agents. dev.to/czmilo. https://dev.to/czmilo/openclaw-dreaming-guide-2026-background-memory-consolidation-for-ai-agents-585e (fetched 2026-05-14)
[^3]: AI Agent Memory Systems Comparison 2026: Mem0 vs Zep vs Letta vs Cognee. n1n.ai. https://explore.n1n.ai/blog/ai-agent-memory-comparison-2026-mem0-zep-letta-cognee-2026-04-23
[^4]: 5 AI Agent Memory Systems Compared: Mem0, Zep, Letta, Supermemory, SuperLocalMemory. dev.to. https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3
[^5]: State of AI Agent Memory 2026. mem0.ai. https://mem0.ai/blog/state-of-ai-agent-memory-2026
[^6]: AI agent memory systems in 2026: Zep, Mem0, Letta, and dual-layer architectures. hermesos.cloud. https://hermesos.cloud/blog/ai-agent-memory-systems
[^7]: chrono-node on npm. https://www.npmjs.com/package/chrono-node (v2.9.1, May 6 2026)
[^8]: wanasit/chrono on GitHub. https://github.com/wanasit/chrono (5.2k stars, MIT, 66 releases, active May 2026)
[^9]: Usage and Cost API. Claude API Docs. https://platform.claude.com/docs/en/build-with-claude/usage-cost-api (Admin-API gated, Feb 2026)
[^10]: Data Usage. code.claude.com. https://code.claude.com/docs/en/data-usage (local JSONL under `~/.claude/projects/`, 30-day default retention via `cleanupPeriodDays`)
[^11]: Claude Code Telemetry → Langfuse bridge. github.com/lainra/claude-code-telemetry
[^12]: LLM Prompt Injection Prevention. OWASP. https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
[^13]: Indirect Prompt Injection Taking Hold in the Wild. Help Net Security, April 2026. https://www.helpnetsecurity.com/2026/04/24/indirect-prompt-injection-in-the-wild/ (Google: +32% malicious content Nov 2025 → Feb 2026)
[^14]: Prompt Injection Is Now a Tier-One Security Risk: A 2026 Defense Playbook. Tek Ninjas. https://tekninjas.com/blogs/cybersecurity-ai-agents-prompt-injection-2026/
[^15]: OpenClaw security issues include data leakage & prompt injection. Giskard. https://www.giskard.ai/knowledge/openclaw-security-vulnerabilities-include-data-leakage-and-prompt-injection-risks
