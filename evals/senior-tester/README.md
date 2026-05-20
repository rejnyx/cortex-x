# senior_tester_review eval suite

Sprint 2.11.2 deliverable. Per-fixture baselines (SARIF v2.1.0 subset) that
validate the [test-smell-detector](../../bin/steward/_lib/test-smell-detector.cjs)
catches the smells it claims to catch and does not false-positive on a clean
suite. The eval suite is the **R1 pre-ship gate** that should have shipped
with Sprint 2.11 but didn't — without it the 39-smell registry was an
unvalidated heuristic.

## Run

```bash
# Verify current detector against locked baselines (CI gate, exit 0/1).
node tools/eval-senior-tester.cjs

# Regenerate baselines after an INTENTIONAL detector change. Operator
# MUST manually re-review the diff before committing the new baseline.
# CI lane runs without this flag — auto-update is banned by design.
node tools/eval-senior-tester.cjs --write-baseline

# Verify a single fixture
node tools/eval-senior-tester.cjs assertion-density
```

## Baselines lock on a dual key

Every `baseline.sarif.json` carries:

- `runs[0].properties.cortex_x.detectorVersion` — string (currently `"1"`).
  Bumped explicitly in `tools/eval-senior-tester.cjs` when the regex
  catalogue or block-extraction semantics change. Mismatch → `DETECTOR_VERSION_DRIFT`.
- `runs[0].properties.cortex_x.fixtureSha` — sha256 of all `*.test.cjs` files
  under the fixture's `tests/` tree (sorted by relative path, LF-normalized).
  Mismatch → `FIXTURE_SHA_DRIFT`.

A change to either side fails the runner. To intentionally update a baseline:

1. Make the change (detector code OR fixture content).
2. Run `node tools/eval-senior-tester.cjs --write-baseline` locally.
3. **Manually review the diff** — every added / removed / shifted finding.
4. Commit detector change + new baseline in the **same PR**. CI on `main`
   re-verifies; if you skipped step 3, the next monthly cron will surface
   the calibration regression to ops.

This is the Sonar / DeepSource baseline-update model:
no `--updateSnapshot` auto-fix, manual two-eyes for any baseline mutation.

## Five fixtures, by design

| Fixture | Purpose | Smells exercised |
|---|---|---|
| [`clean/`](./fixtures/clean/) | False-positive control — must produce 0 findings on a normal node:test suite | (none — passes if 0 findings) |
| [`assertion-density/`](./fixtures/assertion-density/) | Jest-style assertion-quality smells | `assertion_roulette`, `empty_test`, `unknown_test` ×2, `suboptimal_assert`, `magic_number_test`, `comments_only_test` |
| [`state-coupling/`](./fixtures/state-coupling/) | Test-independence smells (external state, flaky timing) | `mystery_guest` (fs + fetch), `sleepy_test`, `no_reproducibility_marker` |
| [`structure-decay/`](./fixtures/structure-decay/) | Structural smells (verbosity, branching, generic names) | `generic_test_name` ×2, `print_statement`, `ignored_test`, `conditional_test_logic`, `exception_catching_throwing`, `sensitive_equality`, `verbose_test` |
| [`e2e-heavy/`](./fixtures/e2e-heavy/) | SMURF layer-balance assessment (ice_cream_cone anti-pattern) | (no individual smells; `layer_balance.anti_patterns` must contain `ice_cream_cone`) |

Total: **17 distinct smells exercised** out of the **39-smell registry**.

## Coverage matrix — what the eval suite validates and what it doesn't

The 39-smell registry is published at [`bin/steward/_lib/test-smell-registry.cjs`](../../bin/steward/_lib/test-smell-registry.cjs).
Of the 39, only 16 have a deterministic regex detector in v1 (the other 23
are LLM-only — Phase B judge cites them, Phase A doesn't).

**Validated by this suite (16 smells in the regex catalog):**

| Smell ID | Fixture | Notes |
|---|---|---|
| `assertion_roulette` | assertion-density | jest `expect()` × ≥3 with no msg arg |
| `comments_only_test` | assertion-density | comment "// expected: …" with no following expect |
| `conditional_test_logic` | structure-decay | `if (` inside test body |
| `empty_test` | assertion-density | empty body |
| `exception_catching_throwing` | structure-decay | try/catch without `.toThrow` |
| `generic_test_name` | structure-decay | `test('test1', …)`, `test('should work', …)` |
| `ignored_test` | structure-decay | `test.skip(…)` |
| `magic_number_test` | assertion-density | `.toBe(12345678)` |
| `mystery_guest` | state-coupling | fs.readFileSync + fetch — fetch detection requires Sprint 2.11.2 regex fix |
| `no_reproducibility_marker` | state-coupling | `Math.random()` without seed |
| `print_statement` | structure-decay | `console.log` |
| `sensitive_equality` | structure-decay | `JSON.stringify(...) == ...` |
| `sleepy_test` | state-coupling | `setTimeout` |
| `suboptimal_assert` | assertion-density | `.toBeTruthy()` |
| `unknown_test` | assertion-density | SUT call, no assertion |
| `verbose_test` | structure-decay | body > 30 lines |

**Not validated by fixture (23 LLM-only smells in the registry, regex detector = `null`):**

These remain in the registry so Phase B (LLM judge, opt-in via `STEWARD_SENIOR_TESTER_JUDGE=1`)
can cite them by ID. Phase A (deterministic) does not flag them — and this
eval suite cannot validate them. Listed here as honest known limits:

- `constructor_initialization` — Java-only
- `default_test` — Java-only (IDE auto-stub)
- `eager_test` — multi-method invocation; needs cross-AST walk
- `general_fixture` — beforeEach-vs-test-body coupling; needs setup/test diff
- `lazy_test` — same single method tested redundantly across tests
- `redundant_assertion` — assertTrue(true) etc.; cheap, candidate Sprint 2.11.3
- `redundant_print_statement` — duplicate console.log; needs cross-test analysis
- `resource_optimism` — assumes external resource without check
- `test_code_duplication` — copy-paste detection across tests
- `not_asserted_side_effects` (NASE, Sandoval ESE'25) — semantic mutation tracking
- `not_asserted_return_values` (NARV) — return-flow analysis
- `assertion_unrelated_inherited_method` (ARPM) — inheritance-aware analysis
- `object_init_multiple_times` (OIMT) — cross-test constructor invariant detection
- `duplicated_setup` (DS) — line-equality across tests
- `testing_same_exception_scenario` (TSES) — exception + assertion equality across tests
- `testing_same_void_method` (TSVM) — cross-test method-call analysis
- `redundant_not_null_assertion` (NNA) — needs assertNotNull + structural assertion correlation
- `exception_due_null_arg` (EDNA) — null-arg-flow analysis
- `exception_due_external_dependency` (EDED) — external-class-name match (port-able)
- `exception_due_incomplete_setup` (EDIS) — needs setup-completeness analysis
- `testing_only_field_accessors` (TOFA) — needs SUT class introspection
- `asserting_constants` (AC) — needs const-vs-runtime-value distinction
- `hidden_io` — currently subsumed by `mystery_guest` regex; standalone detector deferred

## Layer-balance assessment

`e2e-heavy/` exercises the SMURF-aligned layer-balance check. The fixture is
75% e2e (3 of 4 tests under `tests/e2e/`, 1 under `tests/unit/`) and is
expected to produce `anti_patterns: [{id: "ice_cream_cone", severity: "high"}]`.
Verified by the runner via `runs[0].properties.cortex_x.layerBalance` block
in the baseline; not as a regular SARIF result entry.

## When a baseline drift fires in CI

The runner exits 1 on any drift. CI lane fails the PR; the operator decides:

- **Detector regression?** Fix detector. Re-run `--write-baseline` after fix.
  The baseline should match what it was before the regression.
- **Intentional rule change?** Operator approves the new baseline as part of
  the PR description. Document the why in the commit body.
- **Fixture content edit?** Same as intentional rule change — re-baseline +
  document why.

**Do not commit a `--write-baseline` regenerate without reviewing the diff.**
Auto-accepting baseline drift is the documented anti-pattern in static-analysis
literature ([arXiv 2506.08680](https://arxiv.org/abs/2506.08680)).

## What this suite does NOT cover

- **Performance** — detector deadline is 50ms per pattern per line; no eval
  asserts cumulative time on adversarial input. Sprint 2.11.3 candidate.
- **Phase B LLM judge correctness** — the schema validator added in
  Sprint 2.11.2 (`bin/steward/_lib/llm-judge-schema.cjs`) is unit-tested
  in isolation; no end-to-end eval against a real OpenRouter call yet.
- **Cross-language coverage** — fixtures are JS only. Python / Java / TS
  fixtures would expand the surface but tsDetect's research already
  validates the registry on Java; this suite focuses on cortex-x's
  Tier-1 audience (JS/TS).

See `docs/research/sprint-2.11.2-eval-suite-research-2026-05-10.md`
for the full rationale + sources.
