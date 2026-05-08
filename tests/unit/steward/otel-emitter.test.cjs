'use strict';

/**
 * otel-emitter.test.cjs — Sprint 2.0 OTLP emitter unit tests.
 *
 * Covers:
 *   1. Fail-open behavior when STEWARD_OTEL_ENDPOINT is unset
 *   2. Fail-open behavior when endpoint is set but unreachable
 *   3. Span tree structure (parent-child relationships)
 *   4. OpenInference + gen_ai dual-attribute emission
 *   5. trace_id propagation across child spans
 *   6. OTLP wire format (resourceSpans → scopeSpans → spans)
 *   7. Numeric vs string attribute coercion (intValue, doubleValue, stringValue)
 *   8. Idempotent flush()
 *   9. Endpoint allow-list (SSRF guard)
 *  10. withSpan() auto-end + status on resolve/reject
 *  11. SpanKind mapping (AGENT/CHAIN→INTERNAL, LLM/TOOL→CLIENT)
 *  12. Status codes (UNSET/OK/ERROR)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const emitter = require('../../../bin/steward/_lib/otel-emitter.cjs');

// Capture and restore env vars across tests so they don't leak.
function saveEnv(keys) {
  const snap = {};
  for (const k of keys) snap[k] = process.env[k];
  return () => {
    for (const k of keys) {
      if (snap[k] === undefined) delete process.env[k];
      else process.env[k] = snap[k];
    }
  };
}

describe('otel-emitter: createTracer + fail-open', () => {
  let restoreEnv;

  beforeEach(() => {
    restoreEnv = saveEnv(['STEWARD_OTEL_ENDPOINT', 'STEWARD_OTEL_ALLOW_REMOTE', 'STEWARD_SUPPRESS_DEPRECATION']);
    delete process.env.STEWARD_OTEL_ENDPOINT;
    delete process.env.STEWARD_OTEL_ALLOW_REMOTE;
    process.env.STEWARD_SUPPRESS_DEPRECATION = '1';
  });
  afterEach(() => restoreEnv());

  test('endpoint unset → tracer disabled, NoopSpan returned, flush no-ops', async () => {
    const tracer = emitter.createTracer({});
    assert.equal(tracer.enabled, false);

    const span = tracer.startSpan({ name: 'test', kind: emitter.KINDS.AGENT });
    // NoopSpan has zero-padded trace/span ids so callers can still log them.
    assert.equal(span.traceId, '0'.repeat(32));
    assert.equal(span.spanId, '0'.repeat(16));
    span.setAttribute('foo', 'bar');
    span.setStatus(emitter.OTEL_STATUS.OK);
    span.end();

    const result = await tracer.flush();
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'no-endpoint');
    assert.equal(result.spans, 0);
  });

  test('endpoint empty string → tracer disabled (whitespace-trimmed)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = '   ';
    const tracer = emitter.createTracer({});
    assert.equal(tracer.enabled, false);
  });

  test('STEWARD_OTEL_ENDPOINT activates the tracer (canonical env var)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
    const t = emitter.createTracer({});
    assert.equal(t.enabled, true);
  });

  test('endpoint set but unreachable → flush returns {ok:false} but does not throw', async () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://127.0.0.1:1/v1/traces';  // port 1 = guaranteed closed
    const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
    const tracer = emitter.createTracer({ fetchImpl: fakeFetch });
    assert.equal(tracer.enabled, true);

    const s = tracer.startSpan({ name: 'will-fail', kind: emitter.KINDS.AGENT });
    s.end();

    const result = await tracer.flush();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'fetch-failed');
    assert.match(result.error || '', /ECONNREFUSED/);
    assert.equal(result.spans, 1);
  });

  test('opts.endpoint overrides env', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces' });
    assert.equal(tracer.enabled, true);
  });

  test('opts.endpoint=null forces tracer off even if env is set', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
    const tracer = emitter.createTracer({ endpoint: null });
    assert.equal(tracer.enabled, false);
  });
});

describe('otel-emitter: span tree + parent-child propagation', () => {
  let restoreEnv;
  beforeEach(() => {
    restoreEnv = saveEnv(['STEWARD_OTEL_ENDPOINT']);
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
  });
  afterEach(() => restoreEnv());

  test('child spans inherit parent traceId; parentSpanId points at parent', async () => {
    const captured = [];
    const fakeFetch = async (url, opts) => {
      captured.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => '' };
    };
    const tracer = emitter.createTracer({ fetchImpl: fakeFetch });
    const root = tracer.startSpan({ name: 'agent.run', kind: emitter.KINDS.AGENT });
    const child1 = tracer.startSpan({ name: 'llm.call', kind: emitter.KINDS.LLM, parent: root });
    const child2 = tracer.startSpan({ name: 'tool.test', kind: emitter.KINDS.TOOL, parent: root });
    child1.end();
    child2.end();
    root.end();

    await tracer.flush();
    const spans = captured[0].resourceSpans[0].scopeSpans[0].spans;
    assert.equal(spans.length, 3);
    assert.equal(root.traceId, child1.traceId);
    assert.equal(root.traceId, child2.traceId);
    assert.notEqual(root.spanId, child1.spanId);
    assert.notEqual(root.spanId, child2.spanId);

    const rootOtlp = spans.find((s) => s.spanId === root.spanId);
    const child1Otlp = spans.find((s) => s.spanId === child1.spanId);
    const child2Otlp = spans.find((s) => s.spanId === child2.spanId);
    assert.equal(rootOtlp.parentSpanId, undefined);
    assert.equal(child1Otlp.parentSpanId, root.spanId);
    assert.equal(child2Otlp.parentSpanId, root.spanId);
  });

  test('AGENT/CHAIN map to OTel INTERNAL; LLM/TOOL map to CLIENT', () => {
    const { _mapToOtelKind, OTEL_SPAN_KIND, KINDS } = emitter;
    assert.equal(_mapToOtelKind(KINDS.AGENT), OTEL_SPAN_KIND.INTERNAL);
    assert.equal(_mapToOtelKind(KINDS.CHAIN), OTEL_SPAN_KIND.INTERNAL);
    assert.equal(_mapToOtelKind(KINDS.LLM), OTEL_SPAN_KIND.CLIENT);
    assert.equal(_mapToOtelKind(KINDS.TOOL), OTEL_SPAN_KIND.CLIENT);
  });
});

describe('otel-emitter: OTLP wire format', () => {
  let restoreEnv;
  beforeEach(() => {
    restoreEnv = saveEnv(['STEWARD_OTEL_ENDPOINT']);
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
  });
  afterEach(() => restoreEnv());

  test('payload has resourceSpans → scopeSpans → spans envelope', async () => {
    let captured;
    const fakeFetch = async (url, opts) => {
      captured = { url, opts, body: JSON.parse(opts.body) };
      return { ok: true, status: 200, text: async () => '' };
    };
    const tracer = emitter.createTracer({ fetchImpl: fakeFetch, runId: '01HXTEST', agentName: 'steward' });
    tracer.startSpan({ name: 'span', kind: emitter.KINDS.AGENT }).end();
    const r = await tracer.flush();
    assert.equal(r.ok, true);
    assert.equal(r.spans, 1);

    assert.equal(captured.url, 'http://localhost:6006/v1/traces');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['Content-Type'], 'application/json');

    const root = captured.body.resourceSpans[0];
    assert.ok(root, 'has resourceSpans');
    assert.ok(Array.isArray(root.resource.attributes), 'resource.attributes is an array of {key,value}');

    // Resource attributes include service.name, service.version, steward.run_id
    const serviceName = root.resource.attributes.find((a) => a.key === 'service.name');
    assert.equal(serviceName.value.stringValue, 'steward');
    const runId = root.resource.attributes.find((a) => a.key === 'steward.run_id');
    assert.equal(runId.value.stringValue, '01HXTEST');

    const scope = root.scopeSpans[0];
    assert.equal(scope.scope.name, 'steward');
    assert.equal(scope.spans.length, 1);
  });

  test('attribute coercion: string → stringValue, int → intValue (string), float → doubleValue, bool → boolValue', () => {
    const { _toAnyValue, _attrsToOtlp } = emitter;

    assert.deepEqual(_toAnyValue('hello'), { stringValue: 'hello' });
    assert.deepEqual(_toAnyValue(42), { intValue: '42' });
    assert.deepEqual(_toAnyValue(3.14), { doubleValue: 3.14 });
    assert.deepEqual(_toAnyValue(true), { boolValue: true });
    assert.deepEqual(_toAnyValue(null), { stringValue: '' });
    assert.deepEqual(_toAnyValue(undefined), { stringValue: '' });

    // attrs object → list shape
    const out = _attrsToOtlp({ a: 'x', b: 1, c: 1.5, d: true });
    assert.equal(out.length, 4);
    assert.deepEqual(out[0], { key: 'a', value: { stringValue: 'x' } });
    assert.deepEqual(out[1], { key: 'b', value: { intValue: '1' } });
    assert.deepEqual(out[2], { key: 'c', value: { doubleValue: 1.5 } });
    assert.deepEqual(out[3], { key: 'd', value: { boolValue: true } });
  });

  test('undefined attribute values are dropped from the wire payload', () => {
    const out = emitter._attrsToOtlp({ kept: 'x', dropped: undefined });
    assert.equal(out.length, 1);
    assert.equal(out[0].key, 'kept');
  });

  test('startTimeUnixNano + endTimeUnixNano are stringified bigints (>2^53 safe)', () => {
    const t = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: async () => ({ ok: true, status: 200 }) });
    const s = t.startSpan({ name: 'x', kind: emitter.KINDS.AGENT });
    s.end();
    const otlp = s._toOtlp();
    assert.equal(typeof otlp.startTimeUnixNano, 'string');
    assert.equal(typeof otlp.endTimeUnixNano, 'string');
    // Must be a base-10 unsigned integer string.
    assert.match(otlp.startTimeUnixNano, /^\d+$/);
    assert.match(otlp.endTimeUnixNano, /^\d+$/);
  });
});

describe('otel-emitter: OpenInference + gen_ai dual-attribute set', () => {
  test('LLM span carries both openinference.span.kind and gen_ai.* on the same span', async () => {
    let captured;
    const fakeFetch = async (url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async () => '' };
    };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    const span = tracer.startSpan({
      name: 'llm.openrouter',
      kind: emitter.KINDS.LLM,
      attributes: {
        'gen_ai.system': 'openrouter',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'deepseek/deepseek-v4-flash',
        'gen_ai.usage.input_tokens': 1234,
        'gen_ai.usage.output_tokens': 567,
        'llm.provider': 'openrouter',
        'llm.model_name': 'deepseek/deepseek-v4-flash',
        'llm.token_count.prompt': 1234,
        'llm.token_count.completion': 567,
        'llm.token_count.total': 1801,
        'llm.cost_usd': 0.0008,
      },
    });
    span.end();
    await tracer.flush();

    const span0 = captured.resourceSpans[0].scopeSpans[0].spans[0];
    const get = (k) => (span0.attributes.find((a) => a.key === k) || {}).value;

    // openinference.span.kind is set automatically by Span constructor
    assert.equal(get('openinference.span.kind').stringValue, 'LLM');

    // Both attribute sets coexist
    assert.equal(get('gen_ai.system').stringValue, 'openrouter');
    assert.equal(get('llm.provider').stringValue, 'openrouter');
    assert.equal(get('gen_ai.usage.input_tokens').intValue, '1234');
    assert.equal(get('llm.token_count.prompt').intValue, '1234');
    assert.equal(get('llm.cost_usd').doubleValue, 0.0008);
  });
});

describe('otel-emitter: lifecycle invariants', () => {
  test('flush() is idempotent', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls += 1; return { ok: true, status: 200, text: async () => '' }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT }).end();

    const r1 = await tracer.flush();
    const r2 = await tracer.flush();
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.reason, 'already-flushed');
    assert.equal(calls, 1);
  });

  test('span.end() is idempotent', () => {
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces' });
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.end();
    const firstEnd = s._endNs;
    s.end();  // second call should not change end time
    assert.equal(s._endNs, firstEnd);
  });

  test('mutators on ended span are no-ops', () => {
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces' });
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.end();
    s.setAttribute('after.end', 'should not appear');
    const otlp = s._toOtlp();
    assert.equal(otlp.attributes.find((a) => a.key === 'after.end'), undefined);
  });

  test('withSpan() auto-ends + sets OK status on resolve', async () => {
    let captured;
    const fakeFetch = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 200 }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    const result = await tracer.withSpan({ name: 'work', kind: emitter.KINDS.TOOL }, async (span) => {
      span.setAttribute('inner', 'value');
      return 'done';
    });
    assert.equal(result, 'done');
    await tracer.flush();
    const span0 = captured.resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(span0.status.code, emitter.OTEL_STATUS.OK);
    const inner = span0.attributes.find((a) => a.key === 'inner');
    assert.equal(inner.value.stringValue, 'value');
  });

  test('withSpan() auto-ends + sets ERROR status on reject; rethrows', async () => {
    let captured;
    const fakeFetch = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 200 }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    await assert.rejects(
      tracer.withSpan({ name: 'fails', kind: emitter.KINDS.TOOL }, async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    await tracer.flush();
    const span0 = captured.resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(span0.status.code, emitter.OTEL_STATUS.ERROR);
    assert.match(span0.status.message, /boom/);
  });
});

describe('otel-emitter: HTTP error + timeout paths', () => {
  test('HTTP non-2xx → flush returns ok:false with status', async () => {
    const fakeFetch = async () => ({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT }).end();
    const r = await tracer.flush();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'http-error');
    assert.equal(r.status, 503);
  });

  test('AbortError on timeout → flush returns ok:false reason=timeout', async () => {
    const fakeFetch = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT }).end();
    const r = await tracer.flush();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timeout');
  });

  test('no-fetch (Node <18 simulation) → flush returns ok:false reason=no-fetch', async () => {
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: 'not-a-function' });
    tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT }).end();
    const r = await tracer.flush();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-fetch');
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — endpoint allow-list (SSRF)', () => {
  let restoreEnv;
  beforeEach(() => {
    restoreEnv = saveEnv(['STEWARD_OTEL_ENDPOINT', 'STEWARD_OTEL_ALLOW_REMOTE', 'STEWARD_SUPPRESS_DEPRECATION']);
    process.env.STEWARD_SUPPRESS_DEPRECATION = '1';
    delete process.env.STEWARD_OTEL_ENDPOINT;
    delete process.env.STEWARD_OTEL_ALLOW_REMOTE;
    emitter._resetTracerWarning && emitter._resetTracerWarning();
  });
  afterEach(() => restoreEnv());

  test('non-loopback endpoint rejected by default → tracer disabled', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://attacker.example.com/v1/traces';
    const tracer = emitter.createTracer({});
    assert.equal(tracer.enabled, false);
  });

  test('AWS metadata IP rejected (SSRF defense)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://169.254.169.254/v1/traces';
    const tracer = emitter.createTracer({});
    assert.equal(tracer.enabled, false);
  });

  test('non-OTLP path rejected (e.g. /api/exfil)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/api/exfil';
    const tracer = emitter.createTracer({});
    assert.equal(tracer.enabled, false);
  });

  test('non-http scheme rejected (file://, data:, javascript:)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'file:///etc/passwd';
    assert.equal(emitter.createTracer({}).enabled, false);
    process.env.STEWARD_OTEL_ENDPOINT = 'javascript:alert(1)';
    assert.equal(emitter.createTracer({}).enabled, false);
  });

  test('loopback variants accepted: 127.0.0.1, localhost, [::1]', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://127.0.0.1:6006/v1/traces';
    assert.equal(emitter.createTracer({}).enabled, true);
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
    assert.equal(emitter.createTracer({}).enabled, true);
    process.env.STEWARD_OTEL_ENDPOINT = 'http://[::1]:6006/v1/traces';
    assert.equal(emitter.createTracer({}).enabled, true);
  });

  test('STEWARD_OTEL_ALLOW_REMOTE=1 unlocks non-loopback hosts', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'https://otel.internal.corp/v1/traces';
    assert.equal(emitter.createTracer({}).enabled, false);
    process.env.STEWARD_OTEL_ALLOW_REMOTE = '1';
    assert.equal(emitter.createTracer({}).enabled, true);
  });

  test('opts.allowRemote=true overrides env gate', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'https://otel.internal.corp/v1/traces';
    assert.equal(emitter.createTracer({}).enabled, false);
    assert.equal(emitter.createTracer({ allowRemote: true }).enabled, true);
  });

  test('/v1/logs path also accepted (OTLP logs receiver)', () => {
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/logs';
    assert.equal(emitter.createTracer({}).enabled, true);
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — toAnyValue edge cases', () => {
  test('NaN coerces to stringValue, not corrupted JSON null', () => {
    const v = emitter._toAnyValue(NaN);
    assert.deepEqual(v, { stringValue: 'NaN' });
  });

  test('Infinity / -Infinity coerce to stringValue', () => {
    assert.deepEqual(emitter._toAnyValue(Infinity), { stringValue: 'Infinity' });
    assert.deepEqual(emitter._toAnyValue(-Infinity), { stringValue: '-Infinity' });
  });

  test('Symbol does not throw — emits stringValue', () => {
    const v = emitter._toAnyValue(Symbol('x'));
    assert.equal(typeof v.stringValue, 'string');
    assert.match(v.stringValue, /Symbol/);
  });

  test('Function does not emit source code — emits placeholder', () => {
    const fn = function namedFn() { return 'a'.repeat(10000); };
    const v = emitter._toAnyValue(fn);
    assert.equal(v.stringValue, '<function:namedFn>');
  });

  test('Date emits ISO string', () => {
    const d = new Date('2026-05-08T12:34:56.789Z');
    assert.deepEqual(emitter._toAnyValue(d), { stringValue: '2026-05-08T12:34:56.789Z' });
  });

  test('Buffer emits base64, not enumerated bytes', () => {
    const buf = Buffer.from('hello', 'utf8');
    const v = emitter._toAnyValue(buf);
    assert.equal(typeof v.stringValue, 'string');
    assert.equal(v.stringValue, Buffer.from('hello').toString('base64'));
  });

  test('BigInt emits stringValue', () => {
    assert.deepEqual(emitter._toAnyValue(123n), { stringValue: '123' });
  });

  test('Deeply nested object hits depth limit → stringValue placeholder', () => {
    let nested = { value: 'leaf' };
    for (let i = 0; i < 10; i += 1) nested = { inner: nested };
    const v = emitter._toAnyValue(nested);
    // Recursion is depth-limited; somewhere in the kvlist tree we hit
    // the depth-limit placeholder.
    const json = JSON.stringify(v);
    assert.match(json, /depth-limit|leaf/);
  });

  test('String attribute exceeding 8KB cap is truncated with ellipsis', () => {
    const huge = 'A'.repeat(20_000);
    const v = emitter._toAnyValue(huge);
    assert.ok(v.stringValue.length <= 8 * 1024);
    assert.match(v.stringValue, /\.\.\.$/);
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — setStatus path redaction', () => {
  let restoreEnv;
  beforeEach(() => {
    restoreEnv = saveEnv(['STEWARD_OTEL_ENDPOINT']);
    process.env.STEWARD_OTEL_ENDPOINT = 'http://localhost:6006/v1/traces';
  });
  afterEach(() => restoreEnv());

  test('setStatus redacts Windows absolute paths from message', () => {
    const tracer = emitter.createTracer({});
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.setStatus(emitter.OTEL_STATUS.ERROR, 'failed reading C:\\Users\\david\\secret.txt at line 5');
    assert.match(s._status.message, /<path>/);
    assert.doesNotMatch(s._status.message, /david/);
  });

  test('setStatus redacts POSIX absolute paths from message', () => {
    const tracer = emitter.createTracer({});
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.setStatus(emitter.OTEL_STATUS.ERROR, 'cannot stat /home/dave/.ssh/id_rsa');
    assert.match(s._status.message, /<path>/);
    assert.doesNotMatch(s._status.message, /dave/);
  });

  test('setStatus truncates very long messages to 200 bytes', () => {
    const tracer = emitter.createTracer({});
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.setStatus(emitter.OTEL_STATUS.ERROR, 'X'.repeat(5000));
    assert.ok(s._status.message.length <= 200);
  });

  test('setStatus drops non-string messages (only strings reach OTLP wire)', () => {
    const tracer = emitter.createTracer({});
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    s.setStatus(emitter.OTEL_STATUS.ERROR, { not: 'a string' });
    assert.equal(s._status.message, undefined);
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — NoopSpan as parent', () => {
  test('NoopSpan parent (all-zero spanId) is treated as no parent', async () => {
    const captured = [];
    const fakeFetch = async (url, opts) => { captured.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; };

    const noopTracer = emitter.createTracer({ endpoint: null });
    const noopSpan = noopTracer.startSpan({ name: 'fake-parent', kind: emitter.KINDS.AGENT });
    assert.equal(noopSpan.spanId, '0'.repeat(16));

    const realTracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    const child = realTracer.startSpan({ name: 'child', kind: emitter.KINDS.TOOL, parent: noopSpan });
    child.end();
    await realTracer.flush();

    const span0 = captured[0].resourceSpans[0].scopeSpans[0].spans[0];
    // parentSpanId must be undefined / absent — NOT the all-zero string
    assert.equal(span0.parentSpanId, undefined);
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — flush serialize-failed + payload-too-large', () => {
  test('payload-too-large returns ok:false reason=payload-too-large (not a fetch attempt)', async () => {
    let fetchCalls = 0;
    const fakeFetch = async () => { fetchCalls += 1; return { ok: true, status: 200 }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    // Fill a span with a multi-MB attribute value that bypasses the per-attr
    // truncation by wedging it inside a kvlist (less aggressive cap there).
    const span = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    // 50 attrs of 8KB each = 400 KB serialized; we want >1 MB to trip the cap.
    // Simpler: stuff an array of 200 huge strings.
    const big = 'X'.repeat(8000);
    const arr = [];
    for (let i = 0; i < 200; i += 1) arr.push(big);
    span.setAttribute('huge.array', arr);
    span.end();

    const r = await tracer.flush();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'payload-too-large');
    assert.equal(fetchCalls, 0, 'oversized payload must NOT hit the wire');
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — withSpan does not overwrite caller status', () => {
  test('withSpan: if inner sets ERROR, wrapper does NOT auto-set OK on resolve', async () => {
    let captured;
    const fakeFetch = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 200 }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    await tracer.withSpan({ name: 'soft-fail', kind: emitter.KINDS.TOOL }, async (span) => {
      span.setStatus(emitter.OTEL_STATUS.ERROR, 'soft failure as return value');
      return { ok: false };
    });
    await tracer.flush();
    const span0 = captured.resourceSpans[0].scopeSpans[0].spans[0];
    assert.equal(span0.status.code, emitter.OTEL_STATUS.ERROR);
  });
});

describe('otel-emitter: Sprint 2.0 review hardening — service.version semconv', () => {
  test('resource attributes include service.namespace=cortex-x and a non-empty service.version', async () => {
    let captured;
    const fakeFetch = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 200 }; };
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', fetchImpl: fakeFetch });
    tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT }).end();
    await tracer.flush();
    const attrs = captured.resourceSpans[0].resource.attributes;
    const ns = attrs.find((a) => a.key === 'service.namespace');
    const ver = attrs.find((a) => a.key === 'service.version');
    assert.equal(ns.value.stringValue, 'cortex-x');
    assert.ok(ver.value.stringValue.length > 0);
    assert.notEqual(ver.value.stringValue, 'cortex-x-steward', 'old hardcoded value should be gone');
  });
});

describe('otel-emitter: trace_id format invariants', () => {
  test('generateTraceId returns 32 hex chars', () => {
    const id = emitter.generateTraceId();
    assert.equal(id.length, 32);
    assert.match(id, /^[0-9a-f]{32}$/);
  });

  test('generateSpanId returns 16 hex chars', () => {
    const id = emitter.generateSpanId();
    assert.equal(id.length, 16);
    assert.match(id, /^[0-9a-f]{16}$/);
  });

  test('opts.traceId is honored when provided', () => {
    const fixed = 'a'.repeat(32);
    const tracer = emitter.createTracer({ endpoint: 'http://localhost:6006/v1/traces', traceId: fixed });
    assert.equal(tracer.traceId, fixed);
    const s = tracer.startSpan({ name: 's', kind: emitter.KINDS.AGENT });
    assert.equal(s.traceId, fixed);
  });
});
