#!/usr/bin/env node
// bin/cortex-doc-audit.cjs — Sprint 2.8.3 v0 operator-facing CLI
//
// Scans markdown docs in a project and ranks them by agent-readability score.
// Pure-deterministic via bin/steward/_lib/doc-agent-readability.cjs.
//
// Usage:
//   cortex-doc-audit                     # score user-facing docs in CWD
//   cortex-doc-audit --paths=docs/,README.md
//   cortex-doc-audit --json
//   cortex-doc-audit --min-score=60      # exit code 1 if any doc scores below
//
// Output: human-readable ranked list OR JSON with full signal breakdown.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { scoreMarkdown } = require('./steward/_lib/doc-agent-readability.cjs');

const DEFAULT_PATHS = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/install-walkthrough.md',
  'docs/qa-tester-onboarding.md',
  'docs/steward-usage.md',
  'docs/troubleshooting.md',
  'docs/vision.md',
];

const MAX_FILE_BYTES = 512 * 1024; // 512 KB — skip larger to avoid CI memory blowup

function flag(name, args) {
  // R2 blind-hunter MED: `args[idx + 1]` may return another flag
  // (e.g. `--paths --json` would return "--json" as paths value).
  // Guard: skip the trailing-value form if the next arg starts with `--`.
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function isSafeRel(repoRoot, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  if (relPath.includes('\0')) return false;
  const abs = path.resolve(repoRoot, relPath);
  const rootResolved = path.resolve(repoRoot);
  return abs === rootResolved || abs.startsWith(rootResolved + path.sep);
}

function findMarkdownInDir(repoRoot, relDir) {
  const abs = path.resolve(repoRoot, relDir);
  if (!isSafeRel(repoRoot, relDir)) return [];
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      out.push(path.join(relDir, e.name).replace(/\\/g, '/'));
    }
  }
  return out;
}

function resolvePaths(repoRoot, raw) {
  const pieces = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of pieces) {
    if (!isSafeRel(repoRoot, p)) continue;
    const abs = path.resolve(repoRoot, p);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isFile() && p.endsWith('.md')) {
      out.push(p.replace(/\\/g, '/'));
    } else if (stat.isDirectory()) {
      for (const f of findMarkdownInDir(repoRoot, p)) out.push(f);
    }
  }
  return Array.from(new Set(out)).sort();
}

function showHelp() {
  process.stdout.write(`Usage: cortex-doc-audit [options]

Options:
  --paths=<csv>           comma-separated file/dir paths (default: 7 user-facing docs)
  --repo-root=<path>      cwd override
  --min-score=<n>         exit 1 if any doc scores below threshold (default: 0)
  --json                  emit JSON
  --help, -h              show this help

Sprint 2.8.3 v0 — deterministic agent-readability scorer.
Rubric: 5+1 signals × weights synthesized from agentskills.io spec +
Anthropic skill-creator + Cloudflare Markdown-for-Agents + llmstxt.org.
`);
}

function emitHuman(results, minScore) {
  results.sort((a, b) => a.score - b.score);
  const fmt = (n) => String(n).padStart(3);
  console.log(`agent-readability audit — ${results.length} doc(s) scored\n`);
  console.log('  score   path');
  console.log('  ─────   ─────');
  for (const r of results) {
    const marker = r.score < minScore ? ' ⚠ ' : '   ';
    console.log(`${marker}${fmt(r.score)}   ${r.path}`);
  }
  console.log('');
  const failing = results.filter((r) => r.score < minScore);
  if (failing.length > 0) {
    console.log(`${failing.length} doc(s) below --min-score=${minScore}:\n`);
    for (const r of failing) {
      console.log(`  ${r.path} (${r.score}):`);
      for (const p of r.penalties) console.log(`    - ${p}`);
      if (r.yellow_flags && r.yellow_flags.length > 0) {
        for (const f of r.yellow_flags) console.log(`    ⚠ ${f}`);
      }
    }
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const repoRoot = flag('repo-root', args) || process.cwd();
  const pathsRaw = flag('paths', args) || DEFAULT_PATHS.join(',');
  const wantJson = args.includes('--json');
  const minScore = Number.isFinite(Number(flag('min-score', args)))
    ? Math.max(0, Math.min(100, Math.floor(Number(flag('min-score', args)))))
    : 0;

  const paths = resolvePaths(repoRoot, pathsRaw);
  if (paths.length === 0) {
    if (wantJson) console.log(JSON.stringify({ ok: false, error: 'NO_PATHS' }));
    else process.stderr.write('No markdown files found in --paths\n');
    return 1;
  }

  const results = [];
  for (const rel of paths) {
    const abs = path.resolve(repoRoot, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.size > MAX_FILE_BYTES) {
      results.push({ path: rel, score: 0, signals: {}, penalties: ['TOO_LARGE'], bonuses: [], yellow_flags: [] });
      continue;
    }
    let content;
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const scored = scoreMarkdown(content);
    results.push({ path: rel, ...scored });
  }

  if (wantJson) {
    console.log(JSON.stringify({ ok: true, results, min_score: minScore }, null, 2));
  } else {
    emitHuman(results, minScore);
  }

  const anyFailing = results.some((r) => r.score < minScore);
  return anyFailing ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (err) {
    process.stderr.write(`Error: ${err && err.message}\n`);
    process.exit(1);
  }
}

module.exports = { main };
