// Sprint 2.5b — workflow_hardener tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const wh = require('../../../bin/steward/_lib/workflow-hardener-action.cjs');
const probe = require('../../../detectors/workflow-hardener.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wh-${label}-`));
}

function fixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Sprint 2.5b — workflow_hardener detection', () => {
  test('findUnpinnedUses flags actions/checkout@v4 (mutable tag)', () => {
    const findings = wh.findUnpinnedUses(`
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
`);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].action, 'actions/checkout');
    assert.equal(findings[0].current_ref, 'v4');
  });

  test('findUnpinnedUses skips already-pinned SHAs', () => {
    const findings = wh.findUnpinnedUses(`
      - uses: actions/checkout@a3406d29c5cdda61e8aa5e2ab9bc40000000000a
`);
    assert.equal(findings.length, 0);
  });

  test('findMissingTopLevelPermissions detects absence', () => {
    const ok = wh.findMissingTopLevelPermissions(`
permissions:
  contents: read
`);
    assert.equal(ok, null);

    const missing = wh.findMissingTopLevelPermissions(`
on: push
jobs: {}
`);
    assert.ok(missing);
    assert.equal(missing.rule_id, 'missing_permissions');
  });

  test('findMissingConcurrency detects absence', () => {
    const ok = wh.findMissingConcurrency(`
concurrency:
  group: test
`);
    assert.equal(ok, null);

    const missing = wh.findMissingConcurrency(`on: push\njobs: {}\n`);
    assert.ok(missing);
    assert.equal(missing.rule_id, 'missing_concurrency');
  });

  test('findMissingTimeouts flags jobs without timeout-minutes', () => {
    const findings = wh.findMissingTimeouts(`
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo hi
`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].job_name, 'build');
  });
});

describe('Sprint 2.5b — analyzeAll integration', () => {
  test('clean workflow → no findings', () => {
    const dir = tmp('clean');
    fixture(dir, '.github/workflows/clean.yml', `name: clean
on: push
permissions:
  contents: read
concurrency:
  group: clean-\${{ github.ref }}
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@a3406d29c5cdda61e8aa5e2ab9bc40000000000a
      - run: echo hi
`);
    const r = wh.analyzeAll({ repoRoot: dir });
    assert.equal(r.files_scanned, 1);
    assert.equal(r.findings.length, 0);
  });

  test('dirty workflow → multiple findings sorted by severity', () => {
    const dir = tmp('dirty');
    fixture(dir, '.github/workflows/dirty.yml', `name: dirty
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
`);
    const r = wh.analyzeAll({ repoRoot: dir });
    assert.equal(r.files_scanned, 1);
    assert.ok(r.findings.length >= 4); // 2 unpinned + missing perms + missing concurrency + missing timeout
    assert.equal(r.findings[0].rule_id !== undefined, true);
    // High-severity rules first
    const ruleSeverity = { unpinned_action: 3, missing_permissions: 3, missing_concurrency: 2, missing_timeout: 2 };
    for (let i = 1; i < r.findings.length; i++) {
      const a = ruleSeverity[r.findings[i - 1].rule_id] || 0;
      const b = ruleSeverity[r.findings[i].rule_id] || 0;
      assert.ok(a >= b, `findings not sorted at ${i}`);
    }
  });

  test('greenfield (no .github/workflows) → 0 files', () => {
    const dir = tmp('green');
    const r = wh.analyzeAll({ repoRoot: dir });
    assert.equal(r.files_scanned, 0);
    assert.equal(r.findings.length, 0);
  });
});

describe('Sprint 2.5b — runWorkflowHardener flow', () => {
  test('rejects missing slug', async () => {
    const r = await wh.runWorkflowHardener({ repoRoot: process.cwd(), isoDate: '2026-05-10', skipGh: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'WORKFLOW_HARDENER_NO_SLUG');
  });

  test('rejects unsafe slug', async () => {
    const r = await wh.runWorkflowHardener({ repoRoot: process.cwd(), slug: '../etc', isoDate: '2026-05-10', skipGh: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'WORKFLOW_HARDENER_INVALID_SLUG');
  });

  test('rejects unsafe date', async () => {
    const r = await wh.runWorkflowHardener({ repoRoot: process.cwd(), slug: 'safe', isoDate: '../../etc', skipGh: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'WORKFLOW_HARDENER_INVALID_DATE');
  });

  test('greenfield repo → WORKFLOW_HARDENER_NO_WORKFLOWS', async () => {
    const dir = tmp('green');
    const r = await wh.runWorkflowHardener({ repoRoot: dir, slug: 'green', isoDate: '2026-05-10', skipGh: true, dataHome: dir });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'WORKFLOW_HARDENER_NO_WORKFLOWS');
    assert.deepEqual(r.touchedFiles, []);
  });

  test('clean workflow → ok with no_findings', async () => {
    const dir = tmp('clean-run');
    fixture(dir, '.github/workflows/clean.yml', `name: clean
on: push
permissions:
  contents: read
concurrency:
  group: c-\${{ github.ref }}
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@a3406d29c5cdda61e8aa5e2ab9bc40000000000a
`);
    const r = await wh.runWorkflowHardener({ repoRoot: dir, slug: 'clean', isoDate: '2026-05-10', skipGh: true, dataHome: dir });
    assert.equal(r.ok, true);
    assert.equal(r.no_findings, true);
    assert.deepEqual(r.touchedFiles, []);
    assert.ok(fs.existsSync(r.journalPath));
  });

  test('dirty workflow → ok + findings + mock issue', async () => {
    const dir = tmp('dirty-run');
    fixture(dir, '.github/workflows/dirty.yml', `name: dirty
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`);
    const r = await wh.runWorkflowHardener({ repoRoot: dir, slug: 'dirty', isoDate: '2026-05-10', skipGh: true, dataHome: dir });
    assert.equal(r.ok, true);
    assert.ok(r.analysis.findings.length > 0);
    assert.deepEqual(r.touchedFiles, []);
    assert.equal(r.issue.dry_run, true);
  });
});

describe('Sprint 2.5b — detector probe', () => {
  test('greenfield → no-workflows', () => {
    const dir = tmp('probe-green');
    const r = probe.detect({ repoRoot: dir });
    assert.equal(r.status, 'no-workflows');
  });

  test('with workflow → ready', () => {
    const dir = tmp('probe-ready');
    fixture(dir, '.github/workflows/x.yml', 'name: x\non: push\n');
    const r = probe.detect({ repoRoot: dir });
    assert.equal(r.status, 'ready');
  });

  test('opt-out sentinel respected', () => {
    const dir = tmp('probe-opt');
    fixture(dir, '.github/workflows/x.yml', 'name: x\non: push\n');
    fixture(dir, '.cortex/workflow-hardener-disabled', '');
    const r = probe.detect({ repoRoot: dir });
    assert.equal(r.status, 'opted-out');
  });
});
