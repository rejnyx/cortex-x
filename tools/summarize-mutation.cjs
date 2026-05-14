#!/usr/bin/env node
// tools/summarize-mutation.cjs — Sprint 2.3.1 R2 hardening extract.
//
// Reads Stryker's reports/mutation/mutation.json and emits a one-line
// score notice + GitHub Actions step summary. Replaces the inline
// `node -e` shell-interpolated JS in .github/workflows/stryker.yml,
// which R2 flagged as a fragile injection pattern (HIGH-4).
//
// Fixed input path (not configurable) so there is no operator-supplied
// path-injection surface. Exit 0 unconditionally — measure-only posture
// per Sprint 2.3 v0; the GHA "warning" annotation is for visibility, not
// gating.
//
// Usage from CI:
//   node tools/summarize-mutation.cjs
//
// Outputs:
//   stdout: nothing (uses ::notice + step-summary GH annotations)
//   exit:   0 on success, 0 on missing file (degraded notice), 2 on internal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_PATH = path.join('reports', 'mutation', 'mutation.json');
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;

function emitAnnotation(level, title, message) {
  process.stdout.write(`::${level} title=${title}::${message}\n`);
}

function appendSummary(text) {
  if (!STEP_SUMMARY) return;
  try {
    fs.appendFileSync(STEP_SUMMARY, text + '\n');
  } catch (e) {
    process.stderr.write(`Warning: failed to write GITHUB_STEP_SUMMARY: ${e.message}\n`);
  }
}

function extractScore(report) {
  // Stryker report shape: { systemUnderTestMetrics: { metrics: { mutationScore } } }
  // OR top-level: { metrics: { mutationScore } } for older versions.
  const candidates = [
    report && report.systemUnderTestMetrics && report.systemUnderTestMetrics.metrics,
    report && report.metrics,
  ].filter(Boolean);
  for (const m of candidates) {
    if (typeof m.mutationScore === 'number' && Number.isFinite(m.mutationScore)) {
      return m.mutationScore;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    emitAnnotation('warning', 'Mutation Score', `No report found at ${REPORT_PATH}`);
    return 0;
  }
  let report;
  try {
    const raw = fs.readFileSync(REPORT_PATH, 'utf8');
    report = JSON.parse(raw);
  } catch (e) {
    emitAnnotation('error', 'Mutation Score', `Failed to parse ${REPORT_PATH}: ${e.message}`);
    return 0;
  }
  const score = extractScore(report);
  if (score === null) {
    emitAnnotation('warning', 'Mutation Score', 'Report missing metrics.mutationScore field');
    return 0;
  }
  const fmt = score.toFixed(2);
  emitAnnotation('notice', 'Mutation Score', `${fmt}% (measure-only — Sprint 2.3 v0)`);
  appendSummary(`# Mutation Score: ${fmt}%\n`);
  appendSummary('');
  appendSummary('Threshold posture: `break: null` (measure-only). Switch to ratchet after 2-week baseline period.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    process.stderr.write(`Internal error: ${e && e.message}\n`);
    process.exit(2);
  }
}

module.exports = { main, extractScore };
