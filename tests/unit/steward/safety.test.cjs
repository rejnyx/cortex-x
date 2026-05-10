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

describe('Sprint 2.11.1 — safety.cjs redactSecrets (SSOT M2 fix)', () => {
  test('redacts Anthropic OAuth tokens with distinct sentinel', () => {
    const input = 'session.token = sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz_-1234';
    const out = safety.redactSecrets(input);
    assert.ok(!out.includes('sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz_-1234'),
      `OAuth token leaked: ${out}`);
    assert.ok(out.includes('[REDACTED-OAUTH-TOKEN]'),
      'OAuth replacement should use distinct sentinel for diagnostics');
  });

  test('redacts JWT tokens with distinct sentinel', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = safety.redactSecrets(`Authorization: ${jwt}`);
    assert.ok(!out.includes('eyJhbGc'), `JWT leaked: ${out}`);
    assert.ok(out.includes('[REDACTED-JWT]'));
  });

  test('redacts Bearer with base64 chars (regression for narrow Bearer regex)', () => {
    // base64-encoded Bearer values include +/= which the prior senior-tester
    // regex did not cover ([A-Za-z0-9._\-]{16,} is too narrow).
    const input = 'Authorization: Bearer abc123+def456/ghi789==';
    const out = safety.redactSecrets(input);
    assert.ok(!out.includes('abc123+def456/ghi789=='),
      `base64-Bearer leaked: ${out}`);
    assert.ok(out.includes('Bearer [REDACTED]'));
  });

  test('redacts generic sk- prefix tokens', () => {
    const input = "const apiKey = 'sk-abcdefghijklmnopqrst1234';";
    const out = safety.redactSecrets(input);
    assert.ok(!out.includes('sk-abcdefghijklmnopqrst1234'));
    assert.ok(out.includes('sk-[REDACTED]'));
  });

  test('redacts GitHub PATs (classic + fine-grained)', () => {
    const cases = [
      'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      'ghs_zyxwvutsrqponmlkjihgfedcba0987654321',
      'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz1234567',
    ];
    for (const c of cases) {
      const out = safety.redactSecrets(c);
      assert.ok(!out.includes(c), `GitHub PAT leaked: ${c} → ${out}`);
    }
  });

  test('redacts AWS access keys, Google API keys, Slack, Stripe-live', () => {
    // Fixtures are runtime-concatenated so GitHub secret-scanning push
    // protection does not flag them as live keys in source. Each part is
    // chosen so the concatenated string still satisfies the corresponding
    // regex in safety.cjs SECRET_PATTERNS.
    const cases = [
      { input: 'AKIA' + 'IOSFODNN7EXAMPLE',                         sentinel: 'AKIA[REDACTED]' },
      { input: 'AIza' + 'SyDFAKEFIXTUREABCDEFGHIJKLMNOPQRSTUVW',    sentinel: 'AIza[REDACTED]' },
      { input: 'xoxb-' + '12345-67890-abcdefghij',                  sentinel: 'xox[REDACTED]' },
      { input: 'sk' + '_live_' + 'FAKEFIXTUREABCDEFGHIJKL1234567',  sentinel: 'live_[REDACTED]' },
    ];
    for (const c of cases) {
      const out = safety.redactSecrets(c.input);
      assert.ok(!out.includes(c.input), `${c.input} leaked: ${out}`);
      assert.ok(out.includes(c.sentinel), `expected sentinel ${c.sentinel}: ${out}`);
    }
  });

  test('env-style fallback redacts apiKey/password/token assignments', () => {
    const input = `apiKey: 'real-secret-12345'\npassword: "another-67890"\ntoken: \`bearer-style\``;
    const out = safety.redactSecrets(input);
    assert.ok(!out.includes('real-secret-12345'));
    assert.ok(!out.includes('another-67890'));
    assert.ok(!out.includes('bearer-style'));
    assert.ok(out.includes("'<REDACTED>'"));
  });

  test('idempotency — running twice produces same output', () => {
    const input = 'token: "sk-abcdefghijklmnopqrst1234" Authorization: Bearer xyz123==';
    const once = safety.redactSecrets(input);
    const twice = safety.redactSecrets(once);
    assert.equal(once, twice, 'redactSecrets must be idempotent');
  });

  test('multi-segment sentinels (REDACTED-OAUTH-TOKEN) survive env-style fallback', () => {
    // Regression for Sprint 2.11.1 R2 MEDIUM: skip-sentinel regex previously
    // accepted only single-segment suffixes; `[REDACTED-OAUTH-TOKEN]` (two
    // hyphenated segments) failed the check and got re-collapsed to
    // `<REDACTED>`, losing the OAuth-specific diagnostic signal.
    const oauthInput = 'session.token = sk-ant-oat01-AbCdEfGhIjKlMnOpQrStUvWxYz_-1234';
    const once = safety.redactSecrets(oauthInput);
    assert.ok(once.includes('[REDACTED-OAUTH-TOKEN]'),
      `expected OAuth sentinel preserved on first pass: ${once}`);
    const twice = safety.redactSecrets(once);
    assert.ok(twice.includes('[REDACTED-OAUTH-TOKEN]'),
      `OAuth sentinel must survive second pass through env-style fallback: ${twice}`);
    assert.equal(once, twice, 'idempotency on multi-segment sentinel');
  });

  test('null/undefined input returns empty string (regression for non-string passthrough)', () => {
    assert.equal(safety.redactSecrets(null), '');
    assert.equal(safety.redactSecrets(undefined), '');
    assert.equal(safety.redactSecrets(''), '');
  });

  test('non-string input is coerced to string then redacted', () => {
    // Numbers/objects go through String() — no secret patterns match,
    // result is the toString form. This is intentional defense — caller
    // must not assume passthrough.
    assert.equal(safety.redactSecrets(42), '42');
    assert.equal(safety.redactSecrets({ x: 1 }), '[object Object]');
  });

  test('plain non-secret text passes through unchanged', () => {
    const inputs = [
      'hello world',
      'function add(a, b) { return a + b; }',
      '# Heading\nplain markdown content',
    ];
    for (const s of inputs) {
      assert.equal(safety.redactSecrets(s), s, `unchanged: ${s}`);
    }
  });
});
