# Performance — Fast by Default

> Performance is a feature. Slow apps lose users. Performance debt compounds and is expensive to pay back.

## Frontend

### Initial load

- **Core Web Vitals targets (2026):**
  - **LCP** (Largest Contentful Paint) < 2.5s
  - **INP** (Interaction to Next Paint) < 200ms
  - **CLS** (Cumulative Layout Shift) < 0.1
- **Bundle size:** initial JS < 200KB gzipped. Per-route < 100KB additional.
- **Critical CSS inline.** Don't block render on stylesheet fetch.
- **Lazy load heavy libs.** Recharts (~280KB), dnd-kit (~40KB), Monaco (~3MB) → `next/dynamic({ ssr: false })`.
- **Image optimization.** Next.js `<Image>`, Astro `<Image>`, WebP/AVIF, responsive sizes.
- **Font loading.** `font-display: swap`, preload critical weights, limit to 2-3 families.

### Runtime

- **Memoize expensive computations** — `useMemo` / `useCallback` where profiler shows wins. Don't cargo-cult.
- **Virtualize long lists** — `react-window` / `tanstack-virtual` for 100+ item lists.
- **Debounce inputs** — search, autocomplete (300ms default).
- **Throttle scroll handlers** — 16ms (60fps budget).
- **Avoid layout thrashing** — batch reads then writes, don't interleave.

### Perceived performance

- **Skeletons > spinners** for content-heavy loading
- **Optimistic UI** — show expected state, rollback on failure
- **Streaming** — SSE for chat, stream HTML for SSR (React 19 RSC)
- **Prefetch on hover** — `<Link prefetch>` in Next.js

## Backend

### API response time

- **p95 < 300ms** for data endpoints
- **p95 < 1s** for compute endpoints
- **p95 < 3s** for AI endpoints (streaming mitigates)

### Database

- **Index every foreign key** — PostgreSQL doesn't auto-index FKs
- **Index every column used in WHERE** — check `EXPLAIN` plans
- **Avoid N+1 queries** — use JOINs or batch fetches
- **Paginate everything** — `LIMIT/OFFSET` or cursor-based for stable lists
- **Denormalize when needed** — precompute counts, don't `COUNT(*)` on every request
- **Connection pooling** — use Supavisor (Supabase) or PgBouncer

### Caching layers

- **HTTP cache** — `Cache-Control` headers for static/CDN content
- **Server cache** — Redis/KV for expensive queries
- **Edge cache** — Vercel Edge Config, Cloudflare KV
- **Client cache** — TanStack Query, SWR (stale-while-revalidate)

### Background work

- **Async anything slow** — emails, image processing, report generation → queue
- **Cron for periodic** — not in-process setInterval
- **Streaming for long responses** — don't buffer, stream

## AI-specific performance

- **Streaming responses always** — SSE for chat, never buffer
- **Model routing** — classifier → cheap model / complex → expensive
- **Prompt caching** — Anthropic prompt caching cuts cost 90% on repeated prefixes
- **Embedding cache** — compute once, store in pgvector, reuse
- **Reduce context** — strip noise before LLM call
- **Parallel tool calls** — when possible, call tools concurrently
- **Cost per request tracking** — alert on spikes

## Bundle analysis

```bash
npx @next/bundle-analyzer      # Next.js
npx vite-bundle-visualizer     # Vite
npx source-map-explorer        # Generic
```

Review bundle every major feature add. Regressions are hard to un-do after launch.

## Rules

1. **Measure before optimizing.** "I think this is slow" → profile first. Intuition is often wrong.
2. **Optimize the slow thing, not the easy thing.** p95 > p50 matters more than average.
3. **Lighthouse in CI.** Score below threshold → fail build.
4. **Load test before launch.** k6 against production-like infra, find the cliff.
5. **Ship fast, optimize as you grow.** Don't over-engineer day one. But don't ship slow either.

## Red flags

- ❌ `SELECT * FROM users` — returning all columns always
- ❌ `COUNT(*)` on every request for metrics (precompute)
- ❌ Full table scan in query plan (missing index)
- ❌ Sync `fs.readFileSync` in hot path
- ❌ Blocking main thread (> 50ms single task)
- ❌ Giant component re-rendering on every keystroke
- ❌ Unindexed filter on large table (> 10k rows)

## Verification

```bash
npm run build                                # production bundle
npx lighthouse https://prod.example.com      # real-world score
npm run analyze                              # bundle breakdown
k6 run load-tests/main.js                    # p95 under load
```

Targets:
- Lighthouse Performance > 90
- Initial JS bundle < 200KB
- p95 API latency < 300ms
- Zero blocking main thread tasks > 100ms
