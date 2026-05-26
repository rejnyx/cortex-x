'use strict';

// tests/integration/steward-key-probe.test.cjs
//
// Backfill coverage for the steward-key-probe cron action.
// Key-probe is inline node -e JS in the workflow YAML (not a separate module),
// so this test does TWO things:
//   1. Contract assertions: the workflow YAML preserves the canonical
//      OpenRouter probe shape (URL, model name, 4 distinct exit codes)
//   2. Behavioral assertions: extract the inline JS and execute it against a
//      mocked fetch for each of the 4 failure modes (success, 401-malformed,
//      401-provisioning, network error)
//
// No real network calls.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKFLOW_PATH = path.join(
  __dirname, '..', '..',
  '.github', 'workflows', 'steward-key-probe.yml',
);

describe('steward-key-probe — workflow YAML contract', () => {
  const yaml = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  test('workflow targets the canonical OpenRouter chat-completions endpoint', () => {
    assert.ok(
      yaml.includes("https://openrouter.ai/api/v1/chat/completions"),
      'workflow must hit the chat-completions endpoint (NOT /auth/key — that returns 200 even for provisioning keys)',
    );
  });

  test('workflow uses the documented Steward baseline model', () => {
    assert.ok(
      yaml.includes('deepseek/deepseek-v4-flash'),
      'probe must use deepseek-v4-flash (Steward default model)',
    );
  });

  test('workflow declares 4 distinct exit codes (success / fail / degraded / exception)', () => {
    // Exit codes: 0 = PROBE_OK, 1 = PROBE_FAIL or auth-missing, 2 = PROBE_DEGRADED, 3 = exception
    assert.match(yaml, /process\.exit\(0\)/, 'must have exit 0 for PROBE_OK');
    assert.match(yaml, /process\.exit\(1\)/, 'must have exit 1 for PROBE_FAIL');
    assert.match(yaml, /process\.exit\(2\)/, 'must have exit 2 for PROBE_DEGRADED');
    assert.match(yaml, /process\.exit\(3\)/, 'must have exit 3 for exception');
  });

  test('workflow diagnoses provisioning-key error specifically', () => {
    // Sprint 2.7+ regression: the workflow must distinguish provisioning from
    // inference keys (they both look valid until /chat-completions is hit).
    assert.match(
      yaml,
      /provisioning/i,
      'workflow must produce a provisioning-key diagnosis on 401',
    );
  });

  test('workflow refuses to run without OPENROUTER_API_KEY secret', () => {
    assert.match(
      yaml,
      /OPENROUTER_API_KEY/,
      'workflow must reference the OPENROUTER_API_KEY secret',
    );
    assert.match(
      yaml,
      /if\s*\(\s*!key\s*\)/,
      'workflow must guard against missing key',
    );
  });
});

// Extract the inline node -e script body so we can execute it under controlled
// conditions. The script lives inside a `run: |` block + a `node -e "..."` shell
// invocation. We anchor extraction on a STABLE sentinel inside the script
// (the .catch handler at the end) rather than YAML whitespace, so the extractor
// survives reformatting of the workflow.
function extractInlineJs() {
  const yaml = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const startIdx = yaml.indexOf('node -e "');
  assert.ok(startIdx >= 0, 'workflow must contain node -e "..." inline invocation');
  const after = yaml.slice(startIdx + 'node -e "'.length);
  // Stable sentinel: the script always ends with `process.exit(3); });` — the
  // catch handler from the outer IIFE. Find that, then walk forward to the
  // closing `"` that ends the node -e argument.
  const sentinel = '});';
  const sentinelIdx = after.lastIndexOf(sentinel);
  assert.ok(sentinelIdx >= 0, 'inline JS must end with IIFE close + catch handler');
  // Search forward from sentinel for the first standalone `"` (the closing
  // quote of the node -e argument). Skip any whitespace lines in between.
  let pos = sentinelIdx + sentinel.length;
  while (pos < after.length && /[\s\n]/.test(after[pos])) pos += 1;
  assert.equal(after[pos], '"', 'expected closing quote after inline IIFE');
  return after.slice(0, sentinelIdx + sentinel.length);
}

describe('steward-key-probe — inline JS behavior (mocked fetch)', () => {
  test('inline JS extraction succeeds', () => {
    const js = extractInlineJs();
    assert.ok(js.includes("openrouter.ai/api/v1/chat/completions"),
      'extracted JS must contain the endpoint URL');
    assert.ok(js.includes('PROBE_OK') && js.includes('PROBE_DEGRADED') && js.includes('PROBE_FAIL'),
      'extracted JS must contain all probe-status strings');
  });

  // Helper: run the inline JS with a mocked fetch + given env, return { exit, stdout }
  function runProbeWithMock({ envOverrides = {}, fetchImpl }) {
    const js = extractInlineJs();
    // Wrap the IIFE with a fetch override + env injection
    const wrapped = `
      globalThis.fetch = ${fetchImpl};
      ${js}
    `;
    const result = spawnSync(process.execPath, ['-e', wrapped], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENROUTER_API_KEY: envOverrides.OPENROUTER_API_KEY ?? 'test-key',
      },
      timeout: 5000,
    });
    return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  test('exit 1 when OPENROUTER_API_KEY is empty', () => {
    const fetchSrc = `async () => ({ status: 200, text: async () => '' })`;
    const { exit, stdout } = runProbeWithMock({
      envOverrides: { OPENROUTER_API_KEY: '' },
      fetchImpl: fetchSrc,
    });
    assert.equal(exit, 1);
    assert.match(stdout, /OPENROUTER_API_KEY secret not set/);
  });

  test('exit 0 on success (200 + non-empty reply)', () => {
    const fetchSrc = `async () => ({
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'KEY_OK' } }],
        usage: { total_tokens: 10 },
      }),
    })`;
    const { exit, stdout } = runProbeWithMock({ fetchImpl: fetchSrc });
    assert.equal(exit, 0);
    assert.match(stdout, /PROBE_OK/);
  });

  test('exit 2 on degraded (200 + empty content)', () => {
    const fetchSrc = `async () => ({
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '' } }], usage: {} }),
    })`;
    const { exit, stdout } = runProbeWithMock({ fetchImpl: fetchSrc });
    assert.equal(exit, 2);
    assert.match(stdout, /PROBE_DEGRADED/);
  });

  test('exit 1 on provisioning-key 401 (diagnostic emitted)', () => {
    const fetchSrc = `async () => ({
      status: 401,
      text: async () => 'not allowed to call this endpoint (provisioning key)',
    })`;
    const { exit, stdout } = runProbeWithMock({ fetchImpl: fetchSrc });
    assert.equal(exit, 1);
    assert.match(stdout, /provisioning/i);
    assert.match(stdout, /PROBE_FAIL/);
  });

  test('exit 3 on exception thrown by fetch', () => {
    const fetchSrc = `async () => { throw new Error('network down'); }`;
    const { exit, stdout } = runProbeWithMock({ fetchImpl: fetchSrc });
    assert.equal(exit, 3);
    assert.match(stdout, /ERROR:.*network down/);
  });
});
