---
name: ReplayAgent (AMD Hackathon 2026)
slug: amd-hackathon-2026
status: prep
last_scanned: 2026-04-17
scan_version: 1
scanned_by: Claude Opus 4.7
claude_md_reference: c:/Users/david/Desktop/APPs/amd-hackathon-2026/CLAUDE.md
---

# ReplayAgent — AMD Developer Hackathon 2026

## 1. Identity

- **One-liner:** Deterministic agent runtime with time-travel debugging. Capture any LangChain/CrewAI/AutoGen run, rewind to step N, swap inputs, fork 100 alt realities in parallel on one AMD MI300X.
- **Repo:** `c:/Users/david/Desktop/APPs/amd-hackathon-2026/` (GitHub public on Day 1 of hackathon)
- **Live:** TBD (Vercel deploy during Week 1)
- **Event:** AMD Developer Hackathon · lablab.ai · Track 1 (AI Agents) · 2026-05-04 → 2026-05-10
- **Prize target:** $10K pool + R9700 GPU + Build-in-Public extra prize
- **Status context:** prep phase (17 days to kick-off), scaffold complete, core MVP + narrative drafted, need to burn-in AMD Cloud + vLLM infra Week 1.

For Tech Stack / Architecture / Commands / Env Vars → **read [CLAUDE.md](c:/Users/david/Desktop/APPs/amd-hackathon-2026/CLAUDE.md) live**.

## 2. Key Decisions (ADR-lite)

- **Llama-3.3-70B on single MI300X TP=1, 128K ctx** over DeepSeek-V3.1 (8× needed) — hackathon budget ($100 = 50h single, 6h on 8×) — 2026-04-17 — active
- **vLLM OpenAI-compat endpoint** over Optimum-AMD direct — same `OpenAI` SDK client, swap baseURL, no code changes in agent frameworks — 2026-04-17 — active
- **Supabase + pgvector** over dedicated vector DB — already in stack, step embeddings piggyback existing infra — 2026-04-17 — active
- **Python SDK ships LangChain adapter first, CrewAI/AutoGen skeleton** — LangChain is biggest install base + judges recognize; other two show portability — 2026-04-17 — active
- **No auth in MVP** — hackathon demo doesn't need multi-tenant; add in v2 — 2026-04-17 — active
- **Ubuntu 22.04 (NOT 24.04)** for MI300X instance — Ray on 24.04 has HIP invalid-device-ordinal bug — 2026-04-17 — active
- **temp=0 for deterministic replay, seed-only for intentional variance** — greedy decode is byte-exact reproducible — 2026-04-17 — active

## 3. Lessons Learned

_(Captured as they happen. Empty until Week 1 execution.)_

## 4. Cross-Project Dependencies

- **Forks patterns from RELO:** `safe-tool.ts`, `execute-text.ts`, `memory-index.ts` + `activity-log.ts`, `schedule-task.ts`, `system-prompt.ts` + `think.ts`
- **Forks from cortex-x:** `nextjs-saas` profile (scaffold), shared hooks (`session-start`, `block-destructive`, `pre-compact`)
- **Reverse:** if ReplayAgent ships, its Python SDK could instrument RELO's multi-step loop for internal agent QA

## 5. Glossary

- **Run** — a single end-to-end agent execution captured by the SDK
- **Step** — one event inside a run (llm_call, tool_call, tool_result, thought, handoff, error)
- **Replay** — a re-execution of a run with optional mutated inputs at a specific fork step
- **Alt reality** — a tagged cluster of replays with similar outcomes, surfaced by the fork viewer
- **Fork** — the point at which a replay diverges from the source run
- **Mutation** — the change applied at the fork step (prompt swap, tool-response swap, seed, temperature)

## 6. Submission checklist pointers

See [PROGRESS.md](c:/Users/david/Desktop/APPs/amd-hackathon-2026/PROGRESS.md) for Definition of Done.

## 7. Research cache

- [amd-hackathon-2026-2026-04-17.md](../research/amd-hackathon-2026-2026-04-17.md) — competitive, AMD stack, judge psychology, Dave's reusable assets
