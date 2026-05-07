// detect-dep-update-patch.test.cjs — Sprint 1.8.4 patch-update detector tests.
//
// Tests use the `mockOutdatedJson` DI parameter to feed canned npm outdated
// output. No real `npm outdated` calls — fully deterministic.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/dep-update-patch.cjs');

describe('parseSemver', () => {
  test('parses standard X.Y.Z', () => {
    assert.deepEqual(detector.parseSemver('1.2.3'), [1, 2, 3]);
  });

  test('strips ^/~/v prefixes', () => {
    assert.deepEqual(detector.parseSemver('^1.2.3'), [1, 2, 3]);
    assert.deepEqual(detector.parseSemver('~1.2.3'), [1, 2, 3]);
    assert.deepEqual(detector.parseSemver('v1.2.3'), [1, 2, 3]);
  });

  test('strips pre-release suffixes (-alpha, -rc.1)', () => {
    assert.deepEqual(detector.parseSemver('1.2.3-alpha'), [1, 2, 3]);
    assert.deepEqual(detector.parseSemver('1.2.3-rc.1'), [1, 2, 3]);
  });

  test('returns null for invalid input', () => {
    assert.equal(detector.parseSemver(null), null);
    assert.equal(detector.parseSemver(''), null);
    assert.equal(detector.parseSemver('invalid'), null);
    assert.equal(detector.parseSemver('1.2'), null);
    assert.equal(detector.parseSemver('1.2.x'), null);
  });
});

describe('classifyBump', () => {
  test('patch when only patch component changes', () => {
    assert.equal(detector.classifyBump('1.2.3', '1.2.4'), 'patch');
    assert.equal(detector.classifyBump('1.2.3', '1.2.99'), 'patch');
  });

  test('minor when minor component changes', () => {
    assert.equal(detector.classifyBump('1.2.3', '1.3.0'), 'minor');
    assert.equal(detector.classifyBump('1.2.3', '1.5.0'), 'minor');
  });

  test('major when major component changes', () => {
    assert.equal(detector.classifyBump('1.2.3', '2.0.0'), 'major');
    assert.equal(detector.classifyBump('1.2.3', '3.0.0'), 'major');
  });

  test('none when versions identical', () => {
    assert.equal(detector.classifyBump('1.2.3', '1.2.3'), 'none');
  });

  test('handles ^/~/v prefixes correctly', () => {
    assert.equal(detector.classifyBump('^1.2.3', '^1.2.4'), 'patch');
    assert.equal(detector.classifyBump('~1.2.3', '~1.3.0'), 'minor');
  });

  test('returns unknown for unparseable input', () => {
    assert.equal(detector.classifyBump(null, '1.2.3'), 'unknown');
    assert.equal(detector.classifyBump('1.2.3', 'invalid'), 'unknown');
  });
});

describe('detectPatchUpdates (DI)', () => {
  test('returns patch candidates only', () => {
    const mock = JSON.stringify({
      'pkg-a': { current: '1.2.3', wanted: '1.2.4', latest: '1.2.4' },
      'pkg-b': { current: '2.0.0', wanted: '2.1.0', latest: '2.1.0' },
      'pkg-c': { current: '1.0.0', wanted: '1.0.5', latest: '2.0.0' },
    });
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock });
    assert.equal(r.candidates.length, 2); // pkg-a + pkg-c (both patch)
    assert.equal(r.total_outdated, 3);
    assert.equal(r.skipped_minor, 1); // pkg-b
    assert.equal(r.skipped_major, 0);
  });

  test('counts skipped major separately', () => {
    const mock = JSON.stringify({
      'pkg-major': { current: '1.0.0', wanted: '2.0.0', latest: '2.0.0' },
      'pkg-patch': { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' },
    });
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.skipped_major, 1);
  });

  test('candidates sorted alphabetically by package name', () => {
    const mock = JSON.stringify({
      zeta: { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' },
      alpha: { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' },
      beta: { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' },
    });
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock });
    assert.deepEqual(r.candidates.map((c) => c.package), ['alpha', 'beta', 'zeta']);
  });

  test('respects maxCandidates cap', () => {
    const pkgs = {};
    for (let i = 0; i < 10; i += 1) {
      pkgs[`pkg-${i}`] = { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' };
    }
    const mock = JSON.stringify(pkgs);
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock, maxCandidates: 3 });
    assert.equal(r.candidates.length, 3);
    assert.equal(r.total_patch_available, 10);
  });

  test('handles empty json (no outdated)', () => {
    const r = detector.detectPatchUpdates({ mockOutdatedJson: '{}' });
    assert.equal(r.candidates.length, 0);
    assert.equal(r.total_outdated, 0);
  });

  test('handles malformed json without throwing', () => {
    const r = detector.detectPatchUpdates({ mockOutdatedJson: '{ not valid' });
    assert.equal(r.candidates.length, 0);
    assert.equal(r.parse_error, true);
  });

  test('skips entries missing current/wanted', () => {
    const mock = JSON.stringify({
      'broken-1': { current: '1.0.0' }, // no wanted
      'broken-2': { wanted: '1.0.0' },  // no current
      good: { current: '1.0.0', wanted: '1.0.1', latest: '1.0.1' },
    });
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].package, 'good');
  });

  test('candidates have all required fields (package, current, wanted, latest, type)', () => {
    const mock = JSON.stringify({
      good: { current: '1.0.0', wanted: '1.0.1', latest: '2.0.0' },
    });
    const r = detector.detectPatchUpdates({ mockOutdatedJson: mock });
    const c = r.candidates[0];
    assert.equal(c.package, 'good');
    assert.equal(c.current, '1.0.0');
    assert.equal(c.wanted, '1.0.1');
    assert.equal(c.latest, '2.0.0');
    assert.equal(c.type, 'patch');
  });
});

describe('formatCandidatesForCommit', () => {
  test('joins candidates with current→wanted shape', () => {
    const out = detector.formatCandidatesForCommit([
      { package: 'a', current: '1.0.0', wanted: '1.0.1' },
      { package: 'b', current: '2.0.0', wanted: '2.0.1' },
    ]);
    assert.equal(out, 'a 1.0.0→1.0.1, b 2.0.0→2.0.1');
  });

  test('returns empty string for empty / null input', () => {
    assert.equal(detector.formatCandidatesForCommit([]), '');
    assert.equal(detector.formatCandidatesForCommit(null), '');
    assert.equal(detector.formatCandidatesForCommit(undefined), '');
  });
});

describe('buildInstallArgs', () => {
  test('produces npm install args pinned to wanted version', () => {
    const args = detector.buildInstallArgs([
      { package: 'react', wanted: '19.1.0' },
      { package: 'next', wanted: '16.0.5' },
    ]);
    assert.deepEqual(args, ['install', '--save', 'react@19.1.0', 'next@16.0.5']);
  });

  test('returns empty array for no candidates', () => {
    assert.deepEqual(detector.buildInstallArgs([]), []);
    assert.deepEqual(detector.buildInstallArgs(null), []);
    assert.deepEqual(detector.buildInstallArgs(undefined), []);
  });
});
