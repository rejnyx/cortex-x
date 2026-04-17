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
