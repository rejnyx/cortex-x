'use strict';

// Sprint 2.4 — claude-cli engine unit tests.
// Uses injected `spawnImpl` (fake) + injected `claudeCliPath` to avoid
// requiring a real `claude` binary. Real-claude E2E test is gated by
// STEWARD_E2E_CLAUDE_CLI=1 (separate file when added).

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../../../bin/steward/_lib/action-engine.cjs');
const { makeFakeSpawn } = require('../../helpers/fake-spawn.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `claude-cli-${prefix}-`));
}

// Minimal valid plan shape for buildUserPrompt.
const SAMPLE_PLAN = {
  slug: 'test-slug',
  action_kind: 'recommendation',
  action: {
    num: 1,
    title: 'test action',
    body: 'add a test file',
    action_key: 'test#1',
  },
};

// Standard envelope shape `claude -p --output-format json` returns.
function buildEnvelope({ result, structured_output, total_cost_usd = 0, usage, model = 'claude-sonnet-4-7-20260101' } = {}) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: result !== undefined ? result : JSON.stringify({ edits: [{ path: 'src/foo.js', content: '// test\n' }] }),
    structured_output,
    session_id: 'sess-test',
    duration_ms: 1234,
    total_cost_usd,
    usage: usage || { input_tokens: 100, output_tokens: 50 },
    model,
    stop_reason: 'end_turn',
  });
}

describe('claude-cli engine — Sprint 2.4', () => {
  let prevOauthToken;
  let prevApiKey;

  beforeEach(() => {
    prevOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    prevApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token-not-real';
    delete process.env.ANTHROPIC_API_KEY;
    engine._resetClaudeCliPathCache();
  });

  afterEach(() => {
    if (prevOauthToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevOauthToken;
    if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevApiKey;
    engine._resetClaudeCliPathCache();
  });

  test('1. success path: edit applied + cost mapping', async () => {
    const repoRoot = tmpRepo('success');
    const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot,
    });

    assert.equal(result.ok, true, `expected ok=true, got: ${JSON.stringify(result)}`);
    assert.equal(result.engine, 'claude-cli');
    assert.equal(result.cost_usd, 0);
    assert.equal(result.tokens_in, 100);
    assert.equal(result.tokens_out, 50);
    assert.deepEqual(result.touchedFiles, ['src/foo.js']);
    assert.equal(fs.readFileSync(path.join(repoRoot, 'src/foo.js'), 'utf8'), '// test\n');
  });

  test('2. total_cost_usd > 0 → CLAUDE_CLI_BILLING_LEAK + halt file written', async () => {
    const repoRoot = tmpRepo('billing-leak');
    // Override fleet sentinel path by routing through a temp HOME.
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-home-'));
    const prevCortexHome = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = fakeHome;

    try {
      const fake = makeFakeSpawn({ stdout: buildEnvelope({ total_cost_usd: 0.0042 }), code: 0 });

      const result = await engine.applyAction(SAMPLE_PLAN, {
        engine: 'claude-cli',
        claudeCliPath: '/fake/claude',
        spawnImpl: fake.spawn,
        repoRoot,
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, 'CLAUDE_CLI_BILLING_LEAK');
      assert.equal(result.cost_usd, 0.0042);

      // Halt file must exist.
      const haltCheck = require('../../../bin/steward/_lib/halt-check.cjs');
      const haltPath = haltCheck.fleetSentinelPath();
      assert.equal(fs.existsSync(haltPath), true, `expected halt file at ${haltPath}`);
      const haltText = fs.readFileSync(haltPath, 'utf8');
      assert.match(haltText, /CLAUDE_CLI_BILLING_LEAK/);
      assert.match(haltText, /total_cost_usd=0\.0042/);
      // Cleanup the halt file so it doesn't bleed into other tests.
      fs.unlinkSync(haltPath);
    } finally {
      if (prevCortexHome === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevCortexHome;
    }
  });

  test('3. OAuth expired stderr → CLAUDE_CLI_AUTH_REJECTED', async () => {
    const fake = makeFakeSpawn({
      stdout: '',
      stderr: 'Error: OAuth token has expired · Please run /login',
      code: 1,
    });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('oauth-expired'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_AUTH_REJECTED');
  });

  test('4. rate-limit stderr → CLAUDE_CLI_RATE_LIMITED', async () => {
    const fake = makeFakeSpawn({
      stdout: '',
      stderr: 'Server is temporarily limiting requests (not your usage limit) · Rate limited',
      code: 1,
    });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('rate-limited'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_RATE_LIMITED');
  });

  test('5. timeout (fake never closes) → CLAUDE_CLI_TIMEOUT', async () => {
    const fake = makeFakeSpawn({ never: true });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      timeoutMs: 1000, // clamped to 1s minimum
      repoRoot: tmpRepo('timeout'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_TIMEOUT');
  });

  test('6. spawn ENOENT → CLAUDE_CLI_NOT_FOUND', async () => {
    const enoErr = new Error('spawn ENOENT');
    enoErr.code = 'ENOENT';
    const fake = makeFakeSpawn({ spawnError: enoErr });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('enoent'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_NOT_FOUND');
  });

  test('7. JSON-fence wrapped result → stripJsonFences works', async () => {
    const repoRoot = tmpRepo('fenced');
    const fencedResult = '```json\n{"edits":[{"path":"a.js","content":"x"}]}\n```';
    const fake = makeFakeSpawn({
      stdout: buildEnvelope({ result: fencedResult }),
      code: 0,
    });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot,
    });

    assert.equal(result.ok, true, `expected ok=true, got: ${JSON.stringify(result)}`);
    assert.deepEqual(result.touchedFiles, ['a.js']);
  });

  test('8. plan shape invalid (no edits[] array) → CLAUDE_CLI_PLAN_SHAPE_INVALID', async () => {
    const fake = makeFakeSpawn({
      stdout: buildEnvelope({ result: '{"not_edits":[]}' }),
      code: 0,
    });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('shape-invalid'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_PLAN_SHAPE_INVALID');
  });

  test('9. missing total_cost_usd → CLAUDE_CLI_PROTOCOL_DRIFT', async () => {
    const driftEnvelope = JSON.stringify({
      type: 'result',
      result: '{"edits":[]}',
      session_id: 'x',
      duration_ms: 1,
      // total_cost_usd intentionally absent
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude',
    });
    const fake = makeFakeSpawn({ stdout: driftEnvelope, code: 0 });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('drift'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_PROTOCOL_DRIFT');
  });

  test('10. env scrubbing — ANTHROPIC_API_KEY removed from spawned env', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-leak-key-do-not-use';
    process.env.ANTHROPIC_BASE_URL = 'https://leaked.example.com';
    try {
      const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });

      await engine.applyAction(SAMPLE_PLAN, {
        engine: 'claude-cli',
        claudeCliPath: '/fake/claude',
        spawnImpl: fake.spawn,
        repoRoot: tmpRepo('env-scrub'),
      });

      assert.equal(fake.calls.length, 1);
      const spawnedEnv = fake.calls[0].options.env;
      assert.ok(spawnedEnv, 'expected spawn options.env to be set');
      assert.equal(spawnedEnv.ANTHROPIC_API_KEY, undefined, 'ANTHROPIC_API_KEY must be scrubbed');
      assert.equal(spawnedEnv.ANTHROPIC_BASE_URL, undefined, 'ANTHROPIC_BASE_URL must be scrubbed');
      // CLAUDE_CODE_OAUTH_TOKEN MUST be preserved.
      assert.equal(spawnedEnv.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-test-token-not-real');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  test('11. CLAUDE_CODE_OAUTH_TOKEN unset → CLAUDE_CLI_AUTH_NOT_CONFIGURED', async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const fake = makeFakeSpawn({ stdout: '', code: 0 });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('auth-not-configured'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_AUTH_NOT_CONFIGURED');
    assert.equal(fake.calls.length, 0, 'spawn must NOT be called when auth is not configured');
  });

  test('12. --bare in extraArgs → CLAUDE_CLI_FORBIDDEN_FLAG', async () => {
    const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });

    const result = await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      extraArgs: ['--bare'],
      repoRoot: tmpRepo('bare-forbidden'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_FORBIDDEN_FLAG');
    assert.equal(fake.calls.length, 0, 'spawn must NOT be called when --bare is detected');
  });

  test('12b. --bare variants (case, whitespace, =) all → CLAUDE_CLI_FORBIDDEN_FLAG (Sprint 2.4 R2 fix)', async () => {
    const variants = ['--BARE', ' --bare', '--bare=foo', '--Bare', '  --bare  '];
    for (const v of variants) {
      const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });
      const result = await engine.applyAction(SAMPLE_PLAN, {
        engine: 'claude-cli',
        claudeCliPath: '/fake/claude',
        spawnImpl: fake.spawn,
        extraArgs: [v],
        repoRoot: tmpRepo(`bare-variant-${variants.indexOf(v)}`),
      });
      assert.equal(result.ok, false, `variant ${JSON.stringify(v)} must be rejected`);
      assert.equal(result.code, 'CLAUDE_CLI_FORBIDDEN_FLAG', `variant ${JSON.stringify(v)} must produce FORBIDDEN_FLAG`);
      assert.equal(fake.calls.length, 0, `variant ${JSON.stringify(v)} must NOT spawn`);
    }
  });

  test('12c. shell metacharacters in extraArgs → CLAUDE_CLI_FORBIDDEN_FLAG (Sprint 2.4 R2 fix)', async () => {
    const dangerous = ['; calc.exe', 'a&b', 'foo|bar', 'a;b', '$(whoami)', '`rm -rf /`'];
    for (const arg of dangerous) {
      const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });
      const result = await engine.applyAction(SAMPLE_PLAN, {
        engine: 'claude-cli',
        claudeCliPath: '/fake/claude',
        spawnImpl: fake.spawn,
        extraArgs: [arg],
        repoRoot: tmpRepo(`metachar-${dangerous.indexOf(arg)}`),
      });
      assert.equal(result.ok, false, `${JSON.stringify(arg)} must be rejected`);
      assert.equal(result.code, 'CLAUDE_CLI_FORBIDDEN_FLAG');
      assert.equal(fake.calls.length, 0, `${JSON.stringify(arg)} must NOT spawn`);
    }
  });

  test('15. parseClaudeCliResponse rejects NaN total_cost_usd (Sprint 2.4 R2 fix)', () => {
    const env = JSON.stringify({
      type: 'result',
      result: '{}',
      total_cost_usd: null, // null becomes typeof 'object', triggers PROTOCOL_DRIFT path
      usage: {},
    });
    const r = engine.parseClaudeCliResponse(env);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'CLAUDE_CLI_PROTOCOL_DRIFT');
  });

  test('16. resolveClaudeCliPath rejects directory override (Sprint 2.4 R2 fix)', () => {
    const dir = tmpRepo('dir-as-path');
    const prev = process.env.STEWARD_CLAUDE_CLI_PATH;
    process.env.STEWARD_CLAUDE_CLI_PATH = dir;
    try {
      engine._resetClaudeCliPathCache();
      assert.throws(() => engine.resolveClaudeCliPath(), (err) => {
        return err.code === 'CLAUDE_CLI_NOT_FOUND' && /not a regular file/i.test(err.message);
      });
    } finally {
      if (prev === undefined) delete process.env.STEWARD_CLAUDE_CLI_PATH;
      else process.env.STEWARD_CLAUDE_CLI_PATH = prev;
      engine._resetClaudeCliPathCache();
    }
  });

  test('17. scrubClaudeCliEnv on win32 strips lowercase ANTHROPIC_API_KEY (Sprint 2.4 R2 fix)', () => {
    const isWin = process.platform === 'win32';
    if (!isWin) {
      // POSIX path uses uppercase-only scrub; lowercase passes through.
      const scrubbed = engine.scrubClaudeCliEnv({ anthropic_api_key: 'leak', PATH: '/usr/bin' });
      assert.equal(scrubbed.anthropic_api_key, 'leak', 'POSIX preserves lowercase (case-sensitive)');
      return;
    }
    const scrubbed = engine.scrubClaudeCliEnv({ anthropic_api_key: 'leak', PATH: '/usr/bin' });
    assert.equal(scrubbed.anthropic_api_key, undefined, 'win32 scrub must remove lowercase variant');
  });

  test('18. redactSecrets masks OAuth token in stderr categorization', () => {
    const stderrWithToken = 'Error: Bearer sk-ant-oat01-VERYREALTOKEN_abc123 was rejected';
    const redacted = engine.redactSecrets(stderrWithToken);
    assert.ok(!redacted.includes('sk-ant-oat01-VERYREALTOKEN'), 'OAuth token must be redacted');
    assert.ok(redacted.includes('REDACTED'), 'redaction marker present');
  });

  test('13. argv contains -p + --output-format json + --permission-mode dontAsk', async () => {
    const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });

    await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('argv-shape'),
    });

    assert.equal(fake.calls.length, 1);
    const argv = fake.calls[0].argv;
    assert.ok(argv.includes('-p'), `argv must include -p: ${JSON.stringify(argv)}`);
    assert.ok(argv.includes('--output-format'));
    assert.ok(argv.includes('json'));
    assert.ok(argv.includes('--permission-mode'));
    assert.ok(argv.includes('dontAsk'));
    // Lint assertion: --bare MUST NEVER appear.
    assert.equal(argv.includes('--bare'), false, '--bare must never appear in argv');
  });

  test('14. combined prompt piped via stdin (Windows-safe quoting avoidance)', async () => {
    const fake = makeFakeSpawn({ stdout: buildEnvelope(), code: 0 });

    await engine.applyAction(SAMPLE_PLAN, {
      engine: 'claude-cli',
      claudeCliPath: '/fake/claude',
      spawnImpl: fake.spawn,
      repoRoot: tmpRepo('stdin-prompt'),
    });

    assert.equal(fake.calls.length, 1);
    const stdinJoined = fake.calls[0].stdinChunks.join('');
    assert.ok(stdinJoined.length > 0, 'stdin must receive the combined prompt');
    assert.ok(stdinJoined.includes('Steward'), 'system prompt should mention Steward');
    assert.ok(stdinJoined.includes('test action'), 'user prompt should include action title');
  });
});

describe('claude-cli helpers — pure functions', () => {
  test('scrubClaudeCliEnv removes all leak keys', () => {
    const baseEnv = {
      ANTHROPIC_API_KEY: 'leak1',
      ANTHROPIC_AUTH_TOKEN: 'leak2',
      ANTHROPIC_BASE_URL: 'leak3',
      ANTHROPIC_MODEL: 'leak4',
      CLAUDE_CODE_OAUTH_TOKEN: 'preserve',
      PATH: '/usr/bin',
    };
    const scrubbed = engine.scrubClaudeCliEnv(baseEnv);

    for (const k of engine.CLAUDE_CLI_LEAK_KEYS) {
      assert.equal(scrubbed[k], undefined, `${k} must be scrubbed`);
    }
    assert.equal(scrubbed.CLAUDE_CODE_OAUTH_TOKEN, 'preserve');
    assert.equal(scrubbed.PATH, '/usr/bin');
  });

  test('parseClaudeCliResponse rejects empty stdout', () => {
    const result = engine.parseClaudeCliResponse('');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_PROTOCOL_DRIFT');
  });

  test('parseClaudeCliResponse rejects non-JSON stdout', () => {
    const result = engine.parseClaudeCliResponse('not json at all');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_CLI_PROTOCOL_DRIFT');
  });

  test('parseClaudeCliResponse accepts well-formed envelope', () => {
    const env = JSON.stringify({
      type: 'result',
      result: 'hello',
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = engine.parseClaudeCliResponse(env);
    assert.equal(result.ok, true);
    assert.equal(result.parsed.total_cost_usd, 0);
  });

  test('categorizeClaudeCliStderr maps OAuth strings', () => {
    const cat = engine.categorizeClaudeCliStderr('OAuth token has expired', 1);
    assert.equal(cat.code, 'CLAUDE_CLI_AUTH_REJECTED');
  });

  test('categorizeClaudeCliStderr maps rate-limit strings', () => {
    const cat = engine.categorizeClaudeCliStderr('Server is temporarily limiting requests', 1);
    assert.equal(cat.code, 'CLAUDE_CLI_RATE_LIMITED');
  });

  test('categorizeClaudeCliStderr maps quota strings', () => {
    const cat = engine.categorizeClaudeCliStderr("You've hit your weekly limit", 1);
    assert.equal(cat.code, 'CLAUDE_CLI_QUOTA_EXHAUSTED');
  });

  test('categorizeClaudeCliStderr maps server error', () => {
    const cat = engine.categorizeClaudeCliStderr('API Error: 503 service unavailable', 1);
    assert.equal(cat.code, 'CLAUDE_CLI_SERVER_ERROR');
  });

  test('categorizeClaudeCliStderr falls through to SPAWN_FAILED', () => {
    const cat = engine.categorizeClaudeCliStderr('something completely unexpected', 1);
    assert.equal(cat.code, 'CLAUDE_CLI_SPAWN_FAILED');
  });
});
