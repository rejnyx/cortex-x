// cortex-permissions-register contract tests.
//
// Validates:
//   1. Pure-function safety (isCortexPattern, computePlan) — no I/O
//   2. End-to-end via subprocess with isolated fake $HOME
//   3. Identity rule: only cortex-manifest entries touched on --remove
//   4. Backup file written with mode 0o600 (Sprint 2.21.3 MED 2 parity)
//   5. Forward-compat: unknown permissions sub-keys preserved
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
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-permissions-register.cjs');
const { isCortexPattern, computePlan, CORTEX_PERMISSIONS, normalizePermissionsField, normalizeKindList } = require(SCRIPT);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkFakeHome(initialSettings) {
  const home = mkTmp('cortex-perms-home-');
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

describe('cortex-permissions-register — pure functions', () => {
  test('CORTEX_PERMISSIONS manifest shape: deny + allow only, no ask', () => {
    assert.ok(Array.isArray(CORTEX_PERMISSIONS.deny));
    assert.ok(Array.isArray(CORTEX_PERMISSIONS.allow));
    assert.strictEqual(CORTEX_PERMISSIONS.ask, undefined);
    assert.ok(CORTEX_PERMISSIONS.deny.length >= 10, 'deny floor should have at least 10 entries');
    assert.ok(CORTEX_PERMISSIONS.allow.length >= 10, 'allow baseline should have at least 10 entries');
  });

  test('deny floor includes load-bearing destructive patterns', () => {
    assert.ok(CORTEX_PERMISSIONS.deny.includes('Bash(rm -rf*)'));
    assert.ok(CORTEX_PERMISSIONS.deny.includes('Bash(git push --force*)'));
    assert.ok(CORTEX_PERMISSIONS.deny.includes('Bash(git reset --hard*)'));
    assert.ok(CORTEX_PERMISSIONS.deny.includes('Bash(supabase db reset*)'));
    assert.ok(CORTEX_PERMISSIONS.deny.includes('Bash(npm publish*)'));
  });

  test('isCortexPattern: exact-string match per kind', () => {
    assert.ok(isCortexPattern('Bash(rm -rf*)', 'deny'));
    assert.ok(isCortexPattern('Bash(npm test*)', 'allow'));
    assert.ok(!isCortexPattern('Bash(rm -rf*)', 'allow'), 'kind matters');
    assert.ok(!isCortexPattern('Bash(npm test*)', 'deny'), 'kind matters');
    assert.ok(!isCortexPattern('Bash(my-user-tool*)', 'deny'));
    assert.ok(!isCortexPattern('Bash(my-user-tool*)', 'allow'));
    assert.ok(!isCortexPattern(null, 'deny'));
    assert.ok(!isCortexPattern(undefined, 'allow'));
    assert.ok(!isCortexPattern('Bash(rm -rf*)', 'unknown_kind'));
  });

  test('normalizePermissionsField: null / array / scalar → {}', () => {
    assert.deepStrictEqual(normalizePermissionsField(null), {});
    assert.deepStrictEqual(normalizePermissionsField(undefined), {});
    assert.deepStrictEqual(normalizePermissionsField([]), {});
    assert.deepStrictEqual(normalizePermissionsField('string'), {});
    assert.deepStrictEqual(normalizePermissionsField(42), {});
    assert.deepStrictEqual(normalizePermissionsField({ allow: ['x'] }), { allow: ['x'] });
  });

  test('normalizeKindList: non-array → []; filters non-strings', () => {
    assert.deepStrictEqual(normalizeKindList(null), []);
    assert.deepStrictEqual(normalizeKindList('not-array'), []);
    assert.deepStrictEqual(normalizeKindList(['a', 'b', 42, null, 'c']), ['a', 'b', 'c']);
  });

  test('computePlan apply on empty current → adds all manifest entries', () => {
    const { next, summary } = computePlan({}, 'apply');
    assert.strictEqual(next.deny.length, CORTEX_PERMISSIONS.deny.length);
    assert.strictEqual(next.allow.length, CORTEX_PERMISSIONS.allow.length);
    assert.strictEqual(summary.added.deny.length, CORTEX_PERMISSIONS.deny.length);
    assert.strictEqual(summary.added.allow.length, CORTEX_PERMISSIONS.allow.length);
    assert.strictEqual(summary.removed.deny.length, 0);
    assert.strictEqual(summary.removed.allow.length, 0);
    assert.strictEqual(summary.kept.deny, 0);
  });

  test('computePlan apply is idempotent — re-apply on full state = no diff', () => {
    const first = computePlan({}, 'apply').next;
    const { summary } = computePlan(first, 'apply');
    assert.strictEqual(summary.added.deny.length, 0);
    assert.strictEqual(summary.added.allow.length, 0);
    assert.strictEqual(summary.removed.deny.length, 0);
    assert.strictEqual(summary.removed.allow.length, 0);
  });

  test('computePlan apply preserves user-owned entries', () => {
    const userPerms = {
      deny: ['Bash(my-destructive-tool*)'],
      allow: ['Bash(my-safe-tool*)'],
      ask: ['Bash(my-ask-tool*)'],
    };
    const { next, summary } = computePlan(userPerms, 'apply');
    assert.ok(next.deny.includes('Bash(my-destructive-tool*)'));
    assert.ok(next.allow.includes('Bash(my-safe-tool*)'));
    assert.ok(next.ask.includes('Bash(my-ask-tool*)'));
    assert.strictEqual(summary.kept.deny, 1);
    assert.strictEqual(summary.kept.allow, 1);
    assert.strictEqual(summary.kept.ask, 1);
  });

  test('computePlan remove strips cortex entries, keeps user', () => {
    const mixed = {
      deny: ['Bash(rm -rf*)', 'Bash(my-destructive-tool*)'],
      allow: ['Bash(npm test*)', 'Bash(my-safe-tool*)'],
      ask: ['Bash(my-ask-tool*)'],
    };
    const { next, summary } = computePlan(mixed, 'remove');
    assert.deepStrictEqual(next.deny, ['Bash(my-destructive-tool*)']);
    assert.deepStrictEqual(next.allow, ['Bash(my-safe-tool*)']);
    assert.deepStrictEqual(next.ask, ['Bash(my-ask-tool*)']);
    assert.ok(summary.removed.deny.includes('Bash(rm -rf*)'));
    assert.ok(summary.removed.allow.includes('Bash(npm test*)'));
    assert.strictEqual(summary.kept.deny, 1);
  });

  test('computePlan preserves unknown keys under permissions (forward-compat)', () => {
    const futureSchema = {
      deny: [],
      allow: [],
      newFutureField: { something: 'opaque' },
    };
    const { next } = computePlan(futureSchema, 'apply');
    assert.deepStrictEqual(next.newFutureField, { something: 'opaque' });
  });

  test('computePlan handles permissions: null → empty plan in remove mode', () => {
    const { next, summary } = computePlan(null, 'remove');
    assert.strictEqual(Object.keys(next).length, 0);
    assert.strictEqual(summary.removed.deny.length, 0);
  });
});

describe('cortex-permissions-register — CLI end-to-end (fake $HOME)', () => {
  test('--help exits 0 and mentions precedence', () => {
    const home = mkFakeHome();
    try {
      const r = runCli(['--help'], home);
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /deny > ask > allow > defaultMode/);
    } finally { tryRm(home); }
  });

  test('--status on missing settings.json → ok with empty counts', () => {
    const home = mkFakeHome();
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.ok(result.ok);
      assert.strictEqual(result.settings_present, false);
      assert.strictEqual(result.cortex_entries_total, 0);
    } finally { tryRm(home); }
  });

  test('--apply --yes on empty home writes safety floor', () => {
    const home = mkFakeHome();
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.ok(result.ok);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions);
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf*)'));
      assert.ok(settings.permissions.allow.includes('Bash(npm test*)'));
    } finally { tryRm(home); }
  });

  test('--apply --yes is idempotent (second apply produces no diff)', () => {
    const home = mkFakeHome();
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const r2 = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r2.status, 0);
      const result = JSON.parse(r2.stdout);
      assert.ok(result.no_change);
    } finally { tryRm(home); }
  });

  test('--apply preserves pre-existing user entries on same kind', () => {
    const home = mkFakeHome({
      permissions: {
        deny: ['Bash(user-destructive-tool*)'],
        allow: ['Bash(user-safe-tool*)'],
        ask: ['Bash(user-ask-tool*)'],
      },
    });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.includes('Bash(user-destructive-tool*)'));
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf*)'));
      assert.ok(settings.permissions.allow.includes('Bash(user-safe-tool*)'));
      assert.ok(settings.permissions.ask.includes('Bash(user-ask-tool*)'));
    } finally { tryRm(home); }
  });

  test('--remove strips cortex entries but keeps user entries', () => {
    const home = mkFakeHome({
      permissions: {
        deny: ['Bash(user-destructive-tool*)'],
        allow: ['Bash(user-safe-tool*)'],
      },
    });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      runCli(['--remove', '--yes', '--json'], home);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.includes('Bash(user-destructive-tool*)'));
      assert.ok(!settings.permissions.deny.includes('Bash(rm -rf*)'));
      assert.ok(settings.permissions.allow.includes('Bash(user-safe-tool*)'));
      assert.ok(!settings.permissions.allow.includes('Bash(npm test*)'));
    } finally { tryRm(home); }
  });

  test('--remove with no user entries leaves empty permissions key cleanly removed', () => {
    const home = mkFakeHome({ existing: 'top-level-field' });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      runCli(['--remove', '--yes', '--json'], home);
      const settings = readSettingsFromHome(home);
      assert.ok(!settings.permissions, 'permissions key should be removed when empty');
      assert.strictEqual(settings.existing, 'top-level-field', 'unrelated keys preserved');
    } finally { tryRm(home); }
  });

  test('--dry-run prints plan but does not write', () => {
    const home = mkFakeHome();
    try {
      const r = runCli(['--apply', '--dry-run', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.ok(result.dry_run);
      assert.ok(result.next_permissions);
      const settings = readSettingsFromHome(home);
      assert.strictEqual(settings, null, 'settings.json must not be created on dry-run');
    } finally { tryRm(home); }
  });

  test('malformed settings.json → exit 1 with INVALID_JSON code', () => {
    const home = mkFakeHome('{ not valid json');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1);
      const result = JSON.parse(r.stdout);
      assert.ok(!result.ok);
      assert.strictEqual(result.code, 'INVALID_JSON');
    } finally { tryRm(home); }
  });

  test('top-level array → exit 1 with NOT_OBJECT code', () => {
    const home = mkFakeHome('[]');
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
      assert.ok(result.backup_path);
      assert.ok(fs.existsSync(result.backup_path));
      const backupContents = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
      assert.strictEqual(backupContents.existing, 'content');
      assert.ok(!backupContents.permissions, 'backup must reflect pre-mutation state');
      // Mode 0o600 — Sprint 2.21.3 MED 2 parity. Windows mode bits do not
      // honor Unix octal mode exactly, so skip the assertion there.
      if (process.platform !== 'win32') {
        const stat = fs.statSync(result.backup_path);
        assert.strictEqual(stat.mode & 0o777, 0o600, 'backup must be mode 0o600');
      }
    } finally { tryRm(home); }
  });
});

describe('cortex-permissions-register — R2 hardening (Sprint 2.21.2 parity)', () => {
  test('permissions: null → no crash, treated as empty', () => {
    const home = mkFakeHome({ permissions: null });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.length > 0);
    } finally { tryRm(home); }
  });

  test('permissions: [] (array) → no crash, treated as empty', () => {
    const home = mkFakeHome({ permissions: [] });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.length > 0);
    } finally { tryRm(home); }
  });

  test('permissions: "string" → no crash, treated as empty', () => {
    const home = mkFakeHome({ permissions: 'not-an-object' });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.length > 0);
    } finally { tryRm(home); }
  });

  test('permissions.deny: non-array → coerced to empty before merge', () => {
    const home = mkFakeHome({ permissions: { deny: 'not-an-array', allow: ['Bash(user-tool*)'] } });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf*)'));
      assert.ok(settings.permissions.allow.includes('Bash(user-tool*)'));
    } finally { tryRm(home); }
  });

  test('preserves user catch-all Bash(*) alongside cortex deny floor', () => {
    // Sprint 2.28.1 R2 hardening (blind-hunter LOW): test renamed for accuracy.
    // Verifies cortex preserves the user's `Bash(*)` allow entry on apply;
    // Claude Code's `deny > ask > allow` precedence is enforced at runtime
    // by Claude Code, not by this CLI.
    const home = mkFakeHome({ permissions: { allow: ['Bash(*)'] } });
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.allow.includes('Bash(*)'), 'user catch-all preserved');
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf*)'), 'cortex floor still present');
    } finally { tryRm(home); }
  });
});

describe('cortex-permissions-register — Sprint 2.28.1 R2 hardening', () => {
  test('security MED-1: allow list no longer auto-approves cortex-uninstall', () => {
    // Prior `Bash(cortex-*)` catch-all auto-approved destructive
    // cortex-uninstall --purge. Narrowed to read-only CLIs only.
    assert.ok(!CORTEX_PERMISSIONS.allow.includes('Bash(cortex-*)'),
      'broad cortex-* catch-all removed');
    assert.ok(CORTEX_PERMISSIONS.allow.includes('Bash(cortex-doctor*)'),
      'narrow cortex-doctor entry present');
    assert.ok(CORTEX_PERMISSIONS.allow.includes('Bash(cortex-update --check*)'),
      'narrow cortex-update --check entry present');
    const allowJoined = CORTEX_PERMISSIONS.allow.join('|');
    assert.ok(!/cortex-uninstall/.test(allowJoined),
      'cortex-uninstall must NOT be auto-approved');
  });

  test('edge HIGH #8: non-string entries dropped with stderr warning', () => {
    const home = mkFakeHome({ permissions: { deny: ['Bash(rm -rf*)', { invalid: 'shape' }, 42] } });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      assert.match(r.stderr, /non-string entry\(s\) in permissions list dropped/,
        'stderr must surface the silent-drop warning');
      const settings = readSettingsFromHome(home);
      assert.ok(settings.permissions.deny.includes('Bash(rm -rf*)'));
      assert.ok(!settings.permissions.deny.includes(42));
    } finally { tryRm(home); }
  });

  test('security LOW-2: tmp file inherits mode 0o600 (via final settings.json mode)', () => {
    // The tmp file is renamed to settings.json atomically. After rename,
    // settings.json has the tmp's mode bits. On Windows the assertion is
    // skipped because mode bits are not honored exactly.
    const home = mkFakeHome();
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      if (process.platform !== 'win32') {
        const settingsPath = path.join(home, '.claude', 'settings.json');
        const stat = fs.statSync(settingsPath);
        assert.strictEqual(stat.mode & 0o777, 0o600,
          'settings.json must inherit tmp mode 0o600 after atomic rename');
      }
    } finally { tryRm(home); }
  });

  test('acceptance gap: statusReport exposes user_catch_all_in_allow', () => {
    const home = mkFakeHome({ permissions: { allow: ['Bash(*)'] } });
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.user_catch_all_in_allow, true);
    } finally { tryRm(home); }
  });

  test('acceptance gap: statusReport reports user_catch_all_in_allow=false when absent', () => {
    const home = mkFakeHome({ permissions: { allow: ['Bash(npm test)'] } });
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.user_catch_all_in_allow, false);
    } finally { tryRm(home); }
  });
});
