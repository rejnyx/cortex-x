// block-destructive.test.cjs — runtime-safety hook tests.
//
// block-destructive.cjs is registered in ~/.claude/settings.json as a
// PreToolUse Bash matcher. It receives JSON on stdin describing the
// pending tool call and decides allow/deny by writing structured JSON
// to stdout (per Claude Code hook contract) or staying silent (allow).
//
// This is the most safety-critical hook in cortex-x — Hermes runtime
// will rely on it to refuse `rm -rf`, force-push, and similar
// irreversible commands. ANY regression here = real user damage.
//
// Hook contract (per source: shared/hooks/block-destructive.cjs):
//   - Input on stdin: { tool_name, tool_input: { command, ... }, ... }
//   - Block: stdout = { hookSpecificOutput: { permissionDecision: 'deny',
//                       permissionDecisionReason: '...' } }
//   - Allow: silent (empty stdout), exit 0
//   - Always exit 0 — never throw, fail-open on parse errors

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runHook, parseHookOutput } = require('../../_helpers/run-hook.cjs');

function bashCall(command) {
  return { tool_name: 'Bash', tool_input: { command } };
}

function expectBlocked(result, reasonRegex) {
  assert.equal(result.exitCode, 0, `hook should exit 0 even when blocking; got ${result.exitCode}, stderr: ${result.stderr}`);
  const parsed = parseHookOutput(result.stdout);
  assert.ok(parsed, `expected JSON output; got: ${result.stdout}`);
  assert.equal(parsed.hookSpecificOutput?.permissionDecision, 'deny');
  if (reasonRegex) {
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, reasonRegex);
  }
}

function expectAllowed(result) {
  assert.equal(result.exitCode, 0, `allow path should exit 0; stderr: ${result.stderr}`);
  // Allow = silent stdout (no permissionDecision emitted)
  const parsed = parseHookOutput(result.stdout);
  if (parsed) {
    assert.notEqual(parsed.hookSpecificOutput?.permissionDecision, 'deny',
      `expected no deny output; got: ${result.stdout}`);
  }
}

describe('block-destructive: filesystem destruction', () => {
  test('blocks rm -rf /', () => {
    const r = runHook('block-destructive', bashCall('rm -rf /'));
    expectBlocked(r, /Recursive force delete/i);
  });

  test('blocks rm -rf $HOME', () => {
    const r = runHook('block-destructive', bashCall('rm -rf $HOME'));
    expectBlocked(r, /Recursive force delete/i);
  });

  test('blocks rm -fr ~/some/path', () => {
    const r = runHook('block-destructive', bashCall('rm -fr ~/important'));
    expectBlocked(r, /Recursive force delete/i);
  });

  test('blocks rm --recursive --force ./build', () => {
    const r = runHook('block-destructive', bashCall('rm --recursive --force ./build'));
    expectBlocked(r, /Recursive force delete/i);
  });

  test('allows rm -r ./tmp (no force)', () => {
    const r = runHook('block-destructive', bashCall('rm -r ./tmp'));
    expectAllowed(r);
  });

  test('allows rm single-file.txt', () => {
    const r = runHook('block-destructive', bashCall('rm single-file.txt'));
    expectAllowed(r);
  });
});

describe('block-destructive: git destructive ops', () => {
  test('blocks git push --force', () => {
    const r = runHook('block-destructive', bashCall('git push --force origin main'));
    expectBlocked(r, /Force push/i);
  });

  test('blocks git push -f', () => {
    const r = runHook('block-destructive', bashCall('git push -f origin main'));
    expectBlocked(r, /Force push/i);
  });

  test('blocks git reset --hard HEAD~5', () => {
    const r = runHook('block-destructive', bashCall('git reset --hard HEAD~5'));
    expectBlocked(r, /Hard reset/i);
  });

  test('blocks git clean -fd', () => {
    const r = runHook('block-destructive', bashCall('git clean -fd'));
    expectBlocked(r, /Git clean/i);
  });

  test('blocks git branch -D feature/old', () => {
    const r = runHook('block-destructive', bashCall('git branch -D feature/old'));
    expectBlocked(r, /branch delete/i);
  });

  test('blocks git checkout . (blanket)', () => {
    const r = runHook('block-destructive', bashCall('git checkout .'));
    expectBlocked(r, /Blanket checkout/i);
  });

  test('blocks git restore . (blanket)', () => {
    const r = runHook('block-destructive', bashCall('git restore .'));
    expectBlocked(r, /Blanket restore/i);
  });

  test('blocks git stash drop', () => {
    const r = runHook('block-destructive', bashCall('git stash drop'));
    expectBlocked(r, /Stash destruction/i);
  });

  test('blocks git stash clear', () => {
    const r = runHook('block-destructive', bashCall('git stash clear'));
    expectBlocked(r, /Stash destruction/i);
  });

  test('allows git push origin main', () => {
    const r = runHook('block-destructive', bashCall('git push origin main'));
    expectAllowed(r);
  });

  test('allows git status', () => {
    const r = runHook('block-destructive', bashCall('git status'));
    expectAllowed(r);
  });

  test('allows git checkout -b new-feature', () => {
    const r = runHook('block-destructive', bashCall('git checkout -b new-feature'));
    expectAllowed(r);
  });

  test('allows git restore --staged file.txt', () => {
    const r = runHook('block-destructive', bashCall('git restore --staged file.txt'));
    expectAllowed(r);
  });
});

describe('block-destructive: database destruction', () => {
  test('blocks DROP TABLE users', () => {
    const r = runHook('block-destructive', bashCall('psql -c "DROP TABLE users;"'));
    expectBlocked(r, /DROP TABLE/i);
  });

  test('blocks DROP DATABASE prod', () => {
    const r = runHook('block-destructive', bashCall('psql -c "DROP DATABASE prod;"'));
    expectBlocked(r, /DROP DATABASE/i);
  });

  test('blocks TRUNCATE logs', () => {
    const r = runHook('block-destructive', bashCall('psql -c "TRUNCATE logs;"'));
    expectBlocked(r, /TRUNCATE/i);
  });

  test('blocks supabase db reset', () => {
    const r = runHook('block-destructive', bashCall('supabase db reset'));
    expectBlocked(r, /Supabase DB reset/i);
  });

  test('allows SELECT queries', () => {
    const r = runHook('block-destructive', bashCall('psql -c "SELECT * FROM users LIMIT 1;"'));
    expectAllowed(r);
  });
});

describe('block-destructive: defensive parsing', () => {
  test('fail-open on malformed JSON', () => {
    const r = runHook('block-destructive', '{ this is not valid JSON }');
    assert.equal(r.exitCode, 0, 'fail-open contract — never crash session');
  });

  test('fail-open on empty input', () => {
    const r = runHook('block-destructive', '');
    assert.equal(r.exitCode, 0);
  });

  test('fail-open on non-Bash tool (no command field)', () => {
    const r = runHook('block-destructive', { tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } });
    assert.equal(r.exitCode, 0);
    expectAllowed(r);
  });

  test('respects 5s timeout (smoke check — hook returns instantly)', () => {
    const r = runHook('block-destructive', bashCall('echo hello'), { timeout: 5000 });
    assert.equal(r.timedOut, false, 'simple echo should not approach timeout');
    assert.equal(r.exitCode, 0);
  });
});
