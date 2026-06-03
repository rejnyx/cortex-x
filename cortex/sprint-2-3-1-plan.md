---
sprint: 2.3.1
name: Sprint 2.3.1 — Mutation score criterion kind + ratchet activation
date: 2026-06-03
status: in-progress
owner: cortex-x maintainers
arc: Arc 1 (Verification & verdict hardening) — Sprint 3 of 3 (FINAL)
discovery_source: docs/steward-roadmap.md § Sprint 2.3 (measure-only baseline shipped 2026-05-14) + standards/mutation-testing.md + Sprint 2.3.1 backlog item from Sprint 2.3 v0 closing notes
generated_by: cortex-sprint
untrusted_fencing: not-required
fencing_rationale: Auto Mode discovery from docs/steward-roadmap.md + cortex/sprint-2-3 historical artifacts. No operator paste.
---

# Sprint 2.3.1 — Mutation score criterion kind + ratchet activation

> **Operator brief (Arc 1 final sprint):** Sprint 2.3 v0 shipped Stryker measure-only baseline 2026-05-14 with 2-week baseline window. Window closed 2026-05-28. Sprint 2.3.1 promotes mutation score to a Steward spec-verifier criterion kind (the 7th alongside shell / file_predicate / regex / ears_text / llm_judge / read_set) and activates the ratchet so per-action_kind mutation score is enforced going forward.

## Goal

Promote `mutation_score` from advisory baseline to enforced acceptance-criterion kind. Add 7th criterion kind to spec-verifier.cjs (shell/file_predicate/regex/ears_text/llm_judge/read_set + **mutation_score**). Wire ratchet: per-`action_kind` minimum mutation score declared in `action-kinds.cjs` registry; spec-verifier reads current Stryker JSON output (already shipped Sprint 2.3 v0 via .github/workflows/stryker-measure.yml) and rejects edits that lower the score below the declared minimum. Add `STRYKER_RATCHET_MIN_PERCENTAGE` env override for emergency raises.

## Deliverables (10)

1. **`bin/steward/_lib/spec-verifier.cjs` v2 — 7th criterion kind `mutation_score`**:
   - Accepts criterion shape: `{ kind: 'mutation_score', min_percentage: 60, target_files: [...], stryker_output_path: 'reports/mutation/mutation.json' }`
   - Reads Stryker JSON report from path (default `reports/mutation/mutation.json`)
   - Filters mutants to target_files paths (if provided)
   - Computes score = killed / (killed + survived + timeout) × 100
   - PASS if score ≥ min_percentage, FAIL otherwise
   - Fail-OPEN if Stryker report missing (advisory mode for CI lanes without Stryker)
2. **`bin/steward/_lib/action-kinds.cjs` — per-action_kind mutation_score criteria**:
   - Add to existing 18 action_kinds where applicable: `recommendation` (60% min), `dep_update_patch` (50%), `flaky_test_repair` (70%), `lint_fix_shipper` (55%), etc.
   - Action kinds without code mutation (recommendation_harvest, doc_drift) get NO mutation_score criterion
3. **`bin/steward/_lib/spec-verifier.cjs` — new error codes**:
   - `SPEC_MUTATION_SCORE_BELOW_MIN` (verdict reason)
   - `SPEC_MUTATION_REPORT_MISSING` (advisory)
   - `SPEC_MUTATION_REPORT_MALFORMED` (advisory)
4. **`tests/unit/steward/spec-verifier-mutation.test.cjs`** — NEW ≥12 tests:
   - mutation_score criterion PASS when score ≥ min
   - FAIL when score < min with explicit reason
   - target_files filter applied correctly
   - Missing report → advisory (no FAIL, log warning)
   - Malformed report → advisory
   - Score computation formula correctness (edge cases: 0 mutants, all killed, all survived)
   - STRYKER_RATCHET_MIN_PERCENTAGE env override
   - Determinism (same report → same verdict)
5. **`standards/mutation-testing.md`** — extend with § Ratchet activation
   - Document the 7th criterion kind contract
   - Per-action_kind minimum table
   - Emergency raise procedure (env override)
   - Baseline period (Sprint 2.3 v0 → Sprint 2.3.1) honored — no retroactive enforcement on pre-existing low scores
6. **`docs/steward-roadmap.md` Sprint 2.3 status update**:
   - Mark Sprint 2.3.1 ✅ SHIPPED (ratchet active)
   - Update Tier 1 status table
7. **`shared/skills/cortex-sprint/SKILL.md`** — mention mutation_score available in spec-verifier (composition section)
8. **`cortex/sprint-2-3-1-plan.md`** — this file
9. **`cortex/sprint-2-3-1-r2-summary.md`** — written after R2
10. **doc-regen --apply** before commit

## Acceptance criteria (12)

- **AC-1** `file_predicate` — `cortex/sprint-2-3-1-plan.md` exists with 8 required sections.
- **AC-2** `regex` — `bin/steward/_lib/spec-verifier.cjs` contains case for `kind === 'mutation_score'`.
- **AC-3** `regex` — `bin/steward/_lib/spec-verifier.cjs` reads Stryker JSON output (regex matches `reports/mutation` or similar).
- **AC-4** `regex` — `bin/steward/_lib/spec-verifier.cjs` exports new error codes: `SPEC_MUTATION_SCORE_BELOW_MIN`, `SPEC_MUTATION_REPORT_MISSING`, `SPEC_MUTATION_REPORT_MALFORMED`.
- **AC-5** `regex` — `bin/steward/_lib/action-kinds.cjs` contains `mutation_score` criterion in at least 4 action_kinds.
- **AC-6** `file_predicate` — `standards/mutation-testing.md` contains heading "Ratchet activation".
- **AC-7** `regex` — `standards/mutation-testing.md` documents `STRYKER_RATCHET_MIN_PERCENTAGE` env override.
- **AC-8** `shell` — `node --test tests/unit/steward/spec-verifier-mutation.test.cjs` passes with ≥12 tests.
- **AC-9** `shell` — `npm test` exits 0 (baseline 3402 → expect ≥3420).
- **AC-10** `shell` — `node bin/cortex-doc-regen.cjs --check` exits 0 after `--apply`.
- **AC-11** `regex` — `docs/steward-roadmap.md` reflects Sprint 2.3.1 ✅ shipped status.
- **AC-12** `file_predicate` — `cortex/sprint-2-3-1-r2-summary.md` exists with HIGH/MEDIUM disposition.

## Workflow phases

| Phase | Scope | Output |
|---|---|---|
| **Research** | 3 parallel R1: (a) Stryker JSON report schema 2026 + score computation conventions, (b) mutation-score ratcheting patterns in OSS (Cosmic Ray Python, Pitest Java, Mutmut), (c) per-module mutation_score thresholds (recommendation engines, dependency updates, lint fixes — what score is realistic) | Inline → Synthesize |
| **Synthesize** | 1 agent merges research → concrete impl spec for spec-verifier criterion kind + per-action_kind threshold table | Inline spec |
| **Implement** | 4 parallel impl: (1) spec-verifier mutation_score criterion + tests, (2) action-kinds.cjs per-kind criteria additions, (3) standards/mutation-testing.md ratchet section, (4) roadmap status update + SKILL.md mention | Edits to repo |
| **Review** | 6 R2 reviewers in parallel | Per-agent JSON findings |
| **Confidence** | Pass-2 skeptic + dedupe | Final triaged list |

## Risks (7)

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Stryker JSON schema drift between versions — score formula or fields change | Defensive parse — check schema version, fail-OPEN with advisory on unknown shape |
| R-2 | Per-action_kind thresholds too aggressive — Steward auto-PR loops blocked | Conservative starting values (50-70%); operator override via env; document raise procedure |
| R-3 | Stryker not installed on operator machine — verifier crashes | Fail-OPEN: missing report → advisory only, never blocks Steward action |
| R-4 | Mutation score retroactive enforcement breaks existing low-score modules | Baseline period (Sprint 2.3 v0 → 2.3.1) honored — module-specific allowlist for pre-existing low scores documented in standards |
| R-5 | Long-running Stryker (10+ min on large modules) → CI timeout | Already addressed in Sprint 2.3 — `stryker --incremental` flag in cron workflow; criterion reads existing report, doesn't re-run |
| R-6 | False-positive low score on flaky tests | Stryker timeout-mutants treated as "uncovered" not "survived" by formula; advisory warning in r2-summary |
| R-7 | Operator can't tell why action_kind rejected — needs clear error message | Error includes per-action_kind threshold, actual score, mutants surviving (top 3 by file) |

## Out of scope

- New Stryker integration (workflow already shipped Sprint 2.3)
- Per-test-file mutation thresholds (only per-action_kind in v0)
- Cross-language mutation testing (JavaScript/TypeScript via Stryker only)
- Mutation score in steward-status CLI output (defer to 2.3.2 if useful)
- Historical mutation score trending / graphs

## References

- `docs/steward-roadmap.md § Sprint 2.3` — origin (measure-only baseline shipped 2026-05-14)
- `standards/mutation-testing.md` — existing standard from Sprint 2.3 v0
- `bin/steward/_lib/spec-verifier.cjs` — current 6 criterion kinds (shell/file_predicate/regex/ears_text/llm_judge/read_set)
- `bin/steward/_lib/action-kinds.cjs` — 18 action kinds registry
- `.github/workflows/stryker-measure.yml` — Sprint 2.3 v0 cron baseline workflow
- `reports/mutation/mutation.json` — Stryker output consumed by criterion

## Triage policy

Mirror Sprint 2.46 / 2.46.1 / 2.46.2 r2-summary disposition convention. HIGH apply in-commit, MEDIUM if surgical, Architectural defer to 2.3.1.1.

---

*Plan finalized 2026-06-03 by /cortex-sprint pipeline (Arc 1 sprint 3 of 3 — FINAL, Skill registry unknown → SKILL.md verbatim per memory).*
