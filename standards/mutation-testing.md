# Mutation testing — fitness signal beyond "tests pass"

> **Tier:** Rule 2 (Critical). Companion to [`correctness.md`](./correctness.md) §Practice 4 (mutation testing). Sprint 2.3 v0 ships the measurement infrastructure; ratchet thresholds activate after a 2-week baseline period.

A passing test suite proves nothing about whether the tests would catch a regression. Mutation testing systematically modifies your code (one operator change at a time) and re-runs the tests. If the mutated code still passes all tests, the mutation **survived** — meaning your tests don't actually cover that line's intent. If tests fail, the mutation is **killed** — tests are doing their job.

For cortex-x specifically, the fitness signal matters more than coverage: Steward LLM-edited patches can pass `npm test` while leaving load-bearing branches untested. Mutation testing is the post-test gate that catches "tests pass but don't exercise the diff."

## Why cortex-x ships this

Sprint 2.3 R1 refresh (2026-05-10) surfaced 3 findings:

1. **Real catch rate ~50%.** Per [arXiv 2406.09843](https://arxiv.org/html/2406.09843v4), LLM-written tests average **40% mutation score** vs **79% line coverage** — meaning ~half of LLM patches passing `npm test` would fail a mutation gate. This is real ROI signal, not theoretical.

2. **Publishable novelty.** No 2025-2026 paper / OSS framework gates Aider / SWE-agent / Continue / Copilot PRs on mutation score. Steward is the first-mover. See [testdouble.com — Keep your coding agent on task with mutation testing](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing) — the "prompt-then-verify" pattern that maps cleanly onto Steward's spec-verifier.

3. **Public repo = free GHA.** Public repos on GH-hosted Linux runners are free + unlimited per [GHA billing 2026](https://docs.github.com/en/actions/concepts/billing-and-usage). Self-hosting is actively penalized ($0.002/min after 2026-03-01). Recommendation: don't self-host. Just ship with `runs-on: ubuntu-latest`.

## Tooling

- **StrykerJS 9.6+** — JavaScript/TypeScript mutation testing. Latest stable: 9.6.1 (2026-04-10). Configured via `stryker.conf.json` at repo root.
- **node-test runner** — uses Node's native test runner (no Jest/Vitest dependency).
- **fast-check 4.x** — property-based companion. Property tests + mutation testing are empirically complementary (PBT 68.75% alone, mutation 68.75% alone, **combined 81.25%** per [arXiv 2510.25297](https://arxiv.org/abs/2510.25297)).

## What gets mutated (v0 scope)

Single Stryker invocation across the **auth-tier hard-gate scope** only:

- `bin/steward/_lib/splice.cjs` — file mutation primitive (highest risk; corrupts operator's repo if rollback fails)
- `bin/steward/_lib/spec-verifier.cjs` — acceptance-criteria runner; gates every Steward edit
- `bin/steward/_lib/halt-check.cjs` — file-based killswitch (operator-only clear)
- `bin/steward/_lib/cost-safety.cjs` — D/W/M USD caps + token-velocity cap
- `bin/steward/_lib/recommendations.cjs` — recommendations parser (Steward entry point)
- `bin/steward/_lib/policy-check.cjs` — denylist for shell commands Steward may invoke

Modules outside this scope (orchestrators, detectors, qa-engineer profile code) get measure-only visibility via the nightly full run; no break threshold applies to them yet.

## Threshold posture

**v0 ships `break: null`** — measure-only. The Stryker run reports the score but **never fails CI**. This is intentional:

- We don't have a baseline yet — picking 80% from day 1 risks red CI on a project that may sit at 65% naturally.
- The 2-week observation period yields a real baseline number per module.
- After baseline, switch `break` to `baseline - 2pp` (regression detection, not absolute floor).
- Quarterly ratchet toward target floors: 90% on splice.cjs, 80% on spec-verifier + cost-safety + halt-check, 70% on policy-check + recommendations.

This mirrors [Betterer's ratchet pattern](https://phenomnomnominal.github.io/betterer/) — measure-then-improve, never regress.

## Cadence

- **Per push to `main` / `sprint-*` / `feature/*`** (paths-filtered to relevant LoC + config) — incremental scan via `--since=HEAD~1`. Targets <5min wall-clock.
- **Nightly cron 03:15 UTC** — full scan across all configured modules. Writes the incremental cache that pushes consume. 30-45min wall-clock; comfortably under the 60-min `timeout-minutes` cap.
- **Manual via `workflow_dispatch`** — operator can trigger incremental or full from the Actions UI.

## How to interpret reports

After each Stryker run, three artifacts are uploaded to the GH Actions artifact store (14-day retention):

- `reports/mutation/index.html` — interactive HTML report. Click a file to see surviving mutants, hover to see the mutation operator that survived.
- `reports/mutation/mutation.json` — machine-readable score per file + per-mutator breakdown. Consumed by the GH Action summary step.
- `reports/stryker-incremental.json` — cache used by `--since=HEAD~1`. Persisted across runs via `actions/cache@v4`.

**Surviving mutant = test gap.** The action to take:
- If the surviving mutant is on a happy-path branch — add a test that would catch it.
- If on an error-handler that's hard to provoke — file under "acceptable" per [eferro Nov 2025](https://www.eferro.net/2025/11/mutation-testing-when-good-enough-tests.html) "exception-handler survivor" pattern.

## What's NOT in v0

- **Per-directory thresholds via CI matrix.** Stryker has ONE global `thresholds` triple per invocation (issue [#2434](https://github.com/stryker-mutator/stryker-js/issues/2434)). Per-module floors would require N separate runs. Deferred to v1.5 if telemetry shows the single-config approach is insufficient.
- **`mutation_score` criterion kind in spec-verifier.cjs.** Adding a 7th criterion kind to the verifier hot-path requires careful integration (read `reports/mutation/mutation.json` lazily, compare against per-action baseline). Deferred to Sprint 2.3.1 — first establish baseline numbers, then wire the gate.
- **Self-improvement loop integration.** Sprint 2.5+ may add a `mutation_score_drift` action_kind that files a GH issue when nightly score drops >5pp on a module. Not in v0.
- **LLM-generated mutation operators (Meta ACH, llmorpheus).** Deferred to Sprint 3.x. v0 uses Stryker's stock mutators (sufficient for ROI proof).
- **Self-hosted runner.** Public-repo free GHA tier covers the workload; self-hosting adds operational burden + the post-March-2026 platform fee on private repos.

## References

- [StrykerJS docs](https://stryker-mutator.io/docs/stryker-js/introduction)
- [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [Stryker incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [Stryker FAQ — exception-handler survivors](https://stryker-mutator.io/docs/General/faq/)
- [Sprint 2.3 R1 original (2026-05-09)](../docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md)
- [Sprint 2.3 R1 refresh (2026-05-10)](../docs/research/sprint-2.3-mutation-testing-fitness-refresh-2026-05-10.md)
- [arXiv 2406.09843 — LLM-written tests mutation study](https://arxiv.org/html/2406.09843v4)
- [arXiv 2510.25297 — PBT + mutation complementarity](https://arxiv.org/abs/2510.25297)
- [arXiv 2506.02954 — MutGen: mutation > coverage as fitness signal](https://arxiv.org/abs/2506.02954)
- [testdouble.com — prompt-then-verify pattern](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing)
- [GitHub Next llmorpheus](https://github.com/githubnext/llmorpheus) — closest published precedent
- [GHA billing 2026](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Betterer ratchet docs](https://phenomnomnominal.github.io/betterer/) — measure-then-improve
