// loop-detector.cjs — Sprint 2.12 intra-run tool-call loop detector.
//
// Companion to cost-safety.cjs's CROSS-session loop detector (Sprint 1.9.1,
// 5x same-criterion in 7 days). This module catches INTRA-run loops within
// a single Steward execution: same tool called repeatedly with the same args,
// A-B-A oscillation between two tool+args pairs, or no-op tool calls that
// don't change observable state.
//
// Reference: pydantic-deep v0.3.8 StuckLoopDetection (default threshold 3,
// patterns: identical-calls / A-B-A / no-op, modes: warn / error). Real
// production case study: 47 identical tool calls burning $12 before manual
// kill ([Medium Wlodarczyk 2026]). Cortex-x's existing cost ledger would
// catch the $$ side eventually but not the *behavioral* signal that a model
// is stuck — which is what this detector adds.
//
// Today integration footprint is small (Steward cron runs are short, ~10min
// pipelines with deterministic tool calls); this primitive is pre-positioned
// for Sprint 2.4 claude-cli engine sessions and Sprint 3.5+ multi-action /
// host-daemon scenarios where many tool calls happen in a single run.
//
// API:
//   const det = createLoopDetector({ threshold: 3, window: 10 });
//   const r = det.record({ tool: 'edit', args: {path: 'a.cjs'}, stateBefore: 'sha1', stateAfter: 'sha2' });
//   if (!r.ok) { /* loop pattern detected — caller decides halt or warn */ }
//
// All record/snapshot calls are O(window). No I/O. The optional
// writeHaltOnLoop() helper escalates a detection to STEWARD_HALT.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW = 10;
// R2 edge-hunter MEDIUM: clamp window to a sane upper bound so an
// adversarial threshold doesn't allocate megabytes (each ring-buffer entry
// is ~100 bytes; 10k = ~1 MB). Real callers stay well under 100.
const MAX_WINDOW = 10_000;
const DEFAULT_PATTERNS = Object.freeze(['identical', 'oscillation', 'no_op']);

const VALID_PATTERNS = new Set(['identical', 'oscillation', 'no_op']);

// ─── Argument hashing ────────────────────────────────────────────────────────
//
// `args` may be any JSON-serializable value. We canonicalize via stable
// stringification (sorted keys) then sha256-prefix to keep ring-buffer
// entries small. Unserializable input (functions, circular refs) falls back
// to a stable "non-serializable" tag so the detector never throws.

function stableStringify(value) {
  // Sprint 2.12 R2 edge-hunter HIGH: lossy JSON.stringify defaults produce
  // false-positive identical-detections — Map/Set both serialize to `{}`,
  // BigInt throws, NaN/±Infinity become `null`, Symbol values get dropped,
  // function values get dropped. For a safety primitive whose job is to
  // distinguish duplicate calls, hash collisions are worse than the cost
  // of explicit handling. This walker preserves enough discrimination to
  // tell adversarial inputs apart.
  const seen = new WeakSet();
  function walk(v) {
    if (v === null) return null;
    if (v === undefined) return '[UNDEFINED]';
    const t = typeof v;
    if (t === 'number') {
      if (Number.isFinite(v)) return v;
      return `[NUMBER:${String(v)}]`; // NaN, ±Infinity become distinct strings
    }
    if (t === 'bigint') return `[BIGINT:${v.toString()}]`;
    if (t === 'symbol') return `[SYMBOL:${v.description || 'anon'}]`;
    if (t === 'function') return `[FUNCTION:${v.name || 'anon'}]`;
    if (t !== 'object') return v;
    if (seen.has(v)) return '[CIRCULAR]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map) {
      // Stable-ordered key/value pairs.
      const entries = [...v.entries()].map(([k, val]) => [walk(k), walk(val)]);
      entries.sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1));
      return { __map: entries };
    }
    if (v instanceof Set) {
      const arr = [...v.values()].map(walk);
      arr.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
      return { __set: arr };
    }
    if (v instanceof Date) return { __date: v.getTime() };
    if (v instanceof RegExp) return { __regexp: v.toString() };
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  }
  try {
    return JSON.stringify(walk(value));
  } catch {
    return '[NON_SERIALIZABLE]';
  }
}

function hashArgs(args) {
  const s = stableStringify(args == null ? null : args);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function callKey(tool, argsHash) {
  // R2 fast-check property: tool may be any value including objects with
  // throw-on-toString. Coerce via best-effort String() with try/catch
  // fallback so record() honors its never-throws contract on arbitrary
  // input.
  let safe;
  try {
    safe = String(tool == null ? '<no-tool>' : tool);
  } catch {
    safe = '<unstringifiable-tool>';
  }
  if (safe === '') safe = '<empty-tool>';
  return `${safe}::${argsHash}`;
}

// ─── Pattern detectors ───────────────────────────────────────────────────────
//
// Each detector inspects the ring buffer and returns either null (no
// detection) or a finding { pattern, repetitions, history }. Detectors run
// over the most-recent window; the *current* record is the last entry.

function detectIdentical(buf, threshold) {
  // The most recent record's key must appear ≥ threshold times in the buffer.
  if (buf.length < threshold) return null;
  const lastKey = buf[buf.length - 1].key;
  let count = 0;
  for (const r of buf) if (r.key === lastKey) count++;
  if (count < threshold) return null;
  return {
    pattern: 'identical',
    repetitions: count,
    history: buf.map((r) => r.key),
  };
}

function detectOscillation(buf, threshold) {
  // A-B-A oscillation: alternating between two distinct keys covering at
  // least `threshold` cycles (i.e. threshold * 2 - 1 alternating records).
  // For threshold=3 we need [A, B, A, B, A] minimum (5 records).
  const required = threshold * 2 - 1;
  if (buf.length < required) return null;
  const window = buf.slice(-required);
  const a = window[0].key;
  const b = window[1].key;
  if (a === b) return null;
  for (let i = 0; i < window.length; i++) {
    const expected = i % 2 === 0 ? a : b;
    if (window[i].key !== expected) return null;
  }
  return {
    pattern: 'oscillation',
    repetitions: threshold,
    history: window.map((r) => r.key),
  };
}

function detectNoOp(buf, threshold) {
  // The most recent `threshold` records must all be marked noOp=true. Unlike
  // identical/oscillation which detect *what* the agent does, no_op detects
  // calls whose observable state didn't change — caller-supplied via
  // stateBefore === stateAfter.
  if (buf.length < threshold) return null;
  const tail = buf.slice(-threshold);
  for (const r of tail) {
    if (!r.noOp) return null;
  }
  return {
    pattern: 'no_op',
    repetitions: threshold,
    history: tail.map((r) => r.key),
  };
}

// ─── Tracker factory ────────────────────────────────────────────────────────

function createLoopDetector(opts = {}) {
  const threshold = Number.isInteger(opts.threshold) && opts.threshold >= 2
    ? opts.threshold
    : DEFAULT_THRESHOLD;
  const requestedWindow = Number.isInteger(opts.window) && opts.window >= threshold
    ? opts.window
    : Math.max(DEFAULT_WINDOW, threshold);
  // R2 edge-hunter MEDIUM: clamp to MAX_WINDOW so adversarial threshold
  // (large value passed via env) cannot inflate the ring buffer.
  const window = Math.min(requestedWindow, MAX_WINDOW);
  // R2 edge-hunter LOW: dedupe pattern names — duplicate entries previously
  // ran a detector twice per record. First-match-wins makes it harmless but
  // wasteful; uniq is one line.
  const patterns = [...new Set(
    (Array.isArray(opts.patterns) ? opts.patterns : DEFAULT_PATTERNS)
      .filter((p) => VALID_PATTERNS.has(p)),
  )];
  if (patterns.length === 0) {
    throw new Error('loop-detector: at least one valid pattern required');
  }

  const buf = []; // ring buffer of { key, tool, argsHash, ts, noOp }
  let totalRecords = 0;

  function record(call) {
    // R2 edge-hunter LOW: use ?? not || so falsy-but-meaningful tool values
    // (0, '', false) reach callKey which preserves them via String().
    const tool = (call && call.tool != null) ? call.tool : '<no-tool>';
    const argsHash = hashArgs(call && call.args);
    const key = callKey(tool, argsHash);
    const noOp = (call && call.stateBefore != null && call.stateAfter != null
      && call.stateBefore === call.stateAfter);
    const entry = {
      key,
      tool,
      argsHash,
      ts: Date.now(),
      noOp,
    };
    buf.push(entry);
    if (buf.length > window) buf.shift();
    totalRecords += 1;

    // Run enabled detectors; first match wins (deterministic precedence).
    for (const p of patterns) {
      let finding = null;
      if (p === 'identical') finding = detectIdentical(buf, threshold);
      else if (p === 'oscillation') finding = detectOscillation(buf, threshold);
      else if (p === 'no_op') finding = detectNoOp(buf, threshold);
      if (finding) {
        return {
          ok: false,
          code: 'INTRA_RUN_LOOP',
          pattern: finding.pattern,
          repetitions: finding.repetitions,
          history: finding.history,
          totalRecords,
          threshold,
          window,
        };
      }
    }
    return { ok: true, totalRecords };
  }

  function snapshot() {
    return {
      threshold,
      window,
      patterns: [...patterns],
      bufferSize: buf.length,
      totalRecords,
      lastKey: buf.length ? buf[buf.length - 1].key : null,
    };
  }

  function reset() {
    buf.length = 0;
    totalRecords = 0;
  }

  return { record, snapshot, reset };
}

// ─── Halt-file integration helper ───────────────────────────────────────────
//
// Convenience wrapper for callers that want detection → halt-file write in
// one step. Mirrors the pattern at execute.cjs:1561-1564 (cross-session
// loop detection writes STEWARD_HALT). best-effort; never throws.

function writeHaltOnLoop(detection, opts = {}) {
  if (!detection || detection.ok !== false) return { written: false, code: 'NOT_A_LOOP' };
  const repoRoot = opts.repoRoot || process.cwd();
  const haltDir = path.join(repoRoot, '.cortex');
  const haltPath = path.join(haltDir, 'STEWARD_HALT');
  // R2 edge-hunter LOW: sanitize pattern + repetitions to strip newlines
  // and control chars. detection.pattern could in principle flow from
  // future LLM-judge integration; keeping halt-file content stable
  // single-line prevents log-injection / parser confusion downstream.
  const safePattern = String(detection.pattern || 'unknown').replace(/[\r\n\x00-\x1f]/g, '_');
  const safeReps = String(detection.repetitions || 0).replace(/[\r\n\x00-\x1f]/g, '_');
  const safeThresh = String(detection.threshold || 0).replace(/[\r\n\x00-\x1f]/g, '_');
  const reason = `INTRA_RUN_LOOP:${safePattern} repetitions=${safeReps} threshold=${safeThresh}`;
  try {
    fs.mkdirSync(haltDir, { recursive: true });
  } catch (err) {
    // R2 edge-hunter MEDIUM: distinct error code so callers can escalate
    // halt-write failure (last line of defense) rather than treating it
    // as a transient FS hiccup.
    return { written: false, code: 'HALT_DIR_UNAVAILABLE', error: err.message, reason };
  }
  try {
    fs.writeFileSync(haltPath, `${reason}\n${new Date().toISOString()}\n`, 'utf8');
    return { written: true, code: 'HALT_WRITTEN', haltPath, reason };
  } catch (err) {
    return { written: false, code: 'HALT_WRITE_FAILED', error: err.message, reason };
  }
}

module.exports = {
  createLoopDetector,
  writeHaltOnLoop,
  // Exposed for testing
  hashArgs,
  callKey,
  stableStringify,
  detectIdentical,
  detectOscillation,
  detectNoOp,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW,
  MAX_WINDOW,
  DEFAULT_PATTERNS,
  VALID_PATTERNS,
};
