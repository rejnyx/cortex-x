// action-kinds.cjs — Sprint 1.8.1 typed action_kind registry.
//
// The Hermes evolution roadmap (research synth 2026-05-07) calls for evolving
// from "single-shot recommendation processor" to a "quality colleague" with
// a tool palette of specialized capabilities (#1 dep-update, #2 flaky-test
// repair, #3 doc-drift, #4 TODO triage, #5 recommendation harvester, ...).
//
// Single-agent first (Anthropic + Google guidance 2026): keep ONE execute.cjs,
// add a typed action_kind field threaded through dry-run.cjs → execute.cjs.
// Each kind shares 95% of the pipeline (lock, journal, denylist, atomic
// commit, push, draft PR); only the LLM step + edit format differs per kind.
//
// This module is the registry. Adding a new capability (Sprint 1.8.2+) means:
//   1. Define entry below
//   2. Add detector in detectors/<kind>.cjs (read-only signal source)
//   3. Wire LLM step in execute.cjs switch (or skip-LLM for deterministic kinds)
//
// All Sprint 1.7.X / 1.6.X plans default to action_kind: "recommendation"
// (backwards-compatible — pre-1.8.1 plans had implicit kind = recommendation).

'use strict';

const ACTION_KINDS = {
  // ── Currently shipped (Sprint 1.6.13 → 1.7.7) ─────────────────────────
  recommendation: {
    description:
      'Standard cortex/recommendations.md item. LLM produces edits, gates on npm test, atomic commit, draft PR.',
    requires_llm: true,
    source: 'cortex/recommendations.md',
    detector: null, // recommendations.md is parsed directly by dry-run.cjs
    cost_envelope: 'normal', // ~$0.0008/run via deepseek-v4-flash
    blast_radius: 'medium', // arbitrary file edits; bounded by denylist
    shipped_in: '1.6.13',
  },

  // ── Future kinds (Sprint 1.8.X roadmap, declared but not implemented) ─
  // Adding a kind here BEFORE shipping the executor is intentional: lets us
  // version-pin the dispatcher contract without surprises later. Each entry
  // has `shipped_in: null` until the corresponding sprint lands.
  recommendation_harvest: {
    description:
      'Read closed PRs + CI failures + open issues, append candidate observations to recommendations.md. Read-only — no LLM, no edits to source code.',
    requires_llm: false,
    source: 'gh pr list --state closed + gh run list + gh issue list',
    detector: 'detectors/recommendation-harvest.cjs', // Sprint 1.8.2a
    cost_envelope: 'free', // no LLM call
    blast_radius: 'minimal', // appends to recommendations.md only
    shipped_in: '0.1.0', // Sprint 1.8.2c — executor wired in execute.cjs runHarvestAction
  },

  dep_update_patch: {
    description:
      'npm outdated → patch-only diffs → npm test gate → draft PR. Deterministic, no LLM call.',
    requires_llm: false,
    source: 'npm outdated --json',
    detector: 'detectors/dep-update-patch.cjs', // Sprint 1.8.4
    cost_envelope: 'free',
    blast_radius: 'medium', // package.json + lockfile + node_modules state
    shipped_in: '0.1.0', // Sprint 1.8.4
  },

  flaky_test_repair: {
    description:
      'Re-run failed tests N times, classify flaky vs real, auto-quarantine via .skip + linked issue. One LLM call per batch for issue body.',
    requires_llm: true,
    source: 'last npm test failure log',
    detector: null, // future: detectors/flaky-test-repair.cjs
    cost_envelope: 'low', // one LLM call per N flakies
    blast_radius: 'low', // adds .skip + opens GH issue; no logic change
    shipped_in: null, // Sprint 1.8.5
  },

  doc_drift: {
    description:
      'Diff exported APIs vs README/CLAUDE.md after merged PRs. LLM produces doc patches.',
    requires_llm: true,
    source: 'git diff exported symbols + README.md',
    detector: null, // future: detectors/doc-drift.cjs
    cost_envelope: 'normal',
    blast_radius: 'low', // doc-only edits
    shipped_in: null, // Sprint 1.8.6
  },

  todo_triage: {
    description:
      'Scan TODO/FIXME/XXX/HACK markers older than N days, dedupe vs open issues, file gh issues with git-blame context. Deterministic — no LLM call.',
    requires_llm: false, // deterministic body assembly; no LLM
    source: 'fs scan + git blame + gh issue list',
    detector: 'detectors/todo-triage.cjs', // Sprint 1.8.7
    cost_envelope: 'free',
    blast_radius: 'minimal', // gh issue create only; no file edits
    shipped_in: '0.1.0', // Sprint 1.8.7
  },

  // ReasoningBank-lite memory ISN'T an action_kind — it's a cross-cutting
  // memory module written by every kind on failure. Lives in cortex/hermes-lessons.jsonl.
  // See Sprint 1.8.3 design.
};

function getActionKind(name) {
  return ACTION_KINDS[name] || null;
}

function isSupportedKind(name) {
  return name != null && Object.prototype.hasOwnProperty.call(ACTION_KINDS, name);
}

function isShippedKind(name) {
  const k = getActionKind(name);
  return !!(k && k.shipped_in);
}

function listKinds() {
  return Object.keys(ACTION_KINDS);
}

function listShippedKinds() {
  return Object.keys(ACTION_KINDS).filter((k) => ACTION_KINDS[k].shipped_in);
}

const DEFAULT_KIND = 'recommendation';

module.exports = {
  ACTION_KINDS,
  DEFAULT_KIND,
  getActionKind,
  isSupportedKind,
  isShippedKind,
  listKinds,
  listShippedKinds,
};
