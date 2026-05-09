'use strict';

// Sprint 2.9 — `edit` tool descriptor.
// Exact-string replacement in a file. Fails if old_string not found.
// destructiveHint=true (modifies file); idempotent only if replace_all=false
// AND old_string is unique pre-edit (caller's responsibility).

const fs = require('node:fs');

const { assertPathSafe } = require('./_lib/path-safety.cjs');
const { MAX_FILE_BYTES } = require('./_lib/limits.cjs');

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const target = assertPathSafe(args.path, cwd, 'TOOL_EDIT', { mode: 'target' });
  const oldString = args.old_string;
  const newString = args.new_string;
  const replaceAll = args.replace_all === true;

  if (typeof oldString !== 'string') {
    const err = new Error('old_string must be string');
    err.code = 'TOOL_EDIT_OLD_STRING_INVALID';
    throw err;
  }
  if (typeof newString !== 'string') {
    const err = new Error('new_string must be string');
    err.code = 'TOOL_EDIT_NEW_STRING_INVALID';
    throw err;
  }
  if (oldString === newString) {
    const err = new Error('old_string and new_string must differ');
    err.code = 'TOOL_EDIT_NOOP';
    throw err;
  }
  if (oldString.length === 0) {
    const err = new Error('old_string must be non-empty (use write tool to create file)');
    err.code = 'TOOL_EDIT_OLD_STRING_EMPTY';
    throw err;
  }

  // Sprint 2.9 R2 fix (security TOCTOU + edge HIGH): atomic open with
  // O_NOFOLLOW (POSIX) to prevent symlink-swap race between lstat and
  // readFileSync. On Windows we still fall back to lstat+write.
  if (!fs.existsSync(target)) {
    const err = new Error(`file not found: ${target}`);
    err.code = 'TOOL_EDIT_NOT_FOUND';
    throw err;
  }
  const lst = fs.lstatSync(target);
  if (lst.isSymbolicLink()) {
    const err = new Error(`refuse to edit through symlink: ${target}`);
    err.code = 'TOOL_EDIT_SYMLINK_REJECTED';
    throw err;
  }
  if (lst.isDirectory()) {
    const err = new Error(`target is a directory: ${target}`);
    err.code = 'TOOL_EDIT_TARGET_IS_DIRECTORY';
    throw err;
  }
  if (!lst.isFile()) {
    const err = new Error(`not a regular file: ${target}`);
    err.code = 'TOOL_EDIT_NOT_FILE';
    throw err;
  }
  if (lst.size > MAX_FILE_BYTES) {
    const err = new Error(`file too large (${lst.size} bytes > ${MAX_FILE_BYTES} cap)`);
    err.code = 'TOOL_EDIT_TOO_LARGE';
    throw err;
  }

  // Sprint 2.9 R2 fix (security CRITICAL TOCTOU): on POSIX, open with
  // O_NOFOLLOW so the kernel rejects symlink swaps mid-race. On Windows
  // O_NOFOLLOW is unavailable; we rely on the lstat check above + the
  // single-process operator-trust model (TOCTOU race only exploitable
  // by a concurrent attacker, which is out of v0 threat model).
  let content;
  const O = fs.constants;
  if (process.platform !== 'win32' && O.O_NOFOLLOW) {
    let fdRead;
    try {
      fdRead = fs.openSync(target, O.O_RDONLY | O.O_NOFOLLOW);
    } catch (e) {
      if (e.code === 'ELOOP') {
        const err = new Error(`refuse to edit through symlink (TOCTOU defense): ${target}`);
        err.code = 'TOOL_EDIT_SYMLINK_REJECTED';
        throw err;
      }
      throw e;
    }
    try {
      content = fs.readFileSync(fdRead, 'utf8');
    } finally {
      try { fs.closeSync(fdRead); } catch (e) {}
    }
  } else {
    content = fs.readFileSync(target, 'utf8');
  }

  // Sprint 2.9 R2 fix (correctness HIGH-7): non-overlapping advance — `aa`
  // in `aaaa` counts 2, not 3.
  let occurrences = 0;
  let idx = content.indexOf(oldString);
  while (idx !== -1) {
    occurrences++;
    idx = content.indexOf(oldString, idx + oldString.length);
    if (occurrences > 1 && !replaceAll) break;
  }
  if (occurrences === 0) {
    const err = new Error(`old_string not found in ${target}`);
    err.code = 'TOOL_EDIT_OLD_STRING_NOT_FOUND';
    throw err;
  }
  if (occurrences > 1 && !replaceAll) {
    const err = new Error(`old_string occurs multiple times; pass replace_all:true or expand context`);
    err.code = 'TOOL_EDIT_OLD_STRING_NOT_UNIQUE';
    throw err;
  }

  let newContent;
  let replaced;
  if (replaceAll) {
    const parts = content.split(oldString);
    replaced = parts.length - 1;
    newContent = parts.join(newString);
  } else {
    const i = content.indexOf(oldString);
    newContent = content.slice(0, i) + newString + content.slice(i + oldString.length);
    replaced = 1;
  }

  // Sprint 2.9 R2 fix (correctness HIGH-4): apply shrink defense
  // unconditionally — replace_all is the MORE destructive mode.
  const oldLen = content.length;
  const newLen = newContent.length;
  if (oldLen > 0 && newLen / oldLen < 0.5) {
    const err = new Error(`destructive rewrite: file shrunk ${oldLen} → ${newLen} bytes (>50%); use write tool for wholesale replacement`);
    err.code = 'TOOL_EDIT_DESTRUCTIVE_REWRITE';
    throw err;
  }

  // POSIX: open with O_NOFOLLOW for symlink defense. Windows: writeFileSync.
  if (process.platform !== 'win32' && O.O_NOFOLLOW) {
    let fdWrite;
    try {
      fdWrite = fs.openSync(target, O.O_WRONLY | O.O_TRUNC | O.O_NOFOLLOW);
    } catch (e) {
      if (e.code === 'ELOOP') {
        const err = new Error(`refuse to edit through symlink (TOCTOU defense): ${target}`);
        err.code = 'TOOL_EDIT_SYMLINK_REJECTED';
        throw err;
      }
      throw e;
    }
    try {
      fs.writeFileSync(fdWrite, newContent, 'utf8');
    } finally {
      try { fs.closeSync(fdWrite); } catch (e) {}
    }
  } else {
    fs.writeFileSync(target, newContent, 'utf8');
  }
  return {
    path: target,
    occurrences_replaced: replaced,
    old_size: oldLen,
    new_size: newLen,
    replace_all: replaceAll,
  };
}

module.exports = {
  name: 'edit',
  description: 'Exact-string replacement in a file. Fails if old_string is not unique (unless replace_all=true). Refuses 50%+ shrinks unconditionally as destructive-rewrite defense; refuses symlinks via O_NOFOLLOW.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to file. Must exist. Must be inside cwd.',
      },
      old_string: {
        type: 'string',
        description: 'Exact substring to replace. Must exist in file. Empty string rejected.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement string. Must differ from old_string.',
      },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences. Default false (rejects if old_string not unique).',
      },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler,
};
