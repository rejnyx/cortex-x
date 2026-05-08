#!/usr/bin/env node
// recommendation-harvest.cjs — Sprint 1.8.2 read-only signal harvester.
//
// Mines closed PRs + CI failures + open issues to surface candidate
// observations for cortex/recommendations.md. Deterministic — no LLM call,
// no source-code edits, no blast radius beyond appending to one markdown file.
//
// Used by Steward when action_kind === 'recommendation_harvest'. The harvester
// runs read-only signal collection, then dedupes against existing
// recommendations to produce a small list of NEW candidate observations.
//
// Why this matters for the nightly cron: when cortex/recommendations.md is
// drained (all "## DO this week" items processed), Steward has nothing to do
// → no_actionable_step → exit clean. Harvester turns "nothing to do" into
// "draft PR appending 1-3 new observations sourced from real signal" —
// recommendations.md becomes a living document instead of one-shot input.
//
// Signal sources (every one is read-only, optional, fail-open):
//   1. gh pr list --state closed                 — recently merged PRs
//   2. gh run list --status failure              — CI failures
//   3. gh issue list --state open                — open issues
//
// Each missing tool / missing auth → return {} for that signal. The harvester
// never blocks; it surfaces what it can.
//
// CLI:
//   node detectors/recommendation-harvest.cjs              # human report
//   node detectors/recommendation-harvest.cjs --json       # machine output
//   node detectors/recommendation-harvest.cjs --max=5      # cap candidates

'use strict';

const { execSync } = require('child_process');

const SIGNAL_TIMEOUT_MS = 5000;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_CANDIDATES = 3;

function safeExec(cmd, timeout) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: timeout || SIGNAL_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function ghAvailable() {
  return !!safeExec('gh --version', 1000);
}

function ghAuthed() {
  if (!ghAvailable()) return false;
  // gh auth status exits 0 if authed, 1 otherwise. We only need the exit code.
  return !!safeExec('gh auth status', 2000);
}

function isoDateNDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ── Signal collectors ──────────────────────────────────────────────────────

function collectClosedPRs(lookbackDays) {
  if (!ghAuthed()) return [];
  const since = isoDateNDaysAgo(lookbackDays);
  const out = safeExec(
    `gh pr list --state closed --search "merged:>=${since}" --limit 20 --json number,title,mergedAt,url,labels`,
    SIGNAL_TIMEOUT_MS,
  );
  if (!out) return [];
  try { return JSON.parse(out); } catch { return []; }
}

function collectCIFailures(lookbackRuns) {
  if (!ghAuthed()) return [];
  const out = safeExec(
    `gh run list --limit ${lookbackRuns || 20} --json conclusion,name,createdAt,url,databaseId,headSha`,
    SIGNAL_TIMEOUT_MS,
  );
  if (!out) return [];
  try {
    return JSON.parse(out).filter((r) => r.conclusion === 'failure');
  } catch { return []; }
}

function collectOpenIssues(maxCount) {
  if (!ghAuthed()) return [];
  const out = safeExec(
    `gh issue list --state open --limit ${maxCount || 10} --json number,title,url,labels,createdAt`,
    SIGNAL_TIMEOUT_MS,
  );
  if (!out) return [];
  try { return JSON.parse(out); } catch { return []; }
}

// ── Candidate generation ───────────────────────────────────────────────────
//
// Each signal generates 0-N candidate observations. Each candidate has:
//   { title:    short imperative ("Investigate X failure")
//     body:     1-2 sentence rationale
//     source:   one of "ci_failure" | "merged_pr" | "open_issue"
//     source_url: stable URL (for [src: ...] citation)
//     dedup_key: short string used for dedup vs existing recs }

function candidatesFromCIFailures(failures) {
  const candidates = [];
  // Cluster failures by workflow name: 3+ failures of same workflow in window
  // is a stronger signal than one-off flake.
  const byWorkflow = {};
  for (const f of failures) {
    if (!f.name) continue;
    if (!byWorkflow[f.name]) byWorkflow[f.name] = [];
    byWorkflow[f.name].push(f);
  }
  for (const [workflow, runs] of Object.entries(byWorkflow)) {
    if (runs.length >= 2) {
      candidates.push({
        title: `Investigate recurring ${workflow} workflow failures`,
        body: `${runs.length} ${workflow} runs failed in the lookback window. Likely flaky test or genuine regression — triage before next merge.`,
        source: 'ci_failure',
        source_url: runs[0].url || '',
        dedup_key: `ci-${workflow}`,
      });
    }
  }
  return candidates;
}

function candidatesFromMergedPRs(prs) {
  const candidates = [];
  // PRs labeled "tech-debt" or "needs-followup" surface as recommendations
  for (const pr of prs) {
    const labels = (pr.labels || []).map((l) => (l.name || '').toLowerCase());
    if (labels.includes('tech-debt') || labels.includes('needs-followup')) {
      candidates.push({
        title: `Follow-up on PR #${pr.number}: ${pr.title}`,
        body: `Merged PR was tagged for follow-up. Check the discussion + any TODO markers added in the diff.`,
        source: 'merged_pr',
        source_url: pr.url || '',
        dedup_key: `pr-${pr.number}`,
      });
    }
  }
  return candidates;
}

function candidatesFromOpenIssues(issues) {
  const candidates = [];
  // Issues labeled "good-first-issue" or "easy" are candidates for harvest;
  // they're scoped enough that Steward's recommendation pipeline can act on them.
  for (const issue of issues) {
    const labels = (issue.labels || []).map((l) => (l.name || '').toLowerCase());
    if (labels.includes('good-first-issue') || labels.includes('easy')) {
      candidates.push({
        title: `Address issue #${issue.number}: ${issue.title}`,
        body: `Open issue tagged easy/good-first-issue — small enough for Steward to triage in a single recommendation cycle.`,
        source: 'open_issue',
        source_url: issue.url || '',
        dedup_key: `issue-${issue.number}`,
      });
    }
  }
  return candidates;
}

// ── Dedup vs existing recommendations.md ───────────────────────────────────

function extractDedupKeys(recommendationsBody) {
  // Find URLs in [src: ...] citations and extract PR/issue/run numbers
  const keys = new Set();
  if (!recommendationsBody) return keys;
  const urlMatches = [...recommendationsBody.matchAll(/\[src:\s*(\S+?)\]/g)];
  for (const m of urlMatches) {
    const url = m[1];
    // GitHub URL patterns: /pull/123, /issues/123, /runs/123
    const prMatch = url.match(/\/pull\/(\d+)/);
    if (prMatch) keys.add(`pr-${prMatch[1]}`);
    const issueMatch = url.match(/\/issues\/(\d+)/);
    if (issueMatch) keys.add(`issue-${issueMatch[1]}`);
    const runMatch = url.match(/\/actions\/runs\/(\d+)/);
    if (runMatch) keys.add(`run-${runMatch[1]}`);
  }
  // Also dedup by ci-<workflow> patterns from prior harvest runs.
  // Title-shape match: "Investigate recurring <name> workflow failures"
  const ciMatches = [...recommendationsBody.matchAll(/Investigate recurring ([^\n]+?) workflow failures/g)];
  for (const m of ciMatches) {
    keys.add(`ci-${m[1].trim()}`);
  }
  return keys;
}

// ── Main entry point ───────────────────────────────────────────────────────

function harvest({ recommendationsBody, lookbackDays, maxCandidates, signals } = {}) {
  // signals param allows DI for testing (pass mock CI/PR/issue data).
  // In production, we collect from gh.
  const days = lookbackDays || DEFAULT_LOOKBACK_DAYS;
  const maxN = maxCandidates || DEFAULT_MAX_CANDIDATES;

  let prs, failures, issues;
  if (signals) {
    prs = signals.prs || [];
    failures = signals.failures || [];
    issues = signals.issues || [];
  } else {
    prs = collectClosedPRs(days);
    failures = collectCIFailures(20);
    issues = collectOpenIssues(10);
  }

  const allCandidates = [
    ...candidatesFromCIFailures(failures),
    ...candidatesFromMergedPRs(prs),
    ...candidatesFromOpenIssues(issues),
  ];

  // Dedup against existing recommendations.md
  const existingKeys = extractDedupKeys(recommendationsBody || '');
  const fresh = allCandidates.filter((c) => !existingKeys.has(c.dedup_key));

  // Cap to max
  const final = fresh.slice(0, maxN);

  return {
    candidates: final,
    total_signals: prs.length + failures.length + issues.length,
    deduped_count: allCandidates.length - fresh.length,
    gh_available: ghAvailable(),
    gh_authed: signals ? null : ghAuthed(),
  };
}

// Format as recommendations.md-appendable markdown lines
function formatAsRecommendationLines(candidates) {
  return candidates.map((c) => {
    const src = c.source_url ? ` [src: ${c.source_url}]` : '';
    return `- [ ] ${c.title}${src}`;
  }).join('\n');
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const maxN = maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES;

  const result = harvest({ maxCandidates: maxN });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Recommendation harvest report:\n`);
    process.stdout.write(`  gh available: ${result.gh_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  gh authed:    ${result.gh_authed ? 'yes' : 'no'}\n`);
    process.stdout.write(`  total signals examined: ${result.total_signals}\n`);
    process.stdout.write(`  deduped (already in recommendations.md): ${result.deduped_count}\n`);
    process.stdout.write(`  fresh candidates: ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nProposed appendable lines:\n');
      process.stdout.write(formatAsRecommendationLines(result.candidates) + '\n');
    }
  }
}

module.exports = {
  harvest,
  formatAsRecommendationLines,
  candidatesFromCIFailures,
  candidatesFromMergedPRs,
  candidatesFromOpenIssues,
  extractDedupKeys,
  ghAvailable,
  ghAuthed,
};
