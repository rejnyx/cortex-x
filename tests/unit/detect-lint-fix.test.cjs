// detect-lint-fix.test.cjs — Sprint 1.8.9 ESLint + tsc detector tests.
// All tests use mockEslint + mockTsc DI — no real eslint/tsc invocation.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/lint-fix.cjs');

describe('detectLintFix (DI)', () => {
  test('returns empty when neither eslint nor tsc available', () => {
    const r = detector.detectLintFix({
      mockEslint: { ran: false, eslint_available: false, modified_files: [] },
      mockTsc: { ran: false, tsc_available: false, type_errors: [] },
    });
    assert.equal(r.touched_files.length, 0);
    assert.equal(r.type_errors.length, 0);
    assert.equal(r.eslint_available, false);
    assert.equal(r.tsc_available, false);
  });

  test('returns auto-fixed files from eslint result', () => {
    const r = detector.detectLintFix({
      mockEslint: {
        ran: true,
        eslint_available: true,
        modified_files: ['src/a.js', 'src/b.js'],
      },
      mockTsc: { ran: false, tsc_available: false, type_errors: [] },
    });
    assert.deepEqual(r.touched_files, ['src/a.js', 'src/b.js']);
    assert.equal(r.eslint_ran, true);
  });

  test('returns type errors from tsc result', () => {
    const r = detector.detectLintFix({
      mockEslint: { ran: true, eslint_available: true, modified_files: [] },
      mockTsc: {
        ran: true,
        tsc_available: true,
        type_errors: [
          { file: 'src/x.ts', line: 10, column: 5, code: 'TS2322', msg: 'Type "string" is not assignable' },
        ],
      },
    });
    assert.equal(r.type_errors.length, 1);
    assert.equal(r.type_errors[0].code, 'TS2322');
  });

  test('separates eslint auto-fixes from tsc type errors', () => {
    const r = detector.detectLintFix({
      mockEslint: { ran: true, eslint_available: true, modified_files: ['fixed.js'] },
      mockTsc: {
        ran: true,
        tsc_available: true,
        type_errors: [{ file: 'broken.ts', line: 1, column: 1, code: 'TS1', msg: 'x' }],
      },
    });
    assert.equal(r.touched_files.length, 1);
    assert.equal(r.type_errors.length, 1);
  });
});

describe('runTsc parsing (DI)', () => {
  test('parses tsc error line format', () => {
    // Internal helper test — we mock tsc output via mockResult
    const r = detector.runTsc({
      mockResult: {
        ran: true,
        tsc_available: true,
        type_errors: [
          { file: 'src/a.ts', line: 5, column: 3, code: 'TS2322', msg: 'Type error' },
        ],
      },
    });
    assert.equal(r.type_errors.length, 1);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle includes code + message', () => {
    const t = detector.formatIssueTitle({
      code: 'TS2322',
      msg: 'Type "string" is not assignable to type "number"',
    });
    assert.match(t, /TS2322/);
    assert.match(t, /Type/);
  });

  test('formatIssueTitle truncates long messages', () => {
    const t = detector.formatIssueTitle({
      code: 'TS1',
      msg: 'x'.repeat(200),
    });
    assert.ok(t.length <= 80);
    assert.match(t, /…$/);
  });

  test('formatIssueBody includes file location, code, message, why', () => {
    const body = detector.formatIssueBody({
      file: 'src/api.ts',
      line: 42,
      column: 10,
      code: 'TS2322',
      msg: 'incompatible',
    });
    assert.match(body, /src\/api\.ts:42:10/);
    assert.match(body, /TS2322/);
    assert.match(body, /incompatible/);
    assert.match(body, /## Why this is filed/);
    assert.match(body, /lint_fix_shipper/);
  });
});
