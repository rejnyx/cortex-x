#!/usr/bin/env node
// flaky-test-repair.cjs — Sprint 1.8.5 marker-based flaky test quarantine.
//
// Pragmatic v1: scan source for `// HERMES-FLAKY: <reason>` markers above
// test/it/describe declarations. Each match is a "user said this is flaky,
// please quarantine it" signal. Steward:
//   1. Replaces test(...) → test.skip(...)  (or it/describe variants)
//   2. Removes the HERMES-FLAKY marker (action consumed)
//   3. Files a gh issue with the test name + reason + git blame
//   4. Returns touchedFiles = [<test file>] for atomic commit + draft PR
//
// Why marker-based instead of CI-integrated retry-N-times: the latter needs
// `flaky-tests.json` written by the project's CI workflow across runs —
// out of scope for cortex-x to require. Markers are opt-in, deterministic,
// language-agnostic, and zero-config.
//
// Future v2 (parked to v0.9+): parse ~/.cortex/journal/<slug>.jsonl for
// repeat verifier failures with same test name → auto-flag (no marker
// needed). Requires verifier.cjs to capture failed test names per run.
//
// CLI:
//   node detectors/flaky-test-repair.cjs              # human report
//   node detectors/flaky-test-repair.cjs --json       # machine output
//   node detectors/flaky-test-repair.cjs --max=5      # cap candidates

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CANDIDATES = 5;
const FLAKY_MARKER_RE = /\bHERMES-FLAKY\b[:\s]*([^\n]*)/g;
// Captures: test('name', ...), it('name', ...), describe('name', ...)
// across single + double + backtick quotes.
const TEST_DECL_RE = /^(\s*)((?:test|it|describe))\s*\(\s*(['"`])([^'"`]+)\3/;
const SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cortex', 'target']);

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
        if (exts.has(ext)) {
          count += 1;
          yield full;
        }
      }
    }
  }
  yield* walk(root);
}

// Scan a single file's content for HERMES-FLAKY markers + their associated
// test declarations. Returns [{ markerLine, testLine, testKind, testName, reason, indent }].
function scanContentForMarkers(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    FLAKY_MARKER_RE.lastIndex = 0;
    const m = FLAKY_MARKER_RE.exec(line);
    if (!m) continue;
    const reason = (m[1] || '').trim();

    // Look ahead up to 3 lines for the next test/it/describe declaration
    let testLineIdx = -1;
    let testMatch = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const decl = TEST_DECL_RE.exec(lines[j]);
      if (decl) {
        testLineIdx = j;
        testMatch = decl;
        break;
      }
    }
    if (testLineIdx === -1) continue; // marker without followup decl — skip

    out.push({
      markerLine: i + 1,            // 1-indexed
      markerLineIndex: i,           // 0-indexed for content edits
      testLine: testLineIdx + 1,
      testLineIndex: testLineIdx,
      testKind: testMatch[2],       // test | it | describe
      testName: testMatch[4],
      indent: testMatch[1] || '',
      reason,
    });
  }
  return out;
}

// Apply quarantine edit to a file content: replace test(...) → test.skip(...)
// at the matched line, and remove the HERMES-FLAKY marker line. Returns
// { newContent, edits: [{type, line, before, after}] } for transparency.
function applyQuarantineEdits(content, markers) {
  if (markers.length === 0) return { newContent: content, edits: [] };
  const lines = content.split('\n');
  const edits = [];

  // Process in reverse line order so earlier indices stay valid as we splice
  const sorted = [...markers].sort((a, b) => b.markerLineIndex - a.markerLineIndex);
  for (const m of sorted) {
    // Replace `test(` → `test.skip(`, `it(` → `it.skip(`, `describe(` → `describe.skip(`
    const oldLine = lines[m.testLineIndex];
    const skipReplace = oldLine.replace(
      new RegExp(`\\b${m.testKind}\\s*\\(`),
      `${m.testKind}.skip(`,
    );
    edits.push({
      type: 'quarantine',
      line: m.testLine,
      before: oldLine.trim(),
      after: skipReplace.trim(),
    });
    lines[m.testLineIndex] = skipReplace;

    // Remove the HERMES-FLAKY marker line entirely (it's been actioned)
    lines.splice(m.markerLineIndex, 1);
    edits.push({
      type: 'remove_marker',
      line: m.markerLine,
      before: 'HERMES-FLAKY: ' + m.reason,
      after: '',
    });
  }

  return { newContent: lines.join('\n'), edits };
}

function detectFlakyMarkers({ cwd, mockFiles, maxCandidates } = {}) {
  const repoRoot = cwd || process.cwd();
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;
  const found = [];

  if (mockFiles) {
    for (const f of mockFiles) {
      const markers = scanContentForMarkers(f.content || '');
      for (const m of markers) {
        found.push({ file: f.path, ...m });
      }
    }
  } else {
    for (const filePath of walkSourceFiles(repoRoot)) {
      let content;
      try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
      const markers = scanContentForMarkers(content);
      for (const m of markers) {
        // Normalize to forward slashes so JSON output + git stage commands are
        // platform-consistent (path.relative emits backslashes on Windows).
        const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        found.push({ file: rel, ...m });
      }
    }
  }

  return {
    candidates: found.slice(0, max),
    total_found: found.length,
  };
}

function formatIssueTitle(candidate) {
  const truncated = candidate.testName.length > 50
    ? candidate.testName.slice(0, 50) + '…'
    : candidate.testName;
  return `Flaky test quarantined: ${truncated}`;
}

function formatIssueBody(candidate) {
  const lines = [];
  lines.push(`## Quarantined test`);
  lines.push('');
  lines.push(`\`${candidate.file}:${candidate.testLine}\``);
  lines.push('');
  lines.push(`**Test:** \`${candidate.testKind}('${candidate.testName}')\``);
  lines.push('');
  lines.push(`**Reason given:** ${candidate.reason || '(no reason supplied)'}`);
  lines.push('');
  lines.push('## What Steward did');
  lines.push('');
  lines.push(`- Replaced \`${candidate.testKind}(...)\` with \`${candidate.testKind}.skip(...)\``);
  lines.push('- Removed the `HERMES-FLAKY:` marker comment (action consumed)');
  lines.push('');
  lines.push('## Next steps for the maintainer');
  lines.push('');
  lines.push('1. Investigate the underlying flakiness root cause');
  lines.push('2. Fix the test or the code under test');
  lines.push('3. Remove `.skip` to re-enable');
  lines.push('4. Close this issue');
  lines.push('');
  lines.push('---');
  lines.push('Filed by Steward (cortex-x) flaky-test-repair. Marker pattern: `// HERMES-FLAKY: reason`.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const result = detectFlakyMarkers({
    maxCandidates: maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Flaky-test-repair report:\n`);
    process.stdout.write(`  total markers: ${result.total_found}\n`);
    process.stdout.write(`  candidates:    ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nMarked tests to quarantine:\n');
      for (const c of result.candidates) {
        process.stdout.write(`  ${c.file}:${c.testLine}  [${c.testKind}] ${c.testName}\n`);
        if (c.reason) process.stdout.write(`    reason: ${c.reason}\n`);
      }
    } else {
      process.stdout.write('\nNo HERMES-FLAKY markers found. Mark a flaky test by\n');
      process.stdout.write('adding `// HERMES-FLAKY: <reason>` immediately above the test() line.\n');
    }
  }
}

module.exports = {
  detectFlakyMarkers,
  scanContentForMarkers,
  applyQuarantineEdits,
  formatIssueTitle,
  formatIssueBody,
};
