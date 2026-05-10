// llm-judge-schema.cjs — Sprint 2.11.2 Correctness H2 fix.
//
// Deep-type validator for the senior_tester_review Phase B LLM-judge JSON
// envelope. Replaces the prior presence-only key check (which would accept
// e.g. `summary: 42` or `ranked_findings: "not an array"`).
//
// Zero-deps. Mirrors the small footprint of an inline Zod-style validator
// without pulling in zod itself. Each schema rule is one function returning
// `{ ok: true }` or `{ ok: false, code: 'JUDGE_FIELD_INVALID', path: '<dot.path>', error: '<msg>' }`.
//
// The outer validator runs every rule and returns the first failure (deterministic
// shape across providers — operators see "first wrong field" rather than a list
// of grumbles).
//
// Reference: senior_tester_review Phase B JUDGE_SYSTEM_PROMPT in
// bin/steward/_lib/senior-tester-action.cjs (the schema this validates).

'use strict';

const registry = require('./test-smell-registry.cjs');

const SEVERITIES = new Set(['high', 'medium', 'low']);

// ─── Type-shape primitives ──────────────────────────────────────────────────

function isString(v) { return typeof v === 'string'; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
function isNonNegInt(v) { return Number.isInteger(v) && v >= 0; }
function isArray(v) { return Array.isArray(v); }
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
// Sprint 2.11.2 R2 edge-hunter MEDIUM: whitespace-only strings previously
// passed `length > 0` checks. A judge returning `summary: '   '` is
// content-vacuous; treat as invalid.
function isNonEmptyString(v, max) {
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  if (trimmed.length === 0) return false;
  if (typeof max === 'number' && v.length > max) return false;
  return true;
}

// ─── Field-level rules ──────────────────────────────────────────────────────
//
// Each rule: rule(judge, ctx) -> { ok: true } | { ok: false, code, path, error }.

function ruleSummary(judge) {
  if (!isString(judge.summary)) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'summary', error: 'must be string' };
  }
  if (!isNonEmptyString(judge.summary, 4000)) {
    return {
      ok: false,
      code: 'JUDGE_FIELD_INVALID',
      path: 'summary',
      error: judge.summary.length > 4000 ? 'exceeds 4000 chars' : 'must be non-empty (whitespace-only rejected)',
    };
  }
  return { ok: true };
}

function ruleStrategicGaps(judge) {
  const gaps = judge.top_3_strategic_gaps;
  if (!isArray(gaps)) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'top_3_strategic_gaps', error: 'must be array' };
  }
  // Soft floor: prompt asks for 3, but accept 1-5. Empty is meaningless.
  if (gaps.length === 0) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'top_3_strategic_gaps', error: 'must have at least 1 entry' };
  }
  if (gaps.length > 10) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'top_3_strategic_gaps', error: 'exceeds 10 entries' };
  }
  for (let i = 0; i < gaps.length; i++) {
    if (!isString(gaps[i])) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `top_3_strategic_gaps[${i}]`, error: 'must be string' };
    }
    if (!isNonEmptyString(gaps[i], 500)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `top_3_strategic_gaps[${i}]`, error: 'must be 1-500 non-whitespace chars' };
    }
  }
  return { ok: true };
}

function ruleRankedFindings(judge, ctx) {
  const findings = judge.ranked_findings;
  if (!isArray(findings)) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'ranked_findings', error: 'must be array' };
  }
  // Empty allowed — judge may legitimately conclude no rankings worth surfacing.
  if (findings.length > 50) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'ranked_findings', error: 'exceeds 50 entries' };
  }
  const validIds = ctx.validSmellIds;
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const base = `ranked_findings[${i}]`;
    if (!isPlainObject(f)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: base, error: 'must be object' };
    }
    if (!isString(f.smell_id) || f.smell_id.length === 0) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.smell_id`, error: 'must be non-empty string' };
    }
    if (!validIds.has(f.smell_id)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.smell_id`, error: `unknown smell id: ${f.smell_id}` };
    }
    if (!isString(f.file) || f.file.length === 0) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.file`, error: 'must be non-empty string' };
    }
    if (!isNonNegInt(f.line)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.line`, error: 'must be non-negative integer' };
    }
    if (!isString(f.severity) || !SEVERITIES.has(f.severity)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.severity`, error: `must be one of high|medium|low (got: ${f.severity})` };
    }
    if (!isNonEmptyString(f.rationale, 1000)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.rationale`, error: 'must be 1-1000 non-whitespace chars' };
    }
    if (!isNonEmptyString(f.fix_strategy, 500)) {
      return { ok: false, code: 'JUDGE_FIELD_INVALID', path: `${base}.fix_strategy`, error: 'must be 1-500 non-whitespace chars' };
    }
  }
  return { ok: true };
}

function ruleLayerBalance(judge) {
  if (!isString(judge.layer_balance_assessment)) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'layer_balance_assessment', error: 'must be string' };
  }
  if (!isNonEmptyString(judge.layer_balance_assessment, 2000)) {
    return {
      ok: false,
      code: 'JUDGE_FIELD_INVALID',
      path: 'layer_balance_assessment',
      error: judge.layer_balance_assessment.length > 2000 ? 'exceeds 2000 chars' : 'must be non-empty (whitespace-only rejected)',
    };
  }
  return { ok: true };
}

function ruleEffortHours(judge) {
  // Optional field per prompt — if present, must be a non-negative finite number.
  if (!('estimated_effort_hours' in judge)) return { ok: true };
  if (!isFiniteNumber(judge.estimated_effort_hours) || judge.estimated_effort_hours < 0) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'estimated_effort_hours', error: 'must be non-negative finite number' };
  }
  if (judge.estimated_effort_hours > 10000) {
    return { ok: false, code: 'JUDGE_FIELD_INVALID', path: 'estimated_effort_hours', error: 'exceeds 10000 hours (likely hallucinated unit)' };
  }
  return { ok: true };
}

const RULES = [
  ruleSummary,
  ruleStrategicGaps,
  ruleRankedFindings,
  ruleLayerBalance,
  ruleEffortHours,
];

// ─── Public API ─────────────────────────────────────────────────────────────

function validateJudge(judge) {
  if (!isPlainObject(judge)) {
    return { ok: false, code: 'JUDGE_SHAPE_INVALID', path: '$', error: 'envelope must be a JSON object' };
  }
  const ctx = { validSmellIds: new Set(registry.listSmellIds()) };
  for (const rule of RULES) {
    const r = rule(judge, ctx);
    if (!r.ok) return r;
  }
  return { ok: true };
}

module.exports = {
  validateJudge,
  // Exported for test-time inspection
  RULES,
  ruleSummary,
  ruleStrategicGaps,
  ruleRankedFindings,
  ruleLayerBalance,
  ruleEffortHours,
};
