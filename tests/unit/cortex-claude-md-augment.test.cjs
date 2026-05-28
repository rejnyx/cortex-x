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
  detectBlock, computeNext, parseConfirmReply,
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
      assert.ok(md.includes('R1 — research before you ASSERT or implement'));
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
      // Mode 0o600 — CLAUDE.md may contain operator notes about credentials,
      // internal URLs, or sensitive context; backup must be owner-readable
      // only. Windows mode bits do not honor Unix octal mode exactly, so
      // skip the assertion there.
      if (process.platform !== 'win32') {
        const stat = fs.statSync(result.backup_path);
        assert.strictEqual(stat.mode & 0o777, 0o600, 'backup must be mode 0o600 (owner read+write only)');
      }
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

// Sprint 2.28.3 R2 H-3 regression: behavior change "empty stdin → abort"
// must persist in this CLI. Without these assertions, a future re-inline of
// the legacy "reply === '' || ..." semantics would pass _lib/confirm tests
// but break the user contract here.
describe('cortex-claude-md-augment — Sprint 2.21.3 R2 MED hardening', () => {
  // MED #3 — CRLF preservation. Windows-cloned CLAUDE.md often arrives with
  // CRLF; the original computeNext injected LF separators producing mixed
  // EOL output and noisy git diffs.
  test('CRLF input → CRLF output, no mixed EOL', () => {
    const crlfBefore = 'My doc\r\n\r\nSome content\r\n';
    const after = computeNext(crlfBefore, 'apply');
    assert.ok(after.includes('\r\n'), 'output preserves CRLF');
    // No bare LF that isn't preceded by CR (would indicate mixed EOL).
    for (let i = 0; i < after.length; i++) {
      if (after[i] === '\n' && (i === 0 || after[i - 1] !== '\r')) {
        assert.fail(`mixed EOL at position ${i}: ${JSON.stringify(after.slice(Math.max(0, i - 5), i + 5))}`);
      }
    }
  });

  test('LF input → LF output, no spurious CR', () => {
    const lfBefore = 'My doc\n\nSome content\n';
    const after = computeNext(lfBefore, 'apply');
    assert.ok(!after.includes('\r'), 'output stays LF-only');
  });

  // MED #4 — Cortex BEGIN/END markers inside Markdown code fences must NOT
  // be stripped on --remove or re-applied with --apply.
  test('block inside ``` fence is preserved on remove', () => {
    const docWithFencedExample =
      'User docs\n\n```markdown\n' +
      CORTEX_BLOCK_START + '\n' +
      'example block\n' +
      CORTEX_BLOCK_END + '\n' +
      '```\n\nMore user content\n';
    const after = computeNext(docWithFencedExample, 'remove');
    assert.ok(after.includes(CORTEX_BLOCK_START), 'fenced BEGIN preserved');
    assert.ok(after.includes(CORTEX_BLOCK_END), 'fenced END preserved');
    assert.ok(after.includes('example block'), 'fenced example body preserved');
  });

  test('block OUTSIDE fence is stripped; block INSIDE fence is preserved', () => {
    const mixed =
      'User content\n\n' +
      CORTEX_BLOCK_START + '\n' +
      'real block to strip\n' +
      CORTEX_BLOCK_END + '\n\n' +
      '```\n' +
      CORTEX_BLOCK_START + '\n' +
      'example to preserve\n' +
      CORTEX_BLOCK_END + '\n' +
      '```\n';
    const after = computeNext(mixed, 'remove');
    assert.ok(!after.includes('real block to strip'), 'real block stripped');
    assert.ok(after.includes('example to preserve'), 'fenced example survives');
    assert.ok(after.includes('User content'), 'user content survives');
  });

  // MED #6 — `\n{3,}` whitespace collapse must NOT mutate user-intentional
  // multi-blank-line regions outside the stripped block site.
  test('user triple-newlines outside block region are preserved', () => {
    const userContent = 'paragraph A\n\n\n\nparagraph B (3 blank lines intentional)\n';
    // No cortex block present — stripCortexBlocks returns input unchanged,
    // computeNext --remove only trimEnd. The 4-newline gap must survive.
    const after = computeNext(userContent, 'remove');
    assert.ok(after.includes('\n\n\n\n'), 'user-intentional whitespace preserved');
  });

  // R2 round-2 HIGH: 4+ backtick fence parity. A user wrapping a cortex
  // example in a 4-backtick fence (to allow embedded 3-backtick content)
  // would previously flip the toggle to "inside" incorrectly.
  test('R2 round-2 HIGH: 4-backtick fence does not corrupt parity', () => {
    const docWithQuadFence =
      '````markdown\n' +
      '```\n' +
      'inner triple-backtick (legitimate prose content)\n' +
      '```\n' +
      CORTEX_BLOCK_START + '\n' +
      'example marker inside quad fence\n' +
      CORTEX_BLOCK_END + '\n' +
      '````\n' +
      '\nUser tail\n';
    const after = computeNext(docWithQuadFence, 'remove');
    assert.ok(after.includes('example marker inside quad fence'),
      'quad-fence-wrapped example marker stripped — fence parity regression');
  });

  // R2 round-2 HIGH: CRLF leading-blank-line lookback must consume the full
  // `\r\n\r\n` blank pair before the block, not just `\n\r\n` (stray \r).
  test('R2 round-2 HIGH: CRLF leading blank consumed cleanly on strip', () => {
    const crlfDoc =
      'User intro\r\n\r\n' +
      CORTEX_BLOCK_START + '\r\n' +
      'block body\r\n' +
      CORTEX_BLOCK_END + '\r\nbottom\r\n';
    const after = computeNext(crlfDoc, 'remove');
    // No stray \r left at boundary.
    assert.ok(!/\r(?!\n)/.test(after),
      `stray bare-CR in output: ${JSON.stringify(after)}`);
    assert.ok(!after.includes('block body'), 'block stripped');
  });

  // R2 round-2 HIGH: EOL detection uses majority count, not "any-match".
  // A single accidental CRLF in a mostly-LF file should NOT force the
  // injected block to CRLF.
  test('R2 round-2 HIGH: single CRLF in LF file → block uses LF (majority wins)', () => {
    const lfHeavyWithOneCrlf =
      'line1\nline2\nline3\nline4\nline5\nline6\r\nline7\nline8\nline9\nline10\n';
    const after = computeNext(lfHeavyWithOneCrlf, 'apply');
    // The cortex block separators we inject should be LF (majority).
    assert.ok(after.includes(CORTEX_BLOCK_START + '\n'),
      'block uses LF separator (majority wins)');
    // But also: never produce a NEW CRLF where the user didn't have one.
    const beforeCrlf = (lfHeavyWithOneCrlf.match(/\r\n/g) || []).length;
    const afterCrlf = (after.match(/\r\n/g) || []).length;
    assert.equal(afterCrlf, beforeCrlf,
      'CRLF count must not grow on LF-majority input');
  });

  test('R2 round-2: CRLF-majority file produces CRLF block', () => {
    const crlfHeavy =
      'l1\r\nl2\r\nl3\r\nl4\r\nl5\r\nl6\nl7\r\nl8\r\nl9\r\nl10\r\n';
    const after = computeNext(crlfHeavy, 'apply');
    assert.ok(after.includes(CORTEX_BLOCK_START + '\r\n'),
      'block uses CRLF separator (majority wins)');
  });

  test('only the block-removal site collapses whitespace, not whole file', () => {
    const doc =
      'top\n\n\n\nlots-of-blanks-on-purpose\n\n' +
      CORTEX_BLOCK_START + '\n' +
      'block content\n' +
      CORTEX_BLOCK_END + '\n\nbottom\n';
    const after = computeNext(doc, 'remove');
    assert.ok(after.includes('\n\n\n\nlots-of-blanks-on-purpose'),
      'distant whitespace preserved');
    assert.ok(!after.includes('block content'), 'block stripped');
  });
});

describe('cortex-claude-md-augment — Sprint 2.28.3 confirm-contract regression', () => {
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
