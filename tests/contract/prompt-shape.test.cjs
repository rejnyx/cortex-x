// prompt-shape.test.cjs — invokes tools/verify-prompts.cjs as black-box.
//
// The validator itself is the source of truth. This test:
//   1. Exercises the validator against the real prompts/ tree
//   2. Asserts non-strict mode (no blocker-severity findings) — current
//      cortex-x state must always be blocker-clean
//   3. Asserts strict mode result is JSON-parseable when --json given
//   4. Validates the validator has a help screen + handles --file flag

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'tools', 'verify-prompts.cjs');

function runValidator(extraArgs = []) {
  return spawnSync(process.execPath, [VALIDATOR, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('verify-prompts: cortex-x prompt tree must be blocker-clean', () => {
  test('default mode (no --strict): no blocker-severity findings (exit 0)', () => {
    const r = runValidator();
    if (r.status !== 0) {
      throw new Error(`exit ${r.status}\nstdout:\n${r.stdout.slice(-2000)}\nstderr:\n${r.stderr.slice(-1000)}`);
    }
    assert.equal(r.status, 0);
  });

  test('--json emits valid structured output', () => {
    const r = runValidator(['--json']);
    assert.ok(r.stdout.length > 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(['pass', 'fail'].includes(parsed.status));
    assert.ok(typeof parsed.counts === 'object');
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.checks.length >= 30,
      `expected >= 30 checks across all prompts; got ${parsed.checks.length}`);
  });

  test('--tap emits TAP v14', () => {
    const r = runValidator(['--tap']);
    assert.match(r.stdout, /^TAP version 14/);
    assert.match(r.stdout, /^1\.\.\d+/m);
  });

  test('--help prints usage and exits 0', () => {
    const r = runValidator(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /verify-prompts/);
    assert.match(r.stdout, /CHECKS/i);
  });

  test('--file scopes to a single prompt', () => {
    const r = runValidator(['--file', 'prompts/cortex-load.md', '--json']);
    const parsed = JSON.parse(r.stdout);
    // Only one file's checks (plus inventory)
    const fileChecks = parsed.checks.filter((c) => c.id.includes('cortex-load.md'));
    assert.ok(fileChecks.length >= 3,
      `expected >= 3 checks for single file; got ${fileChecks.length}`);
    // Should NOT include checks from other prompts
    const otherChecks = parsed.checks.filter(
      (c) => c.id.includes('.md') && !c.id.includes('cortex-load.md')
    );
    assert.equal(otherChecks.length, 0,
      `--file should scope to single prompt; found checks from others: ${otherChecks.map((c) => c.id).slice(0, 5).join(', ')}`);
  });
});

describe('verify-prompts: prompt-tree contract gates', () => {
  test('all critical workflow prompts present', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const REQUIRED = [
      'new-project.md',
      'existing-project-audit.md',
      'project-scan.md',
      'cortex-load.md',
      'cortex-sync.md',
      'cortex-doctor.md',
      'cortex-reflect.md',
    ];
    for (const name of REQUIRED) {
      const found = parsed.checks.find(
        (c) => c.id === `prompts/${name}.exists` && c.status === 'pass'
      );
      assert.ok(found, `Required prompt missing or invalid: prompts/${name}`);
    }
  });

  test('phase-bearing prompts have contiguous phase numbering', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const phaseChecks = parsed.checks.filter((c) => c.id.endsWith('.phases'));
    assert.ok(phaseChecks.length >= 3, 'expected >= 3 phase-bearing prompts');
    for (const c of phaseChecks) {
      assert.equal(c.status, 'pass',
        `phase contiguity check failed: ${c.id} → ${c.message}`);
    }
  });

  test('zero PII / Dave-specific paths across all prompts', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const piiChecks = parsed.checks.filter((c) => c.id.endsWith('.pii'));
    for (const c of piiChecks) {
      assert.equal(c.status, 'pass',
        `PII leak in ${c.id}: ${c.message}`);
    }
  });

  test('all internal markdown links resolve (no 404s in repo-relative paths)', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const linkFailures = parsed.checks.filter(
      (c) => c.id.includes('.link.') && c.status === 'fail'
    );
    assert.equal(linkFailures.length, 0,
      `broken internal links:\n${linkFailures.map((c) => '  ' + c.message).join('\n')}`);
  });
});
