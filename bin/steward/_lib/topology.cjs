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
// R2 edge-case HIGH-3 (2026-05-14): freeze so a malicious or careless
// downstream module can't `.push('distributed')` and silently expand the
// accepted topology set across the whole codebase.
const VALID_TOPOLOGIES = Object.freeze(['serial', 'parallel']);
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

// R2 security HIGH-1 (2026-05-14): tag-encode known typed objects so Date /
// Buffer / RegExp / Map / Set / TypedArray don't all serialize as '{}' and
// produce phantom fingerprint collisions. Reject non-plain objects to close
// the prototype-pollution surface. Strip dangerous keys (`__proto__`,
// `constructor`, `prototype`) before recursing.
// R2 edge-case HIGH-1 (2026-05-14): WeakSet `seen` guards against circular
// references — without it `a.self = a` triggered stack overflow.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function canonicalize(value, seen) {
  if (seen === undefined) seen = new WeakSet();
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFKC'));
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return 'BI:' + value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`canonicalize: refuses to serialize ${typeof value}`);
  }
  // Tag-encode well-known typed objects so they don't all collide as '{}'.
  if (value instanceof Date) return 'D:' + value.toISOString();
  if (Buffer && Buffer.isBuffer && Buffer.isBuffer(value)) return 'B:' + value.toString('hex');
  if (value instanceof RegExp) return 'R:' + value.source + ':' + value.flags;
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [canonicalize(k), canonicalize(v)]);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return 'M:[' + entries.map((e) => e[0] + ':' + e[1]).join(',') + ']';
  }
  if (value instanceof Set) {
    const items = [...value].map((v) => canonicalize(v));
    items.sort();
    return 'S:[' + items.join(',') + ']';
  }
  if (ArrayBuffer.isView(value)) {
    return 'TA:' + value.constructor.name + ':' + Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex');
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('canonicalize: circular reference');
    seen.add(value);
    return '[' + value.map((v) => canonicalize(v, seen)).join(',') + ']';
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('canonicalize: circular reference');
    seen.add(value);
    // R2 security HIGH-1: reject non-plain objects to close the
    // prototype-walk + collision surface. Subclasses of Object are
    // explicitly rejected (caller can pre-serialize them if intentional).
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      throw new Error(`canonicalize: refuses to serialize non-plain object (proto=${proto && proto.constructor && proto.constructor.name})`);
    }
    // Use only OWN enumerable string keys; strip dangerous keys.
    const keys = Object.keys(value).filter((k) => !DANGEROUS_KEYS.has(k)).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k], seen)).join(',') + '}';
  }
  throw new Error(`canonicalize: unsupported value type (${typeof value})`);
}

// ── Judge position-bias mitigation ────────────────────────────────────────

function randomizeJudgeOrder(workerOutputs, rng) {
  // Fisher-Yates shuffle of worker outputs before sending to judge LLM.
  // Returns NEW array + an inverse-permutation array so caller can map the
  // judge's pick back to the original worker index. NEVER mutates input.
  //
  // RNG defaults to Math.random; tests inject a deterministic RNG.
  // R2 edge-case HIGH-2 (2026-05-14): rng must return [0,1). Defensive clamp
  // via Math.min keeps the swap in-bounds even when an RNG returns exactly
  // 1.0 (some seeded PRNGs do) or NaN (clamps to 0, no swap).
  if (!Array.isArray(workerOutputs)) {
    throw new Error('randomizeJudgeOrder: workerOutputs must be array');
  }
  const seed = rng || Math.random;
  const indices = workerOutputs.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const r = seed();
    // Clamp r to [0, 1) defensively: NaN/Infinity/negative -> 0; >=1 -> just below 1.
    const safeR = Number.isFinite(r) && r >= 0 && r < 1 ? r : (Number.isFinite(r) && r >= 1 ? 0.9999999999 : 0);
    const j = Math.floor(safeR * (i + 1));
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
  // R2 security HIGH-4 (2026-05-14): read via hasOwnProperty so a polluted
  // Object.prototype.topology_safe cannot silently flip every entry to
  // 'parallel'.
  if (kindEntry === null || kindEntry === undefined) {
    return { ok: false, topology: 'serial', reason: `unknown action_kind '${actionKind}'` };
  }
  const hasOwn = Object.prototype.hasOwnProperty.call(kindEntry, 'topology_safe');
  if (!hasOwn) {
    return { ok: true, topology: 'serial', reason: 'default (back-compat)' };
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
