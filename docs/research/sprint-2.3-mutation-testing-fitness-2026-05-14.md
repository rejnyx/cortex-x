# Sprint 2.3 — Mutation testing fitness R1 memo (fresh 2026-05-14)

> Refresh of `sprint-2.3-mutation-testing-fitness-2026-05-09.md` and `…-refresh-2026-05-10.md`.
> Captured 2026-05-14. Goal: unblock implementation tonight with conservative defaults pre-chosen.

## Findings (with URLs)

### 1. StrykerJS current version + features

**Latest stable: `@stryker-mutator/core@9.6.1`**, released 2026-04-10 ([releases](https://github.com/stryker-mutator/stryker-js/releases), [npm](https://www.npmjs.com/package/@stryker-mutator/core)). v9.6.0 (2026-02-27) added **percentage-based concurrency** (`"50%"`) — useful for self-hosted runners where the box does other work. v9.6.1 bumped `typed-rest-client`, `mutation-testing-elements`, fixed Vitest 4.1 hit-count.

**Install footprint (CommonJS-safe).** `npm init stryker@latest` runs a Clack wizard ([getting-started](https://stryker-mutator.io/docs/stryker-js/getting-started/)); the wizard writes `stryker.config.mjs` by default but **JSON config (`stryker.config.json`) is supported** and is the right choice for cortex-x's zero-deps CJS posture — no `.mjs` in source tree, no ESM/CJS interop. Core packages we'll need:

- `@stryker-mutator/core` (engine)
- `@stryker-mutator/mocha-runner` OR the `command` runner (the latter just shells `npm test` and bases verdict on exit code — see [config](https://stryker-mutator.io/docs/stryker-js/configuration/) §`testRunner`). **Use `command` runner** to stay framework-agnostic and avoid pulling Mocha bindings; this matches how `runNpmTest` already works in Steward.

Stryker is `devDependency`-only; it doesn't ship into production. Adds ~30 transitive packages (typescript, mutate-related elements). Acceptable since it's behind a CI lane, not the runtime hot path.

**Defaults from the config docs:**

- `thresholds`: `{ high: 80, low: 60, break: null }` (break: null means: never fail the build on score).
- `mutate` glob: `['{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).+(cjs|mjs|js|ts|...)']` — excludes `__tests__` and `*.spec/*.test`. For cortex-x we'll override to `['bin/**/!(*.test).cjs', '!bin/**/__tests__/**']`.
- `concurrency`: `cpuCoreCount <= 4 ? cpuCoreCount : cpuCoreCount - 1`. Override to `"50%"` on shared GHA hosted runners to leave headroom.
- `coverageAnalysis: "perTest"` + `ignoreStatic: true` is the recommended combo for skipping load-time-only mutants ([config](https://stryker-mutator.io/docs/stryker-js/configuration/)).

**Incremental mode** ([docs](https://stryker-mutator.io/docs/stryker-js/incremental/), [announce](https://stryker-mutator.io/blog/announcing-incremental-mode/)): persists `reports/stryker-incremental.json`, git-diffs mutants + tests between runs, reuses verdicts when unchanged. **Caveats that bite us:** doesn't detect changes outside mutated/test files (dep bumps, env vars, `.snap` files invisible); static mutants can't track test-side changes. Recommended pattern: incremental on PRs, **full --force run weekly** to prevent report drift.

### 2. GHA quota burn — concrete numbers

**Free tier private repo: 2000 min/month** ([billing](https://docs.github.com/en/actions/concepts/billing-and-usage), [pricing](https://github.com/pricing)). Public repos: **unlimited free** on standard runners. 2026 pricing changes ([blog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/), [resources](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/)): hosted-runner prices dropped up to 39% (2026-01-01); new $0.002/min charge on self-hosted runner usage (2026-03-01) — small but no longer free.

**Concrete numbers in the wild:**

- Stryker's own dev-loop quote: "mutation testing Stryker itself needs ~45 minutes on a computer" ([oneuptime guide](https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view)).
- Reference Node project (small, 13 mutants, 5 killed): ~36 seconds full run ([alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)) — but that's a single feature, not 2894 tests.
- **Best estimate for cortex-x (2894 tests across ~150 source files in `bin/`):** unscientific extrapolation says **30–90 min** for full run, **3–8 min** for incremental on a typical PR diff. Mark as **uncertain — must measure on first run**.

**Quota math for cortex-x (private repo, free tier):**
- Full run weekly: 4 × 60 min = **240 min/month** = 12% of quota.
- Incremental per PR (assume 20 PRs/month, 5 min each): **100 min/month** = 5% of quota.
- Combined ≤ **17%** of free quota. Comfortable headroom.

### 3. Self-hosted runner alternatives

GitHub explicitly warns ([self-hosted docs](https://docs.github.com/en/actions/reference/runners/self-hosted-runners), [secure-use](https://docs.github.com/en/actions/reference/security/secure-use)) that self-hosted runners are **persistently compromiseable** by untrusted workflow code — they are **not** ephemeral VMs like hosted runners. Sysdig, Praetorian, and Synacktiv all published 2024–2026 attacks ([sysdig](https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors), [praetorian](https://www.praetorian.com/blog/self-hosted-github-runners-are-backdoors/), [synacktiv](https://www.synacktiv.com/en/publications/github-actions-exploitation-self-hosted-runners)).

**Hard rule from GitHub docs:** "self-hosted runners should almost never be used for public repositories" — any forker can open a PR and execute on your box. cortex-x is currently **private** so this is recoverable, but the moment the launch flips public (Sprint LR.5+), self-hosted on operator's NUC/laptop becomes a P0 risk.

**Mitigation if pursued:** GitHub offers **just-in-time (JIT) ephemeral runners** — at most one job before auto-removal. Combined with separate-machine isolation (a dedicated NUC, not the dev laptop) this is defensible. But it's not a Sprint 2.3 v0 prerequisite — hosted runners are well within budget.

### 4. Risk-tiered thresholds in the wild

Pattern is widely advocated but rarely codified per-module in OSS projects. Best concrete framing from [oneuptime](https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view), [testRigor](https://testrigor.com/blog/understanding-mutation-testing-a-comprehensive-guide/), [mastersoftwaretesting](https://mastersoftwaretesting.com/testing-fundamentals/types-of-testing/mutation-testing):

- **Payment / security / privacy** modules: 90–95% break threshold.
- **Core business logic**: 80% threshold.
- **Utilities / logging / glue**: 60–70% acceptable.
- **Trivial getters / config**: exclude entirely.

Anthropic / Vercel / Replit have **not** published their tiered-threshold configs. The principle is consensus, the numbers are taste. ThoughtWorks Apr 2026 Radar reaffirmed mutation testing (Stryker, PIT, cargo-mutants) as the "shift from how much code is executed to how much is verified" lens.

**For cortex-x mapping to action_kinds:**
- **Tier A — Safety mechanics** (`bin/steward/_lib/cost-safety.cjs`, `halt-check.cjs`, `lock.cjs`, `policy-denylist.cjs`, `spec-verifier.cjs`): **break threshold 85%** — these gate real money + autonomous mutation.
- **Tier B — Action engine** (`action-engine.cjs`, `execute.cjs`, engine adapters): **break 75%**.
- **Tier C — Detectors, CLIs, parsers**: **break 60%**.
- **Tier D — Templates, prompts, docs glue**: **measure-only, no break**.

### 5. Property-based companion (fast-check + Stryker)

`fast-check` is already in cortex-x devDependencies. The research literature on **property-based mutation testing** (PBMT, [Bartocci et al. 2023](https://arxiv.org/pdf/2301.13615)) shows traditional MT typically yields **84–100%** mutation scores while φ-killing mutants against a property yields only **42–57%** — properties are a *stricter* but *complementary* signal, not a replacement.

**Practical pattern (consensus from search):**
1. Write property tests as additional unit tests in the existing Mocha/node:test suite.
2. Run Stryker with the **same** `npm test` runner — properties contribute to mutant kills the same way example-based tests do.
3. Expect **higher mutation scores** on modules where you wrote properties, because fuzzed inputs catch boundary mutants that hand-written examples miss.

No special Stryker config needed; properties are just tests. The win is **kill rate uplift on Tier A modules** where input-space coverage matters (cost safety, lock TTL, policy regex).

### 6. Meta ACH update

ACH presented at **FSE 2025** ([conf page](https://conf.researchr.org/details/fse-2025/fse-2025-industry-papers/16/Mutation-Guided-LLM-based-Test-Generation-at-Meta), [arxiv 2501.12862](https://arxiv.org/abs/2501.12862), [Meta engineering blog Sep 2025](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/), [InfoQ Jan 2026 followup](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/)). Real results: 10,795 Android Kotlin classes, 9,095 LLM-generated mutants, 571 privacy-hardening test cases, **73% acceptance rate** by Meta engineers in test-a-thons.

**Open-source status: NO.** As of 2026-05-14 search, ACH has not been released to GitHub. The methodology is published (`Harden and Catch` JiTTest paper, [arxiv 2504.16472](https://arxiv.org/html/2504.16472v1)), implementation is not. **Defer to Sprint 3.x as planned** — re-implement the *idea* (LLM-generated context-aware mutants beyond Stryker's static catalog) once Tier A coverage is solid via classical Stryker.

### 7. Alternative tools

Stryker remains the only mature mutation testing tool for the JS/TS ecosystem in 2026 ([search 2026 Node alternatives](https://www.npmjs.com/search?q=mutation+testing)). Mutode (2018) hasn't shipped updates. The interesting alternative is **AI-agent-driven mutation testing** ([alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)) — Claude Code reads source, applies one mutation, runs tests, restores — useful when Stryker can't instrument (e.g., Vitest browser mode). For cortex-x this is **interesting as Steward dogfood** (action_kind: `mutation_audit_llm`) but not Sprint 2.3 v0 scope.

## Decisions for Sprint 2.3 v0 implementation

### Open question 1 — Cadence: per-PR incremental OR weekly-only nightly OR both?

**Decision: BOTH, with weekly as canonical.**
- **Per-PR `--incremental`** runs in `mutation-testing.yml` on `pull_request`. Fast (3–8 min est.), informational, **no break threshold** initially — surfaces mutation-score delta in PR comment.
- **Weekly full `--force`** run via `mutation-testing-nightly.yml` on `schedule: '0 3 * * 0'` (Sunday 03:00 UTC). Persists `stryker-incremental.json` artifact for next PR's incremental baseline. **This** is the run that gates the break threshold.

Rationale: PR incremental is faulty signal (misses dep/env changes, static mutants invisible — see §1 caveats). Full weekly is the source of truth. Cost is comfortably under 17% of free quota (§2).

### Open question 2 — Self-hosted runner from day 1 OR later?

**Decision: HOSTED runners only for Sprint 2.3 v0. Self-hosted deferred to Sprint 4.5+.**

Reasoning: (a) §2 shows quota is fine, (b) §3 shows self-hosted is a real security tax (persistent compromise + secret leak between jobs unless JIT ephemeral is set up) — paying that tax for a 30-min wall-time win that we don't yet need is premature optimization. **Revisit when cortex-x goes public and PR cycle time becomes the bottleneck** (post-LR.5).

### Open question 3 — Initial threshold: 80% hard from day 1 OR measure-only 2 weeks → ratchet?

**Decision: MEASURE-ONLY for 2 weeks (Sprint 2.3 v0), then RATCHET to tiered thresholds.**

Concrete plan:
- **Sprint 2.3 v0 (this week):** `break: null` everywhere. PR comment posts current score + delta. Weekly run uploads artifact. **Goal: discover the actual mutation-score baseline.** Likely 50–70% per oneuptime industry reports.
- **Sprint 2.3 v1 (week 18+):** ratchet break thresholds per tier — Tier A 85%, Tier B 75%, Tier C 60%, Tier D none. Encoded as per-glob `mutate` blocks each with its own `thresholds.break`. (Stryker supports this via multi-run with different configs; simpler is one config per tier and a wrapper that runs them in matrix.)
- **Sprint 2.3 v2 (later):** Steward `action_kind: mutation_audit` that proposes new tests for surviving mutants on tier-A files only.

Rationale: pre-committing to 80% without a baseline measurement risks (a) blocking legitimate PRs that touch low-score files, (b) demoralizing the test-writing loop on files that need fixture refactoring before mutation testing makes sense. **Measure first, gate second** is the Anthropic/Vercel pattern that mastersoftwaretesting + testrigor consensus-recommends.

## Recommendations for implementation (10 bullets)

1. **Use `stryker.config.json`** (not `.mjs`) to keep CJS-zero-deps invariant — Stryker supports JSON natively per [config docs](https://stryker-mutator.io/docs/stryker-js/configuration/).
2. **Use the `command` test runner** with `commandRunner: { command: 'npm test' }` to stay framework-agnostic and reuse the existing `runNpmTest` contract from Steward `execute.cjs`.
3. **Glob `mutate`** to only cortex-x source: `['bin/**/!(*.test).cjs', '!bin/**/__tests__/**', '!bin/**/*.test.cjs', 'detectors/**/*.cjs', '!detectors/**/*.test.cjs']`. Exclude `tests/`, `templates/`, `prompts/`, `docs/` outright.
4. **Add `coverageAnalysis: "perTest"` + `ignoreStatic: true`** — proven 2–3x runtime reduction per [config docs](https://stryker-mutator.io/docs/stryker-js/configuration/) §ignoreStatic.
5. **Concurrency `"50%"`** on hosted runners (leaves CPU headroom on shared GHA infra and is forward-compatible with self-hosted later).
6. **Persist `reports/stryker-incremental.json` as a GHA artifact** between the weekly full run and per-PR incremental runs (use `actions/upload-artifact` + `actions/download-artifact`, or commit-to-branch pattern). Without this, incremental on PRs has nothing to read.
7. **Wire Stryker JSON output → Steward journal** post-`runNpmTest` in `bin/steward/execute.cjs`: parse `reports/mutation/mutation.json` for `metrics.mutationScore` and `metrics.killed/survived/timedOut`, attach as `mutation_score` field in the journal entry. This is the **fitness signal** the roadmap calls for — surviving mutants on touched files = "tests pass but don't exercise the edit" = LLM action should be **rejected with a `SPEC_MUTATION_SCORE_BELOW_THRESHOLD` error code** in Sprint 2.3 v1.
8. **R1 memo this conversation links from `MIGRATIONS.md`** under Sprint 2.3 entry, citing the prior 2026-05-09 + 05-10 memos as superseded.
9. **Don't block initial impl on per-tier thresholds.** Ship `break: null` v0 + collect baseline data for 2 weeks. The tier mapping in §4 is the v1 spec — encode it in a `stryker.tiers.json` SSOT file now so v1 is a 1-commit ratchet, not a re-architecture.
10. **No self-hosted runner config in v0.** Add `# TODO Sprint 4.5: self-hosted JIT runner for PR-incremental` comment to the workflow file and move on. Re-evaluate when (a) public repo, (b) PR latency complaints, or (c) GHA cost > $20/month — whichever fires first.

## Sources

- [StrykerJS introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)
- [StrykerJS getting started](https://stryker-mutator.io/docs/stryker-js/getting-started/)
- [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [StrykerJS incremental docs](https://stryker-mutator.io/docs/stryker-js/incremental/)
- [StrykerJS incremental announce blog](https://stryker-mutator.io/blog/announcing-incremental-mode/)
- [StrykerJS releases (v9.6.1 latest, 2026-04-10)](https://github.com/stryker-mutator/stryker-js/releases)
- [@stryker-mutator/core on npm](https://www.npmjs.com/package/@stryker-mutator/core)
- [GitHub Actions billing + 2000-min free quota](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [GitHub 2026 pricing changes (Dec 2025 announcement)](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
- [GitHub Actions 2026 pricing reference page](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/)
- [Self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
- [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Sysdig: self-hosted runners as backdoors](https://www.sysdig.com/blog/how-threat-actors-are-using-self-hosted-github-actions-runners-as-backdoors)
- [Praetorian: self-hosted GitHub runner backdoor](https://www.praetorian.com/blog/self-hosted-github-runners-are-backdoors/)
- [Synacktiv: GHA self-hosted runner exploitation](https://www.synacktiv.com/en/publications/github-actions-exploitation-self-hosted-runners)
- [oneuptime: how to configure Stryker (2026-01-25)](https://oneuptime.com/blog/post/2026-01-25-mutation-testing-with-stryker/view)
- [oneuptime: mutation testing strategies (2026-01-30)](https://oneuptime.com/blog/post/2026-01-30-mutation-testing-strategies/view)
- [alexop.dev: AI-agent mutation testing when Stryker can't](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)
- [testRigor: mutation testing guide](https://testrigor.com/blog/understanding-mutation-testing-a-comprehensive-guide/)
- [mastersoftwaretesting: mutation testing ultimate guide 2025](https://mastersoftwaretesting.com/testing-fundamentals/types-of-testing/mutation-testing)
- [Meta engineering: ACH FSE 2025 (Feb 2025)](https://engineering.fb.com/2025/02/05/security/revolutionizing-software-testing-llm-powered-bug-catchers-meta-ach/)
- [Meta engineering: LLMs + compliance mutation testing (Sep 2025)](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/)
- [arxiv 2501.12862: Mutation-Guided LLM-based Test Generation at Meta](https://arxiv.org/abs/2501.12862)
- [arxiv 2504.16472: Harden and Catch JiTTest open research challenges](https://arxiv.org/html/2504.16472v1)
- [InfoQ Jan 2026: Meta applies LLM mutation testing for compliance](https://www.infoq.com/news/2026/01/meta-llm-mutation-testing/)
- [arxiv 2301.13615: Property-Based Mutation Testing (Bartocci 2023)](https://arxiv.org/pdf/2301.13615)
