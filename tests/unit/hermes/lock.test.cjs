'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  acquireLock,
  releaseLock,
  isStale,
  readLock,
  lockPath,
} = require('../../../bin/hermes/_lib/lock.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hermes-lock-${prefix}-`));
}

describe('lock: basic acquire + release', () => {
  test('acquireLock writes structured payload', () => {
    const repoRoot = tmpRepo('basic');
    const handle = acquireLock(repoRoot, 'test-slug', { actionId: 'A1' });

    assert.ok(handle);
    assert.equal(handle.recovered, false);
    assert.match(handle.lockFilePath, /\.lock$/);
    assert.ok(fs.existsSync(handle.lockFilePath));

    const payload = readLock(handle.lockFilePath);
    assert.equal(typeof payload.pid, 'number');
    assert.equal(payload.action_id, 'A1');
    assert.match(payload.start_ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('releaseLock removes the file', () => {
    const repoRoot = tmpRepo('release');
    const handle = acquireLock(repoRoot, 'test-slug');
    assert.ok(fs.existsSync(handle.lockFilePath));

    const released = releaseLock(handle);
    assert.equal(released, true);
    assert.equal(fs.existsSync(handle.lockFilePath), false);
  });

  test('releaseLock is idempotent (already-released returns false)', () => {
    const repoRoot = tmpRepo('idem');
    const handle = acquireLock(repoRoot, 'test-slug');
    releaseLock(handle);
    const second = releaseLock(handle);
    assert.equal(second, false);
  });
});

describe('lock: collision detection', () => {
  test('second acquire on same slug throws EEXIST_FRESH', () => {
    const repoRoot = tmpRepo('collide');
    acquireLock(repoRoot, 'busy-slug', { actionId: 'first' });

    let err;
    try {
      acquireLock(repoRoot, 'busy-slug', { actionId: 'second' });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.equal(err.code, 'EEXIST_FRESH');
    assert.ok(err.heldBy);
    assert.equal(err.heldBy.action_id, 'first');
  });

  test('different slugs do not collide', () => {
    const repoRoot = tmpRepo('multi-slug');
    const a = acquireLock(repoRoot, 'slug-a');
    const b = acquireLock(repoRoot, 'slug-b');
    assert.notEqual(a.lockFilePath, b.lockFilePath);
    assert.ok(fs.existsSync(a.lockFilePath));
    assert.ok(fs.existsSync(b.lockFilePath));
  });
});

describe('lock: stale-lock recovery', () => {
  test('stale lock (mtime > 2x timeout) is overwritten + flagged recovered', () => {
    const repoRoot = tmpRepo('stale');
    const slug = 'stale-slug';
    const lp = lockPath(repoRoot, slug);

    fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(lp, JSON.stringify({ pid: 9999, start_ts: '2020-01-01', action_id: 'old' }));
    // Backdate mtime to make it stale
    const past = Date.now() - 60 * 60 * 1000; // 1h ago
    fs.utimesSync(lp, past / 1000, past / 1000);

    const handle = acquireLock(repoRoot, slug, { actionTimeoutMs: 60_000 }); // 60s timeout, mtime > 2x → stale
    assert.equal(handle.recovered, true);
    assert.ok(handle.stalePrevious);
    assert.equal(handle.stalePrevious.action_id, 'old');
  });

  test('fresh lock (mtime < 2x timeout) is NOT recovered', () => {
    const repoRoot = tmpRepo('fresh');
    const slug = 'fresh-slug';
    acquireLock(repoRoot, slug, { actionId: 'live', actionTimeoutMs: 60_000 });

    let err;
    try {
      acquireLock(repoRoot, slug, { actionId: 'second', actionTimeoutMs: 60_000 });
    } catch (e) {
      err = e;
    }
    assert.equal(err && err.code, 'EEXIST_FRESH');
  });

  test('isStale returns false on missing lock', () => {
    const repoRoot = tmpRepo('missing');
    const lp = lockPath(repoRoot, 'gone');
    assert.equal(isStale(lp, 1000), false);
  });
});

describe('lock: lock dir creation', () => {
  test('cortex/journal/<slug>/ created if missing', () => {
    const repoRoot = tmpRepo('nodir');
    const slug = 'fresh-slug';
    // Pre-condition: journal dir doesn't exist
    assert.equal(fs.existsSync(path.join(repoRoot, 'cortex', 'journal', slug)), false);

    const handle = acquireLock(repoRoot, slug);
    assert.ok(handle);
    assert.ok(fs.existsSync(path.join(repoRoot, 'cortex', 'journal', slug)));
  });
});
