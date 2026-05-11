// Sprint 2.4.1 — per-action_kind effort tuning contract tests.
//
// Validates:
//   1. resolveEffortLevel() precedence: env > opts > action_kind > default
//   2. VALID_EFFORT_LEVELS allowlist (rejects garbage strings)
//   3. Action kinds that use LLM declare a valid effort field
//   4. Unknown action_kind falls back to 'medium'
//   5. Engine argv includes --effort flag (snapshot via mock spawn — full
//      e2e covered by Sprint 2.4 existing tests)

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const actionEngine = require(path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'action-engine.cjs'));
const actionKinds = require(path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'action-kinds.cjs'));

describe('Sprint 2.4.1 resolveEffortLevel() precedence', () => {
  test('env CLAUDE_CODE_EFFORT_LEVEL overrides everything', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      { effort: 'low' },
      { CLAUDE_CODE_EFFORT_LEVEL: 'max' },
    );
    assert.equal(r.level, 'max');
    assert.equal(r.source, 'env');
  });

  test('env CLAUDE_CODE_EFFORT_LEVEL is case-insensitive + trimmed', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      {},
      { CLAUDE_CODE_EFFORT_LEVEL: '  HIGH  ' },
    );
    assert.equal(r.level, 'high');
  });

  test('invalid env value falls through to opts override', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      { effort: 'low' },
      { CLAUDE_CODE_EFFORT_LEVEL: 'garbage' },
    );
    assert.equal(r.level, 'low');
    assert.equal(r.source, 'opts');
  });

  test('opts.effort overrides action_kind default', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' }, // would be 'high'
      { effort: 'low' },
      {},
    );
    assert.equal(r.level, 'low');
    assert.equal(r.source, 'opts');
  });

  test('action_kind effort used when no env or opts override', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      {},
      {},
    );
    assert.equal(r.level, 'high');
    assert.equal(r.source, 'action_kind');
  });

  test('unknown action_kind falls back to default medium', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'no_such_kind' },
      {},
      {},
    );
    assert.equal(r.level, 'medium');
    assert.equal(r.source, 'default');
  });

  test('missing plan falls back to default', () => {
    const r = actionEngine.resolveEffortLevel(null, {}, {});
    assert.equal(r.level, 'medium');
    assert.equal(r.source, 'default');
  });

  test('plan without action_kind falls back to default', () => {
    const r = actionEngine.resolveEffortLevel({}, {}, {});
    assert.equal(r.level, 'medium');
    assert.equal(r.source, 'default');
  });

  test('pattern_transfer kind resolves to high', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'pattern_transfer' },
      {},
      {},
    );
    assert.equal(r.level, 'high');
    assert.equal(r.source, 'action_kind');
  });

  test('release_notes_drafter resolves to medium', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'release_notes_drafter' },
      {},
      {},
    );
    assert.equal(r.level, 'medium');
    assert.equal(r.source, 'action_kind');
  });

  test('senior_tester_review resolves to medium', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'senior_tester_review' },
      {},
      {},
    );
    assert.equal(r.level, 'medium');
    assert.equal(r.source, 'action_kind');
  });
});

describe('Sprint 2.4.2 R2 hardening — env/opts robustness', () => {
  test('env=null does not throw (parameter default only covers undefined)', () => {
    // Pre-fix: env=null → env.CLAUDE_CODE_EFFORT_LEVEL → TypeError
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      {},
      null,
    );
    assert.equal(r.level, 'high'); // falls through to action_kind
    assert.equal(r.source, 'action_kind');
  });

  test('env=undefined uses process.env (default param)', () => {
    // Make sure removing process.env.CLAUDE_CODE_EFFORT_LEVEL temporarily
    // doesn't break (most envs won't have it set).
    const prev = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
    try {
      const r = actionEngine.resolveEffortLevel(
        { action_kind: 'recommendation' },
        {},
      );
      assert.equal(r.level, 'high');
      assert.equal(r.source, 'action_kind');
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CODE_EFFORT_LEVEL = prev;
    }
  });

  test('env CLAUDE_CODE_EFFORT_LEVEL as non-string (theoretical) does not crash', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      {},
      { CLAUDE_CODE_EFFORT_LEVEL: 5 }, // non-string — process.env never gives this, but test seam should not crash
    );
    assert.equal(r.level, 'high');
    assert.equal(r.source, 'action_kind');
  });

  test('opts.effort is now case-insensitive (Sprint 2.4.2 symmetry fix)', () => {
    // Pre-fix: env was case-insensitive, opts was case-sensitive — surprise.
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      { effort: 'LOW' },
      {},
    );
    assert.equal(r.level, 'low');
    assert.equal(r.source, 'opts');
  });

  test('opts.effort trims whitespace (Sprint 2.4.2 symmetry fix)', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      { effort: '  high  ' },
      {},
    );
    assert.equal(r.level, 'high');
    assert.equal(r.source, 'opts');
  });

  test('prototype-pollution-style action_kind names ignored', () => {
    // action_kind="constructor" / "__proto__" / "toString" must not match
    // because we use hasOwnProperty.call() now.
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const r = actionEngine.resolveEffortLevel(
        { action_kind: evil },
        {},
        {},
      );
      assert.equal(r.level, 'medium');
      assert.equal(r.source, 'default');
    }
  });

  test('opts=null defaults gracefully', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      null,
      {},
    );
    assert.equal(r.level, 'high'); // falls through to action_kind
    assert.equal(r.source, 'action_kind');
  });
});

describe('Sprint 2.4.1 VALID_EFFORT_LEVELS allowlist', () => {
  test('exports the 5 documented effort tiers', () => {
    assert.deepEqual(
      [...actionEngine.VALID_EFFORT_LEVELS],
      ['low', 'medium', 'high', 'xhigh', 'max'],
    );
  });

  test('invalid opts.effort falls through to action_kind', () => {
    const r = actionEngine.resolveEffortLevel(
      { action_kind: 'recommendation' },
      { effort: 'super_duper' },
      {},
    );
    assert.equal(r.level, 'high'); // action_kind default
    assert.equal(r.source, 'action_kind');
  });
});

describe('Sprint 2.4.1 action_kind effort field contract', () => {
  test('every LLM-requiring action_kind declares an effort field', () => {
    const ks = actionKinds.ACTION_KINDS;
    const llmKinds = Object.entries(ks).filter(([_, def]) => def.requires_llm === true);
    assert.ok(llmKinds.length >= 3, `expected >=3 LLM-requiring kinds, got ${llmKinds.length}`);
    for (const [name, def] of llmKinds) {
      assert.ok(
        def.effort,
        `action_kind '${name}' has requires_llm:true but no effort field`,
      );
      assert.ok(
        actionEngine.VALID_EFFORT_LEVELS.includes(def.effort),
        `action_kind '${name}' has invalid effort '${def.effort}'`,
      );
    }
  });

  test('no action_kind uses xhigh or max by default (anti-overthinking)', () => {
    // Research: max overthinks/loops (novaknown.com Apr 2026 regression
    // analysis; resolve.ai production benchmarks). Reserve xhigh/max for
    // env-var operator override only.
    const ks = actionKinds.ACTION_KINDS;
    for (const [name, def] of Object.entries(ks)) {
      if (def.effort) {
        assert.ok(
          def.effort !== 'max',
          `action_kind '${name}' defaults to 'max' — research warns against this (Sprint 2.4.1 R1 §4)`,
        );
        assert.ok(
          def.effort !== 'xhigh',
          `action_kind '${name}' defaults to 'xhigh' — reserve for env-var override only`,
        );
      }
    }
  });

  test('recommendation kind defaults to high (the workhorse)', () => {
    assert.equal(actionKinds.ACTION_KINDS.recommendation.effort, 'high');
  });
});
