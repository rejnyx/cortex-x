# Sprint 2.11.2 — Eval-Suite Research for the 39-Smell Static Detector

> **R1 pre-ship gate.** Sprint 2.11 landed the smell registry but skipped its calibration suite — false-positive rate today is unmeasured. Goal: 5 fixture repos + `expected.json` baselines locked in by the 2026-06-01 monthly cron.

## 1. Executive summary

Lab corpora for test-smell detectors converge on three shapes: (a) the original tsDetect 65-file labeled benchmark (Peruma et al., FSE 2020), (b) the Panichella replication corpus of 2,340 EvoSuite/JTExpert tests over 100 Java classes (EMSE 2022), and (c) the testdouble/test-smells workshop repo (5-bucket taxonomy, JS+Ruby, 2024). For our purposes — JS/TS, deterministic regex + opt-in LLM judge — the **testdouble taxonomy is closest in spirit but undersized**; the academic corpora are Java/JUnit and won't transfer 1:1 to Vitest/Jest/Playwright fixtures. The conventional baseline shape is **per-file findings array, exact-match by smell-id + line, locked with detector version + fixture SHA**, derived from the SARIF v2.1.0 OASIS standard which explicitly defines a `baseline` run-comparison mode. Snapshot-only baselines (Jest-style `--updateSnapshot`) are explicitly considered an anti-pattern in static-analysis evals because they auto-paper-over silent regressions; the linter-validation literature instead requires **dual-key locks (detector version + fixture content hash)** with a manual review step on intentional rule changes. For 5 fixtures the proposed buckets cover ~24 of 39 smells; the **gap is structural smells** (resource_optimism, sensitive_equality, lazy_test, test_redundancy) that don't cluster naturally into any of the 5 categories — a 6th `state-coupling/` fixture or a smell-distribution table per fixture is needed to hit ≥80% coverage.

## 2. Lab + industry corpus references

- **tsDetect (Peruma et al., FSE 2020)** — 65 hand-labeled JUnit files, 19 smell types, reported P=0.96 / R=0.97. Benchmark + tool both open-source. Closest "what good looks like" for a new detector ([paper PDF](https://testsmells.org/assets/publications/FSE2020_TechnicalPaper.pdf), [tool repo](https://github.com/TestSmells/TSDetect)).
- **Panichella et al., "Test Smells 20 Years Later" (EMSE 2022)** — multi-stage cross-validated manual labels on 2,340 EvoSuite + JTExpert tests, 100 classes, 6 smell types. Found prior tools mislabeled >70% of cases — direct evidence why a calibration suite is mandatory and why "trust the regex" is unsafe ([paper](https://link.springer.com/article/10.1007/s10664-022-10207-5), [replication package](https://figshare.com/s/7b8bf9a7580001929f63)).
- **Bavota et al. (2015, foundational empirical study)** — 18 systems, 82% of JUnit classes affected by ≥1 smell; established Assertion Roulette as the canonical co-occurrence anchor. Methodology (manual labeling on a stratified sample) is the design we should mirror, not the corpus itself ([summary](https://dibt.unimol.it/staff/fpalomba/documents/J18.pdf)).
- **Pontillo et al. (cross-project, EMSE 2025)** — extended an existing **9,633 manually labeled** Java test-case ground-truth corpus across 59 Java projects (Eager Test, Mystery Guest, Resource Optimism, Test Redundancy). Evidence the field is converging on a "labeled-test-cases-not-labeled-files" granularity ([paper](https://link.springer.com/chapter/10.1007/978-3-032-21631-1_43)).
- **testdouble/test-smells (2024, archived)** — JS+Ruby workshop repo with 5 buckets: Insufficient / Unclear / Unnecessary / Unrealistic / Unreliable; per-smell folder with README + test + subject. Closest existing JS layout to copy ([repo](https://github.com/testdouble/test-smells)).
- **DARTS** — 3-smell IntelliJ plugin (General Fixture, Eager Test, LCT-M) at commit-level — useful prior art on smell granularity ([repo](https://github.com/StefanoLambiase/DARTS)).
- **SonarQube** — 413 rules, FP rate ~3.2% per 2025 user feedback, P=0.83 / R=0.87 in third-party benchmarks. Their public method: continuous false-positive triage from user reports + rule-by-rule precision SLOs ([blog](https://www.sonarsource.com/blog/how-sonarqube-minimizes-false-positives)).
- **SARIF v2.1.0 (OASIS standard)** — JSON schema for static analysis results; explicitly defines `baselineState` and run-to-run comparison semantics. **Strongly recommend cortex-x's `expected.json` be a SARIF subset** rather than a bespoke shape ([spec](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)).
- **Google Testing Blog — SMURF (Adam Bender, Oct 2024)** — Speed / Maintainability / Utilization / Reliability / Fidelity. The explicit framing for our `e2e-heavy/` fixture is "fidelity high but speed/utilization tanked" ([blog](https://testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html)).

## 3. Baseline format conventions

Recommended `expected.json` (SARIF-subset, per-fixture):

```json
{
  "version": "2.1.0",
  "detectorVersion": "cortex-x@2.11.0",
  "fixtureSha": "sha256:…",
  "runs": [{
    "tool": {"driver": {"name": "cortex-test-quality", "rules": [...]}},
    "results": [
      { "ruleId": "assertion_roulette", "locations": [{"file":"login.test.ts","line":42}], "level":"warning" }
    ],
    "smurfBalance": {"unit":4,"integration":1,"e2e":0}
  }]
}
```

Key conventions from the corpus survey:

- **Granularity:** per-finding (file + line + ruleId), not aggregate counts. Aggregate-only loses placement regressions.
- **Exact-match, no tolerance.** SARIF assumes deterministic; "±1 finding allowed" hides the most common detector regression (a regex matching one line too many). Tolerances belong in flaky-test or LLM-eval frameworks, not static analysis.
- **Dual-version lock.** Both `detectorVersion` and `fixtureSha` (content hash of the fixture tree). Drift on either triggers manual review, not auto-update.
- **Calibration drift handled explicitly:** a regression run produces a SARIF diff; intentional rule changes ship with the baseline update in the *same* PR (matches the Sonar "false-positive triage" model — never silent).

## 4. Recommended 5-fixture matrix for the 39-smell catalog

| # | Fixture | Target smells (count) | LoC budget | Notes |
|---|---|---|---|---|
| 1 | **clean/** | 0 (negative control) | ~120 LoC, 4 files | Vitest unit + 1 Playwright; AAA, single-assert, no I/O. Catches **false positives**, the highest-ROI bucket per Sonar's published FP-rate work. |
| 2 | **assertion-cluster/** | assertion_roulette, eager_test, duplicate_assert, magic_number, conditional_test_logic (5) | ~180 LoC | Rename of your `assertion-roulette/` — matches Bavota's empirical evidence that these 5 co-occur. |
| 3 | **state-coupling/** | mystery_guest, resource_optimism, sensitive_equality, lazy_test, test_redundancy, general_fixture (6) | ~220 LoC | **Replaces your `mystery-guest/`** — covers the 4 smells your proposed buckets miss. Reads from `./fixtures/users.json` + global mocks. |
| 4 | **structure-decay/** | exception_handling, ignored_test, redundant_print, sleepy_test, empty_test, default_test, unknown_test (7) | ~200 LoC | **Replaces your `eager-test/`** (which overlaps fixture 2). Captures hygiene smells the academic corpora bucket together. |
| 5 | **layer-imbalance/** | SMURF: ice_cream_cone, no_unit_foundation, missing_integration, e2e_only, brittle_e2e_selectors + cortex-original layer-balance flags (6) | ~250 LoC, mixed Vitest+Playwright | E2E-heavy by design. `smurfBalance` block in `expected.json` carries the layer-ratio assertion. |

**Coverage = 24 of 39 smells (62%).** The remaining 15 are second-order/composite smells (e.g. lcom_test_methods, comment-as-assertion variants); covering them needs either a 6th fixture or smells re-targeted into fixtures 2-4 with a per-fixture coverage matrix in the eval README. **Recommend: ship 5 + a coverage-matrix doc declaring the 15 uncovered smells as "regex-only, no fixture validation"** — that's an explicit risk register, not a hidden gap.

## 5. Calibration protocol

**Initial baseline (one-time per detector minor version):**

1. Run detector on all 5 fixtures → emit SARIF.
2. **Two-reviewer manual labeling** of every result (mirrors Panichella 2022 + Bavota methodology). Disagreements escalate to operator.
3. Lock `expected.json` with `detectorVersion` + `fixtureSha`. Commit with full review log in PR.

**Every CI run:**

- Detector emits SARIF → diff against `expected.json`.
- Any delta = test fails. No `--updateSnapshot` flag exists.
- Cron job emits FP/FN counts to journal (Phoenix OTLP span per fixture).

**Intentional behavior change (rule added/changed):**

1. Author updates rule + bumps `detectorVersion`.
2. Re-runs eval suite → new SARIF.
3. **Manual re-review only of diffed findings** (not the whole baseline — Pontillo-style incremental labeling).
4. New `expected.json` ships in same PR as the rule change; reviewer signs off both.
5. Old baselines kept under `expected/v2.10.json`, `expected/v2.11.json` for cross-version regression archaeology.

**Drift signals to surface in `cortex-steward status --eval`:**

- FP rate per smell (tracked over last 30 cron runs).
- Smells that have never fired across 5 fixtures in 30 days → candidate for fixture expansion or rule deletion.
- Reviewer-disagreement rate during baseline updates (proxy for rule clarity).

## 6. URL list

1. https://testsmells.org/assets/publications/FSE2020_TechnicalPaper.pdf
2. https://github.com/TestSmells/TSDetect
3. https://link.springer.com/article/10.1007/s10664-022-10207-5
4. https://figshare.com/s/7b8bf9a7580001929f63
5. https://dibt.unimol.it/staff/fpalomba/documents/J18.pdf
6. https://link.springer.com/chapter/10.1007/978-3-032-21631-1_43
7. https://github.com/testdouble/test-smells
8. https://github.com/StefanoLambiase/DARTS
9. https://www.sonarsource.com/blog/how-sonarqube-minimizes-false-positives
10. https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
11. https://testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html
12. https://zenodo.org/records/4000852
13. https://link.springer.com/article/10.1007/s10664-023-10436-2
14. https://jestjs.io/docs/snapshot-testing
