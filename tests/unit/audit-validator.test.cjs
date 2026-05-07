// audit-validator.test.cjs — verify-audit-output.cjs catches the 4 failure
// classes that field test #8 (webovky_hustle, 2026-05-07) exposed:
//
//   audit-bad-missing-recs            → blocker: recommendations.md absent
//   audit-bad-orphan-citation         → blocker: [audit: §99] points to nothing
//   audit-bad-missing-projects-entry  → blocker: $CORTEX_DATA_HOME/projects/<slug>.md absent
//   audit-bad-broken-frontmatter      → blocker: phase != '2-audit', slug missing
//
// Plus audit-good → all checks pass.
//
// Each test spawns the validator as a child process with CORTEX_DATA_HOME
// pointed at the matching fixtures' isolated projects/ dir. Asserts both exit
// code AND output content (so we know the right error fires, not just any error).

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'tools', 'verify-audit-output.cjs');
const GOOD_DATA_HOME = path.join(REPO_ROOT, 'tests', 'fixtures', 'audit-good-data-home');
const EMPTY_DATA_HOME = path.join(REPO_ROOT, 'tests', 'fixtures', 'audit-empty-data-home');

function runValidator(fixture, dataHome, extraArgs = []) {
  const projectPath = path.join(REPO_ROOT, 'tests', 'fixtures', fixture);
  return spawnSync(
    process.execPath,
    [VALIDATOR, '--project-path', projectPath, ...extraArgs],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CORTEX_DATA_HOME: dataHome,
        // suppress TTY-detected color so output assertions are deterministic
        NO_COLOR: '1',
      },
    }
  );
}

describe('verify-audit-output', () => {
  test('audit-good passes all checks (exit 0)', () => {
    const r = runValidator('audit-good', GOOD_DATA_HOME);
    if (r.status !== 0) {
      throw new Error(`expected exit 0, got ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Audit output PASSED/);
    assert.match(r.stdout, /\[OK\] cortex\/AUDIT\.md present/);
    assert.match(r.stdout, /\[OK\] cortex\/recommendations\.md present/);
    assert.match(r.stdout, /\[OK\] AUDIT\.md has all 12 dimension sections/);
  });

  test('audit-good --json emits valid structured output', () => {
    const r = runValidator('audit-good', GOOD_DATA_HOME, ['--json']);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'pass');
    assert.equal(out.counts.blocker, 0);
    assert.equal(out.counts.warning, 0);
    assert.ok(Array.isArray(out.checks));
    assert.ok(out.checks.length >= 10);
  });

  test('audit-good --tap emits TAP v14', () => {
    const r = runValidator('audit-good', GOOD_DATA_HOME, ['--tap']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^TAP version 14/);
    assert.match(r.stdout, /^1\.\.\d+/m);
    assert.match(r.stdout, /^ok 1 -/m);
  });

  test('audit-bad-missing-recs catches missing recommendations.md (exit 1)', () => {
    const r = runValidator('audit-bad-missing-recs', GOOD_DATA_HOME);
    assert.equal(r.status, 1);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /recommendations\.md/);
    assert.match(combined, /Audit output FAILED/);
  });

  test('audit-bad-orphan-citation catches §99 → no ## 99. section (exit 1)', () => {
    const r = runValidator('audit-bad-orphan-citation', GOOD_DATA_HOME);
    assert.equal(r.status, 1);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /audit:\s*§99/);
    assert.match(combined, /Audit output FAILED/);
  });

  test('audit-bad-orphan-citation --json reports orphan in checks', () => {
    const r = runValidator('audit-bad-orphan-citation', GOOD_DATA_HOME, ['--json']);
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'fail');
    const orphan = out.checks.find((c) => c.id.startsWith('citations.orphan.'));
    assert.ok(orphan, `expected an citations.orphan.* check, got: ${out.checks.map((c) => c.id).join(', ')}`);
    assert.equal(orphan.status, 'fail');
    assert.match(orphan.message, /audit:\s*§99/);
  });

  test('audit-bad-missing-projects-entry catches missing projects/<slug>.md (exit 1)', () => {
    const r = runValidator('audit-bad-missing-projects-entry', EMPTY_DATA_HOME);
    assert.equal(r.status, 1);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /projects.*audit-good-fixture\.md/);
    assert.match(combined, /Phase 5d contract/);
  });

  test('audit-bad-broken-frontmatter catches wrong phase + missing slug (exit 1)', () => {
    const r = runValidator('audit-bad-broken-frontmatter', GOOD_DATA_HOME);
    assert.equal(r.status, 1);
    const combined = r.stdout + r.stderr;
    assert.match(combined, /phase:\s*'1-detect'.*expected.*'2-audit'/);
  });

  test('--help prints usage and exits 0', () => {
    const r = spawnSync(process.execPath, [VALIDATOR, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /verify-audit-output/);
    assert.match(r.stdout, /USAGE/);
    assert.match(r.stdout, /CHECKS PERFORMED/);
  });
});
