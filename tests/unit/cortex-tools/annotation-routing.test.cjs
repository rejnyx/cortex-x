'use strict';

// Sprint 2.9 — annotation routing tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  requiredGates,
  requiresSpecVerifier,
  requiresHaltCheck,
  requiresCostWindows,
  isSafeToRetry,
  explainRouting,
} = require('../../../bin/cortex/tools/_lib/annotation-routing.cjs');

const palette = require('../../../bin/cortex/tools/index.cjs');

function descriptor(annotations) {
  return {
    name: 'mock',
    description: 'mock for routing test',
    annotations,
  };
}

describe('requiredGates — readOnlyHint=true', () => {
  test('skips halt check + journal trailer', () => {
    const gates = requiredGates(descriptor({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    }));
    assert.equal(gates.has('halt_check_required'), false);
    assert.equal(gates.has('journal_write_trailer_required'), false);
    assert.equal(gates.has('no_halt_check_required'), true);
  });
});

describe('requiredGates — destructiveHint=true', () => {
  test('mandates spec-verifier + acceptance criteria + policy check', () => {
    const gates = requiredGates(descriptor({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
    }));
    assert.equal(gates.has('spec_verifier_required'), true);
    assert.equal(gates.has('acceptance_criteria_mandatory'), true);
    assert.equal(gates.has('policy_check_required'), true);
  });
});

describe('requiredGates — openWorldHint=true', () => {
  test('mandates all 3 cost windows + token velocity cap', () => {
    const gates = requiredGates(descriptor({
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
    }));
    assert.equal(gates.has('cost_window_daily_required'), true);
    assert.equal(gates.has('cost_window_weekly_required'), true);
    assert.equal(gates.has('cost_window_monthly_required'), true);
    assert.equal(gates.has('token_velocity_cap_required'), true);
  });
});

describe('requiredGates — fail-closed default', () => {
  test('descriptor without annotations gets full gate set', () => {
    const gates = requiredGates({ name: 'noisy' });
    assert.equal(gates.has('spec_verifier_required'), true);
    assert.equal(gates.has('halt_check_required'), true);
    assert.equal(gates.has('cost_window_daily_required'), true);
  });

  test('null descriptor handled', () => {
    const gates = requiredGates(null);
    assert.ok(gates.size > 0);
  });
});

describe('Convenience predicates', () => {
  test('requiresSpecVerifier matches descriptor.destructiveHint', () => {
    assert.equal(requiresSpecVerifier(palette.TOOL_BY_NAME.read), false);
    assert.equal(requiresSpecVerifier(palette.TOOL_BY_NAME.write), true);
    assert.equal(requiresSpecVerifier(palette.TOOL_BY_NAME.bash), true);
  });

  test('requiresHaltCheck false for read-only tools', () => {
    assert.equal(requiresHaltCheck(palette.TOOL_BY_NAME.read), false);
    assert.equal(requiresHaltCheck(palette.TOOL_BY_NAME.glob), false);
    assert.equal(requiresHaltCheck(palette.TOOL_BY_NAME.grep), false);
  });

  test('requiresCostWindows tracks openWorldHint', () => {
    assert.equal(requiresCostWindows(palette.TOOL_BY_NAME.read), false);
    assert.equal(requiresCostWindows(palette.TOOL_BY_NAME.bash), true);
  });

  test('isSafeToRetry tracks idempotentHint', () => {
    assert.equal(isSafeToRetry(palette.TOOL_BY_NAME.read), true);
    assert.equal(isSafeToRetry(palette.TOOL_BY_NAME.bash), false);
    assert.equal(isSafeToRetry(palette.TOOL_BY_NAME.edit), false); // idempotentHint=false
  });
});

describe('explainRouting renders human-readable summary', () => {
  test('output includes tool name + each gate', () => {
    const text = explainRouting(palette.TOOL_BY_NAME.write);
    assert.match(text, /tool: write/);
    assert.match(text, /spec_verifier_required/);
  });
});

describe('Sprint 2.9 palette — every tool routes consistently', () => {
  const expectedRouting = {
    read: { spec: false, halt: false, cost: false, retry: true },
    glob: { spec: false, halt: false, cost: false, retry: true },
    grep: { spec: false, halt: false, cost: false, retry: true },
    write: { spec: true, halt: true, cost: false, retry: true },
    edit: { spec: true, halt: true, cost: false, retry: false },
    bash: { spec: true, halt: true, cost: true, retry: false },
  };

  for (const [name, expected] of Object.entries(expectedRouting)) {
    test(`${name} routing matches expected gate set`, () => {
      const tool = palette.TOOL_BY_NAME[name];
      assert.equal(requiresSpecVerifier(tool), expected.spec, 'spec');
      assert.equal(requiresHaltCheck(tool), expected.halt, 'halt');
      assert.equal(requiresCostWindows(tool), expected.cost, 'cost');
      assert.equal(isSafeToRetry(tool), expected.retry, 'retry');
    });
  }
});
