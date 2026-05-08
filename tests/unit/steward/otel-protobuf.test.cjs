'use strict';

/**
 * otel-protobuf.cjs unit tests — Sprint 2.0.1 zero-deps OTLP protobuf encoder.
 *
 * Sprint 2.0 v1 shipped OTLP/JSON. Manual dogfood 2026-05-08 against live
 * Phoenix 15.5.1 surfaced 415 Unsupported Media Type — Phoenix only accepts
 * application/x-protobuf. Sprint 2.0.1 ships protobuf encoder.
 *
 * Tests focus on:
 *   - Wire-format primitives (varint, tag, length-delimited, fixed64)
 *   - Round-trip via known-good protobuf bytes (hand-computed)
 *   - OTLP semantic correctness (trace_id 16 bytes, span_id 8 bytes)
 *   - AnyValue type dispatch (string / int / double / bool / array / kvlist / bytes)
 *   - Edge cases (empty payload, all-zero parent_span_id, missing fields)
 *
 * We don't ship a protobuf DECODER (Steward never receives OTLP). Round-trip
 * tests use either a) hand-computed expected bytes, or b) the real Phoenix
 * collector consuming the bytes (validated separately via integration smoke).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const pb = require('../../../bin/steward/_lib/otel-protobuf.cjs');

describe('otel-protobuf: wire-format primitives', () => {
  test('encodeVarint: 0 → [0x00]', () => {
    assert.deepEqual([...pb.encodeVarint(0)], [0]);
  });

  test('encodeVarint: 1 → [0x01]', () => {
    assert.deepEqual([...pb.encodeVarint(1)], [1]);
  });

  test('encodeVarint: 127 → [0x7F]', () => {
    assert.deepEqual([...pb.encodeVarint(127)], [0x7F]);
  });

  test('encodeVarint: 128 → [0x80, 0x01]', () => {
    assert.deepEqual([...pb.encodeVarint(128)], [0x80, 0x01]);
  });

  test('encodeVarint: 300 → [0xAC, 0x02]', () => {
    // 300 = 0b1_0010_1100 → groups: 0010_1100, 0000_0010 → [0xAC, 0x02]
    assert.deepEqual([...pb.encodeVarint(300)], [0xAC, 0x02]);
  });

  test('encodeVarint: BigInt 2^64-1', () => {
    const max = (1n << 64n) - 1n;
    const encoded = pb.encodeVarint(max);
    // 10 bytes: 9 × 0xFF + 1 × 0x01 (last byte = 0x01 because the high bit
    // group of 64 bits is just 1).
    assert.equal(encoded.length, 10);
    for (let i = 0; i < 9; i += 1) assert.equal(encoded[i], 0xFF);
    assert.equal(encoded[9], 0x01);
  });

  test('encodeVarint: rejects negative', () => {
    assert.throws(() => pb.encodeVarint(-1));
    assert.throws(() => pb.encodeVarint(-1n));
  });

  test('encodeTag: field=1 wire=2 → 0x0A', () => {
    assert.deepEqual([...pb.encodeTag(1, 2)], [0x0A]);
  });

  test('encodeTag: field=15 wire=0 → 0x78', () => {
    // (15 << 3) | 0 = 0x78
    assert.deepEqual([...pb.encodeTag(15, 0)], [0x78]);
  });

  test('encodeString: "hi" → tag(field=1, wire=2), len=2, "hi"', () => {
    const r = pb.encodeString(1, 'hi');
    assert.deepEqual([...r], [0x0A, 0x02, 0x68, 0x69]); // 0x68=h, 0x69=i
  });

  test('encodeString: empty/null → empty buffer (proto3 default-omit)', () => {
    assert.equal(pb.encodeString(1, '').length, 0);
    assert.equal(pb.encodeString(1, null).length, 0);
    assert.equal(pb.encodeString(1, undefined).length, 0);
  });

  test('encodeFixed64Field: 0 → empty (default-omit)', () => {
    assert.equal(pb.encodeFixed64Field(7, 0).length, 0);
    assert.equal(pb.encodeFixed64Field(7, '0').length, 0);
  });

  test('encodeFixed64Field: BigInt timestamp encodes as 8 LE bytes after tag', () => {
    const ns = 1_700_000_000_000_000_000n;
    const r = pb.encodeFixed64Field(7, ns);
    // tag = (7 << 3) | 1 = 0x39
    assert.equal(r[0], 0x39);
    // Remaining 8 bytes = LE encoding of ns
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(ns);
    assert.deepEqual(r.slice(1), buf);
  });
});

describe('otel-protobuf: AnyValue dispatch', () => {
  test('string → field 1', () => {
    const r = pb.encodeAnyValue('hello');
    // tag = 0x0A (field 1, wire 2), len 5, "hello"
    assert.equal(r[0], 0x0A);
    assert.equal(r[1], 5);
    assert.equal(r.slice(2).toString('utf8'), 'hello');
  });

  test('boolean true → field 2 = 1', () => {
    const r = pb.encodeAnyValue(true);
    // tag = (2<<3)|0 = 0x10, varint 1
    assert.deepEqual([...r], [0x10, 0x01]);
  });

  test('boolean false → field 2 = 0 (explicit)', () => {
    const r = pb.encodeAnyValue(false);
    assert.deepEqual([...r], [0x10, 0x00]);
  });

  test('integer 42 → field 3 = 42', () => {
    const r = pb.encodeAnyValue(42);
    // tag = (3<<3)|0 = 0x18, varint 42 = 0x2A
    assert.deepEqual([...r], [0x18, 0x2A]);
  });

  test('float 3.14 → field 4 (double, fixed64)', () => {
    const r = pb.encodeAnyValue(3.14);
    // tag = (4<<3)|1 = 0x21
    assert.equal(r[0], 0x21);
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(3.14);
    assert.deepEqual(r.slice(1), buf);
  });

  test('array of strings → field 5 (ArrayValue with repeated AnyValue at field 1)', () => {
    const r = pb.encodeAnyValue(['a', 'b']);
    // Outer tag: (5<<3)|2 = 0x2A
    assert.equal(r[0], 0x2A);
    // Outer length follows; then nested repeated AnyValue with field 1
    // (which itself is a length-delimited message containing tag 1 for the
    // string). Just check the structure starts correctly.
    assert.ok(r.length > 4);
  });

  test('null/undefined → empty buffer', () => {
    assert.equal(pb.encodeAnyValue(null).length, 0);
    assert.equal(pb.encodeAnyValue(undefined).length, 0);
  });
});

describe('otel-protobuf: KeyValue + attributes', () => {
  test('encodeKeyValue("foo", "bar")', () => {
    const r = pb.encodeKeyValue('foo', 'bar');
    // field 1 = "foo": tag 0x0A, len 3, "foo"
    // field 2 = AnyValue containing string "bar":
    //   tag 0x12 (field 2, wire 2), len 5,
    //     inner: tag 0x0A (field 1, wire 2), len 3, "bar"
    assert.equal(r[0], 0x0A);
    assert.equal(r[1], 3);
    assert.equal(r.slice(2, 5).toString('utf8'), 'foo');
    assert.equal(r[5], 0x12);
  });

  test('encodeAttributes: empty/null → empty buffer', () => {
    assert.equal(pb.encodeAttributes(null).length, 0);
    assert.equal(pb.encodeAttributes({}).length, 0);
    assert.equal(pb.encodeAttributes(undefined).length, 0);
  });
});

describe('otel-protobuf: Span encoding', () => {
  test('encodes trace_id (16 bytes) + span_id (8 bytes) from hex', () => {
    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'test-span',
      startTimeUnixNano: 1_700_000_000_000_000_000n,
      endTimeUnixNano: 1_700_000_001_000_000_000n,
    };
    const buf = pb.encodeSpan(span);
    // First field tag for trace_id: field 1, wire 2 → 0x0A
    assert.equal(buf[0], 0x0A);
    // Length 16 (trace_id is 16 bytes)
    assert.equal(buf[1], 16);
    // Bytes 2..18 should be 16 bytes of 0xAA (hex 'aa' = 0xAA)
    for (let i = 2; i < 18; i += 1) {
      assert.equal(buf[i], 0xAA);
    }
    // Next: span_id tag (field 2, wire 2) = 0x12
    assert.equal(buf[18], 0x12);
    assert.equal(buf[19], 8);
    for (let i = 20; i < 28; i += 1) {
      assert.equal(buf[i], 0xBB);
    }
  });

  test('omits parent_span_id when all zeros', () => {
    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      parentSpanId: '0'.repeat(16),
      name: 's',
    };
    const buf = pb.encodeSpan(span);
    // Re-encode WITH non-zero parent and verify the delta is exactly the
    // parent_span_id field bytes (tag + len + 8 bytes = 10 bytes total).
    const span2 = { ...span, parentSpanId: 'c'.repeat(16) };
    const buf2 = pb.encodeSpan(span2);
    assert.ok(buf2.length > buf.length, 'non-zero parent must add bytes');
    assert.equal(buf2.length - buf.length, 10);
    // 2.0.1 R2 byte-level absence assertion: the all-zero parent_span_id
    // byte sequence (tag 0x22 + len 0x08 + 8 zeros) MUST NOT appear in buf.
    const allZeroParentBytes = Buffer.from([0x22, 0x08, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(buf.indexOf(allZeroParentBytes) === -1,
      'all-zero parent_span_id must be absent from wire');
  });

  test('omits kind when 0 (proto3 default-omit)', () => {
    const span1 = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'x' };
    const span2 = { ...span1, kind: 0 };
    const span3 = { ...span1, kind: 2 };
    assert.equal(pb.encodeSpan(span1).length, pb.encodeSpan(span2).length);
    assert.ok(pb.encodeSpan(span3).length > pb.encodeSpan(span1).length);
  });

  test('encodes status with code + message', () => {
    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 's',
      status: { code: 2, message: 'failed' },
    };
    const buf = pb.encodeSpan(span);
    // Status is field 15, wire 2 → tag = (15<<3)|2 = 0x7A
    assert.ok(buf.includes(0x7A));
  });
});

describe('otel-protobuf: 2.0.1 R2 review fixes — trust-boundary validation', () => {
  test('encodeAnyValue throws on negative BigInt? NO — sign-extends per proto3 int64', () => {
    // BLOCKER fix: pre-fix, negative BigInt was silently zeroed.
    // Post-fix: sign-extended to 10-byte two's complement varint.
    const r = pb.encodeAnyValue(-1n);
    // tag (3<<3)|0 = 0x18, then 10-byte varint = 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF 0x01
    assert.equal(r[0], 0x18);
    assert.equal(r.length, 11); // tag + 10 byte varint
    for (let i = 1; i < 10; i += 1) assert.equal(r[i], 0xFF);
    assert.equal(r[10], 0x01);
  });

  test('encodeAnyValue: negative integer Number routes to int_value (not double)', () => {
    const r = pb.encodeAnyValue(-42);
    // tag 0x18 (int_value), NOT 0x21 (double_value)
    assert.equal(r[0], 0x18);
    assert.notEqual(r[0], 0x21);
  });

  test('encodeSpan throws on malformed traceId', () => {
    assert.throws(
      () => pb.encodeSpan({ traceId: 'not-hex', spanId: 'b'.repeat(16), name: 's' }),
      /trace_id must match/,
    );
    assert.throws(
      () => pb.encodeSpan({ traceId: 'a'.repeat(31), spanId: 'b'.repeat(16), name: 's' }),
      /trace_id must match/,
    );
    assert.throws(
      () => pb.encodeSpan({ traceId: 'a'.repeat(33), spanId: 'b'.repeat(16), name: 's' }),
      /trace_id must match/,
    );
  });

  test('encodeSpan throws on malformed spanId', () => {
    assert.throws(
      () => pb.encodeSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(15), name: 's' }),
      /span_id must match/,
    );
    assert.throws(
      () => pb.encodeSpan({ traceId: 'a'.repeat(32), spanId: 'gg'.repeat(8), name: 's' }),
      /span_id must match/,
    );
  });

  test('encodeSpan throws on malformed parentSpanId', () => {
    assert.throws(
      () => pb.encodeSpan({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: 'not-hex-junk',
        name: 's',
      }),
      /parent_span_id must match/,
    );
  });

  test('encodeString throws on non-primitive object', () => {
    assert.throws(() => pb.encodeString(1, {}), /string-coercible primitive/);
    assert.throws(() => pb.encodeString(1, []), /string-coercible primitive/);
    assert.throws(() => pb.encodeString(1, () => {}), /string-coercible primitive/);
  });

  test('encodeFixed64Field throws on Number > MAX_SAFE_INTEGER', () => {
    assert.throws(() => pb.encodeFixed64Field(7, 1.7e18), /BigInt, digit-string, or safe-integer/);
  });

  test('encodeFixed64Field throws on negative', () => {
    assert.throws(() => pb.encodeFixed64Field(7, -1n), /negative/);
  });

  test('encodeFixed64Field accepts safe-integer Number', () => {
    const r = pb.encodeFixed64Field(7, 1234);
    assert.equal(r[0], 0x39); // tag
    // Bytes 1..8 should be 1234 LE
    const expected = Buffer.alloc(8);
    expected.writeBigUInt64LE(1234n);
    assert.deepEqual(r.slice(1), expected);
  });

  test('encodeAnyValue accepts Uint8Array as bytes_value', () => {
    const u8 = new Uint8Array([1, 2, 3]);
    const r = pb.encodeAnyValue(u8);
    // bytes_value field 7, wire 2 → tag 0x3A
    assert.equal(r[0], 0x3A);
    assert.equal(r[1], 3); // length
    assert.deepEqual([...r.slice(2)], [1, 2, 3]);
  });
});

describe('otel-protobuf: ExportTraceServiceRequest end-to-end', () => {
  test('full payload encodes to non-empty buffer', () => {
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: {
            'service.name': 'steward',
            'service.namespace': 'cortex-x',
          },
        },
        scopeSpans: [{
          scope: { name: 'steward', version: '0.1.0-pre' },
          spans: [{
            traceId: '1'.repeat(32),
            spanId: '2'.repeat(16),
            name: 'test',
            kind: 1,
            startTimeUnixNano: 1_700_000_000_000_000_000n,
            endTimeUnixNano: 1_700_000_001_000_000_000n,
            attributes: { 'gen_ai.system': 'openrouter' },
            status: { code: 1 },
          }],
        }],
      }],
    };
    const buf = pb.encodeExportTraceServiceRequest(payload);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 50);
    // First byte should be tag for field 1 (resourceSpans) wire 2 = 0x0A
    assert.equal(buf[0], 0x0A);
  });

  test('empty payload → empty buffer', () => {
    assert.equal(pb.encodeExportTraceServiceRequest({}).length, 0);
    assert.equal(pb.encodeExportTraceServiceRequest({ resourceSpans: [] }).length, 0);
  });

  test('large attribute strings are encoded without truncation by encoder itself', () => {
    // The emitter has its own attribute size cap; the encoder should not
    // truncate. Verify a 1KB string survives end-to-end.
    const big = 'x'.repeat(1024);
    const payload = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: '1'.repeat(32),
            spanId: '2'.repeat(16),
            name: 's',
            attributes: { big },
          }],
        }],
      }],
    };
    const buf = pb.encodeExportTraceServiceRequest(payload);
    // Buffer should contain the full 1024-byte string verbatim somewhere.
    assert.ok(buf.includes(Buffer.from(big)));
  });
});
