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

// ---- Silent error log (mirrors post-tool-use.cjs logErr; Rule of Three =
// extract when a 3rd hook needs this). Self-rotating at 16KB → 4KB tail.
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
    const line = `${new Date().toISOString()} [pre-tool-use] ${where}: ${msg.slice(0, 300)}\n`;
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch {}
}

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

function hashSessionId(sessionId) {
  if (!sessionId) return '';
  return crypto.createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 12);
}

let input = '';
const MAX_INPUT = 64 * 1024; // pre-hook doesn't need tool_response, so smaller cap
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

    // Match post-hook's silent-no-op guarantee: skip if cortex-x not installed
    if (!resolveCortexRoot()) { process.exit(0); return; }

    const sessionHash = hashSessionId(data.session_id || data.sessionId || '');
    if (!sessionHash) { process.exit(0); return; } // no session ID → can't correlate anyway

    const stateFile = path.join(os.tmpdir(), `cortex-pending-${sessionHash}.jsonl`);
    const line = JSON.stringify({ ts: Date.now(), tool: toolName }) + '\n';

    // O_NOFOLLOW on Unix blocks symlink attacks; ignored on Windows.
    // O_APPEND gives atomic append on POSIX; Windows FILE_APPEND_DATA also atomic.
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow;
    let fd;
    try {
      fd = fs.openSync(stateFile, flags, 0o600);
    } catch {
      // ELOOP or EPERM from O_NOFOLLOW → assume attack or stale symlink; abort silently
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
