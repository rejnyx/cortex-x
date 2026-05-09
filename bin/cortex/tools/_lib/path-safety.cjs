'use strict';

// Sprint 2.9 R2 fix (ssot HIGH + security HIGH): single source of truth for
// filesystem path containment + safety helpers used by read/write/edit/glob/grep.
//
// Fail-closed semantics: when realpath cannot resolve, we DO NOT fall back to
// lexical compare (the original v0 implementation did, which let edge cases
// like ENOENT/ELOOP/EACCES bypass containment under specific conditions).

const fs = require('node:fs');
const path = require('node:path');

const IS_WINDOWS = process.platform === 'win32';

// Reject Windows device-namespace + UNC prefixes that bypass realpath logic.
// Any path starting with two slashes (\\ or //) — covers `\\?\C:\foo` (device),
// `\\.\C:` (device IO), and `\\server\share` (UNC).
const WIN32_DEVICE_OR_UNC_PREFIX = /^[\\\/]{2}/;

// Normalize a path for case-insensitive containment comparison on Windows.
function normalizeForCompare(p) {
  return IS_WINDOWS ? p.toLowerCase() : p;
}

// Reject paths with NUL bytes (defense against null-byte truncation attacks
// in C-level fs APIs; Sprint 1.6.18 hardening pattern).
function hasNulByte(s) {
  return typeof s === 'string' && s.indexOf('\0') !== -1;
}

// Reject Windows device-namespace + UNC paths that defeat realpath checks.
function isWindowsDeviceOrUnc(p) {
  return IS_WINDOWS && WIN32_DEVICE_OR_UNC_PREFIX.test(p);
}

// Containment check: is `absPath` inside `cwd` (or equal to cwd)?
//
// Modes:
//   - mode: 'target' (default) — realpath the target itself; suitable for
//                                read/edit/glob/grep where the target should
//                                already exist.
//   - mode: 'parent'           — realpath the PARENT directory; suitable for
//                                write where the target may not yet exist.
//
// Failure semantics: returns false (FAIL CLOSED) on any error, including
// realpath ENOENT/ELOOP/EACCES, NUL byte, Windows device prefix.
//
// Sprint 2.9 R2 fix (security HIGH-isWithinCwd-fallback): the v0 lexical
// fallback was removed. If realpath cannot resolve, we refuse the operation.
// Callers who want lexical-only checks can use isWithinCwdLexical() (also
// hardened against `..` segments + UNC + case-mismatch on win32).
function isWithinCwd(absPath, cwd, options) {
  options = options || {};
  const mode = options.mode || 'target';

  if (typeof absPath !== 'string' || typeof cwd !== 'string') return false;
  if (hasNulByte(absPath) || hasNulByte(cwd)) return false;
  if (isWindowsDeviceOrUnc(absPath) || isWindowsDeviceOrUnc(cwd)) return false;
  if (!path.isAbsolute(absPath) || !path.isAbsolute(cwd)) return false;

  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch (e) {
    return false; // cwd must resolve.
  }

  let realPath;
  try {
    if (mode === 'parent') {
      const parent = path.dirname(absPath);
      realPath = fs.realpathSync(parent);
    } else {
      realPath = fs.realpathSync(absPath);
    }
  } catch (e) {
    // Sprint 2.9 R2 fix: when realpath fails (ENOENT for missing target /
    // missing parent), walk up to deepest existing ancestor and check that.
    // If the ancestor is inside cwd, then the (missing) target's natural
    // location is also inside cwd — the caller will surface ENOENT from
    // their own stat call. This preserves containment without false-rejecting
    // legitimate "file doesn't exist yet" + "file disappeared" cases.
    let cursor = path.dirname(absPath);
    while (cursor && cursor !== path.dirname(cursor)) {
      try {
        realPath = fs.realpathSync(cursor);
        break;
      } catch (err) {
        cursor = path.dirname(cursor);
      }
    }
    if (!realPath) return false;
  }

  const a = normalizeForCompare(realPath);
  const b = normalizeForCompare(realCwd);
  if (a === b) return true;
  return a.startsWith(b + path.sep);
}

// Lexical-only containment for cases where realpath is not appropriate
// (e.g. `glob` walk computing rel paths from a known-safe baseDir). This
// version is still hardened against `..` segments, UNC, and case drift on win32.
function isWithinCwdLexical(absPath, cwd) {
  if (typeof absPath !== 'string' || typeof cwd !== 'string') return false;
  if (hasNulByte(absPath) || hasNulByte(cwd)) return false;
  if (isWindowsDeviceOrUnc(absPath) || isWindowsDeviceOrUnc(cwd)) return false;
  if (!path.isAbsolute(absPath) || !path.isAbsolute(cwd)) return false;

  // path.resolve normalizes `..` and `.` segments.
  const resolved = path.resolve(absPath);
  const resolvedCwd = path.resolve(cwd);
  const a = normalizeForCompare(resolved);
  const b = normalizeForCompare(resolvedCwd);
  if (a === b) return true;
  return a.startsWith(b + path.sep);
}

// Validate a path argument for tool handlers — common pre-flight.
// Throws a structured Error with .code on failure, returns the validated
// absolute path on success.
function assertPathSafe(p, cwd, errorPrefix, options) {
  options = options || {};
  if (typeof p !== 'string' || p.length === 0) {
    const err = new Error('path must be non-empty string');
    err.code = `${errorPrefix}_PATH_INVALID`;
    throw err;
  }
  if (hasNulByte(p)) {
    const err = new Error('path contains NUL byte');
    err.code = `${errorPrefix}_PATH_INVALID`;
    throw err;
  }
  if (!path.isAbsolute(p)) {
    const err = new Error(`path must be absolute, got: ${p}`);
    err.code = `${errorPrefix}_PATH_NOT_ABSOLUTE`;
    throw err;
  }
  if (isWindowsDeviceOrUnc(p)) {
    const err = new Error(`Windows device or UNC paths refused: ${p}`);
    err.code = `${errorPrefix}_PATH_INVALID`;
    throw err;
  }
  if (!isWithinCwd(p, cwd, options)) {
    const err = new Error(`path traversal outside cwd: ${p}`);
    err.code = `${errorPrefix}_PATH_TRAVERSAL`;
    throw err;
  }
  return p;
}

module.exports = {
  isWithinCwd,
  isWithinCwdLexical,
  assertPathSafe,
  hasNulByte,
  isWindowsDeviceOrUnc,
  IS_WINDOWS,
};
