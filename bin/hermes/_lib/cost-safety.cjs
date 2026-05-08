// cost-safety.cjs — Sprint 1.9.1 multi-window cost safety + loop detector.
//
// Pre-flight gate primitives layered ABOVE the existing daily cap +
// per-action_key failure breaker (which live in execute.cjs and remain the
// authoritative entry points for backward compat). This module provides:
//
//   - readSpendInWindow(slug, sinceMs)       → sum cost_usd in window
//   - readDailySpend(slug)                   → today's calendar-day spend
//   - readWeeklySpend(slug)                  → last 7 days sliding
//   - readMonthlySpend(slug)                 → calendar-month spend
//   - readTokenVelocity(slug, windowMs)      → tokens in last windowMs
//   - detectCriterionLoop(slug, criterionId, actionKey, windowDays, threshold)
//                                            → count of SPEC_VIOLATION entries
//                                              with the same criterion id
//
// All functions are pure-read over the journal — no mutations, no side
// effects. execute.cjs orchestrates the actual gate decisions and halt-write.
//
// Defaults (env-overridable):
//   HERMES_DAILY_USD_CAP        = 5    (existing in execute.cjs)
//   HERMES_WEEKLY_USD_CAP       = 25   (NEW)
//   HERMES_MONTHLY_USD_CAP      = 80   (NEW)
//   HERMES_TOKEN_VELOCITY_CAP   = 50000 tokens / 5min (NEW)
//   HERMES_LOOP_THRESHOLD       = 5    (NEW — same criterion 5x in window)
//   HERMES_LOOP_WINDOW_DAYS     = 7    (NEW)
//
// Each cap honors `0` as explicit opt-out. Negative + NaN values reset to
// the documented default.

'use strict';

const journal = require('./journal.cjs');

const DEFAULT_DAILY_USD_CAP = 5;
const DEFAULT_WEEKLY_USD_CAP = 25;
const DEFAULT_MONTHLY_USD_CAP = 80;
const DEFAULT_TOKEN_VELOCITY_CAP = 50_000;
const DEFAULT_TOKEN_VELOCITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LOOP_THRESHOLD = 5;
const DEFAULT_LOOP_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Env readers — coerce + clamp fail-open to documented default
// ─────────────────────────────────────────────────────────────────────────────

function readEnvFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n; // 0 honored as explicit opt-out
}

function readEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readWeeklyCap() { return readEnvFloat('HERMES_WEEKLY_USD_CAP', DEFAULT_WEEKLY_USD_CAP); }
function readMonthlyCap() { return readEnvFloat('HERMES_MONTHLY_USD_CAP', DEFAULT_MONTHLY_USD_CAP); }
function readTokenVelocityCap() { return readEnvInt('HERMES_TOKEN_VELOCITY_CAP', DEFAULT_TOKEN_VELOCITY_CAP); }
function readLoopThreshold() { return readEnvInt('HERMES_LOOP_THRESHOLD', DEFAULT_LOOP_THRESHOLD); }
function readLoopWindowDays() { return readEnvInt('HERMES_LOOP_WINDOW_DAYS', DEFAULT_LOOP_WINDOW_DAYS); }

// ─────────────────────────────────────────────────────────────────────────────
// Window readers — read journal entries spanning N days back
// ─────────────────────────────────────────────────────────────────────────────

// Read all journal entries from `daysBack` days ago through today (inclusive).
// Returns flat array; corrupted entries skipped.
function readEntriesSince(slug, daysBack) {
  const out = [];
  const today = Date.now();
  for (let i = 0; i <= daysBack; i += 1) {
    const ts = today - i * DAY_MS;
    const d = new Date(ts).toISOString().slice(0, 10);
    const entries = journal.readJournal(slug, { date: d });
    for (const e of entries) {
      if (!e._corrupted) out.push(e);
    }
  }
  return out;
}

// Sum cost_usd across journal entries with ts >= sinceMs.
function readSpendInWindow(slug, sinceMs) {
  // Compute how many days back we need to scan (with 1-day slack for tz drift).
  const daysBack = Math.max(0, Math.ceil((Date.now() - sinceMs) / DAY_MS) + 1);
  const entries = readEntriesSince(slug, daysBack);
  let spent = 0;
  for (const e of entries) {
    if (typeof e.cost_usd !== 'number' || e.cost_usd <= 0) continue;
    if (typeof e.ts !== 'string') continue;
    const tsMs = Date.parse(e.ts);
    if (!Number.isFinite(tsMs) || tsMs < sinceMs) continue;
    spent += e.cost_usd;
  }
  return spent;
}

function readDailySpend(slug) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = journal.readJournal(slug, { date: today });
  let spent = 0;
  for (const e of entries) {
    if (e._corrupted) continue;
    if (typeof e.cost_usd !== 'number' || e.cost_usd <= 0) continue;
    if (typeof e.ts !== 'string' || !e.ts.startsWith(today)) continue;
    spent += e.cost_usd;
  }
  return spent;
}

function readWeeklySpend(slug) {
  // Sliding 7-day window (not calendar-week — operator-friendly).
  return readSpendInWindow(slug, Date.now() - 7 * DAY_MS);
}

function readMonthlySpend(slug) {
  // Calendar month — first-of-month UTC midnight.
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0);
  return readSpendInWindow(slug, monthStart);
}

// Tokens (in + out) consumed in the last `windowMs` milliseconds.
function readTokenVelocity(slug, windowMs = DEFAULT_TOKEN_VELOCITY_WINDOW_MS) {
  const since = Date.now() - windowMs;
  // ceil(ms / DAY_MS) → number of journal-day files to scan (typically 1).
  const daysBack = Math.max(0, Math.ceil(windowMs / DAY_MS));
  const entries = readEntriesSince(slug, daysBack);
  let tokensIn = 0;
  let tokensOut = 0;
  for (const e of entries) {
    if (typeof e.ts !== 'string') continue;
    const tsMs = Date.parse(e.ts);
    if (!Number.isFinite(tsMs) || tsMs < since) continue;
    if (typeof e.tokens_in === 'number' && e.tokens_in > 0) tokensIn += e.tokens_in;
    if (typeof e.tokens_out === 'number' && e.tokens_out > 0) tokensOut += e.tokens_out;
  }
  return { tokensIn, tokensOut, total: tokensIn + tokensOut, windowMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop detection — repeated SPEC_VIOLATION on same criterion id
// ─────────────────────────────────────────────────────────────────────────────

// Walk last `windowDays` of journal, count entries with spec_failures[].id ==
// criterionId for the given action_key. If actionKey is null, count across all
// action_keys (broader pattern detection).
function countCriterionFailures(slug, criterionId, actionKey, windowDays = DEFAULT_LOOP_WINDOW_DAYS) {
  if (!criterionId) return 0;
  const entries = readEntriesSince(slug, windowDays);
  let count = 0;
  for (const e of entries) {
    if (!Array.isArray(e.spec_failures) || e.spec_failures.length === 0) continue;
    if (actionKey && e.action_key !== actionKey) continue;
    for (const f of e.spec_failures) {
      if (f && f.id === criterionId) {
        count += 1;
        break; // count entry once even if multiple failures in same entry
      }
    }
  }
  return count;
}

// Returns { tripped, criterionId, actionKey, count, threshold } for the FIRST
// criterion that meets or exceeds the threshold. If multiple criteria are
// looping, the first one found is reported. Halt is operator-cleared.
function detectCriterionLoop(slug, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : readLoopThreshold();
  if (threshold === 0) return { tripped: false, reason: 'loop-detector disabled' };
  const windowDays = opts.windowDays !== undefined ? opts.windowDays : readLoopWindowDays();

  const entries = readEntriesSince(slug, windowDays);
  // Count by composite key: criterionId × action_key
  const counts = new Map();
  for (const e of entries) {
    if (!Array.isArray(e.spec_failures) || e.spec_failures.length === 0) continue;
    const ak = e.action_key || '<no-action-key>';
    for (const f of e.spec_failures) {
      if (!f || !f.id) continue;
      const key = `${f.id}::${ak}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      break; // one entry contributes once per criterion id
    }
  }
  for (const [key, count] of counts) {
    if (count >= threshold) {
      const sep = key.lastIndexOf('::');
      return {
        tripped: true,
        criterionId: key.slice(0, sep),
        actionKey: key.slice(sep + 2),
        count,
        threshold,
        windowDays,
      };
    }
  }
  return { tripped: false, threshold, windowDays };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate evaluators — return { ok, code?, ...context }
// ─────────────────────────────────────────────────────────────────────────────

function checkWeeklyBudget(slug) {
  const cap = readWeeklyCap();
  if (cap === 0) return { ok: true, cap: 0, spent: 0, reason: 'cap disabled' };
  const spent = readWeeklySpend(slug);
  if (spent >= cap) {
    return { ok: false, code: 'BUDGET_WEEKLY_CAP_REACHED', cap, spent };
  }
  return { ok: true, cap, spent };
}

function checkMonthlyBudget(slug) {
  const cap = readMonthlyCap();
  if (cap === 0) return { ok: true, cap: 0, spent: 0, reason: 'cap disabled' };
  const spent = readMonthlySpend(slug);
  if (spent >= cap) {
    return { ok: false, code: 'BUDGET_MONTHLY_CAP_REACHED', cap, spent };
  }
  return { ok: true, cap, spent };
}

function checkTokenVelocity(slug, opts = {}) {
  const cap = opts.cap !== undefined ? opts.cap : readTokenVelocityCap();
  if (cap === 0) return { ok: true, cap: 0, total: 0, reason: 'cap disabled' };
  const windowMs = opts.windowMs || DEFAULT_TOKEN_VELOCITY_WINDOW_MS;
  const v = readTokenVelocity(slug, windowMs);
  if (v.total >= cap) {
    return { ok: false, code: 'TOKEN_VELOCITY_CAP_REACHED', cap, ...v };
  }
  return { ok: true, cap, ...v };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forecast — extrapolate end-of-window spend at current rate
// ─────────────────────────────────────────────────────────────────────────────

// Returns { daily, weekly, monthly } each with { spent, cap, projected, percent }.
// projected is "current rate × days remaining in window." If cap === 0
// (disabled), projected is omitted.
function spendForecast(slug) {
  const now = new Date();
  const out = {};

  // Daily
  const dailyCap = readEnvFloat('HERMES_DAILY_USD_CAP', DEFAULT_DAILY_USD_CAP);
  const dailySpent = readDailySpend(slug);
  out.daily = { spent: dailySpent, cap: dailyCap };
  if (dailyCap > 0) {
    out.daily.percent = dailySpent / dailyCap;
    // Daily forecast: today's spend × (24h / hours-elapsed-today). If we're
    // 6h into the day, projected = spent × 4.
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const hoursElapsed = (Date.now() - startOfToday) / (60 * 60 * 1000);
    if (hoursElapsed > 0.1) {
      out.daily.projected = (dailySpent * 24) / Math.max(hoursElapsed, 1);
    }
  }

  // Weekly
  const weeklyCap = readWeeklyCap();
  const weeklySpent = readWeeklySpend(slug);
  out.weekly = { spent: weeklySpent, cap: weeklyCap };
  if (weeklyCap > 0) out.weekly.percent = weeklySpent / weeklyCap;
  // Weekly forecast: current rate × 7 days from now. Sliding window so no
  // hard end — extrapolate "if we keep spending at this 7-day rate, where
  // would we be at end of next 7 days." Effectively spent × 1 (already a
  // 7-day window); the percent vs cap is the more useful number.

  // Monthly
  const monthlyCap = readMonthlyCap();
  const monthlySpent = readMonthlySpend(slug);
  out.monthly = { spent: monthlySpent, cap: monthlyCap };
  if (monthlyCap > 0) {
    out.monthly.percent = monthlySpent / monthlyCap;
    // Monthly forecast: spent × (days-in-month / days-elapsed-this-month)
    const dayOfMonth = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    if (dayOfMonth >= 1) {
      out.monthly.projected = (monthlySpent * daysInMonth) / dayOfMonth;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Spend readers
  readSpendInWindow,
  readDailySpend,
  readWeeklySpend,
  readMonthlySpend,
  // Velocity reader
  readTokenVelocity,
  // Loop detection
  countCriterionFailures,
  detectCriterionLoop,
  // Gate evaluators
  checkWeeklyBudget,
  checkMonthlyBudget,
  checkTokenVelocity,
  // Forecast
  spendForecast,
  // Env readers (exposed for tests)
  readWeeklyCap,
  readMonthlyCap,
  readTokenVelocityCap,
  readLoopThreshold,
  readLoopWindowDays,
  // Constants (exposed for docs / tests)
  DEFAULT_DAILY_USD_CAP,
  DEFAULT_WEEKLY_USD_CAP,
  DEFAULT_MONTHLY_USD_CAP,
  DEFAULT_TOKEN_VELOCITY_CAP,
  DEFAULT_TOKEN_VELOCITY_WINDOW_MS,
  DEFAULT_LOOP_THRESHOLD,
  DEFAULT_LOOP_WINDOW_DAYS,
};
