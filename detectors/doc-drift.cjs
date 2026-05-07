#!/usr/bin/env node
// doc-drift.cjs — Sprint 1.8.6 deterministic doc drift detector.
//
// Pragmatic v1: scan source for top-level exported symbols (function/class/
// const exports), check if README.md and/or CLAUDE.md mention them by name.
// Emit candidates for symbols that exist in source but are NOT mentioned in
// any tracked doc — likely API drift.
//
// No LLM call. Filed gh issues are deterministic (just the symbol name +
// file location + "consider documenting"). Maintainer decides whether to
// add it to README or close as "internal-only".
//
// Future v2 (parked v0.9+): LLM-driven doc patches (read docs, diff against
// API surface, generate patch lines). Bigger surface — language-stack-aware
// exports detection, doc structure understanding, patch shape.
//
// Heuristics for v1:
//   - Match `export function <name>` / `export class <name>` /
//     `export const <name>` (TS/JS); `module.exports = { <name> }` patterns
//   - Skip private symbols (leading `_`, `internal`, `__`)
//   - Skip test files (containing .test., .spec., __tests__/)
//   - Doc match: case-sensitive substring search in README.md + CLAUDE.md
//   - Filter: only emit candidates that have NO doc match anywhere
//
// CLI:
//   node detectors/doc-drift.cjs               # human report
//   node detectors/doc-drift.cjs --json        # machine output
//   node detectors/doc-drift.cjs --max=5

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CANDIDATES = 5;
const SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cortex', 'target']);
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./, /__tests__/, /\.d\.ts$/];

// ES-module + CommonJS export patterns. Captures the symbol name in group 1.
// Order matters — first match per line wins.
const EXPORT_PATTERNS = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  /^export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  /^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  /^export\s+default\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
  // Type/interface in TypeScript surface area — also documentable
  /^export\s+(?:type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
];

function isPrivateSymbol(name) {
  return name.startsWith('_') || name === 'default' || /^internal/i.test(name);
}

function isTestFile(filePath) {
  return SKIP_FILE_PATTERNS.some((re) => re.test(filePath));
}

function* walkSourceFiles(root, opts = {}) {
  const skip = opts.skipDirs || SKIP_DIRS;
  const exts = opts.extensions || SCAN_EXTENSIONS;
  const maxFiles = opts.maxFiles || 5000;
  let count = 0;
  function* walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        yield* walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (exts.has(ext) && !isTestFile(entry.name)) {
          count += 1;
          yield full;
        }
      }
    }
  }
  yield* walk(root);
}

// Scan a file's content for exported symbols. Returns array of
// { name, kind, lineNumber }. Skips private + test-file lookalikes.
function scanContentForExports(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const re of EXPORT_PATTERNS) {
      const m = re.exec(line);
      if (m && !isPrivateSymbol(m[1])) {
        // Determine "kind" from the keyword in the line (best-effort)
        let kind = 'export';
        if (/function/.test(line)) kind = 'function';
        else if (/class/.test(line)) kind = 'class';
        else if (/(?:type|interface)/.test(line)) kind = 'type';
        else if (/(?:const|let|var)/.test(line)) kind = 'const';
        out.push({ name: m[1], kind, lineNumber: i + 1 });
        break; // one match per line
      }
    }
  }
  return out;
}

// Read all tracked doc files and return their concatenated content as one
// big string for substring search. Reads README.md, CLAUDE.md, and docs/*.md
// at the repo root.
function readDocsCorpus(repoRoot, opts = {}) {
  if (opts.mockDocsCorpus != null) return opts.mockDocsCorpus;
  const candidates = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'CLAUDE.md'),
  ];
  // Add docs/*.md files
  const docsDir = path.join(repoRoot, 'docs');
  try {
    const docsEntries = fs.readdirSync(docsDir, { withFileTypes: true });
    for (const e of docsEntries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        candidates.push(path.join(docsDir, e.name));
      }
    }
  } catch { /* docs/ may not exist */ }

  const buf = [];
  for (const f of candidates) {
    try { buf.push(fs.readFileSync(f, 'utf8')); } catch { /* skip missing */ }
  }
  return buf.join('\n\n');
}

// Check if a symbol name is mentioned anywhere in the docs corpus.
// Case-sensitive — the symbol case is what matters in docs.
function isDocumented(symbolName, corpus) {
  if (!symbolName || !corpus) return false;
  // Avoid false positives by requiring the name appear as a word boundary
  // OR inside a code fence / inline code (most common doc reference shape).
  const re = new RegExp(`\\b${symbolName.replace(/[$()*+?.\\^|]/g, '\\$&')}\\b`);
  return re.test(corpus);
}

// Main entry. Scan repo for exported symbols, filter to those undocumented,
// return candidates.
function detectDocDrift({ cwd, mockFiles, mockDocsCorpus, maxCandidates } = {}) {
  const repoRoot = cwd || process.cwd();
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;

  const exports_ = [];
  if (mockFiles) {
    for (const f of mockFiles) {
      const found = scanContentForExports(f.content || '');
      for (const sym of found) {
        exports_.push({ file: f.path, ...sym });
      }
    }
  } else {
    for (const filePath of walkSourceFiles(repoRoot)) {
      let content;
      try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
      const found = scanContentForExports(content);
      for (const sym of found) {
        const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        exports_.push({ file: rel, ...sym });
      }
    }
  }

  const docsCorpus = mockDocsCorpus != null ? mockDocsCorpus : readDocsCorpus(repoRoot, { mockDocsCorpus });

  const candidates = [];
  let documentedCount = 0;
  for (const sym of exports_) {
    if (isDocumented(sym.name, docsCorpus)) {
      documentedCount += 1;
      continue;
    }
    candidates.push(sym);
    if (candidates.length >= max) break;
  }

  return {
    candidates,
    total_exports: exports_.length,
    documented_count: documentedCount,
    drifted_count: exports_.length - documentedCount,
  };
}

function formatIssueTitle(candidate) {
  return `Doc drift: ${candidate.kind} \`${candidate.name}\` not mentioned in README/CLAUDE.md`;
}

function formatIssueBody(candidate) {
  const lines = [];
  lines.push(`## Symbol`);
  lines.push('');
  lines.push(`\`${candidate.name}\` (${candidate.kind})`);
  lines.push('');
  lines.push(`## Source location`);
  lines.push('');
  lines.push(`\`${candidate.file}:${candidate.lineNumber}\``);
  lines.push('');
  lines.push(`## Why this is filed`);
  lines.push('');
  lines.push('Hermes\'s `doc_drift` capability scans top-level exported symbols');
  lines.push('and checks whether they are mentioned (case-sensitive word match) in');
  lines.push('any of: `README.md`, `CLAUDE.md`, or `docs/*.md`.');
  lines.push('');
  lines.push(`The symbol \`${candidate.name}\` is exported but absent from all of those.`);
  lines.push('Likely options:');
  lines.push('');
  lines.push('1. **Add it to docs** — public API surface that users should know about');
  lines.push('2. **Mark it private** — rename with leading `_` or move to `_lib/internal/`');
  lines.push('3. **Close as not-applicable** — the symbol is internal but happens to be exported for testing');
  lines.push('');
  lines.push('---');
  lines.push('Filed by Hermes (cortex-x) doc-drift triage. Deterministic scan — no LLM analysis.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const result = detectDocDrift({
    maxCandidates: maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Doc-drift report:\n`);
    process.stdout.write(`  total exports:    ${result.total_exports}\n`);
    process.stdout.write(`  documented:       ${result.documented_count}\n`);
    process.stdout.write(`  drifted:          ${result.drifted_count}\n`);
    process.stdout.write(`  candidates shown: ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nDrifted symbols (capped):\n');
      for (const c of result.candidates) {
        process.stdout.write(`  ${c.file}:${c.lineNumber}  [${c.kind}] ${c.name}\n`);
      }
    }
  }
}

module.exports = {
  detectDocDrift,
  scanContentForExports,
  readDocsCorpus,
  isDocumented,
  isPrivateSymbol,
  isTestFile,
  formatIssueTitle,
  formatIssueBody,
};
