#!/usr/bin/env node
// cortex-permissions-register — opt-in registration of cortex-x safety-floor
// permissions in ~/.claude/settings.json with strong safety mechanics.
//
// Why this exists: Claude Code 2.x ships a permissions schema with
// `deny > ask > allow > defaultMode` precedence. cortex-x ships a curated
// safety FLOOR (deny patterns blocking destructive ops) + ALLOW baseline
// (common safe ops that don't need approval). Together they replace the
// blunt `--dangerously-skip-permissions` flag: same speed, deny-precedence
// means the operator cannot accidentally `rm -rf` even via typo.
//
// Identity rule: a permission entry is "cortex-owned" iff its Tool(pattern)
// string is listed verbatim in CORTEX_PERMISSIONS. We only ever add,
// remove, or replace cortex-owned entries. User's own entries are
// untouched, even on --remove. (Sprint 2.28 differs from Sprint 2.21
// hooks-register identity rule: hooks use path-based regex on the command;
// permissions use exact-string match against the manifest because the
// pattern strings are short and easy to maintain by hand.)
//
// Modes:
//   --apply        register cortex permissions (default if no mode flag)
//   --remove       remove cortex-owned permission entries
//   --status       print current state, no mutation
//   --dry-run      print planned diff, no mutation
//
// Flags:
//   --yes / -y     skip interactive confirmation
//   --json         machine-readable output
//   --help / -h
//
// Exit codes:
//   0   success / nothing-to-do
//   1   user-visible failure (cannot parse JSON, permission denied, etc.)
//   2   internal bug

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');

// Canonical cortex permission manifest. Two-kind shape — only `deny` (safety
// floor) and `allow` (common-safe baseline). `ask` is intentionally absent:
// cortex does not opine on ask-list (operator preference territory). Add a
// new entry here AND keep install.sh INSTALL_NOTES.md in sync (SSOT
// enforcement: tests check the two stay aligned).
//
// Patterns use Claude Code's Tool(pattern) syntax. Glob-ish: `*` matches any
// suffix on a Bash command argv. Per [code.claude.com/docs/en/settings],
// precedence is `deny > ask > allow > defaultMode`, so a deny entry holds
// even if the user widens allow to a catch-all.
const CORTEX_PERMISSIONS = Object.freeze({
  deny: [
    // Destructive filesystem
    'Bash(rm -rf*)',
    // Destructive git history
    'Bash(git push --force*)',
    'Bash(git push -f*)',
    'Bash(git reset --hard*)',
    'Bash(git clean -f*)',
    'Bash(git checkout .*)',
    // Destructive database
    'Bash(supabase db reset*)',
    'Bash(psql*DROP TABLE*)',
    'Bash(psql*TRUNCATE*)',
    // Accidental npm publishes (operator overrides per-package via project
    // settings if intentional)
    'Bash(npm publish*)',
    // Interactive flags that hang headless agent runs
    'Bash(git rebase -i*)',
    'Bash(git add -i*)',
  ],
  allow: [
    // Test + lint + typecheck — read-only verification, common in every loop
    'Bash(npm test*)',
    'Bash(npm run test:*)',
    'Bash(npm run build)',
    'Bash(npm run lint*)',
    'Bash(npm run typecheck)',
    // Read-only git inspection
    'Bash(git status)',
    'Bash(git diff*)',
    'Bash(git log*)',
    'Bash(git branch*)',
    'Bash(git show*)',
    // Common shell inspection
    'Bash(ls*)',
    'Bash(pwd)',
    'Bash(node --version)',
    'Bash(node -v)',
    // cortex's own READ-ONLY CLIs (Sprint 2.28.1 + 2.28.2 hardening):
    // - 2.28.1 MED-1: prior catch-all `Bash(cortex-*)` auto-approved destructive
    //   `cortex-uninstall --purge`. Narrow to confirmed-safe surfaces only.
    // - 2.28.2 security MED: prior `Bash(cortex-capabilities*)` auto-approved
    //   the `--write` flag (destructive file write to cortex/). Narrowed to
    //   `--json` read-only invocation.
    // - 2.28.2 edge MED #7+#12: trailing `*` on inner-space patterns may
    //   widen to shell-chain (`cortex-update --check && rm -rf /`) and pick
    //   up destructive flags (`--check --reinstall`). Replaced with exact
    //   entries for the small number of known-safe invocations.
    // cortex-uninstall + cortex-update (full path) + cortex-capabilities --write
    // all require explicit operator approval per Claude Code's default flow.
    'Bash(cortex-doctor)',
    'Bash(cortex-doctor --json)',
    'Bash(cortex-doctor --json --fix-suggestions)',
    'Bash(cortex-help)',
    'Bash(cortex-update --check)',
    'Bash(cortex-update --check --json)',
    'Bash(cortex-hooks-register --status)',
    'Bash(cortex-hooks-register --status --json)',
    'Bash(cortex-claude-md-augment --status)',
    'Bash(cortex-claude-md-augment --status --json)',
    'Bash(cortex-permissions-register --status)',
    'Bash(cortex-permissions-register --status --json)',
    'Bash(cortex-capabilities --json)',
    'Bash(cortex-gap-report)',
    'Bash(cortex-gap-report --json)',
  ],
});

function parseArgs(argv) {
  const args = {
    mode: 'apply',
    yes: false, json: false, help: false, dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.mode = 'apply';
    else if (a === '--remove') args.mode = 'remove';
    else if (a === '--status') args.mode = 'status';
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`cortex-permissions-register: unknown flag '${a}'. Use --help for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log('cortex-permissions-register — opt-in registration of cortex-x safety-floor permissions');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-permissions-register             register cortex permissions (default)');
  console.log('  cortex-permissions-register --remove    remove cortex-owned entries');
  console.log('  cortex-permissions-register --status    print current state, no mutation');
  console.log('  cortex-permissions-register --dry-run   print planned diff, no mutation');
  console.log('  cortex-permissions-register --yes       skip interactive confirmation');
  console.log('  cortex-permissions-register --json      machine-readable output');
  console.log('');
  console.log('Identity rule: a permission entry is cortex-owned iff its Tool(pattern)');
  console.log('  string is listed verbatim in CORTEX_PERMISSIONS. Other entries are left');
  console.log('  alone — operator can extend `allow` per-project; cortex `deny` is floor.');
  console.log('  Precedence (Claude Code): deny > ask > allow > defaultMode.');
}

function isCortexPattern(pattern, kind) {
  if (typeof pattern !== 'string') return false;
  const manifest = CORTEX_PERMISSIONS[kind];
  if (!Array.isArray(manifest)) return false;
  return manifest.includes(pattern);
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { exists: false, json: {}, raw: '' };
  }
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const e = new Error(`settings.json is not valid JSON: ${err.message}`);
    e.code = 'INVALID_JSON';
    throw e;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const e = new Error('settings.json must be a JSON object at top level');
    e.code = 'NOT_OBJECT';
    throw e;
  }
  return { exists: true, json: parsed, raw };
}

function backupSettings(raw) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${SETTINGS_PATH}.backup-${ts}`;
  // Mode 0o600 — Sprint 2.21.3 MED 2 hardening: settings.json may contain
  // OAuth tokens; backups must not leak via umask default.
  fs.writeFileSync(backupPath, raw, { encoding: 'utf8', mode: 0o600 });
  return backupPath;
}

function writeSettings(json) {
  const out = JSON.stringify(json, null, 2) + '\n';
  const tmp = SETTINGS_PATH + '.tmp';
  let renamed = false;
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    // Sprint 2.28.1 R2 hardening (security LOW-2): tmp file must inherit the
    // same 0o600 mode as the backup. settings.json may contain OAuth tokens;
    // the tmp file briefly holds identical content before atomic rename.
    fs.writeFileSync(tmp, out, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, SETTINGS_PATH);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
}

// Sprint 2.21.2 R2 hardening parity: tolerate `permissions: null`, array,
// or non-object scalar. Returns a normalized {allow, deny, ask} shape with
// any garbage replaced by [].
function normalizePermissionsField(value) {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) return {};
  if (typeof value !== 'object') return {};
  return value;
}

// Sprint 2.28.1 R2 hardening (edge-case-hunter #8): warn on silent drops.
// Previously non-string entries (e.g. `{deny: [{not: "a string"}]}` from a
// hand-edited settings.json) were dropped without notice, producing silent
// data loss on write. Now we filter the same way but log a stderr warning
// so the operator sees the discarded shape and can fix it manually.
function normalizeKindList(value, opts = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const dropped = [];
  for (const v of value) {
    if (typeof v === 'string') out.push(v);
    else dropped.push(v);
  }
  if (dropped.length > 0 && opts.warn !== false && typeof process !== 'undefined' && process.stderr && process.stderr.write) {
    try {
      const preview = JSON.stringify(dropped.slice(0, 3));
      process.stderr.write(
        `cortex-permissions-register: warning — ${dropped.length} non-string entry(s) in permissions list dropped: ${preview}${dropped.length > 3 ? ' …' : ''}\n`
      );
    } catch { /* best-effort */ }
  }
  return out;
}

// Compute the planned state given current permissions block and the
// requested mode. Returns { next: <new permissions block>, summary }.
function computePlan(currentPermissions, mode) {
  const cur = normalizePermissionsField(currentPermissions);
  const next = {};
  const summary = { added: { deny: [], allow: [] }, removed: { deny: [], allow: [] }, kept: { deny: 0, allow: 0, ask: 0 } };

  for (const kind of Object.keys(CORTEX_PERMISSIONS)) {
    const curList = normalizeKindList(cur[kind]);
    const userOwned = curList.filter((p) => !isCortexPattern(p, kind));
    summary.kept[kind] = userOwned.length;

    const cortexCurrent = curList.filter((p) => isCortexPattern(p, kind));
    const cortexDesired = mode === 'apply' ? [...CORTEX_PERMISSIONS[kind]] : [];

    for (const c of cortexCurrent) {
      if (!cortexDesired.includes(c)) summary.removed[kind].push(c);
    }
    for (const d of cortexDesired) {
      if (!cortexCurrent.includes(d)) summary.added[kind].push(d);
    }

    const combined = [...userOwned, ...cortexDesired];
    if (combined.length > 0) next[kind] = combined;
  }

  // Preserve user-owned `ask` list verbatim (cortex does not opine).
  // Sprint 2.28.2 R2 hardening (edge-case-hunter #2): suppress drop warning
  // on user-owned `ask` — cortex doesn't own this key, so linting its shape
  // to stderr is surprising side-effect noise.
  const userAsk = normalizeKindList(cur.ask, { warn: false });
  if (userAsk.length > 0) {
    next.ask = userAsk;
    summary.kept.ask = userAsk.length;
  }

  // Preserve any other unknown keys under permissions (forward-compat).
  for (const [k, v] of Object.entries(cur)) {
    if (k !== 'allow' && k !== 'deny' && k !== 'ask' && v !== undefined) {
      next[k] = v;
    }
  }

  return { next, summary };
}

// Sprint 2.28.2 R2 hardening (correctness-auditor #1 + acceptance-auditor #2):
// pure decision helper extracted for testability. The TTY-read plumbing stays
// in confirmInteractive, but the reply→boolean mapping is now a pure function
// that can be unit-tested without spawning a subprocess.
//
// Contract: empty / whitespace / non-y reply → false (abort).
// Only literal "y" / "yes" (case-insensitive, trimmed) → true (proceed).
// This is the explicit-confirm-only semantics from Sprint 2.28.1 edge HIGH #11.
function parseConfirmReply(rawReply) {
  if (typeof rawReply !== 'string') return false;
  const trimmed = rawReply.trim().toLowerCase();
  return trimmed === 'y' || trimmed === 'yes';
}

// Sprint 2.21.2 R2 hardening: cross-platform interactive prompt with
// Windows /dev/tty fallback.
//
// Sprint 2.28.1 R2 hardening (edge-case-hunter #11): require EXPLICIT
// 'y'/'yes' reply — empty input (EOF, closed stdin, Ctrl-D) no longer
// defaults to true. Previously `reply === ''` confirmed destructive
// settings.json mutation; safer default when stdin is exhausted is abort.
function confirmInteractive(promptText) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(promptText);
  if (process.platform !== 'win32') {
    try {
      const buf = Buffer.alloc(64);
      const fd = fs.openSync('/dev/tty', 'r');
      let n = 0;
      try { n = fs.readSync(fd, buf, 0, 64, null); } catch { /* fall through */ }
      fs.closeSync(fd);
      return parseConfirmReply(buf.slice(0, n).toString('utf8'));
    } catch {
      /* fall through to stdin path */
    }
  }
  try {
    const buf = Buffer.alloc(64);
    let n = 0;
    try { n = fs.readSync(0, buf, 0, 64, null); } catch { /* fall through */ }
    return parseConfirmReply(buf.slice(0, n).toString('utf8'));
  } catch {
    return false;
  }
}

function statusReport(json) {
  const permissions = normalizePermissionsField(json && json.permissions);
  const report = {
    settings_present: fs.existsSync(SETTINGS_PATH),
    cortex_entries_total: 0,
    per_kind: { deny: 0, allow: 0 },
    // Sprint 2.28.1 R2 hardening (acceptance-auditor gap): expose user
    // catch-all `Bash(*)` in allow so cortex-doctor can warn — it negates
    // the effective coverage of the deny floor for any pattern
    // Claude Code's matcher resolves via prefix.
    user_catch_all_in_allow: false,
  };
  // Suppress drop warnings in status mode (status is read-only; warning
  // would noise stderr without offering a fix path).
  for (const kind of Object.keys(CORTEX_PERMISSIONS)) {
    const list = normalizeKindList(permissions[kind], { warn: false });
    const cortex = list.filter((p) => isCortexPattern(p, kind));
    report.per_kind[kind] = cortex.length;
    report.cortex_entries_total += cortex.length;
  }
  // Sprint 2.28.2 R2 hardening (edge-case-hunter #6 + blind-hunter MED):
  // catch-all detection must tolerate spacing variants (`Bash( * )`,
  // `Bash(**)`) and case variants (`bash(*)`). Exact-string match missed
  // trivial typos. Regex anchors on Bash prefix + optional whitespace +
  // 1-or-more stars + optional whitespace.
  const CATCH_ALL_RE = /^bash\(\s*\*+\s*\)$/i;
  const allowList = normalizeKindList(permissions.allow, { warn: false });
  if (allowList.some((p) => CATCH_ALL_RE.test(p))) {
    report.user_catch_all_in_allow = true;
  }
  return report;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  let settings;
  try {
    settings = readSettings();
  } catch (err) {
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: err.message, code: err.code || 'READ_FAILED' }, null, 2));
    } else {
      console.error(`cortex-permissions-register: ${err.message}`);
      console.error(`  Path: ${SETTINGS_PATH}`);
      console.error('  Fix it manually, or move it aside, then re-run.');
    }
    return 1;
  }

  if (args.mode === 'status') {
    const report = statusReport(settings.json);
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    } else {
      console.log(`cortex-permissions-register status:`);
      console.log(`  settings.json: ${report.settings_present ? SETTINGS_PATH : '(not present)'}`);
      console.log(`  cortex permission entries: ${report.cortex_entries_total}`);
      for (const [kind, count] of Object.entries(report.per_kind)) {
        if (count > 0) console.log(`    ${kind}: ${count} entry(s)`);
      }
      if (report.cortex_entries_total === 0) {
        console.log('  → run `cortex-permissions-register` to register the safety floor');
      }
    }
    return 0;
  }

  const currentPermissions = normalizePermissionsField(settings.json.permissions);
  const { next, summary } = computePlan(currentPermissions, args.mode);

  const noChange = summary.added.deny.length === 0 && summary.added.allow.length === 0
    && summary.removed.deny.length === 0 && summary.removed.allow.length === 0;
  if (noChange) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, mode: args.mode, no_change: true, summary }, null, 2));
    } else {
      console.log(`cortex-permissions-register: nothing to do (already in desired state).`);
    }
    return 0;
  }

  if (args.dryRun) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, mode: args.mode, dry_run: true, summary, next_permissions: next }, null, 2));
    } else {
      console.log('cortex-permissions-register dry-run:');
      console.log(`  add deny:    ${summary.added.deny.length} entry(s)`);
      console.log(`  add allow:   ${summary.added.allow.length} entry(s)`);
      console.log(`  remove deny: ${summary.removed.deny.length} entry(s)`);
      console.log(`  remove allow: ${summary.removed.allow.length} entry(s)`);
      console.log(`  user entries preserved: ${summary.kept.deny + summary.kept.allow + summary.kept.ask} total`);
      console.log(`  target: ${SETTINGS_PATH}`);
    }
    return 0;
  }

  if (!args.yes) {
    const verb = args.mode === 'apply' ? 'register' : 'remove';
    const promptText =
      `cortex-permissions-register will ${verb} cortex-owned permission entries in ${SETTINGS_PATH}.\n` +
      `  add deny:    ${summary.added.deny.length} entry(s)\n` +
      `  add allow:   ${summary.added.allow.length} entry(s)\n` +
      `  remove deny: ${summary.removed.deny.length} entry(s)\n` +
      `  remove allow: ${summary.removed.allow.length} entry(s)\n` +
      `  (user-owned entries are left untouched.)\n` +
      `Proceed? [y/N] `;
    if (!confirmInteractive(promptText)) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, aborted: true }, null, 2));
      } else {
        console.log('cortex-permissions-register: aborted.');
      }
      return 0;
    }
  }

  let backupPath = null;
  if (settings.exists) {
    try {
      backupPath = backupSettings(settings.raw);
    } catch (err) {
      console.error(`cortex-permissions-register: backup failed: ${err.message}`);
      console.error('  refusing to proceed without backup.');
      return 1;
    }
  }

  const newJson = { ...settings.json, permissions: next };
  if (Object.keys(next).length === 0) {
    delete newJson.permissions;
  }
  try {
    writeSettings(newJson);
  } catch (err) {
    console.error(`cortex-permissions-register: write failed: ${err.message}`);
    if (backupPath) console.error(`  backup preserved at: ${backupPath}`);
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify({
      ok: true, mode: args.mode, summary, backup_path: backupPath, settings_path: SETTINGS_PATH,
    }, null, 2));
  } else {
    console.log(`cortex-permissions-register: ${args.mode === 'apply' ? 'registered' : 'removed'} cortex permissions.`);
    if (backupPath) console.log(`  backup: ${backupPath}`);
    console.log(`  next session of Claude Code will pick up the new permissions config.`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('cortex-permissions-register: internal error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

module.exports = {
  CORTEX_PERMISSIONS,
  isCortexPattern,
  computePlan,
  parseArgs,
  statusReport,
  normalizePermissionsField,
  normalizeKindList,
  parseConfirmReply,
};
