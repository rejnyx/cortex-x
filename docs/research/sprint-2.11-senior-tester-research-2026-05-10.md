# Senior-Tester / Autonomous Test-Quality-Reviewer Agent — 2026 SOTA scan

**Date:** 2026-05-10
**Context:** cortex-x Steward runtime, considering a `senior_tester_review` action_kind alongside existing test-adjacent kinds (`flaky_test_repair`, `test_coverage_gap`, `mutation_score_drift`, `tech_debt_audit`, `lint_fix_shipper`).
**Adjacent shipped:** Sprint 2.10 one-shot `/test-audit` (qa-retrofit prompt + qa-engineer profile, 7-phase, ISO 25010:2023 + OWASP ASVS 5.0 + Bach HTSM SFDPOT + tsDetect FSE'20 grounded).

---

## TL;DR

- **Reviewing existing tests is now a real research lane (2024Q4–2025Q4)**, distinct from the well-trodden "LLM generates tests" lane. Pivotal artifacts: **UTRefactor (FSE'25)** — 89% smell reduction via context-injected DSL; **Agentic-LMs / "Hunting Down Test Smells" (IEEE Software, arxiv:2504.07277)** — multi-agent loop, Phi-4-14B at pass@5 75.3% within 5% of o3/Claude-4-Sonnet; **Empirical Software Engineering 2025 (Springer 10.1007/s10664-025-10718-x)** — proposes **13 new test smells in 4 categories** explicitly extending tsDetect, focused on AI-generated tests. The detect→refactor pipeline is now a **two-stage** standard: deterministic detector (tsDetect / PyNose / JNose) feeds an LLM agent that refactors with context.
- **No mainstream SaaS or GitHub App ships a cron-driven "audit existing tests" mode today.** Diffblue Cover added a 2025 **Test Review** feature + **Test Asset Insights** that *learn from* existing tests but generates new tests rather than reviewing test-suite quality holistically. Mabl/Functionize/TestSprite/Applitools/Virtuoso all sit in the **authoring + execution** lane. This is an open niche cortex-x can credibly occupy.
- **Recommendation:** ship `senior_tester_review` as **hybrid 2-stage capability** (deterministic detector → LLM judge with multi-agent option). Use **monthly cadence**, not nightly — test-smell drift is slow, and false positives on smell-refactors are higher-stakes than e.g. lint-fix because they can silently weaken assertions. Output is a **review report + scored backlog**, not auto-merged refactors. Refactor execution stays human-gated until a `mutation_score_delta_nonneg` precondition is wired (Sprint after `mutation_score_drift` matures).

---

## §1 — Published work (2024-Q4 → 2025-Q4)

### 1.1 UTRefactor — *Automated Unit Test Refactoring*
- **Citation:** Gao, Hu, Yang, Xia. FSE 2025. arxiv:2409.16739 (https://arxiv.org/abs/2409.16739).
- **Contribution:** Context-enhanced LLM framework for **refactoring** test smells in Java. Chain-of-thought + DSL-based refactoring rules + checkpoint mechanism for multi-smell tests. **89% reduction** (2,375 → 265 smells across 879 tests, 6 OSS Java projects), beating direct LLM by **61.82%**.
- **Why it matters for cortex-x:** UTRefactor is the closest published prior art for an *agentic refactor* loop that consumes a smell list and produces clean test code. The DSL-based rules are a ready-made grounding source for `senior_tester_review` action prompts.

### 1.2 Agentic LMs: Hunting Down Test Smells
- **Citation:** Melo, Simões, Gheyi, d'Amorim, Ribeiro, Soares, Almeida, Soares. IEEE Software (accepted). arxiv:2504.07277 (https://arxiv.org/abs/2504.07277).
- **Contribution:** Single- vs 2-agent vs 4-agent comparison on **150 real-world Java instances, 5 smell types**, generalized to Python/Go/JS. **Phi-4-14B pass@5 75.3%** (within 5% of o3, Claude-4-Sonnet, Gemini-2.5-Pro). **Multi-agent beats single-agent for 3 of 5 smell types.** 6 PRs merged into OSS projects.
- **Why it matters:** validates that **smaller open models + multi-agent loops** match frontier models for this task — directly relevant to cortex-x's per-action model routing (Sprint 2.0b). Also: confirms **single-agent is fine for some smells**, which lets us route by smell-class.

### 1.3 Evaluating LLMs for Detecting and Correcting Test Smells
- **Citation:** arxiv:2506.07594 (https://arxiv.org/abs/2506.07594), 2025.
- **Contribution:** Empirical study of GPT-4-Turbo, LLaMA-3-70B, Gemini-1.5-Pro on Python + Java suites. Pipeline: **PyNose / tsDetect detection → LLM refactor**. Gemini wins detection (74.35% Py / 80.32% Java). All models can refactor; **all also sometimes introduce new smells** — a critical finding for cortex-x: any auto-refactor MUST be re-detected after.

### 1.4 Test Smells in LLM-Generated Unit Tests
- **Citation:** arxiv:2410.10628 (https://arxiv.org/abs/2410.10628), 2024.
- **Contribution:** First multi-benchmark large-scale analysis of smell *diffusion* in LLM-generated tests. Detectors: tsDetect + JNose. Finds Assertion Roulette + Magic Number Test as dominant LLM smells, correlated with prompt strategy + context length + model scale.
- **Why it matters:** a senior-tester agent in cortex-x must specifically defend against the smells *its own LLM peers* introduce.

### 1.5 Assessing Automatically-Generated Test Code Quality (ESE 2025)
- **Citation:** Springer Empirical Software Engineering, DOI 10.1007/s10664-025-10718-x (https://link.springer.com/article/10.1007/s10664-025-10718-x), 2025.
- **Contribution:** Manual analysis of **2,340 automatically-generated tests** → **13 new test smells, grouped into 4 categories**, explicitly positioned as extending tsDetect's taxonomy beyond hand-written tests.
- **Why it matters:** this is the first published "tsDetect 2.0" candidate. cortex-x should track this taxonomy as the SOTA baseline for AI-era test smells.

### 1.6 Adjacent: iSMELL (ASE 2024) + SmellCC
- **Citation:** Survey reference iSEngLab/AwesomeLLM4SE; SmellCC in arxiv:2508.11958 (https://arxiv.org/abs/2508.11958).
- **Contribution:** LLM + expert toolset assemblies for code-smell (broader than test-smell) detection + cleaning. Useful as architectural prior art for the *expert-tool-assembly* pattern (which cortex-x already uses via qlty/knip/ESLint).

---

## §2 — Test smell taxonomy 2026 state

**Verdict: tsDetect (FSE'20) is still the *production* baseline but is being explicitly extended, not superseded.**

- **tsDetect** remains the dominant detector in published 2025 pipelines. 96% precision / 97% recall on hand-written Java; OSS at github.com/TestSmells/TSDetect; companion tools PyNose (Python) and JNose (Java successor) used in 2024-2025 papers.
- **Two parallel taxonomy expansions** are emerging:
  1. **AI-generated-test smells** (ESE 2025, §1.5): 13 new smells in 4 categories — these are smells that hand-written code rarely exhibits but LLM-generated code does. **No public detector tool yet.**
  2. **Domain-specific smell sets** — microservices test smells (multiple ISSTA/ICSE 2024-2025 papers), VR-app test smells, ML-test smells. These remain niche.
- **No published "test smell → automated repair" mapping exists as a single artifact.** UTRefactor (§1.1) and Hunt-Down (§1.2) each use their own ad-hoc DSL/prompt rule sets. **This is a gap cortex-x can close** by encoding a tsDetect-smell-id → repair-strategy table as part of the action_kind registry.
- **Bach HTSM SFDPOT + ISO 25010:2023** (already in cortex-x Sprint 2.10) cover the **strategic/quality-attribute** dimension but **do not cover the syntactic test-smell** dimension. The two are complementary, not redundant — `senior_tester_review` should fuse both.

---

## §3 — Competitor scan

### Open source
- **tsDetect / TSDetect** (Java) — IntelliJ plugin + CLI. Detection only.
- **JNose** (Java successor) — academic, used in the 2024-2025 papers.
- **PyNose** (Python) — JetBrains research, detection only.
- **UTRefactor** — academic prototype, OSS status unconfirmed in the abstract; check the FSE'25 artifact.
- **iSMELL / SmellCC** — academic, code-smell focused (broader than tests).
- **No "cron-driven nightly test-quality auditor" exists in OSS** that I could find. Closest is custom Jenkins/CircleCI cron-running tsDetect with no LLM judge layer.

### SaaS / commercial
- **Diffblue Cover (2025)** — added **Test Review** (verifies AI-generated tests pre-merge) and **Test Asset Insights** (learns from existing tests to generate idiomatic new ones). **This is "consume existing tests as context for generation," NOT "audit existing tests for quality."** Adjacent, not competing.
- **Mabl / Functionize / TestSprite / Applitools / Virtuoso** — agentic authoring + self-healing E2E. None ship an explicit "audit existing tests" mode.
- **testRigor / Testsigma / LambdaTest** — generation + execution + flaky detection, no smell audit.
- **Sentry, Datadog Test Visibility** — flaky-test surfacing from runtime traces, not static smell detection.

### Claude Code / MCP / GitHub Apps
- **claude-code-skills (levnikolaevich)** — has audit skills (`build-auditor`, `dependencies-auditor`, `query-efficiency-auditor`) — **no test-quality auditor**.
- **code-review-mcp (praneybehl)** — code review via OpenAI/Gemini, not test-suite specific.
- **GitHub Marketplace** — no app dedicated to "review existing test quality on a schedule" surfaced in 2026-05 search.

**Conclusion: this is an open niche.** Senior-tester-review is an agent shape *no one has shipped as a productized cron-driven service*, only as one-shot academic prototypes.

---

## §4 — Recommendation: `senior_tester_review` action_kind shape

### Cadence
**Monthly** (not nightly). Test-smell drift is slow; nightly is wasteful + creates churn. Trigger: cron-monthly OR explicit `cortex-steward run senior_tester_review` OR auto-triggered when `tech_debt_audit` flags a test-folder hotspot.

### Architecture: **2-stage hybrid (deterministic detector + LLM judge)**

```
PHASE A — DETECT (deterministic, zero LLM cost)
  ├─ tsDetect / JNose (Java)
  ├─ PyNose (Python)
  ├─ Detection over JS/TS via pattern grep (cortex-x-owned rule set, seeded from
  │   tsDetect's 21 + ESE'25's 13 new smells)
  └─ Layer-balance check: count tests per layer → flag pyramid skew
       (target 70/20/10 unit/integration/e2e, configurable per profile)

PHASE B — JUDGE (LLM, single call)
  ├─ Input: ranked smell list (top N=20 by frequency × severity)
  │         + 3-5 representative test files (sampled, redacted)
  │         + project profile (qa-engineer / nextjs-saas / ai-agent ...)
  │         + ISO 25010 + Bach HTSM lens
  ├─ Output (JSON-mode):
  │     - findings[]: {id, smell_kind, severity, file, line, fix_strategy, est_minutes}
  │     - layer_balance_assessment: {actual_ratio, target, recommendation}
  │     - top_3_strategic_gaps: free-text, ISO-25010-grounded
  │     - estimated_npm_test_pass_after_fixes: bool (LLM judge, advisory only)
  └─ Default model: deepseek-v4-flash; escalate to claude-sonnet for ≥10 findings
       (per Sprint 2.0b per-kind routing)

PHASE C — DELIVER (deterministic)
  ├─ Write `journal/senior-tester-YYYY-MM.md` with findings
  ├─ Open ONE GitHub issue with checklist (don't fragment into 20 issues)
  ├─ Emit OTLP trace span to Phoenix (per Sprint 2.0)
  └─ DO NOT auto-refactor in v1. Refactor execution = separate `senior_tester_apply`
       action_kind, gated on (a) `mutation_score_drift` baseline existing AND
       (b) human approval, OR (c) mutation_score_delta ≥ 0 post-refactor (auto-rollback otherwise).
```

### Spec-driven verification (Sprint 1.9.0 contract)
- `acceptance_criteria`:
  - `kind: file_predicate` — journal entry exists with required schema
  - `kind: shell` — `npm test` still passes (sanity, since v1 doesn't edit code)
  - `kind: regex` — issue body contains all top-N findings
  - `kind: llm_judge` — review report is "actionable + grounded in cited smells" (low cost, pre-filed prompt)

### Cost ceiling (R4)
- Phase A: $0
- Phase B: ~$0.005 per run with deepseek-v4-flash on 20-finding payload, ~$0.05 escalated
- Monthly cadence × ~5 active projects ≈ **$0.25/month** baseline. Well under daily/weekly/monthly cost caps from Sprint 1.9.1.

### Why hybrid (not pure-LLM, not pure-deterministic)
- **Pure LLM judge over raw test files** = high cost + unstable outputs + missed smells (LLMs are bad at consistent enumeration over large file sets — confirmed by §1.3).
- **Pure deterministic** = misses strategic smells (test pyramid imbalance, missing-quality-attribute coverage, oracle-strength gaps) that need narrative judgment.
- **Hybrid** = detector handles syntactic smells deterministically + cheaply, LLM handles strategic synthesis on a curated payload.

### Backward-compat with existing kinds (R6)
- Does NOT overlap with `flaky_test_repair` (runtime symptom, this is static).
- Does NOT overlap with `test_coverage_gap` (coverage delta, this is quality at fixed coverage).
- Does NOT overlap with `mutation_score_drift` (oracle strength via mutation, this is broader test-suite-quality).
- Complements `tech_debt_audit` (qlty/knip), which is non-test code-quality.
- Reuses Sprint 2.10 `qa-engineer` profile + `qa-retrofit` prompt fragments — same grounding sources, different cadence (monthly cron vs one-shot retrofit).

### Pre-ship gates
1. Encode tsDetect 21 + ESE'25 13 = **34-smell registry** as cortex-x SSOT JSON (one of cortex-x's institutional-wisdom-style files; doesn't rot).
2. Wire JS/TS pattern detectors first (cortex-x's Tier-1 audience), Java/Python next.
3. Add eval suite entry: 5 fixture repos with known-bad test suites, expected findings list.
4. R2 review pipeline (acceptance + correctness + security + ssot + edge-case agents) before merge.
5. Document in `docs/steward-runtime.md` § action_kinds.

### Open question for operator
**Should v1 ship "review only" or "review + propose-PR-with-refactor"?** Given §1.3's finding that LLM refactors *introduce new smells* in a non-trivial fraction of cases, and given cortex-x's R5 (human-only paths inviolate), recommend **review only in v1**, refactor in v1.5 gated on mutation-score delta. This matches the "diagnose, don't blindly fix" principle already encoded in cortex-x.

---

## Sources

- arxiv:2409.16739 — UTRefactor (FSE 2025)
- arxiv:2504.07277 — Agentic LMs: Hunting Down Test Smells (IEEE Software)
- arxiv:2506.07594 — Evaluating LLMs for Detecting and Correcting Test Smells
- arxiv:2410.10628 — Test Smells in LLM-Generated Unit Tests
- arxiv:2508.11958 — SmellCC / Smell-Cleaned Datasets
- Springer ESE 2025, DOI 10.1007/s10664-025-10718-x — 13 new test smells taxonomy
- ESEC/FSE 2020 — tsDetect original (Peruma et al.), still current baseline
- github.com/TestSmells/TSDetect — OSS detector
- diffblue.com/resources/announcing-test-review/ — Diffblue Test Review (2025) — adjacent, not competing
- iSEngLab/AwesomeLLM4SE survey (SCIS 2025) — broader LLM-for-SE landscape
