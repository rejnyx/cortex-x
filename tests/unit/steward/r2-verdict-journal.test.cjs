'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendSeen,
  wasSeen,
  loadJournal,
  _SCHEMA_VERSION,
  _DEFAULT_CAPACITY,
  _journalPath,
} = require('../../../bin/steward/_lib/r2-verdict-journal.cjs');

// Track every tempdir we create so we can clean them up in a single after().
const _tempdirs = [];

function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-journal-'));
  _tempdirs.push(dir);
  return dir;
}

function entryFor(workflowRunId, overrides) {
  return Object.assign(
    {
      workflowRunId,
      sprintId: '2.46.1',
      commitSha: 'abc123def4567890abc123def4567890abc123de',
      seenAt: '2026-06-03T12:00:00.000Z',
    },
    overrides || {}
  );
}

after(() => {
  for (const dir of _tempdirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort */
    }
  }
});

describe('r2-verdict-journal: round-trip', () => {
  test('appendSeen + wasSeen — just-appended id is seen', () => {
    const root = freshRoot();
    const id = 'wf-' + 'a'.repeat(32);
    appendSeen(root, entryFor(id));
    assert.equal(wasSeen(root, id), true);
  });

  test('wasSeen returns false for never-appended id', () => {
    const root = freshRoot();
    assert.equal(wasSeen(root, 'wf-never-appended'), false);
  });

  test('wasSeen handles missing/empty workflow_run_id gracefully', () => {
    const root = freshRoot();
    assert.equal(wasSeen(root, ''), false);
    assert.equal(wasSeen(root, undefined), false);
    assert.equal(wasSeen(root, null), false);
  });
});

describe('r2-verdict-journal: loadJournal', () => {
  test('returns empty journal on ENOENT (no throw — fail-OPEN)', () => {
    const root = freshRoot();
    const j = loadJournal(root);
    assert.equal(j.schema_version, _SCHEMA_VERSION);
    assert.equal(j.capacity, _DEFAULT_CAPACITY);
    assert.deepEqual(j.entries, []);
  });

  test('round-trips a manually-written journal', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const seed = {
      schema_version: _SCHEMA_VERSION,
      capacity: _DEFAULT_CAPACITY,
      entries: [
        {
          workflow_run_id: 'wf-seed-1',
          sprint_id: '2.46.1',
          commit_sha: 'a'.repeat(40),
          seen_at: '2026-06-03T00:00:00.000Z',
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(seed, null, 2));
    const j = loadJournal(root);
    assert.equal(j.entries.length, 1);
    assert.equal(j.entries[0].workflow_run_id, 'wf-seed-1');
    assert.equal(wasSeen(root, 'wf-seed-1'), true);
  });

  test('schema_version mismatch throws explicit code', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ schema_version: 99, capacity: 1000, entries: [] })
    );
    assert.throws(
      () => loadJournal(root),
      (err) => err.code === 'CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH'
    );
  });

  test('malformed JSON throws on loadJournal (read-only consumers see corruption)', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not json at all');
    assert.throws(
      () => loadJournal(root),
      (err) => err.code === 'CORTEX_R2_VERDICT_JOURNAL_MALFORMED_JSON'
    );
  });
});

describe('r2-verdict-journal: persistence + shape', () => {
  test('appendSeen persists JSON of the expected shape on disk', () => {
    const root = freshRoot();
    const id = 'wf-shape-1';
    appendSeen(root, entryFor(id));
    const filePath = _journalPath(root);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schema_version, _SCHEMA_VERSION);
    assert.equal(parsed.capacity, _DEFAULT_CAPACITY);
    assert.ok(Array.isArray(parsed.entries));
    assert.equal(parsed.entries.length, 1);
    const ent = parsed.entries[0];
    assert.equal(ent.workflow_run_id, id);
    assert.equal(ent.sprint_id, '2.46.1');
    assert.equal(ent.commit_sha, 'abc123def4567890abc123def4567890abc123de');
    assert.equal(ent.seen_at, '2026-06-03T12:00:00.000Z');
  });

  test('two rapid appends both persist (simulated concurrency)', () => {
    const root = freshRoot();
    appendSeen(root, entryFor('wf-rapid-1'));
    appendSeen(root, entryFor('wf-rapid-2'));
    const j = loadJournal(root);
    assert.equal(j.entries.length, 2);
    assert.equal(j.entries[0].workflow_run_id, 'wf-rapid-1');
    assert.equal(j.entries[1].workflow_run_id, 'wf-rapid-2');
    assert.equal(wasSeen(root, 'wf-rapid-1'), true);
    assert.equal(wasSeen(root, 'wf-rapid-2'), true);
  });
});

describe('r2-verdict-journal: input validation', () => {
  test('rejects missing workflow_run_id with explicit error', () => {
    const root = freshRoot();
    assert.throws(
      () => appendSeen(root, entryFor(undefined)),
      /MISSING_WORKFLOW_RUN_ID/
    );
    assert.throws(
      () => appendSeen(root, entryFor('')),
      /MISSING_WORKFLOW_RUN_ID/
    );
  });

  test('rejects missing sprint_id / commit_sha / seen_at', () => {
    const root = freshRoot();
    assert.throws(
      () => appendSeen(root, entryFor('wf-1', { sprintId: undefined })),
      /MISSING_SPRINT_ID/
    );
    assert.throws(
      () => appendSeen(root, entryFor('wf-1', { commitSha: undefined })),
      /MISSING_COMMIT_SHA/
    );
    assert.throws(
      () => appendSeen(root, entryFor('wf-1', { seenAt: undefined })),
      /MISSING_SEEN_AT/
    );
  });

  test('rejects missing entry object outright', () => {
    const root = freshRoot();
    assert.throws(() => appendSeen(root, null), /ENTRY_REQUIRED/);
    assert.throws(() => appendSeen(root, undefined), /ENTRY_REQUIRED/);
  });
});

describe('r2-verdict-journal: FIFO eviction', () => {
  test('default capacity (1000): appending 1001 entries evicts the oldest', () => {
    const root = freshRoot();
    // Seed exactly capacity entries.
    for (let i = 0; i < _DEFAULT_CAPACITY; i++) {
      appendSeen(root, entryFor('wf-fifo-' + i));
    }
    let j = loadJournal(root);
    assert.equal(j.entries.length, _DEFAULT_CAPACITY);
    assert.equal(j.entries[0].workflow_run_id, 'wf-fifo-0');
    assert.equal(wasSeen(root, 'wf-fifo-0'), true);

    // 1001st append must evict the oldest.
    const res = appendSeen(root, entryFor('wf-fifo-' + _DEFAULT_CAPACITY));
    assert.equal(res.entries, _DEFAULT_CAPACITY);
    assert.equal(res.evicted, 1);
    j = loadJournal(root);
    assert.equal(j.entries.length, _DEFAULT_CAPACITY);
    assert.equal(wasSeen(root, 'wf-fifo-0'), false, 'oldest id evicted');
    assert.equal(
      wasSeen(root, 'wf-fifo-' + _DEFAULT_CAPACITY),
      true,
      'newest id present'
    );
    assert.equal(
      j.entries[j.entries.length - 1].workflow_run_id,
      'wf-fifo-' + _DEFAULT_CAPACITY
    );
  });

  test('custom capacity via seeded journal — eviction respects the override', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Seed a journal with capacity=3.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schema_version: _SCHEMA_VERSION,
        capacity: 3,
        entries: [],
      })
    );
    appendSeen(root, entryFor('wf-cap-1'));
    appendSeen(root, entryFor('wf-cap-2'));
    appendSeen(root, entryFor('wf-cap-3'));
    let j = loadJournal(root);
    assert.equal(j.entries.length, 3);
    assert.equal(j.capacity, 3);

    const res = appendSeen(root, entryFor('wf-cap-4'));
    assert.equal(res.entries, 3);
    assert.equal(res.evicted, 1);
    j = loadJournal(root);
    assert.equal(j.entries.length, 3);
    assert.equal(wasSeen(root, 'wf-cap-1'), false, 'first id evicted');
    assert.equal(wasSeen(root, 'wf-cap-4'), true, 'newest id present');
    assert.equal(j.entries[0].workflow_run_id, 'wf-cap-2');
    assert.equal(j.entries[2].workflow_run_id, 'wf-cap-4');
  });
});

describe('r2-verdict-journal: corruption handling', () => {
  test('malformed JSON is quarantined; appendSeen succeeds on a fresh journal', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '<<< not json >>>');

    appendSeen(root, entryFor('wf-after-corrupt'));

    // The active journal now contains only the new entry.
    const j = loadJournal(root);
    assert.equal(j.entries.length, 1);
    assert.equal(j.entries[0].workflow_run_id, 'wf-after-corrupt');

    // A quarantine sibling exists for operator triage.
    const dir = path.dirname(filePath);
    const siblings = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith('.r2-seen-runs.quarantine-'));
    assert.ok(
      siblings.length >= 1,
      'expected at least one quarantine sibling, got: ' + JSON.stringify(siblings)
    );
  });

  test('schema_version mismatch on appendSeen throws (no silent migration)', () => {
    const root = freshRoot();
    const filePath = _journalPath(root);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ schema_version: 42, capacity: 1000, entries: [] })
    );
    assert.throws(
      () => appendSeen(root, entryFor('wf-schema-mismatch')),
      (err) => err.code === 'CORTEX_R2_VERDICT_JOURNAL_SCHEMA_MISMATCH'
    );
  });
});

describe('r2-verdict-journal: independence of ids', () => {
  test('distinct ids are tracked independently', () => {
    const root = freshRoot();
    appendSeen(root, entryFor('wf-alpha'));
    appendSeen(root, entryFor('wf-beta'));
    appendSeen(root, entryFor('wf-gamma'));
    assert.equal(wasSeen(root, 'wf-alpha'), true);
    assert.equal(wasSeen(root, 'wf-beta'), true);
    assert.equal(wasSeen(root, 'wf-gamma'), true);
    assert.equal(wasSeen(root, 'wf-delta'), false);
  });
});
