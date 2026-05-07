'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  stripDenylistExamples,
  countMarkers,
  DENYLIST_EXAMPLE_MARKER,
} = require('../../tools/lib/denylist-examples.cjs');

const VERIFY_PROMPTS = path.resolve(__dirname, '..', '..', 'tools', 'verify-prompts.cjs');
const VERIFY_SKILLS = path.resolve(__dirname, '..', '..', 'tools', 'verify-skills.cjs');
const VERIFY_STANDARDS = path.resolve(__dirname, '..', '..', 'tools', 'verify-standards.cjs');

describe('denylist-examples: helper', () => {
  test('marker regex matches the canonical form', () => {
    assert.match('foo <!-- denylist-example --> bar', DENYLIST_EXAMPLE_MARKER);
  });

  test('marker regex tolerates whitespace variants', () => {
    assert.match('<!--denylist-example-->', DENYLIST_EXAMPLE_MARKER);
    assert.match('<!--   denylist-example   -->', DENYLIST_EXAMPLE_MARKER);
  });

  test('marker is case-insensitive', () => {
    assert.match('<!-- DENYLIST-EXAMPLE -->', DENYLIST_EXAMPLE_MARKER);
  });

  test('non-marker comments are NOT matched', () => {
    assert.doesNotMatch('<!-- TODO: fix this -->', DENYLIST_EXAMPLE_MARKER);
    assert.doesNotMatch('<!-- denylist -->', DENYLIST_EXAMPLE_MARKER);
  });

  test('stripDenylistExamples removes only marker-bearing lines', () => {
    const input = [
      'normal line',
      'sk-AAAAAAAAAAAAAAAAAAAA1234 <!-- denylist-example -->',
      'another normal line',
    ].join('\n');

    const out = stripDenylistExamples(input);
    const lines = out.split('\n');
    assert.equal(lines[0], 'normal line');
    assert.equal(lines[1], '');
    assert.equal(lines[2], 'another normal line');
  });

  test('stripDenylistExamples preserves line numbers', () => {
    const input = 'line1\nline2 <!-- denylist-example -->\nline3';
    const out = stripDenylistExamples(input);
    assert.equal(out.split('\n').length, 3);
  });

  test('stripDenylistExamples handles empty / null gracefully', () => {
    assert.equal(stripDenylistExamples(''), '');
    assert.equal(stripDenylistExamples(null), null);
    assert.equal(stripDenylistExamples(undefined), undefined);
  });

  test('countMarkers counts marker-bearing lines', () => {
    const input = 'no\nyes <!-- denylist-example -->\nno\nyes <!-- denylist-example -->';
    assert.equal(countMarkers(input), 2);
  });
});

describe('denylist-examples: integration with all 3 verifiers', () => {
  // Each verifier should accept a synthetic file that quotes the PII regex
  // patterns BUT marks each example line. Without the marker, the regex
  // would catch the file. With the marker, it should pass.

  function tmpRepoWithExample(prefix, dir, filename, content) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), `denylist-${prefix}-`));
    const fullDir = path.join(repo, dir);
    fs.mkdirSync(fullDir, { recursive: true });
    fs.writeFileSync(path.join(fullDir, filename), content, 'utf8');
    return repo;
  }

  test('verify-standards: file with marked example passes PII check', () => {
    const tmpRepo = tmpRepoWithExample('std-marked', 'standards', 'demo.md',
      '# Demo\n\nSee `c:/Users/david/foo` <!-- denylist-example --> for an example.\n',
    );

    const result = spawnSync(process.execPath, [
      VERIFY_STANDARDS, '--file', path.join(tmpRepo, 'standards', 'demo.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    const piiFindings = parsed.findings.filter((f) => f.code === 'PII_LEAK');
    assert.equal(piiFindings.length, 0, 'marked PII example should not trigger PII_LEAK');
    assert.equal(result.status, 0);
  });

  test('verify-standards: file with UNMARKED example fails PII check (control)', () => {
    const tmpRepo = tmpRepoWithExample('std-unmarked', 'standards', 'demo.md',
      '# Demo\n\nSee `c:/Users/david/foo` for an example.\n',
    );

    const result = spawnSync(process.execPath, [
      VERIFY_STANDARDS, '--file', path.join(tmpRepo, 'standards', 'demo.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    const piiFindings = parsed.findings.filter((f) => f.code === 'PII_LEAK');
    assert.equal(piiFindings.length, 1, 'unmarked PII should trigger PII_LEAK');
    assert.equal(result.status, 1);
  });

  test('verify-standards: marker works for davidrajnoha@ pattern too', () => {
    const tmpRepo = tmpRepoWithExample('std-email', 'standards', 'demo.md',
      '# Demo\n\nThe regex matches `davidrajnoha@example.com` <!-- denylist-example --> patterns.\n',
    );

    const result = spawnSync(process.execPath, [
      VERIFY_STANDARDS, '--file', path.join(tmpRepo, 'standards', 'demo.md'), '--json',
    ], { encoding: 'utf8', timeout: 5000 });

    const parsed = JSON.parse(result.stdout);
    const piiFindings = parsed.findings.filter((f) => f.code === 'PII_LEAK');
    assert.equal(piiFindings.length, 0);
    assert.equal(result.status, 0);
  });

  test('all 3 verifiers import the same helper module', () => {
    // Smoke test — the require() at the top of each verifier file should resolve
    // and exporting the same helpers.
    for (const cli of [VERIFY_PROMPTS, VERIFY_SKILLS, VERIFY_STANDARDS]) {
      const src = fs.readFileSync(cli, 'utf8');
      assert.match(src, /denylist-examples/);
      assert.match(src, /stripDenylistExamples/);
    }
  });
});
