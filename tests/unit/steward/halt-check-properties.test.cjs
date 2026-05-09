'use strict';

// Sprint 2.9.7c — halt-check property tests. Per Sprint 2.3 R1 §3.4
// recommendation: companion property tests for the highest-risk primitive.
// halt-check IS the kill switch — its invariants are load-bearing for
// "operator can stop a runaway agent in under 1 second" guarantee.
//
// Zero-deps (cortex-x convention).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const haltCheck = require('../../../bin/steward/_lib/halt-check.cjs');

function tmpRepoRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cx-halt-${prefix}-`));
  return dir;
}

function tmpDataHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cx-halt-data-${prefix}-`));
}

function withDataHome(dataHome, fn) {
  const prev = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dataHome;
  try {
    return fn();
  } finally {
    if (prev !== undefined) process.env.CORTEX_DATA_HOME = prev;
    else delete process.env.CORTEX_DATA_HOME;
  }
}

describe('Sprint 2.9.7c — halt-check kill-switch invariants', () => {
  test('invariant: clean state ⇒ halted:false', () => {
    const repoRoot = tmpRepoRoot('clean');
    const dataHome = tmpDataHome('clean');
    withDataHome(dataHome, () => {
      const r = haltCheck.isHalted({ repoRoot });
      assert.equal(r.halted, false);
    });
  });

  test('invariant: fleet sentinel present ⇒ halted:true with fleet reason', () => {
    const repoRoot = tmpRepoRoot('fleet');
    const dataHome = tmpDataHome('fleet');
    fs.writeFileSync(path.join(dataHome, 'STEWARD_HALT'), 'fleet halt');
    withDataHome(dataHome, () => {
      const r = haltCheck.isHalted({ repoRoot });
      assert.equal(r.halted, true);
      assert.equal(r.reason, 'fleet_sentinel_present');
      assert.equal(r.sentinelPath, path.join(dataHome, 'STEWARD_HALT'));
    });
  });

  test('invariant: project sentinel present ⇒ halted:true with project reason', () => {
    const repoRoot = tmpRepoRoot('project');
    const dataHome = tmpDataHome('project');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'STEWARD_HALT'), 'project halt');
    withDataHome(dataHome, () => {
      const r = haltCheck.isHalted({ repoRoot });
      assert.equal(r.halted, true);
      assert.equal(r.reason, 'project_sentinel_present');
    });
  });

  test('invariant: fleet sentinel takes precedence over project sentinel', () => {
    // Both sentinels present → fleet wins (it's fleet-wide, more severe).
    const repoRoot = tmpRepoRoot('both');
    const dataHome = tmpDataHome('both');
    fs.writeFileSync(path.join(dataHome, 'STEWARD_HALT'), 'fleet halt');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'STEWARD_HALT'), 'project halt');
    withDataHome(dataHome, () => {
      const r = haltCheck.isHalted({ repoRoot });
      assert.equal(r.halted, true);
      assert.equal(r.reason, 'fleet_sentinel_present', 'fleet takes precedence');
    });
  });

  test('invariant: empty file (zero bytes) at sentinel path still triggers halt', () => {
    // Defense: operator can `touch ~/.cortex/STEWARD_HALT` to halt.
    // The file may have no content; mere existence is sufficient.
    const repoRoot = tmpRepoRoot('empty');
    const dataHome = tmpDataHome('empty');
    fs.writeFileSync(path.join(dataHome, 'STEWARD_HALT'), '');
    withDataHome(dataHome, () => {
      const r = haltCheck.isHalted({ repoRoot });
      assert.equal(r.halted, true);
    });
  });

  test('invariant: idempotency — calling isHalted twice in a row returns same result', () => {
    const repoRoot = tmpRepoRoot('idem');
    const dataHome = tmpDataHome('idem');
    fs.writeFileSync(path.join(dataHome, 'STEWARD_HALT'), 'x');
    withDataHome(dataHome, () => {
      const r1 = haltCheck.isHalted({ repoRoot });
      const r2 = haltCheck.isHalted({ repoRoot });
      assert.deepEqual(r1, r2);
    });
  });

  test('invariant: read-only — calling isHalted does NOT create/modify/delete sentinel', () => {
    const repoRoot = tmpRepoRoot('readonly');
    const dataHome = tmpDataHome('readonly');
    const sentinel = path.join(dataHome, 'STEWARD_HALT');
    fs.writeFileSync(sentinel, 'original-content');
    const beforeContent = fs.readFileSync(sentinel, 'utf8');
    const beforeMtime = fs.statSync(sentinel).mtimeMs;
    withDataHome(dataHome, () => {
      for (let i = 0; i < 5; i++) {
        haltCheck.isHalted({ repoRoot });
      }
    });
    // Wait briefly to ensure mtime resolution > 0 if a write happened.
    const afterContent = fs.readFileSync(sentinel, 'utf8');
    const afterMtime = fs.statSync(sentinel).mtimeMs;
    assert.equal(afterContent, beforeContent, 'isHalted must not modify sentinel content');
    assert.equal(afterMtime, beforeMtime, 'isHalted must not touch sentinel mtime');
  });

  test('invariant: removing sentinel between calls reflects in next isHalted result', () => {
    const repoRoot = tmpRepoRoot('toggle');
    const dataHome = tmpDataHome('toggle');
    const sentinel = path.join(dataHome, 'STEWARD_HALT');
    withDataHome(dataHome, () => {
      // Initially clean.
      assert.equal(haltCheck.isHalted({ repoRoot }).halted, false);
      // Operator creates sentinel.
      fs.writeFileSync(sentinel, 'halt');
      assert.equal(haltCheck.isHalted({ repoRoot }).halted, true);
      // Operator removes sentinel.
      fs.unlinkSync(sentinel);
      assert.equal(haltCheck.isHalted({ repoRoot }).halted, false);
    });
  });

  test('invariant: SENTINEL_FILENAME matches the documented contract value', () => {
    // Sprint 4.7 rebrand: STEWARD_HALT (was HERMES_HALT pre-v0.2.0).
    assert.equal(haltCheck.SENTINEL_FILENAME, 'STEWARD_HALT');
  });

  test('invariant: EX_TEMPFAIL is the documented sysexits.h convention', () => {
    // Used by CLI exit code; documented as "halted" outcome.
    assert.equal(haltCheck.EX_TEMPFAIL, 75);
  });

  test('invariant: fleetSentinelPath uses CORTEX_DATA_HOME when set', () => {
    const dataHome = tmpDataHome('path');
    withDataHome(dataHome, () => {
      const fleetPath = haltCheck.fleetSentinelPath();
      assert.equal(fleetPath, path.join(dataHome, 'STEWARD_HALT'));
    });
  });

  test('invariant: projectSentinelPath is repoRoot/.cortex/STEWARD_HALT', () => {
    const repoRoot = '/tmp/proj';
    const projectPath = haltCheck.projectSentinelPath(repoRoot);
    assert.equal(projectPath, path.join(repoRoot, '.cortex', 'STEWARD_HALT'));
  });

  test('invariant: performance — isHalted returns within ~50ms even under load', () => {
    // Per contract: "Returns within ~5ms (single fs.existsSync call per path)".
    // We allow 50ms slack on a busy CI runner / Windows fs. Failing this means
    // halt-check is no longer a fast-path operation, which would compromise
    // the kill-switch latency guarantee.
    const repoRoot = tmpRepoRoot('perf');
    const dataHome = tmpDataHome('perf');
    withDataHome(dataHome, () => {
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        haltCheck.isHalted({ repoRoot });
      }
      const elapsed = Date.now() - start;
      const perCallMs = elapsed / 100;
      assert.ok(perCallMs < 50, `halt-check must average <50ms per call (got ${perCallMs.toFixed(2)}ms)`);
    });
  });
});
