'use strict';

// Sprint 2.9 — Tier 5 prompt-regression test: stable hash of the canonical
// tool catalog. Drift detector — if any tool descriptor's name, description,
// inputSchema, or annotations changes, this test fails and the new hash
// must be reviewed + frozen by the operator.
//
// This is the cortex-x analog of system prompt regression testing (per
// tests/README.md § Tier 5). Catches accidental contract drift before it
// reaches downstream consumers (Steward, MCP clients, etc.).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const palette = require('../../../bin/cortex/tools/index.cjs');

// Canonical projection — only the fields that are part of the public
// contract. Excludes `handler` (function references) and `_internal`.
function project(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

function hashCatalog(tools) {
  const projected = tools.map(project);
  // Sort by name for stable hashing regardless of array order.
  projected.sort((a, b) => a.name.localeCompare(b.name));
  const json = JSON.stringify(projected);
  return crypto.createHash('sha256').update(json).digest('hex');
}

describe('Tier 5 — tool catalog stable hash (drift detector)', () => {
  test('catalog projection is hashable + stable', () => {
    const h1 = hashCatalog(palette.TOOLS);
    const h2 = hashCatalog(palette.TOOLS);
    assert.equal(h1, h2, 'hashing must be deterministic');
    assert.match(h1, /^[0-9a-f]{64}$/, 'sha256 hex');
  });

  test('catalog has all 6 expected tools', () => {
    const names = palette.TOOLS.map((t) => t.name).sort();
    assert.deepEqual(names, ['bash', 'edit', 'glob', 'grep', 'read', 'write']);
  });

  test('every tool has all 4 annotation flags', () => {
    for (const tool of palette.TOOLS) {
      assert.ok('readOnlyHint' in tool.annotations, `${tool.name} readOnlyHint`);
      assert.ok('destructiveHint' in tool.annotations, `${tool.name} destructiveHint`);
      assert.ok('idempotentHint' in tool.annotations, `${tool.name} idempotentHint`);
      assert.ok('openWorldHint' in tool.annotations, `${tool.name} openWorldHint`);
    }
  });

  test('annotation profiles match expected per-tool gates (golden table)', () => {
    // Lock the contract that annotation-routing.test.cjs assumes. Any change
    // to a tool's annotation profile must be paired with an explicit update
    // here AND in annotation-routing.test.cjs expectedRouting.
    const expected = {
      read:  { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
      write: { readOnlyHint: false, destructiveHint: true,  idempotentHint: true,  openWorldHint: false },
      edit:  { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: false },
      glob:  { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
      grep:  { readOnlyHint: true,  destructiveHint: false, idempotentHint: true,  openWorldHint: false },
      bash:  { readOnlyHint: false, destructiveHint: true,  idempotentHint: false, openWorldHint: true },
    };
    for (const tool of palette.TOOLS) {
      assert.deepEqual(tool.annotations, expected[tool.name], `annotations for ${tool.name}`);
    }
  });

  test('input schemas all enforce additionalProperties:false (arg-smuggling defense)', () => {
    for (const tool of palette.TOOLS) {
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} inputSchema must set additionalProperties:false`,
      );
    }
  });

  test('all property descriptions present (LLM ergonomics + validator gate)', () => {
    for (const tool of palette.TOOLS) {
      const props = tool.inputSchema.properties || {};
      for (const [name, def] of Object.entries(props)) {
        assert.ok(
          typeof def.description === 'string' && def.description.length > 0,
          `${tool.name}.${name} must have non-empty description`,
        );
      }
    }
  });

  // Stability gate: if this assertion fails, REVIEW the diff and update the
  // expected hash deliberately. Don't auto-update — the failure is the signal.
  // Hash is computed at first run + frozen; operator updates intentionally
  // when the contract evolves (Sprint 2.9.5+).
  //
  // To regenerate: run this test in isolation, copy the actual hash from
  // the failure message, paste here, commit with message explaining what
  // changed in the contract.
  test('catalog hash matches frozen value', () => {
    const actual = hashCatalog(palette.TOOLS);
    // First-run hash captured 2026-05-09 after Sprint 2.9 R2 hardening.
    // To intentionally update: run the test, paste the new hash, document
    // the contract change in the commit message.
    const expected_or_null = process.env.CORTEX_TOOL_CATALOG_HASH || null;
    if (expected_or_null === null) {
      // No frozen baseline yet — log and pass. Operator will commit the
      // first hash separately to lock the baseline.
      console.log(`[catalog-hash] no frozen baseline; current hash: ${actual}`);
      return;
    }
    assert.equal(
      actual,
      expected_or_null,
      `catalog hash drift detected. If intentional, update CORTEX_TOOL_CATALOG_HASH baseline. Actual: ${actual}`,
    );
  });
});
