'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gitOps = require('../../../bin/hermes/_lib/git-ops.cjs');

function tmpGitRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `git-ops-${prefix}-`));
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), '# initial\n');
  spawnSync('git', ['add', 'README.md'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: repo });
  return repo;
}

describe('git-ops: introspection', () => {
  test('isInGitRepo returns true for git repo, false elsewhere', () => {
    const repo = tmpGitRepo('inrepo');
    assert.equal(gitOps.isInGitRepo(repo), true);

    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-git-'));
    assert.equal(gitOps.isInGitRepo(nonRepo), false);
  });

  test('getCurrentSha returns 40-char hex on a fresh repo', () => {
    const repo = tmpGitRepo('sha');
    const sha = gitOps.getCurrentSha(repo);
    assert.match(sha, /^[0-9a-f]{40}$/);
  });

  test('getCurrentBranch returns current branch name', () => {
    const repo = tmpGitRepo('branch');
    assert.equal(gitOps.getCurrentBranch(repo), 'main');
  });

  test('getCleanTreeStatus reports clean on fresh checkout', () => {
    const repo = tmpGitRepo('clean');
    const status = gitOps.getCleanTreeStatus(repo);
    assert.equal(status.clean, true);
  });

  test('getCleanTreeStatus reports modified files', () => {
    const repo = tmpGitRepo('dirty');
    fs.writeFileSync(path.join(repo, 'README.md'), '# changed\n');
    const status = gitOps.getCleanTreeStatus(repo);
    assert.equal(status.clean, false);
    assert.ok(status.modified.length >= 1);
  });

  test('getCleanTreeStatus reports untracked files', () => {
    const repo = tmpGitRepo('untracked');
    fs.writeFileSync(path.join(repo, 'newfile.txt'), 'new');
    const status = gitOps.getCleanTreeStatus(repo);
    assert.equal(status.clean, false);
    assert.ok(status.untracked.length >= 1);
  });
});

describe('git-ops: branch operations', () => {
  test('checkoutNewBranch creates + switches to new branch', () => {
    const repo = tmpGitRepo('newbranch');
    const result = gitOps.checkoutNewBranch(repo, 'hermes/2026-05-07-test-abc1');
    assert.equal(result.ok, true);
    assert.equal(gitOps.getCurrentBranch(repo), 'hermes/2026-05-07-test-abc1');
  });

  test('rejects branch names starting with -', () => {
    const repo = tmpGitRepo('flag-branch');
    const result = gitOps.checkoutNewBranch(repo, '--exec=evil');
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid branch/);
  });
});

describe('git-ops: stage + commit', () => {
  test('stages explicit paths only', () => {
    const repo = tmpGitRepo('stage');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
    const result = gitOps.stage(repo, ['a.txt']);
    assert.equal(result.ok, true);

    // Verify only a.txt is staged (b.txt remains untracked)
    const status = gitOps.getCleanTreeStatus(repo);
    assert.ok(status.untracked.includes('b.txt') || status.dirty.some((l) => l.includes('b.txt')));
  });

  test('rejects flag-shaped paths', () => {
    const repo = tmpGitRepo('flag-path');
    const result = gitOps.stage(repo, ['--exec=evil']);
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid path/);
  });

  test('rejects empty path array', () => {
    const repo = tmpGitRepo('empty');
    const result = gitOps.stage(repo, []);
    assert.equal(result.ok, false);
  });

  test('commitWithMessageFile creates a commit with the message body', () => {
    const repo = tmpGitRepo('commit');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    gitOps.stage(repo, ['a.txt']);

    const msgFile = path.join(repo, '.commit-msg');
    fs.writeFileSync(msgFile, 'feat: add a.txt\n\nBody.\n');

    const result = gitOps.commitWithMessageFile(repo, msgFile);
    assert.equal(result.ok, true);
    assert.match(result.sha, /^[0-9a-f]{40}$/);

    // Verify commit subject
    const log = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' });
    assert.match(log.stdout, /feat: add a\.txt/);
  });
});

describe('git-ops: revert', () => {
  test('revertCommit creates a new commit that undoes the target', () => {
    const repo = tmpGitRepo('revert');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    gitOps.stage(repo, ['a.txt']);
    const msgFile = path.join(repo, '.msg');
    fs.writeFileSync(msgFile, 'add a.txt');
    const c1 = gitOps.commitWithMessageFile(repo, msgFile);

    const r = gitOps.revertCommit(repo, c1.sha);
    assert.equal(r.ok, true, `revert failed: ${r.stderr}`);
    assert.equal(fs.existsSync(path.join(repo, 'a.txt')), false);
  });

  test('rejects invalid SHA', () => {
    const repo = tmpGitRepo('bad-sha');
    const r = gitOps.revertCommit(repo, 'not-a-sha');
    assert.equal(r.ok, false);
    assert.match(r.error, /invalid sha/);
  });
});
