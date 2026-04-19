/**
 * Pre-Tool-Use — Global Hook (journal companion)
 * Appends tool-call start record to per-session JSONL stack in tmpdir so
 * post-tool-use.cjs can compute duration_ms — including parallel tool calls.
 *
 * Privacy: writes only {ts, tool} — no tool_input contents, no stdin payload.
 * Safe against symlink races: uses O_NOFOLLOW | O_CREAT with 0600 mode.
 * Failure-isolated: always exit 0, never block Claude's flow.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { redact, truncate, singleLine } = require('./_lib/redact.cjs');

// ---- Silent error log (mirrors post-tool-use.cjs, shares redact lib) ----
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
        let tail = buf.slice(Math.max(0, buf.length - ERRLOG_KEEP));
        const nl = tail.indexOf('\n');
        if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1);
        fs.writeFileSync(file, tail, { mode: 0o600 });
      }
    } catch {}
    const raw = err && err.message ? err.message : String(err);
    const safe = truncate(redact(singleLine(raw)), 300);
    const line = `${new Date().toISOString()} [pre-tool-use] ${where}: ${safe}\n`;
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch {}
}

function resolveCortexRoot() {
  const envHome = process.env.CORTEX_HOME;
  if (envHome) {
    try { if (fs.statSync(envHome).isDirectory()) return envHome; } catch {}
  }
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

function hashSessionId(sessionId) {
  if (!sessionId) return '';
  return crypto.createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 12);
}

let input = '';
const MAX_INPUT = 64 * 1024;
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

    if (!resolveCortexRoot()) { process.exit(0); return; }

    const sessionHash = hashSessionId(data.session_id || data.sessionId || '');
    if (!sessionHash) { process.exit(0); return; }

    const stateFile = path.join(os.tmpdir(), `cortex-pending-${sessionHash}.jsonl`);
    const line = JSON.stringify({ ts: Date.now(), tool: toolName }) + '\n';

    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow;
    let fd;
    try {
      fd = fs.openSync(stateFile, flags, 0o600);
    } catch {
      process.exit(0);
      return;
    }
    try { fs.writeSync(fd, line); } finally { fs.closeSync(fd); }
    process.exit(0);
  } catch (e) {
    try { logErr(resolveCortexRoot(), 'main', e); } catch {}
    process.exit(0);
  }
});
