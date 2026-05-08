// action-kinds.test.cjs — Sprint 1.8.1 typed action_kind registry tests.
//
// Verifies the shape of the registry contract and the dispatcher-facing
// helpers. Pre-shipping new kinds (Sprint 1.8.2+) is fine but each entry
// must satisfy the schema below — these tests are the gate.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const kinds = require('../../../bin/steward/_lib/action-kinds.cjs');

describe('action-kinds registry: structure', () => {
  test('exports DEFAULT_KIND = "recommendation" (backwards-compat)', () => {
    assert.equal(kinds.DEFAULT_KIND, 'recommendation');
  });

  test('DEFAULT_KIND is a supported kind', () => {
    assert.ok(kinds.isSupportedKind(kinds.DEFAULT_KIND));
  });

  test('DEFAULT_KIND is a shipped kind (in 1.6.13+)', () => {
    assert.ok(kinds.isShippedKind(kinds.DEFAULT_KIND));
  });

  test('exports ACTION_KINDS with at least the recommendation kind', () => {
    assert.ok(typeof kinds.ACTION_KINDS === 'object');
    assert.ok('recommendation' in kinds.ACTION_KINDS);
  });

  test('every registered kind has the required schema fields', () => {
    const requiredFields = [
      'description',
      'requires_llm',
      'source',
      'detector',
      'cost_envelope',
      'blast_radius',
      'shipped_in',
    ];
    for (const [name, entry] of Object.entries(kinds.ACTION_KINDS)) {
      for (const f of requiredFields) {
        assert.ok(f in entry, `kind '${name}' missing field '${f}'`);
      }
      assert.equal(typeof entry.description, 'string', `${name}.description not string`);
      assert.equal(typeof entry.requires_llm, 'boolean', `${name}.requires_llm not boolean`);
      assert.ok(['free', 'low', 'normal', 'high'].includes(entry.cost_envelope),
        `${name}.cost_envelope must be free|low|normal|high, got '${entry.cost_envelope}'`);
      assert.ok(['minimal', 'low', 'medium', 'high'].includes(entry.blast_radius),
        `${name}.blast_radius must be minimal|low|medium|high, got '${entry.blast_radius}'`);
      // shipped_in is null OR semver-shape (X.Y.Z)
      if (entry.shipped_in !== null) {
        assert.match(entry.shipped_in, /^\d+\.\d+\.\d+$/,
          `${name}.shipped_in must be null or X.Y.Z semver, got '${entry.shipped_in}'`);
      }
    }
  });
});

describe('action-kinds: helpers', () => {
  test('getActionKind returns entry for known kind', () => {
    const entry = kinds.getActionKind('recommendation');
    assert.ok(entry);
    assert.equal(entry.requires_llm, true);
  });

  test('getActionKind returns null for unknown kind', () => {
    assert.equal(kinds.getActionKind('nonexistent_kind'), null);
    assert.equal(kinds.getActionKind(''), null);
    assert.equal(kinds.getActionKind(null), null);
    assert.equal(kinds.getActionKind(undefined), null);
  });

  test('isSupportedKind returns true for registered kinds', () => {
    assert.equal(kinds.isSupportedKind('recommendation'), true);
    // Future kinds declared but not shipped are still "supported"
    assert.equal(kinds.isSupportedKind('recommendation_harvest'), true);
  });

  test('isSupportedKind returns false for unknown kinds', () => {
    assert.equal(kinds.isSupportedKind('nonexistent_kind'), false);
    assert.equal(kinds.isSupportedKind(''), false);
    assert.equal(kinds.isSupportedKind(null), false);
    assert.equal(kinds.isSupportedKind(undefined), false);
  });

  test('isShippedKind returns true only for shipped kinds (shipped_in != null)', () => {
    assert.equal(kinds.isShippedKind('recommendation'), true);
    assert.equal(kinds.isShippedKind('recommendation_harvest'), true);
    assert.equal(kinds.isShippedKind('dep_update_patch'), true);
    assert.equal(kinds.isShippedKind('todo_triage'), true);
    assert.equal(kinds.isShippedKind('flaky_test_repair'), true);
    assert.equal(kinds.isShippedKind('doc_drift'), true);
    assert.equal(kinds.isShippedKind('lint_fix_shipper'), true);
    assert.equal(kinds.isShippedKind('test_coverage_gap'), true);
    // Sprint 1.8.11 — pr_review_responder
    assert.equal(kinds.isShippedKind('pr_review_responder'), true);
    // v1.0+ roadmap placeholder remains parked
    assert.equal(kinds.isShippedKind('release_notes_drafter'), false);
  });

  test('listKinds returns all registered kinds (shipped + future)', () => {
    const all = kinds.listKinds();
    assert.ok(Array.isArray(all));
    assert.ok(all.includes('recommendation'));
    assert.ok(all.length >= 1);
  });

  test('listShippedKinds returns 9 kinds shipped (v0.8 complete: 1 LLM + 8 deterministic)', () => {
    const shipped = kinds.listShippedKinds();
    assert.ok(Array.isArray(shipped));
    assert.ok(shipped.includes('recommendation'));
    assert.ok(shipped.includes('recommendation_harvest'));
    assert.ok(shipped.includes('dep_update_patch'));
    assert.ok(shipped.includes('todo_triage'));
    assert.ok(shipped.includes('flaky_test_repair'));
    assert.ok(shipped.includes('doc_drift'));
    assert.ok(shipped.includes('lint_fix_shipper'));
    assert.ok(shipped.includes('test_coverage_gap'));
    assert.ok(shipped.includes('pr_review_responder'));
    assert.ok(shipped.length >= 9);
  });
});

describe('action-kinds: future-roadmap entries', () => {
  // These tests document the v0.7+ capability roadmap. They MUST pass even
  // before each kind is implemented — the registry is the contract, the
  // executor is the implementation. Having entries declared (with shipped_in: null)
  // lets us version-pin the dispatcher API now.

  test('Sprint 1.8.2 — recommendation_harvest shipped (read-only, no LLM)', () => {
    const k = kinds.getActionKind('recommendation_harvest');
    assert.ok(k);
    assert.equal(k.requires_llm, false);
    assert.equal(k.cost_envelope, 'free');
    assert.equal(k.blast_radius, 'minimal');
    // Sprint 1.8.2a shipped detector; 1.8.2c flipped shipped_in to '0.1.0'.
    assert.equal(k.shipped_in, '0.1.0');
    assert.equal(k.detector, 'detectors/recommendation-harvest.cjs');
  });

  test('Sprint 1.8.4 — dep_update_patch shipped (no LLM, npm outdated patch-only)', () => {
    const k = kinds.getActionKind('dep_update_patch');
    assert.ok(k);
    assert.equal(k.requires_llm, false);
    assert.equal(k.shipped_in, '0.1.0');
    assert.equal(k.detector, 'detectors/dep-update-patch.cjs');
  });

  test('Sprint 1.8.5 — flaky_test_repair shipped (deterministic marker-based)', () => {
    const k = kinds.getActionKind('flaky_test_repair');
    assert.ok(k);
    assert.equal(k.requires_llm, false); // simplified marker-based, no LLM
    assert.equal(k.cost_envelope, 'free');
    assert.equal(k.blast_radius, 'low');
    assert.equal(k.shipped_in, '0.1.0');
    assert.equal(k.detector, 'detectors/flaky-test-repair.cjs');
  });

  test('Sprint 1.8.6 — doc_drift shipped (deterministic exported-symbol scan)', () => {
    const k = kinds.getActionKind('doc_drift');
    assert.ok(k);
    assert.equal(k.requires_llm, false);
    assert.equal(k.cost_envelope, 'free');
    assert.equal(k.blast_radius, 'minimal'); // gh issues only in v1
    assert.equal(k.shipped_in, '0.1.0');
    assert.equal(k.detector, 'detectors/doc-drift.cjs');
  });

  test('Sprint 1.8.7 — todo_triage shipped (gh issue create, no LLM, no file edits)', () => {
    const k = kinds.getActionKind('todo_triage');
    assert.ok(k);
    assert.equal(k.blast_radius, 'minimal');
    assert.equal(k.requires_llm, false);
    assert.equal(k.shipped_in, '0.1.0');
    assert.equal(k.detector, 'detectors/todo-triage.cjs');
  });
});
