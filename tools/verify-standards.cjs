#!/usr/bin/env node
// verify-standards.cjs — Tier 7 link integrity validator for standards/*.md.
//
// Standards are the institutional-wisdom layer. They reference each other
// heavily ("see correctness.md § Trust boundaries"). When a file gets renamed
// or a section deleted, the cross-references go stale silently. This validator
// catches those before they reach scaffolded projects.
//
// Invariants per standards/*.md:
//   1. File exists, non-empty
//   2. Every internal markdown link [text](path) resolves to:
//      - a real file (relative to repo root, the cortex-x convention) OR
//      - an external URL (http://, https://) OR
//      - a same-file anchor (#section)
//   3. Code fence balance (```...```)
//   4. PII guard (denylist: c:/Users/david/, davidrajnoha@, etc.)
//   5. References to other standards/<name>.md are real files
//
// Modes: plain text (TTY-aware), --json (CI), --tap (node:test), --strict
//        (warnings become blockers), --quiet (silent on pass), --file (single).
// Exit codes 0/1/2 per Unix convention. Mirrors verify-prompts.cjs / verify-skills.cjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stripDenylistExamples } = require('./lib/denylist-examples.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const STANDARDS_DIR = path.join(REPO_ROOT, 'standards');

const PII_DENYLIST = [
  /c:\\Users\\david\\/i,
  /c:\/Users\/david\//i,
  /\/c\/Users\/david\//i,
  /davidrajnoha@/i,
];

const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const FENCE_RE = /^```/gm;

function listStandardFiles() {
  if (!fs.existsSync(STANDARDS_DIR)) return [];
  return fs.readdirSync(STANDARDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => path.join(STANDARDS_DIR, f));
}

function isExternal(href) {
  return /^(https?|mailto|ftp):/.test(href);
}

function isAnchorOnly(href) {
  return href.startsWith('#');
}

function resolveLinkTarget(filePath, href) {
  // Strip query / fragment for fs check
  const clean = href.replace(/[#?].*$/, '');
  if (!clean) return null;

  // Two conventions exist in the codebase:
  // (a) Relative-to-the-current-file ("./foo.md", "../docs/bar.md") — natural for editors
  // (b) Repo-root-relative ("standards/foo.md", "docs/bar.md") — natural for GitHub / install
  // Standards files mostly use (a). verify-prompts enforces (b) for prompts/.
  // For standards/ we accept BOTH: try (a) first, fall back to (b).
  const fileDir = path.dirname(filePath);
  const tryA = path.resolve(fileDir, clean);
  if (fs.existsSync(tryA)) return tryA;

  const tryB = path.resolve(REPO_ROOT, clean);
  if (fs.existsSync(tryB)) return tryB;

  return null;
}

function checkFile(filePath) {
  const findings = [];
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');

  if (!fs.existsSync(filePath)) {
    findings.push({ severity: 'blocker', code: 'NOT_FOUND', file: rel, message: 'file does not exist' });
    return findings;
  }

  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    findings.push({ severity: 'blocker', code: 'EMPTY', file: rel, message: 'file is empty' });
    return findings;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  // Check 1 — link resolution
  const links = [...content.matchAll(LINK_RE)];
  for (const m of links) {
    const text = m[1];
    const href = m[2].trim();

    if (isExternal(href) || isAnchorOnly(href)) continue;

    const resolved = resolveLinkTarget(filePath, href);
    if (!resolved) {
      findings.push({
        severity: 'blocker',
        code: 'BROKEN_LINK',
        file: rel,
        message: `broken link [${text}](${href})`,
      });
    }
  }

  // Check 2 — code fence balance
  const fences = (content.match(FENCE_RE) || []).length;
  if (fences % 2 !== 0) {
    findings.push({
      severity: 'blocker',
      code: 'UNBALANCED_FENCES',
      file: rel,
      message: `${fences} code fences (must be even)`,
    });
  }

  // Check 3 — PII denylist (skipping <!-- denylist-example --> lines)
  const contentForPii = stripDenylistExamples(content);
  for (const re of PII_DENYLIST) {
    if (re.test(contentForPii)) {
      findings.push({
        severity: 'blocker',
        code: 'PII_LEAK',
        file: rel,
        message: `denylisted pattern matched: ${re}`,
      });
    }
  }

  return findings;
}

function summarize(findings) {
  let blockers = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.severity === 'blocker') blockers += 1;
    else warnings += 1;
  }
  return { blockers, warnings, total: findings.length };
}

function emitText(allFindings, files, opts) {
  const summary = summarize(allFindings);
  if (!opts.quiet || summary.blockers > 0 || (opts.strict && summary.warnings > 0)) {
    console.log(`verify-standards — ${files.length} file(s) scanned`);
  }
  for (const f of allFindings) {
    const tag = f.severity.toUpperCase().padEnd(7);
    console.log(`  [${tag}] ${f.file}: ${f.message}`);
  }
  if (summary.total === 0 && !opts.quiet) {
    console.log(`  [OK] all standards passed (${files.length} file(s), 0 findings)`);
  }
}

function emitJson(allFindings, files) {
  const summary = summarize(allFindings);
  console.log(JSON.stringify({
    tool: 'verify-standards',
    repo_root: REPO_ROOT,
    files_scanned: files.length,
    summary,
    findings: allFindings,
  }, null, 2));
}

function emitTap(allFindings, files) {
  console.log('TAP version 14');
  console.log(`1..${files.length}`);
  let i = 0;
  // Group findings by file for one TAP test per file
  const byFile = new Map();
  for (const f of allFindings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const file of files) {
    i += 1;
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const fileFindings = byFile.get(rel) || [];
    if (fileFindings.length === 0) {
      console.log(`ok ${i} - ${rel}`);
    } else {
      console.log(`not ok ${i} - ${rel}`);
      console.log('  ---');
      for (const f of fileFindings) {
        console.log(`  - severity: ${f.severity}`);
        console.log(`    code: ${f.code}`);
        console.log(`    message: ${f.message}`);
      }
      console.log('  ...');
    }
  }
}

function run(opts = {}) {
  const files = opts.singleFile
    ? [path.resolve(REPO_ROOT, opts.singleFile)]
    : listStandardFiles();

  const allFindings = [];
  for (const file of files) {
    allFindings.push(...checkFile(file));
  }

  return { files, findings: allFindings };
}

module.exports = {
  run,
  checkFile,
  listStandardFiles,
  resolveLinkTarget,
  PII_DENYLIST,
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (idx === -1) return undefined;
    const eq = args[idx].indexOf('=');
    if (eq >= 0) return args[idx].slice(eq + 1);
    return args[idx + 1];
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('verify-standards — Tier 7 link integrity validator for standards/*.md');
    console.log('');
    console.log('Usage: verify-standards [options]');
    console.log('  --json            machine-readable output');
    console.log('  --tap             TAP v14 output for node:test');
    console.log('  --strict          warnings become blockers');
    console.log('  --quiet           silent on pass');
    console.log('  --file <path>     check a single file');
    console.log('  --help            this help');
    process.exit(0);
  }

  const opts = {
    json: args.includes('--json'),
    tap: args.includes('--tap'),
    strict: args.includes('--strict'),
    quiet: args.includes('--quiet'),
    singleFile: flagValue('file'),
  };

  const { files, findings } = run(opts);
  const summary = summarize(findings);

  if (opts.json) emitJson(findings, files);
  else if (opts.tap) emitTap(findings, files);
  else emitText(findings, files, opts);

  const failOnWarnings = opts.strict && summary.warnings > 0;
  process.exit(summary.blockers > 0 || failOnWarnings ? 1 : 0);
}
