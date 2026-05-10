// secret-sweep-action.cjs — Sprint 2.6b TruffleHog wrapper.
//
// Weekly cron: scans full git history with `trufflehog git file://. --only-verified
// --json --since-commit=<last-sweep-sha>`. On verified hit: opens ONE gh issue
// per finding (severity: high). NO auto-PR — secret revocation requires
// rotation + history rewrite which are destructive and human-only.
//
// Read-only against working tree; only writes are journal entries + gh issue.
// `touchedFiles: []` enforced by acceptance criterion.
//
// Fail-open: if trufflehog binary missing → return TRUFFLEHOG_NOT_FOUND;
// dispatcher treats as `no_actionable_step`. Operator gets one warning line
// per cron run, never halts.
//
// Research grounding (Sprint 2.6b R1):
//   - TruffleHog: github.com/trufflesecurity/trufflehog (Apache-2.0, 800+ secret types)
//   - appsecsanta gitleaks-vs-trufflehog comparison
//   - --only-verified avoids regex false positives that flood the issue tracker

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');
const safety = require('./safety.cjs');

const SWEEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — full history can be slow
const MAX_FINDINGS = 50;
const { SAFE_DATE_REGEX, SAFE_SLUG_REGEX, SAFE_SHA_REGEX, PATH_TRAVERSAL_REGEX } = safety;

// ─────────────────────────────────────────────────────────────────────────────
// Reading prior-sweep SHA from journal (so subsequent sweeps are incremental).
// ─────────────────────────────────────────────────────────────────────────────

function readLastSweptSha({ dataHome, repoRoot, slug }) {
  const journalDir = path.join(dataHome || path.join(repoRoot, 'cortex'), 'journal', slug);
  const stateFile = path.join(journalDir, 'secret-sweep-state.json');
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.last_swept_sha === 'string' && SAFE_SHA_REGEX.test(parsed.last_swept_sha)) {
      return parsed.last_swept_sha;
    }
  } catch { /* first sweep */ }
  return null;
}

function writeLastSweptSha({ dataHome, repoRoot, slug, sha }) {
  const journalDir = path.join(dataHome || path.join(repoRoot, 'cortex'), 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  const stateFile = path.join(journalDir, 'secret-sweep-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ last_swept_sha: sha, updated_at: new Date().toISOString() }, null, 2), 'utf8');
}

function getCurrentSha(repoRoot) {
  const r = child_process.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return null;
  const sha = (r.stdout || '').trim();
  if (!SAFE_SHA_REGEX.test(sha)) return null;
  return sha;
}

// ─────────────────────────────────────────────────────────────────────────────
// TruffleHog invocation
// ─────────────────────────────────────────────────────────────────────────────

function runTruffleHog({ repoRoot, sinceCommit }) {
  // Sprint 2.6b R2 fix (HIGH): defensive URL construction. file:// URIs with
  // `?` `#` `%` `\n` in the path can confuse the receiver. We absolute-resolve
  // the path first, reject if it contains URL-meta characters, and use
  // `path.resolve` (canonical) to avoid relative-path surprises.
  const abs = path.resolve(repoRoot);
  if (/[\r\n?#]/.test(abs)) {
    return { ok: false, code: 'TRUFFLEHOG_UNSAFE_PATH', error: `repoRoot contains URL-meta chars: ${abs}` };
  }
  // Encode percent literals to avoid URL-decode surprises in the receiver.
  const fileUri = `file://${abs.replace(/\\/g, '/').replace(/%/g, '%25')}`;
  const args = [
    'git',
    fileUri,
    '--only-verified',
    '--json',
    '--no-update',
  ];
  if (sinceCommit && SAFE_SHA_REGEX.test(sinceCommit)) {
    args.push(`--since-commit=${sinceCommit}`);
  }
  const r = child_process.spawnSync('trufflehog', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: SWEEP_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024, // 32 MiB output cap
  });
  if (r.error) {
    return { ok: false, code: 'TRUFFLEHOG_SPAWN_ERROR', error: String(r.error) };
  }
  if (r.signal) {
    return { ok: false, code: 'TRUFFLEHOG_KILLED', signal: r.signal };
  }
  // TruffleHog exits 0 even when findings are present; non-zero = real error.
  if (r.status !== 0 && r.status !== 183 /* findings exit-code in some versions */) {
    return { ok: false, code: 'TRUFFLEHOG_FAILED', status: r.status, error: (r.stderr || '').slice(0, 500) };
  }
  // Parse one JSON object per line (NDJSON).
  const findings = [];
  for (const line of (r.stdout || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      findings.push(obj);
    } catch {
      // skip malformed lines
    }
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { ok: true, findings, raw_lines: (r.stdout || '').split('\n').length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatIssueTitle(date) {
  return `secret-history-sweep: ${date} verified-credential alert`;
}

function formatIssueBody({ findings, slug, date, sinceCommit, currentSha }) {
  const lines = [];
  lines.push(`# Secret history sweep — ${date}`);
  lines.push('');
  lines.push(`Project: \`${slug}\` · Mode: weekly cron · Tool: TruffleHog \`--only-verified\``);
  lines.push(`Range: ${sinceCommit ? `\`${sinceCommit.slice(0, 12)}\` … \`${currentSha.slice(0, 12)}\`` : `full history → \`${currentSha.slice(0, 12)}\``}`);
  lines.push('');
  lines.push(`**${findings.length}** verified credential${findings.length === 1 ? '' : 's'} detected.`);
  lines.push('');
  lines.push('## Required action (operator)');
  lines.push('');
  lines.push('1. **ROTATE** every credential listed below — assume compromised.');
  lines.push('2. After rotation, decide whether to rewrite git history (BFG / git-filter-repo) or accept the leak as residual risk for this repo.');
  lines.push('3. Steward will NOT auto-rewrite history — too destructive.');
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  for (const f of findings) {
    const detector = f.DetectorName || f.detector_name || 'unknown';
    const verified = f.Verified === true || f.verified === true ? '✓ verified' : '?';
    const sha = (f.SourceMetadata && f.SourceMetadata.Data && f.SourceMetadata.Data.Git && f.SourceMetadata.Data.Git.commit) || '?';
    const file = (f.SourceMetadata && f.SourceMetadata.Data && f.SourceMetadata.Data.Git && f.SourceMetadata.Data.Git.file) || '?';
    const line = (f.SourceMetadata && f.SourceMetadata.Data && f.SourceMetadata.Data.Git && f.SourceMetadata.Data.Git.line) || '?';
    lines.push(`- [ ] **${detector}** (${verified}) · commit \`${String(sha).slice(0, 12)}\` · \`${file}:${line}\``);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Generated by [cortex-x Steward `secret_history_sweep`](https://github.com/Rejnyx/cortex-x). Weekly cron.');
  lines.push('Tool: [TruffleHog](https://github.com/trufflesecurity/trufflehog) (Apache-2.0).');
  return lines.join('\n');
}

function writeJournal({ findings, repoRoot, dataHome, slug, date, sinceCommit, currentSha }) {
  const journalDir = path.join(dataHome || path.join(repoRoot, 'cortex'), 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  const outPath = path.join(journalDir, `secret-sweep-${date}.md`);
  const lines = [];
  lines.push(`# secret_history_sweep · ${slug} · ${date}`);
  lines.push('');
  lines.push(`Range: ${sinceCommit || '<full history>'} → ${currentSha}`);
  lines.push(`Findings: ${findings.length}`);
  lines.push('');
  for (const f of findings) {
    const detector = f.DetectorName || f.detector_name || 'unknown';
    const verified = f.Verified === true || f.verified === true ? 'verified' : 'unverified';
    lines.push(`- [${verified}] **${detector}** ${JSON.stringify(f).slice(0, 300)}`);
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

function openIssue({ title, body, repoRoot, skipGh, dryRunGh }) {
  if (skipGh || dryRunGh) {
    return { url: 'mock://dry-run', dry_run: true };
  }
  const tmpFile = path.join(require('node:os').tmpdir(), `secret-sweep-${Date.now()}-${process.pid}.md`);
  try {
    fs.writeFileSync(tmpFile, body, { encoding: 'utf8', mode: 0o600 });
    const result = child_process.spawnSync('gh', [
      'issue', 'create',
      '--title', title,
      '--body-file', tmpFile,
      '--label', 'steward-secret-sweep,security,high',
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
    if (result.status === 0) {
      return { url: (result.stdout || '').trim() };
    }
    return { url: null, error: result.stderr || 'unknown' };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────────────────

async function runSecretHistorySweep(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const slug = opts.slug;
  if (!slug) {
    return { ok: false, code: 'SECRET_SWEEP_NO_SLUG', error: 'slug is required', touchedFiles: [], skip_commit: true, usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } };
  }
  if (!SAFE_SLUG_REGEX.test(slug) || PATH_TRAVERSAL_REGEX.test(slug)) {
    return { ok: false, code: 'SECRET_SWEEP_INVALID_SLUG', error: `slug failed safety check: ${slug}`, touchedFiles: [], skip_commit: true, usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } };
  }
  const isoDate = opts.isoDate || new Date().toISOString().slice(0, 10);
  if (!SAFE_DATE_REGEX.test(isoDate)) {
    return { ok: false, code: 'SECRET_SWEEP_INVALID_DATE', error: `isoDate failed safety check: ${isoDate}`, touchedFiles: [], skip_commit: true, usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } };
  }
  const currentSha = getCurrentSha(repoRoot);
  if (!currentSha) {
    return { ok: false, code: 'SECRET_SWEEP_NO_HEAD', error: 'could not resolve git HEAD', touchedFiles: [], skip_commit: true, usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } };
  }
  const sinceCommit = readLastSweptSha({ dataHome: opts.dataHome, repoRoot, slug });
  const result = runTruffleHog({ repoRoot, sinceCommit });
  if (!result.ok) {
    return { ...result, touchedFiles: [], skip_commit: true, usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 } };
  }
  // Update last-swept-sha regardless of findings (sweep window advanced)
  let stateError = null;
  try {
    writeLastSweptSha({ dataHome: opts.dataHome, repoRoot, slug, sha: currentSha });
  } catch (err) {
    stateError = { stage: 'state', error: err.message };
  }

  // Write journal regardless of findings (audit trail)
  let journalPath = null;
  let phaseCError = null;
  try {
    journalPath = writeJournal({
      findings: result.findings,
      repoRoot,
      dataHome: opts.dataHome,
      slug,
      date: isoDate,
      sinceCommit,
      currentSha,
    });
  } catch (err) {
    phaseCError = { stage: 'journal', error: err.message };
  }

  if (result.findings.length === 0) {
    return {
      ok: true,
      no_findings: true,
      findings_count: 0,
      sinceCommit,
      currentSha,
      journalPath,
      stateError,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  let issue = null;
  if (!phaseCError) {
    try {
      const issueTitle = formatIssueTitle(isoDate);
      const issueBody = formatIssueBody({
        findings: result.findings,
        slug,
        date: isoDate,
        sinceCommit,
        currentSha,
      });
      issue = openIssue({
        title: issueTitle,
        body: issueBody,
        repoRoot,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
      });
    } catch (err) {
      phaseCError = { stage: 'issue', error: err.message };
    }
  }

  return {
    ok: true,
    findings_count: result.findings.length,
    findings: result.findings,
    sinceCommit,
    currentSha,
    journalPath,
    issue,
    phaseCError,
    stateError,
    touchedFiles: [],
    skip_commit: true,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
  };
}

module.exports = {
  runSecretHistorySweep,
  // Helpers exported for tests
  readLastSweptSha,
  writeLastSweptSha,
  getCurrentSha,
  runTruffleHog,
  formatIssueTitle,
  formatIssueBody,
  writeJournal,
  openIssue,
};
