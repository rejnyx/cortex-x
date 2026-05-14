// worktree-guard.cjs — Sprint 2.30 — refuse to run Steward in a non-primary
// git worktree.
//
// Why: Steward auto-commits + opens PRs against `main`. If an operator
// forgets to `cd` back to the primary worktree before a Steward cron lane
// fires (or before manually running `cortex-steward dry-run`), Steward
// would atomically commit + push from inside `.claude/worktrees/feat-X/`,
// landing the commit on `worktree-feat-X` instead of `main`. Subsequent
// `gh pr create --draft` opens a PR against the WRONG branch, surfacing
// only via failed nightly CI lanes.
//
// This guard runs BEFORE `git rev-parse` lock acquisition. Refuses with
// STEWARD_WORKTREE_DENIED unless STEWARD_ALLOW_WORKTREE=1 explicitly opts
// the operator in (dogfood / advanced use only).
//
// Contract:
//   - returns { ok: true, primary, current } when running in primary worktree
//   - returns { ok: false, code: 'STEWARD_WORKTREE_DENIED', primary, current,
//                bypassEnv: 'STEWARD_ALLOW_WORKTREE' } when in secondary
//   - returns { ok: false, code: 'STEWARD_WORKTREE_NO_GIT' } when cwd isn't
//     inside a git repo at all (caller decides how to handle)
//
// Caller passes opts.cwd (defaults to process.cwd()) + opts.env (defaults
// to process.env) for testability.

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// R2 round-2 fix (correctness HIGH + edge HIGH): canonicalize via realpath so
// macOS /private/{var,tmp} symlink drift doesn't produce a false DENIED when
// the operator is in the primary worktree. Falls back to syntactic resolve
// if the path doesn't exist (best-effort).
function canonicalize(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
  } catch (err) {
    const e = new Error(err.message || 'git invocation failed');
    e.cause = err;
    e.gitArgs = args;
    throw e;
  }
}

// Parse `git worktree list --porcelain` into [{path, branch, detached, primary}].
// R2 round-2 fix (correctness HIGH): detached-HEAD worktrees emit no `branch`
// line but a `detached` line. Track explicitly so future callers don't deref
// a null .branch.
function parseWorktreeList(porcelain) {
  const entries = [];
  let current = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), branch: null, detached: false };
    } else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      if (current) current.detached = true;
    } else if (line === '' || line === '\n') {
      if (current) { entries.push(current); current = null; }
    }
  }
  if (current) entries.push(current);
  // The first worktree returned by `git worktree list` is the primary
  // (the main repository's working tree).
  if (entries.length > 0) entries[0].primary = true;
  return entries;
}

function checkWorktree(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;

  // Operator escape hatch.
  if (env.STEWARD_ALLOW_WORKTREE === '1') {
    return { ok: true, bypassed: true, current: cwd };
  }

  // R2 round-2 fix (edge HIGH): distinct error for non-existent cwd vs
  // missing git binary. Previously both collapsed into NO_GIT, misleading
  // operators who typo'd --repo-root.
  if (!fs.existsSync(cwd)) {
    return { ok: false, code: 'STEWARD_WORKTREE_BAD_CWD', current: cwd };
  }

  let toplevel;
  try {
    toplevel = runGit(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    return { ok: false, code: 'STEWARD_WORKTREE_NO_GIT', current: cwd };
  }

  let listOutput;
  try {
    listOutput = runGit(['worktree', 'list', '--porcelain'], cwd);
  } catch {
    // Worktree subcommand missing on ancient git? Treat as primary (single
    // worktree). Fail open — Steward proceeds; if there really are multiple
    // worktrees we'd notice via other means.
    return { ok: true, current: toplevel, primary: toplevel };
  }
  const entries = parseWorktreeList(listOutput);
  const primary = entries.find((e) => e.primary);
  if (!primary) {
    return { ok: true, current: toplevel, primary: toplevel };
  }

  // Compare via realpath-canonicalized paths. On macOS /private/var vs /var
  // symlinks would produce false DENIED if compared via syntactic resolve.
  const currentResolved = canonicalize(toplevel);
  const primaryResolved = canonicalize(primary.path);
  if (currentResolved === primaryResolved) {
    return { ok: true, current: currentResolved, primary: primaryResolved };
  }
  return {
    ok: false,
    code: 'STEWARD_WORKTREE_DENIED',
    current: currentResolved,
    primary: primaryResolved,
    bypassEnv: 'STEWARD_ALLOW_WORKTREE',
    message: `Steward refuses to run in a secondary worktree (${currentResolved}). ` +
             `Primary is at ${primaryResolved}. Set STEWARD_ALLOW_WORKTREE=1 to override.`,
  };
}

module.exports = { checkWorktree, parseWorktreeList };
