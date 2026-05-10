// Sprint 2.2.5 v1 — splice.cjs str_replace + insert + safety gate tests.
//
// Coverage:
//   - validateOp: str_replace + insert shape (8 cases)
//   - str_replace: unique anchor, ambiguous, missing, line-boundary,
//     self-protecting tier block (6 cases)
//   - insert: after_line happy paths, off-by-one, EOF (5 cases)
//   - SHA gate: required, present-correct, present-stale (3 cases)
//   - LLM-as-code defense: dangerous patterns blocked in *.js, allowed in
//     *.md (5 cases)
//   - Atomicity preserved across v1 ops (2 cases)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const splice = require('../../../bin/steward/_lib/splice.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `splice-v1-${label}-`));
}

test.describe('v1 validateOp — str_replace shape', () => {
  test('accepts well-formed str_replace', () => {
    const r = splice.validateOp({ kind: 'str_replace', old_str: 'foo', new_str: 'bar' });
    assert.equal(r.ok, true);
  });
  test('rejects empty old_str', () => {
    assert.equal(splice.validateOp({ kind: 'str_replace', old_str: '', new_str: 'bar' }).code, 'EDIT_OP_MISSING_FIELD');
  });
  test('rejects missing new_str', () => {
    assert.equal(splice.validateOp({ kind: 'str_replace', old_str: 'x' }).code, 'EDIT_OP_MISSING_FIELD');
  });
  test('rejects non-string old_str', () => {
    assert.equal(splice.validateOp({ kind: 'str_replace', old_str: null, new_str: 'y' }).code, 'EDIT_OP_MISSING_FIELD');
  });
});

test.describe('v1 validateOp — insert shape', () => {
  test('accepts well-formed insert', () => {
    assert.equal(splice.validateOp({ kind: 'insert', after_line: 0, text: 'x' }).ok, true);
  });
  test('rejects negative after_line', () => {
    assert.equal(splice.validateOp({ kind: 'insert', after_line: -1, text: 'x' }).code, 'EDIT_OP_TYPE_MISMATCH');
  });
  test('rejects float after_line', () => {
    assert.equal(splice.validateOp({ kind: 'insert', after_line: 1.5, text: 'x' }).code, 'EDIT_OP_TYPE_MISMATCH');
  });
  test('rejects empty text', () => {
    assert.equal(splice.validateOp({ kind: 'insert', after_line: 0, text: '' }).code, 'EDIT_OP_EMPTY_PAYLOAD');
  });
});

test.describe('v1 str_replace — anchor uniqueness + boundary + apply', () => {
  test('happy: unique line-boundary anchor → replaces in place', () => {
    const dir = tmp('sr-happy');
    const src = '// header\nfoo\nbar\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'str_replace', old_str: 'foo\n', new_str: 'FOO\nNEW\n' }],
      }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), '// header\nFOO\nNEW\nbar\n');
  });

  test('ambiguous: anchor matches twice → EDIT_OP_ANCHOR_AMBIGUOUS', () => {
    const dir = tmp('sr-ambig');
    const src = 'foo\nfoo\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'str_replace', old_str: 'foo', new_str: 'X' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_ANCHOR_AMBIGUOUS');
  });

  test('missing: anchor not in file → EDIT_OP_ANCHOR_NOT_FOUND', () => {
    const dir = tmp('sr-miss');
    const src = 'hello\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'str_replace', old_str: 'goodbye', new_str: 'X' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_ANCHOR_NOT_FOUND');
  });

  test('line-boundary check: mid-line anchor in self-protecting tier blocked', () => {
    // Simulate self-protecting tier (bin/steward/...) by placing the file under that path.
    const dir = tmp('sr-tier');
    fs.mkdirSync(path.join(dir, 'bin/steward/_lib'), { recursive: true });
    const target = 'bin/steward/_lib/example.cjs';
    const src = 'const banner = "// END";\nconst x = 1;\n';
    fs.writeFileSync(path.join(dir, target), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: target,
        expectedSha256: splice.sha256(src),
        // anchor "// END" is mid-string-literal, not line-boundary
        ops: [{ kind: 'str_replace', old_str: '// END', new_str: '// HACKED' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_ANCHOR_INSIDE_STRING');
  });

  test('line-boundary check: anchor starting at column 0 passes everywhere', () => {
    const dir = tmp('sr-col0');
    const src = '// HEADER\nbody\n';
    fs.writeFileSync(path.join(dir, 'a.md'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.md',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'str_replace', old_str: '// HEADER\n', new_str: '# HEADER\n' }],
      }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), '# HEADER\nbody\n');
  });

  test('non-self-protecting tier: mid-line anchor allowed (warn-only)', () => {
    // Outside self-protecting tier — anchor doesn't touch line boundary, but
    // we don't block (warn-only future hook).
    const dir = tmp('sr-warn');
    const src = 'pre middle post\n';
    fs.writeFileSync(path.join(dir, 'a.md'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.md',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'str_replace', old_str: 'middle', new_str: 'MIDDLE' }],
      }],
    });
    assert.equal(r.ok, true);
  });
});

test.describe('v1 insert — after_line semantics + bounds', () => {
  test('after_line:0 inserts at beginning', () => {
    const dir = tmp('ins-0');
    const src = 'one\ntwo\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'insert', after_line: 0, text: 'zero\n' }],
      }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'zero\none\ntwo\n');
  });

  test('after_line:1 inserts after first line', () => {
    const dir = tmp('ins-1');
    const src = 'one\ntwo\nthree\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'insert', after_line: 1, text: 'inserted\n' }],
      }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\ninserted\ntwo\nthree\n');
  });

  test('after_line beyond end → EDIT_OP_LINE_OUT_OF_RANGE', () => {
    const dir = tmp('ins-oor');
    const src = 'one\ntwo\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [{ kind: 'insert', after_line: 99, text: 'x' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_LINE_OUT_OF_RANGE');
  });

  test('after_line at lineCount (last line) inserts at end', () => {
    const dir = tmp('ins-end');
    const src = 'one\ntwo\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        // 2 newlines = 2 lines (with trailing \n) — after_line=2 = end of file
        ops: [{ kind: 'insert', after_line: 2, text: 'three\n' }],
      }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n');
  });
});

test.describe('v1 SHA gate', () => {
  test('str_replace without expectedSha256 → EDIT_OP_SHA_REQUIRED', () => {
    const dir = tmp('sha-missing');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'foo\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        ops: [{ kind: 'str_replace', old_str: 'foo', new_str: 'bar' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_SHA_REQUIRED');
  });

  test('insert with stale expectedSha256 → EDIT_OP_STALE_SHA', () => {
    const dir = tmp('sha-stale');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'currentcontent\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: 'a'.repeat(64), // wrong sha
        ops: [{ kind: 'insert', after_line: 0, text: 'x\n' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_STALE_SHA');
  });

  test('append + create do NOT require expectedSha256', () => {
    const dir = tmp('sha-not-required');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'seed');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [
        { path: 'a.txt', ops: [{ kind: 'append', text: '+more' }] },
        { path: 'b.txt', ops: [{ kind: 'create', content: 'new' }] },
      ],
    });
    assert.equal(r.ok, true);
  });
});

test.describe('v1 LLM-as-code defense', () => {
  test('dangerous pattern in .cjs blocked', () => {
    const dir = tmp('llm-dangerous-cjs');
    fs.writeFileSync(path.join(dir, 'a.cjs'), '// safe\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.cjs',
        ops: [{ kind: 'append', text: '\nrequire("child_process").exec("rm -rf /");' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_LLM_CONTENT_DANGEROUS');
  });

  test('eval() pattern in .ts blocked', () => {
    const dir = tmp('llm-eval');
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const x = 1;\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.ts',
        ops: [{ kind: 'append', text: '\neval("alert(1)");' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_LLM_CONTENT_DANGEROUS');
  });

  test('process.env interpolation in .js blocked', () => {
    const dir = tmp('llm-procenv');
    fs.writeFileSync(path.join(dir, 'a.js'), '// safe\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.js',
        ops: [{ kind: 'append', text: '\nconst k = `${process.env.SECRET}`;' }],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_LLM_CONTENT_DANGEROUS');
  });

  test('same dangerous pattern in .md ALLOWED (not executable)', () => {
    const dir = tmp('llm-md-ok');
    fs.writeFileSync(path.join(dir, 'a.md'), '# Doc\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.md',
        ops: [{ kind: 'append', text: '\nExample: `require("child_process").exec(...)` is dangerous.\n' }],
      }],
    });
    assert.equal(r.ok, true);
  });

  test('safe content in .cjs passes', () => {
    const dir = tmp('llm-cjs-ok');
    fs.writeFileSync(path.join(dir, 'a.cjs'), '// safe\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.cjs',
        ops: [{ kind: 'append', text: '\nmodule.exports = { foo: 1 };\n' }],
      }],
    });
    assert.equal(r.ok, true);
  });
});

test.describe('v1 atomicity — str_replace failure rolls back prior ops', () => {
  test('append succeeds then str_replace fails → file restored', () => {
    const dir = tmp('v1-atomic');
    const src = 'one\ntwo\n';
    fs.writeFileSync(path.join(dir, 'a.txt'), src);
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{
        path: 'a.txt',
        expectedSha256: splice.sha256(src),
        ops: [
          { kind: 'append', text: 'three\n' },
          { kind: 'str_replace', old_str: 'NONEXISTENT', new_str: 'X' },
        ],
      }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_ANCHOR_NOT_FOUND');
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), src);
  });

  test('multi-edit batch: SHA validation in phase 1 catches stale SHA before any apply', () => {
    // Phase 1 validates SHA + safety BEFORE phase 2 mutates disk. So a stale
    // SHA in edit[1] prevents edit[0] from being applied at all — stronger
    // than the v0 cross-edit semantics. Net: SHA gate gives v1 ops cross-edit
    // atomicity by accident (any stale SHA in the batch fails the whole batch
    // pre-write).
    const dir = tmp('v1-cross-edit');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B\n');
    const shaA = splice.sha256('A\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [
        {
          path: 'a.txt',
          expectedSha256: shaA,
          ops: [{ kind: 'str_replace', old_str: 'A\n', new_str: 'AAA\n' }],
        },
        {
          path: 'b.txt',
          expectedSha256: 'b'.repeat(64), // wrong sha — caught in phase 1
          ops: [{ kind: 'insert', after_line: 0, text: 'x' }],
        },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_STALE_SHA');
    // Both files unchanged — phase 1 SHA gate caught edit[1] before any apply
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'A\n');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'B\n');
  });
});
