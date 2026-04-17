# Scalable — Patterns That Survive 10x Growth

> Default to patterns that work at 10 users, 1000 users, and 100k users without rewrites.

## Why

You won't know in advance which project succeeds. The ones that take off punish you for shortcuts taken early. Scalable-by-default means growth is exciting, not a crisis.

## Non-negotiables from day one

1. **Database:** Indexes on every foreign key + every column used in WHERE. Check query plans early.
2. **Multi-tenant ready:** `org_id` column schema in place, even if single-user now. Backfill later is painful.
3. **RLS from day 1:** Row-level security on every user-facing table. Retrofitting RLS is expensive.
4. **Rate limiting:** Per-user and per-IP, even on internal endpoints. Free tier spam will ruin your day.
5. **Pagination:** Every list endpoint paginates. No `SELECT *` on tables that grow.
6. **Background jobs:** Long tasks go to queue, not request/response. Cron for periodic work.
7. **Structured logging:** JSON logs with correlation IDs. grep-friendly > pretty-printed.

## Negotiable early, critical later

- **Caching layer:** Redis/KV in front of DB. Add when query load justifies complexity.
- **CDN for static assets:** Vercel handles this. On Cloudflare/Netlify, configure explicitly.
- **Read replicas:** Only when write + read load on single DB becomes measurable.
- **Sharding:** Only at 100M+ rows. Pick multi-tenant schema first; pre-sharding is premature.
- **Microservices:** Never. Monolith with clear module boundaries scales further than you think.

## AI-specific scalability

1. **Streaming responses:** SSE for chat, don't buffer full responses.
2. **Tool-based architecture:** Modular tools can be cached, parallelized, rate-limited independently.
3. **Embedding cache:** Embeddings are expensive. Compute once, store in pgvector, reuse.
4. **Context windows are expensive:** Strip noise before LLM call. Don't stuff full DB into prompt.
5. **Memory hierarchy:** Hot (always in context) → Warm (vector search) → Cold (activity log). Don't load cold into every call.

## Cost scalability

- **Monitor token usage per endpoint.** One runaway prompt ruins the month.
- **Model routing:** Simple classifier → cheap model. Complex reasoning → expensive model.
- **Cache frequent queries:** Same question from different users → one LLM call, N cached responses.
- **Background consolidation:** autoDream pattern — consolidate memories at night, cheap model.

## Red flags (fix before launch)

- ❌ No index on foreign keys
- ❌ Single-column `users` table with no `org_id` concept
- ❌ Full-text search via `LIKE %query%` (use pg_trgm + GIN index or proper search)
- ❌ Cron running in-process on single server
- ❌ No rate limiting anywhere
- ❌ Logs are `console.log` without structure

## Test your design

Ask: "If tomorrow 1000 users sign up, what breaks first?"
- DB? → add indexes, connection pooling
- API? → rate limit, cache
- LLM costs? → routing, caching
- You? → monitoring, alerting

If the answer is "nothing, I'd need to add capacity" — you're scalable.
