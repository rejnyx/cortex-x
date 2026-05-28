'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyArtifact,
  enumerateUniverse,
  loadReads,
  buildReport,
  parseArgs,
} = require('../../bin/cortex-usage.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-usage-'));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// === classifyArtifact ===

test('classifyArtifact: Windows absolute path under cortex-x repo', () => {
  const r = classifyArtifact('c:\\Users\\david\\Desktop\\APPs\\cortex-x\\standards\\security.md');
  assert.deepEqual(r, { kind: 'standards', key: 'standards/security.md' });
});

test('classifyArtifact: ~ prefixed forward-slash prompt path', () => {
  const r = classifyArtifact('~/Desktop/APPs/cortex-x/prompts/new-project.md');
  assert.deepEqual(r, { kind: 'prompts', key: 'prompts/new-project.md' });
});

test('classifyArtifact: agent under installed shared copy', () => {
  const r = classifyArtifact('/home/u/.claude/shared/agents/blind-hunter.md');
  assert.deepEqual(r, { kind: 'agents', key: 'agents/blind-hunter.md' });
});

test('classifyArtifact: skill SKILL.md folds to skill key (case-insensitive)', () => {
  const r = classifyArtifact('~/.claude/shared/skills/cortex-init/skill.md');
  assert.deepEqual(r, { kind: 'skills', key: 'skills/cortex-init' });
});

test('classifyArtifact: project-local installed skill counts via .claude/skills marker', () => {
  const r = classifyArtifact('c:\\proj\\.claude\\skills\\local-skill\\SKILL.md');
  assert.deepEqual(r, { kind: 'skills', key: 'skills/local-skill' });
});

test('classifyArtifact: non-cortex project standards dir is NOT counted (no marker)', () => {
  assert.equal(classifyArtifact('/home/u/some-client/standards/thing.md'), null);
});

test('classifyArtifact: cortex source file that is not a knowledge artifact returns null', () => {
  assert.equal(classifyArtifact('c:\\x\\cortex-x\\bin\\steward\\dry-run.cjs'), null);
});

test('classifyArtifact: empty/garbage input returns null', () => {
  assert.equal(classifyArtifact(''), null);
  assert.equal(classifyArtifact(null), null);
  assert.equal(classifyArtifact('cortex-x/README.md'), null);
});

// === loadReads ===

test('loadReads: aggregates count, lastRead, projects across files; filters cutoff', () => {
  const dir = tmpDir();
  writeJsonl(path.join(dir, '2026-05-10-a.jsonl'), [
    { ts: '2026-05-10T08:00:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/security.md' },
    { ts: '2026-05-10T09:00:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/security.md' },
    { ts: '2026-05-10T09:30:00Z', project: 'a', tool: 'Edit', file: '~/cortex-x/standards/security.md' }, // not a Read
    { ts: '2026-05-10T10:00:00Z', project: 'a', tool: 'Read' }, // no file
    'not json',
    { ts: '2020-01-01T00:00:00Z', project: 'old', tool: 'Read', file: '~/cortex-x/standards/security.md' }, // before cutoff
  ]);
  writeJsonl(path.join(dir, '2026-05-11-b.jsonl'), [
    { ts: '2026-05-11T08:00:00Z', project: 'b', tool: 'Read', file: 'c:\\x\\cortex-x\\standards\\security.md' },
  ]);
  const cutoff = Date.parse('2026-05-01T00:00:00Z');
  const stats = loadReads([dir], cutoff);
  const s = stats.get('standards/security.md');
  assert.equal(s.count, 3); // 2 from a + 1 from b, old excluded, edit excluded
  assert.equal(s.kind, 'standards');
  assert.equal(s.projects.size, 2); // a + b
  assert.equal(new Date(s.lastRead).toISOString().slice(0, 10), '2026-05-11');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadReads: missing dir is fail-open (empty map)', () => {
  const stats = loadReads([path.join(os.tmpdir(), 'no-such-cortex-journal-xyz')], 0);
  assert.equal(stats.size, 0);
});

// R2 edge/correctness HIGH: a non-string `file` (array) must NOT be coerced into
// a marker-matching string and counted as a phantom read.
test('loadReads: array/non-string file is ignored, not String()-joined into a read', () => {
  const dir = tmpDir();
  writeJsonl(path.join(dir, '2026-05-10-a.jsonl'), [
    { ts: '2026-05-10T08:00:00Z', project: 'a', tool: 'Read', file: ['x', '~/cortex-x/standards/security.md'] },
    { ts: '2026-05-10T08:01:00Z', project: 'a', tool: 'Read', file: 12345 },
    { ts: '2026-05-10T08:02:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/security.md' }, // the only real one
  ]);
  const stats = loadReads([dir], Date.parse('2026-05-01T00:00:00Z'), Date.parse('2026-05-28T00:00:00Z'));
  assert.equal(stats.get('standards/security.md').count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// R2 correctness HIGH: future / clock-skewed ts must not count (closed window).
test('loadReads: future-dated read is clamped out (tsMs > now)', () => {
  const dir = tmpDir();
  const now = Date.parse('2026-05-28T00:00:00Z');
  writeJsonl(path.join(dir, '2026-05-10-a.jsonl'), [
    { ts: '2026-05-10T08:00:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/a.md' },
    { ts: '2099-01-01T00:00:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/a.md' }, // future
  ]);
  const stats = loadReads([dir], Date.parse('2026-05-01T00:00:00Z'), now);
  const s = stats.get('standards/a.md');
  assert.equal(s.count, 1); // future read excluded
  assert.ok(s.lastRead <= now); // lastRead never ahead of now
  fs.rmSync(dir, { recursive: true, force: true });
});

// R2 advisory: pin the inclusive lower-bound semantics so a future `<` → `<=`
// flip in the cutoff comparison is caught.
test('loadReads: a read exactly at the cutoff instant is included', () => {
  const dir = tmpDir();
  const cutoff = Date.parse('2026-05-10T00:00:00Z');
  writeJsonl(path.join(dir, 'j.jsonl'), [
    { ts: '2026-05-10T00:00:00Z', project: 'a', tool: 'Read', file: '~/cortex-x/standards/a.md' },
  ]);
  const stats = loadReads([dir], cutoff, Date.parse('2026-05-28T00:00:00Z'));
  assert.equal(stats.get('standards/a.md').count, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// === enumerateUniverse ===

test('enumerateUniverse: enumerates md kinds + skill SKILL.md dirs', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'standards'), { recursive: true });
  fs.writeFileSync(path.join(root, 'standards', 'security.md'), '#');
  fs.writeFileSync(path.join(root, 'standards', 'ssot.md'), '#');
  fs.writeFileSync(path.join(root, 'standards', 'notes.txt'), 'ignored'); // non-md
  fs.mkdirSync(path.join(root, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'prompts', 'new-project.md'), '#');
  fs.mkdirSync(path.join(root, 'shared', 'skills', 'cortex-init'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shared', 'skills', 'cortex-init', 'SKILL.md'), '#');
  fs.mkdirSync(path.join(root, 'shared', 'skills', 'empty-dir'), { recursive: true }); // no SKILL.md

  const u = enumerateUniverse(root);
  assert.equal(u.get('standards/security.md'), 'standards');
  assert.equal(u.get('standards/ssot.md'), 'standards');
  assert.equal(u.has('standards/notes.txt'), false);
  assert.equal(u.get('prompts/new-project.md'), 'prompts');
  assert.equal(u.get('skills/cortex-init'), 'skills');
  assert.equal(u.has('skills/empty-dir'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

// === buildReport ===

function statsFrom(entries) {
  const m = new Map();
  for (const e of entries) {
    m.set(e.key, {
      kind: e.kind,
      count: e.count,
      lastRead: Date.parse(e.lastRead),
      projects: new Set(e.projects || ['p']),
    });
  }
  return m;
}

test('buildReport: hot sorted desc; cold = universe minus read', () => {
  const universe = new Map([
    ['standards/a.md', 'standards'],
    ['standards/b.md', 'standards'],
    ['standards/c.md', 'standards'],
  ]);
  const stats = statsFrom([
    { key: 'standards/a.md', kind: 'standards', count: 5, lastRead: '2026-05-10T00:00:00Z' },
    { key: 'standards/b.md', kind: 'standards', count: 12, lastRead: '2026-05-12T00:00:00Z' },
  ]);
  const r = buildReport(stats, universe, null);
  assert.equal(r.hot[0].key, 'standards/b.md'); // 12 > 5
  assert.equal(r.hot[1].key, 'standards/a.md');
  assert.deepEqual(r.cold.map((c) => c.key), ['standards/c.md']);
  assert.equal(r.total_reads, 17);
});

// Regression: the off-by-one fixed during dogfood — `used` must be the
// intersection (universe ∩ read), so used + cold === universe even when an
// orphan artifact (read but not in the on-disk universe) exists.
test('buildReport REGRESSION: orphan read does not inflate used; used+cold===universe', () => {
  const universe = new Map([
    ['standards/a.md', 'standards'],
    ['standards/b.md', 'standards'],
    ['standards/c.md', 'standards'],
  ]);
  const stats = statsFrom([
    { key: 'standards/a.md', kind: 'standards', count: 3, lastRead: '2026-05-10T00:00:00Z' },
    // orphan: read but renamed/removed from the repo — not in universe
    { key: 'standards/ghost.md', kind: 'standards', count: 9, lastRead: '2026-05-11T00:00:00Z' },
  ]);
  const r = buildReport(stats, universe, null);
  const k = r.by_kind.standards;
  assert.equal(k.universe, 3);
  assert.equal(k.used, 1); // only a.md is in BOTH stats and universe
  assert.equal(k.cold, 2); // b.md + c.md
  assert.equal(k.used + k.cold, k.universe); // invariant
  // orphan still surfaces in hot (it WAS read), just not in coverage math
  assert.ok(r.hot.some((h) => h.key === 'standards/ghost.md'));
  // ...and must NOT leak into the cold (prune-candidate) list
  assert.ok(!r.cold.some((c) => c.key === 'standards/ghost.md'));
});

test('buildReport: days_since/last_read are deterministic with an injected now', () => {
  const universe = new Map([['standards/a.md', 'standards']]);
  const stats = statsFrom([
    { key: 'standards/a.md', kind: 'standards', count: 1, lastRead: '2026-05-10T00:00:00Z' },
  ]);
  const now = Date.parse('2026-05-20T00:00:00Z');
  const r = buildReport(stats, universe, null, now);
  assert.equal(r.hot[0].days_since, 10);
  assert.equal(r.hot[0].last_read, '2026-05-10');
});

// R2 correctness MED: the comment at the regression test documents that this
// exact arithmetic shipped an off-by-one once. A generative invariant test is
// the regression wall: used + cold === universe must hold for ALL inputs,
// including orphan reads, empty universe, full overlap, and disjoint sets.
test('buildReport PROPERTY: used + cold === universe for all universe/read combos', () => {
  const KINDS = ['standards', 'prompts', 'agents', 'skills'];
  const keyArb = fc.tuple(fc.constantFrom(...KINDS), fc.string({ minLength: 1, maxLength: 6 }))
    .map(([k, n]) => ({ kind: k, key: `${k}/${n}` }));

  fc.assert(fc.property(
    fc.array(keyArb, { maxLength: 30 }), // universe
    fc.array(keyArb, { maxLength: 30 }), // read set (may include orphans not in universe)
    (uni, reads) => {
      const universe = new Map(uni.map((a) => [a.key, a.kind]));
      const stats = new Map(reads.map((a) => [a.key, {
        kind: a.kind, count: 1, lastRead: Date.parse('2026-05-10T00:00:00Z'), projects: new Set(['p']),
      }]));
      const r = buildReport(stats, universe, null, Date.parse('2026-05-28T00:00:00Z'));
      for (const kind of KINDS) {
        const k = r.by_kind[kind];
        assert.equal(k.used + k.cold, k.universe);
        // used is the true intersection; cold is the true complement
        const uniKeys = [...universe].filter(([, kd]) => kd === kind).map(([key]) => key);
        assert.equal(k.universe, uniKeys.length);
        assert.equal(k.used, uniKeys.filter((key) => stats.has(key)).length);
      }
      // no cold entry is also a read (cold ⊆ universe \ reads)
      assert.ok(r.cold.every((c) => !stats.has(c.key)));
    }
  ), { numRuns: 200 });
});

test('buildReport: kindFilter restricts to one kind', () => {
  const universe = new Map([
    ['standards/a.md', 'standards'],
    ['prompts/p.md', 'prompts'],
  ]);
  const stats = statsFrom([
    { key: 'standards/a.md', kind: 'standards', count: 2, lastRead: '2026-05-10T00:00:00Z' },
    { key: 'prompts/p.md', kind: 'prompts', count: 4, lastRead: '2026-05-10T00:00:00Z' },
  ]);
  const r = buildReport(stats, universe, 'prompts');
  assert.deepEqual(Object.keys(r.by_kind), ['prompts']);
  assert.ok(r.hot.every((h) => h.kind === 'prompts'));
  assert.ok(r.cold.every((c) => c.kind === 'prompts'));
});

// === parseArgs ===

test('parseArgs: defaults', () => {
  const a = parseArgs(['node', 'cortex-usage.cjs']);
  assert.deepEqual(a, { since: null, json: false, kind: null, coldOnly: false });
});

test('parseArgs: flags parse', () => {
  const a = parseArgs(['node', 'x', '--since', '2026-01-01', '--kind', 'skills', '--json', '--cold']);
  assert.equal(a.since, '2026-01-01');
  assert.equal(a.kind, 'skills');
  assert.equal(a.json, true);
  assert.equal(a.coldOnly, true);
});
