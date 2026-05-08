// helpers-property.test.cjs — Sprint 1.6.21 (T2) property tests.
//
// Hand-rolled property testing (cortex-x is zero-deps; no fast-check). Pattern:
//   1. Define an invariant that should hold for ALL valid inputs
//   2. Generate N random inputs from a constrained domain
//   3. Assert the invariant for each generated input
//
// Coverage targets (per standards/correctness.md § Practice 2):
//   - stripJsonFences: roundtrip, idempotency, no-fence pass-through
//   - addCostFields: input mutation safety, conditional add, null handling
//   - extractUsage: shape tolerance, number coercion, NaN/negative rejection
//   - coerceNonNegFiniteNumber: monotonicity on number input, parse-failure
//     symmetric for invalid strings

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const actionEngine = require('../../../bin/steward/_lib/action-engine.cjs');
const execute = require('../../../bin/steward/execute.cjs');

// --- generators ------------------------------------------------------------

function randInt(lo, hi) { return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
function randString(len) {
  let s = '';
  // ASCII printable except backtick to avoid creating accidental fences
  for (let i = 0; i < len; i++) {
    const c = randInt(32, 125);
    s += String.fromCharCode(c === 96 ? 32 : c); // skip backtick
  }
  return s;
}
function randJsonObject() {
  // Generate a simple {edits: [{path, content}]} JSON
  const n = randInt(0, 3);
  const edits = [];
  for (let i = 0; i < n; i++) {
    edits.push({
      path: `file-${randInt(1, 99)}.txt`,
      content: randString(randInt(0, 50)),
    });
  }
  return JSON.stringify({ edits });
}
function randPositiveNumber() {
  // Mix of integer + fractional
  return Math.random() < 0.5 ? randInt(0, 100000) : Math.random() * 100;
}

// --- stripJsonFences -------------------------------------------------------

describe('property: stripJsonFences', () => {
  test('roundtrip: ```json\\n<json>\\n``` → trim(<json>)', () => {
    for (let i = 0; i < 50; i++) {
      const inner = randJsonObject();
      const fenced = '```json\n' + inner + '\n```';
      const result = actionEngine.stripJsonFences(fenced);
      assert.equal(result, inner, `roundtrip failed for inner=${inner.slice(0, 40)}`);
    }
  });

  test('roundtrip: ```\\n<json>\\n``` → trim(<json>) (no language tag)', () => {
    for (let i = 0; i < 50; i++) {
      const inner = randJsonObject();
      const fenced = '```\n' + inner + '\n```';
      const result = actionEngine.stripJsonFences(fenced);
      assert.equal(result, inner);
    }
  });

  test('no-fence pass-through: bare JSON → trim(input)', () => {
    for (let i = 0; i < 50; i++) {
      const inner = randJsonObject();
      const padded = '   ' + inner + '   ';
      const result = actionEngine.stripJsonFences(padded);
      assert.equal(result, inner.trim());
    }
  });

  test('idempotent: stripJsonFences(stripJsonFences(s)) === stripJsonFences(s)', () => {
    for (let i = 0; i < 50; i++) {
      const inner = randJsonObject();
      const fenced = Math.random() < 0.5 ? '```json\n' + inner + '\n```' : inner;
      const once = actionEngine.stripJsonFences(fenced);
      const twice = actionEngine.stripJsonFences(once);
      assert.equal(once, twice);
    }
  });

  test('null/undefined/non-string passthrough: never throws', () => {
    for (const v of [null, undefined, 42, [], {}, true, false]) {
      assert.doesNotThrow(() => actionEngine.stripJsonFences(v));
      // For non-strings: returns the value unchanged
      const result = actionEngine.stripJsonFences(v);
      assert.equal(result, v, `non-string ${typeof v} should pass through unchanged`);
    }
  });

  test('empty string: returns empty string', () => {
    assert.equal(actionEngine.stripJsonFences(''), '');
    assert.equal(actionEngine.stripJsonFences('   '), '');
  });
});

// --- extractUsage ----------------------------------------------------------

describe('property: extractUsage', () => {
  test('null/undefined/missing usage → empty object', () => {
    for (const data of [null, undefined, {}, { usage: null }, { usage: undefined }]) {
      const out = actionEngine.extractUsage(data);
      assert.deepEqual(out, {});
    }
  });

  test('numeric cost → cost_usd field present', () => {
    for (let i = 0; i < 30; i++) {
      const cost = randPositiveNumber();
      const out = actionEngine.extractUsage({ usage: { cost } });
      assert.equal(out.cost_usd, cost);
    }
  });

  test('string-numeric cost → coerced to number', () => {
    for (let i = 0; i < 30; i++) {
      const cost = randPositiveNumber();
      const out = actionEngine.extractUsage({ usage: { cost: String(cost) } });
      assert.equal(out.cost_usd, cost, `string "${String(cost)}" should coerce to ${cost}`);
    }
  });

  test('NaN/Infinity/-N/non-numeric strings → field omitted', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, -0.001, 'abc', '', null, undefined, {}, []]) {
      const out = actionEngine.extractUsage({ usage: { cost: bad } });
      assert.equal(out.cost_usd, undefined, `bad value ${JSON.stringify(bad)} should be omitted`);
    }
  });

  test('tokens are integer-truncated even for fractional inputs', () => {
    for (let i = 0; i < 30; i++) {
      const t = Math.random() * 10000; // fractional
      const out = actionEngine.extractUsage({ usage: { prompt_tokens: t } });
      assert.equal(out.tokens_in, Math.trunc(t));
      assert.ok(Number.isInteger(out.tokens_in));
    }
  });

  test('output never contains keys with undefined value', () => {
    for (let i = 0; i < 30; i++) {
      // Mix valid + invalid
      const usage = {
        cost: Math.random() < 0.5 ? randPositiveNumber() : NaN,
        prompt_tokens: Math.random() < 0.5 ? randInt(0, 1000) : 'bad',
        completion_tokens: Math.random() < 0.5 ? randInt(0, 1000) : null,
      };
      const out = actionEngine.extractUsage({ usage });
      for (const k of Object.keys(out)) {
        assert.notEqual(out[k], undefined, `key ${k} has undefined value`);
      }
    }
  });
});

// --- addCostFields ---------------------------------------------------------

describe('property: addCostFields', () => {
  test('null/undefined applyResult → entry returned unchanged', () => {
    for (let i = 0; i < 20; i++) {
      const entry = { ts: 'x', event: 'e', cost_usd_pre_existing: 'unchanged' };
      const before = JSON.stringify(entry);
      execute.addCostFields(entry, null);
      assert.equal(JSON.stringify(entry), before);
      execute.addCostFields(entry, undefined);
      assert.equal(JSON.stringify(entry), before);
    }
  });

  test('only number-valued cost_usd/tokens_in/tokens_out get added', () => {
    for (let i = 0; i < 30; i++) {
      const entry = { ts: 'x' };
      const apply = {
        cost_usd: Math.random() < 0.5 ? randPositiveNumber() : 'bad',
        tokens_in: Math.random() < 0.5 ? randInt(0, 1000) : null,
        tokens_out: Math.random() < 0.5 ? randInt(0, 1000) : NaN,
      };
      execute.addCostFields(entry, apply);
      // For each field, it's present iff value was a number
      assert.equal(
        'cost_usd' in entry,
        typeof apply.cost_usd === 'number',
        `cost_usd presence should match type (was ${typeof apply.cost_usd})`,
      );
      assert.equal(
        'tokens_in' in entry,
        typeof apply.tokens_in === 'number',
      );
      assert.equal(
        'tokens_out' in entry,
        typeof apply.tokens_out === 'number',
      );
    }
  });

  test('other entry fields untouched (no key drift)', () => {
    for (let i = 0; i < 20; i++) {
      const entry = {
        ts: 'x',
        trigger: 'manual',
        tier: 'T0',
        event: 'foo',
        outcome: 'success',
        actor: 'steward',
        custom_field: 'should not be removed',
      };
      const before = Object.keys(entry).sort();
      execute.addCostFields(entry, { cost_usd: 0.01 });
      const after = Object.keys(entry).sort().filter((k) => k !== 'cost_usd');
      assert.deepEqual(after, before);
    }
  });

  test('mutates input entry (intentional — return value === input)', () => {
    const entry = { ts: 'x' };
    const result = execute.addCostFields(entry, { cost_usd: 0.42 });
    assert.equal(result, entry, 'returned entry must be the same object reference');
    assert.equal(entry.cost_usd, 0.42);
  });
});
