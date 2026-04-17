/**
 * Pre-Tool-Use — Global Hook (journal companion)
 * Records tool-call start timestamp to tmpdir so post-tool-use.cjs can compute duration_ms.
 * Privacy: writes only {ts, tool_name} — no tool_input contents, no stdin payload.
 * Failure-isolated: always exit 0, never block Claude's flow.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input || '{}');
    const sessionId = data.session_id || data.sessionId || 'unknown';
    const toolName = data.tool_name || data.toolName || '';
    if (!toolName) { process.exit(0); return; }

    const stateFile = path.join(os.tmpdir(), `cortex-tool-${sessionId}.json`);
    const payload = JSON.stringify({
      ts: Date.now(),
      tool: toolName,
    });
    fs.writeFileSync(stateFile, payload, { encoding: 'utf8' });
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
