// hook-shape.test.cjs — contract every shared/hooks/*.cjs must satisfy.
//
// Generic invariants — applied to every hook, regardless of event type.
// These catch regressions that unit tests miss because unit tests focus on
// hook-specific behavior. The contract tests check the *boundary* every
// hook crosses.
//
// Invariants:
//   1. Hook script exists and is a regular file
//   2. Hook script can be require()'d without crashing (syntax-clean)
//      EXCEPT: stdin-driven hooks that immediately invoke process.exit on
//      empty stdin will be skipped here (covered by spawnSync tests)
//   3. Hook honors the 5s timeout (always returns within budget)
//   4. Hook does NOT leak Dave-specific paths in stdout/stderr
//   5. Hook fails open: malformed JSON / empty stdin → exit 0 (no crash)
//
// The list of hooks is derived from shared/hooks/*.cjs (excluding _lib/).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runHook, HOOKS_DIR } = require('../_helpers/run-hook.cjs');

function listHooks() {
  return fs
    .readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.cjs') && !f.endsWith('.test.cjs'))
    .map((f) => f.replace(/\.cjs$/, ''));
}

const ALL_HOOKS = listHooks();

// Hooks that operate on cwd-side-effects (write files) — give them a tmp
// cwd so they don't pollute the repo.
const NEEDS_TMP_CWD = new Set(['pre-compact', 'session-start']);

const os = require('node:os');

function tempCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-hook-shape-'));
}

describe('hook-shape contract: all shared/hooks/*.cjs', () => {
  test('inventory non-empty', () => {
    assert.ok(ALL_HOOKS.length >= 5, `expected >= 5 hooks; found ${ALL_HOOKS.length}: ${ALL_HOOKS.join(', ')}`);
  });

  for (const hookName of ALL_HOOKS) {
    test(`${hookName}: file exists and is regular file`, () => {
      const p = path.join(HOOKS_DIR, `${hookName}.cjs`);
      assert.ok(fs.statSync(p).isFile());
    });

    test(`${hookName}: respects 5s timeout (no stdin payload)`, () => {
      const cwd = NEEDS_TMP_CWD.has(hookName) ? tempCwd() : undefined;
      try {
        const r = runHook(hookName, '', { timeout: 5000, cwd });
        assert.equal(r.timedOut, false, `${hookName} timed out on empty stdin — likely waiting for input it'll never get`);
        // exit code 0 OR 1 acceptable (1 = non-blocking error per Anthropic
        // hook contract); 2 = blocking, also acceptable for some hook types
        assert.ok(
          [0, 1, 2, null].includes(r.exitCode),
          `${hookName} exited with unexpected code ${r.exitCode}; stderr: ${r.stderr}`
        );
      } finally {
        if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    test(`${hookName}: does not leak Dave-specific paths`, () => {
      const cwd = NEEDS_TMP_CWD.has(hookName) ? tempCwd() : undefined;
      try {
        const r = runHook(hookName, '', { timeout: 5000, cwd });
        const combined = (r.stdout + r.stderr).toLowerCase();
        assert.ok(
          !combined.includes('/c/users/david/') && !combined.includes('c:\\users\\david\\'),
          `${hookName} leaked Dave-specific path; combined output:\n${(r.stdout + r.stderr).slice(0, 500)}`
        );
      } finally {
        if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    test(`${hookName}: fail-open on malformed JSON stdin`, () => {
      const cwd = NEEDS_TMP_CWD.has(hookName) ? tempCwd() : undefined;
      try {
        const r = runHook(hookName, '{ this is not valid JSON }', { timeout: 5000, cwd });
        // Either exit 0 (graceful continue) OR null/SIGTERM (timeout — bad)
        assert.ok(r.exitCode === 0 || r.exitCode === 1,
          `${hookName} crashed on malformed JSON; exit ${r.exitCode}, stderr: ${r.stderr.slice(0, 300)}`);
        assert.equal(r.timedOut, false);
      } finally {
        if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});

describe('hook-shape contract: critical hooks must be present', () => {
  // Hard-coded list of hooks Hermes runtime will depend on — if any of these
  // is renamed/removed, this test fires loudly.
  const CRITICAL_HOOKS = [
    'block-destructive',
    'session-start',
    'pre-compact',
    'auto-orchestrate',
    'pre-tool-use',
    'post-tool-use',
  ];

  for (const hookName of CRITICAL_HOOKS) {
    test(`critical hook present: ${hookName}.cjs`, () => {
      const p = path.join(HOOKS_DIR, `${hookName}.cjs`);
      assert.ok(
        fs.existsSync(p),
        `Critical hook missing: ${hookName}. Hermes runtime depends on this.`
      );
    });
  }
});
