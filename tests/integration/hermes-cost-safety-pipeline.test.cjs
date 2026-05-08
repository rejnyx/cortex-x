'use strict';

/**
 * cost-safety-pipeline.test.cjs — Sprint 1.9.1 integration.
 *
 * Drives execute.cjs's pre-flight gate pipeline to prove:
 *   - weekly + monthly cap trip BEFORE the daily cap when daily is fine but
 *     7-day or month accumulation has reached the higher cap
 *   - token velocity gate trips for sub-daily token bursts
 *   - cross-session loop detector writes HERMES_HALT when a criterion id
 *     fires ≥ threshold times in window
 *   - existing daily cap + failure breaker behaviour unchanged
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const execute = require('../../bin/hermes/execute.cjs');
const journal = require('../../bin/hermes/_lib/journal.cjs');

const SLUG = 'cost-safety-int';

function tmpRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'fix', private: true, scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

function writePlan(plan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-plan-'));
  const f = path.join(tmp, 'plan.json');
  fs.writeFileSync(f, JSON.stringify(plan), 'utf8');
  return f;
}

function buildPlan() {
  return {
    ok: true, mode: 'dry-run', slug: SLUG, action_kind: 'recommendation',
    action: { num: 1, title: 'demo', action_key: `${SLUG}#1`, body: 'edit' },
    branch: `hermes/cs-int-${Math.random().toString(36).slice(2, 6)}`,
    action_id: `01CS${Date.now().toString(36).slice(-6).toUpperCase()}`,
    trigger: 'manual',
    commit_message:
      'feat: cs-int\n\nbody\n\nHermes-Action-Id: 01\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: cortex/recommendations.md#1\nCo-Authored-By: Hermes <hermes@cortex-x.local>',
  };
}

function dateMinus(d) {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isoMinus(d) {
  const dt = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  dt.setUTCHours(12, 0, 0, 0);
  return dt.toISOString();
}

function seedJournal(entries) {
  for (const e of entries) {
    journal.appendJournal(SLUG, e.entry, { path: journal.journalPath(SLUG, e.date) });
  }
}

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  }
}

describe('Sprint 1.9.1 integration: weekly cap trips even when daily is fine', () => {
  test('seeded $4/day × 6 days → daily $0 today → weekly cap $20 trips', async () => {
    const repoRoot = tmpRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-data-'));
    const planFile = writePlan(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_DAILY_USD_CAP: '5',
      HERMES_WEEKLY_USD_CAP: '20',
      HERMES_MONTHLY_USD_CAP: '0', // disable monthly to isolate weekly
      HERMES_TOKEN_VELOCITY_CAP: '0',
      HERMES_LOOP_THRESHOLD: '0',
    }, async () => {
      // Seed 6 prior days at $4 each → total $24 in 7-day sliding window.
      // Today: $0 spent → daily cap fine; weekly cap should fire.
      const entries = [];
      for (let d = 1; d <= 6; d += 1) {
        entries.push({
          date: dateMinus(d),
          entry: {
            ts: isoMinus(d), trigger: 'cron', tier: 'T2',
            event: 'execute_completed', outcome: 'success', cost_usd: 4,
          },
        });
      }
      seedJournal(entries);

      const result = await execute.runExecute({
        planFile, repoRoot, engine: 'mock', skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BUDGET_WEEKLY_CAP_REACHED');
      assert.ok(result.spent >= 20, `expected weekly spend >= 20, got ${result.spent}`);
    });
  });
});

describe('Sprint 1.9.1 integration: monthly cap', () => {
  test('seeded $20 spread over month → monthly cap $15 trips', async () => {
    const repoRoot = tmpRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-data-'));
    const planFile = writePlan(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_DAILY_USD_CAP: '0',
      HERMES_WEEKLY_USD_CAP: '0',
      HERMES_MONTHLY_USD_CAP: '15',
      HERMES_TOKEN_VELOCITY_CAP: '0',
      HERMES_LOOP_THRESHOLD: '0',
    }, async () => {
      // Multiple dates this month accumulating > $15.
      // Use yesterday's date (always same calendar month except midnight edge).
      const today = new Date();
      const isFirstOfMonth = today.getUTCDate() === 1;
      // If we're on day 1, seed today only; otherwise seed yesterday + today.
      const entries = [];
      if (!isFirstOfMonth) {
        entries.push({
          date: dateMinus(1),
          entry: {
            ts: isoMinus(1), trigger: 'cron', tier: 'T2',
            event: 'execute_completed', outcome: 'success', cost_usd: 10,
          },
        });
      }
      entries.push({
        date: dateMinus(0),
        entry: {
          ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
          event: 'execute_completed', outcome: 'success', cost_usd: 10,
        },
      });
      seedJournal(entries);

      const result = await execute.runExecute({
        planFile, repoRoot, engine: 'mock', skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BUDGET_MONTHLY_CAP_REACHED');
    });
  });
});

describe('Sprint 1.9.1 integration: token velocity', () => {
  test('seeded 60K tokens in last minute → velocity cap 50K trips', async () => {
    const repoRoot = tmpRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-data-'));
    const planFile = writePlan(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_DAILY_USD_CAP: '0',
      HERMES_WEEKLY_USD_CAP: '0',
      HERMES_MONTHLY_USD_CAP: '0',
      HERMES_TOKEN_VELOCITY_CAP: '50000',
      HERMES_LOOP_THRESHOLD: '0',
    }, async () => {
      const now = new Date().toISOString();
      seedJournal([{
        date: dateMinus(0),
        entry: {
          ts: now, trigger: 'cron', tier: 'T2', event: 'execute_completed',
          outcome: 'success', tokens_in: 40000, tokens_out: 20000,
        },
      }]);

      const result = await execute.runExecute({
        planFile, repoRoot, engine: 'mock', skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'TOKEN_VELOCITY_CAP_REACHED');
      assert.ok(result.total >= 50000);
    });
  });
});

describe('Sprint 1.9.1 integration: loop detector writes HERMES_HALT', () => {
  test('5 SPEC_VIOLATION same criterion same action_key → halt + journal', async () => {
    const repoRoot = tmpRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-data-'));
    const planFile = writePlan(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_DAILY_USD_CAP: '0',
      HERMES_WEEKLY_USD_CAP: '0',
      HERMES_MONTHLY_USD_CAP: '0',
      HERMES_TOKEN_VELOCITY_CAP: '0',
      HERMES_LOOP_THRESHOLD: '5',
      HERMES_LOOP_WINDOW_DAYS: '7',
    }, async () => {
      const entries = [];
      for (let d = 0; d < 5; d += 1) {
        entries.push({
          date: dateMinus(d),
          entry: {
            ts: isoMinus(d), trigger: 'cron', tier: 'T2',
            event: 'execute_spec_failed', outcome: 'failure',
            action_key: `${SLUG}#1`,
            spec_failures: [{ id: 'no_destructive_rewrite' }],
          },
        });
      }
      seedJournal(entries);

      const result = await execute.runExecute({
        planFile, repoRoot, engine: 'mock', skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'LOOP_DETECTED');
      assert.equal(result.criterionId, 'no_destructive_rewrite');
      assert.equal(result.actionKey, `${SLUG}#1`);

      // HERMES_HALT sentinel should exist
      const haltPath = path.join(repoRoot, '.cortex', 'HERMES_HALT');
      assert.ok(fs.existsSync(haltPath), `HERMES_HALT must be written at ${haltPath}`);
      const haltContent = fs.readFileSync(haltPath, 'utf8');
      assert.match(haltContent, /LOOP_DETECTED:no_destructive_rewrite/);
    });
  });
});

describe('Sprint 1.9.1 integration: existing daily cap regression', () => {
  test('daily cap still trips with new gates added (regression)', async () => {
    const repoRoot = tmpRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-int-data-'));
    const planFile = writePlan(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_DAILY_USD_CAP: '1',
      HERMES_WEEKLY_USD_CAP: '0',
      HERMES_MONTHLY_USD_CAP: '0',
      HERMES_TOKEN_VELOCITY_CAP: '0',
      HERMES_LOOP_THRESHOLD: '0',
    }, async () => {
      seedJournal([{
        date: dateMinus(0),
        entry: {
          ts: new Date().toISOString(), trigger: 'cron', tier: 'T2',
          event: 'execute_completed', outcome: 'success', cost_usd: 1.5,
        },
      }]);

      const result = await execute.runExecute({
        planFile, repoRoot, engine: 'mock', skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BUDGET_CAP_REACHED');
    });
  });
});
