// Sprint 2.3.2 — backfillExpectedSha regression tests.
//
// Root cause (cortex-x nightly, runs 25851983569 … 26142925029, 7 days red):
// Sprint 2.2.5 v1.5 injects each referenced file's content + SHA-256 into the
// prompt and asks the LLM to copy the sha256 into its op's `expectedSha256`.
// deepseek-v4-flash dropped the field; splice.cjs rejected the plan with
// EDIT_OP_SHA_REQUIRED and the nightly stalled on recommendations.md item #3.
//
// backfillExpectedSha makes the engine own the field: for every ops-edit whose
// path the engine itself injected, it carries the engine-computed hash in
// directly. These tests pin that behaviour + the no-touch boundaries.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const engine = require('../../../bin/steward/_lib/action-engine.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bfsha-${label}-`));
}

function fixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return content;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('Sprint 2.3.2 — backfillExpectedSha happy path', () => {
  test('str_replace op missing expectedSha256 → back-filled with engine sha', () => {
    const dir = tmp('strrepl');
    const content = fixture(dir, 'src/foo.cjs', "const x = 1;\nmodule.exports = { x };\n");
    const body = 'Edit `src/foo.cjs` to rename x.';
    const editPlan = {
      edits: [
        { path: 'src/foo.cjs', ops: [{ kind: 'str_replace', old_str: 'const x = 1;', new_str: 'const x = 2;' }] },
      ],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['src/foo.cjs']);
    assert.deepEqual(r.unresolved, []);
    assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
  });

  test('insert op missing expectedSha256 → back-filled too', () => {
    const dir = tmp('insert');
    const content = fixture(dir, 'notes.md', '# Title\nline one\nline two\n');
    const body = 'Add a line to `notes.md`.';
    const editPlan = {
      edits: [{ path: 'notes.md', ops: [{ kind: 'insert', after_line: 1, text: 'inserted\n' }] }],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['notes.md']);
    assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
  });

  test('LLM-emitted wrong 64-hex SHA on an injected path → overwritten with engine sha', () => {
    const dir = tmp('wrongsha');
    const content = fixture(dir, 'src/bar.cjs', 'const y = 10;\n');
    const body = 'Edit `src/bar.cjs`.';
    const bogus = 'a'.repeat(64);
    const editPlan = {
      edits: [{
        path: 'src/bar.cjs',
        expectedSha256: bogus,
        ops: [{ kind: 'str_replace', old_str: 'const y = 10;', new_str: 'const y = 20;' }],
      }],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['src/bar.cjs']);
    assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
    assert.notEqual(editPlan.edits[0].expectedSha256, bogus);
  });

  test('edit already carrying the correct sha → not double-counted', () => {
    const dir = tmp('correct');
    const content = fixture(dir, 'src/baz.cjs', 'const z = 0;\n');
    const body = 'Edit `src/baz.cjs`.';
    const editPlan = {
      edits: [{
        path: 'src/baz.cjs',
        expectedSha256: sha256(content),
        ops: [{ kind: 'str_replace', old_str: 'const z = 0;', new_str: 'const z = 1;' }],
      }],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, []);
  });

  test('Windows-style + ./-prefixed edit.path normalize to the injected ref', () => {
    const dir = tmp('norm');
    const content = fixture(dir, 'src/win.cjs', 'const w = 1;\n');
    const body = 'Edit `src/win.cjs`.';
    for (const p of ['./src/win.cjs', 'src\\win.cjs']) {
      const editPlan = {
        edits: [{ path: p, ops: [{ kind: 'str_replace', old_str: 'const w = 1;', new_str: 'const w = 2;' }] }],
      };
      const r = engine.backfillExpectedSha(editPlan, body, dir);
      assert.deepEqual(r.backfilled, ['src/win.cjs'], `failed for ${p}`);
      assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
    }
  });
});

describe('Sprint 2.3.2 — backfillExpectedSha no-touch boundaries', () => {
  test('legacy content-shape edit (no ops) is left untouched', () => {
    const dir = tmp('legacy');
    fixture(dir, 'src/foo.cjs', 'old\n');
    const editPlan = { edits: [{ path: 'src/foo.cjs', content: 'new\n', replace_all: true }] };
    const r = engine.backfillExpectedSha(editPlan, 'Edit `src/foo.cjs`.', dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, []);
    assert.equal('expectedSha256' in editPlan.edits[0], false);
  });

  test('ops-edit with only append/create ops needs no sha → untouched', () => {
    const dir = tmp('appendonly');
    fixture(dir, 'log.md', '# Log\n');
    const editPlan = {
      edits: [{ path: 'log.md', ops: [{ kind: 'append', text: 'entry\n' }] }],
    };
    const r = engine.backfillExpectedSha(editPlan, 'Append to `log.md`.', dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, []);
    assert.equal('expectedSha256' in editPlan.edits[0], false);
  });

  test('ops-edit on a path NOT referenced in the body → unresolved, no sha set', () => {
    const dir = tmp('uninjected');
    fixture(dir, 'src/secret.cjs', 'const s = 1;\n');
    // body references a DIFFERENT file; secret.cjs was never injected.
    const editPlan = {
      edits: [{ path: 'src/secret.cjs', ops: [{ kind: 'str_replace', old_str: 'const s = 1;', new_str: 'const s = 2;' }] }],
    };
    const r = engine.backfillExpectedSha(editPlan, 'Edit `src/other.cjs`.', dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, ['src/secret.cjs']);
    assert.equal('expectedSha256' in editPlan.edits[0], false);
  });

  test('malformed / empty editPlan → empty result, no throw', () => {
    for (const bad of [null, undefined, {}, { edits: null }, { edits: [] }, 42, 'str']) {
      const r = engine.backfillExpectedSha(bad, 'body', os.tmpdir());
      assert.deepEqual(r, { backfilled: [], unresolved: [] });
    }
  });

  test('absent file referenced in body → ops-edit lands in unresolved', () => {
    const dir = tmp('absent');
    const editPlan = {
      edits: [{ path: 'src/ghost.cjs', ops: [{ kind: 'str_replace', old_str: 'a', new_str: 'b' }] }],
    };
    const r = engine.backfillExpectedSha(editPlan, 'Edit `src/ghost.cjs`.', dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, ['src/ghost.cjs']);
  });
});

describe('Sprint 2.3.2 — R2 review hardening', () => {
  test('./-prefixed reference in the action BODY still matches a plain edit.path', () => {
    const dir = tmp('dotbody');
    const content = fixture(dir, 'src/dot.cjs', 'const d = 1;\n');
    // Body uses a ./-prefixed backtick path — extractFileReferences keeps the
    // ./; backfill must normalize both sides identically to still match.
    const body = 'Edit `./src/dot.cjs` to bump d.';
    const editPlan = {
      edits: [{ path: 'src/dot.cjs', ops: [{ kind: 'str_replace', old_str: 'const d = 1;', new_str: 'const d = 2;' }] }],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['src/dot.cjs']);
    assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
  });

  test('non-string edit.path → reported once as "(missing path)", no throw, no coercion', () => {
    const dir = tmp('badpath');
    fixture(dir, 'src/ok.cjs', 'const o = 1;\n');
    const editPlan = {
      edits: [
        { path: ['src/ok.cjs'], ops: [{ kind: 'str_replace', old_str: 'a', new_str: 'b' }] },
        { path: 42, ops: [{ kind: 'insert', after_line: 0, text: 'x\n' }] },
      ],
    };
    const r = engine.backfillExpectedSha(editPlan, 'Edit `src/ok.cjs`.', dir);
    assert.deepEqual(r.backfilled, []);
    assert.deepEqual(r.unresolved, ['(missing path)']);
  });

  test('duplicate path across two ops-edits → back-filled path reported once', () => {
    const dir = tmp('dup');
    const content = fixture(dir, 'src/dup.cjs', 'const a = 1;\nconst b = 2;\n');
    const body = 'Edit `src/dup.cjs`.';
    const editPlan = {
      edits: [
        { path: 'src/dup.cjs', ops: [{ kind: 'str_replace', old_str: 'const a = 1;', new_str: 'const a = 9;' }] },
        { path: 'src/dup.cjs', ops: [{ kind: 'str_replace', old_str: 'const b = 2;', new_str: 'const b = 9;' }] },
      ],
    };
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['src/dup.cjs']);
    assert.equal(editPlan.edits[0].expectedSha256, sha256(content));
    assert.equal(editPlan.edits[1].expectedSha256, sha256(content));
  });
});

describe('Sprint 2.3.2 — back-filled plan applies cleanly end-to-end', () => {
  test('str_replace plan with no LLM sha → backfill → applyEditsToFilesystem ok', () => {
    const dir = tmp('e2e');
    fixture(dir, 'src/calc.cjs', 'function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n');
    const body = 'Fix the bug in `src/calc.cjs` — it subtracts instead of adds.';
    const editPlan = {
      edits: [{
        path: 'src/calc.cjs',
        ops: [{ kind: 'str_replace', old_str: '  return a - b;', new_str: '  return a + b;' }],
      }],
    };

    // Pre-condition: without the back-fill, splice rejects the plan.
    const before = engine.applyEditsToFilesystem(
      JSON.parse(JSON.stringify(editPlan.edits)), { repoRoot: dir },
    );
    assert.equal(before.ok, false);
    assert.equal(before.code, 'EDIT_OP_SHA_REQUIRED');

    // Back-fill, then apply for real.
    const r = engine.backfillExpectedSha(editPlan, body, dir);
    assert.deepEqual(r.backfilled, ['src/calc.cjs']);
    const after = engine.applyEditsToFilesystem(editPlan.edits, { repoRoot: dir });
    assert.equal(after.ok, true, after.error);
    assert.match(fs.readFileSync(path.join(dir, 'src/calc.cjs'), 'utf8'), /return a \+ b;/);
  });
});
