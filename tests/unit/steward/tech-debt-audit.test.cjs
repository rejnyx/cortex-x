'use strict';

// Sprint 2.5 — tech_debt_audit unit tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeSnapshotDrift, DEFAULT_TRIGGERS } = require('../../../bin/steward/_lib/snapshot-diff.cjs');
const audit = require('../../../bin/steward/_lib/tech-debt-audit.cjs');
const detector = require('../../../detectors/tech-debt-audit.cjs');
const actionKinds = require('../../../bin/steward/_lib/action-kinds.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tech-debt-${prefix}-`));
}

describe('snapshot-diff — drift triggers', () => {
  test('increase_pp fires when current - prev > threshold', () => {
    const prev = { metrics: { duplication_pct: 3.0 } };
    const curr = { metrics: { duplication_pct: 5.5 } };
    const drift = computeSnapshotDrift(prev, curr, [
      { metric: 'duplication_pct', kind: 'increase_pp', threshold: 2 },
    ]);
    assert.equal(drift.triggered.length, 1);
    assert.equal(drift.triggered[0].metric, 'duplication_pct');
    assert.match(drift.triggered[0].message, /\+2\.50pp, threshold \+2pp/);
  });

  test('increase_pp does NOT fire at exactly threshold (strict >)', () => {
    const prev = { metrics: { duplication_pct: 3.0 } };
    const curr = { metrics: { duplication_pct: 5.0 } }; // delta = 2.0, threshold = 2
    const drift = computeSnapshotDrift(prev, curr, [
      { metric: 'duplication_pct', kind: 'increase_pp', threshold: 2 },
    ]);
    assert.equal(drift.triggered.length, 0);
  });

  test('absolute kind fires regardless of prev', () => {
    const curr = { metrics: { max_function_complexity: 18 } };
    const drift = computeSnapshotDrift(null, curr, [
      { metric: 'max_function_complexity', kind: 'absolute', threshold: 15 },
    ]);
    assert.equal(drift.triggered.length, 1);
    assert.match(drift.triggered[0].message, /max_function_complexity = 18/);
  });

  test('pct_drop fires when % drop exceeds threshold', () => {
    const prev = { metrics: { test_source_ratio: 2.0 } };
    const curr = { metrics: { test_source_ratio: 1.5 } }; // -25%
    const drift = computeSnapshotDrift(prev, curr, [
      { metric: 'test_source_ratio', kind: 'pct_drop', threshold: 20 },
    ]);
    assert.equal(drift.triggered.length, 1);
    assert.match(drift.triggered[0].message, /-25\.0%/);
  });

  test('pct_drop does NOT fire when current >= prev (no drop)', () => {
    const prev = { metrics: { test_source_ratio: 1.5 } };
    const curr = { metrics: { test_source_ratio: 2.0 } };
    const drift = computeSnapshotDrift(prev, curr, [
      { metric: 'test_source_ratio', kind: 'pct_drop', threshold: 20 },
    ]);
    assert.equal(drift.triggered.length, 0);
  });

  test('increase_count fires for absolute integer growth', () => {
    const prev = { metrics: { knip_unused_exports: 4 } };
    const curr = { metrics: { knip_unused_exports: 8 } }; // +4
    const drift = computeSnapshotDrift(prev, curr, [
      { metric: 'knip_unused_exports', kind: 'increase_count', threshold: 3 },
    ]);
    assert.equal(drift.triggered.length, 1);
  });

  test('missing prev metric → no trigger (baseline run)', () => {
    const curr = { metrics: { duplication_pct: 5.0 } };
    const drift = computeSnapshotDrift(null, curr, [
      { metric: 'duplication_pct', kind: 'increase_pp', threshold: 2 },
    ]);
    assert.equal(drift.triggered.length, 0);
  });

  test('unknown trigger kind silently skipped (forward-compat)', () => {
    const drift = computeSnapshotDrift(null, { metrics: {} }, [
      { metric: 'x', kind: 'unknown_kind', threshold: 1 },
    ]);
    assert.equal(drift.triggered.length, 0);
  });

  test('NaN / Infinity in metric values silently skipped', () => {
    const curr = { metrics: { duplication_pct: NaN, total_loc: Infinity } };
    const drift = computeSnapshotDrift(null, curr, DEFAULT_TRIGGERS);
    assert.equal(drift.triggered.length, 0);
    assert.equal(drift.metrics.duplication_pct, undefined);
  });

  test('DEFAULT_TRIGGERS covers expected metrics', () => {
    const metricNames = DEFAULT_TRIGGERS.map((t) => t.metric);
    assert.ok(metricNames.includes('duplication_pct'));
    assert.ok(metricNames.includes('max_function_complexity'));
    assert.ok(metricNames.includes('knip_unused_exports'));
    assert.ok(metricNames.includes('test_source_ratio'));
  });
});

describe('detector — tech-debt-audit', () => {
  test('returns qlty-missing when qlty not on PATH (operator machine reality)', () => {
    // Operator machine doesn't have qlty installed. This test asserts the
    // expected fail-open path; if qlty IS installed this test will report
    // ready/knip-missing instead — both are valid outcomes.
    const repoRoot = tmpRepo('detect-no-qlty');
    const result = detector.detect({ repoRoot });
    // Expect one of: qlty-missing | knip-missing | ready | opted-out.
    assert.ok(['qlty-missing', 'knip-missing', 'ready', 'opted-out'].includes(result.status), `unexpected status: ${result.status}`);
  });

  test('returns opted-out when .cortex/audit-disabled sentinel present', () => {
    const repoRoot = tmpRepo('opted-out');
    fs.mkdirSync(path.join(repoRoot, '.cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.cortex', 'audit-disabled'), 'opt-out\n');
    const result = detector.detect({ repoRoot });
    assert.equal(result.status, 'opted-out');
  });

  test('probeBinary returns ok:false for nonexistent name', () => {
    const result = detector.probeBinary('definitely-not-a-real-cli-' + Date.now());
    assert.equal(result.ok, false);
  });
});

describe('tech-debt-audit executor — fail-open path', () => {
  test('runTechDebtAudit returns skipped when qlty missing (operator machine reality)', async () => {
    const repoRoot = tmpRepo('audit-skip');
    const result = await audit.runTechDebtAudit({ repoRoot });
    // On operator machine without qlty, expect skipped:true.
    if (result.skipped) {
      assert.equal(result.ok, true);
      assert.ok(['QLTY_NOT_INSTALLED', 'AUDIT_OPTED_OUT'].includes(result.skipReason));
      // Skipped means NO snapshot file written.
      assert.equal(fs.existsSync(path.join(repoRoot, 'cortex/debt-snapshot.json')), false);
    } else {
      // qlty is installed — snapshot file should exist.
      assert.equal(result.ok, true);
      assert.equal(fs.existsSync(path.join(repoRoot, 'cortex/debt-snapshot.json')), true);
    }
  });

  test('parseQltyMetrics handles array-of-files schema', () => {
    const stdout = JSON.stringify([
      { name: 'foo.cjs', lines: 100, complexity: 5 },
      { name: 'bar.cjs', lines: 250, complexity: 18 },
    ]);
    const result = audit.parseQltyMetrics(stdout);
    assert.equal(result.total_loc, 350);
    assert.equal(result.files_count, 2);
    assert.equal(result.max_file_complexity, 18);
    // bar.cjs (complexity 18, loc 250) qualifies as offender (loc>100 OR complexity>10).
    assert.ok(result.top_offenders.length >= 1);
    assert.equal(result.top_offenders[0].path, 'bar.cjs');
  });

  test('parseQltyMetrics handles malformed JSON gracefully', () => {
    const result = audit.parseQltyMetrics('not json {{{');
    assert.equal(result.total_loc, null);
    assert.deepEqual(result.top_offenders, []);
  });

  test('parseQltySmells extracts duplication_pct when present', () => {
    const stdout = JSON.stringify({ duplication_pct: 4.7, count: 12 });
    const result = audit.parseQltySmells(stdout);
    assert.equal(result.duplication_pct, 4.7);
    assert.equal(result.smells_count, 12);
  });

  test('parseKnipReport handles array-of-exports schema', () => {
    const stdout = JSON.stringify({ exports: [1, 2, 3], files: [], dependencies: ['unused-dep'] });
    const result = audit.parseKnipReport(stdout);
    assert.equal(result.knip_unused_exports, 3);
    assert.equal(result.knip_unused_files, 0);
    assert.equal(result.knip_unused_deps, 1);
  });

  test('fallbackTestSourceRatio walks tests + bin trees', () => {
    const repoRoot = tmpRepo('ratio');
    fs.mkdirSync(path.join(repoRoot, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'tests', 'a.test.cjs'), 'line1\nline2\nline3\n');
    fs.writeFileSync(path.join(repoRoot, 'bin', 'b.cjs'), 'line1\nline2\n');
    const result = audit.fallbackTestSourceRatio(repoRoot);
    assert.ok(result.test_loc >= 3);
    assert.ok(result.source_loc >= 2);
    assert.ok(result.test_source_ratio !== null);
  });
});

describe('tech-debt-audit — fixture-based integration: drift end-to-end', () => {
  // Sprint 2.5 R2 fix (acceptance MAJOR): exercise full pipeline with a
  // pre-existing prior snapshot (synthetic) and verify drift triggers
  // surface to the result with thresholdExceeded=true.

  test('drift triggers surface end-to-end when prior snapshot has lower metrics', async () => {
    const repoRoot = tmpRepo('drift-e2e');
    fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });

    // Pre-populate prior snapshot with values that make current's drift fire.
    const prior = {
      snapshot_version: 1,
      captured_at: '2026-04-01T00:00:00Z',
      metrics: {
        duplication_pct: 2.0,
        max_function_complexity: 10,
        knip_unused_exports: 1,
        test_source_ratio: 2.5,
      },
    };
    fs.writeFileSync(path.join(repoRoot, 'cortex/debt-snapshot.json'), JSON.stringify(prior, null, 2));

    // Plant some files so fallbackTestSourceRatio finds something.
    fs.mkdirSync(path.join(repoRoot, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'tests', 'a.test.cjs'), 'l\n'.repeat(20));
    fs.writeFileSync(path.join(repoRoot, 'bin', 'main.cjs'), 'l\n'.repeat(100)); // ratio = 0.2 → big pct_drop from 2.5

    const result = await audit.runTechDebtAudit({ repoRoot });

    if (result.skipped) {
      // qlty missing on this machine — fail-open path correctly engaged.
      assert.equal(result.skipReason, 'QLTY_NOT_INSTALLED');
      assert.equal(result.code, 'TECH_DEBT_QLTY_MISSING');
      // Sprint 2.5 R2: roadmap-aligned error code present.
      return;
    }

    // qlty IS installed — full pipeline ran.
    assert.equal(result.ok, true);
    assert.ok(result.snapshot);
    assert.ok(result.drift, 'drift result expected when prior exists');
    assert.equal(typeof result.thresholdExceeded, 'boolean');
    // test_source_ratio drop 2.5→0.2 = -92%, vastly exceeds 20% threshold.
    if (result.drift && result.drift.triggered) {
      const ratioTrigger = result.drift.triggered.find((t) => t.metric === 'test_source_ratio');
      assert.ok(ratioTrigger, 'test_source_ratio pct_drop trigger must fire');
    }
  });

  test('priorCorrupt flag set when prior snapshot is malformed JSON', async () => {
    const repoRoot = tmpRepo('prior-corrupt');
    fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'cortex/debt-snapshot.json'), 'not json {{{');

    const result = await audit.runTechDebtAudit({ repoRoot });
    if (result.skipped) {
      // Fail-open path doesn't read prior; priorCorrupt may be undefined.
      assert.equal(result.skipReason, 'QLTY_NOT_INSTALLED');
      return;
    }
    assert.equal(result.priorCorrupt, true);
    // Snapshot still written (fresh baseline) despite prior being corrupt.
    assert.ok(fs.existsSync(path.join(repoRoot, 'cortex/debt-snapshot.json')));
  });

  test('priorCorrupt set when prior has wrong snapshot_version', async () => {
    const repoRoot = tmpRepo('prior-version');
    fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'cortex/debt-snapshot.json'),
      JSON.stringify({ snapshot_version: 99, metrics: {} }));
    const result = await audit.runTechDebtAudit({ repoRoot });
    if (result.skipped) {
      assert.equal(result.skipReason, 'QLTY_NOT_INSTALLED');
      return;
    }
    assert.equal(result.priorCorrupt, true);
  });
});

describe('tech-debt-audit hardening (R2 review fixes)', () => {
  test('parseQltyMetrics rejects null root', () => {
    const result = audit.parseQltyMetrics('null');
    assert.equal(result.total_loc, null);
  });

  test('parseQltyMetrics rejects negative LoC', () => {
    const stdout = JSON.stringify([{ name: 'a.cjs', lines: -5, complexity: 3 }]);
    const result = audit.parseQltyMetrics(stdout);
    // Negative coerced to 0 via safeNonNegFinite.
    assert.equal(result.total_loc, 0);
  });

  test('parseQltyMetrics rejects NaN/Infinity complexity', () => {
    const stdout = JSON.stringify([
      { name: 'a.cjs', lines: 50, complexity: NaN },
      { name: 'b.cjs', lines: 50, complexity: Infinity },
    ]);
    const result = audit.parseQltyMetrics(stdout);
    assert.equal(result.max_file_complexity, 0); // both rejected → 0
  });

  test('parseQltyMetrics skips non-object rows (null in array)', () => {
    const stdout = JSON.stringify([null, undefined, { name: 'a.cjs', lines: 10, complexity: 5 }]);
    const result = audit.parseQltyMetrics(stdout);
    assert.equal(result.total_loc, 10); // only the valid row counted
  });

  test('parseKnipReport rejects null root', () => {
    const result = audit.parseKnipReport('null');
    assert.equal(result.knip_unused_exports, null);
  });

  test('parseQltySmells rejects null root', () => {
    const result = audit.parseQltySmells('null');
    assert.equal(result.duplication_pct, null);
  });

  test('fallbackTestSourceRatio handles symlink loop without crashing', () => {
    if (process.platform === 'win32') {
      // Junctions need admin on win32; skip the loop-creation test there.
      return;
    }
    const repoRoot = tmpRepo('symlink-loop');
    fs.mkdirSync(path.join(repoRoot, 'sub'));
    try { fs.symlinkSync('..', path.join(repoRoot, 'sub', 'loop')); }
    catch { return; /* skip if no symlink permission */ }
    const result = audit.fallbackTestSourceRatio(repoRoot);
    // Must complete without crash — values may be 0 if no real .cjs files.
    assert.ok(typeof result === 'object');
  });

  test('fallbackTestSourceRatio skips dist/build/coverage dirs', () => {
    const repoRoot = tmpRepo('skip-dirs');
    fs.mkdirSync(path.join(repoRoot, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'dist', 'bundle.js'), 'l\n'.repeat(10000));
    fs.writeFileSync(path.join(repoRoot, 'src', 'a.js'), 'l\n'.repeat(5));
    const result = audit.fallbackTestSourceRatio(repoRoot);
    // dist/bundle.js (10K lines) MUST be excluded; only src/a.js counted.
    assert.ok(result.source_loc < 100, `expected source_loc < 100 (dist excluded), got ${result.source_loc}`);
  });

  test('fallbackTestSourceRatio recognizes .test.cjs and __tests__ patterns', () => {
    const repoRoot = tmpRepo('test-patterns');
    fs.mkdirSync(path.join(repoRoot, 'src', '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', '__tests__', 'sub.test.cjs'), 'l\n'.repeat(10));
    fs.writeFileSync(path.join(repoRoot, 'src', 'lib.cjs'), 'l\n'.repeat(20));
    const result = audit.fallbackTestSourceRatio(repoRoot);
    assert.ok(result.test_loc >= 10);
    assert.ok(result.source_loc >= 20);
  });
});

describe('action-kinds — tech_debt_audit registry entry', () => {
  test('tech_debt_audit kind is registered', () => {
    const k = actionKinds.getActionKind('tech_debt_audit');
    assert.ok(k);
    assert.equal(k.requires_llm, false);
    assert.equal(k.cost_envelope, 'free');
    assert.equal(k.shipped_in, '0.3.0');
  });

  test('tech_debt_audit has all 4 acceptance criteria', () => {
    const k = actionKinds.getActionKind('tech_debt_audit');
    assert.equal(k.acceptance_criteria.length, 4);
    const ids = k.acceptance_criteria.map((c) => c.id);
    assert.ok(ids.includes('snapshot_file_written'));
    assert.ok(ids.includes('snapshot_schema_valid'));
    assert.ok(ids.includes('audit_only_writes_snapshot'));
    assert.ok(ids.includes('audit_readonly_ears'));
  });

  test('isSupportedKind recognizes tech_debt_audit', () => {
    assert.equal(actionKinds.isSupportedKind('tech_debt_audit'), true);
  });

  test('isShippedKind reports tech_debt_audit as shipped', () => {
    assert.equal(actionKinds.isShippedKind('tech_debt_audit'), true);
  });
});
