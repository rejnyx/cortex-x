'use strict';

/**
 * extract-usage.test.cjs — Sprint pre-2.0 housekeeping
 *
 * extractUsage was originally single-response shaped (`{usage: {cost, ...}}`).
 * Sprint 2.0b RouteLLM-style ensemble runs multiple LLM calls in parallel
 * (e.g. judge + cheap-implementer); the cost-aggregation must sum across
 * responses without breaking the existing single-response callers.
 *
 * Audit (2026-05-09) flagged this as a Sprint 2.0b blocker — without the
 * array-path the journal would receive a malformed cost_usd shape after the
 * first parallel call lands.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractUsage } = require('../../../bin/hermes/_lib/action-engine.cjs');

describe('extractUsage: single-response shape (backward compat)', () => {
  test('extracts cost_usd / tokens_in / tokens_out from data.usage', () => {
    const r = extractUsage({
      usage: { cost: 0.0042, prompt_tokens: 1234, completion_tokens: 567 },
    });
    assert.deepEqual(r, { cost_usd: 0.0042, tokens_in: 1234, tokens_out: 567 });
  });

  test('handles null / missing usage gracefully', () => {
    assert.deepEqual(extractUsage(null), {});
    assert.deepEqual(extractUsage({}), {});
    assert.deepEqual(extractUsage({ usage: null }), {});
  });

  test('coerces string costs (some OpenRouter routes return "0.0042" as string)', () => {
    const r = extractUsage({ usage: { cost: '0.0042', prompt_tokens: '1234' } });
    assert.equal(r.cost_usd, 0.0042);
    assert.equal(r.tokens_in, 1234);
  });

  test('rejects negative or NaN costs', () => {
    const r = extractUsage({ usage: { cost: -0.01, prompt_tokens: NaN } });
    assert.deepEqual(r, {});
  });

  test('truncates string-coerced token counts (validateEntry expects integer)', () => {
    const r = extractUsage({ usage: { prompt_tokens: '1234.7', completion_tokens: 567 } });
    assert.equal(r.tokens_in, 1234);
    assert.equal(r.tokens_out, 567);
  });
});

describe('extractUsage: array shape (Sprint 2.0b RouteLLM ensemble)', () => {
  test('sums cost across multiple responses', () => {
    const r = extractUsage([
      { usage: { cost: 0.001, prompt_tokens: 100, completion_tokens: 50 } },
      { usage: { cost: 0.002, prompt_tokens: 200, completion_tokens: 75 } },
      { usage: { cost: 0.0005, prompt_tokens: 50, completion_tokens: 20 } },
    ]);
    assert.equal(r.cost_usd, 0.001 + 0.002 + 0.0005);
    assert.equal(r.tokens_in, 100 + 200 + 50);
    assert.equal(r.tokens_out, 50 + 75 + 20);
  });

  test('handles mixed null/missing usage in ensemble (e.g. one provider returned no usage block)', () => {
    const r = extractUsage([
      { usage: { cost: 0.001, prompt_tokens: 100 } },
      null,
      { usage: null },
      { usage: { cost: 0.0005, prompt_tokens: 50 } },
    ]);
    assert.equal(r.cost_usd, 0.001 + 0.0005);
    assert.equal(r.tokens_in, 150);
    // No completion_tokens reported → omit field entirely (don't emit 0)
    assert.equal(r.tokens_out, undefined);
  });

  test('empty array returns empty envelope', () => {
    assert.deepEqual(extractUsage([]), {});
  });

  test('coerces mixed string + number costs across ensemble (H4 string-coercion preserved)', () => {
    const r = extractUsage([
      { usage: { cost: '0.001' } },
      { usage: { cost: 0.002 } },
    ]);
    // Sum equals number addition, not string concat
    assert.equal(r.cost_usd, 0.003);
  });

  test('single-element array still works (degenerate ensemble)', () => {
    const r = extractUsage([{ usage: { cost: 0.005, prompt_tokens: 100, completion_tokens: 50 } }]);
    assert.deepEqual(r, { cost_usd: 0.005, tokens_in: 100, tokens_out: 50 });
  });
});
