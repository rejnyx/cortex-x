// git-ops.cjs — atomic git operations for Hermes's commit-per-action contract.
//
// Wraps git CLI via spawnSync (no shell injection: array argv, shell:false).
// Provides:
//   - getCleanTreeStatus(repoRoot) → { clean, dirty, untracked, modified }
//   - getCurrentSha(repoRoot) → string SHA
//   - checkoutNewBranch(repoRoot, branch) → { ok, stdout, stderr }
//   - stage(repoRoot, paths) → { ok } — git add -- <explicit paths>
//   - commitWithMessageFile(repoRoot, messageFile) → { ok, sha } — git commit -F
//   - revertCommit(repoRoot, sha) → { ok, stdout } — git revert --no-edit <sha>
//
// Contract:
//   - All operations return { ok: boolean, ... } — never throw on git failure
//   - Spawn errors (git not on PATH, permission, etc.) surface as { ok: false, error }
//   - No shell injection: paths are passed as separate argv, after `--`

'use strict';

const { spawnSync } = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 30_000;

function git(repoRoot, args, opts = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    shell: false,
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
      code: result.error.code,
      args,
    };
  }

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    args,
  };
}

// --- introspection ---------------------------------------------------------

function getCleanTreeStatus(repoRoot) {
  const r = git(repoRoot, ['status', '--porcelain']);
  if (!r.ok) return { clean: false, error: r.error || r.stderr };

  const lines = r.stdout.split('\n').filter(Boolean);
  const untracked = lines.filter((l) => l.startsWith('??')).map((l) => l.slice(3));
  const modified = lines.filter((l) => !l.startsWith('??')).map((l) => l.slice(3).trim());
  return {
    clean: lines.length === 0,
    dirty: lines,
    untracked,
    modified,
  };
}

function getCurrentSha(repoRoot) {
  const r = git(repoRoot, ['rev-parse', 'HEAD']);
  if (!r.ok) return null;
  return r.stdout.trim();
}

function getCurrentBranch(repoRoot) {
  const r = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!r.ok) return null;
  return r.stdout.trim();
}

function isInGitRepo(repoRoot) {
  const r = git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

// --- mutations -------------------------------------------------------------

function checkoutNewBranch(repoRoot, branch) {
  // Reject branch names that look like flag-injection (defense in depth)
  if (typeof branch !== 'string' || branch.startsWith('-')) {
    return { ok: false, error: 'invalid branch name' };
  }
  return git(repoRoot, ['checkout', '-b', branch]);
}

function stage(repoRoot, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'paths must be a non-empty array' };
  }
  // Reject any path that looks like a flag (defense in depth)
  for (const p of paths) {
    if (typeof p !== 'string' || p.startsWith('-')) {
      return { ok: false, error: `invalid path: ${p}` };
    }
  }
  return git(repoRoot, ['add', '--', ...paths]);
}

function commitWithMessageFile(repoRoot, messageFile) {
  if (typeof messageFile !== 'string' || messageFile.length === 0) {
    return { ok: false, error: 'messageFile must be a non-empty path' };
  }
  const r = git(repoRoot, ['commit', '-F', messageFile]);
  if (!r.ok) return r;
  // Capture the commit's SHA right after
  const sha = getCurrentSha(repoRoot);
  return { ...r, sha };
}

function revertCommit(repoRoot, sha) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{4,40}$/i.test(sha)) {
    return { ok: false, error: 'invalid sha' };
  }
  return git(repoRoot, ['revert', '--no-edit', sha]);
}

module.exports = {
  git,
  getCleanTreeStatus,
  getCurrentSha,
  getCurrentBranch,
  isInGitRepo,
  checkoutNewBranch,
  stage,
  commitWithMessageFile,
  revertCommit,
  DEFAULT_TIMEOUT_MS,
};
