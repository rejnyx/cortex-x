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
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Strengthened: assert ALL three signals are surfaced — sprint name,
    // story id, and pending stage. Catches partial-parse regressions
    // (e.g., regex skips story-id but keeps sprint name).
    assert.match(ctx, /Sprint 1\.0/, `sprint name should surface; got: ${ctx.slice(0, 300)}`);
    assert.match(ctx, /S1\.1/, `next pending story id should surface; got: ${ctx.slice(0, 300)}`);
  });

  test('CLAUDE.md detection emits the actual reference, not a placeholder', () => {
    const r = runSessionStartIn(tmpProject);
    const parsed = parseHookOutput(r.stdout);
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Catches "we mention CLAUDE.md as a string literal placeholder but
    // actually never read its contents" regressions.
    assert.match(ctx, /CLAUDE\.md/);
    // Should NOT contain template placeholder syntax in real output
    assert.ok(!/\{\{[^}]+\}\}/.test(ctx),
      `output should not contain template placeholders; got: ${ctx}`);
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
    // Strengthened: assert BOTH the library detection signal AND the slug
    // identification — catches "we say cortex-x library exists but never
    // actually read the project entry by slug" regressions.
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.match(ctx, /cortex-x library/i, `library detection signal should surface; got: ${ctx}`);
    assert.match(ctx, /datahome-fixture/i, `slug should resolve to library entry; got: ${ctx}`);
  });

  test('without $CORTEX_DATA_HOME, does not falsely claim library entry exists', () => {
    // When the hook can't find the project in any library, it should NOT
    // emit "library entry exists" text. Regression check for fail-safe.
    const r = runSessionStartIn(tmpProject, { CORTEX_DATA_HOME: '/nonexistent-path-9999' });
    const parsed = parseHookOutput(r.stdout);
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert.ok(!/library: entry exists/.test(ctx),
      `should not falsely claim library entry; got: ${ctx}`);
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

// Sprint 2.20.1 — first-run discoverability nudge.
// The hook should detect "this looks like a real project with no cortex-x
// footprint" and inject a strong imperative so Claude offers /cortex-init
// without the operator having to remember the command name.
describe('session-start: first-run discoverability nudge', () => {
  function mkProject(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-firstrun-${name}-`));
  }
  function rmProject(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  test('fires on a real project with no CLAUDE.md / no cortex artifacts', () => {
    const dir = mkProject('fires');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"sample"}');
      fs.writeFileSync(path.join(dir, 'README.md'), '# sample\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      assert.ok(out, 'expected JSON output');
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.match(ctx, /first-run hint/);
      assert.match(ctx, /\/cortex-init/);
    } finally { rmProject(dir); }
  });

  test('does NOT fire when CLAUDE.md already exists', () => {
    const dir = mkProject('claudemd');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"sample"}');
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project setup\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });

  test('does NOT fire when cortex/AUDIT.md exists (project already audited)', () => {
    const dir = mkProject('audited');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"sample"}');
      fs.mkdirSync(path.join(dir, 'cortex'));
      fs.writeFileSync(path.join(dir, 'cortex', 'AUDIT.md'), '# audit\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });

  test('does NOT fire when .cortex-bootstrap-pending in-progress', () => {
    const dir = mkProject('pending');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"sample"}');
      fs.writeFileSync(path.join(dir, '.cortex-bootstrap-pending'), 'mode=new\nat=2026-05-13T20:00:00Z\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });

  test('does NOT fire in a scratch dir with no project signals', () => {
    const dir = mkProject('scratch');
    try {
      // Empty dir — no .git, no package.json, no manifests, no src/.
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });

  test('does NOT fire inside the cortex-x source repo itself', () => {
    // Synthetic cortex-x source — 2+ signals match the SKILL.md edge case.
    const dir = mkProject('cortex-src');
    try {
      fs.writeFileSync(path.join(dir, 'install.sh'), '#!/usr/bin/env bash\n');
      fs.writeFileSync(path.join(dir, 'install.ps1'), '# ps installer\n');
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'bin', 'cortex-bootstrap.cjs'), '// stub\n');
      fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'templates', 'CLAUDE.md.hbs'), '# tpl\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });

  test('fires when only .git is present (newly-init git repo)', () => {
    const dir = mkProject('gitonly');
    try {
      // .git alone is enough to count as a real project — operator just ran
      // `git init`, hasn't added files yet. Hook should still offer /cortex-init.
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      const r = runSessionStartIn(dir);
      const out = parseHookOutput(r.stdout);
      const ctx = out.hookSpecificOutput.additionalContext;
      assert.match(ctx, /first-run hint/);
    } finally { rmProject(dir); }
  });
});
