---
name: RELO (Back Office Bot)
slug: relo
status: production
last_scanned: 2026-04-17
scan_version: 1
scanned_by: Claude Opus 4.7
---

# RELO — AI Back Office Agent

## Identity

- **One-liner:** AI-powered autonomous back office agent for Czech real estate agencies — 27 domain tools, 8-step agentic loop, three-layer memory, voice input, proactive alerts
- **Owner:** Dave (David Rajnoha)
- **Repo path:** `c:/Users/david/Desktop/APPs/back-office-bot`
- **Remote:** https://github.com/Rejnyx/back-office-bot
- **Live URL:** https://back-office-bot.vercel.app
- **Stakeholders:** 50 beta registrations (12 with real activity), 1 confirmed realtor (Vojta Žižka)
- **Origin:** Competition project (deadline 26.3.2026) → passed first filter → interview invited but not selected (14.4.2026)

## Tech Stack

- **Framework:** Next.js 16, React 19.2, TypeScript strict
- **Styling:** Tailwind CSS 4, shadcn/ui, OKLCH color system, Motion 12
- **AI/LLM:** OpenAI gpt-5.4-mini (Chat Completions API), gpt-4o Vision, Whisper, Vercel AI SDK v6
- **Database:** Supabase PostgreSQL (24 migrations, RLS, pgvector, triggers, 18 tables)
- **Storage:** Supabase Storage (chat-attachments bucket)
- **Testing:** Vitest 4 (1700+ tests, 91 files), Playwright (16 E2E specs), k6 load tests
- **Deploy:** Vercel (cron jobs for monitoring + briefing + autoDream + tasks + anomalies)
- **Monitoring:** Sentry (error monitoring), Vercel Analytics
- **Auth:** Google OAuth 2.0 (Gmail + Calendar scopes)
- **Charts:** Recharts 3.8

## Architecture

```
User (Czech) → Chat UI (SSE) → /api/chat → OpenAI gpt-5.4-mini
                                    ↓
                            27 AI tools (function calling, 8-step chain)
                            ├── Query: clients, leads, properties
                            ├── Mutate: CRUD on clients, leads, properties
                            ├── Analyze: charts, data quality, insolvency, vision
                            ├── External: Google (Gmail/Calendar), ISIR, ČÚZK, Valuo, sReality
                            ├── Memory: manage_memory (Layer 1-3), semantic_search
                            ├── Async: schedule_background_task (cron worker)
                            ├── Meta: think (reasoning), introspect, explain_platform
                            └── Platform: seed_demo, check_system_health, link_document

Memory architecture (three-layer):
  Layer 1 — core index (compact markdown, always in context)
  Layer 2 — pgvector semantic search over agent_memory
  Layer 3 — agent_activity_log (append-only, searchable)
  autoDream — nightly cron (3:00 UTC) consolidates, verifies, rebuilds index
```

### Key modules

- `src/lib/ai/safe-tool.ts` — Wrapper: strips `$schema` from Zod v4 JSON (OpenAI rejects it), try/catch error classification (timeout/auth/not_found/validation/rate_limit)
- `src/lib/ai/tools/*.ts` — 27 tool implementations (one per file, LEGO pattern)
- `src/lib/ai/system-prompt.ts` — Czech v3 prompt with emoji policy, suggestion taxonomy, injection defense, Think-Plan-Execute protocol
- `src/lib/ai/memory-index.ts` — Layer 1 core index builder (getCoreIndex, rebuildCoreIndex)
- `src/lib/ai/activity-log.ts` — Layer 3 activity log (logActivity, searchActivity)
- `src/lib/embeddings/memory.ts` — Layer 2 semantic memory (embedMemory, backfill)
- `src/app/api/chat/route.ts` — SSE streaming orchestrator
- `src/app/api/cron/autodream/route.ts` — Memory consolidation cron
- `src/app/api/cron/anomalies/route.ts` — Proactive alerts (stagnating leads, data quality, stale clients)
- `src/proxy.ts` — Auth middleware (renamed from middleware.ts per Next.js 16 convention)

## Integrations

- **OpenAI** — Chat Completions (gpt-5.4-mini for chat + tools), Vision (gpt-4o for photo analysis), Whisper (Czech transcription), Embeddings (text-embedding-3-small)
- **Supabase** — Auth (Google OAuth), DB (Postgres + RLS), Storage, pgvector
- **Google Gmail API** — email draft + send (OAuth)
- **Google Calendar API** — read + write events (OAuth)
- **ISIR** — Czech insolvency register (risk screening)
- **ČÚZK** — Czech cadastre (property ownership verification)
- **Valuo / CMA** — property valuation
- **sReality / Bezrealitky** — listing monitoring
- **Telegram Bot API** — webhook integration (voice + text)
- **Sentry** — error monitoring
- **Vercel Cron** — 5 cron jobs (monitor, briefing, tasks, autodream, anomalies)

## Key Decisions (ADR-lite)

- **Chat Completions API over Responses API** — gpt-5.x has documented tool_call_id bug in Responses API — 2026-01 — active
- **Zod v4 `$schema` stripping** — OpenAI JSON Schema parser rejects `$schema` field — 2026-02 — active via safe-tool wrapper
- **safe-tool wrapper pattern** — Tools never throw, return `{success, data|error}`, AI self-heals — 2026-02 — active
- **Three-layer memory architecture** — Inspired by MemGPT/Letta, validates Letta pattern — 2026-03 — active
- **autoDream nightly consolidation** — Matches OpenClaw Dreaming pattern — 2026-03 — active
- **8-step agentic loop (`stopWhen: stepCountIs(8)`)** — Balance between capability and cost — 2026-03 — active
- **middleware.ts → proxy.ts rename** — Next.js 16 convention change — 2026-04 — active
- **No test database mocks for integration tests** — Real Supabase test DB catches migration divergence — 2026-04 — active

## Conventions

- **UI language:** Czech (every user-facing string)
- **Code language:** English (variables, comments, types)
- **Color system:** OKLCH (from `config/design-tokens.ts`)
- **Component library:** shadcn/ui + Radix primitives
- **Form validation:** Zod v4 (with `$schema` stripped for OpenAI compat)
- **Commit style:** Conventional (`feat:`, `fix:`, `docs:`, `chore:`)
- **File naming:** kebab-case for files, PascalCase for components, camelCase for functions
- **Supabase client:** via `@supabase/ssr` (`createClient` + `createServiceClient`)
- **Logging:** Structured `src/lib/logger.ts` (sanitize sensitive keys)
- **SSOT labels:** `config/constants.ts` (Czech labels for DB enums)

## Known Issues / Tech Debt

- **Duplicate project-level hooks** — `.claude/hooks/` duplicates global `~/.claude/shared/hooks/` after cortex-x setup. Safe (both run, regex-based dedup). Clean up after 1-2 weeks of proven global hook operation.
- **50 beta users includes Dave's own test accounts** — 10 deleted 2026-04-17, but cleanup revealed only 12 users with real activity (vs "50 beta testers" narrative)
- **Drop-off brutal** — 16/49 users registered but zero activity. Onboarding needs UX work.
- **No multi-tenant UI** — Migration 024 added `org_id` schema but team management UI is Phase 2.
- **Proactive alerts cron once daily** — Hobby plan limit. Paid plan would allow every 6h.
- **1-person product** — No testimonials, no case study, no sales funnel yet.

## Lessons Learned

### [TRANSFERABLE] safe-tool pattern saves hours — 2026-02
**What:** Wrapping AI SDK `tool()` with try/catch + error classification means tools NEVER throw to the agent loop. AI reads error code, attempts alternatives.
**Why transferable:** Any project using Vercel AI SDK v6 with multi-step agents benefits. Copy `safe-tool.ts` to Chatbot Platform.

### [TRANSFERABLE] Three-layer memory > flat memory — 2026-03
**What:** Core index (always in context) + vector search (semantic) + activity log (searchable) outperforms flat vector DB for agent context.
**Why transferable:** Any long-running agent project. Validated by Letta/MemGPT. Pattern works across projects.

### [TRANSFERABLE] Chat Completions > Responses API for tool calling — 2026-01
**What:** gpt-5.x has documented bug in Responses API where `tool_call_id` gets mismatched in multi-tool chains.
**Why transferable:** Every OpenAI-based project using tool calling. Document in `cortex-x/standards/ai-patterns.md` (future).

### Voice input needs design polish — 2026-04
**What:** First iteration used `MicrophoneSlash` icon (looks like "no microphone"). Changed to `Stop` icon (universal "stop" affordance).
**Why matters:** Design details compound. Dave's design eye catches what pure engineers miss. Apply same eye to Chatbot Platform + WaaS.

### Next.js 16 middleware deprecation — 2026-04
**What:** `middleware.ts` → `proxy.ts` with `export default async function proxy`. All `@/middleware` imports need update.
**Why transferable:** All Next.js 16 projects need this migration. Check Chatbot Platform + Portfolio.

### Tailwind 4 auto content scanning gotcha — 2026-04
**What:** Tailwind 4 scans `docs/` by default — large markdown files (4500 lines session export) broke build with "Invalid code point".
**Fix:** `@source not "../../docs/**/*.md";` in globals.css
**Why transferable:** Any Next.js 16 + Tailwind 4 project with large markdown files. Pre-emptive add to WaaS.

### Supabase Web Locks AbortError — 2026-04
**What:** `@supabase/ssr` uses Web Locks API, can throw AbortError when parallel requests fight over locks.
**Fix:** Wrap `getUser()` in try/catch in proxy.ts — harmless, just means one request waits.
**Why transferable:** All Supabase + Next.js 16 projects.

### Database mocks in integration tests lie — 2026 (from old incidents)
**What:** Mocked Supabase tests passed while real migration broke in production.
**Rule:** Integration tests use REAL Supabase test database, not mocks.
**Why transferable:** Every project. Already in cortex-x standards/testing.md.

## Cross-Project Dependencies

- **Shares patterns with:** chatbot-platform (adapter pattern, multi-tenant RLS), waas-template (design system OKLCH tokens)
- **Upstream from:** cortex-x (this project funds the cortex framework)
- **Learned from:** chatbot-platform (5669 tests, earlier iteration of multi-tenant)
- **Inspired by research:** Letta/MemGPT (memory), OpenClaw Dreaming (autoDream), Anthropic KAIROS leak (validated 3-layer approach)

## Commands Cheatsheet

```bash
# Development
npm install
npm run dev
npm run build
npm test                              # unit + integration
npx playwright test                   # E2E

# Data
npx tsx scripts/seed.ts               # seed demo data (6 profiles)
npx tsx scripts/test-tools.ts         # integration tests 27 tools
npx tsx scripts/audit-users.ts        # DB user audit
npx tsx scripts/audit-users.ts --delete <uuid>  # cleanup

# Database
supabase db push                      # apply migrations
supabase gen types typescript         # regenerate types

# Deploy
git push                              # auto-deploys to Vercel
npx vercel --prod                     # manual deploy

# Load testing
k6 run load-tests/chat-load.js
k6 run load-tests/dashboard-load.js
```

## Environment Variables

**OpenAI:**
- `OPENAI_API_KEY`

**Supabase:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Google OAuth:**
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

**App:**
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET` (Vercel auto-sets)

**Integrations (optional):**
- `TELEGRAM_BOT_TOKEN`
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`

## Glossary (domain terms)

- **Klient (client)** — person who owns properties OR is looking to buy/rent. Distinguished by `type` enum
- **Lead** — potential deal linking client ↔ property, with pipeline status
- **Nemovitost (property)** — real estate listing (apartment, house, land)
- **Pipeline** — lead status flow (new → contacted → viewing → negotiating → closed)
- **ISIR** — Czech insolvency register (Insolvenční rejstřík ČR)
- **ČÚZK** — Czech Office for Surveying, Mapping and Cadastre
- **sReality / Bezrealitky / iDNES** — major Czech real estate portals
- **autoDream** — nightly memory consolidation cron (3:00 UTC)
- **Pitch demo** — deterministic seed profile for client presentations
- **Think tool (#27)** — internal reasoning tool, no side effects

## Key Files (top 10 for new developer)

1. `CLAUDE.md` — full project context (read first)
2. `src/lib/ai/safe-tool.ts` — tool execution wrapper (pattern to understand)
3. `src/lib/ai/tools/index.ts` — factory for 27 tools (entry point)
4. `src/lib/ai/system-prompt.ts` — Czech system prompt (agent behavior)
5. `src/lib/ai/memory-index.ts` — three-layer memory Layer 1
6. `src/app/api/chat/route.ts` — SSE streaming + agent loop
7. `src/app/api/cron/autodream/route.ts` — memory consolidation
8. `supabase/migrations/001_initial.sql` — schema foundation
9. `supabase/migrations/024_organizations.sql` — multi-tenant prep
10. `PROGRESS.md` — sprint state + remaining work

## Stats (as of 2026-04-17)

- **Lines of TypeScript:** ~18,000 (approx)
- **Test files:** 91 unit test files, 16 Playwright E2E specs
- **Test count:** 1700+ unit tests passing
- **DB migrations:** 24 SQL migrations applied
- **AI tools:** 27 domain-specific tools
- **Deployed:** Yes, Vercel production + preview envs
- **Users:** 49 registered (33 active), 1 confirmed realtor
- **Hardening score:** Top 1% complexity among AI agent projects on GitHub (per research audit)

## Open Problems / Next Steps

**Active work:**
- Story 8.5 in Phase 8: Deploy + Demo Video
- 4 uncommitted files in working tree
- Multi-tenant Phase 2 (UI for team management, invitation flow, role switching)

**Distribution:**
- Beta outreach to real realtors (current DB is mostly Dave's tests)
- Vojta Žižka (confirmed realtor) — request testimonial + intro to network
- FB groups + LinkedIn (Dave's proven organic distribution)

**Monetization (from 30-day plan 14.4-14.5):**
- Possible SaaS launch if no job lands
- Free beta → paid after validation
- Czech real estate market is empty for AI tools

**Technical debt:**
- Multi-tenant UI (migration 024 is schema-only)
- Vercel Pro upgrade decision (60s → 300s timeout, 40 crons, allows tighter anomaly detection)
- Cleanup duplicate hooks (project-level vs global)
- Onboarding UX (16/49 drop-off rate)
