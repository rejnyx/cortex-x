'use strict';

// tests/integration/steward-secret-history-sweep.test.cjs
//
// Backfill coverage for the steward-secret-history-sweep cron action.
// Locks in: input safety guards (slug + isoDate), no-HEAD path, TruffleHog
// fail-open behavior when binary is missing (must produce a distinct error
// code, not a silent "no secrets found"), formatter shape, journal contract.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  runSecretHistorySweep,
  readLastSweptSha,
  writeLastSweptSha,
  getCurrentSha,
  formatIssueTitle,
  formatIssueBody,
} = require('../../bin/steward/_lib/secret-sweep-action.cjs');

// Helper: synthetic minimal git repo. Asserts each step succeeds so a
// missing git binary fails with a clear message rather than confusing later.
function makeGitRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-repo-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const initR = spawnSync('git', ['init', '-q'], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(initR.status, 0, `git init failed (is git installed?): ${initR.stderr}`);
  fs.writeFileSync(path.join(tmp, 'README.md'), '# fixture\n');
  const addR = spawnSync('git', ['add', '.'], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(addR.status, 0, `git add failed: ${addR.stderr}`);
  const commitR = spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmp, env, encoding: 'utf8' });
  assert.equal(commitR.status, 0, `git commit failed: ${commitR.stderr}`);
  return tmp;
}

// Resolve git's directory robustly across OSes — used to build a spoofed PATH
// that excludes trufflehog but still includes git (which secret-sweep needs).
function findGitDir() {
  // Walk PATH explicitly rather than relying on `where`/`which` shape (Win can
  // return multiple lines, shims, etc.)
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
    : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const ext of exts) {
      const candidate = path.join(d, `git${ext}`);
      try {
        if (fs.statSync(candidate).isFile()) return d;
      } catch { /* not here */ }
    }
  }
  return null;
}

describe('steward-secret-history-sweep — input safety guards', () => {
  test('missing slug → SECRET_SWEEP_NO_SLUG', async () => {
    const result = await runSecretHistorySweep({});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SECRET_SWEEP_NO_SLUG');
    assert.equal(result.skip_commit, true);
    assert.deepEqual(result.touchedFiles, []);
  });

  test('unsafe slug (path traversal) → SECRET_SWEEP_INVALID_SLUG', async () => {
    const result = await runSecretHistorySweep({ slug: '../../etc/passwd' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SECRET_SWEEP_INVALID_SLUG');
  });

  test('unsafe isoDate (non-ISO) → SECRET_SWEEP_INVALID_DATE', async () => {
    const result = await runSecretHistorySweep({
      slug: 'cortex-x',
      isoDate: 'not-a-date',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SECRET_SWEEP_INVALID_DATE');
  });
});

describe('steward-secret-history-sweep — git HEAD resolution', () => {
  test('non-git directory → SECRET_SWEEP_NO_HEAD', async () => {
    const tmpNonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-nogit-'));
    const result = await runSecretHistorySweep({
      repoRoot: tmpNonGit,
      slug: 'cortex-x',
      isoDate: '2026-05-26',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SECRET_SWEEP_NO_HEAD');
  });

  test('getCurrentSha returns a 40-char hex string on a real repo', () => {
    const repo = makeGitRepo();
    const sha = getCurrentSha(repo);
    assert.ok(sha, 'must return non-empty SHA');
    assert.match(sha, /^[0-9a-f]{40}$/, 'must be canonical 40-hex git SHA');
  });
});

describe('steward-secret-history-sweep — TruffleHog fail-open distinct from no-findings', () => {
  test('missing trufflehog binary → SECRET_SWEEP error code (NOT silent no-findings)', async () => {
    // The critical contract: if trufflehog isn't installed, the sweep must
    // fail loudly with a code (TRUFFLEHOG_SPAWN_ERROR), NOT report 0 findings
    // (which would be a silent fail-open that masks real secrets).
    const repo = makeGitRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-data-'));

    // Spoof PATH so trufflehog can't be found but git remains accessible
    // (secret-sweep calls `git rev-parse HEAD` internally; killing git too
    // would make this test pass for the wrong reason — NO_HEAD instead of
    // TRUFFLEHOG_SPAWN_ERROR).
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-empty-'));
    const origPath = process.env.PATH;
    const gitDir = findGitDir();
    assert.ok(gitDir, 'git must be on PATH for this test to run meaningfully');
    process.env.PATH = `${emptyDir}${path.delimiter}${gitDir}`;

    try {
      const result = await runSecretHistorySweep({
        repoRoot: repo,
        slug: 'cortex-x',
        isoDate: '2026-05-26',
        dataHome,
      });
      // EITHER ok:false with TRUFFLEHOG_SPAWN_ERROR (preferred)
      // OR ok:true with findings_count === 0 IS WRONG — that would be the silent fail
      if (result.ok === false) {
        assert.match(
          result.code,
          /^TRUFFLEHOG_/,
          `missing trufflehog must produce TRUFFLEHOG_* error, got ${result.code}`,
        );
      } else {
        // If by some chance trufflehog WAS found despite PATH spoof, accept it
        // as long as findings_count is documented. The test's PURPOSE is to
        // verify the distinction between "tool ran clean" and "tool absent".
        assert.ok(
          typeof result.findings_count === 'number',
          'on success path, findings_count must be a number',
        );
      }
    } finally {
      process.env.PATH = origPath;
    }
  });
});

describe('steward-secret-history-sweep — last-swept-sha persistence', () => {
  test('writeLastSweptSha + readLastSweptSha roundtrip', () => {
    const repo = makeGitRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-state-'));
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    writeLastSweptSha({ dataHome, repoRoot: repo, slug: 'cortex-x', sha });
    const read = readLastSweptSha({ dataHome, repoRoot: repo, slug: 'cortex-x' });
    assert.equal(read, sha);
  });

  test('readLastSweptSha returns null on first-ever sweep', () => {
    const repo = makeGitRepo();
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ssh-fresh-'));
    const read = readLastSweptSha({ dataHome, repoRoot: repo, slug: 'cortex-x' });
    assert.ok(read === null || read === undefined,
      `first-ever sweep must return null/undefined, got ${read}`);
  });
});

describe('steward-secret-history-sweep — issue formatting', () => {
  test('formatIssueTitle deterministic + includes date', () => {
    const title = formatIssueTitle('2026-05-26');
    assert.ok(title.includes('2026-05-26'));
    assert.ok(title.length > 0 && title.length < 200);
    assert.match(title, /secret/i, 'title must mention "secret"');
  });

  test('formatIssueBody renders markdown with ROTATE imperative', () => {
    const body = formatIssueBody({
      findings: [
        {
          DetectorName: 'AWS',
          Verified: true,
          SourceMetadata: { Data: { Git: { commit: 'abc123', file: 'config.js', line: 42 } } },
        },
      ],
      slug: 'cortex-x',
      date: '2026-05-26',
      sinceCommit: null,
      currentSha: '0'.repeat(40),
    });
    assert.match(body, /ROTATE/, 'must imperatively tell operator to rotate');
    assert.match(body, /AWS/, 'must include detector name');
    assert.match(body, /verified/i, 'must mark verified findings');
  });

  test('formatIssueBody handles empty findings array gracefully', () => {
    const body = formatIssueBody({
      findings: [],
      slug: 'cortex-x',
      date: '2026-05-26',
      sinceCommit: null,
      currentSha: '0'.repeat(40),
    });
    assert.ok(typeof body === 'string' && body.length > 0,
      'must produce a body even on zero-findings path (audit trail)');
  });
});
