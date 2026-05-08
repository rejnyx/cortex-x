# Decision Memo: Sprint 1.9 — Spec-driven verification

## Question

What schema, runner architecture, and failure-mode taxonomy should cortex-x adopt for spec-driven verification, so that any `action_kind` (and any future kind) can declare per-action acceptance criteria that gate `applyEditsToFilesystem` beyond `npm test` boolean pass/fail?

## Context

**The verification gap (real, recent).** Two PRs on 2026-05-08 shipped through `npm test` cleanly while destroying real work:

- **PR #3** `docs/steward-usage.md`: −347 / +32 lines. Action body said "Add a Troubleshooting section." LLM rewrote the file. Tests passed because tests don't validate doc completeness.
- **PR #4** `MIGRATIONS.md`: −609 / +28 lines, plus fabricated Sprint 1.8.0–3 history that never existed. Tests passed.

**Sprint 1.8.13 patch.** Hardcoded content-preservation guardrail in `bin/steward/_lib/action-engine.cjs:213-232` — refuse if new file < 50% of existing size unless `edit.replace_all=true`. New error code `EDIT_DESTRUCTIVE_REWRITE`. It works (run 25556792186 caught the next destructive attempt). But it is **one rule, hardcoded, applies to every kind identically**. A `dep_update_patch` action shrinking a lockfile is fine; a `doc_drift` patch shrinking README is not. The pattern needs per-kind specs.

**What `npm test` cannot catch (general taxonomy).**

1. Doc completeness ("section X still exists, section Y was added")
2. Semantic preservation ("Sprint 1.8.0–3 history is real")
3. Side-effect bounds ("only files matching `cortex/**` were edited")
4. Cost envelope ("LLM call stayed under $0.005")
5. Output shape post-edit ("`recommendations.md` still parses with N+1 items")
6. Negative criteria ("no new npm dep added", "no `.env*` mention introduced")
7. Style/lint deltas a unit test wouldn't see (e.g., new TODO markers)

**Architecture today (from code inspection).**

- `bin/steward/_lib/action-kinds.cjs` — flat registry. 9 shipped kinds + `release_notes_drafter` parked. Each entry has `description / requires_llm / source / detector / cost_envelope / blast_radius / shipped_in`. **No `acceptance_criteria` field today.**
- `bin/steward/_lib/action-engine.cjs` — applies edits with denylist + traversal-guard + Sprint 1.8.13 shrink-guard. **Verification is hardcoded; the engine has no notion of a per-action spec.**
- `bin/steward/execute.cjs` — pipeline halt → lock → engine → `runNpmTest` → commit. **`runNpmTest` is the only gate.**
- `bin/steward/_lib/lessons.cjs` — ReasoningBank-lite already exists; spec failures are a perfect signal source for it.

## Sources Checked

- GitHub Spec Kit repo + spec-template.md verbatim — [github/spec-kit](https://github.com/github/spec-kit), [spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md), [raw spec-template.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/spec-template.md), [tasks-template.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/tasks-template.md)
- AWS Kiro docs — [Specs IDE docs](https://kiro.dev/docs/specs/), [best-practices](https://kiro.dev/docs/specs/best-practices/), [TeachMeIDEA EARS deep-dive](https://teachmeidea.com/kiro-ai-ide-spec-driven-development/)
- EvalAgent / PRDBench — [arXiv 2510.24358 abstract](https://arxiv.org/abs/2510.24358), [HTML v1](https://arxiv.org/html/2510.24358v1)
- Q1-Q2 2026 SDD literature — [Spec-Driven Development paper, arXiv 2602.00180](https://arxiv.org/html/2602.00180v1), [SANER 2026 protocol, arXiv 2601.03878](https://arxiv.org/html/2601.03878v1)
- LLM-as-judge SOTA — [LLM-as-a-Judge for Software Engineering, arXiv 2510.24367](https://arxiv.org/pdf/2510.24367), [Adnan Masood rubric guide (Apr 2026)](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80), [LLM-as-a-Judge for Coding co-creation, arXiv 2604.27727](https://arxiv.org/html/2604.27727)
- Agent landscape — [OpenAI Codex changelog](https://developers.openai.com/codex/changelog), [PR-acceptance task-stratified analysis, arXiv 2602.08915](https://arxiv.org/html/2602.08915v1)

**Honest gaps.** Neither Cursor nor Devin nor OpenAI Codex publish a formal spec format with executable acceptance criteria — they consume free-text task descriptions and rely on test signals. This is exactly the gap the GitHub/Kiro/EvalAgent triad is filling. LangChain "spec-driven extension" did not surface as a real product — likely confusion with their evaluation suites.

## Options Considered

### Option A — GitHub Spec Kit-style markdown + Given/When/Then

**Format.** Markdown sections per spec: `User Scenarios & Testing` → numbered Acceptance Scenarios in `Given X, When Y, Then Z` form, plus `Functional Requirements` (`FR-001: System MUST …`), `Success Criteria` (`SC-001: Measurable metric …`), `Edge Cases`, `Assumptions`. `[NEEDS CLARIFICATION: …]` inline marker for ambiguity.

**Pros.** Human-readable. Already adopted by 14 agent platforms. Aligns with how Hermes already writes commit messages and PR descriptions (markdown). LLM-friendly: the same model that produces edits can read the spec.

**Cons.** Markdown isn't directly executable. Spec Kit itself doesn't ship a runner — implementation specs are *AI input*, not a verification harness. Free-text Given/When/Then needs a parser to become checkable. Spec Kit slash commands (`/specify`, `/plan`, `/tasks`) target greenfield feature work, not per-action gates on autonomous edits.

**Fit with cortex-x.** Partial. The vocabulary fits. The runtime semantics don't.

### Option B — AWS Kiro Requirements/Design/Tasks/Acceptance + EARS

**Format.** Three files per feature (`requirements.md` / `design.md` / `tasks.md`). Acceptance criteria use [EARS](https://teachmeidea.com/kiro-ai-ide-spec-driven-development/) — five canonical patterns:

- Ubiquitous: `THE SYSTEM SHALL <response>`
- Event: `WHEN <trigger> THE SYSTEM SHALL <response>`
- State: `WHILE <state> THE SYSTEM SHALL <response>`
- Optional: `WHERE <feature> THE SYSTEM SHALL <response>`
- Unwanted: `IF <bad cond> THEN THE SYSTEM SHALL <response>`

**Pros.** EARS is the only widely-deployed format that's "concrete enough to write a test against" by design — every clause has a single trigger and single SHALL. Originally Rolls-Royce, battle-tested in safety-critical software. Maps cleanly onto deterministic check functions in cortex-x land (a JS predicate per EARS clause).

**Cons.** Three-file overhead is too heavy for an action_kind spec — Hermes actions are far smaller than feature designs. Kiro's runtime "real-time status updates" are an IDE feature, not an autonomous-agent gate. EARS clauses need a binding from natural-language `<trigger>` to runnable code; Kiro relies on the human to wire that.

**Fit with cortex-x.** EARS-as-grammar is a clean fit. Three-file structure isn't.

### Option C — EvalAgent / PRDBench 6-tool harness with criteria scheme

**Format ([arXiv 2510.24358](https://arxiv.org/html/2510.24358v1) §3.3, §4.1).** Each criterion is a JSON entry:

```json
{
  "metric": "3.2 Unit Test - Generate Huffman Codes",
  "description": "Run: pytest src/tests/test_huffman.py::TestHuffman::test_generate_huffman_codes -v",
  "score": 2,
  "explanation": "Test executed successfully, result 'PASSED'"
}
```

The agent has **6 tools**: file-read, file-write, command-line execution, image-handling, `dealgraph` (multimodal), `judge` (simulated user input). Three test categories per project: **Unit Test** (pytest invocation), **Shell Interaction** (cmd → expected output diff), **File Comparison** (project-level files / directory structure). ~25 criteria per project on average (1,262 / 50). $2.68/project, 7 min, 124k input tokens. Human-judge alignment 81.56% perfect agreement.

**Pros.** Already proven on 50 real Python projects. Simple, machine-readable JSON schema. Three categories (cmd/file/unit) cover the gaps in cortex-x's `npm test`. The `judge` tool is a clean LLM-as-judge integration when needed.

**Cons.** Designed for benchmark-suite annotation, not per-action gating. $2.68/project is a non-starter at Hermes' nightly cadence (~$0.0008/run today via DeepSeek V4 Flash on `recommendation` kind). The 6-tool harness is a runtime, not a schema; cortex-x already has its own runtime. Propagation-chain failure mode (one fail cascades) would be brutal in autonomous nightly runs.

**Fit with cortex-x.** The **schema shape** is a strong fit. The **harness** is overkill — cortex-x already has the lock/journal/verifier triad.

### Option D — Bespoke minimal cortex-x schema, cherry-picking from A/B/C — RECOMMENDED

**Format.** Two layers:

1. **`bin/steward/_lib/action-kinds.cjs` registry gets a new `acceptance_criteria` field.** Type: array of criterion objects. Each criterion has the shape:

```js
{
  id: "doc_preservation_50pct",       // stable key for journal/lessons
  kind: "shell" | "file_predicate" | "regex" | "ears_text" | "llm_judge",
  description: "Generated content preserves >= 50% of original file bytes",
  // kind-specific:
  cmd: "npm test",                     // shell
  predicate: "newSize >= existingSize * 0.5",  // file_predicate (sandboxed JS expr)
  pattern: "/^Sprint 1\\.8\\./m",      // regex (must-match in file)
  ears: "WHEN edit.replace_all=false THE SYSTEM SHALL preserve >= 50% existing bytes",  // documentation-only
  rubric: "Did edits add a Troubleshooting section without removing prior sections?",  // llm_judge prompt
  severity: "block" | "warn",
  applies_to: ["docs/**", "MIGRATIONS.md"]   // glob; null = all touched files
}
```

2. **Per-action override.** A `dry-run.cjs` plan can carry `plan.acceptance_criteria` that *adds to* (never weakens) the kind-level array. This lets one specific recommendation say "this is an intentional rewrite" by including `{id: "allow_rewrite", kind: "regex", pattern: ".*", severity: "block"}` overrides — but the registry's defaults are the floor.

3. **New verifier module.** `bin/steward/_lib/spec-verifier.cjs` runs each criterion sequentially in `execute.cjs`'s pipeline, between the existing `applyAction` step and the existing `runNpmTest` step. **Order matters**: `npm test` is still the strongest objective signal, so it stays terminal. Spec verifier is the *additional* gate that catches the gaps.

4. **Failure surfacing.** A failed criterion writes the criterion `id`, kind, expected/actual to the journal entry's `spec_failures: []` array, propagates a single `SPEC_VIOLATION` exit to `execute.cjs`, triggers atomic rollback exactly like the existing `EDIT_DESTRUCTIVE_REWRITE` path, and feeds `lessons.cjs` so the next run sees "criterion `doc_preservation_50pct` failed for action_key `<slug>#<num>`."

5. **Sprint 1.8.13 generalization.** The hardcoded `EDIT_DESTRUCTIVE_REWRITE` becomes the *default* `acceptance_criteria` entry on the `recommendation` kind: `{id: "no_destructive_rewrite", kind: "file_predicate", predicate: "newSize >= existingSize * 0.5 || edit.replace_all === true", severity: "block"}`. Other kinds (e.g., `dep_update_patch`) get different defaults — lockfile shrinks are fine, so that kind has no shrink-guard but adds `{id: "lockfile_intact", kind: "file_predicate", predicate: "fileExists('package-lock.json')"}`.

**Pros.**

- Sprint 1.8.13 hardcoded rule becomes one of N declared rules — a true generalization, not a parallel system.
- Schema is JS-native (no YAML parser dep, zero-deps preserved).
- `kind: "shell"` covers PRDBench's three test categories trivially.
- `kind: "ears_text"` is documentation-only — the human-readable form lives next to the executable predicate, satisfying both Spec Kit's "humans understand" goal and Kiro's "every line concrete enough to test" goal.
- `kind: "llm_judge"` is a deferred escape hatch (parked for v0.9+ — see [Anthropic 2026 hybrid guidance](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80) and [arXiv 2604.27727 reliability framework](https://arxiv.org/html/2604.27727)). Don't ship it in 1.9; declare the kind, throw `SPEC_LLM_JUDGE_NOT_IMPLEMENTED` until 2.0.
- Each `action_kind` author writes their own criteria once, in the registry — exactly where the current `description / cost_envelope / blast_radius` lives. No new file format, no new tooling.
- Per-action override gives the LLM (or recommendations.md author) the explicit `replace_all`-style escape hatch that prompted Sprint 1.8.13 in the first place, but in a structured way.

**Cons.**

- "Sandboxed JS expression" via `Function()` for `file_predicate` is a footgun if criteria can come from untrusted recommendations.md content. **Mitigation:** predicates are only allowed in the registry (trusted, in-repo, code-review-gated) and in `dry-run.cjs` plans (also Hermes-authored). User-authored recommendations.md never specifies predicates — it can only opt into per-kind defaults via metadata flags like `allow_rewrite: true`.
- One more verification stage = one more place that can fail-open. **Mitigation:** spec-verifier defaults to `block` severity if a criterion file is malformed (fail-closed), with explicit `SPEC_MALFORMED` code.
- Adding a new field to the registry is a contract change. Every existing kind needs a sensible default (most will share the same 2-3 entries from the recommendation kind).

**Sub-recommendation: ship in two waves.**
- **1.9.0** — `kind: "shell" | "file_predicate" | "regex"` (deterministic only). Generalize Sprint 1.8.13. Wire failure into journal + lessons. ~10 criteria authored across the 9 shipped kinds.
- **1.9.1** — `kind: "ears_text"` lands as documentation-only, validated for syntactic well-formedness against the 5 EARS patterns. No runtime semantics yet — purely "every action_kind must declare its EARS contract." This sets up Sprint 2.x to add an EARS→predicate compiler (or LLM-judge wrapper) without changing the registry shape.

## Decision (recommended)

**Option D**, sub-recommendation A (1.9.0 ships deterministic kinds; 1.9.1 adds `ears_text` documentation; LLM-judge parked v0.9+).

Rationale, ordered:

1. **It generalizes the proven win.** Sprint 1.8.13 caught a real attack on PR #5. Option D promotes that one rule into the schema spot it always should have occupied.
2. **It composes with what already works.** The pipeline lock/journal/verifier are unchanged. Spec-verifier slots in as one new module; failure flows reuse the rollback path.
3. **It survives the cost envelope.** Hermes runs at ~$0.0008 / action via DeepSeek V4 Flash. EvalAgent's $2.68/project runtime is 3,300x more expensive — adopting it whole would blow the budget. Deterministic predicates cost ~zero.
4. **It defers the hard problem honestly.** LLM-as-judge for autonomous coding agents is genuinely unsettled (81.56% human agreement on EvalAgent — meaning ~1 in 5 judgments are wrong). Shipping it before the deterministic floor is solid would propagate fabricated content through fabricated judgment. The `kind: "llm_judge"` placeholder reserves the slot.
5. **EARS as documentation is free insurance.** Forcing every action_kind author to write the WHEN/THEN clause makes ambiguity visible at registry-edit time, which is exactly when it's cheap to fix.

## Tradeoffs

**vs. Option A (Spec Kit markdown).** We give up the Spec Kit `/specify` slash-command UX. Acceptable — Hermes' input is `cortex/recommendations.md`, not a human typing `/specify`. We keep the Given/When/Then *vocabulary* (`ears_text` covers it).

**vs. Option B (Kiro three-file).** We give up `requirements.md` / `design.md` / `tasks.md` separation. Acceptable — Hermes actions are atomic, not multi-task features. The three-file split is overhead for our scale.

**vs. Option C (EvalAgent harness).** We give up the multimodal `dealgraph` + `judge` tools and PRDBench's 25-criteria density. Acceptable — image handling isn't on cortex-x's roadmap, and 25 criteria/action is way too granular for nightly cron at $0.0008/run. We adopt their **schema shape** (id / description / kind / score-equivalent) without their runner.

## Implementation Impact

**New files:**
- `bin/steward/_lib/spec-verifier.cjs` — runner. ~150 LoC. Iterates `plan.action_kind`'s `acceptance_criteria` + plan-level overrides, executes each by `kind`, returns `{ok, failed_criteria: [{id, expected, actual}]}`.
- `tests/unit/steward/spec-verifier.test.js` — happy path + each kind + malformed-spec + override-merging. ~25 tests.
- `tests/contract/hermes/action-kinds-acceptance.test.js` — schema invariant: every shipped kind declares ≥ 1 acceptance criterion with non-empty `id` and `kind`. ~6 tests.
- `tests/integration/hermes/spec-verification.test.js` — execute.cjs end-to-end: PR #3 + PR #4 incident reproductions caught by criteria. ~8 tests.

**Modified files:**
- `bin/steward/_lib/action-kinds.cjs` — add `acceptance_criteria: [...]` to all 9 shipped kinds. Each kind authors 1-3 entries.
- `bin/steward/_lib/action-engine.cjs` — `EDIT_DESTRUCTIVE_REWRITE` migrates from hardcoded inline check to a default criterion on the `recommendation` kind. Delete lines 211-232. (Keep code path reachable via the criterion runner.)
- `bin/steward/execute.cjs` — wire `spec-verifier.runChecks(plan, applyResult)` between `applyAction` and `runNpmTest`. Add `SPEC_VIOLATION` and `SPEC_MALFORMED` to exit-code map.
- `bin/steward/_lib/journal.cjs` — accept new `spec_failures: []` field in entry validator.
- `bin/steward/_lib/lessons.cjs` — `recordLesson` already accepts `root_cause`; `SPEC_VIOLATION` + criterion `id` becomes the new root cause for spec failures. Existing module unchanged.
- `bin/steward/status.cjs` — render `spec_failures` block in CLI rollup.
- `docs/steward-runtime.md` + `docs/steward-usage.md` — document the schema, with the PR #3 / PR #4 case studies.

**Test count estimate.** ~40 new tests. Total suite 790 → ~830. Well within "Tier 0–7 + 8" green-CI envelope.

**Effort.** Sprint M (2-3 days focused) is realistic. Day 1: spec-verifier module + unit tests. Day 2: registry migration + integration tests + execute.cjs wiring. Day 3: docs + EARS-text validator + dogfood run on real recommendations. **Confirmed M, not L.**

## Failure Mode Taxonomy

New error codes Sprint 1.9 should add (all bubble up via `result.code` like existing ones):

- **`SPEC_VIOLATION`** — at least one `severity: "block"` criterion failed. Plan rolled back. Lesson recorded. *(The general successor to `EDIT_DESTRUCTIVE_REWRITE`.)*
- **`SPEC_WARNING`** — only `severity: "warn"` criteria failed. Action commits, but PR body lists warnings. *(Allows soft signals like "TODO count rose by N" without blocking the run.)*
- **`SPEC_MALFORMED`** — registry entry has invalid `acceptance_criteria` shape (missing `id`, unknown `kind`, predicate fails to compile). Fail-closed: blocks the run before edits are even applied.
- **`SPEC_PREDICATE_THREW`** — `kind: "file_predicate"` JS expression threw at runtime. Fail-closed.
- **`SPEC_SHELL_TIMEOUT`** — `kind: "shell"` cmd exceeded per-criterion timeout (default 30s). Fail-closed.
- **`SPEC_REGEX_NO_MATCH`** — `kind: "regex"` required pattern absent from target file post-edit.
- **`SPEC_OVERRIDE_REJECTED`** — plan-level override attempted to weaken (delete or downgrade-severity) a registry-declared criterion. Reject; only *additional* or *strictness-equal* overrides are allowed.
- **`SPEC_LLM_JUDGE_NOT_IMPLEMENTED`** — placeholder for v0.9+ `kind: "llm_judge"`. Throws if a kind tries to use it.

## Acceptance Criteria for the Sprint Itself

- [ ] All 9 shipped `action_kind` entries declare a non-empty `acceptance_criteria` array (contract test).
- [ ] `bin/steward/_lib/spec-verifier.cjs` ships with `kind: "shell" | "file_predicate" | "regex"` runners; `ears_text` validates structure but is no-op at runtime; `llm_judge` throws `SPEC_LLM_JUDGE_NOT_IMPLEMENTED`.
- [ ] PR #3 reproduction (mock plan: 347-line file → 32-line replacement) is rejected by spec-verifier with `SPEC_VIOLATION` and criterion `id: "no_destructive_rewrite"` in the journal.
- [ ] PR #4 reproduction (mock plan: 609-line MIGRATIONS.md → 28-line + fabricated content) is rejected by either size criterion or a new regex criterion `sprint_history_preserved` that requires `/^Sprint 1\.[78]\./m` to match in `MIGRATIONS.md` post-edit.
- [ ] Hardcoded shrink check is **removed** from `action-engine.cjs`; only the registry-declared criterion enforces it (no parallel rule sources). Verified by deleting the inline check and running existing 1.8.13 tests against the new path.
- [ ] `cortex-steward status` renders `spec_failures: [...]` block in JSON + human modes.
- [ ] Lessons.cjs records `root_cause: "SPEC_VIOLATION:<criterion_id>"` for blocked runs.
- [ ] `npm test` green at 830 ± 10 tests across all 3 CI lanes (test, install-smoke, no-pii).
- [ ] Dogfood: at least one real cron run on cortex-x demonstrates either (a) clean spec pass, or (b) caught spec violation rolled back + lesson recorded.

## Follow-up Tasks Unlocked

- **Sprint 1.9.1** — `kind: "ears_text"` syntactic validator + per-kind EARS contract documentation. No runtime semantics yet.
- **Sprint 1.9.2** — Spec-failure surface in PR body (the `--draft` PR opens with a `<!-- spec_failures -->` block listing warnings).
- **Sprint 2.0** — `kind: "llm_judge"` implementation. Requires deciding on judge model + rubric format + Cronbach's-alpha calibration. Ground in [arXiv 2510.24367](https://arxiv.org/pdf/2510.24367) "LLM-as-a-Judge for SE."
- **Sprint 2.1 (autoresearch)** — autoresearch needs a fitness signal for "did this research action improve `recommendations.md`?" Sprint 1.9's `acceptance_criteria` schema IS that signal. **Confirm the API surface matches:** the autoresearch result feeds `applyAction` like any other plan, so the same spec-verifier pipeline applies. No additional work needed in 1.9 to enable 2.1 — just verify in the 1.9 design doc that "autoresearch's `recommendation` kind inherits the recommendation acceptance_criteria" remains true.
- **Sprint 2.2** — EARS→predicate compiler. Once we have ~30 EARS clauses across kinds, a small grammar can lift them into deterministic checks automatically. Earlier than that, hand-author both forms (acceptable redundancy).
- **Sprint 2.3** — property-based tests for spec-verifier itself (per `standards/correctness.md`). Random criterion generators × random plans → invariants like "block-severity failure always triggers rollback."

## Open Questions for Operator

1. **A/B — Predicate sandboxing strategy.** `kind: "file_predicate"` runs a JS expression. Should we (A) use `new Function(...)` with a curated context object (touchedFiles, fileSizes, fileContents-by-path), or (B) use a tiny expression DSL parsed in-house (no `eval` at all, but more upfront work)? **Defaulting to A unless you say otherwise** — predicates are repo-resident, code-reviewed, and the recommendation-author surface never reaches them.

2. **Yes/No — Strict-mode default for unknown kinds.** Should an `action_kind` with **zero** declared `acceptance_criteria` (none in registry, none in plan) be (yes) blocked at the contract test, or (no) allowed with a warning that defaults to `npm test` only? **Defaulting to YES unless you say otherwise** — fail-closed matches Sprint 1.8.13's posture.

3. **A/B — Per-action override authority.** Plan-level overrides can ADD criteria. Can they ADD criteria of `severity: "block"` that target the registry's existing criteria *more* strictly (e.g., "this specific action requires 80% size preservation, not 50%")? (A) Yes, allow strict-strengthening. (B) No, plan-level criteria must use new IDs. **Defaulting to A** — strengthening is monotonic safety; only weakening is rejected via `SPEC_OVERRIDE_REJECTED`.

4. **Yes/No — Ship `kind: "ears_text"` validator in 1.9.0 or wait until 1.9.1?** It's syntactic-only (no runtime), but adds 5-pattern regex matching + tests. Skipping it keeps 1.9.0 tighter; including it forces every kind author to write the human form alongside the predicate. **Defaulting to NO (defer to 1.9.1)** — 1.9.0 stays focused on the runtime gate that prevents tomorrow's PR #6.

5. **Yes/No — Should spec-verifier run *before* or *after* `npm test`?** I recommended *before* (cheap deterministic checks first; expensive `npm test` last). But arguments exist for *after* (let the strongest signal go first, then refine). **Defaulting to BEFORE** — fast-fail on cheap checks saves CI minutes when LLM produces obviously wrong edits.
