// bin/steward/_lib/evolve-weekly-action.cjs — Sprint 2.19 v1
//
// Weekly "Dreaming" mining + LLM validation phase. Per
// prompts/cortex-evolve.md Phase B:
//   1. Mine candidates from journal/*.jsonl (B.1.1 — deterministic)
//   2. Apply evidence gates (B.2 — deterministic, in detector)
//   3. LLM validation per candidate (B.3 — cortex-thinker-style judge)
//   4. Budget cap: max 3 insights per weekly run
//   5. Write proposals to insights/proposals/<date>-evolve-<slug>.md
//
// v1 scope: repeated-mistake candidates only (root_cause × action_kind
// pairs above min_events/projects/span thresholds). PrefixSpan sequence
// mining + cross-project transfer deferred to v1.5+.
//
// LLM cost ceiling: max 3 LLM calls per run × ~$0.001/call via Sonnet =
// ~$0.003/run. Sits at <0.01% of Sprint 1.9.1 $25/week cap.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const detector = require('../../../detectors/evolve-weekly.cjs');

const DEFAULT_JUDGE_MODEL = 'anthropic/claude-sonnet-4.6';
const FALLBACK_JUDGE_MODEL = 'deepseek/deepseek-v4-flash';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const JUDGE_TIMEOUT_MS = 60_000;
const MAX_INSIGHTS_PER_RUN = 3;

const VALIDATOR_SYSTEM_PROMPT = `You are an impartial reviewer assessing whether a mined statistical pattern from a Steward agent's journal represents a genuine actionable insight or just noise.

Process:
1. Read the candidate pattern: root_cause + action_kind + event counts + project diversity + days span + 3 journal citations.
2. Decide: insight or noise? Reasoning prefix before verdict (anti-anchor).
3. If insight, write one-sentence rule + suggest where it transfers (which project archetypes / action_kinds).

Discipline:
- Be conservative. Statistical co-occurrence does NOT prove causation.
- Reject if the pattern is just "the same external service was flaky" (e.g. TIMEOUT during network outages).
- Accept if there's a plausible structural cause (e.g. config schema mismatch, missing input validation).
- Confidence below 0.7 → verdict:noise.

Output STRICT JSON (no markdown):
{
  "reasoning": "<≤500 chars CoT prefix>",
  "verdict": "insight" | "noise",
  "confidence": 0.0-1.0,
  "rule": "<one-sentence rule if insight, else null>",
  "transferable_to": ["<project_archetype>", ...] | []
}`;

function buildValidatorUserMessage(candidate) {
  return [
    '# Candidate pattern',
    '',
    `- root_cause: ${candidate.root_cause}`,
    `- action_kind: ${candidate.action_kind}`,
    `- events: ${candidate.events}`,
    `- projects: ${candidate.projects.join(', ')}`,
    `- first seen: ${candidate.first_seen_iso}`,
    `- last seen: ${candidate.last_seen_iso}`,
    `- days span: ${candidate.days_span}`,
    '',
    '## Journal citations (first 3)',
    ...candidate.journal_refs.map((r) => `- ${r}`),
  ].join('\n');
}

// Sprint 2.19 v1 R2 (security-auditor MED Q4): length caps on every
// validator output field. Defends against (a) bandwidth-bomb 50KB rule
// strings, (b) markdown-link/image injection in unbounded fields, (c)
// transferable_to[] explosion. Combined with frontmatter / control-char
// stripping in writeProposal, mitigates downstream proposal-file
// integrity issues.
const MAX_REASONING_LEN = 1000;
const MAX_RULE_LEN = 500;
const MAX_TRANSFERABLE_TO = 10;
const MAX_TRANSFERABLE_ITEM_LEN = 80;

function validateValidatorOutput(judge) {
  if (!judge || typeof judge !== 'object' || Array.isArray(judge)) {
    return { ok: false, code: 'VALIDATOR_NOT_OBJECT', error: 'must be object' };
  }
  if (typeof judge.reasoning !== 'string' || judge.reasoning.length > MAX_REASONING_LEN) {
    return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: 'reasoning' };
  }
  if (judge.verdict !== 'insight' && judge.verdict !== 'noise') {
    return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: 'verdict' };
  }
  if (typeof judge.confidence !== 'number' || judge.confidence < 0 || judge.confidence > 1) {
    return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: 'confidence' };
  }
  if (judge.rule !== null && (typeof judge.rule !== 'string' || judge.rule.length > MAX_RULE_LEN)) {
    return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: 'rule', error: `must be null or string <= ${MAX_RULE_LEN} chars` };
  }
  if (!Array.isArray(judge.transferable_to) || judge.transferable_to.length > MAX_TRANSFERABLE_TO) {
    return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: 'transferable_to', error: `must be array <= ${MAX_TRANSFERABLE_TO} items` };
  }
  for (let i = 0; i < judge.transferable_to.length; i += 1) {
    const it = judge.transferable_to[i];
    if (typeof it !== 'string' || it.length > MAX_TRANSFERABLE_ITEM_LEN) {
      return { ok: false, code: 'VALIDATOR_FIELD_INVALID', path: `transferable_to[${i}]`, error: `each item must be string <= ${MAX_TRANSFERABLE_ITEM_LEN} chars` };
    }
  }
  return { ok: true };
}

// Sanitize a validator-emitted string before writing into proposal
// markdown. Strips CR / control chars / leading frontmatter markers
// (`---\n` at start of line) and `## ` heading-overrides.
function sanitizeForMarkdown(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // control chars except \t \n
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^---\s*$/gm, '\\---')   // neutralize frontmatter forging
    .replace(/^##\s+/gm, '\\## ');     // neutralize heading-override
}

async function validateCandidate(candidate, opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, code: 'VALIDATOR_KEY_MISSING' };
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const model = opts.model
    || process.env.STEWARD_EVOLVE_VALIDATOR_MODEL
    || DEFAULT_JUDGE_MODEL;

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
        'X-Title': 'cortex-x Steward (evolve-weekly)',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
          { role: 'user', content: buildValidatorUserMessage(candidate) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const safeMsg = (err && err.message ? String(err.message) : 'unknown')
      .replace(/Bearer\s+[A-Za-z0-9_-]+/g, 'Bearer [REDACTED]');
    if (err && err.name === 'AbortError') {
      return { ok: false, code: 'VALIDATOR_TIMEOUT', error: safeMsg };
    }
    return { ok: false, code: 'VALIDATOR_NETWORK_ERROR', error: safeMsg };
  }
  clearTimeout(timer);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { ok: false, code: 'VALIDATOR_HTTP_ERROR', httpStatus: resp.status, error: body.slice(0, 200) };
  }
  const data = await resp.json().catch(() => null);
  if (!data) return { ok: false, code: 'VALIDATOR_RESPONSE_NOT_JSON' };
  const content = data && data.choices && data.choices[0]
    && data.choices[0].message && data.choices[0].message.content;
  if (!content) return { ok: false, code: 'VALIDATOR_EMPTY_RESPONSE' };
  const usage = (data && data.usage) || {};
  const cost_usd = Math.max(0, Number(usage.cost) || 0);
  const stripped = content.replace(/^\s*```(?:json)?\s*\n?/, '').replace(/```\s*$/, '').trim();
  let judge;
  try { judge = JSON.parse(stripped); }
  catch (err) { return { ok: false, code: 'VALIDATOR_PARSE_FAILED', error: err && err.message, cost_usd }; }
  const v = validateValidatorOutput(judge);
  if (!v.ok) return { ...v, cost_usd };
  return { ok: true, judge, cost_usd, model_used: model };
}

function writeProposal({ repoRoot, isoDate, candidate, judge }) {
  const proposalsDir = path.join(repoRoot, 'insights', 'proposals');
  if (!fs.existsSync(proposalsDir)) return null;
  const safeRoot = String(candidate.root_cause).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);
  const fname = `${isoDate}-evolve-${safeRoot}.md`;
  const full = path.join(proposalsDir, fname);
  const body = [
    '---',
    `date: ${isoDate}`,
    'type: repeated-mistake',
    `confidence: ${judge.confidence}`,
    `evidence_count: ${candidate.events}`,
    `projects: [${candidate.projects.join(', ')}]`,
    'source: evolve_weekly (Sprint 2.19 v1)',
    '---',
    '',
    '## Problem statement',
    '',
    `Pattern \`${candidate.root_cause}\` × \`${candidate.action_kind}\` fired ${candidate.events} times across ${candidate.projects.length} projects between ${candidate.first_seen_iso} and ${candidate.last_seen_iso} (${candidate.days_span}-day span).`,
    '',
    '## Validator reasoning',
    '',
    sanitizeForMarkdown(judge.reasoning) || '_(none provided)_',
    '',
    '## Proposed rule',
    '',
    sanitizeForMarkdown(judge.rule) || '_(validator flagged as noise)_',
    '',
    '## Transferable to',
    '',
    judge.transferable_to.length > 0
      ? judge.transferable_to.map((t) => `- ${sanitizeForMarkdown(t)}`).join('\n')
      : '_(none)_',
    '',
    '## Evidence (journal citations)',
    '',
    ...candidate.journal_refs.map((r) => `- \`${r}\``),
    '',
  ].join('\n');
  try {
    fs.writeFileSync(full, body, 'utf8');
    return path.relative(repoRoot, full).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

/**
 * Run weekly evolve / Dreaming Phase B.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {string} [opts.slug]
 * @param {Date}   [opts.now]
 * @param {function} [opts.validateImpl] — for tests
 * @returns {Promise<object>}
 */
async function runEvolveWeekly(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const slug = opts.slug || 'cortex-x';
  const now = opts.now || new Date();
  const isoDate = now.toISOString().slice(0, 10);
  const validateImpl = typeof opts.validateImpl === 'function' ? opts.validateImpl : validateCandidate;

  // Phase B.1 + B.2 — mine candidates + apply evidence gates
  const mined = detector.mineWeeklyCandidates({ repoRoot, now });
  if (!mined.candidates || mined.candidates.length === 0) {
    return {
      ok: true,
      skip_commit: true,
      no_work: true,
      summary: `evolve_weekly: 0 candidates survived evidence gates (${mined.window_files} journal files, ${mined.total_events} events in 14-day window)`,
      candidates_total: 0,
      proposals_written: [],
      cost_usd: 0,
      touchedFiles: [],
    };
  }

  // Phase B.3 — LLM validation per candidate. Budget cap MAX_INSIGHTS_PER_RUN.
  const survivors = mined.candidates.slice(0, MAX_INSIGHTS_PER_RUN);
  let cumulativeCost = 0;
  const proposalsWritten = [];
  const validationErrors = [];

  for (const candidate of survivors) {
    const result = await validateImpl(candidate, {
      apiKey: opts.apiKey,
      model: opts.validatorModel,
      fetchImpl: opts.fetchImpl,
    });
    cumulativeCost += Number(result.cost_usd) || 0;
    if (!result.ok) {
      validationErrors.push({ root_cause: candidate.root_cause, code: result.code, error: result.error });
      continue;
    }
    const judge = result.judge;
    if (judge.verdict !== 'insight' || judge.confidence < 0.7) continue;
    const proposalPath = writeProposal({ repoRoot, isoDate, candidate, judge });
    if (proposalPath) proposalsWritten.push(proposalPath);
  }

  return {
    ok: true,
    skip_commit: true,
    no_work: proposalsWritten.length === 0,
    summary: `evolve_weekly: ${mined.candidates.length} candidates surfaced, ${survivors.length} validated, ${proposalsWritten.length} proposals written (cost $${cumulativeCost.toFixed(4)})`,
    candidates_total: mined.candidates.length,
    candidates_validated: survivors.length,
    proposals_written: proposalsWritten,
    validation_errors: validationErrors,
    cost_usd: cumulativeCost,
    // Sprint 2.19 v1 R2 (security-auditor HIGH Finding 0): expose actually-
    // written proposal paths so the action_kind's evolve_weekly_proposals_
    // under_proposals file_predicate criterion runs against real data
    // instead of vacuously-true []. Activates the spec-verifier invariant
    // that was previously decorative.
    touchedFiles: proposalsWritten,
    usage: { cost_usd: cumulativeCost, tokens_in: 0, tokens_out: 0 },
  };
}

module.exports = {
  runEvolveWeekly,
  validateCandidate,
  validateValidatorOutput,
  buildValidatorUserMessage,
  writeProposal,
  VALIDATOR_SYSTEM_PROMPT,
  DEFAULT_JUDGE_MODEL,
  MAX_INSIGHTS_PER_RUN,
};
