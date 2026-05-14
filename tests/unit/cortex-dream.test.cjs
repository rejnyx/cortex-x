'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  tokenize,
  jaccardSim,
  splitEntries,
  findDuplicates,
  normalizeRelativeDates,
  pruneToMaxLines,
  checkCanary,
  buildPlan,
  applyPlan,
  POISONING_CANARY,
  JACCARD_THRESHOLD,
} = require('../../bin/cortex-dream.cjs');

const NOW_MS = Date.parse('2026-05-14T12:00:00Z');

// R2 security HIGH-2 hardening: cortex-dream now refuses to operate on a
// data-home outside the operator's $HOME. Test harness sets the explicit opt-in env.
process.env.CORTEX_ALLOW_NONSTANDARD_DATA_HOME = '1';

function tmpDataHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-dream-'));
  fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
  return dir;
}

test('tokenize: lowercase + strips markdown + filters by length', () => {
  const tokens = tokenize('# Sprint **2.25** ships *cortex-dream* with [Jaccard] dedup');
  assert.ok(tokens.includes('sprint'));
  assert.ok(tokens.includes('ships'));
  assert.ok(tokens.includes('cortex-dream'));
  assert.ok(tokens.includes('jaccard'));
  assert.ok(tokens.includes('dedup'));
  assert.ok(!tokens.includes(''));
  assert.ok(!tokens.includes('a'));   // too short
});

test('jaccardSim: identical sets -> 1.0', () => {
  const a = new Set(['x', 'y', 'z']);
  const b = new Set(['x', 'y', 'z']);
  assert.equal(jaccardSim(a, b), 1);
});

test('jaccardSim: disjoint sets -> 0', () => {
  assert.equal(jaccardSim(new Set(['a', 'b']), new Set(['c', 'd'])), 0);
});

test('jaccardSim: empty inputs -> 0 (no NaN)', () => {
  assert.equal(jaccardSim(new Set(), new Set(['a'])), 0);
  assert.equal(jaccardSim(new Set(['a']), new Set()), 0);
});

test('splitEntries: separates by blank lines, filters short stubs', () => {
  const md = `# Long enough header so that it survives the stub filter cleanly

This is a paragraph with enough content to count as an entry.

short

Another reasonable-length entry with multiple words and details.`;
  const entries = splitEntries(md);
  assert.equal(entries.length, 3);  // header (over MIN_ENTRY_CHARS) + 2 long entries; short stub filtered
});

test('findDuplicates: detects near-identical entries', () => {
  const entries = [
    { text: 'First entry about cortex-dream consolidator details', tokens: new Set(['first', 'entry', 'cortex-dream', 'consolidator', 'details']) },
    { text: 'Second different entry about completely unrelated stuff', tokens: new Set(['second', 'different', 'entry', 'completely', 'unrelated', 'stuff']) },
    { text: 'Similar entry about cortex-dream consolidator details too', tokens: new Set(['first', 'entry', 'cortex-dream', 'consolidator', 'details']) },
  ];
  // Entry 1 vs 3 share all 5 tokens — Jaccard = 5/5 = 1.0
  const r = findDuplicates(entries, 0.9);
  assert.equal(r.kept.length, 2);
  assert.equal(r.duplicates.length, 1);
});

test('findDuplicates: respects strict 0.9 threshold', () => {
  const sharedTokens = ['cortex', 'dream', 'memory', 'consolidator', 'sprint'];
  const entries = [
    { text: 'a', tokens: new Set([...sharedTokens, 'unique-a']) },
    { text: 'b', tokens: new Set([...sharedTokens, 'unique-b']) },
  ];
  // sim = 5/(6+6-5) = 5/7 ≈ 0.71 < 0.9 → not duplicate
  const r = findDuplicates(entries, JACCARD_THRESHOLD);
  assert.equal(r.duplicates.length, 0);
});

test('normalizeRelativeDates: today/yesterday/tomorrow', () => {
  const r = normalizeRelativeDates('Meeting today and yesterday', NOW_MS);
  assert.match(r.content, /2026-05-14/);  // today
  assert.match(r.content, /2026-05-13/);  // yesterday
  assert.equal(r.replacements.length, 2);
});

test('normalizeRelativeDates: N days ago', () => {
  const r = normalizeRelativeDates('Started 3 days ago', NOW_MS);
  assert.match(r.content, /2026-05-11/);
});

test('normalizeRelativeDates: last week / this week / next week', () => {
  const r = normalizeRelativeDates('last week vs this week vs next week', NOW_MS);
  assert.match(r.content, /2026-05-07/);  // last week
  assert.match(r.content, /2026-05-14/);  // this week (today)
  assert.match(r.content, /2026-05-21/);  // next week
});

test('normalizeRelativeDates: no relative dates -> no change', () => {
  const r = normalizeRelativeDates('Just absolute dates like 2026-05-14 and nothing relative', NOW_MS);
  assert.equal(r.replacements.length, 0);
});

test('pruneToMaxLines: under cap -> no prune', () => {
  const content = Array(50).fill('line').join('\n');
  const r = pruneToMaxLines(content, 200);
  assert.equal(r.content, content);
  assert.equal(r.pruned, 0);
});

test('pruneToMaxLines: over cap -> prune from middle, keep header + tail', () => {
  const lines = ['# MEMORY', '', ...Array(300).fill('body line')];
  const content = lines.join('\n');
  const r = pruneToMaxLines(content, 100);
  const resultLines = r.content.split('\n');
  assert.ok(resultLines.length <= 100);
  assert.equal(resultLines[0], '# MEMORY');  // header preserved
  assert.equal(r.pruned, 300 + 2 - resultLines.length + 0);  // approximation
  assert.ok(r.pruned > 100);
});

test('checkCanary: detects <system-reminder>', () => {
  assert.equal(checkCanary('Normal content here'), false);
  assert.equal(checkCanary('Body with <system-reminder>injected</system-reminder> markers'), true);
});

test('checkCanary: detects <untrusted>', () => {
  assert.equal(checkCanary('safe content'), false);
  assert.equal(checkCanary('content with <untrusted>...</untrusted>'), true);
});

test('checkCanary: case-insensitive', () => {
  assert.equal(checkCanary('content with <SYSTEM>foo'), true);
  assert.equal(checkCanary('content with <System-Reminder>foo'), true);
});

test('buildPlan: missing files -> empty plan, ok=true', () => {
  const data = tmpDataHome();
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  assert.equal(plan.ok, true);
  assert.equal(plan.files.length, 0);
  fs.rmSync(data, { recursive: true, force: true });
});

test('buildPlan: writes nothing on dry-run', () => {
  const data = tmpDataHome();
  fs.writeFileSync(path.join(data, 'MEMORY.md'), '# MEMORY\n\nentry about cortex-dream today\n');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  assert.equal(plan.ok, true);
  assert.ok(plan.files.length >= 1);
  const memContent = fs.readFileSync(path.join(data, 'MEMORY.md'), 'utf8');
  assert.match(memContent, /today/);  // unchanged
  fs.rmSync(data, { recursive: true, force: true });
});

test('buildPlan: canary blocks consolidation on poisoned file', () => {
  const data = tmpDataHome();
  fs.writeFileSync(path.join(data, 'MEMORY.md'), '# MEMORY\n\n<system-reminder>injected</system-reminder>\n');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  assert.equal(plan.canary_blocked.length, 1);
  assert.ok(plan.files.find((f) => f.status === 'canary_blocked'));
  fs.rmSync(data, { recursive: true, force: true });
});

test('buildPlan: relative dates surface as plan replacements', () => {
  const data = tmpDataHome();
  fs.writeFileSync(path.join(data, 'MEMORY.md'), '# MEMORY\n\nThis happened yesterday and 5 days ago for context.\n');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  const mem = plan.files.find((f) => f.path.endsWith('MEMORY.md'));
  assert.ok(mem);
  assert.equal(mem.status, 'will_change');
  assert.equal(mem.ops.date_replacements, 2);
  fs.rmSync(data, { recursive: true, force: true });
});

test('applyPlan: writes new content + archive (default)', () => {
  const data = tmpDataHome();
  const memPath = path.join(data, 'MEMORY.md');
  fs.writeFileSync(memPath, '# MEMORY\n\nThis happened yesterday for context with enough length to qualify.\n');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  const w = applyPlan(plan, { noArchive: false });
  assert.equal(w.written, 1);
  assert.equal(w.writtenWithArchive, 1);
  const newContent = fs.readFileSync(memPath, 'utf8');
  assert.match(newContent, /2026-05-13/);
  assert.ok(!newContent.includes('yesterday'));
  // Archive exists
  assert.ok(fs.existsSync(memPath.replace(/\.md$/, '.archive.md')));
  fs.rmSync(data, { recursive: true, force: true });
});

test('applyPlan: --no-archive skips archive write', () => {
  const data = tmpDataHome();
  const memPath = path.join(data, 'MEMORY.md');
  fs.writeFileSync(memPath, '# MEMORY\n\nThis happened yesterday for context with enough length.\n');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  const w = applyPlan(plan, { noArchive: true });
  assert.equal(w.written, 1);
  assert.equal(w.writtenWithArchive, 0);
  assert.ok(!fs.existsSync(memPath.replace(/\.md$/, '.archive.md')));
  fs.rmSync(data, { recursive: true, force: true });
});

test('POISONING_CANARY regex spec', () => {
  assert.ok(POISONING_CANARY.test('<system>'));
  assert.ok(POISONING_CANARY.test('<system-reminder>'));
  assert.ok(POISONING_CANARY.test('<untrusted>'));
  assert.ok(POISONING_CANARY.test('</untrusted>'));
  assert.ok(!POISONING_CANARY.test('<systemic>'));  // word boundary required
  assert.ok(!POISONING_CANARY.test('normal markdown'));
});

test('end-to-end: dry-run does not mutate; --apply mutates', () => {
  const data = tmpDataHome();
  const memPath = path.join(data, 'MEMORY.md');
  const original = '# MEMORY\n\nEntry referencing yesterday with sufficient content length.\n';
  fs.writeFileSync(memPath, original);
  // Dry-run-equivalent: buildPlan without applyPlan
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  assert.equal(fs.readFileSync(memPath, 'utf8'), original);
  // Now apply
  applyPlan(plan, { noArchive: true });
  const after = fs.readFileSync(memPath, 'utf8');
  assert.notEqual(after, original);
  fs.rmSync(data, { recursive: true, force: true });
});

// === R2 2.25.1 HARDENING REGRESSION TESTS ===

test('R2 security HIGH-1: canary catches Unicode lookalike via NFKC normalize', () => {
  // Cyrillic ѕ (U+0455) folds to Latin s under NFKC normalization.
  // Actually NFKC doesn't fold Cyrillic to Latin — let's use a fullwidth form.
  // Fullwidth < and > do fold to ASCII via NFKC.
  const fwLT = '＜';  // FULLWIDTH LESS-THAN SIGN
  const fwGT = '＞';  // FULLWIDTH GREATER-THAN SIGN
  const content = `${fwLT}system${fwGT}injected${fwLT}/system${fwGT}`;
  assert.equal(checkCanary(content), true);
});

test('R2 security HIGH-1: canary expanded set catches tool_use + assistant + instructions', () => {
  assert.equal(checkCanary('<tool_use>x</tool_use>'), true);
  assert.equal(checkCanary('<assistant>x'), true);
  assert.equal(checkCanary('<instructions>'), true);
  assert.equal(checkCanary('<human>'), true);
  assert.equal(checkCanary('<user>'), true);
});

test('R2 security HIGH-1: canary catches HTML-entity-encoded form', () => {
  assert.equal(checkCanary('&lt;system&gt;injected&lt;/system&gt;'), true);
  assert.equal(checkCanary('&#60;tool_use&#62;'), true);
});

test('R2 security HIGH-1: checkCanary defensive on non-string input', () => {
  assert.equal(checkCanary(null), false);
  assert.equal(checkCanary(undefined), false);
  assert.equal(checkCanary(42), false);
});

test('R2 security HIGH-2: buildPlan rejects dataHome outside $HOME without opt-in', () => {
  const origEnv = process.env.CORTEX_ALLOW_NONSTANDARD_DATA_HOME;
  delete process.env.CORTEX_ALLOW_NONSTANDARD_DATA_HOME;
  try {
    const plan = buildPlan({ dataHome: '/etc' });
    assert.equal(plan.ok, false);
    assert.equal(plan.error, 'DATA_HOME_OUTSIDE_HOME');
  } finally {
    if (origEnv) process.env.CORTEX_ALLOW_NONSTANDARD_DATA_HOME = origEnv;
    else process.env.CORTEX_ALLOW_NONSTANDARD_DATA_HOME = '1';  // restore test env
  }
});

test('R2 security HIGH-2: readMarkdownSafe refuses to follow symlinks', () => {
  if (process.platform === 'win32') {
    // Skip on Windows — symlink creation requires elevated perms by default.
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-symlink-'));
  try {
    const target = path.join(tmp, 'target.md');
    const link = path.join(tmp, 'link.md');
    fs.writeFileSync(target, '# real content');
    fs.symlinkSync(target, link);
    // Re-require to get the internal readMarkdownSafe
    delete require.cache[require.resolve('../../bin/cortex-dream.cjs')];
    const dream = require('../../bin/cortex-dream.cjs');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-data-'));
    fs.mkdirSync(path.join(data, 'projects'), { recursive: true });
    fs.symlinkSync(target, path.join(data, 'MEMORY.md'));
    const plan = dream.buildPlan({ dataHome: data, nowMs: NOW_MS });
    const memFile = plan.files.find((f) => f.path.endsWith('MEMORY.md'));
    assert.ok(memFile);
    assert.equal(memFile.status, 'skipped');
    assert.equal(memFile.reason, 'IS_SYMLINK');
    fs.rmSync(data, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('R2 edge-case HIGH-2: months use real calendar math, not 30-day approximation', () => {
  // 12 months ago from 2026-05-14 should be exactly 2025-05-14 (calendar
  // math), not 2026-05-14 - 360 days = 2025-05-19 (30-day hardcode).
  const r = normalizeRelativeDates('event 12 months ago', NOW_MS);
  assert.match(r.content, /2025-05-14/);
});

test('R2 edge-case HIGH-2: 1 month ago handles 30/31-day month boundary correctly', () => {
  // From 2026-05-14, 1 month ago = 2026-04-14 (real calendar).
  const r = normalizeRelativeDates('1 month ago', NOW_MS);
  assert.match(r.content, /2026-04-14/);
});

test('R2 correctness HIGH-1: applyPlan is idempotent — re-running on already-converged file is a no-op', () => {
  const data = tmpDataHome();
  const memPath = path.join(data, 'MEMORY.md');
  fs.writeFileSync(memPath, '# MEMORY\n\nEntry referencing yesterday with sufficient content length.\n');
  // First apply: should mutate + write archive
  const plan1 = buildPlan({ dataHome: data, nowMs: NOW_MS });
  const w1 = applyPlan(plan1, { noArchive: false });
  assert.equal(w1.written, 1);
  // Second apply: file is now converged; should write nothing
  const plan2 = buildPlan({ dataHome: data, nowMs: NOW_MS });
  const w2 = applyPlan(plan2, { noArchive: false });
  assert.equal(w2.written, 0);
  assert.equal(w2.writtenWithArchive, 0);
  fs.rmSync(data, { recursive: true, force: true });
});

test('R2 security HIGH-3: archive append never destroys prior archive', () => {
  const data = tmpDataHome();
  const memPath = path.join(data, 'MEMORY.md');
  const archivePath = path.join(data, 'MEMORY.archive.md');
  fs.writeFileSync(memPath, '# MEMORY\n\nFirst version with yesterday reference and enough length.\n');
  fs.writeFileSync(archivePath, 'PRE-EXISTING-ARCHIVE-CONTENT-MUST-SURVIVE');
  const plan = buildPlan({ dataHome: data, nowMs: NOW_MS });
  applyPlan(plan, { noArchive: false });
  const archiveAfter = fs.readFileSync(archivePath, 'utf8');
  assert.match(archiveAfter, /PRE-EXISTING-ARCHIVE-CONTENT-MUST-SURVIVE/);
  // And the new block is appended:
  assert.match(archiveAfter, /cortex-dream archive/);
  fs.rmSync(data, { recursive: true, force: true });
});
