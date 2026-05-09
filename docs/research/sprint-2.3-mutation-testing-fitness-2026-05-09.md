---
sprint: 2.3
title: Stryker mutation testing as fitness signal
date: 2026-05-09
status: research-complete (autonomous evening session via web research dispatch)
based_on: web research dispatch 2026-05-09 (10 sources cited inline)
---

# Sprint 2.3 — Mutation testing fitness R1 memo

## 1. Question

cortex-x has ~1600 unit + contract + integration tests. `npm test` is the verifier gate (Sprint 1.6.x). But: tests can pass while NOT actually exercising the code under test. Per `standards/correctness.md` § Practice 4 (mutation testing), the fitness signal we want is "tests detect introduced faults" — not just "tests pass".

Sprint 2.3 introduces Stryker into the verifier pipeline as a fitness gate. Open questions:
1. Performance: can incremental mutation runs fit in PR-time budget (≤5min)?
2. Cadence: per-PR (slow but rigorous) vs nightly (fast PRs, delayed feedback)?
3. Threshold: hard gate at what mutation-score %, advisory at what %?
4. Coverage: which modules earn payment-tier rigor (80%+)?
5. Companion tools: Property-Generated Solver (arXiv 2506.18315) and Meta ACH (FSE 2025) — adopt now or defer?

## 2. Findings

### 2.1 — StrykerJS state May 2026

- `@stryker-mutator/core` v9.6.0 (April 2026), pure ESM, runs on Node 20/22 LTS.
- **Incremental mode** mature since v6.2 — diffs against `reports/stryker-incremental.json`, mutates ONLY files in current diff. Reuse rates ~94% on real projects (3731/3965 mutants reused, 234 newly run typical).
- Full runs on large suites: 30–60 min. Incremental PR runs: **1–5 min** with parallel workers + coverage analysis.
- Sources: [StrykerJS incremental docs](https://stryker-mutator.io/docs/stryker-js/incremental/), [oneuptime guide](https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view), [@stryker-mutator/core npm](https://www.npmjs.com/package/@stryker-mutator/core).

### 2.2 — Property-Generated Solver (arXiv 2506.18315, He et al., June 2025)

- **NOT** a mutation testing tool — uses **property-based testing** (PBT) instead.
- Two-agent loop: Generator + Tester. Properties validate invariants against generated inputs.
- **Complement to Stryker, not replacement**: PBT strengthens assertions (good test bodies), Stryker measures whether tests catch faults.
- Implementable in Node.js via `fast-check` (zero-deps preserved if added as devDep).
- Reports +23–37% pass@1 vs traditional TDD.
- Source: [arXiv 2506.18315](https://arxiv.org/abs/2506.18315).

**Note**: cortex-x already uses hand-rolled property testing (Sprint 1.6.21 helpers-property.test.cjs + Sprint 2.9.7b property-invariants.test.cjs) — the pattern is established. Adding fast-check would standardize.

### 2.3 — Meta ACH (FSE 2025, arXiv 2501.12862) — corrected from "FSE 2026"

- LLMs generate **fault-class-specific mutants** (e.g. privacy regressions); a second LLM generates tests that kill them.
- Mutation testing is the **feedback signal driving LLM test generation**, not just a post-hoc score.
- Equivalent-mutant detector: 0.79 precision / 0.47 recall (0.95/0.96 with preprocessing).
- Engineers accepted 73% of generated tests across 10,795 Kotlin classes.
- **Heavyweight**: Meta ran on 10K+ classes; not appropriate for cortex-x's ~50-module surface.
- Sources: [arXiv 2501.12862](https://arxiv.org/abs/2501.12862), [Engineering at Meta](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/), [InfoQ summary](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/).

**Decision**: Defer Meta ACH-style LLM mutation generation to Sprint 3.x. Stryker's deterministic mutation operators give a stronger, cheaper baseline first. Aligns with R1 principle: build the fitness signal before the optimizer.

### 2.4 — CI cadence consensus

Hybrid is standard:
- **Per-PR**: incremental, changed-modules only, parallel stage. ≤5 min budget.
- **Nightly/weekly**: full run on main, publish report.

Universal thresholds discouraged. Risk-tiered targets:
- Payment/auth: **~95%**
- Business logic: **~80%**
- Utilities: **~70%**

"≥80% = strong test suite" is rule-of-thumb. Establish baseline by measurement, then ratchet up.

Sources: [mastersoftwaretesting](https://mastersoftwaretesting.com/testing-fundamentals/types-of-testing/mutation-testing), [Codecov](https://about.codecov.io/blog/mutation-testing-how-to-ensure-code-coverage-isnt-a-vanity-metric/), [empirical CI study (greg4cr 2023)](https://greg4cr.github.io/pdf/23mutationci.pdf).

## 3. Recommendation for cortex-x

### 3.1 — Adopt StrykerJS 9.6 in incremental mode

**Zero-deps invariant preserved.** StrykerJS lives in `devDependencies` like vitest, fast-check, etc. — same precedent as existing test infrastructure. The runtime core (`bin/steward/_lib/`) stays zero-deps; mutation tooling is a dev-time fitness gate.

### 3.2 — Cadence

**Per-PR (incremental):**
- `stryker run --incremental` scoped to Steward-touched files
- **Hard requirement** on `bin/steward/_lib/**` (the autonomous-runtime fitness target — these primitives can write commits, push branches, mutate filesystems on operator's projects)
- Budget ≤5 min using coverage analysis + parallel workers (8 cores on GHA `ubuntu-latest`)

**Nightly cron (full):**
- Full mutation run on main, alongside autoresearch overnight burst (Sprint 2.1)
- Publish report to `cortex/mutation-reports/<date>.json`
- Track mutation-score delta — natural signal for `tech_debt_audit` (Sprint 2.5) drift detection

### 3.3 — Initial thresholds (risk-tiered, NOT universal)

| Module class | Threshold | Gate |
|---|---|---|
| `bin/steward/_lib/**` (halt-check, lock, journal, cost-safety, spec-verifier, action-engine, autoresearch) | **80%** | HARD |
| `bin/steward/*.cjs` orchestrators (dry-run, execute, status) | **70%** | HARD |
| `bin/cortex/tools/**` (Sprint 2.9 Tools Foundation) | **75%** | HARD |
| `detectors/**` (deterministic kind detectors) | **60%** | ADVISORY (warn, not blocker) |
| `templates/**` | N/A (no executable code) | — |
| Everything else | measure-first baseline | no gate until Sprint 3.x |

### 3.4 — Companion: Property-Generated Solver pattern

Add `fast-check` to devDeps. Generate property tests for highest-risk primitives:
- `halt-check` (kill-switch invariants)
- `cost-safety` (multi-window cap monotonicity)
- `spec-verifier` (criterion runner determinism)
- `action-engine` (engine seam contract)
- `path-safety` (containment invariants — already have hand-rolled coverage from Sprint 2.9)

Properties strengthen assertions; Stryker confirms they catch faults. Directly addresses Meta-style "tests that compile but don't exercise" failure mode.

### 3.5 — Defer Meta ACH

Sprint 3.x territory. Wait for:
- Stryker baseline established (3-month real-data measurement)
- Sprint 3.0 AlphaEvolve prompt evolution shipped (LLM-driven optimization infrastructure exists)
- Cost envelope clear ($0 under Max sub via Sprint 2.4 claude-cli engine)

## 4. Acceptance criteria proposal (Sprint 2.3)

1. `package.json` adds `@stryker-mutator/core` + `@stryker-mutator/typescript-checker` (or JS equivalent) + `fast-check` to `devDependencies`.
2. `stryker.conf.json` configured with:
   - `incremental: true`
   - `coverageAnalysis: 'perTest'`
   - `concurrency: 8`
   - `mutate: ['bin/steward/_lib/**/*.cjs', 'bin/steward/*.cjs', 'bin/cortex/tools/**/*.cjs', 'detectors/**/*.cjs']`
   - `thresholds: { high: 80, low: 70, break: 70 }`
3. New npm script `npm run test:mutation` (incremental) + `npm run test:mutation:full` (full run).
4. New CI workflow `.github/workflows/mutation-test.yml`:
   - Runs on PR (incremental, changed-files only)
   - Runs nightly (full, on main)
   - Hard gate at 80% for `bin/steward/_lib/**` (advisory below 70%)
5. New module `bin/steward/_lib/verifier-mutation.cjs` — runs incremental Stryker as part of verifier pipeline (post-`runNpmTest`, only for `recommendation` kind initially).
6. New action_kind `mutation_score_drift` (Sprint 2.5 tech_debt_audit pattern) — files gh issue when nightly mutation score drops > 5pp vs prior run.
7. New error code `EDIT_MUTATION_REGRESSION` — when post-edit incremental mutation score is below pre-edit baseline.
8. ≥ 30 new tests covering verifier-mutation runner + mutation-score parser + drift detector.
9. R1 memo (this file) committed.
10. R2 review pipeline (acceptance + correctness + edge-case) — focused on test-suite scaling concerns + flake-rate impact.

## 5. Cost + effort estimate

- **R1 dispatch**: ✅ DONE (this memo, ~$0.01).
- **R2 review pipeline**: ~$0.04 (3 agents).
- **Implementation**: ~1.5 evening sessions (~10h focused). Adds StrykerJS dev-deps, configures incremental mode, wires verifier-mutation, adds CI workflow, writes ~30 tests.
- **Token cost (per-PR mutation runs)**: $0 (Stryker is local-CPU, no LLM).
- **Token cost (nightly mutation runs)**: $0 same.
- **GHA minutes**: incremental PR ~5 min × ~10 PRs/week = 50 min/week. Full nightly ~45 min × 7 = 315 min/week. Total: ~365 min/week added. With current GHA quota that's ~1500 min/month — 75% of free tier just for mutation testing. **MUST consider GHA cost or use self-hosted runner.**
- **GHA cost mitigation**: scope incremental mutation to `bin/steward/_lib/**` only (smallest surface, highest value). Skip if no `bin/steward/_lib/` files in diff. Reduces typical PR cost to ~30s.

## 6. Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| GHA quota burn from full nightly mutation runs | HIGH | Scope nightly to weekly only OR move to self-hosted runner |
| Flaky test amplification (mutation testing × flaky test = N×M failures) | MEDIUM | Treat flakes as blockers BEFORE shipping mutation gate; existing flaky_test_repair (Sprint 1.8.5) handles |
| Stryker incremental cache corruption on cherry-pick / rebase | LOW | `stryker.conf.json` excludes incremental cache from git; gracefully falls back to full run on cache miss |
| 80% threshold too aggressive for v0 baseline | MEDIUM | Start with measure-only mode 2 weeks; ratchet up after baseline data |
| Stryker's TypeScript checker plugin complexity | LOW | cortex-x is mostly CJS .cjs; TypeScript checker is opt-in, skip until/unless TS files added |

## 7. Out of scope (deferred to Sprint 3.x or later)

- **Meta ACH-style LLM mutation generation** — Sprint 3.x; needs Stryker baseline first.
- **Property-Generated Solver multi-agent loop** — Sprint 3.0 AlphaEvolve territory.
- **Equivalent-mutant detection** — Stryker's static analysis is good enough for v0; AI-assisted equivalent detection is Sprint 3.x optimization.
- **Cross-language mutation testing** — cortex-x is JS-only; Sprint 4.x marketplace concerns.

## 8. Decision

Awaiting operator approval. Proposed sequencing if green-lit:
1. **Add devDeps** (`@stryker-mutator/core`, `fast-check`) + `stryker.conf.json` baseline config.
2. **Run measure-only mode** for 2 weeks — collect baseline scores per module.
3. **Set initial thresholds** at observed-baseline level (likely 60-70%, NOT 80% on day 1).
4. **Wire verifier-mutation gate** as ADVISORY first, ratchet to HARD after 30-day data.
5. **R2 review pipeline** focused on flake-rate impact + GHA quota burn.

## 9. References

1. https://stryker-mutator.io/docs/stryker-js/incremental/
2. https://stryker-mutator.io/blog/announcing-incremental-mode/
3. https://www.npmjs.com/package/@stryker-mutator/core
4. https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view
5. https://arxiv.org/abs/2506.18315 (Property-Generated Solver)
6. https://arxiv.org/abs/2501.12862 (Meta ACH)
7. https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/
8. https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/
9. https://about.codecov.io/blog/mutation-testing-how-to-ensure-code-coverage-isnt-a-vanity-metric/
10. https://mastersoftwaretesting.com/testing-fundamentals/types-of-testing/mutation-testing
11. https://greg4cr.github.io/pdf/23mutationci.pdf
