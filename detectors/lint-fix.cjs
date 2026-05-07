#!/usr/bin/env node
// lint-fix.cjs — Sprint 1.8.9 ESLint --fix + tsc --noEmit detector.
//
// Capability #8 from the Hermes evolution roadmap. Deterministic happy path:
//   1. Run `npx eslint --fix .` (if eslint present) — auto-fixes formatting,
//      simple style violations, unused-import removal, etc.
//   2. Run `npx tsc --noEmit` (if TypeScript present) — surfaces type errors
//      that aren't auto-fixable (LLM diagnosis is OUT-of-scope for v1; we
//      file an issue instead).
//   3. Compare working-tree state before/after. Touched files are the auto-fix
//      output. Type errors become a candidate to open as gh issues.
//
// Output:
//   {
//     touched_files: ["path/a.js", ...],   // files modified by eslint --fix
//     type_errors:   [{file, line, msg}],  // tsc --noEmit findings
//     eslint_available: bool,
//     tsc_available: bool,
//   }
//
// CLI:
//   node detectors/lint-fix.cjs               # human report (no fs writes)
//   node detectors/lint-fix.cjs --json
//   node detectors/lint-fix.cjs --apply       # actually run eslint --fix

'use strict';

const { execSync, spawnSync } = require('child_process');

const SIGNAL_TIMEOUT_MS = 60_000; // eslint can be slow on large repos
const TSC_TIMEOUT_MS = 90_000;

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || SIGNAL_TIMEOUT_MS,
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    if (err && err.stdout != null) {
      return Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8').trim() : String(err.stdout).trim();
    }
    return null;
  }
}

function eslintAvailable(cwd) {
  // npx will resolve eslint from node_modules without needing a global install.
  // Test by running --version with timeout.
  const r = spawnSync('npx', ['eslint', '--version'], {
    cwd, encoding: 'utf8', timeout: 10_000,
    // npx itself is a Node script; on Windows, it's npx.cmd
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function tscAvailable(cwd) {
  const r = spawnSync('npx', ['tsc', '--version'], {
    cwd, encoding: 'utf8', timeout: 10_000,
    shell: process.platform === 'win32',
  });
  return r.status === 0;
}

// Run `git status --porcelain` and parse modified-file paths.
function getModifiedFiles(cwd) {
  const out = safeExec('git status --porcelain', { cwd, timeout: 5_000 });
  if (!out) return [];
  const files = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "XY path"  e.g. " M src/a.js" or "?? new.js"
    const match = trimmed.match(/^[A-Z?!\s]{1,2}\s+(.+)$/);
    if (match) files.push(match[1].replace(/^"|"$/g, ''));
  }
  return files;
}

// Run eslint --fix in repo. Returns { ran, eslint_available, modified_files }.
// Skips silently if eslint not installed (project may not use it).
function runEslintFix({ cwd, apply, mockResult } = {}) {
  if (mockResult != null) return mockResult;
  if (!eslintAvailable(cwd)) {
    return { ran: false, eslint_available: false, modified_files: [] };
  }
  if (!apply) {
    // Dry mode — report capability without running
    return { ran: false, eslint_available: true, modified_files: [] };
  }
  const before = new Set(getModifiedFiles(cwd));
  const r = spawnSync('npx', ['eslint', '--fix', '.'], {
    cwd, encoding: 'utf8', timeout: SIGNAL_TIMEOUT_MS,
    shell: process.platform === 'win32',
  });
  const after = getModifiedFiles(cwd);
  const newlyModified = after.filter((f) => !before.has(f));
  return {
    ran: true,
    eslint_available: true,
    modified_files: newlyModified,
    exit_code: r.status,
    stderr: (r.stderr || '').slice(0, 500),
  };
}

// Run tsc --noEmit, parse output for type errors. Returns array of
// { file, line, column, msg, code }.
function runTsc({ cwd, mockResult } = {}) {
  if (mockResult != null) return mockResult;
  if (!tscAvailable(cwd)) {
    return { ran: false, tsc_available: false, type_errors: [] };
  }
  const r = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd, encoding: 'utf8', timeout: TSC_TIMEOUT_MS,
    shell: process.platform === 'win32',
  });
  const output = (r.stdout || '') + '\n' + (r.stderr || '');
  // tsc error line shape: `path/file.ts(line,col): error TS1234: message text`
  const errors = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/);
    if (m) {
      errors.push({
        file: m[1],
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        code: m[4],
        msg: m[5],
      });
    }
  }
  return {
    ran: true,
    tsc_available: true,
    type_errors: errors,
    exit_code: r.status,
  };
}

// Top-level entry point. Bundles eslint + tsc results.
function detectLintFix({ cwd, apply, mockEslint, mockTsc } = {}) {
  const repoRoot = cwd || process.cwd();
  const eslint = runEslintFix({ cwd: repoRoot, apply, mockResult: mockEslint });
  const tsc = runTsc({ cwd: repoRoot, mockResult: mockTsc });

  return {
    touched_files: eslint.modified_files || [],
    type_errors: tsc.type_errors || [],
    eslint_available: eslint.eslint_available,
    tsc_available: tsc.tsc_available,
    eslint_ran: eslint.ran,
    tsc_ran: tsc.ran,
  };
}

function formatIssueTitle(typeError) {
  const truncMsg = typeError.msg.length > 60 ? typeError.msg.slice(0, 60) + '…' : typeError.msg;
  return `${typeError.code}: ${truncMsg}`;
}

function formatIssueBody(typeError) {
  const lines = [];
  lines.push(`## Type error`);
  lines.push('');
  lines.push(`\`${typeError.file}:${typeError.line}:${typeError.column}\``);
  lines.push('');
  lines.push(`**Code:** ${typeError.code}`);
  lines.push(`**Message:** ${typeError.msg}`);
  lines.push('');
  lines.push('## Why this is filed');
  lines.push('');
  lines.push('Hermes\'s `lint_fix_shipper` capability runs `npx eslint --fix` (auto-fix) +');
  lines.push('`npx tsc --noEmit` (type check). ESLint auto-fixes ship as a separate commit;');
  lines.push('TypeScript errors are NOT auto-fixable, so they get filed as issues for human');
  lines.push('attention.');
  lines.push('');
  lines.push('---');
  lines.push('Filed by Hermes (cortex-x) lint-fix-shipper.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const apply = args.some((a) => a === '--apply');

  const result = detectLintFix({ apply });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Lint-fix report:\n`);
    process.stdout.write(`  eslint available: ${result.eslint_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  tsc available:    ${result.tsc_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  eslint ran:       ${result.eslint_ran ? 'yes' : 'no (use --apply to run)'}\n`);
    process.stdout.write(`  tsc ran:          ${result.tsc_ran ? 'yes' : 'no'}\n`);
    process.stdout.write(`  files auto-fixed: ${result.touched_files.length}\n`);
    process.stdout.write(`  type errors:      ${result.type_errors.length}\n`);
    if (result.touched_files.length > 0) {
      process.stdout.write('\nAuto-fixed files:\n');
      for (const f of result.touched_files) process.stdout.write(`  ${f}\n`);
    }
    if (result.type_errors.length > 0) {
      process.stdout.write('\nType errors (first 5):\n');
      for (const e of result.type_errors.slice(0, 5)) {
        process.stdout.write(`  ${e.file}:${e.line}:${e.column}  ${e.code}: ${e.msg}\n`);
      }
    }
  }
}

module.exports = {
  detectLintFix,
  runEslintFix,
  runTsc,
  getModifiedFiles,
  eslintAvailable,
  tscAvailable,
  formatIssueTitle,
  formatIssueBody,
};
