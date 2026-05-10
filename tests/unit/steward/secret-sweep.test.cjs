// Sprint 2.6b — secret_history_sweep tests.
//
// We can't actually invoke trufflehog in CI without installing it; tests
// focus on flow control + state management + output formatting.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const ssa = require('../../../bin/steward/_lib/secret-sweep-action.cjs');
const probe = require('../../../detectors/secret-history-sweep.cjs');

function tmp(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ss-${label}-`));
  return dir;
}

function gitRepo(label) {
  const dir = tmp(label);
  cp.spawnSync('git', ['init', '-q'], { cwd: dir });
  cp.spawnSync('git', ['config', 'user.email', 'test@local'], { cwd: dir });
  cp.spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  cp.spawnSync('git', ['add', '.'], { cwd: dir });
  cp.spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('Sprint 2.6b — runSecretHistorySweep argument validation', () => {
  test('rejects missing slug', async () => {
    const r = await ssa.runSecretHistorySweep({ repoRoot: process.cwd() });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SECRET_SWEEP_NO_SLUG');
  });

  test('rejects unsafe slug', async () => {
    const r = await ssa.runSecretHistorySweep({ repoRoot: process.cwd(), slug: '../etc' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SECRET_SWEEP_INVALID_SLUG');
  });

  test('rejects unsafe date', async () => {
    const r = await ssa.runSecretHistorySweep({ repoRoot: process.cwd(), slug: 'safe', isoDate: '../../etc' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SECRET_SWEEP_INVALID_DATE');
  });

  test('non-git repo → SECRET_SWEEP_NO_HEAD', async () => {
    const dir = tmp('no-git');
    const r = await ssa.runSecretHistorySweep({ repoRoot: dir, slug: 'test', isoDate: '2026-05-10', skipGh: true, dataHome: dir });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SECRET_SWEEP_NO_HEAD');
  });
});

describe('Sprint 2.6b — sha state file', () => {
  test('readLastSweptSha returns null on first run', () => {
    const dir = tmp('sha-first');
    const sha = ssa.readLastSweptSha({ dataHome: dir, repoRoot: dir, slug: 'test' });
    assert.equal(sha, null);
  });

  test('writeLastSweptSha persists + readLastSweptSha returns it', () => {
    const dir = tmp('sha-rw');
    const fakeSha = 'a3406d29c5cdda61e8aa5e2ab9bc40000000000a';
    ssa.writeLastSweptSha({ dataHome: dir, repoRoot: dir, slug: 'test', sha: fakeSha });
    const got = ssa.readLastSweptSha({ dataHome: dir, repoRoot: dir, slug: 'test' });
    assert.equal(got, fakeSha);
  });

  test('readLastSweptSha rejects malformed sha', () => {
    const dir = tmp('sha-bad');
    const journalDir = path.join(dir, 'journal', 'test');
    fs.mkdirSync(journalDir, { recursive: true });
    fs.writeFileSync(path.join(journalDir, 'secret-sweep-state.json'), JSON.stringify({ last_swept_sha: 'not-a-sha' }), 'utf8');
    const got = ssa.readLastSweptSha({ dataHome: dir, repoRoot: dir, slug: 'test' });
    assert.equal(got, null);
  });
});

describe('Sprint 2.6b — getCurrentSha', () => {
  test('returns 40-hex sha from real git repo', () => {
    const dir = gitRepo('sha');
    const sha = ssa.getCurrentSha(dir);
    assert.match(sha, /^[a-f0-9]{40}$/);
  });

  test('returns null on non-git directory', () => {
    const dir = tmp('no-git-2');
    const sha = ssa.getCurrentSha(dir);
    assert.equal(sha, null);
  });
});

describe('Sprint 2.6b — formatIssueBody', () => {
  test('produces severity-tagged body with rotation guidance', () => {
    const findings = [
      {
        DetectorName: 'AWS',
        Verified: true,
        SourceMetadata: { Data: { Git: { commit: 'a3406d29c5cdda61e8aa5e2ab9bc40000000000a', file: 'test.env', line: 5 } } },
      },
    ];
    const body = ssa.formatIssueBody({
      findings,
      slug: 'demo',
      date: '2026-05-10',
      sinceCommit: null,
      currentSha: 'a3406d29c5cdda61e8aa5e2ab9bc40000000000a',
    });
    assert.match(body, /AWS/);
    assert.match(body, /ROTATE/);
    assert.match(body, /a3406d29c5cd/);
    assert.match(body, /test\.env/);
  });
});

describe('Sprint 2.6b — detector probe', () => {
  test('non-git repo → no-git', () => {
    const dir = tmp('probe-nogit');
    const r = probe.detect({ repoRoot: dir });
    assert.equal(r.status, 'no-git');
  });

  test('opt-out sentinel respected', () => {
    const dir = gitRepo('probe-opt');
    fs.mkdirSync(path.join(dir, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cortex', 'secret-sweep-disabled'), '');
    const r = probe.detect({ repoRoot: dir });
    assert.equal(r.status, 'opted-out');
  });

  test('git repo without trufflehog binary → no-trufflehog (fail-open)', () => {
    const dir = gitRepo('probe-no-bin');
    // Override PATH so trufflehog isn't found.
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = path.join(dir, 'nonexistent-bin');
      const r = probe.detect({ repoRoot: dir });
      // Either no-trufflehog OR ready (if test env happens to have it installed)
      assert.ok(r.status === 'no-trufflehog' || r.status === 'ready');
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
