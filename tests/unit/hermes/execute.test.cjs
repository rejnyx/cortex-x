'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const execute = require('../../../bin/hermes/execute.cjs');
const journal = require('../../../bin/hermes/_lib/journal.cjs');

const CLI = path.resolve(__dirname, '..', '..', '..', 'bin', 'hermes', 'execute.cjs');
const SLUG = 'hermes-dryrun';

// --- helpers ---------------------------------------------------------------

function tmpProjectRepo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `exec-${prefix}-`));
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });

  // Minimal package.json with a passing test
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'fixture',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'README.md'), '# initial\n');

  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: repo });
  return repo;
}

function tmpPlanFile(plan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const f = path.join(tmp, 'plan.json');
  fs.writeFileSync(f, JSON.stringify(plan), 'utf8');
  return f;
}

function buildPlan(overrides = {}) {
  return {
    ok: true,
    mode: 'dry-run',
    slug: SLUG,
    action: { num: 1, title: 'demo action', action_key: `${SLUG}#week-1` },
    branch: 'hermes/2026-05-07-demo-abc1',
    action_id: '01TEST',
    trigger: 'manual',
    commit_message: 'feat(fixture): demo action\n\nDemo body\n\nHermes-Action-Id: 01TEST\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: cortex/recommendations.md#1\nCo-Authored-By: Hermes <hermes@cortex-x.local>',
    ...overrides,
  };
}

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// --- tests -----------------------------------------------------------------

describe('execute: plan validation', () => {
  test('missing --plan-file returns MISSING_PLAN_FILE', async () => {
    const result = await execute.runExecute({});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_PLAN_FILE');
  });

  test('non-existent plan file returns PLAN_FILE_NOT_FOUND', async () => {
    const result = await execute.runExecute({ planFile: '/does/not/exist.json' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_FILE_NOT_FOUND');
  });

  test('malformed JSON returns PLAN_PARSE_ERROR', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-plan-'));
    const f = path.join(tmp, 'bad.json');
    fs.writeFileSync(f, '{ not valid json', 'utf8');
    const result = await execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_PARSE_ERROR');
  });

  test('plan missing commit_message returns PLAN_INCOMPLETE', async () => {
    const f = tmpPlanFile(buildPlan({ commit_message: undefined }));
    const result = await execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_INCOMPLETE');
  });

  // Sprint 1.8.1 — typed action_kind validation
  test('Sprint 1.8.1 — plan missing action_kind defaults to recommendation (backwards-compat)', async () => {
    // Simulate pre-1.8.1 plan (no action_kind field). Should still validate
    // and proceed past loadPlan — fails later in the pipeline due to no
    // mock engine setup, but NOT at plan validation.
    const f = tmpPlanFile(buildPlan());
    const result = await execute.runExecute({ planFile: f });
    // Whatever happens next, it must NOT be PLAN_UNKNOWN_ACTION_KIND or
    // PLAN_ACTION_KIND_NOT_SHIPPED — those are the new 1.8.1 codes.
    assert.notEqual(result.code, 'PLAN_UNKNOWN_ACTION_KIND');
    assert.notEqual(result.code, 'PLAN_ACTION_KIND_NOT_SHIPPED');
  });

  test('Sprint 1.8.1 — plan with unknown action_kind returns PLAN_UNKNOWN_ACTION_KIND', async () => {
    const f = tmpPlanFile(buildPlan({ action_kind: 'totally_made_up_kind' }));
    const result = await execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_UNKNOWN_ACTION_KIND');
    assert.match(result.error, /not registered/);
    assert.match(result.error, /Supported:/);
  });

  test('Sprint 1.8.1 — plan with declared-but-not-shipped kind returns PLAN_ACTION_KIND_NOT_SHIPPED', async () => {
    // recommendation_harvest is declared in registry (Sprint 1.8.2 roadmap)
    // but shipped_in is null until that sprint lands. Executor must reject.
    const f = tmpPlanFile(buildPlan({ action_kind: 'recommendation_harvest' }));
    const result = await execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_ACTION_KIND_NOT_SHIPPED');
    assert.match(result.error, /declared but not yet shipped/);
  });

  test('Sprint 1.8.1 — plan with explicit action_kind: recommendation works (no rejection)', async () => {
    const f = tmpPlanFile(buildPlan({ action_kind: 'recommendation' }));
    const result = await execute.runExecute({ planFile: f });
    // Same as backwards-compat path — must not be rejected by 1.8.1 validators.
    assert.notEqual(result.code, 'PLAN_UNKNOWN_ACTION_KIND');
    assert.notEqual(result.code, 'PLAN_ACTION_KIND_NOT_SHIPPED');
  });
});

describe('execute: halt detection', () => {
  test('HERMES_HALT sentinel halts before plan validation', async () => {
    const repoRoot = tmpProjectRepo('halt');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'HERMES_HALT'), 'halt\n');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({ CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'halt-data-')) }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.halted, true);
      assert.equal(result.exitCode, 75);
    });
  });
});

describe('execute: default engine (openrouter, post-Sprint-1.6.13)', () => {
  test('without OPENROUTER_API_KEY returns OPENROUTER_KEY_MISSING + rolls back', async () => {
    const repoRoot = tmpProjectRepo('openrouter-default');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'or-data-')),
      HERMES_ENGINE: undefined,
      OPENROUTER_API_KEY: undefined,
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_KEY_MISSING');
      assert.equal(result.engine, 'openrouter');
    });
  });

  test('claude-sdk engine still reachable via explicit flag', async () => {
    const repoRoot = tmpProjectRepo('claude-sdk-explicit');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-data-')),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'claude-sdk' });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'CLAUDE_SDK_NOT_IMPLEMENTED');
    });
  });
});

describe('execute: mock engine — happy path', () => {
  test('mock engine applies edit + commits + journals success', async () => {
    const repoRoot = tmpProjectRepo('happy');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'happy-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({
        edits: [{ path: 'src/added.js', content: 'module.exports = "hermes";' }],
      }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });

      assert.equal(result.ok, true, `unexpected failure: ${JSON.stringify(result)}`);
      assert.equal(result.engine, 'mock');
      assert.match(result.commit_sha, /^[0-9a-f]{40}$/);
      assert.deepEqual(result.touched_files, ['src/added.js']);
      assert.match(result.verifier, /pass|exit 0/);

      // The edit was committed
      assert.equal(
        fs.readFileSync(path.join(repoRoot, 'src/added.js'), 'utf8'),
        'module.exports = "hermes";',
      );

      // Journal entry recorded success
      const entries = journal.readJournal(SLUG);
      const success = entries.find((e) => e.event === 'action_completed');
      assert.ok(success);
      assert.equal(success.outcome, 'success');
      assert.equal(success.action_key, `${SLUG}#week-1`);
    });
  });
});

describe('execute: Sprint 1.6.20 — detached HEAD pre-flight (H5)', () => {
  test('detached HEAD → DETACHED_HEAD before lock acquire', async () => {
    const repoRoot = tmpProjectRepo('detached');
    // Detach HEAD by checking out the commit SHA directly
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['checkout', sha], { cwd: repoRoot });

    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'detached-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'DETACHED_HEAD');
      // Journal recorded the refusal
      const entries = journal.readJournal(SLUG);
      const det = entries.find((e) => e.event === 'execute_detached_head');
      assert.ok(det);
    });
  });
});

describe('execute: Sprint 1.6.19 — pre-flight budget cap + circuit breaker', () => {
  test('HERMES_DAILY_USD_CAP enforced: blocks when today\'s journal cost_usd >= cap', async () => {
    const repoRoot = tmpProjectRepo('budget-cap');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-data-'));
    const planFile = tmpPlanFile(buildPlan());

    // Seed journal with $4 spent today (cap will be set to $5 → next $1+ run blocks)
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      journal.appendJournal(SLUG, {
        ts: new Date().toISOString(),
        trigger: 'manual',
        tier: 'T0',
        event: 'action_completed',
        outcome: 'success',
        actor: 'hermes',
        cost_usd: 4.0,
        tokens_in: 1000,
      });
    });

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
      HERMES_DAILY_USD_CAP: '5',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      // 4 + 0 = 4 < 5, so this should pass; let's seed more to actually trip it
      assert.equal(result.ok, true, 'with cap=$5 + spent=$4, run is permitted');
    });

    // Now seed another $1.5 → total $5.5 > cap $5 → next run blocks
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      journal.appendJournal(SLUG, {
        ts: new Date().toISOString(),
        trigger: 'manual',
        tier: 'T0',
        event: 'action_completed',
        outcome: 'success',
        actor: 'hermes',
        cost_usd: 1.5,
        tokens_in: 500,
      });
    });

    const planFile2 = tmpPlanFile(buildPlan({ action: { num: 2, title: 'demo 2', action_key: `${SLUG}#week-2` } }));
    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'b.js', content: 'b' }] }),
      HERMES_DAILY_USD_CAP: '5',
    }, async () => {
      const result = await execute.runExecute({ planFile: planFile2, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'BUDGET_CAP_REACHED');
      assert.ok(result.spent >= 5, `spent ${result.spent} should reflect today's totals`);

      // Journal recorded the refusal
      const entries = journal.readJournal(SLUG);
      const capped = entries.find((e) => e.event === 'execute_budget_capped');
      assert.ok(capped);
      assert.equal(capped.outcome, 'skipped');
    });
  });

  test('HERMES_DAILY_USD_CAP=0 disables the cap (opt-out)', async () => {
    const repoRoot = tmpProjectRepo('budget-disabled');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-off-data-'));
    const planFile = tmpPlanFile(buildPlan());

    // Seed journal with $1000 spent (would normally trip any sane cap)
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      journal.appendJournal(SLUG, {
        ts: new Date().toISOString(),
        trigger: 'manual',
        tier: 'T0',
        event: 'action_completed',
        outcome: 'success',
        actor: 'hermes',
        cost_usd: 1000,
        tokens_in: 1,
      });
    });

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'x.js', content: 'x' }] }),
      HERMES_DAILY_USD_CAP: '0',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, true, 'cap=0 must allow any spend');
    });
  });

  test('HERMES_FAILURE_BREAKER trips after N consecutive execute_*_failed for same action_key', async () => {
    const repoRoot = tmpProjectRepo('breaker');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-data-'));
    const planFile = tmpPlanFile(buildPlan({ action: { num: 9, title: 'demo 9', action_key: `${SLUG}#week-9` } }));

    // Seed 3 failures for same action_key in last 5 minutes
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      for (let i = 0; i < 3; i++) {
        journal.appendJournal(SLUG, {
          ts: new Date(Date.now() - i * 60_000).toISOString(),
          trigger: 'cron',
          tier: 'T2',
          event: 'execute_action_failed',
          outcome: 'failure',
          actor: 'hermes',
          action_key: `${SLUG}#week-9`,
        });
      }
    });

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'y.js', content: 'y' }] }),
      HERMES_FAILURE_BREAKER: '3',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'FAILURE_BREAKER_TRIPPED');
      assert.equal(result.recentFailures, 3);

      const entries = journal.readJournal(SLUG);
      const trip = entries.find((e) => e.event === 'execute_breaker_tripped');
      assert.ok(trip);
    });
  });

  test('failure breaker scoped to action_key: failures on different keys do not trip', async () => {
    const repoRoot = tmpProjectRepo('breaker-scope');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-scope-data-'));
    const planFile = tmpPlanFile(buildPlan({ action: { num: 7, title: 'demo 7', action_key: `${SLUG}#week-7` } }));

    // 5 failures on UNRELATED action_key
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      for (let i = 0; i < 5; i++) {
        journal.appendJournal(SLUG, {
          ts: new Date().toISOString(),
          trigger: 'cron',
          tier: 'T2',
          event: 'execute_verify_failed',
          outcome: 'failure',
          actor: 'hermes',
          action_key: `${SLUG}#week-99`, // different key
        });
      }
    });

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'z.js', content: 'z' }] }),
      HERMES_FAILURE_BREAKER: '3',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, true, 'breaker should not trip on different action_keys');
    });
  });

  test('failure breaker window expires after 1 hour', async () => {
    const repoRoot = tmpProjectRepo('breaker-window');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-window-data-'));
    const planFile = tmpPlanFile(buildPlan({ action: { num: 5, title: 'demo 5', action_key: `${SLUG}#week-5` } }));

    // 5 failures from 2 hours ago — outside the 1-hour window
    await withEnv({ CORTEX_DATA_HOME: dataHome }, async () => {
      for (let i = 0; i < 5; i++) {
        journal.appendJournal(SLUG, {
          ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          trigger: 'cron',
          tier: 'T2',
          event: 'execute_action_failed',
          outcome: 'failure',
          actor: 'hermes',
          action_key: `${SLUG}#week-5`,
        });
      }
    });

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'w.js', content: 'w' }] }),
      HERMES_FAILURE_BREAKER: '3',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, true, 'failures outside 1h window must not count');
    });
  });
});

describe('execute: Sprint 1.6.19 — push + draft PR (best-effort, degrades gracefully)', () => {
  test('no origin remote → result.pr.status === "no_remote", commit still lands', async () => {
    const repoRoot = tmpProjectRepo('no-remote');
    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'no-remote-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, true);
      assert.ok(result.pr, 'pr substruct present');
      assert.equal(result.pr.status, 'no_remote');
      // Commit still landed
      assert.match(result.commit_sha, /^[0-9a-f]{40}$/);
      // Journal entry includes pr_status
      const entries = journal.readJournal(SLUG);
      const success = entries.find((e) => e.event === 'action_completed');
      assert.equal(success.pr_status, 'no_remote');
    });
  });

  test('skipPush opts out → result.pr.status === "skipped", no remote check attempted', async () => {
    const repoRoot = tmpProjectRepo('skip-push');
    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'skip-push-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'b.js', content: 'b' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, skipPush: true });
      assert.equal(result.ok, true);
      assert.equal(result.pr.status, 'skipped');
      assert.match(result.pr.reason, /opt-out/);
    });
  });

  test('HERMES_NO_PUSH=1 env → result.pr.status === "skipped"', async () => {
    const repoRoot = tmpProjectRepo('env-no-push');
    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'env-no-push-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'c.js', content: 'c' }] }),
      HERMES_NO_PUSH: '1',
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.pr.status, 'skipped');
    });
  });

  test('with bare-repo origin: push succeeds, no gh CLI → result.pr.status === "no_gh_cli" (or "created" if gh on PATH)', async () => {
    // Set up a bare repo as origin so push has somewhere to land
    const repoRoot = tmpProjectRepo('with-remote');
    const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bare-'));
    spawnSync('git', ['init', '--bare'], { cwd: bareDir });
    spawnSync('git', ['remote', 'add', 'origin', bareDir], { cwd: repoRoot });

    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'remote-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'd.js', content: 'd' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, true);
      // pushed: true regardless of whether gh CLI is present in test env
      assert.equal(result.pr.pushed, true);
      // Status depends on test env: 'no_gh_cli' (CI without auth) or 'created' (local with auth)
      // or 'pr_failed' (gh present but no GH_TOKEN). All are valid post-push outcomes.
      assert.match(result.pr.status, /^(no_gh_cli|created|pr_failed)$/);
    });
  });
});

describe('execute: mock engine — error paths', () => {
  test('dirty working tree blocks execute', async () => {
    const repoRoot = tmpProjectRepo('dirty');
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# modified\n'); // dirty
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dirty-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'DIRTY_TREE');
    });
  });

  test('verify failure rolls back + journals failure', async () => {
    const repoRoot = tmpProjectRepo('verify-fail');
    // Make npm test fail
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    pkg.scripts.test = 'node -e "process.exit(1)"';
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify(pkg));
    spawnSync('git', ['add', '.'], { cwd: repoRoot });
    spawnSync('git', ['commit', '-m', 'fail-test'], { cwd: repoRoot });

    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'verify-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'VERIFY_FAILED');

      // The edit should have been rolled back (file should not exist)
      assert.equal(fs.existsSync(path.join(repoRoot, 'a.js')), false);

      // Journal recorded the failure
      const entries = journal.readJournal(SLUG);
      const fail = entries.find((e) => e.event === 'execute_verify_failed');
      assert.ok(fail);
      assert.equal(fail.outcome, 'failure');
    });
  });

  test('Sprint 1.6.15: verify_failed entry preserves cost_usd + tokens', async () => {
    const repoRoot = tmpProjectRepo('verify-fail-cost');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    pkg.scripts.test = 'node -e "process.exit(1)"';
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify(pkg));
    spawnSync('git', ['add', '.'], { cwd: repoRoot });
    spawnSync('git', ['commit', '-m', 'fail-test'], { cwd: repoRoot });

    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cost-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({
        edits: [{ path: 'a.js', content: 'a' }],
        usage: { cost_usd: 0.0042, tokens_in: 1500, tokens_out: 800 },
      }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.code, 'VERIFY_FAILED');
      const fail = journal.readJournal(SLUG).find((e) => e.event === 'execute_verify_failed');
      assert.ok(fail);
      assert.equal(fail.cost_usd, 0.0042);
      assert.equal(fail.tokens_in, 1500);
      assert.equal(fail.tokens_out, 800);
    });
  });

  test('Sprint 1.6.15: action_failed entry preserves cost_usd when engine reports it', async () => {
    const repoRoot = tmpProjectRepo('action-fail-cost');
    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'action-cost-data-')),
      HERMES_ENGINE: 'mock',
      // Edit fails (unsafe path) but engine reports cost — LLM call already happened
      HERMES_MOCK_PLAN: JSON.stringify({
        edits: [{ path: '../escaped.js', content: 'x' }],
        usage: { cost_usd: 0.0021, tokens_in: 600, tokens_out: 200 },
      }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      const fail = journal.readJournal(SLUG).find((e) => e.event === 'execute_action_failed');
      assert.ok(fail);
      assert.equal(fail.cost_usd, 0.0021);
      assert.equal(fail.tokens_in, 600);
      assert.equal(fail.tokens_out, 200);
    });
  });

  test('Sprint 1.6.18 (D6): addCostFields contract holds for all 4 journal entry shapes (incl. post_verify_failed)', () => {
    // Sprint 1.6.15 promised cost capture on 3 failure paths but post_verify_failed
    // had no test (action_failed + verify_failed only). Unit-testing the helper
    // covers the contract regardless of which call site invokes it.
    const apply = { cost_usd: 0.0042, tokens_in: 1500, tokens_out: 800 };
    for (const event of ['action_completed', 'execute_action_failed', 'execute_verify_failed', 'execute_post_verify_failed']) {
      const entry = { ts: 'x', trigger: 'manual', tier: 'T0', event, outcome: 'success', actor: 'hermes' };
      const decorated = execute.addCostFields(entry, apply);
      assert.equal(decorated.cost_usd, 0.0042, `${event} should capture cost_usd`);
      assert.equal(decorated.tokens_in, 1500, `${event} should capture tokens_in`);
      assert.equal(decorated.tokens_out, 800, `${event} should capture tokens_out`);
    }
    // Null applyResult — entry untouched
    const entry = { ts: 'x', trigger: 'manual', tier: 'T0', event: 'execute_post_verify_failed', outcome: 'failure', actor: 'hermes' };
    const decorated = execute.addCostFields(entry, null);
    assert.equal(decorated.cost_usd, undefined);
    assert.equal(decorated.tokens_in, undefined);
  });

  test('Sprint 1.6.15: verify_failed without usage envelope omits cost (no null contamination)', async () => {
    const repoRoot = tmpProjectRepo('verify-no-cost');
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    pkg.scripts.test = 'node -e "process.exit(1)"';
    fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify(pkg));
    spawnSync('git', ['add', '.'], { cwd: repoRoot });
    spawnSync('git', ['commit', '-m', 'fail-test'], { cwd: repoRoot });

    const planFile = tmpPlanFile(buildPlan());
    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'verify-nocost-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.code, 'VERIFY_FAILED');
      const fail = journal.readJournal(SLUG).find((e) => e.event === 'execute_verify_failed');
      assert.ok(fail);
      assert.equal(fail.cost_usd, undefined);
      assert.equal(fail.tokens_in, undefined);
    });
  });

  test('mock engine without HERMES_MOCK_PLAN env returns MOCK_NOT_SET + rolls back', async () => {
    const repoRoot = tmpProjectRepo('mock-not-set');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'mns-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: undefined,
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MOCK_NOT_SET');

      // Branch was rolled back to main
      const { spawnSync: ss } = require('node:child_process');
      const branch = ss('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
      assert.equal(branch.stdout.trim(), 'main');
    });
  });

  test('non-git directory returns NOT_GIT_REPO', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'not-git-'));
    fs.writeFileSync(path.join(repoRoot, 'package.json'), '{}');
    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'ng-data-')),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'NOT_GIT_REPO');
    });
  });
});

describe('execute: lock semantics', () => {
  test('lock collision returns LOCK_HELD without committing', async () => {
    const repoRoot = tmpProjectRepo('lock');
    const lockDir = path.join(repoRoot, 'cortex', 'journal', SLUG);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, '.lock'),
      JSON.stringify({ pid: 99999, start_ts: new Date().toISOString(), action_id: 'other' }),
    );

    const planFile = tmpPlanFile(buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lock-data-')),
      HERMES_ENGINE: 'mock',
      HERMES_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'a.js', content: 'a' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'LOCK_HELD');
      assert.equal(result.heldBy.action_id, 'other');
    });
  });
});

describe('execute: CLI', () => {
  test('CLI --help exits 0 with usage', async () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--plan-file/);
    assert.match(result.stdout, /--engine/);
  });

  test('CLI without --plan-file exits 1', async () => {
    const result = spawnSync(process.execPath, [CLI, '--json'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.code, 'MISSING_PLAN_FILE');
  });

  test('CLI with mock engine + valid plan exits 0', async () => {
    const repoRoot = tmpProjectRepo('cli-happy');
    const planFile = tmpPlanFile(buildPlan());
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-data-'));

    const result = spawnSync(process.execPath, [
      CLI, `--plan-file=${planFile}`, `--repo-root=${repoRoot}`,
      '--engine=mock', '--json',
    ], {
      env: {
        ...process.env,
        CORTEX_DATA_HOME: dataHome,
        HERMES_MOCK_PLAN: JSON.stringify({
          edits: [{ path: 'cli-output.js', content: 'module.exports = 1;' }],
        }),
      },
      encoding: 'utf8', timeout: 30000,
    });

    assert.equal(result.status, 0, `expected 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.match(parsed.commit_sha, /^[0-9a-f]{40}$/);
  });
});
