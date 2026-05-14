'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractScore } = require('../../tools/summarize-mutation.cjs');

test('extractScore: reads from systemUnderTestMetrics.metrics.mutationScore', () => {
  const report = {
    systemUnderTestMetrics: {
      metrics: { mutationScore: 75.5 },
    },
  };
  assert.equal(extractScore(report), 75.5);
});

test('extractScore: falls back to top-level metrics.mutationScore', () => {
  const report = { metrics: { mutationScore: 88.1 } };
  assert.equal(extractScore(report), 88.1);
});

test('extractScore: returns null when score is missing', () => {
  assert.equal(extractScore({}), null);
  assert.equal(extractScore({ metrics: {} }), null);
  assert.equal(extractScore({ systemUnderTestMetrics: {} }), null);
});

test('extractScore: returns null for non-number score (defensive)', () => {
  assert.equal(extractScore({ metrics: { mutationScore: 'high' } }), null);
  assert.equal(extractScore({ metrics: { mutationScore: NaN } }), null);
  assert.equal(extractScore({ metrics: { mutationScore: Infinity } }), null);
});

test('extractScore: null/undefined input safe', () => {
  assert.equal(extractScore(null), null);
  assert.equal(extractScore(undefined), null);
});
