// splice.cjs — Sprint 2.2.5 v0+v1: position-aware file edit primitive.
//
// v0 (shipped 2026-05-10): append + create
// v1 (shipped 2026-05-10): + str_replace + insert
// v2 (Sprint 2.2.6 deferred): + delete_file with quarantine pattern
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
// v1 safety contracts:
//   - str_replace + insert MUST carry expectedSha256 on the parent edit;
//     mismatch → EDIT_OP_STALE_SHA. SHA computed pre-edit on full file
//     content (post-BOM-strip).
//   - str_replace anchor MUST be unique (exactly one match) AND must touch
//     a line boundary (start at column 0 OR end at \n). Mid-line / mid-string-
//     literal anchors get EDIT_OP_ANCHOR_INSIDE_STRING when target is in a
//     self-protecting tier; warn-only elsewhere.
//   - LLM-as-code defense: insert.text / append.text / create.content /
//     str_replace.new_str scanned for shell-eval patterns when target file
//     is *.js|*.cjs|*.mjs|*.ts → EDIT_OP_LLM_CONTENT_DANGEROUS block.
//
// Error code namespace (unified per ssot review, EDIT_OP_* prefix):
//   EDIT_OP_KIND_UNKNOWN          — op.kind not in SPLICE_KINDS
//   EDIT_OP_MISSING_FIELD         — op missing required field for its kind
//   EDIT_OP_TYPE_MISMATCH         — op field has wrong type
//   EDIT_OP_EMPTY_PAYLOAD         — text/content is empty string (forbidden)
//   EDIT_OPS_EMPTY                — edit.ops is missing or empty array
//   EDIT_OP_SYMLINK_REFUSED       — target path is a symbolic link
//   EDIT_OP_TARGET_IS_DIR         — target path resolves to a directory
//   EDIT_OP_TARGET_EXISTS         — create op target already exists
//   EDIT_OP_TARGET_MISSING        — append/str_replace/insert target missing
//   EDIT_OP_READ_ERROR            — cannot read file for snapshot capture
//   EDIT_OP_LSTAT_ERROR           — lstat failed with a non-ENOENT error
//   EDIT_OP_APPLY_FAILED          — op application failed mid-loop
//   EDIT_OP_ROLLBACK_FAILED       — apply failed AND rollback failed → STEWARD_HALT
//   EDIT_OP_SHA_REQUIRED          — v1: str_replace/insert without expectedSha256
//   EDIT_OP_STALE_SHA             — v1: expectedSha256 != actual at apply time
//   EDIT_OP_ANCHOR_NOT_FOUND      — v1: str_replace old_str absent in pre-edit file
//   EDIT_OP_ANCHOR_AMBIGUOUS      — v1: str_replace old_str matches >1 location
//   EDIT_OP_ANCHOR_INSIDE_STRING  — v1: anchor doesn't touch a line boundary (block in self-protecting tier)
//   EDIT_OP_LINE_OUT_OF_RANGE     — v1: insert.after_line outside [0, lineCount]
//   EDIT_OP_LLM_CONTENT_DANGEROUS — v1: shell-eval pattern in LLM-emitted content for *.js|.cjs|.mjs|.ts

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SPLICE_KINDS = Object.freeze(['append', 'create', 'str_replace', 'insert']);

// File extensions where LLM-emitted content is executable / interpreted code.
// Patterns below trigger EDIT_OP_LLM_CONTENT_DANGEROUS for these target types.
const EXEC_EXTENSIONS = Object.freeze(['.js', '.cjs', '.mjs', '.ts', '.tsx']);

// Self-protecting tier — paths where anchor-must-touch-line-boundary is
// a block (not a warn). These are the modules whose denylist regex /
// security check / parser logic could be silently mutated via mid-string-
// literal anchor injection (Anthropic Git MCP CVE Jan 2026 precedent).
const SELF_PROTECTING_TIER = [
  /^bin\/steward\//,
  /^bin\/cortex\//,
  /^standards\//,
  /^\.github\//,
  /^profiles\//,
  /^prompts\//,
];

// Shell-eval / process-injection patterns that the LLM should NOT emit into
// .js/.cjs/.mjs/.ts files. Conservative — designed to catch obvious post-hoc
// injection; not a substitute for full static analysis.
const DANGEROUS_PATTERNS = [
  /require\(['"`]child_process['"`]\)/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\$\{process\.env\./,
  /\bspawn(?:Sync)?\s*\(/,
  /\bexec(?:Sync)?\s*\(\s*['"`]/,
];

function isInSelfProtectingTier(relPath) {
  const norm = String(relPath).replace(/\\/g, '/');
  return SELF_PROTECTING_TIER.some((re) => re.test(norm));
}

function targetIsExecutable(relPath) {
  const lower = String(relPath).toLowerCase();
  return EXEC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function scanForDangerousContent(content) {
  if (typeof content !== 'string' || content.length === 0) return null;
  for (const re of DANGEROUS_PATTERNS) {
    const m = re.exec(content);
    if (m) return { matched: m[0], index: m.index };
  }
  return null;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// Anchor "touches line boundary" when it starts at column 0 of some line OR
// ends at a newline character. Mid-line / mid-string-literal anchors do not.
// Used for str_replace's old_str.
function anchorTouchesLineBoundary(content, matchIndex, anchorLen) {
  if (matchIndex === 0) return true; // at start of file
  const prevChar = content.charAt(matchIndex - 1);
  if (prevChar === '\n') return true; // anchor starts a line
  const endIdx = matchIndex + anchorLen;
  if (endIdx >= content.length) return true; // anchor ends at EOF
  const endChar = content.charAt(endIdx);
  if (endChar === '\n') return true; // anchor ends at line break
  // anchor itself ends with newline (covers append-style anchors)
  if (anchorLen > 0 && content.charAt(endIdx - 1) === '\n') return true;
  return false;
}

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
      error: `unknown op.kind: ${JSON.stringify(op.kind)} (supports: ${SPLICE_KINDS.join(', ')})`,
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
  } else if (op.kind === 'str_replace') {
    if (typeof op.old_str !== 'string' || op.old_str.length === 0) {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'str_replace.old_str must be a non-empty string' };
    }
    if (typeof op.new_str !== 'string') {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'str_replace.new_str must be a string' };
    }
  } else if (op.kind === 'insert') {
    if (!Number.isInteger(op.after_line) || op.after_line < 0) {
      return { ok: false, code: 'EDIT_OP_TYPE_MISMATCH', error: 'insert.after_line must be a non-negative integer' };
    }
    if (typeof op.text !== 'string') {
      return { ok: false, code: 'EDIT_OP_MISSING_FIELD', error: 'insert.text must be a string' };
    }
    if (op.text.length === 0) {
      return { ok: false, code: 'EDIT_OP_EMPTY_PAYLOAD', error: 'insert.text must not be empty' };
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

// v1: validate that an edit's ops collectively meet the SHA + LLM-content
// safety bar. Called pre-apply so failures roll back before any FS mutation.
function validateEditSafety(edit, prevContent) {
  const needsSha = edit.ops.some((o) => o && (o.kind === 'str_replace' || o.kind === 'insert'));
  if (needsSha) {
    if (typeof edit.expectedSha256 !== 'string' || edit.expectedSha256.length !== 64) {
      return {
        ok: false,
        code: 'EDIT_OP_SHA_REQUIRED',
        error: `edit ${edit.path}: ops include str_replace/insert which require expectedSha256 (64-char hex)`,
      };
    }
    const actualSha = sha256(prevContent);
    if (actualSha !== edit.expectedSha256) {
      return {
        ok: false,
        code: 'EDIT_OP_STALE_SHA',
        error: `edit ${edit.path}: expectedSha256=${edit.expectedSha256.slice(0, 12)}... but file content sha=${actualSha.slice(0, 12)}... (file changed since LLM read)`,
      };
    }
  }

  const isExec = targetIsExecutable(edit.path);
  if (isExec) {
    for (const op of edit.ops) {
      let payload = '';
      if (op.kind === 'append' || op.kind === 'insert') payload = op.text;
      else if (op.kind === 'create') payload = op.content;
      else if (op.kind === 'str_replace') payload = op.new_str;
      const dangerous = scanForDangerousContent(payload);
      if (dangerous) {
        return {
          ok: false,
          code: 'EDIT_OP_LLM_CONTENT_DANGEROUS',
          error: `edit ${edit.path}: op kind=${op.kind} contains shell-eval / process-injection pattern ${JSON.stringify(dangerous.matched)} (target is executable code; pattern blocked unconditionally)`,
        };
      }
    }
  }

  return { ok: true };
}

// v1: per-op anchor + position checks for str_replace + insert. Called
// during apply phase against the (possibly mutated) running content.
function applyStrReplace(content, op, relPath) {
  const old = op.old_str;
  const idx = content.indexOf(old);
  if (idx === -1) {
    return {
      ok: false,
      code: 'EDIT_OP_ANCHOR_NOT_FOUND',
      error: `str_replace anchor not found in ${relPath}: ${JSON.stringify(old.slice(0, 80))}${old.length > 80 ? '...' : ''}`,
    };
  }
  const second = content.indexOf(old, idx + 1);
  if (second !== -1) {
    return {
      ok: false,
      code: 'EDIT_OP_ANCHOR_AMBIGUOUS',
      error: `str_replace anchor matches at multiple locations (idx=${idx} and ${second}+) in ${relPath}; anchor must be unique`,
    };
  }
  if (!anchorTouchesLineBoundary(content, idx, old.length)) {
    if (isInSelfProtectingTier(relPath)) {
      return {
        ok: false,
        code: 'EDIT_OP_ANCHOR_INSIDE_STRING',
        error: `str_replace anchor in self-protecting tier ${relPath} does not touch a line boundary; mid-line anchors are blocked here to prevent string-literal injection`,
      };
    }
    // outside self-protecting tier: warn (not yet wired to journal — v1.5 follow-up)
  }
  return {
    ok: true,
    newContent: content.slice(0, idx) + op.new_str + content.slice(idx + old.length),
  };
}

function applyInsert(content, op, relPath) {
  // Split preserving line endings — but we only need line count & insertion point.
  // Use the count of \n in the file. after_line: 0 = beginning; after_line: N = after the Nth \n.
  // For a file ending without a trailing newline, line count = (\n count) + 1.
  const newlineCount = (content.match(/\n/g) || []).length;
  const lineCount = content.length === 0 ? 0 : (content.endsWith('\n') ? newlineCount : newlineCount + 1);
  if (op.after_line > lineCount) {
    return {
      ok: false,
      code: 'EDIT_OP_LINE_OUT_OF_RANGE',
      error: `insert.after_line=${op.after_line} exceeds file line count ${lineCount} for ${relPath}`,
    };
  }

  let insertIdx;
  if (op.after_line === 0) {
    insertIdx = 0;
  } else {
    // find the index just after the (after_line-th) '\n'
    let pos = -1;
    for (let i = 0; i < op.after_line; i += 1) {
      pos = content.indexOf('\n', pos + 1);
      if (pos === -1) {
        // file doesn't have enough newlines — caller bound check above should
        // have caught this, but defend.
        if (i === op.after_line - 1) {
          // we're inserting after the last logical line which has no trailing \n
          insertIdx = content.length;
          break;
        }
        return {
          ok: false,
          code: 'EDIT_OP_LINE_OUT_OF_RANGE',
          error: `insert.after_line=${op.after_line} exceeds available newlines in ${relPath}`,
        };
      }
    }
    if (insertIdx === undefined) insertIdx = pos + 1;
  }

  // Ensure inserted text ends with \n if there's content after it (so we don't
  // glue the insertion into the next line). If at EOF, leave as-is — caller's
  // payload determines trailing newline policy.
  let payload = op.text;
  if (insertIdx < content.length && !payload.endsWith('\n')) {
    payload = payload + '\n';
  }
  return {
    ok: true,
    newContent: content.slice(0, insertIdx) + payload + content.slice(insertIdx),
  };
}

// Apply edit_ops[] across a set of edits with all-or-none semantics.
//
// edits: [{ path, ops: [{ kind, ... }], expectedSha256? }]
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

    // v1 safety gate: SHA check + LLM-content scan. Pre-apply so failures
    // bail out before any disk mutation.
    const safety = validateEditSafety(edit, previousContents[edit.path] || '');
    if (!safety.ok) return safety;
  }

  // Phase 2: apply ops. On any failure, restore every path that was touched
  // back to its previousContents (or unlink if it didn't exist before).
  const dirty = []; // paths that have been written to in this run
  for (const edit of edits) {
    const fullPath = path.resolve(repoRoot, edit.path);
    // Running content for this edit — mutated by str_replace / insert chains.
    let running = previousExists[edit.path] ? previousContents[edit.path] : '';
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
          running += op.text;
        } else if (op.kind === 'create') {
          if (previousExists[edit.path]) {
            throw Object.assign(
              new Error(`create target already exists: ${edit.path}`),
              { code: 'EDIT_OP_TARGET_EXISTS' },
            );
          }
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, op.content, 'utf8');
          previousExists[edit.path] = true;
          running = op.content;
        } else if (op.kind === 'str_replace') {
          if (!previousExists[edit.path]) {
            throw Object.assign(
              new Error(`str_replace target does not exist: ${edit.path}`),
              { code: 'EDIT_OP_TARGET_MISSING' },
            );
          }
          const r = applyStrReplace(running, op, edit.path);
          if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
          fs.writeFileSync(fullPath, r.newContent, 'utf8');
          running = r.newContent;
        } else if (op.kind === 'insert') {
          if (!previousExists[edit.path]) {
            throw Object.assign(
              new Error(`insert target does not exist: ${edit.path}`),
              { code: 'EDIT_OP_TARGET_MISSING' },
            );
          }
          const r = applyInsert(running, op, edit.path);
          if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code });
          fs.writeFileSync(fullPath, r.newContent, 'utf8');
          running = r.newContent;
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
  EXEC_EXTENSIONS,
  SELF_PROTECTING_TIER,
  DANGEROUS_PATTERNS,
  validateOp,
  lstatGuard,
  applyOps,
  // exported for tests
  sha256,
  anchorTouchesLineBoundary,
  scanForDangerousContent,
  isInSelfProtectingTier,
  targetIsExecutable,
};
