# Security — Layered Defense from Day One

> Assume every input is hostile. Defend at every boundary. Never trust, always verify.

## Non-negotiables

1. **No secrets in git.** `.env` in `.gitignore` from first commit. Pre-commit hook blocks accidental commits.
2. **RLS on every user table.** Row-level security enforced at DB layer, not just app layer.
3. **Auth on every non-public route.** Middleware/proxy checks session before route handler runs.
4. **Input validation at boundaries.** Zod schemas on API routes, form submissions, URL params.
5. **Output sanitization.** Never interpolate user input into HTML without escaping. React does this; raw SQL doesn't.
6. **HTTPS only.** No mixed content, HSTS header, secure cookies.
7. **CSP header.** Content Security Policy allowlist for script/style sources.
8. **Rate limiting.** Per-user and per-IP on every endpoint, not just auth.

## 8-layer defense model (adapt from RELO)

```
Layer 1: Network       → HTTPS, HSTS, CSP, CORS allowlist
Layer 2: Auth          → Session validation, OAuth state check
Layer 3: Authorization → RLS + app-layer permission check
Layer 4: Input         → Zod validation, MIME type whitelist, file size limits
Layer 5: Rate limit    → Per-user + per-IP + per-endpoint
Layer 6: Logging       → Audit log for sensitive ops, correlation IDs
Layer 7: Secrets       → .env.local, vault, rotating keys
Layer 8: Monitoring    → Sentry errors, anomaly detection, alert on spikes
```

## OWASP Top 10 checklist

1. **Broken Access Control** → RLS + auth middleware
2. **Cryptographic Failures** → HTTPS, hash passwords (bcrypt/argon2), encrypt sensitive data at rest
3. **Injection** → Parameterized queries, Zod validation, no `eval`
4. **Insecure Design** → Threat model before building auth, payment, file upload
5. **Security Misconfiguration** → CSP, secure headers, no default credentials
6. **Vulnerable Components** → `npm audit`, Dependabot, update weekly
7. **Identification Failures** → Strong session management, CSRF tokens for mutations
8. **Software Integrity** → Verify webhook signatures, SRI for CDN scripts
9. **Logging Failures** → Structured logs, never log secrets, audit trail for auth events
10. **SSRF** → Allowlist for outbound requests, no user-provided URLs fetched server-side

## AI-specific security

1. **Prompt injection defense.** System prompt instructs to refuse injections. Validate tool call args.
2. **Tool permission scoping.** AI tools limited to their domain (query vs mutate vs admin).
3. **Cost protection.** Quota per user, alert on spike, cut off at limit.
4. **Output filtering.** Never return raw DB errors to user. Map to generic messages.
5. **Model output sanitization.** Treat LLM output as user input for downstream consumers.

## Secrets management

- **Development:** `.env.local` (gitignored)
- **Production:** Vercel env vars / Supabase vault / AWS Secrets Manager
- **Rotation:** Rotate API keys every 90 days. Critical keys (Stripe, auth) on incident.
- **Never:** Hardcoded, commented out, in docs, in logs, in error messages

## Red flags

- ❌ `SUPABASE_SERVICE_ROLE_KEY` used in browser code
- ❌ `dangerouslySetInnerHTML` with user input
- ❌ Raw SQL with string concatenation
- ❌ `cors: "*"` in production
- ❌ Error responses leaking stack traces
- ❌ No auth check "because this is internal"
- ❌ User input in URL passed to `fetch()` server-side without allowlist

## Incident response

When something leaks:
1. Rotate affected credentials immediately
2. Audit log for unauthorized access
3. Notify affected users (GDPR: within 72h)
4. Post-mortem: what broke, why, how to prevent recurrence
5. Update this doc with lesson learned
