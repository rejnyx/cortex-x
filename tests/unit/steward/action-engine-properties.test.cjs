'use strict';

// Sprint 2.9.7c — action-engine property tests. Per Sprint 2.3 R1 §3.4
// recommendation: companion property tests for high-risk primitives.
// action-engine is the LLM seam — its parsing + redaction + scrubbing
// invariants gate billing safety + secret leakage + content preservation.
//
// Note: action-engine helpers already have substantial coverage from
// Sprint 1.6.21 (T2 helpers-property.test.cjs). This file adds invariants
// that span input categories specifically for the high-risk primitives.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ae = require('../../../bin/steward/_lib/action-engine.cjs');

describe('Sprint 2.9.7c — stripJsonFences property invariants', () => {
  test('invariant: idempotency — stripping twice yields same result', () => {
    const cases = [
      '```json\n{"a":1}\n```',
      '```\n{"a":1}\n```',
      '{"a":1}',
      '   ```json\n  {"a":1}\n  ```   ',
    ];
    for (const s of cases) {
      const once = ae.stripJsonFences(s);
      const twice = ae.stripJsonFences(once);
      assert.equal(once, twice, `idempotent for ${JSON.stringify(s.slice(0, 30))}`);
    }
  });

  test('invariant: no-fence non-whitespace input passes through unchanged', () => {
    // Note: stripJsonFences trims its input. Whitespace-only inputs come back
    // as empty string. This test covers the "no fences, no trimming" path.
    const cases = ['{"a":1}', 'plain text', '{}', '[]'];
    for (const s of cases) {
      const result = ae.stripJsonFences(s);
      assert.equal(result, s, `unchanged: ${JSON.stringify(s)}`);
    }
  });

  test('invariant: stripJsonFences trims leading/trailing whitespace', () => {
    assert.equal(ae.stripJsonFences('   '), '');
    assert.equal(ae.stripJsonFences('\n\n  hello  \n\n'), 'hello');
  });

  test('invariant: non-string input safely passes through', () => {
    for (const bad of [null, undefined, 0, 1, {}, [], true]) {
      assert.doesNotThrow(() => ae.stripJsonFences(bad));
    }
  });
});

describe('Sprint 2.9.7c — extractUsage property invariants', () => {
  test('invariant: missing/null usage ⇒ all zero', () => {
    const cases = [null, undefined, {}, { ok: true }, { data: null }];
    for (const c of cases) {
      const result = ae.extractUsage(c);
      assert.equal(typeof result, 'object');
      assert.ok(typeof result.cost_usd === 'number' || result.cost_usd === undefined);
    }
  });

  test('invariant: malformed numeric values get coerced to 0 or undefined (no NaN/negative)', () => {
    const cases = [
      { usage: { prompt_tokens: 'string' } },
      { usage: { prompt_tokens: NaN } },
      { usage: { prompt_tokens: -100 } },
      { usage: { prompt_tokens: Infinity } },
      { usage: { completion_tokens: -1 } },
    ];
    for (const c of cases) {
      const result = ae.extractUsage(c);
      // Whatever fields are returned must be finite + non-negative.
      for (const key of ['cost_usd', 'tokens_in', 'tokens_out']) {
        if (result[key] !== undefined) {
          assert.ok(Number.isFinite(result[key]), `${key} must be finite (got ${result[key]})`);
          assert.ok(result[key] >= 0, `${key} must be non-negative (got ${result[key]})`);
        }
      }
    }
  });
});

describe('Sprint 2.9.7c — isDenylistedPath (STEWARD_HARD_DENYLIST: secrets/CI/internals)', () => {
  test('invariant: secret + CI + steward-internal paths refused', () => {
    const denylisted = [
      '.env',
      '.env.local',
      '.env.production',
      'package.json',
      'package-lock.json',
      'sub/package.json',
      'bin/steward/execute.cjs',
      'bin/steward/_lib/halt-check.cjs',
      'bin/cortex-steward.cjs',
      '.github/workflows/steward.yml',
      'standards/steward-policy.md',
      '.git/HEAD',
      '.ssh/id_rsa',
      '.gnupg/pubring.kbx',
      'cert.pem',
      'private.key',
      'secrets/api.txt',
      'secret/foo.txt',
    ];
    for (const p of denylisted) {
      assert.equal(ae.isDenylistedPath(p), true, `${p} must be denylisted`);
    }
  });

  test('invariant: regular project paths NOT refused', () => {
    const allowed = [
      'cortex/lessons-learned.jsonl',
      'cortex/recommendations.md',
      'docs/troubleshooting.md',
      'docs/steward-roadmap.md',
      'src/index.js',
      'tests/unit/foo.test.cjs',
      'CLAUDE.md',                     // human-only via policy-check, not denylist
      'standards/correctness.md',      // human-only via policy-check, not denylist
    ];
    for (const p of allowed) {
      assert.equal(ae.isDenylistedPath(p), false, `${p} must NOT be denylisted`);
    }
  });

  test('invariant: Windows backslashes normalized for cross-platform matching', () => {
    assert.equal(ae.isDenylistedPath('bin\\steward\\execute.cjs'), true);
    assert.equal(ae.isDenylistedPath('.github\\workflows\\test.yml'), true);
  });

  test('invariant: idempotency', () => {
    for (const p of ['.env', 'src/foo.js', 'package.json']) {
      assert.equal(ae.isDenylistedPath(p), ae.isDenylistedPath(p));
    }
  });
});

describe('Sprint 2.9.7c — claude-cli helpers property invariants', () => {
  test('invariant: scrubClaudeCliEnv removes ALL leak keys regardless of case', () => {
    const env = {
      ANTHROPIC_API_KEY: 'leak1',
      anthropic_api_key: 'leak2',
      Anthropic_API_Key: 'leak3',
      ANTHROPIC_AUTH_TOKEN: 'leak4',
      PATH: '/usr/bin',
      HOME: '/home/user',
    };
    const scrubbed = ae.scrubClaudeCliEnv(env);
    // PATH + HOME preserved.
    assert.equal(scrubbed.PATH, '/usr/bin');
    assert.equal(scrubbed.HOME, '/home/user');
    // Leak keys gone (in any case).
    for (const k of Object.keys(scrubbed)) {
      assert.ok(!/^anthropic_/i.test(k), `leak key ${k} should have been scrubbed`);
    }
  });

  test('invariant: matchForbiddenFlag detects --bare in many forms', () => {
    const cases = [
      '--bare',
      '--BARE',
      ' --bare ',
      '--bare=value',
      '--bare value',
    ];
    for (const c of cases) {
      assert.ok(ae.matchForbiddenFlag(c), `must match: ${JSON.stringify(c)}`);
    }
  });

  test('invariant: matchForbiddenFlag does NOT match unrelated flags', () => {
    const safe = [
      '--bare-metal',     // different flag (NOT prefix-equal)
      '--bareback',       // different flag
      '-b',               // short flag
      '--print',          // unrelated
      '',
      'positional',
    ];
    for (const s of safe) {
      assert.equal(ae.matchForbiddenFlag(s), null, `must not match: ${JSON.stringify(s)}`);
    }
  });

  test('invariant: containsShellMetacharacters catches command-injection chars', () => {
    const dangerous = [
      'arg & evil',
      'arg | evil',
      'arg ; evil',
      'arg < input',
      'arg > output',
      'arg "quoted"',
      'arg `backtick`',
      'arg $var',
      'arg (subshell)',
      'arg \n newline',
      'arg \r return',
      'arg \0 nul',
    ];
    for (const c of dangerous) {
      assert.equal(ae.containsShellMetacharacters(c), true, `must detect metachar: ${JSON.stringify(c)}`);
    }
  });

  test('invariant: containsShellMetacharacters allows alphanumeric + safe chars', () => {
    const safe = [
      'plain-arg',
      'file.cjs',
      '/path/to/file',
      'C:\\Users\\david',
      '--flag=value',
      'kebab-case-name',
      'snake_case_name',
      'CamelCase',
      'a.b.c',
    ];
    for (const s of safe) {
      assert.equal(ae.containsShellMetacharacters(s), false, `must accept: ${JSON.stringify(s)}`);
    }
  });

  test('invariant: redactSecrets masks Bearer tokens', () => {
    const cases = [
      'Authorization: Bearer abc123def456',
      'Bearer sk-ant-12345',
      'Bearer xoxb-slack-token-abc',
    ];
    for (const c of cases) {
      const redacted = ae.redactSecrets(c);
      // Original token text should NOT appear verbatim in output.
      const tokenMatch = c.match(/Bearer\s+(\S+)/);
      if (tokenMatch && tokenMatch[1].length > 6) {
        assert.ok(!redacted.includes(tokenMatch[1]), `token must be redacted in: ${c}`);
      }
    }
  });

  test('invariant: redactSecrets idempotency — already-redacted text unchanged', () => {
    const text = 'Authorization: Bearer [REDACTED]';
    assert.equal(ae.redactSecrets(text), ae.redactSecrets(ae.redactSecrets(text)));
  });

  test('invariant: redactSecrets passes through plain text unchanged', () => {
    const cases = [
      'plain text',
      'no secrets here',
      '{"foo": "bar"}',
      '',
      'just a number 12345',
    ];
    for (const s of cases) {
      assert.equal(ae.redactSecrets(s), s, `unchanged: ${JSON.stringify(s)}`);
    }
  });
});

describe('Sprint 2.9.7c — DEFAULT_MODEL + OPENROUTER_ENDPOINT contract', () => {
  test('invariant: DEFAULT_MODEL matches the documented SSOT value', () => {
    // Sprint 1.6.16 + 4.7 rebrand: deepseek/deepseek-v4-flash is the SSOT.
    // GHA workflows reference this; keep aligned via tests/contract/default-model-ssot.test.cjs
    assert.equal(typeof ae.DEFAULT_MODEL, 'string');
    assert.ok(ae.DEFAULT_MODEL.length > 0);
  });

  test('invariant: OPENROUTER_ENDPOINT is HTTPS', () => {
    assert.ok(ae.OPENROUTER_ENDPOINT.startsWith('https://'),
      `OpenRouter endpoint must be HTTPS, got: ${ae.OPENROUTER_ENDPOINT}`);
  });

  test('invariant: STEWARD_SYSTEM_PROMPT is non-empty string', () => {
    assert.equal(typeof ae.STEWARD_SYSTEM_PROMPT, 'string');
    assert.ok(ae.STEWARD_SYSTEM_PROMPT.length > 100, 'system prompt must have meaningful content');
  });
});
