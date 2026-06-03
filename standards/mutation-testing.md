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

## R2 hardening shipped 2026-05-14 (Sprint 2.3.1)

After Sprint 2.3 v0 shipped, a security R2 dispatch surfaced 4 HIGH supply-chain findings. All closed before main reaches the workflow:

- **HIGH-1 supply chain**: `@stryker-mutator/core` now pinned to exact `9.6.1` (no caret); `npm ci --ignore-scripts` in the CI workflow prevents transitive `preinstall`/`postinstall` RCE.
- **HIGH-2 cache poisoning**: cache write/read scope locked to `main`-prefixed keys only. A feature/* push cannot poison the incremental baseline that main consumes (cross-branch fallback removed; `actions: read` permission lock keeps cache-write capability scoped to main).
- **HIGH-3 binary integrity**: `npx --no-install stryker` refuses to fetch the binary on the fly. A lockfile-presence guard runs before `npm ci`.
- **HIGH-4 inline node -e injection**: the score-summarizer pattern (originally inline `node -e "const r=JSON.parse(...)..."` in YAML) extracted to `tools/summarize-mutation.cjs` with a fixed input path. No shell-interpolation surface.

The threat model is CI supply chain + secret leakage. Mutation-score-driven false-negative is out of scope while `break: null`.

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
- Sprint 2.3 R1 original (2026-05-09)
- Sprint 2.3 R1 refresh (2026-05-10)
- [arXiv 2406.09843 — LLM-written tests mutation study](https://arxiv.org/html/2406.09843v4)
- [arXiv 2510.25297 — PBT + mutation complementarity](https://arxiv.org/abs/2510.25297)
- [arXiv 2506.02954 — MutGen: mutation > coverage as fitness signal](https://arxiv.org/abs/2506.02954)
- [testdouble.com — prompt-then-verify pattern](https://testdouble.com/insights/keep-your-coding-agent-on-task-with-mutation-testing)
- [GitHub Next llmorpheus](https://github.com/githubnext/llmorpheus) — closest published precedent
- [GHA billing 2026](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Betterer ratchet docs](https://phenomnomnominal.github.io/betterer/) — measure-then-improve

## Ratchet activation {#ratchet-activation}

> **Sprint 2.3.1 (2026-06-03)** — Sprint 2.3 v0 shipped `break: null` measure-only. This section activates the ratchet: `mutation_score` is now the **7th acceptance-criterion kind** in [`bin/steward/_lib/spec-verifier.cjs`](../bin/steward/_lib/spec-verifier.cjs) (joins `shell` / `file_predicate` / `regex` / `ears_text` / `llm_judge` / `read_set`). Verification arc context: [`standards/sprint-pipeline.md`](./sprint-pipeline.md) §spec-verifier-criteria.

### The 7th criterion kind

`mutation_score` is a criterion appended to any Steward `action_kind`'s `acceptance_criteria[]` array. The verifier reads a Stryker JSON report at `stryker_output_path` (default `reports/mutation/mutation.json`), filters mutants by `target_files` globs (defaulting to the action's `write_set` from Sprint 2.18), and computes the **standard Stryker formula**:

```
mutation_score = (killed + timeout) / (killed + survived + timeout + noCoverage) × 100
```

`CompileError` + `RuntimeError` + `Ignored` + `Pending` mutants are excluded from **both** numerator and denominator (toolchain noise + explicit opt-out + not-yet-run). `NoCoverage` is counted as undetected — this is the honest reading; covered-only would let edits in unreachable branches pass trivially.

**Criterion shape** (registered in [`bin/steward/_lib/spec-verifier.cjs`](../bin/steward/_lib/spec-verifier.cjs) — schema SSOT lives there):

```yaml
kind: mutation_score
min_percentage: 60         # int 0..100, required
target_files: []           # array of globs, optional (defaults to action.write_set)
stryker_output_path: reports/mutation/mutation.json   # optional
advisory: true             # if true, failure emits diagnostic but does NOT block
```

**Semantics**:
- `ok: true` + score returned when `score >= effectiveMin` (or when fail-OPEN advisory path triggers).
- `ok: false` + `code: SPEC_MUTATION_SCORE_BELOW_MIN` when score below threshold and `advisory: false`.
- `ok: true` + `advisory: true` + diagnostic code when report missing / malformed / empty-surface (see Fail-OPEN policy below).

**Determinism**: criterion is pure relative to `{ ctx.repoRoot, ctx.env, fixture }` — no `Date.now()`, no `Math.random()`, no `new Date()` in the module body. Repeat invocations on identical inputs produce byte-identical result objects.

**Error codes** (registered in `bin/steward/_lib/errors.cjs` SSOT):
- `SPEC_MUTATION_SCORE_BELOW_MIN` — verdict reason, blocks when enforced
- `SPEC_MUTATION_REPORT_MISSING` — advisory, fail-OPEN
- `SPEC_MUTATION_REPORT_MALFORMED` — advisory, fail-OPEN
- `SPEC_MUTATION_NO_VALID_MUTANTS` — internal advisory, fail-OPEN

### Per-action_kind threshold table

Canonical SSOT — [`bin/steward/_lib/action-kinds.cjs`](../bin/steward/_lib/action-kinds.cjs) registry entries reference this table. Seven tiers active (all `advisory: true` for Sprint 2.3.1); fourteen `N/A` (criterion omitted entirely, mirrors Stryker `mutate` glob exclusion). **Sprint 2.3.1 R2 fix HIGH:** previous edit of this table named three fictional action_kinds (`edit_ops`, `dream_consolidate`, `insight_promote`) that the registry does not contain, and omitted six real ones. Rebuilt 1:1 against the 21 registered action_kinds in [`action-kinds.cjs`](../bin/steward/_lib/action-kinds.cjs).

| # | action_kind | mutation_score | Rationale |
|---|---|---|---|
| 1 | `recommendation` | **60%** advisory | LLM-mixed surface; conservative anchor matching Stryker `low: 60` default. |
| 2 | `recommendation_harvest` | **N/A** | Read-only aggregator. |
| 3 | `recommendation_harvest_parallel` | **N/A** | Read-only aggregator. |
| 4 | `dep_update_patch` | **N/A** | Lockfile + version bumps. No Stryker mutators apply. |
| 5 | `flaky_test_repair` | **70%** advisory | Tests ARE the mutation surface — must preserve kill capacity. |
| 6 | `doc_drift` | **N/A** | Markdown only. |
| 7 | `todo_triage` | **N/A** | Comment/issue edits only. |
| 8 | `test_coverage_gap` | **65%** advisory | New tests should kill mutants by design. |
| 9 | `lint_fix_shipper` | **55%** advisory | Codestyle; StringLiteral mutators survive trivially → low bar. |
| 10 | `pr_review_responder` | **N/A** | Read-mostly + mixed micro-patches; defer until Sprint 2.3.2 calibration. |
| 11 | `mutation_score_drift` | **N/A** | Meta — consumes Stryker reports; does not produce code edits. |
| 12 | `tech_debt_audit` | **60%** advisory | Refactors must preserve behavior — anchor on Stryker `low: 60`. |
| 13 | `pattern_transfer` | **N/A** | Cross-project pattern propagation; mutation surface not yet calibrated. Reserved for Sprint 2.3.2. |
| 14 | `workflow_hardener` | **N/A** | YAML/CI config, no executable surface. |
| 15 | `secret_history_sweep` | **N/A** | Git history rewrite. |
| 16 | `senior_tester_review` | **70%** advisory | Adds tests; should pull score UP. |
| 17 | `evolve_daily` | **N/A** | Read-mostly prompt-evolution loop; defer calibration to Sprint 2.3.2. |
| 18 | `evolve_weekly` | **N/A** | Read-mostly prompt-evolution loop; defer calibration to Sprint 2.3.2. |
| 19 | `wiki_consolidate` | **N/A** | JSONL → MEMORY.md aggregation. |
| 20 | `tdd_red_green` | **60%** advisory | TDD cycle should preserve mutation kill rate as red/green progresses. |
| 21 | `release_notes_drafter` | **N/A** | Markdown generation only. |

**`target_files` semantics (v1, Sprint 2.3.1):** when criterion omits or empty-array's `target_files`, the runner counts mutants across **all files in the Stryker report** (whole-repo surface). The Sprint 2.18 `write_set` seam integration documented as the future natural-lens default ("did our edit hold up under mutation?") is **deferred to Sprint 2.3.2** alongside ratchet promotion to `advisory: false`. Until then, action plans wanting edit-scoped scoring must declare `target_files` explicitly in the criterion. Promoting to enforced before this seam lands would trigger the auto-PR loop risk (R-2 in sprint plan) where an action editing a high-score file gets blocked by unrelated low scores elsewhere.

**Promotion to enforced** (`advisory: false`) requires:
1. 60+ green journal entries on the action_kind in question, AND
2. Zero `cortex-doctor` false-fail reports across the same window, AND
3. Sprint 2.3.2 explicit gate (no silent flip).

### Emergency raise procedure

The `STRYKER_RATCHET_MIN_PERCENTAGE` environment variable overrides `min_percentage` for **all** `mutation_score` criteria evaluated in the current Steward run:

```bash
STRYKER_RATCHET_MIN_PERCENTAGE=75 cortex-steward run --action-kind edit_ops
```

**Use cases**:
- Operator wants to stress-test a sprint's edits at a higher bar before promoting.
- One-shot incident response after a regression slipped past the advisory tier.
- A/B comparison between threshold candidates during Sprint 2.3.2 calibration.

**Discipline**:
- One-shot escape hatch only — `export` in shell rc is forbidden (would silently raise globally).
- Permanent change to a per-action threshold requires a journal entry + R6 incident-class justification (one defense layer + one regression test).
- Env override is recorded in the Phoenix span as `mutation.override_min_percentage` for audit.

### Allowlist for pre-existing low scores — **NOT YET IMPLEMENTED (Sprint 2.3.2 deliverable)**

> **Sprint 2.3.1 R2 fix HIGH:** the verifier in `bin/steward/_lib/spec-verifier.cjs` does NOT yet read the allowlist file. The schema below is the agreed Sprint 2.3.2 contract, NOT shipped behavior. Until 2.3.2 lands, no allowlist semantics apply — the verifier ignores `cortex/state/mutation-allowlist.yaml` entirely. Promotion to `advisory: false` (enforced ratchet) is blocked on this allowlist landing.

Pre-existing low-scoring code surfaces (legacy, vendored, exception-handler-heavy) will be allowlisted via `cortex/state/mutation-allowlist.yaml`:

```yaml
# cortex/state/mutation-allowlist.yaml
allowlist:
  - glob: "bin/steward/_lib/legacy-shim.cjs"
    reason: "Pre-Sprint-1.6 shim, deletion blocked by external consumer"
    expires_iso: "2026-09-01T00:00:00Z"
    owner: "david@rejnyx.com"
  - glob: "tests/fixtures/**"
    reason: "Test fixtures are not implementation"
    expires_iso: "2027-01-01T00:00:00Z"
    owner: "david@rejnyx.com"
```

**Semantics**:
- Spec-verifier reads the allowlist before scoring, removes matched files' mutants from **both** numerator and denominator (so they don't drag the score up OR down).
- `expires_iso` past current `ctx.now` → entry still respected, but verifier emits `WARN` with `code: SPEC_MUTATION_ALLOWLIST_EXPIRED` and the glob/owner pair.
- Empty/missing allowlist file → no-op, no warning.
- `reason` + `owner` are required for human audit; `expires_iso` forces revisit (no permanent allowlist entries).

### Fail-OPEN policy

Mutation testing is a **fitness signal**, not a correctness gate. If the signal is unavailable (report missing) or untrusted (report malformed), the verifier returns `ok: true` with an advisory diagnostic rather than blocking the Steward run. Tier 0-2 acceptance criteria (`shell` / `file_predicate` / `read_set`) remain the hard correctness gates.

| Failure mode | Verifier result | Diagnostic code | PR body label |
|---|---|---|---|
| Report file does not exist (ENOENT) | `ok: true, advisory: true` | `SPEC_MUTATION_REPORT_MISSING` | `advisory_skipped` |
| Report JSON.parse fails | `ok: true, advisory: true` | `SPEC_MUTATION_REPORT_MALFORMED` | `advisory_skipped` |
| Report missing `.files` key | `ok: true, advisory: true` | `SPEC_MUTATION_REPORT_MALFORMED` | `advisory_skipped` |
| 0 valid mutants after target_files filter | `ok: true, advisory: true` | `SPEC_MUTATION_NO_VALID_MUTANTS` | `advisory_skipped` |
| Score < effectiveMin, `advisory: true` | `ok: true, advisory: true` | `SPEC_MUTATION_SCORE_BELOW_MIN` | `advisory_warning` |
| Score < effectiveMin, `advisory: false` | `ok: false` | `SPEC_MUTATION_SCORE_BELOW_MIN` | `BLOCK` |
| Score >= effectiveMin | `ok: true` | — | `pass` |

Report-staleness check (`mtime > 72h`) is **deferred to Sprint 2.3.2** to keep this criterion side-effect-free. Staleness is reported in PR body via Phoenix span metadata, not enforced here.

### Operator error message format

When a mutation criterion blocks (rare in Sprint 2.3.1 — requires `advisory: false` or env override), the operator sees a PR body block + journal entry of the form:

**BLOCK variant** (`SPEC_MUTATION_SCORE_BELOW_MIN`, enforced):
```
SPEC VIOLATION — mutation_score below minimum

  action_kind:    edit_ops
  target_files:   bin/steward/_lib/splice.cjs, bin/steward/_lib/spec-verifier.cjs
  score:          47.3%
  min_required:   60%
  effective_min:  60% (criterion default)

  counts:
    killed:       142
    survived:     158
    timeout:        0
    noCoverage:     0
    compileError:   3   (excluded)
    runtimeError:   0   (excluded)
    ignored:        5   (excluded)
    pending:        0   (excluded)

  next steps:
    1. Inspect surviving mutants: reports/mutation/index.html
    2. Add a test that would have killed each high-value survivor
    3. Re-run: cortex-steward verify --criterion mutation_score
    4. If survivors are exception-handlers, file under acceptable per
       https://stryker-mutator.io/docs/General/faq/
```

**Advisory warning variant** (`SPEC_MUTATION_SCORE_BELOW_MIN`, `advisory: true`):
```
SPEC ADVISORY — mutation_score below minimum (not blocking)

  action_kind:    edit_ops
  score:          47.3% < min 60% (advisory tier — Sprint 2.3.1)
  promotion gate: 60 green journal entries + zero cortex-doctor false-fails
  report:         reports/mutation/index.html (14-day artifact retention)
```

**Advisory skipped variant** (`SPEC_MUTATION_REPORT_MISSING` / `SPEC_MUTATION_REPORT_MALFORMED` / `SPEC_MUTATION_NO_VALID_MUTANTS`):
```
SPEC ADVISORY — mutation_score signal unavailable

  reason:  Stryker report not found at reports/mutation/mutation.json
  policy:  fail-OPEN — Steward run continues without mutation signal
  fix:     ensure nightly Stryker cron has completed (.github/workflows/mutation.yml)
           or run locally: npx --no-install stryker run
```

### Ratchet direction — UP only

Per [qntm's one-way-ratchet principle](https://qntm.org/ratchet) (and Betterer's measure-then-improve pattern), `min_percentage` values in this table move **up only**. A downgrade requires:
1. `STEWARD_MUTATION_BASELINE_DOWNGRADE=1` env var set on the Steward run, AND
2. Journal entry documenting the regression event + scope + revert plan, AND
3. R6 review (one incident class = one defense layer + one regression test).

The verifier itself does not check the env var — discipline is enforced at the PR review layer + via `cortex-doctor` audit that compares current `min_percentage` values against the historical baseline in `cortex/state/mutation-baseline.json`.
