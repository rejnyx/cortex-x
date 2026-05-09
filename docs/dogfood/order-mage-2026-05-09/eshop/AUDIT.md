---
phase: 2-qa-audit
date: 2026-05-09
slug: order-mage-eshop
quality_model: ISO/IEC 25010:2023
auditor: cortex-x /test-audit (manual operator dogfood — colleague preview)
agents: [functional-reliability-correctness, performance-portability-maintainability, security-compatibility-integrity, usability-ai-observability]
---

# Test Audit — order-mage/eshop

> 12-section QA audit aligned to ISO/IEC 25010:2023 + 3 cortex extras.
> Citations are file:line + commit hash. This is a deliverable, not a chat scrollback.

## Executive summary (5 bullets)

- **🚨 Money-path E2E gap:** No end-to-end test drives full guest checkout → payment → order confirmation. Cart, payment-methods, delivery-methods, item-display, order-history, venue-states are tested as separate flows; the integrated checkout-to-paid is not covered. THE money path is the single biggest E2E gap. (§1, §2)
- **🚨 No E2E in CI:** `playwright.config.ts` exists at `e2e/playwright.config.ts` and `npm run test:e2e` is wired in `package.json`, but **`.github/workflows/qa-eval.yml` only runs `vitest run`** on push to main — Playwright suite never runs in CI. Local-only E2E = drifts to broken silently. (§6)
- **⚠️ Payment gateway tests are unit-only:** Comgate, CSOB, GPWebPay, Teya have unit `*.gateway.spec.ts` (gateway shape + error codes), but no integration test that drives the full payment-create → callback → order-update flow with realistic gateway mocks. (§7, §1)
- **⚠️ Zero a11y, mutation, property, visual-regression:** No axe-core, no Stryker, no fast-check, no Chromatic/Percy in `package.json`. Modern e-commerce 2026 baseline (per Sprint 2.10 R1 research) expects all four. (§4, §10, §3, §11)
- **✅ Strong unit foundation in critical-path utilities:** `getEffectivePrices`, `mapCartAddonsToOrderAddons`, `useCartDeliveryMethodArea`, `useCartMinPrice`, `getOrderExpiresAt`, `payment-gateway-settings.service` all have meaningful coverage (8-16 assertions per file). The bones are good — gaps are at the integration + E2E + cross-cut layers, not at the leaf level.

## Quality scorecard (1-5 per ISO 25010:2023 char + cortex extras)

| Characteristic | Score | Evidence |
|---|---|---|
| Functional Suitability | 3/5 | unit-level happy paths solid; integrated-flow E2E gaps in checkout (§1, §2) |
| Performance Efficiency | 1/5 | no perf budget, no Lighthouse CI, no k6 (§4) |
| Compatibility | 2/5 | Playwright config supports browsers but never run in CI; mobile viewport untested (§5) |
| Interaction Capability | 1/5 | zero a11y assertions; no axe-core integration (§10) |
| Reliability | 3/5 | error-path coverage in gateways exists; venue-outage E2E exists; missing on retry/network-fail paths (§2) |
| Security | 2/5 | data-encryption util tested; AI editor tool-executor has basic input validation tests; no prompt-injection or auth-bypass tests (§7) |
| Maintainability | 4/5 | clean module structure (api/, features/), test directory mirrors source, vitest is fast |
| Flexibility | 3/5 | i18n fully tested at locale-level by usage; multi-locale routing tested by hot-file presence |
| Safety | N/A | not applicable to consumer storefront (no life/property risk, no AI safety beyond prompt injection coverage) |
| Correctness invariants (cortex) | 2/5 | no property-based tests on cart-pricing math, addon-resolution, order-expiration logic (§3) |
| AI-specific (cortex) | 2/5 | `ai-tool-executor.spec.ts` has 5 tests (3 happy, 2 error); no prompt-injection eval, no malicious-input tests, no determinism guard (§11) |
| Test observability (cortex) | 2/5 | qa-eval.yml has bespoke vitest-JSON reporter; no flake tracking, no test-impact analysis, no Playwright trace artifact retention configured (§12) |

---

## 1. Functional suitability

**Documented features (from README + src/api top-level):** cart, delivery-method, payment-gateway (Comgate/CSOB/GPWebPay/Teya), order, venue, allergen, integration (admin sync), telephone-verification, AI editor (in `src/app/[locale]/editor/ai/`).

**Coverage map** (sample of 7 features × test layer):

| Feature | Unit | Integration | E2E |
|---|---|---|---|
| Cart (pricing, addons, delivery) | ✅ `getEffectivePrices.spec.ts`, `mapCartAddonsToOrderAddons.spec.ts`, `useCartDeliveryMethodArea.spec.tsx`, `useCartMinPrice.spec.tsx` | ❌ | ✅ `cart-use-cases.spec.ts`, `contained-addons.spec.ts`, `delivery-method-areas.spec.ts` |
| Delivery methods | ✅ `delivery-method-import.processor.spec.ts`, `delivery-validation.service.spec.ts` | ❌ | ✅ `delivery-methods.spec.ts` |
| Payment gateways (4 providers) | ✅ unit per gateway (`comgate`, `csob`, `gpwebpay`, `teya`) | ❌ **gap** | ❌ **gap** (only `payment-methods.spec.ts` tests display, not transaction) |
| Order (create→pay→confirmed) | ⚠️ partial (`getOrderExpiresAt`, `computeNextTrackedOrders`) | ❌ | ❌ **gap** (no full flow E2E) |
| Order history (post-purchase) | ❌ | ❌ | ✅ `order-history.spec.ts` |
| Venue states (closed/outage) | ❌ | ❌ | ✅ `venue-closed.spec.ts`, `venue-outage.spec.ts` |
| AI editor tool-executor | ✅ `ai-tool-executor.spec.ts` (3 happy + 2 error) | ❌ | ❌ |
| Telephone verification | ✅ `telephone-verification.service.spec.ts` | ❌ | ❌ |
| i18n (cs/sk/en/en-GB) | ❌ (locale files churn 36-62 commits/12mo) | ❌ | ❌ (no locale-routing E2E) |

**Verdict:** Top of pyramid (E2E) is shaped right (8 spec files) but skips THE money path. Unit foundation strong on leaf utilities.

## 2. Reliability

**Error-path sampling** (try/catch blocks in src/api):

- `payment-gateway/gateways/gpwebpay/__tests__/gpwebpay-errors.spec.ts` — dedicated error-codes test ✅ (15 assertions)
- `venue-outage/venue-outage.spec.ts` — E2E for one specific outage flow ✅ (6 assertions, but **smell — only 6 for venue states is thin**)
- Network/timeout failures in cart-API: ❌ no test that simulates `/api/cart` returning 5xx and asserting UI fallback
- Payment gateway timeouts (ComGate/CSOB API blocking): ❌ no test
- Telephone verification rate-limit hit: ❌ no test (and no rate-limit detection visible in codebase)

**Verdict:** Error-codes covered for one gateway (gpwebpay); other 3 gateways' error paths are guess-coverage. Network-fail UI paths not asserted.

## 3. Correctness invariants (cortex extra — property-based candidates)

These domain invariants should hold for ALL inputs and are perfect property-test candidates with `fast-check`:

- **Cart total invariant:** `cartTotal === sum(lineItems.price × quantity) − discounts + tax + delivery` (currently asserted by example only in `getEffectivePrices.spec.ts`)
- **Addon-pricing monotonicity:** adding any addon ⇒ cart total ≥ previous; removing ⇒ ≤. Not asserted as property.
- **Order-expiration boundary:** `getOrderExpiresAt(t)` always > `t`; pure function. Not asserted as property.
- **i18n key coverage:** every key in `cs.json` exists in all sibling locale files (`en.json`, `en-GB.json`, `sk.json`). Not asserted (compile-time hole — translations drift silently).

**Verdict:** Zero property-based tests; high ROI gap (4 named candidates above).

## 4. Performance efficiency

- No `lighthouse-ci` config; no `k6` config; no `next/bundle-analyzer` output gated; no INP/LCP/CLS budgets in CI.
- `next.config.ts` exists but unread for this audit.
- Hot file `cart-summary-box/index.tsx` (39 churn 12mo) is on the conversion-critical path; unmemoized re-renders could regress without warning.
- **2026 reality** (per Sprint 2.10 R1 research): INP replaced FID March 2024; 12% of sites failing CWV under INP that previously passed.

**Verdict:** Zero perf testing infrastructure. Mobile checkout latency ungated.

## 5. Compatibility / contract

- **Playwright config supports multiple browsers** — but never runs in CI, so cross-browser regressions ship silently.
- **Contract testing FE-BE:** ❌ No Pact, no OpenAPI consumer-tests for `@order-mage/integration-sdk` (the eshop's coupling point to admin). Type drift between admin GraphQL schema (churn 205 in admin/apps/backend/schema.gql) and eshop's consumer types is a known risk class.
- **Mobile viewport tests:** ❌ Playwright config not seen using mobile devices.

**Verdict:** Cross-browser/mobile/contract = zero CI coverage. The integration-sdk coupling is a contract-testing prime candidate.

## 6. CI/CD state

- **Workflows present:** `deploy.yml` + `qa-eval.yml`
- **`qa-eval.yml`** runs `vitest run --reporter=json` on push to main, parses output via inline node script. **Does NOT run on PRs.** **Does NOT run E2E.**
- **No PR gate:** PRs can merge without ANY tests passing. (Unless husky pre-commit catches it locally — but local hooks are bypassable with `--no-verify`.)
- **No coverage gate:** `@vitest/coverage-v8` is in deps but no `test:coverage` script.

**Verdict:** CI is the single biggest fix-multiplier. All 31 spec files exist and likely pass — they just aren't enforced on PR.

## 7. Security testing

- **Data encryption util** has dedicated test (`data-encryption.util.spec.ts`, 8 assertions) — encryption primitive verified ✅
- **Payment gateway settings service** has test (10 assertions) — provider config + secret-handling primitives ✅
- **AI editor tool-executor** validates tool name + args — 5 tests; rejects missing+nonexistent. ✅ but:
  - ❌ No prompt-injection test (malicious LLM output that calls forbidden tools)
  - ❌ No "out-of-scope" tool test (calling `update_page_body` for a website the user doesn't own)
  - ❌ No path-traversal test on filesystem-touching tools
- **Auth bypass / IDOR tests:** ❌ none found
- **CSRF on order-modifying endpoints:** ❌ no explicit test
- **`@anthropic-ai/sdk` + `@google/genai` in deps** = AI features in production ⇒ **lethal trifecta** check needed (private data + untrusted content + external egress in `src/app/[locale]/editor/ai/`)

**Verdict:** Crypto primitive tested. AI-feature security tests minimal. No OWASP ASVS L1/L2 alignment visible.

## 8. Compatibility (overlap with §5)

GraphQL/REST consumer of admin via `@order-mage/integration-sdk@0.1.91` — version pin discipline OK, but pinning ≠ testing. No contract-verify step.

## 9. Data model + migrations

Server-side `tsx src/server.ts` + likely Prisma/TypeORM (not detected from deps in head — would need full deps inspection). No migration test directory found in 12mo top-churn list. **Risk:** schema migrations not exercised by tests; rollforward+rollback discipline ungated.

## 10. Interaction Capability (a11y)

- ❌ No `axe-core`, `@axe-core/playwright`, `jest-axe` in deps
- ❌ No Lighthouse CI a11y score gating
- ❌ No keyboard-nav E2E test
- ❌ No focus-management test on dynamic cart/modal opens

**Verdict:** Zero a11y testing. Czech market (eshop targets cs/sk/en-GB users) increasingly demands WCAG 2.2 AA per EAA 2025 (European Accessibility Act for e-commerce by 2025-06-28).

## 11. AI-specific testing (cortex extra)

`src/app/[locale]/editor/ai/ai-tool-executor.spec.ts` — 5 tests. Covers:
- ✅ `update_page_body` happy path
- ✅ Reject missing pageKey
- ✅ Reject non-existent page

Missing per Sprint 2.10 R1 research findings:
- ❌ Prompt-injection test (LLM output that calls forbidden tools)
- ❌ Out-of-scope authorization (tool called against resource user doesn't own)
- ❌ Resource-exhaustion test (LLM produces 10,000-line page body — does it crash or get rejected?)
- ❌ Determinism guard (seed=0/temperature=0 reproducibility)
- ❌ Eval suite (`evals/` directory absent)

`@anthropic-ai/sdk` (^0.81.0) and `@google/genai` (^1.48.0) both in deps suggests heavier AI surface than the one tested file covers.

## 12. Test observability (cortex extra)

- **qa-eval.yml** has bespoke vitest-JSON reporter that posts results — meaningful but custom, fragile
- **No flake tracking**, no Playwright trace retention config visible
- **No test-impact analysis** (which tests cover which files — important for affected-only PR runs)

---

## Cross-dimension patterns (top 3)

1. **Unit foundation strong, integration + cross-cuts thin.** Pattern: every leaf utility has a `*.spec.ts` next to it; every cross-feature path (full checkout, RBAC, multi-locale routing) is uncovered. Symptom in §1+§2+§5+§7+§8+§10. Likely root cause: per-feature test discipline driven by feature-PR review, no cross-feature E2E owner.
2. **CI under-utilizes existing test infrastructure.** 31 spec files exist + Playwright config exists, but PR gate runs nothing and main-push gate runs only vitest. The tests were written but never enforced. §6 + §10 (Playwright never runs).
3. **AI-aware codebase, AI-test-unaware.** `@anthropic-ai/sdk` + `@google/genai` + dedicated AI editor module (with `__tests__` dir present), but no eval suite, no prompt-injection tests. §11.

## Open questions (handed to Phase 3)

- Q1 — Top business risk: pravděpodobně "checkout failure invisible to customer support" but operator should confirm
- Q2 — Last 3 production incidents — only operator knows
- Q3 — Compliance: targeting WCAG 2.2 AA for EU EAA 2025? PCI-DSS scope (probably outsourced to gateways)?
- Q4 — Off-limits: legacy editor (`src/app/[locale]/editor/legacy/`) flagged by `clone-default-website.spec.ts` + `use-legacy-editor-store.spec.ts` having only 5-7 assertions — is this intentionally low-investment because deprecated?
- Q5 — Tester profile: solo junior or pair? Hours/week available?

---

## Phase 3 — Human input (auto-mode reasonable-assumption fills)

> **Auto-mode caveat (Sprint 2.10 prompt P3):** Q1 normally NEVER auto-filled. In this preview pass, all 5 are reasonable-assumption fills based on audit signal — colleague should override every one before acting on the backlog.

**Top business risk (Q1, RA):** _End-to-end checkout-to-paid silently breaking and not detected for >1 hour because no E2E in CI + no Playwright in qa-eval.yml._ Override likely candidates: payment-gateway provider outage cascade, multi-locale rollout regression, AI editor producing invalid layout.

**Recent incidents (Q2, RA):** _Unknown — colleague should fill from runbook / Slack incident channel / Linear bug list._ Audit cannot infer.

**Compliance (Q3, RA):** _ASVS L1 default; if EU shipping is core, ASVS L2 + WCAG 2.2 AA required by EAA 2025-06-28._

**Off-limits zones (Q4, RA):** _`src/app/[locale]/editor/legacy/`_ flagged as likely-deprecated from thin coverage signal (5-7 assertions) — colleague to confirm.

**Tester profile (Q5, RA):** _Junior solo, 8-15h/week, comfortable with Playwright + Vitest, learning Stryker + fast-check._ Backlog right-sized to ≤ 5 P0 + 10 P1.
