// detectors/secret-history-sweep.cjs — Sprint 2.6b pre-flight probe.
//
// Cheap (<100ms) PATH lookup for `trufflehog` binary + check that this is
// a git repo with at least one commit. Returns:
//   - 'ready' — trufflehog found, .git exists
//   - 'no-trufflehog' — binary not on PATH (fail-open: kind skips, doesn't halt cron)
//   - 'no-git' — .git directory missing
//   - 'opted-out' — .cortex/secret-sweep-disabled sentinel present

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function probeBinary(name) {
  if (!name || typeof name !== 'string') return { ok: false };
  const isWin = process.platform === 'win32';
  const candidates = isWin ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const cand of candidates) {
      try {
        const st = fs.statSync(path.join(dir, cand));
        if (st.isFile()) return { ok: true, path: path.join(dir, cand) };
      } catch { /* probe-only */ }
    }
  }
  return { ok: false };
}

function isOptedOut(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') return false;
  try {
    fs.statSync(path.join(repoRoot, '.cortex', 'secret-sweep-disabled'));
    return true;
  } catch {
    return false;
  }
}

function detect(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  if (isOptedOut(repoRoot)) {
    return { status: 'opted-out', reason: '.cortex/secret-sweep-disabled sentinel present' };
  }
  // git repo check
  try {
    const st = fs.statSync(path.join(repoRoot, '.git'));
    // .git can be a directory (normal) OR a file (worktree pointer)
    if (!st.isDirectory() && !st.isFile()) {
      return { status: 'no-git', reason: '.git is neither a directory nor a worktree pointer file' };
    }
  } catch {
    return { status: 'no-git', reason: 'no .git directory at repoRoot' };
  }
  const trufflehog = probeBinary('trufflehog');
  if (!trufflehog.ok) {
    return {
      status: 'no-trufflehog',
      reason: 'trufflehog CLI not on PATH; install via `brew install trufflehog` or `go install github.com/trufflesecurity/trufflehog@latest`. Sweep will be skipped (fail-open).',
    };
  }
  return {
    status: 'ready',
    trufflehogPath: trufflehog.path,
  };
}

module.exports = { detect, probeBinary };
