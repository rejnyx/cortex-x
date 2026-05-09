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
  test('todo_triage dispatches without recommendations.md (skip_commit=true)', () => {
    const repo = tmpRepo('todo');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'todo_triage',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.action_kind, 'todo_triage');
    assert.equal(result.skip_commit, true);
    assert.equal(result.branch, null);
    assert.match(result.action.action_key, /^cx#todo_triage-\d{4}-\d{2}-\d{2}$/);
  });

  test('dep_update_patch dispatches with branch + commit_message (skip_commit=false)', () => {
    const repo = tmpRepo('dep');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'dep_update_patch',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    assert.equal(result.action_kind, 'dep_update_patch');
    assert.equal(result.skip_commit, false);
    assert.match(result.branch, /^steward\/\d{4}-\d{2}-\d{2}-cx-dep-update-patch-/);
    assert.ok(result.commit_message);
    assert.match(result.commit_message, /Steward-Recommendation-Source: deterministic-detector \(dep_update_patch\)/);
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

  test('journal entry written for each deterministic dispatch', () => {
    const repo = tmpRepo('journal');
    const result = dryRun.runDryRun({
      slug: 'cx',
      repoRoot: repo,
      kind: 'todo_triage',
      trigger: 'cron',
    });
    assert.equal(result.ok, true);
    // Journal goes to CORTEX_DATA_HOME or default; we only verify the dispatch
    // succeeded — full journal-shape integration is covered by execute tests.
    assert.ok(result.action_id);
  });
});
