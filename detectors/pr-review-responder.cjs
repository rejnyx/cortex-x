#!/usr/bin/env node
// pr-review-responder.cjs — Sprint 1.8.11 PR review comment monitor.
//
// Capability #9 from the Hermes evolution roadmap. Polls open PRs authored
// by Hermes ("Hermes (cortex-x)") that have unresolved reviewer comments.
// Pragmatic v1: file an aggregation issue summarizing the comments per PR.
// Maintainer addresses on the PR or in code; Hermes does NOT auto-patch.
//
// v2 (parked v0.9+): LLM-driven targeted patch on the same hermes/<branch>.
// That requires careful design — comment thread parsing, patch shape, scope
// validation against original recommendation. Out of v0.8 scope.
//
// Output:
//   {
//     candidates: [{ pr_number, pr_title, comment_count, comments: [{author, body, file, line}] }],
//     total_open_prs: <int>,
//     gh_available: bool,
//     gh_authed: bool,
//   }
//
// CLI:
//   node detectors/pr-review-responder.cjs              # human report
//   node detectors/pr-review-responder.cjs --json
//   node detectors/pr-review-responder.cjs --max=5

'use strict';

const { execSync } = require('child_process');

const SIGNAL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CANDIDATES = 5;
const HERMES_AUTHOR = 'Hermes (cortex-x)';

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || SIGNAL_TIMEOUT_MS,
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function ghAvailable() {
  return !!safeExec('gh --version', { timeout: 1000 });
}

function ghAuthed() {
  if (!ghAvailable()) return false;
  return !!safeExec('gh auth status', { timeout: 2000 });
}

// Fetch open PRs authored by Hermes. Returns array of { number, title, author }.
function isHermesAuthor(pr) {
  const name = pr.author && (pr.author.name || pr.author.login || '');
  return name.includes('Hermes') || name === HERMES_AUTHOR || name === 'hermes-cortex-x';
}

function getHermesOpenPRs({ cwd, mockOpenPRs }) {
  let parsed;
  if (mockOpenPRs != null) {
    parsed = mockOpenPRs;
  } else {
    if (!ghAuthed()) return [];
    const out = safeExec(
      `gh pr list --state open --limit 20 --json number,title,author,url`,
      { cwd },
    );
    if (!out) return [];
    try { parsed = JSON.parse(out); } catch { return []; }
  }
  return parsed.filter(isHermesAuthor);
}

// Fetch review comments for a single PR. Returns array of { author, body, file, line }.
function getPRComments({ cwd, prNumber, mockComments }) {
  if (mockComments != null) return mockComments;
  if (!ghAuthed()) return [];
  // gh api can fetch review comments (line-level). Issue comments are different
  // endpoint — we focus on review comments (the ones tied to specific code lines).
  const out = safeExec(
    `gh api repos/{owner}/{repo}/pulls/${prNumber}/comments`,
    { cwd },
  );
  if (!out) return [];
  let parsed;
  try { parsed = JSON.parse(out); } catch { return []; }
  return parsed.map((c) => ({
    author: (c.user && c.user.login) || 'unknown',
    body: (c.body || '').slice(0, 500),
    file: c.path || null,
    line: c.line || c.original_line || null,
  }));
}

// Top-level: detect PRs with unresolved reviewer comments worth aggregating.
// "Unresolved" v1 = there exist any comments at all from a non-Hermes author.
// v2 could check resolution state via gh api thread endpoints.
function detectReviewComments({
  cwd, maxCandidates, mockOpenPRs, mockCommentsByPR,
} = {}) {
  const repoRoot = cwd || process.cwd();
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;

  const prs = getHermesOpenPRs({ cwd: repoRoot, mockOpenPRs });
  const candidates = [];

  for (const pr of prs) {
    const comments = mockCommentsByPR
      ? (mockCommentsByPR[pr.number] || [])
      : getPRComments({ cwd: repoRoot, prNumber: pr.number });

    const externalComments = comments.filter((c) =>
      c.author !== 'hermes-cortex-x' &&
      !((c.author || '').toLowerCase().includes('hermes')),
    );
    if (externalComments.length === 0) continue;

    candidates.push({
      pr_number: pr.number,
      pr_title: pr.title,
      pr_url: pr.url || null,
      comment_count: externalComments.length,
      comments: externalComments,
    });
    if (candidates.length >= max) break;
  }

  return {
    candidates,
    total_open_prs: prs.length,
    gh_available: ghAvailable(),
    gh_authed: mockOpenPRs ? null : ghAuthed(),
  };
}

function formatIssueTitle(candidate) {
  return `Reviewer feedback on PR #${candidate.pr_number}: ${candidate.comment_count} comment${candidate.comment_count === 1 ? '' : 's'}`;
}

function formatIssueBody(candidate) {
  const lines = [];
  lines.push(`## PR`);
  lines.push('');
  lines.push(`#${candidate.pr_number} — ${candidate.pr_title}`);
  if (candidate.pr_url) {
    lines.push('');
    lines.push(candidate.pr_url);
  }
  lines.push('');
  lines.push(`## Reviewer comments (${candidate.comment_count})`);
  lines.push('');
  for (const c of candidate.comments) {
    const loc = c.file ? `\`${c.file}${c.line ? ':' + c.line : ''}\` — ` : '';
    lines.push(`### ${c.author}`);
    lines.push('');
    if (loc) lines.push(loc);
    lines.push('');
    lines.push('> ' + (c.body || '').replace(/\n/g, '\n> '));
    lines.push('');
  }
  lines.push('## Why this is filed');
  lines.push('');
  lines.push('Hermes\'s `pr_review_responder` capability monitors open PRs it authored');
  lines.push('and surfaces reviewer feedback as a single aggregated issue. v1 does NOT');
  lines.push('auto-patch the PR — maintainer addresses on the PR thread or in code.');
  lines.push('');
  lines.push('Suggested next steps:');
  lines.push('1. Review the comments above');
  lines.push('2. Either patch the Hermes PR branch directly, or close the PR if rejected');
  lines.push('3. Close this aggregation issue when comments are resolved');
  lines.push('');
  lines.push('---');
  lines.push('Filed by Hermes (cortex-x) pr-review-responder. Deterministic — no LLM.');
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const result = detectReviewComments({
    maxCandidates: maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`PR-review-responder report:\n`);
    process.stdout.write(`  gh available:    ${result.gh_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  gh authed:       ${result.gh_authed ? 'yes' : 'no'}\n`);
    process.stdout.write(`  total open PRs:  ${result.total_open_prs}\n`);
    process.stdout.write(`  candidates:      ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nPRs with reviewer feedback:\n');
      for (const c of result.candidates) {
        process.stdout.write(`  #${c.pr_number}  ${c.comment_count} comment(s)  ${c.pr_title.slice(0, 60)}\n`);
      }
    }
  }
}

module.exports = {
  detectReviewComments,
  getHermesOpenPRs,
  getPRComments,
  isHermesAuthor,
  formatIssueTitle,
  formatIssueBody,
};
