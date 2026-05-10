---
date: 2026-05-10
type: housekeeping-audit
based_on:
  - operator brief: docs/research/cortex-x-sprint-brief-10-5.md (2026-05-10 morning, post-Sprint-1.6.19, pre-1.7+)
  - senior-tester research: docs/research/sprint-2.11-senior-tester-research-2026-05-10.md
  - devops-hygiene research: docs/research/sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md
status: synthesis ready for operator decision
---

# Housekeeping audit — operator brief × research × roadmap fit

**Three inputs synthesized** into one decision memo before Sprint 2.3b / 2.2.5 v1.5 implementation continues.

## TL;DR

1. **Operator brief is launch-readiness, not engineering**. Most P0/P1 items are still open but pivot from "engineering work" → "publish-readiness work" (naming, license, README "Built by", demo cast, real-run eval baseline). 30+ sprints have shipped since the brief was written; brief's competitive scan + DGM/SWE-Search insight remain valid.
2. **Senior-tester is a real, open niche** (per research §1+§3). UTRefactor / Agentic-LMs / ESE 2025 13-new-smells form a citable foundation. **No SaaS or GitHub App ships a cron-driven "audit existing tests for quality" mode today.** Recommendation: ship as `senior_tester_review` action_kind, monthly cadence, 2-stage hybrid (detect → LLM judge), review-only v1.
3. **DevOps hygiene gap is narrow and concrete**: `workflow_hardener` (SHA-pin + permissions injection + branch-protection drift) and `secret_history_sweep` (TruffleHog full-history) are real, verified, and not currently covered. Skip SBOM / license / dotfiles / README freshness / CODEOWNERS / pre-commit drift (low signal for single-maintainer repo).
4. **Sequencing recommendation:** insert as Sprint 2.5b (`workflow_hardener`) + 2.6b (`secret_history_sweep`) + 2.11 (`senior_tester_review`) into Tier 1, all before public-launch tag. Brief P0/P1 launch-readiness items become a separate "Sprint LR" track.

---

## §1 — Operator brief audit (item-by-item vs current reality)

The brief was written 2026-05-10 morning, post-Sprint 1.6.19. Since then we've shipped **~30+ sprints** (v0.7 → 0.8 → 1.6.X → 1.7-1.9 → 2.0-2.10 → 2.3a + hardening). The brief is therefore stale on context but **most action items remain open** — they were always launch-readiness, not feature work.

| Brief item | Status as of 2026-05-10 evening | Verdict |
|---|---|---|
| §1-2 Kontext + competitor scan | Mostly relevant; 30+ sprints behind reality (no Phoenix / autoresearch / 9-kind palette / spec-verifier / mutation foundation in brief's mental model) | **Refresh, then keep** as launch-essay seed |
| P0.1 Naming `cortex-x` rename | OPEN. `Steward` rename SHIPPED in Sprint 4.7 (Hermes → Steward); `cortex-x` itself still has kolize. | **Strategic operator decision** — defer until ready |
| P0.2 License (PolyForm NC) | OPEN. LICENSE unchanged. | **Strategic operator decision** — defer until ready |
| P0.3 README narrative rewrite | PARTIAL. Persistent-agent positioning shipped; **"Built by" sekce + "Why not Devin/Copilot/Replit" tabulka stále chybí**. | **Ship draft skeleton; operator fills personal bits** |
| P1.1 Real-run eval baseline (5 runs × 3 tasks) | PARTIAL. `evals/results/2026-05-01-01d9013-paper-baseline.json` exists (paper baseline only — predicted scores, no real Claude execution). | **Ship — Sprint LR.1**, ~$0.05 cost |
| P1.2 Statistical disclaimer in README | MISSING. | **Ship — 10 min, no risk** |
| P1.3 Cross-model transfer protocol | MISSING. | **Slot into Sprint 3.0 AlphaEvolve prereq** |
| P1.4 Demo asset (asciinema/MP4) | MISSING. | **Defer — operator-recorded; 1-2h work session** |
| P2.1 Competitive positioning page | PARTIAL. `docs/positioning-vs-ralph.md` covers Ralph only. Devin/Copilot/Replit/DGM matrix still missing. | **Ship — Sprint LR.2** |
| P2.2 First dogfood testimonial | Ongoing — cortex-x dogfoods itself (Sprint 1.6.18 → 2.3a). | **No discrete action — natural artifact accumulates** |
| P2.3 Launch checklist | MISSING. | **Ship — small file, useful** |

**Net for the brief:** keep its analytical sections as launch-essay raw material; convert P0/P1/P2 into a discrete "Sprint LR" (Launch Readiness) track, separate from Tier 1 engineering work. P0.1 + P0.2 are operator-only strategic decisions and should never block engineering momentum.

---

## §2 — Senior-tester capability — verdict + sprint shape

**Research bottom line** (citing [`sprint-2.11-senior-tester-research-2026-05-10.md`](./sprint-2.11-senior-tester-research-2026-05-10.md)):

- **2024-Q4 → 2025-Q4 has crystallized a "review existing tests" research lane** distinct from the well-trodden "LLM generates tests" lane. Citable foundation:
  - **UTRefactor** (FSE 2025, [arxiv:2409.16739](https://arxiv.org/abs/2409.16739)) — 89 % smell reduction via context-injected DSL refactor agent on Java
  - **Agentic-LMs / Hunting Down Test Smells** (IEEE Software, [arxiv:2504.07277](https://arxiv.org/abs/2504.07277)) — Phi-4-14B pass@5 75.3 % within 5 % of o3 / Claude-4-Sonnet; multi-agent beats single for 3 of 5 smell types
  - **Empirical Software Engineering 2025** ([DOI 10.1007/s10664-025-10718-x](https://link.springer.com/article/10.1007/s10664-025-10718-x)) — proposes **13 new test smells in 4 categories** explicitly extending tsDetect for AI-generated tests
  - **arxiv:2506.07594** (2025) — empirical study; critical finding: LLM refactors *sometimes introduce new smells* (re-detect mandatory)
- **No SaaS or GitHub App ships cron-driven "audit existing tests for quality"** — Diffblue Cover (2025) added Test Review + Test Asset Insights but generates new tests rather than audits existing test-suite quality. Mabl/Functionize/TestSprite/Applitools/Virtuoso all sit in authoring + execution lane. **Open niche cortex-x can credibly occupy.**
- **tsDetect (FSE'20) is still the production baseline** but is being explicitly extended (ESE 2025's 13 new smells; PyNose / JNose successors). 96 % precision / 97 % recall on hand-written Java; OSS at github.com/TestSmells/TSDetect.

**Doesn't overlap with anything we ship:**
- ≠ `flaky_test_repair` (runtime symptom, not static)
- ≠ `test_coverage_gap` (coverage delta, not quality at fixed coverage)
- ≠ `mutation_score_drift` (oracle strength via mutation, not broader suite-quality)
- ≠ `tech_debt_audit` (non-test code-quality)
- ≠ Sprint 2.10 `/test-audit` (one-shot retrofit lens, this is monthly cron)

### Proposed: Sprint 2.11 — `senior_tester_review` action_kind (M effort)

**Cadence:** **monthly** (test-smell drift is slow; nightly = wasteful + churn). Cron `0 04 1 * *` (1st of month, 04:00 UTC). Trigger also: explicit `cortex-steward run senior_tester_review` OR auto-triggered when `tech_debt_audit` flags a test-folder hotspot.

**Architecture: 2-stage hybrid**

```
PHASE A — DETECT (deterministic, $0)
  ├─ tsDetect / JNose                     (Java)
  ├─ PyNose                               (Python)
  ├─ cortex-x-owned JS/TS pattern grep    (JS/TS — Tier-1 audience)
  └─ Layer-balance: count tests per layer; flag pyramid skew (target 70/20/10)

PHASE B — JUDGE (LLM, single call)
  ├─ Input: ranked smell list (top 20) + 3-5 redacted test files +
  │         project profile + ISO 25010 + Bach HTSM lens
  ├─ Output (JSON-mode): {findings[], layer_balance_assessment,
  │                       top_3_strategic_gaps, est_npm_test_pass_after_fixes}
  └─ Default model: deepseek-v4-flash (~$0.005/run); escalate to
       claude-sonnet for ≥10 findings (Sprint 2.0b routing)

PHASE C — DELIVER (deterministic)
  ├─ Write journal/senior-tester-YYYY-MM.md
  ├─ Open ONE GitHub issue with checklist (don't fragment into 20)
  ├─ Emit OTLP trace span (Sprint 2.0)
  └─ DO NOT auto-refactor in v1 — refactor = separate v1.5 capability,
     gated on mutation_score_delta ≥ 0
```

**Why hybrid (not pure-LLM, not pure-deterministic)**: pure LLM judge over raw test files = high cost + unstable + miss-enumeration on large file sets ([arxiv:2506.07594](https://arxiv.org/abs/2506.07594) confirms). Pure deterministic = misses strategic smells (pyramid imbalance, oracle-strength gaps) that need narrative judgment.

**Cost ceiling (R4):** ~$0.25/month at full cadence across 5 projects. Well under daily/weekly/monthly cost caps from Sprint 1.9.1.

**Pre-ship gates:**
1. Encode tsDetect 21 + ESE'25 13 = **34-smell registry** as cortex-x SSOT JSON.
2. Wire JS/TS pattern detectors first; Java/Python next.
3. Eval suite entry: 5 fixture repos with known-bad test suites + expected findings.
4. R2 review pipeline (acceptance + correctness + security + ssot + edge-case) before merge.
5. Document in `docs/steward-runtime.md` § action_kinds.

**Open question for operator:** v1 = "review only" or "review + propose-PR-with-refactor"? Given §1.3 finding (LLM refactors introduce new smells) + R5 (human-only paths inviolate), recommend **review-only v1, refactor in v1.5** gated on `mutation_score_drift` baseline + delta ≥ 0.

---

## §3 — DevOps hygiene gaps — verdict + sprint shapes

**Research bottom line** (citing [`sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md`](./sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md)): cortex-x's existing 9-kind palette (with Sprint 2.3a foundation) covers **most** hygiene concerns. Two narrow but high-signal gaps remain.

### Proposed: Sprint 2.5b — `workflow_hardener` action_kind (S effort)

**Why now:** GitHub Aug 2025 policy [enforces SHA pinning](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/); 2026 [roadmap](https://github.com/orgs/community/discussions/190621) adds workflow lockfiles. Direct precedent: [StepSecurity Secure-Repo](https://github.com/step-security/secure-repo) (closed-core SaaS + OSS GHA). Renovate handles version drift but explicitly does **not** do workflow security hardening. Open niche.

**Cadence:** weekly (Sunday 03:00 UTC, before existing dep-patch).

**Operations** (deterministic, zero LLM cost):
1. Replace `uses: actions/checkout@v4` with `actions/checkout@<sha> # v4` via `gh api` resolution.
2. Inject missing `permissions: { contents: read }` at workflow root if absent.
3. Inject `concurrency:` and `timeout-minutes:` defaults where missing.
4. Audit branch-protection JSON via `gh api repos/:o/:r/branches/main/protection` against SSOT `.github/branch-protection.json`; diff = file gh issue.

**Acceptance criteria:** PR-only output, all gated by spec-verifier; touched files restricted to `.github/workflows/*.yml` + `.github/branch-protection.json`.

**Cost ceiling:** $0/run (no LLM call).

### Proposed: Sprint 2.6b — `secret_history_sweep` action_kind (S effort)

**Why now:** cortex-x has `no-pii.yml` (regex-only at HEAD) — does NOT cover rotated-but-leaked keys, encoded blobs, deep history. TruffleHog full-history with `--only-verified` catches these (800+ secret types).

**Cadence:** weekly (Sunday 02:00 UTC, before workflow_hardener).

**Operations** (deterministic, zero LLM cost):
- `trufflehog git file://. --only-verified --json --since-commit=<last-sweep-sha>`
- On verified hit: open `gh issue` with severity LABEL.
- **NO auto-PR** — secret revocation requires human (rotate key, then commit-history rewrite).

**Acceptance criteria:** read-only against working tree; only writes are journal entries + `gh issue create`; no edits to source files.

**Cost ceiling:** $0/run (no LLM call).

### Cheap extension: `tech_debt_audit` test_count delta

**Effort:** ~10 LoC, no new kind. Add `test_count` field to `cortex/debt-snapshot.json`; alarm if month-over-month delta < -5 %. Folds into existing Sprint 2.5 cron.

### Skipped (rationale)

| Candidate | Reason skipped |
|---|---|
| SBOM (CycloneDX/SPDX) | cortex-x ships no artifact; add to profile templates instead |
| License compliance / FOSSA | Dependabot + npm audit covers high-signal cases; PolyForm NC repo is low-impact |
| `.gitignore` drift | One-shot `git ls-files -i -c --exclude-standard` is 5-line lint; fold into `lint_fix_shipper` if signal appears |
| Dotfiles consistency | Greenfield concern; `cortex-doctor` already covers |
| README badge/link freshness | Low signal, high false-positive (rate-limited link checks) |
| CODEOWNERS sync | Personal framework, single maintainer; Tier 3 concern when team scales |
| Pre-commit hook drift | Steward doesn't enforce dev-machine config |
| Container image age | No images shipped |

---

## §4 — Sequencing into roadmap

Three new sprints proposed for Tier 1 (pre-public-launch tag):

| Sprint | Effort | Kind | Cost | Cadence | Why before launch |
|---|---|---|---|---|---|
| **2.5b** `workflow_hardener` | S | deterministic | $0 | weekly | Closes the supply-chain gap GitHub's own 2026 roadmap mandates; makes cortex-x a credible ship to security-conscious adopters |
| **2.6b** `secret_history_sweep` | S | deterministic | $0 | weekly | Pre-public flip MUST: any leaked verified credential in history would be public the moment repo flips. Worth its own sprint. |
| **2.11** `senior_tester_review` | M | hybrid LLM | ~$0.25/mo | monthly | Differentiates cortex-x in launch essay (no SaaS competitor in this niche); demonstrates "AI-augmented tester" positioning matches reality |

**Plus a separate "Sprint LR" track** (Launch Readiness) for operator-strategic items:
- LR.1: Real-run eval baseline (5 × 3 tasks, ~$0.05)
- LR.2: README "Built by" + competitor matrix (skeleton ship-able by me; personal bits = operator)
- LR.3: Statistical disclaimer in README (10 min)
- LR.4: `docs/launch-checklist.md`
- LR.5 (operator-only): naming decision
- LR.6 (operator-only): license decision
- LR.7 (operator-only): demo asset recording

### Proposed roadmap order

Operator-pending-decision (in order from most-actionable to least):

1. **First close `senior_tester_review` v1** (Sprint 2.11) — biggest differentiator, real research lane, zero competitive overlap. Bundle with Sprint 2.10 `/test-audit` retrofit prompt as "AI senior tester" positioning.
2. **Then `workflow_hardener` + `secret_history_sweep`** (2.5b + 2.6b) — security baseline before flipping repo public. Both small.
3. **Then Sprint 2.3b** — vitest migration → throwaway-clone baseline → Stryker integration. Unblocks `mutation_score_drift` end-to-end.
4. **Then Sprint 2.2.5 v1.5** — prompt-content injection for str_replace + insert ops. Re-enables rec #6/#7 dogfood.
5. **Then Sprint LR track** — launch-readiness gate.

OR operator can collapse 1-3 into "complete Tier 1 first, Sprint LR next" — both shapes are reasonable. The single-most important decision is **whether senior_tester_review jumps the queue**: if yes, it becomes the launch-essay headline; if no, Sprint 2.3b is the obvious next.

---

## §5 — Recommendation in one sentence

**Senior-tester is the differentiator** (open niche, real research lane, fits 2-stage hybrid pattern with our existing palette). **DevOps hygiene gaps are real but small** — slot in as 2.5b + 2.6b before public flip. **Brief is launch-readiness, not engineering** — separate Sprint LR track, never blocks Tier 1 momentum.

Operator's call: ship Sprint 2.11 (senior tester) first, OR finish 2.3b + v1.5 first. I'd ship 2.11 first because it's the credibility hook for everything else; runner+Stryker integration (2.3b) ships fine *after* the fitness signal it gates is named in a published differentiator.
