---
phase: 5-qa-gaps
date: 2026-05-10
slug: cortex-x
based_on:
  audit: cortex/qa/AUDIT.md
  catalog: standards/test-types-catalog.md
quality_model: ISO/IEC 25010:2023
asvs_target: L1 (personal framework)
---

# Testing gaps — cortex-x (self-audit), 2026-05-10

**Stack:** Node 22 + Bash/Pwsh installer + 9-kind action_kind palette + 5-lane CI matrix + 14 GHA workflows + autonomous Steward runtime + LLM dispatch (mock/openrouter/claude-cli)
**Q1 top risk (RA):** Steward defense layers exist as libraries but no end-to-end regression that they fire on adversarial input
**Tester profile (Q5, RA):** Operator-solo, ~30h/week, comfortable with Vitest/node:test/fast-check/StrykerJS docs (no live use yet)
**Compliance (Q3, RA):** ASVS L1 baseline (escalates to L2 at Sprint 4.x WaaS commercialization)

---

## P0 — block-release-worthy (must close before Tier 1 sprint completion)

- **GAP-001** — **Adversarial LLM-output regression suite for engine seam.** Add `tests/adversarial/engine-prompt-injection.test.cjs` — 30+ malicious LLM outputs (forbidden-tool calls, path traversal in edits, secret-leaking commits, prompt-leaking outputs); assert spec-verifier rejects + STEWARD_HALT writes + redact scrubs. **Type:** `ai-prompt-injection-regression` + `security-lethal-trifecta`. **Risk if unfixed:** burn-in starts (post billing fix) without E2E proof defense layers actually fire. **Estimate:** 8-12h. **Owner skill:** mid (security background helps). [audit: §7, §11] [catalog: ai-prompt-injection-regression / security-lethal-trifecta]
  **Research nudge:** "Research best practices 2026 for LLM-output adversarial test suite — prompt injection regression + tool-call validation + lethal trifecta defense regression. Min 5 cited URLs. 200-word memo."

- **GAP-002** — **StrykerJS 9.6 mutation testing on `bin/steward/_lib/`.** Sprint 2.3 R1 design already approved-pending; ratchet plan = 60% threshold week 1, 75% by week 6. Risk-tiered: 80% on `_lib`, 70% on orchestrators. **Type:** `correctness-mutation-testing`. **Risk if unfixed:** 1764 tests pass but coverage % is gameable — Trail of Bits 2026 thesis. **Estimate:** 6-8h (config + first run + threshold tune). [audit: §3] [catalog: correctness-mutation-testing] [src: stryker-mutator.io]
  **Research nudge:** Already done — see `docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md` (10 cited URLs).

- **GAP-003** — **`evals/` automated runner.** 9 rubrics exist; wire into nightly CI `steward.yml` job + populate `evals/results/<date>.md`. Use promptfoo or hand-rolled per Sprint 5 design. **Type:** `ai-eval-suite-rubric`. **Risk if unfixed:** prompt regressions invisible until manual replay; framework drift unmetered. **Estimate:** 4-6h. [audit: §11] [catalog: ai-eval-suite-rubric]
  **Research nudge:** "Research best practices 2026 for promptfoo CI runner integration with nightly cron + result archival. Min 5 cited URLs. 200-word memo."

- **GAP-004** — **`bin/cortex/tools/` LLM-dispatch tool-call validation.** 6 tools (read/write/edit/glob/grep/bash) — assert annotation routing rejects unknown tools, schema mismatch, oversize args. Already partial (Sprint 2.9.7c property-invariants.test.cjs covers 16-perm sweep) — extend to LLM-output simulation. **Type:** `ai-tool-call-validation`. **Risk if unfixed:** future Steward LLM-tool surface (Sprint 2.7.1 pattern_transfer impl) ships untested. **Estimate:** 4-6h. [audit: §11] [catalog: ai-tool-call-validation]
  **Research nudge:** "Research best practices 2026 for tool-call validation in Claude Agent SDK / Vercel AI SDK / OpenAI Agents SDK. Min 5 cited URLs."

---

## P1 — sprint-worthy (close in next 2-week sprint)

- **GAP-005** — **Property tests for recommendations.cjs parser** (markdown edge cases: nested fences, BOM, mixed line endings, malformed frontmatter). **Type:** `correctness-property-fast-check`. [audit: §3] [catalog: correctness-property-fast-check]
  **Research nudge:** Skip (already established pattern in Sprint 1.6.21).

- **GAP-006** — **Property tests for journal.cjs append-only ledger** (size cap, rotation, BOM, concurrent writes). **Type:** `correctness-property-fast-check`. [audit: §3]

- **GAP-007** — **Property tests for git-trailer-builder.cjs** (RFC 5322-ish folding rules + co-author multi-line). **Type:** `correctness-property-fast-check`. [audit: §3]

- **GAP-008** — **Semgrep SAST gate in PR CI.** Add to `.github/workflows/test.yml`. **Type:** `security-sast-static`. [audit: §6, §7] [catalog: security-sast-static]
  **Research nudge:** "Research best practices 2026 for Semgrep CI integration on Node.js + bash project; rule-set selection. Min 5 cited URLs."

- **GAP-009** — **osv-scanner v2 SCA gate in PR CI.** **Type:** `security-sca-deps`. (Note: cortex-x has zero deps in package.json — this is a discipline gate for future deps.) [audit: §6, §7] [catalog: security-sca-deps]

- **GAP-010** — **gitleaks + trufflehog secret scanning** (PR + nightly history scan). **Type:** `security-secret-scanning`. [audit: §6, §7] [catalog: security-secret-scanning]

- **GAP-011** — **Fault-injection tests for engine seam** — simulate OpenRouter 5xx, claude-cli timeout, gh-cli auth fail. Assert `STEWARD_*_AUTH_REJECTED` / `_TIMEOUT` / `_OUTPUT_MALFORMED` exit cleanly with cost capture. **Type:** `reliability-fault-injection`. [audit: §2] [catalog: reliability-fault-injection]

- **GAP-012** — **Migration roll-forward + rollback test fixture.** Apply each MIGRATIONS.md sprint entry to a fixture cortex/ tree; reverse; assert original state. **Type:** `reliability-migration-rollforward`. [audit: §9] [catalog: reliability-migration-rollforward]

- **GAP-013** — **End-to-end Steward LLM cycle for 6 untested deterministic kinds** (lint_fix, flaky_test_repair, test_coverage_gap, doc_drift, pr_review_responder, tech_debt_audit). Today: dispatcher tested (Sprint 2.9.6) but no full LLM → applyEdits → spec-verifier → executor → journal cycle exercised. Use mock LLM for deterministic + 1 real LLM for canary. **Type:** `integration-api-route` × 6. [audit: §1]

- **GAP-014** — **End-to-end install banner regression** for all 4 profiles (dev/qa-tester/ai-engineer/minimal). Today: dev + qa-tester have integration tests (Sprint 2.10.2); ai-engineer + minimal still inferred from code path. **Type:** `integration-api-route` × 2. [audit: §1]

- **GAP-015** — **Hook contract negative-path tests** — invalid JSON output, missing `hookSpecificOutput`, oversize stdout. Today happy-path covered; rejection handling assertion gaps. **Type:** `unit-component-rendering` (hooks act like components). [audit: §1]

---

## P1 — DevOps + CI quality (per Sprint 2.10.1 expansion)

- **GAP-016** — **`actionlint` PR gate** on 14 GHA workflows (catch unpinned `@main` actions + expression typos). **Type:** `devops-workflow-lint`. **Estimate:** 1-2h. [audit: §6] [catalog: devops-workflow-lint]

- **GAP-017** — **`pinact` + StepSecurity Harden Runner** for action pinning + runtime EDR (post March 2026 trivy-action incident). **Type:** `devops-action-pinning`. [audit: §6] [catalog: devops-action-pinning]

- **GAP-018** — **`hadolint` Dockerfile gate** — N/A (cortex-x has no Dockerfile yet). Add when Sprint 4.x containerizes Steward runtime. SKIP. [catalog: devops-dockerfile-lint]

- **GAP-019** — **`syft` SBOM generation** per release (relevant when cortex-x publishes to npm/distribution channel). **Type:** `devops-sbom-generation`. [audit: §6] [catalog: devops-sbom-generation]

---

## P2 — backlog (close opportunistically, track but don't gate)

- **GAP-020** — **Hook latency PR gate** (`<50ms` on session-start, post-tool-use; halt-check already has property test). **Type:** `perf-cold-start-budget`. [audit: §4]

- **GAP-021** — **user.yaml schema validation** at session-start hook entry. Currently flat-yaml regex parsed; no schema. **Type:** `data-validation-boundary`. [audit: §9]

- **GAP-022** — **MCP server publishing tests** — when cortex-x publishes Tools Foundation as an MCP server (Sprint 2.9 wave 2). Until then, defer. **Type:** `ai-mcp-protocol-test`. [audit: §11]

- **GAP-023** — **`compliance-iso-25010-coverage` doc** — explicit map of test suite to all 9 ISO 25010:2023 chars (this audit's quality scorecard is the foundation; promote to a versioned doc). **Type:** `compliance-iso-25010-coverage`. [audit: §1]

- **GAP-024** — **`regression-confirmation-istqb`** — split test commands so PR can confirm-failed-only first then regression-suite (faster feedback). **Type:** `regression-confirmation-istqb`. [audit: §1]

---

## SKIP — researched and intentionally NOT recommended (cited)

- **No e2e-browser-flow / a11y / mobile-viewport** — cortex-x has no UI surface (CLI only). [audit: §10]
  Reason: Category 7 a11y entries inapplicable; revisit at Sprint 4.5 BIOS-style health dashboard if/when shipped.

- **No PCI-DSS / EU AI Act / GDPR Art. 32** — cortex-x is a personal framework; not Annex III high-risk; no card data; no EU customer DB. ASVS L1 baseline only. [audit: Phase 3 Q3]
  Reason: escalate at Sprint 4.x commercialization; premature now.

- **No pen-test (HackerOne / Bugcrowd)** — premature; revisit at Sprint 4.7 public launch. [audit: §7]

- **No formal model-based test (TLA+/Quint)** — Steward action_engine state machine could benefit but ROI < hand-property-test for now. Revisit at Sprint 3.x AlphaEvolve. [audit: §3]
  Reason: 2-week learning curve for Quint vs hours for fast-check state-machine; pick the cheaper invariant tool first.

---

## OPEN QUESTIONS (sources disagree or context-dependent — operator decides)

- **StrykerJS cadence: per-PR incremental + nightly full vs weekly-only full?** — recommendation lean: **weekly-only full + per-PR incremental on changed modules**, given GHA quota concerns flagged in Sprint 2.3 R1. [src A: stryker-mutator.io incremental docs] vs [src B: Trail of Bits 2026 mutation-for-the-agentic-era — argues for nightly cadence]

- **Mutation threshold: 80% hard from day 1 vs 60% measure-only 2 weeks → ratchet?** — recommendation lean: **60% measure-only 2 weeks → ratchet 70% week 3-4 → 75% week 6** (per Sprint 2.3 R1 §8.3). Avoid day-1 80% — first run will fail wholesale + create a sprint of cleanup before ANY new work is mergeable. [src A: stryker-mutator.io thresholds] vs [src B: Trail of Bits 2026]

- **Eval-runner platform: promptfoo vs DeepEval vs hand-rolled per Sprint 5 RFC?** — recommendation lean: **promptfoo** (lighter, CI-native, no Python dep) for the simple golden-set + rubric pattern; revisit DeepEval for Pythonic + LangChain ecosystem only if those land in cortex-x stack. [src A: promptfoo.dev] vs [src B: confident-ai.com/deepeval]

---

## Off-limits zones (Phase 3 Q4) — flagged but NOT actionable

- FYI: `bin/hermes/*` legacy paths are mid-rebrand to `bin/steward/*` per Sprint 4.7 rebrand finish (commit `15e671f`). Don't add tests for soon-to-be-renamed shims.

---

## Progress meta

- **Total gaps surfaced:** 24
- **P0:** 4 | **P1 testing:** 11 | **P1 DevOps:** 3 (+ 1 SKIP) | **P2:** 5
- **SKIPs (cited):** 4
- **OPEN:** 3
- **Off-limits FYI:** 1
- **Quality scorecard summary** (from audit): Functional 4/5, Performance 2/5, Compatibility 5/5, Reliability 3/5, Security 2/5, Maintainability 4/5, Flexibility 4/5, Safety 3/5, Correctness 3/5, AI 2/5, Test-obs 4/5

**Single highest-leverage finding:** the defense-by-design / defense-by-regression-test gap (cross-pattern §2 in AUDIT.md). GAP-001 + GAP-002 close it. Both estimated ≤12h. Both produce a regression artifact that protects Sprint 2.x burn-in.

Re-audit `/test-audit` in 3 months to measure progress.
