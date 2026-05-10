'use strict';

// Fixture for cortex-x senior_tester_review eval suite.
// Independence smells: mystery_guest + sleepy_test + hidden_io +
// no_reproducibility_marker. Expected baseline:
// evals/senior-tester/fixtures/state-coupling/baseline.sarif.json.
//
// R2 edge-hunter HIGH: this file is excluded from `npm test` via the
// `tests/**/*.test.cjs` scope in package.json. If a downstream consumer's
// CI matrix uses a permissive `**/*.test.cjs` glob, the early-exit guard
// below neutralizes accidental execution — Sprint 2.11.2 fixture is for
// static-text scanning by the senior-tester detector, not runtime
// execution. The detector reads source verbatim; the guard never runs
// from its perspective.
if (process.env.CORTEX_EVAL_FIXTURE_RUN !== '1') {
  // Stub the test runner so the rest of the file executes without effect.
  // Detector regex catalogue still matches the source patterns below.
  module.exports = { skipped: true };
  return;
}

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

describe('state-coupling smells', () => {
  // mystery_guest — reaches filesystem outside fixtures/, no in-test data
  test('reads external config file', () => {
    const buf = fs.readFileSync('../config/runtime.json', 'utf8');
    assert.ok(buf.length > 0);
  });

  // sleepy_test — uses setTimeout to wait
  test('flaky timer-based wait', async () => {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(Date.now() - start >= 50);
  });

  // hidden_io — uses fetch to network
  test('hidden network call without mock', async () => {
    const r = await fetch('https://api.example.com/health');
    assert.ok(r);
  });

  // no_reproducibility_marker — Math.random with no seed
  test('random without seed', () => {
    const x = Math.random() * 100;
    assert.ok(x >= 0);
    assert.ok(x < 100);
  });
});
