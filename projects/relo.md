---
name: RELO (Back Office Bot)
slug: relo
status: production
last_scanned: 2026-04-17
scan_version: 2
scanned_by: Claude Opus 4.7
claude_md_reference: c:/Users/david/Desktop/APPs/back-office-bot/CLAUDE.md
---

# RELO — AI Back Office Agent

## 1. Identity

- **One-liner:** AI-powered autonomous back office agent for Czech real estate agencies — 27 domain tools, 8-step agentic loop, three-layer memory, voice input, proactive alerts
- **Repo:** https://github.com/Rejnyx/back-office-bot
- **Live:** https://back-office-bot.vercel.app
- **Owner / Stakeholders:** Dave (David Rajnoha). Active users: 33 with data, 1 confirmed realtor (Vojta Žižka). Origin: competition project 26.3.2026 deadline, passed first filter, interview not selected 14.4.2026.
- **Status context:** production-grade quality (top 1% complexity among AI agent projects on GitHub per research audit), needs distribution to real realtors — current user base is mostly Dave's test accounts.

For Tech Stack / Architecture / Commands / Env Vars / Directory Structure → **read `c:/Users/david/Desktop/APPs/back-office-bot/CLAUDE.md` live**.

## 2. Key Decisions (ADR-lite)

- **Chat Completions API over Responses API** — gpt-5.x has documented `tool_call_id` mismatch bug in Responses API with multi-tool chains — 2026-01 — active
- **Zod v4 `$schema` stripping via safe-tool wrapper** — OpenAI JSON Schema parser rejects `$schema` field — 2026-02 — active
- **Tools never throw, return `{success, data|error}`** — AI self-heals with alternative tool calls instead of crashing loop — 2026-02 — active
- **Three-layer memory (core index + pgvector + activity log) with nightly autoDream consolidation** — Inspired by MemGPT/Letta research, validated by Anthropic KAIROS leak — 2026-03 — active
- **8-step agentic loop (`stopWhen: stepCountIs(8)`)** — Balance between capability and cost — 2026-03 — active
- **`middleware.ts` → `proxy.ts` rename** — Next.js 16 convention change, all `@/middleware` imports need update — 2026-04 — active
- **No mocks in integration tests — real Supabase test DB** — Prior incident: mocked tests passed while real migration broke prod — 2026-04 — active
- **`@source not` directive in globals.css for large markdown** — Tailwind 4 auto-scans `docs/`, big markdown files (4500+ lines) break build — 2026-04 — active
- **`microphone=(self)` in Permissions-Policy header** — `microphone=()` blocked voice input, `(self)` allows same-origin — 2026-04 — active
- **Wrap `supabase.auth.getUser()` in try/catch in proxy** — `@supabase/ssr` uses Web Locks API, throws AbortError on parallel requests — 2026-04 — active

## 3. Lessons Learned

### [TRANSFERABLE] safe-tool pattern saves hours — 2026-02
**What happened:** Tools throwing to agent loop crashed multi-step chains 4 separate times. Wrapper with try/catch + error classification eliminated crashes.
**Lesson:** Any Vercel AI SDK v6 project with multi-step agents needs this wrapper. Tools return `{success, data|error}`, never throw.
**Why it matters:** Apply immediately to Chatbot Platform when adding AI agent features. Port `safe-tool.ts` pattern.

### [TRANSFERABLE] Three-layer memory > flat memory — 2026-03
**What happened:** Flat vector DB approach consumed too much context, lost discoverability for core user preferences.
**Lesson:** Layer 1 (compact cheat sheet, always in context) + Layer 2 (pgvector semantic) + Layer 3 (activity log) outperforms flat storage.
**Why it matters:** Any long-running agent project. Pattern validated by Letta/MemGPT research. Don't reinvent.

### [TRANSFERABLE] Chat Completions > Responses API for tool calling — 2026-01
**What happened:** Multi-tool chains broke with gpt-5.x + Responses API due to `tool_call_id` mismatches.
**Lesson:** Always use `openai.chat()` for function calling, not Responses API, until OpenAI fixes the bug.
**Why it matters:** Every OpenAI tool-calling project. Not worth retesting quarterly.

### [TRANSFERABLE] Design eye catches what engineers miss — 2026-04
**What happened:** Voice recording UX used `MicrophoneSlash` icon (reads as "no microphone" to users). Changed to `Stop` icon (universal stop affordance).
**Lesson:** Active states need UNIVERSAL affordance icons, not domain-clever ones. Dave's 17-year design background = competitive edge.
**Why it matters:** Apply same lens to Chatbot Platform + WaaS UI audits.

### [TRANSFERABLE] Tailwind 4 auto content scanning gotcha — 2026-04
**What happened:** Tailwind 4 scans `docs/` by default. Large markdown files (Claude session export 4500 lines) broke build with "Invalid code point 11839035".
**Lesson:** Add `@source not "../../docs/**/*.md";` in globals.css preemptively in all Next.js 16 + Tailwind 4 projects.
**Why it matters:** WaaS template, Chatbot Platform, any future projects. Pre-emptive fix.

### [TRANSFERABLE] Supabase Web Locks AbortError — 2026-04
**What happened:** `@supabase/ssr` uses Web Locks API internally. Parallel `getUser()` calls throw AbortError when lock contention.
**Lesson:** Wrap auth calls in try/catch in proxy/middleware. AbortError is harmless, just means one request waits.
**Why it matters:** All Supabase + Next.js 16 projects. Invisible bug until it surfaces.

### [TRANSFERABLE] Database mocks in integration tests lie — 2026 (historical)
**What happened:** Mocked Supabase tests all passed. Real migration broke in production.
**Lesson:** Integration tests MUST use real Supabase test database. Never mock the DB boundary.
**Why it matters:** Already codified in cortex-x `standards/testing.md`. Enforce in every project.

### Distribution ≠ development — 2026-04
**What happened:** Built top 1% AI agent platform in 5 days. 50 "beta users" turned out to be 12 real users (after audit), none confirmed realtors except Vojta.
**Lesson:** Engineering excellence doesn't equal market validation. Beta funnel needs verification, not assumptions.
**Why it matters:** Apply to all Dave's projects. Count REAL users, not registrations. Interview users early before scaling features.

## 4. Cross-Project Dependencies

- **Shares patterns with:**
  - `chatbot-platform` — adapter pattern concept (RELO's 27 LEGO tools = Chatbot's 5 channel adapters); multi-tenant RLS approach
  - `waas-template` — OKLCH design token system, shadcn/ui conventions
  - `cortex-x` — `safe-tool` pattern candidate for future extraction
- **Upstream from:** `cortex-x` (this project was the experience that funded cortex framework Lessons Learned library)
- **Learned from:** `chatbot-platform` (5669 tests, earlier iteration of multi-tenant patterns that informed RELO's migration 024)
- **Inspired by research:** Letta/MemGPT (three-layer memory), OpenClaw Dreaming (autoDream cron), Anthropic KAIROS leak (validated memory architecture)

## 5. Glossary (domain terms)

- **Klient (client):** Person who owns properties OR is looking to buy/rent. Distinguished by `type` enum. NOT a Chatbot Platform customer.
- **Lead:** Potential deal linking client ↔ property, with pipeline status. Domain-specific to real estate — not the SaaS meaning.
- **Nemovitost (property):** Real estate listing (apartment, house, land). Czech term used throughout DB and UI.
- **Pipeline:** Lead status flow (new → contacted → viewing → negotiating → closed).
- **ISIR:** Czech insolvency register (Insolvenční rejstřík ČR). Used for risk screening.
- **ČÚZK:** Czech Office for Surveying, Mapping and Cadastre (Český úřad zeměměřický a katastrální). Used for property ownership verification.
- **sReality / Bezrealitky / iDNES:** Major Czech real estate portals. Monitored for listing alerts.
- **autoDream:** Nightly memory consolidation cron (3:00 UTC). NOT related to Anthropic's KAIROS — independent implementation, same pattern family.
- **Pitch demo:** Deterministic seed profile used for client presentations (reproducible demo data).
- **Think tool (#27):** Internal reasoning tool, no side effects. Used for Think-Plan-Execute protocol on complex tasks.
- **Safe-tool:** Wrapper around Vercel AI SDK `tool()` that catches errors and returns `{success, data|error}`. RELO-specific name for a transferable pattern.
