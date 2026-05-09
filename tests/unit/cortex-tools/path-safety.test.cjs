'use strict';

// Sprint 2.9 R2 hardening — _lib/path-safety.cjs tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isWithinCwd,
  isWithinCwdLexical,
  assertPathSafe,
  hasNulByte,
  isWindowsDeviceOrUnc,
  IS_WINDOWS,
} = require('../../../bin/cortex/tools/_lib/path-safety.cjs');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cx-pathsafe-${prefix}-`)));
}

describe('hasNulByte', () => {
  test('detects NUL', () => {
    assert.equal(hasNulByte('foo\0bar'), true);
    assert.equal(hasNulByte('plain'), false);
    assert.equal(hasNulByte(null), false);
    assert.equal(hasNulByte(123), false);
  });
});

describe('isWindowsDeviceOrUnc', () => {
  if (IS_WINDOWS) {
    test('detects \\\\?\\ device prefix', () => {
      assert.equal(isWindowsDeviceOrUnc('\\\\?\\C:\\foo'), true);
    });
    test('detects \\\\.\\ device prefix', () => {
      assert.equal(isWindowsDeviceOrUnc('\\\\.\\C:'), true);
    });
    test('detects UNC \\\\server\\share', () => {
      assert.equal(isWindowsDeviceOrUnc('\\\\server\\share\\foo'), true);
    });
    test('does not match plain absolute', () => {
      assert.equal(isWindowsDeviceOrUnc('C:\\foo'), false);
    });
  } else {
    test('returns false on non-Windows', () => {
      assert.equal(isWindowsDeviceOrUnc('//foo/bar'), false);
    });
  }
});

describe('isWithinCwd — target mode', () => {
  test('exact cwd match', () => {
    const dir = tmpDir('exact');
    assert.equal(isWithinCwd(dir, dir), true);
  });

  test('child path inside cwd', () => {
    const dir = tmpDir('child');
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'x');
    assert.equal(isWithinCwd(file, dir), true);
  });

  test('sibling path outside cwd refused', () => {
    const dir = tmpDir('sibling');
    const outside = path.resolve(dir, '..', 'sibling-evil.txt');
    fs.writeFileSync(outside, 'x');
    try {
      assert.equal(isWithinCwd(outside, dir), false);
    } finally {
      fs.unlinkSync(outside);
    }
  });

  test('Sprint 2.9 R2 fix: missing target inside cwd → walks up to existing ancestor (returns true)', () => {
    const dir = tmpDir('enoent');
    const missing = path.join(dir, 'never-exists.txt');
    // Target mode walks up if ENOENT; parent dir IS cwd so containment holds.
    // Caller surfaces ENOENT from their own stat call — that's their concern.
    assert.equal(isWithinCwd(missing, dir), true);
  });

  test('Sprint 2.9 R2 fix: missing target outside cwd → fail-closed (false)', () => {
    const dir = tmpDir('enoent-outside');
    const outside = path.resolve(dir, '..', 'never-exists.txt');
    // Walk-up resolves to parent of dir, which is outside cwd → false.
    assert.equal(isWithinCwd(outside, dir), false);
  });

  test('relative path refused', () => {
    assert.equal(isWithinCwd('relative.txt', '/tmp'), false);
  });

  test('NUL byte refused', () => {
    assert.equal(isWithinCwd('/tmp/foo\0bar', '/tmp'), false);
  });
});

describe('isWithinCwd — parent mode (write)', () => {
  test('parent dir exists + target may not', () => {
    const dir = tmpDir('parent-mode');
    const newFile = path.join(dir, 'sub', 'new.txt');
    // sub doesn't exist; resolves up to dir which is the cwd.
    assert.equal(isWithinCwd(newFile, dir, { mode: 'parent' }), true);
  });

  test('parent traverses outside cwd refused', () => {
    const dir = tmpDir('parent-traverse');
    const outside = path.resolve(dir, '..', 'evil.txt');
    assert.equal(isWithinCwd(outside, dir, { mode: 'parent' }), false);
  });
});

describe('isWithinCwdLexical', () => {
  test('relative refused', () => {
    assert.equal(isWithinCwdLexical('foo', '/tmp'), false);
  });

  test('exact cwd match', () => {
    const dir = tmpDir('lex-exact');
    assert.equal(isWithinCwdLexical(dir, dir), true);
  });

  test('`..` segments resolved correctly', () => {
    const dir = tmpDir('lex-dotdot');
    const traversal = path.join(dir, 'sub', '..', '..', 'evil.txt');
    // Lexically resolves to dir/../evil.txt → outside cwd.
    assert.equal(isWithinCwdLexical(traversal, dir), false);
  });
});

describe('assertPathSafe', () => {
  test('returns path on success', () => {
    const dir = tmpDir('assert-ok');
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'x');
    const r = assertPathSafe(file, dir, 'TOOL_X', { mode: 'target' });
    assert.equal(r, file);
  });

  test('throws TOOL_X_PATH_INVALID on null', () => {
    assert.throws(
      () => assertPathSafe(null, '/tmp', 'TOOL_X'),
      (err) => err.code === 'TOOL_X_PATH_INVALID',
    );
  });

  test('throws TOOL_X_PATH_NOT_ABSOLUTE on relative', () => {
    assert.throws(
      () => assertPathSafe('relative.txt', '/tmp', 'TOOL_X'),
      (err) => err.code === 'TOOL_X_PATH_NOT_ABSOLUTE',
    );
  });

  test('throws TOOL_X_PATH_INVALID on NUL', () => {
    assert.throws(
      () => assertPathSafe('/tmp/foo\0bar', '/tmp', 'TOOL_X'),
      (err) => err.code === 'TOOL_X_PATH_INVALID',
    );
  });

  test('throws TOOL_X_PATH_TRAVERSAL on outside-cwd', () => {
    const dir = tmpDir('assert-traverse');
    const outside = path.resolve(dir, '..', 'evil.txt');
    fs.writeFileSync(outside, 'x');
    try {
      assert.throws(
        () => assertPathSafe(outside, dir, 'TOOL_X', { mode: 'target' }),
        (err) => err.code === 'TOOL_X_PATH_TRAVERSAL',
      );
    } finally {
      fs.unlinkSync(outside);
    }
  });
});
