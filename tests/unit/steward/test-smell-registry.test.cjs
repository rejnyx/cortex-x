// Sprint 2.11 — test-smell-registry contract tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const reg = require('../../../bin/steward/_lib/test-smell-registry.cjs');

describe('Sprint 2.11 — test-smell-registry shape', () => {
  test('exposes 21 tsDetect + 13 ESE 2025 + 5 cortex-original smells', () => {
    assert.equal(reg.TSDETECT_SMELLS.length, 21);
    assert.equal(reg.ESE_2025_SMELLS.length, 13);
    assert.equal(reg.CORTEX_ORIGINAL_SMELLS.length, 5);
    assert.equal(reg.ALL_SMELLS.length, 39);
  });

  test('every smell has required fields', () => {
    for (const s of reg.ALL_SMELLS) {
      assert.equal(typeof s.id, 'string', `id missing: ${JSON.stringify(s)}`);
      assert.match(s.id, /^[a-z][a-z0-9_]*$/, `id snake_case: ${s.id}`);
      assert.equal(typeof s.name, 'string');
      assert.equal(typeof s.category, 'string');
      assert.ok(reg.SEVERITIES.includes(s.severity), `severity invalid: ${s.id} → ${s.severity}`);
      assert.ok(Array.isArray(s.languages));
      for (const l of s.languages) {
        assert.ok(reg.LANGUAGES.includes(l), `language invalid: ${l}`);
      }
      assert.equal(typeof s.description, 'string');
      assert.ok(s.description.length > 0 && s.description.length <= 250, `description len: ${s.id}`);
      assert.equal(typeof s.repair_hint, 'string');
      assert.ok(s.repair_hint.length > 0 && s.repair_hint.length <= 250);
    }
  });

  test('every smell id is unique', () => {
    const seen = new Set();
    for (const s of reg.ALL_SMELLS) {
      assert.ok(!seen.has(s.id), `duplicate id: ${s.id}`);
      seen.add(s.id);
    }
  });

  test('Sandoval ESE 2025 smells carry sandoval-2025 tag', () => {
    for (const s of reg.ESE_2025_SMELLS) {
      assert.ok(Array.isArray(s.tags) && s.tags.includes('sandoval-2025'),
        `Sandoval smell ${s.id} missing sandoval-2025 tag`);
    }
  });

  test('cortex-original smells carry cortex-original tag', () => {
    for (const s of reg.CORTEX_ORIGINAL_SMELLS) {
      assert.ok(Array.isArray(s.tags) && s.tags.includes('cortex-original'),
        `cortex-original smell ${s.id} missing tag`);
    }
  });

  test('getSmellById returns the smell or null', () => {
    assert.equal(reg.getSmellById('assertion_roulette').id, 'assertion_roulette');
    assert.equal(reg.getSmellById('not_asserted_side_effects').id, 'not_asserted_side_effects');
    assert.equal(reg.getSmellById('hidden_io').id, 'hidden_io');
    assert.equal(reg.getSmellById('does_not_exist'), null);
  });

  test('listByCategory groups smells correctly', () => {
    const assertion = reg.listByCategory(reg.CATEGORIES.ASSERTION_QUALITY);
    assert.ok(assertion.length >= 5, 'at least 5 assertion-quality smells');
    for (const s of assertion) {
      assert.equal(s.category, reg.CATEGORIES.ASSERTION_QUALITY);
    }
  });

  test('listByLanguage returns js-applicable smells', () => {
    const js = reg.listByLanguage('js');
    // Most smells apply to JS; constructor_initialization + default_test are Java-only
    const javaOnlyIds = new Set(['constructor_initialization', 'default_test']);
    for (const s of reg.ALL_SMELLS) {
      const expected = !javaOnlyIds.has(s.id);
      const actual = js.some((x) => x.id === s.id);
      assert.equal(actual, expected, `language filter mismatch: ${s.id}`);
    }
  });

  test('exposes the four Sandoval categories', () => {
    const categoriesPresent = new Set(reg.ESE_2025_SMELLS.map((s) => s.category));
    assert.ok(categoriesPresent.has(reg.CATEGORIES.ASSERTION_QUALITY)); // Act-Assert Mismatch + AC + TOFA + NNA
    assert.ok(categoriesPresent.has(reg.CATEGORIES.STRUCTURE));         // Redundant Code
    assert.ok(categoriesPresent.has(reg.CATEGORIES.TEST_INDEPENDENCE)); // Failed Setup (EDIS / EDED / EDNA)
  });
});
