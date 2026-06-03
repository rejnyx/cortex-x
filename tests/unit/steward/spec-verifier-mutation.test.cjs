'use strict';

// Sprint 2.3.1 — `mutation_score` acceptance-criterion kind (7th).
// Reads a Stryker JSON report and scores killed-vs-survived over an
// optionally filtered surface. Three fail-OPEN advisory paths (report
// missing, malformed, no valid mutants) preserve backward compat — Sprint
// 2.3.1 ships advisory-only across all 6 enforced thresholds; promotion to
// blocking is gated on Sprint 2.3.2 calibration data (60+ green runs).
//
// Score formula (Stryker standard):
//   score = (killed + timeout) / (killed + survived + timeout + noCoverage) × 100
//
// Tests use os.tmpdir() + mkdtempSync scratch dirs; no network, no real Stryker.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sv = require('../../../bin/steward/_lib/spec-verifier.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

const scratchDirs = [];

function makeScratchRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-mutscore-'));
  scratchDirs.push(root);
  return root;
}

function writeReport(root, relPath, body) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  return abs;
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

after(() => {
  for (const d of scratchDirs) rmrf(d);
});

// Standard Stryker report shape: { schemaVersion, files: { [path]: { mutants: [...] } } }
function mutant({ id = 'm', status, mutator = 'BooleanLiteral', line = 10 }) {
  return {
    id,
    mutatorName: mutator,
    status,
    location: { start: { line, column: 0 }, end: { line, column: 4 } },
    replacement: '',
  };
}

function reportWith(filesMap) {
  return {
    schemaVersion: '1.0',
    files: filesMap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// validateCriterion mutation_score
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — validateCriterion mutation_score', () => {
  test('accepts minimal valid criterion', () => {
    const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: 60 });
    assert.equal(r.ok, true);
  });

  test('accepts criterion with all optional fields', () => {
    const r = sv.validateCriterion({
      id: 'm',
      kind: 'mutation_score',
      min_percentage: 70,
      target_files: ['src/**/*.js'],
      stryker_output_path: 'reports/mutation/mutation.json',
      advisory: true,
    });
    assert.equal(r.ok, true);
  });

  test('rejects missing min_percentage', () => {
    const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /min_percentage/);
  });

  test('rejects out-of-range min_percentage', () => {
    for (const bad of [-1, 101, 150, -10]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: bad });
      assert.equal(r.ok, false, `min_percentage=${bad}`);
    }
  });

  test('rejects non-numeric / non-finite min_percentage', () => {
    for (const bad of [NaN, Infinity, '70', null, undefined]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: bad });
      assert.equal(r.ok, false, `min_percentage=${JSON.stringify(bad)}`);
    }
  });

  test('accepts boundary min_percentage values 0 and 100', () => {
    for (const ok of [0, 50, 100]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: ok });
      assert.equal(r.ok, true, `min_percentage=${ok}`);
    }
  });

  test('rejects non-array target_files', () => {
    for (const bad of ['x', 42, {}, true]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: 60, target_files: bad });
      assert.equal(r.ok, false, `target_files=${JSON.stringify(bad)}`);
    }
  });

  test('rejects target_files with empty / non-string entries', () => {
    for (const bad of [[''], [123], [null]]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: 60, target_files: bad });
      assert.equal(r.ok, false);
    }
  });

  test('rejects absolute / .. stryker_output_path', () => {
    for (const bad of ['/etc/passwd', 'C:/Windows/x', '..\\evil', 'reports/../../etc/passwd']) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: 60, stryker_output_path: bad });
      assert.equal(r.ok, false, `stryker_output_path=${bad}`);
    }
  });

  test('rejects non-boolean advisory flag', () => {
    for (const bad of [1, 'true', null, {}]) {
      const r = sv.validateCriterion({ id: 'm', kind: 'mutation_score', min_percentage: 60, advisory: bad });
      assert.equal(r.ok, false, `advisory=${JSON.stringify(bad)}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// statusToKey mapping (forward-compat)
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — statusToKey mapping', () => {
  test('maps the 8 Stryker statuses to camelCase keys', () => {
    assert.equal(sv.statusToKey('Killed'), 'killed');
    assert.equal(sv.statusToKey('Survived'), 'survived');
    assert.equal(sv.statusToKey('Timeout'), 'timeout');
    assert.equal(sv.statusToKey('NoCoverage'), 'noCoverage');
    assert.equal(sv.statusToKey('CompileError'), 'compileError');
    assert.equal(sv.statusToKey('RuntimeError'), 'runtimeError');
    assert.equal(sv.statusToKey('Ignored'), 'ignored');
    assert.equal(sv.statusToKey('Pending'), 'pending');
  });

  test('returns null for unknown statuses (forward-compat)', () => {
    assert.equal(sv.statusToKey('FutureStatus'), null);
    assert.equal(sv.statusToKey(''), null);
    assert.equal(sv.statusToKey(null), null);
    assert.equal(sv.statusToKey(42), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runMutationScore — pass + fail paths
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — runMutationScore pass/fail', () => {
  test('Test 1: PASS when score equals min (boundary)', () => {
    const root = makeScratchRepo();
    // 6 killed + 4 survived = 60% score. min_percentage=60 → pass at boundary.
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 6 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 4 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 60);
    assert.equal(r.threshold, 60);
    assert.deepEqual(r.counts.killed, 6);
    assert.deepEqual(r.counts.survived, 4);
  });

  test('Test 2: PASS when score exceeds min', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 8 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 2 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 80);
  });

  test('Test 3: FAIL when score below min — includes reason + score + threshold', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 3 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 7 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived', line: 20 + i })),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MUTATION_SCORE_BELOW_MIN');
    assert.equal(r.reason, 'SPEC_MUTATION_SCORE_BELOW_MIN');
    assert.equal(r.score, 30);
    assert.equal(r.threshold, 60);
    assert.ok(Array.isArray(r.top_survivors));
    assert.equal(r.top_survivors.length, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// target_files filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — target_files glob filter', () => {
  test('Test 4: target_files glob INCLUDES matching files', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/util.js': {
        mutants: [
          mutant({ id: 'k1', status: 'Killed' }),
          mutant({ id: 'k2', status: 'Killed' }),
        ],
      },
      'tests/foo.test.js': {
        mutants: [
          mutant({ id: 's1', status: 'Survived' }),
          mutant({ id: 's2', status: 'Survived' }),
        ],
      },
    }));
    // target_files: src/** → only src/util.js counted (100% pass)
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60, target_files: ['src/**/*.js'] },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 100);
    assert.equal(r.counts.killed, 2);
    assert.equal(r.counts.survived, 0);
  });

  test('Test 5: target_files glob EXCLUDES non-matching files', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/util.js': {
        mutants: [mutant({ id: 'k1', status: 'Killed' })],
      },
      'tests/foo.test.js': {
        mutants: [
          mutant({ id: 's1', status: 'Survived' }),
          mutant({ id: 's2', status: 'Survived' }),
          mutant({ id: 's3', status: 'Survived' }),
        ],
      },
    }));
    // target_files: tests/** → only test file counted, score 0
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60, target_files: ['tests/**/*.js'] },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, false);
    assert.equal(r.score, 0);
    assert.equal(r.counts.killed, 0);
    assert.equal(r.counts.survived, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-OPEN advisory paths
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — fail-OPEN advisory paths', () => {
  test('Test 6: missing report → advisory ok:true with SPEC_MUTATION_REPORT_MISSING', () => {
    const root = makeScratchRepo();
    // No report written.
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.advisory, true);
    assert.equal(r.code, 'SPEC_MUTATION_REPORT_MISSING');
    assert.equal(r.score, null);
    assert.match(r.message, /Stryker report (not found|unreadable)/);
  });

  test('Test 7: malformed JSON → advisory ok:true with SPEC_MUTATION_REPORT_MALFORMED', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', '{ "files": truncated');
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.advisory, true);
    assert.equal(r.code, 'SPEC_MUTATION_REPORT_MALFORMED');
    assert.equal(r.score, null);
  });

  test('Test 6b: report missing .files key → SPEC_MUTATION_REPORT_MALFORMED', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', { schemaVersion: '1.0' });
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.advisory, true);
    assert.equal(r.code, 'SPEC_MUTATION_REPORT_MALFORMED');
  });

  test('Test 8: 0 valid mutants in surface → advisory SPEC_MUTATION_NO_VALID_MUTANTS', () => {
    const root = makeScratchRepo();
    // Only Ignored + Pending + CompileError — none counted toward valid set.
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          mutant({ id: 'i1', status: 'Ignored' }),
          mutant({ id: 'p1', status: 'Pending' }),
          mutant({ id: 'c1', status: 'CompileError' }),
          mutant({ id: 'r1', status: 'RuntimeError' }),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.advisory, true);
    assert.equal(r.code, 'SPEC_MUTATION_NO_VALID_MUTANTS');
    assert.equal(r.score, null);
  });

  test('target_files filter empties surface → SPEC_MUTATION_NO_VALID_MUTANTS', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [mutant({ id: 'k1', status: 'Killed' })],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60, target_files: ['nomatch/**/*.js'] },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.advisory, true);
    assert.equal(r.code, 'SPEC_MUTATION_NO_VALID_MUTANTS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases — all killed / all survived / noCoverage / timeout / excluded
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — edge cases', () => {
  test('Test 9: all killed → score 100, PASS', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: Array.from({ length: 10 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 100);
    assert.equal(r.counts.killed, 10);
  });

  test('Test 10: all survived → score 0, FAIL', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: Array.from({ length: 5 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, false);
    assert.equal(r.score, 0);
    assert.equal(r.code, 'SPEC_MUTATION_SCORE_BELOW_MIN');
  });

  test('Test 12: timeout mutants counted as detected (Stryker convention)', () => {
    const root = makeScratchRepo();
    // 5 timeout + 5 survived = 50% score. min 40 → pass.
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `t${i}`, status: 'Timeout' })),
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 40 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 50);
    assert.equal(r.counts.timeout, 5);
    assert.equal(r.counts.survived, 5);
  });

  test('Test 11: noCoverage mutants counted in denominator (score 0 → FAIL)', () => {
    const root = makeScratchRepo();
    // 0 killed + 0 survived + 10 noCoverage → detected=0, valid=10, score=0.
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: Array.from({ length: 10 }, (_, i) => mutant({ id: `n${i}`, status: 'NoCoverage' })),
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, false);
    assert.equal(r.score, 0);
    assert.equal(r.counts.noCoverage, 10);
  });

  test('Test edge: CompileError + RuntimeError + Ignored + Pending excluded from numerator and denominator', () => {
    const root = makeScratchRepo();
    // 3 killed + 1 survived → score 75%. Junk should not change this.
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 3 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          mutant({ id: 's1', status: 'Survived' }),
          mutant({ id: 'c1', status: 'CompileError' }),
          mutant({ id: 'r1', status: 'RuntimeError' }),
          mutant({ id: 'i1', status: 'Ignored' }),
          mutant({ id: 'p1', status: 'Pending' }),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 60 },
      { repoRoot: root, env: {} },
    );
    assert.equal(r.ok, true);
    assert.equal(r.score, 75);
    assert.equal(r.counts.compileError, 1);
    assert.equal(r.counts.runtimeError, 1);
    assert.equal(r.counts.ignored, 1);
    assert.equal(r.counts.pending, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Env override + determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — env override + determinism', () => {
  test('Test 13: STRYKER_RATCHET_MIN_PERCENTAGE env overrides criterion.min_percentage', () => {
    const root = makeScratchRepo();
    // 50% score; criterion says min 40 (would pass); env says min 80 (should fail).
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const r = sv.runMutationScore(
      { id: 'm', kind: 'mutation_score', min_percentage: 40 },
      { repoRoot: root, env: { STRYKER_RATCHET_MIN_PERCENTAGE: '80' } },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MUTATION_SCORE_BELOW_MIN');
    assert.equal(r.threshold, 80);
    assert.equal(r.score, 50);
  });

  test('env override is ignored when non-numeric or out-of-range', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 5 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    for (const garbage of ['nope', '999', '-5']) {
      const r = sv.runMutationScore(
        { id: 'm', kind: 'mutation_score', min_percentage: 40 },
        { repoRoot: root, env: { STRYKER_RATCHET_MIN_PERCENTAGE: garbage } },
      );
      assert.equal(r.threshold, 40, `garbage=${garbage} should fall back to criterion.min_percentage`);
    }
  });

  test('Test 14: determinism — identical fixture + identical ctx → byte-identical result', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 4 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed', line: 10 + i })),
          ...Array.from({ length: 6 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived', line: 20 + i })),
        ],
      },
      'src/b.js': {
        mutants: [
          mutant({ id: 's_b1', status: 'Survived', mutator: 'StringLiteral', line: 5 }),
        ],
      },
    }));
    const criterion = { id: 'm', kind: 'mutation_score', min_percentage: 60 };
    const ctx = { repoRoot: root, env: {}, now: '2026-06-03T00:00:00Z' };
    const r1 = sv.runMutationScore(criterion, ctx);
    const r2 = sv.runMutationScore(criterion, ctx);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2));
    // Sanity — non-trivial result.
    assert.equal(r1.ok, false);
    assert.ok(Array.isArray(r1.top_survivors));
    assert.ok(r1.top_survivors.length > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runChecks integration — advisory bubbles up, doesn't block
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.3.1 — runChecks integration', () => {
  test('advisory: true mutation_score with below-min score does NOT block', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          mutant({ id: 'k1', status: 'Killed' }),
          ...Array.from({ length: 9 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const fakeKinds = {
      DEFAULT_KIND: 'fake_kind',
      getActionKind: () => ({
        acceptance_criteria: [
          { id: 'mut', kind: 'mutation_score', min_percentage: 60, advisory: true },
        ],
      }),
    };
    const result = sv.runChecks(
      { action_kind: 'fake_kind', repoRoot: root },
      { touchedFiles: [], previousSizes: {}, previousContents: {} },
      { repoRoot: root, actionKinds: fakeKinds },
    );
    assert.equal(result.ok, true, 'advisory criterion must not block');
    assert.ok(Array.isArray(result.advisories), 'advisories[] surfaced');
    assert.ok(result.advisories.length >= 1);
    const adv = result.advisories.find((a) => a.id === 'mut');
    assert.ok(adv, 'mutation advisory present');
    assert.equal(adv.code, 'SPEC_MUTATION_SCORE_BELOW_MIN');
    assert.equal(adv.advisory, true);
  });

  test('non-advisory mutation_score below min BLOCKS', () => {
    const root = makeScratchRepo();
    writeReport(root, 'reports/mutation/mutation.json', reportWith({
      'src/a.js': {
        mutants: [
          ...Array.from({ length: 1 }, (_, i) => mutant({ id: `k${i}`, status: 'Killed' })),
          ...Array.from({ length: 9 }, (_, i) => mutant({ id: `s${i}`, status: 'Survived' })),
        ],
      },
    }));
    const fakeKinds = {
      DEFAULT_KIND: 'fake_kind',
      getActionKind: () => ({
        acceptance_criteria: [
          { id: 'mut', kind: 'mutation_score', min_percentage: 60 },
        ],
      }),
    };
    const result = sv.runChecks(
      { action_kind: 'fake_kind', repoRoot: root },
      { touchedFiles: [], previousSizes: {}, previousContents: {} },
      { repoRoot: root, actionKinds: fakeKinds },
    );
    assert.equal(result.ok, false, 'non-advisory below-min must block');
    assert.equal(result.code, 'SPEC_VIOLATION');
    assert.equal(result.spec_failures.length, 1);
    assert.equal(result.spec_failures[0].code, 'SPEC_MUTATION_SCORE_BELOW_MIN');
  });

  test('missing report with enforced criterion → advisory pass (fail-OPEN ok:true)', () => {
    const root = makeScratchRepo();
    // No report written.
    const fakeKinds = {
      DEFAULT_KIND: 'fake_kind',
      getActionKind: () => ({
        acceptance_criteria: [
          { id: 'mut', kind: 'mutation_score', min_percentage: 60 },
        ],
      }),
    };
    const result = sv.runChecks(
      { action_kind: 'fake_kind', repoRoot: root },
      { touchedFiles: [], previousSizes: {}, previousContents: {} },
      { repoRoot: root, actionKinds: fakeKinds },
    );
    assert.equal(result.ok, true, 'fail-OPEN advisory must not block');
    const adv = (result.advisories || []).find((a) => a.id === 'mut');
    assert.ok(adv);
    assert.equal(adv.code, 'SPEC_MUTATION_REPORT_MISSING');
    assert.equal(adv.advisory, true);
  });
});
