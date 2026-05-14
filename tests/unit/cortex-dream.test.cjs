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
