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
  _resolveSecret,
  _resolveSecretNoGenerate,
  _secretFilePath,
  _signPayloadEd25519,
  _verifyPayloadEd25519,
  _toBase64Url,
  _fromBase64Url,
  _SCHEMA_VERSION,
  _SCHEMA_VERSION_V2,
  _SIG_ALG,
  _SIG_ALG_ED25519,
} = require('../../../bin/steward/_lib/r2-verdict.cjs');
const crypto = require('node:crypto');

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

// =============================================================================
// Sprint 2.46.1 — v2 schema + Ed25519 + STRICT_SECRET
// =============================================================================

const FIXED_COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';
const FIXED_STAGED_TREE = 'fedcba9876543210fedcba9876543210fedcba98';

function v2Input(overrides) {
  return Object.assign(fixedInput(), {
    commitSha: FIXED_COMMIT_SHA,
    stagedTree: FIXED_STAGED_TREE,
    schemaVersion: _SCHEMA_VERSION_V2,
  }, overrides || {});
}

function generateEd25519Pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyId =
    'ed25519:' + crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
  return { privateKeyPem, publicKeyPem, publicKeyId };
}

describe('r2-verdict v2: schema_version + commit_sha', () => {
  test('T1: v2 build emits schema_version=2 + commit_sha + staged_tree', () => {
    const verdict = buildVerdict(v2Input());
    assert.equal(verdict.schema_version, _SCHEMA_VERSION_V2);
    assert.equal(verdict.commit_sha, FIXED_COMMIT_SHA);
    assert.equal(verdict.staged_tree, FIXED_STAGED_TREE);
    assert.equal(verdict.signature.alg, _SIG_ALG);
    assert.equal(verdict.signature.secret_tier, 'env'); // explicit secret = env tier
  });

  test('T2: v2 verifyVerdict ok:true on round-trip with options.headSha matching', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
  });

  test('T3: v2 verifyVerdict ok:false reason HEAD_MISMATCH when options.headSha differs', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_HEAD_MISMATCH');
  });

  test('T3b: v2 verifyVerdict ok:false reason TREE_MISMATCH when stagedTree differs', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: 'aaaabbbbccccdddd0000111122223333aaaa9999',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_TREE_MISMATCH');
  });

  test('T4: v1 verdict still verifies (backward compat) — no commitSha input', () => {
    const verdict = buildVerdict(fixedInput()); // v1, no commit binding
    assert.equal(verdict.schema_version, _SCHEMA_VERSION);
    assert.equal(verdict.commit_sha, undefined);
    const result = verifyVerdict(verdict, FIXED_SECRET);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
  });

  test('T5: v1 verifyVerdict ignores options.headSha (no v2 binding)', () => {
    const verdict = buildVerdict(fixedInput()); // v1
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: 'this-would-never-match-v1',
      stagedTree: 'and-this-too',
    });
    // v1 has no commit_sha field; binding check is skipped.
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
  });

  test('v2 build throws MISSING_COMMIT_SHA when schemaVersion=2 + commitSha absent', () => {
    assert.throws(
      () => buildVerdict(fixedInput({ schemaVersion: _SCHEMA_VERSION_V2 })),
      /MISSING_COMMIT_SHA/
    );
  });

  test('v2 build throws MISSING_STAGED_TREE when commitSha present but stagedTree absent', () => {
    assert.throws(
      () =>
        buildVerdict(
          fixedInput({
            schemaVersion: _SCHEMA_VERSION_V2,
            commitSha: FIXED_COMMIT_SHA,
          })
        ),
      /MISSING_STAGED_TREE/
    );
  });
});

describe('r2-verdict v2: Ed25519 signatures', () => {
  test('T6: Ed25519 signature builds with explicit signingKey', () => {
    const keypair = generateEd25519Pair();
    const verdict = buildVerdict(
      v2Input({
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: keypair.privateKeyPem,
          publicKeyId: keypair.publicKeyId,
        },
      })
    );
    assert.equal(verdict.signature.alg, _SIG_ALG_ED25519);
    assert.equal(verdict.signature.public_key_id, keypair.publicKeyId);
    assert.ok(verdict.signature.value.length > 0);
    // base64url: no padding, no '+' or '/'
    assert.ok(
      !/[+/=]/.test(verdict.signature.value),
      'Ed25519 sig should be base64url (no +/=)'
    );
  });

  test('T7: Ed25519 signature verifies on round-trip with public key registry', () => {
    const keypair = generateEd25519Pair();
    const verdict = buildVerdict(
      v2Input({
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: keypair.privateKeyPem,
          publicKeyId: keypair.publicKeyId,
        },
      })
    );
    const registry = new Map();
    registry.set(keypair.publicKeyId, keypair.publicKeyPem);
    const result = verifyVerdict(verdict, null, {
      publicKeyRegistry: registry,
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
  });

  test('T8: Ed25519 tamper on commit_sha → SIGNATURE_MISMATCH', () => {
    const keypair = generateEd25519Pair();
    const verdict = buildVerdict(
      v2Input({
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: keypair.privateKeyPem,
          publicKeyId: keypair.publicKeyId,
        },
      })
    );
    verdict.commit_sha = '0000000000000000000000000000000000000000';
    const registry = new Map();
    registry.set(keypair.publicKeyId, keypair.publicKeyPem);
    const result = verifyVerdict(verdict, null, {
      publicKeyRegistry: registry,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('T9: Ed25519 tamper on signature.value → SIGNATURE_MISMATCH', () => {
    const keypair = generateEd25519Pair();
    const verdict = buildVerdict(
      v2Input({
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: keypair.privateKeyPem,
          publicKeyId: keypair.publicKeyId,
        },
      })
    );
    // Mutate one char of base64url payload (keep alphabet legal).
    const v = verdict.signature.value;
    verdict.signature.value = (v[0] === 'A' ? 'B' : 'A') + v.slice(1);
    const registry = new Map();
    registry.set(keypair.publicKeyId, keypair.publicKeyPem);
    const result = verifyVerdict(verdict, null, {
      publicKeyRegistry: registry,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_SIGNATURE_MISMATCH');
  });

  test('Ed25519 unknown signer → UNKNOWN_SIGNER', () => {
    const signer = generateEd25519Pair();
    const stranger = generateEd25519Pair();
    const verdict = buildVerdict(
      v2Input({
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: signer.privateKeyPem,
          publicKeyId: signer.publicKeyId,
        },
      })
    );
    const registry = new Map();
    registry.set(stranger.publicKeyId, stranger.publicKeyPem); // only stranger
    const result = verifyVerdict(verdict, null, {
      publicKeyRegistry: registry,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_UNKNOWN_SIGNER');
  });

  test('Ed25519 key rotation: both old + new keys in registry verify', () => {
    const oldKey = generateEd25519Pair();
    const newKey = generateEd25519Pair();
    const oldVerdict = buildVerdict(
      v2Input({
        workflowRunId: 'run-old',
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: oldKey.privateKeyPem,
          publicKeyId: oldKey.publicKeyId,
        },
      })
    );
    const newVerdict = buildVerdict(
      v2Input({
        workflowRunId: 'run-new',
        signatureAlgorithm: _SIG_ALG_ED25519,
        signingKey: {
          privateKeyPem: newKey.privateKeyPem,
          publicKeyId: newKey.publicKeyId,
        },
      })
    );
    const registry = new Map();
    registry.set(oldKey.publicKeyId, oldKey.publicKeyPem);
    registry.set(newKey.publicKeyId, newKey.publicKeyPem);
    const r1 = verifyVerdict(oldVerdict, null, { publicKeyRegistry: registry });
    const r2 = verifyVerdict(newVerdict, null, { publicKeyRegistry: registry });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
  });

  test('T10: Ed25519 base64url roundtrip — no padding, URL-safe alphabet', () => {
    const buf = crypto.randomBytes(64);
    const enc = _toBase64Url(buf);
    assert.ok(!/=/.test(enc), 'no = padding');
    assert.ok(!/\+/.test(enc), 'no + char');
    assert.ok(!/\//.test(enc), 'no / char');
    const dec = _fromBase64Url(enc);
    assert.ok(buf.equals(dec));
  });
});

describe('r2-verdict v2: replay journal (journalLookup hook)', () => {
  test('T10b: journalLookup returning true → RUN_ID_BURNED', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      journalLookup: (runId) => {
        assert.equal(runId, '00000000-0000-4000-8000-000000000001');
        return true;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_RUN_ID_BURNED');
  });

  test('T11: journalLookup returning false → ok preserves (no false-positive deny)', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
      journalLookup: () => false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_OK');
  });

  test('journalLookup throwing → treated as not-burned (fail-open on lookup error)', () => {
    const verdict = buildVerdict(v2Input());
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
      journalLookup: () => {
        throw new Error('journal io fail');
      },
    });
    assert.equal(result.ok, true);
  });

  test('journalLookup applies to v1 verdicts too (defense layer independent of schema)', () => {
    const verdict = buildVerdict(fixedInput()); // v1
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      journalLookup: () => true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CORTEX_R2_VERDICT_RUN_ID_BURNED');
  });
});

describe('r2-verdict v2: STRICT_SECRET enforcement', () => {
  test('T12: STRICT_SECRET=true + env-resolved secret → ok (env tier passes)', () => {
    const verdict = buildVerdict(v2Input()); // explicit secret → env tier
    assert.equal(verdict.signature.secret_tier, 'env');
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
      strictSecret: true,
    });
    assert.equal(result.ok, true);
  });

  test('STRICT_SECRET=true + persisted-tier secret → ok (file tier passes)', () => {
    // Forge a v2 verdict whose secret_tier is 'persisted' (rebuild + re-sign).
    const verdict = buildVerdict(v2Input());
    verdict.signature.secret_tier = 'persisted';
    // Re-sign payload with new secret_tier baked in.
    const payloadOnly = {};
    for (const k of Object.keys(verdict)) {
      if (k === 'signature') continue;
      payloadOnly[k] = verdict[k];
    }
    verdict.signature.value = crypto
      .createHmac('sha256', FIXED_SECRET)
      .update(require('../../../bin/steward/_lib/r2-verdict.cjs').canonicalize(payloadOnly), 'utf8')
      .digest('hex');
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
      strictSecret: true,
    });
    assert.equal(result.ok, true);
  });

  test('T13: STRICT_SECRET=true + host-tier secret_tier → throws STRICT_SECRET_MISSING', () => {
    const verdict = buildVerdict(v2Input());
    verdict.signature.secret_tier = 'host';
    assert.throws(
      () =>
        verifyVerdict(verdict, FIXED_SECRET, {
          headSha: FIXED_COMMIT_SHA,
          stagedTree: FIXED_STAGED_TREE,
          strictSecret: true,
        }),
      /STRICT_SECRET_MISSING/
    );
  });

  test('STRICT_SECRET=false + host-tier → ok (warn path, no throw)', () => {
    const verdict = buildVerdict(v2Input());
    verdict.signature.secret_tier = 'host';
    // Re-sign with secret_tier='host' to keep signature consistent.
    const payloadOnly = {};
    for (const k of Object.keys(verdict)) {
      if (k === 'signature') continue;
      payloadOnly[k] = verdict[k];
    }
    verdict.signature.value = crypto
      .createHmac('sha256', FIXED_SECRET)
      .update(require('../../../bin/steward/_lib/r2-verdict.cjs').canonicalize(payloadOnly), 'utf8')
      .digest('hex');
    const result = verifyVerdict(verdict, FIXED_SECRET, {
      headSha: FIXED_COMMIT_SHA,
      stagedTree: FIXED_STAGED_TREE,
      strictSecret: false,
    });
    assert.equal(result.ok, true);
  });
});

describe('r2-verdict v2: resolveSecret() hybrid resolution', () => {
  test('T14: resolveSecret env path returns source:env', () => {
    const prev = process.env.CORTEX_R2_VERDICT_SECRET;
    process.env.CORTEX_R2_VERDICT_SECRET = 'sentinel-env-secret-value';
    try {
      const result = _resolveSecretNoGenerate();
      assert.equal(result.source, 'env');
      assert.equal(result.secret, 'sentinel-env-secret-value');
    } finally {
      if (prev === undefined) delete process.env.CORTEX_R2_VERDICT_SECRET;
      else process.env.CORTEX_R2_VERDICT_SECRET = prev;
    }
  });

  test('T15: resolveSecret file path (when persisted file exists) returns source:file', () => {
    const prevEnv = process.env.CORTEX_R2_VERDICT_SECRET;
    const prevHome = process.env.CORTEX_DATA_HOME;
    const sandbox = tmpDir('secret-file');
    delete process.env.CORTEX_R2_VERDICT_SECRET;
    process.env.CORTEX_DATA_HOME = sandbox;
    try {
      const target = _secretFilePath();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'persisted-key-from-disk', 'utf8');
      const result = _resolveSecretNoGenerate();
      assert.equal(result.source, 'file');
      assert.equal(result.secret, 'persisted-key-from-disk');
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_R2_VERDICT_SECRET;
      else process.env.CORTEX_R2_VERDICT_SECRET = prevEnv;
      if (prevHome === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevHome;
    }
  });

  test('T16: resolveSecret host-derived fallback returns source:host-derived', () => {
    const prevEnv = process.env.CORTEX_R2_VERDICT_SECRET;
    const prevHome = process.env.CORTEX_DATA_HOME;
    const sandbox = tmpDir('secret-host');
    delete process.env.CORTEX_R2_VERDICT_SECRET;
    process.env.CORTEX_DATA_HOME = sandbox; // file does NOT exist in sandbox
    try {
      const result = _resolveSecretNoGenerate();
      assert.equal(result.source, 'host-derived');
      assert.ok(typeof result.secret === 'string' && result.secret.length === 64);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_R2_VERDICT_SECRET;
      else process.env.CORTEX_R2_VERDICT_SECRET = prevEnv;
      if (prevHome === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevHome;
    }
  });

  test('resolveSecret (with-generate) auto-creates persisted file on first use', () => {
    const prevEnv = process.env.CORTEX_R2_VERDICT_SECRET;
    const prevHome = process.env.CORTEX_DATA_HOME;
    const sandbox = tmpDir('secret-gen');
    delete process.env.CORTEX_R2_VERDICT_SECRET;
    process.env.CORTEX_DATA_HOME = sandbox;
    try {
      const result = _resolveSecret();
      // file path now exists; source is 'file'
      assert.equal(result.source, 'file');
      const target = _secretFilePath();
      assert.ok(fs.existsSync(target));
      const onDisk = fs.readFileSync(target, 'utf8');
      assert.equal(onDisk, result.secret);
      // Second invocation: same secret, no overwrite.
      const second = _resolveSecret();
      assert.equal(second.source, 'file');
      assert.equal(second.secret, result.secret);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_R2_VERDICT_SECRET;
      else process.env.CORTEX_R2_VERDICT_SECRET = prevEnv;
      if (prevHome === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevHome;
    }
  });
});
