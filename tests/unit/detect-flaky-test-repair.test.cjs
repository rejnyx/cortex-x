// detect-flaky-test-repair.test.cjs — Sprint 1.8.5 marker-based detector tests.
// All tests use mockFiles DI — no real fs scan, fully deterministic.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/flaky-test-repair.cjs');

describe('scanContentForMarkers', () => {
  test('finds HERMES-FLAKY marker above test() declaration', () => {
    const content = `
// HERMES-FLAKY: race condition with database
test('user can log in', () => {
  // ...
});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].testKind, 'test');
    assert.equal(markers[0].testName, 'user can log in');
    assert.equal(markers[0].reason, 'race condition with database');
  });

  test('finds marker above it() declaration', () => {
    const content = `
// HERMES-FLAKY: timeout-prone
it('returns within 100ms', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].testKind, 'it');
    assert.equal(markers[0].testName, 'returns within 100ms');
  });

  test('finds marker above describe() declaration', () => {
    const content = `
// HERMES-FLAKY: integration-only suite, fails locally
describe('payment flow', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].testKind, 'describe');
  });

  test('handles single, double, and backtick quotes', () => {
    const content = `
// HERMES-FLAKY: x
test('single quotes', () => {});
// HERMES-FLAKY: y
test("double quotes", () => {});
// HERMES-FLAKY: z
test(\`backticks\`, () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 3);
    assert.deepEqual(markers.map((m) => m.testName), ['single quotes', 'double quotes', 'backticks']);
  });

  test('marker without test declaration within 3 lines is skipped', () => {
    const content = `
// HERMES-FLAKY: orphan marker
const x = 1;
const y = 2;
const z = 3;
test('this is too far away', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 0);
  });

  test('extracts reason text after marker', () => {
    const content = `
// HERMES-FLAKY: some description here
test('x', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers[0].reason, 'some description here');
  });

  test('empty reason is OK (just the marker, no text)', () => {
    const content = `
// HERMES-FLAKY:
test('x', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 1);
    assert.equal(markers[0].reason, '');
  });

  test('handles multiple markers in same file', () => {
    const content = `
// HERMES-FLAKY: a
test('first', () => {});

// HERMES-FLAKY: b
it('second', () => {});

const x = 1; // unrelated

// HERMES-FLAKY: c
describe('third', () => {});
`.trim();
    const markers = detector.scanContentForMarkers(content);
    assert.equal(markers.length, 3);
  });
});

describe('applyQuarantineEdits', () => {
  test('replaces test( with test.skip(', () => {
    const content = `// HERMES-FLAKY: x
test('y', () => {});
`;
    const markers = detector.scanContentForMarkers(content);
    const { newContent } = detector.applyQuarantineEdits(content, markers);
    assert.match(newContent, /test\.skip\('y'/);
    assert.doesNotMatch(newContent, /HERMES-FLAKY/);
  });

  test('replaces it( with it.skip(', () => {
    const content = `// HERMES-FLAKY: x
it('y', () => {});
`;
    const markers = detector.scanContentForMarkers(content);
    const { newContent } = detector.applyQuarantineEdits(content, markers);
    assert.match(newContent, /it\.skip\('y'/);
  });

  test('replaces describe( with describe.skip(', () => {
    const content = `// HERMES-FLAKY: x
describe('y', () => {});
`;
    const markers = detector.scanContentForMarkers(content);
    const { newContent } = detector.applyQuarantineEdits(content, markers);
    assert.match(newContent, /describe\.skip\('y'/);
  });

  test('removes HERMES-FLAKY marker line entirely', () => {
    const content = `// HERMES-FLAKY: x
test('y', () => {});
`;
    const markers = detector.scanContentForMarkers(content);
    const { newContent } = detector.applyQuarantineEdits(content, markers);
    assert.doesNotMatch(newContent, /HERMES-FLAKY/);
  });

  test('returns edit log with quarantine + remove_marker entries', () => {
    const content = `// HERMES-FLAKY: x
test('y', () => {});
`;
    const markers = detector.scanContentForMarkers(content);
    const { edits } = detector.applyQuarantineEdits(content, markers);
    assert.equal(edits.length, 2);
    assert.ok(edits.some((e) => e.type === 'quarantine'));
    assert.ok(edits.some((e) => e.type === 'remove_marker'));
  });

  test('processes multiple markers without index drift', () => {
    const content = `line 0
// HERMES-FLAKY: first
test('a', () => {});
line 4
// HERMES-FLAKY: second
test('b', () => {});
line 7
`;
    const markers = detector.scanContentForMarkers(content);
    const { newContent } = detector.applyQuarantineEdits(content, markers);
    assert.match(newContent, /test\.skip\('a'/);
    assert.match(newContent, /test\.skip\('b'/);
    assert.doesNotMatch(newContent, /HERMES-FLAKY/);
  });

  test('returns content unchanged when no markers', () => {
    const content = `test('x', () => {});\n`;
    const { newContent, edits } = detector.applyQuarantineEdits(content, []);
    assert.equal(newContent, content);
    assert.equal(edits.length, 0);
  });
});

describe('detectFlakyMarkers (DI)', () => {
  test('returns empty when no markers', () => {
    const r = detector.detectFlakyMarkers({
      mockFiles: [{ path: 'a.test.js', content: 'test("x", () => {});' }],
    });
    assert.equal(r.candidates.length, 0);
    assert.equal(r.total_found, 0);
  });

  test('returns candidates from mock files', () => {
    const r = detector.detectFlakyMarkers({
      mockFiles: [
        { path: 'a.test.js', content: '// HERMES-FLAKY: aa\ntest("a", () => {});' },
        { path: 'b.test.js', content: '// HERMES-FLAKY: bb\nit("b", () => {});' },
      ],
    });
    assert.equal(r.candidates.length, 2);
  });

  test('respects maxCandidates cap', () => {
    const files = [];
    for (let i = 0; i < 10; i += 1) {
      files.push({ path: `t${i}.test.js`, content: `// HERMES-FLAKY: r${i}\ntest("t${i}", () => {});` });
    }
    const r = detector.detectFlakyMarkers({ mockFiles: files, maxCandidates: 3 });
    assert.equal(r.candidates.length, 3);
    assert.equal(r.total_found, 10);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle uses test name', () => {
    const t = detector.formatIssueTitle({ testName: 'user logs in' });
    assert.equal(t, 'Flaky test quarantined: user logs in');
  });

  test('formatIssueTitle truncates long names', () => {
    const t = detector.formatIssueTitle({ testName: 'x'.repeat(100) });
    assert.ok(t.length <= 80);
    assert.match(t, /…$/);
  });

  test('formatIssueBody includes file location, kind, name, reason', () => {
    const body = detector.formatIssueBody({
      file: 'tests/x.test.js',
      testLine: 42,
      testKind: 'test',
      testName: 'login flow',
      reason: 'race condition',
    });
    assert.match(body, /tests\/x\.test\.js:42/);
    assert.match(body, /test\('login flow'\)/);
    assert.match(body, /race condition/);
    assert.match(body, /Replaced.*test.*\.skip/);
  });

  test('formatIssueBody handles missing reason', () => {
    const body = detector.formatIssueBody({
      file: 'a.test.js',
      testLine: 1,
      testKind: 'it',
      testName: 'x',
      reason: '',
    });
    assert.match(body, /no reason supplied/);
  });
});
