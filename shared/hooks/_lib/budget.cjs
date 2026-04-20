// cortex-x budget tracking — estimates + records LLM spend per session.
//
// Called by post-tool-use.cjs when Agent/Task tool results arrive (to append
// usage rows), and by auto-orchestrate.cjs on UserPromptSubmit (to read session
// totals and surface warnings). Hard enforcement is not possible from hooks —
// they cannot cancel Agent dispatch pre-flight with cost reasoning — so this
// layer is observability + soft-gate. Claude sees the running total via
// additionalContext and is trusted to respect it.
//
// Grounded in: standards/auto-orchestration.md (Anthropic multi-agent paper
// cites ~15× token cost; Cursor runaway-agent incidents $47k/3d make
// observability non-optional).

const fs = require('fs');
const path = require('path');

// Per 1M tokens, input/output. Published pricing snapshot — refresh on
// major-tag bumps so estimates don't drift. Falls back to DEFAULT_PRICE if
// model unknown (Sonnet-tier conservative default).
const MODEL_PRICES = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4.7': { input: 15, output: 75 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4.6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4.6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.80, output: 4 },
  'claude-haiku-4.5': { input: 0.80, output: 4 },
};
const DEFAULT_PRICE = { input: 3, output: 15 };

function priceFor(model) {
  if (!model) return DEFAULT_PRICE;
  return MODEL_PRICES[model] || MODEL_PRICES[String(model).toLowerCase()] || DEFAULT_PRICE;
}

function estimateCostUsd(model, input_tokens, output_tokens) {
  const p = priceFor(model);
  const i = Number(input_tokens) || 0;
  const o = Number(output_tokens) || 0;
  return (i * p.input + o * p.output) / 1_000_000;
}

function budgetFile(cortexRoot) {
  return path.join(cortexRoot, 'journal', '.budget.jsonl');
}

function recordUsage(cortexRoot, payload) {
  if (!cortexRoot) return null;
  const entry = {
    ts: new Date().toISOString(),
    session_id: (payload && payload.session_id) || 'unknown',
    model: (payload && payload.model) || 'unknown',
    input_tokens: Number(payload && payload.input_tokens) || 0,
    output_tokens: Number(payload && payload.output_tokens) || 0,
    operation: (payload && payload.operation) || 'unknown',
    cost_usd: estimateCostUsd(
      payload && payload.model,
      payload && payload.input_tokens,
      payload && payload.output_tokens
    ),
  };
  try {
    const f = budgetFile(cortexRoot);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch (_) {
    // Silent — observability must never break a session. Failures surface
    // only through the existing .hook-errors.log path via the caller.
  }
  return entry;
}

function sessionTotal(cortexRoot, session_id) {
  const zero = { cost_usd: 0, tokens: 0, count: 0 };
  if (!cortexRoot || !session_id) return zero;
  try {
    const f = budgetFile(cortexRoot);
    if (!fs.existsSync(f)) return zero;
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    let cost = 0, tokens = 0, count = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.session_id !== session_id) continue;
        cost += Number(e.cost_usd) || 0;
        tokens += (Number(e.input_tokens) || 0) + (Number(e.output_tokens) || 0);
        count++;
      } catch (_) {}
    }
    return { cost_usd: cost, tokens, count };
  } catch (_) {
    return zero;
  }
}

function lastSessionSummary(cortexRoot) {
  // Returns the most-recent N rows across ALL sessions so session-start can
  // surface "last session burned $X". Caller picks the session-id grouping.
  const out = { rows: [], totalBySession: {} };
  if (!cortexRoot) return out;
  try {
    const f = budgetFile(cortexRoot);
    if (!fs.existsSync(f)) return out;
    const content = fs.readFileSync(f, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-500);
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        out.rows.push(e);
        const sid = e.session_id || 'unknown';
        if (!out.totalBySession[sid]) {
          out.totalBySession[sid] = { cost_usd: 0, tokens: 0, count: 0, last_ts: '' };
        }
        out.totalBySession[sid].cost_usd += Number(e.cost_usd) || 0;
        out.totalBySession[sid].tokens +=
          (Number(e.input_tokens) || 0) + (Number(e.output_tokens) || 0);
        out.totalBySession[sid].count += 1;
        if ((e.ts || '') > out.totalBySession[sid].last_ts) {
          out.totalBySession[sid].last_ts = e.ts || '';
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

function getCapUsd() {
  const env = parseFloat(process.env.CORTEX_SESSION_BUDGET_USD);
  return Number.isFinite(env) && env > 0 ? env : 5.0;
}

function warningLevel(cost_usd, cap_usd) {
  if (!Number.isFinite(cost_usd) || !Number.isFinite(cap_usd) || cap_usd <= 0) return 'ok';
  if (cost_usd >= cap_usd) return 'over';
  if (cost_usd >= cap_usd * 0.8) return 'warning';
  return 'ok';
}

// Opt-out for flat-subscription users (Claude Max / Teams / Enterprise) where
// token-cost warnings are noise — they pay a flat fee, not per token.
// Set CORTEX_BUDGET_DISABLED=1 to suppress budget UI in auto-orchestrate,
// session-start, and skip budget.jsonl writes in post-tool-use. The `journal/`
// activity log (privacy-safe tool metadata) is unaffected.
function isBudgetDisabled() {
  return process.env.CORTEX_BUDGET_DISABLED === '1';
}

module.exports = {
  MODEL_PRICES,
  DEFAULT_PRICE,
  priceFor,
  estimateCostUsd,
  recordUsage,
  sessionTotal,
  lastSessionSummary,
  getCapUsd,
  warningLevel,
  isBudgetDisabled,
  budgetFile,
};
