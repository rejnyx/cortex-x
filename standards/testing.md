# Testing — Confidence Through Layered Coverage

> Tests exist to let you refactor without fear. Not for 100% coverage — for the ability to change things with evidence.

## Why

Without tests:
- Every change is a prayer
- Refactoring is forbidden (too risky)
- Bugs come back
- You become the only person who can touch the code

With tests:
- Change freely, verify quickly
- Regressions caught in CI, not production
- Refactoring is cheap
- New team members can contribute without fear

## Test Pyramid (2026)

```
        /\           E2E (5-10%)
       /  \          — critical user journeys
      /____\
     /      \        Integration (20-30%)
    /        \       — API routes, DB queries, tool calls
   /__________\
  /            \     Unit (60-75%)
 /              \    — pure functions, hooks, utilities
/________________\
```

**Ratio matters more than count.** 500 unit tests + 2 E2E tests is fragile. 200 unit + 50 integration + 10 E2E is solid.

## Five Pillars of Every Test

Every test file should cover:

1. **Happy path** — feature works as designed
2. **Error cases** — what happens when things fail (network, DB, user input)
3. **Edge cases** — empty input, null, undefined, extreme values, concurrency
4. **Security** — unauthorized access, injection, XSS, auth bypass
5. **Integration** — does this play nice with its neighbors

Test file without error cases = fragile. Test file without security = negligent. Test file without edge cases = naive.

## Tools (2026)

| Layer | Tool | Why |
|-------|------|-----|
| Unit | **Vitest 4** | Fast, native TS, Jest-compatible API |
| Component | **React Testing Library** | Tests behavior, not implementation |
| Integration | **Vitest + MSW** | Mock Service Worker for HTTP mocking |
| E2E | **Playwright** | Cross-browser, reliable, great DX |
| Load | **k6** | JS-based load testing, Grafana integration |
| Visual | **Percy / Chromatic** | Catch UI regressions |
| A11y | **axe-core + Playwright** | Accessibility assertions in E2E |

## Rules

1. **Write test FIRST when fixing a bug.** Reproduce the bug in a test, watch it fail, fix code, watch it pass. Now the bug can't come back.
2. **Test behavior, not implementation.** `expect(result).toBe(5)` > `expect(internalCounter).toBe(5)`.
3. **One assertion per test ideally.** Multiple related assertions OK; multiple unrelated assertions = split the test.
4. **Arrange-Act-Assert structure.** Setup data, execute action, assert outcome.
5. **Deterministic only.** No `Math.random()`, no timing-dependent assertions (use fake timers), no real network calls.
6. **Fast unit tests.** Full unit suite should run in under 30s. If slower, profile and fix.
7. **Integration tests use real DB.** Mocks lie — they pass when prod breaks (learned this incident). Use test database, reset between tests.

## Anti-patterns

- ❌ `expect(something).toBeTruthy()` — too broad, use exact assertions
- ❌ Tests that test the framework (`expect(Button).toBeInTheDocument()`)
- ❌ Shared state between tests (always reset)
- ❌ Tests with names like "it works" (describe what, not that)
- ❌ Snapshots for everything (overuse makes them meaningless)
- ❌ Mocking your own modules (usually means tight coupling)

## AI-specific testing

- **Prompt injection tests** — try malicious inputs, assert they're rejected
- **Tool call validation tests** — Zod schema enforcement on every tool
- **Agent loop tests** — mock LLM responses, test multi-step behavior
- **Cost guard tests** — simulate token blowup, assert quota enforcement
- **Memory system tests** — core index rebuild, activity log search, vector recall
- **Reward-hack tests** — assert the agent did NOT edit a test file or hardcode a fixture to pass (see [correctness.md](./correctness.md) § Reward hacking)

## TDD for agents

Test-first works *better* for AI agents than for humans — but only done right.

- **Test-first cuts regressions ~70%** for coding agents (TDAD, arXiv 2603.17973: 6.08% → 1.82% on SWE-bench Verified). Writing the failing test first makes it harder for the agent to "cheat" than implement-then-write-tests, because the assertion is fixed before the implementation exists.
- **Name the tests — don't just say "do TDD".** The same study found that generic TDD instructions *without telling the agent which tests to check* made regressions **worse (9.94%)** — worse than no intervention. The win comes from **targeted test context** (the specific tests the change must satisfy), not the ritual. When you ask an agent to TDD, hand it the named target tests.
- **Keep hidden hold-outs.** Give the agent the tests to satisfy, but retain a hold-out set it never sees, to catch overfitting (passing the visible cases, failing the rest).
- **Red → green → refactor:** write the failing test, confirm it fails (red), implement until it passes (green), then refactor under green. Confirming red first proves the test actually exercises the new behavior.
- **Anti-reward-hack:** the agent must never weaken or delete existing assertions to force green — that's reward hacking. See [correctness.md](./correctness.md) § Reward hacking for the full failure-mode list + defenses.

Steward encodes this as the `tdd_red_green` action_kind (`bin/steward/_lib/action-kinds.cjs`, registry-only as of Sprint 2.34) — its acceptance criteria forbid shrinking an existing test file to fake green (size-based; the full assertion-integrity diff gate ships with the Sprint 2.34.1 executor).

## Beyond example-based tests — see correctness.md

Standard unit/integration/E2E testing catches **regressions on things you thought to test**. It does **not** catch: algorithm errors producing plausible wrong outputs, invariants that should hold across all inputs, order-dependent bugs in stateful systems, silent LLM-output regressions when prompts or models change, or stale tests that pass because they don't verify hard cases.

For verification **beyond examples**:

- **Property-based testing** (fast-check / Hypothesis) — invariants over generated inputs, not examples
- **Eval-driven dev** (promptfoo / braintrust) — the spec for non-deterministic LLM/agent code
- **Mutation testing** (Stryker / mutmut) — measures test *quality*, not just coverage
- **Stateful simulation** (fast-check commands / Hypothesis RuleBasedStateMachine / Antithesis) — for retry/dedup/ledger/workflow code
- **Schema validation at trust boundaries** (Zod / Pydantic) — types are compile-time; runtime validation is the proof

Full methodology + 2026 tool matrix: [correctness.md](./correctness.md) (Rule 2 Critical, alongside Security / Testing / Observability).

## Coverage goals

- **Unit:** 80%+ on `lib/` and business logic
- **Integration:** 100% of API routes (each happy path + main error)
- **E2E:** Cover all critical user journeys (login → primary feature → logout)

Coverage is a smoke signal, not a goal. Don't game it with trivial tests.

## Verification

```bash
npm test                      # unit + integration
npx playwright test           # E2E
npm run test:coverage         # coverage report
k6 run load-tests/main.js     # load baseline
```
