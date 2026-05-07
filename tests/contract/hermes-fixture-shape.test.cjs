'use strict';

/**
 * Contract test — tests/fixtures/hermes-dryrun/ shape
 *
 * The hermes-dryrun fixture is the deterministic dry-run target Hermes (Phase 7)
 * will eventually run against. Its shape IS the contract Hermes runtime expects
 * from a Hermes-targetable project. This test fails loudly if the contract
 * regresses — e.g. someone removes recommendations.md, or adds a PII path, or
 * the fixture no longer has the parseable "## DO this week" structure Hermes
 * needs to pick its next action.
 *
 * Companion docs: standards/hermes-policy.md, docs/hermes-runtime.md.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'hermes-dryrun');

function readFixture(rel) {
  return fs.readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8');
}

function fixtureExists(rel) {
  return fs.existsSync(path.join(FIXTURE_ROOT, rel));
}

describe('hermes-dryrun fixture: structural shape', () => {
  test('fixture root exists', () => {
    assert.ok(fixtureExists('.'), 'tests/fixtures/hermes-dryrun/ must exist');
  });

  test('README.md present and explains fixture purpose', () => {
    assert.ok(fixtureExists('README.md'));
    const readme = readFixture('README.md');
    assert.match(readme, /fixture/i, 'README must label itself as a fixture');
    assert.match(readme, /Hermes/, 'README must reference Hermes runtime context');
  });

  test('CLAUDE.md present', () => {
    assert.ok(fixtureExists('CLAUDE.md'));
    const claudeMd = readFixture('CLAUDE.md');
    assert.ok(claudeMd.length > 50, 'CLAUDE.md must be substantive');
  });

  test('package.json present with scripts.test', () => {
    assert.ok(fixtureExists('package.json'));
    const pkg = JSON.parse(readFixture('package.json'));
    assert.ok(pkg.scripts, 'package.json must have scripts');
    assert.ok(pkg.scripts.test, 'package.json must define scripts.test (Hermes verifies via npm test)');
  });

  test('cortex/recommendations.md present (Hermes input contract)', () => {
    assert.ok(fixtureExists('cortex/recommendations.md'));
  });

  test('src/index.js present (target Hermes can edit)', () => {
    assert.ok(fixtureExists('src/index.js'));
  });

  test('tests/smoke.test.cjs present (Hermes verifies via npm test)', () => {
    assert.ok(fixtureExists('tests/smoke.test.cjs'));
  });
});

describe('hermes-dryrun fixture: recommendations.md parseable contract', () => {
  test('frontmatter parseable (--- delimited YAML at top)', () => {
    const recs = readFixture('cortex/recommendations.md');
    assert.match(recs, /^---\n[\s\S]*?\n---/, 'must start with --- YAML frontmatter ---');
  });

  test('frontmatter contains slug field', () => {
    const recs = readFixture('cortex/recommendations.md');
    const fm = recs.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, 'frontmatter must exist');
    assert.match(fm[1], /^slug:\s*hermes-dryrun\b/m, 'frontmatter must declare slug: hermes-dryrun');
  });

  test('"## DO this week" section present (Hermes picks actions from here)', () => {
    const recs = readFixture('cortex/recommendations.md');
    assert.match(recs, /^## DO this week/m, 'must have "## DO this week" heading');
  });

  test('at least one action item under "DO this week" (### N. format)', () => {
    const recs = readFixture('cortex/recommendations.md');
    const doThisWeek = recs.split(/^## DO this week/m)[1] || '';
    const beforeNextH2 = doThisWeek.split(/^## /m)[0];
    const actionItems = beforeNextH2.match(/^### \d+\.\s+\S/gm) || [];
    assert.ok(
      actionItems.length >= 1,
      `must have ≥1 action item under "DO this week" (got ${actionItems.length})`,
    );
  });

  test('action items carry citation markers ([audit:] or [src:])', () => {
    const recs = readFixture('cortex/recommendations.md');
    const doThisWeek = recs.split(/^## DO this week/m)[1] || '';
    const beforeNextH2 = doThisWeek.split(/^## /m)[0];
    assert.match(
      beforeNextH2,
      /\[(audit|src):\s*[^\]]+\]/,
      'action items must carry [audit:] or [src:] citation markers (3-hop traceability convention)',
    );
  });
});

describe('hermes-dryrun fixture: PII + env safety', () => {
  const filesToScan = [
    'README.md',
    'CLAUDE.md',
    'package.json',
    'src/index.js',
    'tests/smoke.test.cjs',
    'cortex/recommendations.md',
  ];

  test('no Dave-specific paths leak into fixture files', () => {
    for (const rel of filesToScan) {
      if (!fixtureExists(rel)) continue;
      const content = readFixture(rel);
      assert.doesNotMatch(
        content,
        /\/c\/Users\/david\b/i,
        `${rel} must not contain /c/Users/david/ path leak`,
      );
      assert.doesNotMatch(
        content,
        /davidrajnoha@/,
        `${rel} must not contain davidrajnoha@ email leak`,
      );
      assert.doesNotMatch(
        content,
        /C:\\Users\\david\b/i,
        `${rel} must not contain C:\\Users\\david\\ path leak`,
      );
    }
  });

  test('no env-var interpolation (process.env.HOME, os.homedir()) in fixture target files', () => {
    const targetFiles = ['src/index.js', 'tests/smoke.test.cjs'];
    for (const rel of targetFiles) {
      if (!fixtureExists(rel)) continue;
      const content = readFixture(rel);
      assert.doesNotMatch(
        content,
        /process\.env\.HOME\b/,
        `${rel} must not interpolate process.env.HOME (fixture is location-independent)`,
      );
      assert.doesNotMatch(
        content,
        /os\.homedir\(\)/,
        `${rel} must not call os.homedir() (fixture is location-independent)`,
      );
    }
  });
});

describe('hermes-dryrun fixture: package.json hygiene', () => {
  test('package.json has zero runtime dependencies', () => {
    const pkg = JSON.parse(readFixture('package.json'));
    assert.ok(
      !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
      'fixture must have zero runtime dependencies (deterministic + network-free)',
    );
  });

  test('package.json marked private (must never be published)', () => {
    const pkg = JSON.parse(readFixture('package.json'));
    assert.equal(pkg.private, true, 'fixture package.json must be marked private:true');
  });
});

describe('hermes-dryrun fixture: smoke test runs cleanly', () => {
  test('smoke test references node:test (built-in runner, zero deps)', () => {
    const smoke = readFixture('tests/smoke.test.cjs');
    assert.match(smoke, /require\(['"]node:test['"]\)/, 'must use node:test (zero-dep contract)');
  });

  test('smoke test imports the target file under src/', () => {
    const smoke = readFixture('tests/smoke.test.cjs');
    assert.match(smoke, /require\(['"][\.\/]+src\/index\.js['"]\)/, 'must import src/index.js');
  });
});
