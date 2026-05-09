'use strict';

// Sprint 2.9 — `grep` tool descriptor.
// Regex search across files. Mirrors Claude Code Grep conventions.
// readOnlyHint=true; idempotent; no network.

const fs = require('node:fs');
const path = require('node:path');

const { isWithinCwd, hasNulByte, isWindowsDeviceOrUnc } = require('./_lib/path-safety.cjs');
const {
  MAX_RESULTS,
  MAX_DEPTH,
  MAX_FILE_BYTES,
  GREP_PATTERN_MAX_LENGTH,
  GREP_PER_LINE_REGEX_DEADLINE_MS,
} = require('./_lib/limits.cjs');

// Default exclude list (Sprint 2.9 R2 fix security MEDIUM): grep skips noise
// directories by default; operator opts in via include_hidden=true OR by
// passing a glob filter. This is the same set ripgrep uses by default.
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target',
  '.venv', 'venv', '__pycache__', '.cache', 'coverage', '.nyc_output',
  '.turbo', '.parcel-cache', '.svelte-kit',
]);

function simpleGlobToRegex(pattern) {
  let regex = '';
  for (const c of pattern) {
    if (c === '*') regex += '[^/\\\\]*';
    else if (c === '?') regex += '[^/\\\\]';
    else if ('.+^$|(){}[]\\'.includes(c)) regex += '\\' + c;
    else if (c === '/' || c === '\\') regex += '[/\\\\]';
    else regex += c;
  }
  return new RegExp('^' + regex + '$');
}

function walkFiles(start, options, onFile) {
  const visited = new Set();
  const queue = [{ dir: start, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > MAX_DEPTH) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.') && !options.includeHidden) continue;
      // Sprint 2.9 R2 fix (security MEDIUM): default-exclude noise dirs.
      if (entry.isDirectory() && DEFAULT_EXCLUDE_DIRS.has(entry.name) && !options.includeNoise) continue;
      try {
        const st = fs.lstatSync(full);
        const key = (st.dev || 0) + ':' + (st.ino || 0);
        if (visited.has(key) && key !== '0:0') continue;
        if (visited.has(full)) continue;
        visited.add(key !== '0:0' ? key : full);
        if (entry.isSymbolicLink()) continue;
      } catch (e) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        const stop = onFile(full);
        if (stop) return;
      }
    }
  }
}

// Sprint 2.9 R2 fix (security HIGH-ReDoS + correctness MEDIUM): per-line
// regex deadline. If a single line takes more than the configured budget
// to test, we abandon the file. Catastrophic-backtracking patterns thus
// degrade gracefully instead of locking the event loop.
function testWithDeadline(regex, line, deadlineMs) {
  const start = Date.now();
  const result = regex.test(line);
  const elapsed = Date.now() - start;
  if (elapsed > deadlineMs) {
    const err = new Error(`regex execution exceeded ${deadlineMs}ms (possible ReDoS)`);
    err.code = 'TOOL_GREP_REGEX_TIMEOUT';
    err.elapsedMs = elapsed;
    throw err;
  }
  return result;
}

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const patternStr = args.pattern;
  const flags = args.case_insensitive ? 'i' : '';
  const includeGlob = typeof args.glob === 'string' && args.glob.length > 0
    ? simpleGlobToRegex(args.glob)
    : null;
  const outputMode = args.output_mode === 'count' || args.output_mode === 'files_with_matches'
    ? args.output_mode
    : 'content';
  const headLimit = Number.isInteger(args.head_limit) && args.head_limit > 0 ? args.head_limit : MAX_RESULTS;

  if (typeof patternStr !== 'string' || patternStr.length === 0) {
    const err = new Error('pattern must be non-empty string');
    err.code = 'TOOL_GREP_PATTERN_INVALID';
    throw err;
  }
  if (patternStr.length > GREP_PATTERN_MAX_LENGTH) {
    const err = new Error(`pattern too long (>${GREP_PATTERN_MAX_LENGTH} chars)`);
    err.code = 'TOOL_GREP_PATTERN_INVALID';
    throw err;
  }
  if (hasNulByte(patternStr)) {
    const err = new Error('pattern contains NUL byte');
    err.code = 'TOOL_GREP_PATTERN_INVALID';
    throw err;
  }

  let baseDir;
  if (typeof args.path === 'string' && args.path.length > 0) {
    if (hasNulByte(args.path) || isWindowsDeviceOrUnc(args.path)) {
      const err = new Error(`invalid baseDir path`);
      err.code = 'TOOL_GREP_PATH_INVALID';
      throw err;
    }
    baseDir = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
  } else {
    baseDir = cwd;
  }
  if (!isWithinCwd(baseDir, cwd, { mode: 'target' })) {
    const err = new Error(`baseDir traversal outside cwd: ${baseDir}`);
    err.code = 'TOOL_GREP_PATH_TRAVERSAL';
    throw err;
  }

  let regex;
  try {
    regex = new RegExp(patternStr, flags);
  } catch (e) {
    const err = new Error(`invalid regex: ${e.message}`);
    err.code = 'TOOL_GREP_REGEX_INVALID';
    throw err;
  }

  const matches = [];
  const filesMatched = new Set();
  let totalMatchCount = 0;
  let truncated = false;
  let regexTimedOut = false;

  walkFiles(baseDir, {
    includeHidden: args.include_hidden === true,
    includeNoise: args.include_noise === true,
  }, (filepath) => {
    const rel = path.relative(baseDir, filepath).split(path.sep).join('/');
    if (includeGlob && !includeGlob.test(rel)) return false;
    let stat;
    try {
      stat = fs.statSync(filepath);
    } catch (e) {
      return false;
    }
    if (stat.size > MAX_FILE_BYTES) return false;
    let content;
    try {
      content = fs.readFileSync(filepath, 'utf8');
    } catch (e) {
      return false;
    }
    const lines = content.split(/\r?\n/);
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      let isMatch;
      try {
        isMatch = testWithDeadline(regex, lines[lineIdx], GREP_PER_LINE_REGEX_DEADLINE_MS);
      } catch (err) {
        if (err.code === 'TOOL_GREP_REGEX_TIMEOUT') {
          regexTimedOut = true;
          truncated = true;
          return true; // abort all walking; surface in result
        }
        throw err;
      }
      if (isMatch) {
        filesMatched.add(filepath);
        totalMatchCount++;
        if (outputMode === 'content') {
          matches.push({
            path: filepath,
            line: lineIdx + 1,
            text: lines[lineIdx].slice(0, 1000),
          });
          if (matches.length >= headLimit) {
            truncated = true;
            return true;
          }
        }
        // For non-content modes we still continue counting per-file matches
        // so total_matches is accurate (Sprint 2.9 R2 fix edge HIGH-grep-count).
      }
    }
    if (outputMode === 'files_with_matches' && filesMatched.size >= headLimit) {
      truncated = true;
      return true;
    }
    return false;
  });

  if (outputMode === 'content') {
    return {
      pattern: patternStr,
      output_mode: 'content',
      matches,
      count: matches.length,
      truncated,
      regex_timeout: regexTimedOut,
    };
  }
  if (outputMode === 'files_with_matches') {
    return {
      pattern: patternStr,
      output_mode: 'files_with_matches',
      files: Array.from(filesMatched),
      count: filesMatched.size,
      truncated,
      regex_timeout: regexTimedOut,
    };
  }
  return {
    pattern: patternStr,
    output_mode: 'count',
    files_with_matches: filesMatched.size,
    total_matches: totalMatchCount,
    truncated,
    regex_timeout: regexTimedOut,
  };
}

module.exports = {
  name: 'grep',
  description: 'Regex search across files (Node-native, zero-deps). Modes: content (default), files_with_matches, count. Excludes node_modules/.git/dist/build/.next by default; opt in via include_noise=true. Per-line regex deadline 50ms (ReDoS defense).',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'JS regex pattern (max 1024 chars). E.g. "function\\\\s+\\\\w+", "TODO|FIXME".',
      },
      path: {
        type: 'string',
        description: 'Base directory (relative or absolute). Default = cwd.',
      },
      glob: {
        type: 'string',
        description: 'Filter files by glob (e.g. "*.cjs"). Optional.',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'Output shape. Default "content".',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case-insensitive match (regex i flag). Default false.',
      },
      head_limit: {
        type: 'integer',
        minimum: 1,
        description: 'Cap result count. Default 5000.',
      },
      include_hidden: {
        type: 'boolean',
        description: 'Search dot-files / dot-dirs. Default false.',
      },
      include_noise: {
        type: 'boolean',
        description: 'Search node_modules/.git/dist/build/etc. Default false.',
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
  _internal: { DEFAULT_EXCLUDE_DIRS, simpleGlobToRegex, testWithDeadline },
};
