// Sprint 2.11.2 Correctness H2 — LLM judge schema validator tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { validateJudge } = require('../../../bin/steward/_lib/llm-judge-schema.cjs');
const registry = require('../../../bin/steward/_lib/test-smell-registry.cjs');

const VALID_SMELL_ID = registry.listSmellIds()[0]; // 'assertion_roulette'

const VALID_ENVELOPE = Object.freeze({
  summary: 'Suite is broadly fine; three structural issues should be addressed before next release.',
  top_3_strategic_gaps: [
    'No coverage for error paths',
    'Mystery-guest pattern in 4 of 12 tests',
    'Layer balance skewed toward e2e',
  ],
  ranked_findings: [
    {
      smell_id: VALID_SMELL_ID,
      file: 'tests/unit/foo.test.cjs',
      line: 42,
      severity: 'high',
      rationale: 'Four assertions without messages — failure root-causing requires bisection.',
      fix_strategy: 'Split into 4 focused tests OR add explanatory message arg.',
    },
  ],
  layer_balance_assessment: 'Pyramid is top-heavy: 60% e2e, 35% integration, 5% unit. Consider rebalancing.',
  estimated_effort_hours: 6,
});

describe('Sprint 2.11.2 — validateJudge happy path', () => {
  test('valid envelope passes', () => {
    const r = validateJudge(VALID_ENVELOPE);
    assert.equal(r.ok, true);
  });

  test('estimated_effort_hours optional — passes when absent', () => {
    const { estimated_effort_hours: _, ...rest } = VALID_ENVELOPE;
    assert.equal(validateJudge(rest).ok, true);
  });

  test('empty ranked_findings allowed (judge may decline to rank)', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, ranked_findings: [] });
    assert.equal(r.ok, true);
  });
});

describe('Sprint 2.11.2 — validateJudge type errors', () => {
  test('non-object envelope rejected', () => {
    for (const bad of [null, undefined, 'string', 42, [], true]) {
      const r = validateJudge(bad);
      assert.equal(r.ok, false, `should reject: ${JSON.stringify(bad)}`);
      assert.equal(r.code, 'JUDGE_SHAPE_INVALID');
    }
  });

  test('summary must be non-empty string', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, summary: 42 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'JUDGE_FIELD_INVALID');
    assert.equal(r.path, 'summary');
  });

  test('summary length bound enforced', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, summary: 'x'.repeat(4001) });
    assert.equal(r.ok, false);
    assert.match(r.error, /4000/);
  });

  test('top_3_strategic_gaps must be array', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, top_3_strategic_gaps: 'not an array' });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'top_3_strategic_gaps');
  });

  test('top_3_strategic_gaps cannot be empty', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, top_3_strategic_gaps: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 1/);
  });

  test('top_3_strategic_gaps entry must be string', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, top_3_strategic_gaps: [42] });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'top_3_strategic_gaps[0]');
  });

  test('layer_balance_assessment must be non-empty string', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, layer_balance_assessment: '' });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'layer_balance_assessment');
  });

  test('estimated_effort_hours must be non-negative finite', () => {
    const cases = [-1, NaN, Infinity, 'six'];
    for (const v of cases) {
      const r = validateJudge({ ...VALID_ENVELOPE, estimated_effort_hours: v });
      assert.equal(r.ok, false, `should reject: ${v}`);
      assert.equal(r.path, 'estimated_effort_hours');
    }
  });

  test('estimated_effort_hours rejects implausible value (> 10000)', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, estimated_effort_hours: 99999 });
    assert.equal(r.ok, false);
    assert.match(r.error, /10000/);
  });
});

describe('Sprint 2.11.2 — validateJudge ranked_findings', () => {
  test('finding must be object', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, ranked_findings: ['not-object'] });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0]');
  });

  test('smell_id must be in registry', () => {
    const r = validateJudge({
      ...VALID_ENVELOPE,
      ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], smell_id: 'made_up_smell_xyz' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0].smell_id');
    assert.match(r.error, /unknown smell id/);
  });

  test('severity must be in enum', () => {
    const r = validateJudge({
      ...VALID_ENVELOPE,
      ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], severity: 'critical' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0].severity');
    assert.match(r.error, /high\|medium\|low/);
  });

  test('line must be non-negative integer', () => {
    const cases = [-1, 1.5, '42', null];
    for (const v of cases) {
      const r = validateJudge({
        ...VALID_ENVELOPE,
        ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], line: v }],
      });
      assert.equal(r.ok, false, `should reject: ${v}`);
      assert.equal(r.path, 'ranked_findings[0].line');
    }
  });

  test('rationale length bound enforced', () => {
    const r = validateJudge({
      ...VALID_ENVELOPE,
      ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], rationale: 'x'.repeat(1001) }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0].rationale');
  });

  test('file must be non-empty string', () => {
    const r = validateJudge({
      ...VALID_ENVELOPE,
      ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], file: '' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0].file');
  });

  test('ranked_findings array exceeding 50 entries rejected', () => {
    const long = Array.from({ length: 51 }, () => VALID_ENVELOPE.ranked_findings[0]);
    const r = validateJudge({ ...VALID_ENVELOPE, ranked_findings: long });
    assert.equal(r.ok, false);
    assert.match(r.error, /50/);
  });

  test('whitespace-only summary rejected (R2 edge-hunter MEDIUM)', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, summary: '   \n\t  ' });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'summary');
    assert.match(r.error, /whitespace-only|non-empty/);
  });

  test('whitespace-only top_3_strategic_gaps entry rejected', () => {
    const r = validateJudge({ ...VALID_ENVELOPE, top_3_strategic_gaps: ['  '] });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'top_3_strategic_gaps[0]');
  });

  test('whitespace-only rationale rejected', () => {
    const r = validateJudge({
      ...VALID_ENVELOPE,
      ranked_findings: [{ ...VALID_ENVELOPE.ranked_findings[0], rationale: '  ' }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.path, 'ranked_findings[0].rationale');
  });
});

// Sprint 2.11.2 R2 correctness HIGH: property-based testing fills the
// fuzz-input gap that example tests miss. Three invariants are
// load-bearing for a trust-boundary validator: (1) never throws on any
// input, (2) any non-object envelope is rejected, (3) valid envelope
// remains valid under field-mutation pressure on irrelevant fields.
describe('Sprint 2.11.2 — validateJudge property tests (fast-check)', () => {
  test('never throws on arbitrary JSON-ish input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const r = validateJudge(input);
        // Must always return a result object with `ok` boolean.
        return typeof r === 'object' && r !== null && typeof r.ok === 'boolean';
      }),
      { numRuns: 200 },
    );
  });

  test('non-object input always rejected with JUDGE_SHAPE_INVALID', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.array(fc.anything()),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (nonObject) => {
          const r = validateJudge(nonObject);
          return r.ok === false && r.code === 'JUDGE_SHAPE_INVALID';
        },
      ),
      { numRuns: 100 },
    );
  });

  test('any string field replaced with non-string value → rejected with field path', () => {
    const stringPaths = ['summary', 'layer_balance_assessment'];
    fc.assert(
      fc.property(
        fc.constantFrom(...stringPaths),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string())),
        (path, badValue) => {
          const corrupted = { ...VALID_ENVELOPE, [path]: badValue };
          const r = validateJudge(corrupted);
          return r.ok === false && r.path === path;
        },
      ),
      { numRuns: 50 },
    );
  });
});
