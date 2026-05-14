#!/usr/bin/env node
// cortex-update — pull latest cortex-x source + re-run install.{sh,ps1} on top
// of the running ~/.claude/ install. Matches the upgrade UX of bun/uv/rustup/
// mise/deno (single command, no manual cd + git pull + reinstall sequence).
//
// Resolution:
//   1. process.env.CORTEX_SOURCE        explicit override
//   2. ~/.claude/shared/cortex-source.yaml `cortex_source: <path>`
//   3. ~/cortex-x                       default install location
//
// Modes:
//   default        fetch + compare + (if behind) pull + re-run installer
//   --check        fetch + compare only, exit 0 if up-to-date, 10 if behind
//   --yes          skip the interactive confirmation prompt
//   --reinstall    skip git fetch/pull, just re-run installer from current HEAD
//   --json         machine-readable status (no installer run)
//
// Exit codes:
//   0   up-to-date OR upgrade applied successfully
//   10  --check mode and updates are available (caller can branch)
//   1   user-visible failure (bad source dir, git error, installer fail)
//   2   internal bug (programming error)
//
// Zero-dep. Node ≥18 required (built-in fetch is not used here; node ≥18 is
// the global cortex-x baseline). Spawns git + bash/pwsh via child_process.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { confirmInteractive } = require('./_lib/confirm.cjs');

function readYamlBomSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function resolveCortexSource() {
  if (process.env.CORTEX_SOURCE) return path.normalize(process.env.CORTEX_SOURCE);
  try {
    const yaml = readYamlBomSafe(
      path.join(os.homedir(), '.claude', 'shared', 'cortex-source.yaml')
    );
    const m = yaml.match(/^cortex_source:\s*(.+)$/m);
    if (m) return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
  } catch { /* fall through */ }
  return path.join(os.homedir(), 'cortex-x');
}

function parseArgs(argv) {
  const args = { check: false, yes: false, reinstall: false, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--reinstall') args.reinstall = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`cortex-update: unknown flag '${a}'. Use --help for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log('cortex-update — pull latest cortex-x source + re-run installer');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-update              fetch, compare, pull-if-behind, re-install');
  console.log('  cortex-update --check      just check; exit 10 if updates available');
  console.log('  cortex-update --yes        skip confirmation prompt');
  console.log('  cortex-update --reinstall  re-run installer without git pull');
  console.log('  cortex-update --json       machine-readable status (no install)');
  console.log('');
  console.log('Resolution: $CORTEX_SOURCE > cortex-source.yaml > ~/cortex-x');
  console.log('Override:   CORTEX_SOURCE=/path/to/cortex-x cortex-update');
}

function gitRead(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = (err && err.stderr) ? err.stderr.toString().trim() : '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`);
  }
}

function isClean(cwd) {
  // --porcelain emits nothing when working tree is clean (incl. untracked
  // files unless explicitly counted — we keep that strict default).
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

function getCurrentBranch(cwd) {
  // Detached HEAD returns 'HEAD' literally — caller treats as non-upgradeable.
  return gitRead(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function getCommitsBehind(cwd, localRef, remoteRef) {
  // rev-list A..B counts commits in B not in A — i.e. commits we need to pull.
  const out = gitRead(cwd, ['rev-list', '--count', `${localRef}..${remoteRef}`]);
  return parseInt(out, 10) || 0;
}

function getCommitsAhead(cwd, localRef, remoteRef) {
  const out = gitRead(cwd, ['rev-list', '--count', `${remoteRef}..${localRef}`]);
  return parseInt(out, 10) || 0;
}

function listCommitsBehind(cwd, localRef, remoteRef, limit = 10) {
  const out = gitRead(cwd, [
    'log', '--oneline', '--no-decorate', `-n${limit}`,
    `${localRef}..${remoteRef}`,
  ]);
  return out.split('\n').filter(Boolean);
}

function fetchOrigin(cwd, branch) {
  // Non-interactive fetch with stderr captured. We surface failure to caller —
  // network failure should be visible, not silently swallowed.
  const result = spawnSync('git', ['fetch', '--quiet', 'origin', branch], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`git fetch failed: ${stderr || 'unknown error'}`);
  }
}

function pullFastForward(cwd, branch) {
  const result = spawnSync('git', ['pull', '--ff-only', '--quiet', 'origin', branch], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`git pull --ff-only failed: ${stderr || 'unknown error'}\nResolve manually: cd "${cwd}" && git status`);
  }
}

function runInstaller(sourceDir) {
  // Pick install.sh on POSIX, install.ps1 on Win32. Inherit the parent env
  // so CORTEX_LANGUAGE / CORTEX_PROFILE / CORTEX_NO_UPDATE preferences carry
  // through. CORTEX_NO_UPDATE=1 is forced to prevent installer's own
  // beta-channel auto-pull (we already pulled).
  const env = { ...process.env, CORTEX_NO_UPDATE: '1' };
  if (process.platform === 'win32') {
    const ps1 = path.join(sourceDir, 'install.ps1');
    if (!fs.existsSync(ps1)) throw new Error(`installer missing: ${ps1}`);
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { cwd: sourceDir, stdio: 'inherit', env }
    );
    if (result.status !== 0) throw new Error(`install.ps1 exited ${result.status}`);
  } else {
    const sh = path.join(sourceDir, 'install.sh');
    if (!fs.existsSync(sh)) throw new Error(`installer missing: ${sh}`);
    const result = spawnSync('bash', [sh], {
      cwd: sourceDir, stdio: 'inherit', env,
    });
    if (result.status !== 0) throw new Error(`install.sh exited ${result.status}`);
  }
}

// Sprint 2.28.3 R2 H-7 SSOT migration: confirmInteractive moved to
// bin/_lib/confirm.cjs. Behavior shift documented:
//
//  - non-TTY → false (was: true). CI / cron lanes must pass `--yes`
//    explicitly. No CI workflow currently invokes cortex-update — verified
//    by grep across .github/workflows/ at migration time.
//  - empty reply → false (was: true). Prompt text aligned `[Y/n]` → `[y/N]`.
//  - Aligns with cortex-hooks-register / claude-md-augment /
//    permissions-register / uninstall — single source of truth.

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  const sourceDir = resolveCortexSource();
  if (!fs.existsSync(sourceDir)) {
    console.error(`cortex-update: source dir not found: ${sourceDir}`);
    console.error('  Set CORTEX_SOURCE or clone cortex-x to the expected path.');
    return 1;
  }
  const gitDir = path.join(sourceDir, '.git');
  if (!fs.existsSync(gitDir)) {
    console.error(`cortex-update: not a git repo: ${sourceDir}`);
    console.error('  cortex-x source must be a git clone to support update.');
    return 1;
  }

  // --reinstall short-circuit: skip git entirely.
  if (args.reinstall) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, mode: 'reinstall', source: sourceDir }, null, 2));
      return 0;
    }
    console.log(`cortex-update: --reinstall (skip git pull, re-run installer from current HEAD)`);
    try {
      runInstaller(sourceDir);
      console.log('cortex-update: reinstall complete.');
      return 0;
    } catch (err) {
      console.error(`cortex-update: ${err.message}`);
      return 1;
    }
  }

  let branch;
  try { branch = getCurrentBranch(sourceDir); } catch (err) {
    console.error(`cortex-update: ${err.message}`);
    return 1;
  }
  if (branch === 'HEAD') {
    console.error(`cortex-update: ${sourceDir} is in detached HEAD state.`);
    console.error('  cortex-update cannot fast-forward from a detached HEAD.');
    console.error('  Switch to a branch: cd "' + sourceDir + '" && git checkout main');
    return 1;
  }

  if (!isClean(sourceDir)) {
    console.error(`cortex-update: ${sourceDir} has uncommitted changes.`);
    console.error('  Commit or stash them before running cortex-update.');
    console.error('  Or use --reinstall to skip git pull and just re-run installer.');
    return 1;
  }

  try { fetchOrigin(sourceDir, branch); } catch (err) {
    console.error(`cortex-update: ${err.message}`);
    console.error('  Check network / GitHub auth. cortex-update aborts cleanly — your install is unchanged.');
    return 1;
  }

  const remoteRef = `origin/${branch}`;
  let behind, ahead;
  try {
    behind = getCommitsBehind(sourceDir, branch, remoteRef);
    ahead = getCommitsAhead(sourceDir, branch, remoteRef);
  } catch (err) {
    console.error(`cortex-update: ${err.message}`);
    return 1;
  }

  if (args.json) {
    const status = {
      ok: true,
      source: sourceDir,
      branch,
      behind,
      ahead,
      up_to_date: behind === 0,
    };
    if (behind > 0) {
      status.preview_commits = listCommitsBehind(sourceDir, branch, remoteRef, 10);
    }
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  if (ahead > 0) {
    console.error(`cortex-update: local branch '${branch}' is ${ahead} commit(s) ahead of origin.`);
    console.error('  cortex-update only fast-forwards. Push your changes or use --reinstall.');
    return 1;
  }

  if (behind === 0) {
    console.log(`cortex-update: already up to date (${branch} @ ${remoteRef}).`);
    return 0;
  }

  if (args.check) {
    console.log(`cortex-update: ${behind} commit(s) available on ${remoteRef}:`);
    for (const line of listCommitsBehind(sourceDir, branch, remoteRef, 10)) {
      console.log(`  ${line}`);
    }
    console.log('  Run `cortex-update` (without --check) to apply.');
    return 10;
  }

  console.log(`cortex-update: ${behind} commit(s) available on ${remoteRef}:`);
  for (const line of listCommitsBehind(sourceDir, branch, remoteRef, 10)) {
    console.log(`  ${line}`);
  }
  console.log('');

  if (!args.yes) {
    const ok = confirmInteractive('Apply update + re-run installer? [y/N] ');
    if (!ok) {
      console.log('cortex-update: aborted by user.');
      return 0;
    }
  }

  try { pullFastForward(sourceDir, branch); } catch (err) {
    console.error(`cortex-update: ${err.message}`);
    return 1;
  }
  console.log(`cortex-update: pulled ${behind} commit(s). Re-running installer...`);
  console.log('');

  try {
    runInstaller(sourceDir);
  } catch (err) {
    console.error(`cortex-update: installer failed: ${err.message}`);
    console.error('  Your git source is updated, but ~/.claude/ may be partially synced.');
    console.error('  Re-run: cortex-update --reinstall');
    return 1;
  }

  console.log('');
  console.log('cortex-update: complete.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('cortex-update: internal error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

module.exports = { resolveCortexSource, parseArgs };
