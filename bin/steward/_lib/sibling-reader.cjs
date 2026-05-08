// Sprint 2.7 — sibling-projects read-only file access helper.
//
// Wraps a manifest entry's root + paths_allowed + paths_denied into a
// constrained read-only filesystem facade. Defenses (R1 §5):
//   - All read operations resolve through fs.realpathSync — symlink escapes
//     blocked.
//   - paths_denied takes precedence over paths_allowed (deny-list wins).
//   - All mutation operations throw SIBLING_WRITE_ATTEMPTED + halt.
//   - Symlink loops surface as ELOOP and are caught.
//   - Files exceeding sizeBytesCap are skipped (DoS defense).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE_SIZE_CAP = 1 * 1024 * 1024; // 1 MB per file
const DEFAULT_FILE_COUNT_CAP = 5_000;
const DEFAULT_DEPTH_CAP = 12;

// Glob → regex (very simple, supports * and ** only).
// Sprint 2.7 R2 backlog: graduate to glob-match.cjs (Sprint 1.8.6) when its
// API stabilizes for cross-repo use. For now: hand-rolled, deny-list focus.
function globToRegex(pattern) {
  // Escape regex specials except *
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // ** matches any segments (including separators); * matches single segment
  const re = escaped
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  return new RegExp('^' + re + '$');
}

function matchesAnyGlob(relPath, patterns) {
  if (!patterns || !patterns.length) return false;
  const normalized = relPath.replace(/\\/g, '/');
  for (const p of patterns) {
    const norm = p.replace(/\\/g, '/');
    // Suffix-match for trailing-slash entries (e.g., "secrets/" matches subtree)
    if (norm.endsWith('/')) {
      if (normalized === norm.slice(0, -1) || normalized.startsWith(norm)) return true;
    } else {
      const re = globToRegex(norm);
      if (re.test(normalized)) return true;
      // Also test bare-name for patterns like ".env*" matching at any depth
      const segments = normalized.split('/');
      if (segments.some((s) => re.test(s))) return true;
    }
  }
  return false;
}

// Containment check: resolved path must be inside sibling.rootAbs.
function isContained(resolvedPath, rootAbs) {
  const rootResolved = path.resolve(rootAbs);
  const targetResolved = path.resolve(resolvedPath);
  if (targetResolved === rootResolved) return true;
  return targetResolved.startsWith(rootResolved + path.sep);
}

// Read a file from within a sibling's allow-list, with realpath containment +
// deny-list filter + size cap. Returns { ok, content|code, error }.
function readSiblingFile(sibling, relPath, opts = {}) {
  if (!sibling || !sibling.rootAbs) {
    return { ok: false, code: 'SIBLING_INVALID', error: 'sibling missing rootAbs' };
  }
  if (typeof relPath !== 'string' || !relPath) {
    return { ok: false, code: 'SIBLING_INVALID_PATH', error: 'relPath must be a non-empty string' };
  }
  // Reject absolute paths + traversal.
  if (path.isAbsolute(relPath) || relPath.includes('..')) {
    return { ok: false, code: 'SIBLING_INVALID_PATH', error: 'relPath must be repo-relative without ".." segments' };
  }
  // Allow-list check (prefix match).
  const normalized = relPath.replace(/\\/g, '/');
  const allowedHit = sibling.paths_allowed.some((p) => {
    const ap = p.replace(/\\/g, '/');
    if (ap.endsWith('/')) return normalized.startsWith(ap);
    return normalized === ap || normalized.startsWith(ap + '/');
  });
  if (!allowedHit) {
    return { ok: false, code: 'SIBLING_NOT_ALLOWLISTED', error: `${normalized} is not in paths_allowed` };
  }
  // Deny-list check (trumps allow).
  if (matchesAnyGlob(normalized, sibling.paths_denied)) {
    return { ok: false, code: 'SIBLING_DENIED_PATH', error: `${normalized} matched paths_denied` };
  }
  // Realpath containment (symlink escape defense).
  const target = path.join(sibling.rootAbs, normalized);
  let realTarget;
  try {
    realTarget = fs.realpathSync(target);
  } catch (err) {
    if (err.code === 'ELOOP' || err.code === 'ENAMETOOLONG') {
      return { ok: false, code: 'SIBLING_SYMLINK_LOOP', error: `${normalized}: ${err.code}` };
    }
    if (err.code === 'ENOENT') {
      return { ok: false, code: 'SIBLING_NOT_FOUND', error: `${normalized} does not exist` };
    }
    return { ok: false, code: 'SIBLING_REALPATH_FAILED', error: err.message };
  }
  if (!isContained(realTarget, sibling.rootAbs)) {
    return { ok: false, code: 'SIBLING_REALPATH_OUTSIDE_ROOT', error: `realpath ${realTarget} escapes ${sibling.rootAbs}` };
  }
  // Size cap.
  const sizeCap = opts.sizeBytesCap || DEFAULT_FILE_SIZE_CAP;
  let stat;
  try {
    stat = fs.statSync(realTarget);
  } catch (err) {
    return { ok: false, code: 'SIBLING_STAT_FAILED', error: err.message };
  }
  if (!stat.isFile()) {
    return { ok: false, code: 'SIBLING_NOT_A_FILE', error: `${normalized} is not a regular file` };
  }
  if (stat.size > sizeCap) {
    return { ok: false, code: 'SIBLING_FILE_TOO_LARGE', error: `${normalized} size ${stat.size} > cap ${sizeCap}` };
  }
  // Read.
  let content;
  try {
    content = fs.readFileSync(realTarget, 'utf8');
  } catch (err) {
    return { ok: false, code: 'SIBLING_READ_FAILED', error: err.message };
  }
  return { ok: true, content, size: stat.size, realPath: realTarget };
}

// List files within a sibling's allow-list (recursive, capped).
// Returns { ok, files: [{ relPath, size }], skipped: [...] }.
function listSiblingFiles(sibling, opts = {}) {
  if (!sibling || !sibling.rootAbs) {
    return { ok: false, code: 'SIBLING_INVALID', error: 'sibling missing rootAbs' };
  }
  const sizeCap = opts.sizeBytesCap || DEFAULT_FILE_SIZE_CAP;
  const fileCap = opts.fileCountCap || DEFAULT_FILE_COUNT_CAP;
  const depthCap = opts.depthCap || DEFAULT_DEPTH_CAP;
  const visited = new Set();
  const files = [];
  const skipped = [];

  function walk(absDir, relDir, depth) {
    if (depth > depthCap) return;
    if (files.length >= fileCap) return;
    let realDir;
    try { realDir = fs.realpathSync(absDir); } catch { return; }
    if (visited.has(realDir)) return;
    visited.add(realDir);
    if (!isContained(realDir, sibling.rootAbs)) return;

    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= fileCap) return;
      if (e.isSymbolicLink()) continue; // safety
      const childAbs = path.join(absDir, e.name);
      const childRel = relDir ? path.posix.join(relDir, e.name) : e.name;
      // Deny-list check first (trumps allow).
      if (matchesAnyGlob(childRel, sibling.paths_denied)) {
        skipped.push({ relPath: childRel, reason: 'denied' });
        continue;
      }
      if (e.isDirectory()) {
        walk(childAbs, childRel, depth + 1);
      } else if (e.isFile()) {
        // Allow-list check.
        const allowedHit = sibling.paths_allowed.some((p) => {
          const ap = p.replace(/\\/g, '/');
          if (ap.endsWith('/')) return childRel.startsWith(ap);
          return childRel === ap || childRel.startsWith(ap + '/');
        });
        if (!allowedHit) {
          skipped.push({ relPath: childRel, reason: 'not-allowed' });
          continue;
        }
        let stat;
        try { stat = fs.statSync(childAbs); } catch { continue; }
        if (stat.size > sizeCap) {
          skipped.push({ relPath: childRel, reason: 'too-large', size: stat.size });
          continue;
        }
        files.push({ relPath: childRel, size: stat.size });
      }
    }
  }

  walk(sibling.rootAbs, '', 0);
  return { ok: true, files, skipped };
}

// Validate that a proposed edit's path is in the CURRENT project's cwd (NOT
// in any sibling root). Used by execute.cjs spec-verifier hook to ensure
// pattern_transfer never writes to a sibling repo. Returns { ok, error? }.
function assertEditWithinCwd(editPath, cwd) {
  if (typeof editPath !== 'string' || !editPath) {
    return { ok: false, error: 'editPath must be a non-empty string' };
  }
  if (path.isAbsolute(editPath)) {
    return { ok: false, error: `editPath must be repo-relative, got absolute ${editPath}` };
  }
  if (editPath.includes('..')) {
    return { ok: false, error: `editPath contains ".." traversal: ${editPath}` };
  }
  // Compute the absolute target and ensure it's within cwd.
  const cwdAbs = path.resolve(cwd || process.cwd());
  const target = path.resolve(cwdAbs, editPath);
  if (!isContained(target, cwdAbs)) {
    return { ok: false, error: `editPath escapes cwd: ${editPath}` };
  }
  return { ok: true };
}

module.exports = {
  readSiblingFile,
  listSiblingFiles,
  assertEditWithinCwd,
  matchesAnyGlob,
  isContained,
  globToRegex,
  DEFAULT_FILE_SIZE_CAP,
  DEFAULT_FILE_COUNT_CAP,
  DEFAULT_DEPTH_CAP,
};
