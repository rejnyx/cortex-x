// SPDX-License-Identifier: Apache-2.0
// r2-verdict.cjs — signed verdict for R2 review pipeline (Sprint 2.46).
//
// HMAC-SHA256 over canonical JSON (RFC 8785 subset). Signer + verifier are
// the same machine principal; Ed25519 deferred to cross-host scenarios.
// Zero npm deps — node:crypto + node:fs + node:path + node:os only.
// Deterministic: timestamp/workflowRunId are INPUTS to buildVerdict.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCHEMA_VERSION = 1;
const SIG_ALG = 'HMAC-SHA256';

// ---------------------------------------------------------------------------
// canonicalize(value) — RFC 8785 JCS subset (strings/numbers/bool/null/obj/arr)
// ---------------------------------------------------------------------------
function canonicalize(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('CORTEX_R2_VERDICT_NON_FINITE_NUMBER');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Match JSON.stringify semantics: undefined array slots serialize as null.
    return (
      '[' +
      value
        .map((v) => (v === undefined ? 'null' : canonicalize(v)))
        .join(',') +
      ']'
    );
  }
  if (typeof value === 'object') {
    // Match JSON.stringify semantics: drop keys whose value is undefined.
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ':' + canonicalize(value[k])
    );
    return '{' + parts.join(',') + '}';
  }
  throw new Error('CORTEX_R2_VERDICT_UNSUPPORTED_TYPE:' + typeof value);
}

// ---------------------------------------------------------------------------
// resolveSecret() — env first, then host-derived fallback for local-dev.
// Returns { secret, source } or { secret: null, source: 'none' } if env unset.
// Caller decides whether to fail-OPEN or fail-CLOSED.
// ---------------------------------------------------------------------------
function resolveSecret() {
  const fromEnv = process.env.CORTEX_R2_VERDICT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    return { secret: fromEnv, source: 'env' };
  }
  // Host-derived fallback: not cryptographically strong against other users
  // on the same machine, but enough for single-operator local continuity.
  const host = os.hostname() || 'unknown-host';
  let user = 'unknown-user';
  try {
    user = os.userInfo().username || 'unknown-user';
  } catch (_) {
    /* userInfo can throw in some sandboxes */
  }
  const fallback = crypto
    .createHash('sha256')
    .update(host + '|' + user)
    .digest('hex');
  return { secret: fallback, source: 'host-derived' };
}

// ---------------------------------------------------------------------------
// signPayload(payload, secret) → hex HMAC-SHA256 over canonical JSON
// ---------------------------------------------------------------------------
function signPayload(payload, secret) {
  const canonical = canonicalize(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(canonical, 'utf8')
    .digest('hex');
}

// ---------------------------------------------------------------------------
// buildVerdict(input) → { ...payload, signature: { alg, value } }
//
// Required: findings, applied, deferred, refuted, sprintId, workflowRunId,
//           agentRoster, timestamp.
// Optional: secret (else resolved via resolveSecret()).
// ---------------------------------------------------------------------------
function buildVerdict(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('CORTEX_R2_VERDICT_INPUT_REQUIRED');
  }
  const {
    findings,
    applied,
    deferred,
    refuted,
    sprintId,
    workflowRunId,
    agentRoster,
    timestamp,
    decision,
    secret: explicitSecret,
  } = input;

  if (!sprintId) throw new Error('CORTEX_R2_VERDICT_MISSING_SPRINT_ID');
  if (!workflowRunId)
    throw new Error('CORTEX_R2_VERDICT_MISSING_WORKFLOW_RUN_ID');
  if (!timestamp) throw new Error('CORTEX_R2_VERDICT_MISSING_TIMESTAMP');
  if (!Array.isArray(agentRoster))
    throw new Error('CORTEX_R2_VERDICT_MISSING_AGENT_ROSTER');
  if (!findings || typeof findings !== 'object')
    throw new Error('CORTEX_R2_VERDICT_MISSING_FINDINGS');
  // Decision is required and explicit — never defaulted. A buggy caller passing
  // `decision: ''` / `undefined` must NOT silently produce a PASS verdict.
  const ALLOWED_DECISIONS = ['PASS', 'FAIL'];
  if (!decision || !ALLOWED_DECISIONS.includes(String(decision))) {
    throw new Error('CORTEX_R2_VERDICT_MISSING_DECISION');
  }

  const payload = {
    schema_version: SCHEMA_VERSION,
    sprint_id: String(sprintId),
    workflow_run_id: String(workflowRunId),
    timestamp: String(timestamp),
    agent_roster: agentRoster.map(String),
    findings: findings,
    applied: Array.isArray(applied) ? applied : [],
    deferred: Array.isArray(deferred) ? deferred : [],
    refuted: Array.isArray(refuted) ? refuted : [],
    decision: String(decision),
  };

  const secret =
    typeof explicitSecret === 'string' && explicitSecret.length > 0
      ? explicitSecret
      : resolveSecret().secret;

  const signatureValue = signPayload(payload, secret);
  return Object.assign({}, payload, {
    signature: { alg: SIG_ALG, value: signatureValue },
  });
}

// ---------------------------------------------------------------------------
// verifyVerdict(json, secret) → { ok, reason, parsed? }
//
// Fail-CLOSED on: malformed JSON, schema mismatch, unsupported alg,
//                 missing signature, signature mismatch.
// Fail-OPEN with explicit warning code when secret is undefined/empty
//   (CI may not have provisioned the secret yet — caller decides policy).
// ---------------------------------------------------------------------------
function verifyVerdict(json, secret) {
  let parsed;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json);
    } catch (_) {
      return { ok: false, reason: 'CORTEX_R2_VERDICT_MALFORMED_JSON' };
    }
  } else if (json && typeof json === 'object') {
    parsed = json;
  } else {
    return { ok: false, reason: 'CORTEX_R2_VERDICT_MALFORMED_JSON' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'CORTEX_R2_VERDICT_MALFORMED_JSON' };
  }

  if (parsed.schema_version !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'CORTEX_R2_VERDICT_SCHEMA_VERSION_MISMATCH',
      parsed,
    };
  }

  const sig = parsed.signature;
  if (!sig || typeof sig !== 'object') {
    return { ok: false, reason: 'CORTEX_R2_VERDICT_MISSING_SIGNATURE', parsed };
  }
  if (sig.alg !== SIG_ALG) {
    return { ok: false, reason: 'CORTEX_R2_VERDICT_UNSUPPORTED_ALG', parsed };
  }
  if (typeof sig.value !== 'string' || sig.value.length === 0) {
    return { ok: false, reason: 'CORTEX_R2_VERDICT_MISSING_SIGNATURE', parsed };
  }

  if (typeof secret !== 'string' || secret.length === 0) {
    // Fail-OPEN: signature present but no secret to verify against (CI gap).
    // Caller MUST surface the warning code in observability.
    return {
      ok: true,
      reason: 'CORTEX_R2_VERDICT_NO_SECRET_WARNING',
      parsed,
    };
  }

  // Strip signature before re-canonicalizing.
  const payloadOnly = {};
  for (const k of Object.keys(parsed)) {
    if (k === 'signature') continue;
    payloadOnly[k] = parsed[k];
  }
  const expected = signPayload(payloadOnly, secret);

  const expectedBuf = Buffer.from(expected, 'hex');
  let actualBuf;
  try {
    actualBuf = Buffer.from(sig.value, 'hex');
  } catch (_) {
    return {
      ok: false,
      reason: 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH',
      parsed,
    };
  }
  if (actualBuf.length !== expectedBuf.length) {
    return {
      ok: false,
      reason: 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH',
      parsed,
    };
  }
  let match;
  try {
    match = crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch (_) {
    return {
      ok: false,
      reason: 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH',
      parsed,
    };
  }
  if (!match) {
    return {
      ok: false,
      reason: 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH',
      parsed,
    };
  }

  return { ok: true, reason: 'CORTEX_R2_VERDICT_OK', parsed };
}

// ---------------------------------------------------------------------------
// loadVerdict(rootDir) → { json, raw } or null when file absent.
// Returns null on ENOENT; throws on other I/O errors (caller decides).
// ---------------------------------------------------------------------------
function loadVerdict(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('CORTEX_R2_VERDICT_LOAD_ROOT_REQUIRED');
  }
  const filePath = path.join(rootDir, 'cortex', 'r2-verdict.json');
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (_) {
    return { json: null, raw };
  }
  return { json, raw };
}

module.exports = {
  buildVerdict,
  verifyVerdict,
  loadVerdict,
  canonicalize,
  // exported for tests / advanced callers; not part of public contract
  _resolveSecret: resolveSecret,
  _SCHEMA_VERSION: SCHEMA_VERSION,
  _SIG_ALG: SIG_ALG,
};
