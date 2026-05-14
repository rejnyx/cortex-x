// Sprint 2.28.3 — SSOT atomic-write helper tests.
//
// Verifies mode 0o600 on both backupFile + writeFileAtomic. This is the
// load-bearing safety property for settings.json (OAuth tokens) and
// CLAUDE.md (operator notes) — backup/tmp must not leak to other local users
// via umask default 0o644.
//
// Skips mode assertions on Windows where fs.stat returns 0o666 regardless
// of mode arg (NTFS does not honor POSIX permission bits).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'bin', '_lib', 'atomic-write.cjs');
const { backupFile, writeFileAtomic } = require(LIB);

const IS_WIN = process.platform === 'win32';

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-atomic-test-'));
}

test('backupFile — writes <target>.backup-<iso-ts> with 0o600 mode', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(target, '{"oauth_token":"sensitive"}', 'utf8');
    const backupPath = backupFile(target, '{"oauth_token":"sensitive"}');
    assert.match(backupPath, /\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), '{"oauth_token":"sensitive"}');
    if (!IS_WIN) {
      const mode = fs.statSync(backupPath).mode & 0o777;
      assert.equal(mode, 0o600, `backup file mode should be 0o600, got 0o${mode.toString(8)}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — writes target with 0o600 mode by default', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'settings.json');
    writeFileAtomic(target, '{"token":"x"}');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"token":"x"}');
    if (!IS_WIN) {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, 0o600, `target file mode should be 0o600, got 0o${mode.toString(8)}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — creates parent dir if missing', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'sub', 'deep', 'file.json');
    writeFileAtomic(target, 'content');
    assert.equal(fs.readFileSync(target, 'utf8'), 'content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — opts.mode override honored', () => {
  if (IS_WIN) return; // NTFS doesn't honor POSIX modes
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'public.txt');
    writeFileAtomic(target, 'public', { mode: 0o644 });
    const mode = fs.statSync(target).mode & 0o777;
    assert.equal(mode, 0o644);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — tmp file cleaned up on rename failure', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'sub');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(target, 'nested'));
    let caught = null;
    try {
      writeFileAtomic(path.join(target, 'nested'), 'x');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught !== null, 'writeFileAtomic should throw on rename-to-existing-dir');
    // Sprint 2.28.3 R2: tmp path now uses `<target>.tmp-<pid>-<random>` so
    // collision-free across concurrent runs. Verify no stray tmp files left.
    const stray = fs.readdirSync(target).filter((f) => f.startsWith('nested.tmp-'));
    assert.equal(stray.length, 0, `stray tmp files: ${stray.join(', ')}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — concurrent-safe tmp suffix (R2 M-2)', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'settings.json');
    // Pre-create a stale tmp with looser mode to verify the helper does NOT
    // reuse it (Sprint 2.28.3 R2 H-1 hardening).
    const staleA = `${target}.tmp-99999-aaaaaaaaaaaa`;
    fs.writeFileSync(staleA, 'stale', { mode: 0o644 });
    writeFileAtomic(target, '{"new":true}');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"new":true}');
    // Stale tmp left alone (different random suffix → no collision).
    assert.ok(fs.existsSync(staleA), 'helper must not touch unrelated tmp files');
    if (!IS_WIN) {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, 0o600, `target mode must be 0o600 regardless of any stale tmp`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backupFile — retries on same-second collision (R2 H-4)', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(target, 'orig');
    const p1 = backupFile(target, 'first');
    const p2 = backupFile(target, 'second');
    assert.notEqual(p1, p2, 'backupFile must produce unique paths on collision');
    assert.equal(fs.readFileSync(p1, 'utf8'), 'first', 'first backup preserved');
    assert.equal(fs.readFileSync(p2, 'utf8'), 'second', 'second backup created with -1 suffix');
    assert.match(p2, /\.backup-[\dT-]+-1$/, 'collision suffix appended');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeFileAtomic — overwrites existing target with new content', () => {
  const tmpDir = mktmp();
  try {
    const target = path.join(tmpDir, 'settings.json');
    fs.writeFileSync(target, 'old');
    writeFileAtomic(target, 'new');
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
    if (!IS_WIN) {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, 0o600, 'mode must reset to 0o600 on overwrite');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SSOT parity — all 3 sister CLIs reach the same helpers', () => {
  const hooks = require(path.join(__dirname, '..', '..', 'bin', 'cortex-hooks-register.cjs'));
  const augment = require(path.join(__dirname, '..', '..', 'bin', 'cortex-claude-md-augment.cjs'));
  const perms = require(path.join(__dirname, '..', '..', 'bin', 'cortex-permissions-register.cjs'));
  // parseConfirmReply re-exported from all 3 CLIs ensures backward-compat for
  // any direct importer + lets each CLI's test file assert the same semantics.
  assert.equal(typeof hooks.parseConfirmReply, 'function', 'hooks-register exports parseConfirmReply');
  assert.equal(typeof augment.parseConfirmReply, 'function', 'claude-md-augment exports parseConfirmReply');
  assert.equal(typeof perms.parseConfirmReply, 'function', 'permissions-register exports parseConfirmReply');
  // Same semantics across all 3 (single source via _lib/confirm.cjs).
  for (const cli of [hooks, augment, perms]) {
    assert.equal(cli.parseConfirmReply('y'), true);
    assert.equal(cli.parseConfirmReply(''), false);
    assert.equal(cli.parseConfirmReply('yes'), true);
    assert.equal(cli.parseConfirmReply('n'), false);
  }
});
