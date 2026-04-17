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

const CWD = process.cwd();

// ---- cortex-x location (mirrors session-start.cjs candidates) ----
function resolveCortexRoot() {
  const candidates = [
    path.join(os.homedir(), 'cortex-x'),
    path.join(os.homedir(), 'Desktop', 'APPs', 'cortex-x'),
    path.join(os.homedir(), '.cortex-x'),
  ];
  return candidates.find(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) || null;
}

// ---- Project slug (mirrors session-start.cjs logic) ----
function slugify(s) {
  return String(s || '')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function getProjectSlug() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(CWD, 'package.json'), 'utf8'));
    if (pkg && pkg.name) return slugify(pkg.name);
  } catch {}
  return slugify(path.basename(CWD));
}

// ---- Redaction ----
const SECRET_PATTERNS = [
  /(password|passwd|pwd|token|secret|api[-_]?key|authorization|bearer)[\s:=]+["']?([^\s"'&]+)/gi,
  /\bsk-[a-zA-Z0-9_-]{20,}/g,
  /\bghp_[a-zA-Z0-9]{20,}/g,
  /\bghs_[a-zA-Z0-9]{20,}/g,
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  /\b[a-f0-9]{32,}\b/gi, // long hex tokens
];

function redact(str) {
  if (!str) return '';
  let out = String(str);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '<redacted>');
  }
  return out;
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
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
      return truncate(`${pat}${loc}`, 120);
    }
    case 'Glob':
      return truncate(ti.pattern || '', 120);
    case 'WebFetch':
      return truncate(ti.url || '', 120); // URL only, not prompt
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
    return ti.file_path || null;
  }
  if (toolName === 'NotebookEdit') {
    return ti.notebook_path || null;
  }
  return null;
}

// ---- Success / error detection ----
function detectOk(data) {
  // PostToolUse payload: tool_response.error means failure in some harnesses;
  // fall back to is_error / success flags.
  const tr = data.tool_response || data.toolResponse || {};
  if (tr && typeof tr.is_error === 'boolean') return !tr.is_error;
  if (tr && typeof tr.success === 'boolean') return tr.success;
  if (tr && tr.error) return false;
  if (data.error) return false;
  return true;
}

function extractError(data) {
  const tr = data.tool_response || data.toolResponse || {};
  const raw = (tr && (tr.error || tr.error_message)) || data.error || '';
  if (!raw) return '';
  // raw may be string or object
  const str = typeof raw === 'string' ? raw : (raw.message || JSON.stringify(raw));
  return truncate(redact(str), 200);
}

// ---- Duration correlation (reads PreToolUse state file) ----
function readPendingDuration(sessionId, toolName) {
  if (!sessionId) return null;
  const stateFile = path.join(os.tmpdir(), `cortex-tool-${sessionId}.json`);
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    try { fs.unlinkSync(stateFile); } catch {}
    if (parsed && parsed.tool === toolName && typeof parsed.ts === 'number') {
      return Math.max(0, Date.now() - parsed.ts);
    }
  } catch {}
  return null;
}

// ---- Main ----
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const toolName = data.tool_name || data.toolName || '';
    if (!toolName) { process.exit(0); return; }

    const cortexRoot = resolveCortexRoot();
    if (!cortexRoot) { process.exit(0); return; } // silent exit when cortex-x not installed

    const sessionId = data.session_id || data.sessionId || '';
    const slug = getProjectSlug();
    const ti = data.tool_input || data.toolInput || {};

    const now = new Date();
    const entry = {
      ts: now.toISOString(),
      project: slug,
      tool: toolName,
      duration_ms: readPendingDuration(sessionId, toolName),
      ok: detectOk(data),
      summary: buildSummary(toolName, ti),
    };

    const file = extractFile(toolName, ti);
    if (file) entry.file = file;

    const err = extractError(data);
    if (err) entry.error = err;

    // Drop empty-summary for file-ops (file carries the signal)
    if (!entry.summary && !entry.file) entry.summary = '';

    const journalDir = path.join(cortexRoot, 'journal');
    try { fs.mkdirSync(journalDir, { recursive: true }); } catch {}

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const journalFile = path.join(journalDir, `${yyyy}-${mm}-${dd}-${slug}.jsonl`);

    fs.appendFileSync(journalFile, JSON.stringify(entry) + '\n', { encoding: 'utf8' });
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
