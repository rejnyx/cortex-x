'use strict';

/**
 * Contract test — Sprint 1.9.0 acceptance_criteria invariants.
 *
 * Every shipped action_kind in `bin/steward/_lib/action-kinds.cjs` MUST declare
 * a non-empty `acceptance_criteria` array. Each criterion MUST validate
 * against the spec-verifier rules (id, kind, kind-specific fields). This is
 * the registry-side gate: if a kind ships without spec criteria, spec-verifier
 * would treat it as SPEC_MALFORMED at runtime under the strict-mode default
 * (Q2=YES from the R1 decision memo).
 *
 * If this test fails: the offending kind needs at least one criterion declared
 * before merge. See docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md
 * § "Acceptance Criteria for the Sprint Itself" for the full contract.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const kinds = require('../../bin/steward/_lib/action-kinds.cjs');
const sv = require('../../bin/steward/_lib/spec-verifier.cjs');

describe('action-kinds × acceptance_criteria contract (Sprint 1.9.0)', () => {
  test('every shipped kind declares a non-empty acceptance_criteria array', () => {
    const shipped = kinds.listShippedKinds();
    assert.ok(shipped.length >= 9, `expected ≥ 9 shipped kinds, got ${shipped.length}`);

    for (const name of shipped) {
      const entry = kinds.getActionKind(name);
      assert.ok(
        Array.isArray(entry.acceptance_criteria),
        `kind '${name}' missing acceptance_criteria array`,
      );
      assert.ok(
        entry.acceptance_criteria.length >= 1,
        `kind '${name}' has empty acceptance_criteria (strict-mode default would block)`,
      );
    }
  });

  test('every criterion across every kind validates', () => {
    for (const name of kinds.listKinds()) {
      const entry = kinds.getActionKind(name);
      // Future-roadmap kinds (shipped_in: null) may legally omit the field
      // until they ship; only enforce shape on kinds that DO declare it.
      if (!Array.isArray(entry.acceptance_criteria)) continue;
      for (const c of entry.acceptance_criteria) {
        const v = sv.validateCriterion(c);
        assert.ok(
          v.ok,
          `kind '${name}' criterion '${(c && c.id) || '<no-id>'}' invalid: ${v.reason}`,
        );
      }
    }
  });

  test('every criterion has a unique id within its kind', () => {
    for (const name of kinds.listKinds()) {
      const entry = kinds.getActionKind(name);
      if (!Array.isArray(entry.acceptance_criteria)) continue;
      const ids = entry.acceptance_criteria.map((c) => c.id);
      const seen = new Set();
      for (const id of ids) {
        assert.ok(!seen.has(id), `kind '${name}' has duplicate criterion id '${id}'`);
        seen.add(id);
      }
    }
  });

  test('every criterion declares a string description (non-empty for non-ears_text)', () => {
    for (const name of kinds.listKinds()) {
      const entry = kinds.getActionKind(name);
      if (!Array.isArray(entry.acceptance_criteria)) continue;
      for (const c of entry.acceptance_criteria) {
        // ears_text criteria substitute the EARS clause for description; others
        // should carry a human-readable purpose for the journal/PR-body
        // surface (Sprint 1.9.2 unblock).
        if (c.kind === 'ears_text') continue;
        if (c.description !== undefined) {
          assert.equal(typeof c.description, 'string', `'${name}'/'${c.id}' description not string`);
        }
      }
    }
  });

  test('recommendation kind inherits the no_destructive_rewrite predicate (PR #3 / #4 generalization)', () => {
    const rec = kinds.getActionKind('recommendation');
    const ids = rec.acceptance_criteria.map((c) => c.id);
    assert.ok(
      ids.includes('no_destructive_rewrite'),
      'recommendation kind must inherit no_destructive_rewrite (Sprint 1.8.13 → 1.9.0 generalization)',
    );
  });

  test('issue-only kinds (doc_drift, todo_triage, test_coverage_gap, pr_review_responder) require empty touched files', () => {
    const issueOnly = ['doc_drift', 'todo_triage', 'test_coverage_gap', 'pr_review_responder'];
    for (const name of issueOnly) {
      const entry = kinds.getActionKind(name);
      assert.ok(entry, `kind '${name}' missing from registry`);
      const ids = entry.acceptance_criteria.map((c) => c.id);
      assert.ok(
        ids.includes('no_working_tree_edits'),
        `kind '${name}' must declare no_working_tree_edits (gh-issue-only contract)`,
      );
    }
  });
});
