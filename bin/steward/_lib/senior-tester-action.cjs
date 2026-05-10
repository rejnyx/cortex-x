// senior-tester-action.cjs — Sprint 2.11 senior_tester_review Phase B + C.
//
// Runs after Phase A detector (test-smell-detector.cjs). Two phases:
//
//   Phase B (LLM judge, OPT-IN): when STEWARD_SENIOR_TESTER_JUDGE=1, sends
//   the Phase A findings + 3-5 representative test files to the LLM with
//   a JSON-mode prompt asking for: summary, top_3_strategic_gaps,
//   ranked_findings (with rationale + fix_strategy), layer_balance_assessment,
//   estimated_effort_hours. Default (env unset) = deterministic-only,
//   $0/run. The judge enriches but never replaces the detector findings.
//
//   Phase C (deliver, ALWAYS): assembles journal entry + gh issue body
//   from Phase A (+ optional Phase B). Writes journal/senior-tester-YYYY-MM.md;
//   opens ONE gh issue with checklist (one per run, never N issues per
//   finding). Returns skip_commit:true so the executor bypasses the
//   commit/push/PR pipeline (audit only — never edits source/test files).
//
// Cost ceiling (R4): default $0/run; with judge env enabled,
// ~$0.005/run via deepseek-v4-flash on the 20-finding payload.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const child_process = require('node:child_process');

const registry = require('./test-smell-registry.cjs');
// Sprint 2.11.1 SSOT M2 fix: redactSecrets moved to safety.cjs.
// SSOT M1 fix: OPENROUTER_ENDPOINT imported from action-engine (single
// network constant; no longer copy-pasted across action_kinds).
const { redactSecrets } = require('./safety.cjs');
const { OPENROUTER_ENDPOINT } = require('./action-engine.cjs');
// Sprint 2.11.2 Correctness H2 fix: deep-type validation for the LLM judge
// envelope. Prior validation was presence-only — a judge returning
// `summary: 42` or `ranked_findings: "not an array"` would have passed.
const { validateJudge } = require('./llm-judge-schema.cjs');

const JUDGE_TIMEOUT_MS = 90 * 1000; // 90s — bounded by openrouter-engine clamp anyway
const JUDGE_MAX_FILES = 5;
const JUDGE_FILE_BYTES_CAP = 16 * 1024; // 16 KiB per file in prompt
const JUDGE_FINDINGS_CAP = 20;
// DEFAULT_JUDGE_MODEL stays local: senior-tester has its own
// STEWARD_SENIOR_TESTER_MODEL env override and may legitimately diverge
// from action-engine's DEFAULT_MODEL (edit model vs judge model are
// semantically distinct categories per Sprint 2.0b routing-table).
const DEFAULT_JUDGE_MODEL = 'deepseek/deepseek-v4-flash';

// ─────────────────────────────────────────────────────────────────────────────
// Phase B — LLM judge (optional)
// ─────────────────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are a senior QA engineer reviewing JS/TS test suites. Your output is read by a developer who already has the deterministic findings — your job is to add strategic synthesis, not to repeat the deterministic list.

You MUST output valid JSON matching this schema:
{
  "summary": "<1-paragraph executive summary, plain prose>",
  "top_3_strategic_gaps": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "ranked_findings": [
    {
      "smell_id": "<one of the registry ids>",
      "file": "<rel path>",
      "line": <int>,
      "severity": "high" | "medium" | "low",
      "rationale": "<why this matters in this codebase, 1-2 sentences>",
      "fix_strategy": "<concrete repair hint, 1 line>"
    }
  ],
  "layer_balance_assessment": "<1-paragraph commentary on the test pyramid balance>",
  "estimated_effort_hours": <int>
}

Rules:
- Only cite smell_id values from the registry the user provides.
- Output JSON only. No markdown fences. No prose outside the JSON.
- "ranked_findings" should be 5-15 entries selected from the findings the user gives you, re-ranked + de-duplicated.
- "estimated_effort_hours" is a rough integer for fixing top findings.
- Honesty over flattery — if the suite is largely fine, say so.`;

function buildJudgeUserMessage({ phaseA, sampleFiles, projectProfile, registryDigest }) {
  const findingsForLlm = (phaseA.findings || []).slice(0, JUDGE_FINDINGS_CAP);
  return [
    `Project profile: ${projectProfile || 'unspecified'}`,
    '',
    `# Test smell registry (cite these IDs):`,
    registryDigest,
    '',
    `# Phase A deterministic findings (top ${findingsForLlm.length} of ${phaseA.total_findings || 0}):`,
    JSON.stringify(findingsForLlm, null, 2),
    '',
    `# Layer balance:`,
    JSON.stringify(phaseA.layer_balance, null, 2),
    '',
    `# Sample test files (${sampleFiles.length}, redacted, capped at ${JUDGE_FILE_BYTES_CAP} bytes each):`,
    sampleFiles.map((f) => `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n'),
    '',
    'Return the strict JSON per the schema in the system prompt.',
  ].join('\n');
}

function buildRegistryDigest() {
  // Compact one-line-per-smell digest the LLM can scan inline.
  return registry.ALL_SMELLS.map((s) =>
    `- ${s.id} (${s.category}, ${s.severity}): ${s.description.slice(0, 100)}`,
  ).join('\n');
}

function selectSampleFiles(phaseA, repoRoot) {
  // Pick the test files with the most findings, up to JUDGE_MAX_FILES.
  const byFile = {};
  for (const f of phaseA.findings || []) {
    byFile[f.file] = (byFile[f.file] || 0) + 1;
  }
  const ranked = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, JUDGE_MAX_FILES)
    .map(([file]) => file);
  const samples = [];
  for (const rel of ranked) {
    try {
      const full = path.join(repoRoot, rel);
      const buf = fs.readFileSync(full, 'utf8');
      const truncated = buf.length > JUDGE_FILE_BYTES_CAP
        ? buf.slice(0, JUDGE_FILE_BYTES_CAP) + '\n// [truncated]'
        : buf;
      samples.push({ path: rel, content: redactSecrets(truncated) });
    } catch {
      // file might have been deleted between Phase A and Phase B; skip
    }
  }
  return samples;
}

// Sprint 2.11.1 SSOT M2 fix: redactSecrets + SECRET_PATTERNS extracted to
// safety.cjs (imported above). Coverage expanded vs the previous local
// catalog: added Anthropic OAuth shape (`sk-ant-oat##-…`) with distinct
// `[REDACTED-OAUTH-TOKEN]` replacement, broadened Bearer character class
// to include base64 chars (`+/=`), unified replacement format to
// `[REDACTED-…]` (square brackets, sanitizeForMarkdown-safe).

async function runLlmJudge(phaseA, opts) {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return { ok: false, code: 'JUDGE_NO_API_KEY', error: 'OPENROUTER_API_KEY required for senior-tester LLM judge; set STEWARD_SENIOR_TESTER_JUDGE=0 to skip' };
  }
  if (/[\s\x00-\x1f\x7f]/.test(apiKey)) {
    return { ok: false, code: 'JUDGE_KEY_MALFORMED', error: 'OPENROUTER_API_KEY contains whitespace/control chars' };
  }
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'JUDGE_NO_FETCH', error: 'fetch() not available; Node ≥18 required' };
  }
  const sampleFiles = selectSampleFiles(phaseA, opts.repoRoot);
  const userMessage = buildJudgeUserMessage({
    phaseA,
    sampleFiles,
    projectProfile: opts.projectProfile,
    registryDigest: buildRegistryDigest(),
  });
  const model = opts.model || process.env.STEWARD_SENIOR_TESTER_MODEL || DEFAULT_JUDGE_MODEL;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Rejnyx/cortex-x',
        'X-Title': 'cortex-x Steward (senior_tester_review)',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { ok: false, code: 'JUDGE_TIMEOUT', error: `judge call timed out after ${JUDGE_TIMEOUT_MS}ms` };
    }
    return { ok: false, code: 'JUDGE_NETWORK_ERROR', error: err.message };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let body = '';
    try { body = await resp.text(); } catch { /* ignore */ }
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: 'JUDGE_AUTH_REJECTED', error: `OpenRouter rejected credentials (HTTP ${resp.status}): ${body.slice(0, 300)}` };
    }
    return { ok: false, code: 'JUDGE_HTTP_ERROR', error: `HTTP ${resp.status}: ${body.slice(0, 300)}`, httpStatus: resp.status };
  }

  let data;
  try {
    data = await resp.json();
  } catch (err) {
    return { ok: false, code: 'JUDGE_RESPONSE_NOT_JSON', error: err.message };
  }

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    return { ok: false, code: 'JUDGE_EMPTY_RESPONSE', error: 'no choices[0].message.content' };
  }
  const usage = (data && data.usage) || {};
  const tokens_in = Number(usage.prompt_tokens) || 0;
  const tokens_out = Number(usage.completion_tokens) || 0;
  const cost_usd = Number(usage.cost) || 0;

  // Strip JSON fences (some providers emit ```json ... ``` even with response_format=json_object)
  const stripped = content.replace(/^\s*```(?:json)?\s*\n?/, '').replace(/```\s*$/, '').trim();

  let judge;
  try {
    judge = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, code: 'JUDGE_PARSE_FAILED', error: err.message, content: content.slice(0, 500) };
  }

  // Sprint 2.11.2 Correctness H2: deep-type validation. Prior validation
  // was presence-only key check; now we type-check every field including
  // ranked_findings[] entries (with smell_id ∈ registry, severity ∈ enum,
  // line ≥ 0, rationale/fix_strategy length bounds). First-failure return
  // gives operator a clear "first wrong field" rather than a list dump.
  const validation = validateJudge(judge);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      path: validation.path,
      error: validation.error,
      partial: judge,
      tokens_in,
      tokens_out,
      cost_usd,
    };
  }

  return {
    ok: true,
    judge,
    tokens_in,
    tokens_out,
    cost_usd,
    model,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — deliver (always)
// ─────────────────────────────────────────────────────────────────────────────

// Sprint 2.11 R2 (security-auditor HIGH-3): date-format guard. `isoDate` flows
// from plan files which can be operator-supplied via `--plan-file=<path>`. A
// crafted plan with `isoDate: "../../etc/cron.d/evil"` would otherwise produce
// a path-traversal write outside journalDir.
const SAFE_DATE_REGEX = /^\d{4}-\d{2}(-\d{2})?$/;
const SAFE_SLUG_REGEX = /^[A-Za-z0-9._\-]{1,64}$/;
function assertSafeDate(date) {
  if (typeof date !== 'string' || !SAFE_DATE_REGEX.test(date)) {
    const e = new Error('SENIOR_TESTER_INVALID_DATE');
    e.code = 'SENIOR_TESTER_INVALID_DATE';
    e.invalidDate = date;
    throw e;
  }
}
function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || !SAFE_SLUG_REGEX.test(slug)) {
    const e = new Error('SENIOR_TESTER_INVALID_SLUG');
    e.code = 'SENIOR_TESTER_INVALID_SLUG';
    e.invalidSlug = slug;
    throw e;
  }
}

// Sprint 2.11 R2 (security-auditor HIGH-1): GitHub issue body is a high-trust
// surface read by humans. LLM `summary` / `top_3_strategic_gaps` etc. can be
// coerced via prompt injection in poisoned test files; smell `excerpt` /
// `test_title` come from operator's own source but defense-in-depth applies.
// Sanitize: hard-cap length, neutralize HTML angle brackets, escape `@` to
// prevent unintended notifications, collapse backticks in non-excerpt fields.
const ISSUE_FIELD_MAX_BYTES = 2000;
function sanitizeForIssueBody(s, opts = {}) {
  if (s == null) return '';
  let out = String(s);
  if (out.length > ISSUE_FIELD_MAX_BYTES) {
    out = out.slice(0, ISSUE_FIELD_MAX_BYTES) + ' …[truncated]';
  }
  // Neutralize HTML
  out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Escape @-mentions (zero-width-space prefix prevents trigger; readers see plain @)
  out = out.replace(/@([A-Za-z0-9][\w-]{0,38})/g, '@​$1');
  // For non-excerpt fields, collapse backticks (excerpts need them for code rendering)
  if (!opts.allowBackticks) {
    out = out.replace(/`/g, '‘'); // left single quote — visually similar
  }
  return out;
}

function formatIssueTitle(date) {
  // Sprint 2.11 R2 (security HIGH-3): date is path-validated upstream by
  // assertSafeDate, but sanitize again for defense-in-depth in case this
  // helper is called directly.
  const safe = sanitizeForIssueBody(String(date || ''));
  return `senior-tester-review: ${safe} test-quality audit`;
}

function formatIssueBody({ phaseA, judgeResult, slug, date }) {
  // Sprint 2.11 R2 (security HIGH-1): sanitize ALL LLM-derived content +
  // operator-derived strings (excerpt, test_title) that flow into a
  // markdown body that humans paste into terminals or trust as cortex-x
  // output. Without this, LLM output (potentially coerced via prompt
  // injection in poisoned test fixture) could emit @org-admin mentions,
  // markdown commands suggesting `gh pr merge`, fenced bash blocks, etc.
  const lines = [];
  lines.push(`# Senior tester review — ${sanitizeForIssueBody(date)}`);
  lines.push('');
  lines.push(`Project: \`${sanitizeForIssueBody(slug)}\` · Run: monthly cron · Mode: ${judgeResult ? 'deterministic + LLM judge' : 'deterministic-only'}`);
  lines.push('');
  if (judgeResult && judgeResult.judge) {
    const j = judgeResult.judge;
    lines.push('## Summary (LLM judge)');
    lines.push('');
    lines.push(sanitizeForIssueBody(j.summary || '*(empty)*'));
    lines.push('');
    lines.push('## Top strategic gaps');
    lines.push('');
    const gaps = Array.isArray(j.top_3_strategic_gaps) ? j.top_3_strategic_gaps : [];
    for (const gap of gaps.slice(0, 5)) {
      lines.push(`- ${sanitizeForIssueBody(String(gap))}`);
    }
    lines.push('');
    lines.push(`## Layer balance assessment`);
    lines.push('');
    lines.push(sanitizeForIssueBody(j.layer_balance_assessment || '*(empty)*'));
    lines.push('');
    if (typeof j.estimated_effort_hours === 'number') {
      lines.push(`**Estimated effort:** ~${j.estimated_effort_hours}h to address top findings`);
      lines.push('');
    }
  }
  lines.push('## Layer balance (deterministic)');
  lines.push('');
  const lb = phaseA.layer_balance;
  lines.push(`- Files: **${lb.total}** total — unit ${lb.counts.unit} · integration ${lb.counts.integration} · e2e ${lb.counts.e2e}`);
  lines.push(`- Ratio: **${lb.ratio.unit}/${lb.ratio.integration}/${lb.ratio.e2e}** (target ${lb.target.unit}/${lb.target.integration}/${lb.target.e2e})`);
  lines.push(`- Skew: ${lb.skew}`);
  lines.push('');
  lines.push(`## Findings (${phaseA.total_findings}${phaseA.truncated ? '+ truncated at cap' : ''})`);
  lines.push('');
  // Group by severity
  const bySev = { high: [], medium: [], low: [] };
  for (const f of phaseA.findings || []) {
    if (bySev[f.severity]) bySev[f.severity].push(f);
  }
  for (const sev of ['high', 'medium', 'low']) {
    if (bySev[sev].length === 0) continue;
    lines.push(`### ${sev.toUpperCase()} (${bySev[sev].length})`);
    lines.push('');
    // Cap rendering at 25 per severity to keep issue body under GitHub's
    // 65k char limit even on huge corpora.
    const toRender = bySev[sev].slice(0, 25);
    for (const f of toRender) {
      // Validate smell_id against registry — defense against LLM emitting
      // hallucinated smell ids (or operator-supplied poisoned phaseA shape).
      const smell = registry.getSmellById(f.smell_id);
      const safeId = smell ? f.smell_id : `<unknown:${sanitizeForIssueBody(String(f.smell_id || '?'))}>`;
      const repair = smell ? sanitizeForIssueBody(smell.repair_hint) : '';
      const safeFile = sanitizeForIssueBody(String(f.file || '?'), { allowBackticks: true });
      lines.push(`- [ ] **${safeId}** at \`${safeFile}:${f.line}\``);
      if (f.test_title) lines.push(`  - Test: *${sanitizeForIssueBody(String(f.test_title))}*`);
      if (f.excerpt) {
        // Excerpt rendered in inline code-span: replace backticks with single
        // quotes so the span doesn't break out (defense-in-depth even though
        // excerpts come from operator's own source files).
        const safeExcerpt = String(f.excerpt).slice(0, 120).replace(/`/g, "'");
        lines.push(`  - Excerpt: \`${safeExcerpt}\``);
      }
      if (repair) lines.push(`  - Fix: ${repair}`);
    }
    if (bySev[sev].length > 25) {
      lines.push(`- *(+${bySev[sev].length - 25} more truncated; full list in journal/senior-tester-${date}.md)*`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('Generated by [cortex-x Steward `senior_tester_review`](https://github.com/Rejnyx/cortex-x). Monthly cadence.');
  lines.push('Smell taxonomy: tsDetect (FSE\'20) + ESE 2025 13-new-smell extension.');
  lines.push('Auto-refactor is intentionally NOT shipped in v1 — v1.5 will add gated repair PRs once mutation-score baseline (Sprint 2.3b) lands.');
  return lines.join('\n');
}

function writeJournal({ phaseA, judgeResult, repoRoot, dataHome, slug, date }) {
  const journalDir = path.join(dataHome || path.join(repoRoot, 'cortex'), 'journal', slug);
  fs.mkdirSync(journalDir, { recursive: true });
  const outPath = path.join(journalDir, `senior-tester-${date}.md`);
  const lines = [];
  lines.push(`# senior_tester_review · ${slug} · ${date}`);
  lines.push('');
  lines.push(`Mode: ${judgeResult ? 'deterministic + LLM judge' : 'deterministic-only'}`);
  if (judgeResult && judgeResult.judge) {
    lines.push(`LLM cost: $${(judgeResult.cost_usd || 0).toFixed(4)} (${judgeResult.tokens_in || 0} in / ${judgeResult.tokens_out || 0} out)`);
  } else {
    lines.push('LLM cost: $0 (deterministic-only)');
  }
  lines.push('');
  lines.push('## Phase A — deterministic detector');
  lines.push('');
  lines.push(`- Files scanned: ${phaseA.files_scanned}`);
  lines.push(`- Total findings: ${phaseA.total_findings}${phaseA.truncated ? ' (truncated at cap)' : ''}`);
  lines.push(`- Layer balance: ${JSON.stringify(phaseA.layer_balance.ratio)} (target ${JSON.stringify(phaseA.layer_balance.target)})`);
  lines.push(`- Skew: ${phaseA.layer_balance.skew}`);
  lines.push('');
  if (phaseA.skipped && phaseA.skipped.length > 0) {
    lines.push(`### Skipped files (${phaseA.skipped.length})`);
    for (const s of phaseA.skipped.slice(0, 50)) {
      lines.push(`- \`${s.file}\`: ${s.reason}`);
    }
    lines.push('');
  }
  lines.push('### Findings (full list)');
  lines.push('');
  for (const f of phaseA.findings || []) {
    lines.push(`- [${f.severity}] **${f.smell_id}** \`${f.file}:${f.line}\` — ${f.excerpt || ''}`);
  }
  lines.push('');
  if (judgeResult && judgeResult.judge) {
    lines.push('## Phase B — LLM judge synthesis');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(judgeResult.judge, null, 2));
    lines.push('```');
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  return outPath;
}

function openIssue({ title, body, repoRoot, skipGh, dryRunGh }) {
  if (skipGh || dryRunGh) {
    return { url: 'mock://dry-run', dry_run: true };
  }
  const tmpFile = path.join(require('node:os').tmpdir(), `senior-tester-${Date.now()}-${process.pid}.md`);
  fs.writeFileSync(tmpFile, body, 'utf8');
  const result = child_process.spawnSync('gh', [
    'issue', 'create',
    '--title', title,
    '--body-file', tmpFile,
    '--label', 'steward-senior-tester',
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
  try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  if (result.status === 0) {
    return { url: (result.stdout || '').trim() };
  }
  return { url: null, error: result.stderr || 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entrypoint — composed by execute.cjs runSeniorTesterReviewAction
// ─────────────────────────────────────────────────────────────────────────────

async function runSeniorTesterReview(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const slug = opts.slug;
  // Sprint 2.11 R2 (edge-case BLOCKER-2 + security HIGH-3): guard slug + date
  // before any path interpolation. Plan files can be operator-supplied via
  // `--plan-file=<path>`; a crafted plan with `isoDate: "../../etc"` would
  // otherwise produce a path-traversal write outside journalDir.
  if (!slug) {
    return {
      ok: false,
      code: 'SENIOR_TESTER_NO_SLUG',
      error: 'slug is required for senior_tester_review',
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  try { assertSafeSlug(slug); } catch (err) {
    return {
      ok: false,
      code: err.code || 'SENIOR_TESTER_INVALID_SLUG',
      error: `slug failed safety check: ${slug}`,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  const isoDate = opts.isoDate || new Date().toISOString().slice(0, 7); // YYYY-MM
  try { assertSafeDate(isoDate); } catch (err) {
    return {
      ok: false,
      code: err.code || 'SENIOR_TESTER_INVALID_DATE',
      error: `isoDate failed safety check: ${isoDate}`,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  // Sprint 2.11 R2 (edge-case BLOCKER-3): truthy parse for env so operators
  // setting "true" / "yes" / "on" don't get silent disable.
  const envFlag = (process.env.STEWARD_SENIOR_TESTER_JUDGE || '').trim().toLowerCase();
  const judgeEnabled = opts.judgeEnabled === true
    || envFlag === '1' || envFlag === 'true' || envFlag === 'yes' || envFlag === 'on';

  // Phase A — detect (always)
  const detector = require('./test-smell-detector.cjs');
  const phaseA = detector.detectAll({ repoRoot, layerTarget: opts.layerTarget });

  // Phase A early-skip: zero test files OR zero findings (suite is clean)
  if (phaseA.test_files.length === 0) {
    return {
      ok: false,
      code: 'SENIOR_TESTER_NO_TEST_FILES',
      error: 'no test files found under tests/, test/, __tests__/, spec/, specs/',
      phaseA,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  if (phaseA.total_findings === 0) {
    // Still write a journal entry — useful audit trail of "ran clean"
    const journalPath = writeJournal({ phaseA, judgeResult: null, repoRoot, dataHome: opts.dataHome, slug, date: isoDate });
    return {
      ok: true,
      no_findings: true,
      phaseA,
      journalPath,
      touchedFiles: [],
      skip_commit: true,
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  // Phase B — LLM judge (opt-in)
  let judgeResult = null;
  if (judgeEnabled) {
    const judge = await runLlmJudge(phaseA, {
      repoRoot,
      projectProfile: opts.projectProfile,
      model: opts.model,
      fetch: opts.fetch,
    });
    if (judge.ok) {
      judgeResult = judge;
    } else {
      // Soft-fail: log the judge error but proceed with deterministic-only delivery
      judgeResult = { ok: false, code: judge.code, error: judge.error };
    }
  }

  // Phase C — deliver. Sprint 2.11 R2 (edge-case HIGH-8): wrap in try/catch
  // so Phase A findings + Phase B judge cost aren't lost if dataHome is
  // read-only or gh command fails. Return partial-success result.
  let journalPath = null;
  let issue = null;
  let phaseCError = null;
  try {
    journalPath = writeJournal({
      phaseA,
      judgeResult: judgeResult && judgeResult.ok ? judgeResult : null,
      repoRoot,
      dataHome: opts.dataHome,
      slug,
      date: isoDate,
    });
  } catch (err) {
    phaseCError = { stage: 'journal', code: err.code || 'JOURNAL_WRITE_FAILED', error: err.message };
  }

  if (!phaseCError) {
    try {
      const issueTitle = formatIssueTitle(isoDate);
      const issueBody = formatIssueBody({
        phaseA,
        judgeResult: judgeResult && judgeResult.ok ? judgeResult : null,
        slug,
        date: isoDate,
      });
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
    phaseA,
    judgeResult,
    journalPath,
    issue,
    phaseCError, // null on full success
    touchedFiles: [], // no source/test edits — review only
    skip_commit: true,
    usage: {
      cost_usd: (judgeResult && judgeResult.cost_usd) || 0,
      tokens_in: (judgeResult && judgeResult.tokens_in) || 0,
      tokens_out: (judgeResult && judgeResult.tokens_out) || 0,
    },
  };
}

module.exports = {
  runSeniorTesterReview,
  // Helpers exported for tests
  buildJudgeUserMessage,
  buildRegistryDigest,
  selectSampleFiles,
  redactSecrets,
  formatIssueTitle,
  formatIssueBody,
  writeJournal,
  openIssue,
  runLlmJudge,
  JUDGE_SYSTEM_PROMPT,
};
