// eval-scorer.test.cjs — Sprint 3.0 v0

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const scorer = require('../../bin/steward/_lib/eval-scorer.cjs');

describe('Sprint 3.0 — eval-scorer pure helpers', () => {
  test('mean handles empty array + single element', () => {
    assert.equal(scorer.mean([]), 0);
    assert.equal(scorer.mean([0.5]), 0.5);
    assert.equal(scorer.mean([0, 1]), 0.5);
  });

  test('clamp01 bounds inputs', () => {
    assert.equal(scorer.clamp01(-1), 0);
    assert.equal(scorer.clamp01(2), 1);
    assert.equal(scorer.clamp01(0.5), 0.5);
    assert.equal(scorer.clamp01(NaN), 0);
  });

  test('mulberry32 is deterministic for same seed', () => {
    const a = scorer.mulberry32(42);
    const b = scorer.mulberry32(42);
    for (let i = 0; i < 10; i += 1) assert.equal(a(), b());
  });
});

describe('Sprint 3.0 — bootstrapMeanCI', () => {
  test('single-element returns identical bounds', () => {
    const ci = scorer.bootstrapMeanCI([0.7], { seed: 1, samples: 100 });
    assert.equal(ci.mean, 0.7);
    assert.equal(ci.lower, 0.7);
    assert.equal(ci.upper, 0.7);
    assert.equal(ci.n, 1);
  });

  test('empty array returns zero shape', () => {
    const ci = scorer.bootstrapMeanCI([], { seed: 1 });
    assert.equal(ci.mean, 0);
    assert.equal(ci.n, 0);
  });

  test('uniform-good data: CI tight + lower close to mean', () => {
    const scores = Array.from({ length: 30 }, () => 0.9);
    const ci = scorer.bootstrapMeanCI(scores, { seed: 7, samples: 500 });
    assert.ok(Math.abs(ci.mean - 0.9) < 1e-9);
    assert.ok(Math.abs(ci.lower - 0.9) < 1e-9);
    assert.ok(Math.abs(ci.upper - 0.9) < 1e-9);
  });

  test('mixed data: lower < mean < upper', () => {
    const scores = [0.2, 0.4, 0.5, 0.7, 0.9, 0.3, 0.6, 0.8, 0.4, 0.5];
    const ci = scorer.bootstrapMeanCI(scores, { seed: 11, samples: 2000 });
    assert.ok(ci.lower <= ci.mean, `lower ${ci.lower} should be <= mean ${ci.mean}`);
    assert.ok(ci.upper >= ci.mean, `upper ${ci.upper} should be >= mean ${ci.mean}`);
    assert.ok(ci.upper - ci.lower > 0, 'CI should have non-zero width');
  });

  test('reproducible with same seed', () => {
    const scores = [0.1, 0.5, 0.9, 0.3, 0.7];
    const a = scorer.bootstrapMeanCI(scores, { seed: 42, samples: 500 });
    const b = scorer.bootstrapMeanCI(scores, { seed: 42, samples: 500 });
    assert.equal(a.mean, b.mean);
    assert.equal(a.lower, b.lower);
    assert.equal(a.upper, b.upper);
  });
});

describe('Sprint 3.0 — decideAB rule', () => {
  test('rejects when point-estimate delta too small', () => {
    const champion = { trainScores: [0.7, 0.7, 0.7, 0.7, 0.7] };
    const challenger = { trainScores: [0.71, 0.71, 0.71, 0.71, 0.71] };
    const decision = scorer.decideAB(champion, challenger, { minDelta: 0.05, seed: 1 });
    assert.equal(decision.promote, false);
    assert.equal(decision.reason, 'POINT_ESTIMATE_DELTA_TOO_SMALL');
  });

  test('rejects when challenger lower CI not above champion point estimate', () => {
    // Wide CI on challenger such that its lower bound is below champion mean
    const champion = { trainScores: Array.from({ length: 10 }, () => 0.7) };
    const challenger = { trainScores: [0.5, 0.6, 0.7, 0.8, 0.9, 0.5, 0.6, 0.7, 0.8, 0.9] };
    const decision = scorer.decideAB(champion, challenger, { minDelta: 0.0, seed: 1 });
    assert.equal(decision.promote, false);
    // mean delta > 0 but lower CI bound of challenger still <= champion mean
  });

  test('promotes when challenger meets all 3 criteria', () => {
    const champion = { trainScores: Array.from({ length: 30 }, () => 0.5) };
    const challenger = { trainScores: Array.from({ length: 30 }, () => 0.9) };
    const decision = scorer.decideAB(champion, challenger, { minDelta: 0.05, seed: 1 });
    assert.equal(decision.promote, true);
    assert.equal(decision.reason, 'CHALLENGER_BEATS_CHAMPION');
  });

  test('rejects when validation spec_pass_rate regresses', () => {
    const champion = {
      trainScores: Array.from({ length: 30 }, () => 0.5),
      specPassRateValidation: 0.9,
    };
    const challenger = {
      trainScores: Array.from({ length: 30 }, () => 0.9),
      specPassRateValidation: 0.7, // dropped
    };
    const decision = scorer.decideAB(champion, challenger, { minDelta: 0.05, seed: 1 });
    assert.equal(decision.promote, false);
    assert.equal(decision.reason, 'CHALLENGER_VALIDATION_SPEC_REGRESSION');
  });

  test('emits directional_only_warning when N < 50 per condition', () => {
    const champion = { trainScores: Array.from({ length: 10 }, () => 0.5) };
    const challenger = { trainScores: Array.from({ length: 10 }, () => 0.9) };
    const decision = scorer.decideAB(champion, challenger, { minDelta: 0.05, seed: 1 });
    assert.equal(decision.promote, true);
    assert.ok(decision.evidence.directional_only_warning);
    assert.match(decision.evidence.directional_only_warning, /directional/);
  });

  test('handles missing input shape', () => {
    const decision = scorer.decideAB(null, null);
    assert.equal(decision.promote, false);
    assert.equal(decision.reason, 'INVALID_INPUT');
  });
});

describe('Sprint 3.0 — aggregateByTask', () => {
  test('groups trials by task_id and computes per-task means + pass_rate', () => {
    const rows = [
      { task_id: 'eval-001', score: 1.0, spec_pass: true },
      { task_id: 'eval-001', score: 0.5, spec_pass: true },
      { task_id: 'eval-002', score: 1.0, spec_pass: false },
    ];
    const out = scorer.aggregateByTask(rows);
    assert.equal(out.length, 2);
    const t1 = out.find((t) => t.task_id === 'eval-001');
    assert.equal(t1.trials, 2);
    assert.equal(t1.mean_score, 0.75);
    assert.equal(t1.pass_rate, 0.5); // 1 of 2 trials scored ≥0.99
    assert.equal(t1.spec_pass_rate, 1);
  });
});
