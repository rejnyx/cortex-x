// atomic-write.cjs — Sprint 2.28.3 SSOT extract + R2 hardening.
//
// Secrets-safe atomic write helpers used by cortex-x settings-mutating CLIs.
// Hardened for the failure modes surfaced by R2 round-3 review:
//
//  - H-1 (security CWE-732): fs.writeFileSync(path, ..., { mode }) only
//    applies mode on CREATE. If a stale tmp/backup exists with looser mode,
//    the helper would silently reuse it. Now uses O_CREAT|O_EXCL|O_WRONLY
//    + explicit fchmodSync after open to force mode on every write.
//
//  - H-4 (edge / data-loss): backupFile previously used second-granularity
//    ISO timestamp. Two same-second runs silently overwrote. Now retries
//    with -1, -2, ... -99 suffix on EEXIST. After 100 collisions, gives up
//    with a thrown error rather than continuing.
//
//  - M-2 (race): writeFileAtomic tmp path was deterministic
//    (`<target>.tmp`). Concurrent CLIs would collide. Now uses
//    `<target>.tmp-<pid>-<random>` so each invocation owns its tmp file.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BACKUP_COLLISIONS = 100;

// Open a file exclusively (fails if it exists) with the requested mode set
// explicitly via fchmod after open — covers the umask-narrowing case.
function openExclusiveWithMode(filePath, mode) {
  const fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, mode);
  try {
    fs.fchmodSync(fd, mode);
  } catch (err) {
    fs.closeSync(fd);
    try { fs.unlinkSync(filePath); } catch {}
    throw err;
  }
  return fd;
}

// Write `<targetPath>.backup-<iso-ts>[-<n>]` with mode 0o600 (owner read+write
// only) so backups do not leak secrets to other local users via umask default.
// On EEXIST (same-second collision) appends -1, -2, ... up to -99 before
// failing. Returns the backup path written.
function backupFile(targetPath, rawContent) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let lastErr = null;
  for (let i = 0; i < MAX_BACKUP_COLLISIONS; i++) {
    const suffix = i === 0 ? '' : `-${i}`;
    const backupPath = `${targetPath}.backup-${ts}${suffix}`;
    let fd;
    try {
      fd = openExclusiveWithMode(backupPath, 0o600);
    } catch (err) {
      if (err && err.code === 'EEXIST') { lastErr = err; continue; }
      throw err;
    }
    try {
      fs.writeFileSync(fd, rawContent, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    return backupPath;
  }
  const e = new Error(`backupFile: ${MAX_BACKUP_COLLISIONS} timestamp collisions on ${targetPath}`);
  e.code = 'BACKUP_COLLISION_EXHAUSTED';
  e.cause = lastErr;
  throw e;
}

// Atomic write via tmp + rename. tmp file inherits mode 0o600 via O_EXCL
// open so OAuth tokens briefly held in the tmp file before rename are not
// world-readable. Parent dir is created if missing. tmp is best-effort
// unlinked on failure. Per-invocation tmp suffix prevents concurrent-run
// collision.
function writeFileAtomic(targetPath, content, opts = {}) {
  const mode = opts.mode === undefined ? 0o600 : opts.mode;
  const rand = crypto.randomBytes(6).toString('hex');
  const tmp = `${targetPath}.tmp-${process.pid}-${rand}`;
  let renamed = false;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const fd = openExclusiveWithMode(tmp, mode);
    try {
      fs.writeFileSync(fd, content, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, targetPath);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
}

module.exports = { backupFile, writeFileAtomic, openExclusiveWithMode };
