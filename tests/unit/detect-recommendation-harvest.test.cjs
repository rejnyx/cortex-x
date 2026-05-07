// detect-recommendation-harvest.test.cjs — Sprint 1.8.2 harvester logic tests.
//
// All tests use the `signals` dependency-injection parameter so we never make
// real `gh` calls — fully deterministic, fast, no network.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const harvester = require('../../detectors/recommendation-harvest.cjs');

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_CI_FAILURES = [
  { name: 'test', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/100', databaseId: 100, headSha: 'abc123', createdAt: '2026-05-07T10:00:00Z' },
  { name: 'test', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/101', databaseId: 101, headSha: 'def456', createdAt: '2026-05-07T11:00:00Z' },
  { name: 'test', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/102', databaseId: 102, headSha: 'ghi789', createdAt: '2026-05-07T12:00:00Z' },
  { name: 'install-smoke', conclusion: 'failure', url: 'https://github.com/x/y/actions/runs/103', databaseId: 103, headSha: 'jkl012', createdAt: '2026-05-07T13:00:00Z' },
];

const MOCK_MERGED_PRS = [
  { number: 42, title: 'Add login flow', mergedAt: '2026-05-01', url: 'https://github.com/x/y/pull/42', labels: [{ name: 'feature' }] },
  { number: 43, title: 'Refactor auth module', mergedAt: '2026-05-02', url: 'https://github.com/x/y/pull/43', labels: [{ name: 'tech-debt' }] },
  { number: 44, title: 'Fix UI glitch', mergedAt: '2026-05-03', url: 'https://github.com/x/y/pull/44', labels: [{ name: 'needs-followup' }] },
];

const MOCK_OPEN_ISSUES = [
  { number: 100, title: 'Add tests for util.js', url: 'https://github.com/x/y/issues/100', labels: [{ name: 'good-first-issue' }] },
  { number: 101, title: 'Document the API', url: 'https://github.com/x/y/issues/101', labels: [{ name: 'easy' }, { name: 'docs' }] },
  { number: 102, title: 'Big architectural rewrite', url: 'https://github.com/x/y/issues/102', labels: [{ name: 'epic' }] },
];

// ── Candidate generation ───────────────────────────────────────────────────

describe('candidatesFromCIFailures', () => {
  test('clusters 3 failures of same workflow as ONE candidate', () => {
    const candidates = harvester.candidatesFromCIFailures(MOCK_CI_FAILURES);
    // 3x test + 1x install-smoke → only test reaches threshold (>= 2)
    const testCandidates = candidates.filter((c) => c.title.includes('test workflow'));
    assert.equal(testCandidates.length, 1);
  });

  test('skips workflows with only 1 failure (under threshold)', () => {
    const candidates = harvester.candidatesFromCIFailures(MOCK_CI_FAILURES);
    const installCandidates = candidates.filter((c) => c.title.includes('install-smoke'));
    assert.equal(installCandidates.length, 0);
  });

  test('includes 2 same-workflow failures (threshold = 2)', () => {
    const twoFails = MOCK_CI_FAILURES.slice(0, 2); // 2x test
    const candidates = harvester.candidatesFromCIFailures(twoFails);
    assert.equal(candidates.length, 1);
    assert.match(candidates[0].title, /test workflow failures/);
  });

  test('produces dedup_key in ci-<workflow> form', () => {
    const candidates = harvester.candidatesFromCIFailures(MOCK_CI_FAILURES);
    assert.ok(candidates.some((c) => c.dedup_key === 'ci-test'));
  });

  test('handles empty failure list', () => {
    assert.deepEqual(harvester.candidatesFromCIFailures([]), []);
  });

  test('skips failures with missing workflow name', () => {
    const broken = [{ conclusion: 'failure', url: 'x' }];
    assert.deepEqual(harvester.candidatesFromCIFailures(broken), []);
  });
});

describe('candidatesFromMergedPRs', () => {
  test('surfaces tech-debt and needs-followup PRs', () => {
    const candidates = harvester.candidatesFromMergedPRs(MOCK_MERGED_PRS);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.some((c) => c.dedup_key === 'pr-43'));
    assert.ok(candidates.some((c) => c.dedup_key === 'pr-44'));
  });

  test('ignores feature PRs (no relevant label)', () => {
    const candidates = harvester.candidatesFromMergedPRs(MOCK_MERGED_PRS);
    assert.ok(!candidates.some((c) => c.dedup_key === 'pr-42'));
  });

  test('handles missing labels array gracefully', () => {
    const broken = [{ number: 99, title: 'x', mergedAt: 'y', url: 'z' }];
    assert.deepEqual(harvester.candidatesFromMergedPRs(broken), []);
  });
});

describe('candidatesFromOpenIssues', () => {
  test('surfaces good-first-issue and easy labels', () => {
    const candidates = harvester.candidatesFromOpenIssues(MOCK_OPEN_ISSUES);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.some((c) => c.dedup_key === 'issue-100'));
    assert.ok(candidates.some((c) => c.dedup_key === 'issue-101'));
  });

  test('skips epic / large issues', () => {
    const candidates = harvester.candidatesFromOpenIssues(MOCK_OPEN_ISSUES);
    assert.ok(!candidates.some((c) => c.dedup_key === 'issue-102'));
  });

  test('label match is case-insensitive', () => {
    const upperLabel = [{ number: 1, title: 'x', url: 'y', labels: [{ name: 'GOOD-FIRST-ISSUE' }] }];
    const candidates = harvester.candidatesFromOpenIssues(upperLabel);
    assert.equal(candidates.length, 1);
  });
});

// ── Dedup logic ────────────────────────────────────────────────────────────

describe('extractDedupKeys', () => {
  test('extracts pr-N from /pull/N URLs in [src: ...]', () => {
    const body = '- [ ] Test [src: https://github.com/x/y/pull/42]';
    const keys = harvester.extractDedupKeys(body);
    assert.ok(keys.has('pr-42'));
  });

  test('extracts issue-N from /issues/N URLs', () => {
    const body = '- [ ] Test [src: https://github.com/x/y/issues/99]';
    const keys = harvester.extractDedupKeys(body);
    assert.ok(keys.has('issue-99'));
  });

  test('extracts run-N from /actions/runs/N URLs', () => {
    const body = '- [ ] Test [src: https://github.com/x/y/actions/runs/12345]';
    const keys = harvester.extractDedupKeys(body);
    assert.ok(keys.has('run-12345'));
  });

  test('extracts ci-<workflow> from prior harvested observations', () => {
    const body = '- [ ] Investigate recurring test workflow failures [src: x]';
    const keys = harvester.extractDedupKeys(body);
    assert.ok(keys.has('ci-test'));
  });

  test('returns empty Set on empty body', () => {
    const keys = harvester.extractDedupKeys('');
    assert.equal(keys.size, 0);
  });

  test('returns empty Set on null body', () => {
    const keys = harvester.extractDedupKeys(null);
    assert.equal(keys.size, 0);
  });
});

// ── End-to-end harvest ─────────────────────────────────────────────────────

describe('harvest (DI signals)', () => {
  test('returns candidates from all signal sources', () => {
    const result = harvester.harvest({
      signals: {
        failures: MOCK_CI_FAILURES,
        prs: MOCK_MERGED_PRS,
        issues: MOCK_OPEN_ISSUES,
      },
    });
    // 1 CI cluster + 2 PRs + 2 issues = 5 → capped at default max 3
    assert.equal(result.candidates.length, 3);
    assert.equal(result.total_signals, 4 + 3 + 3);
  });

  test('respects maxCandidates cap', () => {
    const result = harvester.harvest({
      signals: {
        failures: MOCK_CI_FAILURES,
        prs: MOCK_MERGED_PRS,
        issues: MOCK_OPEN_ISSUES,
      },
      maxCandidates: 1,
    });
    assert.equal(result.candidates.length, 1);
  });

  test('dedupes candidates already cited in recommendations.md', () => {
    const existing = `
## DO this week (cited)
- [ ] Investigate recurring test workflow failures [src: ci-test]
- [ ] Follow-up on PR #43 [src: https://github.com/x/y/pull/43]
`;
    const result = harvester.harvest({
      signals: {
        failures: MOCK_CI_FAILURES,
        prs: MOCK_MERGED_PRS,
        issues: MOCK_OPEN_ISSUES,
      },
      recommendationsBody: existing,
      maxCandidates: 10,
    });
    // Should NOT include ci-test or pr-43; should include pr-44, issue-100, issue-101
    const keys = result.candidates.map((c) => c.dedup_key);
    assert.ok(!keys.includes('ci-test'), 'ci-test should be deduped');
    assert.ok(!keys.includes('pr-43'), 'pr-43 should be deduped');
    assert.ok(keys.includes('pr-44'));
    assert.equal(result.deduped_count, 2);
  });

  test('returns 0 candidates when all signals are empty', () => {
    const result = harvester.harvest({
      signals: { failures: [], prs: [], issues: [] },
    });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.total_signals, 0);
  });

  test('handles partial signal sources', () => {
    const result = harvester.harvest({
      signals: { failures: MOCK_CI_FAILURES.slice(0, 2) },
      // no prs, no issues
    });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.total_signals, 2);
  });
});

// ── formatAsRecommendationLines ────────────────────────────────────────────

describe('formatAsRecommendationLines', () => {
  test('produces appendable markdown checklist lines', () => {
    const candidates = [
      { title: 'Test thing', source_url: 'https://example.com/x' },
      { title: 'Another thing', source_url: 'https://example.com/y' },
    ];
    const out = harvester.formatAsRecommendationLines(candidates);
    assert.match(out, /^- \[ \] Test thing \[src: https:\/\/example\.com\/x\]$/m);
    assert.match(out, /^- \[ \] Another thing \[src: https:\/\/example\.com\/y\]$/m);
  });

  test('omits [src: ...] when source_url empty', () => {
    const candidates = [{ title: 'No source', source_url: '' }];
    const out = harvester.formatAsRecommendationLines(candidates);
    assert.equal(out, '- [ ] No source');
  });

  test('handles empty candidates list', () => {
    assert.equal(harvester.formatAsRecommendationLines([]), '');
  });
});
