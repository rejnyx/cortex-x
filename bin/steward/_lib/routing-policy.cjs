// routing-policy.cjs — Sprint 2.0b per-action USD cap + journal scan.
//
// Sibling to routing-table.cjs. Routing-table answers "which model";
// routing-policy answers "is this action allowed to spend more right now".
// Layered above existing daily/weekly/monthly caps (Sprint 1.6.19 + 1.9.1).
//
// Per-action cap rationale (R1 memo §4.3): ensemble profile fans out 3
// workers + judge in a single run — a single retry on a poisoned action
// can spike spend faster than daily cap detects. Per-action cap closes
// that hole at the action_kind boundary before lock acquisition.
//
// Cap precedence (low to high):
//   1. STEWARD_PER_ACTION_USD_CAP env (default $1.00) — global ceiling.
//   2. STEWARD_PER_ACTION_USD_CAP_<KIND> env (e.g.
//      STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION=0.05) — per-kind override.
//
// Disabled when the resolved cap is 0 (operator opts out) or not a number.

'use strict';

const { readEnv } = require('./env.cjs');
const journal = require('./journal.cjs');

const DEFAULT_PER_ACTION_USD_CAP = 1.0; // $1 per single action_kind invocation
// Upper bound on env-supplied caps. Defends against accidental ridiculous
// values like `STEWARD_PER_ACTION_USD_CAP=1e308` from typos that would
// effectively disable the gate. $1000/action is far above any legitimate
// operator setting (Sprint 1.9.1's monthly cap is $80).
const MAX_USD_CAP = 1000;

// Strict numeric coercion (correctness-auditor MAJOR finding): use Number()
// not parseFloat() so trailing garbage like "0.5xyz" or "1.0e" is rejected
// instead of silently parsed to 0.5 / 1.0. Reject NaN, Infinity, negative,
// and anything above MAX_USD_CAP.
function coerceUsdCap(raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_USD_CAP) return undefined;
  return n;
}

function readGlobalCap() {
  const raw = readEnv('PER_ACTION_USD_CAP');
  if (raw === undefined) return DEFAULT_PER_ACTION_USD_CAP;
  const coerced = coerceUsdCap(raw);
  if (coerced === undefined) return DEFAULT_PER_ACTION_USD_CAP;
  return coerced; // 0 = explicit opt-out
}

function readKindCap(actionKind) {
  if (!actionKind) return undefined;
  const normalized = String(actionKind)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
  const raw = readEnv(`PER_ACTION_USD_CAP_${normalized}`);
  if (raw === undefined) return undefined;
  return coerceUsdCap(raw);
}

function resolvePerActionCap(actionKind) {
  const kindCap = readKindCap(actionKind);
  if (kindCap !== undefined) return kindCap;
  return readGlobalCap();
}

// Sum cost_usd across journal entries for a given action_kind in the last
// `windowMs` (default 24 h). Reads today's AND yesterday's journal files so
// the window slides cleanly across UTC midnight (correctness-auditor MAJOR
// finding 2026-05-08: pre-fix cap reset to $0 at 00:00 UTC because
// `journal.readJournal(slug)` defaults to today's file only).
//
// Future-timestamp guard (edge-hunter MAJOR): journal entries with `ts` in
// the future (clock skew, NTP step backward, mis-stamped CI runs) are
// skipped — without this, a single mis-stamped entry would lock the cap
// permanently until the file is hand-edited.
//
// Defensive: corrupted journal entries are skipped silently.
function recentSpendForKind(slug, actionKind, opts = {}) {
  if (!slug || !actionKind) return 0;
  const windowMs = opts.windowMs || 24 * 60 * 60 * 1000;
  const now = opts.nowMs || Date.now();
  const cutoff = now - windowMs;
  // 60s tolerance for clock skew between the writer (could be CI runner) and
  // this reader (could be local dev). Beyond that = skip.
  const futureTolerance = 60_000;

  const dates = new Set();
  const today = new Date(now).toISOString().slice(0, 10);
  const cutoffDate = new Date(cutoff).toISOString().slice(0, 10);
  dates.add(today);
  dates.add(cutoffDate);
  // Defensive: when window is e.g. 36h, also include the day before cutoff.
  if (windowMs > 24 * 60 * 60 * 1000) {
    const earlier = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dates.add(earlier);
  }

  let total = 0;
  for (const date of dates) {
    const entries = journal.readJournal(slug, { date });
    for (const e of entries) {
      if (e._corrupted) continue;
      if (e.action_kind !== actionKind) continue;
      if (typeof e.cost_usd !== 'number' || !Number.isFinite(e.cost_usd) || e.cost_usd < 0) continue;
      if (typeof e.ts !== 'string') continue;
      const tsMs = Date.parse(e.ts);
      if (!Number.isFinite(tsMs)) continue;
      if (tsMs < cutoff) continue;
      if (tsMs > now + futureTolerance) continue; // future-skew defense
      total += e.cost_usd;
    }
  }
  return total;
}

// Pre-flight gate — call before attempting an LLM action. Returns ok:true
// when the action is within budget; ok:false with a structured code when
// the cap is reached so execute.cjs can journal + abort cleanly.
function checkPerActionBudget(slug, actionKind, opts = {}) {
  const cap = resolvePerActionCap(actionKind);
  if (cap === 0) {
    return { ok: true, cap: 0, spent: 0, reason: 'cap disabled' };
  }
  const spent = recentSpendForKind(slug, actionKind, opts);
  if (spent >= cap) {
    return {
      ok: false,
      code: 'PER_ACTION_BUDGET_CAP_REACHED',
      cap,
      spent,
      actionKind,
    };
  }
  return { ok: true, cap, spent, actionKind };
}

module.exports = {
  DEFAULT_PER_ACTION_USD_CAP,
  MAX_USD_CAP,
  coerceUsdCap,
  readGlobalCap,
  readKindCap,
  resolvePerActionCap,
  recentSpendForKind,
  checkPerActionBudget,
};
