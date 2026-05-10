// Sprint 2.13 — self-invocation tracker + 4 guardrails unit tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const {
  createInvocationTracker,
  readEvents,
  renderChainTree,
  argsHash,
  stableArgString,
  DEFAULT_MAX_DEPTH,
  DEFAULT_WALL_CLOCK_MS,
  DEFAULT_DEDUP_WINDOW,
  ABSOLUTE_MAX_DEPTH,
  ABSOLUTE_MAX_WALL_CLOCK_MS,
  VALID_SKILL_KINDS,
} = require('../../../bin/steward/_lib/self-invocation.cjs');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'self-inv-'));
}

function withDataHome(dir, fn) {
  const before = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dir;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.CORTEX_DATA_HOME;
    else process.env.CORTEX_DATA_HOME = before;
  }
}

describe('Sprint 2.13 — argsHash', () => {
  test('stable across key order', () => {
    assert.equal(argsHash('s', { x: 1, y: 2 }), argsHash('s', { y: 2, x: 1 }));
  });

  test('different skill produces different hash', () => {
    assert.notEqual(argsHash('a', { x: 1 }), argsHash('b', { x: 1 }));
  });

  test('different args produce different hash', () => {
    assert.notEqual(argsHash('s', { x: 1 }), argsHash('s', { x: 2 }));
  });

  test('handles null/undefined args', () => {
    assert.match(argsHash('s', null), /^[a-f0-9]{16}$/);
    assert.match(argsHash('s', undefined), /^[a-f0-9]{16}$/);
  });

  test('canonicalization handles Map/Set/BigInt without false-collide', () => {
    const a = stableArgString({ x: new Map([['a', 1]]) });
    const b = stableArgString({ x: new Set(['a']) });
    const c = stableArgString({ x: { a: 1 } });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
  });
});

describe('Sprint 2.13 — createInvocationTracker basics', () => {
  test('requires slug', () => {
    assert.throws(
      () => createInvocationTracker(),
      /slug is required/,
    );
    assert.throws(
      () => createInvocationTracker({ slug: 42 }),
      /slug is required/,
    );
  });

  test('rejects empty skill', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ args: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_SKILL');
  });

  test('happy-path single invocation succeeds', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: '/loop', args: { interval: '5m' } });
    assert.equal(r.ok, true);
    assert.equal(r.depth, 1);
    assert.match(r.invocationId, /^[0-9a-f-]{36}$/);
    assert.match(r.chainId, /^[0-9a-f-]{36}$/);
  });

  test('afterInvoke marks completion + records duration', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: '/loop', args: {} });
    const a = tr.afterInvoke(r.invocationId, { outcome: 'success' });
    assert.equal(a.ok, true);
    const chains = tr.listChains();
    assert.equal(chains[0].invocations[0].outcome, 'success');
    assert.ok(chains[0].invocations[0].completed_ts);
  });

  test('afterInvoke on unknown invocationId returns UNKNOWN_INVOCATION', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.afterInvoke('not-a-real-id');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNKNOWN_INVOCATION');
  });
});

describe('Sprint 2.13 — MAX_DEPTH guardrail', () => {
  test('depth 1, 2, 3 all allowed at default maxDepth=3 (distinct skills)', () => {
    // Distinct skills per level so the 3-record dedup window doesn't
    // false-block (default dedupWindow=3 would refuse a repeat of /loop).
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r1 = tr.beforeInvoke({ skill: '/loop' });
    assert.equal(r1.depth, 1);
    const r2 = tr.beforeInvoke({ skill: 'subagent', parentId: r1.invocationId });
    assert.equal(r2.depth, 2);
    const r3 = tr.beforeInvoke({ skill: 'schedule_wakeup', parentId: r2.invocationId });
    assert.equal(r3.depth, 3);
    assert.equal(r3.ok, true);
  });

  test('depth 4 blocked with MAX_DEPTH_EXCEEDED', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r1 = tr.beforeInvoke({ skill: 's1' });
    const r2 = tr.beforeInvoke({ skill: 's2', parentId: r1.invocationId });
    const r3 = tr.beforeInvoke({ skill: 's3', parentId: r2.invocationId });
    const r4 = tr.beforeInvoke({ skill: 's4', parentId: r3.invocationId });
    assert.equal(r4.ok, false);
    assert.equal(r4.code, 'MAX_DEPTH_EXCEEDED');
    assert.equal(r4.depth, 4);
    assert.equal(r4.maxDepth, 3);
  });

  test('custom maxDepth=2 blocks at depth 3', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, maxDepth: 2 });
    const r1 = tr.beforeInvoke({ skill: 's1' });
    const r2 = tr.beforeInvoke({ skill: 's2', parentId: r1.invocationId });
    const r3 = tr.beforeInvoke({ skill: 's3', parentId: r2.invocationId });
    assert.equal(r3.ok, false);
    assert.equal(r3.code, 'MAX_DEPTH_EXCEEDED');
  });

  test('maxDepth clamped to ABSOLUTE_MAX_DEPTH', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, maxDepth: 99_999 });
    assert.equal(tr.snapshot().maxDepth, ABSOLUTE_MAX_DEPTH);
  });
});

describe('Sprint 2.13 — WALL_CLOCK guardrail', () => {
  test('chain wall-clock under limit allows', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, wallClockMs: 60_000 });
    const r1 = tr.beforeInvoke({ skill: 'a' });
    const r2 = tr.beforeInvoke({ skill: 'b', parentId: r1.invocationId });
    assert.equal(r2.ok, true);
  });

  test('exceeded wall-clock blocks WALL_CLOCK_EXCEEDED', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, wallClockMs: 1 });
    const r1 = tr.beforeInvoke({ skill: 'a' });
    // Sleep so wall-clock advances. 5ms is well past the 1ms limit.
    const wait = Date.now() + 10;
    while (Date.now() < wait) { /* spin */ }
    const r2 = tr.beforeInvoke({ skill: 'b', parentId: r1.invocationId });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'WALL_CLOCK_EXCEEDED');
    assert.ok(r2.elapsedMs > 1);
  });

  test('wallClockMs clamped to ABSOLUTE_MAX_WALL_CLOCK_MS', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, wallClockMs: 999_999_999_999 });
    assert.equal(tr.snapshot().wallClockMs, ABSOLUTE_MAX_WALL_CLOCK_MS);
  });
});

describe('Sprint 2.13 — DEDUP guardrail', () => {
  test('identical (skill, args) within window blocks DEDUP_BLOCKED', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, dedupWindow: 3 });
    const r1 = tr.beforeInvoke({ skill: '/loop', args: { x: 1 } });
    const r2 = tr.beforeInvoke({ skill: '/loop', args: { x: 1 }, parentId: r1.invocationId });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'DEDUP_BLOCKED');
    assert.equal(r2.dedupWindow, 3);
  });

  test('same skill different args allowed', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r1 = tr.beforeInvoke({ skill: '/loop', args: { x: 1 } });
    const r2 = tr.beforeInvoke({ skill: '/loop', args: { x: 2 }, parentId: r1.invocationId });
    assert.equal(r2.ok, true);
  });

  test('past window-size identical-call allowed (window slid past it)', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false, dedupWindow: 2 });
    const r1 = tr.beforeInvoke({ skill: 'a', args: {} });
    const r2 = tr.beforeInvoke({ skill: 'b', args: {}, parentId: r1.invocationId });
    const r3 = tr.beforeInvoke({ skill: 'c', args: {}, parentId: r2.invocationId });
    // r1's `a` is now outside dedup window of 2 — repeating `a` should be allowed.
    const r4 = tr.beforeInvoke({ skill: 'a', args: {}, parentId: r3.invocationId });
    assert.equal(r4.ok, false, 'depth=4 hits MAX_DEPTH first; not a DEDUP test');
    // Use a fresh tracker with bigger maxDepth to test dedup-only.
    const tr2 = createInvocationTracker({ slug: 't2', persist: false, dedupWindow: 2, maxDepth: 10 });
    const a = tr2.beforeInvoke({ skill: 'a' });
    const b = tr2.beforeInvoke({ skill: 'b', parentId: a.invocationId });
    const c = tr2.beforeInvoke({ skill: 'c', parentId: b.invocationId });
    const d = tr2.beforeInvoke({ skill: 'a', parentId: c.invocationId });
    assert.equal(d.ok, true, 'a beyond dedupWindow=2 must be re-allowed');
  });

  test('different chains do NOT cross-contaminate dedup', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const a = tr.beforeInvoke({ skill: 'x', args: { v: 1 } });
    // Different chain (no parent) — same (skill, args) should be allowed.
    const b = tr.beforeInvoke({ skill: 'x', args: { v: 1 } });
    assert.equal(b.ok, true);
    assert.notEqual(a.chainId, b.chainId);
  });
});

describe('Sprint 2.13 — COST_GATE optional check', () => {
  test('costGateCheck returning tripped blocks COST_GATE_TRIPPED', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({
      skill: '/loop',
      args: {},
      costGateCheck: () => ({ tripped: true, reason: 'daily cap reached' }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'COST_GATE_TRIPPED');
    assert.match(r.message, /daily cap/);
  });

  test('costGateCheck returning ok allows', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({
      skill: '/loop',
      args: {},
      costGateCheck: () => ({ tripped: false }),
    });
    assert.equal(r.ok, true);
  });

  test('no costGateCheck function — unaffected', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: '/loop' });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.13 — persistence (JSONL append-only)', () => {
  test('events written to data-home/self-invocations/<slug>.jsonl', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'persist1' });
        const r = tr.beforeInvoke({ skill: '/loop', args: { x: 1 } });
        tr.afterInvoke(r.invocationId, { outcome: 'success' });
      });
      const p = path.join(home, 'self-invocations', 'persist1.jsonl');
      assert.ok(fs.existsSync(p));
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      assert.equal(lines.length, 2);
      const e1 = JSON.parse(lines[0]);
      const e2 = JSON.parse(lines[1]);
      assert.equal(e1.kind, 'started');
      assert.equal(e2.kind, 'completed');
      assert.equal(e1.skill, '/loop');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('blocked events also persisted', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'persist2', maxDepth: 1 });
        const a = tr.beforeInvoke({ skill: 'a' });
        const b = tr.beforeInvoke({ skill: 'b', parentId: a.invocationId });
        assert.equal(b.ok, false);
      });
      const p = path.join(home, 'self-invocations', 'persist2.jsonl');
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      const blocked = lines.map(JSON.parse).find((e) => e.kind === 'blocked');
      assert.ok(blocked);
      assert.equal(blocked.code, 'MAX_DEPTH_EXCEEDED');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('persist=false disables file writes', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'persist3', persist: false });
        tr.beforeInvoke({ skill: '/loop' });
      });
      const p = path.join(home, 'self-invocations', 'persist3.jsonl');
      assert.equal(fs.existsSync(p), false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('readEvents returns empty array when log absent', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        assert.deepEqual(readEvents('not-yet'), []);
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('malformed lines in log are skipped, not fatal', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const dir = path.join(home, 'self-invocations');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'corrupt.jsonl'),
          '{"valid":1}\n{ broken json\n{"valid":2}\n');
        const events = readEvents('corrupt');
        assert.equal(events.length, 2);
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.13 — renderChainTree', () => {
  test('empty events render as "(no chains recorded)"', () => {
    assert.equal(renderChainTree([]), '(no chains recorded)');
  });

  test('renders started events as indented tree', () => {
    const events = [
      { kind: 'started', chainId: 'chain-a', invocationId: 'inv1', depth: 1, skill: '/loop', argsPreview: '{}', ts: '2026-05-10T14:00:00Z' },
      { kind: 'started', chainId: 'chain-a', invocationId: 'inv2', depth: 2, skill: 'subagent', argsPreview: '{"x":1}', ts: '2026-05-10T14:00:30Z' },
    ];
    const out = renderChainTree(events);
    assert.match(out, /chain chain-a/);
    assert.match(out, /\/loop/);
    assert.match(out, /subagent/);
    assert.match(out, /depth=2/);
  });

  test('renders blocked events with [BLOCKED:CODE] marker', () => {
    const events = [
      { kind: 'started', chainId: 'c', invocationId: 'i1', depth: 1, skill: 'a', ts: '2026-05-10T14:00:00Z' },
      { kind: 'blocked', chainId: 'c', depth: 4, skill: 'd', code: 'MAX_DEPTH_EXCEEDED', ts: '2026-05-10T14:01:00Z' },
    ];
    const out = renderChainTree(events);
    assert.match(out, /\[BLOCKED:MAX_DEPTH_EXCEEDED\]/);
  });

  test('limit caps to most-recent N chains', () => {
    const events = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        kind: 'started', chainId: `c${i}`, invocationId: `i${i}`,
        depth: 1, skill: 's', ts: `2026-05-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      });
    }
    const out = renderChainTree(events, { limit: 2 });
    assert.match(out, /chain c4/); // most recent
    assert.match(out, /chain c3/);
    assert.equal(out.includes('chain c0'), false);
  });
});

describe('Sprint 2.13 R2 — slug path-traversal rejection (BLOCKER fix)', () => {
  test('createInvocationTracker rejects path-traversal slug', () => {
    assert.throws(
      () => createInvocationTracker({ slug: '../../etc/passwd' }),
      /UNSAFE_SLUG|invalid slug/i,
    );
  });

  test('createInvocationTracker rejects slug with separator', () => {
    assert.throws(
      () => createInvocationTracker({ slug: 'foo/bar' }),
      /UNSAFE_SLUG|invalid slug/i,
    );
  });

  test('createInvocationTracker rejects empty slug', () => {
    assert.throws(
      () => createInvocationTracker({ slug: '' }),
      /slug is required/,
    );
  });

  test('createInvocationTracker accepts safe slug', () => {
    const tr = createInvocationTracker({ slug: 'cortex-x', persist: false });
    assert.equal(tr.snapshot().slug, 'cortex-x');
  });
});

describe('Sprint 2.13 R2 — UNKNOWN_PARENT rejection (HIGH fix)', () => {
  test('parentId not in any tracked chain returns UNKNOWN_PARENT', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: '/loop', parentId: '00000000-0000-0000-0000-000000000000' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'UNKNOWN_PARENT');
  });

  test('null parentId starts new chain (root invocation)', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: '/loop', parentId: null });
    assert.equal(r.ok, true);
    assert.equal(r.depth, 1);
  });
});

describe('Sprint 2.13 R2 — costGateCheck try/catch (HIGH fix)', () => {
  test('throwing costGateCheck fails closed (treated as tripped)', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({
      skill: '/loop',
      costGateCheck: () => { throw new Error('boom'); },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'COST_GATE_TRIPPED');
    assert.match(r.message, /costGateCheck threw/);
  });

  test('costGateCheck returning malformed object handled gracefully', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({
      skill: '/loop',
      costGateCheck: () => null,
    });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.13 R2 — skill length cap (MEDIUM fix)', () => {
  test('skill > MAX_SKILL_LENGTH (256) rejected', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: 'x'.repeat(257) });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_SKILL');
    assert.match(r.error, /MAX_SKILL_LENGTH/);
  });

  test('skill at exactly MAX_SKILL_LENGTH (256) accepted', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    const r = tr.beforeInvoke({ skill: 'x'.repeat(256) });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.13 R2 — clock-skew clamp (MEDIUM fix)', () => {
  test('negative duration clamped to 0 with clock_skew_detected sentinel', () => {
    // Verify by reading the persisted event after stubbing Date.now.
    // We inject a forward jump at afterInvoke time so completed_ts -
    // started_ms is negative.
    const realNow = Date.now;
    const realDateParse = Date.parse;
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'skew' });
        // Make beforeInvoke see a far-future timestamp so started_ms
        // will be > completed_ts after we restore.
        Date.now = () => realNow() + 60_000;
        const r = tr.beforeInvoke({ skill: '/loop' });
        // Restore Date.now so afterInvoke captures a "now" that is
        // earlier than started_ms — simulating clock backward jump.
        Date.now = realNow;
        const after = tr.afterInvoke(r.invocationId, { outcome: 'success' });
        assert.equal(after.ok, true);
        const events = tr.readEvents();
        const completed = events.find((e) => e.kind === 'completed');
        assert.ok(completed, 'completed event should be persisted');
        assert.equal(completed.durationMs, 0);
        assert.equal(completed.clock_skew_detected, true);
      });
    } finally {
      Date.now = realNow;
      Date.parse = realDateParse;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('positive duration recorded normally (no skew sentinel)', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'normal' });
        const r = tr.beforeInvoke({ skill: '/loop' });
        const after = tr.afterInvoke(r.invocationId, { outcome: 'success' });
        assert.equal(after.ok, true);
        const events = tr.readEvents();
        const completed = events.find((e) => e.kind === 'completed');
        assert.ok(completed.durationMs >= 0);
        assert.equal(completed.clock_skew_detected, undefined);
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.13 R2 — persistenceErrors counter (HIGH fix)', () => {
  test('snapshot exposes persistenceErrors=0 on clean tracker', () => {
    const tr = createInvocationTracker({ slug: 'test', persist: false });
    assert.equal(tr.snapshot().persistenceErrors, 0);
  });

  test('snapshot.persistenceErrors increments when appendEvent fails', () => {
    // Force append failure by pointing data home at a path occupied by
    // a regular file (mkdirSync EEXIST → caught → recordPersist increments).
    const home = tmpHome();
    try {
      // Pre-create a file at the location where mkdirSync would create
      // 'self-invocations' subdirectory.
      const blockedDir = path.join(home, 'self-invocations');
      fs.writeFileSync(blockedDir, 'block');
      withDataHome(home, () => {
        const tr = createInvocationTracker({ slug: 'errs' });
        tr.beforeInvoke({ skill: '/loop' });
        assert.ok(tr.snapshot().persistenceErrors >= 1, 'persistence error not surfaced');
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.13 R2 — readEvents log size cap (MEDIUM fix)', () => {
  test('oversized log returns single log_oversize sentinel', () => {
    const home = tmpHome();
    try {
      withDataHome(home, () => {
        const dir = path.join(home, 'self-invocations');
        fs.mkdirSync(dir, { recursive: true });
        // Write a 51 MiB file to exceed the 50 MiB cap.
        const fp = path.join(dir, 'huge.jsonl');
        const fd = fs.openSync(fp, 'w');
        try {
          // Write a single null byte at offset 51 MiB to size the file
          // without allocating 51 MiB in memory.
          fs.writeSync(fd, Buffer.alloc(1), 0, 1, 51 * 1024 * 1024);
        } finally {
          fs.closeSync(fd);
        }
        const events = readEvents('huge');
        assert.equal(events.length, 1);
        assert.equal(events[0].kind, 'log_oversize');
        assert.ok(events[0].size > 50 * 1024 * 1024);
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.13 — property tests (fast-check)', () => {
  test('beforeInvoke with arbitrary skill never throws', () => {
    fc.assert(
      fc.property(fc.string(), fc.anything(), (skill, args) => {
        const tr = createInvocationTracker({ slug: 'fc-test', persist: false });
        const r = tr.beforeInvoke({ skill, args });
        return typeof r === 'object' && r !== null && typeof r.ok === 'boolean';
      }),
      { numRuns: 100 },
    );
  });

  test('depth-N invocations always blocked at depth N+1 with MAX_DEPTH=N', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        const tr = createInvocationTracker({ slug: 'fc-depth', persist: false, maxDepth: n });
        let parentId = null;
        for (let i = 0; i < n; i++) {
          const r = tr.beforeInvoke({ skill: `s${i}`, parentId });
          if (!r.ok) return false;
          parentId = r.invocationId;
        }
        const blocked = tr.beforeInvoke({ skill: `s${n}`, parentId });
        return blocked.ok === false && blocked.code === 'MAX_DEPTH_EXCEEDED';
      }),
      { numRuns: 30 },
    );
  });
});
