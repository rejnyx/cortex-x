// bin/steward/_lib/lessons-search.cjs — Sprint 3.2 v0
//
// SQLite FTS5 index over $CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl.
// First Tier 2 sprint primitive: enables full-text + action_kind +
// error-code lookup so the next Steward action's pre-prompt recall is
// indexed instead of linear-scan.
//
// Design (R1 from docs/research/sprint-3.6-llm-wiki-research-2026-05-11.md):
//   - SQLite via Node 22.5+ built-in `node:sqlite` (zero npm deps).
//   - FTS5 virtual table for text search; standard table for metadata.
//   - Index lives at $CORTEX_DATA_HOME/journal/<slug>/lessons.idx.db
//     (sibling of lessons.jsonl). Re-built on demand; lessons.jsonl
//     remains the SSOT.
//
// Feature-detect: node:sqlite is experimental on Node 22.x (flag-gated
// until 22.11). Helpers gracefully return { available: false, ... } if
// the module is unavailable so CI on older Node patches doesn't crash.
//
// v0 scope:
//   - Per-project index only. Cross-project federated index is v1.
//   - Build via `buildIndex(slug, opts)` — full rebuild each call (safe
//     for <10K-entry lessons.jsonl, typical operator scale).
//   - 3 query helpers: searchByText, searchByActionKind, searchByErrorCode.
//   - No action-engine recall integration yet (deferred to 3.2.1).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const lessons = require('./lessons.cjs');

// Feature-detect node:sqlite (Node 22.5+ experimental, stable from 23.x).
let sqliteAvailable = false;
let sqliteErr = null;
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
  sqliteAvailable = true;
} catch (e) {
  sqliteErr = (e && e.message) || 'node:sqlite unavailable';
}

function isAvailable() {
  return sqliteAvailable;
}

function unavailableReason() {
  if (sqliteAvailable) return null;
  return `node:sqlite not available on this Node version: ${sqliteErr}. Sprint 3.2 v0 requires Node ≥22.5 with node:sqlite enabled. Hint: NODE_OPTIONS=--experimental-sqlite or upgrade to Node 23+.`;
}

function resolveDataHome(opts = {}) {
  return opts.dataHome || process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
}

function indexPath(slug, opts = {}) {
  return path.join(resolveDataHome(opts), 'journal', slug, 'lessons.idx.db');
}

// Sprint 3.2 v0 — slug safety mirrors Sprint 2.8.1 contract.
function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error('lessons-search: slug must be a non-empty string');
  }
  if (slug.length > 64 || slug.includes('\0')) {
    throw new Error('lessons-search: slug must be ≤64 chars and not contain NUL');
  }
  if (slug === '.' || slug === '..' || slug.startsWith('.') || slug.startsWith('-')) {
    throw new Error(`lessons-search: slug must not start with "." or "-" (got "${slug}")`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    throw new Error(`lessons-search: slug must match /^[A-Za-z0-9_-]+$/ (got "${slug}")`);
  }
}

/**
 * Build (or rebuild) the FTS5 index for a slug. Returns { ok, indexed }.
 */
function buildIndex(slug, opts = {}) {
  assertSafeSlug(slug);
  if (!sqliteAvailable) {
    return { ok: false, code: 'SQLITE_UNAVAILABLE', error: unavailableReason() };
  }
  const dataHome = opts.dataHome;
  const prevDataHome = process.env.CORTEX_DATA_HOME;
  if (dataHome) process.env.CORTEX_DATA_HOME = dataHome;
  let all;
  try {
    all = lessons.readAllLessons(slug);
  } finally {
    if (dataHome) {
      if (prevDataHome === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevDataHome;
    }
  }

  const idxFile = opts.indexPath || indexPath(slug, opts);
  // Sprint 3.2 R2 (security-auditor MED): when opts.indexPath is supplied
  // (library-internal escape hatch — CLI never sets it), assert the
  // resolved path is contained under the resolved data-home. Defense
  // before Sprint 3.2.1 wires this lib into the action_engine LLM tool
  // surface where opts.indexPath could become LLM-controlled.
  if (opts.indexPath) {
    const dh = path.resolve(resolveDataHome(opts));
    const resolved = path.resolve(idxFile);
    const rel = path.relative(dh, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { ok: false, code: 'INDEX_PATH_OUTSIDE_DATA_HOME', error: `opts.indexPath must resolve under ${dh}` };
    }
  }
  fs.mkdirSync(path.dirname(idxFile), { recursive: true });
  // Full rebuild: drop+recreate ensures consistency. For Sprint 3.2 v0
  // sizes (<10K rows) this is fine; incremental indexing is v1.
  if (fs.existsSync(idxFile)) fs.unlinkSync(idxFile);

  const db = new DatabaseSync(idxFile);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE lessons_fts USING fts5(
        action_kind UNINDEXED,
        action_key UNINDEXED,
        root_cause,
        lesson_text,
        hint,
        impact UNINDEXED,
        ts UNINDEXED,
        frequency UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `);

    const insert = db.prepare(`
      INSERT INTO lessons_fts (action_kind, action_key, root_cause, lesson_text, hint, impact, ts, frequency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let indexed = 0;
    for (const l of all) {
      insert.run(
        String(l.action_kind || 'recommendation'),
        String(l.action_key || ''),
        String(l.root_cause || 'UNKNOWN'),
        String(l.lesson_text || ''),
        String(l.hint || ''),
        String(l.impact || 'advisory'),
        String(l.ts || ''),
        Number.isFinite(l.frequency) ? l.frequency : 0,
      );
      indexed += 1;
    }
    return { ok: true, indexed, indexPath: idxFile };
  } finally {
    db.close();
  }
}

function openIndexReadOnly(slug, opts = {}) {
  const idxFile = opts.indexPath || indexPath(slug, opts);
  if (!fs.existsSync(idxFile)) {
    return { ok: false, code: 'INDEX_NOT_BUILT', error: `Index not built for slug=${slug}. Run buildIndex first.`, indexPath: idxFile };
  }
  return { ok: true, db: new DatabaseSync(idxFile, { readOnly: true }), indexPath: idxFile };
}

function rowsToLessons(rows) {
  return rows.map((r) => ({
    action_kind: r.action_kind,
    action_key: r.action_key,
    root_cause: r.root_cause,
    lesson_text: r.lesson_text,
    hint: r.hint,
    impact: r.impact,
    ts: r.ts,
    frequency: Number.isFinite(r.frequency) ? r.frequency : 0,
  }));
}

// Sprint 3.2 v0 — escape FTS5 special chars for safe full-text query.
// FTS5 MATCH syntax: bare words are AND'd, quotes escape. Wrap each
// term in double quotes and double any internal quotes per FTS5 spec.
function escapeFtsTerm(term) {
  return `"${String(term).replace(/"/g, '""')}"`;
}

/**
 * Full-text search across lesson_text + hint + root_cause.
 */
function searchByText(slug, query, opts = {}) {
  assertSafeSlug(slug);
  if (!sqliteAvailable) return { ok: false, code: 'SQLITE_UNAVAILABLE', error: unavailableReason(), hits: [] };
  if (typeof query !== 'string' || query.trim().length === 0) {
    return { ok: false, code: 'INVALID_QUERY', error: 'query must be a non-empty string', hits: [] };
  }
  const opened = openIndexReadOnly(slug, opts);
  if (!opened.ok) return { ...opened, hits: [] };
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(100, opts.limit) : 10;
  // Tokenize query terms, AND-join, score by bm25.
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 16).map(escapeFtsTerm).join(' AND ');
  try {
    const rows = opened.db.prepare(`
      SELECT action_kind, action_key, root_cause, lesson_text, hint, impact, ts, frequency,
             bm25(lessons_fts) AS rank
      FROM lessons_fts
      WHERE lessons_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(terms, limit);
    return { ok: true, hits: rowsToLessons(rows), query };
  } finally {
    opened.db.close();
  }
}

function searchByActionKind(slug, actionKind, opts = {}) {
  assertSafeSlug(slug);
  if (!sqliteAvailable) return { ok: false, code: 'SQLITE_UNAVAILABLE', error: unavailableReason(), hits: [] };
  const opened = openIndexReadOnly(slug, opts);
  if (!opened.ok) return { ...opened, hits: [] };
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(100, opts.limit) : 20;
  try {
    const rows = opened.db.prepare(`
      SELECT action_kind, action_key, root_cause, lesson_text, hint, impact, ts, frequency
      FROM lessons_fts
      WHERE action_kind = ?
      ORDER BY ts DESC
      LIMIT ?
    `).all(String(actionKind || ''), limit);
    return { ok: true, hits: rowsToLessons(rows) };
  } finally {
    opened.db.close();
  }
}

function searchByErrorCode(slug, errorCode, opts = {}) {
  assertSafeSlug(slug);
  if (!sqliteAvailable) return { ok: false, code: 'SQLITE_UNAVAILABLE', error: unavailableReason(), hits: [] };
  // Sprint 3.2 R2 (security-auditor HIGH): mirror searchByText typeof guard
  // so non-string / empty inputs don't coerce to literal "undefined" via
  // template-string concat (defense-in-depth; FTS5 binding is still safe).
  if (typeof errorCode !== 'string' || errorCode.trim().length === 0) {
    return { ok: false, code: 'INVALID_ERROR_CODE', error: 'errorCode must be a non-empty string', hits: [] };
  }
  const opened = openIndexReadOnly(slug, opts);
  if (!opened.ok) return { ...opened, hits: [] };
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(100, opts.limit) : 20;
  try {
    // root_cause is a free-text column in FTS5 — exact match by quoting.
    const rows = opened.db.prepare(`
      SELECT action_kind, action_key, root_cause, lesson_text, hint, impact, ts, frequency
      FROM lessons_fts
      WHERE lessons_fts MATCH ?
      ORDER BY ts DESC
      LIMIT ?
    `).all(`root_cause: ${escapeFtsTerm(errorCode)}`, limit);
    return { ok: true, hits: rowsToLessons(rows) };
  } finally {
    opened.db.close();
  }
}

module.exports = {
  isAvailable,
  unavailableReason,
  buildIndex,
  searchByText,
  searchByActionKind,
  searchByErrorCode,
  indexPath,
  // exported for tests
  assertSafeSlug,
  escapeFtsTerm,
};
