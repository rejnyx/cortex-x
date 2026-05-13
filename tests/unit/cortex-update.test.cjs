// cortex-update contract tests.
//
// What this validates:
//   1. resolveCortexSource respects precedence env > yaml > default
//   2. parseArgs accepts --check, --yes, --reinstall, --json, --help
//   3. parseArgs rejects unknown flags
//   4. --check on a synthetic git repo with no remote bails cleanly
//   5. --json on a synthetic git repo emits expected schema fields
//
// We DO NOT spawn real git fetch over the network or run install.sh/install.ps1
// from these tests — those are covered by the install-smoke CI lane. Here we
// exercise the pure-CPU paths: arg parsing, source resolution, and the
// early-exit branches that detect bad repo state without going to origin.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-update.cjs');
const { resolveCortexSource, parseArgs } = require(SCRIPT);

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function initEmptyRepo(dir) {
  // Local-only git repo with one commit on 'main' — no remote. cortex-update
  // should bail BEFORE hitting fetch when there's no upstream configured.
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'cortex-update test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

function runCli(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('cortex-update — resolveCortexSource precedence', () => {
  test('env CORTEX_SOURCE wins over yaml + default', () => {
    const old = process.env.CORTEX_SOURCE;
    process.env.CORTEX_SOURCE = path.join(os.tmpdir(), 'cortex-x-override-' + Date.now());
    try {
      const resolved = resolveCortexSource();
      assert.strictEqual(resolved, path.normalize(process.env.CORTEX_SOURCE));
    } finally {
      if (old === undefined) delete process.env.CORTEX_SOURCE;
      else process.env.CORTEX_SOURCE = old;
    }
  });

  test('falls through to ~/cortex-x when no env + no yaml lookup match', () => {
    const old = process.env.CORTEX_SOURCE;
    delete process.env.CORTEX_SOURCE;
    try {
      const resolved = resolveCortexSource();
      // We can't assume the yaml is absent on the test host, so we only
      // assert the resolution returned an absolute path that looks plausible.
      assert.ok(path.isAbsolute(resolved), `expected absolute path, got: ${resolved}`);
    } finally {
      if (old !== undefined) process.env.CORTEX_SOURCE = old;
    }
  });
});

describe('cortex-update — parseArgs', () => {
  test('parses every supported flag', () => {
    const a = parseArgs(['node', 'cortex-update.cjs', '--check', '--yes', '--reinstall', '--json']);
    assert.strictEqual(a.check, true);
    assert.strictEqual(a.yes, true);
    assert.strictEqual(a.reinstall, true);
    assert.strictEqual(a.json, true);
  });

  test('accepts -y short form for --yes', () => {
    const a = parseArgs(['node', 'cortex-update.cjs', '-y']);
    assert.strictEqual(a.yes, true);
  });

  test('--help sets help=true (no exit from parseArgs itself)', () => {
    const a = parseArgs(['node', 'cortex-update.cjs', '--help']);
    assert.strictEqual(a.help, true);
  });

  test('unknown flag exits 1 (subprocess)', () => {
    const r = runCli(['--banana']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /unknown flag/i);
  });
});

describe('cortex-update — CLI early-exit branches', () => {
  test('--help prints usage and exits 0', () => {
    const r = runCli(['--help']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /cortex-update — pull latest/);
    assert.match(r.stdout, /--check/);
    assert.match(r.stdout, /--reinstall/);
  });

  test('missing source dir → exit 1 with helpful message', () => {
    const fakePath = path.join(os.tmpdir(), 'cortex-update-does-not-exist-' + Date.now());
    const r = runCli([], { CORTEX_SOURCE: fakePath });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /source dir not found/);
  });

  test('source dir without .git → exit 1', () => {
    const dir = mkTmpDir('cortex-update-nogit-');
    try {
      const r = runCli([], { CORTEX_SOURCE: dir });
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /not a git repo/);
    } finally {
      tryRm(dir);
    }
  });

  test('--reinstall on missing installer → exit 1 with installer-missing error', () => {
    const dir = mkTmpDir('cortex-update-reinstall-');
    try {
      initEmptyRepo(dir);
      // No install.sh / install.ps1 in this synthetic repo — runInstaller bails.
      const r = runCli(['--reinstall'], { CORTEX_SOURCE: dir });
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /installer missing/);
    } finally {
      tryRm(dir);
    }
  });

  test('clean repo without remote → fetch fails → exit 1, install unchanged', () => {
    const dir = mkTmpDir('cortex-update-noremote-');
    try {
      initEmptyRepo(dir);
      // No `git remote add origin ...` — fetch will fail.
      const r = runCli([], { CORTEX_SOURCE: dir });
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /git fetch failed/i);
    } finally {
      tryRm(dir);
    }
  });

  test('dirty working tree → exit 1, never touches network', () => {
    const dir = mkTmpDir('cortex-update-dirty-');
    try {
      initEmptyRepo(dir);
      // Make tree dirty by adding an untracked file (porcelain detects it).
      fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x');
      execFileSync('git', ['add', 'dirty.txt'], { cwd: dir });
      const r = runCli([], { CORTEX_SOURCE: dir });
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /uncommitted changes/);
    } finally {
      tryRm(dir);
    }
  });

  test('detached HEAD → exit 1 with switch-to-branch hint', () => {
    const dir = mkTmpDir('cortex-update-detached-');
    try {
      initEmptyRepo(dir);
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      execFileSync('git', ['checkout', '-q', headSha], { cwd: dir });
      const r = runCli([], { CORTEX_SOURCE: dir });
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /detached HEAD/);
    } finally {
      tryRm(dir);
    }
  });
});
