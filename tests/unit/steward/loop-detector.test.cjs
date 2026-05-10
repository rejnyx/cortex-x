// Sprint 2.12 — intra-run loop detector unit tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const {
  createLoopDetector,
  writeHaltOnLoop,
  hashArgs,
  callKey,
  detectIdentical,
  detectOscillation,
  detectNoOp,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW,
  VALID_PATTERNS,
} = require('../../../bin/steward/_lib/loop-detector.cjs');

describe('Sprint 2.12 — argument hashing', () => {
  test('stable across key order (canonicalization)', () => {
    const a = hashArgs({ x: 1, y: 2 });
    const b = hashArgs({ y: 2, x: 1 });
    assert.equal(a, b);
  });

  test('different values produce different hashes', () => {
    assert.notEqual(hashArgs({ x: 1 }), hashArgs({ x: 2 }));
    assert.notEqual(hashArgs([1, 2, 3]), hashArgs([1, 2]));
  });

  test('handles null / undefined / non-objects', () => {
    assert.match(hashArgs(null), /^[a-f0-9]{16}$/);
    assert.match(hashArgs(undefined), /^[a-f0-9]{16}$/);
    assert.match(hashArgs(42), /^[a-f0-9]{16}$/);
    assert.match(hashArgs('string'), /^[a-f0-9]{16}$/);
  });

  test('handles circular references without throwing', () => {
    const obj = { x: 1 };
    obj.self = obj;
    assert.doesNotThrow(() => hashArgs(obj));
  });

  test('hash is 16-hex prefix of sha256', () => {
    assert.match(hashArgs({ x: 1 }), /^[a-f0-9]{16}$/);
  });

  test('callKey concatenates tool + argsHash', () => {
    const k = callKey('edit', 'abcd1234');
    assert.equal(k, 'edit::abcd1234');
  });
});

describe('Sprint 2.12 — identical-call detection', () => {
  test('3 identical calls trigger detection at 3rd', () => {
    const det = createLoopDetector({ threshold: 3 });
    assert.equal(det.record({ tool: 'a', args: { x: 1 } }).ok, true);
    assert.equal(det.record({ tool: 'a', args: { x: 1 } }).ok, true);
    const r = det.record({ tool: 'a', args: { x: 1 } });
    assert.equal(r.ok, false);
    assert.equal(r.pattern, 'identical');
    assert.equal(r.repetitions, 3);
  });

  test('2 identical calls do NOT trigger', () => {
    const det = createLoopDetector({ threshold: 3 });
    det.record({ tool: 'a', args: { x: 1 } });
    const r = det.record({ tool: 'a', args: { x: 1 } });
    assert.equal(r.ok, true);
  });

  test('mixed tool/args do not trigger', () => {
    const det = createLoopDetector({ threshold: 3 });
    det.record({ tool: 'a', args: { x: 1 } });
    det.record({ tool: 'b', args: { x: 1 } });
    det.record({ tool: 'a', args: { x: 2 } });
    const r = det.record({ tool: 'c', args: { x: 1 } });
    assert.equal(r.ok, true);
  });

  test('threshold respects custom value', () => {
    const det = createLoopDetector({ threshold: 5 });
    for (let i = 0; i < 4; i++) {
      assert.equal(det.record({ tool: 'a' }).ok, true);
    }
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, false);
    assert.equal(r.repetitions, 5);
  });

  test('records past window-size are evicted (stale calls reset count)', () => {
    const det = createLoopDetector({ threshold: 3, window: 4 });
    // 3 of A then 4 of B then 1 A → A count in window is 1, no detection
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' }); // window now [a, a, a, b]
    // Note: 3rd `a` triggered detection; create a fresh detector for the eviction test
    const det2 = createLoopDetector({ threshold: 3, window: 4 });
    det2.record({ tool: 'a' });
    det2.record({ tool: 'a' });
    det2.record({ tool: 'b' });
    det2.record({ tool: 'b' });
    // window now [a, a, b, b]; total a count = 2 — below threshold
    const r = det2.record({ tool: 'b' });
    // window now [a, b, b, b]; b count = 3 — triggers
    assert.equal(r.ok, false);
    assert.equal(r.pattern, 'identical');
  });
});

describe('Sprint 2.12 — A-B-A oscillation detection', () => {
  test('A-B-A-B-A triggers at threshold 3', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['oscillation'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, false);
    assert.equal(r.pattern, 'oscillation');
    assert.equal(r.repetitions, 3);
  });

  test('A-B-A-B (one short) does not trigger at threshold 3', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['oscillation'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' });
    det.record({ tool: 'a' });
    const r = det.record({ tool: 'b' });
    assert.equal(r.ok, true);
  });

  test('A-A-A is not oscillation (identical only)', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['oscillation'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, true);
  });

  test('A-B-C-B-A is not oscillation (interrupted)', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['oscillation'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' });
    det.record({ tool: 'c' });
    det.record({ tool: 'b' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.12 — no-op detection (state hash)', () => {
  test('3 consecutive no-ops trigger', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['no_op'] });
    const r1 = det.record({ tool: 'edit', args: { x: 1 }, stateBefore: 'abc', stateAfter: 'abc' });
    assert.equal(r1.ok, true);
    const r2 = det.record({ tool: 'edit', args: { x: 2 }, stateBefore: 'abc', stateAfter: 'abc' });
    assert.equal(r2.ok, true);
    const r3 = det.record({ tool: 'edit', args: { x: 3 }, stateBefore: 'abc', stateAfter: 'abc' });
    assert.equal(r3.ok, false);
    assert.equal(r3.pattern, 'no_op');
  });

  test('state-changing call resets no-op streak', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['no_op'] });
    det.record({ tool: 'e', stateBefore: 'a', stateAfter: 'a' });
    det.record({ tool: 'e', stateBefore: 'a', stateAfter: 'a' });
    det.record({ tool: 'e', stateBefore: 'a', stateAfter: 'b' }); // state changed
    const r = det.record({ tool: 'e', stateBefore: 'b', stateAfter: 'b' });
    assert.equal(r.ok, true);
  });

  test('records without stateBefore/stateAfter are NEVER no-op', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['no_op'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, true, 'no state hash supplied → not no-op');
  });
});

describe('Sprint 2.12 — pattern enabling', () => {
  test('only enabled patterns fire', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['oscillation'] });
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, true, 'identical pattern disabled — no detection');
  });

  test('invalid pattern names filtered (no throw)', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['identical', 'made_up_pattern'] });
    assert.equal(typeof det.record, 'function');
    // The valid pattern still works
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, false);
  });

  test('all-invalid patterns array throws', () => {
    assert.throws(
      () => createLoopDetector({ patterns: ['nope', 'also_nope'] }),
      /at least one valid pattern/,
    );
  });

  test('VALID_PATTERNS is the canonical set', () => {
    assert.deepEqual([...VALID_PATTERNS].sort(), ['identical', 'no_op', 'oscillation']);
  });
});

describe('Sprint 2.12 — snapshot + reset', () => {
  test('snapshot reflects buffer state', () => {
    const det = createLoopDetector({ threshold: 3, window: 5 });
    det.record({ tool: 'a' });
    det.record({ tool: 'b' });
    const snap = det.snapshot();
    assert.equal(snap.bufferSize, 2);
    assert.equal(snap.totalRecords, 2);
    assert.equal(snap.threshold, 3);
    assert.equal(snap.window, 5);
    assert.match(snap.lastKey, /^b::/);
  });

  test('reset clears buffer + counter', () => {
    const det = createLoopDetector({ threshold: 3 });
    det.record({ tool: 'a' });
    det.record({ tool: 'a' });
    det.reset();
    const snap = det.snapshot();
    assert.equal(snap.bufferSize, 0);
    assert.equal(snap.totalRecords, 0);
    assert.equal(snap.lastKey, null);
    // After reset, the next record can't trigger (count starts fresh)
    const r = det.record({ tool: 'a' });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.12 R2 — stableStringify discrimination (HIGH fix)', () => {
  const { stableStringify } = require('../../../bin/steward/_lib/loop-detector.cjs');

  test('Map vs Set vs plain object produce different hashes', () => {
    const m = new Map([['a', 1]]);
    const s = new Set(['a']);
    const o = { a: 1 };
    assert.notEqual(hashArgs(m), hashArgs(s));
    assert.notEqual(hashArgs(m), hashArgs(o));
    assert.notEqual(hashArgs(s), hashArgs(o));
  });

  test('NaN vs Infinity vs -Infinity produce different hashes', () => {
    assert.notEqual(hashArgs(NaN), hashArgs(Infinity));
    assert.notEqual(hashArgs(NaN), hashArgs(-Infinity));
    assert.notEqual(hashArgs(Infinity), hashArgs(-Infinity));
  });

  test('BigInt with different values produce different hashes', () => {
    assert.notEqual(hashArgs(BigInt(1)), hashArgs(BigInt(2)));
    assert.notEqual(hashArgs(BigInt(1)), hashArgs(1));
  });

  test('Symbol values are not silently dropped (false-collide regression)', () => {
    // Two args differing only by symbol value should produce different hashes.
    const a = { x: Symbol('a') };
    const b = { x: Symbol('b') };
    assert.notEqual(hashArgs(a), hashArgs(b));
  });

  test('function values are discriminated by name', () => {
    const a = function namedA() {};
    const b = function namedB() {};
    assert.notEqual(hashArgs(a), hashArgs(b));
  });

  test('Map content order does not matter (canonicalized)', () => {
    const m1 = new Map([['a', 1], ['b', 2]]);
    const m2 = new Map([['b', 2], ['a', 1]]);
    assert.equal(hashArgs(m1), hashArgs(m2));
  });

  test('Date objects are time-stamped, not collapsed to {}', () => {
    const d1 = new Date(1000);
    const d2 = new Date(2000);
    assert.notEqual(hashArgs(d1), hashArgs(d2));
  });

  test('RegExp objects are pattern-stamped, not collapsed to {}', () => {
    assert.notEqual(hashArgs(/foo/), hashArgs(/bar/));
  });

  test('Map/Set in args do not trigger false identical-detection', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['identical'] });
    const r1 = det.record({ tool: 'edit', args: { ref: new Map([['a', 1]]) } });
    const r2 = det.record({ tool: 'edit', args: { ref: new Set(['a']) } });
    const r3 = det.record({ tool: 'edit', args: { ref: { a: 1 } } });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r3.ok, true, 'three different container types must not be flagged identical');
  });

  test('stableStringify export usable directly', () => {
    assert.equal(typeof stableStringify, 'function');
    assert.match(stableStringify({ a: 1 }), /"a":1/);
  });
});

describe('Sprint 2.12 R2 — window upper bound (MEDIUM fix)', () => {
  const { MAX_WINDOW } = require('../../../bin/steward/_lib/loop-detector.cjs');

  test('threshold above MAX_WINDOW clamps window to MAX_WINDOW', () => {
    const det = createLoopDetector({ threshold: 99_999 });
    assert.equal(det.snapshot().window, MAX_WINDOW);
  });

  test('explicit window above MAX_WINDOW clamps to MAX_WINDOW', () => {
    const det = createLoopDetector({ threshold: 3, window: 1_000_000 });
    assert.equal(det.snapshot().window, MAX_WINDOW);
  });

  test('MAX_WINDOW exposed as 10000', () => {
    assert.equal(MAX_WINDOW, 10_000);
  });
});

describe('Sprint 2.12 R2 — patterns dedupe (LOW fix)', () => {
  test('duplicate patterns deduplicated', () => {
    const det = createLoopDetector({ threshold: 3, patterns: ['identical', 'identical', 'oscillation'] });
    assert.deepEqual(det.snapshot().patterns.sort(), ['identical', 'oscillation']);
  });
});

describe('Sprint 2.12 R2 — writeHaltOnLoop error codes (MEDIUM fix)', () => {
  test('successful write returns code HALT_WRITTEN', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halt-codes-'));
    try {
      const r = writeHaltOnLoop(
        { ok: false, pattern: 'identical', repetitions: 5, threshold: 3 },
        { repoRoot: dir },
      );
      assert.equal(r.written, true);
      assert.equal(r.code, 'HALT_WRITTEN');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('NOT_A_LOOP code when detection.ok is true', () => {
    const r = writeHaltOnLoop({ ok: true });
    assert.equal(r.code, 'NOT_A_LOOP');
  });

  test('HALT_DIR_UNAVAILABLE when .cortex path is occupied by a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halt-blocked-'));
    try {
      // Pre-create a regular FILE at .cortex so mkdirSync errors
      fs.writeFileSync(path.join(dir, '.cortex'), 'block');
      const r = writeHaltOnLoop(
        { ok: false, pattern: 'identical', repetitions: 5, threshold: 3 },
        { repoRoot: dir },
      );
      assert.equal(r.written, false);
      assert.equal(r.code, 'HALT_DIR_UNAVAILABLE');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('newline-bearing pattern is sanitized in halt content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halt-sanitize-'));
    try {
      const r = writeHaltOnLoop(
        { ok: false, pattern: 'identical\nrm -rf /', repetitions: 5, threshold: 3 },
        { repoRoot: dir },
      );
      assert.equal(r.written, true);
      const content = fs.readFileSync(path.join(dir, '.cortex', 'STEWARD_HALT'), 'utf8');
      assert.equal(content.includes('\nrm -rf'), false, 'newline injection must be sanitized');
      assert.match(content, /identical_rm/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.12 — defaults + invariants', () => {
  test('default threshold is 3', () => {
    assert.equal(DEFAULT_THRESHOLD, 3);
  });

  test('default window is 10', () => {
    assert.equal(DEFAULT_WINDOW, 10);
  });

  test('window auto-expands when threshold > default window', () => {
    const det = createLoopDetector({ threshold: 15 });
    assert.equal(det.snapshot().window, 15);
  });

  test('threshold below 2 falls back to default', () => {
    const det = createLoopDetector({ threshold: 1 });
    assert.equal(det.snapshot().threshold, DEFAULT_THRESHOLD);
  });
});

describe('Sprint 2.12 — writeHaltOnLoop integration', () => {
  test('writes halt file when detection failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-halt-'));
    try {
      const r = writeHaltOnLoop(
        { ok: false, pattern: 'identical', repetitions: 5, threshold: 3 },
        { repoRoot: dir },
      );
      assert.equal(r.written, true);
      assert.ok(fs.existsSync(path.join(dir, '.cortex', 'STEWARD_HALT')));
      const content = fs.readFileSync(path.join(dir, '.cortex', 'STEWARD_HALT'), 'utf8');
      assert.match(content, /INTRA_RUN_LOOP:identical/);
      assert.match(content, /repetitions=5/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does NOT write halt when detection succeeded', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-no-halt-'));
    try {
      const r = writeHaltOnLoop({ ok: true }, { repoRoot: dir });
      assert.equal(r.written, false);
      assert.equal(fs.existsSync(path.join(dir, '.cortex', 'STEWARD_HALT')), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('null/undefined detection is no-op', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-null-'));
    try {
      assert.equal(writeHaltOnLoop(null, { repoRoot: dir }).written, false);
      assert.equal(writeHaltOnLoop(undefined, { repoRoot: dir }).written, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Sprint 2.12 — property tests (fast-check)', () => {
  test('random non-repeating tool names below threshold never trigger', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 9 }),
        (toolNames) => {
          // Make every name distinct by prefixing with index — guarantees no
          // identical/oscillation/no-op pattern even adversarially.
          const det = createLoopDetector({ threshold: 3, window: 10 });
          let allOk = true;
          for (let i = 0; i < toolNames.length; i++) {
            const r = det.record({ tool: `${i}-${toolNames[i]}` });
            if (!r.ok) allOk = false;
          }
          return allOk;
        },
      ),
      { numRuns: 100 },
    );
  });

  test('record() never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (tool, args) => {
        const det = createLoopDetector({ threshold: 3 });
        const r = det.record({ tool, args });
        return typeof r === 'object' && r !== null && typeof r.ok === 'boolean';
      }),
      { numRuns: 100 },
    );
  });

  test('true-positive: N >= threshold identical calls always trigger (R2 correctness MEDIUM)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (n, tool) => {
          const det = createLoopDetector({ threshold: 3, window: Math.max(10, n) });
          let last = null;
          for (let i = 0; i < n; i++) last = det.record({ tool });
          return last && last.ok === false && last.pattern === 'identical';
        },
      ),
      { numRuns: 50 },
    );
  });

  test('always at least 3 distinct calls below threshold-3 detection (sanity)', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.string({ minLength: 1 })),
        ([a, b, c]) => {
          // Three distinct tool names — no pattern can fire.
          fc.pre(a !== b && b !== c && a !== c);
          const det = createLoopDetector({ threshold: 3 });
          return det.record({ tool: a }).ok
            && det.record({ tool: b }).ok
            && det.record({ tool: c }).ok;
        },
      ),
      { numRuns: 50 },
    );
  });
});
