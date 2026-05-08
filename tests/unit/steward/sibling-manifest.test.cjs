'use strict';

// Sprint 2.7 — sibling-manifest validator tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const manifest = require('../../../bin/steward/_lib/sibling-manifest.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sib-mani-${prefix}-`));
}

function writeManifest(repoRoot, content) {
  fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'cortex/sibling-projects.json'),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

const VALID_SIBLING = {
  id: 'amd-hackathon',
  root: '/tmp/amd-hackathon-2026',
  read_only: true,
  purpose: 'pattern-transfer',
  paths_allowed: ['src/', 'docs/'],
  paths_denied: ['.env*', 'secrets/', 'node_modules/'],
};

describe('expandEnvVars', () => {
  test('expands ${HOME} to os.homedir()', () => {
    const r = manifest.expandEnvVars('${HOME}/projects/foo');
    assert.equal(r.ok, true);
    assert.ok(r.expanded.includes(os.homedir()));
    assert.ok(r.expanded.endsWith('/projects/foo'));
  });

  test('expands ${USERPROFILE} to os.homedir()', () => {
    const r = manifest.expandEnvVars('${USERPROFILE}/foo');
    assert.equal(r.ok, true);
    assert.ok(r.expanded.includes(os.homedir()));
  });

  test('rejects ${PATH} (not in allowlist)', () => {
    const r = manifest.expandEnvVars('${PATH}/foo');
    assert.equal(r.ok, false);
    assert.match(r.error, /disallowed env var/);
  });

  test('rejects ${ANYTHING_ELSE}', () => {
    const r = manifest.expandEnvVars('${ANTHROPIC_API_KEY}');
    assert.equal(r.ok, false);
  });

  test('passes through paths without env vars', () => {
    const r = manifest.expandEnvVars('/tmp/literal/path');
    assert.equal(r.ok, true);
    assert.equal(r.expanded, '/tmp/literal/path');
  });
});

describe('validateSibling', () => {
  test('accepts a well-formed sibling', () => {
    const r = manifest.validateSibling(VALID_SIBLING, 0);
    assert.equal(r.ok, true);
    assert.equal(r.sibling.id, 'amd-hackathon');
    assert.equal(r.sibling.read_only, true);
  });

  test('rejects non-object sibling', () => {
    assert.equal(manifest.validateSibling(null, 0).ok, false);
    assert.equal(manifest.validateSibling('string', 0).ok, false);
    assert.equal(manifest.validateSibling([], 0).ok, false);
  });

  test('rejects invalid id formats', () => {
    const cases = ['', 'UPPER_CASE', 'has spaces', '-startswithdash', 'endswithdash-', 'a'];
    for (const id of cases) {
      const r = manifest.validateSibling({ ...VALID_SIBLING, id }, 0);
      assert.equal(r.ok, false, `id=${JSON.stringify(id)} must be rejected`);
    }
  });

  test('rejects read_only !== true (v1 enforcement)', () => {
    const r = manifest.validateSibling({ ...VALID_SIBLING, read_only: false }, 0);
    assert.equal(r.ok, false);
    assert.match(r.error, /read_only must be exactly true/);
  });

  test('rejects empty paths_allowed', () => {
    const r = manifest.validateSibling({ ...VALID_SIBLING, paths_allowed: [] }, 0);
    assert.equal(r.ok, false);
  });

  test('rejects non-array paths_allowed', () => {
    const r = manifest.validateSibling({ ...VALID_SIBLING, paths_allowed: 'src/' }, 0);
    assert.equal(r.ok, false);
  });

  test('rejects empty string in paths_allowed', () => {
    const r = manifest.validateSibling({ ...VALID_SIBLING, paths_allowed: ['src/', ''] }, 0);
    assert.equal(r.ok, false);
  });

  test('rejects malicious env var in root', () => {
    const r = manifest.validateSibling({ ...VALID_SIBLING, root: '${PATH}/foo' }, 0);
    assert.equal(r.ok, false);
    assert.match(r.error, /disallowed env var/);
  });
});

describe('validateManifest', () => {
  test('accepts valid v1 manifest', () => {
    const r = manifest.validateManifest({ version: 1, siblings: [VALID_SIBLING] });
    assert.equal(r.ok, true);
    assert.equal(r.manifest.siblings.length, 1);
  });

  test('rejects wrong version', () => {
    const r = manifest.validateManifest({ version: 2, siblings: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /manifest.version must be 1/);
  });

  test('rejects non-array siblings', () => {
    const r = manifest.validateManifest({ version: 1, siblings: {} });
    assert.equal(r.ok, false);
  });

  test('rejects duplicate sibling ids', () => {
    const r = manifest.validateManifest({
      version: 1,
      siblings: [VALID_SIBLING, { ...VALID_SIBLING, root: '/tmp/other' }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /duplicate sibling id/);
  });

  test('rejects null root manifest', () => {
    assert.equal(manifest.validateManifest(null).ok, false);
    assert.equal(manifest.validateManifest('string').ok, false);
    assert.equal(manifest.validateManifest([]).ok, false);
  });
});

describe('loadManifest', () => {
  test('returns MANIFEST_NOT_FOUND when file missing', () => {
    const repoRoot = tmpRepo('not-found');
    const r = manifest.loadManifest(repoRoot);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'MANIFEST_NOT_FOUND');
  });

  test('returns MANIFEST_PARSE_FAILED on invalid JSON', () => {
    const repoRoot = tmpRepo('parse-fail');
    writeManifest(repoRoot, 'not json {{{');
    const r = manifest.loadManifest(repoRoot);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'MANIFEST_PARSE_FAILED');
  });

  test('returns MANIFEST_SCHEMA_INVALID on bad shape', () => {
    const repoRoot = tmpRepo('schema-invalid');
    writeManifest(repoRoot, { version: 1, siblings: [{ id: 'INVALID UPPERCASE' }] });
    const r = manifest.loadManifest(repoRoot);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'MANIFEST_SCHEMA_INVALID');
  });

  test('returns ok on valid manifest', () => {
    const repoRoot = tmpRepo('valid');
    writeManifest(repoRoot, { version: 1, siblings: [VALID_SIBLING] });
    const r = manifest.loadManifest(repoRoot);
    assert.equal(r.ok, true);
    assert.equal(r.manifest.siblings.length, 1);
    assert.equal(r.manifest.siblings[0].id, 'amd-hackathon');
  });
});

describe('normalizePath', () => {
  test('returns null for non-string', () => {
    assert.equal(manifest.normalizePath(null), null);
    assert.equal(manifest.normalizePath(undefined), null);
  });

  test('normalizes forward slashes', () => {
    const r = manifest.normalizePath('a//b/../c');
    assert.equal(r, 'a/c');
  });
});
