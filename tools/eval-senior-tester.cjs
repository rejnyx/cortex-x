#!/usr/bin/env node
// eval-senior-tester.cjs — Sprint 2.11.2 Phase A detector eval runner.
//
// Validates the test-smell-detector against 5 hand-labeled fixtures under
// evals/senior-tester/fixtures/. Each fixture has a baseline.sarif.json
// capturing the expected findings (smell_id × file × line). Runner walks
// every fixture, runs `detectAll`, compares against baseline, reports
// pass/fail with diff.
//
// Format: SARIF v2.1.0 subset (per Sprint 2.11.2 R1 memo recommendation).
// We use only the fields tooling speaks natively:
//   - run.tool.driver.{name, version}
//   - run.results[].{ruleId, level, locations[0].physicalLocation.{artifactLocation.uri, region.startLine}}
// Plus a cortex-x extension block at run.properties.cortex_x:
//   - detectorVersion: pinned at baseline-write time
//   - fixtureSha: sha256 of all .test.cjs files joined; rejects on drift
//   - layerBalance: { unit, integration, e2e, total, ratio, target, skew }
//
// Lock semantics: a baseline is locked by (detectorVersion, fixtureSha) tuple.
// Detector code change → bump detectorVersion + manually re-review baseline.
// Fixture content change → fixtureSha mismatch → CI blocks until baseline
// is regenerated AND committed in the same PR (no auto-update).
//
// Exit code: 0 = all baselines match, 1 = drift detected.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const detector = require('../bin/steward/_lib/test-smell-detector.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'evals', 'senior-tester', 'fixtures');
const FIXTURE_NAMES = ['clean', 'assertion-density', 'state-coupling', 'structure-decay', 'e2e-heavy'];

// Bumped explicitly when detector regex catalogue or block-extraction
// semantics change in a way that legitimately shifts findings. Mismatch
// against the baseline's detectorVersion is fatal — a human must
// regenerate + manually re-verify the baseline.
const DETECTOR_VERSION = '1';

// ─── Fixture content hash ────────────────────────────────────────────────────

function fixtureSha(fixturePath) {
  // Hash all .test.cjs files (sorted by relative path) under the fixture's
  // tests/ tree. Stable across platforms — uses '/' separator and LF
  // line endings via fs.readFileSync(... 'utf8') normalization.
  const files = [];
  walkTestFiles(path.join(fixturePath, 'tests'), fixturePath, files);
  files.sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel.replace(/\\/g, '/'));
    h.update('\0');
    const buf = fs.readFileSync(path.join(fixturePath, rel), 'utf8');
    h.update(buf.replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex');
}

function walkTestFiles(dir, root, accum) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkTestFiles(full, root, accum);
    } else if (e.isFile() && /\.(test|spec)\.c?js$/.test(e.name)) {
      accum.push(path.relative(root, full));
    }
  }
}

// ─── SARIF subset emission ──────────────────────────────────────────────────

function findingsToSarif({ fixtureName, findings, layerBalance, detectorVersion, fixSha }) {
  // Rules referenced (deduplicated by smell_id).
  const ruleIds = [...new Set(findings.map((f) => f.smell_id))].sort();
  return {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'cortex-x-senior-tester',
            version: detectorVersion,
            rules: ruleIds.map((id) => ({ id })),
          },
        },
        properties: {
          cortex_x: {
            fixture: fixtureName,
            detectorVersion,
            fixtureSha: fixSha,
            layerBalance,
          },
        },
        results: findings.map((f) => ({
          ruleId: f.smell_id,
          level: severityToLevel(f.severity),
          message: { text: (f.excerpt || '').toString().slice(0, 200) },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: (f.file || '').replace(/\\/g, '/') },
                region: { startLine: typeof f.line === 'number' ? f.line : 0 },
              },
            },
          ],
        })),
      },
    ],
  };
}

function severityToLevel(s) {
  switch (s) {
    case 'high': return 'error';
    case 'medium': return 'warning';
    case 'low': return 'note';
    default: return 'note';
  }
}

// ─── Diff ───────────────────────────────────────────────────────────────────

function summarizeFindings(sarif) {
  if (!sarif || !sarif.runs || !sarif.runs[0]) return [];
  return sarif.runs[0].results.map((r) => {
    const loc = (r.locations && r.locations[0] && r.locations[0].physicalLocation) || {};
    return {
      ruleId: r.ruleId,
      level: r.level,
      uri: (loc.artifactLocation && loc.artifactLocation.uri) || '',
      startLine: (loc.region && loc.region.startLine) || 0,
    };
  }).sort((a, b) => {
    if (a.uri !== b.uri) return a.uri < b.uri ? -1 : 1;
    if (a.startLine !== b.startLine) return a.startLine - b.startLine;
    return a.ruleId < b.ruleId ? -1 : 1;
  });
}

function diffResults(actual, expected) {
  const a = summarizeFindings(actual);
  const e = summarizeFindings(expected);
  const aKey = (x) => `${x.ruleId}@${x.uri}:${x.startLine}`;
  const aSet = new Set(a.map(aKey));
  const eSet = new Set(e.map(aKey));
  const missing = e.filter((x) => !aSet.has(aKey(x)));
  const extra = a.filter((x) => !eSet.has(aKey(x)));
  return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

// ─── Per-fixture runner ─────────────────────────────────────────────────────

// Sentinel for empty / missing-tests fixtures. Distinct value so a write-baseline
// run on a fixture without any *.test.cjs files is rejected explicitly rather
// than producing a baseline locked on an empty SHA (silent-bug-pin).
const EMPTY_FIXTURE_SHA = 'EMPTY_FIXTURE';

function evalFixture(fixtureName) {
  const fixturePath = path.join(FIXTURES_DIR, fixtureName);

  // R2 edge-hunter HIGH: statSync on non-existent path throws ENOENT;
  // wrap so the runner reports structured FIXTURE_NOT_FOUND instead of
  // crashing the process with a stack trace.
  let stat;
  try {
    stat = fs.statSync(fixturePath);
  } catch (err) {
    return { fixture: fixtureName, ok: false, error: 'FIXTURE_NOT_FOUND', message: err.message };
  }
  if (!stat.isDirectory()) {
    return { fixture: fixtureName, ok: false, error: 'NOT_A_DIRECTORY' };
  }

  const computedSha = fixtureShaOrEmpty(fixturePath);
  const detected = detector.detectAll({ repoRoot: fixturePath });
  const actualSarif = findingsToSarif({
    fixtureName,
    findings: detected.findings,
    layerBalance: detected.layer_balance,
    detectorVersion: DETECTOR_VERSION,
    fixSha: computedSha,
  });

  const baselinePath = path.join(fixturePath, 'baseline.sarif.json');
  if (!fs.existsSync(baselinePath)) {
    return {
      fixture: fixtureName,
      ok: false,
      error: 'BASELINE_MISSING',
      actualSarif,
      computedSha,
    };
  }

  // R2 edge-hunter BLOCKER: malformed JSON in baseline previously crashed
  // the runner mid-loop; subsequent fixtures never ran. Surface as
  // BASELINE_MALFORMED so CI shows which fixture's baseline needs repair.
  let expectedSarif;
  try {
    expectedSarif = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (err) {
    return {
      fixture: fixtureName,
      ok: false,
      error: 'BASELINE_MALFORMED',
      message: `baseline.sarif.json is not valid JSON: ${err.message}`,
      computedSha,
    };
  }

  const baseSha = expectedSarif.runs?.[0]?.properties?.cortex_x?.fixtureSha;
  const baseDetVer = expectedSarif.runs?.[0]?.properties?.cortex_x?.detectorVersion;

  // R2 edge-hunter MEDIUM: missing cortex_x block was previously surfaced
  // as a confusing FIXTURE_SHA_DRIFT ("undefined vs <hex>"). Distinguish
  // schema corruption from drift so operator triages the right thing.
  if (baseSha == null || baseDetVer == null) {
    return {
      fixture: fixtureName,
      ok: false,
      error: 'BASELINE_SCHEMA_INVALID',
      message: 'baseline.sarif.json is missing runs[0].properties.cortex_x.{fixtureSha, detectorVersion}',
      computedSha,
    };
  }

  if (baseSha !== computedSha) {
    return {
      fixture: fixtureName,
      ok: false,
      error: 'FIXTURE_SHA_DRIFT',
      message: `fixture content changed (baseline ${String(baseSha).slice(0, 12)} vs current ${computedSha.slice(0, 12)}); regenerate baseline + manually re-verify`,
      actualSarif,
      computedSha,
    };
  }
  if (baseDetVer !== DETECTOR_VERSION) {
    return {
      fixture: fixtureName,
      ok: false,
      error: 'DETECTOR_VERSION_DRIFT',
      message: `detector version changed (baseline ${baseDetVer} vs runner ${DETECTOR_VERSION}); regenerate baseline + manually re-verify`,
      actualSarif,
      computedSha,
    };
  }

  const diff = diffResults(actualSarif, expectedSarif);
  return {
    fixture: fixtureName,
    ok: diff.ok,
    error: diff.ok ? null : 'FINDINGS_DRIFT',
    diff,
    actualSarif,
    expectedSarif,
    computedSha,
  };
}

// Wraps fixtureSha to return EMPTY_FIXTURE_SHA when the fixture has no
// *.test.cjs files. Without this, a fixture with empty `tests/` or no
// `tests/` at all silently shares a hash with any other empty fixture,
// and `--write-baseline` would lock that empty hash as "valid".
function fixtureShaOrEmpty(fixturePath) {
  const files = [];
  walkTestFiles(path.join(fixturePath, 'tests'), fixturePath, files);
  if (files.length === 0) return EMPTY_FIXTURE_SHA;
  return fixtureSha(fixturePath);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = argv.slice(2);
  const writeBaseline = args.includes('--write-baseline');
  const fixtureFilter = args.find((a) => !a.startsWith('--'));

  // R2 edge-hunter HIGH: validate fixture filter against allow-list so a
  // typo (e.g. `assertion-densty`) errors with a clear message instead
  // of crashing on the missing directory.
  if (fixtureFilter && !FIXTURE_NAMES.includes(fixtureFilter)) {
    console.error(`Unknown fixture: ${fixtureFilter}`);
    console.error(`Known fixtures: ${FIXTURE_NAMES.join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const targets = fixtureFilter ? [fixtureFilter] : FIXTURE_NAMES;
  const results = [];

  for (const name of targets) {
    if (writeBaseline) {
      const fixturePath = path.join(FIXTURES_DIR, name);
      const computedSha = fixtureShaOrEmpty(fixturePath);
      // R2 edge-hunter HIGH: refuse to lock a baseline against an empty
      // fixture — silent bug pinning otherwise, since two different
      // empty fixtures share the same EMPTY_FIXTURE sentinel.
      if (computedSha === EMPTY_FIXTURE_SHA) {
        console.error(`[write-baseline] ${name}: fixture has no *.test.cjs files under tests/; refusing to lock empty baseline`);
        results.push({ fixture: name, ok: false, error: 'EMPTY_FIXTURE_REFUSED' });
        continue;
      }
      const detected = detector.detectAll({ repoRoot: fixturePath });
      const sarif = findingsToSarif({
        fixtureName: name,
        findings: detected.findings,
        layerBalance: detected.layer_balance,
        detectorVersion: DETECTOR_VERSION,
        fixSha: computedSha,
      });
      const baselinePath = path.join(fixturePath, 'baseline.sarif.json');
      fs.writeFileSync(baselinePath, JSON.stringify(sarif, null, 2) + '\n');
      console.log(`[write-baseline] ${name}: ${detected.findings.length} findings → ${path.relative(REPO_ROOT, baselinePath)}`);
      results.push({ fixture: name, ok: true, wrote: true });
      continue;
    }
    const r = evalFixture(name);
    results.push(r);
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${name}`);
    if (!r.ok) {
      console.log(`  error: ${r.error}`);
      if (r.message) console.log(`  ${r.message}`);
      if (r.diff) {
        if (r.diff.missing.length) {
          console.log(`  missing (${r.diff.missing.length}):`);
          for (const m of r.diff.missing.slice(0, 20)) console.log(`    - ${m.ruleId} at ${m.uri}:${m.startLine}`);
          if (r.diff.missing.length > 20) console.log(`    ... +${r.diff.missing.length - 20} more`);
        }
        if (r.diff.extra.length) {
          console.log(`  extra (${r.diff.extra.length}):`);
          for (const x of r.diff.extra.slice(0, 20)) console.log(`    + ${x.ruleId} at ${x.uri}:${x.startLine}`);
          if (r.diff.extra.length > 20) console.log(`    ... +${r.diff.extra.length - 20} more`);
        }
      }
    }
  }

  const failed = results.filter((r) => !r.ok && !r.wrote).length;
  console.log('');
  console.log(`Total: ${results.length} fixtures, ${failed} drifted`);
  process.exitCode = failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  evalFixture,
  fixtureSha,
  fixtureShaOrEmpty,
  diffResults,
  summarizeFindings,
  findingsToSarif,
  DETECTOR_VERSION,
  EMPTY_FIXTURE_SHA,
  FIXTURE_NAMES,
  FIXTURES_DIR,
};
