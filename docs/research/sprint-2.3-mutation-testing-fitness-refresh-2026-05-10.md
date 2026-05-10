---
sprint: 2.3
title: Stryker mutation testing as fitness signal — R1 refresh (post-2.2.5)
date: 2026-05-10
status: research-complete (autonomous afternoon session, 3 parallel research dispatches)
prior_memo: docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md
based_on: 3 parallel web research agents 2026-05-10 — Stryker 9.6 production patterns / mutation-on-autonomous-agents / GHA cost + risk-tiered thresholds; combined with Sprint 2.2.5 v0+v1 ship lessons (commits 4a3a145 + 09dabb2) + Round 11 dogfood architectural finding
---

# Sprint 2.3 — R1 refresh: mutation testing fitness signal post-Sprint 2.2.5

## TL;DR

The 2026-05-09 R1 memo got the direction right (Stryker 9.6 + risk-tiered thresholds + per-PR incremental), but **3 architectural items need correction or addition** based on (a) 1-day delta in tooling, (b) Sprint 2.2.5's `splice.cjs` shipping today, (c) today's Round 11 dogfood lesson. Net plan stays ship-able in M effort (1-2 days focused work) but with a sharper sequencing and a load-bearing novelty hook (Steward = first published autonomous-agent runtime to gate LLM patches on mutation score, per research agent #3).

**Headline corrections vs prior memo**:

1. **Stryker has ONE global threshold triple per invocation, not per-directory.** Original "80% bin/steward/_lib + 70% orchestrators + 75% bin/cortex/tools + 60% advisory detectors" requires N separate Stryker calls + CI matrix. Real implementation cost.
2. **`splice.cjs` exists now (496 LoC, 13 EDIT_OP_* codes)** and inherits "auth-tier" risk profile (corrupts operator's repo if rollback fails). Recommended target: **90%** via ratchet, not the prior generic 80%.
3. **Cost question dissolves on public-repo flip.** GHA Linux on public repos = free + unlimited. Self-hosting actively penalized after 2026-03-01 ($0.002/min on private). Don't self-host.
4. **Sparse prior art = publishable novelty.** No 2025-2026 paper found gating Aider / SWE-agent / Continue PRs on mutation score. Sprint 2.3 = first-mover, not replicator.

## 1. Question

Same as prior memo: cortex-x has ~1860 unit + contract + integration tests; `npm test` is the verifier gate; per `standards/correctness.md` § Practice 4 the fitness signal is "tests detect introduced faults," not "tests pass." Sprint 2.3 introduces Stryker as a fitness gate. Open questions identical:

1. Performance: incremental fits ≤5min PR budget?
2. Cadence: per-PR vs nightly?
3. Threshold: hard gate at what %?
4. Coverage: which modules earn auth-tier rigor (90%)?
5. Companions: Property-Generated Solver / Meta ACH — adopt or defer?

## 2. New findings since 2026-05-09

### 2.1 — StrykerJS state confirmed

`@stryker-mutator/core` 9.6.1 (2026-04-10) is bugfix-only on top of 9.6.0 (2026-02-27). **One useful new feature**: `concurrency: '50%'` percentage strings (works across operator's 16-core box AND GHA's 4-core runners with same config). Replace prior memo's hardcoded `concurrency: 8`.

### 2.2 — Stryker has ONE global threshold triple, NOT per-directory ⚠️

**This is the architectural finding the prior memo missed.** Per [Stryker configuration docs](https://stryker-mutator.io/docs/stryker-js/configuration/) + [issue #2434](https://github.com/stryker-mutator/stryker-js/issues/2434), `thresholds: { high, low, break }` is global per invocation. To enforce different thresholds on `bin/steward/_lib/` (80%) vs `detectors/` (60%), you need:

- Multiple stryker config files (`stryker.lib.conf.json`, `stryker.detectors.conf.json`, etc.)
- N separate `npx stryker run --config-file=...` calls
- CI matrix dispatching per directory

**Pragmatic v1 alternative** (recommended): single Stryker invocation across the **hard-gate scope only** (splice.cjs + action-engine.cjs + spec-verifier.cjs = ~2778 LoC), with a single global `break` threshold. Detectors / orchestrators get measure-only mode (no `break`). Per-directory matrix is a v1.5 follow-up if telemetry justifies.

### 2.3 — Public repo = free GHA = cost question dissolves

[GitHub Actions billing 2026](https://docs.github.com/en/actions/concepts/billing-and-usage) confirms public repos on GH-hosted Linux runners = **free, unlimited**. Once cortex-x flips public after v0.1.0, all Stryker cost analysis becomes moot. Self-hosting penalty: $0.002/min platform fee on private repos after 2026-03-01 ([devclass](https://devclass.com/2025/12/17/github-to-charge-for-self-hosted-runners-from-march-2026/)). **Don't self-host.** Just ship Sprint 2.3 with `runs-on: ubuntu-latest` and accept the 30-45 min nightly cost.

### 2.4 — Mutation-as-fitness for autonomous agents = publishable novelty 🌟

Research agent #3 surfaced **the load-bearing finding for Sprint 2.3 positioning**:

- No 2025-2026 paper gates Aider / SWE-agent / Continue / Copilot PRs on mutation score.
- Aider auto-runs lint+tests, no mutation hook ([Aider 2026 guide](https://devstarsj.github.io/ai-tools/2026-04-11-Aider-AI-Coding-Assistant-Complete-Guide-2026/)).
- Continue gates on Sentry/Snyk/Jira ([review](https://aiagentslist.com/agents/continue)), no mutation.
- SWE-bench leaderboards don't track mutation ([swebench.com](https://www.swebench.com/)).
- Adjacent published work (Meta ACH FSE 2025, MutGen, MuTAP) uses LLMs to GENERATE tests guided by mutants, NOT to gate agent-authored patches.
- [Fowler's Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) mentions "some monitor with mutation testing" — anecdotal, no repo configs cited.
- [InfoQ Jan 2026](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/) confirms mutation-as-agent-fitness is "emerging, not standardized."

**For Steward**: gating Stryker AFTER `npm test` in the spec-verifier pipeline = first-mover position. Frame in launch essay; cite Meta ACH + llmorpheus as nearest prior art. Specific design hook: [testdouble.com — Keep your coding agent on task with mutation testing](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing) describes the **prompt-then-verify** pattern that maps cleanly onto Steward's spec-verifier — literal architecture validation by a tool publication.

### 2.5 — Real catch rate: ~50% of LLM patches that pass `npm test` would fail mutation

[arXiv 2406.09843 — Comprehensive LLM mutation study](https://arxiv.org/html/2406.09843v4): LLM-written tests average **40% mutation score** vs **79% line coverage**. Practical reading: ~half of LLM patches passing `npm test` will survive a mutation gate. **Real ROI signal, not theoretical.**

[arXiv 2510.25297 — PBT edge-case study](https://arxiv.org/abs/2510.25297) Oct 2025: PBT 68.75% bug detection alone, EBT 68.75% alone, **combined 81.25%**. Strongest empirical complementarity evidence — supports keeping PBT-via-fast-check alongside mutation, not as redundant.

### 2.6 — splice.cjs is a defined Sprint 2.3 target now

Sprint 2.2.5 v0+v1 shipped today (commits `4a3a145` + `09dabb2`). `bin/steward/_lib/splice.cjs` is **496 LoC** with **13 EDIT_OP_* error codes** + atomic snapshot+rollback + symlink lstat refusal + LLM-as-code defense regex. Risk profile = **auth-tier** (corrupts operator's repo if rollback fails). Recommended threshold target: **90% via ratchet over Q4 2026**, not 80%. Not enforceable on day 1 — measure-only, then `break = baseline - 2pp` after 2 weeks, +5pp/quarter.

### 2.7 — Round 11 dogfood architectural lesson 🌶️

Round 11 nightly (run 25627821093) attempted Sprint 2.2.5 v1 ops on rec #6 (JSDoc str_replace insert). Result: failure with `EDIT_OP_STALE_SHA` because LLM hallucinated `expectedSha256` (no file content in prompt → no real SHA to echo). **Defense-by-design worked** — engine SHA gate refused.

This finding informs Sprint 2.3 implementation:
- splice.cjs's SHA gate is a critical defense layer that mutation testing should explicitly cover (the `EDIT_OP_STALE_SHA` branch is one of the highest-value mutants to kill).
- Splice's error-handling branches are the "exception-handler survivor" pattern from [Stryker FAQ](https://stryker-mutator.io/docs/General/faq/) — many mutants will survive because tests don't induce every failure mode.
- **Two-tier strategy**: hard-gate on happy-path mutants (touched by edit_ops kinds), advisory on error-handling mutants. Mirror's research agent #3 recommendation.

## 3. Decision — phased Sprint 2.3 ship plan

### Phase 0 — In-house baseline (this week, ~1.5h focused)

Run Stryker locally on splice.cjs alone:
```bash
npx -p @stryker-mutator/core@^9.6.1 stryker run \
  --mutate "bin/steward/_lib/splice.cjs" \
  --concurrency '50%' \
  --reporters html,clear-text,json \
  --testRunner node-test \
  --coverageAnalysis perTest
```

Expected: ~400-700 mutants on 496 LoC, 30-90 min wall-clock with coverage filter. Output: **real baseline number** — drives initial threshold. No CI plumbing required.

### Phase 1 — Sprint 2.3 v0 (M effort, ~6-8h)

**devDeps**:
- `@stryker-mutator/core: ^9.6.1`
- `@stryker-mutator/api: ^9.6.1` (if needed for `node-test` runner)
- `fast-check: ^4.x` (standardize hand-rolled property tests; zero-runtime-deps invariant preserved)

**`stryker.conf.json` at repo root** (single-invocation, hard-gate scope):
```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "npm",
  "testRunner": "node-test",
  "mutate": [
    "bin/steward/_lib/{splice,action-engine,spec-verifier,action-kinds}.cjs",
    "bin/steward/_lib/{policy-check,halt-check,cost-safety,recommendations}.cjs"
  ],
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "coverageAnalysis": "perTest",
  "concurrency": "50%",
  "reporters": ["html", "clear-text", "progress", "json"],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": null
  },
  "timeoutMS": 60000,
  "tempDirName": ".cortex-data/.stryker-tmp",
  "cleanTempDir": "always"
}
```

`break: null` ships measure-only; switched to `break = baseline - 2pp` after 2 weeks observation. Ratchet quarterly toward 90% on splice.cjs.

**Verifier gate integration** (`bin/steward/_lib/spec-verifier.cjs`):
- New criterion kind: `mutation_score` (sixth kind alongside shell / file_predicate / regex / ears_text / llm_judge).
- Action-kind opts in via `acceptance_criteria: [{ kind: 'mutation_score', threshold: -2, scope: 'incremental' }]` — score must not regress more than 2pp on touched files.
- Implementation: shells out to `npx stryker run --since=HEAD~1`, parses JSON report at `reports/mutation/mutation.json`, compares to baseline.
- Failure → SPEC_VIOLATION with id `mutation_score_regression`, error code `EDIT_MUTATION_REGRESSION`.

**GHA workflow** (`.github/workflows/stryker.yml`):
- `on: push` to feature branches → incremental scope (≤3 min budget).
- `on: schedule: cron '15 3 * * *'` → full nightly (~30-45 min, fits public-repo free tier).
- `actions/cache@v4` keyed on `main` SHA persists `reports/stryker-incremental.json` between runs.

### Phase 2 — Sprint 2.3 v1 (Sprint 2.5 territory, deferred)

- New action_kind `mutation_score_drift` (Sprint 2.5 tech_debt_audit pattern) — files gh issue when nightly score drops >5pp.
- Per-directory thresholds via CI matrix (only if v0 telemetry shows single-config insufficient).
- Property-Generated Solver / Meta ACH integration (defer to Sprint 3.x; Sprint 2.3 v0 ships fast-check standardization only).

## 4. Updated open questions for operator

Original 5 from prior memo + 3 new:

1. **Cadence**: per-PR incremental + nightly full (recommended — public repo free) OR weekly-only (cheaper but slower feedback)? **Recommendation**: per-PR + nightly.
2. **Self-hosted runner?** **Recommendation**: NO. Public repo flip post-v0.1.0 makes free GHA the obviously-best option.
3. **Initial threshold**: 80% hard from day 1 OR measure-only 2 weeks → ratchet? **Recommendation**: measure-only (`break: null`), ratchet from observed baseline. Day-1 80% guarantees red CI.
4. **Pre-ship eval tonight?** **Recommendation**: yes, run on splice.cjs alone. ~90 min wall-clock. Real baseline drives Phase 1 start.
5. **fast-check adopt?** **Recommendation**: yes, devDep alongside Stryker. Standardizes 5 hand-rolled property test files.
6. **NEW — single-config or per-directory matrix?** **Recommendation**: single-config v0 (hard-gate scope only). Matrix is v1.5 if telemetry shows it's needed.
7. **NEW — mutation_score criterion kind in v0 or defer?** **Recommendation**: ship as kind in v0 but with `break: null` posture → criterion is observable but never blocks until ratchet enabled.
8. **NEW — frame in launch essay as novelty?** **Recommendation**: yes. testdouble.com pattern + sparse prior art = differentiation. cite Meta ACH + llmorpheus as nearest neighbors.

## 5. Stolen from / new citations vs prior memo

Prior memo's 10 sources stand. Adding from refresh:

- [testdouble.com — Keep your coding agent on task with mutation testing](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing) — load-bearing prompt-then-verify reference.
- [GitHub Next llmorpheus](https://github.com/githubnext/llmorpheus) — closest published precedent for LLM-mutation integration.
- [arXiv 2510.25297 — LLM PBT edge-case study](https://arxiv.org/abs/2510.25297) — empirical complementarity evidence.
- [arXiv 2510.08996 — Saving SWE-Bench](https://arxiv.org/abs/2510.08996) — SWE-bench scores overestimate by 36-53%; reinforces R6 skepticism of npm-test-only gates.
- [arXiv 2506.02954 — MutGen](https://arxiv.org/abs/2506.02954) (revised April 2026) — strongest evidence mutation > coverage as fitness signal.
- [Stryker config docs](https://stryker-mutator.io/docs/stryker-js/configuration/) + [issue #2434](https://github.com/stryker-mutator/stryker-js/issues/2434) — single-threshold-triple architectural finding.
- [GHA billing 2026](https://docs.github.com/en/actions/concepts/billing-and-usage) + [GH self-hosted pricing changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/) — public-repo free, self-hosted penalized.
- [Codecov mutation rule-of-thumb](https://about.codecov.io/blog/mutation-testing-how-to-ensure-code-coverage-isnt-a-vanity-metric/) — 80% error-handling threshold reference.
- [Betterer ratchet docs](https://phenomnomnominal.github.io/betterer/docs/typescript-test/) + [ratchets blog](https://www.dustyburwell.com/2019/05/29/ratchets) — measure-then-ratchet pattern.
- [eferro Nov 2025 mutation testing](https://www.eferro.net/2025/11/mutation-testing-when-good-enough-tests.html) — exception-handler survivor pattern.

## 6. Effort estimate (revised)

| Phase | Effort | Driver |
|---|---|---|
| Phase 0 baseline (splice.cjs) | 1.5 h | tonight's run, no CI plumbing |
| Phase 1 v0 ship (Stryker + fast-check + mutation_score criterion + GHA workflow) | 6-8 h | concrete config, criterion impl, prompt-then-verify pattern wiring, MIGRATIONS entry |
| **Total Sprint 2.3 v0** | **8-10 h** | Estimate revised up from prior memo's S-M (4-6 h) — `mutation_score` criterion + Round 11 lesson + single-vs-matrix decision adds scope |

Phase 2 (mutation_score_drift action_kind + per-directory matrix + property/Meta ACH integration) → defer to Sprint 2.5+ (~6-8 h additional when justified).

## 7. Pre-implementation checklist

- [x] R1 refresh synthesized
- [x] 3-hop traceability per claim (each new finding cites at least one URL)
- [ ] Operator OK on 8 open questions (4 are new vs prior memo)
- [ ] Phase 0 baseline run (~90 min on splice.cjs)
- [ ] R2 review pipeline (6 agents) on this refreshed memo
- [ ] R2 amendment commit
- [ ] Then implementation

## 8. Verdict

**Proceed with Phase 0 (baseline) + Phase 1 (v0 ship).** R1 refresh confirms the prior memo's direction was right; today's findings sharpen the implementation. Splice.cjs is the natural anchor: it's safety-critical, it just shipped, it has 13 distinct error branches that Stryker will surface as survivors, and it's the smallest module to start with. Cost is a non-issue post-public-flip. Frame in launch essay as first-mover on autonomous-agent mutation gating.

**R1 refresh status**: ✅ COMPLETE 2026-05-10. Ready for R2 6-agent review pipeline → amendment → implementation.
