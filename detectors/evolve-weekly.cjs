// detectors/evolve-weekly.cjs — Sprint 2.19 v1
//
// Weekly mining phase (B.1.1 from prompts/cortex-evolve.md) — pure-
// deterministic candidate harvest from journal/*.jsonl entries across
// the trailing 14-day window. Identifies repeated-mistake patterns:
// {error_code, action_kind} pairs that fire ≥ min_events times across
// ≥ min_projects distinct project slugs within ≥ min_days_span days.
//
// Surviving candidates pass to LLM validation (Phase B.3) in
// evolve-weekly-action.cjs. v1 scope: repeated-mistake detection only.
// PrefixSpan sequence mining (B.1.2) + cross-project pattern transfer
// (B.1.3) deferred to v1.5+.
//
// SSOT for thresholds: config/evolve.yaml `evidence_gates`.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_THRESHOLDS = Object.freeze({
  min_events: 3,
  min_projects: 2,
  min_days_span: 7,
  window_days: 14,
});

function isJournalFile(name) {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.jsonl$/i.test(name);
}

function parseJournalLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function dateFromJournalFilename(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

function projectFromJournalFilename(name) {
  const m = name.match(/^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.jsonl$/i);
  return m ? m[1] : null;
}

/**
 * Mine weekly candidates from journal entries across all projects.
 * Returns repeated-mistake candidates keyed by (root_cause, action_kind).
 *
 * @param {object} opts
 * @param {string} [opts.repoRoot] — defaults to process.cwd()
 * @param {Date}   [opts.now]      — for deterministic tests
 * @param {object} [opts.thresholds] — override min_events / min_projects / min_days_span / window_days
 */
function mineWeeklyCandidates(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const now = opts.now instanceof Date ? opts.now : new Date();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };

  const journalDir = path.join(repoRoot, 'journal');
  let files;
  try { files = fs.readdirSync(journalDir).filter(isJournalFile); }
  catch { return { ok: true, candidates: [], window_files: 0, total_events: 0, thresholds }; }

  const windowMs = thresholds.window_days * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;

  // candidates keyed by `${root_cause}::${action_kind}`
  const candidates = new Map();
  let totalEvents = 0;
  let filesInWindow = 0;

  for (const f of files) {
    const isoDate = dateFromJournalFilename(f);
    if (!isoDate) continue;
    const fileTimeMs = Date.parse(isoDate + 'T00:00:00Z');
    if (!Number.isFinite(fileTimeMs) || fileTimeMs < cutoff) continue;
    filesInWindow += 1;

    const project = projectFromJournalFilename(f) || 'unknown';
    let content;
    try { content = fs.readFileSync(path.join(journalDir, f), 'utf8'); } catch { continue; }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const evt = parseJournalLine(line);
      if (!evt) continue;
      totalEvents += 1;
      // Look for failure-shaped events: outcome=failure OR code present
      const code = evt.code || evt.root_cause || null;
      if (!code) continue;
      if (evt.outcome === 'success') continue;
      const actionKind = evt.action_kind || 'recommendation';
      const key = `${code}::${actionKind}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          root_cause: code,
          action_kind: actionKind,
          events: 0,
          projects: new Set(),
          first_seen_iso: isoDate,
          last_seen_iso: isoDate,
          journal_refs: [], // first 3 references (citations)
        });
      }
      const c = candidates.get(key);
      c.events += 1;
      c.projects.add(project);
      if (c.first_seen_iso > isoDate) c.first_seen_iso = isoDate;
      if (c.last_seen_iso < isoDate) c.last_seen_iso = isoDate;
      if (c.journal_refs.length < 3) {
        c.journal_refs.push(`journal/${f}:${evt.ts || isoDate}`);
      }
    }
  }

  // Apply evidence gates (Phase B.2 deterministic checks).
  const surviving = [];
  for (const c of candidates.values()) {
    if (c.events < thresholds.min_events) continue;
    if (c.projects.size < thresholds.min_projects) continue;
    const firstMs = Date.parse(c.first_seen_iso + 'T00:00:00Z');
    const lastMs = Date.parse(c.last_seen_iso + 'T00:00:00Z');
    const spanDays = Math.floor((lastMs - firstMs) / (24 * 60 * 60 * 1000));
    if (spanDays < thresholds.min_days_span) continue;
    surviving.push({
      root_cause: c.root_cause,
      action_kind: c.action_kind,
      events: c.events,
      projects: [...c.projects].sort(),
      first_seen_iso: c.first_seen_iso,
      last_seen_iso: c.last_seen_iso,
      days_span: spanDays,
      journal_refs: c.journal_refs,
    });
  }

  // Sort by events DESC, then by projects-count DESC (stable order for
  // deterministic top-K selection downstream).
  surviving.sort((a, b) => b.events - a.events || b.projects.length - a.projects.length);

  return {
    ok: true,
    candidates: surviving,
    window_files: filesInWindow,
    total_events: totalEvents,
    thresholds,
  };
}

module.exports = {
  mineWeeklyCandidates,
  isJournalFile,
  parseJournalLine,
  DEFAULT_THRESHOLDS,
};
