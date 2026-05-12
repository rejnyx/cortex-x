'use strict';

// Sprint 2.9.7 — verify defense-layer blocks exit clean (exitCode=0) so
// cron dashboards don't false-fail when SPEC_VIOLATION / autoresearch
// ALL_CANDIDATES_FAILED fires correctly. Result shape stays ok:false +
// code preserved (existing test contract intact).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('Sprint 2.9.7 — execute.cjs spec-verifier rollback returns exitCode:0', () => {
  test('SPEC_VIOLATION return literal includes exitCode logic', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    // Find the spec-verifier return block. Match cleanRollback assignment whose
    // RHS includes the SPEC_VIOLATION literal (Sprint 2.18 widened the RHS to
    // also include SPEC_READ_SET_INCOMPLETE — both are defense-working signals,
    // both must roll back clean).
    assert.match(src, /cleanRollback\s*=[\s\S]{0,200}?specResult\.code === 'SPEC_VIOLATION'/);
    assert.match(src, /specResult\.code === 'SPEC_READ_SET_INCOMPLETE'/);
    assert.match(src, /exitCode: cleanRollback \? 0 : 1/);
  });

  test('Sprint 2.9.7a: validExitCodeOrDefault helper rejects NaN/Infinity/oversize ints', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    // Helper definition.
    assert.match(src, /function validExitCodeOrDefault\(value, fallback\)/);
    assert.match(src, /Number\.isInteger\(value\) && value >= 0 && value <= 255/);
    // CLI exit calls into the helper.
    assert.match(src, /process\.exit\(validExitCodeOrDefault\(result\.exitCode, 1\)\)/);
    // Orchestrator propagation calls into the helper.
    assert.match(src, /validExitCodeOrDefault\(applyResult\.exitCode, fallbackExitCode\)/);
  });

  test('Sprint 2.9.7a: helper actually validates correctly', () => {
    // Re-exec the helper logic in isolation so we don't have to require the
    // full execute module (which has expensive top-level requires).
    function validExitCodeOrDefault(value, fallback) {
      if (Number.isInteger(value) && value >= 0 && value <= 255) return value;
      return fallback;
    }
    assert.equal(validExitCodeOrDefault(0, 1), 0);
    assert.equal(validExitCodeOrDefault(255, 1), 255);
    assert.equal(validExitCodeOrDefault(NaN, 1), 1);
    assert.equal(validExitCodeOrDefault(Infinity, 1), 1);
    assert.equal(validExitCodeOrDefault(-1, 1), 1);
    assert.equal(validExitCodeOrDefault(256, 1), 1);
    assert.equal(validExitCodeOrDefault(3.7, 1), 1);
    assert.equal(validExitCodeOrDefault(undefined, 1), 1);
    assert.equal(validExitCodeOrDefault(null, 1), 1);
    assert.equal(validExitCodeOrDefault('0', 1), 1);
  });
});

describe('Sprint 2.9.7 — autoresearch exitCode flows via orchestrator propagation', () => {
  test('autoresearch sets exitCode:0 in its own return; orchestrator validates + propagates', () => {
    const orchSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    // Orchestrator calls validExitCodeOrDefault(applyResult.exitCode, fallbackExitCode).
    assert.match(orchSrc, /validExitCodeOrDefault\(applyResult\.exitCode/);
    const arSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/_lib/autoresearch.cjs'),
      'utf8',
    );
    // Find the return object literal containing the code; exitCode: 0 must
    // appear within ~500 chars (same return block).
    const idx = arSrc.indexOf("code: 'STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED'");
    assert.ok(idx >= 0, 'must find ALL_CANDIDATES_FAILED literal');
    const window = arSrc.slice(idx, idx + 500);
    assert.match(window, /exitCode: 0/, 'exitCode: 0 must be in same return block');
  });
});
