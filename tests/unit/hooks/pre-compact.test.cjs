// pre-compact.test.cjs — PreCompact state-snapshot hook contract.
//
// pre-compact.cjs runs before Claude Code compacts the conversation.
// It snapshots the active sprint state from PROGRESS.md (if present) +
// CLAUDE.md context to .claude/compact-state.md so that resume sessions
// can recover where the user left off.
//
// Contract (per source: shared/hooks/pre-compact.cjs):
//   - Input: stdin payload { hook_event_name: 'PreCompact', trigger, ... }
//     (the hook does not actually read stdin — it operates from process.cwd())
//   - Side effect: writes <cwd>/.claude/compact-state.md with snapshot
//   - Stdout: human-readable status lines (NOT JSON)
//   - Exit 0 always
//
// Per Anthropic docs (code.claude.com/docs/en/hooks), PreCompact non-zero
// stderr is fed to Claude but does not abort compaction. So the only thing
// the test needs to assert is: .claude/compact-state.md gets written.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runHook } = require('../../_helpers/run-hook.cjs');

function makeTmpProject(name, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-precompact-test-${name}-`));
  for (const [filename, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filename);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

function runPreCompactIn(cwd) {
  return runHook('pre-compact', '', { cwd });
}

describe('pre-compact: state file write', () => {
  let tmp;
  after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

  test('writes .claude/compact-state.md on bare project', () => {
    tmp = makeTmpProject('bare', {
      'package.json': JSON.stringify({ name: 'bare-fixture' }),
    });
    const r = runPreCompactIn(tmp);
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
    const stateFile = path.join(tmp, '.claude', 'compact-state.md');
    assert.ok(fs.existsSync(stateFile), `expected ${stateFile} to be written`);
    const content = fs.readFileSync(stateFile, 'utf8');
    assert.match(content, /Compact Recovery State/i);
    assert.match(content, /Auto-generated at \d{4}-/);
  });
});

describe('pre-compact: sprint extraction from PROGRESS.md', () => {
  let tmp;
  after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

  test('captures active sprint name when PROGRESS.md present', () => {
    tmp = makeTmpProject('with-progress', {
      'package.json': JSON.stringify({ name: 'with-progress-fixture' }),
      'PROGRESS.md': [
        '## Sprint 2.5 — Active feature work',
        '',
        '| Story | Popis | Stav |',
        '|---|---|---|',
        '| S2.5.1 | First story | done |',
        '| S2.5.2 | Second story | pending |',
      ].join('\n'),
    });
    const r = runPreCompactIn(tmp);
    assert.equal(r.exitCode, 0);
    const stateFile = path.join(tmp, '.claude', 'compact-state.md');
    const content = fs.readFileSync(stateFile, 'utf8');
    assert.match(content, /Sprint 2\.5/);
  });

  test('mentions CLAUDE.md when present', () => {
    tmp = makeTmpProject('with-claude', {
      'package.json': JSON.stringify({ name: 'with-claude-fixture' }),
      'CLAUDE.md': '# Project instructions\n',
    });
    const r = runPreCompactIn(tmp);
    assert.equal(r.exitCode, 0);
    const stateFile = path.join(tmp, '.claude', 'compact-state.md');
    const content = fs.readFileSync(stateFile, 'utf8');
    assert.match(content, /CLAUDE\.md/);
  });

  test('handles missing .claude/ dir (creates parents)', () => {
    tmp = makeTmpProject('no-claude-dir', {
      'package.json': JSON.stringify({ name: 'no-claude-dir-fixture' }),
    });
    // Confirm .claude/ does not exist yet
    assert.ok(!fs.existsSync(path.join(tmp, '.claude')));
    const r = runPreCompactIn(tmp);
    assert.equal(r.exitCode, 0);
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'compact-state.md')),
      'pre-compact must mkdirSync .claude/ before writing the state file');
  });
});

describe('pre-compact: idempotency + safety', () => {
  let tmp;
  after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

  test('overwrites existing state file (subsequent run replaces)', () => {
    tmp = makeTmpProject('idempotent', {
      'package.json': JSON.stringify({ name: 'idempotent-fixture' }),
      '.claude/compact-state.md': '# Stale content\nFrom a previous run.',
    });
    const r = runPreCompactIn(tmp);
    assert.equal(r.exitCode, 0);
    const content = fs.readFileSync(path.join(tmp, '.claude', 'compact-state.md'), 'utf8');
    assert.match(content, /Compact Recovery State/);
    assert.ok(!content.includes('Stale content'),
      'pre-compact must overwrite stale state, not append');
  });

  test('respects 5s timeout', () => {
    tmp = makeTmpProject('budget', {
      'package.json': JSON.stringify({ name: 'budget-fixture' }),
    });
    const r = runPreCompactIn(tmp);
    assert.equal(r.timedOut, false);
    assert.equal(r.exitCode, 0);
  });
});
