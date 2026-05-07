// session-start.test.cjs — context-injection hook contract.
//
// session-start.cjs runs on every Claude Code session start. It scans cwd
// for PROGRESS.md / CLAUDE.md / MEMORY.md, queries git state, resolves
// $CORTEX_DATA_HOME for cross-project library lookup, and emits structured
// JSON on stdout that Claude Code injects as additional context.
//
// Output contract (per source: shared/hooks/session-start.cjs:333):
//   { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: <string> } }
//
// Hooks are deliberately resilient — missing files, missing git, missing
// $CORTEX_DATA_HOME all gracefully fall through. Tests verify this fail-open
// stays intact.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runHook, parseHookOutput } = require('../../_helpers/run-hook.cjs');

function makeTmpProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-session-test-${name}-`));
  return dir;
}

function runSessionStartIn(cwd, extraEnv = {}) {
  return runHook('session-start', '', { cwd, env: extraEnv });
}

describe('session-start: output contract', () => {
  let tmpProject;

  before(() => {
    tmpProject = makeTmpProject('contract');
    fs.writeFileSync(path.join(tmpProject, 'package.json'), JSON.stringify({ name: 'fixture-proj', version: '0.0.1' }));
  });

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('emits valid JSON shape', () => {
    const r = runSessionStartIn(tmpProject);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed, `stdout was not JSON: ${r.stdout}`);
    assert.ok(parsed.hookSpecificOutput, 'missing hookSpecificOutput key');
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
  });

  test('exits 0 on bare project (no docs, no git)', () => {
    const r = runSessionStartIn(tmpProject);
    assert.equal(r.exitCode, 0);
  });

  test('completes within 5s budget', () => {
    const start = Date.now();
    const r = runSessionStartIn(tmpProject);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `session-start took ${elapsed}ms — exceeds 5s budget`);
    assert.equal(r.exitCode, 0);
  });
});

describe('session-start: project-doc detection', () => {
  let tmpProject;

  before(() => {
    tmpProject = makeTmpProject('docs');
    fs.writeFileSync(path.join(tmpProject, 'package.json'), JSON.stringify({ name: 'fixture-with-docs' }));
    fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# Fixture project instructions\n');
    fs.writeFileSync(
      path.join(tmpProject, 'PROGRESS.md'),
      '## Sprint 1.0\n\n| Story | Popis | Stav |\n|---|---|---|\n| S1.1 | First | pending |\n'
    );
  });

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('mentions CLAUDE.md when present', () => {
    const r = runSessionStartIn(tmpProject);
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed);
    assert.match(parsed.hookSpecificOutput.additionalContext, /CLAUDE\.md/);
  });

  test('parses active sprint from PROGRESS.md', () => {
    const r = runSessionStartIn(tmpProject);
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed);
    // Either the sprint name or the next-pending story should surface
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(/Sprint 1\.0|S1\.1|pending/.test(ctx), `expected sprint/story info; got: ${ctx.slice(0, 200)}`);
  });
});

describe('session-start: $CORTEX_DATA_HOME resolution', () => {
  let tmpProject;
  let tmpDataHome;

  before(() => {
    tmpProject = makeTmpProject('datahome');
    fs.writeFileSync(path.join(tmpProject, 'package.json'), JSON.stringify({ name: 'datahome-fixture' }));

    // Build an isolated $CORTEX_DATA_HOME with a projects-library entry
    tmpDataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-home-test-'));
    fs.mkdirSync(path.join(tmpDataHome, 'projects'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDataHome, 'projects', 'datahome-fixture.md'),
      '---\nslug: datahome-fixture\nproject_path: ' + tmpProject + '\n---\n# datahome-fixture\nExisting library entry.\n'
    );
  });

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(tmpDataHome, { recursive: true, force: true });
  });

  test('respects $CORTEX_DATA_HOME env override', () => {
    const r = runSessionStartIn(tmpProject, { CORTEX_DATA_HOME: tmpDataHome });
    const parsed = parseHookOutput(r.stdout);
    assert.ok(parsed);
    // Should mention the cortex library entry exists for this project
    assert.match(parsed.hookSpecificOutput.additionalContext, /cortex-x library|datahome-fixture/i);
  });
});

describe('session-start: PII / Dave-path leak guard', () => {
  let tmpProject;

  before(() => {
    tmpProject = makeTmpProject('pii');
    fs.writeFileSync(path.join(tmpProject, 'package.json'), JSON.stringify({ name: 'pii-fixture' }));
  });

  after(() => {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('output does not leak Dave-specific paths', () => {
    const r = runSessionStartIn(tmpProject);
    // The hook source itself shouldn't bake in Dave's home dir; runtime
    // resolution from process.env.HOME / os.homedir() would obviously
    // include the runtime user's home, which is fine. What we check:
    // no /c/Users/david/ literal substring (lowercase comparison).
    const stdout = r.stdout.toLowerCase();
    assert.ok(
      !stdout.includes('/c/users/david/') && !stdout.includes('c:\\users\\david\\'),
      `session-start hook leaked Dave-specific path; output:\n${r.stdout}`
    );
  });
});
