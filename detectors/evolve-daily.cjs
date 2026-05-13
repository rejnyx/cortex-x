// detectors/evolve-daily.cjs — Sprint 2.19 daily "Dreaming" phase
//
// Pure-deterministic Phase A from prompts/cortex-evolve.md adapted for
// GHA-runner execution. Operates against the cortex-x repo's own
// insights/ + journal/ + cortex/ directories (NOT against operator-side
// $CORTEX_DATA_HOME, which only exists on the operator's machine).
//
// Phase A (the only phase suitable for daily cron):
//   1. Journal scan + schema validation
//   2. Insights stale-candidate flagging via mtime + thresholds
//   3. Per-day rollup emission to insights/proposals/<date>-daily-rollup.md
//
// No LLM. No network. Tier 0 cost: free.
//
// Terminology: industry slovník is "Dreaming" (OpenClaw) / "Auto Dream"
// (Anthropic) / "NREM+REM consolidation" (ICLM 2026). cortex-x's
// internal name is `cortex-evolve` (prompts/cortex-evolve.md); the
// action_kind `evolve_daily` wires this on a nightly cron and aligns
// with the industry vocabulary in user-facing docs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Match prompts/cortex-evolve.md A.1 schema: ts, project, tool,
// duration_ms, ok, summary. A schema violation = malformed entry; we
// don't reject the file, we flag the line via candidates[].
const REQUIRED_JOURNAL_FIELDS = ['ts'];

// Stale thresholds — config/evolve.yaml SSOT (kept in sync manually
// for v0; future Sprint 2.19.x will read the yaml at runtime).
const STALE_THRESHOLDS = {
  insight: { no_action_days: 30 },
  project_entry: { no_edit_days: 90, no_access_days: 60 },
  research_cache: { max_age_days: 180 },
};

function isJsonlFile(name) {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.jsonl$/i.test(name);
}

function safeReadDir(p) {
  try { return fs.readdirSync(p); } catch { return []; }
}

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function safeReadJsonl(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return { lines: 0, malformed: [] }; }
  const lines = content.split(/\r?\n/);
  const malformed = [];
  let valid = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const missing = REQUIRED_JOURNAL_FIELDS.filter((k) => !(k in obj));
      if (missing.length > 0) {
        malformed.push({ line: i + 1, reason: `missing fields: ${missing.join(', ')}` });
      } else {
        valid += 1;
      }
    } catch (e) {
      malformed.push({ line: i + 1, reason: `parse error: ${e.message.slice(0, 80)}` });
    }
  }
  return { lines: valid, malformed };
}

function ageInDays(mtimeMs, nowMs) {
  return Math.floor((nowMs - mtimeMs) / (24 * 60 * 60 * 1000));
}

/**
 * Run Phase A daily ingestion against cortex-x's own repo paths.
 * @param {object} opts
 * @param {string} [opts.repoRoot] - defaults to process.cwd()
 * @param {Date}   [opts.now]      - for deterministic tests
 * @returns {object} { journal_summary, stale_candidates, rollup_markdown }
 */
function runEvolveDaily(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const isoDate = now.toISOString().slice(0, 10);

  // Phase A.1 — journal scan
  const journalDir = path.join(repoRoot, 'journal');
  const journalFiles = safeReadDir(journalDir).filter(isJsonlFile);
  let totalEntries = 0;
  let totalMalformed = 0;
  const perProject = {};
  const malformedRefs = [];

  for (const f of journalFiles) {
    const full = path.join(journalDir, f);
    const parsed = safeReadJsonl(full);
    totalEntries += parsed.lines;
    totalMalformed += parsed.malformed.length;
    if (parsed.malformed.length > 0) {
      malformedRefs.push({ file: f, count: parsed.malformed.length, sample: parsed.malformed.slice(0, 3) });
    }
    // YYYY-MM-DD-<project>.jsonl — extract project segment
    const m = f.match(/^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.jsonl$/i);
    if (m) {
      perProject[m[1]] = (perProject[m[1]] || 0) + parsed.lines;
    }
  }

  const journalSummary = {
    files_scanned: journalFiles.length,
    total_entries: totalEntries,
    total_malformed: totalMalformed,
    per_project: perProject,
    malformed_refs: malformedRefs,
  };

  // Phase A.3 — mtime stale candidates over insights/ + cortex/projects/
  // (skip A.2 L1-core-index rebuild for v0; that's operator-side data and
  // not on the GHA runner.)
  const staleCandidates = [];

  // insights/ — files with no edit in N days
  const insightsDir = path.join(repoRoot, 'insights');
  for (const entry of safeReadDir(insightsDir)) {
    if (entry === 'proposals' || entry === 'README.md') continue;
    const full = path.join(insightsDir, entry);
    const st = safeStat(full);
    if (!st || !st.isFile()) continue;
    const age = ageInDays(st.mtimeMs, nowMs);
    if (age > STALE_THRESHOLDS.insight.no_action_days) {
      staleCandidates.push({
        kind: 'insight',
        path: `insights/${entry}`,
        age_days: age,
        threshold_days: STALE_THRESHOLDS.insight.no_action_days,
      });
    }
  }

  // cortex/projects/ — project-library entries
  const projectsDir = path.join(repoRoot, 'cortex', 'projects');
  for (const entry of safeReadDir(projectsDir)) {
    if (!entry.endsWith('.md') || entry === 'README.md') continue;
    const full = path.join(projectsDir, entry);
    const st = safeStat(full);
    if (!st || !st.isFile()) continue;
    const age = ageInDays(st.mtimeMs, nowMs);
    if (age > STALE_THRESHOLDS.project_entry.no_edit_days) {
      staleCandidates.push({
        kind: 'project_entry',
        path: `cortex/projects/${entry}`,
        age_days: age,
        threshold_days: STALE_THRESHOLDS.project_entry.no_edit_days,
      });
    }
  }

  // Phase A — emit per-day rollup as advisory markdown
  const rollupLines = [];
  rollupLines.push(`# Daily evolve rollup — ${isoDate}`);
  rollupLines.push('');
  rollupLines.push('> Generated by `evolve_daily` action_kind (Sprint 2.19). Phase A from prompts/cortex-evolve.md.');
  rollupLines.push('> Industry slovník: "Dreaming" (OpenClaw) / "Auto Dream" (Anthropic) / NREM+REM consolidation (ICLM 2026).');
  rollupLines.push('> No LLM call. Read-only scan + advisory rollup. No source edits.');
  rollupLines.push('');
  rollupLines.push('## Journal summary');
  rollupLines.push(`- files scanned: ${journalSummary.files_scanned}`);
  rollupLines.push(`- total valid entries: ${journalSummary.total_entries}`);
  rollupLines.push(`- malformed entries: ${journalSummary.total_malformed}`);
  if (Object.keys(perProject).length > 0) {
    rollupLines.push('');
    rollupLines.push('### Entries per project');
    for (const [proj, count] of Object.entries(perProject)) {
      rollupLines.push(`- ${proj}: ${count}`);
    }
  }
  rollupLines.push('');
  rollupLines.push('## Stale candidates');
  if (staleCandidates.length === 0) {
    rollupLines.push('_None — every tracked file is within freshness threshold._');
  } else {
    for (const c of staleCandidates) {
      rollupLines.push(`- \`${c.path}\` — ${c.kind} stale ${c.age_days}d (threshold ${c.threshold_days}d)`);
    }
  }
  rollupLines.push('');
  rollupLines.push('## Next steps (advisory)');
  rollupLines.push('- Weekly mining (Phase B) consolidates these signals into insight proposals — runs Sundays via `evolve_weekly` action_kind (Sprint 2.19 v1+).');
  rollupLines.push('- Stale candidates persist across daily runs until the operator touches the file OR explicitly archives it via `/cortex-reflect`.');
  rollupLines.push('');

  const rollupMarkdown = rollupLines.join('\n');

  return {
    ok: true,
    isoDate,
    journal_summary: journalSummary,
    stale_candidates: staleCandidates,
    rollup_markdown: rollupMarkdown,
  };
}

module.exports = {
  runEvolveDaily,
  STALE_THRESHOLDS,
  isJsonlFile,
  safeReadJsonl,
};
