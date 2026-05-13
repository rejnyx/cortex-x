// tests/integration/evolve-weekly-cost-flow.test.cjs — Sprint 2.19 v1.5
//
// Closes the integration gap between Sprint 2.19 v1 (evolve_weekly action_kind
// shipped, journals cost_usd on success + failure paths) and Sprint 1.9.1
// (multi-window USD caps read journal entries summing cost_usd).
//
// The Sprint 2.19 v1 R2 review applied a try/finally around the journal write
// to guarantee cost lands on partial-cost-on-crash paths — but no integration
// test ever proved end-to-end that:
//
//   evolve_weekly_completed journal entry with cost_usd
//                           ↓
//   readWeeklySpend / readMonthlySpend reads + sums it
//                           ↓
//   checkWeeklyBudget / checkMonthlyBudget consults it in pre-flight
//                           ↓
//   when cumulative >= cap → BUDGET_*_CAP_REACHED returned by gate
//
// This sprint adds that proof. No production code changes — this is a
// regression test asserting existing wiring works correctly.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const costSafety = require('../../bin/steward/_lib/cost-safety.cjs');

const SLUG = 'evolve-weekly-cost-flow';

function withEnv(envOverrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function makeDataHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evolve-cost-flow-'));
}

// R2 correctness LOW: avoid tmpdir leak by wiping per test. CI cleans /tmp,
// but local dev accumulates evolve-cost-flow-* dirs otherwise.
function cleanupDataHome(dataHome) {
  try { fs.rmSync(dataHome, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function writeJournalEntry(dataHome, slug, entry) {
  // Journal file format per bin/steward/_lib/journal.cjs:38:
  //   $CORTEX_DATA_HOME/journal/<slug>/<YYYY-MM-DD>.jsonl
  // (NOT <YYYY-MM-DD>-<slug>.jsonl — the slug is the directory, not filename.)
  const dir = path.join(dataHome, 'journal', slug);
  fs.mkdirSync(dir, { recursive: true });
  const isoDate = entry.ts.slice(0, 10);
  const fname = `${isoDate}.jsonl`;
  fs.appendFileSync(path.join(dir, fname), JSON.stringify(entry) + '\n', 'utf8');
}

describe('Sprint 2.19 v1.5 — evolve_weekly cost flows into D/W/M caps', () => {
  test('single evolve_weekly_completed entry → readWeeklySpend sums cost_usd', () => {
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
      writeJournalEntry(dataHome, SLUG, {
        ts: new Date().toISOString(),
        tier: 'T0',
        event: 'evolve_weekly_completed',
        actor: 'steward',
        action_kind: 'evolve_weekly',
        outcome: 'success',
        candidates_total: 3,
        proposals_count: 2,
        cost_usd: 0.45,
      });
      const spent = costSafety.readWeeklySpend(SLUG);
      assert.equal(spent, 0.45, `expected 0.45, got ${spent}`);
    });
  });

  test('multiple evolve_weekly entries sum correctly + checkWeeklyBudget reflects spend', () => {
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 25 }, () => {
      const now = Date.now();
      // 3 entries: today, 2 days ago, 5 days ago — all within 7-day sliding window
      const entries = [
        { offset: 0, cost: 0.5 },
        { offset: 2 * 24 * 60 * 60 * 1000, cost: 1.2 },
        { offset: 5 * 24 * 60 * 60 * 1000, cost: 0.8 },
      ];
      for (const e of entries) {
        writeJournalEntry(dataHome, SLUG, {
          ts: new Date(now - e.offset).toISOString(),
          tier: 'T0',
          event: 'evolve_weekly_completed',
          actor: 'steward',
          action_kind: 'evolve_weekly',
          outcome: 'success',
          cost_usd: e.cost,
        });
      }
      const spent = costSafety.readWeeklySpend(SLUG);
      assert.ok(Math.abs(spent - 2.5) < 0.001, `expected 2.5, got ${spent}`);

      const gate = costSafety.checkWeeklyBudget(SLUG);
      assert.equal(gate.ok, true);
      assert.equal(gate.cap, 25);
      assert.ok(Math.abs(gate.spent - 2.5) < 0.001);
    });
  });

  test('cumulative evolve_weekly cost exceeding STEWARD_WEEKLY_USD_CAP trips BUDGET_WEEKLY_CAP_REACHED', () => {
    // Real-incident anchor: an evolve_weekly runaway (3 invocations × $10 each
    // via Sonnet) would blow past $25 weekly cap. Verify pre-flight catches it.
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 5 }, () => {
      const now = Date.now();
      // 3 entries × $2 = $6 → over the $5 cap
      for (let i = 0; i < 3; i += 1) {
        writeJournalEntry(dataHome, SLUG, {
          ts: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
          tier: 'T0',
          event: 'evolve_weekly_completed',
          actor: 'steward',
          action_kind: 'evolve_weekly',
          outcome: 'success',
          cost_usd: 2,
        });
      }
      const gate = costSafety.checkWeeklyBudget(SLUG);
      assert.equal(gate.ok, false, `expected ok:false at spent=6 cap=5, got: ${JSON.stringify(gate)}`);
      assert.equal(gate.code, 'BUDGET_WEEKLY_CAP_REACHED');
      assert.equal(gate.cap, 5);
      assert.ok(gate.spent >= 5);
    });
  });

  test('evolve_weekly partial-cost on FAILURE journals also count toward cap (Sprint 2.19 v1 R2 try/finally regression)', () => {
    // The Sprint 2.19 v1 R2 fix wrapped journal write in try/finally so cost
    // lands even when runEvolveWeekly throws mid-loop. Verify failure-outcome
    // entries with partial cost_usd are still counted toward the cap.
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 5 }, () => {
      writeJournalEntry(dataHome, SLUG, {
        ts: new Date().toISOString(),
        tier: 'T0',
        event: 'evolve_weekly_completed',
        actor: 'steward',
        action_kind: 'evolve_weekly',
        outcome: 'failure',
        candidates_total: 5,
        proposals_count: 0,
        cost_usd: 6, // partial cost from crash mid-loop
      });
      const gate = costSafety.checkWeeklyBudget(SLUG);
      assert.equal(gate.ok, false);
      assert.equal(gate.code, 'BUDGET_WEEKLY_CAP_REACHED');
      // R2 regression: cost from FAILURE path is counted same as SUCCESS
      assert.ok(gate.spent >= 5);
    });
  });

  test('evolve_weekly cost flows into monthly cap (calendar-month window)', () => {
    // R2 correctness MED: previous version placed entry at 01:00 UTC on
    // month-start. If test ran at 23:59 UTC on last day of month, cost-safety
    // would re-read `new Date()` after rollover and the entry would fall in
    // last month's window → flake. Placing entry 12 hours ago guarantees same
    // calendar month for both write + read regardless of test execution time.
    const dataHome = makeDataHome();
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_MONTHLY_USD_CAP: 80 }, () => {
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        writeJournalEntry(dataHome, SLUG, {
          ts: twelveHoursAgo.toISOString(),
          tier: 'T0',
          event: 'evolve_weekly_completed',
          actor: 'steward',
          action_kind: 'evolve_weekly',
          outcome: 'success',
          cost_usd: 50,
        });
        const spent = costSafety.readMonthlySpend(SLUG);
        assert.ok(spent >= 50, `expected ≥50, got ${spent}`);
        const gate = costSafety.checkMonthlyBudget(SLUG);
        assert.equal(gate.ok, true);
        assert.ok(gate.spent >= 50);
      });
    } finally { cleanupDataHome(dataHome); }
  });

  test('R2 acceptance gap #1: spent EXACTLY equal to cap trips gate (>= semantics)', () => {
    // R2 acceptance-auditor flagged the spent===cap boundary as load-bearing
    // because checkWeeklyBudget uses `if (spent >= cap)`. A regression making
    // it `>` would silently allow the cap-exact case through. Test pins it.
    const dataHome = makeDataHome();
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 10 }, () => {
        writeJournalEntry(dataHome, SLUG, {
          ts: new Date().toISOString(),
          tier: 'T0',
          event: 'evolve_weekly_completed',
          actor: 'steward',
          action_kind: 'evolve_weekly',
          outcome: 'success',
          cost_usd: 10, // exactly at cap
        });
        const gate = costSafety.checkWeeklyBudget(SLUG);
        assert.equal(gate.ok, false, `spent==cap should trip (>= semantics), got ok:${gate.ok}`);
        assert.equal(gate.code, 'BUDGET_WEEKLY_CAP_REACHED');
        assert.equal(gate.spent, 10);
        assert.equal(gate.cap, 10);
      });
    } finally { cleanupDataHome(dataHome); }
  });

  test('evolve_weekly entry OLDER than 7 days does NOT inflate weekly spend', () => {
    // Sliding 7-day window — older entries fall off.
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 25 }, () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      writeJournalEntry(dataHome, SLUG, {
        ts: tenDaysAgo.toISOString(),
        tier: 'T0',
        event: 'evolve_weekly_completed',
        actor: 'steward',
        action_kind: 'evolve_weekly',
        outcome: 'success',
        cost_usd: 100,
      });
      const spent = costSafety.readWeeklySpend(SLUG);
      assert.equal(spent, 0, `10d-old entry should not appear in 7d window, got ${spent}`);
    });
  });

  test('STEWARD_WEEKLY_USD_CAP=0 disables the gate even when evolve_weekly cost is large', () => {
    // The "0 = explicit opt-out" contract from cost-safety.cjs comment.
    const dataHome = makeDataHome();
    withEnv({ CORTEX_DATA_HOME: dataHome, STEWARD_WEEKLY_USD_CAP: 0 }, () => {
      writeJournalEntry(dataHome, SLUG, {
        ts: new Date().toISOString(),
        tier: 'T0',
        event: 'evolve_weekly_completed',
        actor: 'steward',
        action_kind: 'evolve_weekly',
        outcome: 'success',
        cost_usd: 999,
      });
      const gate = costSafety.checkWeeklyBudget(SLUG);
      assert.equal(gate.ok, true);
      assert.equal(gate.cap, 0);
      assert.match(gate.reason, /disabled/);
    });
  });
});
