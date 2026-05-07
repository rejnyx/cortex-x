// detect-pr-review-responder.test.cjs — Sprint 1.8.11 detector tests.
// Uses mockOpenPRs + mockCommentsByPR DI — no real gh invocation.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../../detectors/pr-review-responder.cjs');

describe('detectReviewComments (DI)', () => {
  test('returns empty when no Hermes-authored PRs', () => {
    const r = detector.detectReviewComments({
      mockOpenPRs: [
        { number: 1, title: 'Some PR', author: { login: 'random-user' } },
      ],
      mockCommentsByPR: { 1: [{ author: 'reviewer', body: 'fix this' }] },
    });
    assert.equal(r.candidates.length, 0);
    assert.equal(r.total_open_prs, 0); // filtered to Hermes-authored only
  });

  test('detects Hermes-authored PRs with external reviewer comments', () => {
    const r = detector.detectReviewComments({
      mockOpenPRs: [
        { number: 42, title: 'feat: x', author: { login: 'hermes-cortex-x', name: 'Hermes (cortex-x)' } },
      ],
      mockCommentsByPR: {
        42: [
          { author: 'reviewer', body: 'use a different API here', file: 'src/x.js', line: 10 },
        ],
      },
    });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].pr_number, 42);
    assert.equal(r.candidates[0].comment_count, 1);
  });

  test('skips Hermes PRs with no external comments', () => {
    const r = detector.detectReviewComments({
      mockOpenPRs: [
        { number: 1, title: 'a', author: { login: 'hermes-cortex-x' } },
        { number: 2, title: 'b', author: { login: 'hermes-cortex-x' } },
      ],
      mockCommentsByPR: {
        1: [], // no comments
        2: [{ author: 'reviewer', body: 'feedback' }],
      },
    });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].pr_number, 2);
  });

  test('filters out Hermes self-comments', () => {
    const r = detector.detectReviewComments({
      mockOpenPRs: [
        { number: 1, title: 'a', author: { login: 'hermes-cortex-x' } },
      ],
      mockCommentsByPR: {
        1: [
          { author: 'hermes-cortex-x', body: 'my own comment' },
          { author: 'real-reviewer', body: 'feedback from human' },
        ],
      },
    });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].comment_count, 1);
    assert.equal(r.candidates[0].comments[0].author, 'real-reviewer');
  });

  test('respects maxCandidates cap', () => {
    const prs = [];
    const comments = {};
    for (let i = 0; i < 10; i += 1) {
      prs.push({ number: i, title: `pr ${i}`, author: { login: 'hermes-cortex-x' } });
      comments[i] = [{ author: 'reviewer', body: 'feedback' }];
    }
    const r = detector.detectReviewComments({
      mockOpenPRs: prs,
      mockCommentsByPR: comments,
      maxCandidates: 3,
    });
    assert.equal(r.candidates.length, 3);
  });

  test('handles author.name shape (gh api returns either name or login)', () => {
    const r = detector.detectReviewComments({
      mockOpenPRs: [
        { number: 1, title: 'a', author: { name: 'Hermes (cortex-x)' } },
      ],
      mockCommentsByPR: { 1: [{ author: 'reviewer', body: 'x' }] },
    });
    assert.equal(r.candidates.length, 1);
  });
});

describe('formatIssueTitle / formatIssueBody', () => {
  test('formatIssueTitle includes PR number + count', () => {
    const t = detector.formatIssueTitle({ pr_number: 42, comment_count: 3 });
    assert.match(t, /PR #42/);
    assert.match(t, /3 comments/);
  });

  test('formatIssueTitle uses singular when 1 comment', () => {
    const t = detector.formatIssueTitle({ pr_number: 1, comment_count: 1 });
    assert.match(t, /1 comment\b/);
  });

  test('formatIssueBody includes PR + comments + steps', () => {
    const body = detector.formatIssueBody({
      pr_number: 42,
      pr_title: 'feat: do thing',
      pr_url: 'https://github.com/x/y/pull/42',
      comment_count: 1,
      comments: [
        { author: 'reviewer', body: 'looks good', file: 'src/x.js', line: 10 },
      ],
    });
    assert.match(body, /#42/);
    assert.match(body, /feat: do thing/);
    assert.match(body, /reviewer/);
    assert.match(body, /looks good/);
    assert.match(body, /src\/x\.js:10/);
    assert.match(body, /Why this is filed/);
    assert.match(body, /Suggested next steps/);
  });

  test('formatIssueBody handles comment without file/line', () => {
    const body = detector.formatIssueBody({
      pr_number: 1,
      pr_title: 'x',
      comment_count: 1,
      comments: [{ author: 'r', body: 'c' }],
    });
    assert.match(body, /comment/i);
    // No backtick-wrapped path/line pair when missing
    assert.doesNotMatch(body, /`null:null`/);
  });
});
