// workflow-hardener-action.cjs — Sprint 2.5b advisory analyzer.
//
// v1 ships as ADVISORY ONLY: scans .github/workflows/*.yml, identifies
// hardening gaps, opens ONE gh issue with the proposed patches as a
// markdown checklist. NO auto-apply in v1 because:
//
//   1. .github/workflows/** is in the engine HARD_DENYLIST (Sprint pre-2.0
//      housekeeping) — privilege-escalation footgun if Steward could rewrite
//      its own CI/CD.
//   2. CI workflow regressions are catastrophic (broken main, no merges,
//      no rollout). Operator-in-the-loop is the right v1 posture.
//
// v1.5 (Sprint 2.5b.1) will add auto-fix behind an explicit env flag with
// per-finding spec criteria + per-PR rollback semantics.
//
// Research grounding (Sprint 2.5b R1):
//   - GitHub Aug-2025 policy: SHA pinning enforcement
//     https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/
//   - 2026 Actions security roadmap (workflow lockfiles)
//     https://github.com/orgs/community/discussions/190621
//   - StepSecurity Secure-Repo: closest precedent
//     https://github.com/step-security/secure-repo
//   - OpenSSF Scorecard: weekly-cron-with-public-results pattern
//     https://github.com/ossf/scorecard
//   - Wiz GHA hardening guide: missing permissions: as P1 finding
//     https://www.wiz.io/blog/github-actions-security-guide

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');
const safety = require('./safety.cjs');

const MAX_WORKFLOW_BYTES = 256 * 1024; // 256 KiB per file
const MAX_FILES = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Hardening rules
// ─────────────────────────────────────────────────────────────────────────────

const RULES = {
  unpinned_action: {
    severity: 'high',
    description: 'Action `uses:` reference uses a mutable tag or branch instead of a SHA. Per GitHub Aug-2025 security policy + 2026 roadmap, SHA pinning is required for supply-chain integrity. tj-actions/changed-files compromise (2024-2025) is the canonical incident.',
    fix_hint: 'Replace `uses: org/action@v1` with `uses: org/action@<full-sha> # v1`. Get SHA via `gh api repos/<org>/<action>/git/refs/tags/<v>`.',
  },
  missing_permissions: {
    severity: 'high',
    description: 'Workflow lacks a top-level `permissions:` block. Without it, GITHUB_TOKEN inherits broad repo-write defaults (Wiz/StepSecurity treat as P1 finding).',
    fix_hint: 'Add `permissions: { contents: read }` at workflow root; raise per-job only as needed.',
  },
  missing_concurrency: {
    severity: 'medium',
    description: 'Workflow lacks `concurrency:` block. Cron runs can stack on slow nights; PR runs can stomp each other.',
    fix_hint: 'Add `concurrency: { group: <workflow-name>-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == \'pull_request\' }} }`.',
  },
  missing_timeout: {
    severity: 'medium',
    description: 'Job lacks `timeout-minutes:`. Default 6h is wasteful on hangs.',
    fix_hint: 'Add `timeout-minutes: 15` (or appropriate cap) at job level.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Analyzer — pure parsing, no side effects.
// ─────────────────────────────────────────────────────────────────────────────

function listWorkflowFiles(repoRoot) {
  const dir = path.join(repoRoot, '.github', 'workflows');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (files.length >= MAX_FILES) break;
    if (e.isFile() && /\.ya?ml$/i.test(e.name)) {
      files.push(path.join('.github', 'workflows', e.name));
    }
  }
  return files;
}

// Detect `uses:` references that aren't SHA-pinned. SHA = 40-char hex.
// Fully-qualified action ref: `org/repo[/path]@<ref>`.
function findUnpinnedUses(content) {
  const findings = [];
  // Sprint 2.5b R2 fix (HIGH): normalize CRLF before line-split so Windows
  // workflow files don't bleed \r into excerpts + line numbers stay accurate.
  const lines = safety.normalizeCRLF(content).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `uses: org/repo[/sub]@ref` (skip local actions like ./ and docker://)
    const m = line.match(/^\s*-?\s*uses:\s*([A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-/]+)@([A-Za-z0-9._\-]+)/);
    if (!m) continue;
    const [, action, ref] = m;
    // Skip local action references (./<path> isn't reachable here since we
    // only match `org/repo` shape, but defensive against future regex broadening).
    if (action.startsWith('./') || action.startsWith('docker://')) continue;
    // SHA = 40 hex chars
    if (safety.SAFE_SHA_REGEX.test(ref)) continue;
    findings.push({
      rule_id: 'unpinned_action',
      file: null, // filled by caller
      line: i + 1,
      action,
      current_ref: ref,
      excerpt: line.trim().slice(0, 120),
    });
  }
  return findings;
}

// Detect missing top-level `permissions:` block. Heuristic: look for
// `^permissions:` at column-0 in the workflow body. Doesn't catch per-job
// permissions, only top-level.
function findMissingTopLevelPermissions(content) {
  if (/^permissions\s*:/m.test(content)) return null;
  return {
    rule_id: 'missing_permissions',
    file: null,
    line: 1,
    excerpt: '<no top-level permissions: block>',
  };
}

function findMissingConcurrency(content) {
  if (/^concurrency\s*:/m.test(content)) return null;
  return {
    rule_id: 'missing_concurrency',
    file: null,
    line: 1,
    excerpt: '<no concurrency: block>',
  };
}

// Find jobs missing timeout-minutes. Each job is `<name>:` followed by
// indented props. We do a coarse split.
function findMissingTimeouts(content) {
  const findings = [];
  // Locate `jobs:` block then iterate top-level job names (2-space indent).
  const jobsIdx = content.search(/^jobs\s*:/m);
  if (jobsIdx === -1) return findings;
  const jobsBlock = content.slice(jobsIdx);
  // Match each job header: 2-space-indented identifier followed by colon.
  const jobRegex = /^  ([A-Za-z][\w-]*)\s*:\s*$/gm;
  let m;
  while ((m = jobRegex.exec(jobsBlock)) !== null) {
    const jobName = m[1];
    const startIdx = m.index + m[0].length;
    // Find next 2-space-indent job header (or end of file)
    jobRegex.lastIndex = startIdx;
    const nextMatch = jobRegex.exec(jobsBlock);
    const endIdx = nextMatch ? nextMatch.index : jobsBlock.length;
    jobRegex.lastIndex = startIdx; // reset for next outer iteration
    const jobBody = jobsBlock.slice(startIdx, endIdx);
    if (!/timeout-minutes\s*:/.test(jobBody)) {
      // line number ≈ count of \n before the job header in original content
      const beforeHeader = content.slice(0, jobsIdx + m.index);
      const lineNum = beforeHeader.split('\n').length;
      findings.push({
        rule_id: 'missing_timeout',
        file: null,
        line: lineNum,
        job_name: jobName,
        excerpt: `<job ${jobName} has no timeout-minutes>`,
      });
    }
  }
  return findings;
}

function analyzeFile(relPath, content) {
  const findings = [];
  for (const f of findUnpinnedUses(content)) {
    findings.push({ ...f, file: relPath });
  }
  const perms = findMissingTopLevelPermissions(content);
  if (perms) findings.push({ ...perms, file: relPath });
  const conc = findMissingConcurrency(content);
  if (conc) findings.push({ ...conc, file: relPath });
  for (const f of findMissingTimeouts(content)) {
    findings.push({ ...f, file: relPath });
  }
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — analyze + open advisory issue
// ─────────────────────────────────────────────────────────────────────────────

function analyzeAll(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const files = listWorkflowFiles(repoRoot);
  const findings = [];
  const skipped = [];
  for (const rel of files) {
    const full = path.join(repoRoot, rel);
    let content;
    try {
      const st = fs.statSync(full);
      if (st.size > MAX_WORKFLOW_BYTES) {
        skipped.push({ file: rel, reason: `oversize-${st.size}` });
        continue;
      }
      content = fs.readFileSync(full, 'utf8');
    } catch (err) {
      skipped.push({ file: rel, reason: `read: ${err.code || err.message}` });
      continue;
    }
    findings.push(...analyzeFile(rel, content));
  }
  // Sort: high severity first, then by file:line
  const w = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const sa = w[(RULES[a.rule_id] || {}).severity] || 0;
    const sb = w[(RULES[b.rule_id] || {}).severity] || 0;
    if (sa !== sb) return sb - sa;
    const fc = String(a.file || '').localeCompare(String(b.file || ''));
    if (fc !== 0) return fc;
    return (a.line || 0) - (b.line || 0);
  });
  return {
    files_scanned: files.length,
    findings,
    skipped,
  };
}

function formatIssueTitle(date) {
  return `workflow-hardener: ${date} GitHub Actions security audit`;
}

function formatIssueBody({ analysis, slug, date }) {
  // Sprint 2.5b R2 fix (BLOCKER): all operator-derived strings (file paths,
  // action refs, job names from raw YAML) flow through sanitizeForMarkdown.
  // A poisoned PR contributor could otherwise inject backticks, @-mentions,
  // markdown headers, or HTML into the gh issue body that humans read +
  // potentially paste into terminals.
  const lines = [];
  lines.push(`# Workflow hardener — ${safety.sanitizeForMarkdown(String(date))}`);
  lines.push('');
  lines.push(`Project: \`${safety.sanitizeForMarkdown(String(slug))}\` · Run: weekly cron · Mode: advisory-only (v1)`);
  lines.push('');
  lines.push(`Files scanned: **${analysis.files_scanned}** under \`.github/workflows/\``);
  lines.push(`Total findings: **${analysis.findings.length}**`);
  lines.push('');

  if (analysis.findings.length === 0) {
    lines.push('No hardening gaps detected. ✅');
    return lines.join('\n');
  }

  // Group by rule_id for readability
  const byRule = {};
  for (const f of analysis.findings) {
    if (!byRule[f.rule_id]) byRule[f.rule_id] = [];
    byRule[f.rule_id].push(f);
  }

  for (const ruleId of ['unpinned_action', 'missing_permissions', 'missing_concurrency', 'missing_timeout']) {
    const matches = byRule[ruleId] || [];
    if (matches.length === 0) continue;
    const rule = RULES[ruleId];
    lines.push(`## ${ruleId.replace(/_/g, ' ').toUpperCase()} (${matches.length}, ${rule.severity})`);
    lines.push('');
    lines.push(rule.description);
    lines.push('');
    lines.push(`**Fix:** ${rule.fix_hint}`);
    lines.push('');
    lines.push(`### Findings`);
    lines.push('');
    for (const f of matches.slice(0, 25)) {
      // Sanitize each field individually — file/action/job_name come from
      // the raw YAML and could contain markdown injection payloads.
      const safeFile = safety.sanitizeForMarkdown(String(f.file || '?'), { allowBackticks: true });
      const safeAction = f.action ? safety.sanitizeForMarkdown(String(f.action), { allowBackticks: true }) : '';
      const safeRef = f.current_ref ? safety.sanitizeForMarkdown(String(f.current_ref), { allowBackticks: true }) : '';
      const safeJob = f.job_name ? safety.sanitizeForMarkdown(String(f.job_name), { allowBackticks: true }) : '';
      const ref = safeAction ? `\`${safeAction}@${safeRef}\`` : '';
      const job = safeJob ? ` (job: \`${safeJob}\`)` : '';
      lines.push(`- [ ] \`${safeFile}:${f.line}\`${job} ${ref}`);
    }
    if (matches.length > 25) {
      lines.push(`- *(+${matches.length - 25} more — full list in journal)*`);
    }
    lines.push('');
  }

  if (analysis.skipped && analysis.skipped.length > 0) {
    lines.push('## Skipped files');
    lines.push('');
    for (const s of analysis.skipped) {
      lines.push(`- \`${s.file}\`: ${s.reason}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Generated by [cortex-x Steward `workflow_hardener`](https://github.com/Rejnyx/cortex-x). Weekly advisory cadence.');
  lines.push('Auto-apply (Sprint 2.5b.1) is deferred — `.github/workflows/**` is in the engine HARD_DENYLIST. Operator reviews + applies manually.');
  return lines.join('\n');
}

function writeJournal({ analysis, repoRoot, dataHome, slug, date }) {
  const journalDir = path.join(dataHome || path.join(repoRoot, 'cortex'), 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  const outPath = path.join(journalDir, `workflow-hardener-${date}.md`);
  const lines = [];
  lines.push(`# workflow_hardener · ${slug} · ${date}`);
  lines.push('');
  lines.push(`Mode: advisory-only (v1)`);
  lines.push('');
  lines.push(`Files scanned: ${analysis.files_scanned}`);
  lines.push(`Findings: ${analysis.findings.length}`);
  lines.push('');
  lines.push('## Full findings');
  lines.push('');
  for (const f of analysis.findings) {
    const sev = (RULES[f.rule_id] || {}).severity || 'unknown';
    lines.push(`- [${sev}] **${f.rule_id}** \`${f.file}:${f.line}\` ${f.excerpt || ''}`);
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

function openIssue({ title, body, repoRoot, skipGh, dryRunGh }) {
  if (skipGh || dryRunGh) {
    return { url: 'mock://dry-run', dry_run: true };
  }
  const tmpFile = path.join(require('node:os').tmpdir(), `workflow-hardener-${Date.now()}-${process.pid}.md`);
  try {
    fs.writeFileSync(tmpFile, body, { encoding: 'utf8', mode: 0o600 });
    const result = child_process.spawnSync('gh', [
      'issue', 'create',
      '--title', title,
      '--body-file', tmpFile,
      '--label', 'steward-workflow-hardener',
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
    if (result.status === 0) {
      return { url: (result.stdout || '').trim() };
    }
    return { url: null, error: result.stderr || 'unknown' };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// Slug + date guards re-exported via shared safety module. Originally
// duplicated; consolidated by Sprint 2.5b R2 review feedback.
const { SAFE_DATE_REGEX, SAFE_SLUG_REGEX, PATH_TRAVERSAL_REGEX } = safety;

async function runWorkflowHardener(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const slug = opts.slug;
  if (!slug) {
    return {
      ok: false,
      code: 'WORKFLOW_HARDENER_NO_SLUG',
      error: 'slug is required',
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  if (!SAFE_SLUG_REGEX.test(slug) || PATH_TRAVERSAL_REGEX.test(slug)) {
    return {
      ok: false,
      code: 'WORKFLOW_HARDENER_INVALID_SLUG',
      error: `slug failed safety check: ${slug}`,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  const isoDate = opts.isoDate || new Date().toISOString().slice(0, 10); // YYYY-MM-DD (weekly)
  if (!SAFE_DATE_REGEX.test(isoDate)) {
    return {
      ok: false,
      code: 'WORKFLOW_HARDENER_INVALID_DATE',
      error: `isoDate failed safety check: ${isoDate}`,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  const analysis = analyzeAll({ repoRoot });
  if (analysis.files_scanned === 0) {
    return {
      ok: false,
      code: 'WORKFLOW_HARDENER_NO_WORKFLOWS',
      error: 'no .github/workflows/*.yml files found',
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  let journalPath = null;
  let issue = null;
  let phaseCError = null;
  try {
    journalPath = writeJournal({
      analysis,
      repoRoot,
      dataHome: opts.dataHome,
      slug,
      date: isoDate,
    });
  } catch (err) {
    phaseCError = { stage: 'journal', code: err.code || 'JOURNAL_WRITE_FAILED', error: err.message };
  }

  if (analysis.findings.length === 0) {
    // Nothing to surface — quiet success, journal still written for audit
    return {
      ok: true,
      no_findings: true,
      analysis,
      journalPath,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  if (!phaseCError) {
    try {
      const issueTitle = formatIssueTitle(isoDate);
      const issueBody = formatIssueBody({ analysis, slug, date: isoDate });
      issue = openIssue({
        title: issueTitle,
        body: issueBody,
        repoRoot,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
      });
    } catch (err) {
      phaseCError = { stage: 'issue', code: err.code || 'ISSUE_OPEN_FAILED', error: err.message };
    }
  }

  return {
    ok: true,
    analysis,
    journalPath,
    issue,
    phaseCError,
    touchedFiles: [],
    skip_commit: true,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
  };
}

module.exports = {
  runWorkflowHardener,
  RULES,
  analyzeAll,
  analyzeFile,
  findUnpinnedUses,
  findMissingTopLevelPermissions,
  findMissingConcurrency,
  findMissingTimeouts,
  formatIssueTitle,
  formatIssueBody,
  writeJournal,
  openIssue,
};
