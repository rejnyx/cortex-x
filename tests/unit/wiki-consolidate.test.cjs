// tests/unit/wiki-consolidate.test.cjs — Sprint 2.8.2 v0
//
// Pure-deterministic Phase A wiki consolidator. Tests cover:
//   - lesson aggregation by action_kind
//   - frontmatter shape (Obsidian-compatible YAML)
//   - confidence band heuristic
//   - article body structure (heading, claims, sources, notes)
//   - sanitization (control chars, line-anchored `---` / `## ` escapes)
//   - safe path containment (kind name allow-list)
//   - cost-cap (max kinds per run)
//   - dry-run flag (no disk writes)
//   - skip when lessons.jsonl missing or empty
//   - registry entry shape (action_kind: wiki_consolidate)

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runWikiConsolidate,
  _internal,
} = require('../../bin/steward/_lib/wiki-consolidate.cjs');
const actionKinds = require('../../bin/steward/_lib/action-kinds.cjs');

function withEnv(envOverrides, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function makeFixture(lessons) {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cons-'));
  const slug = 'cortex-x-test';
  const journalDir = path.join(dataHome, 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  const lessonsPath = path.join(journalDir, 'lessons.jsonl');
  const content = lessons.map((l) => JSON.stringify(l)).join('\n');
  fs.writeFileSync(lessonsPath, content, 'utf8');
  return { dataHome, slug, lessonsPath };
}

function cleanup(dataHome) {
  try { fs.rmSync(dataHome, { recursive: true, force: true }); } catch { /* best */ }
}

describe('wiki-consolidate — registry entry', () => {
  test('wiki_consolidate is registered + shipped', () => {
    assert.equal(actionKinds.isSupportedKind('wiki_consolidate'), true);
    assert.equal(actionKinds.isShippedKind('wiki_consolidate'), true);
    const kind = actionKinds.getActionKind('wiki_consolidate');
    assert.equal(kind.requires_llm, false);
    assert.equal(kind.cost_envelope, 'free');
    assert.ok(Array.isArray(kind.acceptance_criteria));
    assert.ok(kind.acceptance_criteria.length >= 2);
  });

  test('acceptance criteria enforce writes-only-under-wiki/ invariant', () => {
    const kind = actionKinds.getActionKind('wiki_consolidate');
    const ids = kind.acceptance_criteria.map((c) => c.id);
    assert.ok(ids.includes('wiki_consolidate_writes_under_data_home_wiki'));
    assert.ok(ids.includes('wiki_consolidate_data_home_only_ears'));
  });
});

describe('wiki-consolidate — lesson aggregation', () => {
  test('groups lessons by action_kind correctly', () => {
    const lessons = [
      { action_kind: 'doc_drift', root_cause: 'STALE_LINK', lesson_text: 'x', ts: '2026-05-10' },
      { action_kind: 'doc_drift', root_cause: 'BROKEN_REF', lesson_text: 'y', ts: '2026-05-11' },
      { action_kind: 'dep_update_patch', root_cause: 'NPM_AUDIT', lesson_text: 'z', ts: '2026-05-12' },
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const byKind = _internal.loadLessonsByKind(slug);
        assert.equal(byKind.size, 2);
        assert.equal(byKind.get('doc_drift').length, 2);
        assert.equal(byKind.get('dep_update_patch').length, 1);
      });
    } finally { cleanup(dataHome); }
  });

  test('summarizeKindBucket aggregates error_codes + projects + first/last seen', () => {
    const lessons = [
      { root_cause: 'A', project: 'cortex-x', ts: '2026-05-09', frequency: 3 },
      { root_cause: 'B', project: 'cortex-x', ts: '2026-05-12', frequency: 2 },
      { root_cause: 'A', project: 'kiosek', ts: '2026-05-10', frequency: 1 },
    ];
    const s = _internal.summarizeKindBucket(lessons);
    assert.equal(s.count, 3);
    assert.deepEqual(s.error_codes, ['A', 'B']);
    assert.deepEqual(s.projects, ['cortex-x', 'kiosek']);
    assert.equal(s.first_seen, '2026-05-09');
    assert.equal(s.last_seen, '2026-05-12');
    assert.equal(s.total_frequency, 6);
  });

  test('skips corrupted JSON lines in lessons.jsonl', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cons-corrupt-'));
    const slug = 'cortex-x-test';
    const journalDir = path.join(dataHome, 'journal', slug);
    fs.mkdirSync(journalDir, { recursive: true });
    fs.writeFileSync(
      path.join(journalDir, 'lessons.jsonl'),
      '{"action_kind":"x","ts":"2026-05-10"}\n{not valid json\n{"action_kind":"y","ts":"2026-05-11"}\n',
      'utf8'
    );
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const byKind = _internal.loadLessonsByKind(slug);
        assert.equal(byKind.size, 2);
      });
    } finally { cleanup(dataHome); }
  });
});

describe('wiki-consolidate — confidence band heuristic', () => {
  test('high band when ≥10 lessons', () => {
    assert.equal(_internal.confidenceBand(10), 'high');
    assert.equal(_internal.confidenceBand(50), 'high');
  });
  test('medium band when 3..9 lessons', () => {
    assert.equal(_internal.confidenceBand(3), 'medium');
    assert.equal(_internal.confidenceBand(9), 'medium');
  });
  test('low band when <3 lessons', () => {
    assert.equal(_internal.confidenceBand(0), 'low');
    assert.equal(_internal.confidenceBand(2), 'low');
  });
});

describe('wiki-consolidate — article rendering', () => {
  test('frontmatter has required Obsidian-compatible keys', () => {
    const summary = { count: 5, error_codes: ['X'], projects: ['p'], first_seen: '2026-05-10', last_seen: '2026-05-12', total_frequency: 5 };
    const fm = _internal.renderFrontmatter('doc_drift', summary, '2026-05-13T12:00:00.000Z', 'abc123def4567890');
    assert.match(fm, /^---\n/);
    assert.match(fm, /\ntitle: "action_kind: doc_drift"/);
    assert.match(fm, /\nslug: doc_drift/);
    assert.match(fm, /\nfrontmatter_version: 1/);
    assert.match(fm, /\nsource_count: 5/);
    assert.match(fm, /\nconfidence_band: medium/);
    assert.match(fm, /\nprovenance: observed/);
    assert.match(fm, /\naction_kinds: \[doc_drift\]/);
    assert.match(fm, /\nerror_codes: \["X"\]/);
    assert.match(fm, /\nprojects: \["p"\]/);
    assert.match(fm, /\ntags: \[steward\/wiki, kind\/doc_drift\]/);
    assert.match(fm, /\ncontent_hash: abc123def4567890/);
    assert.match(fm, /\n---$/);
  });

  test('renderArticle produces frontmatter + body with all required sections', () => {
    const lessons = [
      { root_cause: 'STALE_LINK', lesson_text: 'links rotted', frequency: 5, ts: '2026-05-10', last_seen: '2026-05-10' },
    ];
    const summary = _internal.summarizeKindBucket(lessons);
    const article = _internal.renderArticle('doc_drift', lessons, summary, '2026-05-13T12:00:00.000Z');
    assert.match(article, /^---\n/);
    assert.match(article, /\n# action_kind: doc_drift/);
    assert.match(article, /## Recent lessons/);
    assert.match(article, /STALE_LINK/);
    assert.match(article, /## Sources/);
    assert.match(article, /## Notes/);
    assert.match(article, /Phase B \(LLM-validated merge/);
  });

  test('sanitizes lesson body — escapes ^---$ and ^## injections', () => {
    const lessons = [
      { root_cause: 'X', lesson_text: 'normal text\n---\nfake-divider\n## fake-heading\nmore', frequency: 1 },
    ];
    const summary = _internal.summarizeKindBucket(lessons);
    const article = _internal.renderArticle('doc_drift', lessons, summary, '2026-05-13T00:00:00Z');
    // Body should escape line-anchored injection
    assert.match(article, /\\---/);
    assert.match(article, /\\## fake-heading/);
  });

  test('sanitizes lesson body — strips control chars', () => {
    const lessons = [
      { root_cause: 'X', lesson_text: 'text\x00with\x01control\x07chars', frequency: 1 },
    ];
    const summary = _internal.summarizeKindBucket(lessons);
    const article = _internal.renderArticle('doc_drift', lessons, summary, '2026-05-13T00:00:00Z');
    assert.doesNotMatch(article, /[\x00\x01\x07]/);
  });
});

describe('wiki-consolidate — kind slug safety', () => {
  test('safe kind names pass', () => {
    assert.equal(_internal.isSafeKindSlug('doc_drift'), true);
    assert.equal(_internal.isSafeKindSlug('recommendation_harvest'), true);
    assert.equal(_internal.isSafeKindSlug('a-b-c_1_2'), true);
  });
  test('unsafe kind names rejected', () => {
    assert.equal(_internal.isSafeKindSlug('../escape'), false);
    assert.equal(_internal.isSafeKindSlug('a/b'), false);
    assert.equal(_internal.isSafeKindSlug(''), false);
    assert.equal(_internal.isSafeKindSlug('a'.repeat(65)), false);
    assert.equal(_internal.isSafeKindSlug(null), false);
    assert.equal(_internal.isSafeKindSlug(undefined), false);
  });
});

describe('wiki-consolidate — runWikiConsolidate orchestrator', () => {
  test('returns no_work when lessons.jsonl missing', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cons-empty-'));
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug: 'cortex-x' });
        assert.equal(r.ok, true);
        assert.equal(r.no_work, true);
        assert.equal(r.reason, 'no_lessons_jsonl_or_empty');
      });
    } finally { cleanup(dataHome); }
  });

  test('rejects invalid slug', () => {
    const r = runWikiConsolidate({ slug: '../etc' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_SLUG');
  });

  test('writes article per action_kind to wiki/<slug>/capabilities/<kind>.md', () => {
    const lessons = [
      { action_kind: 'doc_drift', root_cause: 'STALE_LINK', lesson_text: 'x', ts: '2026-05-10', frequency: 3 },
      { action_kind: 'doc_drift', root_cause: 'BROKEN_REF', lesson_text: 'y', ts: '2026-05-11', frequency: 2 },
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug });
        assert.equal(r.ok, true);
        assert.equal(r.kinds_processed, 1);
        assert.equal(r.articles_written.length, 1);
        assert.match(r.articles_written[0], /wiki[\\/].+[\\/]capabilities[\\/]doc_drift\.md/);
        const articlePath = path.join(dataHome, 'wiki', slug, 'capabilities', 'doc_drift.md');
        assert.equal(fs.existsSync(articlePath), true);
        const content = fs.readFileSync(articlePath, 'utf8');
        assert.match(content, /STALE_LINK/);
        assert.match(content, /BROKEN_REF/);
      });
    } finally { cleanup(dataHome); }
  });

  test('respects max-kinds cap; ranks by lesson count desc', () => {
    const lessons = [];
    // 6 different kinds, with descending lesson counts: a×5, b×4, c×3, d×2, e×1, f×1
    for (let i = 0; i < 5; i += 1) lessons.push({ action_kind: 'a', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    for (let i = 0; i < 4; i += 1) lessons.push({ action_kind: 'b', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    for (let i = 0; i < 3; i += 1) lessons.push({ action_kind: 'c', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    for (let i = 0; i < 2; i += 1) lessons.push({ action_kind: 'd', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    lessons.push({ action_kind: 'e', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    lessons.push({ action_kind: 'f', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' });
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug, maxKindsPerRun: 3 });
        assert.equal(r.kinds_processed, 3);
        assert.equal(r.kinds_skipped, 3);
        // Top 3 are a, b, c (highest lesson counts)
        assert.ok(r.articles_written.some((p) => p.includes('/a.md') || p.includes('\\a.md')));
        assert.ok(r.articles_written.some((p) => p.includes('/b.md') || p.includes('\\b.md')));
        assert.ok(r.articles_written.some((p) => p.includes('/c.md') || p.includes('\\c.md')));
      });
    } finally { cleanup(dataHome); }
  });

  test('dry-run does NOT touch disk', () => {
    const lessons = [{ action_kind: 'doc_drift', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' }];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug, dryRun: true });
        assert.equal(r.ok, true);
        assert.equal(r.dry_run, true);
        // No wiki/ dir should exist
        assert.equal(fs.existsSync(path.join(dataHome, 'wiki')), false);
      });
    } finally { cleanup(dataHome); }
  });

  test('cost_usd is always 0 in Phase A (no LLM)', () => {
    const lessons = [{ action_kind: 'doc_drift', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' }];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug });
        assert.equal(r.cost_usd, 0);
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 idempotency: re-run with unchanged lessons produces zero new writes', () => {
    // R2 correctness HIGH: cron should not produce dirty diffs on re-runs
    // when underlying lessons haven't changed. content_hash gates rewrite.
    const lessons = [
      { action_kind: 'doc_drift', root_cause: 'STALE_LINK', lesson_text: 'x', ts: '2026-05-10', frequency: 3 },
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r1 = runWikiConsolidate({ slug });
        assert.equal(r1.articles_written.length, 1);
        // Second run with same lessons → unchanged path fires
        const r2 = runWikiConsolidate({ slug });
        assert.equal(r2.articles_written.length, 0);
        assert.equal(r2.articles_unchanged.length, 1);
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 idempotency: content change DOES trigger rewrite', () => {
    const initial = [
      { action_kind: 'doc_drift', root_cause: 'X', lesson_text: 'a', ts: '2026-05-10' },
    ];
    const { dataHome, slug } = makeFixture(initial);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        runWikiConsolidate({ slug }); // initial write
        // Append a new lesson to lessons.jsonl
        const lessonsPath = path.join(dataHome, 'journal', slug, 'lessons.jsonl');
        fs.appendFileSync(
          lessonsPath,
          '\n' + JSON.stringify({ action_kind: 'doc_drift', root_cause: 'Y', lesson_text: 'b', ts: '2026-05-11' }) + '\n',
          'utf8'
        );
        const r2 = runWikiConsolidate({ slug });
        assert.equal(r2.articles_written.length, 1);
        assert.equal(r2.articles_unchanged.length, 0);
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 security HIGH: lessons.jsonl above MAX_LESSONS_FILE_BYTES returns no_work', () => {
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-cons-large-'));
    const slug = 'cortex-x-test';
    const journalDir = path.join(dataHome, 'journal', slug);
    fs.mkdirSync(journalDir, { recursive: true });
    // Write a fake oversized lessons.jsonl
    const oversizedPath = path.join(journalDir, 'lessons.jsonl');
    // 8MiB + 1 byte of valid JSON-line padding
    const oneLine = JSON.stringify({ action_kind: 'doc_drift', root_cause: 'X', lesson_text: 'x', ts: '2026-05-10' }) + '\n';
    const targetSize = _internal.MAX_LESSONS_FILE_BYTES + 1024;
    const repeats = Math.ceil(targetSize / oneLine.length);
    fs.writeFileSync(oversizedPath, oneLine.repeat(repeats), 'utf8');
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug });
        assert.equal(r.ok, true);
        assert.equal(r.no_work, true);
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 edge-case HIGH: non-string ts in lesson does not crash sort', () => {
    const lessons = [
      { action_kind: 'doc_drift', root_cause: 'X', lesson_text: 'x', ts: '2026-05-10', frequency: 1 },
      { action_kind: 'doc_drift', root_cause: 'Y', lesson_text: 'y', ts: 1714560000000, frequency: 1 }, // number!
      { action_kind: 'doc_drift', root_cause: 'Z', lesson_text: 'z', ts: ['array'], frequency: 1 }, // hostile array!
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        // Must NOT throw TypeError
        const r = runWikiConsolidate({ slug });
        assert.equal(r.ok, true);
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 edge-case HIGH: YAML scalar escape strips control chars + caps length', () => {
    // Verify escapeYamlString defangs newlines, tabs, control chars.
    const escaped = _internal.escapeYamlString('hello\nworld\twith\x07control');
    assert.equal(escaped.includes('\n'), false);
    assert.equal(escaped.includes('\t'), false);
    assert.equal(escaped.includes('\x07'), false);
    // Length cap: 200 chars
    const longInput = 'x'.repeat(500);
    const escapedLong = _internal.escapeYamlString(longInput);
    // Result is wrapped in `"..."` so the content is ≤200, total ≤202
    assert.ok(escapedLong.length <= 202, `expected ≤202, got ${escapedLong.length}`);
  });

  test('R2 edge-case MED: Windows reserved names (con, aux, nul) rejected', () => {
    for (const name of ['con', 'CON', 'aux', 'nul', 'PRN', 'com1', 'lpt9']) {
      assert.equal(_internal.isSafeKindSlug(name), false, `${name} should be rejected`);
    }
  });

  test('R2 correctness MED: tie-break by name when lesson counts equal', () => {
    // Two kinds with same count — alphabetical order should determine
    // which lands first in the result list (deterministic across runs).
    const lessons = [
      { action_kind: 'beta', root_cause: 'X', lesson_text: 'x', ts: '2026-05-10' },
      { action_kind: 'alpha', root_cause: 'X', lesson_text: 'x', ts: '2026-05-10' },
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug, maxKindsPerRun: 1 });
        assert.equal(r.kinds_processed, 1);
        // alpha < beta alphabetically → alpha should be the one written
        assert.ok(r.articles_written[0].endsWith('alpha.md') || r.articles_written[0].includes('alpha.md'));
      });
    } finally { cleanup(dataHome); }
  });

  test('R2 correctness MED: mixed-format timestamps compare correctly', () => {
    // Date-only `2026-05-10` vs full timestamp `2026-05-10T12:00:00Z` should
    // produce correct min/max via Date.parse() normalization.
    const lessons = [
      { ts: '2026-05-10', root_cause: 'A' },
      { ts: '2026-05-12T15:00:00Z', root_cause: 'B' },
      { ts: '2026-05-11T00:00:00Z', root_cause: 'C' },
    ];
    const s = _internal.summarizeKindBucket(lessons);
    // Latest should be the May 12 entry (timestamped)
    assert.equal(s.last_seen, '2026-05-12T15:00:00Z');
    // Earliest should be the May 10 entry (date-only)
    assert.equal(s.first_seen, '2026-05-10');
  });

  test('skips unsafe kind names defensively (does not write articles for them)', () => {
    const lessons = [
      { action_kind: 'doc_drift', root_cause: 'X', lesson_text: 't', ts: '2026-05-10' },
      { action_kind: '../escape', root_cause: 'BAD', lesson_text: 'evil', ts: '2026-05-10' },
    ];
    const { dataHome, slug } = makeFixture(lessons);
    try {
      withEnv({ CORTEX_DATA_HOME: dataHome }, () => {
        const r = runWikiConsolidate({ slug });
        assert.equal(r.ok, true);
        // Only safe kind processed
        assert.equal(r.kinds_processed, 1);
        // Unsafe kind didn't materialize as a file
        assert.equal(fs.existsSync(path.join(dataHome, 'wiki', slug, 'capabilities', '..', 'escape.md')), false);
      });
    } finally { cleanup(dataHome); }
  });
});
