'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = require('../../../bin/cortex-hermes.cjs');

const FIXTURE_SRC = path.resolve(__dirname, '..', '..', 'fixtures', 'hermes-dryrun');
const SLUG = 'hermes-dryrun';
const CLI_PATH = path.resolve(__dirname, '..', '..', '..', 'bin', 'cortex-hermes.cjs');

function freshFixture(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cli-disp-${prefix}-`));
  copyDir(FIXTURE_SRC, tmp);
  return tmp;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

describe('cortex-hermes: help + version', () => {
  test('no args prints help and exits 0', () => {
    const result = spawnSync(process.execPath, [CLI_PATH], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /Subcommands:/);
    assert.match(result.stdout, /dry-run/);
    assert.match(result.stdout, /status/);
  });

  test('--help flag prints help', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  test('-h short flag prints help', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, '-h'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  test('help subcommand prints help', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
  });

  test('--version prints version line', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, '--version'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^cortex-hermes \S+/);
  });

  test('readVersion reads package.json', () => {
    const v = cli.readVersion();
    assert.match(v, /^\d/);
  });
});

describe('cortex-hermes: subcommand dispatch', () => {
  test('dry-run dispatches to bin/hermes/dry-run.cjs', () => {
    const repoRoot = freshFixture('disp-dry');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-disp-data-'));

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'dry-run', `--slug=${SLUG}`, `--repo-root=${repoRoot}`, '--json',
    ], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'dry-run');
  });

  test('status dispatches to bin/hermes/status.cjs', () => {
    const repoRoot = freshFixture('disp-status');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-disp-data-'));

    const result = spawnSync(process.execPath, [
      CLI_PATH, 'status', `--slug=${SLUG}`, `--repo-root=${repoRoot}`, '--json',
    ], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.slug, SLUG);
  });
});

describe('cortex-hermes: error paths', () => {
  test('unknown subcommand exits 1 with hint', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'frobnicate'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown subcommand/);
    assert.match(result.stderr, /cortex-hermes help/);
  });

  test('SUBCOMMANDS exposes dispatch table', () => {
    assert.ok(cli.SUBCOMMANDS['dry-run']);
    assert.ok(cli.SUBCOMMANDS['status']);
    assert.ok(cli.SUBCOMMANDS['execute']);
  });

  test('execute subcommand is reachable via dispatcher (returns 64 stub)', () => {
    const result = spawnSync(process.execPath, [CLI_PATH, 'execute', '--json'], {
      encoding: 'utf8', timeout: 5000,
    });
    // Without --plan-file the inner CLI exits 1 (MISSING_PLAN_FILE),
    // dispatcher passes through. Either way it shouldn't hang.
    assert.ok(result.status === 1 || result.status === 64,
      `expected exit 1 or 64, got ${result.status}; stdout: ${result.stdout}`);
  });
});
