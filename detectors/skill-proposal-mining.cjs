// detectors/skill-proposal-mining.cjs — Sprint 3.1 v0
//
// Pure-deterministic detector that surfaces SKILL.md proposal candidates
// from `journal/*.jsonl`. Distinct from Sprint 2.19 v1 weekly mining:
//
//   2.19 weekly → emits "a lesson should be added to lessons.jsonl"
//   3.1 v0      → emits "a NEW action_kind might be worth scaffolding"
//
// The detector is intentionally narrower than 2.19's miner — per Sprint
// 3.1 v0 R1 (`docs/research/sprint-3.1-self-extending-2026-05-13.md`):
//
//   1. Surface candidates to journal only — no LLM, no auto-scaffold
//   2. Operator manually flags via `cortex-propose-skill <id>` CLI
//   3. Only flagged candidates trigger LLM scaffolder + draft PR
//   4. Hard rate limit ≤1 proposal/week
//
// This is by design — DGM-style auto-rewrite-self is the cautionary tale.
// Anthropic skill-creator is operator-invoked (not agent-initiated).
// cortex-x v0 sits between the two: agent surfaces, operator decides.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_THRESHOLDS = Object.freeze({
  // Stricter than 2.19 mining (events=3 / projects=2 / span=7) — proposing
  // a NEW capability is higher-impact than recording a lesson.
  min_events: 5,
  min_projects: 1,        // single project OK for v0; multi-project Sprint 3.1.1
  min_days_span: 14,
  window_days: 30,        // longer window than 2.19's 14d — capabilities
                          // are slower-moving than lessons.
});

function isJournalFile(name) {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.jsonl$/i.test(name);
}

function projectFromFilename(name) {
  const m = name.match(/^\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\.jsonl$/i);
  return m ? m[1] : null;
}

function dateFromFilename(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}

/**
 * Mine candidate "new action_kind" proposals from journal entries.
 * Strategy: group failure events by (code, action_kind) over the window;
 * candidates that repeatedly fail in ways the EXISTING action_kinds
 * couldn't address are surfaced.
 *
 * v0 heuristic: a candidate is interesting if it has:
 *   - ≥ min_events failures
 *   - tagged with `propose_skill_candidate: true` in the journal OR
 *     the same root_cause × action_kind combination accumulates without
 *     any successful resolution (no `outcome: success` for same combo)
 *
 * @param {object} opts
 * @param {string} [opts.repoRoot]
 * @param {Date}   [opts.now]
 * @param {object} [opts.thresholds]
 */
function mineSkillProposals(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const now = opts.now instanceof Date ? opts.now : new Date();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };

  const journalDir = path.join(repoRoot, 'journal');
  let files;
  try { files = fs.readdirSync(journalDir).filter(isJournalFile); }
  catch { return { ok: true, candidates: [], window_files: 0, thresholds }; }

  const windowMs = thresholds.window_days * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;

  const candidates = new Map();
  let filesInWindow = 0;

  for (const f of files) {
    const isoDate = dateFromFilename(f);
    if (!isoDate) continue;
    const fileTimeMs = Date.parse(isoDate + 'T00:00:00Z');
    if (!Number.isFinite(fileTimeMs) || fileTimeMs < cutoff) continue;
    filesInWindow += 1;

    const project = projectFromFilename(f) || 'unknown';
    let content;
    try { content = fs.readFileSync(path.join(journalDir, f), 'utf8'); } catch { continue; }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      const code = evt.code || evt.root_cause || null;
      if (!code) continue;
      // Skip success outcomes — we're surfacing unresolved patterns.
      if (evt.outcome === 'success') continue;
      const aks = evt.action_kind || 'unknown';
      const key = `${code}::${aks}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          id: `proposal-${Buffer.from(key).toString('hex').slice(0, 16)}`,
          root_cause: code,
          original_action_kind: aks,
          events: 0,
          projects: new Set(),
          first_seen_iso: isoDate,
          last_seen_iso: isoDate,
          journal_refs: [],
          human_flagged: false,
        });
      }
      const c = candidates.get(key);
      c.events += 1;
      c.projects.add(project);
      if (c.first_seen_iso > isoDate) c.first_seen_iso = isoDate;
      if (c.last_seen_iso < isoDate) c.last_seen_iso = isoDate;
      if (c.journal_refs.length < 5) {
        c.journal_refs.push(`journal/${f}:${evt.ts || isoDate}`);
      }
      // Per R1 §5 mitigation — operator can flag a candidate by adding
      // `propose_skill_candidate: true` to a journal entry. v0 honors
      // the flag as a permission, not a trigger (CLI dispatch is the
      // actual trigger — see bin/cortex-propose-skill.cjs).
      if (evt.propose_skill_candidate === true) c.human_flagged = true;
    }
  }

  const surviving = [];
  for (const c of candidates.values()) {
    if (c.events < thresholds.min_events) continue;
    if (c.projects.size < thresholds.min_projects) continue;
    const firstMs = Date.parse(c.first_seen_iso + 'T00:00:00Z');
    const lastMs = Date.parse(c.last_seen_iso + 'T00:00:00Z');
    const spanDays = Math.floor((lastMs - firstMs) / (24 * 60 * 60 * 1000));
    if (spanDays < thresholds.min_days_span) continue;
    surviving.push({
      id: c.id,
      root_cause: c.root_cause,
      original_action_kind: c.original_action_kind,
      events: c.events,
      projects: [...c.projects].sort(),
      first_seen_iso: c.first_seen_iso,
      last_seen_iso: c.last_seen_iso,
      days_span: spanDays,
      journal_refs: c.journal_refs,
      human_flagged: c.human_flagged,
    });
  }

  // Sort by human_flagged desc, then events desc — flagged candidates
  // surface first regardless of event count.
  surviving.sort((a, b) => {
    if (a.human_flagged !== b.human_flagged) return a.human_flagged ? -1 : 1;
    return b.events - a.events;
  });

  return {
    ok: true,
    candidates: surviving,
    window_files: filesInWindow,
    thresholds,
  };
}

module.exports = {
  mineSkillProposals,
  isJournalFile,
  DEFAULT_THRESHOLDS,
};
