'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const verifier = require('../../../bin/steward/_lib/verifier.cjs');

function tmpProject(scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-fixture',
    private: true,
    scripts: scripts || { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  return dir;
}

describe('verifier: runNpmTest', () => {
  test('returns ok=true when npm test exits 0', () => {
    const repoRoot = tmpProject({ test: 'node -e "process.exit(0)"' });
    const result = verifier.runNpmTest({ repoRoot });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
  });

  test('returns ok=false when npm test exits non-zero', () => {
    const repoRoot = tmpProject({ test: 'node -e "process.exit(1)"' });
    const result = verifier.runNpmTest({ repoRoot });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
  });

  test('captures stdout', () => {
    const repoRoot = tmpProject({ test: 'node -e "console.log(\'HELLO_FROM_TEST\')"' });
    const result = verifier.runNpmTest({ repoRoot });
    assert.match(result.stdout, /HELLO_FROM_TEST/);
  });

  test('returns durationMs', () => {
    const repoRoot = tmpProject({ test: 'node -e "process.exit(0)"' });
    const result = verifier.runNpmTest({ repoRoot });
    assert.ok(typeof result.durationMs === 'number');
    assert.ok(result.durationMs >= 0);
  });

  test('respects timeoutMs', () => {
    const repoRoot = tmpProject({
      test: 'node -e "setTimeout(() => process.exit(0), 5000)"',
    });
    const result = verifier.runNpmTest({ repoRoot, timeoutMs: 500 });
    assert.equal(result.ok, false);
    // Either timedOut=true OR exit code != 0 — both are acceptable
    assert.ok(result.timedOut === true || (result.exitCode !== 0 && result.exitCode !== null));
  });
});

describe('verifier: runNpmScript', () => {
  test('runs an arbitrary npm script', () => {
    const repoRoot = tmpProject({
      test: 'node -e "process.exit(0)"',
      lint: 'node -e "console.log(\'LINT_OK\')"',
    });
    const result = verifier.runNpmScript('lint', { repoRoot });
    assert.equal(result.ok, true);
    assert.match(result.stdout, /LINT_OK/);
  });
});

describe('verifier: summarizeResult', () => {
  test('handles node:test pass output', () => {
    const summary = verifier.summarizeResult({
      ok: true, exitCode: 0, durationMs: 8500,
      stdout: 'ℹ tests 192\nℹ pass 192\nℹ fail 0\n',
      stderr: '',
    });
    assert.match(summary, /192\/192 pass/);
    assert.match(summary, /8\.5s/);
  });

  test('handles node:test fail output', () => {
    const summary = verifier.summarizeResult({
      ok: false, exitCode: 1, durationMs: 4200,
      stdout: 'ℹ tests 50\nℹ pass 47\nℹ fail 3\n',
      stderr: '',
    });
    assert.match(summary, /47 pass \/ 3 fail/);
  });

  test('handles timeout', () => {
    const summary = verifier.summarizeResult({
      ok: false, timedOut: true, durationMs: 300000,
      stdout: '', stderr: '',
    });
    assert.match(summary, /TIMEOUT/);
    assert.match(summary, /300\.0s/);
  });

  test('handles spawn error', () => {
    const summary = verifier.summarizeResult({
      ok: false, error: 'ENOENT: npm not found', durationMs: 5,
    });
    assert.match(summary, /ERROR ENOENT/);
  });
});
