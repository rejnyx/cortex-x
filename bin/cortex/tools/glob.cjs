'use strict';

// Sprint 2.9 — `glob` tool descriptor.
// Filename pattern matching, mtime-sorted (matches Claude Code Glob convention).
// readOnlyHint=true; idempotent; no network.

const fs = require('node:fs');
const path = require('node:path');

const { isWithinCwd, hasNulByte, isWindowsDeviceOrUnc } = require('./_lib/path-safety.cjs');
const { MAX_RESULTS, MAX_DEPTH, GLOB_PATTERN_MAX_LENGTH } = require('./_lib/limits.cjs');

// Tiny zero-deps glob → regex translator. Supports:
//   *      → match any chars except path separator
//   **     → match any chars including path separator
//   ?      → match single char except path separator
//   {a,b}  → alternation (each alternative is itself glob-translated, so
//            `{*.cjs,*.js}` works correctly per Sprint 2.9 R2 fix blind HIGH)
//   [...]  → char class (passed through to regex)
//
// Patterns are anchored: must match full path relative to cwd.
function globToRegex(pattern) {
  return new RegExp('^' + globToRegexSource(pattern) + '$');
}

// Sprint 2.9 R2 fix (blind HIGH): inner alternatives must be RECURSIVELY
// translated so glob meta inside `{}` works. Previously alternatives were
// only escaped, which made `{*.cjs,*.js}` produce `(?:*.cjs|*.js)` — invalid
// regex; threw at globToRegex call time.
function globToRegexSource(pattern) {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
      if (pattern[i] === '/' || pattern[i] === '\\') i++;
    } else if (c === '*') {
      regex += '[^/\\\\]*';
      i++;
    } else if (c === '?') {
      regex += '[^/\\\\]';
      i++;
    } else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        regex += '\\{';
        i++;
        continue;
      }
      const inner = pattern.slice(i + 1, end);
      const alts = inner.split(',').map((s) => globToRegexSource(s));
      regex += '(?:' + alts.join('|') + ')';
      i = end + 1;
    } else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        regex += '\\[';
        i++;
        continue;
      }
      regex += pattern.slice(i, end + 1);
      i = end + 1;
    } else if (c === '/' || c === '\\') {
      regex += '[/\\\\]';
      i++;
    } else if ('.+^$|()'.includes(c)) {
      regex += '\\' + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return regex;
}

function walkDir(start, regex, options) {
  const visited = new Set();
  const results = [];
  const queue = [{ dir: start, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    if (results.length >= MAX_RESULTS) {
      truncated = true;
      break;
    }
    const { dir, depth } = queue.shift();
    if (depth > MAX_DEPTH) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) {
        truncated = true;
        break;
      }
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') && !options.includeHidden) continue;
      try {
        const st = fs.lstatSync(full);
        // Sprint 2.9 R2 fix (edge MEDIUM): on Windows, ino is sometimes 0
        // for non-NTFS volumes — fall back to path-based dedup if both dev
        // and ino are 0.
        const key = (st.dev || 0) + ':' + (st.ino || 0);
        const altKey = full;
        if (visited.has(key) && key !== '0:0') continue;
        if (visited.has(altKey)) continue;
        visited.add(key !== '0:0' ? key : altKey);
        if (entry.isSymbolicLink() && !options.followSymlinks) continue;
      } catch (e) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        const rel = path.relative(options.baseDir, full);
        const normalized = rel.split(path.sep).join('/');
        if (regex.test(normalized)) {
          let mtime = 0;
          try {
            mtime = fs.statSync(full).mtimeMs;
          } catch (e) {}
          results.push({ path: full, rel: normalized, mtime });
        }
      }
    }
  }
  results.sort((a, b) => b.mtime - a.mtime);
  return { results, truncated };
}

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const pattern = args.pattern;

  if (typeof pattern !== 'string' || pattern.length === 0) {
    const err = new Error('pattern must be non-empty string');
    err.code = 'TOOL_GLOB_PATTERN_INVALID';
    throw err;
  }
  if (pattern.length > GLOB_PATTERN_MAX_LENGTH) {
    const err = new Error(`pattern too long (>${GLOB_PATTERN_MAX_LENGTH} chars)`);
    err.code = 'TOOL_GLOB_PATTERN_INVALID';
    throw err;
  }
  if (hasNulByte(pattern)) {
    const err = new Error('pattern contains NUL byte');
    err.code = 'TOOL_GLOB_PATTERN_INVALID';
    throw err;
  }

  // Resolve baseDir robustly: explicit absolute path or relative to cwd.
  let baseDir;
  if (typeof args.path === 'string' && args.path.length > 0) {
    if (hasNulByte(args.path) || isWindowsDeviceOrUnc(args.path)) {
      const err = new Error(`invalid baseDir path`);
      err.code = 'TOOL_GLOB_PATH_INVALID';
      throw err;
    }
    baseDir = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  } else {
    baseDir = cwd;
  }
  if (!isWithinCwd(baseDir, cwd, { mode: 'target' })) {
    const err = new Error(`baseDir traversal outside cwd: ${baseDir}`);
    err.code = 'TOOL_GLOB_PATH_TRAVERSAL';
    throw err;
  }

  let regex;
  try {
    regex = globToRegex(pattern);
  } catch (e) {
    const err = new Error(`invalid glob pattern: ${e.message}`);
    err.code = 'TOOL_GLOB_PATTERN_INVALID';
    throw err;
  }
  const { results, truncated } = walkDir(baseDir, regex, {
    baseDir,
    followSymlinks: false,
    includeHidden: args.include_hidden === true,
  });

  return {
    pattern,
    base_dir: baseDir,
    matches: results.map((r) => ({ path: r.path, mtime_ms: r.mtime })),
    count: results.length,
    truncated,
    max_results_cap: MAX_RESULTS,
  };
}

module.exports = {
  name: 'glob',
  description: 'Filename pattern matching (mtime-sorted, descending). Supports *, **, ?, {a,b} (recursive), [...]. Refuses paths outside cwd. Result cap 5000.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g. "**/*.cjs", "src/{a,b}/*.ts"). Max 256 chars.',
      },
      path: {
        type: 'string',
        description: 'Base directory for search (relative to cwd or absolute). Default = cwd.',
      },
      include_hidden: {
        type: 'boolean',
        description: 'Include dot-files / dot-dirs. Default false.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler,
  _internal: { globToRegex, globToRegexSource },
};
