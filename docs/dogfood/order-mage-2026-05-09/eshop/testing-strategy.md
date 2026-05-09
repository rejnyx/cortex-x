---
phase: 5-qa-strategy
date: 2026-05-09
slug: order-mage-eshop
based_on:
  audit: cortex/qa/AUDIT.md
  research: docs/research/sprint-2.10-qa-retrofit-2026-05-09.md
quality_model: ISO/IEC 25010:2023
asvs_target: L1 (escalates to L2 if EU shipping core)
---

# Testing strategy — order-mage/eshop, 2026-05-09

**Stack:** Next.js 16 + Vitest 4 + Playwright + Storybook + Anthropic SDK + Google GenAI + 4 Czech payment gateways (Comgate/CSOB/GPWebPay/Teya) + i18n (cs/sk/en/en-GB)
**Top business risk (Q1, RA):** End-to-end checkout-to-paid silently breaking
**Compliance (Q3, RA):** ASVS L1; WCAG 2.2 AA required by EAA 2025-06-28 if EU shipping core
**Tester capacity (Q5, RA):** Junior solo, ~10h/week, Playwright + Vitest comfortable

---

## Pyramid target (12-month plan)

|              | Now (2026-05-09) | 3 months  | 12 months  |
|--------------|------------------|-----------|------------|
| Unit         | 23 spec files    | 35-40     | 60-80      |
| Integration  | 0 dedicated      | 8-12      | 20-30      |
| Contract     | 0                | 3 (admin SDK) | 5-8     |
| E2E          | 8 spec files     | 14 (full money path covered) | 20-25 |
| Mutation     | 0                | high-risk modules at 60% | 75% on payment-gateway, cart-pricing |
| Property     | 0                | 4 invariants (cart total, addon monotonicity, order-expire, i18n key coverage) | 8-12 |
| Perf budget  | 0                | Lighthouse CI on top 5 routes | + k6 browser on checkout funnel |
| A11y         | 0                | axe-core in component tests + CI gate | WCAG 2.2 AA full audit |
| AI evals     | 1 spec (5 tests) | `evals/` dir + 10-rubric eval set | + prompt-injection regression suite |

---

## Tool decisions (cited)

- **Unit/component:** Vitest 4 (already in stack) — keep [src: https://playwright.dev/docs/release-notes] [research: nextjs16-qa-unit-fitness-2026]
- **E2E:** Playwright 1.50+ (already in stack at e2e/) — keep, but **wire into CI** (this is the #1 fix) [src: https://tech-insider.org/cypress-vs-playwright-2026/] [research: nextjs16-qa-e2e-strategy-2026]
- **Mutation:** **StrykerJS 9.6 incremental mode**, threshold 75% on `src/api/payment-gateway/**` + `src/features/utils/getEffectivePrices.ts` + `src/features/utils/mapCartAddonsToOrderAddons.ts` [src: https://stryker-mutator.io/] [research: stryker-qa-mutation-fitness-2026]
- **Property-based:** **fast-check 4** for cart-pricing invariants, addon-pricing monotonicity, order-expiration boundary [src: https://fast-check.dev/docs/introduction/why-property-based/] [research: fast-check-qa-unit-fitness-2026]
- **Contract:** **OpenAPI from `@order-mage/integration-sdk`** + **Pact** consumer-side from eshop → admin (only the endpoints eshop actually consumes) [src: https://docs.pact.io/] [research: pact-qa-contract-testing-2026]
- **Perf:** **Lighthouse CI** on 5 critical routes per PR (home, PLP, PDP, cart, checkout); INP-aware [src: https://contextqa.com/blog/performance-testing-tools-2026/] [research: lighthouse-qa-perf-testing-2026]
- **A11y:** **axe-core + @axe-core/playwright** in E2E + jest-axe in component-level tests [src: https://github.com/dequelabs/axe-core-npm] [research: axe-qa-a11y-testing-2026]
- **Visual:** **Playwright `toHaveScreenshot()`** for top 5-10 routes (no Storybook-tied product yet, so Chromatic over-delivers) [src: https://playwright.dev/docs/release-notes] [research: playwright-qa-visual-2026]
- **Payment in CI:** **stripe-mock pattern adapted** — for ComGate/CSOB/GPWebPay/Teya, ship dedicated fixture servers (or HTTP recording via MSW + `nock`) so CI never hits real gateways [src: https://github.com/stripe/stripe-mock] [research: payment-gateway-qa-ecommerce-2026]
- **AI evals:** Promptfoo for ai-tool-executor regression rubric [src: https://www.promptfoo.dev/] [research: ai-eval-qa-2026]

---

## CI gating philosophy

| Gate | Layer | Action |
|---|---|---|
| Block on red | unit (vitest) + critical-path E2E (full guest-checkout, full logged-in-checkout, refund-from-admin reflected on storefront) | merge blocked |
| Soft-block | mutation score regression on payment-gateway/* > 5pp | warn, require justification in PR |
| Soft-block | Lighthouse perf budget regression > 20% | warn |
| Inform-only | a11y score, visual diff, full mutation sweep, full E2E (all 14 flows) | annotate PR, don't block |
| Nightly only | full Playwright matrix (Chromium + WebKit + Firefox + mobile), full mutation sweep, k6 browser load | non-blocking, alert on regression |

---

## Coverage thresholds (risk-tiered, mutation-aware)

| Tier | Examples | Line cov | Branch cov | Mutation score |
|---|---|---|---|---|
| **High-risk** | `src/api/payment-gateway/**`, `src/features/utils/getEffectivePrices.ts`, `src/features/utils/mapCartAddonsToOrderAddons.ts`, `src/api/order/**`, `src/api/telephone-verification/**` | 80% | 70% | 75% |
| **Mid-risk** | `src/api/cart/**`, `src/api/delivery-method/**`, `src/api/payment-method/**`, `src/features/components/cart-*`, `src/features/components/product-detail/**` | 70% | 60% | 60% |
| **Low-risk** | `src/features/components/[non-cart]/**`, `src/features/i18n/locales/**` (data, not logic), Storybook stories | 50% | — | — (advisory) |
| **Excluded** | `**/dist/**`, `.next/**`, `**/*.generated.*`, `src/app/[locale]/editor/legacy/**` (deprecated per Q4 RA) | — | — | — |

---

## ISO 25010:2023 9-char + 3 cortex extras targets (3-month sprint)

- **Functional Suitability:** Wire all 31 specs into CI PR gate (vitest run + playwright run on `--project=critical`)
- **Performance Efficiency:** Lighthouse CI on home / PLP / PDP / cart / checkout, 5 INP/LCP/CLS budgets at p95 + 20%
- **Compatibility:** Playwright matrix runs nightly on Chromium + WebKit + mobile-Chrome (3 browsers); cross-browser regression gate
- **Interaction Capability:** axe-core in 5 cart/checkout component tests + lighthouse-ci a11y score ≥ 90 in CI inform-only
- **Reliability:** add network-failure E2E for cart `/api/cart 5xx`, payment-gateway timeout (one provider), telephone-verification rate-limit
- **Security:** add prompt-injection eval to ai-tool-executor; add IDOR test sample for `/api/order/{id}` (current user can't fetch other user's orders)
- **Maintainability:** mutation-score gate on payment-gateway provider modules at 60% (start) → 75% (3 months)
- **Flexibility:** add i18n-key-coverage property test (every key in cs.json must exist in en/en-GB/sk)
- **Safety:** N/A (consumer storefront)
- **Correctness invariants:** 4 fast-check property tests (cart-total, addon-monotonicity, order-expire, i18n-key)
- **AI-specific:** `evals/` dir with 10-rubric promptfoo set + prompt-injection regression sweep
- **Test observability:** Playwright trace retention on failure (`trace: 'retain-on-failure'`), upload as CI artifact

---

## Out-of-scope (cited reasoning)

- **Don't migrate from Vitest to Jest yet** — Vitest 4 + Next.js 16 is well-supported in 2026; migration cost > benefit [research: nextjs16-qa-unit-fitness-2026]
- **Don't add Stryker on day 1 for entire codebase** — start with 3 high-risk modules (payment-gateway, getEffectivePrices, mapCartAddonsToOrderAddons); ratchet up after first 6 weeks. [research: stryker-qa-mutation-fitness-2026] (Trail of Bits 2026: incremental mode with risk-tiering beats blanket adoption)
- **Don't replace `@order-mage/integration-sdk` with hand-written client just for testability** — keep SDK; add Pact contract layer as the verification surface. Less invasive, same coverage. [research: pact-qa-contract-testing-2026]
- **Don't add full visual regression on every page** — start with 5 critical (home, PLP, PDP, cart, checkout); past that = noise. [research: playwright-qa-visual-2026]

---

## Three-month execution plan (paired with backlog in testing-gaps.md)

### Month 1 — close P0 (block-release-worthy)
- **Week 1:** GAP-001 (CI runs Playwright on PR), GAP-002 (full guest-checkout E2E), GAP-003 (StrykerJS on payment-gateway module at 60%)
- **Week 2:** GAP-004 (axe-core in 5 component tests), GAP-005 (prompt-injection eval for ai-tool-executor)

### Month 2 — close top P1 + first SKIP revisits
- **Week 3-4:** GAP-006 (Pact consumer test for top-3 admin endpoints), GAP-007 (Lighthouse CI on 5 routes), GAP-008 (4 fast-check property tests on cart math)
- **Week 5-6:** GAP-009 (full logged-in-checkout E2E), GAP-010 (i18n key coverage property test)

### Month 3 — pyramid rebalance + mutation sweep
- **Week 7-8:** ratchet StrykerJS threshold 60% → 75% on payment-gateway; add to `src/api/order/**`
- **Week 9-10:** convert top-3 brittle E2E to integration where Pact contract covers
- **Week 11-12:** re-run `/test-audit` for delta — measure progress, refresh research

---

## Anti-patterns to avoid in this stack

1. **Hitting real Comgate/CSOB/GPWebPay/Teya in CI** — even sandbox accounts pollute the gateway dashboard and rate-limit; use HTTP-recorded fixtures
2. **Snapshot tests on cart-summary-box** (39 churn — every snapshot will diff every PR; mask `[data-testid=cart-total]`, timestamps, dynamic promo text)
3. **Skipping mobile viewport** — Czech mobile checkout traffic >50%; 1s delay = 20% conversion drop (Sprint 2.10 R1 research)
4. **Adding more unit tests when CI doesn't run them** — fix the gate before adding more spec files

---

## Re-audit cadence

Re-run `/test-audit` every 3 months (or after major refactor / acquisition / stack-version bump). The diff between the new `cortex/qa/AUDIT.md` and the previous one is the progress signal.
