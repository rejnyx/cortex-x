'use strict';

// SSOT for the adversarial review-agent roster.
//
// Imported by:
//   post-tool-use.cjs        — marks a session "reviewed" when one of these
//                              subagent_types fires (writes the review marker)
//   pre-commit-review-gate.cjs — names them in the deny reason so the agent
//                              knows exactly which agents satisfy the gate
//
// Single source so the two halves never drift (a Set-only addition would
// silently keep commits blocked; a prose-only addition would lie). Keep in
// sync with agents/*.md — a test asserts this list matches the on-disk roster.
module.exports = {
  REVIEW_AGENTS: [
    'blind-hunter',
    'edge-case-hunter',
    'acceptance-auditor',
    'security-auditor',
    'correctness-auditor',
    'ssot-enforcer',
  ],
};
