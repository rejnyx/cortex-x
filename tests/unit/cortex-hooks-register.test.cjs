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
const { isCortexEntry, computePlan, HOOK_SPEC, CORTEX_PATH_RE, parseConfirmReply } = require(SCRIPT);

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
      // Mode 0o600 — settings.json may contain OAuth tokens / API keys;
      // backup must be owner-readable only. Windows mode bits do not honor
      // Unix octal mode exactly, so skip the assertion there.
      if (process.platform !== 'win32') {
        const stat = fs.statSync(result.backup_path);
        assert.strictEqual(stat.mode & 0o777, 0o600, 'backup must be mode 0o600 (owner read+write only)');
      }
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

// Sprint 2.21.2 R2 hardening — null/array hook field tolerance.
describe('cortex-hooks-register — R2 hardening (Sprint 2.21.2)', () => {
  test('HIGH#3 hooks: null → no crash, treated as empty', () => {
    const home = mkFakeHome({ permissions: {}, hooks: null });
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0, 'must not crash with exit 2');
      const report = JSON.parse(r.stdout);
      assert.strictEqual(report.ok, true);
      assert.strictEqual(report.cortex_entries_total, 0);
    } finally { tryRm(home); }
  });

  test('HIGH#3 hooks: [] (array) → no crash, treated as empty for apply', () => {
    const home = mkFakeHome({ permissions: {}, hooks: [] });
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const settings = readSettingsFromHome(home);
      // After apply, hooks should be a proper object with cortex events.
      assert.ok(typeof settings.hooks === 'object' && !Array.isArray(settings.hooks));
      assert.ok(settings.hooks.SessionStart);
    } finally { tryRm(home); }
  });

  test('HIGH#3 hooks: "string" → no crash, treated as empty', () => {
    const home = mkFakeHome({ hooks: 'not-a-hooks-block' });
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
    } finally { tryRm(home); }
  });

  test('HIGH#5 HOOK_SPEC SSOT alignment with install.{sh,ps1} INSTALL_NOTES', () => {
    // Defense against the SSOT drift the enforcer flagged (Sprint 2.21.2):
    // HOOK_SPEC must enumerate every hook script that install.{sh,ps1}
    // documents in the INSTALL_NOTES.md heredoc. We verify by reading
    // install.sh and confirming each HOOK_SPEC event + script name appears
    // in the heredoc text.
    const installShPath = path.join(REPO_ROOT, 'install.sh');
    const installSh = fs.readFileSync(installShPath, 'utf8');
    for (const [event, entries] of Object.entries(HOOK_SPEC)) {
      // Locate the "$event": [ ... ] block in the install.sh heredoc.
      const eventRegex = new RegExp(`"${event}":\\s*\\[`);
      assert.ok(eventRegex.test(installSh), `install.sh INSTALL_NOTES missing event "${event}"`);
      // For each cortex hook script referenced, verify install.sh mentions it.
      for (const entry of entries) {
        for (const h of entry.hooks) {
          const m = h.command.match(/hooks\/([\w-]+\.cjs)/);
          if (!m) continue;
          const scriptName = m[1];
          assert.ok(installSh.includes(scriptName), `install.sh INSTALL_NOTES missing hook script "${scriptName}" for event "${event}"`);
        }
      }
    }
  });
});

// Sprint 2.28.3 R2 H-3 regression: behavior change "empty stdin → abort"
// must persist in this CLI. Without these assertions, a future re-inline of
// the legacy "reply === '' || ..." semantics would pass _lib/confirm tests
// but break the user contract here.
describe('cortex-hooks-register — Sprint 2.28.3 confirm-contract regression', () => {
  test('parseConfirmReply is re-exported from this CLI', () => {
    assert.equal(typeof parseConfirmReply, 'function');
  });

  test('parseConfirmReply rejects empty / Enter / whitespace (abort default)', () => {
    for (const reply of ['', '\n', ' ', '\r\n', '\t']) {
      assert.equal(parseConfirmReply(reply), false, `reply ${JSON.stringify(reply)} must abort`);
    }
  });

  test('parseConfirmReply accepts y / yes (any case + whitespace)', () => {
    for (const reply of ['y', 'Y', 'yes', 'YES', ' yes ', '\ty\n']) {
      assert.equal(parseConfirmReply(reply), true);
    }
  });

  test('prompt text uses [y/N] not [Y/n] (abort-on-empty UX truth)', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    assert.ok(!src.includes('Proceed? [Y/n]'),
      'old [Y/n] prompt removed — would lie about default behavior');
    assert.ok(src.includes('Proceed? [y/N]'),
      'new [y/N] prompt present (reflects empty=abort default)');
  });
});
