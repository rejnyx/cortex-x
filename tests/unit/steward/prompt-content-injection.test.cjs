// Sprint 2.2.5 v1.5 — prompt-content injection tests.
//
// Closes the architectural gap surfaced in Round 11 dogfood (run 25627821093):
// LLM hallucinated SHA because prompt builder didn't inject file content.
// v1.5 detects backtick-wrapped path references in recommendation body,
// reads files (with HARD_DENYLIST + symlink + realpath defenses), and
// injects content + SHA256 as TRUSTED <file path="..." sha256="..."> blocks.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const engine = require('../../../bin/steward/_lib/action-engine.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pci-${label}-`));
}

function fixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Sprint 2.2.5 v1.5 — extractFileReferences happy path', () => {
  test('detects single backtick-wrapped path with extension', () => {
    const dir = tmp('basic');
    fixture(dir, 'src/foo.cjs', "module.exports = 'hello';\n");
    const body = 'Edit `src/foo.cjs` to export bar instead.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, 'src/foo.cjs');
    assert.match(refs[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(refs[0].content, /module\.exports/);
  });

  test('detects multiple references, deduplicates', () => {
    const dir = tmp('multi');
    fixture(dir, 'a.md', '# A\n');
    fixture(dir, 'b.md', '# B\n');
    const body = 'Edit `a.md` and `b.md` and again `a.md`.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 2);
    const paths = refs.map((r) => r.path).sort();
    assert.deepEqual(paths, ['a.md', 'b.md']);
  });

  test('SHA matches actual file content byte-for-byte', () => {
    const dir = tmp('sha');
    const content = 'precise content for sha verification\n';
    fixture(dir, 'tests/x.test.cjs', content);
    const body = 'See `tests/x.test.cjs` for the test.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 1);
    const expected = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    assert.equal(refs[0].sha256, expected);
  });
});

describe('Sprint 2.2.5 v1.5 — extractFileReferences defenses', () => {
  test('skips path-traversal references', () => {
    const dir = tmp('traversal');
    fixture(dir, 'safe.md', '# safe\n');
    const body = 'Edit `safe.md` and `../etc/passwd`.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, 'safe.md');
  });

  test('skips absolute paths', () => {
    const dir = tmp('abs');
    fixture(dir, 'safe.md', '# safe\n');
    const body = 'Compare `safe.md` to `/etc/hosts` and `C:/Windows/system32`.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, 'safe.md');
  });

  test('skips HARD_DENYLIST paths (.env / package.json / .ssh)', () => {
    const dir = tmp('deny');
    fixture(dir, '.env', 'SECRET=value\n');
    fixture(dir, 'package.json', '{}\n');
    fixture(dir, '.ssh/config', 'Host *\n');
    fixture(dir, 'safe.md', '# safe\n');
    const body = 'Edit `.env`, `package.json`, `.ssh/config`, and `safe.md`.';
    const refs = engine.extractFileReferences(body, dir);
    // Only safe.md should pass
    const paths = refs.map((r) => r.path);
    assert.ok(paths.includes('safe.md'));
    assert.ok(!paths.includes('.env'));
    assert.ok(!paths.includes('package.json'));
    assert.ok(!paths.includes('.ssh/config'));
  });

  test('skips files that do not exist', () => {
    const dir = tmp('missing');
    fixture(dir, 'real.md', '# real\n');
    const body = 'Edit `real.md` and `imaginary.md`.';
    const refs = engine.extractFileReferences(body, dir);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].path, 'real.md');
  });

  test('skips directories (lstat-isFile guard)', () => {
    const dir = tmp('dirs');
    fs.mkdirSync(path.join(dir, 'subdir.md'), { recursive: true });
    fixture(dir, 'real.md', '# real\n');
    const body = 'Edit `real.md` and `subdir.md`.';
    const refs = engine.extractFileReferences(body, dir);
    const paths = refs.map((r) => r.path);
    assert.ok(paths.includes('real.md'));
    assert.ok(!paths.includes('subdir.md'));
  });

  test('caps at MAX_INJECTED_FILES (8)', () => {
    const dir = tmp('cap');
    let body = 'Files: ';
    for (let i = 0; i < 20; i++) {
      fixture(dir, `f${i}.md`, `# ${i}\n`);
      body += `\`f${i}.md\` `;
    }
    const refs = engine.extractFileReferences(body, dir);
    assert.ok(refs.length <= 8, `cap exceeded: ${refs.length}`);
  });

  test('skips oversized files (> 16 KiB)', () => {
    const dir = tmp('size');
    const big = 'x'.repeat(17 * 1024);
    fixture(dir, 'big.md', big);
    fixture(dir, 'small.md', '# small\n');
    const body = 'Edit `big.md` and `small.md`.';
    const refs = engine.extractFileReferences(body, dir);
    const paths = refs.map((r) => r.path);
    assert.ok(paths.includes('small.md'));
    assert.ok(!paths.includes('big.md'));
  });

  test('skips paths with newlines / null bytes', () => {
    const dir = tmp('null');
    fixture(dir, 'real.md', '# real\n');
    const body = 'Edit `real.md`. (the `bad\\0path.md` should be ignored)';
    const refs = engine.extractFileReferences(body, dir);
    const paths = refs.map((r) => r.path);
    assert.ok(paths.includes('real.md'));
  });

  test('handles empty / non-string body gracefully', () => {
    const dir = tmp('empty');
    assert.deepEqual(engine.extractFileReferences('', dir), []);
    assert.deepEqual(engine.extractFileReferences(null, dir), []);
    assert.deepEqual(engine.extractFileReferences(undefined, dir), []);
    assert.deepEqual(engine.extractFileReferences(42, dir), []);
  });
});

describe('Sprint 2.2.5 v1.5 — buildUserPrompt integration', () => {
  test('emits <file path="..." sha256="..."> block when body references real file', () => {
    const dir = tmp('prompt');
    fixture(dir, 'docs/foo.md', '# Foo\nBar baz.\n');
    const plan = {
      action_kind: 'recommendation',
      slug: 'test',
      action: {
        num: 1,
        title: 'Edit foo',
        body: 'Add JSDoc above the loadAllowedUserIds function in `docs/foo.md`.',
        action_key: 'test#1',
      },
    };
    const prompt = engine.buildUserPrompt(plan, { repoRoot: dir });
    assert.match(prompt, /<file path="docs\/foo\.md" sha256="[a-f0-9]{64}" bytes="\d+">/);
    assert.match(prompt, /# Foo\nBar baz\./);
    assert.match(prompt, /<\/file>/);
    // Ensure system instruction line is included by reference somewhere.
    assert.match(prompt, /Steward read these for you/);
  });

  test('omits file block when body has no references', () => {
    const dir = tmp('no-refs');
    const plan = {
      action_kind: 'recommendation',
      slug: 'test',
      action: {
        num: 1,
        title: 'Pure narrative',
        body: 'Update the documentation to reflect new behavior.',
        action_key: 'test#1',
      },
    };
    const prompt = engine.buildUserPrompt(plan, { repoRoot: dir });
    assert.ok(!prompt.includes('<file path='), 'should not emit file block when no refs');
  });

  test('non-fatal on extraction error (proceed without injection)', () => {
    const plan = {
      action_kind: 'recommendation',
      slug: 'test',
      action: {
        num: 1,
        title: 'OK',
        body: 'Edit `nope.md` (file does not exist).',
        action_key: 'test#1',
      },
    };
    // Should not throw even though referenced file is missing.
    const prompt = engine.buildUserPrompt(plan, { repoRoot: tmp('missing-ref') });
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.length > 0);
  });
});
