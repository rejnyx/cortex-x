'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_TREE_USD_CAP,
  TREE_USD_CAP_MIN,
  TREE_USD_CAP_MAX,
  VALID_TOPOLOGIES,
  LOOP_DETECTOR_WINDOW_HOURS,
  LOOP_DETECTOR_THRESHOLD,
  parseTreeBudgetCap,
  canonicalizeWorkerInput,
  canonicalize,
  randomizeJudgeOrder,
  validateTopologySafe,
  isFingerprintCacheKeyValid,
} = require('../../../bin/steward/_lib/topology.cjs');

// ── parseTreeBudgetCap ────────────────────────────────────────────────────

test('parseTreeBudgetCap: returns default when env missing', () => {
  assert.equal(parseTreeBudgetCap({}), DEFAULT_TREE_USD_CAP);
  assert.equal(parseTreeBudgetCap(null), DEFAULT_TREE_USD_CAP);
});

test('parseTreeBudgetCap: parses string value', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: '2.5' }), 2.5);
});

test('parseTreeBudgetCap: parses numeric value', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: 0.75 }), 0.75);
});

test('parseTreeBudgetCap: clamps below MIN', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: '0.01' }), TREE_USD_CAP_MIN);
});

test('parseTreeBudgetCap: clamps above MAX', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: '100' }), TREE_USD_CAP_MAX);
});

test('parseTreeBudgetCap: rejects non-numeric, returns default', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: 'abc' }), DEFAULT_TREE_USD_CAP);
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: '' }), DEFAULT_TREE_USD_CAP);
});

test('parseTreeBudgetCap: rejects Infinity / NaN', () => {
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: 'Infinity' }), DEFAULT_TREE_USD_CAP);
  assert.equal(parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: 'NaN' }), DEFAULT_TREE_USD_CAP);
});

// ── canonicalize ──────────────────────────────────────────────────────────

test('canonicalize: object key order ignored', () => {
  const a = canonicalize({ a: 1, b: 2, c: 3 });
  const b = canonicalize({ c: 3, a: 1, b: 2 });
  assert.equal(a, b);
});

test('canonicalize: nested object key order ignored', () => {
  const a = canonicalize({ x: { p: 1, q: 2 }, y: 3 });
  const b = canonicalize({ y: 3, x: { q: 2, p: 1 } });
  assert.equal(a, b);
});

test('canonicalize: array order preserved', () => {
  assert.notEqual(canonicalize([1, 2, 3]), canonicalize([3, 2, 1]));
});

test('canonicalize: NFKC-normalizes strings', () => {
  // Fullwidth A (U+FF21) folds to ASCII A under NFKC.
  const a = canonicalize('Ａ');
  const b = canonicalize('A');
  assert.equal(a, b);
});

test('canonicalize: Infinity and NaN serialize as null (JSON-safe)', () => {
  assert.equal(canonicalize(Infinity), 'null');
  assert.equal(canonicalize(NaN), 'null');
});

// ── canonicalizeWorkerInput ───────────────────────────────────────────────

test('canonicalizeWorkerInput: identical input -> identical fingerprint', () => {
  const plan = { action_kind: 'recommendation_harvest_parallel', read_set: ['a.md', 'b.md'] };
  const f1 = canonicalizeWorkerInput(plan, 'criterion-1');
  const f2 = canonicalizeWorkerInput(plan, 'criterion-1');
  assert.equal(f1, f2);
});

test('canonicalizeWorkerInput: different criterion -> different fingerprint', () => {
  const plan = { action_kind: 'x' };
  const f1 = canonicalizeWorkerInput(plan, 'c1');
  const f2 = canonicalizeWorkerInput(plan, 'c2');
  assert.notEqual(f1, f2);
});

test('canonicalizeWorkerInput: key order in plan does not change fingerprint', () => {
  const planA = { a: 1, b: 2, c: 3 };
  const planB = { c: 3, b: 2, a: 1 };
  assert.equal(canonicalizeWorkerInput(planA, 'c1'), canonicalizeWorkerInput(planB, 'c1'));
});

test('canonicalizeWorkerInput: SHA-256 shape', () => {
  const f = canonicalizeWorkerInput({}, 'criterion-x');
  assert.match(f, /^[0-9a-f]{64}$/);
});

test('canonicalizeWorkerInput: throws on null plan', () => {
  assert.throws(() => canonicalizeWorkerInput(null, 'c1'));
});

test('canonicalizeWorkerInput: throws on empty criterion', () => {
  assert.throws(() => canonicalizeWorkerInput({}, ''));
  assert.throws(() => canonicalizeWorkerInput({}, null));
});

// ── randomizeJudgeOrder ───────────────────────────────────────────────────

test('randomizeJudgeOrder: shuffled length === input length', () => {
  const r = randomizeJudgeOrder(['a', 'b', 'c']);
  assert.equal(r.shuffled.length, 3);
  assert.equal(r.originalIndexAt.length, 3);
});

test('randomizeJudgeOrder: contains every original element', () => {
  const original = ['x', 'y', 'z', 'w'];
  const r = randomizeJudgeOrder(original);
  assert.deepEqual([...r.shuffled].sort(), [...original].sort());
});

test('randomizeJudgeOrder: originalIndexAt maps back correctly', () => {
  const original = ['a', 'b', 'c'];
  const r = randomizeJudgeOrder(original);
  for (let i = 0; i < r.shuffled.length; i += 1) {
    assert.equal(r.shuffled[i], original[r.originalIndexAt[i]]);
  }
});

test('randomizeJudgeOrder: does NOT mutate input', () => {
  const original = ['a', 'b', 'c'];
  const copy = [...original];
  randomizeJudgeOrder(original);
  assert.deepEqual(original, copy);
});

test('randomizeJudgeOrder: deterministic with fixed RNG (max-value -> identity)', () => {
  // RNG returning ~1.0 makes j === i in Fisher-Yates -> no swaps -> identity.
  const rng = () => 0.999999;
  const r = randomizeJudgeOrder(['a', 'b', 'c'], rng);
  assert.deepEqual(r.shuffled, ['a', 'b', 'c']);
  assert.deepEqual(r.originalIndexAt, [0, 1, 2]);
});

test('randomizeJudgeOrder: deterministic with fixed RNG (zero -> known permutation)', () => {
  // RNG returning 0 makes j=0 every iteration: predictable Fisher-Yates output.
  const rng = () => 0;
  const r = randomizeJudgeOrder(['a', 'b', 'c'], rng);
  // i=2,j=0 swaps [0,1,2]->[2,1,0]; i=1,j=0 swaps [2,1,0]->[1,2,0]
  assert.deepEqual(r.originalIndexAt, [1, 2, 0]);
  assert.deepEqual(r.shuffled, ['b', 'c', 'a']);
});

test('randomizeJudgeOrder: throws on non-array', () => {
  assert.throws(() => randomizeJudgeOrder('not array'));
  assert.throws(() => randomizeJudgeOrder(null));
});

test('randomizeJudgeOrder: empty array returns empty', () => {
  const r = randomizeJudgeOrder([]);
  assert.deepEqual(r.shuffled, []);
  assert.deepEqual(r.originalIndexAt, []);
});

// ── validateTopologySafe ──────────────────────────────────────────────────

test('validateTopologySafe: missing field -> default serial', () => {
  const r = validateTopologySafe('foo', {});
  assert.equal(r.ok, true);
  assert.equal(r.topology, 'serial');
});

test('validateTopologySafe: explicit serial accepted', () => {
  const r = validateTopologySafe('foo', { topology_safe: 'serial' });
  assert.equal(r.ok, true);
  assert.equal(r.topology, 'serial');
});

test('validateTopologySafe: explicit parallel accepted', () => {
  const r = validateTopologySafe('foo', { topology_safe: 'parallel' });
  assert.equal(r.ok, true);
  assert.equal(r.topology, 'parallel');
});

test('validateTopologySafe: invalid value rejected', () => {
  const r = validateTopologySafe('foo', { topology_safe: 'distributed' });
  assert.equal(r.ok, false);
  assert.equal(r.topology, 'serial');  // safe fallback
});

test('validateTopologySafe: null kindEntry rejected', () => {
  const r = validateTopologySafe('foo', null);
  assert.equal(r.ok, false);
});

// ── isFingerprintCacheKeyValid ────────────────────────────────────────────

test('isFingerprintCacheKeyValid: well-formed key', () => {
  const sha = 'a'.repeat(64);
  assert.equal(isFingerprintCacheKeyValid(`criterion-1::${sha}`), true);
});

test('isFingerprintCacheKeyValid: missing separator', () => {
  assert.equal(isFingerprintCacheKeyValid('no-separator'), false);
});

test('isFingerprintCacheKeyValid: non-hex sha', () => {
  assert.equal(isFingerprintCacheKeyValid('c::not-a-sha'), false);
});

test('isFingerprintCacheKeyValid: empty criterion', () => {
  const sha = 'b'.repeat(64);
  assert.equal(isFingerprintCacheKeyValid(`::${sha}`), false);
});

// ── Constants spec ────────────────────────────────────────────────────────

test('constants: VALID_TOPOLOGIES is non-empty array', () => {
  assert.ok(Array.isArray(VALID_TOPOLOGIES));
  assert.ok(VALID_TOPOLOGIES.includes('serial'));
  assert.ok(VALID_TOPOLOGIES.includes('parallel'));
});

test('constants: cap range sensible', () => {
  assert.ok(TREE_USD_CAP_MIN > 0);
  assert.ok(TREE_USD_CAP_MIN < DEFAULT_TREE_USD_CAP);
  assert.ok(DEFAULT_TREE_USD_CAP < TREE_USD_CAP_MAX);
});

test('constants: loop detector window + threshold', () => {
  assert.equal(LOOP_DETECTOR_WINDOW_HOURS, 24);
  assert.equal(LOOP_DETECTOR_THRESHOLD, 3);
});

// === R2 2.2.1 HARDENING REGRESSION TESTS ===

const fc = require('fast-check');

test('R2 security HIGH-1: canonicalize rejects non-plain objects', () => {
  class Foo {}
  assert.throws(() => canonicalize(new Foo()), /non-plain object/);
});

test('R2 security HIGH-1: canonicalize tag-encodes Date so they do not collide', () => {
  const a = canonicalize(new Date('2026-05-14T00:00:00Z'));
  const b = canonicalize(new Date('2026-05-15T00:00:00Z'));
  const empty = canonicalize({});
  assert.notEqual(a, b);
  assert.notEqual(a, empty);
});

test('R2 security HIGH-1: canonicalize tag-encodes Buffer', () => {
  const a = canonicalize(Buffer.from('abc'));
  const b = canonicalize(Buffer.from('def'));
  assert.notEqual(a, b);
  assert.match(a, /^B:/);
});

test('R2 security HIGH-1: canonicalize tag-encodes Map + Set + RegExp', () => {
  assert.match(canonicalize(new Map([['k', 'v']])), /^M:/);
  assert.match(canonicalize(new Set([1, 2, 3])), /^S:/);
  assert.match(canonicalize(/abc/i), /^R:/);
});

test('R2 security HIGH-1: canonicalize strips own __proto__/constructor/prototype keys', () => {
  // Own property "__proto__" (via JSON.parse, which doesn't treat the key as
  // [[Prototype]] setter) must be stripped — otherwise an attacker-supplied
  // plan could include phantom keys in the fingerprint.
  const polluted = JSON.parse('{"x": 1, "__proto__": "evil"}');
  const clean = { x: 1 };
  assert.equal(canonicalize(polluted), canonicalize(clean));
});

test('R2 security HIGH-1: canonicalize throws on symbol + function', () => {
  assert.throws(() => canonicalize(Symbol('x')));
  assert.throws(() => canonicalize(() => 1));
});

test('R2 edge-case HIGH-1: canonicalize detects circular references (no stack overflow)', () => {
  const a = {};
  a.self = a;
  assert.throws(() => canonicalize(a), /circular/);
});

test('R2 edge-case HIGH-1: canonicalize detects circular references in arrays', () => {
  const a = [];
  a.push(a);
  assert.throws(() => canonicalize(a), /circular/);
});

test('R2 edge-case HIGH-2: randomizeJudgeOrder handles rng() returning 1.0 (out-of-bounds defense)', () => {
  const rng = () => 1.0;
  const r = randomizeJudgeOrder(['a', 'b', 'c'], rng);
  // No undefined slots; permutation must be a valid permutation
  assert.equal(r.shuffled.length, 3);
  assert.ok(r.shuffled.every((v) => v !== undefined));
  assert.deepEqual([...r.shuffled].sort(), ['a', 'b', 'c']);
});

test('R2 edge-case HIGH-2: randomizeJudgeOrder handles rng() returning NaN (defense)', () => {
  const rng = () => NaN;
  const r = randomizeJudgeOrder(['a', 'b', 'c'], rng);
  assert.equal(r.shuffled.length, 3);
  assert.ok(r.shuffled.every((v) => v !== undefined));
});

test('R2 edge-case HIGH-2: randomizeJudgeOrder handles rng() returning negative (defense)', () => {
  const rng = () => -0.5;
  const r = randomizeJudgeOrder(['a', 'b', 'c'], rng);
  assert.equal(r.shuffled.length, 3);
  assert.ok(r.shuffled.every((v) => v !== undefined));
});

test('R2 edge-case HIGH-3: VALID_TOPOLOGIES is frozen (no runtime mutation)', () => {
  assert.ok(Object.isFrozen(VALID_TOPOLOGIES));
  assert.throws(() => {
    VALID_TOPOLOGIES.push('distributed');
  }, TypeError);
  // Confirm validateTopologySafe still rejects after attempted mutation
  const r = validateTopologySafe('test', { topology_safe: 'distributed' });
  assert.equal(r.ok, false);
});

test('R2 security HIGH-4: validateTopologySafe uses hasOwnProperty (prototype-pollution defense)', () => {
  // Simulate Object.prototype.topology_safe = 'parallel' pollution
  const origDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'topology_safe');
  Object.prototype.topology_safe = 'parallel';  // eslint-disable-line no-extend-native
  try {
    const r = validateTopologySafe('test', {});
    assert.equal(r.ok, true);
    assert.equal(r.topology, 'serial');   // back-compat default, NOT polluted 'parallel'
  } finally {
    if (origDescriptor) Object.defineProperty(Object.prototype, 'topology_safe', origDescriptor);
    else delete Object.prototype.topology_safe;
  }
});

// === Property tests (R2 correctness HIGH + MED) ===

test('property: randomizeJudgeOrder shuffled is a permutation of input (multiset equality)', () => {
  fc.assert(fc.property(
    fc.array(fc.string(), { minLength: 0, maxLength: 10 }),
    (arr) => {
      const r = randomizeJudgeOrder(arr);
      return r.shuffled.length === arr.length &&
        [...r.shuffled].sort().join('|') === [...arr].sort().join('|');
    }
  ), { numRuns: 50 });
});

test('property: randomizeJudgeOrder originalIndexAt maps shuffled back to input', () => {
  fc.assert(fc.property(
    fc.array(fc.string(), { minLength: 1, maxLength: 10 }),
    (arr) => {
      const r = randomizeJudgeOrder(arr);
      for (let i = 0; i < r.shuffled.length; i += 1) {
        if (r.shuffled[i] !== arr[r.originalIndexAt[i]]) return false;
      }
      return true;
    }
  ), { numRuns: 50 });
});

test('property: Fisher-Yates uniformity over n=4 (chi-squared smoke)', () => {
  // 24 permutations of [0,1,2,3]; with 2400 trials, each cell expects 100.
  // Chi-squared on 23 df, p=0.001 critical ≈ 49.7. Generous bound: max < 200.
  const counts = new Map();
  const trials = 2400;
  for (let t = 0; t < trials; t += 1) {
    const r = randomizeJudgeOrder([0, 1, 2, 3]);
    const key = r.shuffled.join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let chi2 = 0;
  const expected = trials / 24;
  for (const [, cnt] of counts) {
    chi2 += ((cnt - expected) ** 2) / expected;
  }
  // Generous bound — uniform RNG should easily clear this; biased shuffles fail badly.
  assert.ok(chi2 < 100, `chi-squared ${chi2.toFixed(2)} too high (suggest non-uniform shuffle)`);
});

test('property: parseTreeBudgetCap always returns value in [MIN, MAX]', () => {
  fc.assert(fc.property(
    fc.oneof(fc.string(), fc.double(), fc.integer(), fc.constant(null), fc.constant(undefined)),
    (v) => {
      const r = parseTreeBudgetCap({ STEWARD_TREE_USD_CAP: v });
      return r >= 0.10 && r <= 10.0 && Number.isFinite(r);
    }
  ), { numRuns: 50 });
});

test('property: canonicalizeWorkerInput key-order invariance', () => {
  fc.assert(fc.property(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
    fc.string({ minLength: 1, maxLength: 30 }),
    (plan, criterionId) => {
      const fp1 = canonicalizeWorkerInput(plan, criterionId);
      // Shuffle keys to a new object
      const keys = Object.keys(plan).sort();
      const shuffled = {};
      for (let i = keys.length - 1; i >= 0; i -= 1) shuffled[keys[i]] = plan[keys[i]];
      const fp2 = canonicalizeWorkerInput(shuffled, criterionId);
      return fp1 === fp2;
    }
  ), { numRuns: 30 });
});
