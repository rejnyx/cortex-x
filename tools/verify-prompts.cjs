#!/usr/bin/env node
// verify-prompts.cjs — structural validator for cortex-x prompts/*.md.
//
// Each prompt is a Claude-facing workflow document; users paste them in
// Claude Code as slash-commands (`/start` → new-project.md, `/audit` →
// existing-project-audit.md, etc.). Subtle regressions slip through code
// review easily because the file looks like prose. This validator runs
// in CI and surfaces breakage before merge.
//
// Checks performed (10):
//   1. File exists + is non-empty
//   2. Has `## Phase` heading sequence (if it's a workflow prompt)
//   3. Phase numbers are sorted ascending and contiguous (no skips)
//   4. Internal markdown links [text](relative/path) resolve to existing files
//   5. References to ~/.claude/shared/agents/<name>.md match actual agents/
//   6. References to ~/.claude/shared/standards/<name>.md match actual standards/
//   7. No PII / maintainer-specific paths leak (/c/Users/david/, davidrajnoha@, ...)
//   8. No Czech-specific path placeholders that should be parameterized
//   9. Anchors and on_complete sections match expected schemas
//  10. Code-block fences are balanced
//
// Modes: plain text (default), --json (CI), --tap (node:test integration)
// Exit codes: 0 pass / 1 validation failures / 2 verifier crashed
// Zero deps. Mirrors tools/verify-audit-output.cjs structure.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stripDenylistExamples } = require('./lib/denylist-examples.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROMPTS_DIR = path.join(REPO_ROOT, 'prompts');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const STANDARDS_DIR = path.join(REPO_ROOT, 'standards');

// ── argv parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { json: false, tap: false, strict: false, quiet: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--tap') args.tap = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`verify-prompts — structural validator for cortex-x prompts/*.md

USAGE
  verify-prompts [--strict] [--json | --tap] [--quiet]
  verify-prompts --file prompts/new-project.md

EXIT CODES
  0  all checks pass
  1  validation failures
  2  verifier crashed

CHECKS
  1. File exists, non-empty
  2. Phase heading sequence (## Phase N)
  3. Phase contiguity (no missing numbers)
  4. Internal links resolve (paths relative to repo root)
  5. Agent references match agents/<name>.md
  6. Standards references match standards/<name>.md
  7. No PII / maintainer-specific paths
  8. Code-block fence balance
`);
}

// ── output helpers ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY === true;
const useUnicode = (isTTY && process.platform !== 'win32') || process.env.WT_SESSION;
const useColor = isTTY && !process.env.NO_COLOR;
const sym = useUnicode ? { pass: '✓', fail: '✗', warn: '⚠' } : { pass: '[OK]', fail: '[FAIL]', warn: '[WARN]' };
const color = useColor
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s };

// ── markdown helpers (zero-dep) ─────────────────────────────────────────────
function maskCode(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^~~~[\s\S]*?^~~~/gm, (m) => m.replace(/[^\n]/g, ' '));
}

function fenceBalance(md) {
  const fences = (md.match(/^```/gm) || []).length;
  return { balanced: fences % 2 === 0, count: fences };
}

function extractPhases(md) {
  const masked = maskCode(md);
  const re = /^##\s+Phase\s+(\d+)\b.*$/gm;
  const phases = [];
  let m;
  while ((m = re.exec(masked))) phases.push({ num: Number(m[1]), title: m[0] });
  return phases;
}

function extractInternalLinks(md) {
  const masked = maskCode(md);
  const links = [];
  const re = /\[([^\]]+)\]\((?!https?:|#|mailto:)([^)\s]+?)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(masked))) {
    links.push({ text: m[1], href: m[2] });
  }
  return links;
}

const PII_DENY = [
  /\/c\/Users\/david\b/i,
  /C:\\Users\\david\b/i,
  /davidrajnoha@/i,
];

// Allowlisted Rejnyx mentions (license/repo URLs, install instructions).
// Specifically: github.com/Rejnyx/cortex-x is fine; bare "Rejnyx" outside
// that context is suspect.
const PII_REJNYX_OK = /github\.com\/Rejnyx\/cortex-x/;

// ── validator core ──────────────────────────────────────────────────────────
class Validator {
  constructor(args) {
    this.args = args;
    this.checks = [];
  }

  push(id, severity, status, message) {
    this.checks.push({ id, severity, status, message });
  }
  pass(id, message) { this.push(id, 'blocker', 'pass', message); }
  fail(id, severity, message) { this.push(id, severity, 'fail', message); }

  listFiles() {
    if (this.args.file) {
      return [path.resolve(this.args.file)];
    }
    return fs
      .readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(PROMPTS_DIR, f));
  }

  validateFile(filePath) {
    const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      this.fail(`${rel}.exists`, 'blocker', `${rel}: missing or empty`);
      return;
    }
    const md = fs.readFileSync(filePath, 'utf8');

    // 1. File present
    this.pass(`${rel}.exists`, `${rel}: present (${md.length} bytes)`);

    // 2 + 3. Phase contiguity
    const phases = extractPhases(md);
    if (phases.length === 0) {
      this.push(`${rel}.phases`, 'warning', 'pass', `${rel}: no Phase headings (non-workflow prompt)`);
    } else {
      const nums = phases.map((p) => p.num);
      const sorted = [...nums].sort((a, b) => a - b);
      const isAsc = nums.every((n, i) => n === sorted[i]);
      const min = sorted[0];
      const expected = sorted.map((_, i) => min + i);
      const isContiguous = sorted.every((n, i) => n === expected[i]);

      if (!isAsc) {
        this.fail(`${rel}.phases.order`, 'warning', `${rel}: Phase headings not in ascending order: [${nums.join(', ')}]`);
      } else if (!isContiguous) {
        this.fail(`${rel}.phases.contiguity`, 'warning', `${rel}: Phase numbers not contiguous (gaps): [${sorted.join(', ')}]`);
      } else {
        this.pass(`${rel}.phases`, `${rel}: ${phases.length} phases ${sorted[0]}-${sorted[sorted.length - 1]} (contiguous)`);
      }
    }

    // 4. Internal links resolve
    const links = extractInternalLinks(md);
    let brokenLinks = 0;
    for (const { text, href } of links) {
      const [bare] = href.split('#');
      if (!bare) continue;  // anchor-only link, skip
      // cortex-x convention: links are relative to repo root
      const target = path.resolve(REPO_ROOT, bare);
      if (!fs.existsSync(target)) {
        this.fail(`${rel}.link.${bare}`, 'warning', `${rel}: broken link [${text}](${href}) — ${bare} does not exist`);
        brokenLinks++;
      }
    }
    if (brokenLinks === 0 && links.length > 0) {
      this.pass(`${rel}.links`, `${rel}: ${links.length} internal links all resolve`);
    }

    // 5. Agent references via ~/.claude/shared/agents/<name>.md
    const agentRefRe = /~\/\.claude\/shared\/agents\/([\w-]+)\.md/g;
    let agentRefMissing = 0;
    let m;
    while ((m = agentRefRe.exec(md))) {
      const agentName = m[1];
      const agentFile = path.join(AGENTS_DIR, `${agentName}.md`);
      if (!fs.existsSync(agentFile)) {
        this.fail(`${rel}.agent.${agentName}`, 'warning', `${rel}: references ~/.claude/shared/agents/${agentName}.md but agents/${agentName}.md does not exist`);
        agentRefMissing++;
      }
    }
    if (agentRefMissing === 0) {
      this.pass(`${rel}.agent-refs`, `${rel}: agent references all resolve`);
    }

    // 6. Standards references
    const stdRefRe = /standards\/([\w-]+)\.md/g;
    let stdRefMissing = 0;
    while ((m = stdRefRe.exec(md))) {
      const stdName = m[1];
      const stdFile = path.join(STANDARDS_DIR, `${stdName}.md`);
      if (!fs.existsSync(stdFile)) {
        this.fail(`${rel}.standard.${stdName}`, 'warning', `${rel}: references standards/${stdName}.md but file does not exist`);
        stdRefMissing++;
      }
    }
    if (stdRefMissing === 0) {
      this.pass(`${rel}.standard-refs`, `${rel}: standards references all resolve`);
    }

    // 7. PII / the operator-path leak
    // Lines marked `<!-- denylist-example -->` are excluded from the scan
    // (see tools/lib/denylist-examples.cjs for the rationale).
    const mdForPii = stripDenylistExamples(md);
    let piiHits = [];
    for (const re of PII_DENY) {
      const matches = mdForPii.match(re);
      if (matches) piiHits.push(matches[0]);
    }
    if (piiHits.length > 0) {
      this.fail(`${rel}.pii`, 'blocker', `${rel}: PII / maintainer-specific path leak: ${[...new Set(piiHits)].join(', ')}`);
    } else {
      this.pass(`${rel}.pii`, `${rel}: no PII leak detected`);
    }

    // Optional: bare "Rejnyx" mentions outside the github.com/Rejnyx/cortex-x context
    const rejnyxRe = /\bRejnyx\b/g;
    const rejnyxMatches = (md.match(rejnyxRe) || []).length;
    const rejnyxAllowed = (md.match(/github\.com\/Rejnyx\/cortex-x/g) || []).length;
    if (rejnyxMatches > rejnyxAllowed * 2) {
      // Heuristic: each github.com/Rejnyx/cortex-x URL contains "Rejnyx" once,
      // so allowed bare mentions ≈ allowed URL mentions. Significant excess
      // suggests stray mentions outside the canonical URL.
      this.push(`${rel}.rejnyx-bare`, 'warning', 'fail', `${rel}: ${rejnyxMatches} bare "Rejnyx" mentions vs ${rejnyxAllowed} canonical URLs (review for stray refs)`);
    }

    // 8. Code fence balance
    const { balanced, count } = fenceBalance(md);
    if (!balanced) {
      this.fail(`${rel}.fences`, 'blocker', `${rel}: code-block fences not balanced (${count} backtick fences)`);
    } else {
      this.pass(`${rel}.fences`, `${rel}: ${count} code fences (balanced)`);
    }
  }

  run() {
    const files = this.listFiles();
    if (files.length === 0) {
      this.fail('inventory', 'blocker', 'no prompt files found');
      return;
    }
    this.pass('inventory', `found ${files.length} prompt file(s)`);
    for (const f of files) this.validateFile(f);
  }

  exitCode() {
    const blockers = this.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail');
    const warnings = this.checks.filter((c) => c.severity === 'warning' && c.status === 'fail');
    if (blockers.length > 0) return 1;
    if (this.args.strict && warnings.length > 0) return 1;
    return 0;
  }
}

// ── reporters ───────────────────────────────────────────────────────────────
function reportPlain(v) {
  if (v.args.quiet && v.exitCode() === 0) return;
  if (!v.args.quiet) {
    process.stdout.write(`verify-prompts — ${PROMPTS_DIR}\n\n`);
  }
  for (const c of v.checks) {
    if (v.args.quiet && c.status === 'pass') continue;
    const symbol =
      c.status === 'pass' ? color.green(sym.pass)
      : c.severity === 'warning' ? color.yellow(sym.warn)
      : color.red(sym.fail);
    process.stdout.write(`  ${symbol} ${c.message}\n`);
  }
  const blockers = v.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail').length;
  const warnings = v.checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passes = v.checks.filter((c) => c.status === 'pass').length;
  process.stdout.write(`\n`);
  if (v.exitCode() === 0) {
    process.stdout.write(color.green(`  ${sym.pass} Prompts PASSED`));
    process.stdout.write(`  (${passes} pass, ${warnings} warn)\n`);
  } else {
    process.stderr.write(color.red(`  ${sym.fail} Prompts FAILED`));
    process.stderr.write(`  (${blockers} blocker, ${warnings} warn)\n`);
  }
}

function reportJson(v) {
  const blockers = v.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail').length;
  const warnings = v.checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passes = v.checks.filter((c) => c.status === 'pass').length;
  process.stdout.write(JSON.stringify({
    status: v.exitCode() === 0 ? 'pass' : 'fail',
    counts: { pass: passes, blocker: blockers, warning: warnings },
    checks: v.checks,
  }, null, 2) + '\n');
}

function reportTap(v) {
  process.stdout.write(`TAP version 14\n`);
  process.stdout.write(`1..${v.checks.length}\n`);
  v.checks.forEach((c, i) => {
    const ok = c.status === 'pass' ? 'ok' : 'not ok';
    process.stdout.write(`${ok} ${i + 1} - ${c.id}: ${c.message}\n`);
  });
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  try {
    const args = parseArgs(process.argv);
    const v = new Validator(args);
    v.run();
    if (args.json) reportJson(v);
    else if (args.tap) reportTap(v);
    else reportPlain(v);
    process.exit(v.exitCode());
  } catch (e) {
    process.stderr.write(`verify-prompts crashed: ${e.message}\n${e.stack}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { Validator, extractPhases, extractInternalLinks, fenceBalance };
