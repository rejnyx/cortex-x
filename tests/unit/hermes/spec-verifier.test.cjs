// spec-verifier.test.cjs — Sprint 1.9.0 spec-driven verification unit tests.
//
// Coverage targets (per docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md
// "Acceptance Criteria for the Sprint Itself"):
//   - validateCriterion: every kind, every malformed shape
//   - simpleGlobMatch / filterTargets: ** vs * semantics
//   - mergeCriteria: add new id, strengthen existing, reject downgrade,
//     reject kind-change, reject malformed override
//   - runShell: exit 0 → ok, exit !=0 → SPEC_VIOLATION, timeout → SPEC_SHELL_TIMEOUT
//   - runFilePredicate: truthy → ok, falsy → SPEC_VIOLATION, throw → SPEC_PREDICATE_THREW
//   - runRegex: match → ok, no-match → SPEC_REGEX_NO_MATCH, applies_to glob filter
//   - runEarsText: runtime no-op success
//   - runLlmJudge: throws SPEC_LLM_JUDGE_NOT_IMPLEMENTED
//   - runChecks: end-to-end with stub action-kinds registry covering happy/block/warn

'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sv = require('../../../bin/hermes/_lib/spec-verifier.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// validateCriterion
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCriterion: structural rules', () => {
  test('rejects null/undefined/non-object', () => {
    assert.equal(sv.validateCriterion(null).ok, false);
    assert.equal(sv.validateCriterion(undefined).ok, false);
    assert.equal(sv.validateCriterion('string').ok, false);
    assert.equal(sv.validateCriterion([]).ok, false);
  });

  test('rejects missing or empty id', () => {
    assert.equal(sv.validateCriterion({ kind: 'shell', cmd: 'echo' }).ok, false);
    assert.equal(sv.validateCriterion({ id: '', kind: 'shell', cmd: 'echo' }).ok, false);
  });

  test('rejects unknown kind', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'magic' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /kind/i);
  });

  test('rejects invalid severity', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'shell', cmd: 'true', severity: 'panic' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /severity/);
  });

  test('rejects non-array applies_to', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: 'a', applies_to: 'docs/**' });
    assert.equal(r.ok, false);
  });

  test('Sprint 1.9.0 review (edge HIGH-D): rejects empty applies_to array (semantic ambiguity)', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: 'a', applies_to: [] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /empty applies_to/);
  });

  test('rejects applies_to with non-string elements', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: 'a', applies_to: ['docs/**', 42] });
    assert.equal(r.ok, false);
  });

  test('Sprint 1.9.0 review (security/MED): predicate denylist rejects globalThis token', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: 'globalThis.process.exit(7)' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /denylisted token/);
  });

  test('predicate denylist rejects process / require / Function tokens', () => {
    for (const tok of ['process.cwd()', 'require("fs")', 'Function("ev")()', 'eval("ev")', 'fetch("evil")', 'child_process.execSync("ls")']) {
      const r = sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: tok });
      assert.equal(r.ok, false, `expected reject for: ${tok}`);
    }
  });

  test('predicate denylist allows legitimate helpers (touchedFiles, fileSize, etc.)', () => {
    const r = sv.validateCriterion({
      id: 'x', kind: 'file_predicate',
      predicate: 'touchedFiles.every(p => fileSize(p) >= prevSize(p) * 0.5)',
    });
    assert.equal(r.ok, true);
  });
});

describe('validateCriterion: shell', () => {
  test('accepts well-formed shell criterion', () => {
    const r = sv.validateCriterion({ id: 'lint', kind: 'shell', cmd: 'echo ok', timeoutMs: 5000 });
    assert.equal(r.ok, true);
  });
  test('rejects empty cmd', () => {
    assert.equal(sv.validateCriterion({ id: 'x', kind: 'shell', cmd: '' }).ok, false);
  });
  test('rejects negative timeoutMs', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'shell', cmd: 'echo', timeoutMs: -1 });
    assert.equal(r.ok, false);
  });
});

describe('validateCriterion: file_predicate', () => {
  test('accepts compilable predicate', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: 'true' });
    assert.equal(r.ok, true);
  });
  test('rejects empty predicate', () => {
    assert.equal(sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: '' }).ok, false);
  });
  test('rejects non-compilable predicate (syntax error at registry edit time)', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'file_predicate', predicate: 'this is not js (' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /compile/i);
  });
});

describe('validateCriterion: regex', () => {
  test('accepts valid pattern', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: '^Sprint', flags: 'm' });
    assert.equal(r.ok, true);
  });
  test('rejects empty pattern', () => {
    assert.equal(sv.validateCriterion({ id: 'x', kind: 'regex', pattern: '' }).ok, false);
  });
  test('rejects invalid pattern', () => {
    const r = sv.validateCriterion({ id: 'x', kind: 'regex', pattern: '(' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid pattern/i);
  });
});

describe('validateCriterion: ears_text (5 EARS patterns)', () => {
  test('accepts Ubiquitous (THE SYSTEM SHALL ...)', () => {
    const r = sv.validateCriterion({
      id: 'ubi', kind: 'ears_text',
      ears: 'THE SYSTEM SHALL preserve existing file content unless replace_all is true',
    });
    assert.equal(r.ok, true);
  });
  test('accepts Event-driven (WHEN ... THE SYSTEM SHALL ...)', () => {
    const r = sv.validateCriterion({
      id: 'when', kind: 'ears_text',
      ears: 'WHEN edit.replace_all is false THE SYSTEM SHALL preserve >= 50% existing bytes',
    });
    assert.equal(r.ok, true);
  });
  test('accepts State (WHILE ... THE SYSTEM SHALL ...)', () => {
    const r = sv.validateCriterion({
      id: 'while', kind: 'ears_text',
      ears: 'WHILE the lock is held THE SYSTEM SHALL block additional Hermes runs',
    });
    assert.equal(r.ok, true);
  });
  test('accepts Optional (WHERE ... THE SYSTEM SHALL ...)', () => {
    const r = sv.validateCriterion({
      id: 'where', kind: 'ears_text',
      ears: 'WHERE the action targets cortex/recommendations.md THE SYSTEM SHALL preserve existing items',
    });
    assert.equal(r.ok, true);
  });
  test('accepts Unwanted (IF ..., THEN ... SHALL ...)', () => {
    const r = sv.validateCriterion({
      id: 'if', kind: 'ears_text',
      ears: 'IF a destructive rewrite is detected, THEN the system SHALL reject the edit',
    });
    assert.equal(r.ok, true);
  });
  test('rejects free-text without EARS pattern', () => {
    const r = sv.validateCriterion({
      id: 'bad', kind: 'ears_text',
      ears: 'this is just english prose, no shall verb',
    });
    assert.equal(r.ok, false);
  });
});

describe('validateCriterion: llm_judge (declared but not implemented at runtime)', () => {
  test('accepts well-formed llm_judge criterion (validation passes; runner throws)', () => {
    const r = sv.validateCriterion({ id: 'judge', kind: 'llm_judge', rubric: 'is the doc complete?' });
    assert.equal(r.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// glob matching
// ─────────────────────────────────────────────────────────────────────────────

describe('simpleGlobMatch', () => {
  test('** matches across path segments', () => {
    assert.equal(sv.simpleGlobMatch('docs/**', 'docs/a.md'), true);
    assert.equal(sv.simpleGlobMatch('docs/**', 'docs/sub/a.md'), true);
    assert.equal(sv.simpleGlobMatch('**/CLAUDE.md', 'foo/bar/CLAUDE.md'), true);
  });
  test('* matches within a single segment', () => {
    assert.equal(sv.simpleGlobMatch('*.md', 'README.md'), true);
    assert.equal(sv.simpleGlobMatch('*.md', 'docs/README.md'), false);
  });
  test('exact path match', () => {
    assert.equal(sv.simpleGlobMatch('MIGRATIONS.md', 'MIGRATIONS.md'), true);
    assert.equal(sv.simpleGlobMatch('MIGRATIONS.md', 'docs/MIGRATIONS.md'), false);
  });
  test('escapes regex meta characters in literal segments', () => {
    assert.equal(sv.simpleGlobMatch('docs/v1.0.md', 'docs/v1x0xmd'), false);
    assert.equal(sv.simpleGlobMatch('docs/v1.0.md', 'docs/v1.0.md'), true);
  });
  test('Windows backslash paths normalize to forward-slash', () => {
    assert.equal(sv.simpleGlobMatch('docs/**', 'docs\\sub\\a.md'), true);
  });
});

describe('filterTargets', () => {
  test('null/empty globs returns full touched list', () => {
    const targets = sv.filterTargets(null, ['a.md', 'b.md']);
    assert.deepEqual(targets, ['a.md', 'b.md']);
  });
  test('multi-glob OR-matches', () => {
    const targets = sv.filterTargets(['*.md', 'src/**'], ['a.md', 'src/foo.js', 'pkg/x.json']);
    assert.deepEqual(targets, ['a.md', 'src/foo.js']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeCriteria
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeCriteria', () => {
  test('null/empty overrides returns kindCriteria unchanged', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true' }];
    const m = sv.mergeCriteria(kind, null);
    assert.equal(m.ok, true);
    assert.deepEqual(m.criteria, kind);
  });

  test('adds new id from plan override', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true' }];
    const overrides = [{ id: 'b', kind: 'shell', cmd: 'true' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
    assert.equal(m.criteria.length, 2);
    assert.deepEqual(m.criteria.map((c) => c.id), ['a', 'b']);
  });

  test('strengthens existing id (same kind, same severity) → replace authoritative', () => {
    const kind = [{ id: 'a', kind: 'file_predicate', predicate: 'fileSize("x") >= 100' }];
    const overrides = [{ id: 'a', kind: 'file_predicate', predicate: 'fileSize("x") >= 200' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
    assert.equal(m.criteria.length, 1);
    assert.match(m.criteria[0].predicate, />= 200/);
  });

  test('rejects kind change for same id (SPEC_OVERRIDE_REJECTED)', () => {
    const kind = [{ id: 'a', kind: 'file_predicate', predicate: 'true' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, false);
    assert.equal(m.code, 'SPEC_OVERRIDE_REJECTED');
  });

  test('rejects severity downgrade (block → warn)', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'block' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'warn' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, false);
    assert.equal(m.code, 'SPEC_OVERRIDE_REJECTED');
  });

  test('allows severity upgrade (warn → block)', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'warn' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'block' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
    assert.equal(m.criteria[0].severity, 'block');
  });

  test('rejects malformed override (missing id)', () => {
    const m = sv.mergeCriteria([], [{ kind: 'shell', cmd: 'true' }]);
    assert.equal(m.ok, false);
    assert.equal(m.code, 'SPEC_MALFORMED');
  });

  test('Sprint 1.9.0 review (correctness mutation killer): warn → warn allowed', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'warn' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'warn' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
    assert.equal(m.criteria[0].severity, 'warn');
  });

  test('Sprint 1.9.0 review (correctness mutation killer): block → block allowed', () => {
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'block' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'block' }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
    assert.equal(m.criteria[0].severity, 'block');
  });

  test('omitted severity defaults to block; defaulting cannot be used to mask a downgrade', () => {
    // Existing block, override with severity:undefined → defaults to block → no downgrade
    const kind = [{ id: 'a', kind: 'shell', cmd: 'true', severity: 'block' }];
    const overrides = [{ id: 'a', kind: 'shell', cmd: 'true' /* no severity */ }];
    const m = sv.mergeCriteria(kind, overrides);
    assert.equal(m.ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Individual runners
// ─────────────────────────────────────────────────────────────────────────────

describe('runShell', () => {
  let tmpRoot;
  beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-shell-')); });
  afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('exit 0 returns ok', () => {
    // Use cross-platform builtin: `cd .` exits 0 on both POSIX and cmd.exe shells.
    const r = sv.runShell({ id: 'x', kind: 'shell', cmd: 'cd .' }, { repoRoot: tmpRoot });
    assert.equal(r.ok, true);
  });

  test('non-zero exit returns SPEC_VIOLATION', () => {
    const cmd = process.platform === 'win32' ? 'cmd /c exit 7' : 'exit 7';
    const r = sv.runShell({ id: 'x', kind: 'shell', cmd }, { repoRoot: tmpRoot });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_VIOLATION');
    assert.match(r.actual, /exit 7/);
  });

  test('timeout returns SPEC_SHELL_TIMEOUT', () => {
    // Sleep long enough to exceed timeout. node -e is universal.
    const cmd = `node -e "setTimeout(()=>{}, 5000)"`;
    const r = sv.runShell({ id: 'x', kind: 'shell', cmd, timeoutMs: 200 }, { repoRoot: tmpRoot });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_SHELL_TIMEOUT');
  });

  test('Sprint 1.9.0 review (edge HIGH-C): ENOENT-style cmd-not-found returns SPEC_MALFORMED, not SPEC_SHELL_TIMEOUT', () => {
    // Use a command that genuinely doesn't exist. Note: with shell:true the
    // shell itself runs and reports "command not found" via non-zero exit
    // (POSIX) or 1/9009 (cmd.exe) — not as r.error ENOENT directly. Some
    // hosts surface r.error; both paths are valid. We just assert this is
    // NOT misclassified as SPEC_SHELL_TIMEOUT.
    const cmd = 'definitely-not-a-real-binary-xyz-9999';
    const r = sv.runShell({ id: 'x', kind: 'shell', cmd }, { repoRoot: tmpRoot });
    assert.equal(r.ok, false);
    assert.notEqual(r.code, 'SPEC_SHELL_TIMEOUT', `expected NOT SPEC_SHELL_TIMEOUT, got ${r.code} (actual=${r.actual})`);
    // Either SPEC_MALFORMED (r.error path) or SPEC_VIOLATION (shell exit !=0).
    assert.ok(['SPEC_MALFORMED', 'SPEC_VIOLATION'].includes(r.code), `unexpected code: ${r.code}`);
  });
});

describe('runFilePredicate', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-pred-'));
    fs.writeFileSync(path.join(tmpRoot, 'doc.md'), 'a'.repeat(100), 'utf8');
  });
  afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('truthy predicate returns ok', () => {
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: 'fileSize("doc.md") === 100' },
      { repoRoot: tmpRoot, touchedFiles: ['doc.md'] },
    );
    assert.equal(r.ok, true);
  });

  test('falsy predicate returns SPEC_VIOLATION', () => {
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: 'fileSize("doc.md") > 1000' },
      { repoRoot: tmpRoot, touchedFiles: ['doc.md'] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_VIOLATION');
  });

  test('runtime throw returns SPEC_PREDICATE_THREW', () => {
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: 'undefinedThing.crash()' },
      { repoRoot: tmpRoot, touchedFiles: ['doc.md'] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_PREDICATE_THREW');
  });

  test('Sprint 1.9.0 review (edge HIGH-B): Promise-returning predicate → SPEC_PREDICATE_THREW (not silent pass)', () => {
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: 'Promise.resolve(false)' },
      { repoRoot: tmpRoot, touchedFiles: [] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_PREDICATE_THREW');
    assert.match(r.actual, /Promise/);
  });

  test('thenable (Promise-shaped object) also rejected', () => {
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: '({ then: () => {} })' },
      { repoRoot: tmpRoot, touchedFiles: [] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_PREDICATE_THREW');
  });

  test('PR #3/#4 reproduction: shrink ratio guard via prevSize/fileSize', () => {
    // Pretend doc.md was 1000 bytes pre-edit but now shrunk to 100 bytes (10%).
    const r = sv.runFilePredicate(
      {
        id: 'no_destructive_rewrite',
        kind: 'file_predicate',
        predicate: 'touchedFiles.every(p => prevSize(p) < 200 || fileSize(p) >= prevSize(p) * 0.5)',
      },
      {
        repoRoot: tmpRoot,
        touchedFiles: ['doc.md'],
        previousSizes: { 'doc.md': 1000 },
      },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_VIOLATION');
  });

  test('predicate cannot reach module-scope require (new Function sandboxing)', () => {
    // `require` is bound at module scope by Node's CommonJS wrapper, not on
    // globalThis. `new Function` creates a function whose [[Scope]] is the
    // global execution context — it does NOT capture the module-scope `require`.
    // So `typeof require` is "undefined" inside the predicate. Predicate
    // returns false → SPEC_VIOLATION. This documents the trust-boundary
    // baseline; if we later swap to vm.runInNewContext, this test pins the
    // expected isolation level.
    const r = sv.runFilePredicate(
      { id: 'x', kind: 'file_predicate', predicate: 'typeof require === "function"' },
      { repoRoot: tmpRoot, touchedFiles: [] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_VIOLATION');
  });
});

describe('runRegex', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-regex-'));
    fs.writeFileSync(path.join(tmpRoot, 'MIGRATIONS.md'), 'Sprint 1.7.X notes\nSprint 1.8.13 notes\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'OTHER.md'), 'unrelated\n', 'utf8');
  });
  afterEach(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

  test('matching pattern in target returns ok', () => {
    const r = sv.runRegex(
      { id: 'x', kind: 'regex', pattern: '^Sprint 1\\.[78]\\.', flags: 'm' },
      { repoRoot: tmpRoot, touchedFiles: ['MIGRATIONS.md'] },
    );
    assert.equal(r.ok, true);
  });

  test('no match returns SPEC_REGEX_NO_MATCH', () => {
    const r = sv.runRegex(
      { id: 'x', kind: 'regex', pattern: '^Sprint 9\\.', flags: 'm' },
      { repoRoot: tmpRoot, touchedFiles: ['MIGRATIONS.md'] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_REGEX_NO_MATCH');
  });

  test('applies_to glob filters which touched files are checked', () => {
    const r = sv.runRegex(
      { id: 'x', kind: 'regex', pattern: 'Sprint', flags: 'm', applies_to: ['MIGRATIONS.md'] },
      { repoRoot: tmpRoot, touchedFiles: ['MIGRATIONS.md', 'OTHER.md'] },
    );
    assert.equal(r.ok, true); // OTHER.md skipped; MIGRATIONS.md matches
  });

  test('applies_to with no matches in touched returns ok (no applicable target)', () => {
    const r = sv.runRegex(
      { id: 'x', kind: 'regex', pattern: 'NEVER_MATCHES', applies_to: ['nonexistent/**'] },
      { repoRoot: tmpRoot, touchedFiles: ['MIGRATIONS.md'] },
    );
    assert.equal(r.ok, true);
  });
});

describe('runEarsText runtime no-op', () => {
  test('always returns ok (1.9.0: doc-only at runtime)', () => {
    const r = sv.runEarsText(
      { id: 'x', kind: 'ears_text', ears: 'WHEN x THE SYSTEM SHALL y' },
      { repoRoot: '.', touchedFiles: [] },
    );
    assert.equal(r.ok, true);
  });
});

describe('runLlmJudge', () => {
  test('throws SPEC_LLM_JUDGE_NOT_IMPLEMENTED (kind reserved for v2.0+)', () => {
    const r = sv.runLlmJudge(
      { id: 'x', kind: 'llm_judge', rubric: 'is it ok' },
      { repoRoot: '.', touchedFiles: [] },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_LLM_JUDGE_NOT_IMPLEMENTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runChecks (end-to-end with stub registry)
// ─────────────────────────────────────────────────────────────────────────────

function makeStubRegistry(kindEntries) {
  return {
    DEFAULT_KIND: 'recommendation',
    getActionKind: (name) => kindEntries[name] || null,
  };
}

describe('runChecks: registry contract', () => {
  test('unknown action_kind returns SPEC_MALFORMED', () => {
    const r = sv.runChecks(
      { action_kind: 'nope' },
      { ok: true, touchedFiles: [] },
      { repoRoot: '.', actionKinds: makeStubRegistry({}) },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MALFORMED');
  });

  test('strict mode (Q2=YES): kind without acceptance_criteria array fails', () => {
    const r = sv.runChecks(
      { action_kind: 'recommendation' },
      { ok: true, touchedFiles: [] },
      {
        repoRoot: '.',
        actionKinds: makeStubRegistry({ recommendation: { description: 'x' /* no acceptance_criteria */ } }),
      },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MALFORMED');
  });

  test('happy path: all criteria pass', () => {
    let tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-runchk-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.md'), 'hello world', 'utf8');
    try {
      const r = sv.runChecks(
        { action_kind: 'recommendation' },
        { ok: true, touchedFiles: ['a.md'] },
        {
          repoRoot: tmpRoot,
          actionKinds: makeStubRegistry({
            recommendation: {
              acceptance_criteria: [
                { id: 'positive_size', kind: 'file_predicate', predicate: 'fileSize("a.md") > 0' },
                { id: 'has_hello', kind: 'regex', pattern: 'hello', applies_to: ['a.md'] },
              ],
            },
          }),
        },
      );
      assert.equal(r.ok, true);
      assert.deepEqual(r.spec_failures, []);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('block-severity failure → SPEC_VIOLATION + spec_failures populated', () => {
    let tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-runchk-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.md'), 'short', 'utf8');
    try {
      const r = sv.runChecks(
        { action_kind: 'recommendation' },
        { ok: true, touchedFiles: ['a.md'], previousSizes: { 'a.md': 10000 } },
        {
          repoRoot: tmpRoot,
          actionKinds: makeStubRegistry({
            recommendation: {
              acceptance_criteria: [
                {
                  id: 'no_destructive_rewrite',
                  kind: 'file_predicate',
                  predicate: 'touchedFiles.every(p => prevSize(p) < 200 || fileSize(p) >= prevSize(p) * 0.5)',
                  severity: 'block',
                },
              ],
            },
          }),
        },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'SPEC_VIOLATION');
      assert.equal(r.spec_failures.length, 1);
      assert.equal(r.spec_failures[0].id, 'no_destructive_rewrite');
      assert.equal(r.spec_failures[0].severity, 'block');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('warn-severity-only failure → ok=true, code=SPEC_WARNING', () => {
    let tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-runchk-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.md'), 'tiny', 'utf8');
    try {
      const r = sv.runChecks(
        { action_kind: 'recommendation' },
        { ok: true, touchedFiles: ['a.md'] },
        {
          repoRoot: tmpRoot,
          actionKinds: makeStubRegistry({
            recommendation: {
              acceptance_criteria: [
                { id: 'lengthy', kind: 'file_predicate', predicate: 'fileSize("a.md") > 1000', severity: 'warn' },
              ],
            },
          }),
        },
      );
      assert.equal(r.ok, true);
      assert.equal(r.code, 'SPEC_WARNING');
      assert.equal(r.warnings, 1);
      assert.equal(r.spec_failures.length, 1);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('plan override adds new criterion (additional gate for one action)', () => {
    let tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-runchk-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.md'), 'content with marker', 'utf8');
    try {
      const r = sv.runChecks(
        {
          action_kind: 'recommendation',
          acceptance_criteria: [
            { id: 'has_marker', kind: 'regex', pattern: 'marker', applies_to: ['a.md'] },
          ],
        },
        { ok: true, touchedFiles: ['a.md'] },
        {
          repoRoot: tmpRoot,
          actionKinds: makeStubRegistry({
            recommendation: {
              acceptance_criteria: [
                { id: 'positive_size', kind: 'file_predicate', predicate: 'fileSize("a.md") > 0' },
              ],
            },
          }),
        },
      );
      assert.equal(r.ok, true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('llm_judge in registry triggers SPEC_LLM_JUDGE_NOT_IMPLEMENTED at run time', () => {
    const r = sv.runChecks(
      { action_kind: 'recommendation' },
      { ok: true, touchedFiles: [] },
      {
        repoRoot: '.',
        actionKinds: makeStubRegistry({
          recommendation: {
            acceptance_criteria: [{ id: 'judge', kind: 'llm_judge', rubric: 'x' }],
          },
        }),
      },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_LLM_JUDGE_NOT_IMPLEMENTED');
  });

  test('malformed criterion in registry triggers SPEC_MALFORMED (registry typo gate)', () => {
    const r = sv.runChecks(
      { action_kind: 'recommendation' },
      { ok: true, touchedFiles: [] },
      {
        repoRoot: '.',
        actionKinds: makeStubRegistry({
          recommendation: {
            acceptance_criteria: [{ id: 'broken', kind: 'shell' /* no cmd */ }],
          },
        }),
      },
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_MALFORMED');
  });

  test('Sprint 1.9.0 review (correctness mutation killer): warn-severity criterion that throws still fail-closes (FAIL_CLOSED before severity)', () => {
    const r = sv.runChecks(
      { action_kind: 'recommendation' },
      { ok: true, touchedFiles: [] },
      {
        repoRoot: '.',
        actionKinds: makeStubRegistry({
          recommendation: {
            acceptance_criteria: [{
              id: 'warns_but_throws',
              kind: 'file_predicate',
              predicate: '(()=>{ throw new Error("bad"); })()',
              severity: 'warn',
            }],
          },
        }),
      },
    );
    // SPEC_PREDICATE_THREW is in FAIL_CLOSED_CODES → must fail-close even if
    // the criterion's severity is 'warn'. Without this guard a malicious-but-
    // warn-flagged criterion could mask runtime errors and silently pass.
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SPEC_PREDICATE_THREW');
  });
});
