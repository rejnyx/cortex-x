'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const status = require('../../../bin/steward/status.cjs');
const journal = require('../../../bin/steward/_lib/journal.cjs');
const dryRun = require('../../../bin/steward/dry-run.cjs');

const FIXTURE_SRC = path.resolve(__dirname, '..', '..', 'fixtures', 'steward-dryrun');
const SLUG = 'steward-dryrun';

function freshFixture(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `steward-status-${prefix}-`));
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

function withDataHome(dataHome, fn) {
  const prev = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dataHome;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CORTEX_DATA_HOME;
    else process.env.CORTEX_DATA_HOME = prev;
  }
}

describe('status: error paths', () => {
  test('missing slug returns MISSING_SLUG', () => {
    const result = status.getStatus({});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_SLUG');
  });
});

describe('status: clean fixture', () => {
  test('reports not-halted, lock free, recommendations OK', () => {
    const repoRoot = freshFixture('clean');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));

    withDataHome(dataHome, () => {
      const result = status.getStatus({ slug: SLUG, repoRoot });
      assert.equal(result.ok, true);
      assert.equal(result.halt.halted, false);
      assert.equal(result.lock.held, false);
      assert.equal(result.recommendations.ok, true);
      assert.equal(result.recommendations.do_this_week_count, 3);
      assert.equal(result.recommendations.do_this_sprint_count, 1);
    });
  });

  test('empty journal summary when no runs yet', () => {
    const repoRoot = freshFixture('empty-journal');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));

    withDataHome(dataHome, () => {
      const result = status.getStatus({ slug: SLUG, repoRoot });
      assert.equal(result.journal.entries_total, 0);
      assert.deepEqual(result.journal.by_outcome, {});
      assert.deepEqual(result.journal.last_entries, []);
    });
  });
});

describe('status: after dry-run activity', () => {
  test('journal summary reflects dry-run entries', () => {
    const repoRoot = freshFixture('after-runs');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));

    withDataHome(dataHome, () => {
      dryRun.runDryRun({ slug: SLUG, repoRoot, trigger: 'cron' });
      dryRun.runDryRun({ slug: SLUG, repoRoot, trigger: 'manual' });

      const result = status.getStatus({ slug: SLUG, repoRoot });
      assert.equal(result.journal.entries_total, 2);
      assert.equal(result.journal.by_outcome.success, 2);
      assert.equal(result.journal.by_event.dry_run_completed, 2);
      assert.equal(result.journal.by_trigger.cron, 1);
      assert.equal(result.journal.by_trigger.manual, 1);
      assert.equal(result.journal.last_entries.length, 2);
    });
  });

  test('cost + token totals roll up correctly', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-cost-'));
    withDataHome(dataHome, () => {
      journal.appendJournal('cost-slug', {
        ts: new Date().toISOString(), trigger: 'cron', tier: 'T0', event: 'a',
        cost_usd: 0.10, tokens_in: 100, tokens_out: 50,
      });
      journal.appendJournal('cost-slug', {
        ts: new Date().toISOString(), trigger: 'cron', tier: 'T0', event: 'b',
        cost_usd: 0.25, tokens_in: 200, tokens_out: 100,
      });

      const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-cost-repo-'));
      const result = status.getStatus({ slug: 'cost-slug', repoRoot });
      assert.equal(result.journal.cost_usd_total, 0.35);
      assert.equal(result.journal.tokens_in_total, 300);
      assert.equal(result.journal.tokens_out_total, 150);
    });
  });
});

describe('status: halt + lock detection', () => {
  test('detects halt sentinel', () => {
    const repoRoot = freshFixture('halt');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'STEWARD_HALT'), 'halt\n');

    withDataHome(dataHome, () => {
      const result = status.getStatus({ slug: SLUG, repoRoot });
      assert.equal(result.halt.halted, true);
      assert.equal(result.halt.reason, 'project_sentinel_present');
    });
  });

  test('detects held lock with metadata', () => {
    const repoRoot = freshFixture('lock');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));
    const lockDir = path.join(repoRoot, 'cortex', 'journal', SLUG);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, '.lock'),
      JSON.stringify({ pid: 12345, start_ts: new Date().toISOString(), action_id: 'A1' }),
    );

    withDataHome(dataHome, () => {
      const result = status.getStatus({ slug: SLUG, repoRoot });
      assert.equal(result.lock.held, true);
      assert.equal(result.lock.heldBy.pid, 12345);
      assert.equal(result.lock.heldBy.action_id, 'A1');
    });
  });
});

describe('status: human-readable formatting', () => {
  test('formatHumanReadable produces multi-line text', () => {
    const repoRoot = freshFixture('format');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));

    withDataHome(dataHome, () => {
      const result = status.getStatus({ slug: SLUG, repoRoot });
      const text = status.formatHumanReadable(result);
      assert.match(text, /Steward status/);
      assert.match(text, /halt:/);
      assert.match(text, /lock:/);
      assert.match(text, /recommendations:/);
      assert.match(text, /journal:/);
    });
  });
});

describe('status: CLI', () => {
  test('CLI --json emits structured status', () => {
    const repoRoot = freshFixture('cli');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'steward-status-data-'));

    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', '..', '..', 'bin', 'steward', 'status.cjs'),
      `--slug=${SLUG}`,
      `--repo-root=${repoRoot}`,
      '--json',
    ], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.slug, SLUG);
  });

  test('CLI without --slug prints usage and exits 1', () => {
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', '..', '..', 'bin', 'steward', 'status.cjs'),
    ], { encoding: 'utf8', timeout: 5000 });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  });
});

// Sprint 2.13 — --self-invocations flag renders chain history.
describe('status: self-invocations flag (Sprint 2.13)', () => {
  const selfInvocation = require('../../../bin/steward/_lib/self-invocation.cjs');

  test('opts.selfInvocations=false omits the block', () => {
    const repoRoot = freshFixture('si-off');
    const dataHome = path.join(repoRoot, '.cortex-data');
    try {
      withDataHome(dataHome, () => {
        const result = status.getStatus({ slug: SLUG, repoRoot });
        assert.equal(result.self_invocations, undefined);
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('opts.selfInvocations=true returns block with empty tree on greenfield', () => {
    const repoRoot = freshFixture('si-empty');
    const dataHome = path.join(repoRoot, '.cortex-data');
    try {
      withDataHome(dataHome, () => {
        const result = status.getStatus({ slug: SLUG, repoRoot, selfInvocations: true });
        assert.ok(result.self_invocations);
        assert.equal(result.self_invocations.total_events, 0);
        assert.match(result.self_invocations.tree, /no chains/);
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('opts.selfInvocations=true surfaces recorded chains', () => {
    const repoRoot = freshFixture('si-active');
    const dataHome = path.join(repoRoot, '.cortex-data');
    try {
      withDataHome(dataHome, () => {
        const tracker = selfInvocation.createInvocationTracker({ slug: SLUG });
        const r1 = tracker.beforeInvoke({ skill: '/loop', args: { interval: '5m' } });
        tracker.afterInvoke(r1.invocationId, { outcome: 'success' });
        const r2 = tracker.beforeInvoke({
          skill: 'subagent', args: { sub: 'general' }, parentId: r1.invocationId,
        });
        tracker.afterInvoke(r2.invocationId, { outcome: 'success' });

        const result = status.getStatus({ slug: SLUG, repoRoot, selfInvocations: true });
        assert.ok(result.self_invocations.total_events >= 4); // 2 started + 2 completed
        assert.match(result.self_invocations.tree, /\/loop/);
        assert.match(result.self_invocations.tree, /subagent/);
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('formatHumanReadable includes self_invocations block when present', () => {
    const repoRoot = freshFixture('si-fmt');
    const dataHome = path.join(repoRoot, '.cortex-data');
    try {
      withDataHome(dataHome, () => {
        const tracker = selfInvocation.createInvocationTracker({ slug: SLUG });
        const r = tracker.beforeInvoke({ skill: '/loop' });
        tracker.afterInvoke(r.invocationId, { outcome: 'success' });

        const result = status.getStatus({ slug: SLUG, repoRoot, selfInvocations: true });
        const human = status.formatHumanReadable(result);
        assert.match(human, /self_invocations \(--self-invocations\)/);
        assert.match(human, /events_total:/);
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test('CLI --self-invocations flag is forwarded to getStatus', () => {
    const repoRoot = freshFixture('si-cli');
    const dataHome = path.join(repoRoot, '.cortex-data');
    try {
      const env = { ...process.env, CORTEX_DATA_HOME: dataHome };
      const result = spawnSync(
        process.execPath,
        [
          path.resolve(__dirname, '..', '..', '..', 'bin', 'steward', 'status.cjs'),
          `--slug=${SLUG}`,
          `--repo-root=${repoRoot}`,
          '--self-invocations',
          '--json',
        ],
        { encoding: 'utf8', env },
      );
      assert.equal(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.self_invocations, 'self_invocations block must be present in JSON output');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
