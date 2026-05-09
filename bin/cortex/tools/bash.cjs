'use strict';

// Sprint 2.9 — `bash` tool descriptor.
// Shell command execution. destructiveHint=true (can do anything);
// idempotentHint=false (commands have side effects); openWorldHint=true
// (network is reachable from inherited PATH).
//
// Defense-in-depth tripwires (NOT a security boundary): forbidden tokens,
// pipe-to-shell regex, output cap, timeout, env allowlist, optional
// command allowlist via STEWARD_BASH_ALLOWLIST.

const { spawn } = require('node:child_process');

const {
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  BASH_MAX_OUTPUT_BYTES,
  BASH_MAX_COMMAND_LENGTH,
} = require('./_lib/limits.cjs');

// Forbidden command tokens. Defense-in-depth, not security boundary.
const FORBIDDEN_TOKENS = Object.freeze([
  'mkfs',
  'dd if=',
  ':(){',          // fork bomb signature
  'sudo passwd',
  'shutdown',
  'reboot',
]);

// Regex-form forbidden patterns. Sprint 2.9 R2 fix (blind BLOCKER + edge HIGH):
// previous literal-substring matching had two failure modes — `rm -rf /tmp`
// false-positive on prefix `rm -rf /`, and `> /dev/sdb` undetected because
// only `/dev/sda` was in the literal list.
const FORBIDDEN_REGEXES = Object.freeze([
  // rm -rf with absolute root path (catches /, /home, /etc, /var, /usr, /opt — but NOT /tmp/x).
  // Word-boundary on -rf flag avoids matching `rm -rfd /tmp` style legitimate forms.
  // Also catches --recursive --force long-form.
  /\brm\s+(-[rRfF]+|--recursive|--force)(\s+(-[rRfF]+|--recursive|--force))*\s+\/(?:home|etc|usr|var|opt|root|boot|lib|sbin|bin|sys|proc)?\b/i,
  /\brm\s+(-[rRfF]+|--recursive|--force)(\s+(-[rRfF]+|--recursive|--force))*\s+\/\s*$/,
  /\brm\s+(-[rRfF]+|--recursive|--force)(\s+(-[rRfF]+|--recursive|--force))*\s+\/\*/,
  /\brm\s+(-[rRfF]+|--recursive|--force)(\s+(-[rRfF]+|--recursive|--force))*\s+\$HOME\b/i,
  /\brm\s+(-[rRfF]+|--recursive|--force)(\s+(-[rRfF]+|--recursive|--force))*\s+~(?:\/|\s|$)/,

  // Disk-device write — covers /dev/sd[a-z], /dev/nvme*, /dev/hd[a-z], /dev/xvd[a-z], /dev/vd[a-z].
  />\s*\/dev\/(sd[a-z]\d*|nvme\d+n\d+(p\d+)?|hd[a-z]\d*|xvd[a-z]\d*|vd[a-z]\d*)\b/i,

  // Pipe-to-shell. Catches curl/wget piped into sh/bash/zsh/ksh/fish/python/ruby/perl/node.
  /\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|ksh|fish|python\d?|ruby|perl|node)\b/i,
  // Process substitution form: bash <(curl …), sh <(wget …)
  /\b(sh|bash|zsh|ksh)\s+<\(\s*(curl|wget|fetch)\b/i,
  // eval / source curl: eval "$(curl …)", source <(curl …)
  /\b(eval|source|\.)\s+["`(]?\s*\$?\(\s*(curl|wget|fetch)\b/i,

  // halt as a SHELL COMMAND form (catches `halt`, `halt now`, `halt;`, `halt&`, `halt|x`).
  // Sprint 2.9 R2 fix (blind MEDIUM): added [&|] to trailing alternation.
  /(^|[\s;&|])halt(\s*$|\s+(now|-)|\s*[;&|])/i,

  // Windows-specific destructive patterns (cmd.exe / PowerShell).
  /\bdel\s+\/[fsq]+(\s+\/[fsq]+)*\s+[A-Za-z]:[\\\/]/i,
  /\brd\s+\/s\s+\/q\s+%/i,
  /\bformat\s+[A-Za-z]:\s+\/[yq]/i,
  /\b(remove-item|rmdir|rd)\s+-recurse\s+-force/i,
]);

// Sprint 2.9 R2 fix (correctness HIGH-3): Unicode whitespace normalization.
// JS s in a /u-flagged regex matches all Unicode Zs category + line/para
// separators including U+00A0 NBSP, U+1680 OGHAM, U+2000-200A, U+2028-2029,
// U+202F NNBSP, U+205F MMSP, U+3000 IDEOGRAPHIC, U+FEFF ZWNBSP.
const _UNICODE_WHITESPACE_REGEX = /\s+/gu;
function checkForbidden(command) {
  // Normalize unicode whitespace + lowercase + collapse runs.
  const normalized = command.toLowerCase().replace(_UNICODE_WHITESPACE_REGEX, ' ');

  // Literal-token denylist (case-folded).
  for (const token of FORBIDDEN_TOKENS) {
    if (normalized.includes(token.toLowerCase())) {
      return token;
    }
  }
  // Regex denylist (operates on normalized form to defeat whitespace tricks,
  // but match.0 quotes the original-case substring for the error message).
  for (const re of FORBIDDEN_REGEXES) {
    const m = normalized.match(re);
    if (m) return `forbidden-pattern: ${m[0].slice(0, 80)}`;
  }
  return null;
}

// Allowlist mode: STEWARD_BASH_ALLOWLIST is comma-separated command prefixes.
// Sprint 2.9 R2 fix (edge MEDIUM): empty-after-trim allowlist now FAIL-CLOSED
// (previously silently disabled the allowlist). If operator sets the env var
// at all, we treat empty as "deny everything". Unset env var → no allowlist.
function loadAllowlist(env) {
  if (!env || env.STEWARD_BASH_ALLOWLIST === undefined) return null;
  return env.STEWARD_BASH_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean);
}

function checkAllowlist(command, allowlist) {
  if (allowlist === null) return true; // no allowlist active
  // Empty array (env var set but trimmed to nothing) = deny all.
  if (allowlist.length === 0) return false;
  for (const prefix of allowlist) {
    if (command.startsWith(prefix)) return true;
  }
  return false;
}

async function handler(args, ctx) {
  ctx = ctx || {};
  const cwd = ctx.cwd || process.cwd();
  const env = ctx.env || process.env;
  const command = args.command;
  const timeoutMs = (Number.isInteger(args.timeout_ms) && args.timeout_ms > 0)
    ? Math.min(args.timeout_ms, BASH_MAX_TIMEOUT_MS)
    : BASH_DEFAULT_TIMEOUT_MS;

  if (typeof command !== 'string' || command.length === 0) {
    const err = new Error('command must be non-empty string');
    err.code = 'TOOL_BASH_COMMAND_INVALID';
    throw err;
  }
  if (command.length > BASH_MAX_COMMAND_LENGTH) {
    const err = new Error(`command too long (>${BASH_MAX_COMMAND_LENGTH} chars)`);
    err.code = 'TOOL_BASH_COMMAND_INVALID';
    throw err;
  }
  if (command.indexOf('\0') !== -1) {
    const err = new Error('command contains NUL byte');
    err.code = 'TOOL_BASH_COMMAND_INVALID';
    throw err;
  }

  const forbidden = checkForbidden(command);
  if (forbidden) {
    const err = new Error(`command contains forbidden token: ${forbidden}`);
    err.code = 'TOOL_BASH_FORBIDDEN_COMMAND';
    err.forbidden = forbidden;
    throw err;
  }

  const allowlist = loadAllowlist(env);
  if (!checkAllowlist(command, allowlist)) {
    const err = new Error(`command not in STEWARD_BASH_ALLOWLIST: ${command.slice(0, 80)}`);
    err.code = 'TOOL_BASH_NOT_IN_ALLOWLIST';
    throw err;
  }

  // Sprint 2.9 R2 fix (security HIGH + correctness LOW-10): switch from
  // denylist to ALLOWLIST for spawned env. Operator widens via
  // STEWARD_BASH_ENV_PASSTHROUGH (comma-sep list) when a tool needs e.g. GH_TOKEN.
  const PASSTHROUGH_BASE = ['PATH', 'HOME', 'USER', 'USERPROFILE', 'LANG', 'TZ', 'SHELL', 'TEMP', 'TMP', 'SystemRoot', 'COMSPEC'];
  const operatorPassthrough = (env.STEWARD_BASH_ENV_PASSTHROUGH || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowedKeys = new Set([...PASSTHROUGH_BASE, ...operatorPassthrough]);
  const scrubbed = {};
  for (const k of Object.keys(env)) {
    if (allowedKeys.has(k)) scrubbed[k] = env[k];
  }

  return await new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

    let child;
    let synchronousErrorThrown = null;
    try {
      child = spawn(shell, shellArgs, {
        cwd,
        env: scrubbed,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      const err = new Error(`spawn failed: ${e.message}`);
      err.code = 'TOOL_BASH_SPAWN_FAILED';
      reject(err);
      return;
    }

    // Sprint 2.9 R2 fix (blind HIGH-spawn-race): null-check stdio streams
    // (spawn can return a child where stdout/stderr is null if config failed).
    if (!child.stdout || !child.stderr) {
      const err = new Error('spawn produced no stdio streams');
      err.code = 'TOOL_BASH_SPAWN_FAILED';
      try { child.kill('SIGKILL'); } catch (e) {}
      reject(err);
      return;
    }

    // Sprint 2.9 R2 fix (edge HIGH + blind MEDIUM): track output as Buffer
    // arrays, slice by BYTES not characters, decode at end. Avoids UTF-8
    // truncation mid-codepoint and string-vs-byte unit mismatch.
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    function settle(fn) {
      if (settled) return;
      settled = true;
      fn();
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch (e) {}
    }, timeoutMs);

    function appendChunk(arr, chunk, currentBytes) {
      const remaining = BASH_MAX_OUTPUT_BYTES - currentBytes;
      if (remaining <= 0) {
        outputTruncated = true;
        return currentBytes;
      }
      if (chunk.length <= remaining) {
        arr.push(chunk);
        return currentBytes + chunk.length;
      }
      arr.push(chunk.subarray(0, remaining));
      outputTruncated = true;
      return currentBytes + remaining;
    }

    child.stdout.on('data', (chunk) => {
      stdoutBytes = appendChunk(stdoutChunks, chunk, stdoutBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes = appendChunk(stderrChunks, chunk, stderrBytes);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      synchronousErrorThrown = e;
      settle(() => {
        const err = new Error(`spawn error: ${e.message}`);
        err.code = 'TOOL_BASH_SPAWN_FAILED';
        reject(err);
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (synchronousErrorThrown) return; // already rejected
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        settle(() => {
          const err = new Error(`command timed out after ${timeoutMs}ms`);
          err.code = 'TOOL_BASH_TIMEOUT';
          err.partialStdout = stdout;
          err.partialStderr = stderr;
          reject(err);
        });
        return;
      }
      settle(() => resolve({
        command,
        exit_code: code === null ? -1 : code,
        signal,
        stdout,
        stderr,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        output_truncated: outputTruncated,
        timeout_ms: timeoutMs,
      }));
    });
  });
}

module.exports = {
  name: 'bash',
  description: 'Run a shell command. Defense-in-depth tripwires (forbidden tokens for rm -rf /, mkfs, fork bombs, curl|sh, shutdown, disk-device writes) — NOT a security boundary; use STEWARD_BASH_ALLOWLIST for actual containment. Output capped at 1 MiB. Default timeout 30s; max 120s. Env restricted to allowlist (PATH, HOME, USER, LANG, TZ, SHELL, plus STEWARD_BASH_ENV_PASSTHROUGH).',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command (max 2048 chars). Runs under sh on Unix, cmd on Windows. Refuses NUL bytes.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Max execution time in milliseconds. Default 30000; cap 120000.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler,
  _internal: {
    FORBIDDEN_TOKENS,
    FORBIDDEN_REGEXES,
    checkForbidden,
    checkAllowlist,
    loadAllowlist,
  },
};
