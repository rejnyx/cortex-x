// detect-todo-triage.test.cjs — Sprint 1.8.7 TODO triage detector tests.
//
// Tests use the `mockFiles` + `mockOpenIssues` + `skipBlame` + `skipGh` DI
// parameters to feed canned input. No real fs scan, no git blame, no gh
// calls — fully deterministic.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/todo-triage.cjs');

describe('scanFileForMarkers (via triageTodos mockFiles)', () => {
  test('finds TODO marker in source line', () => {
    const r = detector.triageTodos({
      mockFiles: [{ path: 'src/x.js', content: 'const x = 1;\n// TODO: refactor this' }],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.total_markers, 1);
    assert.equal(r.candidates[0].marker, 'TODO');
    assert.match(r.candidates[0].text, /refactor/);
  });

  test('finds FIXME / XXX / HACK markers', () => {
    const r = detector.triageTodos({
      mockFiles: [
        { path: 'a.js', content: '// FIXME: broken edge case' },
        { path: 'b.js', content: '// XXX: ugly hack' },
        { path: 'c.js', content: '// HACK: temporary fix' },
      ],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.total_markers, 3);
    const markers = r.candidates.map((c) => c.marker).sort();
    assert.deepEqual(markers, ['FIXME', 'HACK', 'XXX']);
  });

  test('captures line number', () => {
    const r = detector.triageTodos({
      mockFiles: [{ path: 'x.js', content: 'line 1\nline 2\n// TODO: this is line 3' }],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.candidates[0].lineNumber, 3);
  });

  test('does NOT match TODO inside identifier (must be word-bounded)', () => {
    const r = detector.triageTodos({
      mockFiles: [{ path: 'x.js', content: 'const NOTODO = 1;\nconst todoStuff = 2;' }],
      skipBlame: true,
      skipGh: true,
    });
    // Word boundary: 'TODO' inside 'NOTODO' should NOT match (no word break before)
    // 'todo' lowercase doesn't match (regex is uppercase only — word case matters)
    assert.equal(r.total_markers, 0);
  });

  test('handles multiple markers in same file', () => {
    const content = 'line 0\n// TODO: first\nline 2\n// FIXME: second\nline 4';
    const r = detector.triageTodos({
      mockFiles: [{ path: 'x.js', content }],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.total_markers, 2);
  });
});

describe('triageTodos: dedup vs open issues', () => {
  const TODOS = [
    { path: 'a.js', content: '// TODO: implement caching layer' },
    { path: 'b.js', content: '// TODO: fix flaky tests' },
    { path: 'c.js', content: '// TODO: add observability' },
  ];

  test('dedups when open issue title contains TODO keyword', () => {
    const r = detector.triageTodos({
      mockFiles: TODOS,
      mockOpenIssues: [
        { title: 'Add caching layer to API responses' }, // matches 'caching'
      ],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.skipped_dup, 1);
    assert.equal(r.candidates.length, 2);
    // The "caching layer" TODO should be deduped
    assert.ok(!r.candidates.some((c) => c.text.includes('caching')));
  });

  test('keeps all TODOs when no open issues', () => {
    const r = detector.triageTodos({
      mockFiles: TODOS,
      mockOpenIssues: [],
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.candidates.length, 3);
    assert.equal(r.skipped_dup, 0);
  });

  test('respects maxCandidates cap', () => {
    const many = [];
    for (let i = 0; i < 10; i += 1) {
      many.push({ path: `f${i}.js`, content: `// TODO: thing ${i} extra-padding-text` });
    }
    const r = detector.triageTodos({
      mockFiles: many,
      mockOpenIssues: [],
      maxCandidates: 3,
      skipBlame: true,
      skipGh: true,
    });
    assert.equal(r.candidates.length, 3);
  });
});

describe('isLikelyDuplicate', () => {
  test('returns true when issue title contains 5+ char chunk of TODO', () => {
    const issues = new Set(['add caching layer for users']);
    assert.equal(detector.isLikelyDuplicate('implement caching layer here', issues), true);
  });

  test('returns false when no shared 5+ char tokens', () => {
    const issues = new Set(['fix bug in login']);
    assert.equal(detector.isLikelyDuplicate('add new feature', issues), false);
  });

  test('returns false on empty input', () => {
    assert.equal(detector.isLikelyDuplicate('', new Set(['anything'])), false);
    assert.equal(detector.isLikelyDuplicate('something', new Set()), false);
  });

  test('only counts tokens >= 5 chars (avoids generic stopwords)', () => {
    const issues = new Set(['the cat sat']);
    // 'the', 'cat', 'sat' are all <5 chars; should NOT match
    assert.equal(detector.isLikelyDuplicate('the cat ran', issues), false);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle uses marker + text shape', () => {
    const t = detector.formatIssueTitle({ marker: 'TODO', text: 'add tests' });
    assert.equal(t, 'TODO: add tests');
  });

  test('formatIssueTitle truncates long text to 60 chars', () => {
    const longText = 'x'.repeat(100);
    const t = detector.formatIssueTitle({ marker: 'TODO', text: longText });
    assert.ok(t.length <= 70); // marker + : + 60-char text
  });

  test('formatIssueTitle handles missing text', () => {
    const t = detector.formatIssueTitle({ marker: 'FIXME' });
    assert.match(t, /FIXME:/);
  });

  test('formatIssueBody includes file location, marker, and code context', () => {
    const body = detector.formatIssueBody({
      file: 'src/x.js',
      lineNumber: 42,
      marker: 'TODO',
      text: 'add caching',
      rawLine: '// TODO: add caching',
    });
    assert.match(body, /src\/x\.js:42/);
    assert.match(body, /\*\*TODO\*\*: add caching/);
    assert.match(body, /## Code context/);
    assert.match(body, /## Source location/);
  });

  test('formatIssueBody includes blame info when present', () => {
    const body = detector.formatIssueBody({
      file: 'a.js',
      lineNumber: 1,
      marker: 'TODO',
      text: 'x',
      blame: { author: 'Dave', authorDate: '2026-01-01T00:00:00Z', sha: 'abc12345' },
      age_days: 90,
    });
    assert.match(body, /## git blame/);
    assert.match(body, /author: Dave/);
    assert.match(body, /age: 90 days/);
    assert.match(body, /commit: abc12345/);
  });

  test('formatIssueBody omits blame section when not present', () => {
    const body = detector.formatIssueBody({
      file: 'a.js',
      lineNumber: 1,
      marker: 'TODO',
      text: 'x',
      blame: null,
    });
    assert.doesNotMatch(body, /## git blame/);
  });

  test('formatIssueBody includes Steward attribution footer', () => {
    const body = detector.formatIssueBody({ file: 'a.js', lineNumber: 1, marker: 'TODO', text: 'x' });
    assert.match(body, /Filed by Steward/);
  });
});

describe('ageDays', () => {
  test('returns positive int for past dates', () => {
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    assert.ok(detector.ageDays(past) >= 29);
  });

  test('returns 0 for now', () => {
    const now = new Date().toISOString();
    assert.equal(detector.ageDays(now), 0);
  });

  test('returns null for invalid input', () => {
    assert.equal(detector.ageDays(null), null);
    assert.equal(detector.ageDays('not a date'), null);
  });
});

describe('todoFingerprint', () => {
  test('returns lowercased trimmed text', () => {
    assert.equal(detector.todoFingerprint({ text: '  Add Caching  ' }), 'add caching');
  });

  test('handles missing text', () => {
    assert.equal(detector.todoFingerprint({}), '');
  });
});
