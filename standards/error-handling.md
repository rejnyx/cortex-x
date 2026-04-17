# Error Handling — Fail Gracefully, Recover Automatically

> Errors are a fact of life: networks fail, APIs time out, users type weird things. The question isn't "will errors happen" but "how does the app respond."

## Core principles

1. **Fail fast at boundaries, fail gracefully inside.** Validate at API entry, crash early. Within the app, catch and recover.
2. **Errors are data.** Classify them, log them, monitor them. Don't just `throw`.
3. **Users see helpful messages, not stack traces.** Map internal errors to user-facing language.
4. **Every error has a recovery path.** Retry, fallback, degrade, or ask for help.

## Error classification

Classify every error at creation time:

| Type | Description | User-facing action |
|------|-------------|--------------------|
| **timeout** | Operation exceeded time limit | Retry automatically, then prompt |
| **auth** | Missing/invalid credentials | Redirect to login |
| **not_found** | Resource doesn't exist | "Not found" page with search/back |
| **validation** | User input invalid | Inline field errors |
| **rate_limit** | Too many requests | "Try again in X seconds" |
| **permission** | Authz denied | "You don't have access" + contact |
| **external** | Third-party API failed | Retry, then degrade or queue |
| **internal** | Our bug | Generic "something went wrong" + Sentry |

## Patterns

### Error boundaries (React)

- Wrap **every route** in an error boundary
- Wrap **risky widgets** (chart, editor, third-party embeds)
- Fallback UI shows: message, retry button, contact link
- Log to Sentry with component tree context

### Safe tool pattern (AI agents)

- Tools **never throw** — wrap in try/catch
- Return `{ success: true, data }` or `{ success: false, error: { code, message } }`
- AI reads error, attempts recovery with alternative tool
- Failure patterns stored in memory for learning

### Retry with backoff

```ts
// Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
for (let attempt = 0; attempt < 5; attempt++) {
  try {
    return await operation()
  } catch (err) {
    if (!isRetryable(err)) throw err
    await sleep(100 * Math.pow(2, attempt))
  }
}
```

- **Retry on:** network errors, 5xx, 429 rate limit, timeout
- **Don't retry on:** 4xx (except 429), validation errors, auth errors
- **Cap retries** to prevent infinite loops (5 max)
- **Jitter** on backoff to avoid thundering herd

### Circuit breaker

When external service fails repeatedly:
1. **Closed** — normal operation
2. **Open** — fail fast, don't call service (after N consecutive failures)
3. **Half-open** — test recovery with one request, close if successful

Prevents cascade failures when a dependency is down.

### Graceful degradation

- **Search service down?** Show cached results
- **Analytics down?** Show "stats unavailable" but keep core app working
- **LLM down?** Fall back to template response or secondary provider
- **Image optimization down?** Serve original

## User-facing errors

### Good error messages

- **Specific** — "Email je již registrován" > "Chyba"
- **Actionable** — "Zkuste jiný email" > "Zkus to znovu"
- **Honest but not technical** — "Nepodařilo se připojit" > "ECONNREFUSED"
- **In user's language** — Czech for Czech UI

### Bad error messages

- ❌ "Error" (no context)
- ❌ "Undefined is not a function" (leaked stack trace)
- ❌ "500 Internal Server Error" (not actionable)
- ❌ "SyntaxError: Unexpected token '<'" (developer babble)

## Logging errors

### Always log

- Stack trace
- User ID (if known)
- Request ID (correlation)
- Relevant input (sanitized — no passwords)
- Timestamp
- Environment (prod, staging, dev)

### Never log

- Full request bodies (PII risk)
- Passwords, tokens, API keys
- Credit card numbers
- Health data (HIPAA-like)

## API error responses

Consistent envelope:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Email is required",
    "field": "email",
    "requestId": "req_abc123"
  }
}
```

- **`code`** — machine-readable, stable
- **`message`** — human-readable, short
- **`field`** — for validation errors
- **`requestId`** — for support tickets

## Client-side error handling

### React patterns

- **Error boundaries** for render errors
- **TanStack Query** `onError` for fetch errors
- **Toast notifications** for transient errors
- **Inline field errors** for validation
- **Redirect** for auth errors

### Don't

- ❌ `alert('Error!')` — blocks UI, feels 1995
- ❌ Silent fail — user doesn't know it failed
- ❌ Page reload on any error — loses state
- ❌ Block all interaction on non-critical errors

## AI-specific error handling

- **Tool errors never crash agent** — wrap in safe-tool
- **LLM rate limits** — retry with backoff, fall back to cheaper model
- **Context window exceeded** — trigger compaction, retry
- **Prompt injection detected** — refuse, log, don't execute
- **Cost limit hit** — reject with clear message, admin alert

## Testing error paths

Your test suite must cover:
- Network failure (MSW to simulate)
- Invalid input (empty, null, too long, wrong type)
- Unauthorized access (missing token, wrong role)
- Rate limit (simulate 429)
- External service down (mock 500s)
- Timeout (slow response)
- Database failure (connection dropped)

## Red flags

- ❌ `try { } catch (e) { console.log(e) }` — silent swallowing
- ❌ Every function wrapped in try/catch "just in case" — hides bugs
- ❌ Errors returned as `any` — no classification
- ❌ User sees "Something went wrong" for everything
- ❌ No retry logic on external APIs
- ❌ Sentry disabled in production (can't see what's breaking)

## Verification

- Crash a component → does error boundary catch it?
- Block network in DevTools → do fetches retry gracefully?
- Submit invalid form → are errors inline, specific, in Czech?
- Kill DB connection → does API return helpful error (not stack trace)?
- Trigger rate limit → do subsequent requests show helpful message?
