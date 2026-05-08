// Sprint 2.6 — journal-tail watcher.
//
// Observes cortex/journal/*.jsonl for new lines and emits routing
// decisions: which channel should receive a notification for each event.
// Bridge.cjs subscribes via the `subscribe` API and forwards to the
// configured Discord channel via discord.js.
//
// Routing per R1 §3:
//   #steward-alerts    — halt events, breaker trips, auth rejects
//   #steward-research  — autoresearch winners, prompt evolutions
//   #steward-failures  — spec_failures rollup, npm test failures
//   #steward-cost      — daily/weekly/monthly cap warnings, billing leaks
//
// Pure logic for the routing decision — bridge.cjs handles fs.watch + push.

'use strict';

// Channel routing rules. First-match-wins; default = #alerts.
const ROUTING_RULES = [
  // Cost-related events.
  { match: (e) => /cost_cap|budget_warning|billing_leak|claude_cli_billing_leak|token_velocity/i.test(e.event || e.code || ''), channel: 'steward-cost' },
  // Autoresearch + evolution events.
  { match: (e) => /autoresearch|evolution|alphaevolve|prompt_evolved/i.test(e.event || ''), channel: 'steward-research' },
  // Failure events.
  { match: (e) => /spec_violation|spec_failures|npm_test_failed|verifier_failed|edit_destructive|action_failed/i.test(e.event || e.code || ''), channel: 'steward-failures' },
  // Halt + critical alerts (catch-all → alerts).
  { match: (e) => /halt|breaker|loop_detected|auth_rejected|protocol_drift/i.test(e.event || e.code || ''), channel: 'steward-alerts' },
];

const DEFAULT_CHANNEL = 'steward-alerts';

// Determine which channel a journal entry should route to.
function routeJournalEvent(entry) {
  if (!entry || typeof entry !== 'object') return null;
  // Skip routine success entries (no channel).
  if (entry.outcome === 'success' && !/threshold_exceeded|drift|recovered/.test(entry.event || '')) {
    return null;
  }
  for (const rule of ROUTING_RULES) {
    try {
      if (rule.match(entry)) return rule.channel;
    } catch { /* malformed entry — ignore */ }
  }
  // Failure-class default routes to alerts.
  if (entry.outcome === 'failure' || entry.outcome === 'recovered') {
    return DEFAULT_CHANNEL;
  }
  return null;
}

// Render a one-line summary suitable for a Discord message body.
// Truncates long fields. Operator can drill in via /why <sha>.
function renderJournalSummary(entry) {
  if (!entry) return '';
  const ts = entry.ts || new Date().toISOString();
  const event = entry.event || entry.code || 'unknown';
  const outcome = entry.outcome ? ` (${entry.outcome})` : '';
  const slug = entry.slug ? ` [${entry.slug}]` : '';
  const action_kind = entry.action_kind ? ` kind=${entry.action_kind}` : '';
  const detail = entry.detail || entry.error || '';
  const detailTrim = typeof detail === 'string' ? detail.slice(0, 200) : '';
  return `**${event}**${outcome}${slug}${action_kind} — \`${ts}\`${detailTrim ? `\n> ${detailTrim}` : ''}`;
}

// Parse NDJSON content into journal entries (best-effort, skips
// unparseable lines silently).
function parseNDJSON(content) {
  if (!content || typeof content !== 'string') return [];
  const out = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* skip */ }
  }
  return out;
}

// Tail-follower factory — given a file path + a `onEvent` callback,
// returns a controller object with `start()` / `stop()`. Bridge.cjs uses
// fs.watch + readSync from offset to push only new lines. Pure logic
// returns the controller; actual fs binding is in bridge.cjs.
function makeTailFollower(filePath, onEvent, opts = {}) {
  let lastSize = 0;
  let stopped = false;
  let fs;
  try { fs = opts.fs || require('node:fs'); } catch { fs = null; }

  function pump() {
    if (stopped || !fs) return;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= lastSize) return;
      const fd = fs.openSync(filePath, 'r');
      try {
        const length = stat.size - lastSize;
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, lastSize);
        lastSize = stat.size;
        const entries = parseNDJSON(buf.toString('utf8'));
        for (const e of entries) {
          try { onEvent(e); } catch { /* handler-side error swallowed */ }
        }
      } finally {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    } catch { /* file gone or unreadable */ }
  }

  return {
    start() {
      try {
        if (fs.existsSync(filePath)) lastSize = fs.statSync(filePath).size;
      } catch { lastSize = 0; }
    },
    pump,
    stop() { stopped = true; },
    get _state() { return { lastSize, stopped }; },
  };
}

module.exports = {
  ROUTING_RULES,
  DEFAULT_CHANNEL,
  routeJournalEvent,
  renderJournalSummary,
  parseNDJSON,
  makeTailFollower,
};
