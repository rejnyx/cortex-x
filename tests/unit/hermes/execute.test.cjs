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
