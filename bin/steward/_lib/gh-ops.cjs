// gh-ops.cjs — GitHub CLI wrapper for Steward draft-PR creation (Sprint 1.6.19).
//
// Wraps `gh pr create --draft` via spawnSync (no shell injection: array argv,
// shell:false). Mirrors git-ops.cjs contract: returns { ok, ... } never throws.
//
// Why a separate module: gh CLI is an OPTIONAL dependency of Steward (the
// commit + push path works without it; gh adds the draft-PR step on top).
// Keeping it isolated lets execute.cjs degrade gracefully when gh is absent.
//
// Contract:
//   - createDraftPR(repoRoot, opts) → { ok, url?, error?, code? }
//   - hasGhCli() → boolean (cached check)
//
// Security: PR title/body files are passed via -F/-F flags pointing to tmpfile
// to avoid shell-quoting issues with multi-line commit-style content.

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_TIMEOUT_MS = 60_000;

let _ghCliCache = null;

function gh(repoRoot, args, opts = {}) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    shell: false,
    env: opts.env || process.env,
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
      code: result.error.code,
      args,
    };
  }

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    args,
  };
}

// Detect gh CLI presence. Cached after first call (process-lifetime) since
// CLI binary doesn't appear/disappear during a Steward run.
function hasGhCli(opts = {}) {
  if (opts.refresh) _ghCliCache = null;
  if (_ghCliCache !== null) return _ghCliCache;
  const r = spawnSync('gh', ['--version'], {
    timeout: 5_000,
    shell: false,
    encoding: 'utf8',
  });
  _ghCliCache = !r.error && r.status === 0;
  return _ghCliCache;
}

// Write a multi-line body to a tmp file. gh pr create supports `-F <file>`
// for body, which is the safest way to ship arbitrary content (commit-style
// bodies often contain backticks, dollars, double-quotes that would need
// shell-escaping otherwise — even though spawnSync shell:false avoids the
// shell, the tmp-file path is also more debuggable on failure).
function writeTmpBody(content, prefix = 'steward-pr-body-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, `body-${crypto.randomBytes(4).toString('hex')}.md`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// Create a draft PR.
//   opts.title    — PR title (string, required)
//   opts.body     — PR body (string, optional but recommended)
//   opts.base     — base branch (default: 'main')
//   opts.head     — head branch (required — typically plan.branch)
//   opts.repoRoot — repo path (required for cwd)
//
// Returns { ok, url?, error?, code? }. The URL is parsed from gh's stdout
// (gh pr create prints the PR URL on success).
function createDraftPR(opts = {}) {
  const { title, body = '', base = 'main', head, repoRoot, labels } = opts;

  if (!title || typeof title !== 'string') return { ok: false, code: 'PR_NO_TITLE', error: 'PR title required' };
  if (!head || typeof head !== 'string') return { ok: false, code: 'PR_NO_HEAD', error: 'PR head branch required' };
  if (head.startsWith('-') || base.startsWith('-')) return { ok: false, code: 'PR_INVALID_REF', error: 'flag-shaped branch ref' };
  if (!repoRoot) return { ok: false, code: 'PR_NO_REPO', error: 'repoRoot required' };
  // Sprint 2.1 R2 fix: optional labels[] array for marker labels like
  // `judge-disagreement` (autoresearch when forward+reverse judge picks
  // diverged). Filter to safe label names (no flag-shaped, no whitespace).
  const safeLabels = Array.isArray(labels)
    ? labels.filter((l) => typeof l === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(l))
    : [];

  if (!hasGhCli()) {
    return {
      ok: false,
      code: 'GH_CLI_MISSING',
      error: 'gh CLI not on PATH — install from https://cli.github.com or skip with --no-pr',
    };
  }

  const bodyFile = writeTmpBody(body);
  try {
    const args = [
      'pr', 'create',
      '--draft',
      '--title', title,
      '--body-file', bodyFile,
      '--base', base,
      '--head', head,
    ];
    for (const label of safeLabels) {
      args.push('--label', label);
    }
    const r = gh(repoRoot, args);

    if (!r.ok) {
      return {
        ok: false,
        code: 'PR_CREATE_FAILED',
        error: r.stderr || r.error || 'gh pr create exited non-zero',
        exitCode: r.exitCode,
      };
    }

    // gh pr create --draft prints the PR URL on stdout (typically last line)
    const url = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).pop() || null;
    return { ok: true, url };
  } finally {
    try { fs.unlinkSync(bodyFile); } catch { /* tmpfile cleanup best-effort */ }
  }
}

module.exports = {
  gh,
  hasGhCli,
  createDraftPR,
  DEFAULT_TIMEOUT_MS,
};
