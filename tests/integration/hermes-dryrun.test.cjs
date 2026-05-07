'use strict';

// Integration test for bin/hermes/dry-run.cjs against tests/fixtures/hermes-dryrun.
// Proves the orchestrator wires every primitive end-to-end without Claude SDK.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dryRun = require('../../bin/hermes/dry-run.cjs');
const journal = require('../../bin/hermes/_lib/journal.cjs');
const trailers = require('../../bin/hermes/_lib/git-trailers.cjs');

const FIXTURE_SRC = path.resolve(__dirname, '..', 'fixtures', 'hermes-dryrun');
const SLUG = 'hermes-dryrun';

// Copy the read-only fixture into a tmp dir so each test can mutate cortex/journal/.lock + journal entries
function freshFixture(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-int-${prefix}-`));
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

describe('hermes-dryrun integration: happy path', () => {
  test('first run picks DO-this-week #1 + emits valid plan', () => {
    const repoRoot = freshFixture('happy');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot, trigger: 'manual' });

      assert.equal(result.ok, true);
      assert.equal(result.mode, 'dry-run');
      assert.equal(result.action.num, 1);
      assert.match(result.action.title, /subtract/i);
      assert.match(result.branch, /^hermes\/\d{4}-\d{2}-\d{2}-add-a-subtract-function-/);
      assert.match(result.action_id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });

  test('planned commit is valid Conventional Commits + Git trailers', () => {
    const repoRoot = freshFixture('commit-shape');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot, trigger: 'cron' });

      assert.match(result.commit_message, /^feat\(hermes-dryrun\):/);
      const parsed = trailers.parseTrailers(result.commit_message);
      assert.equal(parsed['Hermes-Action-Id'], result.action_id);
      assert.equal(parsed['Hermes-Trigger'], 'cron');
      assert.match(parsed['Hermes-Journal-Entry'], /\.jsonl$/);
      assert.match(parsed['Hermes-Recommendation-Source'], /cortex\/recommendations\.md#/);
      assert.match(parsed['Co-Authored-By'], /Hermes <hermes@cortex-x\.local>/);
    });
  });
});

describe('hermes-dryrun integration: deduplication via journal', () => {
  test('second run picks DO-this-week #2 (skips already-processed #1)', () => {
    const repoRoot = freshFixture('dedupe');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const first = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(first.action.num, 1);

      const second = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(second.action.num, 2);
      assert.notEqual(second.action_id, first.action_id);
    });
  });

  test('after all DO-this-week items processed, returns no_actionable_step', () => {
    const repoRoot = freshFixture('exhausted');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      // The fixture has 3 DO-this-week items
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      const fourth = dryRun.runDryRun({ slug: SLUG, repoRoot });

      assert.equal(fourth.ok, true);
      assert.equal(fourth.no_actionable_step, true);
      assert.equal(fourth.processed.length, 3);
    });
  });
});

describe('hermes-dryrun integration: halt + lock semantics', () => {
  test('HERMES_HALT sentinel halts the run', () => {
    const repoRoot = freshFixture('halt');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'HERMES_HALT'), 'killed by test\n');

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'project_sentinel_present');
      assert.equal(result.exitCode, 75);
    });
  });

  test('lock collision returns LOCK_HELD without writing journal', () => {
    const repoRoot = freshFixture('lock');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));
    // Manually create a lock file
    const lockDir = path.join(repoRoot, 'cortex', 'journal', SLUG);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, '.lock'),
      JSON.stringify({ pid: 99999, start_ts: new Date().toISOString(), action_id: 'other' }),
    );

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'LOCK_HELD');
      assert.equal(result.heldBy.action_id, 'other');
    });
  });

  test('lock is released after a successful run', () => {
    const repoRoot = freshFixture('release');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(result.ok, true);
      const lockFile = path.join(repoRoot, 'cortex', 'journal', SLUG, '.lock');
      assert.equal(fs.existsSync(lockFile), false, 'lock file should be released');
    });
  });
});

describe('hermes-dryrun integration: error paths', () => {
  test('missing slug returns MISSING_SLUG', () => {
    const result = dryRun.runDryRun({});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_SLUG');
  });

  test('missing recommendations.md returns MISSING_RECOMMENDATIONS', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-empty-'));
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: SLUG, repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MISSING_RECOMMENDATIONS');
    });
  });

  test('slug mismatch between CLI and recommendations.md returns SLUG_MISMATCH', () => {
    const repoRoot = freshFixture('mismatch');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      const result = dryRun.runDryRun({ slug: 'wrong-slug', repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'SLUG_MISMATCH');
    });
  });
});

describe('hermes-dryrun integration: journal contract', () => {
  test('successful run appends one journal entry', () => {
    const repoRoot = freshFixture('journal');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      dryRun.runDryRun({ slug: SLUG, repoRoot, trigger: 'manual' });
      const entries = journal.readJournal(SLUG);
      assert.equal(entries.length, 1);
      const e = entries[0];
      assert.equal(e.event, 'dry_run_completed');
      assert.equal(e.outcome, 'success');
      assert.equal(e.actor, 'hermes');
      assert.equal(e.trigger, 'manual');
      assert.match(e.action_key, /^hermes-dryrun#week-1$/);
    });
  });

  test('no_actionable_step appends a skipped journal entry', () => {
    const repoRoot = freshFixture('journal-skip');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      dryRun.runDryRun({ slug: SLUG, repoRoot });

      const entries = journal.readJournal(SLUG);
      const last = entries[entries.length - 1];
      assert.equal(last.event, 'no_actionable_step');
      assert.equal(last.outcome, 'skipped');
    });
  });

  test('journal entries do not leak the user homedir', () => {
    const repoRoot = freshFixture('journal-pii');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    withDataHome(dataHome, () => {
      dryRun.runDryRun({ slug: SLUG, repoRoot });
      const filePath = journal.journalPath(SLUG);
      const raw = fs.readFileSync(filePath, 'utf8');
      const homedir = os.homedir();
      assert.equal(raw.includes(homedir), false, 'journal must not contain absolute homedir paths');
    });
  });
});

describe('hermes-dryrun integration: CLI entry', () => {
  test('CLI --json prints structured plan and exits 0', () => {
    const repoRoot = freshFixture('cli-json');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));

    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', '..', 'bin', 'hermes', 'dry-run.cjs'),
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
    assert.equal(parsed.mode, 'dry-run');
    assert.equal(parsed.slug, SLUG);
  });

  test('CLI without --slug prints usage and exits 1', () => {
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', '..', 'bin', 'hermes', 'dry-run.cjs'),
    ], { encoding: 'utf8', timeout: 5000 });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  });

  test('CLI with HERMES_HALT exits 75', () => {
    const repoRoot = freshFixture('cli-halt');
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-int-data-'));
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'HERMES_HALT'), 'halt\n');

    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', '..', 'bin', 'hermes', 'dry-run.cjs'),
      `--slug=${SLUG}`,
      `--repo-root=${repoRoot}`,
      '--quiet',
    ], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });

    assert.equal(result.status, 75);
  });
});
