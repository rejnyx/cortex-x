# order-mage QA-retrofit dogfood — 2026-05-09

> Manual operator dogfood of cortex-x `/test-audit` (Sprint 2.10) on `order-mage/eshop` + `order-mage/admin`. Run by Dave (operator) as a preview deliverable for the new junior tester joining the team next week.

## Why this exists

cortex-x `/test-audit` is brand-new (shipped Sprint 2.10 same day). Before handing it to a junior tester onboarding to a complex production codebase pair, the operator wanted to:

1. **Run it manually** to verify the deliverable shape works on real codebases (not the cortex-x R1 paper exercise)
2. **Pre-cache findings** so the colleague's day-1 audit either matches (cortex works as advertised) or differs (signal for prompt iteration)
3. **Seed the conversation** — colleague sees a senior-consultant-grade deliverable on day 1 and reviews/executes, doesn't build

This directory archives the deliverables produced. They are **NOT pushed back to order-mage repos** — the original clones at `c:/tmp/qa-dogfood/{eshop,admin}/cortex/qa/` are local-only.

## Deliverables (per repo)

```
eshop/
  AUDIT.md             — 12-section ISO 25010:2023 + 3 cortex-extras audit
  testing-strategy.md  — 12-month pyramid plan, tool decisions, CI gates
  testing-gaps.md      — 20 prioritized gaps (5 P0 + 10 P1 + 5 P2 + 4 SKIP + 2 OPEN + 1 off-limits FYI)

admin/
  AUDIT.md             — same shape; multi-tenant Nx monorepo specifics
  testing-strategy.md  — same shape; pyramid weighted toward backend-integration strength
  testing-gaps.md      — 28 prioritized gaps (5 P0 + 11 P1 testing + 7 P1 DevOps/CI + 5 P2 + 4 SKIP + 3 OPEN + 1 FYI)
```

## Top-line findings (the 5 things to discuss with the colleague day 1)

### eshop
1. **🚨 CI runs ZERO tests on PR.** `qa-eval.yml` only on push to main, only vitest. Playwright never runs in CI.
2. **🚨 Money-path E2E gap.** Cart, payment-methods, venue-states tested separately; full guest-checkout-to-paid is uncovered.
3. **⚠️ Payment-gateway tests are unit-only.** Comgate/CSOB/GPWebPay/Teya all have unit specs; no end-to-end transactional flow tests.
4. **⚠️ Zero a11y / mutation / property / visual-regression infrastructure.**
5. **✅ Strong unit foundation in critical-path utilities** (cart pricing, addon mapping, order expiration, payment-gateway-settings).

### admin
1. **🚨 PR gate runs ZERO tests.** `check-pull-request.yml` ends at `nx affected:build`; **169 test files run nowhere on PR**. Single-line fix in 1 file = biggest leverage move.
2. **🚨 Auth + RBAC + tenant-isolation tests = 0.** Multi-tenant SaaS without isolation tests = critical security gap (Security score 1/5).
3. **🚨 `libs/emails` 0 tests.** Money-path templates (PaymentConfirmation, PasswordReset) untested.
4. **⚠️ Hot files vs test ratio skewed.** `api-partner-settings.service.ts` (50 churn 12mo) likely undertested.
5. **✅ `apps/backend-integration` (97 specs)** is the test-discipline gold standard — preserve.

## Joint pattern

Both repos exhibit the same root pattern: **"Tests written, gate missing"** — the discipline to write tests is established, the discipline to enforce them on PR is not. ONE workflow line in each repo closes ~70% of the runtime risk class.

## Sprint 2.10.1 expansion (also shipped same day)

Operator added two more requirements during the dogfood:

1. **DevOps/CI as part of QA scope** — qa_concerns expanded from 10 → 15 (added `ci-pipeline-testing`, `iac-testing`, `container-security`, `deploy-safety`, `secret-supply-chain`). The admin `testing-gaps.md` reflects this with 7 explicit DevOps/CI gaps (GAP-017 through GAP-023).
2. **Auto-research-nudge pattern** — every gap ships with an inline `**Research nudge:**` line proposing a WebSearch query. Trains junior testers in the audit-then-research-first discipline.

The 6 deliverables in this archive use the Sprint 2.10.1 (full 15-concern) taxonomy.

## Suggested colleague day-1 review flow

1. Read `eshop/AUDIT.md` § Executive summary (5 bullets) + Quality scorecard
2. Read `eshop/testing-gaps.md` P0 section (5 items) — discuss which she agrees with vs disagrees
3. Override Phase 3 RA fills with her real Q1-Q5 answers (Top business risk, last 3 incidents, compliance target, off-limits zones, her capacity)
4. Repeat for admin
5. Pick ONE P0 gap from each repo to ship in week 1 — measurable wins
6. Re-run `/test-audit` in 3 months for delta

## Honest caveats (operator-mode disclosure)

- **Phase 3 (5 human questions) was auto-filled with reasonable assumptions.** Every Q1-Q5 fill is RA-marked; colleague should override before acting on the backlog.
- **Audit was depth-first not breadth-first per file.** A real `/test-audit` run dispatches 4 parallel general-purpose agents per repo. The dogfood operator did targeted reads + structured synthesis (one human-loop pass instead of 4-agent parallel). The deliverable shape is identical; the file:line citation depth is shallower.
- **No Phase 6 sample-test seeding.** That's a separate `--seed-tests` opt-in; operator skipped to keep this preview tight.
- **Findings on private code only.** This README is checked into cortex-x (public repo); the deliverables themselves contain references to file paths in private repos. Treat `docs/dogfood/order-mage-2026-05-09/` as semi-confidential — don't open-source without operator review.

## Re-run instructions for the colleague

After `git clone cortex-x` + `./install.ps1`:

```bash
cd /path/to/order-mage/eshop  # her own duplicate clone
claude                         # opens Claude Code
# Then in Claude Code:
/test-audit                    # 30-min audit, produces 6 files in cortex/qa/
```

Compare her run's `cortex/qa/AUDIT.md` to the version in this archive. Differences = signal: either prompt-iteration opportunity or her audit caught something the dogfood missed.
