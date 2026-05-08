'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isHalted,
  fleetSentinelPath,
  projectSentinelPath,
  EX_TEMPFAIL,
  SENTINEL_FILENAME,
} = require('../../../bin/steward/_lib/halt-check.cjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `steward-halt-${prefix}-`));
}

function tmpDataHome(prefix) {
  const dir = tmpDir(prefix);
  return dir;
}

describe('halt-check: not halted by default', () => {
  test('clean repo + clean fleet returns halted=false', () => {
    const repoRoot = tmpDir('clean');
    const dataHome = tmpDataHome('clean-data');
    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, false);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });
});

describe('halt-check: project sentinel', () => {
  test('per-repo STEWARD_HALT triggers halt', () => {
    const repoRoot = tmpDir('project-halt');
    const dataHome = tmpDataHome('project-halt-data');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', SENTINEL_FILENAME), 'halt reason\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'project_sentinel_present');
      assert.match(result.sentinelPath, /STEWARD_HALT$/);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });

  test('legacy HERMES_HALT filename is NOT honored (v0.2.0 strip)', () => {
    const repoRoot = tmpDir('project-legacy-noop');
    const dataHome = tmpDataHome('project-legacy-data');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'HERMES_HALT'), 'pre-rebrand halt\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, false, 'legacy HERMES_HALT must not trigger halt — operators must rename to STEWARD_HALT');
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });
});

describe('halt-check: fleet sentinel', () => {
  test('CORTEX_DATA_HOME/STEWARD_HALT triggers halt', () => {
    const repoRoot = tmpDir('fleet-halt');
    const dataHome = tmpDataHome('fleet-halt-data');
    fs.writeFileSync(path.join(dataHome, SENTINEL_FILENAME), 'fleet halt\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'fleet_sentinel_present');
      assert.match(result.sentinelPath, /STEWARD_HALT$/);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });

  test('fleet sentinel takes precedence over project sentinel', () => {
    const repoRoot = tmpDir('both-halt');
    const dataHome = tmpDataHome('both-halt-data');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', SENTINEL_FILENAME), 'project\n');
    fs.writeFileSync(path.join(dataHome, SENTINEL_FILENAME), 'fleet\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'fleet_sentinel_present');
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });
});

describe('halt-check: contract', () => {
  test('exports EX_TEMPFAIL = 75 (sysexits.h convention)', () => {
    assert.equal(EX_TEMPFAIL, 75);
  });

  test('SENTINEL_FILENAME is STEWARD_HALT', () => {
    assert.equal(SENTINEL_FILENAME, 'STEWARD_HALT');
  });

  test('paths are absolute', () => {
    const dataHome = tmpDataHome('paths');
    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      assert.ok(path.isAbsolute(fleetSentinelPath()));
      assert.ok(path.isAbsolute(projectSentinelPath('/some/repo')));
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });
});
