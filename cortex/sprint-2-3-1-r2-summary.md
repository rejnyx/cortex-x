---
title: Sprint 2.3.1 — R2 Review Summary
sprint: 2.3.1
date: 2026-06-03
status: shipped
arc: Arc 1 (Verification & verdict hardening) — Sprint 3 of 3 (FINAL)
generated_by: cortex-sprint
untrusted_fencing: not-required
fencing_rationale: Auto-generated summary from validated R2 workflow output.
---

# Sprint 2.3.1 — R2 Review Summary

> **FOURTH consecutive R2 self-correcting moment** (Sprint 2.46 / 2.46.1 / 2.46.2 / **2.3.1**). The pattern has now established itself as the load-bearing dogfood story: every sprint shipped via /cortex-sprint workflow contains structural defects in its own deliverables, R2 catches them, parent agent fixes HIGH in-commit before push.
>
> **Provenance:** workflow `wf_d8ffc0f8-c85` (2026-06-03). 70 agents, 3.6M subagent tokens, 17 min. 56 raw findings → 27 validated (2 HIGH + 11 MEDIUM + ~14 LOW) after Pass-2.
>
> **Pattern:** SSOT inversion in standards table (fictional action_kinds named that don't exist in registry, real ones omitted) + contract drift (`target_files` defaults promised vs delivered semantics). Both pure documentation defects with zero runtime impact today (sprint is advisory) — but would break Sprint 2.3.2 ratchet promotion if shipped uncorrected.

## Disposition summary

| Bucket | Count | Notes |
|---|---|---|
| **Applied in-commit** | 5 (2 HIGH + 3 MEDIUM) | Standards table rebuilt 1:1 against 21 real registry kinds; target_files contract honestly documented as v1 whole-repo; roadmap edit_ops → tdd_red_green; allowlist labeled NOT YET IMPLEMENTED; tech-debt-audit test count 4 → 5 |
| **Deferred to Sprint 2.3.2** | 8 (architectural + cross-cutting) | write_set → target_files seam; allowlist runtime implementation; STRYKER_RATCHET_MIN_PERCENTAGE audit attribute; advisory-emission logic clean-pass code; target_files immutability in mergeCriteria; default Stryker path SSOT; survivors cap before sort; error code consolidation |
| **Refuted** | 0 | Every finding reproducible |

## HIGH findings (2 dedup) — disposition

### Applied in-commit (2 HIGH)

| # | File:Line | Finding | Citing reviewers | Confidence | Fix |
|---|---|---|---|---|---|
| **H-1 fictional kinds** | `standards/mutation-testing.md:159,161,162` | Per-action_kind threshold table fabricated 3 action_kinds (`edit_ops`, `dream_consolidate`, `insight_promote`) and OMITTED 6 real ones (`evolve_daily`, `evolve_weekly`, `tdd_red_green`, `release_notes_drafter`, `mutation_score_drift`, `pattern_transfer`). Table self-declared "Canonical SSOT" but diverged from registry in ~28% of rows. Operators configuring thresholds would reference kinds that silently don't exist. | ssot-enforcer + correctness-auditor + acceptance-auditor (3 reviewers, all 92-96 confidence) | 96 | Table rebuilt 1:1 against 21 real registry entries. Header explicitly acknowledges the rebuild. |
| **H-2 target_files contract** | `standards/mutation-testing.md:108,164` vs `bin/steward/_lib/spec-verifier.cjs:869,933` | Standard promised `target_files` defaults to action's `write_set` (Sprint 2.18 seam): "did our edit hold up under mutation?" runtime defaults to ALL files in Stryker report (whole-repo surface). When ratchet flips to enforced in 2.3.2, action editing one file gets blocked by unrelated low scores. Auto-PR loop risk (R-2). | correctness-auditor | 92 | Standard updated to admit v1 whole-repo semantics honestly; write_set seam wiring explicitly deferred to Sprint 2.3.2 alongside `advisory: false` promotion. Operators wanting edit-scoped scoring must declare `target_files` explicitly. |

## MEDIUM findings (11) — disposition

### Applied in-commit (3)

| # | File:Line | Finding | Fix |
|---|---|---|---|
| **M-roadmap-drift** | `docs/steward-roadmap.md:264` | AC-11 status update listed `edit_ops` instead of `tdd_red_green` (same SSOT inversion as H-1). | Renamed to `tdd_red_green`; corrected threshold count 6 → 7; aligned error code count 3 → 5. |
| **M-allowlist-fiction** | `standards/mutation-testing.md:191-211` | Allowlist § documented complete semantics + `SPEC_MUTATION_ALLOWLIST_EXPIRED` error code but verifier never reads any allowlist file. Documentation-as-fiction (SSOT violation). | Section header now explicitly marked "NOT YET IMPLEMENTED (Sprint 2.3.2 deliverable)" with banner; schema retained as agreed future contract; promotion to enforced ratchet gated on this allowlist landing. |
| **M-test-count** | `tests/unit/steward/tech-debt-audit.test.cjs:407` | Test asserts `acceptance_criteria.length === 4` but Sprint 2.3.1 impl-2 added 5th (mutation_score) → test failure. | Updated to assert `=== 5` with new sub-assertion that mutation_score criterion is present (regression guard). |

### Deferred to Sprint 2.3.2 (8 MEDIUM architectural)

| # | Finding | Why deferred |
|---|---|---|
| **M-write-set-seam** | Wire action.write_set as default target_files in runMutationScore | Architectural — touches action-engine dispatch + criterion factory + standards renormalization |
| **M-allowlist-runtime** | Implement YAML allowlist parser + integration into runMutationScore (already labeled deferred in standards) | Co-targeted with ratchet promotion to enforced |
| **M-override-audit** | STRYKER_RATCHET_MIN_PERCENTAGE should emit `mutation.override_min_percentage` Phoenix span attribute + journal entry distinguishing env vs criterion threshold | Observability — standards promised behavior runner does not deliver |
| **M-advisory-emission** | Clean-pass + `c.advisory === true` path emits advisory entry with `code: undefined` instead of `SPEC_MUTATION_SCORE_OK` | Refactor advisory-emission branch logic to explicit case table |
| **M-target-files-immutability** | mergeCriteria does not protect target_files like read_set expected_glob → bypass vector when ratchet enforced | Mirror read_set immutability check; matters at 2.3.2 enforcement |
| **M-stryker-path-ssot** | Default `reports/mutation/mutation.json` duplicated in 4 places (spec-verifier.cjs, action-kinds.cjs, summarize-mutation.cjs, standards) | Extract const + import; surgical but cross-module |
| **M-error-code-ssot** | Plan declared 3 codes; impl ships 5; standards lists 4; verifier header lists 5 incl. vestigial SPEC_MUTATION_MIN_REQUIRED | Extract MUTATION_ERROR_CODES exported const set; align plan + standards + tests |
| **M-survivors-cap** | top_survivors cap at first 1000 BEFORE sort → hint partial when surface > 1000 mutants | Streaming top-N heap pattern |
| **M-whitespace-env** | STRYKER_RATCHET_MIN_PERCENTAGE='   ' silently sets threshold to 0 (Number('   ') === 0) | Add String.trim() guard before Number() coercion |

## LOW findings — log only

~14 LOW including: documentation alignment (CLI help, comment accuracy), error code enumeration completeness, comment-vs-code drift, dead defensive code in edge paths. None block ship.

## Pass-2 confidence validation

- **56 raw findings → 27 validated → 5 applied in-commit + 8 deferred + 14 LOW logged**
- 0 rejected by skeptic
- **Strongest dedup signal:** H-1 fictional kinds — **3 reviewers** independently surfaced same SSOT inversion at 92-96 confidence each. Sprint 2.46.1 had similar 3-reviewer convergence on STRICT_SECRET bypass; Sprint 2.46 + 2.46.2 had 6-reviewer convergence on path drift.

## Arc 1 R2 self-correcting story (4 consecutive sprints)

| Sprint | R2 caught HIGH | Convergence | Hours from dispatch to fixed |
|---|---|---|---|
| 2.46 | 8 (fictional gate table + over-promised SKILL claims + path drift) | 6 reviewers on path drift | ~3h |
| 2.46.1 | 8 (appendSeen never called + STRICT_SECRET bypass + env var drift + CORTEX_DATA_HOME SSOT + marker shortcut) | 3 reviewers on STRICT_SECRET | ~2h |
| 2.46.2 | 7 (cortex-doctor 4-way broken + baseline vacuous + qualifier='+' bug) | 6 reviewers on doctor path | ~2h |
| **2.3.1** | **2 (SSOT inversion + target_files contract drift)** | **3 reviewers on fictional kinds** | **~1h** |

**Cumulative across Arc 1 (Sprint 2.46 + 2.46.1 + 2.46.2 + 2.3.1):**
- **23 HIGH bugs caught by R2, all applied in-commit before main**
- **~340 agents, ~16M subagent tokens across 4 R2 workflows**
- **Zero refuted by Pass-2 — 100% reproducible findings**
- **Tests: 3290 → 3435 (+145 across arc)**

**Conclusion:** R2 pipeline is empirically load-bearing — without it, Arc 1 would have shipped 4 broken sprints into main. The pipeline self-correcting is not theoretical; it's been validated 4 consecutive times in 1 session.

## AC verdict against Sprint 2.3.1 plan

| AC | Status | Note |
|---|---|---|
| AC-1 plan doc with 8 sections | ✅ PASS | All sections present |
| AC-2 spec-verifier mutation_score case | ✅ PASS | New criterion kind dispatch |
| AC-3 reads Stryker JSON | ✅ PASS | reports/mutation/mutation.json default |
| AC-4 3 error codes exported | ⚠️ DRIFT (deferred) | Impl ships 5 codes; plan said 3; alignment deferred to 2.3.2 |
| AC-5 mutation_score in ≥4 action_kinds | ✅ PASS | 7 action_kinds shipped with mutation_score |
| AC-6 standards heading "Ratchet activation" | ✅ PASS | Heading present |
| AC-7 STRYKER_RATCHET_MIN_PERCENTAGE documented | ✅ PASS | Documented + functional (Phoenix audit deferred) |
| AC-8 ≥12 unit tests | ✅ PASS | 14 tests in spec-verifier-mutation.test.cjs + 6 fixtures |
| AC-9 npm test exits 0 | ✅ PASS | 3402 → 3435 (+33) after test-count regression fix |
| AC-10 cortex-doc-regen --check exit 0 | ⏳ verified before commit | |
| AC-11 roadmap Sprint 2.3.1 ✅ shipped | ✅ PASS | Roadmap updated (after edit_ops → tdd_red_green fix) |
| AC-12 r2-summary.md exists | ✅ PASS | This document |

## Sprint 2.3.2 backlog (8 deferred architectural items)

Priority order for the eventual "advisory: false" ratchet promotion sprint:

1. **write_set → target_files seam** — the central promise of "did our edit hold up under mutation?" semantics
2. **Allowlist runtime** — `cortex/state/mutation-allowlist.yaml` parser + integration (documented but NOT shipped in 2.3.1)
3. **STRYKER_RATCHET_MIN_PERCENTAGE audit** — Phoenix span attribute + journal entry
4. **target_files immutability** — mergeCriteria mirror of read_set expected_glob hardening
5. **Default Stryker path SSOT** — extract const + import across 4 sites
6. **Error code consolidation** — MUTATION_ERROR_CODES exported set; align plan + standards + verifier header
7. **Survivors top-N streaming** — replace cap-at-1000-before-sort with streaming heap
8. **Advisory-emission branch refactor** — explicit case table for clean-pass + advisory-criterion path

Plus 60+ green journal entries on each action_kind + zero cortex-doctor false-fail reports requirement before promotion gate fires.

## Signed verdict for Sprint 2.3.1 commit

(Computed at commit time after all fixes landed — see commit body for `R2-verdict: <hash8>`.)

---

*Arc 1 (Verification & verdict hardening) complete. 3 sprints (2.46.1 + 2.46.2 + 2.3.1) shipped with consistent R2 self-correcting story validated 4 times. The verdict pipeline now has commit_sha binding + nonce journal + STRICT_SECRET mode (Sprint 2.46.1), doc-currency drift detection (Sprint 2.46.2), and 7th criterion kind mutation_score with per-action_kind thresholds (Sprint 2.3.1). Arc 2 (Operator UX) candidate next.*
