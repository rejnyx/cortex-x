---
phase: 5-qa-gaps
date: 2026-05-09
slug: order-mage-eshop
based_on:
  audit: cortex/qa/AUDIT.md
  research: docs/research/sprint-2.10-qa-retrofit-2026-05-09.md
quality_model: ISO/IEC 25010:2023
asvs_target: L1 (escalates to L2 if EU shipping core)
---

# Testing gaps — order-mage/eshop, 2026-05-09

**Stack:** Next.js 16 + Vitest + Playwright + Anthropic SDK + 4 Czech payment gateways + i18n cs/sk/en/en-GB
**Q1 top risk (RA):** End-to-end checkout-to-paid silently breaking
**Tester profile (Q5, RA):** Junior solo, ~10h/week
**Compliance (Q3, RA):** ASVS L1; WCAG 2.2 AA per EAA 2025-06-28 if EU shipping core

> Backlog format: `GAP-NNN — title. Type: <missing-X>. Risk if unfixed: <one sentence>. Estimate: <Xh>. Owner skill: <profile>. [audit: §N] [src: URL] [research: topic-name]`
>
> Three-hop traceability is mandatory: every gap traces claim → finding ID (audit § OR research topic) → source URL.

---

## P0 — block-release-worthy (must close before next prod release)

- **GAP-001** — **Wire Playwright into CI on PR**. **Type:** missing-CI-gate. **Risk if unfixed:** any commit can break full E2E and ship undetected because PR gate runs nothing today (qa-eval.yml runs only on push to main + only vitest). **Estimate:** 3-4h. **Owner skill:** junior solo OK with Playwright + GHA basics. [audit: §6] [src: https://playwright.dev/docs/ci-intro] [research: nextjs16-qa-e2e-strategy-2026]

- **GAP-002** — **Full guest-checkout E2E flow** (cart → delivery → payment-method → ComGate sandbox → confirmation). **Type:** missing-critical-path-E2E. **Risk if unfixed:** money path can break silently — venue closed/outage states are tested but the END-to-end happy path isn't. **Estimate:** 6-8h. **Owner skill:** junior with Playwright trace tooling. [audit: §1, §2] [src: https://crystallize.com/blog/e2e-checkout-flow] [research: nextjs16-qa-e2e-strategy-2026]

- **GAP-003** — **StrykerJS at 60% on payment-gateway provider modules** (Comgate/CSOB/GPWebPay/Teya). **Type:** missing-mutation-fitness. **Risk if unfixed:** unit tests pass but actually verify weak invariants — Trail of Bits 2026: "coverage % gameable by AI; mutation score is the honest fitness function". **Estimate:** 4-6h (config + first run baseline). **Owner skill:** junior with StrykerJS docs. [audit: §3, §7] [src: https://stryker-mutator.io/docs/stryker-js/configuration/] [research: stryker-qa-mutation-fitness-2026]

- **GAP-004** — **axe-core a11y in 5 critical-flow component tests** (cart-summary-box, product-detail-v2, cart-delivery-box, cart-items-list-summary-box, order-modal). **Type:** missing-a11y-baseline. **Risk if unfixed:** EAA 2025-06-28 deadline for EU e-commerce; non-compliance = legal exposure for Czech/Slovak/EU shipping. **Estimate:** 4h. **Owner skill:** junior, axe-core has good defaults. [audit: §10] [src: https://github.com/dequelabs/axe-core-npm] [research: axe-qa-a11y-testing-2026]

- **GAP-005** — **Prompt-injection eval for `ai-tool-executor`** + 3 negative tests (LLM output asks for forbidden tool, LLM output asks for resource user doesn't own, LLM output produces 10MB page body). **Type:** missing-AI-security-tests. **Risk if unfixed:** AI editor with `@anthropic-ai/sdk` + `@google/genai` is a lethal-trifecta candidate; current 5-test coverage doesn't include malicious inputs. **Estimate:** 4-6h. **Owner skill:** junior + cortex-x ai-patterns standard reference. [audit: §7, §11] [src: https://www.hackerone.com/blog/agentic-prompt-injection-testing] [research: ai-eval-qa-2026]

---

## P1 — sprint-worthy (close in next 2-week sprint)

- **GAP-006** — **Pact consumer test against top-3 admin SDK endpoints** (orders, products, checkout). **Type:** missing-contract-test. **Risk:** type drift between admin GraphQL schema (churn 205/12mo on schema.gql) and eshop's `@order-mage/integration-sdk` consumer is a real risk. **Estimate:** 6-8h. **Owner skill:** junior with Pact docs. [audit: §5, §8] [src: https://docs.pact.io/] [research: pact-qa-contract-testing-2026]

- **GAP-007** — **Lighthouse CI on 5 critical routes** (`/`, `/[locale]`, `/[locale]/menu`, `/[locale]/cart`, `/[locale]/checkout`). Budget = current p95 + 20%. INP-aware. **Type:** missing-perf-budget. **Risk:** mobile checkout regressions ship blind; 1s delay = 20% conversion drop. **Estimate:** 3-4h. **Owner skill:** junior with @lhci/cli. [audit: §4] [src: https://contextqa.com/blog/performance-testing-tools-2026/] [research: lighthouse-qa-perf-testing-2026]

- **GAP-008** — **4 fast-check property tests** (cart-total invariant, addon-monotonicity, order-expire boundary, i18n-key coverage). **Type:** missing-property-tests. **Risk:** unit tests cover examples; properties cover universe of inputs. Cart-pricing edge cases (negative discount, zero quantity) not asserted. **Estimate:** 4h. **Owner skill:** junior with fast-check intro. [audit: §3] [src: https://fast-check.dev/docs/introduction/why-property-based/] [research: fast-check-qa-unit-fitness-2026]

- **GAP-009** — **Full logged-in-checkout E2E** (login → saved address → saved payment method → reorder from history → confirm). **Type:** missing-E2E. **Risk:** registered-user flow is the conversion lever; saved-data path different from guest. **Estimate:** 4-6h. **Owner skill:** junior with Playwright fixtures. [audit: §1] [src: https://www.shopify.com/blog/ecommerce-testing] [research: nextjs16-qa-e2e-strategy-2026]

- **GAP-010** — **i18n-key-coverage property test** — every key in `cs.json` exists in `en.json`, `en-GB.json`, `sk.json`. **Type:** missing-data-completeness-test. **Risk:** locale drift (62 churn on cs.json vs 36-39 on others 12mo) — Czech keys added without translations ship as fallback strings. **Estimate:** 1-2h. **Owner skill:** junior. [audit: §3, §11 Flexibility] [src: https://fast-check.dev/docs/configuration/runners-options/] [research: fast-check-qa-unit-fitness-2026]

- **GAP-011** — **Network-failure E2E for cart `/api/cart` 5xx + payment-gateway timeout**. **Type:** missing-reliability-test. **Risk:** cart UI behavior under network failure is the customer-support multiplier — unhandled = customer thinks order placed when it didn't. **Estimate:** 3-4h. **Owner skill:** junior with Playwright `route.fulfill`. [audit: §2] [src: https://playwright.dev/docs/api/class-route] [research: playwright-qa-reliability-2026]

- **GAP-012** — **Mobile viewport critical-path E2E suite** (cart, checkout). **Type:** missing-mobile-coverage. **Risk:** Czech/Slovak mobile checkout >50% of traffic; desktop-only E2E silently misses iOS Safari payment-sheet bugs. **Estimate:** 2-3h (extends GAP-002 + GAP-009 with `device: 'iPhone 14'`). **Owner skill:** junior. [audit: §5] [src: https://playwright.dev/docs/emulation] [research: nextjs16-qa-e2e-strategy-2026]

- **GAP-013** — **Replace 7-assertion `venue-outage.spec.ts` with comprehensive variant table** (closed-during-checkout, closed-after-cart, partial-outage, all-outage). **Type:** smell-flag (thin coverage). **Risk:** venue states are revenue-affecting; thin coverage masks corner-case revenue loss. **Estimate:** 2h. **Owner skill:** junior. [audit: §1, §2] [research: nextjs16-qa-e2e-strategy-2026]

- **GAP-014** — **`evals/` directory + 10-rubric promptfoo set for AI editor**. **Type:** missing-AI-eval-suite. **Risk:** AI tool-executor regression invisible without rubric. **Estimate:** 4-6h. **Owner skill:** junior with promptfoo docs. [audit: §11] [src: https://www.promptfoo.dev/docs/intro/] [research: ai-eval-qa-2026]

- **GAP-015** — **Telephone-verification rate-limit + abuse test**. **Type:** missing-security-test. **Risk:** unbounded SMS sends → cost explosion + abuse; current tests don't assert rate-limit invariant. **Estimate:** 2-3h. **Owner skill:** junior. [audit: §7] [research: api-qa-security-testing-2026]

---

## P2 — backlog (close opportunistically, track but don't gate)

- **GAP-016** — Visual regression via Playwright `toHaveScreenshot()` on home + PDP + checkout (with mask for cart-total + timestamps + promo banners). [audit: §11 inferred] [src: https://playwright.dev/docs/test-snapshots] [research: playwright-qa-visual-2026]
- **GAP-017** — Storybook a11y addon enabled across existing component stories. [audit: §10] [research: axe-qa-a11y-testing-2026]
- **GAP-018** — Test:coverage script in package.json + c8/v8 report uploaded as CI artifact. [audit: §12] [src: https://github.com/bcoe/c8] [research: test-observability-qa-2026]
- **GAP-019** — Playwright trace-on-failure retention configured + uploaded as CI artifact for debug. [audit: §12] [src: https://playwright.dev/docs/trace-viewer-intro] [research: test-observability-qa-2026]
- **GAP-020** — DB migration roll-forward + roll-back tests (only if Prisma/TypeORM deps confirmed). [audit: §9] [research: data-migration-qa-2026]

---

## SKIP — researched and intentionally NOT recommended (cited)

- **Don't migrate from Vitest to Jest** — Vitest 4 + Next.js 16 is well-supported in 2026; migration cost > benefit. [src: https://vitest.dev/guide/comparisons.html] [research: nextjs16-qa-unit-fitness-2026]
  Reason: Vitest is faster + native ESM + native TS; Jest 30 doesn't beat it for this stack.

- **Don't add Stryker on day 1 for entire codebase** — start with 3 high-risk modules (payment-gateway, getEffectivePrices, mapCartAddonsToOrderAddons); ratchet up after 6 weeks. [src: https://stryker-mutator.io/docs/stryker-js/configuration/] [research: stryker-qa-mutation-fitness-2026]
  Reason: Trail of Bits 2026: "incremental mode with risk-tiering beats blanket adoption" — solo junior tester gets crushed by a full sweep.

- **Don't add Chromatic** — Storybook present but no obvious product-team use; Playwright `toHaveScreenshot()` covers top-5 routes for free. [src: https://www.chromatic.com/compare/percy] [research: playwright-qa-visual-2026]
  Reason: Chromatic shines when Storybook is THE design pipeline; here it's a dev tool.

- **Don't introduce Cypress** — Playwright already wired, Cypress migration is 100h+ for negligible benefit. [src: https://tech-insider.org/cypress-vs-playwright-2026/] [research: nextjs16-qa-e2e-strategy-2026]
  Reason: 2026 industry vector is Playwright-ward; ship Playwright deeper, don't fork tooling.

---

## OPEN QUESTIONS (sources disagree or context-dependent — operator decides)

- **ASVS Level 1 vs Level 2 target** — recommendation lean: **L2** if eshop accepts EU customer payment data, **L1** if all PCI scope outsourced to gateway providers (Comgate/CSOB tokenization). [src A: https://owasp.org/www-project-application-security-verification-standard/] vs [src B: https://docs.stripe.com/security/stripe-as-pci-service-provider]

- **Pact vs OpenAPI-only** for FE-BE contract — recommendation lean: **Pact consumer-side** because admin's `schema.gql` churns 205/12mo and OpenAPI alone won't catch field-level breakage. [src A: https://docs.pact.io/] vs [src B: https://www.speakeasy.com/blog/pact-vs-openapi]

---

## Off-limits zones (Phase 3 Q4 RA) — flagged but NOT actionable

- FYI: `src/app/[locale]/editor/legacy/` flagged as likely-deprecated from thin coverage signal — `clone-default-website.spec.ts` (5 assertions), `use-legacy-editor-store.spec.ts` (7 assertions). Not on backlog per Q4 RA — colleague to confirm if deprecation is real.

---

## Progress meta

- **Total gaps surfaced:** 20
- **P0:** 5 | **P1:** 10 | **P2:** 5
- **SKIPs (cited):** 4
- **OPEN:** 2
- **Off-limits FYI:** 1
- **Quality scorecard summary** (from audit): Functional 3/5, Performance 1/5, Compatibility 2/5, Interaction 1/5, Reliability 3/5, Security 2/5, Maintainability 4/5, Flexibility 3/5, Correctness 2/5, AI 2/5, Test-obs 2/5

Re-audit `/test-audit` in 3 months to measure progress on this backlog.
