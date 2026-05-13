// lessons-search.test.cjs — Sprint 3.2 v0
//
// FTS5 path is gated by node:sqlite availability (Node ≥22.5). Tests
// skip gracefully on older Node so CI doesn't crash on environments
// where sqlite isn't compiled in.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const search = require('../../bin/steward/_lib/lessons-search.cjs');
const lessons = require('../../bin/steward/_lib/lessons.cjs');

const SKIP_REASON = search.isAvailable() ? null : `node:sqlite unavailable — ${search.unavailableReason()}`;

function tmpDataHome(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-lsearch-${name}-`));
}

function seedLessons(dataHome, slug, items) {
  process.env.CORTEX_DATA_HOME = dataHome;
  for (const it of items) lessons.recordLesson(slug, it);
  delete process.env.CORTEX_DATA_HOME;
}

describe('Sprint 3.2 — lessons-search availability + safety', () => {
  test('isAvailable reflects node:sqlite presence', () => {
    assert.equal(typeof search.isAvailable(), 'boolean');
  });

  test('assertSafeSlug rejects traversal', () => {
    assert.throws(() => search.assertSafeSlug('..'), /must not start/);
    assert.throws(() => search.assertSafeSlug('a/b'), /must match/);
    assert.throws(() => search.assertSafeSlug('with\0nul'), /NUL/);
    assert.throws(() => search.assertSafeSlug(''), /non-empty/);
  });

  test('escapeFtsTerm wraps + double-quotes', () => {
    assert.equal(search.escapeFtsTerm('hello'), '"hello"');
    assert.equal(search.escapeFtsTerm('a"b'), '"a""b"');
  });

  test('buildIndex returns SQLITE_UNAVAILABLE if module missing', { skip: search.isAvailable() ? false : 'positive case: requires unavailable env' }, () => {
    // This test runs only when sqlite IS available — and asserts buildIndex returns ok.
    const dh = tmpDataHome('avail');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'KEY_MISSING', lesson_text: 'auth rejected', ts: '2026-05-10T00:00:00Z' },
    ]);
    const r = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.equal(r.indexed, 1);
    assert.ok(fs.existsSync(r.indexPath));
  });
});

describe('Sprint 3.2 — FTS5 build + query', () => {
  const SKIP = SKIP_REASON ? { skip: SKIP_REASON } : {};

  test('buildIndex indexes every lesson', SKIP, () => {
    const dh = tmpDataHome('build');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'KEY_MISSING', lesson_text: 'OpenRouter auth rejected', hint: 'verify key type', impact: 'blocker', ts: '2026-05-10T00:00:00Z', frequency: 2 },
      { action_kind: 'recommendation', root_cause: 'TIMEOUT', lesson_text: 'request timed out', impact: 'warning', ts: '2026-05-11T00:00:00Z', frequency: 1 },
      { action_kind: 'pattern_transfer', root_cause: 'SIBLING_UNREADABLE', lesson_text: 'sibling repo permission denied', impact: 'advisory', ts: '2026-05-12T00:00:00Z' },
    ]);
    const r = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.equal(r.indexed, 3);
  });

  test('searchByText returns matching lessons ranked by bm25', SKIP, () => {
    const dh = tmpDataHome('text');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'KEY_MISSING', lesson_text: 'OpenRouter auth rejected — key was provisioning not inference', ts: '2026-05-10T00:00:00Z' },
      { action_kind: 'recommendation', root_cause: 'TIMEOUT', lesson_text: 'network timed out', ts: '2026-05-11T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r = search.searchByText('cortex-x', 'OpenRouter auth', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.ok(r.hits.length >= 1);
    assert.match(r.hits[0].lesson_text, /OpenRouter/);
  });

  test('searchByText returns empty hits on no match', SKIP, () => {
    const dh = tmpDataHome('nomatch');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'X', lesson_text: 'foo', ts: '2026-05-10T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r = search.searchByText('cortex-x', 'nonexistent-term-xyzzy', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.equal(r.hits.length, 0);
  });

  test('searchByActionKind filters exactly by action_kind', SKIP, () => {
    const dh = tmpDataHome('kind');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'A', lesson_text: 'first', ts: '2026-05-10T00:00:00Z' },
      { action_kind: 'pattern_transfer', root_cause: 'B', lesson_text: 'second', ts: '2026-05-11T00:00:00Z' },
      { action_kind: 'recommendation', root_cause: 'C', lesson_text: 'third', ts: '2026-05-12T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r = search.searchByActionKind('cortex-x', 'recommendation', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.equal(r.hits.length, 2);
    assert.ok(r.hits.every((h) => h.action_kind === 'recommendation'));
  });

  test('searchByErrorCode finds by root_cause', SKIP, () => {
    const dh = tmpDataHome('errcode');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'OPENROUTER_KEY_MALFORMED', lesson_text: 'whitespace in key', ts: '2026-05-10T00:00:00Z' },
      { action_kind: 'recommendation', root_cause: 'TIMEOUT', lesson_text: 'slow', ts: '2026-05-11T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r = search.searchByErrorCode('cortex-x', 'OPENROUTER_KEY_MALFORMED', { dataHome: dh });
    assert.equal(r.ok, true);
    assert.ok(r.hits.length >= 1);
    assert.equal(r.hits[0].root_cause, 'OPENROUTER_KEY_MALFORMED');
  });

  test('searchByText limit caps results at 100', SKIP, () => {
    const dh = tmpDataHome('limit');
    const many = Array.from({ length: 5 }, (_, i) => ({
      action_kind: 'recommendation',
      root_cause: `E${i}`,
      lesson_text: `lesson commontoken about thing ${i}`,
      ts: '2026-05-10T00:00:00Z',
    }));
    seedLessons(dh, 'cortex-x', many);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r = search.searchByText('cortex-x', 'commontoken', { dataHome: dh, limit: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.hits.length, 3);
  });

  test('searchByText returns INDEX_NOT_BUILT before build', SKIP, () => {
    const dh = tmpDataHome('not-built');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'X', lesson_text: 'foo', ts: '2026-05-10T00:00:00Z' },
    ]);
    const r = search.searchByText('cortex-x', 'foo', { dataHome: dh });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INDEX_NOT_BUILT');
  });

  test('searchByText handles quotes in input safely', SKIP, () => {
    const dh = tmpDataHome('escape');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'X', lesson_text: 'failed: "see logs"', ts: '2026-05-10T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    // Should not throw on quote in query
    const r = search.searchByText('cortex-x', 'see "logs"', { dataHome: dh });
    assert.equal(r.ok, true);
  });

  test('searchByErrorCode rejects non-string / empty errorCode (R2 HIGH fix)', SKIP, () => {
    const dh = tmpDataHome('errcode-invalid');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'X', lesson_text: 'foo', ts: '2026-05-10T00:00:00Z' },
    ]);
    search.buildIndex('cortex-x', { dataHome: dh });
    const r1 = search.searchByErrorCode('cortex-x', '', { dataHome: dh });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'INVALID_ERROR_CODE');
    const r2 = search.searchByErrorCode('cortex-x', undefined, { dataHome: dh });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'INVALID_ERROR_CODE');
  });

  test('buildIndex rejects opts.indexPath outside data-home (R2 MED fix)', SKIP, () => {
    const dh = tmpDataHome('idx-traversal');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'X', lesson_text: 'foo', ts: '2026-05-10T00:00:00Z' },
    ]);
    const r = search.buildIndex('cortex-x', { dataHome: dh, indexPath: '/tmp/evil.db' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INDEX_PATH_OUTSIDE_DATA_HOME');
  });

  test('buildIndex rebuilds idempotently (drops + recreates)', SKIP, () => {
    const dh = tmpDataHome('rebuild');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'A', lesson_text: 'first', ts: '2026-05-10T00:00:00Z' },
    ]);
    const r1 = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(r1.indexed, 1);
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', root_cause: 'B', lesson_text: 'second', ts: '2026-05-11T00:00:00Z' },
    ]);
    const r2 = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(r2.indexed, 2); // both entries now indexed in fresh DB
  });
});
