'use strict';

// Sprint 2.9 — `read` tool descriptor.
// Reads a file from local filesystem. Returns content + line count.
// readOnlyHint=true; no destructive ops; idempotent; no network.

const fs = require('node:fs');
const path = require('node:path');

const { assertPathSafe } = require('./_lib/path-safety.cjs');
const { MAX_FILE_BYTES } = require('./_lib/limits.cjs');

// Sprint 2.9 R2 fix (edge HIGH): magic-byte sniff for binary files. UTF-8
// decode of binary data produces silent mojibake + nonsense line counts.
// Detect: NUL byte in first 8 KiB → binary.
function isBinaryBuffer(buf) {
  const sniffLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sniffLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const target = assertPathSafe(args.path, cwd, 'TOOL_READ', { mode: 'target' });

  let stat;
  try {
    stat = fs.statSync(target);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const err = new Error(`file not found: ${target}`);
      err.code = 'TOOL_READ_NOT_FOUND';
      throw err;
    }
    throw e;
  }
  if (!stat.isFile()) {
    const err = new Error(`not a regular file: ${target}`);
    err.code = 'TOOL_READ_NOT_FILE';
    throw err;
  }
  if (stat.size > MAX_FILE_BYTES) {
    const err = new Error(`file too large (${stat.size} bytes > ${MAX_FILE_BYTES} cap)`);
    err.code = 'TOOL_READ_TOO_LARGE';
    throw err;
  }

  const buf = fs.readFileSync(target);
  if (isBinaryBuffer(buf)) {
    const err = new Error(`refuse to read binary file: ${target}`);
    err.code = 'TOOL_READ_BINARY';
    throw err;
  }
  const content = buf.toString('utf8');
  const lines = content.split(/\r?\n/);
  // Sprint 2.9 R2 fix (edge HIGH): explicit integer + range checks. Schema
  // enforces minimum:1 for limit but direct handler calls (e.g. from Steward)
  // bypass adapter validation; defend in depth.
  const offset = (Number.isInteger(args.offset) && args.offset >= 0) ? args.offset : 0;
  const limit = (Number.isInteger(args.limit) && args.limit >= 1) ? args.limit : lines.length;
  const slice = lines.slice(offset, offset + limit);
  // Detect line-ending style for callers that want round-trip fidelity.
  // Detect line-ending style: crlf-only, lf-only, or mixed.
  const hasCRLF = /\r\n/.test(content);
  const hasBareLF = /(?<!\r)\n/.test(content);
  let eol = 'lf';
  if (hasCRLF && hasBareLF) eol = 'mixed';
  else if (hasCRLF) eol = 'crlf';
  else eol = 'lf';

  return {
    path: target,
    content: slice.join('\n'),
    line_count_total: lines.length,
    line_count_returned: slice.length,
    offset,
    limit,
    truncated: offset + slice.length < lines.length,
    eol,
  };
}

module.exports = {
  name: 'read',
  description: 'Read a UTF-8 text file from local filesystem. Returns content + line count + EOL style. Refuses paths outside cwd, files > 5 MiB, or binary files (NUL byte in first 8 KiB).',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to file. Must be inside cwd. Must not contain NUL bytes.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Skip first N lines. Default 0.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'Read at most N lines. Default = all remaining lines.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler,
};
