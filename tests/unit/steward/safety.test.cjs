// Sprint 2.5b/2.6b/2.11 — shared safety SSOT contract tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const safety = require('../../../bin/steward/_lib/safety.cjs');

describe('Sprint 2.5b R2 — safety.cjs slug regex (path-traversal rejection)', () => {
  test('accepts valid slugs', () => {
    const ok = ['cortex-x', 'my-repo', 'project_42', 'a.b.c', 'A1', 'snake_case'];
    for (const s of ok) {
      assert.doesNotThrow(() => safety.assertSafeSlug(s), `should accept: ${s}`);
    }
  });

  test('rejects path-traversal slugs (regression for HIGH finding)', () => {
    const bad = ['..', '../etc', '..foo', 'foo..bar', 'foo/../bar', '....', 'a..b'];
    for (const s of bad) {
      assert.throws(
        () => safety.assertSafeSlug(s),
        (e) => e.code === 'UNSAFE_SLUG',
        `should reject: ${s}`,
      );
    }
  });

  test('rejects slug with separators / null / oversized', () => {
    const bad = ['a/b', 'a\\b', '', '.', null, 42, 'x'.repeat(65)];
    for (const s of bad) {
      assert.throws(
        () => safety.assertSafeSlug(s),
        (e) => e.code === 'UNSAFE_SLUG',
        `should reject: ${JSON.stringify(s)}`,
      );
    }
  });

  test('rejects pure-dot slugs (.,..,...)', () => {
    for (const s of ['.', '..', '...', '....']) {
      assert.throws(() => safety.assertSafeSlug(s), (e) => e.code === 'UNSAFE_SLUG');
    }
  });
});

describe('Sprint 2.5b R2 — safety.cjs date + sha guards', () => {
  test('assertSafeDate accepts YYYY-MM and YYYY-MM-DD', () => {
    assert.doesNotThrow(() => safety.assertSafeDate('2026-05'));
    assert.doesNotThrow(() => safety.assertSafeDate('2026-05-10'));
  });

  test('assertSafeDate rejects path traversal', () => {
    assert.throws(() => safety.assertSafeDate('../etc'), (e) => e.code === 'UNSAFE_DATE');
    assert.throws(() => safety.assertSafeDate('20260510'), (e) => e.code === 'UNSAFE_DATE');
    assert.throws(() => safety.assertSafeDate(null), (e) => e.code === 'UNSAFE_DATE');
  });

  test('assertSafeSha accepts 40-hex', () => {
    assert.doesNotThrow(() => safety.assertSafeSha('a3406d29c5cdda61e8aa5e2ab9bc40000000000a'));
    assert.doesNotThrow(() => safety.assertSafeSha('A3406D29C5CDDA61E8AA5E2AB9BC40000000000A'));
  });

  test('assertSafeSha rejects non-hex / wrong-length', () => {
    assert.throws(() => safety.assertSafeSha('not-a-sha'), (e) => e.code === 'UNSAFE_SHA');
    assert.throws(() => safety.assertSafeSha('a3406d29'), (e) => e.code === 'UNSAFE_SHA');
    assert.throws(() => safety.assertSafeSha(null), (e) => e.code === 'UNSAFE_SHA');
  });
});

describe('Sprint 2.5b R2 — safety.cjs CRLF normalization', () => {
  test('normalizeCRLF strips \\r\\n + bare \\r', () => {
    assert.equal(safety.normalizeCRLF('a\r\nb\r\nc'), 'a\nb\nc');
    assert.equal(safety.normalizeCRLF('a\rb'), 'ab');
    assert.equal(safety.normalizeCRLF('a\nb'), 'a\nb');
  });

  test('normalizeCRLF handles null/undefined → empty string', () => {
    assert.equal(safety.normalizeCRLF(null), '');
    assert.equal(safety.normalizeCRLF(undefined), '');
  });
});

describe('Sprint 2.5b R2 — safety.cjs sanitizeForMarkdown', () => {
  test('neutralizes HTML angle brackets', () => {
    const out = safety.sanitizeForMarkdown('<script>alert(1)</script>');
    assert.ok(!out.includes('<script>'));
    assert.match(out, /&lt;/);
  });

  test('escapes @-mentions with zero-width space', () => {
    const out = safety.sanitizeForMarkdown('@channel @org-admin attention');
    assert.ok(!out.includes('@channel'));
    assert.ok(!out.includes('@org-admin'));
  });

  test('collapses backticks by default', () => {
    const out = safety.sanitizeForMarkdown('hello `rm -rf /` world');
    assert.ok(!out.includes('`rm -rf /`'));
  });

  test('preserves backticks when allowBackticks', () => {
    const out = safety.sanitizeForMarkdown('hello `rm -rf /` world', { allowBackticks: true });
    assert.ok(out.includes('`rm -rf /`'));
  });

  test('caps at MAX_FIELD_BYTES + adds shortened marker', () => {
    const long = 'x'.repeat(safety.MAX_FIELD_BYTES + 50);
    const out = safety.sanitizeForMarkdown(long);
    assert.ok(out.length <= safety.MAX_FIELD_BYTES + 50);
    assert.match(out, /\[shortened\]/);
  });

  test('strips CRLF for stable line accounting', () => {
    const out = safety.sanitizeForMarkdown('a\r\nb');
    assert.ok(!out.includes('\r'));
  });
});
