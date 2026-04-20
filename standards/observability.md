# Observability — See What's Happening in Production

> Production without observability is flying blind. When users say "it's broken," you need to know what, where, and why within minutes, not days.

## Three Pillars

1. **Logs** — what happened
2. **Metrics** — how often, how fast
3. **Traces** — how requests flow through the system

## Logs

### Structured logging from day one

- **JSON logs**, not pretty-printed strings
- **Correlation IDs** on every request — trace a user's full journey
- **Log levels**: DEBUG (dev only), INFO (significant events), WARN (recoverable), ERROR (needs attention)
- **Never log secrets** — no passwords, tokens, API keys, PII
- **Sanitize before logging** — redact email fields, credit cards, etc.

### What to log

- Every API request (method, path, user_id, duration, status)
- Every DB query slower than threshold (e.g., 100ms)
- Every external API call (service, endpoint, latency, status)
- Every error with stack trace and context
- Significant state changes (user signup, payment, order placed)

### What NOT to log

- Every function entry/exit (noise)
- Successful reads of public data (noise)
- User passwords, tokens, PII (security)
- Giant JSON dumps without context (useless)

## Metrics

### Must-have metrics

- **Request rate** per endpoint (RPM)
- **Latency** percentiles (p50, p95, p99) per endpoint
- **Error rate** percentage per endpoint
- **DB query duration** percentiles
- **External API latency** per service
- **Token usage** per LLM endpoint (cost tracking)
- **Queue depth** for background jobs

### Derived metrics

- **Uptime** — availability over time
- **SLA compliance** — % of requests under target latency
- **Cost per user** — LLM spend / active users

## Traces

### When to use

- Debugging why a request is slow
- Understanding microservice call graphs
- Finding bottlenecks across services

### Tools

- **Vercel** — built-in trace viewer for serverless
- **OpenTelemetry** — vendor-neutral standard
- **Sentry Performance** — errors + traces
- **Jaeger / Tempo** — self-hosted trace backends

## Error monitoring

**Sentry** is the default (free tier generous). Alternatives: Rollbar, Bugsnag, LogRocket.

### Setup from day one

- `@sentry/nextjs` wizard install
- Client + server + edge configs
- `instrumentation.ts` for Next.js 16
- Source maps uploaded for production
- Enabled only in production (not dev)

### What to capture

- Unhandled errors (automatic)
- Caught errors you want visibility on (`Sentry.captureException`)
- User context (ID, org, tier) for filtering
- Release version for regression tracking

### What NOT to enable (usually)

- Session replay (expensive, only for critical paths)
- Performance tracing on every request (sample instead)

## Alerting

### Alert on user-facing symptoms, not internal metrics

- ✅ "Error rate on /api/chat > 5% for 5 min"
- ❌ "CPU > 80%"

### Alert fatigue kills alerting

- Every alert must be actionable
- Every alert must page the right person
- If an alert fires but no one acts, delete it

### Runbooks

Every alert links to a runbook:
1. What this alert means
2. First things to check
3. Common causes
4. Escalation path

## AI-specific observability

- **Token usage per endpoint** — spot runaway prompts
- **Tool call failures** — which tools fail most, why
- **Agent loop depth** — are we hitting max steps?
- **Model routing decisions** — cheap model usage %
- **Memory system health** — index rebuild success, vector search latency

## Runtime SLOs + Circuit Breakers + LLM Observability (2026)

> The section above covers logs / metrics / traces — the *inputs* to observability. This section covers the *decisions and gates* senior teams enforce on top of that data in 2026: SLOs with burn-rate alerts, performance budgets as CI gates, circuit breakers on external calls, and the dedicated LLM-observability stack.

### Burn-rate SLOs, not threshold alerts

Define 2-3 user-facing SLOs and alert on **burn rate**, not raw metrics:

- ✅ "Burning 10% of monthly error budget in 1 hour" → page now
- ❌ "p99 > 500ms for 5 minutes" → false alarms, alert fatigue

**Why:** threshold alerts fire on transient spikes. Burn-rate alerts fire when the slow bleed will actually exhaust the budget before month-end. This is the **2026 SRE consensus** (moved on from Google SRE book's threshold-centric examples).

**Tools (solo / Vercel+Supabase):** Sentry SLOs or Better Stack — $0–29/mo, no infra. Vercel Observability Plus has native SLO views.
**Tools (team / K8s):** Nobl9, Datadog SLOs, Grafana SLO (via Sloth, open-source).

**Minimum SLO set for any production project:**
1. Availability (requests that don't 5xx, >99.5%)
2. p95 latency on primary endpoints (<300ms API, <3s AI endpoints)
3. Success rate on critical flows (auth, payment, agent-completes-without-loop)

### Performance budgets as CI gates (not suggestions)

Hard-fail CI on regressions, don't just comment:

| Budget | Tool | Threshold example |
|---|---|---|
| Bundle size | `size-limit` (PR comment + fail) | <200KB gzipped initial |
| Core Web Vitals | Lighthouse CI `@lhci/cli` + `budgets.json` | LCP <2.5s, INP <200ms |
| API p95 latency | k6 smoke test with `thresholds` | p95 at 120% of baseline = fail |
| Cold start | Lambda/Vercel cold-start rate metric | <5% cold starts per 5-min window |

**Strategy:** one commit-time smoke (<30s budget), one post-deploy full load test per day. Budget regressions are caught in PR, not on Monday morning.

### Circuit breakers + timeouts on all external calls

Every external call — DB, third-party API, LLM — has **explicit timeout + circuit breaker**. No unbounded `await`.

**Solo defaults:**
- DB: 5s
- Third-party API: 10s
- LLM: 30s

**Tool (Node):** `cockatiel` (modern, TypeScript-first) or `opossum`. For LLM: AI SDK's `abortSignal` + exponential backoff retry.

**Pattern:**
```typescript
import { Policy } from 'cockatiel'
const policy = Policy.handleAll()
  .retry().attempts(3).backoff('exponential')
  .circuitBreaker(5_000, { breakAfter: 3 })

const result = await policy.execute(() => externalAPI.call(args))
```

**Why:** cascading failures are the #1 cause of total outages. When upstream slows, unbounded awaits exhaust your connection pool, then your whole service dies. One `cockatiel` line prevents it.

### LLM observability — the dedicated stack

Every LLM call traced with: tokens in/out, model, latency, cost, tool-call tree. **Cost attributed per-customer / per-feature from commit #1** (retrofitting cost attribution post-scale is a painful quarter).

| Scale | Tool | Setup | Why |
|---|---|---|---|
| Solo / MVP | **Helicone** | 15 min, proxy-based | 100k req/mo free, zero-code setup |
| Solo / self-host | **Langfuse** on Supabase | 1h | Self-hosted, data stays in your infra |
| Team | **LangSmith** | $39/user | LangChain native, rich tracing |
| Team / OTel-native | **Phoenix** (Arize) | Self-hosted, free | OTel-native, unlimited, open-source |

**Mandatory for `ai-agent` + `chatbot-platform` profiles.** Not optional.

**Signals caught:**
- Token spend spikes from runaway agent loops
- Model-routing regressions (cheap-model fall-through broken)
- p99 latency from slow tool calls (one tool blocking the whole chain)
- Cost per customer / per feature (attribution for pricing decisions)
- Eval drift (production outputs diverging from golden set)

### Solo (Vercel/Supabase) vs Team (K8s) lane split

| Concern | Solo lane | Team lane |
|---|---|---|
| SLO | Sentry SLOs / Better Stack | Nobl9 / Datadog / Grafana SLO |
| Perf budget | size-limit + Lighthouse CI + k6 smoke | + Artillery / Locust sustained |
| APM / N+1 | Sentry Performance (free N+1 detector) | Datadog APM / New Relic |
| Logs + traces | Pino + Axiom or Sentry | OTel collector → Tempo/Loki |
| Circuit breakers | `cockatiel` in-process | Istio/Envoy mesh-level |
| Chaos | Scripted `docker compose kill` in staging | Gremlin / Litmus / Chaos Mesh |
| LLM obs | Helicone (proxy) / Langfuse self-host | LangSmith / Phoenix self-host |
| Load test | k6 smoke per commit | k6 OSS cluster or Grafana Cloud k6 |

### Cargo-cult vs genuinely valuable

**Cargo-cult for small apps (don't):**
- Distributed tracing for <5 services (structured logs + request ID win)
- Chaos engineering at <10 people (Gremlin/Litmus overkill)
- Kubernetes-level SLO tools for Vercel projects (Sentry SLOs cover it)
- Full Datadog stack on a 3-person team (Sentry Perf + Vercel Observability ~$50/mo vs $200+/engineer)
- ThreadSanitizer-style race detectors in single-node Node.js (distributed locks + idempotency keys > detection tooling)

**Valuable at every scale (do from day 1):**
- Structured JSON logging (zero cost, massive debuggability)
- Performance budgets in CI (catches 100% of regressions vs ~20% in review)
- Burn-rate alerts (vs threshold alerts — 2026 SRE consensus)
- Circuit breakers on external calls (one line with `cockatiel`)
- LLM cost tracing from commit #1

### Agent-specific production concerns (2026)

- **Token budget tracking** — per session, per user, hard kill-switch (OWASP LLM10 Unbounded Consumption)
- **Model routing latency** — measure; cheap-model fall-through breaks silently
- **Tool call timeout handling** — 30s per tool, aggregate agent-session cap
- **Context-window management** — log context-size per step; regressions spike cost
- **LLM API rate limit handling** — retry with exponential backoff + jitter; alert on 429 rate
- **Cost-per-request observability** — traced alongside latency, visible in dashboard, not a spreadsheet

### Runtime SLO + circuit breaker red flags

- ❌ Threshold alerts still in use (migrate to burn-rate)
- ❌ No performance budgets in CI (regressions ship silently)
- ❌ Any `await fetch(...)` without timeout + circuit breaker
- ❌ No circuit breaker on LLM / third-party API → cascading failure waiting
- ❌ LLM cost not attributed per-user/feature (can't make pricing decisions)
- ❌ Token spend dashboard lives in someone's spreadsheet, not in APM
- ❌ `stopWhen` missing from agent loop → runaway cost incident
- ❌ Cold start rate not tracked (Vercel default: 5% is the upper bound)

## Red flags

- ❌ `console.log` in production (unstructured, can't query)
- ❌ No request correlation IDs (can't trace user journeys)
- ❌ Error monitoring disabled "because it's noisy" (fix the noise, don't hide)
- ❌ Metrics dashboard no one looks at (delete or integrate into review)
- ❌ Alerts that fire 100x/day (tune or delete)

## Getting started

1. Ship with structured logger (`pino` or `winston` or custom)
2. Add Sentry from first production deploy
3. Vercel Analytics for basic metrics (free)
4. Add custom metrics as you hit real problems
5. Alerting after first real incident (learned what matters)

## Verification

- Can you trace a specific user's request from click to DB query? (yes → good)
- Can you answer "what's the p95 latency on /api/chat?" in 30 seconds? (yes → good)
- Do you know when a deploy breaks something within 5 minutes? (yes → good)
