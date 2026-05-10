# Sprint 2.11 — senior_tester_review smell taxonomy research

**Date:** 2026-05-10
**Scope:** ground the cortex-x test-smell detector against (1) the actual ESE 2025 taxonomy, (2) JS/TS detection prior art, (3) current test-pyramid consensus.

## §1 — ESE 2025 taxonomy (confirmed, exact)

Source: Sandoval Alcocer et al., *"Assessing automatically-generated tests code quality: beyond traditional test smells"* — Empirical Software Engineering 31(1), publ. 2025-11-11, DOI [10.1007/s10664-025-10718-x](https://doi.org/10.1007/s10664-025-10718-x). Open preprint: [arXiv:2312.08826](https://arxiv.org/abs/2312.08826) — *"A manual categorization of new quality issues on automatically-generated tests"* — same taxonomy, full HTML at [arxiv.org/html/2312.08826](https://arxiv.org/html/2312.08826). Smelly is the companion static-analysis tool.

13 quality issues in **4 categories**. Symptom column is the rule used during manual labeling (and the basis for Smelly).

| id  | category                                    | smell name                                       | one-line description                                                                                  |
|-----|---------------------------------------------|--------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| NASE | Act-Assert Mismatch                         | Not Asserted Side Effects                        | Void method call mutates state but no assertion verifies the mutation.                                |
| NARV | Act-Assert Mismatch                         | Not Asserted Return Values                       | Method returns a value that is never checked by any assertion.                                        |
| ARPM | Act-Assert Mismatch                         | Assertions with Not Related Parent-class Method  | Assertion calls an inherited method that checks a value unrelated to what the test purports to test.  |
| OIMT | Redundant Code                              | Asserting Object Initialization Multiple Times   | ≥2 tests assert values set by the constructor (initialization re-checked).                            |
| DS   | Redundant Code                              | Duplicated Setup                                 | ≥2 tests share ≥2 equal lines of setup code.                                                          |
| TSES | Redundant Code                              | Testing the Same Exception Scenario              | ≥2 tests handle the same exception + same console output but call different methods.                  |
| TSVM | Redundant Code                              | Testing the Same Void Method                     | ≥2 tests call the same void method with unrelated assertions.                                         |
| NNA  | Redundant Code                              | Redundant Not-Null Assertion                     | `assertNotNull` after construction or where another assertion already implies non-null.               |
| EDNA | Failed Setup                                | Exceptions Due to Null Arguments                 | Test fails with NPE caused by a null argument it passed itself (not by SUT logic).                    |
| EDED | Failed Setup                                | Exceptions Due to External Dependencies          | Test handles `HeadlessException` / `SQLException` / `NotYetConnectedException` — environment failure. |
| EDIS | Failed Setup                                | Exceptions Due to Incomplete Setup               | Test constructs object, calls method, swallows the exception thrown by missing prior setup steps.     |
| TOFA | Testing Field Accessors and Constants       | Testing Only Field Accessors                     | Test contains only object init + getter assertions; no behavior tested.                               |
| AC   | Testing Field Accessors and Constants       | Asserting Constants                              | Assertion checks a `static final` value that cannot change unless source is edited.                   |

Note: this taxonomy is **complementary** to tsDetect's 21 (FSE'20) — not a replacement. tsDetect covers structural smells (Eager Test, Mystery Guest, etc.); Sandoval's 13 cover *automated-generation pathologies* (over-asserting init, fake-passing on swallowed exceptions, etc.).

## §2 — JS/TS detection prior art

There are **two** real public detectors, plus citing-works using Java tools on translated corpora. tsDetect/JNose/PyNose are not ported to JS/TS. The two JS/TS-native projects are:

### 2a — SNUTS.js — [github.com/Jhonatanmizu/SNUTS.js](https://github.com/Jhonatanmizu/SNUTS.js)

Babel-AST based, supports Jest + Jasmine. Paper: *"SNUTS.js: Sniffing Nasty Unit Test Smells in JavaScript"*, SBES 2024 ([sol.sbc.org.br/.../30417](https://sol.sbc.org.br/index.php/sbes/article/download/30417/30223/)). 7 originally-novel + 8 ports = **15 smells** in `src/common/detectors/`:

- Test Without Description, Anonymous Test, Transcripting Test, Comments-Only Test, Overcommented, Sensitive Equality, General Fixture *(novel)*
- Complex Snapshot, Conditional Test Logic, Identical Test Description, Non-functional Statement, Only Test, Suboptimal Assert, Verbose Test, Verify In Setup *(ports)*

Concrete patterns confirmed by reading source:

```js
// Conditional Test Logic — @babel/traverse visitor
traverse(ast, { IfStatement: ({node}) => smells.push({startLine, endLine}) })

// Sensitive Equality — assert against .toString()
jestMatchers = {toEqual, toStrictEqual, toBe, toMatchObject}
isMemberExpression(callee) && jestMatchers.has(callee.property.name)
&& isCallExpression(args[0]) && args[0].callee.property.name === 'toString'

// Suboptimal Assert — expect(x).toBe(undefined) / expect(arr.length).toBe(n)
isExpectToBeAssertion(node) && (isUndefinedLike(node) || isUsingDotLength(node))
```

### 2b — smelly-test (`marabesi/smelly-test`, npm `smelly-detector`) — [github.com/marabesi/smelly-test](https://github.com/marabesi/smelly-test)

Esprima (.js) + TS-Compiler (.ts) AST walks. Smaller surface, **8 smells**: Conditional Test Logic (if + 3 for-variants), Sleepy Test (`setTimeout`), Loudmouth (`console.log/info/error`), Eager Mock (`jest.mock` overuse), Empty Describe, Duplicated Test Case (line-range hash, weak heuristic).

### 2c — relevant adjacent

- *Investigating Test Smells in JavaScript Test Code* (SAST 2021, [dl.acm.org/.../3482915](https://dl.acm.org/doi/10.1145/3482909.3482915)) — empirical study, no released tool but documents JS-specific patterns.
- *Test Smells in LLM-Generated Unit Tests* ([arXiv:2410.10628](https://arxiv.org/abs/2410.10628), Oct 2024) — uses **TsDetect + JNose unchanged** on Java output; does not introduce new JS rules.
- *Evaluating LLMs' Effectiveness in Detecting and Correcting Test Smells* ([arXiv:2506.07594](https://arxiv.org/abs/2506.07594), 2025) — LLM-as-detector approach, no AST patterns published.

**Implication for cortex-x:** SNUTS.js's `@babel/traverse` visitor pattern is the cleanest reference. Adopt its visitor model + the matcher-set idiom (`jestMatchers = new Set([...])`) so we're framework-aware (Jest/Vitest/Jasmine share `expect().to*` semantics, so one visitor covers all three).

## §3 — Layer-balance ratios — current consensus

The "70/20/10" you cited is folk-attributed to Cohn but **isn't actually in *Succeeding with Agile* (2009)** — Cohn drew Unit / Service / UI without explicit percentages; the 70/20/10 split traces to Google internal guidance ([circleci.com/.../testing-pyramid](https://circleci.com/blog/testing-pyramid/), [martinfowler.com/.../practical-test-pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)). 2024-2026 status:

| model           | author / year                | shape (top→bottom)                                | concrete ratio                          | status 2026                                          |
|-----------------|------------------------------|---------------------------------------------------|-----------------------------------------|------------------------------------------------------|
| Test Pyramid    | Cohn 2009 / Fowler 2012      | UI · Service · Unit                               | none specified by Cohn                  | still default for monoliths                          |
| 70/20/10        | Google folklore / Fowler 2018| E2E · Integration · Unit                          | 10 / 20 / 70                            | ubiquitous rule of thumb, not authoritative         |
| Honeycomb       | Spotify 2018                 | Integrated · Integration · Implementation-detail  | bulk in middle (integration)            | preferred for microservices                          |
| Testing Trophy  | Kent C. Dodds 2018+          | E2E · Integration · Unit · **Static**             | weighted toward integration             | de-facto frontend default                            |
| SMURF           | Google 2024-10               | *not a shape* — 5-axis tradeoff                   | per-context, no fixed ratio             | **current Google guidance, supersedes 70/20/10**    |

SMURF = **S**peed / **M**aintainability / **U**tilization / **R**eliability / **F**idelity ([testing.googleblog.com/.../smurf-beyond-test-pyramid](https://testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html), Oct 2024). Google explicitly rejects fixed ratios: "balance these tests to address associated trade-offs" — context-dependent, not 70/20/10.

**Recommendation for cortex-x:** drop the hard-coded 70/20/10 assertion. Detect *gross imbalances* instead — flag if `e2e/(unit+integration+e2e) > 0.40` (top-heavy = "ice-cream cone" anti-pattern, well-attested) or if `unit_count == 0 && integration_count > 0` (no foundation). Per-profile heuristic preferable to global ratio: `nextjs-saas` should expect Trophy-like (heavy integration via React Testing Library); `ai-agent` should expect Honeycomb (eval suites at integration tier). Cite SMURF in the standards doc as the 2026 anchor.

## §4 — Verdict on draft registry

Mapping your draft to ESE 2025 + SNUTS.js + tsDetect:

| draft id                       | keep / replace / drop                                                                                                        |
|--------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `trivial_assertion`            | **Replace** with SNUTS.js `Suboptimal Assert` (well-defined) + Sandoval's `AC` (Asserting Constants).                       |
| `tautological_assertion`       | **Keep**, but rename `tautological_assert` and seed examples from `expect(x).toBe(x)` and Suboptimal Assert.                 |
| `missing_negative_assertion`   | **Keep** — not in either taxonomy, but a valid eval-driven heuristic; mark as cortex-original.                              |
| `shared_mutable_state`         | **Replace** with tsDetect `Mystery Guest` + `General Fixture` (already covered by SNUTS.js). Don't reinvent.                |
| `implicit_setup_dependency`    | **Replace** with Sandoval `EDIS` (Exceptions Due to Incomplete Setup) — exact match, plus SNUTS.js `Verify In Setup`.       |
| `hidden_io`                    | **Keep** — adjacent to but distinct from `Mystery Guest`; mark cortex-original; Vitest-aware (network/fs/process.env mocks).|
| `generic_test_name`            | **Keep**, align with SNUTS.js `Test Without Description` + `Anonymous Test` for free coverage.                              |
| `comment_instead_of_assert`    | **Keep**, align with SNUTS.js `Comments-Only Test` (exact match — rename to that).                                          |
| `multi_concept_test`           | **Replace** with tsDetect `Eager Test` (well-known, established detector logic).                                            |
| `no_boundary_test`             | **Drop from auto-detection** — too semantic; move to LLM-judge criterion only. False-positive risk too high for AST.        |
| `no_error_path_test`           | **Drop from auto-detection** — same reason; LLM-judge only.                                                                 |
| `no_reproducibility_marker`    | **Keep** — cortex-original, anchored in [standards/correctness.md](../standards/correctness.md) (seed/freeze-time markers). |
| `magic_test_data`              | **Keep**, align with tsDetect `Magic Number Test` (rename).                                                                  |

**Net change:** drop 2 (`no_boundary_test`, `no_error_path_test` → LLM-judge tier), replace 4 with established names, keep 6 with renames, gain free coverage of Sandoval's `NASE` / `NARV` / `OIMT` / `DS` / `EDNA` / `EDED` / `TOFA` (high-value, well-defined, not in your draft). Final registry ≈ 16–18 AST/regex rules + 2 LLM-judge rules.

## Sources

- Sandoval Alcocer et al., ESE 2025 — [doi.org/10.1007/s10664-025-10718-x](https://doi.org/10.1007/s10664-025-10718-x)
- Sandoval Alcocer et al., preprint — [arxiv.org/abs/2312.08826](https://arxiv.org/abs/2312.08826) / [HTML](https://arxiv.org/html/2312.08826)
- Oliveira et al., SBES 2024, SNUTS.js — [sol.sbc.org.br/.../30417](https://sol.sbc.org.br/index.php/sbes/article/download/30417/30223/) · [github.com/Jhonatanmizu/SNUTS.js](https://github.com/Jhonatanmizu/SNUTS.js)
- Marabesi, smelly-test — [github.com/marabesi/smelly-test](https://github.com/marabesi/smelly-test)
- Test Smells in LLM-Generated Unit Tests — [arxiv.org/abs/2410.10628](https://arxiv.org/abs/2410.10628)
- LLMs Detecting/Correcting Test Smells — [arxiv.org/abs/2506.07594](https://arxiv.org/abs/2506.07594)
- Google Testing Blog, SMURF — [testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html](https://testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html)
- Fowler, Practical Test Pyramid — [martinfowler.com/articles/practical-test-pyramid.html](https://martinfowler.com/articles/practical-test-pyramid.html)
- Cohn, *Succeeding with Agile* (2009) — origin of pyramid, no 70/20/10 numbers in original.
- Kent C. Dodds, Testing Trophy — [kentcdodds.com/blog/the-testing-trophy-and-testing-classifications](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- Spotify Engineering, Honeycomb (2018) — referenced via [qase.io/blog/the-test-pyramid-and-its-discontents/](https://qase.io/blog/the-test-pyramid-and-its-discontents/)
