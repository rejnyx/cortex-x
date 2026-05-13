// bin/steward/_lib/evolve-action.cjs — Sprint 2.19 daily Dreaming handler
//
// Wraps detectors/evolve-daily.cjs and writes the per-day rollup to
// insights/proposals/<date>-evolve-daily.md. Read-only against source —
// only touches insights/proposals/ which is allow-listed for write
// under config/evolve.yaml `auto_improves`.
//
// Always returns skip_commit: true — the rollup is advisory, lands in
// insights/proposals/, no source edits, no PR opened. Weekly Phase B
// (mining) is a separate action_kind (deferred to 2.19 v1+).

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const detector = require('../../../detectors/evolve-daily.cjs');

/**
 * Run daily evolve / Dreaming phase.
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {string} [opts.slug]
 * @param {Date}   [opts.now] — for deterministic tests
 * @returns {Promise<object>}
 */
async function runEvolveDaily(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const slug = opts.slug || 'cortex-x';
  const now = opts.now || new Date();

  let result;
  try {
    result = detector.runEvolveDaily({ repoRoot, now });
  } catch (err) {
    return {
      ok: false,
      skip_commit: true,
      code: 'EVOLVE_DAILY_DETECTOR_THREW',
      error: `evolve_daily detector threw: ${err && err.message}`,
      touchedFiles: [],
    };
  }

  // Emit advisory rollup. Land in insights/proposals/ which is on the
  // auto_improves allow-list. Skip writing if proposals dir doesn't
  // exist — fail-open, don't create directories on the runner.
  const proposalsDir = path.join(repoRoot, 'insights', 'proposals');
  let writtenPath = null;
  if (fs.existsSync(proposalsDir)) {
    const fname = `${result.isoDate}-evolve-daily.md`;
    const full = path.join(proposalsDir, fname);
    try {
      fs.writeFileSync(full, result.rollup_markdown, 'utf8');
      writtenPath = path.relative(repoRoot, full).replace(/\\/g, '/');
    } catch (err) {
      // Write failure → keep going. Rollup still surfaces via journal.
    }
  }

  return {
    ok: true,
    skip_commit: true,
    no_work: result.stale_candidates.length === 0 && result.journal_summary.total_malformed === 0,
    isoDate: result.isoDate,
    slug,
    summary: writtenPath
      ? `evolve_daily wrote rollup → ${writtenPath} (${result.journal_summary.files_scanned} journal files, ${result.stale_candidates.length} stale, ${result.journal_summary.total_malformed} malformed)`
      : `evolve_daily ran (${result.journal_summary.files_scanned} journal files, ${result.stale_candidates.length} stale, ${result.journal_summary.total_malformed} malformed) — no rollup written (insights/proposals/ absent)`,
    rollup_path: writtenPath,
    stale_count: result.stale_candidates.length,
    malformed_count: result.journal_summary.total_malformed,
    journal_files_scanned: result.journal_summary.files_scanned,
    journal_total_entries: result.journal_summary.total_entries,
    touchedFiles: [],
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
  };
}

module.exports = {
  runEvolveDaily,
};
