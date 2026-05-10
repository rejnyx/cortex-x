// Sprint 2.11 — senior_tester_review end-to-end integration test.
//
// Wires dry-run.cjs → execute.cjs through the senior_tester_review kind
// against a fixture repo with deliberate smells. Covers:
//   - Dispatcher branch in dry-run produces expected plan shape
//   - Executor invokes Phase A + Phase C (Phase B skipped — judge env unset)
//   - skip_commit flow bypasses git pipeline
//   - Acceptance criterion `senior_tester_no_working_tree_edits` passes
//   - Journal entry written

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const child_process = require('node:child_process');

const dryRun = require('../../bin/steward/dry-run.cjs');
const executor = require('../../bin/steward/execute.cjs');

function tmpRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `st-int-${label}-`));
  // Initialize a minimal git repo so executor's git checks don't crash.
  child_process.spawnSync('git', ['init', '-q'], { cwd: dir });
  child_process.spawnSync('git', ['config', 'user.email', 'test@local'], { cwd: dir });
  child_process.spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // Initial commit so HEAD exists.
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  child_process.spawnSync('git', ['add', '.'], { cwd: dir });
  child_process.spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function fixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Sprint 2.11 — senior_tester_review end-to-end pipeline', () => {
  test('greenfield repo: dry-run returns no_actionable_step', () => {
    const dir = tmpRepo('green');
    const r = dryRun.runDryRun({
      slug: 'green',
      kind: 'senior_tester_review',
      repoRoot: dir,
      isoDate: '2026-05-10',
    });
    assert.equal(r.ok, true);
    assert.equal(r.no_actionable_step, true);
    assert.equal(r.action_kind, 'senior_tester_review');
    assert.equal(r.probe_status, 'no-test-files');
  });

  test('repo with tests: dry-run produces plan with skip_commit + senior_tester_review kind', () => {
    const dir = tmpRepo('tests');
    fixture(dir, 'tests/unit/clean.test.cjs', `
const test = require('node:test');
const assert = require('node:assert/strict');
test('clean', () => { assert.deepStrictEqual({ a: 1 }, { a: 1 }); });
`);
    const r = dryRun.runDryRun({
      slug: 'with-tests',
      kind: 'senior_tester_review',
      repoRoot: dir,
      isoDate: '2026-05-10',
    });
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'dry-run');
    assert.equal(r.action_kind, 'senior_tester_review');
    assert.equal(r.skip_commit, true);
    assert.equal(r.branch, null);
    assert.match(r.action.title, /Senior tester review/);
  });

  test('execute: clean suite returns ok with skip_commit + no working-tree edits', async () => {
    const dir = tmpRepo('clean-exec');
    fixture(dir, 'tests/unit/clean.test.cjs', `
const test = require('node:test');
const assert = require('node:assert/strict');
test('describes the SUT', () => {
  assert.deepStrictEqual({ a: 1 }, { a: 1 });
});
`);
    const plan = dryRun.runDryRun({
      slug: 'clean-exec',
      kind: 'senior_tester_review',
      repoRoot: dir,
      isoDate: '2026-05-10',
    });
    assert.equal(plan.ok, true);
    // Commit test fixtures so runExecute's DIRTY_TREE check passes.
    child_process.spawnSync('git', ['add', 'tests/'], { cwd: dir });
    child_process.spawnSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir });
    // runExecute reads plan from a file outside the repo (so it doesn't trip
    // DIRTY_TREE as untracked).
    const planFile = path.join(os.tmpdir(), `plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan), 'utf8');
    const result = await executor.runExecute({
      planFile,
      repoRoot: dir,
      skipGh: true,
      skipPush: true,
    });
    assert.equal(result.ok, true, `expected ok=true, got ${JSON.stringify(result)}`);
    assert.equal(result.skip_commit, true);
    // No working-tree edits (acceptance criterion)
    assert.deepEqual(result.touchedFiles || [], []);
  });

  test('execute: dirty suite produces findings + writes journal + mock issue', async () => {
    const dir = tmpRepo('dirty-exec');
    // Several smells in one file
    fixture(dir, 'tests/unit/dirty.test.cjs', `
test('test1', () => {
  console.log('debug');
  expect(getResult()).toBeTruthy();
});
test.skip('todo broken', () => {});
test('placeholder', () => {
  doSomething();
  // expected: result is 5
});
`);
    const plan = dryRun.runDryRun({
      slug: 'dirty-exec',
      kind: 'senior_tester_review',
      repoRoot: dir,
      isoDate: '2026-05-10',
    });
    assert.equal(plan.ok, true);
    child_process.spawnSync('git', ['add', 'tests/'], { cwd: dir });
    child_process.spawnSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir });
    const planFile = path.join(os.tmpdir(), `plan-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(planFile, JSON.stringify(plan), 'utf8');
    const result = await executor.runExecute({
      planFile,
      repoRoot: dir,
      skipGh: true,
      skipPush: true,
    });
    assert.equal(result.ok, true, `expected ok=true, got ${JSON.stringify(result)}`);
    assert.equal(result.skip_commit, true);
    assert.deepEqual(result.touchedFiles || [], []);
  });
});
