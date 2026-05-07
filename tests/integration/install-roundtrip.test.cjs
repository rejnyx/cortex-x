// install-roundtrip.test.cjs — install.sh idempotency + verifier integration.
//
// Spawns install.sh into an isolated $HOME (tmpdir/.claude-test), then runs
// verify-install.cjs against that isolated tree. Repeats to confirm the
// install is idempotent (re-running install.sh on an existing install must
// not corrupt it).
//
// Why integration not unit: this exercises the FULL pipeline — bash/pwsh
// invocation, file copies, cygpath translation, BOM safety, verifier exit
// codes — in one test. The unit-style alternative (mocking everything) would
// have higher line coverage but lower confidence.
//
// Skipped automatically:
//   - on Windows pwsh-only environments (we test the bash path here; ps1 path
//     is exercised separately in the GitHub Actions matrix `win-pwsh7` lane)
//   - if `bash` is unavailable on PATH

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VERIFIER = path.join(REPO_ROOT, 'tests', 'smoke', 'verify-install.cjs');

function bashAvailable() {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function makeIsolatedHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-install-test-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cortex'), { recursive: true });
  return dir;
}

function rmIfExists(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function runInstall(isolatedHome) {
  return spawnSync('bash', [path.join(REPO_ROOT, 'install.sh')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: isolatedHome,
      // Force non-interactive — install.sh has a TTY-gated language prompt.
      CORTEX_LANGUAGE: 'en',
      // Pin source dir so script doesn't try to git-pull during test.
      CORTEX_HOME: REPO_ROOT,
      CORTEX_NO_UPDATE: '1',
      CORTEX_DATA_HOME: path.join(isolatedHome, '.cortex'),
    },
  });
}

function runVerifier(isolatedHome, jsonMode = false) {
  return spawnSync(process.execPath, [VERIFIER, ...(jsonMode ? ['--json'] : [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,  // Windows
      CORTEX_DATA_HOME: path.join(isolatedHome, '.cortex'),
    },
  });
}

describe('install.sh roundtrip', { skip: !bashAvailable() }, () => {
  let isolatedHome;

  before(() => {
    isolatedHome = makeIsolatedHome();
  });

  after(() => {
    rmIfExists(isolatedHome);
  });

  test('first install completes successfully', () => {
    const r = runInstall(isolatedHome);
    if (r.status !== 0) {
      throw new Error(`install.sh exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    assert.equal(r.status, 0);
  });

  test('verifier passes after first install', () => {
    const r = runVerifier(isolatedHome);
    if (r.status !== 0) {
      throw new Error(`verifier exited ${r.status}\n${r.stdout}\n${r.stderr}`);
    }
    assert.equal(r.status, 0);
  });

  test('verifier --json emits valid structured output', () => {
    const r = runVerifier(isolatedHome, true);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'pass');
    assert.ok(Array.isArray(out.checks));
    assert.ok(out.checks.length >= 25, `expected >= 25 checks, got ${out.checks.length}`);
  });

  test('second install is idempotent', () => {
    // Re-run install.sh on the existing isolated home. Must not break state.
    const r = runInstall(isolatedHome);
    if (r.status !== 0) {
      throw new Error(`re-install exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    assert.equal(r.status, 0);

    // verifier must still pass
    const v = runVerifier(isolatedHome);
    assert.equal(v.status, 0);
  });

  test('backup rotation keeps exactly one shared.backup-*', () => {
    // Two installs already ran (first + idempotent re-run). Third install
    // creates a third backup; rotation should retain only the most recent.
    runInstall(isolatedHome);
    const claudeDir = path.join(isolatedHome, '.claude');
    const backups = fs.readdirSync(claudeDir).filter((f) => f.startsWith('shared.backup-'));
    assert.equal(backups.length, 1, `expected exactly 1 backup after rotation, found ${backups.length}: ${backups.join(', ')}`);
  });
});
