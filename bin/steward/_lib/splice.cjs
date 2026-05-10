// splice.cjs — Sprint 2.2.5 v0: position-aware file edit primitive.
//
// Provides 2 ops in v0 (append + create); v1 will add str_replace + insert
// once v0 dogfood lessons land. v2 (Sprint 2.2.6) will add delete_file with
// quarantine pattern.
//
// Contract:
//   - Called by applyEditsToFilesystem AFTER path-safety + isDenylistedPath
//     gates have run. splice.cjs trusts the caller to deliver vetted edits;
//     it does NOT re-implement path validation (ssot review reuse path).
//   - Symlinks are refused via fs.lstatSync at this layer (security
//     CRITICAL-3 — symlink TOCTOU not caught by lexical path.relative
//     containment in caller).
//   - Atomicity: snapshot every previousContents up front, attempt all ops,
//     on any failure write all snapshots back. If rollback itself fails,
//     return haltRecommended:true so caller writes STEWARD_HALT.
//
// Error code namespace (unified per ssot review):
//   EDIT_OP_KIND_UNKNOWN     — op.kind not in SPLICE_KINDS
//   EDIT_OP_MISSING_FIELD    — op missing required field for its kind
//   EDIT_OP_TYPE_MISMATCH    — op field has wrong type
//   EDIT_OP_EMPTY_PAYLOAD    — text/content is empty string (forbidden)
//   EDIT_OPS_EMPTY           — edit.ops is missing or empty array
//   EDIT_OP_SYMLINK_REFUSED  — target path is a symbolic link
//   EDIT_OP_TARGET_IS_DIR    — target path resolves to a directory
//   EDIT_OP_TARGET_EXISTS    — create op target already exists
//   EDIT_OP_TARGET_MISSING   — append op target does not exist
//   EDIT_OP_READ_ERROR       — cannot read file for snapshot capture
//   EDIT_OP_LSTAT_ERROR      — lstat failed with a non-ENOENT error
//   EDIT_OP_APPLY_FAILED     — op application failed mid-loop
//   EDIT_OP_ROLLBACK_FAILED  — apply failed AND rollback also failed → STEWARD_HALT

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SPLICE_KINDS = Object.freeze(['append', 'create']);

function validateOp(op) {
  if (!op || typeof op !== 'object') {
    return { ok: false, code: 'EDIT_OP_TYPE_MISMATCH', error: 'op must be an object' };
  }
  if (typeof op.kind !== 'string') {
    return { ok: false, code: 'EDIT_OP_TYPE_MISMATCH', error: 'op.kind must be a string' };
  }
  if (!SPLICE_KINDS.includes(op.kind)) {
    return {
      ok: false,
      code: 'EDIT_OP_KIND_UNKNOWN',
      error: `unknown op.kind: ${JSON.stringify(op.kind)} (v0 supports: ${SPLICE_KINDS.join(', ')})`,
    };
  }
  if (op.kind === 'append') {
    if (typeof op.text !== 'string') {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'append.text must be a string' };
    }
    if (op.text.length === 0) {
      return { ok: false, code: 'EDIT_OP_EMPTY_PAYLOAD', error: 'append.text must not be empty' };
    }
  } else if (op.kind === 'create') {
    if (typeof op.content !== 'string') {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'create.content must be a string' };
    }
    if (op.content.length === 0) {
      return { ok: false, code: 'EDIT_OP_EMPTY_PAYLOAD', error: 'create.content must not be empty' };
    }
  }
  return { ok: true };
}

function lstatGuard(fullPath) {
  let lstat;
  try {
    lstat = fs.lstatSync(fullPath);
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, exists: false };
    return {
      ok: false,
      code: 'EDIT_OP_LSTAT_ERROR',
      error: `lstat failed for ${fullPath}: ${err.message}`,
    };
  }
  if (lstat.isSymbolicLink()) {
    return {
      ok: false,
      code: 'EDIT_OP_SYMLINK_REFUSED',
      error: `path is a symbolic link: ${fullPath}`,
    };
  }
  if (lstat.isDirectory()) {
    return {
      ok: false,
      code: 'EDIT_OP_TARGET_IS_DIR',
      error: `path resolves to a directory: ${fullPath}`,
    };
  }
  return { ok: true, exists: lstat.isFile() };
}

// Apply edit_ops[] across a set of edits with all-or-none semantics.
//
// edits: [{ path, ops: [{ kind, ... }] }]
// Returns:
//   { ok: true, touchedFiles, previousContents }
//   { ok: false, code, error, haltRecommended? }
function applyOps({ repoRoot, edits }) {
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, code: 'EDIT_OPS_EMPTY', error: 'edits array missing or empty' };
  }

  const touched = [];
  const previousContents = {};
  const previousExists = {};

  // Phase 1: validate every op + capture pre-state for every targeted path.
  // No filesystem mutation in this phase.
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') {
      return { ok: false, code: 'EDIT_OP_TYPE_MISMATCH', error: 'edit must be an object' };
    }
    if (typeof edit.path !== 'string' || edit.path.length === 0) {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'edit.path must be a non-empty string' };
    }
    if (!Array.isArray(edit.ops) || edit.ops.length === 0) {
      return { ok: false, code: 'EDIT_OPS_EMPTY', error: `edit.ops missing or empty for ${edit.path}` };
    }
    for (const op of edit.ops) {
      const v = validateOp(op);
      if (!v.ok) return v;
    }

    const fullPath = path.resolve(repoRoot, edit.path);
    const guard = lstatGuard(fullPath);
    if (!guard.ok) return guard;

    if (guard.exists) {
      try {
        previousContents[edit.path] = fs.readFileSync(fullPath, 'utf8');
        previousExists[edit.path] = true;
      } catch (err) {
        return {
          ok: false,
          code: 'EDIT_OP_READ_ERROR',
          error: `cannot read pre-edit content for ${edit.path}: ${err.message}`,
        };
      }
    } else {
      previousExists[edit.path] = false;
    }
  }

  // Phase 2: apply ops. On any failure, restore every path that was touched
  // back to its previousContents (or unlink if it didn't exist before).
  const dirty = []; // paths that have been written to in this run
  for (const edit of edits) {
    const fullPath = path.resolve(repoRoot, edit.path);
    try {
      for (const op of edit.ops) {
        if (op.kind === 'append') {
          if (!previousExists[edit.path]) {
            throw Object.assign(
              new Error(`append target does not exist: ${edit.path} (use create instead)`),
              { code: 'EDIT_OP_TARGET_MISSING' },
            );
          }
          fs.appendFileSync(fullPath, op.text, 'utf8');
        } else if (op.kind === 'create') {
          if (previousExists[edit.path]) {
            throw Object.assign(
              new Error(`create target already exists: ${edit.path}`),
              { code: 'EDIT_OP_TARGET_EXISTS' },
            );
          }
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, op.content, 'utf8');
          // Mark as exists so subsequent ops in same edit (e.g. create+append)
          // see consistent state mid-transaction.
          previousExists[edit.path] = true;
        }
        if (!dirty.includes(edit.path)) dirty.push(edit.path);
      }
      if (!touched.includes(edit.path)) touched.push(edit.path);
    } catch (err) {
      // Rollback every dirty path
      for (const relPath of dirty) {
        const full = path.resolve(repoRoot, relPath);
        try {
          if (previousContents[relPath] !== undefined) {
            fs.writeFileSync(full, previousContents[relPath], 'utf8');
          } else {
            try { fs.unlinkSync(full); } catch (unlinkErr) {
              if (unlinkErr.code !== 'ENOENT') throw unlinkErr;
            }
          }
        } catch (rollbackErr) {
          return {
            ok: false,
            code: 'EDIT_OP_ROLLBACK_FAILED',
            error: `op failed: ${err.message}; rollback of ${relPath} also failed: ${rollbackErr.message}`,
            haltRecommended: true,
          };
        }
      }
      return {
        ok: false,
        code: err.code || 'EDIT_OP_APPLY_FAILED',
        error: err.message,
      };
    }
  }

  return { ok: true, touchedFiles: touched, previousContents };
}

module.exports = {
  SPLICE_KINDS,
  validateOp,
  lstatGuard,
  applyOps,
};
