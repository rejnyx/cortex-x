#!/usr/bin/env node
// test-coverage-gap.cjs — Sprint 1.8.10 coverage gap detector.
//
// Capability #6 from the Steward evolution roadmap. Pragmatic v1: parse a
// `coverage/coverage-summary.json` file (c8 / istanbul / jest output) +
// `git log --since=14days --name-only` to cross-reference. Files with
// coverage below threshold AND recently edited get filed as gh issues.
//
// NO LLM in v1 — issues just say "this file has low coverage, write a
// test". Maintainer authors the test. v2 (parked v0.9+) generates focused
// tests via LLM call.
//
// Output:
//   {
//     candidates: [{ file, statements_pct, recently_edited, edits_count }],
//     total_low_coverage: <int>,
//     skipped_unchanged: <int>,
//     coverage_available: bool,
//   }
//
// CLI:
//   node detectors/test-coverage-gap.cjs              # human report
//   node detectors/test-coverage-gap.cjs --json
//   node detectors/test-coverage-gap.cjs --threshold=70
//   node detectors/test-coverage-gap.cjs --max=5

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_THRESHOLD = 70;     // files below this % statements coverage = candidate
const DEFAULT_LOOKBACK_DAYS = 14; // files edited within = recent
const DEFAULT_MAX_CANDIDATES = 5;

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 5000,
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

// Read coverage/coverage-summary.json (c8 / istanbul / jest format).
// Returns parsed object or null if missing.
// DI sentinel: `mockSummary === undefined` (omitted) falls through to disk;
// `mockSummary === null` is explicit "force missing" used by unit tests that
// must isolate from a real coverage/ dir created by a prior `npm run
// test:coverage`. Passing an object short-circuits both branches.
function readCoverageSummary({ cwd, mockSummary }) {
  if (mockSummary !== undefined) return mockSummary;
  const candidates = [
    path.join(cwd, 'coverage', 'coverage-summary.json'),
    path.join(cwd, 'coverage-summary.json'),
  ];
  for (const f of candidates) {
    try {
      const text = fs.readFileSync(f, 'utf8');
      return JSON.parse(text);
    } catch { /* try next */ }
  }
  return null;
}

// Get files modified in the last N days. Returns Set of relative paths.
function getRecentlyEditedFiles({ cwd, days, mockRecentFiles }) {
  if (mockRecentFiles != null) return new Set(mockRecentFiles);
  const since = `${days || DEFAULT_LOOKBACK_DAYS}.days.ago`;
  const out = safeExec(`git log --since="${since}" --name-only --pretty=format: -- .`, { cwd });
  if (!out) return new Set();
  const files = new Set();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) files.add(trimmed.replace(/\\/g, '/'));
  }
  return files;
}

// Detect coverage gaps. Returns { candidates, ... }.
function detectCoverageGaps({ cwd, threshold, lookbackDays, maxCandidates, mockSummary, mockRecentFiles } = {}) {
  const repoRoot = cwd || process.cwd();
  const thr = threshold != null ? threshold : DEFAULT_THRESHOLD;
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;

  const summary = readCoverageSummary({ cwd: repoRoot, mockSummary });
  if (!summary) {
    return {
      candidates: [],
      total_low_coverage: 0,
      skipped_unchanged: 0,
      coverage_available: false,
    };
  }

  const recent = getRecentlyEditedFiles({ cwd: repoRoot, days: lookbackDays, mockRecentFiles });

  // Coverage summary shape:
  //   { "total": {...}, "/abs/path/to/file.js": { statements: { pct: 50 }, ... } }
  // We skip the "total" entry. Each file entry has statements/branches/functions/lines pcts.
  let totalLow = 0;
  let skippedUnchanged = 0;
  const candidates = [];
  for (const [filePath, metrics] of Object.entries(summary)) {
    if (filePath === 'total' || !metrics || !metrics.statements) continue;
    const pct = typeof metrics.statements.pct === 'number' ? metrics.statements.pct : null;
    if (pct === null || pct >= thr) continue;
    totalLow += 1;

    // Compute relative path for cross-reference vs git output
    const relFile = path.isAbsolute(filePath) ? path.relative(repoRoot, filePath) : filePath;
    const relNormalized = relFile.replace(/\\/g, '/');

    // Skip files that haven't been recently touched — coverage debt without
    // active development isn't worth filing
    const recentlyEdited = recent.has(relNormalized);
    if (!recentlyEdited) {
      skippedUnchanged += 1;
      continue;
    }

    candidates.push({
      file: relNormalized,
      statements_pct: pct,
      branches_pct: metrics.branches ? metrics.branches.pct : null,
      functions_pct: metrics.functions ? metrics.functions.pct : null,
      lines_pct: metrics.lines ? metrics.lines.pct : null,
      threshold: thr,
      recently_edited: true,
    });
  }

  // Sort by lowest coverage first (most impactful gaps)
  candidates.sort((a, b) => a.statements_pct - b.statements_pct);

  return {
    candidates: candidates.slice(0, max),
    total_low_coverage: totalLow,
    skipped_unchanged: skippedUnchanged,
    coverage_available: true,
  };
}

function formatIssueTitle(candidate) {
  return `Coverage gap: ${candidate.file} at ${candidate.statements_pct.toFixed(1)}% statements`;
}

function formatIssueBody(candidate) {
  const lines = [];
  lines.push(`## File`);
  lines.push('');
  lines.push(`\`${candidate.file}\``);
  lines.push('');
  lines.push(`## Coverage metrics (below ${candidate.threshold}% threshold)`);
  lines.push('');
  lines.push(`| metric | percentage |`);
  lines.push(`| --- | --- |`);
  lines.push(`| statements | ${candidate.statements_pct.toFixed(1)}% |`);
  if (candidate.branches_pct != null)  lines.push(`| branches   | ${candidate.branches_pct.toFixed(1)}% |`);
  if (candidate.functions_pct != null) lines.push(`| functions  | ${candidate.functions_pct.toFixed(1)}% |`);
  if (candidate.lines_pct != null)     lines.push(`| lines      | ${candidate.lines_pct.toFixed(1)}% |`);
  lines.push('');
  lines.push(`## Why this is filed`);
  lines.push('');
  lines.push('Steward\'s `test_coverage_gap` capability cross-references the project\'s');
  lines.push(`coverage report (\`coverage/coverage-summary.json\`) against \`git log\` to`);
  lines.push(`find files that are BOTH undertested (statements < ${candidate.threshold}%) AND`);
  lines.push(`recently edited. The combination is a strong signal that uncovered paths`);
  lines.push('are likely to harbor regressions.');
  lines.push('');
  lines.push('Suggested next steps:');
  lines.push('1. Run `npm run test:coverage` and inspect uncovered lines');
  lines.push('2. Add focused unit tests covering the recently-edited code paths');
  lines.push('3. Re-run coverage report to verify lift');
  lines.push('');
  lines.push('---');
  lines.push('Filed by Steward (cortex-x) test-coverage-gap. Deterministic — no LLM analysis.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const thrArg = args.find((a) => a.startsWith('--threshold='));
  const maxArg = args.find((a) => a.startsWith('--max='));

  const result = detectCoverageGaps({
    threshold: thrArg ? parseInt(thrArg.slice(12), 10) : DEFAULT_THRESHOLD,
    maxCandidates: maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Coverage-gap report:\n`);
    process.stdout.write(`  coverage available:   ${result.coverage_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  total low coverage:   ${result.total_low_coverage}\n`);
    process.stdout.write(`  skipped (unchanged):  ${result.skipped_unchanged}\n`);
    process.stdout.write(`  candidates (recent):  ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nGap candidates:\n');
      for (const c of result.candidates) {
        process.stdout.write(`  ${c.file.padEnd(50)}  ${c.statements_pct.toFixed(1)}% statements\n`);
      }
    }
  }
}

module.exports = {
  detectCoverageGaps,
  readCoverageSummary,
  getRecentlyEditedFiles,
  formatIssueTitle,
  formatIssueBody,
};
