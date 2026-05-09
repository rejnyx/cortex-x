---
phase: 5-qa-strategy
date: 2026-05-10
slug: cortex-x
based_on:
  audit: cortex/qa/AUDIT.md
  catalog: standards/test-types-catalog.md
quality_model: ISO/IEC 25010:2023
asvs_target: L1 (escalates to L2 at Sprint 4.x WaaS commercialization)
---

# Testing strategy — cortex-x (self-audit), 2026-05-10

**Stack:** Node 22 + Bash/Pwsh installer + 5-lane CI matrix + 14 GHA workflows + Steward autonomous runtime + LLM dispatch (mock | openrouter | claude-cli)
**Top business risk (Q1, RA):** defense layers exist as libraries; no E2E regression they fire on adversarial input
**Compliance (Q3, RA):** ASVS L1 baseline; escalate at Sprint 4.x
**Tester capacity (Q5, RA):** Operator-solo, ~30h/week

---

## Pyramid target (12-month plan)

|              | Now (2026-05-10) | 3 months  | 12 months  |
|--------------|------------------|-----------|------------|
| Unit         | 68 spec files    | 75-80     | 100+       |
| Contract     | 12 (SSOT-strong) | 15-18     | 22-25      |
| Integration  | 6                | 12-15     | 20-25      |
| Smoke        | 1 (verify-install)| 3-4      | 5-6        |
| **Mutation** | **0** 🚨          | 60% threshold on `_lib` | 75% on critical path |
| **Property** | 7 modules        | 12-15 modules | 20+   |
| **Adversarial / prompt-injection** | **0** 🚨 | 30+ malicious cases | 80+ |
| Eval rubrics | 9 authored + **0 automated** 🚨 | 9 + cron runner | 20+ rubrics + drift gate |

---

## Tool decisions (cited)

- **Unit:** Vitest is wrong choice (heavyweight); cortex-x correctly uses **node:test + node:assert/strict** (zero-deps) — keep [src: nodejs.org/api/test.html]
- **Mutation:** **StrykerJS 9.6 incremental mode** [src: stryker-mutator.io] — per Sprint 2.3 R1 §3
- **Property:** **fast-check 4** when adoption begins; current Sprint 1.6.21 + 2.9.7c uses hand-rolled (zero-deps) — both viable, fast-check faster to author [src: fast-check.dev]
- **Eval runner:** **promptfoo** [src: promptfoo.dev] — lightweight CI-native; defer DeepEval until Pythonic eval logic lands
- **SAST:** **Semgrep** (46% detection vs SonarQube 19%) [src: semgrep.dev]
- **SCA:** **osv-scanner v2.3.5+** (Google, free) [src: github.com/google/osv-scanner]
- **Secret scanning:** **gitleaks pre-commit + trufflehog CI** [src: gitleaks.io, trufflesecurity.com]
- **Workflow lint:** **actionlint** [src: github.com/rhysd/actionlint]
- **Action pinning:** **pinact + StepSecurity Harden Runner** (post March 2026 trivy-action incident) [src: stepsecurity.io]

---

## CI gating philosophy

| Gate | Layer | Action |
|---|---|---|
| Block on red | unit + contract + 5-lane install-smoke | merge blocked |
| Block on red | hook-contract + prompt-regression (Tier 4-5 HARD per tests/README.md) | merge blocked |
| Soft-block | mutation regression on `_lib/*` > 5pp | warn, require justification |
| Soft-block | hook latency regression > 20% | warn |
| Inform-only | full mutation sweep, OWASP ZAP baseline (when introduced) | annotate PR |
| Nightly only | adversarial LLM-output regression suite, full chaos (Sprint 2.2) | non-blocking, alert on regression |

**The single biggest CI fix:** GAP-001 (adversarial regression suite) — closes the defense-by-regression-test gap that's the load-bearing finding of this audit.

---

## Coverage thresholds (risk-tiered, mutation-aware)

| Tier | Examples | Line cov | Branch cov | Mutation score |
|---|---|---|---|---|
| **High-risk** | `bin/steward/_lib/*` (action-engine, executor, spec-verifier, halt-check, cost-safety, memory-decay, autoresearch), `bin/cortex/tools/_lib/path-safety` | 80% | 70% | **75%** |
| **Mid-risk** | `bin/steward/dry-run.cjs`, `bin/cortex-steward.cjs`, `shared/hooks/*`, `detectors/*` | 70% | 60% | 60% |
| **Low-risk** | `tools/*`, `templates/*` (HBS), `profiles/*.yaml` (data-only) | 50% | — | — (advisory) |
| **Excluded** | `tests/fixtures/**` (test data), `bin/hermes/*` (deprecated, Sprint 4.7), `**/*.generated.*` | — | — | — |

---

## ISO 25010:2023 coverage targets (3-month sprint)

- **Functional Suitability:** close 6 deterministic-kind LLM-cycle E2E gaps (GAP-013)
- **Performance Efficiency:** hook latency PR gate (GAP-020); install wall-time budget
- **Compatibility:** preserve 5-lane CI matrix; add macOS-pwsh in next-quarter (low priority)
- **Interaction Capability:** N/A (CLI only)
- **Reliability:** fault-injection tests on engine seam (GAP-011); migration roll-fwd+back fixture (GAP-012)
- **Security:** **GAP-001 adversarial regression suite + Semgrep + osv-scanner + gitleaks** in PR — closes the deepest finding
- **Maintainability:** mutation testing on `_lib` at 60% (GAP-002); ratchet to 75% by 3 months
- **Flexibility:** preserve engine-seam swap discipline (mock/openrouter/claude-cli)
- **Safety:** spec-verifier already gates LLM edits; **add adversarial regression** that confirms safety in adversarial conditions
- **Correctness invariants:** extend property tests from 7 → 12 modules (GAP-005, 006, 007)
- **AI-specific:** `evals/` runner (GAP-003) + tool-call validation (GAP-004) + prompt-injection regression (GAP-001)
- **Test observability:** flake-rate consumer in CI (use `gh api` rerun-stats); test-impact analysis when fast-check footprint grows

---

## DevOps + CI quality gates (NEW — Sprint 2.10.1 expansion)

| Concern | Tool | Gate | GAP-id |
|---|---|---|---|
| Workflow correctness | actionlint | block PR | GAP-016 |
| Action pinning | pinact + StepSecurity Harden Runner | block PR (pin) + alert (runtime) | GAP-017 |
| Secret scanning | gitleaks + trufflehog | block PR + nightly history | GAP-010 |
| SBOM (when releasing) | syft (CycloneDX 1.6+) | required in release pipeline | GAP-019 |
| Dep vulnerability | osv-scanner v2 | block on CRITICAL; warn HIGH | GAP-009 |
| Container scan | Trivy | N/A (no Dockerfile yet) | GAP-018 SKIP |
| IaC lint | kube-linter | N/A (no k8s yaml in cortex-x) | SKIP |
| Deploy smoke | n/a | n/a (cortex-x is the deploy machinery, not a deployable service) | — |
| DORA metrics | dora-metrics-action | dashboard for solo-tracking | P3 future |

---

## Out-of-scope (cited reasoning)

- **No e2e-browser-flow / a11y** — CLI framework, no UI surface [src: cortex-x/CLAUDE.md "agentic-ready by default" framing]
- **No PCI-DSS / GDPR Art. 32 / EU AI Act** — personal framework, no regulated user data, not Annex III high-risk; revisit at Sprint 4.x WaaS [src: PolyForm Noncommercial 1.0.0 license]
- **No formal model-based testing (TLA+/Quint)** yet — fast-check + state-machine tests cheaper for similar invariant coverage; reconsider at Sprint 3.x AlphaEvolve when prompt-evolution invariants need formal proof [src: stryker-mutator.io vs TLA+ tradeoff analysis]
- **No StrykerJS day-1 80% threshold** — would block all PRs week 1; ratchet plan per Sprint 2.3 R1 §8.3 [src: stryker-mutator.io thresholds]
- **No DeepEval (Python) for evals** — adds Python runtime to a JS-only stack; revisit if Pythonic eval logic ever lands [src: confident-ai.com/deepeval]

---

## Three-month execution plan (paired with backlog in testing-gaps.md)

### Month 1 — close P0 (defense regression + mutation foundation)
- **Week 1:** GAP-002 (StrykerJS 60% measure-only on `_lib`), GAP-003 (`evals/` runner)
- **Week 2:** GAP-001 (adversarial regression suite — 30 cases), GAP-004 (tool-call validation extend)

### Month 2 — close top P1 (property + DevOps gates)
- **Week 3-4:** GAP-005 + GAP-006 + GAP-007 (3 property test waves), GAP-016 (actionlint)
- **Week 5-6:** GAP-008 (Semgrep), GAP-010 (gitleaks + trufflehog), GAP-017 (pinact + Harden Runner), GAP-011 (fault injection)

### Month 3 — pyramid rebalance + ratchet
- **Week 7-8:** ratchet StrykerJS 60% → 75% on `_lib` high-risk; add `bin/cortex/tools/` to mutation scope
- **Week 9-10:** GAP-013 (6 deterministic-kind LLM-cycle E2E), GAP-012 (migration roll-fwd+back fixture)
- **Week 11-12:** re-run `/test-audit` for delta — measure progress, refresh research; promote `regression-confirmation-istqb` (GAP-024)

---

## Anti-patterns to avoid in cortex-x specifically

1. **"Property test discipline only when there's bandwidth"** — Sprint 1.6.21 + 2.9.7c happened during marathon sessions; cousin modules waited months. Routine application (1 property test per merged feature) closes the gap without sprints.
2. **"Defense-by-design without defense-by-test"** — the audit's biggest finding. cortex-x has 4 defense layers (spec-verifier + halt-check + redact + path-safety) ALL with unit tests for the LIBRARY. None has end-to-end "adversarial input → defense fires" regression. GAP-001 closes this class.
3. **"Eval rubrics authored, runner deferred"** — same anti-pattern. 9 rubrics in `evals/` since Sprint 5; results dir empty for months. GAP-003 = wire it.
4. **"Mock-only LLM E2E"** — 6 of 9 deterministic action_kinds have dispatcher tests + zero LLM-cycle E2E. GAP-013 fixes; needs operator-cost-validated single canary run per kind.

---

## Re-audit cadence

Re-run `/test-audit` every 3 months. Compare new `cortex/qa/AUDIT.md` to previous — diff = progress signal. Quality scorecard 1-5 per char is the trackable metric.

**Self-audit value to the framework:** validates the prompt + catalog selection oracle work on a real (non-tmpdir) repo. Both `cortex/qa/AUDIT.md` (this file's sibling) + the testing-gaps.md backlog ARE the validation deliverable for Sprint 2.10's qa-retrofit infrastructure.
