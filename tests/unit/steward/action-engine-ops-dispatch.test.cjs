// Sprint 2.2.5 v0 — action-engine.applyEditsToFilesystem dispatch tests for
// the new ops-shape edit. Verifies path-safety + denylist gates fire before
// splice (ssot review reuse path), and that ops-shape edits produce
// previousContents in the result envelope so spec-verifier can read them.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ae = require('../../../bin/steward/_lib/action-engine.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aeops-${label}-`));
}

test.describe('action-engine.applyEditsToFilesystem — ops-shape dispatch', () => {
  test('append op grows file + previousContents captured', () => {
    const dir = tmp('append-disp');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'seed');
    const r = ae.applyEditsToFilesystem(
      [{ path: 'a.txt', ops: [{ kind: 'append', text: '+more' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.touchedFiles, ['a.txt']);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'seed+more');
    assert.equal(r.previousContents['a.txt'], 'seed');
    // size is captured for parity with legacy plumbing
    assert.equal(r.previousSizes['a.txt'], 4);
    // edits[] reflects ops shape, not legacy {replace_all}
    assert.deepEqual(r.edits[0].ops, [{ kind: 'append' }]);
  });

  test('create op makes new file + spec-verifier-friendly result shape', () => {
    const dir = tmp('create-disp');
    const r = ae.applyEditsToFilesystem(
      [{ path: 'docs/new.md', ops: [{ kind: 'create', content: '# Hello\n' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'docs/new.md'), 'utf8'), '# Hello\n');
    // No prior content for create
    assert.equal(r.previousContents['docs/new.md'], undefined);
  });

  test('ops-shape inherits NUL byte rejection from path-safety gate', () => {
    const dir = tmp('nul-byte');
    const r = ae.applyEditsToFilesystem(
      [{ path: 'a\0b.txt', ops: [{ kind: 'create', content: 'x' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_UNSAFE');
    assert.match(r.error, /NUL byte/);
  });

  test('ops-shape inherits absolute-path rejection', () => {
    const dir = tmp('abs-path');
    const r = ae.applyEditsToFilesystem(
      [{ path: '/etc/passwd', ops: [{ kind: 'create', content: 'x' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_UNSAFE');
    assert.match(r.error, /relative/);
  });

  test('ops-shape inherits traversal rejection', () => {
    const dir = tmp('traversal');
    const r = ae.applyEditsToFilesystem(
      [{ path: '../escape.txt', ops: [{ kind: 'create', content: 'x' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_UNSAFE');
    assert.match(r.error, /traversal/);
  });

  test('ops-shape inherits denylist rejection (.env)', () => {
    const dir = tmp('denylist-env');
    const r = ae.applyEditsToFilesystem(
      [{ path: '.env', ops: [{ kind: 'create', content: 'SECRET=1' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_DENYLISTED');
  });

  test('ops-shape inherits denylist rejection (bin/steward self)', () => {
    const dir = tmp('denylist-self');
    const r = ae.applyEditsToFilesystem(
      [{ path: 'bin/steward/execute.cjs', ops: [{ kind: 'append', text: '// hax' }] }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_DENYLISTED');
  });

  test('legacy {path, content, replace_all} still works (backward-compat)', () => {
    const dir = tmp('legacy');
    fs.writeFileSync(path.join(dir, 'legacy.txt'), 'old');
    const r = ae.applyEditsToFilesystem(
      [{ path: 'legacy.txt', content: 'new', replace_all: true }],
      { repoRoot: dir },
    );
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'legacy.txt'), 'utf8'), 'new');
    assert.equal(r.edits[0].replace_all, true);
  });

  test('mixed batch: ops + legacy in same edits[]', () => {
    const dir = tmp('mixed');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A');
    const r = ae.applyEditsToFilesystem(
      [
        { path: 'a.txt', ops: [{ kind: 'append', text: '+X' }] },
        { path: 'b.txt', content: 'created via legacy' },
      ],
      { repoRoot: dir },
    );
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'A+X');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'created via legacy');
  });

  test('per-edit ops-batch is atomic (multi-op within one edit rolls back)', () => {
    // splice.applyOps atomicity is per call — within ONE edit's ops[] array,
    // all-or-none. Cross-edit (multi-edit batch) atomicity is a v1+ goal,
    // matching legacy applyEditsToFilesystem semantics where edits[k+1]
    // failure leaves edits[0..k] applied. This test verifies the per-edit
    // contract: ops[0] create succeeds + ops[1] create on existing path fails
    // → entire edit rolls back, file does NOT exist.
    const dir = tmp('per-edit-atomic');
    fs.writeFileSync(path.join(dir, 'preexisting.txt'), 'PRE');
    const r = ae.applyEditsToFilesystem(
      [
        {
          path: 'new1.md',
          ops: [
            { kind: 'create', content: 'first' },
            { kind: 'append', text: 'second' },
            // Force failure: append onto a path that doesn't exist as part of the same edit
            // is fine because previousExists tracks state mid-transaction. Use create
            // collision as a guaranteed failure trigger from a second edit instead.
          ],
        },
      ],
      { repoRoot: dir },
    );
    // The single-edit case actually succeeds (multi-op create+append works).
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'new1.md'), 'utf8'), 'firstsecond');

    // Now test the actual "ops within one edit fail mid-batch" case: create + append
    // where the create collides.
    const dir2 = tmp('per-edit-fail');
    fs.writeFileSync(path.join(dir2, 'collide.txt'), 'EXISTING');
    const r2 = ae.applyEditsToFilesystem(
      [
        {
          path: 'collide.txt',
          ops: [
            { kind: 'append', text: '+more' },
            { kind: 'create', content: 'will-fail' }, // collides — but only after append succeeded
          ],
        },
      ],
      { repoRoot: dir2 },
    );
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'EDIT_OP_TARGET_EXISTS');
    // collide.txt MUST be back to its pre-edit state (rolled back from append+create)
    assert.equal(fs.readFileSync(path.join(dir2, 'collide.txt'), 'utf8'), 'EXISTING');
  });

  test('cross-edit failure: edit[0] persists when edit[1] fails (matches legacy semantics)', () => {
    // Documenting current v0 behavior: cross-edit atomicity is NOT provided.
    // edit[0] succeeds and persists; edit[1] failure surfaces but doesn't roll
    // back edit[0]. v1+ may add cross-edit batching; until then, callers should
    // emit one edit per recommendation (which is what LLMs do today).
    const dir = tmp('cross-edit');
    fs.writeFileSync(path.join(dir, 'collide.txt'), 'EXISTING');
    const r = ae.applyEditsToFilesystem(
      [
        { path: 'new1.md', ops: [{ kind: 'create', content: 'first' }] },
        { path: 'collide.txt', ops: [{ kind: 'create', content: 'will-fail' }] },
      ],
      { repoRoot: dir },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EDIT_OP_TARGET_EXISTS');
    // edit[0] persists — same as legacy semantics
    assert.equal(fs.readFileSync(path.join(dir, 'new1.md'), 'utf8'), 'first');
    // collide.txt unchanged
    assert.equal(fs.readFileSync(path.join(dir, 'collide.txt'), 'utf8'), 'EXISTING');
  });
});
