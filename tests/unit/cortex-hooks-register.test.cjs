// cortex-hooks-register contract tests.
//
// Validates:
//   1. Pure-function safety (isCortexEntry, computePlan) — no I/O
//   2. End-to-end via subprocess with isolated fake $HOME
//   3. Idempotency, merge-preservation, malformed-JSON refusal
//
// All tests use os.tmpdir() as fake $HOME. Never touches the real
// ~/.claude/settings.json on the test host.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-hooks-register.cjs');
const { isCortexEntry, computePlan, HOOK_SPEC, CORTEX_PATH_RE } = require(SCRIPT);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkFakeHome(initialSettings) {
  const home = mkTmp('cortex-hooks-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (initialSettings !== undefined) {
    const payload = typeof initialSettings === 'string'
      ? initialSettings
      : JSON.stringify(initialSettings, null, 2) + '\n';
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), payload, 'utf8');
  }
  return home;
}

function runCli(args, home) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readSettingsFromHome(home) {
  const p = path.join(home, '.claude', 'settings.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('cortex-hooks-register — pure functions', () => {
  test('CORTEX_PATH_RE matches expected paths', () => {
    assert.ok(CORTEX_PATH_RE.test('/home/x/.claude/shared/hooks/session-start.cjs'));
    assert.ok(CORTEX_PATH_RE.test('C:\\Users\\x\\.claude\\shared\\hooks\\block-destructive.cjs'));
    assert.ok(!CORTEX_PATH_RE.test('node my-custom-hook.cjs'));
    assert.ok(!CORTEX_PATH_RE.test('.claude/hooks/local.cjs')); // different prefix
  });

  test('isCortexEntry recognizes both POSIX and Windows command paths', () => {
    assert.ok(isCortexEntry({ hooks: [{ command: 'node "$HOME/.claude/shared/hooks/block-destructive.cjs"' }] }));
    assert.ok(isCortexEntry({ hooks: [{ command: 'node "%USERPROFILE%\\.claude\\shared\\hooks\\session-start.cjs"' }] }));
    assert.ok(!isCortexEntry({ hooks: [{ command: 'echo "hello"' }] }));
    assert.ok(!isCortexEntry({}));
    assert.ok(!isCortexEntry({ hooks: 'not-an-array' }));
    assert.ok(!isCortexEntry({ hooks: [] }));
  });

  test('computePlan apply on empty current → adds all spec entries', () => {
    const { next, summary } = computePlan({}, 'apply');
    for (const event of Object.keys(HOOK_SPEC)) {
      assert.ok(Array.isArray(next[event]));
      assert.strictEqual(next[event].length, HOOK_SPEC[event].length);
    }
    assert.ok(summary.added.length >= Object.keys(HOOK_SPEC).length);
  });

  test('computePlan apply preserves non-cortex entries on the same event', () => {
    const userHook = { hooks: [{ type: 'command', command: 'node ~/my-custom.cjs', timeout: 5 }] };
    const current = { SessionStart: [userHook] };
    const { next } = computePlan(current, 'apply');
    assert.ok(next.SessionStart.includes(userHook), 'user hook must remain by reference');
    // And cortex SessionStart entries appended after.
    assert.ok(next.SessionStart.length >= 2);
  });

  test('computePlan apply idempotent: second pass produces no diff', () => {
    const first = computePlan({}, 'apply');
    const second = computePlan(first.next, 'apply');
    assert.strictEqual(second.summary.added.length, 0);
    assert.strictEqual(second.summary.removed.length, 0);
  });

  test('computePlan remove strips cortex entries, keeps user entries', () => {
    const userHook = { hooks: [{ type: 'command', command: 'node ~/my-custom.cjs' }] };
    const applied = computePlan({ SessionStart: [userHook] }, 'apply').next;
    const removed = computePlan(applied, 'remove').next;
    assert.ok(Array.isArray(removed.SessionStart));
    assert.strictEqual(removed.SessionStart.length, 1, 'only user hook should remain');
    assert.deepStrictEqual(removed.SessionStart[0], userHook);
  });
});

describe('cortex-hooks-register — CLI end-to-end (fake $HOME)', () => {
  test('--help prints usage and exits 0', () => {
    const home = mkTmp('cortex-hooks-help-');
    try {
      const r = runCli(['--help'], home);
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /cortex-hooks-register/);
      assert.match(r.stdout, /Identity rule/);
    } finally { tryRm(home); }
  });

  test('unknown flag → exit 1', () => {
    const home = mkTmp('cortex-hooks-badflag-');
    try {
      const r = runCli(['--banana'], home);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /unknown flag/);
    } finally { tryRm(home); }
  });

  test('--apply on fresh home (no settings.json) creates one with cortex hooks', () => {
    const home = mkFakeHome(undefined);
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.hooks, 'hooks key must exist');
      assert.ok(settings.hooks.SessionStart);
      assert.ok(settings.hooks.PreToolUse);
      assert.strictEqual(settings.hooks.PreToolUse.length, HOOK_SPEC.PreToolUse.length);
    } finally { tryRm(home); }
  });

  test('--apply preserves existing permissions key', () => {
    const home = mkFakeHome({
      permissions: { allow: ['Bash(npm test:*)'] },
      model: 'sonnet',
    });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.deepStrictEqual(settings.permissions, { allow: ['Bash(npm test:*)'] });
      assert.strictEqual(settings.model, 'sonnet');
      assert.ok(settings.hooks.SessionStart);
    } finally { tryRm(home); }
  });

  test('--apply preserves user-owned hook entries side by side with cortex hooks', () => {
    const userHook = {
      hooks: [{ type: 'command', command: 'node ~/my-personal-hook.cjs', timeout: 5 }],
    };
    const home = mkFakeHome({
      hooks: { SessionStart: [userHook] },
    });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      // User hook must still be present.
      const stillThere = settings.hooks.SessionStart.some(
        (e) => Array.isArray(e.hooks) && e.hooks[0]?.command === 'node ~/my-personal-hook.cjs'
      );
      assert.ok(stillThere, 'user-owned hook must survive --apply');
      // And cortex SessionStart hook also present.
      const cortexThere = settings.hooks.SessionStart.some(
        (e) => Array.isArray(e.hooks) && /session-start\.cjs/.test(e.hooks[0]?.command || '')
      );
      assert.ok(cortexThere, 'cortex SessionStart hook must be added');
    } finally { tryRm(home); }
  });

  test('idempotent: --apply twice yields no_change second time', () => {
    const home = mkFakeHome({});
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const r2 = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r2.status, 0);
      const result = JSON.parse(r2.stdout);
      assert.strictEqual(result.no_change, true);
    } finally { tryRm(home); }
  });

  test('--remove strips cortex hooks, leaves user hook + permissions intact', () => {
    const userHook = { hooks: [{ type: 'command', command: 'node ~/my-custom.cjs' }] };
    const home = mkFakeHome({
      permissions: { allow: ['Bash(npm:*)'] },
      hooks: { SessionStart: [userHook] },
    });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      // Verify both present after apply:
      const mid = readSettingsFromHome(home);
      assert.strictEqual(mid.hooks.SessionStart.length, 2);
      // Remove cortex:
      const r = runCli(['--remove', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.deepStrictEqual(settings.permissions, { allow: ['Bash(npm:*)'] });
      assert.strictEqual(settings.hooks.SessionStart.length, 1);
      assert.deepStrictEqual(settings.hooks.SessionStart[0], userHook);
    } finally { tryRm(home); }
  });

  test('--remove with no cortex entries → no_change', () => {
    const home = mkFakeHome({ permissions: {} });
    try {
      const r = runCli(['--remove', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.no_change, true);
    } finally { tryRm(home); }
  });

  test('--status reports cortex entry counts', () => {
    const home = mkFakeHome({});
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
      const report = JSON.parse(r.stdout);
      assert.strictEqual(report.ok, true);
      assert.ok(report.cortex_entries_total > 0);
      assert.ok(report.per_event.SessionStart);
    } finally { tryRm(home); }
  });

  test('--dry-run prints plan but does not write', () => {
    const home = mkFakeHome({});
    try {
      const r = runCli(['--apply', '--dry-run', '--json'], home);
      assert.strictEqual(r.status, 0);
      const plan = JSON.parse(r.stdout);
      assert.strictEqual(plan.dry_run, true);
      // Settings file should NOT have hooks key written.
      const settings = readSettingsFromHome(home);
      assert.ok(!settings.hooks, 'dry-run must not mutate settings.json');
    } finally { tryRm(home); }
  });

  test('malformed JSON → exit 1 with INVALID_JSON code', () => {
    const home = mkFakeHome('{ this is not json ');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'INVALID_JSON');
    } finally { tryRm(home); }
  });

  test('top-level array → exit 1 with NOT_OBJECT code', () => {
    const home = mkFakeHome('[1, 2, 3]');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.code, 'NOT_OBJECT');
    } finally { tryRm(home); }
  });

  test('backup file written next to settings.json on first apply', () => {
    const home = mkFakeHome({ existing: 'content' });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.ok(result.backup_path, 'backup_path must be in result');
      assert.ok(fs.existsSync(result.backup_path), 'backup file must exist');
      // Backup should contain the original (no hooks key).
      const backupContents = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
      assert.strictEqual(backupContents.existing, 'content');
      assert.ok(!backupContents.hooks, 'backup must reflect pre-mutation state');
    } finally { tryRm(home); }
  });

  test('--remove leaves no empty hooks key (cleanly stripped)', () => {
    const home = mkFakeHome({ permissions: { allow: [] } });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      runCli(['--remove', '--yes', '--json'], home);
      const settings = readSettingsFromHome(home);
      assert.ok(!settings.hooks, 'hooks key should be removed when empty');
      assert.ok(settings.permissions, 'unrelated keys preserved');
    } finally { tryRm(home); }
  });
});
