'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildVerdict,
  verifyVerdict,
  loadVerdict,
  canonicalize,
  _SCHEMA_VERSION,
  _SIG_ALG,
} = require('../../../bin/steward/_lib/r2-verdict.cjs');

const FIXED_SECRET = 'cortex-test-secret-1234567890';

function fixedInput(overrides) {
  return Object.assign(
    {
      sprintId: '2.46',
      workflowRunId: '00000000-0000-4000-8000-000000000001',
      timestamp: '2026-06-03T12:00:00.000Z',
      agentRoster: [
        'security',
        'correctness',
        'acceptance',
        'ssot',
        'blind',
        'edge-case',
      ],
      findings: { HIGH: 0, MEDIUM: 2, LOW: 7 },
      applied: ['F-1', 'F-2'],
      deferred: [],
      refuted: [],
      decision: 'PASS',
      secret: FIXED_SECRET,
    },
    overrides || {}
  );
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `r2-verdict-${prefix}-`));
}

describe('r2-verdict: buildVerdict', () => {
  test('returns signed payload with schema_version + signature block', () => {
    const verdict = buildVerdict(fixedInput());
    assert.equal(verdict.schema_version, _SCHEMA_VERSION);
    assert.equal(verdict.sprint_id, '2.46');
    assert.equal(verdict.decision, 'PASS');
    assert.ok(verdict.signature, 'signature block present');
    assert.equal(verdict.signature.alg, _SIG_ALG);
    assert.ok(
      /^[0-9a-f]{64}$/.test(verdict.signature.value),
      'signature value is 64-char hex (HMAC-SHA256)'
    );
  });

  test('preserves sprintId and workflowRunId through build', () => {
    const verdict = buildVerdict(
      fixedInput({
        sprintId: '99.99',
        workflowRunId: 'wf-deadbeef',
      })
    );
    assert.equal(verdict.sprint_id, '99.99');
    assert.equal(verdict.workflow_run_id, 'wf-deadbeef');
  });

  test('throws on missing required input', () => {
    assert.throws(() => buildVerdict(null), /INPUT_REQUIRED/);
    assert.throws(
      () => buildVerdict(fixedInput({ sprintId: undefined })),
      /MISSING_SPRINT_ID/
    );
    assert.throws(
      () => buildVerdict(fixedInput({ timestamp: undefined })),
      /MISSING_TIMESTAMP/
    );
  });

  test('requires explicit decision — never defaults to PASS', () => {
    // Sprint 2.46 L-25: a buggy caller passing decision:undefined / '' / null
    // must NOT silently produce a PASS verdict that unblocks the gate.
    assert.throws(
      () => buildVerdict(fixedInput({ decision: undefined })),
      /MISSING_DECISION/
    );
    assert.throws(
      () => buildVerdict(fixedInput({ decision: '' })),
      /MISSING_DECISION/
    );
    assert.throws(
      () => buildVerdict(fixedInput({ decision: null })),
      /MISSING_DECISION/
    );
    assert.throws(
      () => buildVerdict(fixedInput({ decision: 'MAYBE' })),
      /MISSING_DECISION/
    );
  });

  test('accepts FAIL decision and round-trips it', () => {
    const verdict = buildVerdict(fixedInput({ decision: 'FAIL' }));
    assert.equal(verdict.decision, 'FAIL');
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, true);
    assert.equal(result.parsed.decision, 'FAIL');
  });
});

describe('r2-verdict: verifyVerdict (round-trip)', () => {
  test('returns ok:true on untampered payload', () => {
    const verdict = buildVerdict(fixedInput());
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
    assert.ok(result.parsed);
    assert.equal(result.parsed.sprint_id, '2.46');
  });

  test('round-trips when serialized to JSON string', () => {
    const verdict = buildVerdict(fixedInput());
    const serialized = JSON.stringify(verdict);
    const result = verifyVerdict(serialized, FIXED_SECRET);
    assert.equal(result.ok, true);
  });

  test('sprintId and workflowRunId survive round-trip', () => {
    const verdict = buildVerdict(
      fixedInput({
        sprintId: '3.14',
        workflowRunId: 'wf-pi',
      })
    );
    const result = verifyVerdict(JSON.stringify(verdict), FIXED_SECRET);
    assert.equal(result.ok, true);
    assert.equal(result.parsed.sprint_id, '3.14');
    assert.equal(result.parsed.workflow_run_id, 'wf-pi');
  });
});

describe('r2-verdict: canonicalize', () => {
  test('is deterministic for same input', () => {
    const obj = { b: 2, a: 1, c: [3, 2, 1] };
    const a = canonicalize(obj);
    const b = canonicalize(obj);
    assert.equal(a, b);
  });

  test('sorts keys recursively regardless of insertion order', () => {
    const first = { z: 1, a: { y: 2, b: 3 } };
    const second = { a: { b: 3, y: 2 }, z: 1 };
    assert.equal(canonicalize(first), canonicalize(second));
    assert.equal(
      canonicalize(first),
      '{"a":{"b":3,"y":2},"z":1}'
    );
  });

  test('preserves array order', () => {
    assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  });

  test('handles primitives + null', () => {
    assert.equal(canonicalize(null), 'null');
    assert.equal(canonicalize(true), 'true');
    assert.equal(canonicalize(false), 'false');
    assert.equal(canonicalize(42), '42');
    assert.equal(canonicalize('x'), '"x"');
  });

  test('drops object keys whose value is undefined (JSON.stringify parity)', () => {
    // Sprint 2.46 M-16: previously threw CORTEX_R2_VERDICT_UNSUPPORTED_TYPE.
    assert.equal(canonicalize({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
    assert.equal(canonicalize({ x: undefined }), '{}');
  });

  test('serializes undefined array slots as null (JSON.stringify parity)', () => {
    // Sprint 2.46 M-16: previously threw CORTEX_R2_VERDICT_UNSUPPORTED_TYPE.
    const sparse = [1, undefined, 3];
    assert.equal(canonicalize(sparse), '[1,null,3]');
  });
});

describe('r2-verdict: tamper detection', () => {
  test('rejects tampered findings.HIGH count', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.findings.HIGH = 99;
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('rejects tampered decision (PASS → FAIL)', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.decision = 'FAIL';
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('rejects tampered signature value', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.signature.value = 'f'.repeat(64);
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('rejects mismatched signature length', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.signature.value = 'ab';
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('rejects wrong secret', () => {
    const verdict = buildVerdict(fixedInput());
    const result = verifyVerdict(verdict, 'different-secret');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });
});

describe('r2-verdict: schema + alg gates', () => {
  test('rejects schema_version mismatch', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.schema_version = 99;
    // Re-sign with bad schema would still hit SCHEMA_MISMATCH first because
    // verifier checks schema before signature.
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SCHEMA_VERSION_MISMATCH');
  });

  test('rejects unsupported signature algorithm', () => {
    const verdict = buildVerdict(fixedInput());
    verdict.signature.alg = 'RSA-SHA256';
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_UNSUPPORTED_ALG');
  });

  test('rejects missing signature block entirely', () => {
    const verdict = buildVerdict(fixedInput());
    delete verdict.signature;
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_MISSING_SIGNATURE');
  });
});

describe('r2-verdict: malformed input', () => {
  test('rejects non-JSON string', () => {
    const result = verifyVerdict('this is not json {', FIXED_SECRET);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_MALFORMED_JSON');
  });

  test('rejects null / non-object input', () => {
    const a = verifyVerdict(null, FIXED_SECRET);
    assert.equal(a.ok, false);
    assert.equal(a.reason, 'CORTEX_R2_VERDICT_MALFORMED_JSON');
    const b = verifyVerdict(42, FIXED_SECRET);
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'CORTEX_R2_VERDICT_MALFORMED_JSON');
  });
});

describe('r2-verdict: fail-OPEN on missing secret', () => {
  test('returns ok:true with explicit warning when secret undefined', () => {
    const verdict = buildVerdict(fixedInput());
    const result = verifyVerdict(verdict, undefined);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_NO_SECRET_WARNING');
    assert.ok(result.parsed);
  });

  test('returns ok:true with warning when secret is empty string', () => {
    const verdict = buildVerdict(fixedInput());
    const result = verifyVerdict(verdict, '');
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_NO_SECRET_WARNING');
  });
});

describe('r2-verdict: loadVerdict', () => {
  test('returns null when cortex/r2-verdict.json absent', () => {
    const root = tmpDir('absent');
    const result = loadVerdict(root);
    assert.equal(result, null);
  });

  test('round-trips a written verdict from disk', () => {
    const root = tmpDir('present');
    const cortexDir = path.join(root, 'cortex');
    fs.mkdirSync(cortexDir, { recursive: true });
    const verdict = buildVerdict(fixedInput());
    fs.writeFileSync(
      path.join(cortexDir, 'r2-verdict.json'),
      JSON.stringify(verdict, null, 2),
      'utf8'
    );
    const loaded = loadVerdict(root);
    assert.ok(loaded);
    assert.ok(loaded.json);
    assert.equal(loaded.json.sprint_id, '2.46');
    const verified = verifyVerdict(loaded.json, FIXED_SECRET);
    assert.equal(verified.ok, true);
  });

  test('throws on missing rootDir argument', () => {
    assert.throws(() => loadVerdict(), /LOAD_ROOT_REQUIRED/);
    assert.throws(() => loadVerdict(null), /LOAD_ROOT_REQUIRED/);
  });
});
