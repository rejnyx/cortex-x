'use strict';

// Fixture for cortex-x senior_tester_review eval suite.
// Jest-style fixture (the detector's strongest coverage). Smells:
// assertion_roulette + empty_test + unknown_test + suboptimal_assert
// + magic_number_test + comments_only_test. Expected baseline at
// evals/senior-tester/fixtures/assertion-density/baseline.sarif.json.
//
// We use stub jest-style globals (expect / test / describe) so this
// file is parseable by detectAll without needing jest installed at
// eval time. The detector reads source text only — these globals are
// never invoked.

/* global expect:writable, test:writable, describe:writable */
const expect = (v) => ({
  toBe: (_x) => undefined,
  toEqual: (_x) => undefined,
  toBeTruthy: () => undefined,
  toBeDefined: () => undefined,
  toBeUndefined: () => undefined,
});
const test = (_n, _f) => undefined;
const describe = (_n, _f) => undefined;

function build() {
  return { id: 1, name: 'a', count: 3, tags: ['x', 'y'] };
}

describe('assertion smells', () => {
  // assertion_roulette — 4 unrelated expect() calls, no message arg
  test('assertion roulette example', () => {
    const obj = build();
    expect(obj.id).toBe(1);
    expect(obj.name).toEqual('a');
    expect(obj.count).toBe(3);
    expect(obj.tags).toEqual(['x', 'y']);
  });

  // empty_test — body has no statements
  test('empty body', () => {
  });

  // unknown_test — invokes SUT but never calls expect/assert
  test('no assertion present', () => {
    const obj = build();
    obj.count + 1;
    JSON.stringify(obj);
  });

  // suboptimal_assert — toBeTruthy / toBeDefined etc.
  test('suboptimal toBeTruthy', () => {
    const x = build();
    expect(x).toBeTruthy();
  });

  // magic_number_test — long literal in toBe
  test('magic number assertion', () => {
    const result = 12345678;
    expect(result).toBe(12345678);
  });

  // comments_only_test — comment indicates expected value but no expect runs
  test('expected value in comment only', () => {
    const obj = build();
    // expected: count to be 3
    obj.count;
  });
});
