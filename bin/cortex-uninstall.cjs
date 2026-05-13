#!/usr/bin/env node
// cortex-uninstall — clean removal of cortex-x from this machine.
//
// Defaults are conservative: removes the framework + cortex-owned skills +
// cortex-owned agents + source clone, BUT preserves $CORTEX_DATA_HOME
// (~/.cortex by default) which holds the operator's research / projects
// library / journal / insights — months of accumulated work. Set --purge
// to remove that too.
//
// Never touches:
//   ~/.claude/CLAUDE.md           operator's global memory
//   ~/.claude/settings.json       operator's hook config (cortex never wrote it)
//   ~/.claude/projects/           Claude Code's per-project state
//   anything outside ~/.claude/ and ~/.cortex/ and the source clone
//
// Flags:
//   --dry-run        list what would be removed, exit 0
//   --yes            skip interactive confirmation
//   --purge          also remove $CORTEX_DATA_HOME (user data — DESTRUCTIVE)
//   --backup         tarball $CORTEX_DATA_HOME to ~/cortex-data-backup-<ts>.tar.gz
//                    before removing (only relevant with --purge)
//   --keep-source    do NOT remove the cortex-x source clone (~/cortex-x)
//   --json           machine-readable plan/result (no destructive action
//                    unless combined with --yes)
//
// Exit codes:
//   0   success (or dry-run completed)
//   1   user-visible failure (path missing, refuse-to-run, etc.)
//   2   internal bug

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const HOME = os.homedir();
const CLAUDE_HOME = path.join(HOME, '.claude');
const SHARED = path.join(CLAUDE_HOME, 'shared');
const AGENTS_DIR = path.join(CLAUDE_HOME, 'agents');
const SKILLS_DIR = path.join(CLAUDE_HOME, 'skills');
const CORTEX_USER_YAML = path.join(CLAUDE_HOME, 'cortex', 'user.yaml');

// Skill names cortex-x installs (stable, hardcoded — names rarely change).
// Matches install.sh emit_* blocks. We content-check each before removing
// so we never trash a user-written skill that happens to share a name.
const CORTEX_SKILLS = ['cortex-init', 'cortex-help', 'audit', 'designer', 'start', 'test-audit'];

function readYamlBomSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function resolveCortexSource() {
  if (process.env.CORTEX_SOURCE) return path.normalize(process.env.CORTEX_SOURCE);
  try {
    const m = readYamlBomSafe(path.join(SHARED, 'cortex-source.yaml')).match(/^cortex_source:\s*(.+)$/m);
    if (m) return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
  } catch { /* fall through */ }
  return path.join(HOME, 'cortex-x');
}

function resolveCortexDataHome() {
  if (process.env.CORTEX_DATA_HOME) return path.normalize(process.env.CORTEX_DATA_HOME);
  try {
    const m = readYamlBomSafe(path.join(SHARED, 'cortex-source.yaml')).match(/^cortex_data_home:\s*(.+)$/m);
    if (m) return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
  } catch { /* fall through */ }
  return path.join(HOME, '.cortex');
}

function parseArgs(argv) {
  const args = {
    dryRun: false, yes: false, purge: false, backup: false,
    keepSource: false, json: false, help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--purge') args.purge = true;
    else if (a === '--backup') args.backup = true;
    else if (a === '--keep-source') args.keepSource = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`cortex-uninstall: unknown flag '${a}'. Use --help for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log('cortex-uninstall — clean removal of cortex-x from this machine');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-uninstall                conservative removal (keeps user data)');
  console.log('  cortex-uninstall --dry-run      show what would be removed, no action');
  console.log('  cortex-uninstall --yes          skip confirmation prompt');
  console.log('  cortex-uninstall --purge        ALSO remove ~/.cortex/ user data');
  console.log('  cortex-uninstall --backup       tarball ~/.cortex/ before --purge');
  console.log('  cortex-uninstall --keep-source  keep the ~/cortex-x source clone');
  console.log('  cortex-uninstall --json         machine-readable plan/result');
  console.log('');
  console.log('Never touches: ~/.claude/CLAUDE.md, ~/.claude/settings.json,');
  console.log('               ~/.claude/projects/, anything outside cortex namespaces.');
}

function fileSha256(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

function listSourceAgents(sourceDir) {
  // Cortex agent names = file basenames under agents/ in the source clone.
  const dir = path.join(sourceDir, 'agents');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
}

// A skill / agent is treated as cortex-owned only if either the source file
// is missing (we can't compare so we trust the path name AND the location)
// OR the installed file's sha256 matches the source's. Modified files are
// left alone — operator may have customized them.
function isCortexOwnedFile(installedPath, sourcePath) {
  if (!fs.existsSync(installedPath)) return false;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    // Source missing — fall back to "yes if path is one we hardcoded"
    return true;
  }
  return fileSha256(installedPath) === fileSha256(sourcePath);
}

function buildPlan(args) {
  const sourceDir = resolveCortexSource();
  const dataHome = resolveCortexDataHome();
  const sourceAvailable = fs.existsSync(sourceDir) && fs.existsSync(path.join(sourceDir, '.git'));

  const plan = {
    source_dir: sourceDir,
    source_present: fs.existsSync(sourceDir),
    data_home: dataHome,
    data_home_present: fs.existsSync(dataHome),
    remove_paths: [],
    skip_paths: [],
    warnings: [],
    purge: !!args.purge,
    keep_source: !!args.keepSource,
    backup: !!args.backup,
  };

  if (fs.existsSync(SHARED)) plan.remove_paths.push(SHARED);
  if (fs.existsSync(CORTEX_USER_YAML)) plan.remove_paths.push(CORTEX_USER_YAML);

  // Cortex skills — content-checked when source is present.
  for (const name of CORTEX_SKILLS) {
    const skillDir = path.join(SKILLS_DIR, name);
    if (!fs.existsSync(skillDir)) continue;
    const installedMd = path.join(skillDir, 'SKILL.md');
    const sourceMd = sourceAvailable
      ? path.join(sourceDir, 'shared', 'skills', name, 'SKILL.md')
      : null;
    if (isCortexOwnedFile(installedMd, sourceMd)) {
      plan.remove_paths.push(skillDir);
    } else {
      plan.skip_paths.push(skillDir);
      plan.warnings.push(`skill '${name}' looks user-modified (sha mismatch) — leaving in place`);
    }
  }

  // Cortex agents — only matching names.
  if (fs.existsSync(AGENTS_DIR)) {
    const sourceAgentNames = sourceAvailable ? listSourceAgents(sourceDir) : null;
    for (const fname of fs.readdirSync(AGENTS_DIR)) {
      if (!fname.endsWith('.md')) continue;
      const installedPath = path.join(AGENTS_DIR, fname);
      if (sourceAgentNames !== null && !sourceAgentNames.includes(fname)) {
        plan.skip_paths.push(installedPath);
        continue;
      }
      const sourcePath = sourceAvailable
        ? path.join(sourceDir, 'agents', fname)
        : null;
      if (isCortexOwnedFile(installedPath, sourcePath)) {
        plan.remove_paths.push(installedPath);
      } else {
        plan.skip_paths.push(installedPath);
        plan.warnings.push(`agent '${fname}' looks user-modified (sha mismatch) — leaving in place`);
      }
    }
  }

  // Source clone — opt-out via --keep-source.
  if (plan.source_present && !args.keepSource) {
    // Refuse to remove a dirty source clone — operator might have local work.
    if (sourceAvailable) {
      try {
        const status = execFileSync('git', ['status', '--porcelain'], {
          cwd: sourceDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (status.length > 0) {
          plan.skip_paths.push(sourceDir);
          plan.warnings.push(
            `source clone ${sourceDir} has uncommitted changes — refusing to remove (use --keep-source to skip or commit/stash first)`
          );
        } else {
          plan.remove_paths.push(sourceDir);
        }
      } catch {
        plan.skip_paths.push(sourceDir);
        plan.warnings.push(`could not git-status source clone ${sourceDir} — leaving in place`);
      }
    } else {
      // Not a git repo at all — still remove.
      plan.remove_paths.push(sourceDir);
    }
  }

  // User data — only with --purge.
  if (args.purge && plan.data_home_present) {
    plan.remove_paths.push(dataHome);
  }

  return plan;
}

function confirmInteractive(promptText) {
  // Non-TTY (CI / piped): refuse silent destructive uninstall. Operator must pass
  // --yes/-y explicitly to acknowledge in scripted contexts. Sprint 2.17.x audit
  // closed a piped-destructive gap where `echo y | cortex-uninstall --purge`
  // would bypass the prompt without explicit consent flag.
  if (!process.stdin.isTTY) return false;
  process.stdout.write(promptText);
  try {
    const buf = Buffer.alloc(8);
    const fd = fs.openSync('/dev/tty', 'r');
    let n = 0;
    try { n = fs.readSync(fd, buf, 0, 8, null); } catch { /* fall through */ }
    fs.closeSync(fd);
    const reply = buf.slice(0, n).toString('utf8').trim().toLowerCase();
    return reply === 'y' || reply === 'yes';
  } catch {
    return false;
  }
}

function backupDataHome(dataHome) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tarPath = path.join(HOME, `cortex-data-backup-${ts}.tar.gz`);
  // Use tar — present on macOS / Linux / WSL / Git Bash. On native Windows
  // PS, fall back to .zip via PowerShell Compress-Archive.
  if (process.platform === 'win32') {
    const zipPath = tarPath.replace(/\.tar\.gz$/, '.zip');
    const r = spawnSync('powershell', [
      '-NoProfile', '-Command',
      `Compress-Archive -Path "${dataHome}\\*" -DestinationPath "${zipPath}" -Force`,
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`backup zip failed: ${(r.stderr || '').trim()}`);
    return zipPath;
  }
  const r = spawnSync('tar', ['-czf', tarPath, '-C', path.dirname(dataHome), path.basename(dataHome)], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`backup tar failed: ${(r.stderr || '').trim()}`);
  return tarPath;
}

function removePath(p) {
  // Defensive: refuse to remove paths that are clearly NOT cortex-owned —
  // a programming-error guard. We only ever pass cortex-managed paths in,
  // but if something upstream breaks, this catches it.
  const safeRoots = [SHARED, AGENTS_DIR, SKILLS_DIR, CORTEX_USER_YAML, path.join(CLAUDE_HOME, 'cortex'), HOME];
  const containedByCortexNamespace =
    p.startsWith(SHARED) ||
    p.startsWith(AGENTS_DIR + path.sep) ||
    p.startsWith(SKILLS_DIR + path.sep) ||
    p === CORTEX_USER_YAML ||
    p === path.join(CLAUDE_HOME, 'cortex') ||
    p === resolveCortexSource() ||
    p === resolveCortexDataHome();
  if (!containedByCortexNamespace) {
    throw new Error(`refuse to remove non-cortex path: ${p}`);
  }
  // Also defensively refuse $HOME, $CLAUDE_HOME, root of FS.
  if (p === HOME || p === CLAUDE_HOME || p === '/' || p === path.parse(HOME).root) {
    throw new Error(`refuse to remove dangerous path: ${p}`);
  }
  fs.rmSync(p, { recursive: true, force: true });
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  const plan = buildPlan(args);

  if (args.json && args.dryRun) {
    console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...plan }, null, 2));
    return 0;
  }

  // Summary print.
  if (!args.json) {
    console.log('cortex-uninstall plan:');
    console.log(`  source clone:  ${plan.source_dir}${plan.source_present ? '' : ' (not present)'}`);
    console.log(`  user data:     ${plan.data_home} ${plan.purge ? '(WILL BE REMOVED)' : '(preserved)'}`);
    console.log('');
    console.log(`  Will remove ${plan.remove_paths.length} path(s):`);
    for (const p of plan.remove_paths) console.log(`    - ${p}`);
    if (plan.skip_paths.length > 0) {
      console.log(`  Skipping ${plan.skip_paths.length} path(s):`);
      for (const p of plan.skip_paths) console.log(`    - ${p}`);
    }
    if (plan.warnings.length > 0) {
      console.log('  Warnings:');
      for (const w of plan.warnings) console.log(`    ! ${w}`);
    }
    console.log('');
    console.log('  NEVER touched: ~/.claude/CLAUDE.md, ~/.claude/settings.json,');
    console.log('                 ~/.claude/projects/');
    console.log('');
  }

  if (args.dryRun) {
    if (!args.json) console.log('cortex-uninstall: dry-run, no destructive action taken.');
    return 0;
  }

  if (plan.remove_paths.length === 0) {
    if (!args.json) console.log('cortex-uninstall: nothing to remove (cortex-x not installed?).');
    if (args.json) console.log(JSON.stringify({ ok: true, mode: 'noop', ...plan }, null, 2));
    return 0;
  }

  if (!args.yes) {
    const prompt = plan.purge
      ? 'This will remove cortex-x AND your user data at ' + plan.data_home + '. Continue? [y/N] '
      : 'This will remove cortex-x (user data preserved). Continue? [y/N] ';
    if (!confirmInteractive(prompt)) {
      if (!args.json) console.log('cortex-uninstall: aborted.');
      return 0;
    }
  }

  let backupPath = null;
  if (args.backup && args.purge && plan.data_home_present) {
    try {
      backupPath = backupDataHome(plan.data_home);
      if (!args.json) console.log(`cortex-uninstall: backed up user data → ${backupPath}`);
    } catch (err) {
      console.error(`cortex-uninstall: backup failed: ${err.message}`);
      console.error('  refusing to proceed with --purge without successful backup.');
      return 1;
    }
  }

  const removed = [];
  const failures = [];
  for (const p of plan.remove_paths) {
    try {
      removePath(p);
      removed.push(p);
    } catch (err) {
      failures.push({ path: p, error: err.message });
    }
  }

  if (args.json) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      mode: 'removed',
      removed,
      failures,
      skipped: plan.skip_paths,
      backup_path: backupPath,
      warnings: plan.warnings,
    }, null, 2));
  } else {
    console.log(`cortex-uninstall: removed ${removed.length} path(s).`);
    if (failures.length > 0) {
      console.log(`cortex-uninstall: ${failures.length} failure(s):`);
      for (const f of failures) console.log(`    ! ${f.path}: ${f.error}`);
      return 1;
    }
    if (!plan.purge && plan.data_home_present) {
      console.log('');
      console.log(`  Your user data is preserved at: ${plan.data_home}`);
      console.log('  (research, projects library, journal, insights — months of work.)');
      console.log('  Remove with: cortex-uninstall --purge --backup');
    }
  }
  return failures.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('cortex-uninstall: internal error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

module.exports = {
  parseArgs,
  buildPlan,
  resolveCortexSource,
  resolveCortexDataHome,
  CORTEX_SKILLS,
};
