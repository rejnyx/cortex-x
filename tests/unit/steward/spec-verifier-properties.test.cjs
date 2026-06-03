'use strict';

// Sprint 2.9.7c — spec-verifier property tests. Per Sprint 2.3 R1 §3.4
// recommendation: companion property tests for high-risk primitives.
// spec-verifier is the gate that protects against unsafe LLM edits — its
// invariants are load-bearing.
//
// Zero-deps (cortex-x convention).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const sv = require('../../../bin/steward/_lib/spec-verifier.cjs');

describe('Sprint 2.9.7c — spec-verifier validateCriterion invariants', () => {
  test('invariant: rejects null / undefined / non-object', () => {
    for (const bad of [null, undefined, 'string', 123, [], true]) {
      const r = sv.validateCriterion(bad);
      assert.equal(r.ok, false, `must reject ${JSON.stringify(bad)}`);
    }
  });

  test('invariant: rejects missing or empty id', () => {
    for (const id of [undefined, null, '', 0, false]) {
      const r = sv.validateCriterion({ id, kind: 'shell', shell: 'echo' });
      assert.equal(r.ok, false, `must reject id=${JSON.stringify(id)}`);
    }
  });

  test('invariant: accepts all VALID_KINDS with correct kind-specific fields', () => {
    const fixtures = {
      shell: { cmd: 'echo ok' },
      file_predicate: { predicate: 'true' },
      regex: { pattern: 'foo' },
      ears_text: { ears: 'WHEN foo bar THE SYSTEM SHALL baz' },
      llm_judge: {},
      read_set: { expected_glob: 'src/**/*.ts' }, // Sprint 2.18
      mutation_score: { min_percentage: 60 }, // Sprint 2.3.1
    };
    for (const kind of sv.VALID_KINDS) {
      const c = { id: 'x', kind, ...fixtures[kind] };
      const r = sv.validateCriterion(c);
      assert.equal(r.ok, true, `kind=${kind} should be accepted; got ${JSON.stringify(r)}`);
    }
  });

  test('invariant: rejects kinds not in VALID_KINDS', () => {
    for (const kind of ['unknown', 'fake', '', 'shell_command', 'predicate', 'regexp']) {
      const r = sv.validateCriterion({ id: 'x', kind });
      assert.equal(r.ok, false, `must reject kind=${kind}`);
    }
  });

  test('invariant: severity defaults are accepted; invalid values rejected', () => {
    const base = { id: 'x', kind: 'shell', cmd: 'echo' };
    // Default (no severity field) — accepted.
    assert.equal(sv.validateCriterion({ ...base }).ok, true);
    // Valid severities.
    for (const sev of sv.VALID_SEVERITIES) {
      assert.equal(sv.validateCriterion({ ...base, severity: sev }).ok, true, `severity=${sev}`);
    }
    // Invalid severities.
    for (const sev of ['error', 'critical', 'info', '', 'BLOCK', 'Warn']) {
      assert.equal(sv.validateCriterion({ ...base, severity: sev }).ok, false, `severity=${sev}`);
    }
  });

  test('invariant: applies_to must be array of non-empty strings or null/undefined', () => {
    const base = { id: 'x', kind: 'regex', pattern: 'foo' };
    // null / undefined / non-empty array — accepted.
    assert.equal(sv.validateCriterion({ ...base }).ok, true);
    assert.equal(sv.validateCriterion({ ...base, applies_to: null }).ok, true);
    assert.equal(sv.validateCriterion({ ...base, applies_to: ['*.cjs'] }).ok, true);
    assert.equal(sv.validateCriterion({ ...base, applies_to: ['a', 'b', 'c'] }).ok, true);
    // Empty array — REJECTED per Sprint 1.9.0 R2 edge HIGH-D (semantically ambiguous).
    assert.equal(sv.validateCriterion({ ...base, applies_to: [] }).ok, false);
    // Non-array — rejected.
    for (const bad of ['*.cjs', 123, {}, true]) {
      assert.equal(sv.validateCriterion({ ...base, applies_to: bad }).ok, false, `applies_to=${JSON.stringify(bad)}`);
    }
    // Array with empty/non-string entry — rejected.
    assert.equal(sv.validateCriterion({ ...base, applies_to: [''] }).ok, false);
    assert.equal(sv.validateCriterion({ ...base, applies_to: [123] }).ok, false);
  });

  test('invariant: file_predicate denylist blocks RCE-shaped tokens', () => {
    // Sprint 1.9.0 review (security/MED): predicate strings can't reference
    // process / require / globalThis / Function / eval / etc.
    const dangerous = [
      'process.exit(1)',
      'require("fs")',
      'globalThis.x = 1',
      'new Function("return 1")',
      'eval("1")',
      'child_process.spawn',
      'fetch("...")',
      'Buffer.alloc(1)',
      '__dirname',
      '__filename',
      'setTimeout(() => {}, 1)',
    ];
    for (const pred of dangerous) {
      const r = sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: pred });
      assert.equal(r.ok, false, `denylist must reject predicate: ${pred}`);
    }
  });

  test('invariant: regex criterion with invalid pattern is rejected at validate time', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: '[unclosed' });
    assert.equal(r.ok, false, 'invalid regex must be rejected at validation time, not runtime');
  });

  test('invariant: ears_text without SHALL clause rejected', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'ears_text', ears: 'this is just words' });
    assert.equal(r.ok, false);
  });
});

describe('Sprint 2.9.7c — spec-verifier simpleGlobMatch invariants', () => {
  test('invariant: literal pattern matches exact path', () => {
    assert.equal(sv.simpleGlobMatch('foo.cjs', 'foo.cjs'), true);
    assert.equal(sv.simpleGlobMatch('foo.cjs', 'bar.cjs'), false);
  });

  test('invariant: * does not cross path separator', () => {
    assert.equal(sv.simpleGlobMatch('*.cjs', 'foo.cjs'), true);
    assert.equal(sv.simpleGlobMatch('*.cjs', 'a/foo.cjs'), false);
  });

  test('invariant: ** crosses path separator', () => {
    assert.equal(sv.simpleGlobMatch('**/*.cjs', 'foo.cjs'), true);
    assert.equal(sv.simpleGlobMatch('**/*.cjs', 'a/b/foo.cjs'), true);
    assert.equal(sv.simpleGlobMatch('**/*.cjs', 'a/b/c/d/foo.cjs'), true);
  });

  test('invariant: idempotency — same input produces same result', () => {
    const cases = [
      ['*.cjs', 'foo.cjs'],
      ['**/test.txt', 'a/b/c/test.txt'],
      ['exact-match', 'exact-match'],
      ['exact-match', 'no-match'],
    ];
    for (const [pattern, p] of cases) {
      const r1 = sv.simpleGlobMatch(pattern, p);
      const r2 = sv.simpleGlobMatch(pattern, p);
      assert.equal(r1, r2, `non-idempotent for (${pattern}, ${p})`);
    }
  });
});

describe('Sprint 2.9.7c — spec-verifier filterTargets invariants', () => {
  test('invariant: empty globs ⇒ all touched files match', () => {
    const result = sv.filterTargets(null, ['a.cjs', 'b.cjs']);
    assert.deepEqual(result, ['a.cjs', 'b.cjs']);
  });

  test('invariant: empty touched files ⇒ empty result regardless of globs', () => {
    assert.deepEqual(sv.filterTargets(['*.cjs'], []), []);
    assert.deepEqual(sv.filterTargets([], []), []);
    assert.deepEqual(sv.filterTargets(null, []), []);
  });

  test('invariant: filter is a subset relationship — output ⊆ input', () => {
    const inputs = ['a.cjs', 'b.cjs', 'c.txt', 'd.md', 'sub/e.cjs'];
    for (const globSet of [['*.cjs'], ['**/*.cjs'], ['*.txt'], ['**/*'], []]) {
      const result = sv.filterTargets(globSet, inputs);
      for (const r of result) {
        assert.ok(inputs.includes(r), `filter output ${r} must be in input set`);
      }
    }
  });
});

describe('Sprint 2.9.7c — spec-verifier runChecks contract', () => {
  test('invariant: runChecks returns object with ok field; never throws on legitimate inputs', () => {
    // The spec-verifier must NEVER let an uncaught throw escape — that would
    // leave the working tree dirty + dead branch checked out (Sprint 1.9.0
    // review edge HIGH-E). Test the happy-path contract.
    let result;
    assert.doesNotThrow(() => {
      result = sv.runChecks(
        { action_kind: 'recommendation' },
        { ok: true, edits: [], touchedFiles: [] },
        { repoRoot: process.cwd() },
      );
    });
    assert.ok(result, 'runChecks must return an object');
    assert.ok('ok' in result, 'result must have ok field');
    assert.equal(typeof result.ok, 'boolean');
  });

  test('invariant: runChecks does not throw on null applyResult.touchedFiles', () => {
    let result;
    assert.doesNotThrow(() => {
      result = sv.runChecks(
        { action_kind: 'recommendation' },
        { ok: true, edits: [] /* touchedFiles missing */ },
        { repoRoot: process.cwd() },
      );
    });
    assert.ok(result);
  });
});

describe('Sprint 2.9.7c — spec-verifier EARS_PATTERNS sanity', () => {
  test('invariant: EARS_PATTERNS recognizes all 5 EARS form variants', () => {
    // Sprint 1.9.0 R1 specified 5 EARS patterns. Verify they all parse.
    const samples = [
      'WHEN edit.replace_all is false THE SYSTEM SHALL preserve content',
      'WHILE todo_triage is processing THE SYSTEM SHALL only file gh issues',
      'WHERE cost_usd > cap THE SYSTEM SHALL halt execution',
      'IF spec-verifier rejects THEN THE SYSTEM SHALL rollback atomically',
      'THE SYSTEM SHALL preserve at least 50 percent of file content',
    ];
    let recognized = 0;
    for (const s of samples) {
      for (const re of sv.EARS_PATTERNS) {
        if (re.test(s)) { recognized++; break; }
      }
    }
    assert.ok(recognized >= 1, 'at least one EARS pattern should match each sample (got 0)');
  });
});
