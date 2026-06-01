'use strict';

// Sprint 2.9.7c — hand-rolled property tests for cost-safety primitive
// invariants. Per Sprint 2.3 R1 §3.4 (companion property tests for highest-risk
// primitives — halt-check, cost-safety, spec-verifier, action-engine,
// path-safety). Zero-deps (cortex-x convention).
//
// Closes Sprint 2.9.7b's "next wave" of property coverage.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const costSafety = require('../../../bin/steward/_lib/cost-safety.cjs');

function tmpDataHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cx-cs-${prefix}-`));
}

function seedJournal(dataHome, slug, entries) {
  const journalDir = path.join(dataHome, 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  // Group entries by date
  const byDate = {};
  for (const e of entries) {
    const date = (e.ts || new Date().toISOString()).slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(e);
  }
  for (const [date, dayEntries] of Object.entries(byDate)) {
    const file = path.join(journalDir, `${date}.jsonl`);
    fs.appendFileSync(file, dayEntries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
}

function withDataHome(dataHome, fn) {
  const prev = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dataHome;
  try {
    return fn();
  } finally {
    if (prev !== undefined) process.env.CORTEX_DATA_HOME = prev;
    else delete process.env.CORTEX_DATA_HOME;
  }
}

describe('Sprint 2.9.7c — cost-safety multi-window monotonicity invariants', () => {
  test('invariant: empty journal ⇒ all spend reads return 0', () => {
    const dataHome = tmpDataHome('empty');
    withDataHome(dataHome, () => {
      assert.equal(costSafety.readDailySpend('cx'), 0);
      assert.equal(costSafety.readWeeklySpend('cx'), 0);
      assert.equal(costSafety.readMonthlySpend('cx'), 0);
    });
  });

  test('invariant: spend monotonicity — daily ≤ weekly ≤ monthly when entries are within window', () => {
    const dataHome = tmpDataHome('monotonicity');
    const now = new Date();
    // Clamp the spread to the current calendar month. The test name's
    // "when entries are within window" qualifier requires ALL entries inside
    // monthly's window (calendar-month-start … now); otherwise weekly's
    // sliding-7-day window legitimately extends past the calendar boundary
    // and exceeds monthly, breaking the invariant on day 1–6 of any UTC
    // month (Sprint 2.40 surfaced this on a 2026-06-01 run).
    const dayOfMonth = now.getUTCDate();                  // 1..31
    const seedDays = Math.min(7, dayOfMonth);
    const entries = [];
    for (let i = 0; i < seedDays; i++) {
      const ts = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      entries.push({
        ts: ts.toISOString(),
        event: 'execute_action_completed',
        outcome: 'success',
        cost_usd: 0.10,
      });
    }
    seedJournal(dataHome, 'cx', entries);
    withDataHome(dataHome, () => {
      const daily = costSafety.readDailySpend('cx');
      const weekly = costSafety.readWeeklySpend('cx');
      const monthly = costSafety.readMonthlySpend('cx');
      assert.ok(daily <= weekly, `daily=${daily} should be <= weekly=${weekly}`);
      assert.ok(weekly <= monthly, `weekly=${weekly} should be <= monthly=${monthly}`);
      // Daily should match today's only entry: $0.10
      assert.ok(Math.abs(daily - 0.10) < 1e-9, `daily=${daily} expected ~0.10`);
      // Weekly = seedDays × $0.10 (full 7 days normally; clamped near month start)
      const expectedWeekly = seedDays * 0.10;
      assert.ok(Math.abs(weekly - expectedWeekly) < 1e-6, `weekly=${weekly} expected ~${expectedWeekly}`);
    });
  });

  test('invariant: malformed cost_usd values do not crash the readers', () => {
    const dataHome = tmpDataHome('malformed');
    const malformed = [
      { ts: new Date().toISOString(), event: 'x', cost_usd: 'not a number' },
      { ts: new Date().toISOString(), event: 'x', cost_usd: NaN },
      { ts: new Date().toISOString(), event: 'x', cost_usd: -1 },
      { ts: new Date().toISOString(), event: 'x', cost_usd: Infinity },
      { ts: new Date().toISOString(), event: 'x', cost_usd: null },
      { ts: new Date().toISOString(), event: 'x', cost_usd: undefined },
      { ts: new Date().toISOString(), event: 'x' /* missing cost_usd */ },
    ];
    seedJournal(dataHome, 'cx', malformed);
    withDataHome(dataHome, () => {
      // Reader must return a finite non-negative number despite garbage input.
      const daily = costSafety.readDailySpend('cx');
      assert.ok(Number.isFinite(daily), `daily must be finite (got ${daily})`);
      assert.ok(daily >= 0, `daily must be non-negative (got ${daily})`);
    });
  });

  test('invariant: detectCriterionLoop never triggers below threshold', () => {
    const dataHome = tmpDataHome('loop-below');
    const entries = [];
    // 4 SPEC_VIOLATION events for same criterion over 3 days — below threshold of 5
    for (let i = 0; i < 4; i++) {
      const ts = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      entries.push({
        ts: ts.toISOString(),
        event: 'execute_spec_failed',
        outcome: 'failure',
        action_key: 'cx#1',
        spec_failures: [{ id: 'no_destructive_rewrite' }],
      });
    }
    seedJournal(dataHome, 'cx', entries);
    withDataHome(dataHome, () => {
      const result = costSafety.detectCriterionLoop('cx', { threshold: 5, windowDays: 7 });
      assert.equal(result.tripped, false, 'should not trigger at 4 < threshold 5');
    });
  });

  test('invariant: detectCriterionLoop ALWAYS triggers at exactly threshold', () => {
    const dataHome = tmpDataHome('loop-at');
    const entries = [];
    // Exactly 5 SPEC_VIOLATION events for same criterion over 5 days
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      entries.push({
        ts: ts.toISOString(),
        event: 'execute_spec_failed',
        outcome: 'failure',
        action_key: 'cx#1',
        spec_failures: [{ id: 'no_destructive_rewrite' }],
      });
    }
    seedJournal(dataHome, 'cx', entries);
    withDataHome(dataHome, () => {
      const result = costSafety.detectCriterionLoop('cx', { threshold: 5, windowDays: 7 });
      assert.equal(result.tripped, true, 'should trigger at exactly 5 >= threshold 5');
      assert.equal(result.criterionId, 'no_destructive_rewrite');
      assert.equal(result.actionKey, 'cx#1');
    });
  });

  test('invariant: token velocity reader never returns negative or NaN totals', () => {
    const dataHome = tmpDataHome('velocity-noise');
    const entries = [
      { ts: new Date().toISOString(), event: 'execute', tokens_in: 1000, tokens_out: 500 },
      { ts: new Date().toISOString(), event: 'execute', tokens_in: 'not number', tokens_out: 200 },
      { ts: new Date().toISOString(), event: 'execute', tokens_in: -100, tokens_out: 100 },
      { ts: new Date().toISOString(), event: 'execute', tokens_in: NaN, tokens_out: NaN },
      { ts: new Date().toISOString(), event: 'execute' /* missing both */ },
    ];
    seedJournal(dataHome, 'cx', entries);
    withDataHome(dataHome, () => {
      const v = costSafety.readTokenVelocity('cx');
      // Returns { tokensIn, tokensOut, total, windowMs } — verify all numeric
      // and non-negative regardless of malformed entries.
      assert.ok(Number.isFinite(v.tokensIn), `tokensIn must be finite (got ${v.tokensIn})`);
      assert.ok(Number.isFinite(v.tokensOut), `tokensOut must be finite (got ${v.tokensOut})`);
      assert.ok(Number.isFinite(v.total), `total must be finite (got ${v.total})`);
      assert.ok(v.tokensIn >= 0, `tokensIn must be non-negative (got ${v.tokensIn})`);
      assert.ok(v.tokensOut >= 0, `tokensOut must be non-negative (got ${v.tokensOut})`);
      assert.ok(v.total >= 0, `total must be non-negative (got ${v.total})`);
    });
  });

  test('invariant: weekly budget gate rejects when sum >= cap', () => {
    const dataHome = tmpDataHome('weekly-rejected');
    // 5 entries × $5 = $25 = exactly the default weekly cap
    const entries = [];
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      entries.push({
        ts: ts.toISOString(),
        event: 'execute_action_completed',
        outcome: 'success',
        cost_usd: 5.0,
      });
    }
    seedJournal(dataHome, 'cx', entries);
    withDataHome(dataHome, () => {
      const r = costSafety.checkWeeklyBudget('cx');
      assert.equal(r.ok, false, 'budget gate must fail at exactly cap');
      assert.equal(r.code, 'BUDGET_WEEKLY_CAP_REACHED');
    });
  });

  test('invariant: budget gates pass when journal is empty', () => {
    const dataHome = tmpDataHome('empty-budget');
    withDataHome(dataHome, () => {
      assert.equal(costSafety.checkWeeklyBudget('cx').ok, true);
      assert.equal(costSafety.checkMonthlyBudget('cx').ok, true);
      assert.equal(costSafety.checkTokenVelocity('cx').ok, true);
    });
  });

  test('invariant: spendForecast returns object with sensible numeric fields', () => {
    const dataHome = tmpDataHome('forecast');
    seedJournal(dataHome, 'cx', [
      { ts: new Date().toISOString(), event: 'execute_action_completed', cost_usd: 0.50 },
    ]);
    withDataHome(dataHome, () => {
      const f = costSafety.spendForecast('cx');
      assert.ok(typeof f === 'object', 'spendForecast returns object');
      // Don't lock the field names — just verify any numeric fields are
      // finite and non-negative. This is a weak invariant but catches
      // regressions like NaN-on-empty-journal.
      function checkAllNumbers(obj, prefix = '') {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'number') {
            assert.ok(Number.isFinite(v), `${prefix}${k} must be finite (got ${v})`);
            assert.ok(v >= 0, `${prefix}${k} must be non-negative (got ${v})`);
          } else if (v && typeof v === 'object' && !Array.isArray(v)) {
            checkAllNumbers(v, `${prefix}${k}.`);
          }
        }
      }
      checkAllNumbers(f);
    });
  });
});
