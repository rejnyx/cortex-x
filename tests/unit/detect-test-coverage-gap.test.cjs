// detect-test-coverage-gap.test.cjs — Sprint 1.8.10 detector tests.
// Uses mockSummary + mockRecentFiles DI — no real coverage / git invocation.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/test-coverage-gap.cjs');

// Use relative path keys so the test runs identically on Windows + Unix.
// (coverage tools usually emit absolute paths, but the detector handles both.)
const MOCK_SUMMARY = {
  total: { statements: { pct: 60 }, branches: { pct: 50 }, functions: { pct: 70 }, lines: { pct: 65 } },
  'src/low-cov.js': {
    statements: { pct: 25 }, branches: { pct: 20 }, functions: { pct: 30 }, lines: { pct: 28 },
  },
  'src/medium-cov.js': {
    statements: { pct: 65 }, branches: { pct: 60 }, functions: { pct: 70 }, lines: { pct: 65 },
  },
  'src/high-cov.js': {
    statements: { pct: 95 }, branches: { pct: 90 }, functions: { pct: 100 }, lines: { pct: 95 },
  },
};

describe('detectCoverageGaps (DI)', () => {
  test('returns empty when no coverage summary', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: null,
    });
    assert.equal(r.coverage_available, false);
    assert.equal(r.candidates.length, 0);
  });

  test('returns candidates only for low-coverage + recently-edited files', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: MOCK_SUMMARY,
      mockRecentFiles: ['src/low-cov.js'], // only this is recent
      threshold: 70,
    });
    assert.equal(r.coverage_available, true);
    assert.equal(r.total_low_coverage, 2); // low-cov + medium-cov both below 70
    assert.equal(r.skipped_unchanged, 1);  // medium-cov not in recent
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].file, 'src/low-cov.js');
    assert.equal(r.candidates[0].statements_pct, 25);
  });

  test('skips files at or above threshold', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: MOCK_SUMMARY,
      mockRecentFiles: ['src/high-cov.js'],
      threshold: 70,
    });
    // high-cov is 95% → above 70, skipped
    assert.equal(r.candidates.length, 0);
    assert.equal(r.total_low_coverage, 2); // counts only low-cov + medium-cov
  });

  test('candidates sorted lowest-coverage-first', () => {
    const summary = {
      'a.js': { statements: { pct: 50 } },
      'b.js': { statements: { pct: 20 } },
      'c.js': { statements: { pct: 35 } },
    };
    const r = detector.detectCoverageGaps({
      mockSummary: summary,
      mockRecentFiles: ['a.js', 'b.js', 'c.js'],
      threshold: 70,
    });
    assert.equal(r.candidates.length, 3);
    assert.deepEqual(r.candidates.map((c) => c.statements_pct), [20, 35, 50]);
  });

  test('respects maxCandidates cap', () => {
    const summary = {};
    const recent = [];
    for (let i = 0; i < 10; i += 1) {
      summary[`f${i}.js`] = { statements: { pct: 10 + i } };
      recent.push(`f${i}.js`);
    }
    const r = detector.detectCoverageGaps({
      mockSummary: summary,
      mockRecentFiles: recent,
      threshold: 70,
      maxCandidates: 3,
    });
    assert.equal(r.candidates.length, 3);
  });

  test('skips total entry from coverage summary', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: { total: { statements: { pct: 50 } }, 'x.js': { statements: { pct: 10 } } },
      mockRecentFiles: ['x.js'],
      threshold: 70,
    });
    // 'total' must not show up as a candidate
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].file, 'x.js');
  });

  test('handles missing pct field gracefully', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: {
        'no-stmts.js': { statements: {} },
        'has-stmts.js': { statements: { pct: 30 } },
      },
      mockRecentFiles: ['no-stmts.js', 'has-stmts.js'],
      threshold: 70,
    });
    assert.equal(r.candidates.length, 1);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle includes file + percentage', () => {
    const t = detector.formatIssueTitle({ file: 'src/x.js', statements_pct: 25.5 });
    assert.match(t, /src\/x\.js/);
    assert.match(t, /25\.5%/);
  });

  test('formatIssueBody includes file, metrics table, why, suggestions', () => {
    const body = detector.formatIssueBody({
      file: 'src/x.js',
      statements_pct: 25,
      branches_pct: 20,
      functions_pct: 30,
      lines_pct: 28,
      threshold: 70,
    });
    assert.match(body, /src\/x\.js/);
    assert.match(body, /25\.0%/);
    assert.match(body, /Coverage metrics/);
    assert.match(body, /## Why this is filed/);
    assert.match(body, /Run.*test:coverage/);
  });

  test('formatIssueBody handles missing metric subfields', () => {
    const body = detector.formatIssueBody({
      file: 'a.js', statements_pct: 30, threshold: 70,
      branches_pct: null, functions_pct: null, lines_pct: null,
    });
    assert.match(body, /statements/);
    assert.doesNotMatch(body, /\| branches/);
  });
});

describe('Sprint 2.15.1 R2 hardening — mockSummary DI contract', () => {
  test('mockSummary=null returns "no coverage available" (force-missing)', () => {
    const r = detector.detectCoverageGaps({ mockSummary: null });
    assert.equal(r.coverage_available, false);
    assert.equal(r.candidates.length, 0);
  });

  test('mockSummary=[] (array) does NOT silently signal "clean coverage"', () => {
    // Pre-fix: arrays were truthy → coverage_available:true, 0 candidates →
    // indistinguishable from a real clean run. Post-fix: rejected as
    // ambiguous type → force-missing.
    const r = detector.detectCoverageGaps({ mockSummary: [] });
    assert.equal(r.coverage_available, false);
  });

  test('mockSummary=42 (number) rejected', () => {
    const r = detector.detectCoverageGaps({ mockSummary: 42 });
    assert.equal(r.coverage_available, false);
  });

  test('mockSummary="oops" (string) rejected', () => {
    const r = detector.detectCoverageGaps({ mockSummary: 'oops' });
    assert.equal(r.coverage_available, false);
  });

  test('mockSummary=true (bool) rejected', () => {
    const r = detector.detectCoverageGaps({ mockSummary: true });
    assert.equal(r.coverage_available, false);
  });

  test('mockSummary=function rejected', () => {
    const r = detector.detectCoverageGaps({ mockSummary: () => ({}) });
    assert.equal(r.coverage_available, false);
  });

  test('mockSummary=plain object accepted (existing contract)', () => {
    const r = detector.detectCoverageGaps({
      mockSummary: { total: { statements: { pct: 50 } }, 'x.js': { statements: { pct: 10 } } },
      mockRecentFiles: ['x.js'],
      threshold: 70,
    });
    assert.equal(r.coverage_available, true);
  });
});
