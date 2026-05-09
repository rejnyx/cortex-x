'use strict';

// Sprint 2.9 — annotation routing helper.
// Maps MCP tool annotations onto cortex-x existing safety mechanics so that
// any runtime consuming a cortex-x tool descriptor can know which gates to
// apply BEFORE invoking the handler.
//
// This module is the integration point between Sprint 2.9 (tool descriptors)
// and Sprint 1.9.0 (spec-verifier) + 1.9.1 (cost windows) + halt-check.
// It is INTENTIONALLY a pure-logic router; it doesn't touch action-engine.cjs
// directly. Steward's action-engine consumes this when an action_kind refs
// a tool descriptor (Sprint 2.9.5+ wiring).

// Annotation → required gates table.
// Each entry returns the minimum set of pre-invocation gates a runtime
// must apply for the given annotation profile. Values are cumulative; the
// caller unions all applicable gates.
const GATE_MATRIX = Object.freeze({
  // readOnlyHint: when true, skip write-side gates.
  readOnlyHint_true: Object.freeze([
    'no_halt_check_required',
    'no_journal_write_trailer_required',
  ]),
  readOnlyHint_false: Object.freeze([
    'halt_check_required',
    'journal_write_trailer_required',
  ]),
  // destructiveHint: when true, mandatory acceptance criteria gate (Sprint 1.9.0).
  destructiveHint_true: Object.freeze([
    'spec_verifier_required',
    'acceptance_criteria_mandatory',
    'policy_check_required',
  ]),
  destructiveHint_false: Object.freeze([]),
  // idempotentHint: when true, safe to retry transient failures.
  idempotentHint_true: Object.freeze(['retry_on_transient_safe']),
  idempotentHint_false: Object.freeze(['retry_on_transient_unsafe']),
  // openWorldHint: when true, network access; cost windows apply.
  openWorldHint_true: Object.freeze([
    'cost_window_daily_required',
    'cost_window_weekly_required',
    'cost_window_monthly_required',
    'token_velocity_cap_required',
  ]),
  openWorldHint_false: Object.freeze([]),
});

// Return the set of gates required for a descriptor's annotation profile.
function requiredGates(descriptor) {
  if (!descriptor || !descriptor.annotations) {
    // Fail-closed: missing annotations = treat as fully destructive + open-world.
    return new Set([
      'halt_check_required',
      'journal_write_trailer_required',
      'spec_verifier_required',
      'acceptance_criteria_mandatory',
      'policy_check_required',
      'retry_on_transient_unsafe',
      'cost_window_daily_required',
      'cost_window_weekly_required',
      'cost_window_monthly_required',
      'token_velocity_cap_required',
    ]);
  }
  const a = descriptor.annotations;
  const set = new Set();
  for (const gate of GATE_MATRIX[`readOnlyHint_${a.readOnlyHint === true}`] || []) set.add(gate);
  for (const gate of GATE_MATRIX[`destructiveHint_${a.destructiveHint === true}`] || []) set.add(gate);
  for (const gate of GATE_MATRIX[`idempotentHint_${a.idempotentHint === true}`] || []) set.add(gate);
  for (const gate of GATE_MATRIX[`openWorldHint_${a.openWorldHint === true}`] || []) set.add(gate);
  // Reconcile: readOnlyHint=true overrides write-side gates UNLESS destructive=true
  // (which the descriptor validator already rejects as inconsistent).
  if (a.readOnlyHint === true) {
    set.delete('halt_check_required');
    set.delete('journal_write_trailer_required');
  }
  return set;
}

// Convenience predicates for common runtime questions.
function requiresSpecVerifier(descriptor) {
  return requiredGates(descriptor).has('spec_verifier_required');
}

function requiresHaltCheck(descriptor) {
  return requiredGates(descriptor).has('halt_check_required');
}

function requiresCostWindows(descriptor) {
  return requiredGates(descriptor).has('cost_window_daily_required');
}

function isSafeToRetry(descriptor) {
  return requiredGates(descriptor).has('retry_on_transient_safe');
}

// Build a human-readable routing report for journal/lesson/PR-body rendering.
// Used by Steward's `status --tools` (Sprint 2.9.5) and as input to the
// PR-body renderer (Sprint 1.9.1 follow-up).
function explainRouting(descriptor) {
  const gates = requiredGates(descriptor);
  const lines = [
    `tool: ${descriptor.name}`,
    `annotations: readOnly=${descriptor.annotations.readOnlyHint} destructive=${descriptor.annotations.destructiveHint} idempotent=${descriptor.annotations.idempotentHint} openWorld=${descriptor.annotations.openWorldHint}`,
    `gates required (${gates.size}):`,
  ];
  for (const g of Array.from(gates).sort()) lines.push(`  - ${g}`);
  return lines.join('\n');
}

module.exports = {
  requiredGates,
  requiresSpecVerifier,
  requiresHaltCheck,
  requiresCostWindows,
  isSafeToRetry,
  explainRouting,
  GATE_MATRIX,
};
