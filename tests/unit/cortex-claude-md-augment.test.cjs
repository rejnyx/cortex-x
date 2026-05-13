// cortex-claude-md-augment contract tests.
//
// Validates:
//   1. Pure function safety (detectBlock, computeNext)
//   2. End-to-end via subprocess with isolated fake $HOME
//   3. Idempotency, user-content preservation, version upgrade path

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-claude-md-augment.cjs');
const {
  BLOCK_VERSION, CORTEX_BLOCK_START, CORTEX_BLOCK_END, CORTEX_BLOCK_RE,
  detectBlock, computeNext,
} = require(SCRIPT);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mkFakeHome(initialClaudeMd) {
  const home = mkTmp('cortex-claudemd-home-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  if (initialClaudeMd !== undefined) {
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), initialClaudeMd, 'utf8');
  }
  return home;
}

function runCli(args, home) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readClaudeMd(home) {
  const p = path.join(home, '.claude', 'CLAUDE.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

describe('cortex-claude-md-augment — pure functions', () => {
  test('detectBlock on empty content returns absent', () => {
    const r = detectBlock('');
    assert.strictEqual(r.present, false);
    assert.strictEqual(r.count, 0);
  });

  test('detectBlock finds versioned block', () => {
    const content = `# user header\n\n${CORTEX_BLOCK_START}\nbody\n${CORTEX_BLOCK_END}\n`;
    const r = detectBlock(content);
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.version, BLOCK_VERSION);
    assert.strictEqual(r.count, 1);
  });

  test('detectBlock catches stale-version block (v0)', () => {
    const content = `<!-- BEGIN cortex-x discipline (v0) — managed by cortex-claude-md-augment -->\nold\n<!-- END cortex-x discipline -->\n`;
    const r = detectBlock(content);
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.version, '0');
  });

  test('detectBlock counts duplicates', () => {
    const block = `${CORTEX_BLOCK_START}\nbody\n${CORTEX_BLOCK_END}`;
    const r = detectBlock(`${block}\n\n${block}\n`);
    assert.strictEqual(r.count, 2);
  });

  test('computeNext apply preserves user content above', () => {
    const userContent = '# Dave\n\nMy preferences.\n';
    const next = computeNext(userContent, 'apply');
    assert.ok(next.startsWith('# Dave'));
    assert.ok(next.includes('My preferences'));
    assert.ok(next.includes(CORTEX_BLOCK_START));
    assert.ok(next.endsWith('\n'));
  });

  test('computeNext apply on already-applied content is idempotent', () => {
    const first = computeNext('user content\n', 'apply');
    const second = computeNext(first, 'apply');
    assert.strictEqual(second, first);
  });

  test('computeNext remove strips block but leaves user content', () => {
    const userContent = '# Dave\n\nMy preferences.\n';
    const applied = computeNext(userContent, 'apply');
    const removed = computeNext(applied, 'remove');
    assert.ok(removed.includes('# Dave'));
    assert.ok(removed.includes('My preferences'));
    assert.ok(!removed.includes(CORTEX_BLOCK_START));
    assert.ok(!removed.includes(CORTEX_BLOCK_END));
  });

  test('computeNext apply deduplicates if multiple blocks present', () => {
    const block = `${CORTEX_BLOCK_START}\nbody\n${CORTEX_BLOCK_END}`;
    const dirty = `# Dave\n${block}\n\nMiddle\n\n${block}\n`;
    const next = computeNext(dirty, 'apply');
    const matches = [...next.matchAll(CORTEX_BLOCK_RE)];
    assert.strictEqual(matches.length, 1, 'duplicates must be collapsed to one block');
    assert.ok(next.includes('Middle'), 'user content between duplicates must survive');
  });
});

describe('cortex-claude-md-augment — CLI end-to-end', () => {
  test('--help exits 0', () => {
    const home = mkTmp('cortex-cmda-help-');
    try {
      const r = runCli(['--help'], home);
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /cortex-claude-md-augment/);
    } finally { tryRm(home); }
  });

  test('unknown flag → exit 1', () => {
    const home = mkTmp('cortex-cmda-badflag-');
    try {
      const r = runCli(['--banana'], home);
      assert.strictEqual(r.status, 1);
    } finally { tryRm(home); }
  });

  test('--apply on fresh home creates CLAUDE.md with block', () => {
    const home = mkFakeHome(undefined);
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const md = readClaudeMd(home);
      assert.ok(md.includes(CORTEX_BLOCK_START));
      assert.ok(md.includes(CORTEX_BLOCK_END));
      assert.ok(md.includes('R1 — research before implementing'));
    } finally { tryRm(home); }
  });

  test('--apply preserves user content above the block', () => {
    const home = mkFakeHome('# Dave\n\nMy global preferences.\n- thing 1\n- thing 2\n');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const md = readClaudeMd(home);
      assert.ok(md.includes('# Dave'));
      assert.ok(md.includes('My global preferences'));
      assert.ok(md.includes('- thing 1'));
      assert.ok(md.indexOf('# Dave') < md.indexOf(CORTEX_BLOCK_START), 'user content must come first');
    } finally { tryRm(home); }
  });

  test('idempotent: --apply twice yields identical content', () => {
    const home = mkFakeHome('# Dave\n\nMy prefs.\n');
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const mid = readClaudeMd(home);
      runCli(['--apply', '--yes', '--json'], home);
      const after = readClaudeMd(home);
      assert.strictEqual(after, mid);
    } finally { tryRm(home); }
  });

  test('--remove strips block, leaves user content', () => {
    const home = mkFakeHome('# Dave\n\nMy prefs.\n');
    try {
      runCli(['--apply', '--yes', '--json'], home);
      const r = runCli(['--remove', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const md = readClaudeMd(home);
      assert.ok(md.includes('# Dave'));
      assert.ok(md.includes('My prefs'));
      assert.ok(!md.includes(CORTEX_BLOCK_START));
      assert.ok(!md.includes('discipline'));
    } finally { tryRm(home); }
  });

  test('--remove on no-block content is a noop', () => {
    const home = mkFakeHome('# Dave\nNo block here.\n');
    try {
      const r = runCli(['--remove', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.no_change, true);
    } finally { tryRm(home); }
  });

  test('--status reports presence and version', () => {
    const home = mkFakeHome('# Dave\n');
    try {
      let r = runCli(['--status', '--json'], home);
      let report = JSON.parse(r.stdout);
      assert.strictEqual(report.cortex_block_present, false);

      runCli(['--apply', '--yes', '--json'], home);
      r = runCli(['--status', '--json'], home);
      report = JSON.parse(r.stdout);
      assert.strictEqual(report.cortex_block_present, true);
      assert.strictEqual(report.cortex_block_version, BLOCK_VERSION);
      assert.strictEqual(report.stale, false);
    } finally { tryRm(home); }
  });

  test('--status flags stale version', () => {
    const stale = '# Dave\n<!-- BEGIN cortex-x discipline (v0) — managed by cortex-claude-md-augment -->\nold\n<!-- END cortex-x discipline -->\n';
    const home = mkFakeHome(stale);
    try {
      const r = runCli(['--status', '--json'], home);
      const report = JSON.parse(r.stdout);
      assert.strictEqual(report.stale, true);
      assert.strictEqual(report.cortex_block_version, '0');
    } finally { tryRm(home); }
  });

  test('--dry-run prints plan but does not write', () => {
    const home = mkFakeHome('# Dave\n');
    try {
      const r = runCli(['--apply', '--dry-run', '--json'], home);
      assert.strictEqual(r.status, 0);
      const md = readClaudeMd(home);
      assert.ok(!md.includes(CORTEX_BLOCK_START));
    } finally { tryRm(home); }
  });

  test('backup file written next to CLAUDE.md on first apply', () => {
    const home = mkFakeHome('# Dave\nOriginal content.\n');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      const result = JSON.parse(r.stdout);
      assert.ok(result.backup_path);
      assert.ok(fs.existsSync(result.backup_path));
      const backupContent = fs.readFileSync(result.backup_path, 'utf8');
      assert.ok(!backupContent.includes(CORTEX_BLOCK_START));
      assert.ok(backupContent.includes('Original content'));
    } finally { tryRm(home); }
  });

  test('stale-version block is upgraded to current version on --apply', () => {
    const stale = '# Dave\n<!-- BEGIN cortex-x discipline (v0) — managed by cortex-claude-md-augment -->\nold body\n<!-- END cortex-x discipline -->\n';
    const home = mkFakeHome(stale);
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 0);
      const md = readClaudeMd(home);
      assert.ok(md.includes(`v${BLOCK_VERSION}`));
      assert.ok(!md.includes('old body'));
      assert.ok(md.includes('# Dave'));
    } finally { tryRm(home); }
  });
});

// Sprint 2.21.2 R2 hardening — regression tests for 3 HIGH findings.
describe('cortex-claude-md-augment — R2 hardening (Sprint 2.21.2)', () => {
  function mkProject(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-cmda-r2-${name}-`));
  }
  function rmProject(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  function mkFakeHomeLocal(content) {
    const home = mkProject('home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), content, 'utf8');
    return home;
  }

  test('HIGH#1 orphan BEGIN marker → refuses to mutate (data-loss guard)', () => {
    const home = mkFakeHomeLocal('# Dave\n<!-- BEGIN cortex-x discipline (v1) — managed by cortex-claude-md-augment -->\nuser writes about cortex\n');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1, 'must refuse with exit 1');
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, 'ORPHAN_MARKER');
      assert.strictEqual(result.orphan, 'begin');
      // Critically: file must be unchanged.
      const md = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8');
      assert.match(md, /user writes about cortex/);
    } finally { rmProject(home); }
  });

  test('HIGH#1 orphan END marker → refuses to mutate', () => {
    const home = mkFakeHomeLocal('# Dave\n<!-- END cortex-x discipline -->\nstray end\n');
    try {
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.code, 'ORPHAN_MARKER');
      assert.strictEqual(result.orphan, 'end');
    } finally { rmProject(home); }
  });

  test('HIGH#1 --status reports orphan_marker field', () => {
    const home = mkFakeHomeLocal('<!-- BEGIN cortex-x discipline (v2) — managed by cortex-claude-md-augment -->\nno end\n');
    try {
      const r = runCli(['--status', '--json'], home);
      assert.strictEqual(r.status, 0);
      const report = JSON.parse(r.stdout);
      assert.strictEqual(report.orphan_marker, 'begin');
    } finally { rmProject(home); }
  });

  test('HIGH#2 non-UTF8 CLAUDE.md → refuses to mutate (corruption guard)', () => {
    const home = mkProject('utf8');
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      // Write latin1 bytes (0xe9 = é in latin1, invalid mid-sequence in utf8)
      const invalidUtf8 = Buffer.from([0x23, 0x20, 0xe9, 0x6e, 0xe9, 0x0a]); // "# énén\n" in latin1
      fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), invalidUtf8);
      const r = runCli(['--apply', '--yes', '--json'], home);
      assert.strictEqual(r.status, 1);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.code, 'NOT_UTF8');
      // File untouched (still latin1 bytes).
      const onDisk = fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'));
      assert.strictEqual(onDisk[2], 0xe9, 'invalid bytes must remain');
    } finally { rmProject(home); }
  });
});
