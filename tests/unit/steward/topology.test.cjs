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
