'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runHook, parseHookOutput, REPO_ROOT } = require('../../_helpers/run-hook.cjs');

const gate = require('../../../shared/hooks/pre-commit-review-gate.cjs');
const { REVIEW_AGENTS } = require('../../../shared/hooks/_lib/review-agents.cjs');

// === isGitCommit ===

test('isGitCommit: matches real commit forms (start + chained + amend)', () => {
  assert.ok(gate.isGitCommit('git commit -m "x"'));
  assert.ok(gate.isGitCommit('  git commit -m "x"'));
  assert.ok(gate.isGitCommit('git add . && git commit -m "x"'));
  assert.ok(gate.isGitCommit('git commit --amend --no-edit'));
  assert.ok(gate.isGitCommit('git stage foo; git commit -m y'));
});

test('isGitCommit: does NOT match the phrase inside an argument', () => {
  assert.equal(gate.isGitCommit('echo "git commit"'), false);
  assert.equal(gate.isGitCommit('grep "git commit" file.txt'), false);
});

test('isGitCommit: rejects non-commit + help + dry-run forms', () => {
  assert.equal(gate.isGitCommit('git status'), false);
  assert.equal(gate.isGitCommit('git commit --help'), false);
  assert.equal(gate.isGitCommit('git commit -h'), false);
  assert.equal(gate.isGitCommit('git commit --dry-run'), false);
  assert.equal(gate.isGitCommit(''), false);
  assert.equal(gate.isGitCommit(null), false);
});

test('isGitCommit: a -h inside the commit message is still a real commit', () => {
  // exclusion must anchor the help flag right after `commit`, not match -h in a msg
  assert.ok(gate.isGitCommit('git commit -m "fix -h handling"'));
});

// === escape hatches ===

test('hasSkipMarker / gateDisabled', () => {
  assert.ok(gate.hasSkipMarker('git commit -m "wip [skip-review]"'));
  assert.equal(gate.hasSkipMarker('git commit -m "normal"'), false);
  assert.ok(gate.gateDisabled({ CORTEX_REVIEW_GATE: '0' }));
  assert.equal(gate.gateDisabled({ CORTEX_REVIEW_GATE: '1' }), false);
  assert.equal(gate.gateDisabled({}), false);
});

// === hashSessionId (must match post-tool-use's algorithm) ===

test('hashSessionId: sha1 first-12, empty for falsy', () => {
  const expected = crypto.createHash('sha1').update('sess-123').digest('hex').slice(0, 12);
  assert.equal(gate.hashSessionId('sess-123'), expected);
  assert.equal(gate.hashSessionId(''), '');
  assert.equal(gate.hashSessionId(null), '');
});

// === decide (pure core) ===

const base = { isCommit: true, skip: false, disabled: false, sessionHash: 'abc123', stagedCount: 5, markerExists: false };

test('decide: non-trivial unreviewed commit → deny', () => {
  const r = gate.decide(base);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /review/i);
});

test('decide: threshold boundary — exactly 3 staged files → deny', () => {
  assert.equal(gate.decide({ ...base, stagedCount: gate.TRIVIAL_FILE_THRESHOLD }).decision, 'deny');
});

test('decide: review ran (marker) → allow', () => {
  assert.equal(gate.decide({ ...base, markerExists: true }).decision, 'allow');
});

test('decide: trivial diff (< threshold) → allow', () => {
  assert.equal(gate.decide({ ...base, stagedCount: gate.TRIVIAL_FILE_THRESHOLD - 1 }).decision, 'allow');
});

test('decide: escape hatches (skip / disabled) → allow', () => {
  assert.equal(gate.decide({ ...base, skip: true }).decision, 'allow');
  assert.equal(gate.decide({ ...base, disabled: true }).decision, 'allow');
});

test('decide: not a commit → allow', () => {
  assert.equal(gate.decide({ ...base, isCommit: false }).decision, 'allow');
});

test('decide: no sessionHash (cannot correlate) → allow (fail-open)', () => {
  assert.equal(gate.decide({ ...base, sessionHash: '' }).decision, 'allow');
});

test('decide: unknown staged count (NaN, git failed) → allow (fail-open)', () => {
  assert.equal(gate.decide({ ...base, stagedCount: NaN }).decision, 'allow');
});

// === hook integration via spawn ===

test('hook: non-commit Bash command passes through (continue:true)', () => {
  const r = runHook('pre-commit-review-gate', { tool_name: 'Bash', tool_input: { command: 'ls -la' }, session_id: 's1' });
  assert.equal(r.exitCode, 0);
  const out = parseHookOutput(r.stdout);
  assert.equal(out.continue, true);
});

test('hook: non-Bash tool passes through', () => {
  const r = runHook('pre-commit-review-gate', { tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: 's1' });
  assert.equal(r.exitCode, 0);
  assert.equal(parseHookOutput(r.stdout).continue, true);
});

test('hook: [skip-review] in commit message short-circuits to allow', () => {
  const r = runHook('pre-commit-review-gate', {
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "wip [skip-review]"' },
    session_id: 's1',
  });
  assert.equal(r.exitCode, 0);
  assert.equal(parseHookOutput(r.stdout).continue, true);
});

test('hook: CORTEX_REVIEW_GATE=0 disables the gate', () => {
  const r = runHook('pre-commit-review-gate',
    { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, session_id: 's1' },
    { env: { CORTEX_REVIEW_GATE: '0' } });
  assert.equal(r.exitCode, 0);
  assert.equal(parseHookOutput(r.stdout).continue, true);
});

// === post-tool-use review marker (the producer the gate consumes) ===

function markerPath(sessionId) {
  const h = crypto.createHash('sha1').update(sessionId).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `cortex-review-${h}.flag`);
}

test('post-tool-use: a review-agent Agent call writes the session marker', () => {
  const sessionId = `marker-test-${Date.now()}`;
  const m = markerPath(sessionId);
  try { fs.rmSync(m, { force: true }); } catch {}
  const r = runHook('post-tool-use', {
    tool_name: 'Agent',
    tool_input: { subagent_type: 'blind-hunter', description: 'review the diff' },
    session_id: sessionId,
    tool_response: { success: true },
  });
  assert.equal(r.exitCode, 0);
  assert.ok(fs.existsSync(m), 'review marker should be written for a review-agent call');
  fs.rmSync(m, { force: true });
});

test('post-tool-use: a non-review Agent call does NOT write the marker', () => {
  const sessionId = `marker-neg-${Date.now()}`;
  const m = markerPath(sessionId);
  try { fs.rmSync(m, { force: true }); } catch {}
  const r = runHook('post-tool-use', {
    tool_name: 'Agent',
    tool_input: { subagent_type: 'general-purpose', description: 'do a thing' },
    session_id: sessionId,
    tool_response: { success: true },
  });
  assert.equal(r.exitCode, 0);
  assert.equal(fs.existsSync(m), false, 'non-review agent must not set the review marker');
  try { fs.rmSync(m, { force: true }); } catch {}
});

// === roster SSOT (the producer Set, the gate's deny-reason, and the on-disk
// agents must all agree — a Set-only drift would silently block every commit) ===

test('REVIEW_AGENTS: deny reason names every roster agent (prose ⊇ roster)', () => {
  const reason = gate.decide({ ...base }).reason;
  for (const agent of REVIEW_AGENTS) {
    assert.ok(reason.includes(agent), `deny reason missing roster agent "${agent}"`);
  }
});

test('REVIEW_AGENTS: every roster agent has an on-disk agents/<name>.md', () => {
  for (const agent of REVIEW_AGENTS) {
    const p = path.join(REPO_ROOT, 'agents', `${agent}.md`);
    assert.ok(fs.existsSync(p), `roster agent "${agent}" has no agents/${agent}.md — roster drifted from reality`);
  }
});

// === deny-envelope integration: the serialized permissionDecision:'deny' shape
// the runtime actually consumes. A key-name typo would pass every unit test but
// silently never block in production — this is the only test that catches it. ===

test('hook: non-trivial unreviewed commit emits permissionDecision:deny envelope', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-gate-e2e-'));
  const sessionId = `e2e-deny-${Date.now()}`;
  const marker = markerPath(sessionId);
  try { fs.rmSync(marker, { force: true }); } catch {} // ensure "no review ran"
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(repo, f), 'x');
    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });

    const r = runHook('pre-commit-review-gate', {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: three files"' },
      session_id: sessionId,
      cwd: repo,
    });
    assert.equal(r.exitCode, 0);
    const out = parseHookOutput(r.stdout);
    assert.ok(out && out.hookSpecificOutput, 'expected hookSpecificOutput envelope');
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /review/i);
  } finally {
    try { fs.rmSync(marker, { force: true }); } catch {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('hook: same commit ALLOWED once the review marker exists', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-gate-e2e-'));
  const sessionId = `e2e-allow-${Date.now()}`;
  const marker = markerPath(sessionId);
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(repo, f), 'x');
    execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
    fs.writeFileSync(marker, new Date().toISOString()); // review "ran"

    const r = runHook('pre-commit-review-gate', {
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "feat: three files"' },
      session_id: sessionId,
      cwd: repo,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(parseHookOutput(r.stdout).continue, true);
  } finally {
    try { fs.rmSync(marker, { force: true }); } catch {}
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
