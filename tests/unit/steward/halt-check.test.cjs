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
  fleetLegacySentinelPath,
  projectLegacySentinelPath,
  EX_TEMPFAIL,
  SENTINEL_FILENAME,
  LEGACY_SENTINEL_FILENAME,
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
      assert.notEqual(result.legacy, true);
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });

  test('Sprint 4.7 backward-compat: per-repo legacy HERMES_HALT still halts', () => {
    const repoRoot = tmpDir('project-legacy-halt');
    const dataHome = tmpDataHome('project-legacy-halt-data');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', LEGACY_SENTINEL_FILENAME), 'pre-rebrand halt\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'project_sentinel_present');
      assert.equal(result.legacy, true);
      assert.match(result.sentinelPath, /HERMES_HALT$/);
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

  test('Sprint 4.7 backward-compat: fleet legacy HERMES_HALT still halts', () => {
    const repoRoot = tmpDir('fleet-legacy-halt');
    const dataHome = tmpDataHome('fleet-legacy-halt-data');
    fs.writeFileSync(path.join(dataHome, LEGACY_SENTINEL_FILENAME), 'pre-rebrand fleet halt\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.equal(result.reason, 'fleet_sentinel_present');
      assert.equal(result.legacy, true);
      assert.match(result.sentinelPath, /HERMES_HALT$/);
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

  test('current STEWARD_HALT wins over legacy HERMES_HALT in same scope', () => {
    const repoRoot = tmpDir('both-prefix');
    const dataHome = tmpDataHome('both-prefix-data');
    fs.writeFileSync(path.join(dataHome, SENTINEL_FILENAME), 'fresh\n');
    fs.writeFileSync(path.join(dataHome, LEGACY_SENTINEL_FILENAME), 'legacy\n');

    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      const result = isHalted({ repoRoot });
      assert.equal(result.halted, true);
      assert.match(result.sentinelPath, /STEWARD_HALT$/);
      assert.notEqual(result.legacy, true);
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

  test('SENTINEL_FILENAME is STEWARD_HALT (Sprint 4.7 rebrand)', () => {
    assert.equal(SENTINEL_FILENAME, 'STEWARD_HALT');
  });

  test('LEGACY_SENTINEL_FILENAME is HERMES_HALT (pre-Sprint-4.7 alias)', () => {
    assert.equal(LEGACY_SENTINEL_FILENAME, 'HERMES_HALT');
  });

  test('paths are absolute', () => {
    const dataHome = tmpDataHome('paths');
    const prevEnv = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = dataHome;
    try {
      assert.ok(path.isAbsolute(fleetSentinelPath()));
      assert.ok(path.isAbsolute(projectSentinelPath('/some/repo')));
      assert.ok(path.isAbsolute(fleetLegacySentinelPath()));
      assert.ok(path.isAbsolute(projectLegacySentinelPath('/some/repo')));
    } finally {
      if (prevEnv === undefined) delete process.env.CORTEX_DATA_HOME;
      else process.env.CORTEX_DATA_HOME = prevEnv;
    }
  });
});
