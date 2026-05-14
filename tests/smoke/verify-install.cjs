#!/usr/bin/env node
// verify-install.cjs — single source of truth for "is cortex-x correctly installed?"
//
// Called from three places:
//   1. install.sh           — final step, exit 1 = abort install
//   2. install.ps1          — same, on Windows
//   3. .github/workflows/install-smoke.yml — CI matrix (linux, macos, win × bash/pwsh/ps5.1)
//   4. integration tests    — tests/integration/install-roundtrip.test.cjs
//
// Usage:
//   node tests/smoke/verify-install.cjs                # plain text, ✓/✗, color if TTY
//   node tests/smoke/verify-install.cjs --json         # machine-readable
//   node tests/smoke/verify-install.cjs --strict       # fail on warnings, not just blockers
//   node tests/smoke/verify-install.cjs --quiet        # only output on failure
//
// Exit codes:
//   0 — all checks pass
//   1 — one or more validation failures (cortex-x install is broken)
//   2 — verifier itself crashed (bug in verify-install.cjs)
//
// Design constraint: zero deps, std-only. Runs on the same Node engine the
// rest of cortex-x targets (>=22). Must work cross-platform (Linux, macOS,
// Windows native + Git Bash + pwsh). Never spawns subprocesses, never reads
// network, never mutates fs.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveCortexDataHome } = require('../../tools/lib/resolve-cortex-home.cjs');

// ── argv parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FLAG_JSON = args.includes('--json');
const FLAG_STRICT = args.includes('--strict');
const FLAG_QUIET = args.includes('--quiet');

// ── output helpers ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY === true;
const useUnicode = isTTY && process.platform !== 'win32' || process.env.TERM_PROGRAM === 'WindowsTerminal' || process.env.WT_SESSION;
const useColor = isTTY && !process.env.NO_COLOR;

const sym = useUnicode
  ? { pass: '✓', fail: '✗', warn: '⚠' }
  : { pass: '[OK]', fail: '[FAIL]', warn: '[WARN]' };

const color = useColor
  ? {
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
    }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s };

// ── result accumulator ──────────────────────────────────────────────────────
const checks = [];
function pushCheck({ id, severity, status, message, expected, actual }) {
  checks.push({ id, severity, status, message, expected, actual });
}

// ── individual checks ───────────────────────────────────────────────────────
// Resolve home directory respecting test/CI env overrides.
// On Windows, os.homedir() returns USERPROFILE — but install.sh + the
// install-roundtrip integration test set HOME to an isolated tmpdir to
// avoid polluting the user's real ~/.claude/. We honor HOME first so the
// verifier checks the SAME home the installer wrote to.
//
// Precedence: HOME (explicit, set by tests/install) > USERPROFILE (Windows
// native) > os.homedir() fallback.
function resolveHome() {
  if (process.env.HOME && fs.existsSync(process.env.HOME)) return process.env.HOME;
  if (process.platform === 'win32' && process.env.USERPROFILE && fs.existsSync(process.env.USERPROFILE)) {
    return process.env.USERPROFILE;
  }
  return os.homedir();
}
const HOME = resolveHome();
const CLAUDE_HOME = path.join(HOME, '.claude');
const SHARED = path.join(CLAUDE_HOME, 'shared');
const DATA_HOME = resolveCortexDataHome();

function checkFileExists(id, p, severity = 'blocker') {
  const exists = fs.existsSync(p) && fs.statSync(p).isFile();
  pushCheck({
    id,
    severity,
    status: exists ? 'pass' : 'fail',
    message: exists ? `file present: ${p}` : `MISSING file: ${p}`,
    expected: 'file exists',
    actual: exists ? 'present' : 'absent',
  });
}

function checkDirExists(id, p, severity = 'blocker') {
  const exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
  pushCheck({
    id,
    severity,
    status: exists ? 'pass' : 'fail',
    message: exists ? `directory present: ${p}` : `MISSING directory: ${p}`,
    expected: 'directory exists',
    actual: exists ? 'present' : 'absent',
  });
}

function checkMinCount(id, dir, minCount, label, severity = 'blocker') {
  let actualCount = 0;
  try {
    actualCount = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    actualCount = 0;
  }
  const passed = actualCount >= minCount;
  pushCheck({
    id,
    severity,
    status: passed ? 'pass' : 'fail',
    message: passed
      ? `${label}: ${actualCount} items in ${dir} (>= ${minCount})`
      : `${label}: ${actualCount} items in ${dir} (expected >= ${minCount})`,
    expected: `>= ${minCount}`,
    actual: actualCount,
  });
}

function readYamlBomSafe(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function checkYamlField(id, yamlPath, requiredField, severity = 'blocker') {
  if (!fs.existsSync(yamlPath)) {
    pushCheck({
      id,
      severity,
      status: 'fail',
      message: `YAML file missing — cannot check field ${requiredField}: ${yamlPath}`,
      expected: `${requiredField}: <value>`,
      actual: 'file absent',
    });
    return;
  }
  const content = readYamlBomSafe(yamlPath);
  const re = new RegExp('^' + requiredField + ':\\s*(.+)$', 'm');
  const match = content.match(re);
  pushCheck({
    id,
    severity,
    status: match ? 'pass' : 'fail',
    message: match
      ? `${yamlPath} has ${requiredField}: ${match[1].trim()}`
      : `${yamlPath} missing required field: ${requiredField}`,
    expected: `${requiredField}: <value>`,
    actual: match ? match[1].trim() : 'absent',
  });
}

function checkSourceMirror(id, label, severity = 'blocker') {
  // Verify that the count of files in the cortex-x source repo's agents/
  // matches ~/.claude/agents/. Catches "copy failed silently mid-stream"
  // (which is exactly what field test #5 hit on 2026-05-07).
  //
  // Source resolution: try cortex-source.yaml first, fall back to common
  // dev paths.
  let sourceRoot = null;
  try {
    const yaml = readYamlBomSafe(path.join(SHARED, 'cortex-source.yaml'));
    const m = yaml.match(/^cortex_source:\s*(.+)$/m);
    if (m) sourceRoot = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }

  if (!sourceRoot || !fs.existsSync(sourceRoot)) {
    pushCheck({
      id,
      severity: 'warning',
      status: 'skipped',
      message: `${label}: cortex-x source dir not resolvable from cortex-source.yaml — skipping mirror check`,
      expected: 'mirror check',
      actual: 'skipped',
    });
    return;
  }

  const sourceAgents = path.join(sourceRoot, 'agents');
  const installedAgents = path.join(CLAUDE_HOME, 'agents');
  if (!fs.existsSync(sourceAgents) || !fs.existsSync(installedAgents)) {
    pushCheck({
      id,
      severity,
      status: 'fail',
      message: `${label}: source or installed agents/ missing`,
      expected: 'both dirs present',
      actual: `source ${fs.existsSync(sourceAgents) ? 'OK' : 'MISSING'}, installed ${fs.existsSync(installedAgents) ? 'OK' : 'MISSING'}`,
    });
    return;
  }

  const sourceCount = fs.readdirSync(sourceAgents).filter((f) => f.endsWith('.md')).length;
  const installedCount = fs.readdirSync(installedAgents).filter((f) => f.endsWith('.md')).length;
  const ok = installedCount >= sourceCount;
  pushCheck({
    id,
    severity,
    status: ok ? 'pass' : 'fail',
    message: ok
      ? `${label}: ${installedCount} installed >= ${sourceCount} in source`
      : `${label}: ${installedCount} installed < ${sourceCount} in source — copy step lost ${sourceCount - installedCount} agent(s)`,
    expected: `>= ${sourceCount}`,
    actual: installedCount,
  });
}

// ── all checks ──────────────────────────────────────────────────────────────
function runChecks() {
  // Critical files (~/.claude/shared/)
  checkFileExists('shared.cortex-source.yaml', path.join(SHARED, 'cortex-source.yaml'));
  checkFileExists('shared.prompts.new-project', path.join(SHARED, 'prompts', 'new-project.md'));
  checkFileExists('shared.prompts.existing-project-audit', path.join(SHARED, 'prompts', 'existing-project-audit.md'));
  checkFileExists('shared.prompts.cortex-doctor', path.join(SHARED, 'prompts', 'cortex-doctor.md'));
  checkFileExists('shared.skills.cortex-init', path.join(SHARED, 'skills', 'cortex-init', 'SKILL.md'));
  checkFileExists('shared.standards.rule-1', path.join(SHARED, 'standards', 'RULE-1.md'));
  checkFileExists('shared.agents.synthesizer', path.join(SHARED, 'agents', 'synthesizer.md'));
  checkFileExists('shared.agents.planner', path.join(SHARED, 'agents', 'planner.md'));
  checkFileExists('shared.hooks.session-start', path.join(SHARED, 'hooks', 'session-start.cjs'));
  checkFileExists('shared.hooks.block-destructive', path.join(SHARED, 'hooks', 'block-destructive.cjs'));
  // Tier 4 — additional critical hooks Hermes runtime depends on
  checkFileExists('shared.hooks.pre-compact', path.join(SHARED, 'hooks', 'pre-compact.cjs'));
  checkFileExists('shared.hooks.auto-orchestrate', path.join(SHARED, 'hooks', 'auto-orchestrate.cjs'));
  checkFileExists('shared.hooks.pre-tool-use', path.join(SHARED, 'hooks', 'pre-tool-use.cjs'));
  checkFileExists('shared.hooks.post-tool-use', path.join(SHARED, 'hooks', 'post-tool-use.cjs'));

  // User-discoverable agents (Claude Code reads ~/.claude/agents/, NOT ~/.claude/shared/agents/)
  // Field test #5 caught this: install copied to staging only, default agents
  // were invisible at runtime.
  checkFileExists('user.agents.blind-hunter', path.join(CLAUDE_HOME, 'agents', 'blind-hunter.md'));
  checkFileExists('user.agents.security-auditor', path.join(CLAUDE_HOME, 'agents', 'security-auditor.md'));
  checkFileExists('user.skills.cortex-init', path.join(CLAUDE_HOME, 'skills', 'cortex-init', 'SKILL.md'));

  // Sprint LR.B+ (2026-05-12) — these skills must promote to ~/.claude/skills/
  // or they're invisible as slash commands. Claude Code only auto-loads from
  // this exact path (NOT from ~/.claude/shared/skills/).
  checkFileExists('user.skills.cortex-help', path.join(CLAUDE_HOME, 'skills', 'cortex-help', 'SKILL.md'));
  checkFileExists('user.skills.audit', path.join(CLAUDE_HOME, 'skills', 'audit', 'SKILL.md'));
  checkFileExists('user.skills.designer', path.join(CLAUDE_HOME, 'skills', 'designer', 'SKILL.md'));
  checkFileExists('user.skills.start', path.join(CLAUDE_HOME, 'skills', 'start', 'SKILL.md'));
  // Sprint 2.24 — /cortex-goal slash-skill (plan-first wrapper for native /goal).
  checkFileExists('user.skills.cortex-goal', path.join(CLAUDE_HOME, 'skills', 'cortex-goal', 'SKILL.md'), 'warning');

  // Sprint LR.B+ — cortex-capabilities CLI shim. Without this, /cortex-help
  // can't surface the registry on a stranger's machine because the
  // implementation lives only in the source repo.
  checkFileExists('shared.bin.cortex-capabilities', path.join(SHARED, 'bin', 'cortex-capabilities'), 'warning');

  // Sprint 2.8.1 + 3.0 v0/v1/v2 + 3.1 v0 + 3.2 v0/v1 — operator CLI delegation
  // shims (added 2026-05-13 afternoon). Same warning severity — these are
  // operator-facing convenience, not load-bearing for /cortex-help.
  checkFileExists('shared.bin.cortex-propose-skill',  path.join(SHARED, 'bin', 'cortex-propose-skill'),  'warning');
  checkFileExists('shared.bin.cortex-lessons-search', path.join(SHARED, 'bin', 'cortex-lessons-search'), 'warning');
  checkFileExists('shared.bin.cortex-evolve-ab',      path.join(SHARED, 'bin', 'cortex-evolve-ab'),      'warning');
  checkFileExists('shared.bin.cortex-export-lessons', path.join(SHARED, 'bin', 'cortex-export-lessons'), 'warning');
  checkFileExists('shared.bin.cortex-doc-audit',      path.join(SHARED, 'bin', 'cortex-doc-audit'),      'warning');
  checkFileExists('shared.bin.cortex-wiki-consolidate', path.join(SHARED, 'bin', 'cortex-wiki-consolidate'), 'warning');
  checkFileExists('shared.bin.cortex-update',         path.join(SHARED, 'bin', 'cortex-update'),         'warning');
  checkFileExists('shared.bin.cortex-uninstall',      path.join(SHARED, 'bin', 'cortex-uninstall'),      'warning');
  checkFileExists('shared.bin.cortex-hooks-register', path.join(SHARED, 'bin', 'cortex-hooks-register'), 'warning');
  checkFileExists('shared.bin.cortex-claude-md-augment', path.join(SHARED, 'bin', 'cortex-claude-md-augment'), 'warning');
  checkFileExists('shared.bin.cortex-permissions-register', path.join(SHARED, 'bin', 'cortex-permissions-register'), 'warning');
  checkFileExists('shared.bin.cortex-doctor',         path.join(SHARED, 'bin', 'cortex-doctor'),         'warning');
  // Sprint 2.22 / 2.25 — three CLIs shipped 2026-05-14 (skill-validate / dream / insights).
  checkFileExists('shared.bin.cortex-skill-validate', path.join(SHARED, 'bin', 'cortex-skill-validate'), 'warning');
  checkFileExists('shared.bin.cortex-dream',          path.join(SHARED, 'bin', 'cortex-dream'),          'warning');
  checkFileExists('shared.bin.cortex-insights',       path.join(SHARED, 'bin', 'cortex-insights'),       'warning');

  // Cortex-source.yaml integrity (Sprint 1.6 contract)
  checkYamlField('shared.cortex-source.cortex_source', path.join(SHARED, 'cortex-source.yaml'), 'cortex_source');
  checkYamlField('shared.cortex-source.cortex_data_home', path.join(SHARED, 'cortex-source.yaml'), 'cortex_data_home');

  // Min-count gates
  checkMinCount('shared.standards.count', path.join(SHARED, 'standards'), 20, 'standards');
  checkMinCount('shared.prompts.count', path.join(SHARED, 'prompts'), 10, 'prompts');
  checkMinCount('shared.agents.count', path.join(SHARED, 'agents'), 5, 'agents (staging)');
  checkMinCount('shared.hooks.count', path.join(SHARED, 'hooks'), 5, 'hooks');
  checkMinCount('shared.skills.count', path.join(SHARED, 'skills'), 3, 'skills');
  checkMinCount('user.agents.count', path.join(CLAUDE_HOME, 'agents'), 5, 'agents (user-discoverable)');

  // Source-to-installed mirror check (catches partial copies)
  checkSourceMirror('mirror.agents', 'agents source-to-installed mirror');

  // Sprint 1.6 user-data home
  checkDirExists('data.research', path.join(DATA_HOME, 'research'));
  checkDirExists('data.projects', path.join(DATA_HOME, 'projects'));
  checkDirExists('data.insights.proposals', path.join(DATA_HOME, 'insights', 'proposals'));
  checkDirExists('data.journal', path.join(DATA_HOME, 'journal'));
  checkDirExists('data.evals', path.join(DATA_HOME, 'evals'));

  // bin/ helpers (~/.claude/shared/bin/) — soft check, severity warning
  checkFileExists('shared.bin.cortex-gap-report', path.join(SHARED, 'bin', 'cortex-gap-report.cjs'), 'warning');
  checkFileExists('shared.bin.cortex-bootstrap', path.join(SHARED, 'bin', 'cortex-bootstrap.cjs'), 'warning');
  checkFileExists('shared.bin.cortex-migrate-data.sh', path.join(SHARED, 'bin', 'cortex-migrate-data.sh'), 'warning');
  // Sprint 1.7.3 — cortex-steward shim on PATH (delegates to $CORTEX_ROOT/bin/cortex-steward.cjs).
  // Both shims must exist so cortex-steward works from bash + pwsh after install.
  checkFileExists('shared.bin.cortex-hermes', path.join(SHARED, 'bin', 'cortex-steward'), 'warning');
  checkFileExists('shared.bin.cortex-steward.ps1', path.join(SHARED, 'bin', 'cortex-steward.ps1'), 'warning');
  // Sprint 1.7.4 — user identity captured at install (~/.claude/cortex/user.yaml).
  // Templates + session-start hook read this to personalize output. Always
  // written by install (even with empty fields), so missing file = install bug.
  checkFileExists('cortex.user.yaml', path.join(CLAUDE_HOME, 'cortex', 'user.yaml'), 'warning');

  // Tier 3 — tools/ (audit output validator + lib/) — invoked by cortex-doctor
  checkFileExists('shared.tools.verify-audit-output', path.join(SHARED, 'tools', 'verify-audit-output.cjs'), 'warning');
  checkFileExists('shared.tools.lib.resolve-cortex-home', path.join(SHARED, 'tools', 'lib', 'resolve-cortex-home.cjs'), 'warning');
  // Tier 5 — prompt + skill validators
  checkFileExists('shared.tools.verify-prompts', path.join(SHARED, 'tools', 'verify-prompts.cjs'), 'warning');
  checkFileExists('shared.tools.verify-skills', path.join(SHARED, 'tools', 'verify-skills.cjs'), 'warning');
  checkFileExists('shared.tools.verify-standards', path.join(SHARED, 'tools', 'verify-standards.cjs'), 'warning');
}

// ── reporting ───────────────────────────────────────────────────────────────
function summarize() {
  const blockers = checks.filter((c) => c.severity === 'blocker' && c.status === 'fail');
  const warnings = checks.filter((c) => c.severity === 'warning' && c.status === 'fail');
  const passes = checks.filter((c) => c.status === 'pass');
  const skipped = checks.filter((c) => c.status === 'skipped');

  let exitCode = 0;
  if (blockers.length > 0) exitCode = 1;
  if (FLAG_STRICT && warnings.length > 0) exitCode = 1;

  return { blockers, warnings, passes, skipped, exitCode };
}

function reportPlain({ blockers, warnings, passes, skipped, exitCode }) {
  if (FLAG_QUIET && exitCode === 0) return;

  if (!FLAG_QUIET) {
    process.stdout.write(`cortex-x install verification\n`);
    process.stdout.write(color.dim(`  CLAUDE_HOME:      ${CLAUDE_HOME}\n`));
    process.stdout.write(color.dim(`  CORTEX_DATA_HOME: ${DATA_HOME}\n`));
    process.stdout.write(`\n`);
  }

  for (const c of checks) {
    if (FLAG_QUIET && c.status === 'pass') continue;
    const symbol =
      c.status === 'pass' ? color.green(sym.pass)
      : c.status === 'skipped' ? color.dim(sym.warn)
      : c.severity === 'warning' ? color.yellow(sym.warn)
      : color.red(sym.fail);
    process.stdout.write(`  ${symbol} ${c.message}\n`);
  }

  process.stdout.write(`\n`);
  if (exitCode === 0) {
    process.stdout.write(color.green(`  ${sym.pass} Install verification PASSED`));
    process.stdout.write(`  (${passes.length} pass, ${warnings.length} warn, ${skipped.length} skip)\n`);
  } else {
    process.stderr.write(color.red(`  ${sym.fail} Install verification FAILED`));
    process.stderr.write(`  (${blockers.length} blocker, ${warnings.length} warn)\n`);
    process.stderr.write(`\n  Try: re-run install.sh / install.ps1, or open an issue at\n`);
    process.stderr.write(`       https://github.com/Rejnyx/cortex-x/issues\n`);
  }
}

function reportJson(summary) {
  const out = {
    status: summary.exitCode === 0 ? 'pass' : 'fail',
    cortex_data_home: DATA_HOME,
    claude_home: CLAUDE_HOME,
    counts: {
      pass: summary.passes.length,
      blocker: summary.blockers.length,
      warning: summary.warnings.length,
      skipped: summary.skipped.length,
    },
    checks,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  try {
    runChecks();
    const summary = summarize();
    if (FLAG_JSON) reportJson(summary);
    else reportPlain(summary);
    process.exit(summary.exitCode);
  } catch (e) {
    process.stderr.write(`verify-install.cjs crashed: ${e.message}\n${e.stack}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { runChecks, summarize, checks: () => checks };
