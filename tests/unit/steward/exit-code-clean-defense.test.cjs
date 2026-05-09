'use strict';

// Sprint 2.9.7 — verify defense-layer blocks exit clean (exitCode=0) so
// cron dashboards don't false-fail when SPEC_VIOLATION / autoresearch
// ALL_CANDIDATES_FAILED fires correctly. Result shape stays ok:false +
// code preserved (existing test contract intact).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const autoresearch = require('../../../bin/steward/_lib/autoresearch.cjs');

describe('Sprint 2.9.7 — execute.cjs spec-verifier rollback returns exitCode:0', () => {
  test('SPEC_VIOLATION return literal includes exitCode logic', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    // Find the spec-verifier return block.
    assert.match(src, /cleanRollback = specResult\.code === 'SPEC_VIOLATION'/);
    assert.match(src, /exitCode: cleanRollback \? 0 : 1/);
  });

  test('CLI exit logic uses typeof check (exitCode=0 is honored)', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    // Verify typeof number check (replaces previous truthy `if (result.exitCode)`).
    assert.match(src, /typeof result\.exitCode === 'number'/);
  });

  test('orchestrator propagates applyResult.exitCode when present', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    assert.match(src, /typeof applyResult\.exitCode === 'number'/);
  });
});

describe('Sprint 2.9.7 — autoresearch exitCode flows via orchestrator propagation', () => {
  test('autoresearch sets exitCode:0 in its own return; orchestrator propagates via typeof check', () => {
    // Two-leg architecture: autoresearch.cjs (the helper) sets exitCode:0 on
    // its ALL_CANDIDATES_FAILED return; execute.cjs orchestrator picks up
    // applyResult.exitCode if present. No need to add the code to
    // NO_CANDIDATES_CODES — the propagation path works via exitCode field.
    const orchSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/execute.cjs'),
      'utf8',
    );
    assert.match(orchSrc, /typeof applyResult\.exitCode === 'number'/);
    assert.match(orchSrc, /\? applyResult\.exitCode/);
    const arSrc = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../../../bin/steward/_lib/autoresearch.cjs'),
      'utf8',
    );
    // Find the return object literal containing the code; check that
    // exitCode: 0 appears within ~500 chars (same return block).
    const idx = arSrc.indexOf("code: 'STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED'");
    assert.ok(idx > 0, 'must find ALL_CANDIDATES_FAILED literal');
    const window = arSrc.slice(idx, idx + 500);
    assert.match(window, /exitCode: 0/, 'exitCode: 0 must be in same return block');
  });
});
