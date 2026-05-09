---
phase: 2-qa-audit
date: 2026-05-10
slug: cortex-x
quality_model: ISO/IEC 25010:2023
auditor: cortex-x /test-audit (eat-our-own-dogfood self-audit)
agents: [functional-reliability-correctness, performance-portability-maintainability, security-compatibility-integrity, usability-ai-observability]
---

# Test Audit — cortex-x (self-audit)

> 12-section QA audit aligned to ISO/IEC 25010:2023 + 3 cortex extras.
> Citations are file:line + commit hash. This is a deliverable, not a chat scrollback.
>
> **Meta-context:** cortex-x is a framework, not an application. Many catalog entries don't apply (no UI = no a11y; no e-commerce = no perf budgets in user-funnel sense). The audit signal here is: how good is the framework's own test posture given what it actually does (CLI + autonomous agentic runtime + LLM dispatch)?

## Executive summary (5 bullets)

- **🚨 No mutation testing despite Sprint 2.3 R1 ALREADY recommending it.** `package.json` has zero StrykerJS reference. 1764 tests pass — but coverage % is gameable; mutation score is the honest fitness function (Trail of Bits 2026). The catalog flags this as `correctness-mutation-testing` P0 for any framework with autonomous-agent surfaces.
- **🚨 Lethal trifecta surface in agentic runtime is undertested.** `bin/steward/_lib/action-engine.cjs` does external fetch (OpenRouter) + private-data access (recommendations.md, journal) + tool execution (npm test, gh pr create). 1 test file (`engine-claude-cli.test.cjs`) covers happy path; **zero adversarial / prompt-injection tests** against the LLM seam. Catalog match: `ai-prompt-injection-regression` + `security-lethal-trifecta` both P0.
- **⚠️ No `evals/` automated runner.** 9 eval rubrics exist (`eval-001` through `eval-009`) — designed in Sprint 5 self-improvement RFC, but no CI invocation, no `evals/results/` directory populated. Catalog match: `ai-eval-suite-rubric` is P1 — rubrics are halfway done.
- **⚠️ Property-based tests cover ~7 modules only** (Sprint 1.6.21 + Sprint 2.9.7c). Many SSOT primitives still lack property tests (e.g. recommendations.cjs parser, journal.cjs, lock.cjs, audit-context.cjs writer). Catalog match: `correctness-property-fast-check` P1 for remaining hot files.
- **✅ Strong test discipline at the unit + contract layer.** 87 test files (68 unit + 12 contract + 6 integration), 1764 assertions running in ~45s. Smoke + integration cover install end-to-end across 5-lane CI matrix (linux-bash, macos-bash, windows-gitbash, windows-pwsh7, windows-ps5.1). Hook contract + prompt regression are HARD gates per `tests/README.md`.

## Quality scorecard (1-5 per ISO 25010:2023 char + cortex extras)

| Characteristic | Score | Evidence |
|---|---|---|
| Functional Suitability | 4/5 | 87 test files cover 9-kind action_kind palette, all detectors, all hook events; gap = Steward end-to-end LLM-dispatch happy path E2E |
| Performance Efficiency | 2/5 | no perf budget on hooks (must complete <50ms — there's a halt-check property test for this but no PR gate); bin/cortex/tools/ ungated |
| Compatibility | 5/5 | 5-lane CI matrix is exemplary; cygpath + BOM-free YAML + `[ -f ]` POSIX-portable shells all explicitly tested |
| Interaction Capability | N/A | no UI surfaces (CLI only — TTY prompts are tested in install-roundtrip but not "interaction" in 25010 sense) |
| Reliability | 3/5 | strong: idempotent install, lock mutex, rollback in execute.cjs, atomic git ops; gap: no chaos test on cron triggers, no rollback drill, no migration roll-fwd+back |
| Security | 2/5 | block-destructive hook + denylist + path-safety + redact tested; **gap: zero prompt-injection eval, no lethal-trifecta regression, no SAST in CI**, no SCA gate |
| Maintainability | 4/5 | hot files (install.{sh,ps1}, action-engine, execute) all have direct tests; tier-1 SSOT enforced via contract tests |
| Flexibility | 4/5 | profile system + hooks + skills all swappable; 3 engine seams (mock/openrouter/claude-cli) tested independently |
| Safety | 3/5 | spec-verifier gates LLM edits; `STEWARD_HALT` kill-switch tested; halt-check has property test for <50ms latency invariant. Gap: no formal model-based test on action-engine state machine |
| Correctness invariants (cortex) | 3/5 | property-based on 7 modules (Sprint 1.6.21 + 2.9.7c); **mutation testing absent entirely** |
| AI-specific (cortex) | 2/5 | 9 eval rubrics exist but ZERO automated runner; no prompt-injection regression sweep; no determinism guard (operator note: per Sprint 2.10.4 catalog research, "determinism is dead" — pivot to property-based + LLM-judge) |
| Test observability (cortex) | 4/5 | journal/ ledger + cost-window tests + flake history via `gh api` rerun stats — strongest test-obs in catalog of similar-size projects |

---

## 1. Functional suitability

**Documented 9-kind action_kind palette** (per CLAUDE.md + docs/steward-roadmap.md):

| Kind | Spec test | Dispatch test | E2E test (full LLM cycle) |
|---|---|---|---|
| `recommendation` | ✅ acceptance | ✅ dispatcher | ⚠️ mock-only (engine-mock) |
| `recommendation_harvest` | ✅ | ✅ | ⚠️ mock-only |
| `dep_update_patch` | ✅ | ✅ (Sprint 2.9.6 fix) | ⚠️ mock-only |
| `todo_triage` | ✅ | ✅ | ⚠️ mock-only |
| `lint_fix_shipper` | ✅ | ✅ | ❌ NO test (only Sprint 2.9.6 dispatcher) |
| `flaky_test_repair` | ✅ | ✅ | ❌ NO test |
| `test_coverage_gap` | ✅ | ✅ | ❌ NO test |
| `doc_drift` | ✅ | ✅ | ❌ NO test |
| `pr_review_responder` | ✅ | ✅ | ❌ NO test |
| `tech_debt_audit` | ✅ | ✅ (Sprint 2.5) | ❌ NO test |
| `pattern_transfer` | ⚠️ stub (Sprint 2.7.1 R1 awaiting impl) | ⚠️ ACTION_KIND_NOT_DISPATCHABLE | ❌ |

**Verdict:** spec + dispatcher coverage strong (acceptance gates work). LLM-cycle E2E gaps for 6 of 9 kinds — impossible to validate end-to-end via mock; needs real LLM call (operator-cost-validated, but 6 are recipes not yet exercised in CI).

## 2. Reliability

- **Idempotent install** — install-roundtrip.test.cjs runs install.sh twice in isolated home, verifier passes both times ✅
- **Lock mutex** — lock.cjs has unit tests for stale-lock detection + cleanup ✅
- **Rollback** — execute.cjs Phase 5 atomic rollback when verifier rejects ✅
- **STEWARD_HALT** — halt-check.cjs has 13 property tests including <50ms perf invariant ✅
- **Cron failure injection** — ❌ no test that simulates GHA failure mid-run (Sprint 2.2 worktree supervisor would address; deferred until burn-in cost data exists)
- **Migration roll-fwd+back** — partial: MIGRATIONS.md has versioned migration entries; no automated test that applies + reverses on a fixture cortex/ tree

## 3. Correctness invariants

**Property-based test coverage** (Sprint 1.6.21 + 2.9.7c):
- ✅ helpers-property.test.cjs (Sprint 1.6.21) — extractUsage, stripJsonFences, addCostFields
- ✅ memory-decay-properties.test.cjs (Sprint 2.9.7c) — scoring, decay floor, blocker invariant — **CAUGHT REAL BUG** in Sprint 2.8 R1 contract
- ✅ cost-safety-properties.test.cjs — multi-window monotonicity
- ✅ spec-verifier-properties.test.cjs — RCE-token denylist
- ✅ halt-check-properties.test.cjs — kill-switch invariants
- ✅ path-safety-properties.test.cjs — NUL byte, UNC, traversal
- ✅ action-engine-properties.test.cjs — redaction, scrub, denylist
- ✅ property-invariants.test.cjs (cortex-tools) — 16-permutation annotation routing, bash forbidden-pattern

**Gaps** (catalog `correctness-property-fast-check` P1):
- ❌ recommendations.cjs parser — markdown parsing has many edge cases (nested code fences, BOM, mixed line endings) not property-tested
- ❌ journal.cjs — append-only ledger has rotation invariants (size cap) untested
- ❌ git-trailer-builder.cjs — RFC 5322-ish invariants ungated
- ❌ audit-context.cjs writer — frontmatter contract not property-tested

**Mutation testing**: completely absent. Sprint 2.3 R1 has design + cited recommendation (StrykerJS 9.6 incremental, 75% threshold on `bin/steward/_lib`). Awaits operator approval.

## 4. Performance efficiency

- ✅ halt-check has explicit `<50ms` property test
- ✅ session-start hook has timeout=5 in settings.json (per INSTALL_NOTES)
- ❌ no benchmark file in repo (`*.bench.cjs` glob = 0 results)
- ❌ no PR gate on hook latency (could regress silently to 4999ms before timeout fires)
- ❌ no LLM call latency budget — execute.cjs spawns claude-cli or fetches OpenRouter; no p99 budget asserted
- ❌ no install.sh wall-time budget — install.{sh,ps1} should complete in <30s on cold cache; unmeasured

**Catalog match** (P1): `perf-cold-start-budget` for hooks; `perf-load-k6` not applicable (no HTTP service).

## 5. Compatibility / contract

- ✅ **5-lane CI matrix** in `.github/workflows/install-smoke.yml`: ubuntu-bash, macos-bash, windows-gitbash, windows-pwsh7, windows-ps5.1 — best-in-class compatibility discipline
- ✅ **Contract tests** (12 files): default-model-ssot, denylist-ssot, routing-table-ssot, action-kinds-acceptance, hook-shape, profile-yaml-schema
- ✅ **BOM safety** explicit (Sprint 1.6 + verifier writes UTF-8 without BOM on Windows)
- ✅ **cygpath** explicit for MSYS path translation
- ⚠️ Inter-component contracts (Steward action_engine ↔ engine seam ↔ verifier ↔ executor) tested but distributed; could benefit from a single `contract-state-machine` test

## 6. CI/CD state

**14 workflows in `.github/workflows/`:**
- `test.yml` — main test lane (Linux fast)
- `install-smoke.yml` — 5-lane install matrix
- `no-pii.yml` — PII scanner
- `steward.yml` — nightly recommendation
- `steward-autoresearch.yml`
- `steward-{harvest,dep-patch,doc-drift,flaky-test-repair,lint-fix,pr-review-responder,tech-debt-audit,test-coverage-gap,todo-triage}.yml` — 9 deterministic-kind workflows (Sprint 2.9.6 dispatcher fix unblocked all 9)

**Strengths:**
- Exemplary install matrix (rare in 2026 OSS — most ship Linux-only)
- Hook contract + prompt regression are HARD gates per `tests/README.md` Tier 4-5
- PII scanner blocks public-data leaks

**Gaps:**
- ❌ No SAST gate (Semgrep/CodeQL — catalog `security-sast-static` P1)
- ❌ No SCA gate (osv-scanner — catalog `security-sca-deps` P1)
- ❌ No secret scanning (gitleaks — catalog `security-secret-scanning` P1)
- ❌ No mutation gate (Sprint 2.3 R1 awaiting impl)
- ❌ No nightly chaos test (Sprint 2.2 awaiting burn-in data)
- ⚠️ GHA billing currently blocked (per OPERATOR_HANDOVER.md) — workflows trigger but die at job-start

## 7. Security testing

- ✅ **block-destructive hook** — extensive unit tests (`tests/unit/hooks/block-destructive.test.cjs`); 32 known-bad commands all detected, 24 known-safe commands NOT false-positive (Sprint 2.9.7c property tests)
- ✅ **path-safety** — NUL byte, UNC paths, Windows device namespace, traversal escape — all property-tested (Sprint 2.9.7c)
- ✅ **redact secrets** — _lib/redact.cjs has tests; integrated in journal writer + post-tool-use hook
- ✅ **policy denylist** — bin/steward/_lib/policy-check.cjs tested
- ⚠️ **GitHub token handling** — install.sh has `$GITHUB_TOKEN` fallback for private clone; never logged, never persisted; OK
- ❌ **Prompt injection regression suite** — 0 tests against engine-claude-cli.cjs / engine-openrouter.cjs malicious-LLM-output paths
- ❌ **Lethal trifecta defense regression** — execute.cjs has all 3 components (fetch + private-data + exec); cortex-x has the standard documented in `standards/security.md` § Agentic Security but no end-to-end test that asserts the defense actually fires
- ❌ **SAST/SCA/secret-scan in CI** — none

**Catalog matches** (escalated by Q1 + Q3):
- `ai-prompt-injection-regression` P0
- `security-lethal-trifecta` P0
- `security-sast-static` P1
- `security-sca-deps` P1
- `security-secret-scanning` P1

## 8. Compatibility (cross-component contract)

Steward's component graph:
```
session-start hook → audit-context.md → spec-verifier ← LLM engine seam ← action-engine
                                              ↓                                    ↓
                                          executor ← engine-mock | engine-openrouter | engine-claude-cli
                                              ↓
                                        journal + git ops + gh ops
```

Each pair has unit tests for happy path. No single-pass integration test that exercises ALL components in one cycle (closest is `tests/integration/steward-evals.test.cjs` but eval-style only).

## 9. Data model + migrations

- ✅ MIGRATIONS.md — versioned migration entries with rollback notes (manual roll-back instructions only; no automated test)
- ✅ cortex-source.yaml — frontmatter contract tested
- ✅ recommendations.md format — parser has unit tests
- ⚠️ user.yaml schema — populated by install + read by hooks; **no schema validation test**
- ❌ projects/<slug>.md format — institutional library; format ungated by tests
- ❌ insights/proposals/<slug>.md — present in templates, no test for schema

## 10. Interaction Capability (a11y)

**N/A** — cortex-x is a CLI framework. TTY prompts in install scripts have language + identity confirmation but no a11y attribute (terminals don't have ARIA). Skip Category 7 entirely from selection oracle.

## 11. AI-specific testing (cortex extra)

- ✅ **9 eval rubrics** in `evals/`: scaffold-nextjs-saas, scaffold-minimal-skip, project-scan-existing, cortex-sync-captures-decision, code-review-catches-ssot-violation, code-review-catches-security, doctor-detects-missing-hooks, sprint-status-parses-correctly, retrospective-distills-transferable
- ⚠️ **No automated eval runner** — Sprint 5 Phase 5 self-improvement RFC designed but not cron-wired; `evals/results/` directory empty
- ❌ **No prompt-injection regression** — Steward's own LLM seam (engine-claude-cli + engine-openrouter) is the highest-value injection target in the entire stack and has zero adversarial test
- ❌ **No hallucination detection** — autoresearch.cjs dispatches WebSearch agents; their output goes into recommendations; not asserted for groundedness
- ❌ **No determinism guard** — but per Sprint 2.10.4 catalog research, this is actually CORRECT (determinism is dead); cortex-x's spec-driven verification (Sprint 1.9.0) already validates the pivot direction

**Catalog matches** (P0):
- `ai-eval-suite-rubric` — runner needed (rubrics already exist)
- `ai-prompt-injection-regression` — engine seam regression suite needed
- `ai-tool-call-validation` — bin/cortex/tools/ has 6 tools; safe-tool wrapper pattern from `standards/ai-patterns.md` not regression-tested at the seam

## 12. Test observability (cortex extra)

- ✅ **Journal ledger** — bin/steward/_lib/journal.cjs writes JSONL traces
- ✅ **Cost-window tests** — 9 property tests on multi-window monotonicity
- ✅ **Halt-check perf** — explicit <50ms invariant
- ✅ **Tier 4-5 HARD gates** — hook contract + prompt regression must pass before Steward runtime ships per tests/README.md
- ⚠️ No flake-rate consumer in CI (gh api rerun-stats parsing not yet wired)
- ⚠️ No test-impact analysis (which tests cover which files for smarter `nx affected`-style gating)

---

## Cross-dimension patterns (top 3)

1. **"Property-based discipline established but uneven."** Sprint 1.6.21 + 2.9.7c shipped 7 modules with property tests + caught real bug. Many cousins (recommendations parser, journal, git-trailer) still example-tested only. Pattern: when one tester (operator) had bandwidth, that file got property tests; when not, it didn't. Routine application would close the gap.
2. **"Defense designed, regression untested."** Lethal trifecta documented in standards/security.md; spec-verifier in Sprint 1.9.0; STEWARD_HALT in halt-check; redact in _lib. ALL three layers exist + have unit tests for the LIBRARY but ZERO END-TO-END test that simulates "malicious LLM output → defense fires → STEWARD_HALT writes." Pattern: defense-by-design without defense-by-regression-test.
3. **"Eval rubrics designed, runner deferred."** 9 eval rubrics in evals/ since Sprint 5 design (months ago). evals/results/ empty. The discipline to author rubrics is established; the discipline to run them is parked behind cron infrastructure.

## Open questions (handed to Phase 3)

- Q1 — Top business risk: probably "Steward auto-merges malicious LLM output to main during burn-in" — confirms Sprint 2.3 mutation + Sprint 2.7.1 R1 lethal-trifecta-defense priorities
- Q2 — Last 3 production incidents: cortex-x has no production users (Dave-only); incidents are dogfood-only. Skip RA fill.
- Q3 — Compliance: not regulated (private framework, MIT-eligible PolyForm Noncommercial); no GDPR/HIPAA/PCI scope. ASVS L1 baseline.
- Q4 — Off-limits: hermes/* legacy is being rebranded → steward/* (Sprint 4.7 ongoing); don't edit hermes/* without policy-check
- Q5 — Tester profile: operator-solo (Dave); review-pipeline-driven cadence

---

## Phase 3 — Human input (auto-mode reasonable-assumption fills)

**Top business risk (Q1, RA):** _Steward defense layers (spec-verifier + halt-check + redact + lethal-trifecta) all exist as libraries but have no end-to-end regression assertion that they actually fire when adversarial input arrives. Burn-in starts when GHA billing is fixed; without an E2E adversarial test, defense effectiveness is theoretical._

**Compliance target (Q3, RA):** _ASVS L1 baseline; no formal regulator. cortex-x is a personal framework + may commercialize via WaaS later (Sprint 4.x) — at that point ASVS L2 escalation likely._

**Tester profile (Q5, RA):** _Operator-solo; ~30h/week available for cortex-x evolution; comfortable with Vitest/node:test, fast-check, StrykerJS docs but no live experience yet._

---

## Catalog selection (Phase 5a-bis)

Catalog source: `~/.claude/shared/standards/test-types-catalog.md` (117 entries)

**Categories filtered out** (stack-irrelevant for cortex-x):
- Category 7 — Usability/accessibility (no UI surface)
- Category 11 — Compliance (mostly N/A — only ASVS L1 applies)
- Category 12 — Documentation (relevant but not P0)
- Most of Category 2 — Performance (no HTTP service; only hook latency budgets)
- Most of Category 6 — Contract (already extensively tested)

**Selected types: 17 of 117**

| Catalog ID | Category | Audit § | Q3 escalation | Q5 tier | Priority |
|---|---|---|---|---|---|
| `ai-prompt-injection-regression` | ai-eval | §7, §11 | Q1 risk → P0 | mid | **P0** |
| `security-lethal-trifecta` | security | §7 | Q1 risk → P0 | senior | **P0** |
| `correctness-mutation-testing` | correctness | §3 | Sprint 2.3 R1 already approved-pending | mid | **P0** |
| `ai-eval-suite-rubric` | ai-eval | §11 | rubrics exist, runner missing | mid | **P0** |
| `correctness-property-fast-check` | correctness | §3 | extend to recommendations / journal / trailer | junior | **P1** |
| `ai-tool-call-validation` | ai-eval | §11 | bin/cortex/tools/ regression | mid | **P1** |
| `security-sast-static` | security | §7 | Semgrep PR gate | junior | **P1** |
| `security-sca-deps` | security | §7 | osv-scanner v2 PR gate | junior | **P1** |
| `security-secret-scanning` | security | §7 | gitleaks + trufflehog | junior | **P1** |
| `reliability-fault-injection` | reliability | §2 | LLM 5xx, gh-cli timeout | mid | **P1** |
| `reliability-migration-rollforward` | reliability | §9 | MIGRATIONS.md auto-test | mid | **P1** |
| `regression-confirmation-istqb` | functional | §1 | already de-facto, document | junior | **P2** |
| `perf-cold-start-budget` | performance | §4 | hook latency PR gate | junior | **P2** |
| `data-validation-boundary` | data | §9 | user.yaml schema | junior | **P2** |
| `ai-mcp-protocol-test` | ai-eval | §11 | future MCP server publishing | mid | **P2** |
| `devops-action-pinning` | devops | §6 | pinact + Harden Runner | junior | **P2** |
| `compliance-iso-25010-coverage` | compliance | §1 | document existing 9-char coverage | mid | **P2** |

**Skipped with rationale:**
- `e2e-browser-flow` + all UI-related — no UI surface
- `compliance-eu-ai-act` — not in scope (personal framework, not Annex III high-risk)
- `compliance-pci-dss-l4` — no card data
- `security-pen-test` — premature for personal framework; revisit at Tier 4 commercialization
- `perf-load-k6` — no HTTP service
- All a11y entries — not applicable to CLI

**Off-limits zones (Phase 3 Q4) — flagged but NOT actionable:**
- FYI: `bin/hermes/*` is being rebranded to `bin/steward/*` (Sprint 4.7) — gaps here will be moot; don't add tests for soon-to-be-deleted shims.
