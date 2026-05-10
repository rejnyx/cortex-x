// self-invocation.cjs — Sprint 2.13 self-invocation tracker + 4 hard guardrails.
//
// When a Claude Code session uses Skill (slash commands), ScheduleWakeup, or
// dispatches subagents (Agent tool with subagent_type), each event is a
// "self-invocation" that may chain into further self-invocations. Without
// guardrails, a session can recurse indefinitely (Codex issue #9912,
// opencode #18100), oscillate between two no-op skills, or hit the daily
// USD cap from sheer call volume.
//
// This module enforces the 4 production-grade defenses identified in the
// 2026-05-10 deep-dive research memo (Codex/opencode/Towards Data Science
// "17x error trap" / Rack2Cloud execution-budgets convergence):
//
//   1. MAX_DEPTH       — chain depth ≤ 3 (configurable via STEWARD_INVOCATION_MAX_DEPTH)
//   2. WALL_CLOCK      — chain wall-clock ≤ 30 min (STEWARD_INVOCATION_WALL_CLOCK_MS)
//   3. DEDUP_WINDOW    — identical (skill, args) blocked within last 3 of chain
//   4. COST_GATE       — existing daily/weekly/monthly caps via cost-safety.cjs
//
// Persistence: append-only JSONL at $CORTEX_DATA_HOME/self-invocations/<slug>.jsonl.
// Each line is one event (started, completed, blocked). Cross-session
// readable; status --self-invocations renders the tree.
//
// API:
//
//   const tracker = createInvocationTracker({ slug, repoRoot });
//   const inv = tracker.beforeInvoke({
//     skill: '/loop',
//     args: { prompt: 'check CI', interval: '5m' },
//     parentId: previousInvocationId || null,
//   });
//   if (!inv.ok) { /* guardrail blocked: inv.code */ }
//   else { /* caller invokes; tracker recorded the start event */
//     // ... do the work ...
//     tracker.afterInvoke(inv.invocationId, { outcome: 'success' });
//   }
//
//   const chains = tracker.listChains();           // all in-memory chains
//   const events = tracker.readEvents(slug, opts); // disk-backed history

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { resolveCortexDataHome } = require('../../../tools/lib/resolve-cortex-home.cjs');
const { readEnv } = require('./env.cjs');
// Sprint 2.13 R2 BLOCKER fix: reuse safety.cjs slug validation. Without
// it, an operator-supplied slug `../../etc/passwd` would resolve outside
// the dataHome via path.join — CWE-22 path traversal on appendFileSync.
const { assertSafeSlug } = require('./safety.cjs');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_WALL_CLOCK_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_DEDUP_WINDOW = 3;
const ABSOLUTE_MAX_DEPTH = 100;          // fail-safe upper bound
const ABSOLUTE_MAX_WALL_CLOCK_MS = 24 * 60 * 60 * 1000; // 24h fail-safe
// R2 edge-hunter MEDIUM: cap skill name length so a runaway caller can't
// fill the JSONL log with multi-MB skill strings (log-fill DoS).
const MAX_SKILL_LENGTH = 256;
// R2 edge-hunter MEDIUM: cap log file size so readEvents doesn't OOM on
// adversarial JSONL input (long-running daemon scenario).
const MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MiB

const VALID_SKILL_KINDS = new Set([
  'skill',           // /loop, /schedule, etc.
  'schedule_wakeup',
  'monitor',
  'cron_create',
  'subagent',        // Agent tool dispatch
  'task_resume',     // Other re-entry vectors
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function newId() {
  // Node ≥14.17 has randomUUID built-in. Zero-deps preserved.
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

// Stable hash of (skill, args) for dedup detection. Imports the
// canonicalization discipline from loop-detector.cjs (Sprint 2.12 R2 HIGH
// fix) which handles Map/Set/BigInt/NaN/Symbol/Function/Date/RegExp without
// false-collide.
const { stableStringify } = require('./loop-detector.cjs');

function stableArgString(value) {
  return stableStringify(value);
}

function argsHash(skill, args) {
  return crypto.createHash('sha256').update(`${skill || ''}::${stableArgString(args)}`).digest('hex').slice(0, 16);
}

// ─── Env-tunable limits ──────────────────────────────────────────────────────

function readMaxDepth() {
  const raw = Number(readEnv('INVOCATION_MAX_DEPTH'));
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_MAX_DEPTH;
  return Math.min(raw, ABSOLUTE_MAX_DEPTH);
}

function readWallClockMs() {
  const raw = Number(readEnv('INVOCATION_WALL_CLOCK_MS'));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_WALL_CLOCK_MS;
  return Math.min(raw, ABSOLUTE_MAX_WALL_CLOCK_MS);
}

function readDedupWindow() {
  const raw = Number(readEnv('INVOCATION_DEDUP_WINDOW'));
  if (!Number.isInteger(raw) || raw < 1) return DEFAULT_DEDUP_WINDOW;
  return raw;
}

// ─── Persistence layer ──────────────────────────────────────────────────────

function eventLogPath(slug) {
  // R2 BLOCKER: slug must be safe (no path-traversal) before joining
  // with dataHome. Reuses safety.cjs SSOT (Sprint 2.5b).
  assertSafeSlug(slug);
  return path.join(resolveCortexDataHome(), 'self-invocations', `${slug}.jsonl`);
}

function appendEvent(slug, event) {
  const p = eventLogPath(slug);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${JSON.stringify(event)}\n`, 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function readEvents(slug, opts = {}) {
  const p = eventLogPath(slug);
  if (!fs.existsSync(p)) return [];
  // R2 edge-hunter MEDIUM: refuse to slurp an oversized log file. 50 MiB
  // ≈ 500k events at ~100 bytes each — well past any sane chain history.
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return [];
  }
  if (stat.size > MAX_LOG_BYTES) {
    // Caller can detect via the 'log_oversize' sentinel.
    return [{ kind: 'log_oversize', path: p, size: stat.size, cap: MAX_LOG_BYTES }];
  }
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch { /* skip malformed lines — append-only log can have partial writes */ }
  }
  if (opts.sinceMs != null) {
    return events.filter((e) => {
      const t = Date.parse(e.ts || '');
      return Number.isFinite(t) && t >= opts.sinceMs;
    });
  }
  return events;
}

// ─── Tracker factory ────────────────────────────────────────────────────────

function createInvocationTracker(opts = {}) {
  const slug = opts.slug;
  if (!slug || typeof slug !== 'string') {
    throw new Error('createInvocationTracker: slug is required');
  }
  // R2 BLOCKER: validate slug at constructor time so persistence path
  // construction never sees a path-traversal value.
  try {
    assertSafeSlug(slug);
  } catch (err) {
    const e = new Error(`createInvocationTracker: invalid slug — ${err.message}`);
    e.code = err.code || 'UNSAFE_SLUG';
    throw e;
  }

  const maxDepth = Number.isInteger(opts.maxDepth) && opts.maxDepth >= 1
    ? Math.min(opts.maxDepth, ABSOLUTE_MAX_DEPTH)
    : readMaxDepth();
  const wallClockMs = Number.isFinite(opts.wallClockMs) && opts.wallClockMs > 0
    ? Math.min(opts.wallClockMs, ABSOLUTE_MAX_WALL_CLOCK_MS)
    : readWallClockMs();
  const dedupWindow = Number.isInteger(opts.dedupWindow) && opts.dedupWindow >= 1
    ? opts.dedupWindow
    : readDedupWindow();
  const persist = opts.persist !== false; // default ON; tests can disable

  // In-memory chain registry. Keyed by chainId. Each chain holds a list of
  // its invocations in order — used for depth, wall-clock, dedup checks.
  const chains = new Map();

  // Map of invocation id → chain id (for fast parent lookup).
  const invocationToChain = new Map();

  // R2 edge-hunter HIGH: surface persistence failures via tracker state.
  // Caller / status renderer can detect "guardrail logging silently dying"
  // by reading snapshot().persistenceErrors > 0.
  let persistenceErrors = 0;
  function recordPersist(result) {
    if (result && result.ok === false) persistenceErrors += 1;
    return result;
  }

  function buildChainState(chainId, startedTs) {
    return {
      chainId,
      startedTs,                  // chain wall-clock anchor (first-invocation start)
      invocations: [],            // [{ id, parentId, depth, skill, argsHashStr, started_ts, completed_ts, outcome }]
    };
  }

  function chainFor(parentId) {
    if (!parentId) return null;
    const cid = invocationToChain.get(parentId);
    if (!cid) return null;
    return chains.get(cid) || null;
  }

  function depthOfParent(parentId, chain) {
    if (!parentId || !chain) return 0;
    const parent = chain.invocations.find((i) => i.id === parentId);
    return parent ? parent.depth : 0;
  }

  function lastNInvocations(chain, n) {
    return chain.invocations.slice(-n);
  }

  function beforeInvoke(call = {}) {
    const skill = String(call.skill || '');
    if (!skill) {
      return { ok: false, code: 'INVALID_SKILL', error: 'skill is required' };
    }
    // R2 edge-hunter MEDIUM: cap skill length to prevent JSONL log-fill
    // DoS via runaway caller. 256 chars is generous; real skills are
    // < 50 chars (e.g. '/loop', 'subagent', 'schedule_wakeup').
    if (skill.length > MAX_SKILL_LENGTH) {
      return { ok: false, code: 'INVALID_SKILL', error: `skill length ${skill.length} > MAX_SKILL_LENGTH ${MAX_SKILL_LENGTH}` };
    }
    const args = call.args !== undefined ? call.args : null;
    const aHash = argsHash(skill, args);
    const parentId = call.parentId || null;
    const tsIso = nowIso();
    const tsMs = nowMs();

    // Resolve chain context.
    let chain = parentId ? chainFor(parentId) : null;
    let depth;
    if (parentId && !chain) {
      // R2 edge-hunter HIGH: caller passed a parentId that doesn't match
      // any tracked chain. Previously this silently re-rooted the
      // invocation at depth=1, bypassing MAX_DEPTH defense for typo'd or
      // cross-instance ids. Now reject explicitly.
      return {
        ok: false,
        code: 'UNKNOWN_PARENT',
        error: `parentId ${parentId} is not tracked in this session`,
      };
    }
    if (chain) {
      depth = depthOfParent(parentId, chain) + 1;
    } else {
      // Root invocation — begin a new chain.
      const chainId = newId();
      chain = buildChainState(chainId, tsMs);
      chains.set(chainId, chain);
      depth = 1;
    }

    // ─── Guardrails ─────────────────────────────────────────────────────
    // (Order: cheapest first. depth and wall-clock are O(1); dedup is O(window).)

    if (depth > maxDepth) {
      const blockEvent = {
        ts: tsIso,
        kind: 'blocked',
        chainId: chain.chainId,
        parentId,
        depth,
        skill,
        argsHash: aHash,
        code: 'MAX_DEPTH_EXCEEDED',
        message: `chain depth ${depth} > maxDepth ${maxDepth}`,
      };
      if (persist) recordPersist(appendEvent(slug, blockEvent));
      return {
        ok: false,
        code: 'MAX_DEPTH_EXCEEDED',
        chainId: chain.chainId,
        depth,
        maxDepth,
        message: blockEvent.message,
      };
    }

    const elapsedMs = tsMs - chain.startedTs;
    if (elapsedMs > wallClockMs) {
      const blockEvent = {
        ts: tsIso,
        kind: 'blocked',
        chainId: chain.chainId,
        parentId,
        depth,
        skill,
        argsHash: aHash,
        code: 'WALL_CLOCK_EXCEEDED',
        message: `chain wall-clock ${elapsedMs}ms > limit ${wallClockMs}ms`,
      };
      if (persist) recordPersist(appendEvent(slug, blockEvent));
      return {
        ok: false,
        code: 'WALL_CLOCK_EXCEEDED',
        chainId: chain.chainId,
        elapsedMs,
        wallClockMs,
        message: blockEvent.message,
      };
    }

    // Dedup: identical (skill, argsHash) within the last `dedupWindow`
    // invocations on THIS chain. Window is a tail count; past invocations
    // older than window can repeat without triggering.
    const tail = lastNInvocations(chain, dedupWindow);
    const dup = tail.find((i) => i.skill === skill && i.argsHash === aHash);
    if (dup) {
      const blockEvent = {
        ts: tsIso,
        kind: 'blocked',
        chainId: chain.chainId,
        parentId,
        depth,
        skill,
        argsHash: aHash,
        code: 'DEDUP_BLOCKED',
        message: `duplicate (${skill}, ${aHash}) within last ${dedupWindow} invocations`,
      };
      if (persist) recordPersist(appendEvent(slug, blockEvent));
      return {
        ok: false,
        code: 'DEDUP_BLOCKED',
        chainId: chain.chainId,
        skill,
        argsHash: aHash,
        dedupWindow,
        message: blockEvent.message,
      };
    }

    // Optional COST_GATE check. Skipped if caller didn't pass costGate
    // function (separates cost-safety integration concerns).
    // R2 edge-hunter HIGH: wrap caller-supplied gate in try/catch so a
    // buggy costGateCheck (the gate meant to PREVENT runaway) cannot
    // crash the tracker (the layer meant to PREVENT runaway). Fail-closed
    // semantics: treat a thrown gate as tripped.
    if (typeof call.costGateCheck === 'function') {
      let gate;
      try {
        gate = call.costGateCheck();
      } catch (err) {
        gate = { tripped: true, reason: `costGateCheck threw: ${err.message}` };
      }
      if (gate && gate.tripped) {
        const blockEvent = {
          ts: tsIso,
          kind: 'blocked',
          chainId: chain.chainId,
          parentId,
          depth,
          skill,
          argsHash: aHash,
          code: 'COST_GATE_TRIPPED',
          message: gate.reason || 'cost cap reached',
        };
        if (persist) recordPersist(appendEvent(slug, blockEvent));
        return {
          ok: false,
          code: 'COST_GATE_TRIPPED',
          chainId: chain.chainId,
          gate,
          message: blockEvent.message,
        };
      }
    }

    // ─── Allowed — record start ─────────────────────────────────────────

    const invocationId = newId();
    const invocation = {
      id: invocationId,
      parentId,
      depth,
      skill,
      argsHash: aHash,
      started_ts: tsIso,
      started_ms: tsMs,
      completed_ts: null,
      outcome: null,
    };
    chain.invocations.push(invocation);
    invocationToChain.set(invocationId, chain.chainId);

    const startEvent = {
      ts: tsIso,
      kind: 'started',
      chainId: chain.chainId,
      invocationId,
      parentId,
      depth,
      skill,
      argsHash: aHash,
      argsPreview: previewArgs(args),
    };
    if (persist) recordPersist(appendEvent(slug, startEvent));

    return {
      ok: true,
      invocationId,
      chainId: chain.chainId,
      depth,
    };
  }

  function afterInvoke(invocationId, completion = {}) {
    const chainId = invocationToChain.get(invocationId);
    if (!chainId) {
      return { ok: false, code: 'UNKNOWN_INVOCATION', invocationId };
    }
    const chain = chains.get(chainId);
    const invocation = chain && chain.invocations.find((i) => i.id === invocationId);
    if (!invocation) {
      return { ok: false, code: 'UNKNOWN_INVOCATION', invocationId };
    }
    invocation.completed_ts = nowIso();
    invocation.outcome = completion.outcome || 'success';

    const event = {
      ts: invocation.completed_ts,
      kind: 'completed',
      chainId,
      invocationId,
      parentId: invocation.parentId,
      depth: invocation.depth,
      skill: invocation.skill,
      argsHash: invocation.argsHash,
      outcome: invocation.outcome,
      // R2 correctness MEDIUM: clamp negative duration produced by clock
      // skew (NTP correction or VM pause between started_ms and
      // completed_ts capture). Surface a clock_skew_detected sentinel so
      // downstream consumers can distinguish "real instant" from
      // "clamped".
      durationMs: 0,
    };
    const rawDuration = Date.parse(invocation.completed_ts) - invocation.started_ms;
    if (rawDuration < 0) {
      event.durationMs = 0;
      event.clock_skew_detected = true;
    } else {
      event.durationMs = rawDuration;
    }
    if (completion.error) event.error = String(completion.error).slice(0, 500);
    if (persist) recordPersist(appendEvent(slug, event));

    return { ok: true, invocationId, chainId };
  }

  function listChains() {
    return [...chains.values()].map((c) => ({
      chainId: c.chainId,
      startedTs: new Date(c.startedTs).toISOString(),
      invocations: c.invocations.map((i) => ({ ...i })),
    }));
  }

  function snapshot() {
    return {
      slug,
      maxDepth,
      wallClockMs,
      dedupWindow,
      persist,
      chainCount: chains.size,
      totalInvocations: [...chains.values()].reduce((acc, c) => acc + c.invocations.length, 0),
      // R2 edge-hunter HIGH: persistence-degradation visibility. Caller /
      // status renderer can detect "guardrail logging silently dying" by
      // reading persistenceErrors > 0.
      persistenceErrors,
    };
  }

  return {
    beforeInvoke,
    afterInvoke,
    listChains,
    snapshot,
    readEvents: (rOpts) => readEvents(slug, rOpts),
  };
}

function previewArgs(args) {
  // Capture a short preview for status-rendering. Avoid storing raw args
  // (could be large or contain sensitive content). Trims to 80 chars.
  try {
    const s = JSON.stringify(args);
    if (s == null) return '';
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  } catch {
    return '[unserializable]';
  }
}

// ─── Status renderer (chain tree) ───────────────────────────────────────────
//
// Renders disk-backed events into ASCII tree per chain. Used by the
// `cortex-steward status --self-invocations` flag.

function renderChainTree(events, opts = {}) {
  const limit = opts.limit || 10; // most recent N chains
  // Bucket events by chainId, preserving order.
  const byChain = new Map();
  for (const e of events) {
    if (!e || !e.chainId) continue;
    if (!byChain.has(e.chainId)) byChain.set(e.chainId, []);
    byChain.get(e.chainId).push(e);
  }

  // Sort chains by first-event ts desc, take top N.
  const chainsSorted = [...byChain.entries()]
    .map(([id, evts]) => ({
      id,
      events: evts,
      firstTs: evts[0] ? Date.parse(evts[0].ts) : 0,
    }))
    .sort((a, b) => b.firstTs - a.firstTs)
    .slice(0, limit);

  const out = [];
  for (const c of chainsSorted) {
    const startEvents = c.events.filter((e) => e.kind === 'started');
    const blockedEvents = c.events.filter((e) => e.kind === 'blocked');
    const completedEvents = c.events.filter((e) => e.kind === 'completed');
    const totalEvents = c.events.length;
    out.push(`chain ${c.id.slice(0, 8)} (${new Date(c.firstTs).toISOString()}) — ${totalEvents} events, ${startEvents.length} started, ${completedEvents.length} completed, ${blockedEvents.length} blocked`);
    // Render started+blocked events as a depth-indented tree.
    for (const e of c.events) {
      if (e.kind !== 'started' && e.kind !== 'blocked') continue;
      const indent = '  '.repeat(Math.max(0, (e.depth || 1) - 1));
      const marker = e.kind === 'blocked' ? `[BLOCKED:${e.code}]` : '';
      const argsPart = e.argsPreview ? ` args=${e.argsPreview}` : '';
      out.push(`${indent}└─ ${e.skill}${argsPart} (depth=${e.depth}) ${marker}`);
    }
    out.push('');
  }
  if (out.length === 0) return '(no chains recorded)';
  return out.join('\n').trimEnd();
}

module.exports = {
  createInvocationTracker,
  readEvents,
  renderChainTree,
  eventLogPath,
  argsHash,
  stableArgString,
  // Constants for tests + integration
  DEFAULT_MAX_DEPTH,
  DEFAULT_WALL_CLOCK_MS,
  DEFAULT_DEDUP_WINDOW,
  ABSOLUTE_MAX_DEPTH,
  ABSOLUTE_MAX_WALL_CLOCK_MS,
  VALID_SKILL_KINDS,
};
