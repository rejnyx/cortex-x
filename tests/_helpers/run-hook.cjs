// run-hook.cjs — invoke a cortex-x hook script with mock stdin payload.
//
// Hooks are stdin-driven Node CJS scripts under shared/hooks/<name>.cjs.
// Claude Code spawns them per event (PreToolUse, SessionStart, PostToolUse,
// UserPromptSubmit, PreCompact) and pipes a JSON payload on stdin. The hook
// writes structured JSON or human messages to stdout/stderr and exits.
//
// This helper standardizes test invocations:
//
//   const { runHook } = require('../_helpers/run-hook.cjs');
//   const r = runHook('block-destructive', {
//     tool_name: 'Bash',
//     tool_input: { command: 'rm -rf /' },
//   });
//   assert.equal(r.exitCode, 0);                       // fail-open contract
//   assert.match(r.stdout, /permissionDecision.*deny/);
//
// Cross-platform: spawnSync invokes hook via process.execPath (the running
// node binary), bypassing the shebang line and OS-level execute permissions.
// Works on Linux, macOS, Windows native, Git Bash without modification.

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'shared', 'hooks');

const DEFAULT_TIMEOUT_MS = 5000;

function runHook(name, payload, options = {}) {
  const hookPath = path.join(HOOKS_DIR, `${name}.cjs`);
  const input =
    payload === undefined || payload === null
      ? ''
      : typeof payload === 'string'
      ? payload
      : JSON.stringify(payload);

  const result = spawnSync(process.execPath, [hookPath], {
    encoding: 'utf8',
    input,
    timeout: options.timeout || DEFAULT_TIMEOUT_MS,
    cwd: options.cwd || REPO_ROOT,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.signal === 'SIGTERM',
    error: result.error,
  };
}

function parseHookOutput(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

module.exports = {
  runHook,
  parseHookOutput,
  REPO_ROOT,
  HOOKS_DIR,
  DEFAULT_TIMEOUT_MS,
};
