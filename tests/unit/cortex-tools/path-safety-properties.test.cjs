'use strict';

// Sprint 2.9.7c — path-safety property tests. Per Sprint 2.3 R1 §3.4
// recommendation: companion property tests for high-risk primitives.
// path-safety enforces filesystem-containment invariants — its
// security-critical correctness gates every file-touching tool.
//
// Already has unit-test coverage from Sprint 2.9. This file adds
// property-style invariants that span input categories (NUL bytes,
// UNC paths, device-namespace, traversal segments, mixed separators,
// case-folding on Windows). Hand-rolled, zero-deps.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ps = require('../../../bin/cortex/tools/_lib/path-safety.cjs');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cx-pathsafe-prop-${prefix}-`)));
}

describe('Sprint 2.9.7c — path-safety hasNulByte property invariants', () => {
  test('invariant: NUL byte detected at any position', () => {
    assert.equal(ps.hasNulByte('\0'), true);
    assert.equal(ps.hasNulByte('foo\0'), true);
    assert.equal(ps.hasNulByte('\0bar'), true);
    assert.equal(ps.hasNulByte('foo\0bar'), true);
    assert.equal(ps.hasNulByte('a/b/c\0'), true);
  });

  test('invariant: NUL-free strings return false', () => {
    const cases = ['', 'plain', 'a/b/c', 'C:\\Users\\david', '/home/x', 'file.cjs'];
    for (const s of cases) {
      assert.equal(ps.hasNulByte(s), false, `false for ${JSON.stringify(s)}`);
    }
  });

  test('invariant: non-string input returns false (defensive)', () => {
    for (const bad of [null, undefined, 0, 1, {}, [], true, NaN]) {
      assert.equal(ps.hasNulByte(bad), false, `false for ${JSON.stringify(bad)}`);
    }
  });
});

describe('Sprint 2.9.7c — isWindowsDeviceOrUnc property invariants', () => {
  test('invariant: any double-slash prefix is a device-or-UNC path on Windows', () => {
    if (!ps.IS_WINDOWS) return; // skip on POSIX
    const samples = [
      '\\\\?\\C:\\foo',          // device namespace
      '\\\\.\\C:\\foo',          // device IO
      '\\\\server\\share',       // UNC
      '//server/share',          // forward-slash UNC
      '\\\\?\\UNC\\server\\share', // long UNC
    ];
    for (const s of samples) {
      assert.equal(ps.isWindowsDeviceOrUnc(s), true, `must reject: ${s}`);
    }
  });

  test('invariant: plain absolute Windows paths are NOT device-or-UNC', () => {
    if (!ps.IS_WINDOWS) return;
    const samples = ['C:\\Users\\david', 'D:\\repos\\cortex-x', 'C:\\'];
    for (const s of samples) {
      assert.equal(ps.isWindowsDeviceOrUnc(s), false, `must accept: ${s}`);
    }
  });

  test('invariant: returns false on non-Windows platforms (no false positives)', () => {
    if (ps.IS_WINDOWS) return;
    // On POSIX, even `//foo/bar` is a legitimate path (per POSIX spec).
    assert.equal(ps.isWindowsDeviceOrUnc('//foo/bar'), false);
    assert.equal(ps.isWindowsDeviceOrUnc('/usr/local'), false);
  });
});

describe('Sprint 2.9.7c — isWithinCwd property invariants', () => {
  test('invariant: any path inside cwd ⇒ true', () => {
    const cwd = tmpDir('inside');
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'x');
    fs.mkdirSync(path.join(cwd, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'sub', 'b.txt'), 'y');
    assert.equal(ps.isWithinCwd(path.join(cwd, 'a.txt'), cwd), true);
    assert.equal(ps.isWithinCwd(path.join(cwd, 'sub', 'b.txt'), cwd), true);
    assert.equal(ps.isWithinCwd(cwd, cwd), true, 'exact cwd matches itself');
  });

  test('invariant: any sibling-dir path ⇒ false', () => {
    const cwd = tmpDir('sibling');
    const parent = path.dirname(cwd);
    const sibling = fs.mkdtempSync(path.join(parent, 'sibling-evil-'));
    try {
      assert.equal(ps.isWithinCwd(sibling, cwd), false);
      // Even files inside a sibling dir.
      fs.writeFileSync(path.join(sibling, 'evil.txt'), 'x');
      assert.equal(ps.isWithinCwd(path.join(sibling, 'evil.txt'), cwd), false);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  test('invariant: NUL byte in path ⇒ false (fail-closed)', () => {
    const cwd = tmpDir('nul');
    assert.equal(ps.isWithinCwd(cwd + '\0evil', cwd), false);
    assert.equal(ps.isWithinCwd(cwd, cwd + '\0evil'), false);
  });

  test('invariant: relative path ⇒ false', () => {
    const cwd = tmpDir('rel');
    assert.equal(ps.isWithinCwd('relative.txt', cwd), false);
    assert.equal(ps.isWithinCwd('../foo', cwd), false);
    assert.equal(ps.isWithinCwd('./foo', cwd), false);
  });

  test('invariant: non-string inputs ⇒ false', () => {
    const cwd = tmpDir('types');
    for (const bad of [null, undefined, 0, {}, [], true]) {
      assert.equal(ps.isWithinCwd(bad, cwd), false);
      assert.equal(ps.isWithinCwd(cwd, bad), false);
    }
  });

  test('invariant: parent mode allows non-existent target inside cwd', () => {
    const cwd = tmpDir('parent-mode');
    const newFile = path.join(cwd, 'never-exists', 'deep', 'file.txt');
    // Target doesn't exist; parent dir doesn't exist; neither does grandparent.
    // Walk-up should find cwd as deepest existing ancestor → true.
    assert.equal(ps.isWithinCwd(newFile, cwd, { mode: 'parent' }), true);
  });

  test('invariant: containment is transitive — parent dir inside cwd ⇒ all children inside cwd', () => {
    const cwd = tmpDir('transitive');
    const sub = path.join(cwd, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    // For any path inside `sub`, it's also inside `cwd`.
    for (const name of ['a.txt', 'b/c.txt', 'b/c/d/e.txt']) {
      const full = path.join(sub, name);
      // Ensure parent path exists for realpath.
      if (name.includes('/') || name.includes('\\')) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
      }
      fs.writeFileSync(full, 'x');
      assert.equal(ps.isWithinCwd(full, cwd), true, `transitive containment ${name}`);
    }
  });
});

describe('Sprint 2.9.7c — isWithinCwdLexical property invariants', () => {
  test('invariant: `..` segments resolved away — escape attempt detected', () => {
    const cwd = tmpDir('lex-dotdot');
    const escape = path.join(cwd, 'sub', '..', '..', 'evil.txt');
    // Resolves to one level above cwd → outside.
    assert.equal(ps.isWithinCwdLexical(escape, cwd), false);
  });

  test('invariant: `.` segments resolve to identity', () => {
    const cwd = tmpDir('lex-dot');
    const equiv = path.join(cwd, '.', 'a.txt');
    assert.equal(ps.isWithinCwdLexical(equiv, cwd), true);
  });

  test('invariant: relative paths refused at lexical level too', () => {
    assert.equal(ps.isWithinCwdLexical('foo', '/tmp'), false);
    assert.equal(ps.isWithinCwdLexical('../foo', '/tmp'), false);
  });
});

describe('Sprint 2.9.7c — assertPathSafe property invariants', () => {
  test('invariant: returns the path on success (identity on valid input)', () => {
    const cwd = tmpDir('assert-id');
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'x');
    const result = ps.assertPathSafe(path.join(cwd, 'a.txt'), cwd, 'TOOL_X', { mode: 'target' });
    assert.equal(result, path.join(cwd, 'a.txt'));
  });

  test('invariant: every error has .code property with TOOL_X_ prefix', () => {
    // Test the contract: assertPathSafe never throws bare Error — always
    // attaches a typed .code with the caller's prefix.
    const cwd = tmpDir('assert-codes');
    const cases = [
      [null, 'TOOL_X_PATH_INVALID'],
      ['', 'TOOL_X_PATH_INVALID'],
      ['relative.txt', 'TOOL_X_PATH_NOT_ABSOLUTE'],
      ['/tmp/foo\0bar', 'TOOL_X_PATH_INVALID'],
    ];
    for (const [input, expectedCode] of cases) {
      let caught = null;
      try {
        ps.assertPathSafe(input, cwd, 'TOOL_X');
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, `must throw for input ${JSON.stringify(input)}`);
      assert.equal(caught.code, expectedCode, `code for ${JSON.stringify(input)}`);
    }
  });

  test('invariant: path-traversal attempts always rejected with TOOL_X_PATH_TRAVERSAL', () => {
    const cwd = tmpDir('assert-traverse');
    const parent = path.dirname(cwd);
    const outside = fs.mkdtempSync(path.join(parent, 'outside-'));
    try {
      assert.throws(
        () => ps.assertPathSafe(outside, cwd, 'TOOL_X', { mode: 'target' }),
        (err) => err.code === 'TOOL_X_PATH_TRAVERSAL',
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('invariant: error code prefix is configurable per caller', () => {
    let caught;
    try {
      ps.assertPathSafe(null, '/tmp', 'TOOL_READ');
    } catch (e) { caught = e; }
    assert.ok(caught.code.startsWith('TOOL_READ_'), `prefix preserved: ${caught.code}`);

    try {
      ps.assertPathSafe(null, '/tmp', 'TOOL_BASH');
    } catch (e) { caught = e; }
    assert.ok(caught.code.startsWith('TOOL_BASH_'), `prefix preserved: ${caught.code}`);
  });
});
