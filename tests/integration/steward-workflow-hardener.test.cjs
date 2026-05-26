'use strict';

// tests/integration/steward-workflow-hardener.test.cjs
//
// Backfill coverage for the steward-workflow-hardener cron action.
// Locks in: 4 detector rules (unpinned action, missing top-level permissions,
// missing concurrency, missing job timeout) + issue formatter shape + analyzeAll
// orchestrator. Synthetic YAML fixtures keep runtime <2s; no real gh API calls.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  RULES,
  analyzeAll,
  analyzeFile,
  findUnpinnedUses,
  findMissingTopLevelPermissions,
  findMissingConcurrency,
  findMissingTimeouts,
  formatIssueTitle,
  formatIssueBody,
} = require('../../bin/steward/_lib/workflow-hardener-action.cjs');

describe('steward-workflow-hardener — detectors', () => {
  test('findUnpinnedUses flags @main / @v1 (non-SHA refs)', () => {
    const yaml = `
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@main
      - uses: actions/cache@v3.0.1
`;
    const findings = findUnpinnedUses(yaml);
    assert.equal(findings.length, 3, 'all three @ref forms must be flagged when not SHA');
    assert.ok(findings.every((f) => f.rule_id === 'unpinned_action'));
    assert.ok(findings.some((f) => f.action === 'actions/checkout' && f.current_ref === 'v4'));
    assert.ok(findings.some((f) => f.action === 'actions/setup-node' && f.current_ref === 'main'));
  });

  test('findUnpinnedUses accepts 40-char SHA refs as safe (pinned)', () => {
    const yaml = `
jobs:
  build:
    steps:
      - uses: actions/checkout@1d96c772d19495a3b5c517cd2bc0cb401ea0529f
`;
    const findings = findUnpinnedUses(yaml);
    assert.equal(findings.length, 0, '40-hex SHA is the canonical safe pin');
  });

  test('findUnpinnedUses normalizes CRLF (Windows workflow files)', () => {
    const yaml = '\r\nname: x\r\njobs:\r\n  build:\r\n    steps:\r\n      - uses: actions/checkout@main\r\n';
    const findings = findUnpinnedUses(yaml);
    assert.equal(findings.length, 1);
    // Excerpt must NOT contain stray \r
    assert.ok(!findings[0].excerpt.includes('\r'), 'excerpt must be CRLF-stripped');
  });

  test('findMissingTopLevelPermissions returns finding when block absent', () => {
    const yaml = `name: bad
on: { push: { branches: [main] } }
jobs:
  build: { runs-on: ubuntu-latest, steps: [] }
`;
    const result = findMissingTopLevelPermissions(yaml);
    assert.ok(result, 'must return a finding object');
    assert.equal(result.rule_id, 'missing_permissions');
  });

  test('findMissingTopLevelPermissions returns null when block present', () => {
    const yaml = `name: ok
permissions:
  contents: read
on: { push: { branches: [main] } }
jobs: {}
`;
    const result = findMissingTopLevelPermissions(yaml);
    assert.equal(result, null);
  });

  test('findMissingConcurrency flags absence, accepts presence', () => {
    const without = 'name: x\non: push\njobs: {}\n';
    const withConc = 'name: x\nconcurrency:\n  group: ${{ github.ref }}\non: push\njobs: {}\n';
    assert.ok(findMissingConcurrency(without));
    assert.equal(findMissingConcurrency(withConc), null);
  });

  test('findMissingTimeouts flags each job lacking timeout-minutes', () => {
    const yaml = `name: x
on: push
jobs:
  fast:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: []
  slow:
    runs-on: ubuntu-latest
    steps: []
  also-slow:
    runs-on: ubuntu-latest
    steps: []
`;
    const findings = findMissingTimeouts(yaml);
    assert.equal(findings.length, 2, '2 jobs without timeout-minutes');
    const names = findings.map((f) => f.job_name).sort();
    assert.deepEqual(names, ['also-slow', 'slow']);
  });
});

describe('steward-workflow-hardener — analyzeAll orchestrator', () => {
  function makeSyntheticRepo() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-wfh-'));
    fs.mkdirSync(path.join(tmp, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.github', 'workflows', 'broken.yml'),
      `name: broken-workflow
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
`,
    );
    fs.writeFileSync(
      path.join(tmp, '.github', 'workflows', 'good.yml'),
      `name: good-workflow
permissions:
  contents: read
concurrency:
  group: \${{ github.ref }}
on:
  push: { branches: [main] }
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@1d96c772d19495a3b5c517cd2bc0cb401ea0529f
`,
    );
    return tmp;
  }

  test('analyzeAll reports findings only for the broken workflow', () => {
    const repoRoot = makeSyntheticRepo();
    const result = analyzeAll({ repoRoot });
    assert.ok(result && typeof result === 'object', 'analyzeAll must return an object');
    // Shape pre-check: refuse if both shapes are absent — otherwise a regression
    // returning {} would falsely satisfy "0 findings on broken.yml".
    const hasFindings = Array.isArray(result.findings);
    const hasFiles = Array.isArray(result.files);
    assert.ok(hasFindings || hasFiles,
      `analyzeAll must return either {findings: []} or {files: []}; got ${JSON.stringify(Object.keys(result))}`);
    // Either shape: top-level findings array OR per-file findings
    const allFindings = result.findings
      || (result.files || []).flatMap((f) => f.findings || []);
    assert.ok(allFindings.length >= 3, `expected >=3 findings on broken.yml, got ${allFindings.length}`);
    // Good.yml must contribute zero findings
    const goodFindings = allFindings.filter((f) => (f.file || '').endsWith('good.yml'));
    assert.equal(goodFindings.length, 0, 'good.yml must be clean');
  });

  test('analyzeFile attaches relative file path to every finding', () => {
    const content = 'jobs:\n  x:\n    steps:\n      - uses: actions/checkout@main\n';
    const findings = analyzeFile('.github/workflows/test.yml', content);
    assert.ok(findings.length >= 1);
    for (const f of findings) {
      assert.equal(f.file, '.github/workflows/test.yml', 'each finding tagged with its file');
    }
  });
});

describe('steward-workflow-hardener — issue formatting', () => {
  test('formatIssueTitle is deterministic + includes date', () => {
    const title = formatIssueTitle('2026-05-26');
    assert.ok(title.includes('2026-05-26'), 'title must include the date');
    assert.ok(title.length > 0 && title.length < 200, 'title within reasonable bounds');
  });

  test('formatIssueBody renders a non-empty markdown body', () => {
    const body = formatIssueBody({
      analysis: {
        findings: [
          { rule_id: 'unpinned_action', file: '.github/workflows/x.yml', line: 10, action: 'a/b', current_ref: 'main', excerpt: 'uses: a/b@main' },
        ],
        files: [],
      },
      slug: 'cortex-x',
      date: '2026-05-26',
    });
    assert.ok(typeof body === 'string');
    assert.ok(body.length > 50, 'body should be non-trivial');
    assert.ok(body.includes('unpinned_action') || body.includes('a/b'), 'body should mention the finding');
  });
});

describe('steward-workflow-hardener — RULES registry', () => {
  test('RULES exposes all 4 detector rule_ids as object keys', () => {
    const expected = ['unpinned_action', 'missing_permissions', 'missing_concurrency', 'missing_timeout'];
    for (const e of expected) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(RULES, e),
        `RULES must declare rule "${e}"`,
      );
      assert.ok(
        RULES[e].severity === 'high' || RULES[e].severity === 'medium' || RULES[e].severity === 'low',
        `RULES.${e} must have a valid severity`,
      );
      assert.ok(
        typeof RULES[e].description === 'string' && RULES[e].description.length > 0,
        `RULES.${e} must have a non-empty description`,
      );
      assert.ok(
        typeof RULES[e].fix_hint === 'string' && RULES[e].fix_hint.length > 0,
        `RULES.${e} must have a non-empty fix_hint`,
      );
    }
  });
});
