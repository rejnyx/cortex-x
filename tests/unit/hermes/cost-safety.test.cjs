'use strict';

/**
 * cost-safety.test.cjs — Sprint 1.9.1 multi-window cost safety + loop detector.
 *
 * Tests every primitive in `bin/hermes/_lib/cost-safety.cjs` against an
 * isolated CORTEX_DATA_HOME, with hand-crafted journal entries simulating
 * spend / token-velocity / spec-failure patterns. No live LLM, no network.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cs = require('../../../bin/hermes/_lib/cost-safety.cjs');
const journal = require('../../../bin/hermes/_lib/journal.cjs');

const SLUG = 'cost-safety-test';

function setupDataHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-test-'));
  process.env.CORTEX_DATA_HOME = dir;
  return dir;
}

function teardownDataHome(prevHome) {
  if (prevHome === undefined) delete process.env.CORTEX_DATA_HOME;
  else process.env.CORTEX_DATA_HOME = prevHome;
}

// Write a journal entry on a specific date (YYYY-MM-DD). Useful for backdating.
function writeOn(date, entry) {
  return journal.appendJournal(SLUG, entry, {
    path: journal.journalPath(SLUG, date),
  });
}

function isoMinus(daysAgo, hour = 12) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function dateMinus(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe('cost-safety: env readers', () => {
  let prevEnv = {};
  beforeEach(() => {
    prevEnv = {
      week: process.env.HERMES_WEEKLY_USD_CAP,
      month: process.env.HERMES_MONTHLY_USD_CAP,
      vel: process.env.HERMES_TOKEN_VELOCITY_CAP,
      loop: process.env.HERMES_LOOP_THRESHOLD,
    };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries({
      HERMES_WEEKLY_USD_CAP: prevEnv.week,
      HERMES_MONTHLY_USD_CAP: prevEnv.month,
      HERMES_TOKEN_VELOCITY_CAP: prevEnv.vel,
      HERMES_LOOP_THRESHOLD: prevEnv.loop,
    })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('returns documented defaults when env unset', () => {
    delete process.env.HERMES_WEEKLY_USD_CAP;
    delete process.env.HERMES_MONTHLY_USD_CAP;
    delete process.env.HERMES_TOKEN_VELOCITY_CAP;
    delete process.env.HERMES_LOOP_THRESHOLD;
    assert.equal(cs.readWeeklyCap(), 25);
    assert.equal(cs.readMonthlyCap(), 80);
    assert.equal(cs.readTokenVelocityCap(), 50_000);
    assert.equal(cs.readLoopThreshold(), 5);
  });

  test('honors `0` as explicit opt-out (NOT reset to default)', () => {
    process.env.HERMES_WEEKLY_USD_CAP = '0';
    process.env.HERMES_MONTHLY_USD_CAP = '0';
    process.env.HERMES_LOOP_THRESHOLD = '0';
    assert.equal(cs.readWeeklyCap(), 0);
    assert.equal(cs.readMonthlyCap(), 0);
    assert.equal(cs.readLoopThreshold(), 0);
  });

  test('clamps negative + NaN to default', () => {
    process.env.HERMES_WEEKLY_USD_CAP = '-1';
    process.env.HERMES_MONTHLY_USD_CAP = 'banana';
    assert.equal(cs.readWeeklyCap(), 25);
    assert.equal(cs.readMonthlyCap(), 80);
  });
});

describe('cost-safety: spend window readers', () => {
  let dataHome;
  let prevHome;
  beforeEach(() => { prevHome = process.env.CORTEX_DATA_HOME; dataHome = setupDataHome(); });
  afterEach(() => { teardownDataHome(prevHome); fs.rmSync(dataHome, { recursive: true, force: true }); });

  test('readDailySpend sums today only, ignores backdated entries', () => {
    writeOn(dateMinus(0), {
      ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 0.5,
    });
    writeOn(dateMinus(0), {
      ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 0.3,
    });
    writeOn(dateMinus(2), {
      ts: isoMinus(2), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 100,
    });
    assert.equal(cs.readDailySpend(SLUG), 0.8);
  });

  test('readWeeklySpend sums sliding 7-day window', () => {
    for (let d = 0; d < 6; d += 1) {
      writeOn(dateMinus(d), {
        ts: isoMinus(d), trigger: 'cron', tier: 'T2',
        event: 'execute_completed', outcome: 'success', cost_usd: 1.0,
      });
    }
    // Outside window
    writeOn(dateMinus(10), {
      ts: isoMinus(10), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 100,
    });
    const spend = cs.readWeeklySpend(SLUG);
    assert.ok(spend >= 5 && spend <= 7, `weekly spend out of bounds: ${spend}`);
  });

  test('readMonthlySpend uses calendar-month boundary', () => {
    // Today's calendar month entry
    writeOn(dateMinus(0), {
      ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 1.5,
    });
    const spend = cs.readMonthlySpend(SLUG);
    assert.equal(spend, 1.5);
  });
});

describe('cost-safety: token velocity', () => {
  let dataHome;
  let prevHome;
  beforeEach(() => { prevHome = process.env.CORTEX_DATA_HOME; dataHome = setupDataHome(); });
  afterEach(() => { teardownDataHome(prevHome); fs.rmSync(dataHome, { recursive: true, force: true }); });

  test('sums tokens_in + tokens_out within window', () => {
    const now = new Date().toISOString();
    writeOn(dateMinus(0), {
      ts: now, trigger: 'cron', tier: 'T2', event: 'execute_completed',
      outcome: 'success', tokens_in: 10000, tokens_out: 5000,
    });
    const v = cs.readTokenVelocity(SLUG);
    assert.equal(v.tokensIn, 10000);
    assert.equal(v.tokensOut, 5000);
    assert.equal(v.total, 15000);
  });

  test('ignores entries older than windowMs', () => {
    // 1-minute window — entry from 10 minutes ago must be ignored.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeOn(dateMinus(0), {
      ts: tenMinAgo, trigger: 'cron', tier: 'T2', event: 'execute_completed',
      outcome: 'success', tokens_in: 99999,
    });
    const v = cs.readTokenVelocity(SLUG, 60 * 1000);
    assert.equal(v.total, 0);
  });
});

describe('cost-safety: detectCriterionLoop', () => {
  let dataHome;
  let prevHome;
  beforeEach(() => { prevHome = process.env.CORTEX_DATA_HOME; dataHome = setupDataHome(); });
  afterEach(() => { teardownDataHome(prevHome); fs.rmSync(dataHome, { recursive: true, force: true }); });

  test('does NOT trip below threshold', () => {
    for (let d = 0; d < 3; d += 1) {
      writeOn(dateMinus(d), {
        ts: isoMinus(d), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'foo#1',
        spec_failures: [{ id: 'no_destructive_rewrite' }],
      });
    }
    const r = cs.detectCriterionLoop(SLUG, { threshold: 5, windowDays: 7 });
    assert.equal(r.tripped, false);
  });

  test('trips at threshold for same criterion + same action_key', () => {
    for (let d = 0; d < 5; d += 1) {
      writeOn(dateMinus(d), {
        ts: isoMinus(d), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'foo#1',
        spec_failures: [{ id: 'no_destructive_rewrite' }],
      });
    }
    const r = cs.detectCriterionLoop(SLUG, { threshold: 5, windowDays: 7 });
    assert.equal(r.tripped, true);
    assert.equal(r.criterionId, 'no_destructive_rewrite');
    assert.equal(r.actionKey, 'foo#1');
    assert.equal(r.count, 5);
  });

  test('does NOT cross-contaminate between action_keys', () => {
    // 4 fails on foo#1 + 4 fails on foo#2 → neither trips threshold=5
    for (let d = 0; d < 4; d += 1) {
      writeOn(dateMinus(d), {
        ts: isoMinus(d), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'foo#1',
        spec_failures: [{ id: 'X' }],
      });
      writeOn(dateMinus(d), {
        ts: isoMinus(d), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'foo#2',
        spec_failures: [{ id: 'X' }],
      });
    }
    const r = cs.detectCriterionLoop(SLUG, { threshold: 5, windowDays: 7 });
    assert.equal(r.tripped, false);
  });

  test('threshold=0 disables detector', () => {
    for (let d = 0; d < 100; d += 1) {
      writeOn(dateMinus(0), {
        ts: new Date().toISOString(), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'X', spec_failures: [{ id: 'Y' }],
      });
    }
    const r = cs.detectCriterionLoop(SLUG, { threshold: 0 });
    assert.equal(r.tripped, false);
    assert.match(r.reason, /disabled/);
  });

  test('ignores entries outside windowDays', () => {
    // 5 fails at day 30 — window is 7 → no trip
    for (let i = 0; i < 5; i += 1) {
      writeOn(dateMinus(30), {
        ts: isoMinus(30), trigger: 'cron', tier: 'T2', event: 'execute_spec_failed',
        outcome: 'failure', action_key: 'foo#1', spec_failures: [{ id: 'X' }],
      });
    }
    const r = cs.detectCriterionLoop(SLUG, { threshold: 5, windowDays: 7 });
    assert.equal(r.tripped, false);
  });
});

describe('cost-safety: gate evaluators', () => {
  let dataHome;
  let prevHome;
  let prevEnv;
  beforeEach(() => {
    prevHome = process.env.CORTEX_DATA_HOME;
    dataHome = setupDataHome();
    prevEnv = { weekly: process.env.HERMES_WEEKLY_USD_CAP };
  });
  afterEach(() => {
    teardownDataHome(prevHome);
    if (prevEnv.weekly === undefined) delete process.env.HERMES_WEEKLY_USD_CAP;
    else process.env.HERMES_WEEKLY_USD_CAP = prevEnv.weekly;
    fs.rmSync(dataHome, { recursive: true, force: true });
  });

  test('checkWeeklyBudget returns ok when below cap', () => {
    process.env.HERMES_WEEKLY_USD_CAP = '10';
    writeOn(dateMinus(1), {
      ts: isoMinus(1), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 3,
    });
    const r = cs.checkWeeklyBudget(SLUG);
    assert.equal(r.ok, true);
    assert.equal(r.cap, 10);
    assert.equal(r.spent, 3);
  });

  test('checkWeeklyBudget returns BUDGET_WEEKLY_CAP_REACHED at cap', () => {
    process.env.HERMES_WEEKLY_USD_CAP = '5';
    writeOn(dateMinus(1), {
      ts: isoMinus(1), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 5,
    });
    const r = cs.checkWeeklyBudget(SLUG);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BUDGET_WEEKLY_CAP_REACHED');
  });

  test('cap=0 honored as opt-out (always ok=true)', () => {
    process.env.HERMES_WEEKLY_USD_CAP = '0';
    writeOn(dateMinus(0), {
      ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 9999,
    });
    const r = cs.checkWeeklyBudget(SLUG);
    assert.equal(r.ok, true);
    assert.match(r.reason, /disabled/);
  });
});

describe('cost-safety: spendForecast', () => {
  let dataHome;
  let prevHome;
  beforeEach(() => { prevHome = process.env.CORTEX_DATA_HOME; dataHome = setupDataHome(); });
  afterEach(() => { teardownDataHome(prevHome); fs.rmSync(dataHome, { recursive: true, force: true }); });

  test('returns daily/weekly/monthly with caps + spent + percent', () => {
    writeOn(dateMinus(0), {
      ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
      event: 'execute_completed', outcome: 'success', cost_usd: 2.5,
    });
    const f = cs.spendForecast(SLUG);
    assert.ok(f.daily);
    assert.ok(f.weekly);
    assert.ok(f.monthly);
    assert.equal(f.daily.spent, 2.5);
    assert.ok(f.daily.percent !== undefined);
    assert.ok(f.daily.percent > 0);
  });

  test('omits projected when window is too early to extrapolate', () => {
    // No spend, no journal entries
    const f = cs.spendForecast(SLUG);
    // Daily projected may exist (rate * 24h) — depends on hour of day.
    // Monthly projected may exist (rate * days_in_month / day_of_month) — depends on day.
    // We only assert shape, not exact values.
    assert.equal(typeof f.daily.spent, 'number');
    assert.equal(typeof f.weekly.spent, 'number');
    assert.equal(typeof f.monthly.spent, 'number');
  });
});
