'use strict';

// Sprint 2.9 — `write` tool descriptor.
// Creates or overwrites a file. destructiveHint=true (overwrites silently);
// idempotent (same input = same output state); no network.

const fs = require('node:fs');
const path = require('node:path');

const { assertPathSafe } = require('./_lib/path-safety.cjs');
const { MAX_FILE_BYTES } = require('./_lib/limits.cjs');

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const target = assertPathSafe(args.path, cwd, 'TOOL_WRITE', { mode: 'parent' });
  const content = args.content;

  if (typeof content !== 'string') {
    const err = new Error('content must be string');
    err.code = 'TOOL_WRITE_CONTENT_INVALID';
    throw err;
  }
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_FILE_BYTES) {
    const err = new Error(`content too large (${byteLength} bytes > ${MAX_FILE_BYTES} cap)`);
    err.code = 'TOOL_WRITE_TOO_LARGE';
    throw err;
  }

  // Sprint 2.9 R2 fix (edge HIGH + security TOCTOU): if target exists,
  // (a) refuse if it's a symlink, (b) refuse if it's a directory.
  // Also require the parent dir to BE a directory if it exists (catches
  // the `/cwd/README.md/foo.txt` case where parent is a regular file).
  if (fs.existsSync(target)) {
    const lst = fs.lstatSync(target);
    if (lst.isSymbolicLink()) {
      const err = new Error(`refuse to write through symlink: ${target}`);
      err.code = 'TOOL_WRITE_SYMLINK_REJECTED';
      throw err;
    }
    if (lst.isDirectory()) {
      const err = new Error(`target is a directory: ${target}`);
      err.code = 'TOOL_WRITE_TARGET_IS_DIRECTORY';
      throw err;
    }
  }
  const parent = path.dirname(target);
  if (fs.existsSync(parent)) {
    const pst = fs.lstatSync(parent);
    if (pst.isSymbolicLink()) {
      const err = new Error(`refuse to write into symlinked parent: ${parent}`);
      err.code = 'TOOL_WRITE_SYMLINK_REJECTED';
      throw err;
    }
    if (!pst.isDirectory()) {
      const err = new Error(`parent path is not a directory: ${parent}`);
      err.code = 'TOOL_WRITE_PARENT_NOT_DIRECTORY';
      throw err;
    }
  } else {
    fs.mkdirSync(parent, { recursive: true });
  }

  // Sprint 2.9 R2 fix (security CRITICAL TOCTOU): on POSIX, open with
  // O_NOFOLLOW so the kernel rejects symlink swaps mid-race. On Windows
  // O_NOFOLLOW is unavailable; rely on lstat above + operator-trust model.
  const O = fs.constants;
  if (process.platform !== 'win32' && O.O_NOFOLLOW) {
    let fd;
    try {
      fd = fs.openSync(target, O.O_WRONLY | O.O_CREAT | O.O_TRUNC | O.O_NOFOLLOW, 0o644);
    } catch (e) {
      if (e.code === 'ELOOP' || e.code === 'EMLINK') {
        const err = new Error(`refuse to write through symlink (TOCTOU defense): ${target}`);
        err.code = 'TOOL_WRITE_SYMLINK_REJECTED';
        throw err;
      }
      throw e;
    }
    try {
      fs.writeFileSync(fd, content, 'utf8');
    } finally {
      try { fs.closeSync(fd); } catch (e) {}
    }
  } else {
    fs.writeFileSync(target, content, 'utf8');
  }

  return {
    path: target,
    bytes_written: byteLength,
    line_count: content.split(/\r?\n/).length,
  };
}

module.exports = {
  name: 'write',
  description: 'Create or overwrite a file with given content (UTF-8). Refuses paths outside cwd, content > 5 MiB, writing through symlinks (O_NOFOLLOW where available), writing into a directory target, or writing where parent is not a directory.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to file. Must be inside cwd.',
      },
      content: {
        type: 'string',
        description: 'File content as UTF-8 string. Max 5 MiB.',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler,
};
