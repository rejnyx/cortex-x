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
    // pr_review_responder is the last parked kind (v0.9). All v0.8 kinds
    // shipped: recommendation, recommendation_harvest, dep_update_patch,
    // todo_triage, flaky_test_repair, doc_drift, lint_fix_shipper, test_coverage_gap.
    const f = tmpPlanFile(buildPlan({ action_kind: 'pr_review_responder' }));
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

// ── Sprint 1.8.2c — recommendation_harvest executor branch ─────────────────

describe('execute: Sprint 1.8.2c — recommendation_harvest', () => {
  function tmpRepoWithRecs(prefix, recsBody) {
    const repo = tmpProjectRepo(prefix);
    fs.mkdirSync(path.join(repo, 'cortex'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'cortex', 'recommendations.md'), recsBody);
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['commit', '-m', 'add recs'], { cwd: repo });
    return repo;
  }

  function buildHarvestPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'recommendation_harvest',
      action: {
        num: null,
        title: 'Harvest 2 recommendations from gh signals',
        body: 'Read-only harvest',
        action_key: `${SLUG}#harvest-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-recommendation-harvest-test',
      action_id: '01HARVEST',
      trigger: 'manual',
      commit_message: 'feat(hermes-dryrun): harvest recommendations\n\nbody\n\nHermes-Action-Id: 01HARVEST\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: harvester\nHermes-Action-Kind: recommendation_harvest',
      ...overrides,
    };
  }

  const MOCK_HARVEST_SIGNALS = {
    failures: [
      { name: 'test', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/1', databaseId: 1, headSha: 'a', createdAt: 't' },
      { name: 'test', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/2', databaseId: 2, headSha: 'b', createdAt: 't' },
    ],
    prs: [
      { number: 99, title: 'tech-debt fix', mergedAt: '2026-05-01', url: 'https://github.com/x/y/pull/99', labels: [{ name: 'tech-debt' }] },
    ],
    issues: [],
  };

  test('appendCandidatesToRecsBody inserts under existing DO this week (cited) section', () => {
    const body = '---\nslug: x\n---\n\n## DO this week (cited)\n- [ ] existing item [src: foo]\n\n## DO next week\n- [ ] later\n';
    const out = execute.appendCandidatesToRecsBody(body, '- [ ] new item [src: bar]');
    assert.match(out, /^- \[ \] existing item \[src: foo\]$/m);
    assert.match(out, /^- \[ \] new item \[src: bar\]$/m);
    // New line must appear BEFORE the next ## heading
    const newIdx = out.indexOf('new item');
    const nextSection = out.indexOf('## DO next week');
    assert.ok(newIdx < nextSection, 'new item must precede next section heading');
  });

  test('appendCandidatesToRecsBody creates new section if missing', () => {
    const body = '---\nslug: x\n---\n\n# Recs\n\nNo DO section here.\n';
    const out = execute.appendCandidatesToRecsBody(body, '- [ ] fresh item');
    assert.match(out, /## DO this week \(cited\)/);
    assert.match(out, /- \[ \] fresh item/);
  });

  test('runHarvestAction skips when recommendations.md missing', async () => {
    const repo = tmpProjectRepo('harvest-no-recs');
    const result = await execute.runHarvestAction(buildHarvestPlan(), { repoRoot: repo, harvestSignals: MOCK_HARVEST_SIGNALS });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'HARVEST_RECS_MISSING');
  });

  test('runHarvestAction returns HARVEST_NO_CANDIDATES when signals are all deduped', async () => {
    const recs = '---\nslug: hermes-dryrun\n---\n\n## DO this week (cited)\n- [ ] Investigate recurring test workflow failures\n- [ ] Follow-up on PR #99 [src: https://github.com/x/y/pull/99]\n';
    const repo = tmpRepoWithRecs('harvest-deduped', recs);
    const result = await execute.runHarvestAction(buildHarvestPlan(), { repoRoot: repo, harvestSignals: MOCK_HARVEST_SIGNALS });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'HARVEST_NO_CANDIDATES');
    assert.equal(result.touchedFiles.length, 0);
  });

  test('runHarvestAction appends candidates and reports touched recommendations.md', async () => {
    const recs = '---\nslug: hermes-dryrun\n---\n\n## DO this week (cited)\n- [ ] some unrelated existing item [src: https://example.com/x]\n';
    const repo = tmpRepoWithRecs('harvest-append', recs);
    const result = await execute.runHarvestAction(buildHarvestPlan(), { repoRoot: repo, harvestSignals: MOCK_HARVEST_SIGNALS });
    assert.equal(result.ok, true);
    assert.equal(result.touchedFiles.length, 1);
    assert.equal(result.touchedFiles[0], 'cortex/recommendations.md');
    assert.equal(result.usage.cost_usd, 0); // free path
    assert.ok(result.harvested_count >= 1);
    // Verify the file was actually modified
    const written = fs.readFileSync(path.join(repo, 'cortex', 'recommendations.md'), 'utf8');
    assert.match(written, /Investigate recurring test workflow failures/);
  });

  test('full pipeline: harvest plan → execute → atomic commit on cortex/recommendations.md', async () => {
    const recs = '---\nslug: hermes-dryrun\n---\n\n## DO this week (cited)\n- [ ] existing only [src: https://example.com/x]\n';
    const repo = tmpRepoWithRecs('harvest-full', recs);
    const planFile = tmpPlanFile(buildHarvestPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-data-')),
      HERMES_NO_PUSH: '1', // skip remote ops
    }, async () => {
      const result = await execute.runExecute({
        planFile,
        repoRoot: repo,
        skipPush: true,
        harvestSignals: MOCK_HARVEST_SIGNALS,
      });
      assert.equal(result.ok, true, `expected ok, got: ${JSON.stringify(result)}`);
      assert.match(result.commit_sha || '', /^[0-9a-f]{40}$/);
      // Verify the commit lives on the harvest branch and recommendations.md was modified
      const log = spawnSync('git', ['log', '--oneline', '-2'], { cwd: repo, encoding: 'utf8' });
      assert.match(log.stdout, /harvest|Harvest/);
      const updated = fs.readFileSync(path.join(repo, 'cortex', 'recommendations.md'), 'utf8');
      assert.match(updated, /existing only/, 'original line preserved');
      assert.match(updated, /test workflow/, 'harvested candidate appended');
    });
  });
});

// ── Sprint 1.8.4 — dep_update_patch executor branch ────────────────────────

describe('execute: Sprint 1.8.4 — dep_update_patch', () => {
  function buildDepPatchPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'dep_update_patch',
      action: {
        num: null,
        title: 'Update 2 patch dependencies',
        body: 'Patch-level npm dependency updates',
        action_key: `${SLUG}#dep-update-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-dep-update-patch-test',
      action_id: '01DEPATCH',
      trigger: 'manual',
      commit_message: 'chore(deps): patch updates\n\nbody\n\nHermes-Action-Id: 01DEPATCH\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: dep-update-patch\nHermes-Action-Kind: dep_update_patch',
      ...overrides,
    };
  }

  const MOCK_OUTDATED_JSON = JSON.stringify({
    'lodash': { current: '4.17.20', wanted: '4.17.21', latest: '4.17.21' },
    'chalk': { current: '5.0.0', wanted: '5.0.1', latest: '5.5.0' },
  });

  test('runDepUpdateAction returns DEP_UPDATE_NO_CANDIDATES when no patch updates', async () => {
    const repo = tmpProjectRepo('dep-no-cands');
    const result = await execute.runDepUpdateAction(buildDepPatchPlan(), {
      repoRoot: repo,
      mockOutdatedJson: '{}',
      skipNpmInstall: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DEP_UPDATE_NO_CANDIDATES');
  });

  test('runDepUpdateAction returns ok with package.json touched on candidates', async () => {
    const repo = tmpProjectRepo('dep-happy');
    const result = await execute.runDepUpdateAction(buildDepPatchPlan(), {
      repoRoot: repo,
      mockOutdatedJson: MOCK_OUTDATED_JSON,
      skipNpmInstall: true, // tests don't actually install — would fail offline
    });
    assert.equal(result.ok, true);
    assert.ok(result.touchedFiles.includes('package.json'));
    assert.equal(result.usage.cost_usd, 0); // free path
    assert.equal(result.updated_count, 2);
    assert.equal(result.candidates.length, 2);
  });

  test('runDepUpdateAction respects maxCandidates cap', async () => {
    const many = {};
    for (let i = 0; i < 8; i += 1) {
      many[`pkg-${i}`] = { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' };
    }
    const repo = tmpProjectRepo('dep-cap');
    const result = await execute.runDepUpdateAction(buildDepPatchPlan(), {
      repoRoot: repo,
      mockOutdatedJson: JSON.stringify(many),
      skipNpmInstall: true,
      maxCandidates: 3,
    });
    assert.equal(result.ok, true);
    assert.equal(result.updated_count, 3);
  });
});

// ── Sprint 1.8.7 — todo_triage executor branch ─────────────────────────────

describe('execute: Sprint 1.8.7 — todo_triage', () => {
  function buildTodoPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'todo_triage',
      action: {
        num: null,
        title: 'Triage 3 stale TODO markers',
        body: 'TODO triage',
        action_key: `${SLUG}#todo-triage-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-todo-triage-test',
      action_id: '01TODOX',
      trigger: 'manual',
      commit_message: 'chore(todo): triage stale markers\n\nbody\n\nHermes-Action-Id: 01TODOX\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: todo-triage\nHermes-Action-Kind: todo_triage',
      ...overrides,
    };
  }

  const MOCK_FILES = [
    { path: 'src/x.js', content: '// TODO: implement caching layer for users' },
    { path: 'src/y.js', content: '// FIXME: handle edge case in auth flow' },
  ];

  test('runTodoTriageAction returns TODO_TRIAGE_NO_CANDIDATES on empty scan', async () => {
    const repo = tmpProjectRepo('todo-empty');
    const result = await execute.runTodoTriageAction(buildTodoPlan(), {
      repoRoot: repo,
      mockFiles: [],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'TODO_TRIAGE_NO_CANDIDATES');
  });

  test('runTodoTriageAction returns ok with skip_commit + opened_issues', async () => {
    const repo = tmpProjectRepo('todo-happy');
    const result = await execute.runTodoTriageAction(buildTodoPlan(), {
      repoRoot: repo,
      mockFiles: MOCK_FILES,
      mockOpenIssues: [],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, true);
    assert.deepEqual(result.touchedFiles, []);
    assert.equal(result.usage.cost_usd, 0);
    assert.equal(result.opened_issues.length, 2);
    assert.ok(result.opened_issues.every((i) => i.dry_run === true));
  });

  test('full pipeline: todo_triage plan → execute → no commit, gh issues opened', async () => {
    const repo = tmpProjectRepo('todo-full');
    const planFile = tmpPlanFile(buildTodoPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'todo-data-')),
      HERMES_NO_PUSH: '1',
    }, async () => {
      const result = await execute.runExecute({
        planFile,
        repoRoot: repo,
        skipPush: true,
        mockFiles: MOCK_FILES,
        mockOpenIssues: [],
        skipBlame: true,
        skipGh: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.action_kind, 'todo_triage');
      assert.equal(result.skip_commit, true);
      assert.equal(result.triaged_count, 2);
      // No commit means no commit_sha; verify there's no fresh commit on the branch
      // (should still be on the original branch's HEAD)
      const log = spawnSync('git', ['log', '--oneline', '-2'], { cwd: repo, encoding: 'utf8' });
      // Initial commit only — Hermes did NOT commit anything
      assert.ok(!/todo-triage|Triage/.test(log.stdout), 'no Hermes commit should be present');
    });
  });
});

// ── Sprint 1.8.5 — flaky_test_repair executor branch ───────────────────────

describe('execute: Sprint 1.8.5 — flaky_test_repair', () => {
  function buildFlakyPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'flaky_test_repair',
      action: {
        num: null,
        title: 'Quarantine 2 flaky tests',
        body: 'Marker-based quarantine',
        action_key: `${SLUG}#flaky-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-flaky-test-repair-test',
      action_id: '01FLAKYX',
      trigger: 'manual',
      commit_message: 'chore(test): quarantine flaky tests\n\nbody\n\nHermes-Action-Id: 01FLAKYX\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: flaky-test-repair\nHermes-Action-Kind: flaky_test_repair',
      ...overrides,
    };
  }

  function tmpRepoWithFlakyMarkers(prefix, files) {
    const repo = tmpProjectRepo(prefix);
    for (const f of files) {
      const fullPath = path.join(repo, f.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content);
    }
    spawnSync('git', ['add', '.'], { cwd: repo });
    spawnSync('git', ['commit', '-m', 'add flaky tests'], { cwd: repo });
    return repo;
  }

  test('runFlakyRepairAction returns FLAKY_REPAIR_NO_CANDIDATES when no markers', async () => {
    const repo = tmpProjectRepo('flaky-empty');
    const result = await execute.runFlakyRepairAction(buildFlakyPlan(), {
      repoRoot: repo,
      mockFiles: [{ path: 'a.test.js', content: 'test("x", () => {});' }],
      skipGh: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'FLAKY_REPAIR_NO_CANDIDATES');
  });

  test('runFlakyRepairAction quarantines marker-tagged tests via real fs writes', async () => {
    const flakyContent = `// HERMES-FLAKY: race condition\ntest('user logs in', () => {});\n`;
    const repo = tmpRepoWithFlakyMarkers('flaky-quarantine', [
      { path: 'tests/auth.test.js', content: flakyContent },
    ]);
    const result = await execute.runFlakyRepairAction(buildFlakyPlan(), {
      repoRoot: repo,
      skipGh: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.quarantined_count, 1);
    assert.equal(result.touchedFiles.length, 1);
    // path.relative emits OS-native separators (Windows = \, Unix = /)
    // — normalize for cross-platform assertion
    const normalized = result.touchedFiles[0].replace(/\\/g, '/');
    assert.equal(normalized, 'tests/auth.test.js');
    // Verify edits applied
    const updated = fs.readFileSync(path.join(repo, 'tests/auth.test.js'), 'utf8');
    assert.match(updated, /test\.skip\('user logs in'/);
    assert.doesNotMatch(updated, /HERMES-FLAKY/);
  });

  test('full pipeline: flaky plan → execute → atomic commit on test files', async () => {
    const flakyContent = `// HERMES-FLAKY: timeout\nit('returns 200', () => {});\n`;
    const repo = tmpRepoWithFlakyMarkers('flaky-full', [
      { path: 'tests/api.test.js', content: flakyContent },
    ]);
    const planFile = tmpPlanFile(buildFlakyPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-data-')),
      HERMES_NO_PUSH: '1',
    }, async () => {
      const result = await execute.runExecute({
        planFile,
        repoRoot: repo,
        skipPush: true,
        skipGh: true,
      });
      assert.equal(result.ok, true, `expected ok, got: ${JSON.stringify(result)}`);
      assert.match(result.commit_sha || '', /^[0-9a-f]{40}$/);
      // Verify file modified + committed
      const updated = fs.readFileSync(path.join(repo, 'tests/api.test.js'), 'utf8');
      assert.match(updated, /it\.skip\('returns 200'/);
    });
  });
});

// ── Sprint 1.8.6 — doc_drift executor branch ───────────────────────────────

describe('execute: Sprint 1.8.6 — doc_drift', () => {
  function buildDocDriftPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'doc_drift',
      action: {
        num: null,
        title: 'Triage 2 doc-drifted exports',
        body: 'Doc drift detection',
        action_key: `${SLUG}#doc-drift-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-doc-drift-test',
      action_id: '01DOCDRX',
      trigger: 'manual',
      commit_message: 'chore(docs): triage doc drift\n\nbody\n\nHermes-Action-Id: 01DOCDRX\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: doc-drift\nHermes-Action-Kind: doc_drift',
      ...overrides,
    };
  }

  test('runDocDriftAction returns DOC_DRIFT_NO_CANDIDATES when all documented', async () => {
    const repo = tmpProjectRepo('docdrift-empty');
    const result = await execute.runDocDriftAction(buildDocDriftPlan(), {
      repoRoot: repo,
      mockFiles: [{ path: 'src/x.js', content: 'export function foo() {}' }],
      mockDocsCorpus: 'foo is documented',
      skipGh: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DOC_DRIFT_NO_CANDIDATES');
  });

  test('runDocDriftAction returns ok with skip_commit + opened_issues for drift', async () => {
    const repo = tmpProjectRepo('docdrift-happy');
    const result = await execute.runDocDriftAction(buildDocDriftPlan(), {
      repoRoot: repo,
      mockFiles: [
        { path: 'src/a.js', content: 'export function newAPI() {}' },
        { path: 'src/b.js', content: 'export class HiddenClass {}' },
      ],
      mockDocsCorpus: '', // nothing documented
      skipGh: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, true);
    assert.deepEqual(result.touchedFiles, []);
    assert.equal(result.opened_issues.length, 2);
    assert.equal(result.drifted_count, 2);
  });

  test('full pipeline: doc_drift plan → execute → no commit, gh issues opened', async () => {
    const repo = tmpProjectRepo('docdrift-full');
    const planFile = tmpPlanFile(buildDocDriftPlan());

    await withEnv({
      CORTEX_DATA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'docdrift-data-')),
      HERMES_NO_PUSH: '1',
    }, async () => {
      const result = await execute.runExecute({
        planFile,
        repoRoot: repo,
        skipPush: true,
        mockFiles: [{ path: 'src/x.js', content: 'export function undocumented() {}' }],
        mockDocsCorpus: '',
        skipGh: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.action_kind, 'doc_drift');
      assert.equal(result.skip_commit, true);
      assert.equal(result.triaged_count !== undefined || result.opened_issues !== undefined, true);
    });
  });
});

// ── Sprint 1.8.9 — lint_fix_shipper executor branch ────────────────────────

describe('execute: Sprint 1.8.9 — lint_fix_shipper', () => {
  function buildLintFixPlan(overrides = {}) {
    return {
      ok: true,
      mode: 'dry-run',
      slug: SLUG,
      action_kind: 'lint_fix_shipper',
      action: {
        num: null,
        title: 'Auto-fix lint issues',
        body: 'eslint --fix + tsc --noEmit',
        action_key: `${SLUG}#lint-fix-2026-05-07`,
      },
      branch: 'hermes/2026-05-07-lint-fix-test',
      action_id: '01LINTX',
      trigger: 'manual',
      commit_message: 'chore(lint): auto-fix style violations\n\nbody\n\nHermes-Action-Id: 01LINTX\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: lint-fix\nHermes-Action-Kind: lint_fix_shipper',
      ...overrides,
    };
  }

  test('runLintFixAction returns LINT_FIX_NO_WORK when nothing to fix', async () => {
    const repo = tmpProjectRepo('lint-noop');
    const result = await execute.runLintFixAction(buildLintFixPlan(), {
      repoRoot: repo,
      mockEslint: { ran: true, eslint_available: true, modified_files: [] },
      mockTsc: { ran: true, tsc_available: true, type_errors: [] },
      skipGh: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'LINT_FIX_NO_WORK');
  });

  test('runLintFixAction returns ok with touchedFiles when eslint produced edits', async () => {
    const repo = tmpProjectRepo('lint-edits');
    const result = await execute.runLintFixAction(buildLintFixPlan(), {
      repoRoot: repo,
      mockEslint: {
        ran: true,
        eslint_available: true,
        modified_files: ['src/a.js', 'src/b.js'],
      },
      mockTsc: { ran: true, tsc_available: true, type_errors: [] },
      skipGh: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, false); // has edits → commit needed
    assert.deepEqual(result.touchedFiles, ['src/a.js', 'src/b.js']);
    assert.equal(result.fixed_count, 2);
  });

  test('runLintFixAction returns ok + skip_commit when only type errors (no eslint edits)', async () => {
    const repo = tmpProjectRepo('lint-tsc-only');
    const result = await execute.runLintFixAction(buildLintFixPlan(), {
      repoRoot: repo,
      mockEslint: { ran: true, eslint_available: true, modified_files: [] },
      mockTsc: {
        ran: true,
        tsc_available: true,
        type_errors: [{ file: 'src/x.ts', line: 1, column: 1, code: 'TS2322', msg: 'oops' }],
      },
      skipGh: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, true); // no edits → no commit
    assert.deepEqual(result.touchedFiles, []);
    assert.equal(result.type_errors_count, 1);
  });

  test('runLintFixAction handles mixed: eslint edits + tsc errors', async () => {
    const repo = tmpProjectRepo('lint-mixed');
    const result = await execute.runLintFixAction(buildLintFixPlan(), {
      repoRoot: repo,
      mockEslint: {
        ran: true,
        eslint_available: true,
        modified_files: ['src/auto.js'],
      },
      mockTsc: {
        ran: true,
        tsc_available: true,
        type_errors: [{ file: 'src/y.ts', line: 1, column: 1, code: 'TS1', msg: 'x' }],
      },
      dryRunGh: true, // mock issue creation
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, false); // commit needed for the edits
    assert.equal(result.fixed_count, 1);
    assert.equal(result.type_errors_count, 1);
    assert.equal(result.opened_issues.length, 1);
    assert.ok(result.opened_issues[0].dry_run);
  });
});
