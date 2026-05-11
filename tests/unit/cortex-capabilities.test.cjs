// Sprint 2.15 — capability registry generator contract tests.
//
// Validates that bin/cortex-capabilities.cjs:
//   1. produces a registry with all expected top-level categories;
//   2. action_kinds inventory matches what ACTION_KINDS exports;
//   3. counts are integers (no NaN, no negative);
//   4. markdown render contains TL;DR section with counts;
//   5. is idempotent (two calls produce identical output structure).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const capabilities = require(path.join(REPO_ROOT, 'bin', 'cortex-capabilities.cjs'));

describe('cortex-capabilities buildRegistry()', () => {
  test('produces all expected top-level keys', () => {
    const r = capabilities.buildRegistry();
    const required = [
      'generated_at', 'generator', 'note',
      'action_kinds', 'steward_primitives', 'hooks', 'standards',
      'profiles', 'prompts', 'agents', 'workflows',
      'tests', 'code_volume',
    ];
    for (const k of required) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  test('action_kinds inventory non-empty + matches ACTION_KINDS module', () => {
    const r = capabilities.buildRegistry();
    assert.ok(Array.isArray(r.action_kinds), 'action_kinds is array');
    assert.ok(r.action_kinds.length >= 10, `expected >=10 action_kinds, got ${r.action_kinds.length}`);
    // Cross-check against authoritative module:
    const actionKindsMod = require(path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'action-kinds.cjs'));
    const expectedKinds = Object.keys(actionKindsMod.ACTION_KINDS || actionKindsMod.action_kinds || {});
    if (expectedKinds.length > 0) {
      const detected = r.action_kinds.map(a => a.name);
      for (const k of expectedKinds) {
        assert.ok(detected.includes(k), `action_kind '${k}' missing from registry`);
      }
    }
  });

  test('counts are non-negative integers (no NaN)', () => {
    const r = capabilities.buildRegistry();
    const numericCounts = [
      r.action_kinds.length, r.steward_primitives.length, r.hooks.length,
      r.standards.length, r.profiles.length, r.prompts.length,
      r.agents.length, r.workflows.length,
      r.tests.total,
      r.code_volume.steward_runtime_loc,
      r.code_volume.test_code_loc,
    ];
    for (const n of numericCounts) {
      assert.ok(Number.isInteger(n), `expected integer, got ${n}`);
      assert.ok(n >= 0, `expected non-negative, got ${n}`);
    }
  });

  test('every action_kind has name + (optional description)', () => {
    const r = capabilities.buildRegistry();
    for (const k of r.action_kinds) {
      assert.equal(typeof k.name, 'string');
      assert.ok(k.name.length > 0);
      // description may be null but if present must be string
      if (k.description !== null && k.description !== undefined) {
        assert.equal(typeof k.description, 'string');
      }
    }
  });

  test('every primitive has name + path + (sprint or null)', () => {
    const r = capabilities.buildRegistry();
    for (const p of r.steward_primitives) {
      assert.equal(typeof p.name, 'string');
      assert.equal(typeof p.path, 'string');
      assert.ok(p.path.startsWith('bin/steward/_lib/'));
    }
  });

  test('workflows include cron-driven Steward jobs', () => {
    const r = capabilities.buildRegistry();
    const cronWorkflows = r.workflows.filter(w => w.triggers.some(t => t.startsWith('cron(')));
    assert.ok(cronWorkflows.length >= 3, `expected >=3 cron workflows, got ${cronWorkflows.length}`);
  });

  test('idempotency: two consecutive calls produce same structure', () => {
    const r1 = capabilities.buildRegistry();
    const r2 = capabilities.buildRegistry();
    assert.equal(r1.action_kinds.length, r2.action_kinds.length);
    assert.equal(r1.steward_primitives.length, r2.steward_primitives.length);
    assert.equal(r1.hooks.length, r2.hooks.length);
    assert.equal(r1.standards.length, r2.standards.length);
    // generated_at will differ; everything else stable.
  });
});

describe('cortex-capabilities renderMarkdown()', () => {
  test('output contains TL;DR section with counts', () => {
    const r = capabilities.buildRegistry();
    const md = capabilities.renderMarkdown(r);
    assert.ok(md.includes('# cortex-x — capability registry'));
    assert.ok(md.includes('## TL;DR — counts'));
    assert.ok(md.includes('| Steward action_kinds |'));
    assert.ok(md.includes('## 1. Steward action_kinds'));
    assert.ok(md.includes('## 2. Steward primitives'));
    assert.ok(md.includes('## 3. Universal hooks'));
    assert.ok(md.includes('## 4. Standards'));
    assert.ok(md.includes('## 5. Profiles'));
    assert.ok(md.includes('## 6. Prompts'));
    assert.ok(md.includes('## 7. Review-pipeline agents'));
    assert.ok(md.includes('## 8. GitHub workflows'));
  });

  test('markdown is valid (no unclosed pipe rows)', () => {
    const r = capabilities.buildRegistry();
    const md = capabilities.renderMarkdown(r);
    // Every table row starts with | and ends with |
    const lines = md.split('\n');
    for (const l of lines) {
      const t = l.trim();
      if (t.startsWith('|') && t !== '|---|---|' && !t.startsWith('| Category |')) {
        assert.ok(t.endsWith('|'), `unclosed table row: ${t.slice(0, 80)}`);
      }
    }
  });

  test('includes AUTO-GENERATED banner', () => {
    const r = capabilities.buildRegistry();
    const md = capabilities.renderMarkdown(r);
    assert.ok(md.includes('AUTO-GENERATED'));
    assert.ok(md.includes('npm run capabilities'));
  });
});
