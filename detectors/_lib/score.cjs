// cortex-x detector scoring library.
//
// Shared scoring logic used by detect-profile.cjs, detect-stack.cjs, detect-stage.cjs.
// Pure functions, no I/O, no external deps.
//
// Contract per auto-optimization.md:
//   - Deterministic
//   - Fail-open (return [] on invalid input, never throw)
//   - Evidence-backed (every score carries the signals that produced it)

'use strict';

/**
 * Score a candidate against a set of required + optional signals.
 *
 * @param {object} candidate Candidate object with `detect:` block
 * @param {object} signals   Observed signals from the project
 * @returns {object}         { score: 0..1, evidence: string[], matched: string[], missed: string[] }
 */
function scoreCandidate(candidate, signals) {
  const result = { score: 0, evidence: [], matched: [], missed: [] };
  if (!candidate || !candidate.detect) return result;

  const detect = candidate.detect;
  let weight = 0;
  let earned = 0;

  // package.json dependencies — weight 40% of score
  const wantDeps = (detect.package_json && detect.package_json.dependencies) || [];
  if (wantDeps.length > 0) {
    weight += 0.4;
    const depHits = wantDeps.filter(d => signals.deps && signals.deps.has(d));
    const ratio = depHits.length / wantDeps.length;
    earned += 0.4 * ratio;
    if (depHits.length > 0) {
      result.matched.push(`deps:${depHits.join(',')}`);
      result.evidence.push(`${depHits.length}/${wantDeps.length} expected deps present`);
    }
    const depMisses = wantDeps.filter(d => !signals.deps || !signals.deps.has(d));
    if (depMisses.length > 0) {
      result.missed.push(`missing-deps:${depMisses.join(',')}`);
    }
  }

  // Folder/file patterns — weight 30% of score
  const wantFiles = detect.files || [];
  if (wantFiles.length > 0) {
    weight += 0.3;
    const fileHits = wantFiles.filter(f => signals.files && signals.files.has(f));
    const ratio = fileHits.length / wantFiles.length;
    earned += 0.3 * ratio;
    if (fileHits.length > 0) {
      result.matched.push(`files:${fileHits.join(',')}`);
      result.evidence.push(`${fileHits.length}/${wantFiles.length} expected paths present`);
    }
    const fileMisses = wantFiles.filter(f => !signals.files || !signals.files.has(f));
    if (fileMisses.length > 0) {
      result.missed.push(`missing-paths:${fileMisses.join(',')}`);
    }
  }

  // Config files (e.g., next.config.*, tauri.conf.json) — weight 20%
  const wantConfig = detect.config_files || [];
  if (wantConfig.length > 0) {
    weight += 0.2;
    const configHits = wantConfig.filter(c => signals.configs && signals.configs.has(c));
    const ratio = configHits.length / wantConfig.length;
    earned += 0.2 * ratio;
    if (configHits.length > 0) {
      result.matched.push(`configs:${configHits.join(',')}`);
      result.evidence.push(`${configHits.length}/${wantConfig.length} config files present`);
    }
  }

  // Negative signals (if present, penalize) — weight 10%
  const negative = detect.negative_signals || [];
  if (negative.length > 0) {
    weight += 0.1;
    const hits = negative.filter(n => (
      (signals.deps && signals.deps.has(n)) ||
      (signals.files && signals.files.has(n))
    ));
    if (hits.length === 0) earned += 0.1;
    else result.evidence.push(`negative-signals-present:${hits.join(',')}`);
  }

  // Normalize — if nothing to score against, confidence is 0 (no signal)
  if (weight === 0) {
    result.score = 0;
    result.evidence.push('no-signals-defined-in-profile');
    return result;
  }

  result.score = Math.round((earned / weight) * 100) / 100;
  return result;
}

/**
 * Rank candidates by score, return sorted descending.
 * Ties broken by number of matched signals (more = higher).
 */
function rankCandidates(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter(r => r && typeof r.score === 'number')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.matched ? b.matched.length : 0) - (a.matched ? a.matched.length : 0);
    });
}

/**
 * Classify confidence level for decision routing.
 *   >= 0.9  → "high"      (auto-apply eligible)
 *   0.6-0.9 → "medium"    (suggest, let Claude surface)
 *   0.3-0.6 → "low"       (ambiguous, GUIDE the user)
 *   < 0.3   → "none"      (no signal, ignore)
 */
function confidenceLevel(score) {
  if (!Number.isFinite(score)) return 'none';
  if (score >= 0.9) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.3) return 'low';
  return 'none';
}

module.exports = {
  scoreCandidate,
  rankCandidates,
  confidenceLevel,
};
