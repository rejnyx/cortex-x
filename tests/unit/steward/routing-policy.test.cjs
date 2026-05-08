'use strict';

/**
 * routing-policy.cjs unit tests — Sprint 2.0b per-action USD cap.
 *
 * Covers:
 *   - global cap default ($1)
 *   - per-kind override
 *   - 0 = explicit opt-out
 *   - invalid env values fall back to default (defensive)
 *   - journal scan sums cost_usd within 24h window
 *   - corrupted entries skipped
 *   - checkPerActionBudget pre-flight gate
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const policy = require('../../../bin/steward/_lib/routing-policy.cjs');

const ENV_KEYS_TO_GUARD = [
  'STEWARD_PER_ACTION_USD_CAP',
  'STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION',
  'STEWARD_PER_ACTION_USD_CAP_ARCHITECTURE_REVIEW',
  'CORTEX_DATA_HOME',
];

let originalEnv = {};
let tmpDataHome;

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS_TO_GUARD) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Each test gets its own journal dir so journal.appendJournal writes are
  // isolated. Cleanup in afterEach.
  tmpDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-routing-policy-'));
  process.env.CORTEX_DATA_HOME = tmpDataHome;
});

afterEach(() => {
  for (const k of ENV_KEYS_TO_GUARD) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  try { fs.rmSync(tmpDataHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('routing-policy: cap resolution', () => {
  test('readGlobalCap returns default $1 when env unset', () => {
    assert.equal(policy.readGlobalCap(), 1.0);
  });

  test('readGlobalCap honors STEWARD_PER_ACTION_USD_CAP env', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '0.25';
    assert.equal(policy.readGlobalCap(), 0.25);
  });

  test('readGlobalCap respects 0 as explicit opt-out', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '0';
    assert.equal(policy.readGlobalCap(), 0);
  });

  test('readGlobalCap rejects negative values, falls back to default', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '-10';
    assert.equal(policy.readGlobalCap(), 1.0);
  });

  test('readGlobalCap rejects non-numeric values, falls back to default', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = 'free!';
    assert.equal(policy.readGlobalCap(), 1.0);
  });

  test('readKindCap returns undefined when no per-kind override set', () => {
    assert.equal(policy.readKindCap('recommendation'), undefined);
  });

  test('readKindCap returns env value when STEWARD_PER_ACTION_USD_CAP_<KIND> set', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION = '0.05';
    assert.equal(policy.readKindCap('recommendation'), 0.05);
  });

  test('resolvePerActionCap prefers per-kind cap over global', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '1.0';
    process.env.STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION = '0.10';
    assert.equal(policy.resolvePerActionCap('recommendation'), 0.10);
    // Different kind falls back to global.
    assert.equal(policy.resolvePerActionCap('architecture_review'), 1.0);
  });

  test('resolvePerActionCap normalizes dashes/dots in action_kind', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP_ARCHITECTURE_REVIEW = '0.40';
    assert.equal(policy.resolvePerActionCap('architecture_review'), 0.40);
    assert.equal(policy.resolvePerActionCap('architecture-review'), 0.40);
  });
});

describe('routing-policy: journal scan + budget gate', () => {
  const journal = require('../../../bin/steward/_lib/journal.cjs');
  const slug = 'cortex-x';

  function appendCost(actionKind, costUsd, tsOffsetMs = 0) {
    const ts = new Date(Date.now() - tsOffsetMs).toISOString();
    journal.appendJournal(slug, {
      ts,
      trigger: 'manual',
      tier: 'T0',
      event: 'action_completed',
      outcome: 'success',
      actor: 'steward',
      action_kind: actionKind,
      action_key: 'rec-test-1',
      action_id: '01HXXX',
      cost_usd: costUsd,
    });
  }

  test('recentSpendForKind sums entries within 24h window', () => {
    appendCost('recommendation', 0.10);
    appendCost('recommendation', 0.20);
    appendCost('architecture_review', 5.00); // different kind, should be excluded
    const sum = policy.recentSpendForKind(slug, 'recommendation');
    assert.ok(sum >= 0.30 - 1e-9 && sum <= 0.30 + 1e-9, `expected ~0.30, got ${sum}`);
  });

  test('recentSpendForKind ignores entries outside the window', () => {
    appendCost('recommendation', 0.10, 25 * 60 * 60 * 1000); // 25h ago
    appendCost('recommendation', 0.05); // now
    const sum = policy.recentSpendForKind(slug, 'recommendation');
    assert.ok(Math.abs(sum - 0.05) < 1e-9, `expected 0.05, got ${sum}`);
  });

  test('recentSpendForKind ignores corrupted entries', () => {
    appendCost('recommendation', 0.05);
    // Manually append a corrupted line to the journal file.
    const journalPath = path.join(tmpDataHome, 'journal', slug, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(journalPath, 'not-json\n', 'utf8');
    const sum = policy.recentSpendForKind(slug, 'recommendation');
    assert.ok(Math.abs(sum - 0.05) < 1e-9);
  });

  test('checkPerActionBudget returns ok when under cap', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '1.0';
    appendCost('recommendation', 0.50);
    const r = policy.checkPerActionBudget(slug, 'recommendation');
    assert.equal(r.ok, true);
    assert.ok(r.spent >= 0.499 && r.spent <= 0.501);
    assert.equal(r.cap, 1.0);
  });

  test('checkPerActionBudget caps at exact threshold', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '0.50';
    appendCost('recommendation', 0.50);
    const r = policy.checkPerActionBudget(slug, 'recommendation');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PER_ACTION_BUDGET_CAP_REACHED');
  });

  test('checkPerActionBudget skipped when cap=0 (opt-out)', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '0';
    appendCost('recommendation', 100);
    const r = policy.checkPerActionBudget(slug, 'recommendation');
    assert.equal(r.ok, true);
    assert.equal(r.cap, 0);
    assert.match(r.reason || '', /disabled/i);
  });

  test('checkPerActionBudget ignores cost from other action_kinds', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '0.20';
    appendCost('architecture_review', 5.00); // does not count against recommendation
    const r = policy.checkPerActionBudget(slug, 'recommendation');
    assert.equal(r.ok, true);
  });

  test('checkPerActionBudget honors per-kind override', () => {
    process.env.STEWARD_PER_ACTION_USD_CAP = '5.00'; // global generous
    process.env.STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION = '0.15'; // recommendation tight
    appendCost('recommendation', 0.20);
    const r = policy.checkPerActionBudget(slug, 'recommendation');
    assert.equal(r.ok, false);
    assert.equal(r.cap, 0.15);
  });

  test('24-h window includes yesterday\'s journal file (midnight-crossing)', () => {
    // Correctness-auditor MAJOR finding: pre-fix, recentSpendForKind read
    // ONLY today's journal file. At 00:01 UTC, all yesterday's spend
    // disappeared from the cap calculation. Test simulates a Steward run
    // at 00:30 UTC with a $0.50 spend recorded yesterday at 22:00 UTC —
    // post-fix, the spend must still count.
    //
    // appendJournal routes by today's date by default (not by entry.ts), so
    // to simulate the cross-midnight case we explicitly write to yesterday's
    // file via opts.path. This matches what real production does: Steward
    // runs yesterday wrote to yesterday's file; today's run reads it.
    const now = Date.now();
    const yesterday = new Date(now - 26 * 60 * 60 * 1000);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);
    const yesterdayFile = path.join(tmpDataHome, 'journal', slug, `${yesterdayDate}.jsonl`);
    fs.mkdirSync(path.dirname(yesterdayFile), { recursive: true });
    journal.appendJournal(slug, {
      ts: yesterday.toISOString(),
      trigger: 'manual',
      tier: 'T0',
      event: 'action_completed',
      outcome: 'success',
      actor: 'steward',
      action_kind: 'recommendation',
      action_key: 'rec-cross-midnight',
      action_id: '01HCROSS',
      cost_usd: 0.50,
    }, { path: yesterdayFile });
    assert.ok(fs.existsSync(yesterdayFile), 'yesterday journal file must exist after explicit write');

    // 1 hour after yesterday's entry — entry is well within a 24h window.
    // Pre-fix: routing-policy only read today's file (which contains nothing
    // from yesterday's perspective) → sum=0 → cap effectively reset at midnight.
    // Post-fix: reads yesterday's file too → sum=0.50.
    const fakeNow = yesterday.getTime() + 1 * 60 * 60 * 1000;
    const sum = policy.recentSpendForKind(slug, 'recommendation', { nowMs: fakeNow });
    assert.ok(Math.abs(sum - 0.50) < 1e-9, `expected 0.50 from yesterday's file, got ${sum}`);
  });

  test('future-timestamped journal entries are skipped (clock-skew defense)', () => {
    // Edge-hunter MAJOR finding: a journal entry with `ts` in the future
    // (clock skew, NTP step backward) was previously included in the
    // window and could permanently lock the cap at $X. Post-fix: skipped.
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h ahead
    journal.appendJournal(slug, {
      ts: future.toISOString(),
      trigger: 'manual',
      tier: 'T0',
      event: 'action_completed',
      outcome: 'success',
      actor: 'steward',
      action_kind: 'recommendation',
      action_key: 'rec-future',
      action_id: '01HFUTURE',
      cost_usd: 999.99, // poison
    });
    const sum = policy.recentSpendForKind(slug, 'recommendation');
    assert.ok(sum < 1, `future entry must be skipped; got sum=${sum}`);
  });

  test('coerceUsdCap rejects "0.5xyz" trailing garbage (strict parsing)', () => {
    // Correctness-auditor MAJOR: pre-fix used parseFloat which lenient-parses
    // "0.5xyz" as 0.5. Post-fix: Number(raw) strict, rejects.
    assert.equal(policy.coerceUsdCap('0.5xyz'), undefined);
    assert.equal(policy.coerceUsdCap('1e'), undefined);
    assert.equal(policy.coerceUsdCap('1.0e'), undefined);
    assert.equal(policy.coerceUsdCap('0.5e308'), undefined); // exceeds MAX_USD_CAP
  });

  test('coerceUsdCap accepts well-formed values', () => {
    assert.equal(policy.coerceUsdCap('0'), 0);
    assert.equal(policy.coerceUsdCap('0.5'), 0.5);
    assert.equal(policy.coerceUsdCap('1'), 1);
    assert.equal(policy.coerceUsdCap('1000'), 1000);
    assert.equal(policy.coerceUsdCap('  0.25  '), 0.25); // trim
  });

  test('coerceUsdCap rejects values above MAX_USD_CAP', () => {
    assert.equal(policy.coerceUsdCap('1001'), undefined);
    assert.equal(policy.coerceUsdCap(String(policy.MAX_USD_CAP + 1)), undefined);
  });

  test('readGlobalCap rejects "1e308" (overflow defense)', () => {
    // Pre-fix: parseFloat('1e308') = 1e308, Number.isFinite true, accepted.
    // Post-fix: above MAX_USD_CAP, rejected → fall back to default $1.
    process.env.STEWARD_PER_ACTION_USD_CAP = '1e308';
    assert.equal(policy.readGlobalCap(), 1.0);
  });
});
