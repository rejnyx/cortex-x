---
phase: 5-qa-strategy
date: 2026-05-09
slug: order-mage-admin
based_on:
  audit: cortex/qa/AUDIT.md
  research: docs/research/sprint-2.10-qa-retrofit-2026-05-09.md
quality_model: ISO/IEC 25010:2023
asvs_target: L2 (multi-tenant SaaS admin)
---

# Testing strategy — order-mage/admin (Nx monorepo), 2026-05-09

**Stack:** Nx 20 + NestJS + GraphQL + React (TanStack Router/Query) + Tailwind 4 + Postgres + Redis + RabbitMQ + MinIO + Inbucket + Storybook + Docusaurus + 9 apps + 4 libs
**Top business risk (Q1, RA):** Tenant data leak via missing isolation tests OR breaking PR shipping because no test gate fires (siblings)
**Compliance (Q3, RA):** ASVS L2; GDPR Art. 32 audit-log
**Tester capacity (Q5, RA):** Junior solo, ~12h/week, learning NestJS + Nx

---

## Pyramid target (12-month plan)

|              | Now (2026-05-09) | 3 months  | 12 months  |
|--------------|------------------|-----------|------------|
| Unit (apps)  | 169 specs        | 200-220   | 280-340    |
| Unit (libs)  | 4 specs (2/2/0/0) | 20-30   | 40-60      |
| Integration  | 97 (backend-integration alone) ✅ | maintain + 10 cross-app | + 20 |
| Contract     | 0 (Pact)         | 5 (top FE→BE GraphQL queries) | 12-18 |
| E2E          | 12 spec files (3 apps) | + 8 critical-path | + 18 |
| Mutation     | 0                | apps/backend high-risk modules at 60% | 75% on order, billing, auth |
| Property     | 0                | 6 invariants (tenant scope, order state, refund sum, RBAC matrix, i18n key, schema drift) | 12-15 |
| Perf budget  | 0                | Lighthouse + k6 on apps/frontend top 5 | + backend p95 GraphQL endpoint budgets |
| A11y         | 0                | axe-core in 5 frontend component tests + Storybook a11y addon | full WCAG 2.2 if back-office gets external users |
| AI evals     | 22 specs (onboarding-agent only) | + repo-root `evals/` + LLM service rubric | + prompt-injection regression sweep |

---

## Tool decisions (cited)

- **Unit (apps + libs):** Jest 29 (already in stack via `@nx/jest`) — keep [src: https://nx.dev/recipes/testing/jest] [research: nx-qa-unit-fitness-2026]
- **E2E:** Playwright 1.58 (already in stack at apps/frontend/e2e + apps/geolocation-service-e2e + apps/media-engine-e2e) — **wire into CI** (top fix) [src: https://playwright.dev/docs/ci-intro] [research: playwright-qa-e2e-strategy-2026]
- **Mutation:** **StrykerJS 9.6 incremental mode**, threshold 75% on `apps/backend/src/order/**` + `apps/backend/src/api-partner/**` + `libs/backend-common/**` [src: https://stryker-mutator.io/] [research: stryker-qa-mutation-fitness-2026]
- **Property-based:** **fast-check 4** for tenant-scope invariant, order state-machine, refund-sum, RBAC matrix completeness [src: https://fast-check.dev/docs/introduction/why-property-based/] [research: fast-check-qa-unit-fitness-2026]
- **Contract:** **Pact** consumer (apps/frontend) → provider (apps/backend GraphQL) — only the operations frontend actually consumes; complement existing apps/backend-integration breadth [src: https://docs.pact.io/] [research: pact-qa-contract-testing-2026]
- **Perf:** **Lighthouse CI** on apps/frontend top 5 routes + **k6** on apps/backend top 10 GraphQL operations (use existing `docker-compose-scale-test.yaml` if it's load-test infra) [research: lighthouse-qa-perf-testing-2026]
- **A11y:** **axe-core + @axe-core/playwright** in frontend E2E + jest-axe in component tests + Storybook a11y addon [research: axe-qa-a11y-testing-2026]
- **Security:** **Schemathesis** for GraphQL schema BOLA fuzzing (2 authenticated tenants + schema → cross-tenant oracle) + **OWASP ZAP** baseline scan in nightly CI [src: https://github.com/schemathesis/schemathesis] [research: admin-qa-security-testing-2026]
- **AI evals:** **promptfoo** for LLM service + onboarding-agent rubric [src: https://www.promptfoo.dev/] [research: ai-eval-qa-2026]
- **Audit log testing:** custom contract test pattern — every `@Mutation` resolver writes to `audit_log` before returning 2xx (assert via integration test layer) [research: admin-audit-log-qa-2026]

---

## CI gating philosophy

| Gate | Layer | Action |
|---|---|---|
| Block on red | `nx affected:test` (unit + integration of touched libs/apps) + critical-path E2E (login + RBAC + tenant-switch + refund + customer-impersonation) | merge blocked |
| Soft-block | mutation score regression on apps/backend high-risk > 5pp | warn |
| Soft-block | Lighthouse perf budget regression > 20% | warn |
| Inform-only | full E2E matrix, full mutation sweep, a11y score, OWASP ZAP baseline | annotate PR |
| Nightly only | Schemathesis BOLA fuzz, k6 load via docker-compose-scale-test, full Playwright matrix | non-blocking, alert |

**The single biggest CI fix:** add `npx nx affected:test --base=origin/main --head=HEAD` to `check-pull-request.yml` after the build step. This is GAP-001.

---

## Coverage thresholds (risk-tiered, mutation-aware)

| Tier | Examples | Line cov | Branch cov | Mutation score |
|---|---|---|---|---|
| **High-risk** | `apps/backend/src/order/**`, `apps/backend/src/api-partner/**`, `apps/backend/src/llm/**`, `libs/emails/src/emails/templates/Password*`, `libs/emails/src/emails/templates/PaymentConfirmation*`, auth-related modules | 80% | 70% | 75% |
| **Mid-risk** | `apps/backend/src/item/**`, `apps/onboarding-agent/**`, `apps/frontend/src/features/api/**`, `libs/backend-common/**`, `libs/shared/**` | 70% | 60% | 60% |
| **Low-risk** | `apps/frontend/src/components/[non-cart]/**`, `apps/docs/**`, `apps/frontend/src/features/i18n/locales/**` (data) | 50% | — | — (advisory) |
| **Excluded** | `**/dist/**`, `**/*.generated.ts` (graphql-codegen output), `apps/frontend/src/tests-ids/enum.ts` | — | — | — |

---

## ISO 25010:2023 9-char + 3 cortex extras targets (3-month sprint)

- **Functional Suitability:** wire `nx affected:test` into PR gate (single biggest leverage move)
- **Performance Efficiency:** Lighthouse CI on frontend top 5 + k6 on apps/backend top 10 GraphQL operations
- **Compatibility:** Pact consumer-driven contract tests for top-3 FE→BE flows (orders list, order detail, refund)
- **Interaction Capability:** axe-core in 5 frontend component tests + Storybook a11y addon
- **Reliability:** invoke `docker-compose-e2e.yaml` infra in PR (or nightly if too slow); Inbucket-backed email-flow tests for libs/emails
- **Security:** RBAC matrix property test + tenant-scope invariant property test + audit-log contract test on top-5 mutations
- **Maintainability:** mutation gate on apps/backend high-risk at 60% (start) → 75% (3 months); ratchet libs/backend-common from 0
- **Flexibility:** i18n-key-coverage property test (CS.json keys exist in 6 sibling locales)
- **Safety:** N/A unless admin opens external customer access
- **Correctness invariants:** 6 fast-check property tests (tenant, order-state, refund-sum, RBAC, i18n-key, schema-drift)
- **AI-specific:** repo-root `evals/` dir + promptfoo set for `apps/backend/src/llm/` + prompt-injection regression sweep
- **Test observability:** enable Nx Cloud (or self-hosted Nx remote cache); Playwright trace retention; flake-rerun stats consumer

---

## DevOps + CI quality gates (NEW — Sprint 2.10.1 expansion)

Testing doesn't end at unit/integration/E2E. For a 9-app Nx monorepo with 10 GHA workflows, DevOps quality is testing too.

| Concern | Tool | Gate |
|---|---|---|
| **Workflow correctness** | `actionlint`, `pinact` (action-pinning lint) | block PRs with unpinned `@main` actions |
| **Dockerfile lint** | `hadolint` | block PRs with HIGH violations on apps/*/Dockerfile |
| **Container image scan** | `Trivy` or `grype` on `build-*-backend.yml` outputs | block on CRITICAL CVE; warn on HIGH |
| **Secret scanning** | `gitleaks` in PR + nightly scan of full history | block on PR; alert on history hit |
| **SBOM generation** | `syft` per app, attached to deploy artifact | required in `deploy-admin.yml` outputs |
| **Dependency scanning** | `osv-scanner` | warn on HIGH; block on CRITICAL |
| **IaC lint** | `kubeval` / `kube-linter` on `infra/k3s/**` | block on policy violations |
| **Deploy smoke tests** | post-deploy synthetic check (login + 1 RBAC-protected query) on `deploy-dev-to-staging.yml` | block deploy success on smoke fail |
| **Observability assertion** | post-deploy: assert structured logs from healthcheck endpoint reach the log pipeline | inform-only initially, gate after baseline |
| **DORA metrics** | `dora-metrics-action` or self-hosted | dashboard for weekly review (deploy freq, lead time, change failure rate, MTTR) |

These belong in the qa-engineer concern taxonomy alongside the testing-only concerns. See updated profile.

---

## Out-of-scope (cited reasoning)

- **Don't replace Jest with Vitest in the Nx workspace** — Nx + Jest is a battle-tested pairing in 2026; migration cost > benefit for this monorepo size [src: https://nx.dev/recipes/testing/jest] [research: nx-qa-unit-fitness-2026]
- **Don't add Cypress** — Playwright already wired across 3 apps [src: https://tech-insider.org/cypress-vs-playwright-2026/] [research: playwright-qa-e2e-strategy-2026]
- **Don't add full BOLA fuzz on every PR** — Schemathesis runs nightly because it's slow; PR gate uses ≥2-tenant integration test fixture instead [src: https://github.com/schemathesis/schemathesis] [research: admin-qa-security-testing-2026]
- **Don't auto-enable Nx Cloud paid tier yet** — measure-only with `NX_NO_CLOUD: false` + free tier first; ratchet up if tester capacity scales [src: https://nx.app/]

---

## Three-month execution plan (paired with backlog in testing-gaps.md)

### Month 1 — close P0 (block-release-worthy)
- **Week 1:** GAP-001 (`nx affected:test` in PR gate), GAP-002 (RBAC matrix property test), GAP-003 (tenant-scope property test on top-5 services)
- **Week 2:** GAP-004 (libs/emails test scaffold for top-5 templates), GAP-005 (auth-flow integration tests in apps/backend-integration)

### Month 2 — close top P1 + first SKIP revisits
- **Week 3-4:** GAP-006 (audit-log contract test on top-5 mutations), GAP-007 (Pact consumer for top-3 FE→BE flows), GAP-008 (axe-core in 5 frontend component tests)
- **Week 5-6:** GAP-009 (StrykerJS on apps/backend high-risk at 60%), GAP-010 (Lighthouse CI on frontend top 5)

### Month 3 — pyramid rebalance + DevOps quality
- **Week 7-8:** ratchet StrykerJS 60% → 75%; add gitleaks + actionlint + hadolint to PR
- **Week 9-10:** invoke `docker-compose-e2e.yaml` in nightly; Inbucket-backed email-flow tests
- **Week 11-12:** re-run `/test-audit` for delta; refresh research

---

## Anti-patterns to avoid in this stack

1. **Adding more `apps/backend-integration` specs while PR doesn't run them** — fix the gate first
2. **Replacing existing 97 backend-integration specs with unit tests** — they're the right shape; don't degrade
3. **Treating `docker-compose-e2e.yaml` as docs** — it's an asset; wire it into nightly CI
4. **Ignoring `libs/emails`** — money + auth path templates; zero tests is a real risk

---

## Re-audit cadence

Re-run `/test-audit` every 3 months. Compare new `cortex/qa/AUDIT.md` to previous — diff = progress signal.
