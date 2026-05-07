// lock.cjs — per-project mutex for Hermes runs (MUST-H2).
//
// Lock file at <repoRoot>/cortex/journal/<slug>/.lock contains:
//   { pid: number, start_ts: ISO-8601, action_id: string }
//
// Atomic acquire via fs.writeFileSync(..., { flag: 'wx' }) — fails if file
// already exists. Stale-lock recovery: if mtime > 2× action_timeout_ms,
// the lock is logged as `lock_recovered` and overwritten.
//
// Contract:
//   - acquireLock returns a handle on success or throws { code: 'EEXIST_FRESH' }
//     if a non-stale lock is held
//   - releaseLock is idempotent (no-op if file already gone)
//   - All operations are sync to keep cross-process semantics simple
//   - Lock dir is created if missing (mkdirSync recursive)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ACTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

function lockDir(repoRoot, slug) {
  return path.join(repoRoot, 'cortex', 'journal', slug);
}

function lockPath(repoRoot, slug) {
  return path.join(lockDir(repoRoot, slug), '.lock');
}

function isStale(lockFilePath, actionTimeoutMs) {
  try {
    const stat = fs.statSync(lockFilePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs > 2 * actionTimeoutMs;
  } catch {
    return false;
  }
}

function readLock(lockFilePath) {
  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function acquireLock(repoRoot, slug, opts = {}) {
  const actionTimeoutMs = opts.actionTimeoutMs || DEFAULT_ACTION_TIMEOUT_MS;
  const actionId = opts.actionId || 'unknown';

  fs.mkdirSync(lockDir(repoRoot, slug), { recursive: true });
  const lockFilePath = lockPath(repoRoot, slug);

  const payload = JSON.stringify({
    pid: process.pid,
    start_ts: new Date().toISOString(),
    action_id: actionId,
  }, null, 2);

  // Try atomic exclusive create
  try {
    fs.writeFileSync(lockFilePath, payload, { flag: 'wx', encoding: 'utf8' });
    return {
      lockFilePath,
      slug,
      repoRoot,
      acquiredAt: Date.now(),
      recovered: false,
    };
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Lock exists — check if stale
  if (isStale(lockFilePath, actionTimeoutMs)) {
    const stale = readLock(lockFilePath);
    fs.writeFileSync(lockFilePath, payload, { encoding: 'utf8' }); // overwrite
    return {
      lockFilePath,
      slug,
      repoRoot,
      acquiredAt: Date.now(),
      recovered: true,
      stalePrevious: stale,
    };
  }

  // Fresh lock held by another process
  const fresh = readLock(lockFilePath);
  const error = new Error(`Hermes lock held for slug=${slug}`);
  error.code = 'EEXIST_FRESH';
  error.lockFilePath = lockFilePath;
  error.heldBy = fresh;
  throw error;
}

function releaseLock(handle) {
  if (!handle || !handle.lockFilePath) return false;
  try {
    fs.unlinkSync(handle.lockFilePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  isStale,
  readLock,
  lockPath,
  lockDir,
  DEFAULT_ACTION_TIMEOUT_MS,
};
