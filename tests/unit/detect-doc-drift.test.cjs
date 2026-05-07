// detect-doc-drift.test.cjs — Sprint 1.8.6 deterministic doc drift tests.
// All tests use mockFiles + mockDocsCorpus DI. No real fs scan.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/doc-drift.cjs');

describe('scanContentForExports', () => {
  test('detects export function', () => {
    const exports_ = detector.scanContentForExports('export function foo() {}');
    assert.equal(exports_.length, 1);
    assert.equal(exports_[0].name, 'foo');
    assert.equal(exports_[0].kind, 'function');
  });

  test('detects export async function', () => {
    const exports_ = detector.scanContentForExports('export async function bar() {}');
    assert.equal(exports_[0].name, 'bar');
    assert.equal(exports_[0].kind, 'function');
  });

  test('detects export class', () => {
    const exports_ = detector.scanContentForExports('export class MyClass {}');
    assert.equal(exports_[0].name, 'MyClass');
    assert.equal(exports_[0].kind, 'class');
  });

  test('detects export const', () => {
    const exports_ = detector.scanContentForExports('export const PI = 3.14;');
    assert.equal(exports_[0].name, 'PI');
    assert.equal(exports_[0].kind, 'const');
  });

  test('detects export let / export var', () => {
    const exports_ = detector.scanContentForExports('export let counter = 0;');
    assert.equal(exports_[0].name, 'counter');
  });

  test('detects export type / export interface', () => {
    const exports_ = detector.scanContentForExports('export type Foo = string;\nexport interface Bar {}');
    assert.equal(exports_.length, 2);
    assert.deepEqual(exports_.map((e) => e.kind), ['type', 'type']);
  });

  test('detects export default function/class', () => {
    const exports_ = detector.scanContentForExports('export default function App() {}\nexport default class Page {}');
    assert.equal(exports_.length, 2);
    assert.equal(exports_[0].name, 'App');
    assert.equal(exports_[1].name, 'Page');
  });

  test('captures line number', () => {
    const content = 'line 0\nline 1\nexport const X = 1;\nline 3';
    const exports_ = detector.scanContentForExports(content);
    assert.equal(exports_[0].lineNumber, 3);
  });

  test('skips private symbols (leading underscore)', () => {
    const exports_ = detector.scanContentForExports('export function _privateThing() {}');
    assert.equal(exports_.length, 0);
  });

  test('skips internal-prefixed names', () => {
    const exports_ = detector.scanContentForExports('export function internalOnly() {}');
    assert.equal(exports_.length, 0);
  });

  test('does not detect nested / non-top-level exports', () => {
    const content = '  export function indented() {}\n   export const x = 1;';
    // EXPORT_PATTERNS use ^ anchor — indented exports skip
    const exports_ = detector.scanContentForExports(content);
    assert.equal(exports_.length, 0);
  });
});

describe('isDocumented', () => {
  test('matches whole word', () => {
    assert.equal(detector.isDocumented('myFunc', 'use myFunc to call'), true);
  });

  test('does not match substring inside another word', () => {
    assert.equal(detector.isDocumented('foo', 'this is foobar'), false);
  });

  test('case-sensitive matching', () => {
    assert.equal(detector.isDocumented('MyClass', 'use myclass'), false);
    assert.equal(detector.isDocumented('MyClass', 'use MyClass'), true);
  });

  test('returns false for empty inputs', () => {
    assert.equal(detector.isDocumented('', 'corpus'), false);
    assert.equal(detector.isDocumented('symbol', ''), false);
  });

  test('matches symbols with embedded $ (jQuery-style)', () => {
    // Symbol mid-word $ works because \b is between alpha + $.
    // Leading $ is documented limitation — cortex-x exports don't use it.
    assert.equal(detector.isDocumented('a$b', 'see a$b for'), true);
  });
});

describe('isPrivateSymbol', () => {
  test('underscore prefix → private', () => {
    assert.equal(detector.isPrivateSymbol('_x'), true);
    assert.equal(detector.isPrivateSymbol('__y'), true);
  });

  test('default → private (default exports often re-exported with proper name)', () => {
    assert.equal(detector.isPrivateSymbol('default'), true);
  });

  test('internal prefix → private (case-insensitive)', () => {
    assert.equal(detector.isPrivateSymbol('internalThing'), true);
    assert.equal(detector.isPrivateSymbol('InternalAPI'), true);
  });

  test('regular names → public', () => {
    assert.equal(detector.isPrivateSymbol('myFunc'), false);
    assert.equal(detector.isPrivateSymbol('MyClass'), false);
  });
});

describe('isTestFile', () => {
  test('matches .test. and .spec.', () => {
    assert.equal(detector.isTestFile('foo.test.js'), true);
    assert.equal(detector.isTestFile('bar.spec.ts'), true);
  });

  test('matches __tests__ folder', () => {
    assert.equal(detector.isTestFile('__tests__/whatever.js'), true);
  });

  test('matches .d.ts (type definitions, not real exports)', () => {
    assert.equal(detector.isTestFile('types.d.ts'), true);
  });

  test('non-test files pass', () => {
    assert.equal(detector.isTestFile('regular.js'), false);
    assert.equal(detector.isTestFile('Component.tsx'), false);
  });
});

describe('detectDocDrift (DI)', () => {
  test('returns drift candidates for undocumented exports', () => {
    const r = detector.detectDocDrift({
      mockFiles: [
        { path: 'src/api.js', content: 'export function publicAPI() {}' },
        { path: 'src/util.js', content: 'export const VERSION = "1.0";' },
      ],
      mockDocsCorpus: 'README mentions VERSION but nothing else',
    });
    assert.equal(r.total_exports, 2);
    assert.equal(r.documented_count, 1); // VERSION
    assert.equal(r.drifted_count, 1);    // publicAPI
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].name, 'publicAPI');
  });

  test('zero drift when all documented', () => {
    const r = detector.detectDocDrift({
      mockFiles: [{ path: 'src/x.js', content: 'export function foo() {}' }],
      mockDocsCorpus: 'foo is the main API',
    });
    assert.equal(r.drifted_count, 0);
    assert.equal(r.candidates.length, 0);
  });

  test('all drifted when no docs', () => {
    const r = detector.detectDocDrift({
      mockFiles: [
        { path: 'a.js', content: 'export function a() {}' },
        { path: 'b.js', content: 'export class B {}' },
      ],
      mockDocsCorpus: '',
    });
    assert.equal(r.drifted_count, 2);
  });

  test('respects maxCandidates cap', () => {
    const files = [];
    for (let i = 0; i < 10; i += 1) {
      files.push({ path: `f${i}.js`, content: `export function foo${i}() {}` });
    }
    const r = detector.detectDocDrift({ mockFiles: files, mockDocsCorpus: '', maxCandidates: 3 });
    assert.equal(r.candidates.length, 3);
    assert.equal(r.total_exports, 10);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle includes kind + name', () => {
    const t = detector.formatIssueTitle({ kind: 'function', name: 'myFn' });
    assert.match(t, /Doc drift:/);
    assert.match(t, /function/);
    assert.match(t, /myFn/);
  });

  test('formatIssueBody includes symbol, location, why, options', () => {
    const body = detector.formatIssueBody({
      file: 'src/x.js',
      lineNumber: 42,
      kind: 'class',
      name: 'MyAPI',
    });
    assert.match(body, /MyAPI/);
    assert.match(body, /src\/x\.js:42/);
    assert.match(body, /## Why this is filed/);
    assert.match(body, /Add it to docs/);
    assert.match(body, /Mark it private/);
    assert.match(body, /Close as not-applicable/);
  });
});
