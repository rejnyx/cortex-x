---
title: cortex-x state audit — 2026-05-10
based_on: 6-hour autonomous session ending commit 5b49030 (Sprint 2.11 + 2.5b + 2.6b + 2.5c + LR + 2.2.5 v1.5)
mode: read-only
auditor: parallel-research subagent
---

# cortex-x state audit — 2026-05-10

## A. Cron schedule reality

Today is **Sunday 2026-05-10**. All cron expressions are UTC; operator is CEST (UTC+2).

| Workflow file | Cron expr | Next 3 fire times (UTC) | First-real-fire ETA |
|---|---|---|---|
| `steward.yml` | `0 4 * * *` | 05-11 04:00 / 05-12 04:00 / 05-13 04:00 | **2026-05-11 06:00 CEST** — picks rec #6 (JSDoc, str_replace v1 dogfood) |
| `steward-harvest.yml` | `0 3 * * *` | 05-11 03:00 / 05-12 03:00 / 05-13 03:00 | 2026-05-11 |
| `steward-autoresearch.yml` | `0 */4 * * *` | 05-10 12:00 / 05-10 16:00 / 05-10 20:00 | already firing |
| `steward-secret-history-sweep.yml` ⭐NEW | `0 2 * * 0` | 05-17 02:00 / 05-24 02:00 / 05-31 02:00 | **2026-05-17 04:00 CEST** — first real run; needs TruffleHog install |
| `steward-workflow-hardener.yml` ⭐NEW | `0 3 * * 0` | 05-17 03:00 / 05-24 03:00 / 05-31 03:00 | **2026-05-17 05:00 CEST** — will self-flag 40 mutable tags |
| `steward-dep-patch.yml` | `0 4 * * 0` | 05-17 04:00 / 05-24 04:00 / 05-31 04:00 | 2026-05-17 |
| `steward-doc-drift.yml` | `0 6 * * 1` | 05-11 06:00 / 05-18 06:00 / 05-25 06:00 | 2026-05-11 |
| `steward-flaky-test-repair.yml` | `0 7 * * 2` | 05-12 07:00 / 05-19 07:00 / 05-26 07:00 | 2026-05-12 |
| `steward-test-coverage-gap.yml` | `0 8 * * 3` | 05-13 08:00 / 05-20 08:00 / 05-27 08:00 | 2026-05-13 |
| `steward-lint-fix.yml` | `0 9 * * 4` | 05-14 09:00 / 05-21 09:00 / 05-28 09:00 | 2026-05-14 |
| `steward-senior-tester-review.yml` ⭐NEW | `0 4 1 * *` | **06-01 04:00** / 07-01 04:00 / 08-01 04:00 | **2026-06-01 06:00 CEST** — 22 days out |
| `steward-todo-triage.yml` | `0 4 1 * *` | 06-01 04:00 / 07-01 04:00 / 08-01 04:00 | 2026-06-01 |
| `steward-tech-debt-audit.yml` | `0 5 1 * *` | 06-01 05:00 / 07-01 05:00 / 08-01 05:00 | 2026-06-01 |
| `steward-pr-review-responder.yml` | (none — workflow_dispatch only) | — | on-demand |

**SHA-pinning audit:** ~46 `uses:` lines across 17 workflow files; **only 6 are SHA-pinned** (3 in `steward-workflow-hardener.yml` lines 30/33/76, 3 in `steward-secret-history-sweep.yml` lines 34/39/87). **40 mutable `@v5` / `@v4` tags remain** — workflow_hardener will surface every one as a HIGH finding on its first cron run 2026-05-17. This is intentional dogfood per session summary, but it produces a noisy first issue (~40 entries) that operator must triage manually.

## B. Production-validation gaps

| Action_kind | Tested? | Prod-validated? | First-fire ETA | External deps |
|---|---|---|---|---|
| `recommendation` | ✅ unit+contract+integration | ✅ run 25557000551 (PR #5) + 25584616397 + da172fa | 2026-05-11 | OPENROUTER_API_KEY |
| `recommendation_harvest` | ✅ | ✅ multi nightly runs | 2026-05-11 | gh CLI |
| `dep_update_patch` | ✅ | ⚠️ deterministic, no real cron run logged | 2026-05-17 | npm registry |
| `flaky_test_repair` | ✅ | ❌ on-demand only, never fired | on-demand | — |
| `doc_drift` | ✅ | ⚠️ no cron run yet (1st = 05-11) | 2026-05-11 | gh CLI |
| `todo_triage` | ✅ | ⚠️ no real run (next = 06-01) | 2026-06-01 | gh CLI |
| `test_coverage_gap` | ✅ | ❌ never fired | 2026-05-13 | gh CLI |
| `lint_fix_shipper` | ✅ | ❌ never fired | 2026-05-14 | eslint |
| `pr_review_responder` | ✅ | ❌ never fired | on-demand | gh CLI |
| `tech_debt_audit` | ✅ | ⚠️ never real cron | 2026-06-01 | gh CLI |
| `pattern_transfer` | ✅ | ❌ never fired (no cron) | manifest | OPENROUTER |
| `senior_tester_review` ⭐ | ✅ +54 tests | ❌ **first fire 22 days out** | **2026-06-01** | gh CLI; opt-in OPENROUTER |
| `workflow_hardener` ⭐ | ✅ +24 tests | ❌ **first fire 7 days out** | **2026-05-17** | gh CLI |
| `secret_history_sweep` ⭐ | ✅ +22 tests | ❌ **first fire 7 days out** | **2026-05-17** | **TruffleHog binary** (installed at workflow runtime; fail-open if install fails) |

**Honest read:** of 14 shipped action_kinds, only 2 (`recommendation`, `recommendation_harvest`) have real OpenRouter cron evidence. The other 12 are unit-tested but never actually fired in production. Sprint 2.2.5 v1.5's promised v1-ops dogfood (rec #6 JSDoc str_replace) lands tomorrow morning — that is the **single load-bearing prod fire** before any external eyes see the repo.

## C. Deferred debt list

| Item | File:line evidence | Effort | Suggested sprint |
|---|---|---|---|
| **SSOT M1** OPENROUTER_ENDPOINT dup | `bin/steward/_lib/action-engine.cjs:36` + `bin/steward/_lib/senior-tester-action.cjs:33` (literal `'https://openrouter.ai/api/v1/chat/completions'` twice) | S | 2.11.1 |
| **SSOT M1** DEFAULT_MODEL dup | `action-engine.cjs:41` (`'deepseek/deepseek-v4-flash'`) re-imported but senior-tester reads its own env path; routing-table.cjs:7 comments confirm pre-2.0b duplication still present | S | 2.11.1 |
| **SSOT m1** NO_WORKING_TREE_EDITS_CRITERION dup | `action-kinds.cjs:279,305,335,390,576,610,655` — same `id: 'no_working_tree_edits'` literal copy-pasted 7 times across kinds (with 3 `_no_working_tree_edits` suffix variants) | S | 2.11.1 |
| **SSOT M2** redactSecrets dup | `bin/steward/_lib/action-engine.cjs:1218` + `bin/steward/_lib/senior-tester-action.cjs:138` — different bodies; senior-tester version missing the OAuth `sk-ant-oat##` shape covered in action-engine | S-M | 2.11.1 — extract to `safety.cjs` |
| **Correctness H2** LLM judge schema validation presence-only | `senior-tester-action.cjs` (Phase B JSON parse — no Zod-style deep type check; only key presence) | M | 2.11.2 |
| **Correctness H3** senior_tester_review eval suite | nonexistent: no `evals/senior-tester/` dir; R1 memo promised 5 fixture repos | M-L | 2.11.2 — pre-ship gate slipped |
| **Edge-case** extractTestBlocks string/comment skip | `bin/steward/_lib/test-smell-detector.cjs:269-330` — brace state machine ignores `'`, `"`, `` ` ``, `//`, `/* */` → false positives in tests with literals containing braces | M (AST migration) | 2.11.3 |
| **workflow_hardener v1.5** auto-fix via PR | `action-kinds.cjs:565` (`workflow_hardener` advisory-only); engine HARD_DENYLIST entry blocks `.github/workflows/**` | M | 2.5b.1 |
| **secret_history_sweep v1.5** per-finding gh issue + rotation template | currently single bundled issue per cron; no `templates/secret-rotation.md` exists | S-M | 2.6b.1 |

**Cross-kind concern:** `dataHome` falls back to `repoRoot/cortex/` per session summary — creates working-tree pollution if `CORTEX_DATA_HOME` not set. Affects all 14 kinds; not a single-file fix.

## D. Launch-readiness — operator-only vs engineering-doable

**Operator-only (cannot delegate to Steward):**
- P0 Naming decision (cortex-x brand kolize with Cortex Labs / Cortex.dev / Snowflake Cortex)
- P0 License decision (PolyForm Noncommercial blocks operator's own client work)
- P0 D-1 git history PII purge (destructive force-push)
- P0 README "Built by" — first-person voice
- P1 Demo asciinema cast (operator-narrated)
- P1 2-week dogfood log + operator testimonial
- P2 HN / LinkedIn / Reddit launch posts

**Engineering-doable (can be Sprint LR.X work):**
- P0 README opening line rewrite (concrete benefit + proof + diff)
- P0 Status banner near top
- P0 GitHub repo description + topics
- P0 "Why not Devin/Copilot" comparison table (data exists in `docs/positioning-vs-ralph.md`)
- P1 LR.1 real-run eval baseline ($0.05 cost, 5×3 evals)
- P1 LR.1.1 Aider-Polyglot lift (15→30 step limit)
- P1 cross-model transfer protocol doc
- P1 `docs/positioning.md` full landscape table
- P2 `CONTRIBUTING.md` good-first-issue labels (3-5 entries)

## E. Test coverage health

`tests/` layout (test files, `*.test.cjs`):
- **unit:** 81 files
- **contract:** 12 files
- **integration:** 7 files
- **fixtures:** 1 (helper)
- **Total:** 101 test files. Session summary claims **1986 test cases**. `package.json:15` `npm test` is `node --test --test-reporter=spec`.

`.skip` / `.todo` / `xit` markers — silent gaps + intentional regression fixtures:
- `tests/unit/steward/test-smell-detector.test.cjs:57-58` — `test.skip('broken', …)` + `xit('also broken', …)` — **fixture for the smell detector itself** (it's testing that the detector flags these). Safe.
- `tests/unit/steward/senior-tester-action.test.cjs:71` — `test.skip('skipped without rationale', …)` — **fixture**. Safe.
- `tests/integration/senior-tester-review-pipeline.test.cjs:121` — `test.skip('todo broken', …)` — **fixture**. Safe.
- No production-skipped tests detected (i.e. nothing of form "skipped because broken — fix later"). Clean.

## F. R6 backward-compat reality

`bin/steward/_lib/action-kinds.cjs` registry contains all **16 kinds** at the listed line offsets:
- 11 prior shipped (lines 157, 183, 213, 243, 265, 294, 324, 350, 379, 468, 513) — all retain prior `acceptance_criteria[]` shape unchanged.
- 3 new shipped (565, 599, 643).
- 2 future stubs `mutation_score_drift` (422) + `release_notes_drafter` (671) with `shipped_in: null` per design.

The shape contract (`description`, `requires_llm`, `source`, `detector`, `cost_envelope`, `blast_radius`, `shipped_in`, `acceptance_criteria`) is consistent across all 16. R6 holds: prior 11 kinds work unchanged.

## Synthesis: top 5 risks before next autonomous mandate

1. **Single load-bearing cron tomorrow (rec #6).** If the 2026-05-11 04:00 UTC nightly fails on the JSDoc str_replace, *every* claim about "v1 ops graduate from designed to exercised" collapses, and the launch-readiness narrative loses its concrete evidence. **Mitigation:** before 22:00 CEST tonight, manually `gh workflow run steward.yml` once and confirm the run lands a green draft PR. If it fails, that is a real bug, not flaky cron — fix before autonomous mandate.
2. **40 mutable workflow tags.** workflow_hardener's first cron 2026-05-17 will produce an issue with ~40 finding entries. Nine of those existed before this session (ack'd in session summary), but operator must commit to either fixing them or accepting the chronic noise. **Mitigation:** spend 30 min before 2026-05-17 doing a one-shot SHA-pin sweep on the 40 lines — turn the first cron into a clean signal instead of a wall of self-flagging.
3. **Sprint 2.6b TruffleHog never installed.** The workflow installs trufflehog at runtime via `curl … | sh`. If GitHub blocks that script (rate limit, network, supply chain), the workflow fails-open silently and operator believes secret sweep ran. **Mitigation:** before 2026-05-17, `gh workflow run steward-secret-history-sweep.yml` manually and verify the journal artifact contains `trufflehog --version` output, not just `install failed; fail-open`.
4. **senior_tester_review eval suite never built (Correctness H3).** R1 memo specified 5 fixture repos with known-bad test suites + expected findings as a *pre-ship gate*. Sprint 2.11 shipped without it. The 39-smell registry is therefore an unvalidated heuristic — false-positive rate is unknown. First cron 2026-06-01 will produce a gh issue whose accuracy we cannot quantify. **Mitigation:** before 2026-06-01, build the 5 fixtures (M-L effort, ~1 day) so the issue's findings can be cross-checked. Otherwise the differentiator pitch ("AI-augmented tester") rests on no evidence.
5. **redactSecrets divergence** (`senior-tester-action.cjs:138` lacks the OAuth `sk-ant-oat##` shape covered in `action-engine.cjs:1218`). On the senior-tester monthly cron, if a Sprint 2.4-style OAuth artifact ends up in test code excerpts forwarded to the LLM judge, it leaks. **Mitigation:** SSOT M2 fix (extract to `safety.cjs`) is S-effort and on the 2.11.1 backlog — bump to "before next autonomous mandate" priority, not "next sprint."

**Net read:** the 6-hour session shipped impressive volume, but production validation lags badly behind unit testing — 12 of 14 kinds have never actually fired against OpenRouter. The 24h ahead (rec #6 nightly) is the single most informative signal cortex-x has had in two weeks. If it lands clean, the launch-readiness narrative gains real evidence. If it fails, debt items #4 and #5 become urgent rather than deferred.
