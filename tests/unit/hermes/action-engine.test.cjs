'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../../../bin/hermes/_lib/action-engine.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `engine-${prefix}-`));
}

async function withMockPlan(plan, fn) {
  const prev = process.env.HERMES_MOCK_PLAN;
  process.env.HERMES_MOCK_PLAN = JSON.stringify(plan);
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.HERMES_MOCK_PLAN;
    else process.env.HERMES_MOCK_PLAN = prev;
  }
}

describe('action-engine: mock engine (sync, wrapped in async applyAction)', () => {
  test('applies single edit', async () => {
    const repoRoot = tmpRepo('single');
    const result = await withMockPlan({
      edits: [{ path: 'src/foo.js', content: 'module.exports = 42;' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.touchedFiles, ['src/foo.js']);
    assert.equal(result.engine, 'mock');
    assert.equal(fs.readFileSync(path.join(repoRoot, 'src/foo.js'), 'utf8'), 'module.exports = 42;');
  });

  test('applies multiple edits', async () => {
    const repoRoot = tmpRepo('multi');
    const result = await withMockPlan({
      edits: [
        { path: 'a.js', content: 'a' },
        { path: 'sub/b.js', content: 'b' },
      ],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));

    assert.equal(result.ok, true);
    assert.equal(result.touchedFiles.length, 2);
    assert.equal(fs.readFileSync(path.join(repoRoot, 'a.js'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(repoRoot, 'sub/b.js'), 'utf8'), 'b');
  });

  test('returns MOCK_NOT_SET when env var missing', async () => {
    const repoRoot = tmpRepo('not-set');
    const prev = process.env.HERMES_MOCK_PLAN;
    delete process.env.HERMES_MOCK_PLAN;
    try {
      const result = await engine.applyAction({}, { engine: 'mock', repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MOCK_NOT_SET');
    } finally {
      if (prev !== undefined) process.env.HERMES_MOCK_PLAN = prev;
    }
  });

  test('returns MOCK_PARSE_ERROR on invalid JSON', async () => {
    const repoRoot = tmpRepo('bad-json');
    const prev = process.env.HERMES_MOCK_PLAN;
    process.env.HERMES_MOCK_PLAN = '{ not valid json';
    try {
      const result = await engine.applyAction({}, { engine: 'mock', repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MOCK_PARSE_ERROR');
    } finally {
      if (prev === undefined) delete process.env.HERMES_MOCK_PLAN;
      else process.env.HERMES_MOCK_PLAN = prev;
    }
  });

  test('rejects empty edits array', async () => {
    const repoRoot = tmpRepo('empty');
    const result = await withMockPlan({ edits: [] },
      () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_NO_EDITS');
  });

  test('rejects absolute paths (defense in depth)', async () => {
    const repoRoot = tmpRepo('abs');
    const result = await withMockPlan({
      edits: [{ path: '/etc/passwd', content: 'evil' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_EDIT_UNSAFE');
  });

  test('rejects path traversal', async () => {
    const repoRoot = tmpRepo('traversal');
    const result = await withMockPlan({
      edits: [{ path: '../../../escape.js', content: 'evil' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_EDIT_UNSAFE');
  });
});

describe('action-engine: openrouter engine (async, fetch-based)', () => {
  // All openrouter tests use a mocked fetch — never make a real API call.

  function makeFetch(impl) {
    return async (...args) => impl(...args);
  }

  function okResponse(body) {
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  function errResponse(status, body) {
    return {
      ok: false,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  test('returns OPENROUTER_KEY_MISSING when env unset', async () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const result = await engine.applyAction({ action: { num: 1, title: 't', body: 'b' } }, {
        engine: 'openrouter',
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_KEY_MISSING');
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });

  test('happy path: parses LLM JSON + applies edits + captures cost/tokens', async () => {
    const repoRoot = tmpRepo('or-happy');
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-only-not-real-1234567890';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              edits: [{ path: 'docs/openrouter-test.md', content: '# from OR\n' }],
            }),
          },
        }],
        usage: { prompt_tokens: 1500, completion_tokens: 250, cost: 0.0042 },
      }));

      const result = await engine.applyAction(
        { action: { num: 1, title: 'demo', body: 'do the thing' } },
        { engine: 'openrouter', repoRoot, fetch: fetchFake, model: 'test/model' },
      );

      assert.equal(result.ok, true);
      assert.equal(result.engine, 'openrouter');
      assert.equal(result.model, 'test/model');
      assert.deepEqual(result.touchedFiles, ['docs/openrouter-test.md']);
      assert.equal(result.cost_usd, 0.0042);
      assert.equal(result.tokens_in, 1500);
      assert.equal(result.tokens_out, 250);
      assert.equal(fs.readFileSync(path.join(repoRoot, 'docs/openrouter-test.md'), 'utf8'), '# from OR\n');
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('passes correct headers + model + JSON-mode to OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test-1234';
    try {
      let captured = null;
      const fetchFake = makeFetch(async (url, opts) => {
        captured = { url, opts };
        return okResponse({
          choices: [{ message: { content: '{"edits":[{"path":"x.md","content":"x"}]}' } }],
          usage: {},
        });
      });

      await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        {
          engine: 'openrouter',
          repoRoot: tmpRepo('headers'),
          fetch: fetchFake,
          model: 'anthropic/claude-sonnet-4.5',
        },
      );

      assert.equal(captured.url, engine.OPENROUTER_ENDPOINT);
      assert.equal(captured.opts.method, 'POST');
      assert.match(captured.opts.headers.Authorization, /^Bearer sk-or-v1-/);
      assert.equal(captured.opts.headers['Content-Type'], 'application/json');
      assert.equal(captured.opts.headers['X-Title'], 'cortex-x Hermes');

      const body = JSON.parse(captured.opts.body);
      assert.equal(body.model, 'anthropic/claude-sonnet-4.5');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.messages[0].role, 'system');
      assert.match(body.messages[0].content, /Hermes/);
      assert.equal(body.messages[1].role, 'user');
      assert.match(body.messages[1].content, /Action 1: t/);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('returns OPENROUTER_HTTP_ERROR on 4xx/5xx', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => errResponse(401, 'unauthorized'));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('http-err'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_HTTP_ERROR');
      assert.equal(result.httpStatus, 401);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('returns OPENROUTER_PLAN_NOT_JSON when LLM emits malformed JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{ message: { content: 'not json at all' } }],
        usage: {},
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('not-json'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_PLAN_NOT_JSON');
      assert.match(result.raw_preview, /not json/);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('returns OPENROUTER_NETWORK_ERROR on fetch throw', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => { throw new Error('econnrefused'); });
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('netw'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_NETWORK_ERROR');
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('returns OPENROUTER_EMPTY_RESPONSE when response has no message content', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({ choices: [], usage: {} }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('empty'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_EMPTY_RESPONSE');
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('rejects path traversal in LLM-generated edits', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              edits: [{ path: '../../../../etc/passwd', content: 'evil' }],
            }),
          },
        }],
        usage: {},
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('llm-traversal'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_EDIT_UNSAFE');
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  // Sprint 1.6.17: cross-model JSON robustness + cost capture on parse failure.
  // Surfaced by Haiku 4.5 dogfood — Anthropic models on OpenRouter sometimes
  // ignore response_format: json_object and wrap output in markdown fences.
  test('Sprint 1.6.17: parses markdown ```json fenced output (Anthropic via OpenRouter)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fenced = '```json\n' + JSON.stringify({ edits: [{ path: 'a.txt', content: 'fenced' }] }) + '\n```';
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{ message: { content: fenced } }],
        usage: { cost: 0.0042, prompt_tokens: 1500, completion_tokens: 800 },
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('fenced-json'), fetch: fetchFake },
      );
      assert.equal(result.ok, true);
      assert.deepEqual(result.touchedFiles, ['a.txt']);
      assert.equal(result.cost_usd, 0.0042);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('Sprint 1.6.17: parses generic markdown fenced output (no language tag)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fenced = '```\n' + JSON.stringify({ edits: [{ path: 'b.txt', content: 'g' }] }) + '\n```';
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{ message: { content: fenced } }],
        usage: { cost: 0.001, prompt_tokens: 100, completion_tokens: 50 },
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('fenced-bare'), fetch: fetchFake },
      );
      assert.equal(result.ok, true);
      assert.deepEqual(result.touchedFiles, ['b.txt']);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('Sprint 1.6.17: bare JSON still parses (DeepSeek/OpenAI no-regression)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{ message: { content: JSON.stringify({ edits: [{ path: 'c.txt', content: 'bare' }] }) } }],
        usage: { prompt_tokens: 200 },
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('bare-json'), fetch: fetchFake },
      );
      assert.equal(result.ok, true);
      assert.equal(result.tokens_in, 200);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('Sprint 1.6.17: PLAN_NOT_JSON forwards usage (LLM spend captured even on parse failure)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [{ message: { content: 'I cannot return JSON sorry.' } }],
        usage: { cost: 0.0021, prompt_tokens: 600, completion_tokens: 50 },
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('parse-fail-cost'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_PLAN_NOT_JSON');
      assert.equal(result.cost_usd, 0.0021);
      assert.equal(result.tokens_in, 600);
      assert.equal(result.tokens_out, 50);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  test('Sprint 1.6.17: EMPTY_RESPONSE forwards usage when response has tokens', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    try {
      const fetchFake = makeFetch(async () => okResponse({
        choices: [],
        usage: { prompt_tokens: 400, completion_tokens: 0 },
      }));
      const result = await engine.applyAction(
        { action: { num: 1, title: 't', body: 'b' } },
        { engine: 'openrouter', repoRoot: tmpRepo('empty-cost'), fetch: fetchFake },
      );
      assert.equal(result.ok, false);
      assert.equal(result.code, 'OPENROUTER_EMPTY_RESPONSE');
      assert.equal(result.tokens_in, 400);
      assert.equal(result.tokens_out, 0);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});

describe('action-engine: claude-sdk engine (alternative path stub)', () => {
  test('returns CLAUDE_SDK_NOT_IMPLEMENTED', async () => {
    const result = await engine.applyAction({}, { engine: 'claude-sdk' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_SDK_NOT_IMPLEMENTED');
  });
});

describe('action-engine: engine selection', () => {
  test('opts.engine takes precedence over env', async () => {
    const prev = process.env.HERMES_ENGINE;
    process.env.HERMES_ENGINE = 'claude-sdk';
    try {
      const { name } = engine.selectEngine({ engine: 'mock' });
      assert.equal(name, 'mock');
    } finally {
      if (prev === undefined) delete process.env.HERMES_ENGINE;
      else process.env.HERMES_ENGINE = prev;
    }
  });

  test('HERMES_ENGINE env var as fallback', () => {
    const prev = process.env.HERMES_ENGINE;
    process.env.HERMES_ENGINE = 'mock';
    try {
      const { name } = engine.selectEngine({});
      assert.equal(name, 'mock');
    } finally {
      if (prev === undefined) delete process.env.HERMES_ENGINE;
      else process.env.HERMES_ENGINE = prev;
    }
  });

  test('default is openrouter (post-Sprint-1.6.13)', () => {
    const prev = process.env.HERMES_ENGINE;
    delete process.env.HERMES_ENGINE;
    try {
      const { name } = engine.selectEngine({});
      assert.equal(name, 'openrouter');
    } finally {
      if (prev !== undefined) process.env.HERMES_ENGINE = prev;
    }
  });

  test('unknown engine name returns UNKNOWN_ENGINE on apply', async () => {
    const result = await engine.applyAction({}, { engine: 'frobnicate' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNKNOWN_ENGINE');
  });
});

describe('action-engine: applyEditsToFilesystem helper (shared)', () => {
  test('exposed as a public export', () => {
    assert.equal(typeof engine.applyEditsToFilesystem, 'function');
  });

  test('rejects empty edits with custom code', () => {
    const result = engine.applyEditsToFilesystem([], {
      repoRoot: tmpRepo('helper-empty'),
      emptyCode: 'CUSTOM_NO_EDITS',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CUSTOM_NO_EDITS');
  });
});
