// Sprint 2.11 — test-smell-detector behavior tests.
//
// Sanity-tests the regex-heuristic detector on synthetic test fixtures.
// Each smell ID with a regex pattern gets a positive case + a negative
// case (false-positive defense).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const det = require('../../../bin/steward/_lib/test-smell-detector.cjs');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `smell-det-${label}-`));
}

function writeFixture(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Sprint 2.11 — test-smell-detector regex coverage', () => {
  test('print_statement: positive on console.log inside test', () => {
    const dir = tmp('print');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
'use strict';
const test = require('node:test');
test('foo', () => {
  console.log('debug residue');
  expect(1).toBe(1);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'print_statement'));
  });

  test('print_statement: negative — comment-only console.log is ignored', () => {
    const dir = tmp('print-neg');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('foo', () => {
  // console.log is forbidden
  expect(1).toBe(1);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(!r.findings.some((f) => f.smell_id === 'print_statement'));
  });

  test('ignored_test: positive on .skip without rationale', () => {
    const dir = tmp('skip');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test.skip('broken', () => {});
xit('also broken', () => {});
`);
    const r = det.detectAll({ repoRoot: dir });
    const skipFindings = r.findings.filter((f) => f.smell_id === 'ignored_test');
    assert.ok(skipFindings.length >= 2);
  });

  test('empty_test: positive on empty body', () => {
    const dir = tmp('empty');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('todo', () => {});
test('also todo', async () => {  });
`);
    const r = det.detectAll({ repoRoot: dir });
    const empties = r.findings.filter((f) => f.smell_id === 'empty_test');
    assert.ok(empties.length >= 1);
  });

  test('sleepy_test: positive on setTimeout', () => {
    const dir = tmp('sleep');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('flaky', async () => {
  await new Promise((res) => setTimeout(res, 1000));
  expect(1).toBe(1);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'sleepy_test'));
  });

  test('suboptimal_assert: positive on .toBeTruthy()', () => {
    const dir = tmp('subopt');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('foo', () => {
  expect(getResult()).toBeTruthy();
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'suboptimal_assert'));
  });

  test('generic_test_name: positive on "test1" / "should work"', () => {
    const dir = tmp('generic');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('test1', () => {
  expect(1).toBe(1);
});
test('should work', () => {
  expect(2).toBe(2);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    const generics = r.findings.filter((f) => f.smell_id === 'generic_test_name');
    assert.ok(generics.length >= 2);
  });

  test('conditional_test_logic: positive on if-branch (not for)', () => {
    const dir = tmp('cond');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('if-logic', () => {
  if (process.env.CI) {
    expect(true).toBe(true);
  } else {
    expect(false).toBe(false);
  }
});
test('for-loop is OK', () => {
  for (let i = 0; i < 3; i++) {
    expect(i).toBeGreaterThanOrEqual(0);
  }
});
`);
    const r = det.detectAll({ repoRoot: dir });
    const conds = r.findings.filter((f) => f.smell_id === 'conditional_test_logic');
    // Only the if-logic test should trigger
    assert.equal(conds.length, 1);
  });

  test('mystery_guest: positive on fs.readFileSync inside test', () => {
    const dir = tmp('myst');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
const fs = require('node:fs');
test('reads from disk without fixture', () => {
  const data = fs.readFileSync('/etc/hosts', 'utf8');
  expect(data.length).toBeGreaterThan(0);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'mystery_guest'));
  });

  test('no_reproducibility_marker: positive on Math.random without seed', () => {
    const dir = tmp('repro');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('flaky', () => {
  const x = Math.random();
  expect(x).toBeGreaterThanOrEqual(0);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'no_reproducibility_marker'));
  });

  test('no_reproducibility_marker: negative when seed is pinned', () => {
    const dir = tmp('repro-neg');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('seeded', () => {
  faker.seed(0x1234);
  const x = faker.helpers.arrayElement([1, 2, 3]);
  expect([1, 2, 3]).toContain(x);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(!r.findings.some((f) => f.smell_id === 'no_reproducibility_marker'));
  });

  test('comments_only_test: positive on "// expected: X" without expect', () => {
    const dir = tmp('com');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('placeholder', () => {
  doSomething();
  // expected: result is 5
  // should be greater than zero
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'comments_only_test'));
  });

  test('verbose_test: positive on > 30 lines', () => {
    const dir = tmp('verb');
    const longBody = Array(35).fill('  const x = 1;').join('\n');
    writeFixture(dir, 'tests/unit/x.test.cjs', `
test('big', () => {
${longBody}
  expect(1).toBe(1);
});
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.ok(r.findings.some((f) => f.smell_id === 'verbose_test'));
  });
});

describe('Sprint 2.11 — layer-balance SMURF heuristic', () => {
  test('detects ice-cream-cone anti-pattern when e2e > 40%', () => {
    const lb = det.computeLayerBalance([
      'tests/e2e/a.test.cjs',
      'tests/e2e/b.test.cjs',
      'tests/e2e/c.test.cjs',
      'tests/unit/d.test.cjs',
    ]);
    assert.ok(lb.anti_patterns.some((a) => a.id === 'ice_cream_cone'));
  });

  test('detects no_unit_foundation when only integration/e2e exist', () => {
    const lb = det.computeLayerBalance([
      'tests/integration/a.test.cjs',
      'tests/integration/b.test.cjs',
    ]);
    assert.ok(lb.anti_patterns.some((a) => a.id === 'no_unit_foundation'));
  });

  test('healthy distribution → no anti-patterns', () => {
    const files = [];
    for (let i = 0; i < 70; i++) files.push(`tests/unit/f${i}.test.cjs`);
    for (let i = 0; i < 20; i++) files.push(`tests/integration/f${i}.test.cjs`);
    for (let i = 0; i < 10; i++) files.push(`tests/e2e/f${i}.test.cjs`);
    const lb = det.computeLayerBalance(files);
    assert.equal(lb.anti_patterns.length, 0);
  });

  test('classifyLayer normalizes Windows paths', () => {
    assert.equal(det.classifyLayer('tests\\contract\\a.test.cjs'), 'integration');
    assert.equal(det.classifyLayer('tests\\unit\\a.test.cjs'), 'unit');
    assert.equal(det.classifyLayer('tests\\e2e\\a.test.cjs'), 'e2e');
  });

  test('cites SMURF model reference', () => {
    const lb = det.computeLayerBalance(['tests/unit/a.test.cjs']);
    assert.match(lb.pyramid_model_ref, /SMURF/);
  });
});

describe('Sprint 2.11 — detectAll plumbing', () => {
  test('returns shape: files_scanned, total_findings, findings, layer_balance, skipped', () => {
    const dir = tmp('shape');
    writeFixture(dir, 'tests/unit/a.test.cjs', `
test('foo', () => { expect(1).toBe(1); });
`);
    const r = det.detectAll({ repoRoot: dir });
    assert.equal(typeof r.files_scanned, 'number');
    assert.equal(typeof r.total_findings, 'number');
    assert.ok(Array.isArray(r.findings));
    assert.ok(typeof r.layer_balance === 'object');
    assert.ok(Array.isArray(r.skipped));
    assert.ok(Array.isArray(r.test_files));
  });

  test('empty repo → 0 files, 0 findings, no anti-patterns', () => {
    const dir = tmp('empty-repo');
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const r = det.detectAll({ repoRoot: dir });
    assert.equal(r.files_scanned, 0);
    assert.equal(r.total_findings, 0);
  });
});
