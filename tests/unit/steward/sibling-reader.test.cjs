'use strict';

// Sprint 2.7 — sibling-reader tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reader = require('../../../bin/steward/_lib/sibling-reader.cjs');
const manifest = require('../../../bin/steward/_lib/sibling-manifest.cjs');

function tmpSibling(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sib-${prefix}-`));
  // Plant fixture content.
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.cjs'), '// public file\n');
  fs.writeFileSync(path.join(root, 'docs', 'README.md'), '# docs\n');
  fs.writeFileSync(path.join(root, 'secrets', 'api.key'), 'SECRET\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg.cjs'), 'noise\n');
  fs.writeFileSync(path.join(root, '.env.local'), 'TOKEN=secret\n');
  return {
    rootAbs: root,
    rootRaw: root,
    root: root,
    id: 'fixture-sib',
    read_only: true,
    purpose: 'pattern-transfer',
    paths_allowed: ['src/', 'docs/'],
    paths_denied: ['.env*', 'secrets/', 'node_modules/'],
  };
}

describe('readSiblingFile', () => {
  test('reads allowlisted file', () => {
    const sib = tmpSibling('read-allowed');
    const r = reader.readSiblingFile(sib, 'src/index.cjs');
    assert.equal(r.ok, true);
    assert.match(r.content, /public file/);
  });

  test('rejects path not in allow-list', () => {
    const sib = tmpSibling('read-not-allowed');
    fs.writeFileSync(path.join(sib.rootAbs, 'README.md'), 'top-level');
    const r = reader.readSiblingFile(sib, 'README.md');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_NOT_ALLOWLISTED');
  });

  test('rejects denied path even if also allowed', () => {
    const sib = tmpSibling('read-denied');
    sib.paths_allowed = ['secrets/']; // grant explicitly
    const r = reader.readSiblingFile(sib, 'secrets/api.key');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_DENIED_PATH');
  });

  test('rejects absolute path', () => {
    const sib = tmpSibling('read-abs');
    const r = reader.readSiblingFile(sib, '/etc/passwd');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_INVALID_PATH');
  });

  test('rejects ".." traversal', () => {
    const sib = tmpSibling('read-traversal');
    const r = reader.readSiblingFile(sib, 'src/../../../etc/passwd');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_INVALID_PATH');
  });

  test('rejects non-existent file', () => {
    const sib = tmpSibling('read-missing');
    const r = reader.readSiblingFile(sib, 'src/missing.cjs');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_NOT_FOUND');
  });

  test('rejects file > sizeBytesCap', () => {
    const sib = tmpSibling('read-large');
    const r = reader.readSiblingFile(sib, 'src/index.cjs', { sizeBytesCap: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_FILE_TOO_LARGE');
  });

  test('rejects symlink escape', () => {
    if (process.platform === 'win32') return; // junction permission needed
    const sib = tmpSibling('read-symlink');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-target-'));
    fs.writeFileSync(path.join(target, 'evil.txt'), 'PWNED');
    try { fs.symlinkSync(path.join(target, 'evil.txt'), path.join(sib.rootAbs, 'src', 'link.cjs')); }
    catch { return; }
    const r = reader.readSiblingFile(sib, 'src/link.cjs');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SIBLING_REALPATH_OUTSIDE_ROOT');
  });

  test('rejects directory (not a regular file)', () => {
    const sib = tmpSibling('read-dir');
    const r = reader.readSiblingFile(sib, 'src');
    assert.equal(r.ok, false);
    // Could be NOT_ALLOWLISTED (no trailing slash match) or NOT_A_FILE; both fine.
    assert.ok(['SIBLING_NOT_A_FILE', 'SIBLING_NOT_ALLOWLISTED'].includes(r.code), `unexpected code ${r.code}`);
  });
});

describe('listSiblingFiles', () => {
  test('lists allowlisted files', () => {
    const sib = tmpSibling('list-basic');
    const r = reader.listSiblingFiles(sib);
    assert.equal(r.ok, true);
    const paths = r.files.map((f) => f.relPath);
    assert.ok(paths.includes('src/index.cjs'));
    assert.ok(paths.includes('docs/README.md'));
  });

  test('skips denied directories', () => {
    const sib = tmpSibling('list-denied');
    const r = reader.listSiblingFiles(sib);
    const paths = r.files.map((f) => f.relPath);
    // node_modules and secrets are denied
    for (const p of paths) {
      assert.equal(p.includes('node_modules'), false, `${p} must not appear`);
      assert.equal(p.includes('secrets/'), false, `${p} must not appear`);
    }
  });

  test('respects fileCountCap', () => {
    const sib = tmpSibling('list-cap');
    // Plant many files in src/
    for (let i = 0; i < 15; i += 1) {
      fs.writeFileSync(path.join(sib.rootAbs, 'src', `f${i}.cjs`), 'x');
    }
    const r = reader.listSiblingFiles(sib, { fileCountCap: 5 });
    assert.ok(r.files.length <= 5);
  });
});

describe('assertEditWithinCwd', () => {
  test('accepts repo-relative path inside cwd', () => {
    const r = reader.assertEditWithinCwd('cortex/lessons-learned.jsonl', '/tmp/repo');
    assert.equal(r.ok, true);
  });

  test('rejects absolute path', () => {
    const r = reader.assertEditWithinCwd('/etc/passwd', '/tmp/repo');
    assert.equal(r.ok, false);
    assert.match(r.error, /absolute/);
  });

  test('rejects ".." traversal', () => {
    const r = reader.assertEditWithinCwd('../sibling/file.cjs', '/tmp/repo');
    assert.equal(r.ok, false);
    assert.match(r.error, /traversal/);
  });

  test('rejects empty/non-string path', () => {
    assert.equal(reader.assertEditWithinCwd('', '/tmp/repo').ok, false);
    assert.equal(reader.assertEditWithinCwd(null, '/tmp/repo').ok, false);
  });
});

describe('matchesAnyGlob', () => {
  test('matches .env* pattern', () => {
    assert.equal(reader.matchesAnyGlob('.env.local', ['.env*']), true);
    assert.equal(reader.matchesAnyGlob('.env', ['.env*']), true);
    assert.equal(reader.matchesAnyGlob('config.env', ['.env*']), false);
  });

  test('matches secrets/ subtree', () => {
    assert.equal(reader.matchesAnyGlob('secrets/api.key', ['secrets/']), true);
    assert.equal(reader.matchesAnyGlob('secrets', ['secrets/']), true);
    assert.equal(reader.matchesAnyGlob('public/secrets-info', ['secrets/']), false);
  });

  test('matches **/*.pem pattern', () => {
    assert.equal(reader.matchesAnyGlob('certs/server.pem', ['**/*.pem']), true);
    assert.equal(reader.matchesAnyGlob('deep/nested/cert.pem', ['**/*.pem']), true);
    assert.equal(reader.matchesAnyGlob('cert.pem.bak', ['**/*.pem']), false);
  });

  test('returns false for empty patterns', () => {
    assert.equal(reader.matchesAnyGlob('any/path', []), false);
    assert.equal(reader.matchesAnyGlob('any/path', null), false);
  });
});

describe('action-kinds — pattern_transfer registry', () => {
  test('pattern_transfer kind is registered', () => {
    const actionKinds = require('../../../bin/steward/_lib/action-kinds.cjs');
    const k = actionKinds.getActionKind('pattern_transfer');
    assert.ok(k);
    assert.equal(k.requires_llm, true);
    assert.equal(k.cost_envelope, 'normal');
    assert.equal(k.shipped_in, '0.3.0');
    assert.ok(k.acceptance_criteria.length >= 3);
  });
});
