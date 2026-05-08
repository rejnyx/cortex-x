// otel-protobuf.cjs — Sprint 2.0.1 zero-deps OTLP protobuf encoder.
//
// Sprint 2.0 shipped OTLP/JSON encoding (Content-Type: application/json)
// against the OpenTelemetry HTTP spec which permits both JSON and protobuf.
// Manual dogfood 2026-05-08 against live Phoenix 15.5.1 surfaced that
// Phoenix's OTLP HTTP receiver returns 415 Unsupported Media Type on JSON —
// it only accepts application/x-protobuf. Spec is permissive; real receivers
// are not. This module encodes spans into the canonical OTLP protobuf wire
// format so Phoenix (and any spec-compliant collector) accepts the payload.
//
// Schema reference: https://github.com/open-telemetry/opentelemetry-proto
// (commit pinned via tests; refresh schema only on collector breakage).
//
// Zero-deps: pure Node Buffer manipulation, no `protobufjs`, no `@grpc/...`.
// We only need to ENCODE (Steward never receives OTLP — Phoenix does).
// Decoding lives in tests via JSON-equivalent comparison, no wire-format
// round-trip needed.
//
// Wire format primer (sufficient for OTLP traces):
//   - tag = (field_number << 3) | wire_type
//   - wire_type 0 = varint (uint, int, bool, enum)
//   - wire_type 1 = fixed64 (8 bytes LE)
//   - wire_type 2 = length-delimited (string, bytes, embedded message, packed)
//   - wire_type 5 = fixed32 (4 bytes LE)
//   - varint encoding: 7 bits per byte, continuation bit on each but the last

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Wire-format primitives
// ─────────────────────────────────────────────────────────────────────────────

// Encode a non-negative integer or BigInt as a varint. Returns Buffer.
// For OTLP, only non-negative values appear (uint32, uint64, enum, length).
function encodeVarint(n) {
  // Coerce small numbers to plain Number; large to BigInt for precision.
  let value;
  if (typeof n === 'bigint') {
    if (n < 0n) throw new TypeError('varint cannot be negative');
    value = n;
  } else {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new TypeError(`varint requires non-negative finite number, got ${n}`);
    }
    if (n > Number.MAX_SAFE_INTEGER) {
      // Beyond 2^53; promote to BigInt to preserve precision.
      value = BigInt(Math.floor(n));
    } else {
      value = n;
    }
  }
  const bytes = [];
  if (typeof value === 'bigint') {
    while (value >= 128n) {
      bytes.push(Number((value & 0x7Fn) | 0x80n));
      value >>= 7n;
    }
    bytes.push(Number(value));
  } else {
    while (value >= 128) {
      bytes.push((value & 0x7F) | 0x80);
      value = Math.floor(value / 128);
    }
    bytes.push(value);
  }
  return Buffer.from(bytes);
}

// Encode a tag (field_number, wire_type).
function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

// Encode a length-delimited field: tag + varint length + payload bytes.
function encodeLengthDelimited(fieldNumber, payload) {
  const tag = encodeTag(fieldNumber, 2);
  const len = encodeVarint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

// Encode a string field (UTF-8 length-delimited). proto3 default-omit: empty
// string is the default value of `string` type and is NOT serialized.
//
// 2.0.1 R2 fix: explicit type guard. Pre-fix, `String({})` produced
// "[object Object]" silently — operator typo could land junk on the wire
// without warning. Now: only string + finite primitive (number, boolean,
// bigint) accepted; objects throw.
function encodeString(fieldNumber, value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  if (typeof value !== 'string'
    && typeof value !== 'number'
    && typeof value !== 'boolean'
    && typeof value !== 'bigint') {
    throw new TypeError(`encodeString requires string-coercible primitive, got ${typeof value}`);
  }
  const str = String(value);
  if (str.length === 0) return Buffer.alloc(0);
  const bytes = Buffer.from(str, 'utf8');
  return encodeLengthDelimited(fieldNumber, bytes);
}

// Encode a bytes field (length-delimited).
function encodeBytes(fieldNumber, buf) {
  if (!buf || buf.length === 0) return Buffer.alloc(0);
  return encodeLengthDelimited(fieldNumber, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
}

// Encode a varint field with tag.
function encodeVarintField(fieldNumber, value) {
  if (value === undefined || value === null || value === 0) {
    // Default values are omitted on the wire per proto3.
    return Buffer.alloc(0);
  }
  return Buffer.concat([encodeTag(fieldNumber, 0), encodeVarint(value)]);
}

// Encode an enum field (proto3 default-omit semantics: 0 = omitted).
function encodeEnumField(fieldNumber, value) {
  return encodeVarintField(fieldNumber, value);
}

// Encode a fixed64 field. Accepts BigInt or string-of-digits.
// For OTLP, used for nanosec timestamps which exceed 2^53 — Number values
// are REJECTED to prevent silent precision loss in the upper bits.
//
// 2.0.1 R2 fix: removed the `Math.floor(Number(value))` Number-fallback.
// Pre-fix path corrupted the low ~3 digits of a 1.7e18 ns timestamp passed
// as Number. Now: caller must pass BigInt or numeric string.
function encodeFixed64Field(fieldNumber, value) {
  if (value === undefined || value === null) return Buffer.alloc(0);
  let bi;
  if (typeof value === 'bigint') bi = value;
  else if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) {
      throw new TypeError(`fixed64 string must be base-10 digits, got ${value.slice(0, 64)}`);
    }
    bi = BigInt(value);
  }
  else if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
    // Safe integer Numbers (< 2^53) accepted because the upper bits are
    // guaranteed zero — no precision loss.
    bi = BigInt(value);
  }
  else {
    throw new TypeError(`fixed64 requires BigInt, digit-string, or safe-integer Number, got ${typeof value}`);
  }
  if (bi < 0n) throw new TypeError(`fixed64 negative not supported: ${value}`);
  if (bi === 0n) return Buffer.alloc(0); // proto3 default-omit
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bi);
  return Buffer.concat([encodeTag(fieldNumber, 1), buf]);
}

// Encode a double field (fixed64 with double bits).
function encodeDoubleField(fieldNumber, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Buffer.alloc(0);
  const buf = Buffer.alloc(8);
  buf.writeDoubleLE(value);
  return Buffer.concat([encodeTag(fieldNumber, 1), buf]);
}

// Encode an embedded message field: tag + varint length + nested-message bytes.
function encodeMessageField(fieldNumber, messageBuf) {
  if (!messageBuf || messageBuf.length === 0) return Buffer.alloc(0);
  return encodeLengthDelimited(fieldNumber, messageBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// OTLP message encoders
// ─────────────────────────────────────────────────────────────────────────────

// proto3 int64 negatives encode as 10-byte two's-complement varints. We
// don't use them today (Steward never emits negative attribute values) but
// the encoder must not silently corrupt operator data. Encode via
// uint64-cast: `int64 -1` ↔ `uint64 0xFFFF...FFFF`. Returns Buffer.
function encodeSignedVarintInt64(bi) {
  if (typeof bi !== 'bigint') {
    throw new TypeError(`encodeSignedVarintInt64 requires BigInt, got ${typeof bi}`);
  }
  if (bi < 0n) {
    // Two's complement in 64 bits: bi + 2^64
    return encodeVarint((1n << 64n) + bi);
  }
  return encodeVarint(bi);
}

// AnyValue (common.v1) — oneof
//   string_value=1, bool_value=2, int_value=3, double_value=4,
//   array_value=5, kvlist_value=6, bytes_value=7
//
// 2.0.1 R2 BLOCKER fix: negatives no longer silently zero-coerce. BigInt
// negatives sign-extend per proto3 spec; Number integers (including
// negatives) route to int_value with proper signed encoding. Only true
// floats land in double_value.
function encodeAnyValue(v) {
  if (v === null || v === undefined) {
    // No value set; emit empty AnyValue (legal — represents NULL).
    return Buffer.alloc(0);
  }
  if (typeof v === 'string') {
    return encodeString(1, v);
  }
  if (typeof v === 'boolean') {
    // bool_value field 2 — explicit emission (oneof semantics: must
    // distinguish "false" from "unset"). Don't use encodeBoolField (it
    // does default-omit which is wrong here).
    return Buffer.concat([encodeTag(2, 0), encodeVarint(v ? 1 : 0)]);
  }
  if (typeof v === 'bigint') {
    // int_value field 3 — int64 is varint encoded with sign extension.
    return Buffer.concat([encodeTag(3, 0), encodeSignedVarintInt64(v)]);
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v)) {
      // int_value field 3 — works for both positive and negative integers
      // via the signed varint encoder. Promote to BigInt to bypass int32
      // coercion in bitwise ops.
      return Buffer.concat([encodeTag(3, 0), encodeSignedVarintInt64(BigInt(v))]);
    }
    // double_value field 4 (true float / NaN / Infinity caught upstream)
    return encodeDoubleField(4, v);
  }
  if (Buffer.isBuffer(v) || (v && typeof v === 'object' && ArrayBuffer.isView(v))) {
    // bytes_value field 7. Accept Buffer + any TypedArray view.
    return encodeBytes(7, Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  }
  if (Array.isArray(v)) {
    // array_value field 5 — ArrayValue { repeated AnyValue values = 1 }
    const inner = Buffer.concat(v.map((item) => encodeMessageField(1, encodeAnyValue(item))));
    return encodeMessageField(5, inner);
  }
  if (typeof v === 'object') {
    // kvlist_value field 6 — KeyValueList { repeated KeyValue values = 1 }
    const kvs = Object.entries(v).map(([k, val]) => encodeMessageField(1, encodeKeyValue(k, val)));
    return encodeMessageField(6, Buffer.concat(kvs));
  }
  // Fallback (Symbol, function): stringify with explicit cast for safety.
  return encodeString(1, String(v));
}

// KeyValue { string key = 1; AnyValue value = 2 }
function encodeKeyValue(key, value) {
  return Buffer.concat([
    encodeString(1, key),
    encodeMessageField(2, encodeAnyValue(value)),
  ]);
}

// KeyValue list as length-prefixed messages — used by Resource + Scope + Span attributes.
function encodeAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return Buffer.alloc(0);
  const parts = [];
  for (const [k, v] of Object.entries(attributes)) {
    if (k == null || k === '') continue;
    parts.push(encodeMessageField(1, encodeKeyValue(k, v)));
  }
  return Buffer.concat(parts);
}

// Status (trace.v1) { string message = 2; StatusCode code = 3 }
// StatusCode: UNSET=0, OK=1, ERROR=2
function encodeStatus(status) {
  if (!status) return Buffer.alloc(0);
  const parts = [];
  if (status.message) parts.push(encodeString(2, status.message));
  if (status.code !== undefined && status.code !== 0) {
    parts.push(encodeEnumField(3, status.code));
  }
  return Buffer.concat(parts);
}

// Span (trace.v1)
//   bytes trace_id=1, bytes span_id=2, string trace_state=3, bytes parent_span_id=4,
//   string name=5, SpanKind kind=6, fixed64 start_time_unix_nano=7,
//   fixed64 end_time_unix_nano=8, repeated KeyValue attributes=9,
//   uint32 dropped_attributes_count=10, repeated Event events=11,
//   uint32 dropped_events_count=12, repeated Link links=13,
//   uint32 dropped_links_count=14, Status status=15
// 2.0.1 R2 BLOCKER fix: validate hex inputs before Buffer.from. `Buffer.from(s, 'hex')`
// silently truncates on the first non-hex character + drops trailing odd
// nibble — produces wrong-length trace_id/span_id silently. OTLP spec
// requires 16-byte trace_id + 8-byte span_id; Phoenix will reject or
// misattribute on length mismatch.
const HEX_TRACE_ID_RE = /^[0-9a-f]{32}$/i;
const HEX_SPAN_ID_RE = /^[0-9a-f]{16}$/i;
function hexToBytesValidated(hex, expectedRegex, fieldName) {
  if (typeof hex !== 'string' || !expectedRegex.test(hex)) {
    throw new TypeError(`${fieldName} must match ${expectedRegex} (got ${typeof hex === 'string' ? hex.slice(0, 64) : typeof hex})`);
  }
  return Buffer.from(hex, 'hex');
}

function encodeSpan(span) {
  const parts = [];
  // trace_id (16 bytes / 32 hex chars) — REQUIRED per OTLP spec.
  if (span.traceId) {
    parts.push(encodeBytes(1, hexToBytesValidated(span.traceId, HEX_TRACE_ID_RE, 'trace_id')));
  }
  // span_id (8 bytes / 16 hex chars) — REQUIRED per OTLP spec.
  if (span.spanId) {
    parts.push(encodeBytes(2, hexToBytesValidated(span.spanId, HEX_SPAN_ID_RE, 'span_id')));
  }
  if (span.parentSpanId) {
    const parentBuf = hexToBytesValidated(span.parentSpanId, HEX_SPAN_ID_RE, 'parent_span_id');
    // OTLP spec: omit parent_span_id when it's all zeros (NoopSpan parent).
    if (!parentBuf.every((b) => b === 0)) {
      parts.push(encodeBytes(4, parentBuf));
    }
  }
  if (span.name) parts.push(encodeString(5, span.name));
  if (span.kind !== undefined && span.kind !== 0) {
    parts.push(encodeEnumField(6, span.kind));
  }
  if (span.startTimeUnixNano) parts.push(encodeFixed64Field(7, span.startTimeUnixNano));
  if (span.endTimeUnixNano) parts.push(encodeFixed64Field(8, span.endTimeUnixNano));
  if (span.attributes) {
    const attrBuf = encodeAttributes(span.attributes);
    if (attrBuf.length > 0) {
      // attributes is repeated KeyValue with field number 9; encodeAttributes
      // emits with field number 1 (for KeyValueList context). Re-tag here.
      const parts2 = [];
      for (const [k, v] of Object.entries(span.attributes)) {
        if (k == null || k === '') continue;
        parts2.push(encodeMessageField(9, encodeKeyValue(k, v)));
      }
      parts.push(Buffer.concat(parts2));
    }
  }
  if (span.status) parts.push(encodeMessageField(15, encodeStatus(span.status)));
  return Buffer.concat(parts);
}

// InstrumentationScope (common.v1)
//   string name=1, string version=2, repeated KeyValue attributes=3,
//   uint32 dropped_attributes_count=4
function encodeScope(scope) {
  if (!scope) return Buffer.alloc(0);
  const parts = [];
  if (scope.name) parts.push(encodeString(1, scope.name));
  if (scope.version) parts.push(encodeString(2, scope.version));
  if (scope.attributes) {
    for (const [k, v] of Object.entries(scope.attributes)) {
      if (k == null || k === '') continue;
      parts.push(encodeMessageField(3, encodeKeyValue(k, v)));
    }
  }
  return Buffer.concat(parts);
}

// ScopeSpans (trace.v1)
//   InstrumentationScope scope=1, repeated Span spans=2, string schema_url=3
function encodeScopeSpans(scopeSpans) {
  const parts = [];
  if (scopeSpans.scope) parts.push(encodeMessageField(1, encodeScope(scopeSpans.scope)));
  if (Array.isArray(scopeSpans.spans)) {
    for (const span of scopeSpans.spans) {
      parts.push(encodeMessageField(2, encodeSpan(span)));
    }
  }
  if (scopeSpans.schemaUrl) parts.push(encodeString(3, scopeSpans.schemaUrl));
  return Buffer.concat(parts);
}

// Resource (resource.v1)
//   repeated KeyValue attributes=1, uint32 dropped_attributes_count=2
function encodeResource(resource) {
  if (!resource) return Buffer.alloc(0);
  const parts = [];
  if (resource.attributes) {
    for (const [k, v] of Object.entries(resource.attributes)) {
      if (k == null || k === '') continue;
      parts.push(encodeMessageField(1, encodeKeyValue(k, v)));
    }
  }
  return Buffer.concat(parts);
}

// ResourceSpans (trace.v1)
//   Resource resource=1, repeated ScopeSpans scope_spans=2, string schema_url=3
function encodeResourceSpans(resourceSpans) {
  const parts = [];
  if (resourceSpans.resource) parts.push(encodeMessageField(1, encodeResource(resourceSpans.resource)));
  if (Array.isArray(resourceSpans.scopeSpans)) {
    for (const ss of resourceSpans.scopeSpans) {
      parts.push(encodeMessageField(2, encodeScopeSpans(ss)));
    }
  }
  if (resourceSpans.schemaUrl) parts.push(encodeString(3, resourceSpans.schemaUrl));
  return Buffer.concat(parts);
}

// ExportTraceServiceRequest (collector/trace/v1)
//   repeated ResourceSpans resource_spans=1
function encodeExportTraceServiceRequest(payload) {
  const parts = [];
  if (Array.isArray(payload.resourceSpans)) {
    for (const rs of payload.resourceSpans) {
      parts.push(encodeMessageField(1, encodeResourceSpans(rs)));
    }
  }
  return Buffer.concat(parts);
}

module.exports = {
  // Public top-level: encode a payload object (the same shape we previously
  // serialized to JSON via toResourceSpansShape) into protobuf-binary Buffer.
  encodeExportTraceServiceRequest,
  // Lower-level encoders exposed for tests + future re-use
  encodeResourceSpans,
  encodeScopeSpans,
  encodeResource,
  encodeScope,
  encodeSpan,
  encodeStatus,
  encodeKeyValue,
  encodeAnyValue,
  encodeAttributes,
  // Wire-format primitives
  encodeVarint,
  encodeSignedVarintInt64,
  encodeTag,
  encodeLengthDelimited,
  encodeString,
  encodeBytes,
  encodeVarintField,
  encodeEnumField,
  encodeFixed64Field,
  encodeDoubleField,
  encodeMessageField,
  // Validation helpers
  hexToBytesValidated,
  HEX_TRACE_ID_RE,
  HEX_SPAN_ID_RE,
};
