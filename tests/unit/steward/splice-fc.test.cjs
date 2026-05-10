// Sprint 2.3a — fast-check integration smoke test for splice.cjs primitives.
//
// Foundation work: validates fast-check@^4.x devDep loads + can drive splice
// invariants with shrinking + replay seeds. Hand-rolled property tests in
// splice-properties.test.cjs continue to be SoT for the v0+v1 ops contract;
// this file is the shrinking-aware companion that catches counterexamples
// the hand-rolled tables miss.
//
// Migration cadence (Sprint 2.3a → 2.3b): incremental — every new property
// invariant lands here using fc; existing hand-rolled tests stay until they
// flake or until 2.3b's mutation runner reveals coverage gaps.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const fc = require('fast-check');

const splice = require('../../../bin/steward/_lib/splice.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `splice-fc-${label}-`));
}

test.describe('Sprint 2.3a — splice fast-check smoke', () => {
  test('append monotonicity holds for arbitrary unicode strings (fc + shrinking)', () => {
    const dir = tmp('append-fc');
    let caseId = 0;
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (text) => {
        const name = `c${caseId++}.txt`;
        const p = path.join(dir, name);
        fs.writeFileSync(p, 'seed\n');
        const before = fs.statSync(p).size;
        const r = splice.applyOps({
          repoRoot: dir,
          edits: [{ path: name, ops: [{ kind: 'append', text }] }],
        });
        if (!r.ok) return false;
        const after = fs.statSync(p).size;
        return after - before === Buffer.byteLength(text, 'utf8');
      }),
      { numRuns: 100, seed: 0x2c3a },
    );
  });

  test('validateOp totality — never throws across arbitrary structured input', () => {
    const opLike = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.string(),
      fc.array(fc.anything(), { maxLength: 3 }),
      fc.record({
        kind: fc.option(fc.string({ maxLength: 16 }), { nil: null }),
        text: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
        content: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
        old_str: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
        new_str: fc.option(fc.string({ maxLength: 32 }), { nil: null }),
        after_line: fc.option(fc.integer(), { nil: null }),
      }),
    );
    fc.assert(
      fc.property(opLike, (op) => {
        let r;
        try {
          r = splice.validateOp(op);
        } catch (err) {
          return false; // totality violation
        }
        if (!r || typeof r.ok !== 'boolean') return false;
        if (r.ok) return true;
        return /^EDIT_OP_(KIND_UNKNOWN|MISSING_FIELD|EMPTY_PAYLOAD|TYPE_MISMATCH)$/.test(r.code);
      }),
      { numRuns: 200, seed: 0x2c3a },
    );
  });

  test('atomicity under random mixed batches — disk == pre-batch on any failure', () => {
    const dir = tmp('atomic-fc');
    let runId = 0;
    const opGen = fc.oneof(
      fc.record({
        kind: fc.constant('append'),
        text: fc.string({ minLength: 1, maxLength: 8 }),
      }),
      fc.record({
        kind: fc.constant('create'),
        content: fc.string({ minLength: 1, maxLength: 8 }),
      }),
    );
    const editsGen = fc.array(
      fc.record({
        path: fc.constantFrom('a.txt', 'b.txt', 'c.txt'),
        ops: fc.array(opGen, { minLength: 1, maxLength: 2 }),
      }),
      { minLength: 1, maxLength: 4 },
    );
    fc.assert(
      fc.property(editsGen, (edits) => {
        const subDir = path.join(dir, `r${runId++}`);
        fs.mkdirSync(subDir, { recursive: true });
        const seeds = { 'a.txt': 'seed-a', 'b.txt': 'seed-b', 'c.txt': 'seed-c' };
        for (const [n, c] of Object.entries(seeds)) fs.writeFileSync(path.join(subDir, n), c);
        const r = splice.applyOps({ repoRoot: subDir, edits });
        if (r.ok) return true; // success path is fine
        // Failure path: every seed file MUST hold its original content
        for (const [n, expected] of Object.entries(seeds)) {
          if (fs.readFileSync(path.join(subDir, n), 'utf8') !== expected) return false;
        }
        return true;
      }),
      { numRuns: 50, seed: 0x2c3a },
    );
  });
});
