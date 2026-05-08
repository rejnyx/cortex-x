'use strict';

/**
 * Integration test — Sprint 1.9.0 spec-driven verification end-to-end.
 *
 * Drives execute.cjs's full pipeline (lock + branch + applyAction + spec-verifier
 * + npm test + commit + journal) with the mock engine to prove:
 *
 *   1. PR #3 reproduction: shrinking a 1000-byte file to <50% triggers
 *      SPEC_VIOLATION on the no_destructive_rewrite criterion → rollback +
 *      journal entry + lesson recorded.
 *   2. PR #4 reproduction: shrinking MIGRATIONS.md to <50% with fabricated
 *      content triggers the same criterion.
 *   3. Happy path: a legitimate edit that preserves >=50% bytes passes
 *      spec-verifier, reaches npm test, and commits.
 *   4. replace_all=true on the edit lets a true rewrite through (intentional
 *      regeneration use case — explicitly opt-in escape hatch).
 *
 * The tests use the REAL action-kinds.cjs registry (not a stub), so they also
 * verify that the recommendation kind's no_destructive_rewrite criterion
 * fires under the live spec-verifier wiring.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const execute = require('../../bin/steward/execute.cjs');
const journal = require('../../bin/steward/_lib/journal.cjs');

const SLUG = 'spec-verification-integration';

function tmpRepoWith(seedFiles = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `spec-int-${Date.now()}-`));
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo });
  // Windows autocrlf would mangle byte counts during git checkout/restore on
  // rollback. The integration test compares exact pre-edit content against
  // post-rollback content; force LF preservation so the size predicate is
  // reproducible cross-platform.
  spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'spec-int-fixture',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  for (const [rel, content] of Object.entries(seedFiles)) {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  spawnSync('git', ['add', '.'], { cwd: repo });
  spawnSync('git', ['commit', '-m', 'initial'], { cwd: repo });
  return repo;
}

function writePlan(repoRoot, plan) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-plan-'));
  const f = path.join(tmp, 'plan.json');
  fs.writeFileSync(f, JSON.stringify(plan), 'utf8');
  return f;
}

function buildPlan(overrides = {}) {
  const action_id = overrides.action_id || `01SPEC${Date.now().toString(36).toUpperCase().slice(-8)}`;
  return {
    ok: true,
    mode: 'dry-run',
    slug: SLUG,
    action_kind: 'recommendation',
    action: { num: 1, title: 'spec-verifier integration', action_key: `${SLUG}#week-1`, body: 'edit' },
    branch: `hermes/2026-05-09-spec-int-${Math.random().toString(36).slice(2, 6)}`,
    action_id,
    trigger: 'manual',
    commit_message: `feat(fixture): spec integration

body

Hermes-Action-Id: ${action_id}
Hermes-Journal-Entry: ~/.cortex/journal/x.jsonl
Hermes-Trigger: manual
Hermes-Recommendation-Source: cortex/recommendations.md#1
Co-Authored-By: Hermes <hermes@cortex-x.local>`,
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

describe('spec-verifier integration: PR #3 reproduction (destructive rewrite of large doc)', () => {
  test('1000-byte file shrunk to 4 bytes → SPEC_VIOLATION + rollback', async () => {
    const repoRoot = tmpRepoWith({ 'docs/steward-usage.md': 'x'.repeat(1000) });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({
        edits: [{ path: 'docs/steward-usage.md', content: 'tiny' }],
      }),
    }, async () => {
      const result = await execute.runExecute({
        planFile,
        repoRoot,
        engine: 'mock',
        skipPush: true,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'SPEC_VIOLATION');
      assert.ok(Array.isArray(result.spec_failures));
      assert.equal(result.spec_failures[0].id, 'no_destructive_rewrite');
      assert.equal(result.spec_failures[0].severity, 'block');

      // Working tree restored — original content intact
      const restored = fs.readFileSync(path.join(repoRoot, 'docs/steward-usage.md'), 'utf8');
      assert.equal(restored.length, 1000, 'rollback must restore pre-edit file size');

      // Branch deleted — agent returned to main
      const branches = spawnSync('git', ['branch', '--list'], { cwd: repoRoot, encoding: 'utf8' }).stdout;
      assert.ok(!branches.includes('spec-int'), 'dead branch must be deleted');
    });
  });
});

describe('spec-verifier integration: PR #4 reproduction (MIGRATIONS shrunk + fabricated content)', () => {
  test('600-byte MIGRATIONS shrunk to 28 bytes → SPEC_VIOLATION', async () => {
    const original = 'Sprint 1.7.0\nSprint 1.7.1\nSprint 1.8.0\n'.repeat(20); // ~720 bytes
    const repoRoot = tmpRepoWith({ 'MIGRATIONS.md': original });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({
        edits: [{ path: 'MIGRATIONS.md', content: 'Sprint 1.9.999 fake history\n' }],
      }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'SPEC_VIOLATION');
      assert.equal(result.spec_failures[0].id, 'no_destructive_rewrite');

      // Restored
      assert.equal(fs.readFileSync(path.join(repoRoot, 'MIGRATIONS.md'), 'utf8'), original);
    });
  });
});

describe('spec-verifier integration: happy path (preserves >=50%)', () => {
  test('replacement keeping 70% of bytes passes spec-verifier and commits', async () => {
    const original = 'x'.repeat(1000);
    const replacement = 'y'.repeat(700);
    const repoRoot = tmpRepoWith({ 'docs/keep.md': original });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'docs/keep.md', content: replacement }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, true, `expected ok: ${JSON.stringify(result)}`);
      assert.equal(fs.readFileSync(path.join(repoRoot, 'docs/keep.md'), 'utf8'), replacement);
    });
  });
});

describe('spec-verifier integration: replace_all=true escape hatch', () => {
  test('intentional rewrite via replace_all=true bypasses no_destructive_rewrite', async () => {
    const original = 'y'.repeat(1000);
    const repoRoot = tmpRepoWith({ 'docs/regen.md': original });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({
        edits: [{ path: 'docs/regen.md', content: 'fresh', replace_all: true }],
      }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, true, `replace_all should bypass: ${JSON.stringify(result)}`);
      assert.equal(fs.readFileSync(path.join(repoRoot, 'docs/regen.md'), 'utf8'), 'fresh');
    });
  });
});

describe('spec-verifier integration: small files (< 200 bytes) bypass shrink rule naturally', () => {
  test('placeholder file shrunk to 1 byte does NOT trigger SPEC_VIOLATION (under MIN_GUARDED_BYTES analog)', async () => {
    // The criterion's predicate uses prevSize(p) < 200 as the lower bound.
    const repoRoot = tmpRepoWith({ 'CHANGELOG.md': 'placeholder\n' });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'CHANGELOG.md', content: '#' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, true, `small original under threshold should bypass: ${JSON.stringify(result)}`);
    });
  });
});

describe('spec-verifier integration: journal entry on SPEC_VIOLATION', () => {
  test('SPEC_VIOLATION writes execute_spec_failed entry with spec_failures payload', async () => {
    const repoRoot = tmpRepoWith({ 'docs/big.md': 'z'.repeat(1000) });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'docs/big.md', content: 'tiny' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'SPEC_VIOLATION');

      const today = new Date().toISOString().slice(0, 10);
      const entries = journal.readJournal(SLUG, { date: today });
      const failed = entries.find((e) => e.event === 'execute_spec_failed');
      assert.ok(failed, `journal must contain execute_spec_failed entry; got: ${JSON.stringify(entries.map((e) => e.event))}`);
      assert.ok(Array.isArray(failed.spec_failures), 'journal entry must carry spec_failures array');
      assert.equal(failed.spec_failures[0].id, 'no_destructive_rewrite');
      assert.equal(failed.outcome, 'failure');
    });
  });
});

describe('spec-verifier integration: lesson recorded on SPEC_VIOLATION', () => {
  test('SPEC_VIOLATION records lesson with criterion id encoded in root_cause', async () => {
    const repoRoot = tmpRepoWith({ 'docs/lessoned.md': 'q'.repeat(1000) });
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-int-data-'));
    const planFile = writePlan(repoRoot, buildPlan());

    await withEnv({
      CORTEX_DATA_HOME: dataHome,
      STEWARD_MOCK_PLAN: JSON.stringify({ edits: [{ path: 'docs/lessoned.md', content: 'tiny' }] }),
    }, async () => {
      const result = await execute.runExecute({ planFile, repoRoot, engine: 'mock', skipPush: true });
      assert.equal(result.ok, false);

      const lessonsFile = path.join(dataHome, 'journal', SLUG, 'lessons.jsonl');
      assert.ok(fs.existsSync(lessonsFile), 'lessons.jsonl must be written on SPEC_VIOLATION');
      const lines = fs.readFileSync(lessonsFile, 'utf8').split('\n').filter(Boolean);
      assert.ok(lines.length >= 1);
      const lesson = JSON.parse(lines[lines.length - 1]);
      // Sprint 1.9.0 review (acceptance/MED): root_cause encodes the failing
      // criterion id as `<CODE>:<criterion_id>` per memo AC. lessons.cjs hint
      // matching strips the `:<id>` suffix internally.
      assert.equal(lesson.root_cause, 'SPEC_VIOLATION:no_destructive_rewrite');
      // SPEC_VIOLATION hint case fires (recognized after suffix strip).
      assert.match(lesson.hint, /acceptance criterion rejected/);
    });
  });
});
