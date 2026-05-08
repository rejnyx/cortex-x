'use strict';

/**
 * Contract test — routing-table.cjs ↔ action-kinds.cjs SSOT (Sprint 2.0b).
 *
 * SSOT-enforcer MAJOR finding 2026-05-08: routing-table forward-declares
 * action_kinds (architecture_review, security_review) that don't exist in
 * action-kinds.cjs. This is intentional (forward-decl so the dispatcher
 * contract is stable when 2.1+ adds executor branches), but the contract
 * needs an explicit test so we don't drift in the other direction —
 * shipping an LLM kind in action-kinds.cjs without a routing-table entry.
 *
 * Two invariants:
 *   1. Every kind in ACTION_KINDS that has `requires_llm: true` MUST
 *      appear in ROUTING_TABLE. Otherwise the new LLM kind silently uses
 *      the engine's DEFAULT_MODEL fallback instead of routed model.
 *   2. Every kind in ROUTING_TABLE that's NOT in ACTION_KINDS MUST be on
 *      the explicit forward-declaration list (today: architecture_review,
 *      security_review, release_notes_drafter).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const routing = require('../../bin/steward/_lib/routing-table.cjs');
const actionKinds = require('../../bin/steward/_lib/action-kinds.cjs');

// Forward-declared kinds: routing-table entry exists, action-kinds.cjs
// either has matching declaration or the kind is reserved for a future
// sprint. release_notes_drafter is already declared in action-kinds.cjs
// (shipped_in: null) so it lives here too.
const FORWARD_DECLARED_KINDS = new Set([
  'architecture_review',
  'security_review',
]);

describe('routing-table ↔ action-kinds SSOT', () => {
  test('every requires_llm action_kind has a routing-table entry', () => {
    for (const [name, def] of Object.entries(actionKinds.ACTION_KINDS)) {
      if (def.requires_llm !== true) continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(routing.ROUTING_TABLE, name),
        `action_kind '${name}' has requires_llm:true but no routing-table entry — silent DEFAULT_MODEL fallback risk`,
      );
    }
  });

  test('routing-table kinds either exist in action-kinds or are forward-declared', () => {
    for (const name of Object.keys(routing.ROUTING_TABLE)) {
      const inRegistry = Object.prototype.hasOwnProperty.call(actionKinds.ACTION_KINDS, name);
      const inForwardDecl = FORWARD_DECLARED_KINDS.has(name);
      assert.ok(
        inRegistry || inForwardDecl,
        `routing-table entry '${name}' has no action-kinds.cjs declaration AND is not on the FORWARD_DECLARED_KINDS list — drift`,
      );
    }
  });

  test('every shipped LLM action_kind has all 4 profile slots populated', () => {
    for (const [name, def] of Object.entries(actionKinds.ACTION_KINDS)) {
      if (def.requires_llm !== true) continue;
      if (!def.shipped_in) continue; // unshipped — table can be sparse
      const entry = routing.ROUTING_TABLE[name];
      assert.ok(entry, `shipped LLM kind '${name}' missing routing entry`);
      for (const profile of routing.listProfiles()) {
        assert.ok(
          entry[profile] !== undefined,
          `shipped LLM kind '${name}' missing profile slot '${profile}'`,
        );
      }
    }
  });

  test('isLLMKind matches action-kinds requires_llm for every registered kind', () => {
    for (const [name, def] of Object.entries(actionKinds.ACTION_KINDS)) {
      const fromActionKinds = def.requires_llm === true;
      const fromRoutingTable = routing.isLLMKind(name);
      // Forward-declared kinds (architecture_review, security_review) are
      // in routing-table but not action-kinds yet — skip them (they'll be
      // flagged by the previous test if they hit the LLM dispatch path
      // before being registered).
      if (FORWARD_DECLARED_KINDS.has(name)) continue;
      assert.equal(
        fromRoutingTable,
        fromActionKinds,
        `isLLMKind('${name}') ${fromRoutingTable} doesn't match action-kinds requires_llm ${fromActionKinds}`,
      );
    }
  });
});
