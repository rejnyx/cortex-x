// skill-shape.test.cjs — invokes tools/verify-skills.cjs as black-box.
//
// Asserts cortex-x SKILL.md tree complies with agentskills.io spec.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'tools', 'verify-skills.cjs');

function runValidator(extraArgs = []) {
  return spawnSync(process.execPath, [VALIDATOR, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('verify-skills: cortex-x SKILL.md tree must be agentskills.io-compliant', () => {
  test('default mode: no blocker findings (exit 0)', () => {
    const r = runValidator();
    if (r.status !== 0) {
      throw new Error(`exit ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    assert.equal(r.status, 0);
  });

  test('--strict mode: no warnings either (exit 0)', () => {
    const r = runValidator(['--strict']);
    if (r.status !== 0) {
      throw new Error(`strict mode failed; stdout:\n${r.stdout}`);
    }
    assert.equal(r.status, 0);
  });

  test('--json emits valid structured output', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    assert.ok(['pass', 'fail'].includes(parsed.status));
    assert.ok(typeof parsed.counts === 'object');
    assert.ok(Array.isArray(parsed.checks));
  });

  test('--help prints usage', () => {
    const r = runValidator(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /verify-skills/);
    assert.match(r.stdout, /agentskills\.io/);
  });
});

describe('verify-skills: spec invariants for cortex-x skills', () => {
  test('all critical skills present (cortex-init, audit, start)', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const REQUIRED = ['cortex-init', 'audit', 'start'];
    for (const name of REQUIRED) {
      const found = parsed.checks.find(
        (c) => c.id === `skills/${name}.exists` && c.status === 'pass'
      );
      assert.ok(found, `Required skill missing: ${name}`);
    }
  });

  test('every skill name matches its parent directory (agentskills.io requirement)', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const nameMatchChecks = parsed.checks.filter((c) => c.id.endsWith('.name'));
    assert.ok(nameMatchChecks.length >= 3, 'expected >= 3 skills');
    for (const c of nameMatchChecks) {
      assert.equal(c.status, 'pass',
        `name-vs-dir mismatch: ${c.id} → ${c.message}`);
    }
  });

  test('every skill has substantive description (>= 30 chars)', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const descChecks = parsed.checks.filter((c) => c.id.endsWith('.description'));
    for (const c of descChecks) {
      assert.equal(c.status, 'pass',
        `description issue: ${c.id} → ${c.message}`);
    }
  });

  test('zero PII leaks across all skills', () => {
    const r = runValidator(['--json']);
    const parsed = JSON.parse(r.stdout);
    const piiChecks = parsed.checks.filter((c) => c.id.endsWith('.pii'));
    for (const c of piiChecks) {
      assert.equal(c.status, 'pass', `PII leak: ${c.id} → ${c.message}`);
    }
  });
});
