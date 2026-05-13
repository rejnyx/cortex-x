// lessons-recall-fts.test.cjs — Sprint 3.2 v1 FTS recall integration

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lessons = require('../../bin/steward/_lib/lessons.cjs');
const search = require('../../bin/steward/_lib/lessons-search.cjs');

const SKIP_REASON = search.isAvailable() ? null : `node:sqlite unavailable — ${search.unavailableReason()}`;

function tmpDataHome(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-recall-fts-${name}-`));
}

function seedLessons(dataHome, slug, items) {
  process.env.CORTEX_DATA_HOME = dataHome;
  for (const it of items) lessons.recordLesson(slug, it);
  delete process.env.CORTEX_DATA_HOME;
}

describe('Sprint 3.2 v1 — recallLessonsFTS fall-back behavior', () => {
  const SKIP = SKIP_REASON ? { skip: SKIP_REASON } : {};

  test('falls back to linear scan when no index built', () => {
    const dh = tmpDataHome('no-idx');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', action_key: 'cortex-x#w1', root_cause: 'KEY_MISSING', lesson_text: 'key was empty', impact: 'blocker', ts: '2026-05-13T10:00:00Z', frequency: 1 },
    ]);
    process.env.CORTEX_DATA_HOME = dh;
    try {
      const out = lessons.recallLessonsFTS('cortex-x', { action_kind: 'recommendation', action_key: 'cortex-x#w1' });
      assert.equal(Array.isArray(out), true);
      assert.equal(out.length, 1); // linear-scan fall-back works
      assert.equal(out[0].action_key, 'cortex-x#w1');
    } finally {
      delete process.env.CORTEX_DATA_HOME;
    }
  });

  test('falls back to linear scan when index is stale beyond maxIdxAgeMs', SKIP, () => {
    const dh = tmpDataHome('stale-idx');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', action_key: 'cortex-x#w1', root_cause: 'X', lesson_text: 'foo', impact: 'blocker', ts: '2026-05-13T10:00:00Z', frequency: 1 },
    ]);
    const idxResult = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(idxResult.ok, true);
    // Backdate the index file by 24 hours
    const ancient = new Date(Date.now() - 24 * 60 * 60 * 1000);
    fs.utimesSync(idxResult.indexPath, ancient, ancient);
    process.env.CORTEX_DATA_HOME = dh;
    try {
      const out = lessons.recallLessonsFTS('cortex-x', { action_kind: 'recommendation', action_key: 'cortex-x#w1' }, {
        maxIdxAgeMs: 6 * 60 * 60 * 1000, // 6h
      });
      // Should fall back to linear scan, still returns the lesson
      assert.equal(out.length, 1);
    } finally {
      delete process.env.CORTEX_DATA_HOME;
    }
  });
});

describe('Sprint 3.2 v1 R2 — clock-skew defense', () => {
  const SKIP = SKIP_REASON ? { skip: SKIP_REASON } : {};

  test('falls back to linear scan when mtime is in the FUTURE (negative ageMs)', SKIP, () => {
    const dh = tmpDataHome('clock-skew');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', action_key: 'cortex-x#w1', root_cause: 'X', lesson_text: 'foo', impact: 'blocker', ts: '2026-05-13T10:00:00Z', frequency: 1 },
    ]);
    const built = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(built.ok, true);
    // Set mtime 1 day in the future — simulates NTP correction / VM
    // snapshot restore / wall-clock fiddling.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    fs.utimesSync(built.indexPath, future, future);
    process.env.CORTEX_DATA_HOME = dh;
    try {
      // Sprint 2.19 incident class — negative ageMs must NOT bypass the
      // freshness gate. Linear-scan should fire.
      const out = lessons.recallLessonsFTS('cortex-x', {
        action_kind: 'recommendation',
        action_key: 'cortex-x#w1',
      });
      assert.equal(out.length, 1);
      assert.equal(out[0].action_key, 'cortex-x#w1');
    } finally {
      delete process.env.CORTEX_DATA_HOME;
    }
  });
});

describe('Sprint 3.2 v1 — recallLessonsFTS happy path', () => {
  const SKIP = SKIP_REASON ? { skip: SKIP_REASON } : {};

  test('uses FTS when index exists + fresh', SKIP, () => {
    const dh = tmpDataHome('fts-happy');
    seedLessons(dh, 'cortex-x', [
      { action_kind: 'recommendation', action_key: 'cortex-x#w1', root_cause: 'OPENROUTER_KEY_MALFORMED', lesson_text: 'whitespace stripped key', impact: 'blocker', ts: '2026-05-13T10:00:00Z', frequency: 2 },
      { action_kind: 'recommendation', action_key: 'cortex-x#w2', root_cause: 'TIMEOUT', lesson_text: 'request slow', impact: 'warning', ts: '2026-05-13T11:00:00Z', frequency: 0 },
    ]);
    const built = search.buildIndex('cortex-x', { dataHome: dh });
    assert.equal(built.ok, true);
    process.env.CORTEX_DATA_HOME = dh;
    try {
      const out = lessons.recallLessonsFTS('cortex-x', {
        action_kind: 'recommendation',
        action_key: 'cortex-x#w1',
      }, { topK: 2 });
      assert.ok(out.length >= 1);
      // Action-key match should win
      assert.equal(out[0].action_key, 'cortex-x#w1');
    } finally {
      delete process.env.CORTEX_DATA_HOME;
    }
  });

  test('returns empty array when slug has no lessons', SKIP, () => {
    const dh = tmpDataHome('empty');
    process.env.CORTEX_DATA_HOME = dh;
    try {
      const out = lessons.recallLessonsFTS('cortex-x', { action_kind: 'recommendation' });
      assert.equal(Array.isArray(out), true);
      assert.equal(out.length, 0);
    } finally {
      delete process.env.CORTEX_DATA_HOME;
    }
  });
});
