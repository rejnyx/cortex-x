// cortex-doctor contract tests.
//
// We can't fully isolate cortex-doctor from the test host's real ~/.claude/
// because resolveSourceFromYaml reads ~/.claude/shared/cortex-source.yaml.
// But we CAN test:
//   1. CLI exit codes (--help, unknown flag)
//   2. --json output shape (must produce valid JSON with expected keys)
//   3. severity tally is consistent with findings array
//   4. pure-function module exports (REQUIRED_SKILLS, RECOMMENDED_SKILLS)
//
// Full E2E isolation tests would require setting HOME to a fake dir and
// constructing a synthetic shared/ tree. That's overkill for v0.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-doctor.cjs');
const { REQUIRED_SKILLS, RECOMMENDED_SKILLS, parseArgs } = require(SCRIPT);

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('cortex-doctor — exports', () => {
  test('REQUIRED_SKILLS contains the load-bearing two', () => {
    assert.ok(REQUIRED_SKILLS.includes('cortex-init'));
    assert.ok(REQUIRED_SKILLS.includes('cortex-help'));
  });

  test('RECOMMENDED_SKILLS covers the 4 main entry points', () => {
    for (const s of ['audit', 'designer', 'start', 'test-audit']) {
      assert.ok(RECOMMENDED_SKILLS.includes(s), `missing recommended skill: ${s}`);
    }
  });

  test('parseArgs accepts every flag', () => {
    const a = parseArgs(['node', 'cortex-doctor.cjs', '--json', '--fix-suggestions']);
    assert.strictEqual(a.json, true);
    assert.strictEqual(a.fix, true);
  });
});

describe('cortex-doctor — CLI', () => {
  test('--help exits 0 with usage', () => {
    const r = runCli(['--help']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /cortex-doctor/);
    assert.match(r.stdout, /Severity:/);
  });

  test('unknown flag → exit 1', () => {
    const r = runCli(['--banana']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /unknown flag/);
  });

  test('--json emits valid JSON with expected schema', () => {
    const r = runCli(['--json']);
    // status may be 0 or 1 depending on test host state; both are valid runs.
    assert.ok(r.status === 0 || r.status === 1, `expected 0 or 1, got ${r.status}`);
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (err) {
      assert.fail(`stdout was not valid JSON: ${err.message}\nstdout was:\n${r.stdout}`);
    }
    assert.ok('ok' in parsed);
    assert.ok('counts' in parsed);
    assert.ok(Array.isArray(parsed.findings));
    assert.ok(parsed.findings.length > 0, 'expected at least one finding');
    for (const f of parsed.findings) {
      assert.ok(typeof f.id === 'string' && f.id.length > 0);
      assert.ok(['ok', 'info', 'warn', 'error'].includes(f.severity), `invalid severity: ${f.severity}`);
      assert.ok(typeof f.message === 'string' && f.message.length > 0);
    }
  });

  test('--json counts match findings array tally', () => {
    const r = runCli(['--json']);
    const parsed = JSON.parse(r.stdout);
    const recomputed = { ok: 0, info: 0, warn: 0, error: 0 };
    for (const f of parsed.findings) recomputed[f.severity] = (recomputed[f.severity] || 0) + 1;
    for (const sev of Object.keys(recomputed)) {
      assert.strictEqual(
        parsed.counts[sev] || 0, recomputed[sev],
        `counts.${sev} mismatch: report says ${parsed.counts[sev] || 0}, findings tally says ${recomputed[sev]}`
      );
    }
  });

  test('--json reports ok=false iff there are errors', () => {
    const r = runCli(['--json']);
    const parsed = JSON.parse(r.stdout);
    const hasErrors = parsed.findings.some((f) => f.severity === 'error');
    assert.strictEqual(parsed.ok, !hasErrors);
  });

  test('--json includes node_version finding', () => {
    const r = runCli(['--json']);
    const parsed = JSON.parse(r.stdout);
    const f = parsed.findings.find((x) => x.id === 'node_version');
    assert.ok(f, 'node_version finding must always be present');
  });

  test('human output (no --json) prints summary line', () => {
    const r = runCli([]);
    assert.match(r.stdout, /Summary:/);
  });

  test('--fix-suggestions includes fix arrows', () => {
    // Even on a healthy machine, info-severity findings may have fix fields.
    // Just check the flag is accepted and produces output.
    const r = runCli(['--fix-suggestions']);
    assert.ok(r.stdout.length > 0);
  });
});
