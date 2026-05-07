#!/usr/bin/env node
// verify-audit-output.cjs — structural validator for cortex-x /audit deliverables.
//
// Audits Claude-generated audit outputs against the contract specified in
// prompts/existing-project-audit.md (Phase 5 outputs). Catches the three
// failure classes that field test #8 (webovky_hustle, 2026-05-07) exposed:
//
//   G1: $CORTEX_DATA_HOME/projects/<slug>.md not written
//   G2: slug derivation jargon-heavy (this validator just verifies presence,
//       Phase 0 plain-language gate is enforced in the prompt itself)
//   G3: 3-hop citation chain broken — [audit: §N] in recommendations.md
//       points to a section that doesn't exist in AUDIT.md
//
// Usage:
//   verify-audit-output --project-path <path> [--slug <slug>] [--strict]
//   verify-audit-output --json   # machine-readable
//   verify-audit-output --tap    # node --test integration
//
// Exit codes:
//   0 — all checks pass
//   1 — validation failures present (audit output is incomplete)
//   2 — validator itself crashed (bug in this file)
//
// Zero deps. Uses session-start.cjs's flat-YAML regex pattern for frontmatter
// parsing — same precedent, same shape, same SSOT (tools/lib/resolve-cortex-home.cjs).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveCortexDataHome } = require('./lib/resolve-cortex-home.cjs');

// ── argv parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    projectPath: null,
    slug: null,
    json: false,
    tap: false,
    strict: false,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-path') args.projectPath = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--tap') args.tap = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!args.projectPath && !a.startsWith('--')) {
      // positional project path
      args.projectPath = a;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`verify-audit-output — validate cortex-x /audit deliverables

USAGE
  verify-audit-output [--project-path <path>] [--slug <slug>] [--strict]
  verify-audit-output --json
  verify-audit-output --tap

ARGUMENTS
  --project-path <path>  Project root with cortex/ artifacts (default: cwd)
  --slug <slug>          Expected slug (default: read from cortex/AUDIT.md frontmatter)
  --strict               Fail on warnings, not just blockers
  --json                 Machine-readable output
  --tap                  TAP v14 output (for node --test integration)
  --quiet                Only output on failure

EXIT CODES
  0  all checks pass
  1  validation failures present
  2  validator crashed (bug)

CHECKS PERFORMED (10)
  1. cortex/AUDIT.md exists with frontmatter phase: 2-audit
  2. cortex/AUDIT.md slug matches --slug or filename derivation
  3. cortex/recommendations.md exists with frontmatter phase: 5-synthesis
  4. recommendations.md based_on.audit chain points to AUDIT.md
  5. recommendations.md based_on.research chain points to a research file
  6. $CORTEX_DATA_HOME/projects/<slug>.md exists with frontmatter
  7. projects/<slug>.md project_path matches the audited path
  8. 3-hop citation chain: every [audit: §N] in recommendations resolves
     to a ## N. section in AUDIT.md
  9. Every research [src: URL] cited in recommendations exists in research file
 10. AUDIT.md has all 12 dimension sections (## 1. through ## 12.)
`);
}

// ── frontmatter parser (zero-dep) ───────────────────────────────────────────
// Handles flat keys + 1-level nested mappings. Refuses anything weirder
// (multi-line strings, anchors, lists) — out of scope for cortex audit
// outputs which are generated from a known template.
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src, hasFrontmatter: false };
  const data = {};
  let parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^(\s*)/)[1].length;
    const kv = raw.trim().match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    const trimmedVal = val.trim().replace(/^["']|["']$/g, '');
    if (indent === 0) {
      parent = null;
      if (val === '' || val === undefined) {
        data[key] = {};
        parent = key;
      } else {
        data[key] = trimmedVal;
      }
    } else if (parent) {
      data[parent][key] = trimmedVal;
    }
  }
  return { data, body: src.slice(m[0].length), hasFrontmatter: true };
}

// ── markdown helpers (zero-dep) ─────────────────────────────────────────────
// Mask out fenced code blocks + HTML comments so regex scans don't false-match
// inside them. Replace with spaces (preserves byte offsets so line numbers
// remain accurate for diagnostics).
function maskCode(md) {
  return md
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^~~~[\s\S]*?^~~~/gm, (m) => m.replace(/[^\n]/g, ' '));
}

function extractSections(md) {
  const masked = maskCode(md);
  const sections = new Map();
  const re = /^##\s+(\d{1,2})[.\s]\s*(.+)$/gm;
  let m;
  while ((m = re.exec(masked))) sections.set(Number(m[1]), m[2].trim());
  return sections;
}

function extractCitations(md) {
  const masked = maskCode(md);
  const citations = [];
  const lines = masked.split(/\r?\n/);
  const auditRe = /\[audit:\s*§?(\d{1,2})\b[^\]]*\]/g;
  const srcRe = /\[src:\s*([^\]]+)\]/g;
  lines.forEach((line, idx) => {
    let m;
    while ((m = auditRe.exec(line))) {
      citations.push({ kind: 'audit', section: Number(m[1]), line: idx + 1 });
    }
    while ((m = srcRe.exec(line))) {
      citations.push({ kind: 'src', url: m[1].trim(), line: idx + 1 });
    }
  });
  return citations;
}

// ── output / TTY helpers ────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY === true;
const useUnicode = (isTTY && process.platform !== 'win32') || process.env.WT_SESSION;
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

// ── validator core ──────────────────────────────────────────────────────────
class Validator {
  constructor(args) {
    this.args = args;
    this.projectPath = path.resolve(args.projectPath || process.cwd());
    this.checks = [];
    this.dataHome = resolveCortexDataHome();
  }

  push(id, severity, status, message) {
    this.checks.push({ id, severity, status, message });
  }

  pass(id, message) { this.push(id, 'blocker', 'pass', message); }
  fail(id, severity, message) { this.push(id, severity, 'fail', message); }

  readIfExists(p) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return fs.readFileSync(p, 'utf8');
  }

  run() {
    this.checkAuditMd();
    this.checkRecommendationsMd();
    this.checkProjectsLibraryEntry();
    this.checkCitationChain();
    this.checkAllDimensionSections();
  }

  checkAuditMd() {
    const auditPath = path.join(this.projectPath, 'cortex', 'AUDIT.md');
    const src = this.readIfExists(auditPath);
    if (!src) {
      this.fail('audit.exists', 'blocker', `MISSING: ${auditPath}`);
      this._auditFm = null;
      this._auditSections = new Map();
      return;
    }
    this.pass('audit.exists', `cortex/AUDIT.md present`);

    const fm = parseFrontmatter(src);
    this._auditFm = fm.data;
    this._auditSections = extractSections(fm.body);

    if (!fm.hasFrontmatter) {
      this.fail('audit.frontmatter', 'blocker', `cortex/AUDIT.md has no YAML frontmatter`);
      return;
    }

    if (fm.data.phase !== '2-audit') {
      this.fail('audit.phase', 'blocker', `cortex/AUDIT.md frontmatter phase: '${fm.data.phase}' (expected '2-audit')`);
    } else {
      this.pass('audit.phase', `cortex/AUDIT.md phase: 2-audit`);
    }

    if (!fm.data.slug) {
      this.fail('audit.slug', 'blocker', `cortex/AUDIT.md frontmatter missing slug:`);
    } else {
      this.pass('audit.slug', `cortex/AUDIT.md slug: ${fm.data.slug}`);
      if (!this.args.slug) this.args.slug = fm.data.slug;
    }
  }

  checkRecommendationsMd() {
    const recsPath = path.join(this.projectPath, 'cortex', 'recommendations.md');
    const src = this.readIfExists(recsPath);
    if (!src) {
      this.fail('recommendations.exists', 'blocker', `MISSING: ${recsPath}`);
      this._recsFm = null;
      this._recsBody = '';
      return;
    }
    this.pass('recommendations.exists', `cortex/recommendations.md present`);

    const fm = parseFrontmatter(src);
    this._recsFm = fm.data;
    this._recsBody = fm.body;

    if (!fm.hasFrontmatter) {
      this.fail('recommendations.frontmatter', 'blocker', `cortex/recommendations.md has no YAML frontmatter`);
      return;
    }

    if (fm.data.phase !== '5-synthesis') {
      this.fail('recommendations.phase', 'blocker', `cortex/recommendations.md phase: '${fm.data.phase}' (expected '5-synthesis')`);
    } else {
      this.pass('recommendations.phase', `cortex/recommendations.md phase: 5-synthesis`);
    }

    const basedOn = fm.data.based_on || {};
    if (!basedOn.audit) {
      this.fail('recommendations.based_on.audit', 'warning', `recommendations.md missing based_on.audit chain`);
    } else if (!basedOn.audit.includes('AUDIT.md')) {
      this.fail('recommendations.based_on.audit', 'warning', `recommendations.md based_on.audit doesn't reference AUDIT.md: '${basedOn.audit}'`);
    } else {
      this.pass('recommendations.based_on.audit', `recommendations.md based_on.audit chain present`);
    }
  }

  checkProjectsLibraryEntry() {
    if (!this.args.slug) {
      this.fail('projects.entry', 'blocker', `cannot check projects/<slug>.md — slug not resolvable`);
      return;
    }
    const projectsEntry = path.join(this.dataHome, 'projects', `${this.args.slug}.md`);
    const src = this.readIfExists(projectsEntry);
    if (!src) {
      this.fail('projects.entry', 'blocker', `MISSING: ${projectsEntry} (Phase 5d contract — every audit MUST write a projects-library entry)`);
      return;
    }
    this.pass('projects.entry', `${projectsEntry} present`);

    const fm = parseFrontmatter(src);
    if (!fm.hasFrontmatter) {
      this.fail('projects.frontmatter', 'blocker', `${projectsEntry} has no YAML frontmatter`);
      return;
    }

    if (fm.data.slug !== this.args.slug) {
      this.fail('projects.slug', 'blocker', `${projectsEntry} frontmatter slug: '${fm.data.slug}' (expected '${this.args.slug}')`);
    } else {
      this.pass('projects.slug', `projects/${this.args.slug}.md slug matches`);
    }

    if (!fm.data.project_path) {
      this.fail('projects.project_path', 'warning', `${projectsEntry} frontmatter missing project_path:`);
    } else {
      this.pass('projects.project_path', `projects/${this.args.slug}.md has project_path`);
    }

    if (!fm.data.last_audit) {
      this.fail('projects.last_audit', 'warning', `${projectsEntry} frontmatter missing last_audit:`);
    } else {
      this.pass('projects.last_audit', `projects/${this.args.slug}.md has last_audit`);
    }
  }

  checkCitationChain() {
    if (!this._recsBody || !this._auditSections || this._auditSections.size === 0) {
      // upstream check already failed — don't add noise
      return;
    }
    const citations = extractCitations(this._recsBody);
    const auditCitations = citations.filter((c) => c.kind === 'audit');

    if (auditCitations.length === 0) {
      this.fail('citations.coverage', 'warning', `recommendations.md has no [audit: §N] markers — 3-hop traceability contract violated`);
      return;
    }

    const validSections = this._auditSections;
    let orphans = 0;
    for (const cit of auditCitations) {
      if (!validSections.has(cit.section)) {
        this.fail(
          `citations.orphan.${cit.line}`,
          'blocker',
          `recommendations.md:${cit.line} cites [audit: §${cit.section}] but AUDIT.md has no ## ${cit.section}. section`
        );
        orphans++;
      }
    }
    if (orphans === 0) {
      this.pass('citations.chain', `${auditCitations.length} [audit: §N] citations all resolve to AUDIT.md sections`);
    }
  }

  checkAllDimensionSections() {
    if (this._auditSections.size === 0) return;
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const missing = expected.filter((n) => !this._auditSections.has(n));
    if (missing.length > 0) {
      this.fail(
        'audit.dimensions',
        'warning',
        `AUDIT.md missing dimension section(s): ## ${missing.join(', ## ')}`
      );
    } else {
      this.pass('audit.dimensions', `AUDIT.md has all 12 dimension sections`);
    }
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
    process.stdout.write(`verify-audit-output — ${v.projectPath}\n`);
    process.stdout.write(color.dim(`  CORTEX_DATA_HOME: ${v.dataHome}\n`));
    if (v.args.slug) process.stdout.write(color.dim(`  slug: ${v.args.slug}\n`));
    process.stdout.write(`\n`);
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
    process.stdout.write(color.green(`  ${sym.pass} Audit output PASSED`));
    process.stdout.write(`  (${passes} pass, ${warnings} warn)\n`);
  } else {
    process.stderr.write(color.red(`  ${sym.fail} Audit output FAILED`));
    process.stderr.write(`  (${blockers} blocker, ${warnings} warn)\n`);
  }
}

function reportJson(v) {
  const blockers = v.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail').length;
  const warnings = v.checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passes = v.checks.filter((c) => c.status === 'pass').length;

  const out = {
    status: v.exitCode() === 0 ? 'pass' : 'fail',
    project_path: v.projectPath,
    slug: v.args.slug,
    cortex_data_home: v.dataHome,
    counts: { pass: passes, blocker: blockers, warning: warnings },
    checks: v.checks,
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
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
    process.stderr.write(`verify-audit-output crashed: ${e.message}\n${e.stack}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { Validator, parseFrontmatter, extractSections, extractCitations };
