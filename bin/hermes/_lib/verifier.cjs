// verifier.cjs — runs the project's verification commands (`npm test` and
// optionally `npm run lint`) and reports a structured result.
//
// Hermes's atomic-commit-per-action contract (MUST-H1) requires that every
// action's edits leave the test suite green. The verifier wraps that gate.
//
// Contract:
//   - runNpmTest({ repoRoot, timeoutMs }) returns { ok, exitCode, stdout, stderr, durationMs, signal }
//   - Never throws — timeouts + spawn errors surface as { ok: false, error }
//   - No shell injection: spawnSync with array argv, never string command
//   - Default timeout 5 minutes; configurable per-call

'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function runNpmCommand(args, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  // On Windows, npm is npm.cmd (batch file) which requires shell:true to spawn.
  // Node 16+ closed the auto-shell-for-cmd loophole as a CVE-2024-27980 fix.
  // We pass `shell: true` only on Windows + set windowsVerbatimArguments to
  // avoid Node injecting quoting we don't want. Args are static `['test']` or
  // `['run', '<scriptName>']` — no user input flows in.
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  const start = Date.now();
  const result = spawnSync(npmCmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CI: '1' },
    shell: isWindows,
  });
  const durationMs = Date.now() - start;

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
      code: result.error.code,
      durationMs,
      signal: result.signal,
    };
  }

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    durationMs,
    signal: result.signal,
    timedOut: result.signal === 'SIGTERM',
  };
}

function runNpmTest(opts = {}) {
  return runNpmCommand(['test'], opts);
}

function runNpmScript(scriptName, opts = {}) {
  return runNpmCommand(['run', scriptName], opts);
}

// Compact one-line summary for journal entries.
// Returns "192/192 pass · 8.7s" or "192 pass / 3 fail · 8.7s" or "TIMEOUT 300s".
function summarizeResult(result) {
  const sec = (result.durationMs / 1000).toFixed(1);
  if (result.timedOut) return `TIMEOUT ${sec}s`;
  if (result.error) return `ERROR ${result.error} · ${sec}s`;

  // Try to extract test counts from `node --test` style output
  const passMatch = result.stdout.match(/^[\sℹ]*tests\s+(\d+)/m);
  const failMatch = result.stdout.match(/^[\sℹ]*fail\s+(\d+)/m);

  if (passMatch && failMatch) {
    const total = Number(passMatch[1]);
    const failed = Number(failMatch[1]);
    if (failed === 0) return `${total}/${total} pass · ${sec}s`;
    return `${total - failed} pass / ${failed} fail · ${sec}s`;
  }

  return `${result.ok ? 'pass' : 'fail'} (exit ${result.exitCode}) · ${sec}s`;
}

module.exports = {
  runNpmTest,
  runNpmScript,
  runNpmCommand,
  summarizeResult,
  DEFAULT_TIMEOUT_MS,
};
