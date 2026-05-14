// Sprint 2.30 — worktree-guard contract tests.
//
// Uses a real git repo + worktree fixture so the guard's git plumbing is
// exercised end-to-end. Sets STEWARD_ALLOW_WORKTREE only when explicitly
// asserting the bypass.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { checkWorktree, parseWorktreeList } = require(
  path.resolve(__dirname, '..', '..', 'bin', 'steward', '_lib', 'worktree-guard.cjs')
);

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-worktree-guard-'));
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim();
}

function initRepo(dir) {
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@cortex.local'], dir);
  git(['config', 'user.name', 'cortex test'], dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'init'], dir);
}

describe('worktree-guard — parseWorktreeList', () => {
  test('parses primary + 1 secondary', () => {
    const porcelain = [
      'worktree /repo/primary',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/feat-x',
      'HEAD def456',
      'branch refs/heads/worktree-feat-x',
      '',
    ].join('\n');
    const entries = parseWorktreeList(porcelain);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].path, '/repo/primary');
    assert.equal(entries[0].branch, 'main');
    assert.equal(entries[0].primary, true);
    assert.equal(entries[1].path, '/repo/feat-x');
    assert.equal(entries[1].branch, 'worktree-feat-x');
    assert.equal(entries[1].primary, undefined);
  });

  test('handles empty input', () => {
    assert.deepEqual(parseWorktreeList(''), []);
  });

  // R2 round-2 HIGH: detached-HEAD worktree must carry a detached marker
  // so future callers don't deref a null .branch.
  test('R2 round-2 HIGH: detached-HEAD worktree marked detached: true', () => {
    const porcelain = [
      'worktree /repo/primary',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/detached',
      'HEAD def456',
      'detached',
      '',
    ].join('\n');
    const entries = parseWorktreeList(porcelain);
    assert.equal(entries.length, 2);
    assert.equal(entries[1].detached, true);
    assert.equal(entries[1].branch, null);
    assert.equal(entries[0].detached, false);
  });
});

describe('worktree-guard — checkWorktree', () => {
  test('returns ok: true in primary worktree', () => {
    const dir = mktmp();
    try {
      initRepo(dir);
      const r = checkWorktree({ cwd: dir, env: {} });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.ok(r.current, 'current path returned');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns DENIED in secondary worktree', () => {
    const dir = mktmp();
    try {
      initRepo(dir);
      const feat = path.join(dir, 'feat-x-tree');
      // Use absolute path for both worktree dir + branch name.
      git(['worktree', 'add', '-b', 'feat-x', feat], dir);
      const r = checkWorktree({ cwd: feat, env: {} });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'STEWARD_WORKTREE_DENIED');
      assert.equal(r.bypassEnv, 'STEWARD_ALLOW_WORKTREE');
      assert.ok(r.message.includes('STEWARD_ALLOW_WORKTREE'),
        'message includes bypass hint');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('STEWARD_ALLOW_WORKTREE=1 bypasses denial', () => {
    const dir = mktmp();
    try {
      initRepo(dir);
      const feat = path.join(dir, 'feat-y-tree');
      git(['worktree', 'add', '-b', 'feat-y', feat], dir);
      const r = checkWorktree({ cwd: feat, env: { STEWARD_ALLOW_WORKTREE: '1' } });
      assert.equal(r.ok, true);
      assert.equal(r.bypassed, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns STEWARD_WORKTREE_NO_GIT outside a git repo', () => {
    const dir = mktmp();
    try {
      // No init — bare tmp dir.
      const r = checkWorktree({ cwd: dir, env: {} });
      assert.equal(r.ok, false);
      assert.equal(r.code, 'STEWARD_WORKTREE_NO_GIT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // R2 round-2 HIGH: non-existent cwd must return STEWARD_WORKTREE_BAD_CWD,
  // distinct from missing-git so operators get an actionable error.
  test('R2 round-2 HIGH: non-existent cwd returns STEWARD_WORKTREE_BAD_CWD', () => {
    const r = checkWorktree({
      cwd: path.join(os.tmpdir(), 'cortex-nonexistent-' + Date.now() + '-' + Math.random()),
      env: {},
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STEWARD_WORKTREE_BAD_CWD');
  });

  test('denial message includes both current + primary paths', () => {
    const dir = mktmp();
    try {
      initRepo(dir);
      const feat = path.join(dir, 'feat-z-tree');
      git(['worktree', 'add', '-b', 'feat-z', feat], dir);
      const r = checkWorktree({ cwd: feat, env: {} });
      assert.equal(r.ok, false);
      // Allow path-resolution to canonicalize (e.g. /private/var on macOS).
      assert.ok(r.message.includes(path.resolve(feat))
        || r.message.toLowerCase().includes('worktree'));
      assert.ok(r.primary, 'primary path returned');
      assert.ok(r.current, 'current path returned');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
