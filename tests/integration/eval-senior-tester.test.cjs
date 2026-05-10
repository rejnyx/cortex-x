// Sprint 2.11.2 — eval-senior-tester end-to-end gate.
//
// CI lane: every PR runs this; if any baseline drifts, the PR fails until
// the operator either fixes the detector regression or commits an updated
// (manually re-reviewed) baseline.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const runner = require('../../tools/eval-senior-tester.cjs');

describe('Sprint 2.11.2 — senior-tester eval suite end-to-end', () => {
  test('all 5 fixtures pass against locked baselines', () => {
    const failures = [];
    for (const name of runner.FIXTURE_NAMES) {
      const r = runner.evalFixture(name);
      if (!r.ok) {
        failures.push({
          fixture: r.fixture,
          error: r.error,
          missing: r.diff?.missing || [],
          extra: r.diff?.extra || [],
        });
      }
    }
    if (failures.length > 0) {
      const dump = JSON.stringify(failures, null, 2);
      assert.fail(`Eval baselines drifted:\n${dump}\n\nIf the change is intentional, run \`node tools/eval-senior-tester.cjs --write-baseline\`, manually verify the diff, and commit the new baseline in this PR.`);
    }
  });

  test('every fixture has a baseline.sarif.json', () => {
    for (const name of runner.FIXTURE_NAMES) {
      const p = path.join(runner.FIXTURES_DIR, name, 'baseline.sarif.json');
      assert.ok(fs.existsSync(p), `missing baseline: ${p}`);
    }
  });

  test('e2e-heavy fixture surfaces ice_cream_cone anti-pattern in layer-balance block', () => {
    const sarif = JSON.parse(
      fs.readFileSync(path.join(runner.FIXTURES_DIR, 'e2e-heavy', 'baseline.sarif.json'), 'utf8'),
    );
    const lb = sarif.runs[0].properties.cortex_x.layerBalance;
    assert.ok(Array.isArray(lb.anti_patterns));
    const cone = lb.anti_patterns.find((p) => p.id === 'ice_cream_cone');
    assert.ok(cone, 'expected ice_cream_cone in layer_balance.anti_patterns');
    assert.equal(cone.severity, 'high');
  });

  test('clean fixture produces zero findings (false-positive control)', () => {
    const sarif = JSON.parse(
      fs.readFileSync(path.join(runner.FIXTURES_DIR, 'clean', 'baseline.sarif.json'), 'utf8'),
    );
    assert.equal(sarif.runs[0].results.length, 0,
      'clean fixture must produce 0 findings; any non-zero count is a false-positive regression');
  });

  test('detectorVersion matches runner version across all baselines', () => {
    for (const name of runner.FIXTURE_NAMES) {
      const sarif = JSON.parse(
        fs.readFileSync(path.join(runner.FIXTURES_DIR, name, 'baseline.sarif.json'), 'utf8'),
      );
      assert.equal(
        sarif.runs[0].properties.cortex_x.detectorVersion,
        runner.DETECTOR_VERSION,
        `${name}: detectorVersion mismatch — runner is ${runner.DETECTOR_VERSION}`,
      );
    }
  });
});
