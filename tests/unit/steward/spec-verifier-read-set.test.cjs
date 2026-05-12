'use strict';

// Sprint 2.18 — `read_set` acceptance-criterion kind (read-coverage proof).
// Closes the failure class where an agent claims to have processed a set of
// inputs but only sampled a fraction. Verifier enumerates `expected_glob` on
// the working tree and asserts plan.read_set covers ≥ min_coverage.
//
// Zero-deps. fast lane (uses /tmp scratch dirs, no network, no fixture repo).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sv = require('../../../bin/steward/_lib/spec-verifier.cjs');

function makeScratchRepo(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-readset-'));
  for (const [rel, body] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return root;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

describe('Sprint 2.18 — validateCriterion read_set', () => {
  test('accepts minimal valid criterion', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' });
    assert.equal(r.ok, true);
  });

  test('accepts criterion with all optional fields', () => {
    const r = sv.validateCriterion({
      id: 'rs',
      kind: 'read_set',
      expected_glob: 'src/**/*.ts',
      min_coverage: 0.8,
      expected_count: 50,
      excludes: ['dist', '.cache'],
      severity: 'warn',
    });
    assert.equal(r.ok, true);
  });

  test('rejects missing expected_glob', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /expected_glob/);
  });

  test('rejects empty expected_glob', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: '' });
    assert.equal(r.ok, false);
  });

  test('rejects non-string expected_glob', () => {
    for (const bad of [123, null, {}, [], true]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: bad });
      assert.equal(r.ok, false, `expected_glob=${JSON.stringify(bad)}`);
    }
  });

  test('rejects min_coverage outside [0, 1]', () => {
    for (const bad of [-0.1, 1.5, 2, -1]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', min_coverage: bad });
      assert.equal(r.ok, false, `min_coverage=${bad}`);
    }
  });

  test('rejects non-finite min_coverage (NaN / Infinity)', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'half', null]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', min_coverage: bad });
      assert.equal(r.ok, false, `min_coverage=${JSON.stringify(bad)}`);
    }
  });

  test('accepts min_coverage boundary values 0 and 1', () => {
    for (const ok of [0, 0.5, 1]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', min_coverage: ok });
      assert.equal(r.ok, true, `min_coverage=${ok}`);
    }
  });

  test('rejects negative or non-integer expected_count', () => {
    for (const bad of [-1, 1.5, '5', NaN, Infinity]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', expected_count: bad });
      assert.equal(r.ok, false, `expected_count=${JSON.stringify(bad)}`);
    }
  });

  test('accepts expected_count=0 (vacuous lower bound)', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', expected_count: 0 });
    assert.equal(r.ok, true);
  });

  test('rejects non-array excludes', () => {
    for (const bad of ['dist', 123, {}, true]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', excludes: bad });
      assert.equal(r.ok, false);
    }
  });

  test('rejects excludes with empty / non-string entries', () => {
    for (const bad of [[''], [123], [null]]) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'x', excludes: bad });
      assert.equal(r.ok, false);
    }
  });
});

describe('Sprint 2.18 — normalizeReadSet helper', () => {
  test('returns empty for non-array input', () => {
    for (const bad of [null, undefined, 'string', 123, {}]) {
      assert.deepEqual(sv.normalizeReadSet(bad), []);
    }
  });

  test('ignores empty / non-string entries', () => {
    const r = sv.normalizeReadSet(['a', '', null, 5, 'b']);
    assert.deepEqual(r, ['a', 'b']);
  });

  test('deduplicates entries', () => {
    const r = sv.normalizeReadSet(['a', 'b', 'a', 'b', 'a']);
    assert.deepEqual(r, ['a', 'b']);
  });

  test('normalizes Windows backslashes to posix', () => {
    const r = sv.normalizeReadSet(['src\\foo.ts', 'src/foo.ts']);
    // After normalization both become 'src/foo.ts' — dedup leaves one.
    assert.deepEqual(r, ['src/foo.ts']);
  });
});

describe('Sprint 2.18 — enumerateGlob walker', () => {
  test('matches files via simple-glob, returns posix paths', () => {
    const root = makeScratchRepo({
      'src/a.ts': '',
      'src/b.ts': '',
      'src/nested/c.ts': '',
      'src/skip.md': '',
      'README.md': '',
    });
    try {
      const r = sv.enumerateGlob(root, 'src/**/*.ts');
      r.files.sort();
      assert.deepEqual(r.files, ['src/a.ts', 'src/b.ts', 'src/nested/c.ts']);
      assert.equal(r.capped, false);
    } finally {
      rmrf(root);
    }
  });

  test('skips default excludes (node_modules, .git, dist)', () => {
    const root = makeScratchRepo({
      'src/a.ts': '',
      'node_modules/pkg/index.ts': '',
      '.git/HEAD': '',
      'dist/bundle.ts': '',
    });
    try {
      const r = sv.enumerateGlob(root, '**/*.ts');
      r.files.sort();
      assert.deepEqual(r.files, ['src/a.ts']);
    } finally {
      rmrf(root);
    }
  });

  test('caller-provided excludes MERGE with defaults (Sprint 2.18 R2 — was footgun before)', () => {
    const root = makeScratchRepo({
      'src/a.ts': '',
      'node_modules/x.ts': '', // still skipped — default exclude preserved
      'skipme/y.ts': '',        // skipped — caller added
    });
    try {
      const r = sv.enumerateGlob(root, '**/*.ts', ['skipme']);
      r.files.sort();
      assert.deepEqual(r.files, ['src/a.ts']);
    } finally {
      rmrf(root);
    }
  });

  test('returns empty for non-matching glob', () => {
    const root = makeScratchRepo({ 'a.txt': '' });
    try {
      const r = sv.enumerateGlob(root, '**/*.ts');
      assert.deepEqual(r.files, []);
      assert.equal(r.capped, false);
    } finally {
      rmrf(root);
    }
  });

  test('survives unreadable directories (fail-open per dir)', () => {
    const root = makeScratchRepo({ 'src/a.ts': '' });
    try {
      // Non-existent root — should return empty without throwing.
      const r = sv.enumerateGlob(path.join(root, 'no-such-dir'), '**/*.ts');
      assert.deepEqual(r.files, []);
    } finally {
      rmrf(root);
    }
  });
});

describe('Sprint 2.18 — runReadSet runtime semantics', () => {
  test('passes when declared set fully covers enumerated files', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: { read_set: ['src/a.ts', 'src/b.ts'] } },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });

  test('fails when plan.read_set is empty but enumeration finds files', () => {
    const root = makeScratchRepo({ 'src/a.ts': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: {} },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_READ_SET_INCOMPLETE');
      assert.match(r.actual, /empty\/missing/);
    } finally {
      rmrf(root);
    }
  });

  test('vacuously passes when enumeration is empty (no files matched)', () => {
    const root = makeScratchRepo({ 'a.txt': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: {} },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });

  test('fails when coverage below min_coverage', () => {
    const root = makeScratchRepo({
      'src/a.ts': '',
      'src/b.ts': '',
      'src/c.ts': '',
      'src/d.ts': '',
    });
    try {
      // Declared 2 of 4 — coverage = 0.5. min_coverage = 1.0 → fail.
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: { read_set: ['src/a.ts', 'src/b.ts'] } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_READ_SET_INCOMPLETE');
      assert.match(r.actual, /50\.0%/);
    } finally {
      rmrf(root);
    }
  });

  test('passes when coverage meets relaxed min_coverage', () => {
    const root = makeScratchRepo({
      'src/a.ts': '',
      'src/b.ts': '',
      'src/c.ts': '',
      'src/d.ts': '',
    });
    try {
      // Declared 3 of 4 — coverage = 0.75. min_coverage = 0.5 → pass.
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', min_coverage: 0.5 },
        { repoRoot: root, plan: { read_set: ['src/a.ts', 'src/b.ts', 'src/c.ts'] } },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });

  test('expected_count fires independently of glob coverage', () => {
    const root = makeScratchRepo({ 'src/a.ts': '' });
    try {
      // Declared 1, but expected_count = 5 — fail even though glob coverage 100%.
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', expected_count: 5 },
        { repoRoot: root, plan: { read_set: ['src/a.ts'] } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_READ_SET_INCOMPLETE');
      assert.match(r.actual, /deficit 4/);
    } finally {
      rmrf(root);
    }
  });

  test('normalizes Windows backslashes in declared read_set before comparing', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: { read_set: ['src\\a.ts', 'src\\b.ts'] } },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });

  test('surfaces uncovered file sample (up to 5) in failure actual', () => {
    const layout = {};
    for (let i = 0; i < 10; i++) layout[`src/f${i}.ts`] = '';
    const root = makeScratchRepo(layout);
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: { read_set: [] } },
      );
      assert.equal(r.ok, false);
      // empty-declared path shows empty/missing; widen by declaring one.
      const r2 = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts' },
        { repoRoot: root, plan: { read_set: ['src/f0.ts'] } },
      );
      assert.equal(r2.ok, false);
      // ≤5 file paths + "+N more" suffix.
      const occurrences = (r2.actual.match(/src\/f/g) || []).length;
      assert.ok(occurrences >= 1 && occurrences <= 5, `expected 1..5 sample paths, got ${occurrences}`);
      assert.match(r2.actual, /\+\d+ more/);
    } finally {
      rmrf(root);
    }
  });

  test('returns SPEC_MALFORMED when enumeration exceeds cap', () => {
    const layout = {};
    const cap = sv.READ_SET_MAX_FILES_ENUMERATED;
    for (let i = 0; i < cap + 5; i++) layout[`src/f${i}.ts`] = '';
    const root = makeScratchRepo(layout);
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: '**/*.ts' },
        { repoRoot: root, plan: { read_set: [] } },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_MALFORMED');
      assert.match(r.actual, /narrow the glob/);
    } finally {
      rmrf(root);
    }
  });

  test('property: random declared subset → coverage matches set-intersection arithmetic', () => {
    // Builds a fixture of 30 files, picks K of them as declared, asserts the
    // runner's coverage decision matches the arithmetic.
    const layout = {};
    const all = [];
    for (let i = 0; i < 30; i++) {
      const rel = `src/p${i}.ts`;
      layout[rel] = '';
      all.push(rel);
    }
    const root = makeScratchRepo(layout);
    try {
      // Deterministic pseudo-random with a fixed seed so failures are reproducible.
      let seed = 42;
      const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let trial = 0; trial < 50; trial++) {
        const k = Math.floor(rand() * 30);
        const declared = [];
        const seenIdx = new Set();
        while (declared.length < k) {
          const idx = Math.floor(rand() * 30);
          if (seenIdx.has(idx)) continue;
          seenIdx.add(idx);
          declared.push(all[idx]);
        }
        const minCov = rand();
        const expectedCov = declared.length / 30;
        const r = sv.runReadSet(
          { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', min_coverage: minCov },
          { repoRoot: root, plan: { read_set: declared } },
        );
        if (declared.length === 0) {
          assert.equal(r.ok, false, 'empty declared must always fail when enumeration non-empty');
        } else if (expectedCov >= minCov) {
          assert.equal(r.ok, true, `trial ${trial}: cov=${expectedCov} >= min=${minCov} should pass`);
        } else {
          assert.equal(r.ok, false, `trial ${trial}: cov=${expectedCov} < min=${minCov} should fail`);
          assert.equal(r.code, 'SPEC_READ_SET_INCOMPLETE');
        }
      }
    } finally {
      rmrf(root);
    }
  });
});

describe('Sprint 2.18 — runChecks integration for read_set kind', () => {
  test('full runChecks dispatch routes to read_set runner', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const actionKinds = {
        DEFAULT_KIND: 'test_kind',
        getActionKind() {
          return {
            acceptance_criteria: [
              { id: 'must_read', kind: 'read_set', expected_glob: 'src/**/*.ts' },
            ],
          };
        },
      };
      // Happy path — full coverage.
      const okR = sv.runChecks(
        { action_kind: 'test_kind', read_set: ['src/a.ts', 'src/b.ts'] },
        { touchedFiles: [] },
        { repoRoot: root, actionKinds },
      );
      assert.equal(okR.ok, true);
      assert.equal(okR.criteria_passed, 1);

      // Failure path — partial coverage.
      const failR = sv.runChecks(
        { action_kind: 'test_kind', read_set: ['src/a.ts'] },
        { touchedFiles: [] },
        { repoRoot: root, actionKinds },
      );
      assert.equal(failR.ok, false);
      assert.equal(failR.code, 'SPEC_VIOLATION'); // block severity by default
      assert.equal(failR.spec_failures[0].code, 'SPEC_READ_SET_INCOMPLETE');
    } finally {
      rmrf(root);
    }
  });

  test('warn-severity read_set criterion does not block the action', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const actionKinds = {
        DEFAULT_KIND: 'test_kind',
        getActionKind() {
          return {
            acceptance_criteria: [
              { id: 'soft_read', kind: 'read_set', expected_glob: 'src/**/*.ts', severity: 'warn' },
            ],
          };
        },
      };
      const r = sv.runChecks(
        { action_kind: 'test_kind' }, // no read_set declared
        { touchedFiles: [] },
        { repoRoot: root, actionKinds },
      );
      // warn-only failures keep ok=true so the action proceeds — defense surfaces
      // in journal + autoresearch judge ensemble, not as a hard rollback.
      assert.equal(r.ok, true);
      assert.equal(r.code, 'SPEC_WARNING');
      assert.equal(r.spec_failures.length, 1);
      assert.equal(r.spec_failures[0].severity, 'warn');
    } finally {
      rmrf(root);
    }
  });

  test('plan override may add a project-specific read_set criterion', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const actionKinds = {
        DEFAULT_KIND: 'test_kind',
        getActionKind() {
          return { acceptance_criteria: [] }; // kind defines no read_set baseline
        },
      };
      const r = sv.runChecks(
        {
          action_kind: 'test_kind',
          read_set: ['src/a.ts', 'src/b.ts'],
          acceptance_criteria: [
            { id: 'extra', kind: 'read_set', expected_glob: 'src/**/*.ts' },
          ],
        },
        { touchedFiles: [] },
        { repoRoot: root, actionKinds },
      );
      assert.equal(r.ok, true);
      assert.equal(r.criteria_passed, 1);
    } finally {
      rmrf(root);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 2.18 R2 — review-pipeline-driven regression tests (6-agent review,
// 2026-05-12). Each test pins one finding the reviewers surfaced.
// ─────────────────────────────────────────────────────────────────────────────

describe('Sprint 2.18 R2 — expected_glob hardening (blind + correctness + security + edge)', () => {
  test('rejects absolute glob (leading slash) — vacuous-pass disguise', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: '/etc/**' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /repo-relative/);
  });

  test('rejects Windows drive-letter absolute glob', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'C:/Windows/**' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /repo-relative/);
  });

  test('rejects backslash-leading absolute glob (Windows UNC-ish)', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: '\\\\server\\share' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /repo-relative/);
  });

  test('rejects glob containing .. segment', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/../etc/passwd' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /\.\./);
  });

  test('rejects glob with NUL byte', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/\0evil' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /NUL/);
  });

  test('rejects glob with control character', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/\x01evil' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /control/);
  });

  test('rejects glob exceeding 500-char length cap (regex compilation budget)', () => {
    const longGlob = 'src/' + 'a/'.repeat(300);
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: longGlob });
    assert.equal(r.ok, false);
    assert.match(r.reason, /500-char/);
  });

  test('rejects expected_count exceeding 100k sanity ceiling', () => {
    const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 200_000 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /100_000/);
  });

  test('rejects excludes entry with path separator', () => {
    for (const bad of ['node_modules/foo', 'a\\b']) {
      const r = sv.validateCriterion({ id: 'rs', kind: 'read_set', expected_glob: 'src/**', excludes: [bad] });
      assert.equal(r.ok, false, `excludes=[${bad}] should reject`);
      assert.match(r.reason, /basename/);
    }
  });
});

describe('Sprint 2.18 R2 — normalizeReadSet (correctness/edge MED)', () => {
  test('strips leading ./ so agent declarations match enumeration', () => {
    const r = sv.normalizeReadSet(['./src/a.ts', 'src/b.ts']);
    assert.deepEqual(r.sort(), ['src/a.ts', 'src/b.ts']);
  });

  test('strips trailing slashes', () => {
    const r = sv.normalizeReadSet(['src/foo/', 'src/foo']);
    // both collapse to src/foo, dedup leaves one
    assert.deepEqual(r, ['src/foo']);
  });

  test('drops entries with .. segments (padding bypass defense)', () => {
    const r = sv.normalizeReadSet(['src/a.ts', '../../etc/passwd', 'src/b.ts']);
    assert.deepEqual(r.sort(), ['src/a.ts', 'src/b.ts']);
  });

  test('drops absolute paths and Windows drive-letter paths', () => {
    const r = sv.normalizeReadSet(['/etc/passwd', 'C:/Windows/foo', 'src/a.ts']);
    assert.deepEqual(r, ['src/a.ts']);
  });

  test('NFC-normalizes Czech diacritics (HFS+/APFS vs ext4 parity)', () => {
    // Build NFC/NFD explicitly via codepoints so source-file encoding doesn't
    // silently normalize before the test even runs.
    //   NFC: prefix + U+00E9 (precomposed) + suffix
    //   NFD: prefix + U+0065 + U+0301 (combining acute) + suffix
    const nfc = 'slozka/pre' + String.fromCharCode(0x00E9) + 't.md';
    const nfd = 'slozka/pre' + 'e' + String.fromCharCode(0x0301) + 't.md';
    assert.notEqual(nfc, nfd, 'fixture nfc/nfd should differ pre-normalize');
    assert.equal(nfc.normalize('NFC'), nfd.normalize('NFC'), 'sanity: NFC convergence');
    const r = sv.normalizeReadSet([nfd, nfc]);
    // After NFC both normalize to the precomposed form -> dedup leaves one.
    assert.equal(r.length, 1, 'expected 1 entry post-NFC, got ' + r.length + ': ' + JSON.stringify(r));
    assert.equal(r[0], nfc);
  });
});

describe('Sprint 2.18 R2 — enumerateGlob symlink + permission + root (blind/correctness/edge HIGH)', () => {
  test('skips symbolic links explicitly (Windows reparse-point safety)', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      // Create a symlink to an out-of-tree file. On platforms where symlink
      // creation requires elevated privileges (Windows non-admin), skip
      // gracefully — the existence test in the walker is what we're proving.
      const targetOutside = path.join(os.tmpdir(), `outside-${Date.now()}.ts`);
      fs.writeFileSync(targetOutside, '', 'utf8');
      try {
        fs.symlinkSync(targetOutside, path.join(root, 'src', 'linked.ts'));
      } catch (err) {
        if (err.code === 'EPERM' || err.code === 'EACCES') return; // skip on Windows non-admin
        throw err;
      }
      const r = sv.enumerateGlob(root, 'src/**/*.ts');
      r.files.sort();
      // Should NOT include linked.ts even though it would match the glob —
      // walker explicitly skips ent.isSymbolicLink().
      assert.deepEqual(r.files, ['src/a.ts', 'src/b.ts']);
      fs.unlinkSync(targetOutside);
    } finally {
      rmrf(root);
    }
  });

  test('rootMissing=true when repoRoot does not exist', () => {
    const r = sv.enumerateGlob('/no/such/path/exists/here/at/all', '**/*.ts');
    assert.equal(r.rootMissing, true);
    assert.deepEqual(r.files, []);
  });

  test('rootMissing surfaces SPEC_MALFORMED via runReadSet (not vacuous pass)', () => {
    const r = sv.runReadSet(
      { id: 'rs', kind: 'read_set', expected_glob: 'src/**' },
      { repoRoot: '/no/such/path/exists', plan: {} },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MALFORMED');
    assert.match(r.actual, /not enumerable/);
  });
});

describe('Sprint 2.18 R2 — padding bypass + min_coverage=0 contradiction (blind/edge HIGH+MED)', () => {
  test('expected_count counts INTERSECTION, not raw declared.length (padding defense)', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      // Agent declares 5 paths but only 2 intersect the enumeration.
      // expected_count: 5 must FAIL (intersection=2 < 5), not silently pass.
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', expected_count: 5 },
        {
          repoRoot: root,
          plan: { read_set: ['src/a.ts', 'src/b.ts', 'fake1.ts', 'fake2.ts', 'fake3.ts'] },
        },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_READ_SET_INCOMPLETE');
      assert.match(r.actual, /intersection has 2 entries/);
    } finally {
      rmrf(root);
    }
  });

  test('expected_count satisfied honestly via real intersection', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '', 'src/c.ts': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', expected_count: 2, min_coverage: 0 },
        { repoRoot: root, plan: { read_set: ['src/a.ts', 'src/b.ts'] } },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });

  test('min_coverage=0 passes regardless of declared set (registry opt-out)', () => {
    const root = makeScratchRepo({ 'src/a.ts': '', 'src/b.ts': '' });
    try {
      const r = sv.runReadSet(
        { id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', min_coverage: 0 },
        { repoRoot: root, plan: {} },
      );
      assert.equal(r.ok, true);
    } finally {
      rmrf(root);
    }
  });
});

describe('Sprint 2.18 R2 — mergeCriteria override-weakening guard (edge HIGH)', () => {
  test('rejects override that narrows expected_glob (same severity)', () => {
    const existing = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**/*.ts', severity: 'block' }];
    const override = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/a.ts', severity: 'block' }];
    const r = sv.mergeCriteria(existing, override);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_OVERRIDE_REJECTED');
    assert.match(r.error, /expected_glob/);
  });

  test('rejects override that decreases expected_count', () => {
    const existing = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 10, severity: 'block' }];
    const override = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 3, severity: 'block' }];
    const r = sv.mergeCriteria(existing, override);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_OVERRIDE_REJECTED');
    assert.match(r.error, /expected_count/);
  });

  test('rejects override that drops expected_count when baseline had it', () => {
    const existing = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 10, severity: 'block' }];
    const override = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', severity: 'block' }];
    const r = sv.mergeCriteria(existing, override);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_OVERRIDE_REJECTED');
  });

  test('rejects override that lowers min_coverage', () => {
    const existing = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', min_coverage: 1.0, severity: 'block' }];
    const override = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', min_coverage: 0.5, severity: 'block' }];
    const r = sv.mergeCriteria(existing, override);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_OVERRIDE_REJECTED');
    assert.match(r.error, /min_coverage/);
  });

  test('accepts override that strengthens: raises expected_count, keeps glob', () => {
    const existing = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 5, severity: 'block' }];
    const override = [{ id: 'rs', kind: 'read_set', expected_glob: 'src/**', expected_count: 10, severity: 'block' }];
    const r = sv.mergeCriteria(existing, override);
    assert.equal(r.ok, true);
    assert.equal(r.criteria[0].expected_count, 10);
  });
});

