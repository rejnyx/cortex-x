// auto-orchestrate.test.cjs — UserPromptSubmit soft-gate hook contract.
//
// auto-orchestrate.cjs intercepts UserPromptSubmit, detects "new
// implementation" intents (implement feature / build / wire up / etc.),
// and injects 3-fronta orchestration guidance + research cache state +
// budget into the turn.
//
// Contract (per source: shared/hooks/auto-orchestrate.cjs):
//   - Input on stdin: { prompt, session_id, cwd, ... } (UserPromptSubmit)
//   - No trigger match → stdout: { continue: true } (silent pass-through)
//   - Trigger match → stdout: { continue: true, hookSpecificOutput: {
//                              hookEventName: 'UserPromptSubmit',
//                              additionalContext: <guidance string> } }
//   - Always exit 0 (fail-open contract)
//   - NEVER blocks the turn

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { runHook, parseHookOutput } = require('../../_helpers/run-hook.cjs');

function userPrompt(prompt, extra = {}) {
  return { prompt, session_id: 'test-session', cwd: process.cwd(), ...extra };
}

function expectSilentPassthrough(result) {
  assert.equal(result.exitCode, 0, `auto-orchestrate exited ${result.exitCode}; stderr: ${result.stderr}`);
  const parsed = parseHookOutput(result.stdout);
  assert.ok(parsed, `expected JSON output; got: ${result.stdout}`);
  assert.equal(parsed.continue, true);
  assert.equal(parsed.hookSpecificOutput, undefined,
    `silent pass-through should not emit hookSpecificOutput; got: ${JSON.stringify(parsed.hookSpecificOutput)}`);
}

function expectGuidanceInjected(result) {
  assert.equal(result.exitCode, 0);
  const parsed = parseHookOutput(result.stdout);
  assert.ok(parsed);
  assert.equal(parsed.continue, true);
  assert.ok(parsed.hookSpecificOutput, 'expected hookSpecificOutput on trigger match');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
  assert.ok(parsed.hookSpecificOutput.additionalContext.length > 10,
    'guidance string should be non-trivial');
  return parsed.hookSpecificOutput.additionalContext;
}

describe('auto-orchestrate: trigger patterns', () => {
  test('triggers on Czech "implementuj novou feature"', () => {
    const r = runHook('auto-orchestrate', userPrompt('implementuj novou feature pro správu uživatelů'));
    expectGuidanceInjected(r);
  });

  test('triggers on English "implement a new endpoint"', () => {
    const r = runHook('auto-orchestrate', userPrompt('implement a new endpoint for the users API'));
    expectGuidanceInjected(r);
  });

  test('triggers on "build new component"', () => {
    const r = runHook('auto-orchestrate', userPrompt('build a new component for the dashboard'));
    expectGuidanceInjected(r);
  });

  test('triggers on "wire up payments"', () => {
    const r = runHook('auto-orchestrate', userPrompt('wire up payments via Stripe'));
    expectGuidanceInjected(r);
  });

  test('triggers on "vytvoř novou stránku"', () => {
    const r = runHook('auto-orchestrate', userPrompt('vytvoř novou stránku pro registraci'));
    expectGuidanceInjected(r);
  });
});

describe('auto-orchestrate: guidance content quality', () => {
  test('triggered guidance includes orchestration signal (3-fronta / decision tree / batch)', () => {
    const r = runHook('auto-orchestrate', userPrompt('implement a new feature for users'));
    const ctx = expectGuidanceInjected(r);
    // The guidance string is supposed to direct toward 3-fronta orchestration
    // (per standards/auto-orchestration.md). Catches "we emit 'continue: true'
    // with hookSpecificOutput but additionalContext is empty/garbage" regression.
    assert.ok(ctx.length > 80,
      `guidance should be substantive; got ${ctx.length} chars: ${ctx.slice(0, 200)}`);
    // Must mention research caches or 3-fronta or sequential decision pattern
    assert.match(ctx, /research|3-fronta|sequential|parallel|fronta|decision tree|cache/i,
      `guidance should reference orchestration signals; got: ${ctx.slice(0, 400)}`);
  });

  test('triggered guidance is well-formed (no template-placeholder leaks)', () => {
    const r = runHook('auto-orchestrate', userPrompt('build new auth integration'));
    const ctx = expectGuidanceInjected(r);
    // Catches handlebars-style `{{...}}` placeholders escaping to runtime
    assert.ok(!/\{\{[^}]+\}\}/.test(ctx),
      `guidance should not contain unrendered template placeholders; got: ${ctx.slice(0, 300)}`);
    // Catches "undefined" string from missing context value
    assert.ok(!/\bundefined\b/.test(ctx),
      `guidance should not contain literal 'undefined'; got: ${ctx.slice(0, 300)}`);
  });

  test('guidance surfaces research-cache state (catches "buildGuidance ran with empty caches" regression)', () => {
    const r = runHook('auto-orchestrate', userPrompt('implement new endpoint'));
    const ctx = expectGuidanceInjected(r);
    // The hook calls listResearchCache() and the result should show up
    // in guidance (even when empty — output reads "(empty)" or similar).
    // Catches "we read the cache dir but never include the result" regression.
    assert.match(ctx, /Research cache|cache:/i,
      `guidance should mention research cache; got: ${ctx.slice(0, 400)}`);
  });

  test('guidance includes decision tree / next-step direction', () => {
    const r = runHook('auto-orchestrate', userPrompt('implement new endpoint'));
    const ctx = expectGuidanceInjected(r);
    // The 3-fronta pattern requires the user / Claude to decide research-vs-skip.
    // Guidance should include numbered or bulleted decision steps.
    assert.match(ctx, /Decision tree|decision|spawn.*Agent|skip|implement/i,
      `guidance should include decision/next-step direction; got: ${ctx.slice(0, 400)}`);
  });
});

describe('auto-orchestrate: skip patterns', () => {
  test('skips "fix typo"', () => {
    const r = runHook('auto-orchestrate', userPrompt('fix typo in README — implement → implements'));
    expectSilentPassthrough(r);
  });

  test('skips "quick fix"', () => {
    const r = runHook('auto-orchestrate', userPrompt('quick fix the broken link'));
    expectSilentPassthrough(r);
  });

  test('skips "skip research"', () => {
    const r = runHook('auto-orchestrate', userPrompt('skip research and just implement the feature'));
    expectSilentPassthrough(r);
  });

  test('silent on simple greeting', () => {
    const r = runHook('auto-orchestrate', userPrompt('ahoj, jak se máš?'));
    expectSilentPassthrough(r);
  });

  test('silent on simple question', () => {
    const r = runHook('auto-orchestrate', userPrompt('what does this function do?'));
    expectSilentPassthrough(r);
  });
});

describe('auto-orchestrate: fail-open contract', () => {
  test('exit 0 on malformed JSON input', () => {
    const r = runHook('auto-orchestrate', '{ malformed');
    assert.equal(r.exitCode, 0);
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed);
    assert.equal(parsed.continue, true);
  });

  test('exit 0 on empty stdin', () => {
    const r = runHook('auto-orchestrate', '');
    assert.equal(r.exitCode, 0);
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed);
    assert.equal(parsed.continue, true);
  });

  test('exit 0 on missing prompt field', () => {
    const r = runHook('auto-orchestrate', { session_id: 'test', cwd: '/tmp' });
    assert.equal(r.exitCode, 0);
    expectSilentPassthrough(r);
  });

  test('respects 5s timeout', () => {
    const r = runHook('auto-orchestrate', userPrompt('hello'), { timeout: 5000 });
    assert.equal(r.timedOut, false);
  });

  test('CORTEX_BUDGET_DISABLED suppresses budget guidance', () => {
    // When budget is disabled, guidance should still emit but without USD figures
    const r = runHook(
      'auto-orchestrate',
      userPrompt('implement a new feature'),
      { env: { CORTEX_BUDGET_DISABLED: '1' } }
    );
    const ctx = expectGuidanceInjected(r);
    assert.ok(!/\$\d+\.\d{2}/.test(ctx),
      `with CORTEX_BUDGET_DISABLED=1, guidance should not contain dollar figures; got: ${ctx.slice(0, 300)}`);
  });
});

describe('auto-orchestrate: PII / Dave-path leak guard', () => {
  test('output does not leak Dave-specific paths', () => {
    const r = runHook('auto-orchestrate', userPrompt('implement a new feature'));
    const stdout = r.stdout.toLowerCase();
    assert.ok(
      !stdout.includes('/c/users/david/') && !stdout.includes('c:\\users\\david\\'),
      `auto-orchestrate hook leaked Dave-specific path; output:\n${r.stdout}`
    );
  });
});
