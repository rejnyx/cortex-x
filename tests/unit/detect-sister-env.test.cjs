// detect-sister-env.test.cjs — sister-env detector smoke + shape contract.
//
// detect-sister-env.cjs scans sibling directories for shared env-var flags
// (e.g., REPO_A and REPO_B both use OPENAI_API_KEY → flag the relationship).
// We can't easily build a "siblings" fixture in tests/fixtures/ without
// polluting the layout, so this test is intentionally a smoke + shape test:
// detector must run against any fixture without crashing and emit valid JSON
// with the documented fields.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runDetector } = require('../_helpers/run-detector.cjs');

const FIXTURES_TO_PROBE = [
  'tests/fixtures/nextjs-saas-mini',
  'tests/fixtures/minimal-mini',
  'tests/fixtures/monorepo-edge',
];

for (const fixture of FIXTURES_TO_PROBE) {
  test(`detect-sister-env: returns valid shape for ${fixture}`, () => {
    const r = runDetector('sister-env', fixture);
    assert.ok(typeof r === 'object', 'detector must return an object');
    assert.ok(r.target && typeof r.target === 'object');
    assert.ok(typeof r.target.cwd === 'string');
    assert.ok(Array.isArray(r.target.env_flags));
    assert.equal(typeof r.siblings_scanned, 'number');
    assert.ok(Array.isArray(r.sibling_projects));
    assert.ok(r.shared_env && typeof r.shared_env === 'object');
    assert.ok(Array.isArray(r.suggested_additions));
    assert.equal(typeof r.threshold, 'number');
    assert.equal(typeof r.elapsed_ms, 'number');
    assert.ok(r.elapsed_ms < 1000, `detector must run in <1s, took ${r.elapsed_ms}ms`);
  });
}

test('detect-sister-env: target.cwd reflects the --cwd argument', () => {
  const r = runDetector('sister-env', 'tests/fixtures/nextjs-saas-mini');
  // The detector echoes back the cwd it was given (it may be relative or
  // absolute depending on resolution; we just assert it's not empty).
  assert.ok(r.target.cwd.length > 0);
  assert.ok(r.target.cwd.includes('nextjs-saas-mini'));
});
