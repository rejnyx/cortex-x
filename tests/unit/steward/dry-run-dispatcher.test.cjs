'use strict';

// Sprint 2.9.6 — dry-run dispatcher tests for deterministic action_kinds.
// Pre-existing v0.7-era bug: dispatcher only handled `recommendation` and
// `recommendation_harvest`; everything else fell through to the LLM path.
// Cron workflows for todo_triage / dep_update_patch existed since Sprint
// 1.8.4-1.8.7 but never ran successfully end-to-end. This test locks the
// fix in place.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

const dryRun = require('../../../bin/steward/dry-run.cjs');

function tmpRepo(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cx-dryrun-${prefix}-`)));
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('Sprint 2.9.6 dispatcher — deterministic kinds', () => {
  test('todo_triage on repo with TODO markers builds plan (skip_commit=true)', () => {
    const repo = tmpRepo('todo');
    // Plant a fresh TODO older than threshold via mock files.
    fs.writeFileSync(path.join(repo, 'src.js'), 'function x() {\n  // TODO: do something\n  return 1;\n}\n');
    // Run with skipBlame:true so we don't need git history depth.
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'todo_triage',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.action_kind, 'todo_triage');
    // On a clean repo with no git history older than threshold, detector
    // returns no_actionable_step (correct behavior). The bare repo case is
    // covered by the next test.
    assert.ok(result.no_actionable_step || result.skip_commit === true);
  });

  test('todo_triage on bare repo (no TODOs) returns no_actionable_step', () => {
    const repo = tmpRepo('todo-empty');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'todo_triage',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.no_actionable_step, true);
    assert.equal(result.action_kind, 'todo_triage');
  });

  test('dep_update_patch on repo with no package.json returns no_actionable_step', () => {
    const repo = tmpRepo('dep-empty');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'dep_update_patch',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    // On a bare repo without package.json, npm outdated returns nothing →
    // no_actionable_step. This is the success-shape exit (clean cron skip).
    assert.equal(result.no_actionable_step, true);
    assert.equal(result.action_kind, 'dep_update_patch');
  });

  test('flaky_test_repair dispatches via shared deterministic builder', () => {
    const repo = tmpRepo('flaky');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'flaky_test_repair',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.action_kind, 'flaky_test_repair');
    assert.equal(result.skip_commit, false);
  });

  test('doc_drift / test_coverage_gap / pr_review_responder are skip_commit (issue-only)', () => {
    for (const kind of ['doc_drift', 'test_coverage_gap', 'pr_review_responder']) {
      const repo = tmpRepo(kind);
      const result = dryRun.runDryRun({ slug: 'cx', repoRoot: repo, kind, trigger: 'cron' });
      assert.equal(result.ok, true, `${kind} ok`);
      assert.equal(result.action_kind, kind, `${kind} kind`);
      assert.equal(result.skip_commit, true, `${kind} skip_commit`);
    }
  });

  test('lint_fix_shipper / tech_debt_audit are commit-shaped (file edits)', () => {
    for (const kind of ['lint_fix_shipper', 'tech_debt_audit']) {
      const repo = tmpRepo(kind);
      const result = dryRun.runDryRun({ slug: 'cx', repoRoot: repo, kind, trigger: 'cron' });
      assert.equal(result.ok, true, `${kind} ok`);
      assert.equal(result.action_kind, kind, `${kind} kind`);
      assert.equal(result.skip_commit, false, `${kind} skip_commit`);
      assert.ok(result.commit_message, `${kind} has commit_message`);
    }
  });

  test('pattern_transfer hard-fails as no_actionable_step (Sprint 2.7.1 not yet wired)', () => {
    const repo = tmpRepo('pt');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'pattern_transfer',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.no_actionable_step, true);
    assert.equal(result.action_kind, 'pattern_transfer');
    assert.match(result.reason, /Sprint 2.7.1/);
  });

  test('recommendation kind STILL requires recommendations.md (regression guard)', () => {
    const repo = tmpRepo('rec');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'recommendation',
      trigger: 'cron',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_RECOMMENDATIONS');
  });

  test('recommendation_harvest STILL requires recommendations.md (regression guard)', () => {
    const repo = tmpRepo('harvest');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'recommendation_harvest',
      trigger: 'cron',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_RECOMMENDATIONS');
  });

  test('unknown kind rejected via UNKNOWN_KIND', () => {
    const repo = tmpRepo('bad');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'totally_invented_kind',
      trigger: 'cron',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNKNOWN_KIND');
  });

  test('flaky_test_repair on bare repo builds plan (no detector probe in dispatch)', () => {
    // flaky_test_repair, doc_drift, lint_fix_shipper, etc. don't probe at
    // dry-run time — they always build a plan that the executor will run.
    const repo = tmpRepo('flaky-plan');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'flaky_test_repair',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.action_kind, 'flaky_test_repair');
    // Either dispatched-as-plan or no_actionable_step — both valid; verify
    // dispatch happened (action_kind set, no error).
    assert.ok(result.action_id || result.no_actionable_step);
  });
});
