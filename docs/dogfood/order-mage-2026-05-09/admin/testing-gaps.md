---
phase: 5-qa-gaps
date: 2026-05-09
slug: order-mage-admin
based_on:
  audit: cortex/qa/AUDIT.md
  research: docs/research/sprint-2.10-qa-retrofit-2026-05-09.md
quality_model: ISO/IEC 25010:2023
asvs_target: L2 (multi-tenant SaaS admin)
---

# Testing gaps — order-mage/admin (Nx monorepo), 2026-05-09

**Stack:** Nx 20 + NestJS + GraphQL + React (TanStack) + Postgres + Redis + RabbitMQ + MinIO + Inbucket
**Q1 top risk (RA):** Tenant data leak via missing isolation tests OR breaking PR shipping (sibling root cause: PR gate runs zero tests)
**Tester profile (Q5, RA):** Junior solo, ~12h/week, learning NestJS + Nx + GraphQL
**Compliance (Q3, RA):** ASVS L2; GDPR Art. 32 audit-log

---

## P0 — block-release-worthy (must close before next prod release)

- **GAP-001** — **Wire `nx affected:test` into PR gate.** Add 1 line after the build step in `.github/workflows/check-pull-request.yml`: `- run: npx nx affected:test --base=origin/main --head=HEAD --parallel=3`. **Type:** missing-CI-gate. **Risk if unfixed:** 169 test files exist, run nowhere on PR — any commit can break tests and ship. THE highest-leverage 1-line fix in the entire backlog. **Estimate:** 1-2h (with cache tuning + matrix split if too slow). **Owner skill:** junior solo OK with Nx + GHA. [audit: §6] [src: https://nx.dev/recipes/ci/monorepo-ci-github-actions] [research: nx-qa-ci-gate-2026]

- **GAP-002** — **RBAC matrix property test** — table `(role, endpoint, method) → expected_status` for top-3 admin operations (refund-order, change-tenant-settings, export-customer-data). Generated from a CSV checked into repo. **Type:** missing-security-test. **Risk if unfixed:** broken access control = #1 OWASP API risk; back-office without RBAC tests is critical security gap. **Estimate:** 6-8h. **Owner skill:** junior with table-driven test pattern. [audit: §7] [src: https://owasp.org/API-Security/] [research: admin-qa-security-testing-2026]

- **GAP-003** — **Tenant-scope invariant property test** — fast-check generates random `(tenant_a, tenant_b, query)` triples, asserts queries scoped to tenant_a never return tenant_b data. Apply to top-5 services in `apps/backend/src/`. **Type:** missing-tenant-isolation-test. **Risk if unfixed:** multi-tenant SaaS without isolation tests = data-leak waiting class; BOLA detection requires ≥2 authenticated tenants per Sprint 2.10 R1 research. **Estimate:** 6-8h. **Owner skill:** junior with fast-check intro + Nest test fixture. [audit: §3, §7] [src: https://arxiv.org/html/2604.00702v1] [research: admin-qa-security-testing-2026]

- **GAP-004** — **libs/emails test scaffold for top-5 templates** (PasswordReset, EmailVerification, PaymentConfirmation, EmailChangeNew, EmailChangeOld). Render-snapshot + locale-coverage assertions. **Type:** missing-money-path-coverage. **Risk if unfixed:** transactional email regression invisible — broken PaymentConfirmation = customer support flood. **Estimate:** 4-6h. **Owner skill:** junior with `@testing-library/react` for `@react-email`. [audit: §1, §7] [research: email-template-qa-2026]

- **GAP-005** — **Auth-flow integration tests** in `apps/backend-integration` — login (success + 4 error codes), logout, token refresh, password reset (full email flow via Inbucket from docker-compose-e2e), 2FA if present. **Type:** missing-auth-coverage. **Risk if unfixed:** zero auth tests in a NestJS multi-tenant SaaS; auth bugs ship blind. **Estimate:** 8-10h. **Owner skill:** junior with NestJS `@nestjs/testing` + Inbucket API. [audit: §7] [src: https://owasp.org/www-project-application-security-verification-standard/] [research: admin-qa-security-testing-2026]

---

## P1 — sprint-worthy (close in next 2-week sprint)

- **GAP-006** — **Audit-log contract test** on top-5 admin mutations (refund, role-change, tenant-export, customer-impersonate, tenant-delete). Pattern: every mutation writes `audit_log(actor_id, action, target_id, before, after)` row before responding 2xx. **Type:** missing-compliance-test. **Risk:** GDPR Art. 32 + SOC 2 require audit-log; admins lying to logs is now an attack class (Fortuna 2026). **Estimate:** 4-6h. **Owner skill:** junior. [audit: §7] [src: https://andreafortuna.org/2026/05/04/when-ai-lies-to-its-own-logs-forensic-readiness/] [research: admin-audit-log-qa-2026]

- **GAP-007** — **Pact consumer test for top-3 FE→BE GraphQL operations** (orders list, order detail, refund). **Type:** missing-contract-test. **Risk:** schema.gql at 205 churn/12mo + 6 locales drifting + 9 apps consuming = type drift highly likely. **Estimate:** 6-8h. **Owner skill:** junior + Pact docs. [audit: §5, §8] [src: https://docs.pact.io/] [research: pact-qa-contract-testing-2026]

- **GAP-008** — **axe-core in 5 frontend component tests** (orders-table, refund-modal, customer-detail, settings-form, login-form). **Type:** missing-a11y-baseline. **Risk:** if admin opens external user access (support agent role, vendor portal), WCAG 2.2 AA exposure. **Estimate:** 4h. **Owner skill:** junior with `@axe-core/react`. [audit: §10] [src: https://github.com/dequelabs/axe-core-npm] [research: axe-qa-a11y-testing-2026]

- **GAP-009** — **StrykerJS at 60% threshold on `apps/backend/src/order/**` + `apps/backend/src/api-partner/**` + `libs/backend-common/**`** (the 3 highest-churn / highest-risk modules). **Type:** missing-mutation-fitness. **Risk:** 169 tests pass + zero verification they actually verify the right invariants; Trail of Bits 2026: "mutation testing is the missing safety net for AI-generated code". **Estimate:** 6-8h (config + first run baseline). **Owner skill:** junior with StrykerJS docs. [audit: §3] [src: https://stryker-mutator.io/] [research: stryker-qa-mutation-fitness-2026]

- **GAP-010** — **Lighthouse CI on apps/frontend top 5 routes** + INP/LCP/CLS budgets. **Type:** missing-perf-budget. **Risk:** admin used heavily by support agents during peak — laggy = support-time multiplier. **Estimate:** 3-4h. **Owner skill:** junior. [audit: §4] [src: https://contextqa.com/blog/performance-testing-tools-2026/] [research: lighthouse-qa-perf-testing-2026]

- **GAP-011** — **Wire `docker-compose-e2e.yaml` into nightly CI** — runs full Postgres+Redis+RabbitMQ+MinIO+Inbucket stack, then runs `apps/frontend/e2e/` Playwright suite + e2e suites of geolocation-service + media-engine. **Type:** missing-E2E-in-CI. **Risk:** the e2e infra exists fully staged but never runs in CI; unit pass means little when integrated stack untested. **Estimate:** 6-8h. **Owner skill:** junior with docker-compose + GHA services. [audit: §2, §6] [research: nx-qa-e2e-ci-2026]

- **GAP-012** — **i18n-key-coverage property test** — every key in `CS.json` (144 churn, source-of-truth) must exist in EN_GB, EN_US, PL, HR, FR, DE. **Type:** missing-data-completeness-test. **Risk:** locale drift evidence in churn ratio (CS 144 vs PL/HR/FR/DE all 36); Czech keys land without translations. **Estimate:** 1-2h. **Owner skill:** junior. [audit: §3, §11] [research: fast-check-qa-unit-fitness-2026]

- **GAP-013** — **Order state-machine property test** — fast-check generates random transition sequences, asserts only valid transitions allowed (created→paid→fulfilled vs invalid created→fulfilled). **Type:** missing-correctness-invariant. **Risk:** order.service.ts at 61 churn — state machine evolves; example tests can miss invalid sequences. **Estimate:** 3-4h. **Owner skill:** junior with fast-check `@fast-check/state-machine`. [audit: §3] [src: https://fast-check.dev/docs/advanced/model-based-testing/] [research: fast-check-qa-unit-fitness-2026]

- **GAP-014** — **Schemathesis BOLA fuzz** in nightly CI against `/api/admin/**` GraphQL schema with 2-tenant fixture. **Type:** missing-security-fuzz. **Risk:** automated BOLA detection requires ≥2 users + schema; manual review can't replace it. **Estimate:** 4-6h. **Owner skill:** junior with Schemathesis docs. [audit: §7] [src: https://github.com/schemathesis/schemathesis] [research: admin-qa-security-testing-2026]

- **GAP-015** — **Repo-root `evals/` directory + promptfoo rubric** for `apps/backend/src/llm/llm.service.ts` + `apps/backend/src/llm/tools/generate-image.tool.ts`. **Type:** missing-AI-eval-suite. **Risk:** LLM regression invisible without eval rubric; onboarding-agent (22 specs) covers ITS scope but not the new llm.service. **Estimate:** 4-6h. **Owner skill:** junior with promptfoo. [audit: §11] [src: https://www.promptfoo.dev/] [research: ai-eval-qa-2026]

- **GAP-016** — **libs/shared test scaffold** — currently 0 tests in a shared lib used across apps. Identify top-5 most-imported modules, ship 1 test each. **Type:** missing-shared-lib-coverage. **Risk:** shared bugs break many apps. **Estimate:** 4-6h. **Owner skill:** junior. [audit: §1] [research: nx-qa-unit-fitness-2026]

---

## P1 — DevOps + CI quality (NEW per operator-requested 2.10.1 expansion)

These belong in the test backlog because broken CI/DevOps = test confidence undermined.

- **GAP-017** — **`gitleaks` in PR + nightly history scan**. **Type:** missing-secret-detection. **Risk:** committed secrets leak into git history; nightly scan needed because PR-only misses pre-existing leaks. **Estimate:** 2h. [src: https://github.com/gitleaks/gitleaks] [research: ci-qa-secret-detection-2026]

- **GAP-018** — **`actionlint` in PR** — lints all 10 GHA workflows. **Type:** missing-workflow-correctness-gate. **Risk:** broken workflows ship; e.g. expression typo means a build never runs but PR shows green. **Estimate:** 1-2h. [src: https://github.com/rhysd/actionlint] [research: ci-qa-pipeline-testing-2026]

- **GAP-019** — **`hadolint` Dockerfile lint in PR** — block on HIGH violations. **Type:** missing-container-quality-gate. **Risk:** Dockerfile drift; e.g. `apt-get` without `--no-install-recommends` bloats images, leaks deps. **Estimate:** 1h. [src: https://github.com/hadolint/hadolint] [research: container-qa-security-2026]

- **GAP-020** — **`Trivy` image scan** on outputs of `build-core-backend.yml` etc. Block on CRITICAL CVE; warn on HIGH. **Type:** missing-image-security-scan. **Risk:** runtime CVEs in NestJS/node images go undetected. **Estimate:** 2h. [src: https://github.com/aquasecurity/trivy] [research: container-qa-security-2026]

- **GAP-021** — **`osv-scanner` dependency vulnerability scan in PR**. Block on CRITICAL. **Type:** missing-dep-vuln-gate. **Risk:** 169 deps in admin × 9 apps = constant CVE surface. **Estimate:** 1h. [src: https://google.github.io/osv-scanner/] [research: dep-qa-vulnerability-2026]

- **GAP-022** — **`kubeval` / `kube-linter` on `infra/k3s/**` YAMLs**. Block on policy violations. **Type:** missing-IaC-lint. **Risk:** churn on `infra/k3s/dev/patch-backend-pod.yaml` is 463/12mo (top hot file overall) — silent IaC drift. **Estimate:** 2h. [src: https://github.com/stackrox/kube-linter] [research: iac-qa-kube-linter-2026]

- **GAP-023** — **Post-deploy smoke synthetic check** on `deploy-dev-to-staging.yml` — login + 1 RBAC-protected query + 1 audit-log row write. Block deploy success on smoke fail. **Type:** missing-deploy-safety-gate. **Risk:** deploys complete "successfully" while runtime is broken. **Estimate:** 3-4h. [research: deploy-safety-qa-2026]

---

## P2 — backlog (close opportunistically, track but don't gate)

- **GAP-024** — Nx Cloud (free tier) for remote cache + flake tracking. [audit: §12] [src: https://nx.app/] [research: test-observability-qa-2026]
- **GAP-025** — DORA metrics dashboard (deploy freq, lead time, change failure rate, MTTR). [research: dora-metrics-qa-2026]
- **GAP-026** — Storybook a11y addon enabled. [audit: §10] [research: axe-qa-a11y-testing-2026]
- **GAP-027** — SBOM generation (`syft`) per app, attached to deploy artifact. [research: container-qa-security-2026]
- **GAP-028** — Visual regression via Playwright `toHaveScreenshot()` for orders-table + refund-modal. [research: playwright-qa-visual-2026]

---

## SKIP — researched and intentionally NOT recommended (cited)

- **Don't replace Jest with Vitest in Nx workspace** — battle-tested pairing in 2026; migration cost > benefit at this monorepo size [src: https://nx.dev/recipes/testing/jest] [research: nx-qa-unit-fitness-2026]

- **Don't add full GraphQL schema fuzz on every PR** — Schemathesis runs nightly because slow; PR uses ≥2-tenant integration fixture instead [src: https://github.com/schemathesis/schemathesis] [research: admin-qa-security-testing-2026]

- **Don't migrate apps/onboarding-agent's existing 22 specs** — preserve as-is; add eval suite alongside, not replace [research: ai-eval-qa-2026]

- **Don't enable Nx Cloud paid tier yet** — measure free tier first [src: https://nx.app/]

---

## OPEN QUESTIONS (sources disagree or context-dependent — operator decides)

- **`docker-compose-e2e.yaml` in PR vs nightly?** Recommendation lean: **nightly + on-demand label `e2e-required` for PRs touching backend**. Full e2e on every PR is too slow for solo junior cadence. [src A: https://nx.dev/recipes/ci/monorepo-ci-github-actions] vs [src B: docker-compose run-time empirical]

- **WCAG 2.2 AA scope for back-office?** Recommendation lean: **AA if ANY external user role exists (vendor, support agent, customer self-service)**, else **A baseline**. Operator confirms user roles. [src A: https://www.w3.org/WAI/standards-guidelines/wcag/] vs [src B: EAA 2025 scope analysis]

- **Pact vs `apps/backend-integration` extension?** Recommendation lean: **add Pact** for the FE-consumer-driven angle that integration tests can't catch (subset-of-fields breakage). [src A: https://docs.pact.io/] vs [src B: https://www.speakeasy.com/blog/pact-vs-openapi]

---

## Off-limits zones (Phase 3 Q4 RA) — flagged but NOT actionable

- FYI: Preserve `apps/backend-integration` test discipline (97 specs at integration layer) as gold-standard; do NOT replace with unit-only tests. — flagged in audit §1, §2; preserved per Q4 RA.

---

## Progress meta

- **Total gaps surfaced:** 28
- **P0:** 5 | **P1:** 11 | **P1 DevOps/CI:** 7 | **P2:** 5
- **SKIPs (cited):** 4
- **OPEN:** 3
- **Off-limits FYI:** 1
- **Quality scorecard summary** (from audit): Functional 3/5, Performance 1/5, Compatibility 2/5, Interaction 1/5, Reliability 2/5, **Security 1/5** (lowest), Maintainability 4/5, Flexibility 3/5, Correctness 2/5, AI 2/5, Test-obs 3/5

**The Security 1/5 score is the headline.** GAP-001 (CI gate) + GAP-002 (RBAC) + GAP-003 (tenant) + GAP-005 (auth) + GAP-006 (audit-log) close it.

Re-audit `/test-audit` in 3 months to measure progress.
