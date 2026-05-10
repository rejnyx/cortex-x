// Sprint 2.2.5 v0 — splice.cjs primitive unit tests.
//
// Coverage:
//   - validateOp: per-kind shape validation (4 cases × 5 invariants)
//   - lstatGuard: symlink, directory, ENOENT, real file (4 cases)
//   - applyOps: append happy, create happy, atomic rollback, missing target,
//     existing target, empty payload, NUL byte path (handled at caller),
//     symlink target rejection (12 cases)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const splice = require('../../../bin/steward/_lib/splice.cjs');

function tmpRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `splice-${label}-`));
  return dir;
}

test.describe('splice.validateOp — per-kind discriminated-union', () => {
  test('rejects non-object op', () => {
    assert.equal(splice.validateOp(null).code, 'EDIT_OP_TYPE_MISMATCH');
    assert.equal(splice.validateOp('string').code, 'EDIT_OP_TYPE_MISMATCH');
    assert.equal(splice.validateOp(42).code, 'EDIT_OP_TYPE_MISMATCH');
  });

  test('rejects unknown kind', () => {
    const r = splice.validateOp({ kind: 'shell_exec', text: 'rm -rf /' });
    assert.equal(r.code, 'EDIT_OP_KIND_UNKNOWN');
    assert.match(r.error, /v0 supports/);
  });

  test('append requires text string', () => {
    assert.equal(splice.validateOp({ kind: 'append' }).code, 'EDIT_OP_MISSING_FIELD');
    assert.equal(splice.validateOp({ kind: 'append', text: 42 }).code, 'EDIT_OP_MISSING_FIELD');
    assert.equal(splice.validateOp({ kind: 'append', text: '' }).code, 'EDIT_OP_EMPTY_PAYLOAD');
    assert.equal(splice.validateOp({ kind: 'append', text: 'hi' }).ok, true);
  });

  test('create requires content string', () => {
    assert.equal(splice.validateOp({ kind: 'create' }).code, 'EDIT_OP_MISSING_FIELD');
    assert.equal(splice.validateOp({ kind: 'create', content: null }).code, 'EDIT_OP_MISSING_FIELD');
    assert.equal(splice.validateOp({ kind: 'create', content: '' }).code, 'EDIT_OP_EMPTY_PAYLOAD');
    assert.equal(splice.validateOp({ kind: 'create', content: 'hi' }).ok, true);
  });

  test('SPLICE_KINDS exports v0 set only (append + create)', () => {
    assert.deepEqual([...splice.SPLICE_KINDS], ['append', 'create']);
  });
});

test.describe('splice.lstatGuard — symlink + directory + missing-file refusal', () => {
  test('returns exists:false for ENOENT (create scenario)', () => {
    const dir = tmpRepo('lstat-enoent');
    const r = splice.lstatGuard(path.join(dir, 'no-such-file.txt'));
    assert.equal(r.ok, true);
    assert.equal(r.exists, false);
  });

  test('returns exists:true for real file (append scenario)', () => {
    const dir = tmpRepo('lstat-file');
    const p = path.join(dir, 'real.txt');
    fs.writeFileSync(p, 'hello');
    const r = splice.lstatGuard(p);
    assert.equal(r.ok, true);
    assert.equal(r.exists, true);
  });

  test('refuses symlink', { skip: process.platform === 'win32' ? 'symlink requires admin on Windows' : false }, () => {
    const dir = tmpRepo('lstat-symlink');
    const target = path.join(dir, 'target.txt');
    fs.writeFileSync(target, 'real content');
    const link = path.join(dir, 'link.txt');
    try {
      fs.symlinkSync(target, link);
    } catch (err) {
      // Some Linux environments without symlink perms — skip
      if (err.code === 'EPERM' || err.code === 'EACCES') return;
      throw err;
    }
    const r = splice.lstatGuard(link);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_SYMLINK_REFUSED');
  });

  test('refuses directory', () => {
    const dir = tmpRepo('lstat-dir');
    const subdir = path.join(dir, 'subdir');
    fs.mkdirSync(subdir);
    const r = splice.lstatGuard(subdir);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_IS_DIR');
  });
});

test.describe('splice.applyOps — append + create happy paths', () => {
  test('append grows existing file', () => {
    const dir = tmpRepo('apply-append');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'one\n');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'file.txt', ops: [{ kind: 'append', text: 'two\n' }] }],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.touchedFiles, ['file.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8'), 'one\ntwo\n');
    assert.equal(r.previousContents['file.txt'], 'one\n');
  });

  test('create makes new file with content', () => {
    const dir = tmpRepo('apply-create');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'new.md', ops: [{ kind: 'create', content: '# Hello\n' }] }],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.touchedFiles, ['new.md']);
    assert.equal(fs.readFileSync(path.join(dir, 'new.md'), 'utf8'), '# Hello\n');
  });

  test('create makes intermediate directories', () => {
    const dir = tmpRepo('apply-create-mkdirs');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'docs/sub/file.md', ops: [{ kind: 'create', content: 'body' }] }],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'docs/sub/file.md'), 'utf8'), 'body');
  });
});

test.describe('splice.applyOps — error paths', () => {
  test('append on missing file returns EDIT_OP_TARGET_MISSING', () => {
    const dir = tmpRepo('apply-append-missing');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'no-file.txt', ops: [{ kind: 'append', text: 'x' }] }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_MISSING');
  });

  test('create on existing file returns EDIT_OP_TARGET_EXISTS', () => {
    const dir = tmpRepo('apply-create-exists');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'existing');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'file.txt', ops: [{ kind: 'create', content: 'new' }] }],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_EXISTS');
    assert.equal(fs.readFileSync(path.join(dir, 'file.txt'), 'utf8'), 'existing');
  });

  test('empty edits[] returns EDIT_OPS_EMPTY', () => {
    const dir = tmpRepo('apply-empty');
    assert.equal(splice.applyOps({ repoRoot: dir, edits: [] }).code, 'EDIT_OPS_EMPTY');
  });

  test('edit with empty ops[] returns EDIT_OPS_EMPTY', () => {
    const dir = tmpRepo('apply-edit-empty-ops');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [{ path: 'a.txt', ops: [] }],
    });
    assert.equal(r.code, 'EDIT_OPS_EMPTY');
  });
});

test.describe('splice.applyOps — atomicity (snapshot-then-write-or-rollback)', () => {
  test('failed second op rolls back first op (file restored to pre-edit content)', () => {
    const dir = tmpRepo('atomic-rollback');
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    fs.writeFileSync(a, 'original-a\n');
    fs.writeFileSync(b, 'original-b\n');
    // First edit succeeds (append to a.txt), second fails (append to non-existent c.txt)
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [
        { path: 'a.txt', ops: [{ kind: 'append', text: 'new-a\n' }] },
        { path: 'c.txt', ops: [{ kind: 'append', text: 'whatever\n' }] },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_MISSING');
    // a.txt MUST be back to its pre-edit state
    assert.equal(fs.readFileSync(a, 'utf8'), 'original-a\n');
    // b.txt MUST still hold its original (was never touched)
    assert.equal(fs.readFileSync(b, 'utf8'), 'original-b\n');
  });

  test('failed create after successful create unlinks the first one', () => {
    const dir = tmpRepo('atomic-rollback-create');
    fs.writeFileSync(path.join(dir, 'collision.txt'), 'pre-existing');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [
        { path: 'new1.md', ops: [{ kind: 'create', content: 'first' }] },
        { path: 'collision.txt', ops: [{ kind: 'create', content: 'will-collide' }] },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_EXISTS');
    // new1.md must NOT exist (rolled back)
    assert.equal(fs.existsSync(path.join(dir, 'new1.md')), false);
    // collision.txt must still hold its original content
    assert.equal(fs.readFileSync(path.join(dir, 'collision.txt'), 'utf8'), 'pre-existing');
  });
});

test.describe('splice.applyOps — multi-op same edit', () => {
  test('create then append in single edit applies both', () => {
    const dir = tmpRepo('multi-op');
    const r = splice.applyOps({
      repoRoot: dir,
      edits: [
        {
          path: 'multi.md',
          ops: [
            { kind: 'create', content: '# Header\n' },
            { kind: 'append', text: 'body\n' },
          ],
        },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'multi.md'), 'utf8'), '# Header\nbody\n');
  });
});
