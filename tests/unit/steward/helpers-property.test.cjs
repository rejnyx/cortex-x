// helpers-property.test.cjs — Sprint 1.6.21 (T2) property tests.
//
// Sprint 2.3a migration: Math.random() loops replaced with fast-check
// (`fc.assert(fc.property(...))`) so failures shrink to a minimal counterexample
// and seeds replay deterministically. Hand-picked edge-case tables stay
// (NaN, Infinity, -Infinity, null, undefined) — those are intentional regressions
// against specific incident classes, not random-generated.
//
// Coverage targets (per standards/correctness.md § Practice 2):
//   - stripJsonFences: roundtrip, idempotency, no-fence pass-through, totality
//   - extractUsage: shape tolerance, number coercion, NaN/negative rejection
//   - addCostFields: input mutation safety, conditional add, null handling

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const actionEngine = require('../../../bin/steward/_lib/action-engine.cjs');
const execute = require('../../../bin/steward/execute.cjs');

// --- generators ------------------------------------------------------------

// JSON object resembling the engine's editPlan shape — used to drive
// stripJsonFences round-trip tests with realistic payloads.
const editPlanGen = fc.record({
  edits: fc.array(
    fc.record({
      path: fc.string({ minLength: 1, maxLength: 24 }).filter((s) => /^[a-zA-Z0-9./_-]+$/.test(s)),
      content: fc.string({ maxLength: 80 }),
    }),
    { maxLength: 3 },
  ),
}).map((obj) => JSON.stringify(obj));

// Non-negative finite number generator — covers integer + fractional + zero.
const positiveNumber = fc.oneof(
  fc.nat({ max: 100_000 }),
  fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
);

// --- stripJsonFences -------------------------------------------------------

describe('property: stripJsonFences', () => {
  test('roundtrip: ```json\\n<json>\\n``` → trim(<json>)', () => {
    fc.assert(
      fc.property(editPlanGen, (inner) => {
        const fenced = '```json\n' + inner + '\n```';
        return actionEngine.stripJsonFences(fenced) === inner;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('roundtrip: ```\\n<json>\\n``` → trim(<json>) (no language tag)', () => {
    fc.assert(
      fc.property(editPlanGen, (inner) => {
        const fenced = '```\n' + inner + '\n```';
        return actionEngine.stripJsonFences(fenced) === inner;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('no-fence pass-through: bare JSON with whitespace → trim(input)', () => {
    fc.assert(
      fc.property(editPlanGen, (inner) => {
        const padded = '   ' + inner + '   ';
        return actionEngine.stripJsonFences(padded) === inner.trim();
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('idempotent: stripJsonFences(stripJsonFences(s)) === stripJsonFences(s)', () => {
    fc.assert(
      fc.property(editPlanGen, fc.boolean(), (inner, fenced) => {
        const input = fenced ? '```json\n' + inner + '\n```' : inner;
        const once = actionEngine.stripJsonFences(input);
        const twice = actionEngine.stripJsonFences(once);
        return once === twice;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('null/undefined/non-string passthrough: never throws (totality)', () => {
    // Hand-picked table — these are the intentional regressions against
    // specific OPENROUTER_NO_DATA / OPENROUTER_PLAN_SHAPE_INVALID failure modes.
    for (const v of [null, undefined, 42, [], {}, true, false]) {
      assert.doesNotThrow(() => actionEngine.stripJsonFences(v));
      const result = actionEngine.stripJsonFences(v);
      assert.equal(result, v, `non-string ${typeof v} should pass through unchanged`);
    }
  });

  test('empty string: returns empty string', () => {
    assert.equal(actionEngine.stripJsonFences(''), '');
    assert.equal(actionEngine.stripJsonFences('   '), '');
  });

  test('totality across arbitrary string input — never throws', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        let r;
        try {
          r = actionEngine.stripJsonFences(s);
        } catch (err) {
          return false;
        }
        return typeof r === 'string';
      }),
      { numRuns: 200, seed: 0xc01a },
    );
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
    fc.assert(
      fc.property(positiveNumber, (cost) => {
        const out = actionEngine.extractUsage({ usage: { cost } });
        return out.cost_usd === cost;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('string-numeric cost → coerced to number', () => {
    fc.assert(
      fc.property(positiveNumber, (cost) => {
        const out = actionEngine.extractUsage({ usage: { cost: String(cost) } });
        return out.cost_usd === cost;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('NaN/Infinity/-N/non-numeric strings → field omitted', () => {
    // Hand-picked — these are the intentional regressions against the
    // Sprint 1.6.16 negative-cost / NaN-cost incident class.
    for (const bad of [NaN, Infinity, -Infinity, -1, -0.001, 'abc', '', null, undefined, {}, []]) {
      const out = actionEngine.extractUsage({ usage: { cost: bad } });
      assert.equal(out.cost_usd, undefined, `bad value ${JSON.stringify(bad)} should be omitted`);
    }
  });

  test('tokens are integer-truncated even for fractional inputs', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10_000, noNaN: true, noDefaultInfinity: true }), (t) => {
        const out = actionEngine.extractUsage({ usage: { prompt_tokens: t } });
        return out.tokens_in === Math.trunc(t) && Number.isInteger(out.tokens_in);
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('output never contains keys with undefined value', () => {
    const usageGen = fc.record({
      cost: fc.option(fc.oneof(positiveNumber, fc.constant(NaN)), { nil: undefined }),
      prompt_tokens: fc.option(fc.oneof(fc.nat({ max: 1000 }), fc.constant('bad')), { nil: undefined }),
      completion_tokens: fc.option(fc.oneof(fc.nat({ max: 1000 }), fc.constant(null)), { nil: undefined }),
    });
    fc.assert(
      fc.property(usageGen, (usage) => {
        const out = actionEngine.extractUsage({ usage });
        for (const k of Object.keys(out)) {
          if (out[k] === undefined) return false;
        }
        return true;
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });
});

// --- addCostFields ---------------------------------------------------------

describe('property: addCostFields', () => {
  test('null/undefined applyResult → entry returned unchanged', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (apply) => {
        const entry = { ts: 'x', event: 'e', cost_usd_pre_existing: 'unchanged' };
        const before = JSON.stringify(entry);
        execute.addCostFields(entry, apply);
        return JSON.stringify(entry) === before;
      }),
      { numRuns: 20, seed: 0xc01a },
    );
  });

  test('only number-valued cost_usd/tokens_in/tokens_out get added', () => {
    const applyGen = fc.record({
      cost_usd: fc.oneof(positiveNumber, fc.constant('bad')),
      tokens_in: fc.oneof(fc.nat({ max: 1000 }), fc.constant(null)),
      tokens_out: fc.oneof(fc.nat({ max: 1000 }), fc.constant(NaN)),
    });
    fc.assert(
      fc.property(applyGen, (apply) => {
        const entry = { ts: 'x' };
        execute.addCostFields(entry, apply);
        return (
          ('cost_usd' in entry) === (typeof apply.cost_usd === 'number')
          && ('tokens_in' in entry) === (typeof apply.tokens_in === 'number')
          && ('tokens_out' in entry) === (typeof apply.tokens_out === 'number')
        );
      }),
      { numRuns: 100, seed: 0xc01a },
    );
  });

  test('other entry fields untouched (no key drift)', () => {
    fc.assert(
      fc.property(positiveNumber, (cost) => {
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
        execute.addCostFields(entry, { cost_usd: cost });
        const after = Object.keys(entry).sort().filter((k) => k !== 'cost_usd');
        return JSON.stringify(after) === JSON.stringify(before);
      }),
      { numRuns: 50, seed: 0xc01a },
    );
  });

  test('mutates input entry (intentional — return value === input)', () => {
    fc.assert(
      fc.property(positiveNumber, (cost) => {
        const entry = { ts: 'x' };
        const result = execute.addCostFields(entry, { cost_usd: cost });
        return result === entry && entry.cost_usd === cost;
      }),
      { numRuns: 30, seed: 0xc01a },
    );
  });
});
