// SPDX-License-Identifier: Apache-2.0
// r2-verdict-journal.cjs — single-use replay journal for R2 verdict workflow_run_ids.
//
// Sprint 2.46.1 (R2-HIGH residual #2): a signed verdict must be redeemable
// EXACTLY ONCE. This journal records `workflow_run_id` values that have been
// observed by the pre-commit gate, so a replayed verdict (same id, same
// signature, different commit context) is denied on the second presentation.
//
// Storage: <rootDir>/cortex/.r2-seen-runs.json — a single JSON document of
// shape { schema_version, capacity, entries: [...] }. FIFO eviction at
// `capacity` entries (default 1000) bounds disk + scan cost.
//
// Determinism: all timestamps are INPUT to appendSeen, never generated inside
// the module. The module performs no Date.now()/Math.random()/new Date()
// calls in its hot path — pure I/O over caller-supplied state.
//
// Zero npm deps — node:fs + node:path + node:os only.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const _SCHEMA_VERSION = 1;
const _DEFAULT_CAPACITY = 1000;
const _MAX_RETRIES = 3;
const _RETRY_BACKOFF_MS = 50;
const _RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EEXIST']);

// ---------------------------------------------------------------------------
// journalPath(rootDir) — resolve absolute path to the journal file.
// ---------------------------------------------------------------------------
function journalPath(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_ROOT_REQUIRED');
  }
  return path.join(rootDir, 'cortex', '.r2-seen-runs.json');
}

// ---------------------------------------------------------------------------
// quarantinePath(filePath, workflowRunId) — sibling path used when the
// existing journal is corrupt and must be preserved for operator triage.
// ---------------------------------------------------------------------------
function quarantinePath(filePath, workflowRunId) {
  const dir = path.dirname(filePath);
  const safeId = String(workflowRunId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(dir, `.r2-seen-runs.quarantine-${safeId}.json`);
}

// ---------------------------------------------------------------------------
// emptyJournal() — canonical empty document.
// ---------------------------------------------------------------------------
function emptyJournal() {
  return {
    schema_version: _SCHEMA_VERSION,
    capacity: _DEFAULT_CAPACITY,
    entries: [],
  };
}

// ---------------------------------------------------------------------------
// loadJournal(rootDir) — fail-OPEN on ENOENT, throw on schema mismatch.
// Malformed JSON does NOT throw here; callers that need quarantine semantics
// must drive that via appendSeen. loadJournal throws on malformed JSON so
// that read-only consumers (wasSeen) surface corruption explicitly.
// ---------------------------------------------------------------------------
function loadJournal(rootDir) {
  const filePath = journalPath(rootDir);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyJournal();
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const e = new Error('CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON');
    e.code = 'CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON';
    throw e;
  }
  if (!parsed || typeof parsed !== 'object') {
    const e = new Error('CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON');
    e.code = 'CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON';
    throw e;
  }
  if (parsed.schema_version !== _SCHEMA_VERSION) {
    const e = new Error('CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH');
    e.code = 'CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH';
    e.found = parsed.schema_version;
    e.expected = _SCHEMA_VERSION;
    throw e;
  }
  if (!Array.isArray(parsed.entries)) {
    const e = new Error('CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON');
    e.code = 'CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON';
    throw e;
  }
  if (
    typeof parsed.capacity !== 'number' ||
    !Number.isFinite(parsed.capacity) ||
    parsed.capacity <= 0
  ) {
    parsed.capacity = _DEFAULT_CAPACITY;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// wasSeen(rootDir, workflowRunId) — O(N) linear scan over entries.
// Graceful on missing parameter (returns false). Surfaces corruption via the
// loadJournal throw path so the operator notices.
// ---------------------------------------------------------------------------
function wasSeen(rootDir, workflowRunId) {
  if (!workflowRunId || typeof workflowRunId !== 'string') return false;
  const journal = loadJournal(rootDir);
  for (let i = 0; i < journal.entries.length; i++) {
    const ent = journal.entries[i];
    if (ent && ent.workflow_run_id === workflowRunId) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// loadOrQuarantine(filePath, workflowRunId) — internal helper used by
// appendSeen. Returns { journal, quarantined }. On malformed JSON, the
// existing file is renamed to a sibling .quarantine-<id>.json so the
// operator can triage; the active journal is reset to empty. ENOENT yields
// empty journal without quarantine.
// ---------------------------------------------------------------------------
function loadOrQuarantine(filePath, workflowRunId) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { journal: emptyJournal(), quarantined: false };
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const qPath = quarantinePath(filePath, workflowRunId);
    try {
      fs.renameSync(filePath, qPath);
    } catch (_) {
      // If rename fails (e.g. cross-volume on exotic FS), copy + unlink.
      try {
        fs.writeFileSync(qPath, raw);
        fs.unlinkSync(filePath);
      } catch (_) {
        /* best-effort — caller will recreate the file below */
      }
    }
    // Safety-critical fail surfaced to the operator. Per module convention
    // we keep stderr quiet by default, but corruption warrants a visible
    // signal so it is not silently overwritten.
    // eslint-disable-next-line no-console
    console.warn(
      `[cortex/r2-verdict-journal] quarantined malformed journal: ${qPath}`
    );
    return { journal: emptyJournal(), quarantined: true };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    // Treat structurally-invalid same as malformed JSON.
    const qPath = quarantinePath(filePath, workflowRunId);
    try {
      fs.renameSync(filePath, qPath);
    } catch (_) {
      /* best-effort */
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[cortex/r2-verdict-journal] quarantined structurally-invalid journal: ${qPath}`
    );
    return { journal: emptyJournal(), quarantined: true };
  }
  if (parsed.schema_version !== _SCHEMA_VERSION) {
    const e = new Error('CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH');
    e.code = 'CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH';
    e.found = parsed.schema_version;
    e.expected = _SCHEMA_VERSION;
    throw e;
  }
  if (
    typeof parsed.capacity !== 'number' ||
    !Number.isFinite(parsed.capacity) ||
    parsed.capacity <= 0
  ) {
    parsed.capacity = _DEFAULT_CAPACITY;
  }
  return { journal: parsed, quarantined: false };
}

// ---------------------------------------------------------------------------
// sleepSync(ms) — block the event loop for `ms` milliseconds without using
// Date.now()/setTimeout (deterministic-forbidden). Uses Atomics.wait on a
// shared int32 buffer, which is the canonical Node way to sleep synchronously
// without timer APIs.
// ---------------------------------------------------------------------------
function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

// ---------------------------------------------------------------------------
// atomicWriteJSON(filePath, obj) — write-tmp + fsync + rename. Same-volume
// rename is atomic on POSIX and on Windows (MoveFileEx with REPLACE_EXISTING
// is the documented semantic of fs.renameSync). The tmp filename is derived
// from `process.pid` + a monotonic counter so two near-simultaneous calls in
// the same process don't collide.
// ---------------------------------------------------------------------------
let _tmpCounter = 0;
function atomicWriteJSON(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  _tmpCounter = (_tmpCounter + 1) >>> 0;
  const tmp = `${filePath}.tmp.${process.pid}.${_tmpCounter}`;
  const json = JSON.stringify(obj, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, json, 0, 'utf8');
    try {
      fs.fsyncSync(fd);
    } catch (_) {
      /* fsync unsupported on some FS (tmpfs); tolerate */
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

// ---------------------------------------------------------------------------
// appendSeen(rootDir, entry) — read → append → evict-if-needed → atomic-write.
//
// entry: { workflowRunId, sprintId, commitSha, seenAt }
//   - workflowRunId REQUIRED
//   - sprintId, commitSha REQUIRED (lock the verdict to a commit context)
//   - seenAt REQUIRED — caller-supplied ISO timestamp (INPUT, not generated)
//
// On retryable I/O errors (EBUSY/EPERM/EACCES/EEXIST from concurrent writers
// on Windows), retry up to _MAX_RETRIES with a fixed backoff. Other errors
// propagate to the caller.
//
// Returns { entries: <count after append+evict>, evicted: <count evicted> }.
// ---------------------------------------------------------------------------
function appendSeen(rootDir, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_ENTRY_REQUIRED');
  }
  const { workflowRunId, sprintId, commitSha, seenAt } = entry;
  if (!workflowRunId || typeof workflowRunId !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_MISSING_WORKFLOW_RUN_ID');
  }
  if (!sprintId || typeof sprintId !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_MISSING_SPRINT_ID');
  }
  if (!commitSha || typeof commitSha !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_MISSING_COMMIT_SHA');
  }
  if (!seenAt || typeof seenAt !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_JOURNAL_MISSING_SEEN_AT');
  }

  const filePath = journalPath(rootDir);
  let lastErr = null;

  for (let attempt = 0; attempt < _MAX_RETRIES; attempt++) {
    try {
      const { journal } = loadOrQuarantine(filePath, workflowRunId);
      journal.entries.push({
        workflow_run_id: workflowRunId,
        sprint_id: sprintId,
        commit_sha: commitSha,
        seen_at: seenAt,
      });
      let evicted = 0;
      const cap = journal.capacity || _DEFAULT_CAPACITY;
      while (journal.entries.length > cap) {
        journal.entries.shift();
        evicted++;
      }
      atomicWriteJSON(filePath, journal);
      return { entries: journal.entries.length, evicted };
    } catch (err) {
      lastErr = err;
      const code = err && err.code;
      if (!_RETRYABLE_CODES.has(code) || attempt === _MAX_RETRIES - 1) {
        throw err;
      }
      sleepSync(_RETRY_BACKOFF_MS);
    }
  }
  // Defensive — unreachable because the last iteration throws above.
  throw lastErr || new Error('CORTEX_R2_VERDICT_JOURNAL_UNKNOWN_ERROR');
}

module.exports = {
  appendSeen,
  wasSeen,
  loadJournal,
  _SCHEMA_VERSION,
  _DEFAULT_CAPACITY,
  _journalPath: journalPath,
};
