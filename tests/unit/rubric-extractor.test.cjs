// rubric-extractor.test.cjs — Sprint 3.0 v2

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const rubric = require('../../bin/steward/_lib/rubric-extractor.cjs');

const SAMPLE_BODY = `# Eval 005 — Code review pipeline catches planted SSOT violation

## Input

Some setup blah blah.

## Expected properties

### Must have

- [ ] property A is satisfied
- [ ] property B fires

### Must NOT have

- [ ] no auto-fix
- [ ] no silent pass

### Should have

- [ ] cross-validation
- [ ] structured output

## Scoring rubric

Some scoring text.
`;

describe('Sprint 3.0 v2 — extractRubric', () => {
  test('parses must_have / must_not_have / should_have arrays with stable ids', () => {
    const r = rubric.extractRubric(SAMPLE_BODY);
    assert.equal(r.must_have.length, 2);
    assert.equal(r.must_have[0].id, 'must-have-1');
    assert.equal(r.must_have[0].text, 'property A is satisfied');
    assert.equal(r.must_not_have.length, 2);
    assert.equal(r.must_not_have[0].id, 'must-not-have-1');
    assert.equal(r.should_have.length, 2);
    assert.equal(r.should_have[1].text, 'structured output');
  });

  test('stops at next top-level ## section', () => {
    const r = rubric.extractRubric(SAMPLE_BODY);
    // Should not include anything from "## Scoring rubric"
    for (const it of [...r.must_have, ...r.should_have, ...r.must_not_have]) {
      assert.equal(it.text.includes('Scoring'), false);
    }
  });

  test('handles empty body', () => {
    const r = rubric.extractRubric('');
    assert.equal(r.must_have.length, 0);
    assert.equal(r.must_not_have.length, 0);
    assert.equal(r.should_have.length, 0);
  });

  test('skips bullet lines outside Expected properties section', () => {
    const body = `# Title

## Other section

- [ ] this should not be parsed

## Expected properties

### Must have

- [ ] real item
`;
    const r = rubric.extractRubric(body);
    assert.equal(r.must_have.length, 1);
    assert.equal(r.must_have[0].text, 'real item');
  });

  test('handles checked boxes [x] same as unchecked [ ]', () => {
    const body = `## Expected properties

### Must have

- [x] checked item
- [ ] unchecked item
`;
    const r = rubric.extractRubric(body);
    assert.equal(r.must_have.length, 2);
  });
});

describe('Sprint 3.0 v2 — scoreFromRubric', () => {
  test('refusal_detected → score 0', () => {
    const r = { must_have: [{ id: 'must-have-1', text: 'x' }], should_have: [], must_not_have: [] };
    const judge = { refusal_detected: true, must_have: [{ id: 'must-have-1', pass: true }] };
    const s = rubric.scoreFromRubric(r, judge);
    assert.equal(s.score, 0);
    assert.equal(s.breakdown.refusal_detected, true);
  });

  test('all-must-pass + all-should-pass + no-violations → score 1.0', () => {
    const r = {
      must_have: [{ id: 'must-have-1', text: 'a' }, { id: 'must-have-2', text: 'b' }],
      should_have: [{ id: 'should-have-1', text: 'c' }],
      must_not_have: [{ id: 'must-not-have-1', text: 'd' }],
    };
    const judge = {
      refusal_detected: false,
      must_have: [{ id: 'must-have-1', pass: true }, { id: 'must-have-2', pass: true }],
      should_have: [{ id: 'should-have-1', pass: true }],
      must_not_have: [{ id: 'must-not-have-1', violated: false }],
    };
    const s = rubric.scoreFromRubric(r, judge);
    assert.equal(s.score, 1);
  });

  test('partial must-pass scales down proportionally', () => {
    const r = {
      must_have: [{ id: 'must-have-1', text: 'a' }, { id: 'must-have-2', text: 'b' }],
      should_have: [],
      must_not_have: [],
    };
    const judge = {
      refusal_detected: false,
      must_have: [{ id: 'must-have-1', pass: true }, { id: 'must-have-2', pass: false }],
      should_have: [],
      must_not_have: [],
    };
    const s = rubric.scoreFromRubric(r, judge);
    // 1 of 2 must-have pass; only must_have weight active → 0.5
    assert.equal(s.score, 0.5);
  });

  test('must_not violation subtracts proportionally', () => {
    const r = {
      must_have: [],
      should_have: [],
      must_not_have: [{ id: 'must-not-have-1', text: 'a' }, { id: 'must-not-have-2', text: 'b' }],
    };
    const judge = {
      refusal_detected: false,
      must_have: [],
      should_have: [],
      must_not_have: [{ id: 'must-not-have-1', violated: true }, { id: 'must-not-have-2', violated: false }],
    };
    const s = rubric.scoreFromRubric(r, judge);
    // 1 of 2 violated → (2-1)/2 = 0.5 → 0.5 * 1.0 weight = 0.5 / 1.0 total = 0.5
    assert.equal(s.score, 0.5);
  });

  test('judge missing item id → treated as fail (defensive)', () => {
    const r = {
      must_have: [{ id: 'must-have-1', text: 'a' }],
      should_have: [],
      must_not_have: [],
    };
    const judge = { refusal_detected: false, must_have: [], should_have: [], must_not_have: [] };
    const s = rubric.scoreFromRubric(r, judge);
    assert.equal(s.score, 0);
  });

  test('empty rubric returns score 0 with reason flag', () => {
    const r = { must_have: [], should_have: [], must_not_have: [] };
    const judge = { refusal_detected: false, must_have: [], should_have: [], must_not_have: [] };
    const s = rubric.scoreFromRubric(r, judge);
    assert.equal(s.score, 0);
    assert.equal(s.breakdown.reason, 'EMPTY_RUBRIC');
  });
});
