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
  parseFrontmatter,
};
