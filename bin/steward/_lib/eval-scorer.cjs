// bin/steward/_lib/eval-scorer.cjs — Sprint 3.0 v0
//
// Pure-math scoring + bootstrap-CI + champion-vs-challenger decision rule.
// Pre-empt mode-1 metric overfitting + mode-collapse failure modes
// surfaced in Sprint 3.0 R1 (docs/research/sprint-3.0-r1-...md):
//   - Champion-vs-challenger decision requires BOTH point-estimate
//     improvement AND lower-CI-bound > champion point estimate AND
//     held-out validation set non-regression.
//   - 10-task v0 eval suite is below the N≈400-600 published threshold
//     for 5% delta detection at 95% confidence. v0 results are
//     "directional," not statistically significant. Honest framing in
//     decision output.

'use strict';

const DEFAULT_BOOTSTRAP_SAMPLES = 1000;
const DEFAULT_CONFIDENCE = 0.95;

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += Number(x);
  return s / arr.length;
}

// Seeded PRNG so bootstrap CI is reproducible across runs.
// Mulberry32 — small, fast, well-distributed.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Resample `scores` with replacement, computing a bootstrap distribution
 * of the mean. Returns { lower, mean, upper } at the requested confidence.
 *
 * @param {number[]} scores  — per-trial scores (0..1)
 * @param {object}   opts
 * @param {number}   [opts.samples=1000]
 * @param {number}   [opts.confidence=0.95]
 * @param {number}   [opts.seed=42]  — deterministic across re-runs
 */
function bootstrapMeanCI(scores, opts = {}) {
  const samples = Number.isFinite(opts.samples) && opts.samples > 0
    ? Math.min(10000, Math.floor(opts.samples))
    : DEFAULT_BOOTSTRAP_SAMPLES;
  const conf = Number.isFinite(opts.confidence) && opts.confidence > 0 && opts.confidence < 1
    ? opts.confidence : DEFAULT_CONFIDENCE;
  const rng = mulberry32(Number.isFinite(opts.seed) ? Math.floor(opts.seed) : 42);

  if (!Array.isArray(scores) || scores.length === 0) {
    return { mean: 0, lower: 0, upper: 0, samples, confidence: conf, n: 0 };
  }
  const n = scores.length;
  if (n === 1) {
    return { mean: scores[0], lower: scores[0], upper: scores[0], samples, confidence: conf, n };
  }

  const means = new Array(samples);
  for (let i = 0; i < samples; i += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) {
      acc += scores[Math.floor(rng() * n)];
    }
    means[i] = acc / n;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - conf) / 2;
  const lowerIdx = Math.floor(alpha * samples);
  const upperIdx = Math.min(samples - 1, Math.floor((1 - alpha) * samples));
  return {
    mean: mean(scores),
    lower: means[lowerIdx],
    upper: means[upperIdx],
    samples,
    confidence: conf,
    n,
  };
}

/**
 * Decide champion vs challenger per R1 §5 rules:
 *   1. Challenger point estimate > champion point estimate by ≥ minDelta
 *   2. Challenger LOWER CI bound > champion point estimate (strict
 *      improvement under uncertainty)
 *   3. spec_pass_rate on held-out validation set NOT worse than champion
 *
 * Returns: { promote, reason, evidence }
 *
 * @param {object} champion
 * @param {number[]} champion.trainScores
 * @param {number[]} [champion.validationScores]
 * @param {number} [champion.specPassRateValidation]
 * @param {object} challenger  — same shape
 * @param {object} opts
 * @param {number} [opts.minDelta=0.05]
 */
function decideAB(champion, challenger, opts = {}) {
  const minDelta = Number.isFinite(opts.minDelta) ? opts.minDelta : 0.05;
  const seed = Number.isFinite(opts.seed) ? opts.seed : 42;

  if (!champion || !challenger
      || !Array.isArray(champion.trainScores) || !Array.isArray(challenger.trainScores)) {
    return {
      promote: false,
      reason: 'INVALID_INPUT',
      evidence: { hint: 'Both champion + challenger must have trainScores[]' },
    };
  }

  const champCI = bootstrapMeanCI(champion.trainScores, { ...opts, seed });
  const challCI = bootstrapMeanCI(challenger.trainScores, { ...opts, seed });
  const delta = challCI.mean - champCI.mean;

  // Rule 1 — point-estimate improvement by ≥ minDelta
  if (delta < minDelta) {
    return {
      promote: false,
      reason: 'POINT_ESTIMATE_DELTA_TOO_SMALL',
      evidence: {
        champion_mean: champCI.mean,
        challenger_mean: challCI.mean,
        delta,
        required: minDelta,
        champion_ci: champCI,
        challenger_ci: challCI,
      },
    };
  }

  // Rule 2 — lower CI bound of challenger must exceed champion point estimate
  if (challCI.lower <= champCI.mean) {
    return {
      promote: false,
      reason: 'CHALLENGER_LOWER_CI_NOT_ABOVE_CHAMPION',
      evidence: {
        champion_mean: champCI.mean,
        challenger_lower_ci: challCI.lower,
        delta_from_champion_mean: challCI.lower - champCI.mean,
        champion_ci: champCI,
        challenger_ci: challCI,
      },
    };
  }

  // Rule 3 — held-out validation: spec_pass_rate must not regress
  const champSpec = Number.isFinite(champion.specPassRateValidation)
    ? champion.specPassRateValidation : null;
  const challSpec = Number.isFinite(challenger.specPassRateValidation)
    ? challenger.specPassRateValidation : null;
  if (champSpec !== null && challSpec !== null && challSpec < champSpec) {
    return {
      promote: false,
      reason: 'CHALLENGER_VALIDATION_SPEC_REGRESSION',
      evidence: {
        champion_spec_pass_rate_validation: champSpec,
        challenger_spec_pass_rate_validation: challSpec,
        hint: 'spec_verifier pass rate dropped on held-out validation set — possible overfit to train tasks',
        champion_ci: champCI,
        challenger_ci: challCI,
      },
    };
  }

  return {
    promote: true,
    reason: 'CHALLENGER_BEATS_CHAMPION',
    evidence: {
      champion_mean: champCI.mean,
      challenger_mean: challCI.mean,
      delta,
      challenger_lower_ci: challCI.lower,
      champion_ci: champCI,
      challenger_ci: challCI,
      directional_only_warning: champion.trainScores.length < 50
        || challenger.trainScores.length < 50
        ? `N=${Math.min(champion.trainScores.length, challenger.trainScores.length)} per condition; published threshold for 5% delta at 95% confidence is ≈400-600. v0 results are directional, not statistically significant.`
        : null,
    },
  };
}

/**
 * Per-task aggregate: for each task, average score across trials,
 * compute pass_rate ( fraction of trials with score == 1 ), capture
 * spec_pass_rate.
 *
 * @param {Array<{task_id: string, score: number, spec_pass: boolean}>} trialRows
 */
function aggregateByTask(trialRows) {
  if (!Array.isArray(trialRows)) return [];
  const byTask = new Map();
  for (const r of trialRows) {
    if (!r || typeof r.task_id !== 'string') continue;
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, { task_id: r.task_id, scores: [], spec_passes: 0, trials: 0 });
    const t = byTask.get(r.task_id);
    t.scores.push(clamp01(Number(r.score)));
    if (r.spec_pass) t.spec_passes += 1;
    t.trials += 1;
  }
  return [...byTask.values()].map((t) => ({
    task_id: t.task_id,
    mean_score: mean(t.scores),
    trials: t.trials,
    pass_rate: t.scores.filter((s) => s >= 0.99).length / t.trials,
    spec_pass_rate: t.spec_passes / t.trials,
  })).sort((a, b) => a.task_id.localeCompare(b.task_id));
}

module.exports = {
  bootstrapMeanCI,
  decideAB,
  aggregateByTask,
  mean,
  clamp01,
  // exported for tests
  mulberry32,
};
