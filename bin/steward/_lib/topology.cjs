// topology.cjs — Sprint 2.2 v0 foundation: multi-agent supervisor/worker primitives.
//
// Purpose: pure utilities (no spawning, no LLM, no filesystem mutation) that
// codify the contracts the Sprint 2.2 spawner (v1) will use:
//
//   1. parseTreeBudgetCap(env) — STEWARD_TREE_USD_CAP parsing with clamp +
//      default. Per-tree token budget is the 4th window alongside D/W/M caps.
//   2. canonicalizeWorkerInput(plan, criterionId) — deterministic SHA-256
//      fingerprint for cross-tree loop detector. Two workers reaching the
//      same canonicalized state in a 24h window = loop signal.
//   3. randomizeJudgeOrder(workerOutputs, rng) — Fisher-Yates shuffle of
//      worker outputs before they reach the judge LLM. Mitigates judge
//      position bias (LLM judges over-weight first option per Liu et al
//      2024 + Monte Carlo 2026).
//   4. validateTopologySafe(actionKind, kindEntry) — assert the action_kind
//      registry entry's topology_safe field is 'serial' (default) or
//      'parallel' (opt-in). Empty/null treated as 'serial' for back-compat.
//
// R1 memo: docs/research/sprint-2.2-worktree-supervisor-2026-05-14.md
// Standard: standards/multi-agent-supervisor.md
//
// Sprint 2.2 v0 ships THESE UTILITIES ONLY. The actual spawner
// (`runSupervisor` + `runWorker` + git worktree integration + judge
// LLM invocation) is Sprint 2.2.1 territory. Shipping the foundation
// first lets the operator review the contracts before any worker
// process spawns.

'use strict';

const crypto = require('node:crypto');

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_TREE_USD_CAP = 1.5;          // R1 anthill memo: ~2× single-call dogfood
const TREE_USD_CAP_MIN = 0.10;
const TREE_USD_CAP_MAX = 10.0;
const VALID_TOPOLOGIES = ['serial', 'parallel'];
const LOOP_DETECTOR_WINDOW_HOURS = 24;
const LOOP_DETECTOR_THRESHOLD = 3;         // 3× same canonical input in 24h → halt

// ── Tree budget cap parser ────────────────────────────────────────────────

function parseTreeBudgetCap(env) {
  // Accepts a string (env-var-shaped) OR a number. Clamps to [MIN, MAX].
  // Returns DEFAULT on missing/invalid input (fail-open with conservative
  // default, NOT fail-closed — operator might forget to set the env in a
  // dogfood run and the cap shape still applies).
  const raw = env && env.STEWARD_TREE_USD_CAP;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TREE_USD_CAP;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TREE_USD_CAP;
  if (n < TREE_USD_CAP_MIN) return TREE_USD_CAP_MIN;
  if (n > TREE_USD_CAP_MAX) return TREE_USD_CAP_MAX;
  return n;
}

// ── Cross-tree loop detector input canonicalization ───────────────────────

function canonicalizeWorkerInput(plan, criterionId) {
  // Produces a stable SHA-256 fingerprint of the worker's effective input.
  // Two workers reaching the same fingerprint in `LOOP_DETECTOR_WINDOW_HOURS`
  // is the cross-tree-ping-pong signal the $47K LangChain incident (Sept 2025)
  // would have caught with this primitive.
  //
  // Stability requirements:
  //   - Object key order ignored (canonical JSON via sorted keys)
  //   - undefined values stripped (treated as absence)
  //   - Numbers normalized via Number.toString (no trailing zeros)
  //   - Strings NFKC-normalized to fold Unicode lookalikes (Sprint 2.25.1 pattern)
  if (plan === null || plan === undefined) {
    throw new Error('canonicalizeWorkerInput: plan is required');
  }
  if (typeof criterionId !== 'string' || criterionId.length === 0) {
    throw new Error('canonicalizeWorkerInput: criterionId must be non-empty string');
  }
  const canonical = canonicalize({ plan, criterionId });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(value) {
  // Stable string serialization. Sort object keys; preserve array order.
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFKC'));
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  return JSON.stringify(String(value));
}

// ── Judge position-bias mitigation ────────────────────────────────────────

function randomizeJudgeOrder(workerOutputs, rng) {
  // Fisher-Yates shuffle of worker outputs before sending to judge LLM.
  // Returns NEW array + an inverse-permutation array so caller can map the
  // judge's pick back to the original worker index. NEVER mutates input.
  //
  // RNG defaults to Math.random; tests inject a deterministic RNG.
  if (!Array.isArray(workerOutputs)) {
    throw new Error('randomizeJudgeOrder: workerOutputs must be array');
  }
  const seed = rng || Math.random;
  const indices = workerOutputs.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(seed() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = indices.map((origIdx) => workerOutputs[origIdx]);
  // shuffled[k] === workerOutputs[indices[k]] — to map judge pick `k` back to
  // original index, use `indices[k]`.
  return { shuffled, originalIndexAt: indices };
}

// ── Action-kind topology field validator ──────────────────────────────────

function validateTopologySafe(actionKind, kindEntry) {
  // Asserts the registry entry's topology_safe field is valid. Missing
  // field treated as 'serial' (back-compat — existing 19 action_kinds
  // remain serial-only until explicitly opted into parallel topology).
  if (kindEntry === null || kindEntry === undefined) {
    return { ok: false, topology: 'serial', reason: `unknown action_kind '${actionKind}'` };
  }
  const raw = kindEntry.topology_safe;
  if (raw === undefined || raw === null) {
    return { ok: true, topology: 'serial', reason: 'default (back-compat)' };
  }
  if (!VALID_TOPOLOGIES.includes(raw)) {
    return { ok: false, topology: 'serial', reason: `topology_safe must be one of ${VALID_TOPOLOGIES.join('|')}, got '${raw}'` };
  }
  return { ok: true, topology: raw, reason: 'explicit' };
}

// ── Loop detector fingerprint cache shape ─────────────────────────────────

function isFingerprintCacheKeyValid(key) {
  // Cache keys are `${criterionId}::${sha256}`. Both halves must be
  // non-empty + sha must be 64 hex chars.
  if (typeof key !== 'string') return false;
  const sep = key.indexOf('::');
  if (sep === -1 || sep === 0) return false;
  const sha = key.slice(sep + 2);
  return /^[0-9a-f]{64}$/.test(sha);
}

module.exports = {
  // Constants
  DEFAULT_TREE_USD_CAP,
  TREE_USD_CAP_MIN,
  TREE_USD_CAP_MAX,
  VALID_TOPOLOGIES,
  LOOP_DETECTOR_WINDOW_HOURS,
  LOOP_DETECTOR_THRESHOLD,
  // Functions
  parseTreeBudgetCap,
  canonicalizeWorkerInput,
  canonicalize,
  randomizeJudgeOrder,
  validateTopologySafe,
  isFingerprintCacheKeyValid,
};
