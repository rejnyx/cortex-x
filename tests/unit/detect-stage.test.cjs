// detect-stage.test.cjs — stage classifier matches synthetic git histories.
//
// Stage fixtures are built lazily via `buildStageFixture(name, commitCount)`
// in a `before()` hook so the test suite runs even on a fresh checkout where
// the .git/ folders don't yet exist. fixture-utils uses git plumbing with
// hard-coded GIT_AUTHOR_* env vars — never touches the user's global config.

'use strict';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { runDetector } = require('../_helpers/run-detector.cjs');
const { buildStageFixture } = require('../_helpers/fixture-utils.cjs');

before(() => {
  // Idempotent — only rebuilds if commit count differs from target.
  buildStageFixture('stage-greenfield', 0);
  buildStageFixture('stage-prototype', 30);
  buildStageFixture('stage-mvp', 100);
});

test('detect-stage: greenfield (0 commits)', () => {
  const r = runDetector('stage', 'tests/fixtures/stage-greenfield');
  assert.equal(r.stage, 'greenfield', `got ${r.stage} (evidence: ${r.evidence.join(', ')})`);
  assert.ok(r.confidence >= 0.5);
});

test('detect-stage: prototype (30 commits, no infra)', () => {
  const r = runDetector('stage', 'tests/fixtures/stage-prototype');
  assert.equal(r.stage, 'prototype', `got ${r.stage} (evidence: ${r.evidence.join(', ')})`);
  assert.ok(r.confidence >= 0.5);
});

test('detect-stage: mvp (100 commits + tests/ + .github/workflows/ + vercel.json)', () => {
  const r = runDetector('stage', 'tests/fixtures/stage-mvp');
  assert.equal(r.stage, 'mvp', `got ${r.stage} (evidence: ${r.evidence.join(', ')})`);
  assert.ok(r.confidence >= 0.6);
});

test('detect-stage: returns valid shape on any fixture', () => {
  // Run against a profile fixture (not stage-specific) — should still emit
  // valid output (deterministic guarantee per auto-optimization.md).
  const r = runDetector('stage', 'tests/fixtures/minimal-mini');
  assert.ok(typeof r.stage === 'string');
  assert.ok(['greenfield', 'prototype', 'mvp', 'growth', 'mature'].includes(r.stage));
  assert.ok(typeof r.confidence === 'number');
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.ok(Array.isArray(r.evidence));
});
