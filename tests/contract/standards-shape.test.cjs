'use strict';

// Tier 7 — black-box contract tests for tools/verify-standards.cjs.
// Mirrors the structure of prompt-shape.test.cjs + skill-shape.test.cjs.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', '..', 'tools', 'verify-standards.cjs');
const STANDARDS_DIR = path.resolve(__dirname, '..', '..', 'standards');

describe('verify-standards: default mode', () => {
  test('default mode exits 0 on clean repo', () => {
    const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  });

  test('--strict exits 0 (no warnings expected for clean repo)', () => {
    const result = spawnSync(process.execPath, [CLI, '--strict'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
  });

  test('--quiet on clean repo emits nothing extra', () => {
    const result = spawnSync(process.execPath, [CLI, '--quiet'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
    // Quiet mode = no per-file OK lines
    assert.equal(result.stdout.trim(), '');
  });
});

describe('verify-standards: --json output', () => {
  test('emits valid structured JSON', () => {
    const result = spawnSync(process.execPath, [CLI, '--json'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.tool, 'verify-standards');
    assert.ok(parsed.summary);
    assert.equal(typeof parsed.summary.blockers, 'number');
    assert.equal(typeof parsed.summary.warnings, 'number');
    assert.ok(parsed.files_scanned >= 10);
    assert.ok(Array.isArray(parsed.findings));
  });
});

describe('verify-standards: --tap output', () => {
  test('emits valid TAP v14', () => {
    const result = spawnSync(process.execPath, [CLI, '--tap'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^TAP version 14/);
    assert.match(result.stdout, /1\.\.\d+/);
    assert.match(result.stdout, /ok \d+ - standards\//);
  });
});

describe('verify-standards: --help', () => {
  test('--help prints usage and exits 0', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--json/);
    assert.match(result.stdout, /--tap/);
  });

  test('-h short flag prints help', () => {
    const result = spawnSync(process.execPath, [CLI, '-h'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });
});

describe('verify-standards: critical-standards inventory', () => {
  test('all critical standards files present', () => {
    const required = [
      'RULE-1.md', 'ssot.md', 'modular.md', 'scalable.md',
      'security.md', 'testing.md', 'observability.md', 'correctness.md',
      'ship-ready.md', 'coding-behavior.md',
      'hermes-policy.md', // Phase 7 policy
    ];
    for (const f of required) {
      const p = path.join(STANDARDS_DIR, f);
      assert.ok(fs.existsSync(p), `standards/${f} must exist`);
      assert.ok(fs.statSync(p).size > 0, `standards/${f} must be non-empty`);
    }
  });
});

describe('verify-standards: --file scoping', () => {
  test('--file scopes to single standard', () => {
    const result = spawnSync(process.execPath, [
      CLI, '--file', 'standards/ssot.md', '--json',
    ], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.files_scanned, 1);
  });
});

describe('verify-standards: synthetic regression cases', () => {
  // These tests prove the validator actually fails when given a broken file.

  test('detects broken markdown link', () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-std-broken-'));
    const stdDir = path.join(tmpRepo, 'standards');
    fs.mkdirSync(stdDir, { recursive: true });
    fs.writeFileSync(
      path.join(stdDir, 'broken.md'),
      '# Broken\n\nSee [missing](./does-not-exist.md).\n',
    );

    // Run the validator with --file pointing at this file
    const result = spawnSync(process.execPath, [
      CLI, '--file', path.join(stdDir, 'broken.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.summary.blockers >= 1);
    assert.ok(parsed.findings.some((f) => f.code === 'BROKEN_LINK'));
    assert.equal(result.status, 1);
  });

  test('detects unbalanced code fences', () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-std-fence-'));
    const stdDir = path.join(tmpRepo, 'standards');
    fs.mkdirSync(stdDir, { recursive: true });
    fs.writeFileSync(
      path.join(stdDir, 'unbalanced.md'),
      '# Unbalanced\n\n```js\nfunction x() {}\n', // missing closing ```
    );

    const result = spawnSync(process.execPath, [
      CLI, '--file', path.join(stdDir, 'unbalanced.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.code === 'UNBALANCED_FENCES'));
    assert.equal(result.status, 1);
  });

  test('detects PII leak (Dave-specific path)', () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-std-pii-'));
    const stdDir = path.join(tmpRepo, 'standards');
    fs.mkdirSync(stdDir, { recursive: true });
    fs.writeFileSync(
      path.join(stdDir, 'pii.md'),
      '# PII\n\nSomething at c:/Users/david/foo\n',
    );

    const result = spawnSync(process.execPath, [
      CLI, '--file', path.join(stdDir, 'pii.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.findings.some((f) => f.code === 'PII_LEAK'));
    assert.equal(result.status, 1);
  });

  test('passes a clean file', () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-std-clean-'));
    const stdDir = path.join(tmpRepo, 'standards');
    fs.mkdirSync(stdDir, { recursive: true });
    fs.writeFileSync(
      path.join(stdDir, 'clean.md'),
      '# Clean\n\nNo broken links, no PII.\n\n```js\nconst x = 1;\n```\n',
    );

    const result = spawnSync(process.execPath, [
      CLI, '--file', path.join(stdDir, 'clean.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.blockers, 0);
    assert.equal(result.status, 0);
  });
});
