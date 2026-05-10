// action-kinds.cjs — Sprint 1.8.1 typed action_kind registry.
//
// The Hermes evolution roadmap (research synth 2026-05-07) calls for evolving
// from "single-shot recommendation processor" to a "quality colleague" with
// a tool palette of specialized capabilities (#1 dep-update, #2 flaky-test
// repair, #3 doc-drift, #4 TODO triage, #5 recommendation harvester, ...).
//
// Single-agent first (Anthropic + Google guidance 2026): keep ONE execute.cjs,
// add a typed action_kind field threaded through dry-run.cjs → execute.cjs.
// Each kind shares 95% of the pipeline (lock, journal, denylist, atomic
// commit, push, draft PR); only the LLM step + edit format differs per kind.
//
// This module is the registry. Adding a new capability (Sprint 1.8.2+) means:
//   1. Define entry below
//   2. Add detector in detectors/<kind>.cjs (read-only signal source)
//   3. Wire LLM step in execute.cjs switch (or skip-LLM for deterministic kinds)
//   4. Declare acceptance_criteria — every shipped kind MUST declare ≥ 1
//      criterion (Sprint 1.9.0 strict mode). Empty array → SPEC_MALFORMED.
//
// All Sprint 1.7.X / 1.6.X plans default to action_kind: "recommendation"
// (backwards-compatible — pre-1.8.1 plans had implicit kind = recommendation).

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1.9.0 — common acceptance criteria reused across kinds.
// Per memo: kind-level criteria can compose from a shared library. Each kind
// then layers its own kind-specific criteria on top.
// ─────────────────────────────────────────────────────────────────────────────

// PR #3 / PR #4 (2026-05-08) regression. Generalizes the pre-1.9 hardcoded
// EDIT_DESTRUCTIVE_REWRITE check from action-engine.cjs into a per-kind
// declarative criterion. Recommendation kind opts in by default; deterministic
// kinds whose normal flow legitimately shrinks files (lockfile updates, lint
// fixes that delete dead code) MUST NOT include this criterion.
const NO_DESTRUCTIVE_REWRITE_CRITERION = {
  id: 'no_destructive_rewrite',
  kind: 'file_predicate',
  description: 'Edits targeting an existing file >= 200 bytes must not shrink it below 50% of original size unless edit.replace_all=true. Generalizes Sprint 1.8.13 EDIT_DESTRUCTIVE_REWRITE incident class (PR #3, PR #4 — LLM destructive-rewrite pattern with fabricated content).',
  predicate:
    'touchedFiles.every((p) => prevSize(p) < 200 || fileSize(p) >= prevSize(p) * 0.5 || ((edits.find((e) => e && e.path === p) || {}).replace_all === true))',
  severity: 'block',
};

// Documentation companion to NO_DESTRUCTIVE_REWRITE_CRITERION. ears_text is
// runtime no-op in 1.9.0 (validateCriterion enforces the EARS pattern at
// registry load time). Lives next to the predicate so kind authors document
// the human-readable contract.
const NO_DESTRUCTIVE_REWRITE_EARS = {
  id: 'no_destructive_rewrite_ears',
  kind: 'ears_text',
  description: 'Human-readable EARS clause documenting the no_destructive_rewrite predicate.',
  ears: 'WHEN edit.replace_all is false AND the existing file size is at least 200 bytes THE SYSTEM SHALL preserve at least 50 percent of the existing file content',
  severity: 'block',
};

// Sprint 2.2.5 v0 — edit_ops[] primitive criteria. Layered ON TOP of
// NO_DESTRUCTIVE_REWRITE_CRITERION (which remains the universal backstop
// for all edits). The criteria below fire only when an edit declares
// `ops`-shape (as opposed to legacy `{path, content, replace_all}`).

// EDIT_POSITION_APPEND_GROWS — when an op of kind=append runs against a
// path, post-edit fileSize MUST exceed prevSize. Catches stealth-replace
// (memo R2 §security HIGH-2 + edge-case ship-blocker: an LLM that emits
// kind=append but text replaces existing content reduction).
const EDIT_POSITION_APPEND_GROWS = {
  id: 'edit_position_append_grows',
  kind: 'file_predicate',
  description:
    'For each edit declaring ops with kind=append on path P, fileSize(P) MUST exceed prevSize(P). Detects stealth-replace masquerading as append.',
  predicate:
    'edits.every((e) => !e || !Array.isArray(e.ops) || !e.ops.some((o) => o && o.kind === "append") || fileSize(e.path) > prevSize(e.path))',
  severity: 'block',
};

// EDIT_POSITION_CREATE_MAKES_FILE — when an op of kind=create runs against
// a path, the path MUST exist post-edit AND be non-empty (catches LLM
// emitting kind=create with valid shape but empty text — already blocked
// by splice.cjs validateOp, but a defense-in-depth peer criterion lets
// PR-body / lessons-learned see specific failure id).
const EDIT_POSITION_CREATE_MAKES_FILE = {
  id: 'edit_position_create_makes_file',
  kind: 'file_predicate',
  description:
    'For each edit declaring ops with kind=create on path P, fileExists(P) MUST be true AND fileSize(P) MUST be > 0 post-edit.',
  predicate:
    'edits.every((e) => !e || !Array.isArray(e.ops) || !e.ops.some((o) => o && o.kind === "create") || (fileExists(e.path) && fileSize(e.path) > 0))',
  severity: 'block',
};

// EDIT_POSITION_GROWTH_BOUNDED — across all touched paths, file MUST NOT
// grow by more than 4× its prior size OR by more than +4 KiB, whichever
// is larger. Catches over-edit + stealth replace-as-append confusion
// (security MEDIUM — bounded growth invariant).
const EDIT_POSITION_GROWTH_BOUNDED = {
  id: 'edit_position_growth_bounded',
  kind: 'file_predicate',
  description:
    'Touched paths must not grow more than 4× prevSize OR +4 KiB (whichever is larger). Catches stealth replace-as-append + over-edit.',
  predicate:
    'touchedFiles.every((p) => prevSize(p) === 0 || fileSize(p) <= Math.max(prevSize(p) * 4, prevSize(p) + 4096))',
  severity: 'block',
};

// Documentation companion (ears_text — runtime no-op).
const EDIT_POSITION_EARS = {
  id: 'edit_position_ears',
  kind: 'ears_text',
  description: 'Human-readable EARS clause for the edit_ops[] primitive contract.',
  ears: 'WHEN an edit declares ops with kind=append THE SYSTEM SHALL ensure the post-edit file size exceeds the pre-edit size; WHEN an edit declares ops with kind=create THE SYSTEM SHALL ensure the target file exists and is non-empty post-edit; WHEN any path is touched THE SYSTEM SHALL bound growth to 4 times prior size or 4 kibibytes additional, whichever is larger',
  severity: 'block',
};

// Sprint 2.2.5 v1 — str_replace + insert criteria. These are runtime-evaluated
// against ops that declare kind=str_replace / kind=insert. Engine-side splice.cjs
// already enforces these at apply time (failures = EDIT_OP_ANCHOR_NOT_FOUND /
// EDIT_OP_ANCHOR_AMBIGUOUS / EDIT_OP_LINE_OUT_OF_RANGE) — the criteria below
// are belt-and-braces post-edit verification surfaced through SPEC_VIOLATION
// for crisper PR-body / lessons-learned signal.

// EDIT_POSITION_STR_REPLACE_PRESERVED — for any str_replace op, the post-edit
// file MUST contain the new_str. (Catches the case where the engine apply
// path silently drops the replacement.)
const EDIT_POSITION_STR_REPLACE_PRESERVED = {
  id: 'edit_position_str_replace_preserved',
  kind: 'file_predicate',
  description:
    'For each str_replace op on path P with new_str N, fileContent(P) MUST contain N post-edit. Detects silent drop / mis-apply of replacement.',
  predicate:
    'edits.every((e) => !e || !Array.isArray(e.ops) || e.ops.every((o) => !o || o.kind !== "str_replace" || fileContent(e.path).indexOf(o.new_str) >= 0))',
  severity: 'block',
};

// EDIT_POSITION_INSERT_GROWS — for any insert op, post-edit fileSize MUST
// exceed prevSize (insert is monotonic by definition).
const EDIT_POSITION_INSERT_GROWS = {
  id: 'edit_position_insert_grows',
  kind: 'file_predicate',
  description:
    'For each edit with ops including kind=insert on path P, fileSize(P) MUST exceed prevSize(P). Insert never shrinks.',
  predicate:
    'edits.every((e) => !e || !Array.isArray(e.ops) || !e.ops.some((o) => o && o.kind === "insert") || fileSize(e.path) > prevSize(e.path))',
  severity: 'block',
};

// EDIT_POSITION_V1_EARS — companion ears_text.
const EDIT_POSITION_V1_EARS = {
  id: 'edit_position_v1_ears',
  kind: 'ears_text',
  description: 'Human-readable EARS clause for v1 ops (str_replace + insert).',
  ears: 'WHEN an edit declares ops with kind=str_replace THE SYSTEM SHALL ensure the post-edit file contains the new_str; WHEN an edit declares ops with kind=insert THE SYSTEM SHALL ensure the post-edit file size exceeds the pre-edit size',
  severity: 'block',
};

const ACTION_KINDS = {
  // ── Currently shipped (Sprint 1.6.13 → 1.7.7) ─────────────────────────
  recommendation: {
    description:
      'Standard cortex/recommendations.md item. LLM produces edits, gates on npm test, atomic commit, draft PR.',
    requires_llm: true,
    source: 'cortex/recommendations.md',
    detector: null, // recommendations.md is parsed directly by dry-run.cjs
    cost_envelope: 'normal', // ~$0.0008/run via deepseek-v4-flash
    blast_radius: 'medium', // arbitrary file edits; bounded by denylist
    shipped_in: '1.6.13',
    acceptance_criteria: [
      NO_DESTRUCTIVE_REWRITE_CRITERION,
      NO_DESTRUCTIVE_REWRITE_EARS,
      EDIT_POSITION_APPEND_GROWS,
      EDIT_POSITION_CREATE_MAKES_FILE,
      EDIT_POSITION_GROWTH_BOUNDED,
      EDIT_POSITION_EARS,
      EDIT_POSITION_STR_REPLACE_PRESERVED,
      EDIT_POSITION_INSERT_GROWS,
      EDIT_POSITION_V1_EARS,
    ],
  },

  // ── Future kinds (Sprint 1.8.X roadmap, declared but not implemented) ─
  // Adding a kind here BEFORE shipping the executor is intentional: lets us
  // version-pin the dispatcher contract without surprises later. Each entry
  // has `shipped_in: null` until the corresponding sprint lands.
  recommendation_harvest: {
    description:
      'Read closed PRs + CI failures + open issues, append candidate observations to recommendations.md. Read-only — no LLM, no edits to source code.',
    requires_llm: false,
    source: 'gh pr list --state closed + gh run list + gh issue list',
    detector: 'detectors/recommendation-harvest.cjs', // Sprint 1.8.2a
    cost_envelope: 'free', // no LLM call
    blast_radius: 'minimal', // appends to recommendations.md only
    shipped_in: '0.1.0', // Sprint 1.8.2c — executor wired in execute.cjs runHarvestAction
    acceptance_criteria: [
      // Harvester ALWAYS appends to recommendations.md. The file must remain
      // larger after the action — never shrink (which would mean we deleted
      // existing recommendations).
      {
        id: 'recommendations_md_grows_or_stable',
        kind: 'file_predicate',
        description: 'Harvester only appends; recommendations.md size must not shrink.',
        predicate:
          'touchedFiles.every((p) => p !== "cortex/recommendations.md" || fileSize(p) >= prevSize(p))',
        severity: 'block',
      },
      {
        id: 'harvester_appends_only_ears',
        kind: 'ears_text',
        ears: 'WHEN the harvester runs THE SYSTEM SHALL only append to cortex/recommendations.md and never shrink it',
        severity: 'block',
      },
    ],
  },

  dep_update_patch: {
    description:
      'npm outdated → patch-only diffs → npm test gate → draft PR. Deterministic, no LLM call.',
    requires_llm: false,
    source: 'npm outdated --json',
    detector: 'detectors/dep-update-patch.cjs', // Sprint 1.8.4
    cost_envelope: 'free',
    blast_radius: 'medium', // package.json + lockfile + node_modules state
    shipped_in: '0.1.0', // Sprint 1.8.4
    acceptance_criteria: [
      // dep_update_patch CAN legitimately shrink package-lock.json (when a
      // transitive dep is consolidated). So we explicitly do NOT include the
      // no_destructive_rewrite criterion here. Instead, we require the
      // package-lock to remain readable + non-empty.
      {
        id: 'lockfile_present_after_update',
        kind: 'file_predicate',
        description: 'After dep_update_patch, package-lock.json must still exist and be non-empty.',
        predicate: '!fileExists("package-lock.json") || fileSize("package-lock.json") > 0',
        severity: 'block',
      },
      {
        id: 'dep_update_ears',
        kind: 'ears_text',
        ears: 'WHEN dep_update_patch applies edits THE SYSTEM SHALL keep package-lock.json readable and non-empty',
        severity: 'block',
      },
    ],
  },

  flaky_test_repair: {
    description:
      'Marker-based quarantine: scan source for `// HERMES-FLAKY: <reason>` markers above test/it/describe declarations, replace with .skip + remove marker + open gh issue. Deterministic, no LLM call.',
    requires_llm: false,
    source: 'fs scan for HERMES-FLAKY markers',
    detector: 'detectors/flaky-test-repair.cjs', // Sprint 1.8.5
    cost_envelope: 'free',
    blast_radius: 'low', // adds .skip in test files + opens GH issue
    shipped_in: '0.1.0', // Sprint 1.8.5
    acceptance_criteria: [
      // flaky_test_repair only adds `.skip` markers — file size grows by ~5
      // chars per quarantine. NEVER shrinks. Inherit no_destructive_rewrite.
      NO_DESTRUCTIVE_REWRITE_CRITERION,
      {
        id: 'flaky_repair_adds_skip',
        kind: 'ears_text',
        ears: 'WHEN flaky_test_repair quarantines a test THE SYSTEM SHALL add a .skip marker without removing prior content',
        severity: 'block',
      },
    ],
  },

  doc_drift: {
    description:
      'Scan exported symbols (function/class/const/type), check mention in README/CLAUDE.md/docs/, file gh issues for undocumented public API surface. Deterministic — no LLM call.',
    requires_llm: false,
    source: 'fs scan + README.md + CLAUDE.md + docs/*.md',
    detector: 'detectors/doc-drift.cjs', // Sprint 1.8.6
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issues only — no doc edits in v1
    shipped_in: '0.1.0', // Sprint 1.8.6
    acceptance_criteria: [
      // doc_drift v1 ONLY files gh issues — no working-tree edits. Therefore
      // touchedFiles MUST be empty. If something edits files, that's a
      // regression we want to catch.
      {
        id: 'no_working_tree_edits',
        kind: 'file_predicate',
        description: 'doc_drift v1 only files gh issues; touched files must be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'doc_drift_issues_only_ears',
        kind: 'ears_text',
        ears: 'WHILE doc_drift is in v1 mode THE SYSTEM SHALL only file gh issues without editing files',
        severity: 'block',
      },
    ],
  },

  todo_triage: {
    description:
      'Scan TODO/FIXME/XXX/HACK markers older than N days, dedupe vs open issues, file gh issues with git-blame context. Deterministic — no LLM call.',
    requires_llm: false, // deterministic body assembly; no LLM
    source: 'fs scan + git blame + gh issue list',
    detector: 'detectors/todo-triage.cjs', // Sprint 1.8.7
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issue create only; no file edits
    shipped_in: '0.1.0', // Sprint 1.8.7
    acceptance_criteria: [
      {
        id: 'no_working_tree_edits',
        kind: 'file_predicate',
        description: 'todo_triage only files gh issues; touched files must be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'todo_triage_issues_only_ears',
        kind: 'ears_text',
        ears: 'WHILE todo_triage is processing THE SYSTEM SHALL only file gh issues without editing files',
        severity: 'block',
      },
    ],
  },

  // ── Future kinds (Sprint 1.9+ roadmap) ─────────────────────────────────
  // Declared with shipped_in: null so the dispatcher contract is forward-
  // compatible. Each lands when the corresponding sprint implements its
  // detector + executor branch.
  test_coverage_gap: {
    description:
      'Cross-reference coverage report (statements < threshold) + recently-edited files, file gh issue per gap. v1: deterministic detection only — LLM-driven test generation parked v0.9+. Capability #6.',
    requires_llm: false, // v1: file issue, no test generation
    source: 'coverage/coverage-summary.json + git log --since',
    detector: 'detectors/test-coverage-gap.cjs', // Sprint 1.8.10
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issues only
    shipped_in: '0.1.0', // Sprint 1.8.10
    acceptance_criteria: [
      {
        id: 'no_working_tree_edits',
        kind: 'file_predicate',
        description: 'test_coverage_gap v1 files gh issues only; touched files must be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'coverage_gap_issues_only_ears',
        kind: 'ears_text',
        ears: 'WHILE test_coverage_gap runs in v1 detection mode THE SYSTEM SHALL only file gh issues',
        severity: 'block',
      },
    ],
  },

  lint_fix_shipper: {
    description:
      'Run ESLint --fix (auto-fix style + simple violations) + tsc --noEmit (type-check, file issues for non-fixable errors). Deterministic. Capability #8.',
    requires_llm: false,
    source: 'npx eslint + npx tsc',
    detector: 'detectors/lint-fix.cjs', // Sprint 1.8.9
    cost_envelope: 'free',
    blast_radius: 'medium', // arbitrary file edits via auto-fixers
    shipped_in: '0.1.0', // Sprint 1.8.9
    acceptance_criteria: [
      // ESLint --fix can legitimately delete unused imports / dead code, so
      // edits may shrink files. We do NOT include no_destructive_rewrite.
      // We only require that edits don't truncate to an empty file.
      {
        id: 'no_empty_files_post_lint',
        kind: 'file_predicate',
        description: 'ESLint --fix should not produce an empty file from a non-empty original.',
        predicate: 'touchedFiles.every((p) => prevSize(p) === 0 || fileSize(p) > 0)',
        severity: 'block',
      },
      {
        id: 'lint_fix_no_empty_ears',
        kind: 'ears_text',
        ears: 'WHEN lint_fix_shipper applies edits THE SYSTEM SHALL not produce an empty file from a non-empty original',
        severity: 'block',
      },
    ],
  },

  pr_review_responder: {
    description:
      'Monitor open Hermes-authored PRs for unresolved reviewer comments, file aggregation issue per PR. v1: deterministic surfacing only — auto-patch parked v0.9+. Capability #9.',
    requires_llm: false, // v1: aggregate + file issue, no patch generation
    source: 'gh pr list + gh api repos/.../pulls/N/comments',
    detector: 'detectors/pr-review-responder.cjs', // Sprint 1.8.11
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issues only
    shipped_in: '0.1.0', // Sprint 1.8.11
    acceptance_criteria: [
      {
        id: 'no_working_tree_edits',
        kind: 'file_predicate',
        description: 'pr_review_responder v1 surfaces via gh issues only; touched files must be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'pr_responder_issues_only_ears',
        kind: 'ears_text',
        ears: 'WHILE pr_review_responder runs in v1 surfacing mode THE SYSTEM SHALL only file gh issues',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.3b: mutation score drift (deterministic, snapshot-only v1) ─
  // Sprint 2.3a (this entry, shipped_in: null) reserves the dispatcher
  // contract so downstream consumers can prepare matchers + journal
  // schemas before the runner lands. Sprint 2.3b will:
  //   1. migrate npm test from `node --test` to vitest (Phase -1) so
  //      Stryker's `coverageAnalysis: "perTest"` works (CommandRunner
  //      fallback breaks coverage filtering → 8-20h wall-clock per run)
  //   2. baseline mutation score on splice.cjs in a throwaway clone
  //      (Phase 0) before wiring CI gates
  //   3. wire `npx stryker run --incremental` to write reports/mutation.json
  //      with {tier, score, mutants_killed, mutants_survived, baseline_diff}
  //      (Phase 1) — see docs/research/sprint-2.3-mutation-testing-fitness-refresh-2026-05-10.md
  //
  // Mutation tier targets (SSOT in standards/correctness.md § Practice 4):
  //   - tier: critical → 90% (splice.cjs atomic-rollback, policy-check, path-safety)
  //   - tier: orchestrator → 80% (action-engine, spec-verifier, recommendations parser)
  //   - tier: advisory → 70% (everything else; informational only)
  mutation_score_drift: {
    description:
      'Run incremental mutation tests on touched modules; write reports/mutation.json snapshot; compute drift vs prior baseline. v1: snapshot-only (no PR opening, no auto-test-generation). Deterministic — no LLM call. Sprint 2.3b will land the executor + detector once vitest migration completes.',
    requires_llm: false,
    source: 'npx stryker run --incremental + reports/mutation.json (prior baseline)',
    detector: 'detectors/mutation-score-drift.cjs', // Sprint 2.3b
    cost_envelope: 'free', // no LLM call; CI-minute cost tracked separately via $0.10/run ceiling
    blast_radius: 'minimal', // snapshot file write only — no source edits
    shipped_in: null, // Sprint 2.3b
    acceptance_criteria: [
      // Sprint 2.3b R1 (refresh memo §3): action MUST produce a fresh snapshot.
      // The runner is read-only against source (mutation testing happens in
      // Stryker's sandbox, not on disk).
      {
        id: 'mutation_snapshot_written',
        kind: 'file_predicate',
        description: 'Action MUST produce reports/mutation.json non-empty.',
        predicate:
          'touchedFiles.includes("reports/mutation.json") && fileSize("reports/mutation.json") > 50',
        severity: 'block',
      },
      {
        id: 'mutation_snapshot_schema_valid',
        kind: 'regex',
        description: 'Snapshot MUST contain canonical top-level keys: schema_version, tier, score, mutants_killed, mutants_survived.',
        file: 'reports/mutation.json',
        pattern: '"schema_version"\\s*:\\s*1.*"tier".*"score".*"mutants_killed".*"mutants_survived"',
        severity: 'block',
      },
      {
        id: 'mutation_audit_only_writes_snapshot',
        kind: 'file_predicate',
        description: 'mutation_score_drift is read-only against source — only reports/mutation.json may change.',
        predicate: 'touchedFiles.every((p) => p === "reports/mutation.json")',
        severity: 'block',
      },
      {
        id: 'mutation_score_drift_readonly_ears',
        kind: 'ears_text',
        ears: 'WHEN mutation_score_drift runs THE SYSTEM SHALL only modify reports/mutation.json',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.5: 10th capability — tech debt audit (deterministic) ─────
  tech_debt_audit: {
    description:
      'Run qlty metrics + qlty smells + knip; snapshot to cortex/debt-snapshot.json; compute drift vs prior snapshot. v1: snapshot-only (no PR opening). Deterministic — no LLM call.',
    requires_llm: false,
    source: 'qlty metrics --all --json + qlty smells --all --sarif + knip --reporter json',
    detector: 'detectors/tech-debt-audit.cjs', // Sprint 2.5
    cost_envelope: 'free', // no LLM call
    blast_radius: 'minimal', // only writes cortex/debt-snapshot.json (no source edits, no PR in v1)
    shipped_in: '0.3.0', // Sprint 2.5
    acceptance_criteria: [
      // Sprint 2.5 R1 §2.8: action MUST produce a fresh snapshot file.
      // Sprint 2.5 v1 is snapshot-only; PR opening is deferred to v2 once
      // operator-action-rate on advisory PRs is measured (≥30% threshold).
      {
        id: 'snapshot_file_written',
        kind: 'file_predicate',
        description: 'Action MUST produce cortex/debt-snapshot.json non-empty.',
        predicate: 'touchedFiles.includes("cortex/debt-snapshot.json") && fileSize("cortex/debt-snapshot.json") > 50',
        severity: 'block',
      },
      {
        id: 'snapshot_schema_valid',
        kind: 'regex',
        description: 'Snapshot MUST contain canonical top-level keys.',
        file: 'cortex/debt-snapshot.json',
        pattern: '"snapshot_version"\\s*:\\s*1.*"captured_at".*"metrics"',
        severity: 'block',
      },
      {
        id: 'audit_only_writes_snapshot',
        kind: 'file_predicate',
        description: 'Audit kind is read-only against source — only cortex/debt-snapshot.json may change.',
        predicate: 'touchedFiles.every((p) => p === "cortex/debt-snapshot.json")',
        severity: 'block',
      },
      {
        id: 'audit_readonly_ears',
        kind: 'ears_text',
        ears: 'WHEN tech_debt_audit runs THE SYSTEM SHALL only modify cortex/debt-snapshot.json',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.7: 11th capability — cross-project pattern transfer ──────
  pattern_transfer: {
    description:
      'Read allowlisted sibling projects (cortex/sibling-projects.json) read-only, distill cross-project patterns into the CURRENT project\'s lessons-learned.jsonl. v1: journal-only — never opens PRs, never edits sibling repos. LLM-driven. Capability #11.',
    requires_llm: true,
    source: 'cortex/sibling-projects.json + sibling repos read-only via sibling-reader.cjs',
    detector: 'detectors/pattern-transfer.cjs', // Sprint 2.7
    cost_envelope: 'normal', // ~$0.0008/run via deepseek-v4-flash, $0 under claude-cli engine (Sprint 2.4)
    blast_radius: 'minimal', // appends to current project's lessons-learned.jsonl only — never touches siblings
    shipped_in: '0.3.0', // Sprint 2.7 v0 (manifest + reader + register; LLM dispatch deferred to 2.7.1)
    acceptance_criteria: [
      // Sprint 2.7 R1 §11: lessons-learned must gain a new entry with source_repo.
      {
        id: 'lessons_jsonl_grew_with_source_repo',
        kind: 'file_predicate',
        description: 'pattern_transfer must append to lessons-learned.jsonl with source_repo field present.',
        predicate:
          'touchedFiles.includes("cortex/lessons-learned.jsonl") && fileSize("cortex/lessons-learned.jsonl") >= prevSize("cortex/lessons-learned.jsonl")',
        severity: 'block',
      },
      {
        id: 'pattern_transfer_no_cross_repo_edit',
        kind: 'file_predicate',
        description: 'pattern_transfer must NEVER edit files outside cwd. Spec-verifier rejects any edit landing in sibling roots. Sprint 2.7.1 hardening: tightened against UNC paths (\\\\server\\share), Windows drive-letters, traversal segments (..), and double-quote tricks.',
        // Sprint 2.7.1 fix (R2 retro BLOCKER B1): UNC paths `\\\\server\\share` were
        // previously bypass-prone (no leading `/`, no drive letter). Now reject
        // any path containing `\\` (backslash sequence — typical UNC marker),
        // any `..` segment (not just substring `..`), and absolute paths.
        // Splits on both `/` and `\\` to defend against mixed separators.
        predicate: 'touchedFiles.every((p) => typeof p === "string" && p.length > 0 && !p.includes("\\\\") && !p.split(/[\\\\\\/]/).includes("..") && !p.match(/^[A-Za-z]:/) && !p.startsWith("/") && !p.startsWith("\\\\"))',
        severity: 'block',
      },
      {
        id: 'pattern_transfer_journal_only_ears',
        kind: 'ears_text',
        ears: 'WHEN pattern_transfer runs THE SYSTEM SHALL only append to the current project lessons-learned.jsonl AND never edit any sibling project',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.5b: 13th capability — workflow_hardener (deterministic) ──
  // v1 = ADVISORY only: scans .github/workflows/*.yml for hardening gaps
  // (unpinned action SHAs, missing permissions: / concurrency: /
  // timeout-minutes:), writes journal entry + opens ONE gh issue with
  // proposed patches. NO auto-apply in v1 — .github/workflows/** is in
  // engine HARD_DENYLIST (privilege-escalation footgun if Steward could
  // rewrite its own CI). v1.5 (Sprint 2.5b.1) will add auto-fix behind
  // explicit env flag with per-finding spec criteria.
  //
  // Cadence: weekly cron `0 03 * * 0` (Sunday 03:00 UTC, before existing
  // dep-patch 04:00). Cost: $0/run (no LLM call).
  // R1 memo: docs/research/sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md
  workflow_hardener: {
    description:
      'Advisory analyzer for .github/workflows/*.yml — flags unpinned action SHAs, missing permissions:/concurrency:/timeout-minutes:. v1 opens ONE gh issue with proposed patches; v1.5 will add auto-fix behind explicit env flag.',
    requires_llm: false,
    source: '.github/workflows/*.yml + workflow-hardener heuristics',
    detector: 'detectors/workflow-hardener.cjs',
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issue + journal only; no working-tree edits in v1
    shipped_in: '0.3.0', // Sprint 2.5b v1
    acceptance_criteria: [
      {
        id: 'workflow_hardener_no_working_tree_edits',
        kind: 'file_predicate',
        description: 'workflow_hardener v1 only writes journal + opens gh issue; touched files MUST be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'workflow_hardener_advisory_only_ears',
        kind: 'ears_text',
        ears: 'WHILE workflow_hardener runs in v1 advisory mode THE SYSTEM SHALL only write journal entries and open gh issues without editing any workflow files',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.6b: 14th capability — secret_history_sweep (deterministic) ──
  // v1 wraps TruffleHog full-history scan with --only-verified. On verified
  // hit: opens gh issue with severity LABEL. NO auto-PR (secret revocation
  // requires human — rotate key, then commit-history rewrite is destructive).
  // Cadence: weekly cron `0 02 * * 0` (Sunday 02:00 UTC, before
  // workflow_hardener 03:00). Cost: $0/run (no LLM call).
  // Fail-open: missing trufflehog binary → kind skipped with warn line.
  // R1 memo: docs/research/sprint-2.5b-2.6b-devops-hygiene-research-2026-05-10.md
  secret_history_sweep: {
    description:
      'TruffleHog full-history scan with --only-verified. On verified hit: opens gh issue with severity LABEL. NO auto-PR. Read-only against working tree; only writes are journal entries + gh issue create. Fail-open if trufflehog binary missing.',
    requires_llm: false,
    source: 'trufflehog git file://. --only-verified --json --since-commit=<last-sweep-sha>',
    detector: 'detectors/secret-history-sweep.cjs',
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issue + journal only; read-only against repo
    shipped_in: '0.3.0', // Sprint 2.6b v1
    acceptance_criteria: [
      {
        id: 'secret_sweep_no_working_tree_edits',
        kind: 'file_predicate',
        description: 'secret_history_sweep v1 only writes journal + opens gh issue; touched files MUST be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'secret_sweep_read_only_ears',
        kind: 'ears_text',
        ears: 'WHEN secret_history_sweep runs THE SYSTEM SHALL only read git history and emit journal/gh-issue without editing any source file',
        severity: 'block',
      },
    ],
  },

  // ── Sprint 2.11: 12th capability — senior_tester_review (hybrid LLM) ──
  // Hybrid 2-stage: deterministic Phase A detector (test-smell-detector.cjs
  // walks tests/, applies regex over 16 of 39 registry smells, layer-balance
  // computed) → optional Phase B LLM judge (STEWARD_SENIOR_TESTER_JUDGE=1
  // opt-in; deepseek-v4-flash, ~$0.005/run) → deterministic Phase C deliverer
  // (writes journal/senior-tester-YYYY-MM.md + opens ONE gh issue with
  // checklist; no source/test edits).
  //
  // Cadence: monthly (1st of month, 04:00 UTC). Test-smell drift is slow.
  // Cost ceiling (R4): default $0/run; ~$0.005/run with judge enabled.
  // Differentiator: no SaaS or GitHub App ships cron-driven "audit existing
  // tests" mode (Diffblue Cover generates new tests; Mabl/Functionize
  // authoring; Sprint 2.10 /test-audit is one-shot retrofit).
  //
  // R1 memo: docs/research/sprint-2.11-senior-tester-research-2026-05-10.md
  // Smell taxonomy memo: c:/tmp/sprint-2.11-smell-taxonomy-research-2026-05-10.md
  // Grounded in: tsDetect FSE'20, Sandoval ESE 2025 (DOI 10.1007/s10664-025-10718-x),
  // SNUTS.js SBES 2024, SMURF Google 2024-10.
  senior_tester_review: {
    description:
      '2-stage hybrid test-quality auditor: deterministic detector (~16 smells with regex; tsDetect 21 + Sandoval ESE 2025 13 + cortex-original 5 in registry) + optional LLM judge for strategic synthesis. Writes journal entry + opens ONE gh issue per run. Never edits source/test files in v1.',
    requires_llm: false, // judge is opt-in via STEWARD_SENIOR_TESTER_JUDGE=1
    source: 'fs walk of tests/ + test smell registry + (optional) LLM judge call',
    detector: 'detectors/senior-tester-review.cjs',
    cost_envelope: 'free', // default; opt-in judge runs $0.005/run via deepseek-v4-flash
    blast_radius: 'minimal', // gh issue + journal only; no source/test edits
    shipped_in: '0.3.0', // Sprint 2.11 v1
    acceptance_criteria: [
      // Sprint 2.11 R1: action MUST NOT edit source/test files. Audit only.
      {
        id: 'senior_tester_no_working_tree_edits',
        kind: 'file_predicate',
        description: 'senior_tester_review v1 only writes journal + opens gh issue; touched files MUST be empty.',
        predicate: 'touchedFiles.length === 0',
        severity: 'block',
      },
      {
        id: 'senior_tester_review_only_ears',
        kind: 'ears_text',
        ears: 'WHEN senior_tester_review runs THE SYSTEM SHALL only write journal entries and open gh issues without editing any source or test files',
        severity: 'block',
      },
    ],
  },

  // ── v1.0+ roadmap placeholder ──────────────────────────────────────────
  release_notes_drafter: {
    description:
      'After merge to main, read merged PRs since last release tag, draft release notes. Future capability for v1.0+ release-management automation.',
    requires_llm: true,
    source: 'gh pr list --state merged + git tag --list',
    detector: null,
    cost_envelope: 'normal',
    blast_radius: 'low', // appends to CHANGELOG.md
    shipped_in: null, // Sprint 1.10.x or v1.0
    acceptance_criteria: [
      // Same pattern as recommendation: LLM drafts, must not destroy CHANGELOG history.
      NO_DESTRUCTIVE_REWRITE_CRITERION,
      {
        id: 'release_notes_appends_ears',
        kind: 'ears_text',
        ears: 'WHEN release_notes_drafter runs THE SYSTEM SHALL append release notes without removing prior CHANGELOG history',
        severity: 'block',
      },
    ],
  },

  // ReasoningBank-lite memory ISN'T an action_kind — it's a cross-cutting
  // memory module written by every kind on failure. Lives in cortex/hermes-lessons.jsonl.
  // See Sprint 1.8.3 design.
};

function getActionKind(name) {
  return ACTION_KINDS[name] || null;
}

function isSupportedKind(name) {
  return name != null && Object.prototype.hasOwnProperty.call(ACTION_KINDS, name);
}

function isShippedKind(name) {
  const k = getActionKind(name);
  return !!(k && k.shipped_in);
}

function listKinds() {
  return Object.keys(ACTION_KINDS);
}

function listShippedKinds() {
  return Object.keys(ACTION_KINDS).filter((k) => ACTION_KINDS[k].shipped_in);
}

const DEFAULT_KIND = 'recommendation';

module.exports = {
  ACTION_KINDS,
  DEFAULT_KIND,
  getActionKind,
  isSupportedKind,
  isShippedKind,
  listKinds,
  listShippedKinds,
  // Sprint 1.9.0 — exported for shared use across kinds + tests
  NO_DESTRUCTIVE_REWRITE_CRITERION,
  NO_DESTRUCTIVE_REWRITE_EARS,
};
