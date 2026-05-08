// otel-emitter.cjs — Sprint 2.0 zero-deps OTLP HTTP emitter for Steward.
//
// Sends span trees over OTLP HTTP/JSON to a configured OpenTelemetry endpoint
// (Phoenix at localhost:6006/v1/traces by default; works against any OTLP
// HTTP receiver). Hand-rolled to preserve cortex-x's zero-runtime-deps
// invariant (no `@opentelemetry/api`, no `@arizeai/openinference-*` packages).
//
// Attribute strategy: emit BOTH OpenInference (`openinference.span.kind`,
// `llm.*`, `tool.*`) AND OpenTelemetry gen_ai semconv (`gen_ai.system`,
// `gen_ai.usage.*`, `gen_ai.operation.name`) on every span. Phoenix renders
// the OpenInference set natively; any future OTel-compatible backend (Jaeger,
// Tempo, future Langfuse upgrade) understands gen_ai. Cost ~10 extra bytes
// per span; portability is worth it.
//
// Lifecycle:
//   1. createTracer({ endpoint, traceId, runId, agentName }) — at runExecute start
//   2. tracer.startSpan({ name, kind, parent, attributes }) — for each phase
//   3. span.setAttribute(k, v) / span.setStatus(s) / span.end()
//   4. await tracer.flush() — at runExecute end (single batched POST)
//
// Fail-open posture: STEWARD_OTEL_ENDPOINT unset → tracer is a no-op
// (every method returns immediately, flush() resolves to {ok: true,
// reason: 'no-endpoint'}). Endpoint unreachable → flush() resolves to
// {ok: false, reason: 'fetch-failed', error}; the steward run completes
// normally regardless. We log ONE warning per run, not per span.
//
// Journal SSOT: this emitter never replaces journal writes. The trace_id
// and per-phase span_ids are recorded in journal entries via execute.cjs
// for cross-reference; Phoenix is purely additive.

'use strict';

const crypto = require('node:crypto');
const { readEnv } = require('./env.cjs');

const DEFAULT_ENDPOINT = 'http://localhost:6006/v1/traces';
const FETCH_TIMEOUT_MS = 5_000;

// Sprint 2.0 hardening (security review). Sprint 1.6.20 H2 hardcoded
// OPENROUTER_ENDPOINT specifically because operator-controllable egress URLs
// are a credible SSRF + reconnaissance channel; the same threat model
// applies to STEWARD_OTEL_ENDPOINT. Defense:
//   1. URL must parse + use scheme http/https
//   2. Host must be loopback (127.0.0.1, localhost, ::1) UNLESS the operator
//      explicitly opts in via STEWARD_OTEL_ALLOW_REMOTE=1
//   3. Path must end with /v1/traces or /v1/logs (bounds the SSRF shape to
//      OTLP receivers)
//   4. Non-loopback opt-in is a deliberate, audited choice for cron/CI
//      contexts — not the default
// Violations: tracer becomes disabled, single warning to stderr.
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ALLOWED_OTLP_PATH_SUFFIXES = ['/v1/traces', '/v1/logs'];

// Per-attribute and total-payload size caps (CWE-770 mitigation). Phoenix's
// OTLP-HTTP receiver has a default body limit around 10 MB; we cap further
// down so a runaway attribute (e.g. operator passes an entire file body
// as a span attribute) doesn't blow the receiver up or saturate the link.
const MAX_ATTRIBUTE_STRING_BYTES = 8 * 1024;       // 8 KB per string attr
const MAX_PAYLOAD_BYTES = 1 * 1024 * 1024;         // 1 MB total per flush
const MAX_STATUS_MESSAGE_BYTES = 200;              // status.message redaction

// Path-redaction regex — strips absolute filesystem paths from error messages
// before they ride the OTLP wire (CWE-117/209). Covers POSIX (/Users/, /home/,
// /opt/, /var/, /etc/) and Windows (C:\Users\, D:\..., \\share\). Replaces
// matched span with `<path>`; non-greedy to stop at whitespace / quote.
const PATH_REDACT_RE = /(?:[A-Za-z]:[\\/]|\\\\[^\s"'<>]+[\\/]|\/(?:Users|home|opt|var|etc|tmp|root|mnt))[^\s"'<>]+/g;

function redactPaths(str) {
  if (typeof str !== 'string') return str;
  return str.replace(PATH_REDACT_RE, '<path>');
}

function truncateString(str, maxBytes) {
  if (typeof str !== 'string') return str;
  // Byte-length bound; UTF-8 chars are 1-4 bytes so this is conservative.
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  // Walk codepoints to avoid splitting a multi-byte char.
  let out = '';
  let bytes = 0;
  for (const ch of str) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (bytes + chBytes > maxBytes - 3) break; // leave room for "..."
    out += ch;
    bytes += chBytes;
  }
  return out + '...';
}

// Validate STEWARD_OTEL_ENDPOINT against the allow-list.
// Returns { ok: true, url } or { ok: false, reason }.
function validateEndpoint(rawEndpoint, opts = {}) {
  if (typeof rawEndpoint !== 'string') return { ok: false, reason: 'not-a-string' };
  const trimmed = rawEndpoint.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  let parsed;
  try { parsed = new URL(trimmed); }
  catch { return { ok: false, reason: 'invalid-url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `unsupported-scheme:${parsed.protocol}` };
  }
  // Host must be loopback unless operator explicitly opts in.
  const allowRemote = opts.allowRemote === true || readEnv('OTEL_ALLOW_REMOTE') === '1';
  if (!allowRemote) {
    const host = parsed.hostname.toLowerCase();
    // Strip IPv6 brackets if present (URL leaves them in parsed.hostname for v6).
    const bare = host.replace(/^\[|\]$/g, '');
    if (!LOOPBACK_HOSTNAMES.has(host) && !LOOPBACK_HOSTNAMES.has(bare)) {
      return { ok: false, reason: `non-loopback-host:${parsed.hostname}` };
    }
  }
  // Path must end with /v1/traces or /v1/logs to bound the SSRF shape.
  const pathOk = ALLOWED_OTLP_PATH_SUFFIXES.some((suf) => parsed.pathname === suf || parsed.pathname.endsWith(suf));
  if (!pathOk) {
    return { ok: false, reason: `unsupported-path:${parsed.pathname}` };
  }
  return { ok: true, url: trimmed };
}

// OpenInference span kinds (https://arize-ai.github.io/openinference/spec/semantic_conventions.html)
const KINDS = Object.freeze({
  AGENT: 'AGENT',
  LLM: 'LLM',
  TOOL: 'TOOL',
  CHAIN: 'CHAIN',
  EMBEDDING: 'EMBEDDING',
  RETRIEVER: 'RETRIEVER',
  RERANKER: 'RERANKER',
  GUARDRAIL: 'GUARDRAIL',
  EVALUATOR: 'EVALUATOR',
  PROMPT: 'PROMPT',
});

// OTel SpanKind enum (https://opentelemetry.io/docs/specs/otel/trace/api/#spankind)
// Phoenix accepts numeric kind; we map AGENT/CHAIN to INTERNAL, LLM/TOOL to CLIENT.
const OTEL_SPAN_KIND = Object.freeze({
  UNSPECIFIED: 0,
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
  PRODUCER: 4,
  CONSUMER: 5,
});

function mapToOtelKind(openinferenceKind) {
  if (openinferenceKind === 'LLM' || openinferenceKind === 'TOOL') return OTEL_SPAN_KIND.CLIENT;
  return OTEL_SPAN_KIND.INTERNAL;
}

// OTel status codes
const OTEL_STATUS = Object.freeze({
  UNSET: 0,
  OK: 1,
  ERROR: 2,
});

// Generate a 32-hex-char trace_id (16 random bytes per OTel spec).
function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

// Generate a 16-hex-char span_id (8 random bytes per OTel spec).
function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

// Current monotonic time in nanoseconds since UNIX epoch (OTLP wire format).
// Date.now() gives ms; multiply by 1e6 → ns. Stringified because JSON can't
// represent uint64 losslessly above 2^53.
function nowNanosString() {
  return String(BigInt(Date.now()) * 1_000_000n);
}

// Convert a JS value into OTLP AnyValue shape.
// (https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/common/v1/common.proto)
//
// Sprint 2.0 hardening (correctness M1, edge-case HIGH):
//   - NaN/Infinity are not valid JSON numbers (JSON.stringify(NaN)="null"
//     would silently corrupt the wire). Coerce to stringValue.
//   - Symbol throws on String() coercion → catch + stringValue.
//   - Function would emit its source code (multi-KB body) → emit name only.
//   - Date emits ISO string (vs. an empty kvlistValue from Object.entries).
//   - Buffer emits base64 string (vs. enumerating every byte index).
//   - BigInt → stringValue with literal numeric form.
//   - Strings are byte-truncated to MAX_ATTRIBUTE_STRING_BYTES (CWE-770).
//   - kvlist/array recursion is depth-limited to prevent runaway nesting.
const MAX_ATTRIBUTE_DEPTH = 4;
function toAnyValue(v, depth = 0) {
  if (v === null || v === undefined) return { stringValue: '' };
  if (typeof v === 'string') {
    return { stringValue: truncateString(v, MAX_ATTRIBUTE_STRING_BYTES) };
  }
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { stringValue: String(v) }; // NaN, Infinity, -Infinity
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'bigint') {
    return { stringValue: v.toString() };
  }
  if (typeof v === 'symbol') {
    try { return { stringValue: v.toString() }; }
    catch { return { stringValue: '<symbol>' }; }
  }
  if (typeof v === 'function') {
    return { stringValue: `<function:${v.name || 'anonymous'}>` };
  }
  // Buffer must be checked before generic object — Buffer is an object.
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(v)) {
    return { stringValue: truncateString(v.toString('base64'), MAX_ATTRIBUTE_STRING_BYTES) };
  }
  if (v instanceof Date) {
    return { stringValue: v.toISOString() };
  }
  if (Array.isArray(v)) {
    if (depth >= MAX_ATTRIBUTE_DEPTH) {
      return { stringValue: '<array:depth-limit>' };
    }
    return { arrayValue: { values: v.map((item) => toAnyValue(item, depth + 1)) } };
  }
  if (typeof v === 'object') {
    if (depth >= MAX_ATTRIBUTE_DEPTH) {
      return { stringValue: '<object:depth-limit>' };
    }
    try {
      const entries = Object.entries(v);
      return { kvlistValue: { values: entries.map(([key, value]) => ({ key, value: toAnyValue(value, depth + 1) })) } };
    } catch {
      return { stringValue: '<unenumerable-object>' };
    }
  }
  // Fallback — stringify anything else (rare).
  try { return { stringValue: String(v) }; }
  catch { return { stringValue: '<uncoercible>' }; }
}

// Convert a flat attributes object into OTLP `attributes: [{key, value}]` shape.
function attrsToOtlp(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => ({ key, value: toAnyValue(v) }));
}

// Internal Span class. Not exported directly; obtained via tracer.startSpan().
class Span {
  constructor({ tracer, traceId, spanId, parentSpanId, name, kind, attributes }) {
    this._tracer = tracer;
    this._traceId = traceId;
    this._spanId = spanId;
    this._parentSpanId = parentSpanId || null;
    this._name = name;
    this._kind = kind;
    this._attributes = { ...(attributes || {}) };
    this._startNs = nowNanosString();
    this._endNs = null;
    this._status = { code: OTEL_STATUS.UNSET };
    this._events = [];
    this._ended = false;

    // Always set the openinference.span.kind attribute (Phoenix renders by it).
    if (kind && !this._attributes['openinference.span.kind']) {
      this._attributes['openinference.span.kind'] = kind;
    }
  }

  get traceId() { return this._traceId; }
  get spanId() { return this._spanId; }
  get name() { return this._name; }

  setAttribute(key, value) {
    // Sprint 2.0 review (edge): use explicit nullish/empty check — `!key`
    // would also drop numeric-zero keys, which is a footgun if attribute
    // values ever reach Object.entries on an array.
    if (this._ended || key === undefined || key === null || key === '') return this;
    this._attributes[String(key)] = value;
    return this;
  }

  setAttributes(obj) {
    if (this._ended || !obj || typeof obj !== 'object' || Array.isArray(obj)) return this;
    for (const [k, v] of Object.entries(obj)) {
      if (k !== '') this._attributes[k] = v;
    }
    return this;
  }

  setStatus(code, message) {
    // Sprint 2.0 security review (CWE-117/209): error messages from the
    // verifier / spec-verifier / openrouter can carry filesystem paths and
    // partial command output. Truncate + redact paths before they ride the
    // OTLP wire — the destination may be a local Phoenix readable by other
    // users on the box, or (with STEWARD_OTEL_ALLOW_REMOTE=1) a remote host.
    if (this._ended) return this;
    let safeMsg = message;
    if (typeof safeMsg === 'string') {
      safeMsg = redactPaths(safeMsg);
      safeMsg = truncateString(safeMsg, MAX_STATUS_MESSAGE_BYTES);
    } else if (safeMsg !== undefined) {
      // Don't pass non-strings through; OTLP Status.message is string|undefined.
      safeMsg = undefined;
    }
    this._status = { code, message: safeMsg };
    return this;
  }

  addEvent(name, attributes) {
    if (this._ended) return this;
    this._events.push({
      name: String(name),
      timeUnixNano: nowNanosString(),
      attributes: attrsToOtlp(attributes),
    });
    return this;
  }

  end() {
    if (this._ended) return this;
    this._ended = true;
    this._endNs = nowNanosString();
    this._tracer._registerEndedSpan(this);
    return this;
  }

  // Serialize this span to OTLP wire format.
  _toOtlp() {
    return {
      traceId: this._traceId,
      spanId: this._spanId,
      parentSpanId: this._parentSpanId || undefined,
      name: this._name,
      kind: mapToOtelKind(this._kind),
      startTimeUnixNano: this._startNs,
      endTimeUnixNano: this._endNs || nowNanosString(),
      attributes: attrsToOtlp(this._attributes),
      events: this._events,
      status: this._status,
    };
  }
}

class NoopSpan {
  constructor() {
    this._traceId = '0'.repeat(32);
    this._spanId = '0'.repeat(16);
  }
  get traceId() { return this._traceId; }
  get spanId() { return this._spanId; }
  get name() { return ''; }
  setAttribute() { return this; }
  setAttributes() { return this; }
  setStatus() { return this; }
  addEvent() { return this; }
  end() { return this; }
}

// Resolve the cortex-x package.json version once at module load. Used as
// the resource attribute service.version (OTel semconv expects semver-ish).
// Falls back to '0.0.0-unknown' if package.json can't be read.
let _resolvedServiceVersion = null;
function resolveServiceVersion() {
  if (_resolvedServiceVersion !== null) return _resolvedServiceVersion;
  try {
    const path = require('node:path');
    const fs = require('node:fs');
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    _resolvedServiceVersion = pkg.version || '0.0.0-unknown';
  } catch {
    _resolvedServiceVersion = '0.0.0-unknown';
  }
  return _resolvedServiceVersion;
}

// Sprint 2.0.1 — translate the OTLP-JSON payload shape produced by the
// emitter (used to be sent over the wire as JSON) into the simpler
// JS-object shape that otel-protobuf.cjs expects:
//
//   - attributes are plain `{ key: value }` objects (not the OTLP attr-array)
//   - kind / status.code / events / startTimeUnixNano stay as-is
//
// We invert attrsToOtlp here so the protobuf encoder's encodeAnyValue can
// type-dispatch on JS primitives directly. The JSON-shape attribute array
// (`[{key:'x', value:{stringValue:'y'}}]`) was a JSON-wire artifact; the
// protobuf wire format encodes the same thing more compactly via repeated
// KeyValue messages, but we generate it from a plain object for clarity.
function attrsFromOtlpArray(attrArray) {
  if (!Array.isArray(attrArray)) return {};
  const out = {};
  for (const kv of attrArray) {
    if (!kv || typeof kv.key !== 'string') continue;
    const v = kv.value || {};
    if ('stringValue' in v) out[kv.key] = v.stringValue;
    else if ('boolValue' in v) out[kv.key] = v.boolValue;
    else if ('intValue' in v) {
      // intValue may come as string for >2^53; preserve when needed
      const raw = v.intValue;
      if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
        const n = Number(raw);
        out[kv.key] = Number.isSafeInteger(n) ? n : BigInt(raw);
      } else if (typeof raw === 'number') out[kv.key] = raw;
      else out[kv.key] = raw;
    }
    else if ('doubleValue' in v) out[kv.key] = v.doubleValue;
    else if ('arrayValue' in v) {
      out[kv.key] = (v.arrayValue && v.arrayValue.values) || [];
    }
    else if ('kvlistValue' in v) {
      out[kv.key] = attrsFromOtlpArray((v.kvlistValue && v.kvlistValue.values) || []);
    }
    else if ('bytesValue' in v) out[kv.key] = v.bytesValue;
    // else: empty AnyValue → null
  }
  return out;
}

function otlpJsonShapeToProtobufShape(payload) {
  if (!payload || !Array.isArray(payload.resourceSpans)) {
    return { resourceSpans: [] };
  }
  return {
    resourceSpans: payload.resourceSpans.map((rs) => ({
      resource: rs.resource ? {
        attributes: attrsFromOtlpArray(rs.resource.attributes),
      } : undefined,
      scopeSpans: (rs.scopeSpans || []).map((ss) => ({
        scope: ss.scope ? {
          name: ss.scope.name,
          version: ss.scope.version,
          attributes: attrsFromOtlpArray(ss.scope.attributes),
        } : undefined,
        spans: (ss.spans || []).map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name,
          kind: s.kind,
          startTimeUnixNano: s.startTimeUnixNano,
          endTimeUnixNano: s.endTimeUnixNano,
          attributes: attrsFromOtlpArray(s.attributes),
          status: s.status,
        })),
      })),
    })),
  };
}

// Public tracer. One per Steward run.
class Tracer {
  constructor({ endpoint, traceId, runId, agentName, serviceVersion, fetchImpl }) {
    this._endpoint = endpoint || null;
    this._traceId = traceId || generateTraceId();
    this._runId = runId || null;
    this._agentName = agentName || 'steward';
    this._serviceVersion = serviceVersion || resolveServiceVersion();
    this._fetch = fetchImpl || (typeof globalThis !== 'undefined' && globalThis.fetch);
    this._endedSpans = [];
    this._enabled = !!this._endpoint;
    this._flushed = false;
  }

  get traceId() { return this._traceId; }
  get enabled() { return this._enabled; }

  startSpan({ name, kind, parent, attributes } = {}) {
    if (!this._enabled) return new NoopSpan();
    // Sprint 2.0 review (correctness M3, edge): a NoopSpan from a disabled
    // tracer (or any caller passing a forged parent) carries spanId=
    // '0000000000000000'. The OTLP spec treats all-zero spanId as invalid;
    // Phoenix may render it as orphaned or reject. Treat it as "no parent".
    let parentSpanId = null;
    if (parent && typeof parent.spanId === 'string'
        && parent.spanId.length === 16
        && parent.spanId !== '0'.repeat(16)) {
      parentSpanId = parent.spanId;
    }
    const span = new Span({
      tracer: this,
      traceId: this._traceId,
      spanId: generateSpanId(),
      parentSpanId,
      name: name || 'unnamed',
      kind: kind || KINDS.CHAIN,
      attributes,
    });
    return span;
  }

  // Convenience: run an async function inside a span; auto-end on resolve/reject.
  // Status semantics: don't overwrite a status the inner function already set.
  // Steward's pattern is "soft errors as return values, not throws" — inner fn
  // may have called span.setStatus(ERROR, ...) on a {ok:false} return; we must
  // not blanket that to OK just because the function returned without throwing.
  async withSpan({ name, kind, parent, attributes }, fn) {
    const span = this.startSpan({ name, kind, parent, attributes });
    try {
      const out = await fn(span);
      // Only auto-set OK if caller didn't set anything else (still UNSET).
      if (span.setStatus && span._status && span._status.code === OTEL_STATUS.UNSET) {
        span.setStatus(OTEL_STATUS.OK);
      }
      return out;
    } catch (err) {
      if (span.setStatus) span.setStatus(OTEL_STATUS.ERROR, err && err.message);
      throw err;
    } finally {
      if (span.end) span.end();
    }
  }

  _registerEndedSpan(span) {
    this._endedSpans.push(span);
  }

  // Flush all ended spans in a single batched POST. Idempotent. Fail-open.
  // Sprint 2.0 review: snapshot _endedSpans early so concurrent end()s during
  // the await don't get silently dropped (or, if the flush errors, get
  // re-queued for a retry that will never come). Steward currently flushes
  // exactly once at runExecute end, so the snapshot is enough.
  async flush() {
    if (this._flushed) return { ok: true, reason: 'already-flushed', spans: 0 };
    this._flushed = true;
    if (!this._enabled) return { ok: true, reason: 'no-endpoint', spans: 0 };
    const snapshot = this._endedSpans.slice();
    if (snapshot.length === 0) return { ok: true, reason: 'no-spans', spans: 0 };
    if (typeof this._fetch !== 'function') return { ok: false, reason: 'no-fetch', spans: snapshot.length };

    const payload = {
      resourceSpans: [{
        resource: {
          attributes: attrsToOtlp({
            'service.name': this._agentName,
            'service.namespace': 'cortex-x',
            'service.version': this._serviceVersion,
            'steward.run_id': this._runId || '',
          }),
        },
        scopeSpans: [{
          scope: { name: 'steward', version: this._serviceVersion },
          spans: snapshot.map((s) => s._toOtlp()),
        }],
      }],
    };

    // Sprint 2.0.1 — encode to OTLP/protobuf wire format. Sprint 2.0 v1
    // shipped OTLP/JSON; manual dogfood 2026-05-08 against live Phoenix
    // 15.5.1 surfaced 415 Unsupported Media Type — Phoenix only accepts
    // protobuf despite the OTLP HTTP spec permitting both encodings.
    // We translate the same payload object (same shape used by JSON) into
    // protobuf-binary via the zero-deps encoder in otel-protobuf.cjs.
    //
    // Tests that previously JSON.parsed the body now read tracer._lastPayload
    // (the payload object before encoding) — same data, accessible without
    // a protobuf decoder dependency.
    const otelProtobuf = require('./otel-protobuf.cjs');
    this._lastPayload = payload;
    // Test hook: also expose globally so integration tests that don't have
    // direct access to the tracer (because it's created inside execute.cjs)
    // can read the last flushed payload.
    module.exports._lastFlushedPayloadForTests = payload;
    let body;
    try {
      const protobufPayload = otlpJsonShapeToProtobufShape(payload);
      body = otelProtobuf.encodeExportTraceServiceRequest(protobufPayload);
    } catch (err) {
      return { ok: false, reason: 'serialize-failed', spans: snapshot.length, error: err && err.message };
    }
    // Payload size cap (CWE-770). Phoenix's default body limit is ~10 MB;
    // we cap further to keep the link healthy and to refuse payloads that
    // imply attribute-coercion failure (a 1MB+ body for ~5 spans means
    // somebody passed a megabyte-sized string as an attribute).
    if (body.length > MAX_PAYLOAD_BYTES) {
      return { ok: false, reason: 'payload-too-large', spans: snapshot.length, bytes: body.length };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await this._fetch(this._endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/x-protobuf' },
        body,
      });
      clearTimeout(timer);
      // 200-299 + 204 (No Content) are valid OTLP success per spec.
      if (resp && typeof resp.status === 'number' && resp.status >= 200 && resp.status < 300) {
        return { ok: true, reason: 'flushed', spans: snapshot.length, status: resp.status };
      }
      return { ok: false, reason: 'http-error', spans: snapshot.length, status: resp && resp.status };
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        return { ok: false, reason: 'timeout', spans: snapshot.length, error: 'OTLP flush timed out' };
      }
      return { ok: false, reason: 'fetch-failed', spans: snapshot.length, error: err && err.message };
    }
  }
}

// Public factory. Reads STEWARD_OTEL_ENDPOINT (with HERMES_OTEL_ENDPOINT
// backward-compat alias via env.cjs). Returns a tracer that is enabled iff
// the endpoint passes validateEndpoint(). Caller can override via opts.
//
// Sprint 2.0 security review (CWE-918): operator-controllable egress URLs
// are an SSRF + reconnaissance regression of the Sprint 1.6.20 H2 hardening.
// The validateEndpoint allow-list (loopback-only by default, /v1/traces or
// /v1/logs path required, STEWARD_OTEL_ALLOW_REMOTE=1 to opt in to non-loopback)
// keeps egress bounded.
function createTracer(opts = {}) {
  const rawFromEnv = readEnv('OTEL_ENDPOINT');
  const rawCandidate = opts.endpoint !== undefined ? opts.endpoint : rawFromEnv;

  let endpoint = null;
  let validationFailure = null;
  if (rawCandidate !== null && rawCandidate !== undefined) {
    const v = validateEndpoint(rawCandidate, { allowRemote: opts.allowRemote });
    if (v.ok) endpoint = v.url;
    else validationFailure = v.reason;
  }

  // If validation rejected a non-empty value, warn ONCE (per process) so the
  // operator notices a typo / malicious env without spamming logs. The empty/
  // unset case is silent (intended off-state).
  if (validationFailure && rawCandidate && String(rawCandidate).trim().length > 0
      && !createTracer._warned && process.env.STEWARD_SUPPRESS_DEPRECATION !== '1') {
    createTracer._warned = true;
    try {
      process.stderr.write(
        `[steward:otel] STEWARD_OTEL_ENDPOINT rejected (reason=${validationFailure}). ` +
        `Tracer disabled — observability falls back to journal SSOT. ` +
        `Allow-list: loopback URLs (http://127.0.0.1:*, http://localhost:*) ending in /v1/traces or /v1/logs. ` +
        `Set STEWARD_OTEL_ALLOW_REMOTE=1 to allow non-loopback hosts.\n`
      );
    } catch { /* stderr unavailable */ }
  }

  return new Tracer({
    endpoint,
    traceId: opts.traceId,
    runId: opts.runId,
    agentName: opts.agentName,
    serviceVersion: opts.serviceVersion,
    fetchImpl: opts.fetchImpl,
  });
}

// Test-only: reset the one-time warning latch so each test can verify
// independently. Not part of the public surface.
function _resetTracerWarning() { createTracer._warned = false; }

module.exports = {
  createTracer,
  generateTraceId,
  generateSpanId,
  KINDS,
  OTEL_STATUS,
  OTEL_SPAN_KIND,
  DEFAULT_ENDPOINT,
  // Internal — exported for tests only
  _Tracer: Tracer,
  _Span: Span,
  _NoopSpan: NoopSpan,
  _attrsToOtlp: attrsToOtlp,
  _toAnyValue: toAnyValue,
  _mapToOtelKind: mapToOtelKind,
  _nowNanosString: nowNanosString,
};
