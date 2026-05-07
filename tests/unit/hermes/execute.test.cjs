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
const FIXTURE_SRC = path.resolve(__dirname, '..', '..', 'fixtures', 'hermes-dryrun');
const SLUG = 'hermes-dryrun';

function freshFixture(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-exec-${prefix}-`));
  copyDir(FIXTURE_SRC, tmp);
  return tmp;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function tmpPlanFile(plan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-plan-'));
  const planFile = path.join(tmp, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan), 'utf8');
  return planFile;
}

function withDataHome(dataHome, fn) {
  const prev = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dataHome;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CORTEX_DATA_HOME;
    else process.env.CORTEX_DATA_HOME = prev;
  }
}

const VALID_PLAN = {
  ok: true,
  mode: 'dry-run',
  slug: SLUG,
  action: { num: 1, title: 'demo', action_key: `${SLUG}#week-1` },
  branch: 'hermes/2026-05-07-demo-abc1',
  action_id: '01TEST',
  trigger: 'manual',
};

describe('execute: plan validation', () => {
  test('missing --plan-file returns MISSING_PLAN_FILE', () => {
    const result = execute.runExecute({});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_PLAN_FILE');
  });

  test('non-existent plan file returns PLAN_FILE_NOT_FOUND', () => {
    const result = execute.runExecute({ planFile: '/does/not/exist.json' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_FILE_NOT_FOUND');
  });

  test('malformed JSON returns PLAN_PARSE_ERROR', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bad-plan-'));
    const f = path.join(tmp, 'bad.json');
    fs.writeFileSync(f, '{ not valid json', 'utf8');
    const result = execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_PARSE_ERROR');
  });

  test('non-dry-run plan returns PLAN_INVALID', () => {
    const f = tmpPlanFile({ ok: true, mode: 'production', slug: 'x' });
    const result = execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_INVALID');
  });

  test('plan missing required fields returns PLAN_INCOMPLETE', () => {
    const f = tmpPlanFile({ ok: true, mode: 'dry-run', slug: 'x' });
    const result = execute.runExecute({ planFile: f });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLAN_INCOMPLETE');
  });
});

describe('execute: v0.5 stub contract', () => {
  test('valid plan returns V05_NOT_IMPLEMENTED', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-data-'));
    const repoRoot = freshFixture('valid-plan');
    const planFile = tmpPlanFile(VALID_PLAN);

    withDataHome(dataHome, () => {
      const result = execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'V05_NOT_IMPLEMENTED');
      assert.match(result.error, /Claude Agent SDK/);
      assert.match(result.seam_documented_at, /hermes-runtime\.md/);
      assert.ok(Array.isArray(result.next_steps));
      assert.ok(result.next_steps.length >= 3);
      assert.equal(result.plan_validated.slug, SLUG);
      assert.equal(result.plan_validated.action_key, `${SLUG}#week-1`);
    });
  });

  test('valid plan journals execute_not_implemented entry', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-data-'));
    const repoRoot = freshFixture('journal');
    const planFile = tmpPlanFile(VALID_PLAN);

    withDataHome(dataHome, () => {
      execute.runExecute({ planFile, repoRoot });
      const entries = journal.readJournal(SLUG);
      const last = entries[entries.length - 1];
      assert.ok(last);
      assert.equal(last.event, 'execute_not_implemented');
      assert.equal(last.outcome, 'skipped');
      assert.equal(last.actor, 'hermes');
      assert.equal(last.action_key, `${SLUG}#week-1`);
    });
  });
});

describe('execute: halt detection', () => {
  test('HERMES_HALT sentinel halts before plan validation', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-data-'));
    const repoRoot = freshFixture('halt');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'HERMES_HALT'), 'halt\n');
    const planFile = tmpPlanFile(VALID_PLAN);

    withDataHome(dataHome, () => {
      const result = execute.runExecute({ planFile, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.halted, true);
      assert.equal(result.exitCode, 75);
    });
  });
});

describe('execute: CLI', () => {
  test('CLI without --plan-file exits 1 with error', () => {
    const result = spawnSync(process.execPath, [CLI, '--json'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.code, 'MISSING_PLAN_FILE');
  });

  test('CLI with valid plan exits 64 (EX_USAGE) for V05_NOT_IMPLEMENTED', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-data-'));
    const repoRoot = freshFixture('cli-valid');
    const planFile = tmpPlanFile(VALID_PLAN);

    const result = spawnSync(process.execPath, [
      CLI, `--plan-file=${planFile}`, `--repo-root=${repoRoot}`, '--json',
    ], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8', timeout: 5000,
    });

    assert.equal(result.status, 64);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.code, 'V05_NOT_IMPLEMENTED');
  });

  test('CLI --help exits 0 with usage', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /v0\.5/);
    assert.match(result.stdout, /--plan-file/);
  });
});
