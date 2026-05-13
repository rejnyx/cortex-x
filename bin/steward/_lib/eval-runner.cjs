// bin/steward/_lib/eval-runner.cjs — Sprint 3.0 v0
//
// Reads eval task definitions from evals/eval-*.md and runs each task
// N times against a pluggable executor. Captures trial rows with
// task_id + score + spec_pass + duration + cost.
//
// The executor is pluggable so v0 ships with a deterministic `mockExecutor`
// for tests / harness verification, and operators wire a real LLM
// executor later via injection.
//
// File format expectation (existing evals/eval-*.md):
//   ---
//   id: eval-001
//   name: ...
//   category: ...
//   version: 1.0
//   validation: true   # Sprint 3.0 v0 — held-out set marker (default false)
//   ---
//   # ...
//   ## Input
//   ...
//   ## Expected properties
//   - [ ] property A
//   - [ ] property B
//   ...

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const scorer = require('./eval-scorer.cjs');

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---\n', 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const fmRaw = content.slice(4, end);
  const body = content.slice(end + 5);
  const fm = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^\d+(\.\d+)?$/.test(v)) v = Number(v);
    fm[m[1]] = v;
  }
  return { frontmatter: fm, body };
}

/**
 * Discover eval tasks under evalsDir. Returns array of { id, file,
 * frontmatter, body }. Skips README and other non-eval files.
 */
function discoverTasks(evalsDir) {
  if (!fs.existsSync(evalsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(evalsDir)) {
    if (!/^eval-\d+/.test(entry) || !entry.endsWith('.md')) continue;
    const full = path.join(evalsDir, entry);
    const content = fs.readFileSync(full, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    if (!frontmatter.id) continue;
    out.push({
      id: String(frontmatter.id),
      file: entry,
      validation: !!frontmatter.validation,
      frontmatter,
      body,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deterministic mock executor — assigns a score per task based on a
 * stable hash of (variant_id, task_id, trial). Used in tests + harness
 * verification. Real LLM executor is plugged in by the operator post-v0.
 *
 * Returns {score, spec_pass, duration_ms, cost_usd}.
 */
// Sprint 3.0 v1 — real-LLM executor via OpenRouter.
//
// Single-turn evaluation: variant prompt = system, task.body = user.
// Response is scored as a **smoke baseline** (Sprint 3.0 v1 honest scope):
// non-empty content + cost recorded + duration recorded. True
// rubric-scoring (LLM-as-judge against eval's must-have checklist) is
// deferred to v2.
//
// Requires OPENROUTER_API_KEY in env. Cost-guard via opts.maxCostUsd
// aborts the run when cumulative cost exceeds the cap.
function makeOpenRouterExecutor(opts = {}) {
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('makeOpenRouterExecutor: OPENROUTER_API_KEY required (env or opts.apiKey)');
  }
  const model = opts.model || 'deepseek/deepseek-v4-flash';
  const maxTokens = Number.isFinite(opts.maxTokens) && opts.maxTokens > 0
    ? Math.floor(opts.maxTokens) : 2048;
  const maxCostUsd = Number.isFinite(opts.maxCostUsd) && opts.maxCostUsd > 0
    ? opts.maxCostUsd : 1.0;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const endpoint = opts.endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  const variantPromptText = opts.variantPromptText || '';

  let cumulativeCost = 0;

  async function exec({ variant_id, task_id, trial, task }) {
    if (cumulativeCost >= maxCostUsd) {
      return {
        score: 0,
        spec_pass: false,
        duration_ms: 0,
        cost_usd: 0,
        skipped: true,
        skip_reason: 'COST_CAP_REACHED',
        response_text: '',
      };
    }

    const userPrompt = task.body || '';
    const t0 = Date.now();
    let resp;
    try {
      resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: variantPromptText || `You are running cortex-x eval task ${task_id}. Read the user message (task input + rubric) and respond as cortex-x's relevant agent would.` },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
        }),
      });
    } catch (err) {
      return {
        score: 0,
        spec_pass: false,
        duration_ms: Date.now() - t0,
        cost_usd: 0,
        error: `fetch_failed: ${err && err.message}`,
        response_text: '',
      };
    }
    const duration_ms = Date.now() - t0;
    const text = await resp.text();
    if (!resp.ok) {
      return {
        score: 0,
        spec_pass: false,
        duration_ms,
        cost_usd: 0,
        error: `http_${resp.status}: ${text.slice(0, 200)}`,
        response_text: '',
      };
    }
    let body;
    try { body = JSON.parse(text); } catch (err) {
      return {
        score: 0,
        spec_pass: false,
        duration_ms,
        cost_usd: 0,
        error: 'json_parse_failed',
        response_text: text.slice(0, 500),
      };
    }
    const responseText = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    const cost_usd = (body && body.usage && Number(body.usage.cost)) || 0;
    cumulativeCost += cost_usd;

    // Smoke score: 1.0 if non-empty response, 0 otherwise. Sprint 3.0 v2
    // will replace with LLM-as-judge against rubric checklist.
    const responseStr = typeof responseText === 'string' ? responseText : '';
    const score = responseStr.trim().length >= 32 ? 1.0 : 0;
    // spec_pass mirrors the smoke threshold; true rubric-driven spec_pass
    // lands with v2 LLM-as-judge scoring.
    const spec_pass = score >= 1.0;

    return {
      score,
      spec_pass,
      duration_ms,
      cost_usd,
      response_text: responseStr,
      cumulative_cost_usd: cumulativeCost,
      model_used: model,
    };
  }

  exec.getCumulativeCost = () => cumulativeCost;
  return exec;
}

function mockExecutor({ variant_id, task_id, trial }) {
  let h = 2166136261;
  const s = `${variant_id}::${task_id}::${trial}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = ((h >>> 0) % 1000) / 1000;
  return {
    score: u,
    spec_pass: u > 0.2, // 80% spec-pass baseline
    duration_ms: 100 + Math.floor(u * 200),
    cost_usd: 0.0001,
  };
}

/**
 * Run a single variant (prompt-file identity) over the eval suite.
 *
 * @param {object} opts
 * @param {string} opts.variantId       — label for the prompt variant
 * @param {string} opts.evalsDir        — path to evals/
 * @param {number} [opts.trials=5]      — N trials per task
 * @param {function} [opts.executor]    — pluggable async; default mock
 * @param {string[]} [opts.taskIds]     — filter to a subset
 * @param {boolean} [opts.validationOnly]  — only run held-out tasks
 * @param {boolean} [opts.trainOnly]    — only run non-validation tasks
 * @returns {Promise<object>} VariantResult
 */
async function runVariant(opts = {}) {
  const variantId = String(opts.variantId || 'unknown');
  const evalsDir = opts.evalsDir;
  if (!evalsDir) throw new Error('eval-runner.runVariant: evalsDir is required');
  const trials = Number.isFinite(opts.trials) && opts.trials > 0
    ? Math.floor(opts.trials) : 5;
  const executor = typeof opts.executor === 'function' ? opts.executor : mockExecutor;

  let tasks = discoverTasks(evalsDir);
  if (opts.validationOnly) tasks = tasks.filter((t) => t.validation);
  if (opts.trainOnly) tasks = tasks.filter((t) => !t.validation);
  if (Array.isArray(opts.taskIds) && opts.taskIds.length > 0) {
    const want = new Set(opts.taskIds);
    tasks = tasks.filter((t) => want.has(t.id));
  }

  const trialRows = [];
  let totalCost = 0;
  for (const t of tasks) {
    for (let i = 0; i < trials; i += 1) {
      const r = await executor({ variant_id: variantId, task_id: t.id, trial: i, task: t });
      trialRows.push({
        task_id: t.id,
        trial: i,
        score: scorer.clamp01(Number(r.score)),
        spec_pass: !!r.spec_pass,
        duration_ms: Number(r.duration_ms) || 0,
        cost_usd: Number(r.cost_usd) || 0,
        validation: t.validation,
      });
      totalCost += Number(r.cost_usd) || 0;
    }
  }

  // Aggregations
  const trainRows = trialRows.filter((r) => !r.validation);
  const validationRows = trialRows.filter((r) => r.validation);
  const trainScores = trainRows.map((r) => r.score);
  const validationScores = validationRows.map((r) => r.score);
  const trainSpecPasses = trainRows.filter((r) => r.spec_pass).length;
  const validationSpecPasses = validationRows.filter((r) => r.spec_pass).length;

  return {
    variant_id: variantId,
    captured_at: new Date().toISOString(),
    trials_per_task: trials,
    tasks_count: tasks.length,
    trials_total: trialRows.length,
    train_tasks_count: tasks.filter((t) => !t.validation).length,
    validation_tasks_count: tasks.filter((t) => t.validation).length,
    trainScores,
    validationScores,
    specPassRateTrain: trainRows.length > 0 ? trainSpecPasses / trainRows.length : 0,
    specPassRateValidation: validationRows.length > 0 ? validationSpecPasses / validationRows.length : 0,
    cost_usd_total: Number(totalCost.toFixed(6)),
    by_task: scorer.aggregateByTask(trialRows),
    rows: trialRows,
  };
}

/**
 * Persist variant result to evals/results/<date>-<variant_id>.json.
 */
function writeVariantResult(result, evalsResultsDir) {
  fs.mkdirSync(evalsResultsDir, { recursive: true });
  const date = result.captured_at.slice(0, 10);
  const safeId = String(result.variant_id).replace(/[^A-Za-z0-9_-]/g, '-');
  const filename = `${date}-${safeId}.json`;
  const full = path.join(evalsResultsDir, filename);
  fs.writeFileSync(full, JSON.stringify(result, null, 2), 'utf8');
  return full;
}

module.exports = {
  discoverTasks,
  runVariant,
  writeVariantResult,
  mockExecutor,
  makeOpenRouterExecutor,
  parseFrontmatter,
};
