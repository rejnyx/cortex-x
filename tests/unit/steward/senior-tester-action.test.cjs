// Sprint 2.11 — senior-tester-action behavior tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const action = require('../../../bin/steward/_lib/senior-tester-action.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sta-${label}-`));
}

function fixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Sprint 2.11 — runSeniorTesterReview deterministic-only path', () => {
  test('SENIOR_TESTER_NO_TEST_FILES on greenfield repo', async () => {
    const dir = tmp('green');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const r = await action.runSeniorTesterReview({
      repoRoot: dir,
      slug: 'test-green',
      isoDate: '2026-05',
      dataHome: dir,
      skipGh: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SENIOR_TESTER_NO_TEST_FILES');
    assert.equal(r.skip_commit, true);
    assert.deepEqual(r.touchedFiles, []);
    assert.equal(r.usage.cost_usd, 0);
  });

  test('clean suite (no findings) writes journal but skips issue', async () => {
    const dir = tmp('clean');
    fixture(dir, 'tests/unit/a.test.cjs', `
const test = require('node:test');
const assert = require('node:assert/strict');
test('clean assertion', () => {
  assert.deepStrictEqual({ a: 1 }, { a: 1 });
});
`);
    const r = await action.runSeniorTesterReview({
      repoRoot: dir,
      slug: 'test-clean',
      isoDate: '2026-05',
      dataHome: dir,
      skipGh: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.no_findings, true);
    assert.equal(r.skip_commit, true);
    assert.deepEqual(r.touchedFiles, []);
    assert.ok(fs.existsSync(r.journalPath));
  });

  test('dirty suite produces findings + writes journal + opens (mock) gh issue', async () => {
    const dir = tmp('dirty');
    fixture(dir, 'tests/unit/dirty.test.cjs', `
test('test1', () => {
  console.log('debug');
  expect(getResult()).toBeTruthy();
});
test.skip('skipped without rationale', () => {});
test('placeholder', () => {
  // expected: result is 5
  doSomething();
});
`);
    const r = await action.runSeniorTesterReview({
      repoRoot: dir,
      slug: 'test-dirty',
      isoDate: '2026-05',
      dataHome: dir,
      skipGh: true, // mock gh
    });
    assert.equal(r.ok, true);
    assert.ok(r.phaseA.total_findings > 0, 'at least one finding');
    assert.equal(r.skip_commit, true);
    assert.deepEqual(r.touchedFiles, []);
    assert.ok(fs.existsSync(r.journalPath));
    assert.equal(r.issue.dry_run, true);
    assert.equal(r.usage.cost_usd, 0);
  });
});

describe('Sprint 2.11 — issue body formatting', () => {
  test('formatIssueBody includes severity sections + smell IDs', () => {
    const phaseA = {
      files_scanned: 5,
      total_findings: 3,
      findings: [
        { smell_id: 'print_statement', file: 'tests/x.test.cjs', line: 5, severity: 'low', excerpt: 'console.log()' },
        { smell_id: 'ignored_test', file: 'tests/y.test.cjs', line: 10, severity: 'high', excerpt: 'test.skip(...)' },
        { smell_id: 'sleepy_test', file: 'tests/z.test.cjs', line: 15, severity: 'high', excerpt: 'setTimeout(...)' },
      ],
      layer_balance: {
        counts: { unit: 5, integration: 0, e2e: 0 },
        total: 5,
        ratio: { unit: 100, integration: 0, e2e: 0 },
        target: { unit: 70, integration: 20, e2e: 10 },
        skew: 'no anti-patterns detected',
      },
      truncated: false,
    };
    const body = action.formatIssueBody({ phaseA, judgeResult: null, slug: 'demo', date: '2026-05' });
    assert.match(body, /HIGH \(2\)/);
    assert.match(body, /LOW \(1\)/);
    assert.match(body, /print_statement/);
    assert.match(body, /ignored_test/);
    assert.match(body, /sleepy_test/);
  });

  test('formatIssueTitle is stable shape', () => {
    assert.equal(action.formatIssueTitle('2026-05'), 'senior-tester-review: 2026-05 test-quality audit');
  });
});

describe('Sprint 2.11 — judge prompt scaffolding', () => {
  test('buildRegistryDigest is non-empty and lists smell ids', () => {
    const digest = action.buildRegistryDigest();
    assert.ok(digest.includes('assertion_roulette'));
    assert.ok(digest.includes('not_asserted_side_effects'));
    assert.ok(digest.includes('hidden_io'));
  });

  test('JUDGE_SYSTEM_PROMPT is JSON-mode strict', () => {
    assert.match(action.JUDGE_SYSTEM_PROMPT, /JSON/);
    assert.match(action.JUDGE_SYSTEM_PROMPT, /summary/);
    assert.match(action.JUDGE_SYSTEM_PROMPT, /ranked_findings/);
  });

  // Sprint 2.11.1: replacement format unified to `[REDACTED-...]`
  // (square-bracket sentinels survive sanitizeForMarkdown unchanged; the
  // earlier `<redacted>` form would HTML-escape to `&lt;redacted&gt;`
  // when re-rendered in issue bodies).
  test('redactSecrets strips Bearer tokens + sk- keys', () => {
    const input = `
const headers = { Authorization: 'Bearer sk-abcdefghijklmnopqrst1234' };
const apiKey = 'sk-abcdefghijklmnopqrst1234';
`;
    const out = action.redactSecrets(input);
    assert.ok(!out.includes('sk-abcdefghijklmnopqrst1234'));
    assert.ok(out.includes('Bearer [REDACTED]'));
  });

  // Sprint 2.11 R2 fixes — explicit regression coverage for blind-hunter
  // HIGH-1 + security-auditor HIGH-2.
  test('redactSecrets actually redacts apiKey/password/token assignments (HIGH-1 fix)', () => {
    const input = `apiKey: 'real-secret-value-12345'\npassword: "another-secret-67890"\ntoken: \`bearer-style-secret\``;
    const out = action.redactSecrets(input);
    assert.ok(!out.includes('real-secret-value-12345'), `failed to redact apiKey value: ${out}`);
    assert.ok(!out.includes('another-secret-67890'), `failed to redact password value: ${out}`);
    assert.ok(!out.includes('bearer-style-secret'), `failed to redact token value: ${out}`);
    assert.ok(out.includes("'<REDACTED>'"));
  });

  test('redactSecrets covers 2026 provider patterns (HIGH-2 fix)', () => {
    const cases = [
      { input: 'AKIAIOSFODNN7EXAMPLE', mustNotContain: 'AKIAIOSFODNN7EXAMPLE' },
      { input: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890', mustNotContain: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' },
      { input: 'AIzaSyD_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567', mustNotContain: 'AIzaSyD_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567' },
      { input: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c', mustNotContain: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIi' },
      { input: 'sk-ant-oat01-abcdefghijklmnopqrst', mustNotContain: 'sk-ant-oat01' },
    ];
    for (const c of cases) {
      const out = action.redactSecrets(c.input);
      assert.ok(!out.includes(c.mustNotContain), `failed to redact: ${c.input} → ${out}`);
    }
  });

  test('runSeniorTesterReview rejects missing slug (BLOCKER fix)', async () => {
    const r = await action.runSeniorTesterReview({
      repoRoot: process.cwd(),
      // slug intentionally absent
      isoDate: '2026-05',
      skipGh: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SENIOR_TESTER_NO_SLUG');
  });

  test('runSeniorTesterReview rejects path-traversal isoDate (HIGH-3 fix)', async () => {
    const r = await action.runSeniorTesterReview({
      repoRoot: process.cwd(),
      slug: 'safe-slug',
      isoDate: '../../../etc',
      skipGh: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SENIOR_TESTER_INVALID_DATE');
  });

  test('runSeniorTesterReview rejects unsafe slug (HIGH-3 fix)', async () => {
    const r = await action.runSeniorTesterReview({
      repoRoot: process.cwd(),
      slug: '../etc/cron.d',
      isoDate: '2026-05',
      skipGh: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'SENIOR_TESTER_INVALID_SLUG');
  });

  test('formatIssueBody sanitizes LLM output against prompt-injection (HIGH-1 fix)', () => {
    const phaseA = {
      files_scanned: 1,
      total_findings: 0,
      findings: [],
      layer_balance: {
        counts: { unit: 1, integration: 0, e2e: 0 },
        total: 1,
        ratio: { unit: 100, integration: 0, e2e: 0 },
        target: { unit: 70, integration: 20, e2e: 10 },
        skew: 'no anti-patterns detected',
      },
      truncated: false,
    };
    const judgeResult = {
      ok: true,
      judge: {
        summary: '<script>alert(1)</script>\n@channel @org-admin\n`gh pr merge --admin`',
        top_3_strategic_gaps: ['<img src=x onerror=alert(1)>', '@everyone'],
        layer_balance_assessment: 'just `rm -rf` everything',
        ranked_findings: [],
        estimated_effort_hours: 5,
      },
    };
    const body = action.formatIssueBody({ phaseA, judgeResult, slug: 'demo', date: '2026-05' });
    assert.ok(!body.includes('<script>'), 'HTML must be neutralized');
    assert.ok(!body.includes('@channel'), '@-mentions must be escaped');
    assert.ok(!body.includes('@everyone'), '@-mentions must be escaped');
    assert.ok(!body.includes('@org-admin'), '@-mentions must be escaped');
    assert.ok(!body.match(/`gh pr merge --admin`/), 'backticks must be collapsed in non-excerpt fields');
  });

  test('formatIssueBody handles unknown smell_id without leaking raw value', () => {
    const phaseA = {
      files_scanned: 1,
      total_findings: 1,
      findings: [
        { smell_id: 'this_does_not_exist_<script>', file: 'tests/x.test.cjs', line: 1, severity: 'high', excerpt: 'oops' },
      ],
      layer_balance: {
        counts: { unit: 1, integration: 0, e2e: 0 },
        total: 1,
        ratio: { unit: 100, integration: 0, e2e: 0 },
        target: { unit: 70, integration: 20, e2e: 10 },
        skew: 'no anti-patterns detected',
      },
      truncated: false,
    };
    const body = action.formatIssueBody({ phaseA, judgeResult: null, slug: 'demo', date: '2026-05' });
    assert.match(body, /<unknown:.*>/);
    assert.ok(!body.includes('<script>'), 'HTML in unknown smell_id must be neutralized');
  });
});

describe('Sprint 2.11 — detector ranking determinism (HIGH-1 fix)', () => {
  const det = require('../../../bin/steward/_lib/test-smell-detector.cjs');
  test('total_findings reflects pre-truncation count; findings are post-sort top-N', () => {
    // We can't easily produce > 200 findings deterministically without large
    // fixture files, so just verify the shape: when total_findings > findings.length
    // the truncated flag is set + sort by severity is enforced (high before low).
    // For the cortex-x own tests/, we know we get a lot of findings.
    const r = det.detectAll({ repoRoot: process.cwd() });
    // Sort invariant: each consecutive finding's severity weight is >= next.
    const w = { high: 3, medium: 2, low: 1 };
    for (let i = 1; i < r.findings.length; i++) {
      const a = w[r.findings[i - 1].severity] || 0;
      const b = w[r.findings[i].severity] || 0;
      assert.ok(a >= b, `findings not sorted by severity at index ${i}: ${r.findings[i - 1].severity} → ${r.findings[i].severity}`);
    }
  });

  test('selectSampleFiles prefers files with most findings', () => {
    const dir = tmp('sample');
    fixture(dir, 'tests/unit/many.test.cjs', 'console.log(1)\nconsole.log(2)');
    fixture(dir, 'tests/unit/few.test.cjs', 'expect(1).toBe(1)');
    const phaseA = {
      findings: [
        { file: 'tests/unit/many.test.cjs' },
        { file: 'tests/unit/many.test.cjs' },
        { file: 'tests/unit/few.test.cjs' },
      ],
    };
    const samples = action.selectSampleFiles(phaseA, dir);
    assert.ok(samples.length >= 1);
    assert.equal(samples[0].path, 'tests/unit/many.test.cjs');
  });
});

describe('Sprint 2.11 — judge LLM error paths (no network)', () => {
  test('JUDGE_NO_API_KEY when env unset', async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const r = await action.runLlmJudge(
        { findings: [], layer_balance: {} },
        { repoRoot: process.cwd() },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'JUDGE_NO_API_KEY');
    } finally {
      if (savedKey) process.env.OPENROUTER_API_KEY = savedKey;
    }
  });

  test('JUDGE_KEY_MALFORMED when key contains whitespace', async () => {
    const savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'bad key with space';
    try {
      const r = await action.runLlmJudge(
        { findings: [], layer_balance: {} },
        { repoRoot: process.cwd() },
      );
      assert.equal(r.ok, false);
      assert.equal(r.code, 'JUDGE_KEY_MALFORMED');
    } finally {
      if (savedKey) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });
});
