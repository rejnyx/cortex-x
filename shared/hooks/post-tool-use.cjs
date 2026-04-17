/**
 * Post-Tool-Use — Global Hook (journal writer)
 * Appends one JSONL entry per tool call to {cortex_root}/journal/YYYY-MM-DD-<project-slug>.jsonl
 *
 * Schema: {ts, project, tool, duration_ms, ok, summary, error?, file?}
 * Privacy: never logs file contents, user input, API responses, or secrets.
 *          Only metadata: tool name, short summary, file path, error message.
 *
 * Failure-isolated: all errors swallowed, always exit 0.
 * See journal/README.md for schema + privacy contract.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CWD = process.cwd();

// ---- Silent error log (observability for catch-swallowed failures) ----
// Writes one line to {cortex_root}/.hook-errors.log on caught failures.
// Rotates: truncates to last ~4KB when file exceeds 16KB. Never throws.
const ERRLOG_MAX = 16 * 1024;
const ERRLOG_KEEP = 4 * 1024;
function logErr(cortexRoot, where, err) {
  if (!cortexRoot) return;
  try {
    const file = path.join(cortexRoot, '.hook-errors.log');
    try {
      const st = fs.statSync(file);
      if (st.size > ERRLOG_MAX) {
        const buf = fs.readFileSync(file);
        const tail = buf.slice(Math.max(0, buf.length - ERRLOG_KEEP));
        fs.writeFileSync(file, tail, { mode: 0o600 });
      }
    } catch {}
    const msg = err && err.message ? err.message : String(err);
    const line = `${new Date().toISOString()} [post-tool-use] ${where}: ${msg.slice(0, 300)}\n`;
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch {}
}

// ---- cortex-x location (mirrors session-start.cjs candidates) ----
function resolveCortexRoot() {
  const candidates = [
    path.join(os.homedir(), 'cortex-x'),
    path.join(os.homedir(), 'Desktop', 'APPs', 'cortex-x'),
    path.join(os.homedir(), '.cortex-x'),
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isDirectory()) return p; } catch {}
  }
  return null;
}

// ---- Project slug (mirrors session-start.cjs logic) ----
function slugify(s) {
  let out = String(s || '')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  // Windows reserved names — prefix to avoid write failure
  if (/^(con|aux|nul|prn|com[1-9]|lpt[1-9])$/i.test(out)) out = 'p-' + out;
  return out || 'unknown';
}

function getProjectSlug() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(CWD, 'package.json'), 'utf8'));
    if (pkg && typeof pkg.name === 'string') return slugify(pkg.name);
  } catch {}
  return slugify(path.basename(CWD));
}

// ---- Redaction ----
// Order matters: scheme-prefix tokens (Bearer/Basic/etc.) first so the value gets scrubbed
// before the generic keyword pattern consumes just the scheme word.
const SECRET_PATTERNS = [
  // HTTP auth schemes — value after the scheme is the secret
  [/\b(Bearer|Basic|Digest|Token|JWT)\s+[A-Za-z0-9._~+/=:-]{8,}/gi, '$1 <redacted>'],
  // curl -u user:pass / --user user:pass (word-boundary doesn't fire before `-`)
  [/((?:^|\s)-u\s+|(?:^|\s)--user[\s=]+)[^\s:]+:[^\s]+/g, '$1<redacted>'],
  // URLs with inline credentials (postgres/mysql/mongo/redis/http(s)).
  // Greedy `[^\s]+@` backs off to the LAST @ so passwords containing @ still get caught.
  [/(\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^:\s/@]+):[^\s]+@/g, '$1:<redacted>@'],
  // URL query-string secrets
  [/([?&](?:access[_-]?token|api[_-]?token|api[_-]?key|auth[_-]?token|authorization|secret|password)=)[^&\s"']+/gi, '$1<redacted>'],
  // Known provider key shapes
  [/\bsk-(?:ant-)?[a-zA-Z0-9_-]{20,}/g, '<redacted>'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/g, '<redacted>'],
  [/\b(AKIA|ASIA|ANPA|AIDA|AROA|AIPA|ABIA|ACCA)[0-9A-Z]{16}\b/g, '<redacted>'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '<redacted>'],
  [/\bghp_[a-zA-Z0-9]{20,}/g, '<redacted>'],
  [/\bghs_[a-zA-Z0-9]{20,}/g, '<redacted>'],
  [/\bxox[baprs]-[a-zA-Z0-9-]{10,}/g, '<redacted>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<redacted>'],
  // Generic keyword=value (after scheme patterns above, so Bearer/Basic already handled)
  // Excluded from keyword list: `pwd` (collides with shell command)
  [/\b(password|passwd|token|secret|api[-_]?key|authorization)[\s:=]+["']?([^\s"'&]+)/gi, '$1=<redacted>'],
];

function redact(str) {
  if (!str) return '';
  let out = String(str);
  // URL-decode once so %3D-encoded secrets get caught
  try { out = decodeURIComponent(out); } catch {}
  for (const [re, repl] of SECRET_PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function homeStrip(p) {
  if (!p) return p;
  const home = os.homedir();
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

// ---- Per-tool summary extraction ----
function buildSummary(toolName, ti) {
  ti = ti || {};
  switch (toolName) {
    case 'Bash':
      return truncate(redact(ti.command || ''), 120);
    case 'Edit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return ''; // file field carries location; no other metadata
    case 'Grep': {
      const pat = ti.pattern || '';
      const loc = ti.path ? ` in ${ti.path}` : '';
      return truncate(redact(`${pat}${loc}`), 120);
    }
    case 'Glob':
      return truncate(ti.pattern || '', 120);
    case 'WebFetch':
      return truncate(redact(ti.url || ''), 120); // URL redacted for token query strings
    case 'WebSearch':
      return truncate(redact(ti.query || ''), 120);
    case 'Agent':
    case 'Task':
      return truncate(ti.description || ti.subagent_type || '', 120);
    case 'Skill':
      return truncate(ti.skill || '', 80);
    case 'ScheduleWakeup':
      return `${ti.delaySeconds || ''}s`;
    default:
      return '';
  }
}

function extractFile(toolName, ti) {
  ti = ti || {};
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'Read') {
    return ti.file_path ? homeStrip(ti.file_path) : null;
  }
  if (toolName === 'NotebookEdit') {
    return ti.notebook_path ? homeStrip(ti.notebook_path) : null;
  }
  return null;
}

// ---- Success / error detection ----
// Returns true/false/null. null = ambiguous (no success/error signal in payload).
function detectOk(data) {
  const tr = data.tool_response || data.toolResponse;
  if (!tr || (typeof tr === 'object' && !Array.isArray(tr) && Object.keys(tr).length === 0)) {
    if (data.error) return false;
    return null;
  }
  if (typeof tr.is_error === 'boolean') return !tr.is_error;
  if (typeof tr.success === 'boolean') return tr.success;
  if (tr.error) return false;
  if (data.error) return false;
  return true;
}

function extractError(data) {
  const tr = data.tool_response || data.toolResponse || {};
  const raw = (tr && (tr.error || tr.error_message)) || data.error || '';
  if (!raw) return '';
  let str;
  if (typeof raw === 'string') {
    str = raw;
  } else if (raw instanceof Error) {
    str = raw.message || String(raw);
  } else {
    // Defensive stringify — tolerate circular refs
    try {
      const seen = new WeakSet();
      str = JSON.stringify(raw, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      });
    } catch {
      str = String(raw);
    }
  }
  // First line only — error messages often echo full user content / API bodies
  str = str.split(/\r?\n/)[0];
  return truncate(redact(str), 200);
}

// ---- Sanitize session id for use in filenames ----
function hashSessionId(sessionId) {
  if (!sessionId) return '';
  return crypto.createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 12);
}

function stateFilePath(sessionHash) {
  return path.join(os.tmpdir(), `cortex-pending-${sessionHash}.jsonl`);
}

// ---- Duration correlation (reads + mutates PreToolUse stack file) ----
// State file is JSONL stack; each PreToolUse appends one line. PostToolUse
// matches the last entry for this tool_name, removes it, computes duration.
function readPendingDuration(sessionHash, toolName) {
  if (!sessionHash) return null;
  const file = stateFilePath(sessionHash);
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); }
  catch { return null; }

  // Walk from newest to oldest — matches parallel tool calls LIFO-ish
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry && entry.tool === toolName && typeof entry.ts === 'number') {
      const duration = Math.max(0, Date.now() - entry.ts);
      lines.splice(i, 1);
      // Rewrite file without the matched line
      try {
        if (lines.length === 0) fs.unlinkSync(file);
        else fs.writeFileSync(file, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
      } catch {}
      return duration;
    }
  }
  return null;
}

// ---- Secure append helper (0600 perms on Unix) ----
function secureAppend(file, data) {
  // 'a' flag + O_CREAT + mode 0600 — on Windows mode is ignored, behavior falls back to default
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND;
  const fd = fs.openSync(file, flags, 0o600);
  try { fs.writeSync(fd, data); } finally { fs.closeSync(fd); }
}

// ---- Main ----
let input = '';
const MAX_INPUT = 256 * 1024;
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => process.exit(0));
process.stdin.on('data', chunk => {
  if (input.length + chunk.length > MAX_INPUT) { process.exit(0); return; }
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const toolName = data.tool_name || data.toolName || '';
    if (!toolName) { process.exit(0); return; }

    const cortexRoot = resolveCortexRoot();
    if (!cortexRoot) { process.exit(0); return; }

    const sessionHash = hashSessionId(data.session_id || data.sessionId || '');
    const slug = getProjectSlug();
    const ti = data.tool_input || data.toolInput || {};

    const now = new Date();
    const summary = buildSummary(toolName, ti);
    const file = extractFile(toolName, ti);

    // Skip zero-signal entries (unknown tool, no file, ok-true) — pollutes evolve mining
    const ok = detectOk(data);
    const err = extractError(data);
    if (!summary && !file && !err && ok !== false) { process.exit(0); return; }

    const entry = {
      ts: now.toISOString(),
      project: slug,
      tool: toolName,
      duration_ms: readPendingDuration(sessionHash, toolName),
      ok,
      summary,
    };
    if (file) entry.file = file;
    if (err) entry.error = err;

    const journalDir = path.join(cortexRoot, 'journal');
    try { fs.mkdirSync(journalDir, { recursive: true, mode: 0o700 }); } catch {}

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const journalFile = path.join(journalDir, `${yyyy}-${mm}-${dd}-${slug}.jsonl`);

    try {
      secureAppend(journalFile, JSON.stringify(entry) + '\n');
    } catch (e) {
      logErr(cortexRoot, 'secureAppend', e);
    }
    process.exit(0);
  } catch (e) {
    try { logErr(resolveCortexRoot(), 'main', e); } catch {}
    process.exit(0);
  }
});
