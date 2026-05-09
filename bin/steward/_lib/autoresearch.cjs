// autoresearch.cjs — Sprint 2.1 N-strategy serial autoresearch loop.
//
// Diverge-then-judge pattern: instead of running a single LLM call → apply
// → test → PR (today's flow), generate N=3 diverse candidate strategies,
// apply each in turn, run spec-verifier + npm test as gates, then judge
// picks among passing candidates. Rejected candidates roll back via git
// stash; winner is re-applied and committed atomically.
//
// Single-process serial within one run. Sprint 2.2 (worktree supervisor)
// fans out to N parallel workers; this sprint stays sequential.
//
// Research basis: docs/research/sprint-2.1-autoresearch-overnight-burst-2026-05-08.md
// (R1 memo, 2026-05-08). Anchors:
//   - Karpathy autoresearch (March 2026, 41k+ stars) — minimal loop pattern.
//   - AlphaCode/AlphaCodium pass@k — N=3 cost-quality knee for code gen.
//   - Tennis-XGBoost post-mortem — validation hacking class + delta-anomaly defense.
//   - Verbalized Sampling / DIPPER — strategy collapse mitigations (deferred to 2.1.1).
//   - Anthropic multi-agent +90.2% (3-5 subagents) — judge cross-family.
//
// Operator-approved decisions on R1 memo §9 open questions:
//   Q1 — Lessons write all-N (winners + rejected) for Sprint 3.0 AlphaEvolve seed.
//   Q2 — Judge disagreement → auto-fallback to most-spec-criteria-passed candidate
//        + label PR with `judge-disagreement` for human awareness.
//   Q3 — Verbalized Sampling deferred to 2.1.1 (token budget interaction).
//   Q4 — N capped at [1, 10]. Default 3. Contract test exercises 1/3/5/10.
//   Q5 — Sunday autoresearch coexists with nightly cron (journal dedup handles).
//   Q6 — Run-level cost rollup primary, candidate-level in journal phase entries.
//
// Error codes (per Sprint 1.9 convention):
//   STEWARD_AUTORESEARCH_VERIFIER_TAMPERED   — hash mismatch on policy/criteria
//   STEWARD_AUTORESEARCH_STRATEGY_COLLAPSE   — all candidates >85% similar after re-roll
//   STEWARD_AUTORESEARCH_JUDGE_DISAGREEMENT  — both-orderings judge disagreed (soft-fall to spec-margin)
//   STEWARD_AUTORESEARCH_RUN_USD_EXCEEDED    — $1/run cap tripped mid-run
//   STEWARD_AUTORESEARCH_TIME_EXCEEDED       — 60min cap tripped mid-run
//   STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED — no candidate passed spec-verifier

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { readEnv } = require('./env.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration with safe defaults + clamps.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_N = 3;
const MIN_N = 1;
const MAX_N = 10;
const DEFAULT_RUN_USD_CAP = 1.0;
const DEFAULT_MAX_TIME_MIN = 60;
const MAX_TIME_MIN_CLAMP = 300; // 5 hours hard ceiling (GHA free-tier 6h job limit)
const DEFAULT_JUDGE_MODEL = 'anthropic/claude-sonnet-4.6';
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_DELTA_ANOMALY_MULTIPLIER = 3.0;

// Read STEWARD_AUTORESEARCH_N (clamped to [1, 10]).
function readN() {
  const raw = readEnv('AUTORESEARCH_N');
  if (raw === undefined) return DEFAULT_N;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_N;
  return Math.max(MIN_N, Math.min(MAX_N, n));
}

function readRunUsdCap() {
  const raw = readEnv('AUTORESEARCH_RUN_USD_CAP');
  if (raw === undefined) return DEFAULT_RUN_USD_CAP;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RUN_USD_CAP;
  return n; // 0 = explicit opt-out
}

function readMaxTimeMin() {
  const raw = readEnv('AUTORESEARCH_MAX_TIME_MIN');
  if (raw === undefined) return DEFAULT_MAX_TIME_MIN;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TIME_MIN;
  return Math.min(n, MAX_TIME_MIN_CLAMP);
}

function readJudgeModel() {
  const raw = readEnv('AUTORESEARCH_JUDGE_MODEL');
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return DEFAULT_JUDGE_MODEL;
}

function readSimilarityThreshold() {
  const raw = readEnv('AUTORESEARCH_SIMILARITY_THRESHOLD');
  if (raw === undefined) return DEFAULT_SIMILARITY_THRESHOLD;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_SIMILARITY_THRESHOLD;
  return n;
}

function readDeltaAnomalyMultiplier() {
  const raw = readEnv('AUTORESEARCH_DELTA_ANOMALY_MULTIPLIER');
  if (raw === undefined) return DEFAULT_DELTA_ANOMALY_MULTIPLIER;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 1) return DEFAULT_DELTA_ANOMALY_MULTIPLIER;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff hashing + Jaccard similarity (strategy collapse detection).
// ─────────────────────────────────────────────────────────────────────────────

// Bag-of-changed-lines: extract added/removed lines from a unified diff
// (or from the candidate's [{path, content}] applied delta vs prevSize).
// We use a content-only sketch: line strings in a Set, sized by the candidate.
function diffSketch(candidate) {
  const lines = new Set();
  if (!candidate || !Array.isArray(candidate.edits)) return lines;
  for (const edit of candidate.edits) {
    if (!edit || typeof edit.content !== 'string') continue;
    // Bag the content lines. Order-insensitive — "minimize edits" vs
    // "refactor for clarity" should still produce different bags even if
    // some lines coincidentally repeat.
    for (const line of edit.content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      // Hash long lines to keep memory bounded across very large files.
      if (trimmed.length > 256) {
        lines.add(crypto.createHash('sha1').update(trimmed).digest('hex'));
      } else {
        lines.add(trimmed);
      }
    }
  }
  return lines;
}

function jaccardSimilarity(setA, setB) {
  if (!setA || !setB) return 0;
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const v of setA) if (setB.has(v)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 1;
  return intersection / union;
}

// Returns { collapsed: boolean, pairs: [[i, j, similarity], ...] }
// where pairs are above the threshold. collapsed === true when ALL candidates
// reduce to a single equivalence class (i.e. every pair is above threshold).
function detectCollapse(candidates, threshold = DEFAULT_SIMILARITY_THRESHOLD) {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return { collapsed: false, pairs: [], allSimilar: false };
  }
  const sketches = candidates.map(diffSketch);
  const pairs = [];
  let highCount = 0;
  for (let i = 0; i < sketches.length; i += 1) {
    for (let j = i + 1; j < sketches.length; j += 1) {
      const sim = jaccardSimilarity(sketches[i], sketches[j]);
      if (sim >= threshold) {
        pairs.push([i, j, sim]);
        highCount += 1;
      }
    }
  }
  const totalPairs = (sketches.length * (sketches.length - 1)) / 2;
  const allSimilar = totalPairs > 0 && highCount === totalPairs;
  return { collapsed: allSimilar, pairs, allSimilar };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diversity prompt overlay — temperature laddering + explicit strategy labels.
// ─────────────────────────────────────────────────────────────────────────────

// Each candidate gets a different temperature + explicit strategy persona.
// The 3 default strategies map to AlphaCodium-style "diverse problem-solving
// styles": minimize-edits (T=0.2), default (T=0.7), exploratory (T=1.0).
//
// When N != 3, intermediate values are interpolated.
function buildCandidateStrategies(n) {
  const strategies = [];
  if (n <= 0) return strategies;
  if (n === 1) {
    strategies.push({
      label: 'default',
      persona: 'You are a careful senior engineer. Pick the smallest correct change.',
      temperature: 0.7,
    });
    return strategies;
  }
  // Always include the conservative + exploratory anchors.
  strategies.push({
    label: 'minimize_edits',
    persona: 'You are a senior engineer who prefers minimal, surgical changes. Edit the smallest set of files possible. Prefer additions over rewrites.',
    temperature: 0.2,
  });
  // Middle slots — N-2 of them.
  for (let i = 1; i < n - 1; i += 1) {
    const t = 0.2 + ((i) / (n - 1)) * 0.8; // ramp 0.2 → 1.0
    strategies.push({
      label: `balanced_${i}`,
      persona: `You are a senior engineer at experimentation level ${i}. Balance correctness with code clarity. Consider 2-3 alternatives and pick the most robust.`,
      temperature: Math.round(t * 100) / 100,
    });
  }
  strategies.push({
    label: 'exploratory',
    persona: 'You are a senior engineer who is willing to refactor for clarity. If the existing structure is awkward, propose a cleaner shape — but only when justified by the action body.',
    temperature: 1.0,
  });
  return strategies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash check — Tennis-XGBoost validation-hacking defense.
// ─────────────────────────────────────────────────────────────────────────────

// Hash the spec-verifier inputs (action-kinds.cjs registry) at run start; on
// completion, recompute and compare. Mismatch = candidate edited the policy
// (a class of validation-hacking attack documented in R1 memo §1.5).
function hashCriteriaSnapshot(repoRoot) {
  const targets = [
    path.join(repoRoot, 'bin', 'steward', '_lib', 'action-kinds.cjs'),
    path.join(repoRoot, 'bin', 'steward', '_lib', 'spec-verifier.cjs'),
    path.join(repoRoot, 'bin', 'steward', '_lib', 'policy-check.cjs'),
  ];
  const hasher = crypto.createHash('sha256');
  let read = 0;
  for (const target of targets) {
    try {
      const content = fs.readFileSync(target, 'utf8');
      hasher.update(target);
      hasher.update('\0');
      hasher.update(content);
      hasher.update('\0');
      read += 1;
    } catch (_) {
      // File missing is itself a signal — record sentinel + continue.
      hasher.update(target);
      hasher.update('\0<missing>\0');
    }
  }
  return { hash: hasher.digest('hex'), filesRead: read };
}

function verifyCriteriaUnchanged(repoRoot, baselineHash) {
  const fresh = hashCriteriaSnapshot(repoRoot);
  return {
    ok: fresh.hash === baselineHash,
    baselineHash,
    currentHash: fresh.hash,
    filesRead: fresh.filesRead,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delta anomaly detector — Tennis-XGBoost post-plateau acceleration signal.
// ─────────────────────────────────────────────────────────────────────────────

// Reads journal entries for autoresearch winners over the last 7 days,
// computes their spec-verifier "improvement margin" (passed_criteria_count
// minus baseline). If today's winner exceeds rolling-mean × multiplier,
// soft-flag for human review (NOT a hard halt).
// Sprint 2.1 R2 edge MAJOR: require sampleSize >= 3 before flagging — single-
// or two-sample rolling means produce noisy false-positives on first 1-2 weekly
// runs. Also wrap journal.readJournal in try/catch so corrupted journal doesn't
// crash the whole run after the winner has been picked.
const DELTA_ANOMALY_MIN_SAMPLE = 3;

function checkDeltaAnomaly(journalSlug, todayMargin, opts = {}) {
  const multiplier = opts.multiplier || readDeltaAnomalyMultiplier();
  const journal = require('./journal.cjs');
  const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let entries;
  try {
    entries = journal.readJournal(journalSlug);
  } catch (err) {
    return { anomaly: false, sampleSize: 0, threshold: null, todayMargin, error: err && err.message };
  }
  const recent = [];
  for (const e of entries) {
    if (e._corrupted) continue;
    if (e.event !== 'autoresearch_winner') continue;
    if (typeof e.spec_margin !== 'number' || !Number.isFinite(e.spec_margin)) continue;
    if (typeof e.ts !== 'string') continue;
    const tsMs = Date.parse(e.ts);
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;
    recent.push(e.spec_margin);
  }
  if (recent.length < DELTA_ANOMALY_MIN_SAMPLE) {
    return { anomaly: false, sampleSize: recent.length, threshold: null, todayMargin, bootstrap: true };
  }
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const threshold = mean * multiplier;
  return {
    anomaly: todayMargin > threshold && todayMargin > 0,
    sampleSize: recent.length,
    rollingMean: mean,
    threshold,
    multiplier,
    todayMargin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Judge prompt + selection — both-orderings, length-aware rubric.
// ─────────────────────────────────────────────────────────────────────────────

// Build a judge prompt that ranks N candidates (typically 2-3 after spec
// filtering). Returns { systemPrompt, userPrompt } for caller to fetch().
// Sprint 2.1 R2 edge MAJOR: strip closing-tag tokens from operator-authored
// content so an `</untrusted>` literal in recommendations.md body doesn't
// escape the trust delimiter and inject system-channel instructions into
// the judge prompt. Same defense pattern as Sprint 1.6.20 H4 (prompt
// injection via untrusted CLAUDE.md content).
function sanitizeForUntrustedBlock(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<\/untrusted>/gi, '&lt;/untrusted&gt;')
    .replace(/<untrusted/gi, '&lt;untrusted');
}

function buildJudgePrompt(plan, candidates) {
  const sys = [
    'You are a senior code reviewer judging multiple solutions to the same task.',
    '',
    'Each candidate has already passed spec-verifier (correctness gate). Your job',
    'is to pick the *best* qualitative solution among the N candidates.',
    '',
    'Rubric:',
    '- Correctness (is the action body satisfied?)',
    '- Clarity (does the diff read like a senior engineer wrote it?)',
    '- Minimality (smaller diffs preferred when correctness is equivalent)',
    '- Follow-on cost (will this need refactoring soon?)',
    '',
    'CRITICAL: verbosity is not quality. A larger diff is worse if a smaller diff',
    'achieves the same outcome.',
    '',
    'Output ONLY a JSON object: {"winner_index": <0-based>, "rationale": "<short>"}',
    'No markdown fences, no commentary.',
  ].join('\n');

  const lines = [];
  lines.push(`# Action: ${sanitizeForUntrustedBlock(plan.action.title)}`);
  lines.push('');
  lines.push('<untrusted source="cortex/recommendations.md">');
  lines.push(sanitizeForUntrustedBlock(plan.action.body || ''));
  lines.push('</untrusted>');
  lines.push('');
  lines.push('## Candidates');
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    lines.push(`### Candidate ${i} — strategy: ${c.strategy_label || 'unlabeled'}`);
    lines.push(`Spec criteria passed: ${c.spec_criteria_passed}/${c.spec_criteria_total}`);
    lines.push(`Touched files: ${(c.touchedFiles || []).join(', ') || '(none)'}`);
    lines.push('Diff summary:');
    for (const edit of (c.edits || [])) {
      const preview = (edit.content || '').slice(0, 500);
      lines.push(`File: ${edit.path}`);
      lines.push('```');
      lines.push(preview);
      lines.push('```');
    }
    lines.push('');
  }
  lines.push('Pick the winner_index. JSON only.');
  return { systemPrompt: sys, userPrompt: lines.join('\n') };
}

// Consensus across both orderings: judge sees candidates in [0, 1, 2] order,
// then again in [2, 1, 0] order. If both runs pick the same candidate → strong
// signal. If they disagree → soft-fall to `most-spec-criteria-passed` and
// label PR with judge-disagreement.
function reconcileJudgeResults(forwardPick, reversePickInForwardSpace, candidates) {
  if (forwardPick === reversePickInForwardSpace) {
    return {
      winnerIndex: forwardPick,
      method: 'consensus',
      candidate: candidates[forwardPick],
    };
  }
  // Disagreement — pick by spec-criteria margin.
  let bestIdx = 0;
  let bestMargin = -Infinity;
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const margin = (c.spec_criteria_passed || 0) - (c.spec_criteria_total || 0);
    if (margin > bestMargin) {
      bestMargin = margin;
      bestIdx = i;
    }
  }
  return {
    winnerIndex: bestIdx,
    method: 'spec_margin_fallback',
    candidate: candidates[bestIdx],
    judgeDisagreement: { forwardPick, reversePick: reversePickInForwardSpace },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost + time tracking helpers (per-run accounting).
// ─────────────────────────────────────────────────────────────────────────────

function makeRunBudget(opts = {}) {
  return {
    startMs: Date.now(),
    spentUsd: 0,
    runUsdCap: opts.runUsdCap !== undefined ? opts.runUsdCap : readRunUsdCap(),
    maxTimeMin: opts.maxTimeMin !== undefined ? opts.maxTimeMin : readMaxTimeMin(),
  };
}

function addCost(budget, costUsd) {
  if (typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0) {
    budget.spentUsd += costUsd;
  }
}

// Returns { ok: true } when within budget, or { ok: false, code: ... } when
// the cap is reached. Skipped (returns ok: true) when caps are disabled (0).
function checkBudget(budget) {
  if (budget.runUsdCap > 0 && budget.spentUsd >= budget.runUsdCap) {
    return {
      ok: false,
      code: 'STEWARD_AUTORESEARCH_RUN_USD_EXCEEDED',
      cap: budget.runUsdCap,
      spent: budget.spentUsd,
    };
  }
  if (budget.maxTimeMin > 0) {
    const elapsedMin = (Date.now() - budget.startMs) / 60_000;
    if (elapsedMin >= budget.maxTimeMin) {
      return {
        ok: false,
        code: 'STEWARD_AUTORESEARCH_TIME_EXCEEDED',
        cap: budget.maxTimeMin,
        elapsedMin,
      };
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports — primitives for the runtime to compose.
// ─────────────────────────────────────────────────────────────────────────────
//
// The full runAutoresearch orchestrator lives in execute.cjs (Sprint 2.1
// wiring) because it touches git stash + spec-verifier + applyAction +
// journal — all SSOT modules already imported there. This file owns the
// pure primitives: similarity, diversity, hashing, judge prompts, budget.

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — runAutoresearch
// ─────────────────────────────────────────────────────────────────────────────
//
// Single-process serial N-strategy loop. For each strategy:
//   1. Apply candidate via deps.applyAction with persona + temperature
//   2. Run deps.runSpec + deps.runNpmTest as gates
//   3. Record candidate metrics
//   4. Roll back via deps.rollback (git checkout -- . && git clean -fd)
// After all candidates evaluated:
//   5. Verify criteria hash unchanged (validation hacking defense)
//   6. Detect strategy collapse (Jaccard >= threshold across all pairs)
//   7. Filter to passing candidates (spec + npm test both ok)
//   8. If 0 passing → return STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED
//   9. If 1 passing → that's the winner, no judge call
//   10. If 2-3 passing → judge with both-orderings, reconcile via
//       reconcileJudgeResults (consensus or spec-margin fallback)
//   11. Detect delta anomaly (winner's spec margin vs rolling 7-day mean)
//   12. Re-apply winner, return result for downstream commit pipeline
//
// Dependency injection (deps object): keeps the orchestrator pure-of-side-
// effects from this module's perspective. execute.cjs wires the real
// applyAction, spec-verifier, runNpmTest, gitOps. Tests inject mocks.

async function runAutoresearch(plan, deps, opts = {}) {
  const N = opts.N !== undefined ? Math.max(MIN_N, Math.min(MAX_N, opts.N)) : readN();
  const similarityThreshold = opts.similarityThreshold !== undefined ? opts.similarityThreshold : readSimilarityThreshold();
  const judgeModel = opts.judgeModel || readJudgeModel();
  const repoRoot = opts.repoRoot;
  const slug = plan.slug;

  if (typeof deps.applyAction !== 'function'
    || typeof deps.runSpec !== 'function'
    || typeof deps.runNpmTest !== 'function'
    || typeof deps.rollback !== 'function') {
    return {
      ok: false,
      code: 'AUTORESEARCH_DEPS_INCOMPLETE',
      error: 'runAutoresearch requires deps {applyAction, runSpec, runNpmTest, rollback}',
    };
  }

  // Sprint 2.1 R2 edge MAJOR: guard repoRoot before path.join in
  // hashCriteriaSnapshot (otherwise `path.join(undefined, ...)` throws and
  // crashes the whole run before any candidate runs).
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    return {
      ok: false,
      code: 'AUTORESEARCH_REPO_ROOT_MISSING',
      error: 'runAutoresearch requires opts.repoRoot to be a non-empty string',
    };
  }

  const budget = makeRunBudget(opts);
  const baselineHash = hashCriteriaSnapshot(repoRoot);
  const strategies = buildCandidateStrategies(N);
  const candidates = [];

  for (let i = 0; i < strategies.length; i += 1) {
    // Pre-iteration budget check — protects against in-flight overshoot.
    const budgetCheck = checkBudget(budget);
    if (!budgetCheck.ok) {
      // Don't run more candidates; reconcile what we have so far.
      candidates.push({
        index: i,
        strategy_label: strategies[i].label,
        ok: false,
        code: budgetCheck.code,
        error: budgetCheck.code === 'STEWARD_AUTORESEARCH_RUN_USD_EXCEEDED'
          ? `run cap $${budget.runUsdCap} reached at $${budget.spentUsd.toFixed(4)} before candidate ${i}`
          : `run time cap reached before candidate ${i}`,
        skipped_due_to_budget: true,
      });
      break;
    }

    const strategy = strategies[i];
    const applyResult = await deps.applyAction(plan, {
      ...opts,
      personaOverlay: strategy.persona,
      temperature: strategy.temperature,
    });

    addCost(budget, applyResult && applyResult.cost_usd);

    if (!applyResult || !applyResult.ok) {
      candidates.push({
        index: i,
        strategy_label: strategy.label,
        ok: false,
        code: applyResult && applyResult.code,
        error: applyResult && applyResult.error,
        cost_usd: (applyResult && applyResult.cost_usd) || 0,
        edits: [],
        spec_pass: false,
        spec_criteria_passed: 0,
        spec_criteria_total: 0,
        npm_pass: false,
      });
      // Apply failure → nothing to roll back, still call rollback to be safe
      // (mock or transient touched files).
      try { await deps.rollback(); } catch { /* best-effort */ }
      continue;
    }

    // Spec-verifier gate.
    let specResult;
    try {
      specResult = await deps.runSpec(plan, applyResult);
    } catch (err) {
      specResult = { ok: false, code: 'SPEC_MALFORMED', error: err && err.message };
    }
    const specPass = !!(specResult && specResult.ok);

    // npm test gate (only run if spec passed; saves ~30s per failed candidate).
    let npmResult = null;
    let npmPass = false;
    if (specPass) {
      try {
        npmResult = await deps.runNpmTest();
        npmPass = !!(npmResult && npmResult.ok);
      } catch (err) {
        npmResult = { ok: false, error: err && err.message };
        npmPass = false;
      }
    }

    // R2 edge MAJOR: a candidate that returned ok:true but with no edits is
    // effectively a no-op; it cannot be a winner downstream. Mark failed.
    const hasEdits = Array.isArray(applyResult.edits) && applyResult.edits.length > 0;
    // R2 blind BLOCKER: criteria_passed === 0 is a legit value (zero criteria
    // passed). Use ?? not || so explicit 0 doesn't short-circuit to a wrong
    // fallback. Spec-verifier (Sprint 2.1 R2 fix) now always emits criteria_passed
    // and criteria_total on success — these are the SSOT.
    const specCriteriaPassed = specResult && typeof specResult.criteria_passed === 'number'
      ? specResult.criteria_passed
      : (specPass ? (specResult && typeof specResult.criteria_total === 'number' ? specResult.criteria_total : 0) : 0);
    const specCriteriaTotal = specResult && typeof specResult.criteria_total === 'number'
      ? specResult.criteria_total
      : 0;
    candidates.push({
      index: i,
      strategy_label: strategy.label,
      ok: specPass && npmPass && hasEdits,
      cost_usd: applyResult.cost_usd || 0,
      tokens_in: applyResult.tokens_in || 0,
      tokens_out: applyResult.tokens_out || 0,
      edits: applyResult.edits || [],
      touchedFiles: applyResult.touchedFiles || [],
      spec_pass: specPass,
      spec_criteria_passed: specCriteriaPassed,
      spec_criteria_total: specCriteriaTotal,
      spec_failures: (specResult && specResult.spec_failures) || [],
      npm_pass: npmPass,
      npm_summary: npmResult,
      ...(hasEdits ? {} : { code: 'CANDIDATE_NO_EDITS' }),
    });

    // Roll back the working tree before the next candidate.
    try { await deps.rollback(); } catch { /* best-effort */ }
  }

  // Tamper check (R1 memo §1.5 / §4 Tennis-XGBoost defense).
  const tamper = verifyCriteriaUnchanged(repoRoot, baselineHash.hash);
  if (!tamper.ok) {
    return {
      ok: false,
      code: 'STEWARD_AUTORESEARCH_VERIFIER_TAMPERED',
      error: `criteria/policy file hash changed during run (baseline=${tamper.baselineHash.slice(0, 12)}, current=${tamper.currentHash.slice(0, 12)}); validation hacking suspected`,
      candidates,
      budget: { spent_usd: budget.spentUsd },
    };
  }

  // Filter to passing candidates first.
  const passing = candidates.filter((c) => c.ok);

  // Strategy collapse detection. R2 edge MAJOR: only run on passing candidates
  // with non-empty edits — otherwise N empty-edits failures all sketch to ()
  // and Jaccard(empty,empty)=1 → spurious "collapsed" alongside ALL_FAILED,
  // misleading the operator about the root cause.
  const collapseInputs = passing.length > 0
    ? passing.map((c) => ({ edits: c.edits || [] }))
    : [];
  const collapse = collapseInputs.length >= 2
    ? detectCollapse(collapseInputs, similarityThreshold)
    : { collapsed: false, pairs: [], allSimilar: false };

  if (passing.length === 0) {
    // Sprint 2.9.7: ensemble defense fired correctly — N candidates tried,
    // all rejected by spec-verifier OR npm test gate. Return shape stays
    // ok:false + same code (existing test contract intact) but exitCode:0
    // so cron dashboards don't false-fail when the ensemble protects us.
    return {
      ok: false,
      code: 'STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED',
      error: `none of the ${candidates.length} candidates passed spec-verifier + npm test`,
      candidates,
      collapse,
      budget: { spent_usd: budget.spentUsd },
      exitCode: 0,
    };
  }

  // If all candidates collapsed (above threshold) — surface as soft warning,
  // proceed with deduplicated set. The first passing candidate becomes the
  // winner without judge call (no qualitative diversity to judge between).
  if (collapse.collapsed && passing.length > 0) {
    const winner = passing[0];
    return {
      ok: true,
      mode: 'autoresearch',
      winner,
      winner_method: 'strategy_collapse_first_pass',
      collapse,
      candidates,
      judgeUsed: false,
      delta: null,
      budget: { spent_usd: budget.spentUsd },
      criteriaTamper: false,
    };
  }

  // Single passing candidate — no judge needed.
  if (passing.length === 1) {
    const winner = passing[0];
    const delta = checkDeltaAnomaly(slug, winner.spec_criteria_passed - 0, opts);
    return {
      ok: true,
      mode: 'autoresearch',
      winner,
      winner_method: 'sole_passing_candidate',
      collapse,
      candidates,
      judgeUsed: false,
      delta,
      budget: { spent_usd: budget.spentUsd },
      criteriaTamper: false,
    };
  }

  // 2+ passing candidates — judge call with both-orderings.
  // R2 blind BLOCKER + correctness MAJOR: replace `||` short-circuit on
  // winnerIndex (which collapses legitimate index 0 into a fake disagreement)
  // with explicit Number.isInteger guard; explicitly check forward.ok and
  // reverseOutcome.ok so a soft-fail judge (network error, malformed JSON)
  // routes through the spec-margin fallback with `judgeError` populated
  // instead of silently confusing the operator.
  let judgeOutcome;
  function pickIndexOrFallback(result) {
    if (result && result.ok !== false && Number.isInteger(result.winnerIndex)) {
      return { ok: true, idx: result.winnerIndex };
    }
    return { ok: false, error: result && (result.error || result.code) };
  }
  function specMarginPick(cands) {
    let bestIdx = 0;
    let bestPassed = -Infinity;
    for (let i = 0; i < cands.length; i += 1) {
      const passed = cands[i].spec_criteria_passed || 0;
      if (passed > bestPassed) {
        bestPassed = passed;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
  if (typeof deps.judge === 'function') {
    try {
      const forward = await deps.judge({ plan, candidates: passing, judgeModel, ordering: 'forward' });
      const reverseInput = passing.slice().reverse();
      const reverseOutcome = await deps.judge({ plan, candidates: reverseInput, judgeModel, ordering: 'reverse' });
      addCost(budget, (forward && forward.cost_usd) || 0);
      addCost(budget, (reverseOutcome && reverseOutcome.cost_usd) || 0);

      const fwd = pickIndexOrFallback(forward);
      const rev = pickIndexOrFallback(reverseOutcome);

      if (!fwd.ok || !rev.ok) {
        // Judge soft-failed (HTTP error, JSON parse failure, missing winner_index).
        // Fall back to spec-margin pick + record judgeError for operator visibility.
        const winnerIndex = specMarginPick(passing);
        judgeOutcome = {
          winnerIndex,
          method: 'spec_margin_fallback',
          candidate: passing[winnerIndex],
          judgeError: fwd.error || rev.error || 'judge soft-failure',
        };
      } else {
        const reversePickInForwardSpace = (passing.length - 1) - rev.idx;
        judgeOutcome = reconcileJudgeResults(fwd.idx, reversePickInForwardSpace, passing);
      }
    } catch (err) {
      // Judge call THREW (rare — deps.judge is supposed to soft-fail). Record
      // and pick by spec-margin.
      const winnerIndex = specMarginPick(passing);
      judgeOutcome = {
        winnerIndex,
        method: 'spec_margin_fallback',
        candidate: passing[winnerIndex],
        judgeError: err && err.message,
      };
    }
  } else {
    // No judge dep wired — soft fallback, pick by spec-margin.
    const winnerIndex = specMarginPick(passing);
    judgeOutcome = {
      winnerIndex,
      method: 'spec_margin_fallback',
      candidate: passing[winnerIndex],
      judgeSkipped: true,
    };
  }

  const winner = judgeOutcome.candidate;
  // R2 edge MAJOR: defensive — if reconcile somehow produced no candidate
  // (e.g. caller-induced edge case), refuse to produce a winner downstream.
  if (!winner) {
    return {
      ok: false,
      code: 'AUTORESEARCH_NO_WINNER',
      error: 'judge reconcile produced no candidate',
      candidates,
      collapse,
      budget: { spent_usd: budget.spentUsd },
    };
  }
  const delta = checkDeltaAnomaly(slug, winner.spec_criteria_passed || 0, opts);

  return {
    ok: true,
    mode: 'autoresearch',
    winner,
    winner_method: judgeOutcome.method,
    judgeUsed: !judgeOutcome.judgeSkipped,
    judgeDisagreement: judgeOutcome.judgeDisagreement || null,
    judgeError: judgeOutcome.judgeError || null,
    collapse,
    candidates,
    delta,
    budget: { spent_usd: budget.spentUsd },
    criteriaTamper: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Constants + clamps
  DEFAULT_N,
  MIN_N,
  MAX_N,
  DEFAULT_RUN_USD_CAP,
  DEFAULT_MAX_TIME_MIN,
  MAX_TIME_MIN_CLAMP,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_DELTA_ANOMALY_MULTIPLIER,
  // Env readers
  readN,
  readRunUsdCap,
  readMaxTimeMin,
  readJudgeModel,
  readSimilarityThreshold,
  readDeltaAnomalyMultiplier,
  // Strategy collapse detection
  diffSketch,
  jaccardSimilarity,
  detectCollapse,
  // Diversity prompts
  buildCandidateStrategies,
  // Hash check (validation hacking defense)
  hashCriteriaSnapshot,
  verifyCriteriaUnchanged,
  // Delta anomaly
  checkDeltaAnomaly,
  // Judge
  buildJudgePrompt,
  reconcileJudgeResults,
  // Run budget
  makeRunBudget,
  addCost,
  checkBudget,
  // Orchestrator
  runAutoresearch,
};
