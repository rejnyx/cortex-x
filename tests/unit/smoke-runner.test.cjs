// smoke-runner.test.cjs — proves the test runner starts on this platform.
//
// This is the absolute baseline: if this fails, no other test will run, and
// the contributor knows their Node install is broken before they read deeper
// failures. Keep it tiny (no fs, no spawn, no fixtures).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('node --test runner is operational', () => {
  assert.equal(1 + 1, 2);
});

test('Node version meets engine floor (>=22)', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 22, `Expected Node >=22, got ${process.versions.node}`);
});

test('require() of internal helpers does not throw', () => {
  // Catches typos / missing files in the helper layer before any real test
  // imports them.
  assert.doesNotThrow(() => require('../_helpers/snapshot-helpers.cjs'));
  assert.doesNotThrow(() => require('../_helpers/fixture-utils.cjs'));
  assert.doesNotThrow(() => require('../_helpers/run-detector.cjs'));
  assert.doesNotThrow(() => require('../../tools/lib/resolve-cortex-home.cjs'));
});
