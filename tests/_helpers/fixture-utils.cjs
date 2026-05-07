// fixture-utils.cjs — helpers for building test fixture trees.
//
// Two flavors:
//   buildStageFixture(name, commitCount)   — initialize a git repo with N
//                                             synthetic commits (low-level
//                                             plumbing, no global git config
//                                             mutation, idempotent).
//   ensureFixtureClean(name)               — wipe transient state inside a
//                                             fixture (.git/, node_modules/)
//                                             without touching tracked files.
//
// All operations are scoped under tests/fixtures/<name>/ and refuse to act
// outside that prefix.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');

function fixturePath(name) {
  const abs = path.join(FIXTURES_ROOT, name);
  // safety: never escape FIXTURES_ROOT
  if (!abs.startsWith(FIXTURES_ROOT + path.sep) && abs !== FIXTURES_ROOT) {
    throw new Error(`Fixture path escape attempt: ${name}`);
  }
  return abs;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Hard-coded local identity — never touches user's global git config.
      GIT_AUTHOR_NAME: 'cortex-x test',
      GIT_AUTHOR_EMAIL: 'test@cortex-x.local',
      GIT_COMMITTER_NAME: 'cortex-x test',
      GIT_COMMITTER_EMAIL: 'test@cortex-x.local',
      // Deterministic dates so commit history is reproducible across machines.
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  });
}

function buildStageFixture(name, commitCount) {
  const dir = fixturePath(name);
  if (!fs.existsSync(dir)) {
    throw new Error(`Stage fixture directory does not exist: ${dir}. Create it with at least a package.json first.`);
  }

  const dotGit = path.join(dir, '.git');
  if (fs.existsSync(dotGit)) {
    // already initialized — count commits, decide whether to extend or reset
    const existingCount = countCommits(dir);
    if (existingCount === commitCount) return; // idempotent — nothing to do
    if (existingCount > commitCount) {
      // user wants fewer commits — wipe and rebuild
      fs.rmSync(dotGit, { recursive: true, force: true });
    } else {
      // existing < target → extend
      const seed = fs.readFileSync(path.join(dir, '.cortex-stage-seed')).toString();
      const baseSeed = parseInt(seed, 10);
      for (let i = existingCount; i < commitCount; i++) {
        appendSyntheticCommit(dir, baseSeed + i);
      }
      return;
    }
  }

  // fresh init
  git(dir, ['init', '-q', '--initial-branch=main']);
  fs.writeFileSync(path.join(dir, '.cortex-stage-seed'), String(Date.now()), 'utf8');

  for (let i = 0; i < commitCount; i++) {
    appendSyntheticCommit(dir, i);
  }
}

function appendSyntheticCommit(dir, n) {
  const ledger = path.join(dir, '.cortex-stage-ledger');
  fs.appendFileSync(ledger, `synthetic commit ${n}\n`, 'utf8');
  git(dir, ['add', '.cortex-stage-ledger']);
  git(dir, ['commit', '-q', '-m', `synthetic commit ${n}`]);
}

function countCommits(dir) {
  try {
    const out = git(dir, ['rev-list', '--count', 'HEAD']);
    return parseInt(out.trim(), 10);
  } catch {
    return 0;
  }
}

function ensureFixtureClean(name) {
  const dir = fixturePath(name);
  for (const transient of ['.git', 'node_modules']) {
    const p = path.join(dir, transient);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  for (const transient of ['.cortex-stage-seed', '.cortex-stage-ledger']) {
    const p = path.join(dir, transient);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

module.exports = {
  FIXTURES_ROOT,
  fixturePath,
  buildStageFixture,
  ensureFixtureClean,
  countCommits,
};
