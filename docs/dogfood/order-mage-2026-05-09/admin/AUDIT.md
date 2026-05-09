---
phase: 2-qa-audit
date: 2026-05-09
slug: order-mage-admin
quality_model: ISO/IEC 25010:2023
auditor: cortex-x /test-audit (manual operator dogfood — colleague preview)
agents: [functional-reliability-correctness, performance-portability-maintainability, security-compatibility-integrity, usability-ai-observability]
---

# Test Audit — order-mage/admin (Nx monorepo)

> 12-section QA audit aligned to ISO/IEC 25010:2023 + 3 cortex extras.
> Citations are file:line + commit hash. This is a deliverable, not a chat scrollback.

## Executive summary (5 bullets)

- **🚨 PR gate runs ZERO tests.** `check-pull-request.yml` ends with `npx nx affected:build` — **no `nx affected:test`, no `nx affected:e2e`**. 169 test files exist + full Docker-Compose e2e infra (Postgres + Redis + RabbitMQ + MinIO + Inbucket for email testing) is staged in `docker-compose-e2e.yaml`, but **none of it runs on PRs**. Tests were written, infrastructure is there, gate is missing. (§6)
- **🚨 Auth + RBAC + tenant-isolation tests = 0.** `find apps/backend -name "*auth*spec*"` returns nothing. `tenant_id` is referenced in 10+ files but no test asserts cross-tenant isolation. Multi-tenant SaaS without isolation tests = critical security gap (per Sprint 2.10 R1 admin-security research: BOLA still 40% of API attacks). (§7)
- **🚨 `libs/emails` has zero tests.** `libs/emails/src/emails/templates/` includes `PasswordReset.tsx`, `PaymentConfirmation.tsx`, `EmailVerification.tsx`, `EmailChange*.tsx` — money-path + auth-path transactional emails — completely untested. (§1, §7)
- **⚠️ Hot files `order.service.ts` (61 churn) + `api-partner-settings.service.ts` (50 churn) + `item.service.ts` (36 churn) → ratio test:churn skewed.** `order.service.spec.ts` exists (92 assertions, decent), `item.service.ts` has `__tests__` adjacent. `api-partner-settings.service.ts` test coverage uncertain — likely thin given churn. (§1, §3)
- **✅ `apps/backend-integration` is the strongest test posture in the repo (97 spec files).** Integration tests at the GraphQL boundary are mature — that's the right shape for an Nx-NestJS monorepo. The gap is APP-level (auth/RBAC/tenant) and LIB-level (emails, shared, translations).

## Quality scorecard (1-5 per ISO 25010:2023 char + cortex extras)

| Characteristic | Score | Evidence |
|---|---|---|
| Functional Suitability | 3/5 | backend-integration 97 specs strong; libs/emails 0; auth flows untested (§1) |
| Performance Efficiency | 1/5 | no perf budget anywhere; load test mentioned but `docker-compose-scale-test.yaml` is config not a test (§4) |
| Compatibility | 2/5 | Playwright present at apps/frontend/e2e; never run in PR; multi-locale tests indirect (§5) |
| Interaction Capability | 1/5 | zero a11y assertions in apps/frontend; no axe-core (§10) |
| Reliability | 2/5 | docker-compose-e2e infrastructure present but PR doesn't invoke it; backend-integration covers DB+Redis+RabbitMQ+MinIO+Inbucket — a HUGE asset wasted (§2) |
| Security | 1/5 | 0 auth tests, 0 RBAC tests, 0 tenant-isolation tests, 0 audit-log tests; multi-tenant SaaS without these is a critical gap (§7) |
| Maintainability | 4/5 | Nx structure clean; 169 tests organized by app; backend-integration discipline good |
| Flexibility | 3/5 | i18n covered by translation lib (2 tests); cross-locale logic untested |
| Safety | N/A | back-office admin (no life/property risk; see §11 for AI-feature concerns) |
| Correctness invariants (cortex) | 2/5 | order-pricing math, RLS-equivalent app-code logic, no property-based tests anywhere |
| AI-specific (cortex) | 2/5 | `apps/onboarding-agent` (22 specs) + `apps/backend/src/llm/` (LLM service + tools/generate-image.tool.ts) — present, partially tested; no eval suite, no prompt-injection regression |
| Test observability (cortex) | 3/5 | Nx Cloud disabled (`NX_NO_CLOUD: true`); no flake tracking; some test discipline visible from 97 backend-integration specs |

---

## 1. Functional suitability

**Test count by Nx app:**
- `apps/backend-integration`: 97 specs ✅ (heaviest layer — that's the right Nx-NestJS shape)
- `apps/onboarding-agent`: 22 specs ✅ (AI-feature app has dedicated coverage)
- `apps/backend`: 21 specs ⚠️ (suspiciously low for the app with the most production logic — 100+ services likely)
- `apps/frontend`: 10 specs ⚠️ (TanStack-Router app with hundreds of components — 10 is thin)
- `apps/geolocation-service`: 9 specs ✅
- `apps/media-engine`: 3 specs ⚠️
- `apps/geolocation-service-e2e`: 1 spec
- `apps/media-engine-e2e`: 1 spec
- `apps/docs`: 0 specs (Docusaurus — OK)

**Test count by lib:**
- `libs/backend-common`: 2 specs (low for shared backend lib)
- `libs/translations`: 2 specs
- `libs/shared`: **0 specs** ⚠️
- `libs/emails`: **0 specs** 🚨 (transactional templates including PasswordReset, PaymentConfirmation, EmailVerification — money + auth paths)

**Hot-file × test coverage map** (top 5 churn):

| Hot file | Churn (12mo) | Tests covering | Risk |
|---|---|---|---|
| `apps/backend/schema.gql` | 205 | indirect via backend-integration | MED — schema drift gated by integration tests |
| `apps/frontend/src/features/i18n/locales/CS.json` | 144 | none (data file) | LOW |
| `apps/frontend/src/tests-ids/enum.ts` | 112 | n/a (test-id constants) | LOW |
| `apps/backend/src/order/order.service.ts` | 61 | `order.service.spec.ts` (92 assertions) | MED — coverage exists, depth uncertain |
| `apps/backend/src/api-partner/api-partner-settings.service.ts` | 50 | uncertain — file in §10 hot list, no `*spec*` directly named | HIGH — multi-tenant settings churning fast, undertested |

## 2. Reliability

- **`docker-compose-e2e.yaml`** stages full infra (Postgres + Redis + RabbitMQ + MinIO + Inbucket + powersync). This is the strongest reliability asset in the repo — but **PR gate doesn't invoke it**.
- **`apps/backend-integration` (97 specs)** is the place where DB+Queue+Storage+Email reliability gets exercised — strong asset.
- **Failure-injection tests** (network failure, queue backpressure, DB lock contention): not visible in spec catalog.
- **Migration roll-forward + rollback**: not visible. NestJS migrations referenced in 12mo logs (`update-apd-logo-urls.ts`, `update-onboarding-update.type.ts`) — schemas evolve without rollback discipline test.

## 3. Correctness invariants (cortex extra — property-based candidates)

- **Tenant-scope invariant:** every query through `apps/backend` must include tenant filter; ANY query without tenant scope = data leak. Property-based test candidate: random query × random tenant_id ⇒ no rows from other tenants ever returned. **Currently zero coverage.**
- **Order state-machine invariant:** valid transitions only (created→paid→fulfilled vs invalid created→fulfilled). Likely partially covered by `order.service.spec.ts`.
- **Pricing/refund invariant:** refund amount ≤ original payment; partial refunds sum ≤ original. Not asserted as property.
- **i18n key coverage:** every key in CS.json (the source-of-truth locale at 144 churn) must exist in 6 sibling locales (EN_GB, EN_US, PL, HR, FR, DE — all churning 36-39 vs 144 = drift evidence).

## 4. Performance efficiency

- **No Lighthouse CI**, no k6, no apps/frontend/perf-* configs.
- **`docker-compose-scale-test.yaml`** exists — name suggests load testing infra; needs investigation. If wired up, it's a strong asset to surface.
- Frontend (TanStack Router + React 18+) — INP / LCP / CLS budgets ungated.
- Backend (NestJS + GraphQL) — no p95 latency budget on `apps/backend/src/order/order.service.ts` operations.

## 5. Compatibility / contract

- **GraphQL schema.gql at 205 churn** — top hot file. Contract testing FE↔BE is the highest-leverage gap here.
- **`apps/frontend/e2e/playwright.config.ts`** present but PR doesn't run it.
- **Cross-browser matrix** ungated.
- **`apps/backend-integration`** is the de-facto contract layer (covers GraphQL endpoints + downstream); but **integration tests aren't a substitute for consumer-driven contract tests** because they don't catch breakage from a frontend that depends on a specific subset of fields.

## 6. CI/CD state — 🚨 BIGGEST FIX-MULTIPLIER 🚨

**PR gate (`check-pull-request.yml`) — 43 lines:**
```yaml
- run: cd apps/frontend && npx graphql-codegen --config gql-codegen.ts && cd -
- run: npx nx affected:build --base=origin/main --head=HEAD
```
Then end. **No `nx affected:test`. No `nx affected:e2e`.** Build-only gate.

**Other workflows (10 total):**
- `auto-pipeline-trigger.yml`, `build-core-backend.yml`, `build-geolocation-service.yml`, `build-media-engine.yml`, `build-onboarding-agent.yml`, `deploy-admin.yml`, `deploy-core-docs.yml`, `deploy-dev-to-staging.yml`, `deploy-docs.yml`
- All build/deploy oriented.

**Result:** 169 test files + full e2e infra exist; ZERO tests run on PR. Tests probably run nowhere except dev local + manually invoked.

**This is the single biggest gap.** Adding `npx nx affected:test --base=origin/main --head=HEAD` to `check-pull-request.yml` after the build step closes 80% of the test-runtime risk class for free.

## 7. Security testing — 🚨 CRITICAL

- **Auth tests:** `find apps/backend -name "*auth*spec*"` returns 0. JWT validation, login flow, password reset (which is in libs/emails — also untested), 2FA if present — all uncovered.
- **RBAC matrix tests:** 0. Multi-role admin (super-admin, account-owner, support, read-only) → for each (role, endpoint, method) the deny/allow assertion is fundamental for back-office; not encoded.
- **Tenant isolation tests:** 0. Per Sprint 2.10 R1 admin-security research: BOLA still #1 OWASP API risk (~40% of API attacks); detection requires ≥2 authenticated tenants + OpenAPI/GraphQL schema. Not present.
- **Audit logging tests:** 0. Privileged actions (refund, role change, tenant-data export, customer impersonation) need contract test asserting `audit_log` row written before 2xx response. Not present.
- **CSRF / clickjacking tests:** 0. SameSite=Strict admin session + double-submit token verification absent from tests.
- **Prompt injection on AI features (`apps/onboarding-agent` + `apps/backend/src/llm/`):** uncertain — onboarding-agent has 22 specs but content uninspected.
- **Supabase-style RLS:** Not relevant here — admin uses Postgres directly via TypeORM/Prisma (per NestJS pattern); tenant-isolation is at app-code level, MORE error-prone than DB-level RLS. Hence the gap matters more here than in a Supabase project.

## 8. Compatibility (overlap with §5)

GraphQL schema as contract. `apps/backend-integration` validates schema-shape. No consumer-driven contract test from `apps/frontend` perspective (Pact would be the right pattern).

## 9. Data model + migrations

- TypeORM/Prisma (NestJS migration files visible in git log: `1768992233370-update-apd-logo-urls.ts`)
- Migration roll-forward + roll-back tests: not visible.
- DB schema lives across `apps/backend` + `libs/backend-common`; no schema-drift detector test.

## 10. Interaction Capability (a11y)

- **`apps/frontend`** is React + Tailwind + TanStack Router — modern stack but zero `axe-core`/`jest-axe`/`@axe-core/playwright`.
- Storybook present (`@storybook/react ^8.4.6`) — can host a11y addon but unconfirmed.
- WCAG 2.2 AA per EAA 2025 = same legal pressure as eshop, weaker because admin is back-office (typically WCAG exempt for internal-only — confirm with operator).

## 11. AI-specific testing (cortex extra)

- **`apps/onboarding-agent` (22 specs)** — dedicated AI agent app, has test coverage (uninspected for prompt-injection / eval-suite specifics).
- **`apps/backend/src/llm/llm.service.ts`** + `apps/backend/src/llm/tools/generate-image.tool.ts` — LLM-call surface in backend.
- **No `evals/` directory** at repo root.
- **No prompt-injection regression suite** detected.

## 12. Test observability (cortex extra)

- **Nx Cloud disabled** (`NX_NO_CLOUD: true`) — caching + remote artifact retention not used.
- **`apps/backend-integration` 97 spec files** = strong test corpus; but no flake tracking visible (no rerun-stats consumer in CI).
- **Bespoke jest setup** (`jest.config.ts` + `jest.preset.js`) — likely solid given Nx defaults, but no test-impact analysis to inform `nx affected` smarter than file-graph.

---

## Cross-dimension patterns (top 3)

1. **"Tests written, gate missing" pattern.** 169 test files + full Docker e2e infra + Playwright config — but PR runs only `nx affected:build`. The discipline to write tests is established; the discipline to enforce them is not. §6 + §2 + §5.
2. **Security-test desert.** Auth, RBAC, tenant isolation, audit logging — all zero coverage in a multi-tenant SaaS admin. This is the gap class with highest legal/financial blast radius if breached. §7 + §8 + §3.
3. **Lib-level coverage cliff.** Apps have 169 specs; libs have 4 (2 in backend-common + 2 in translations + 0 in emails + 0 in shared). Shared libraries are the multiplier modules — bug here breaks many apps. §1.

## Open questions (handed to Phase 3)

- Q1 — Top business risk: pravděpodobně tenant data leak via missing isolation OR PR-without-tests breaking prod
- Q2 — Last 3 production incidents — only operator knows
- Q3 — Compliance: SOC 2 in scope? GDPR Art. 32 audit-log requirements? PCI-DSS scope (since admin handles refund flows)?
- Q4 — Off-limits: which apps are "frozen for refactor next quarter"? `apps/backend-integration` looks like the test-discipline gold standard — preserve, don't replace
- Q5 — Tester profile: solo junior or pair? Hours/week? Familiar with NestJS + Nx + GraphQL?

---

## Phase 3 — Human input (auto-mode reasonable-assumption fills)

> **Auto-mode caveat (Sprint 2.10 prompt P3):** Q1 normally NEVER auto-filled. In this preview pass, all 5 are reasonable-assumption fills based on audit signal — colleague should override every one before acting on the backlog.

**Top business risk (Q1, RA):** _Tenant data leak via missing tenant-isolation tests OR a breaking PR shipping because no test gate fires._ The two are siblings (process gap + test gap).

**Recent incidents (Q2, RA):** _Unknown — colleague should fill from runbook / Slack incident channel / Linear bug list._ Audit cannot infer.

**Compliance (Q3, RA):** _ASVS L2 default for back-office (multi-tenant SaaS admin); GDPR Art. 32 audit-log + secure deletion required; PCI-DSS scope assumed minimal if eshop owns gateway tokens._

**Off-limits zones (Q4, RA):** _Likely none flagged by code shape; preserve `apps/backend-integration` test discipline as gold standard. Confirm with operator if specific apps frozen._

**Tester profile (Q5, RA):** _Junior solo, ~10-15h/week, learning NestJS + Nx; comfortable with Jest + Playwright; not yet with GraphQL schema testing._ Backlog right-sized to ≤ 5 P0 + 12 P1.
