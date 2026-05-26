'use strict';

// tests/integration/steward-tech-debt-audit.test.cjs
//
// Backfill coverage for the steward-tech-debt-audit cron action.
// Locks in: deterministic parsers (qlty metrics / qlty smells / knip),
// fallback test/source ratio, qlty-missing skip path, security fix from
// Sprint 2.9.7a (no pipe-to-shell in subprocess invocation), scrubbed env.
//
// Scope: deterministic surfaces only — no real qlty/knip binary execution.
// The orchestrator's spawn path is exercised by the existing dryrun test;
// here we focus on what regression-tests cheaply.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  runTechDebtAudit,
  parseQltyMetrics,
  parseQltySmells,
  parseKnipReport,
  fallbackTestSourceRatio,
  SNAPSHOT_PATH,
  SNAPSHOT_VERSION,
} = require('../../bin/steward/_lib/tech-debt-audit.cjs');

const SOURCE_PATH = path.join(__dirname, '..', '..', 'bin', 'steward', '_lib', 'tech-debt-audit.cjs');

describe('steward-tech-debt-audit — deterministic parsers', () => {
  test('parseQltyMetrics aggregates file-level metrics into totals', () => {
    // Real qlty output shape: { files: [{ name, lines, complexity }, ...] }
    const stdout = JSON.stringify({
      files: [
        { name: 'a.ts', lines: 120, complexity: 8 },
        { name: 'b.ts', lines: 200, complexity: 15 },
        { name: 'c.ts', lines: 50, complexity: 3 },
      ],
    });
    const parsed = parseQltyMetrics(stdout);
    assert.equal(parsed.total_loc, 370);
    assert.equal(parsed.files_count, 3);
    assert.equal(parsed.max_file_complexity, 15);
    // Top offenders threshold: loc > 100 OR complexity > 10
    assert.ok(parsed.top_offenders.length >= 2, 'expected b.ts + a.ts in top_offenders');
    assert.equal(parsed.top_offenders[0].path, 'b.ts', 'sorted by complexity desc');
  });

  test('parseQltyMetrics from summary shape (alt qlty version)', () => {
    const stdout = JSON.stringify({
      summary: {
        total_loc: 5000,
        files: 42,
        max_complexity: 25,
        max_function_complexity: 18,
      },
    });
    const parsed = parseQltyMetrics(stdout);
    assert.equal(parsed.total_loc, 5000);
    assert.equal(parsed.files_count, 42);
    assert.equal(parsed.max_file_complexity, 25);
    assert.equal(parsed.max_function_complexity, 18);
  });

  test('parseQltyMetrics rejects adversarial input (negative + non-finite)', () => {
    const stdout = JSON.stringify({
      summary: {
        total_loc: -100,
        files: 'not a number',
        max_complexity: Infinity,
        max_function_complexity: NaN,
      },
    });
    const parsed = parseQltyMetrics(stdout);
    // safeNonNegFinite rejects all four — every field should be null
    assert.equal(parsed.total_loc, null);
    assert.equal(parsed.files_count, null);
    assert.equal(parsed.max_file_complexity, null);
    assert.equal(parsed.max_function_complexity, null);
  });

  test('parseQltyMetrics returns null sentinel on malformed JSON', () => {
    const result = parseQltyMetrics('not json at all');
    assert.equal(result.total_loc, null);
    assert.equal(result.files_count, null);
    assert.deepEqual(result.top_offenders, []);
  });

  test('parseKnipReport extracts unused export counts (array form)', () => {
    // Array form is SSOT-authoritative per parser docstring
    const stdout = JSON.stringify({
      files: ['unused1.ts', 'unused2.ts'],
      exports: [
        { file: 'src/foo.ts', name: 'unusedFn' },
        { file: 'src/bar.ts', name: 'anotherUnused' },
      ],
      dependencies: ['some-unused-pkg'],
    });
    const parsed = parseKnipReport(stdout);
    assert.equal(parsed.knip_unused_exports, 2);
    assert.equal(parsed.knip_unused_files, 2);
    assert.equal(parsed.knip_unused_deps, 1);
  });

  test('parseKnipReport falls back to scalar shape (older knip versions)', () => {
    const stdout = JSON.stringify({
      unusedExports: 5,
      unusedFiles: 3,
      unusedDependencies: 2,
    });
    const parsed = parseKnipReport(stdout);
    assert.equal(parsed.knip_unused_exports, 5);
    assert.equal(parsed.knip_unused_files, 3);
    assert.equal(parsed.knip_unused_deps, 2);
  });

  test('parseKnipReport handles malformed JSON without throwing', () => {
    const result = parseKnipReport('{broken json');
    assert.equal(result.knip_unused_exports, null);
    assert.equal(result.knip_unused_files, null);
    assert.equal(result.knip_unused_deps, null);
  });

  test('parseQltySmells handles smells JSON with duplication_pct', () => {
    const stdout = JSON.stringify({
      duplication_pct: 7.5,
      count: 12,
    });
    const parsed = parseQltySmells(stdout);
    assert.equal(parsed.duplication_pct, 7.5);
    assert.equal(parsed.smells_count, 12);
  });

  test('parseQltySmells handles array form (fallback)', () => {
    const stdout = JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const parsed = parseQltySmells(stdout);
    assert.equal(parsed.smells_count, 3);
    assert.equal(parsed.duplication_pct, null);
  });
});

describe('steward-tech-debt-audit — orchestrator skip paths', () => {
  // Resolve a system binary's directory by walking PATH explicitly. Used to
  // build a spoofed PATH that excludes qlty/knip but preserves other binaries
  // tech-debt-audit may reach for (graceful fallback path expectations).
  function findBinaryDir(binName) {
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())
      : [''];
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const d of dirs) {
      for (const ext of exts) {
        try {
          if (fs.statSync(path.join(d, `${binName}${ext}`)).isFile()) return d;
        } catch { /* not here */ }
      }
    }
    return null;
  }

  test('qlty-missing yields skip-result with documented error code', async () => {
    // Override PATH to a dir with no qlty/knip; preserve other essentials
    // (node + git + system shell) so the orchestrator doesn't trip on those.
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-tda-empty-'));
    const origPath = process.env.PATH;
    const origPathExt = process.env.PATHEXT;
    // Find essential binaries' dirs and include only those + emptyDir
    const essentialDirs = new Set([emptyDir]);
    for (const b of ['node', 'git']) {
      const d = findBinaryDir(b);
      if (d) essentialDirs.add(d);
    }
    process.env.PATH = [...essentialDirs].join(path.delimiter);
    if (process.platform === 'win32') {
      process.env.PATHEXT = origPathExt || '.EXE;.CMD;.BAT';
    }
    try {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-tda-repo-'));
      const result = await runTechDebtAudit({ repoRoot: tmpRepo });
      assert.equal(result.ok, true, 'qlty-missing must NOT be a hard failure');
      assert.equal(result.skipped, true);
      assert.equal(result.skip_commit, true);
      assert.equal(result.code, 'TECH_DEBT_QLTY_MISSING');
      assert.deepEqual(result.touchedFiles, []);
    } finally {
      process.env.PATH = origPath;
      if (origPathExt !== undefined) process.env.PATHEXT = origPathExt;
    }
  });
});

describe('steward-tech-debt-audit — Sprint 2.9.7a security fix preserved', () => {
  test('source code does NOT use shell:true on subprocess invocation', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8');
    assert.doesNotMatch(
      src,
      /spawn\([^)]*\bshell:\s*true/,
      'Sprint 2.9.7a removed shell:true from subprocess spawning; do not reintroduce',
    );
  });

  test('source code does NOT use bash -c <(curl) pipe-to-shell pattern', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8');
    assert.doesNotMatch(
      src,
      /bash\s+-c\s+<\(/,
      'Sprint 2.9.7a removed the pipe-to-shell installer pattern; do not reintroduce',
    );
    assert.doesNotMatch(
      src,
      /curl[^\n]*\|\s*sh/,
      'curl|sh anti-pattern must not be reintroduced',
    );
  });

  test('runCommand applies scrubbed env (does not leak OPENROUTER_API_KEY)', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8');
    assert.match(
      src,
      /buildScrubbedEnv|SCRUBBED_ENV_KEEP_KEYS/,
      'env scrubbing must be present',
    );
    assert.doesNotMatch(
      src,
      /env:\s*\{\s*\.\.\.process\.env/,
      'do not spread process.env into subprocess env (would leak secrets)',
    );
  });
});

describe('steward-tech-debt-audit — snapshot contract', () => {
  test('SNAPSHOT_PATH + SNAPSHOT_VERSION are exported and stable', () => {
    assert.equal(typeof SNAPSHOT_PATH, 'string');
    assert.ok(SNAPSHOT_PATH.length > 0);
    assert.equal(typeof SNAPSHOT_VERSION, 'number');
    assert.ok(SNAPSHOT_VERSION >= 1, 'snapshot version must be >= 1');
    // Path is project-relative, never absolute (snapshot is committed to repo)
    assert.ok(
      !path.isAbsolute(SNAPSHOT_PATH),
      `SNAPSHOT_PATH must be repo-relative, got ${SNAPSHOT_PATH}`,
    );
  });
});

describe('steward-tech-debt-audit — fallback heuristic', () => {
  test('fallbackTestSourceRatio returns a shape object with numeric fields', () => {
    // Use a small synthetic repo to keep test runtime bounded; running it
    // on the cortex-x repo itself walks ~50k files and exceeds the <2s budget.
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-tda-ratio-'));
    fs.mkdirSync(path.join(tmpRepo, 'src'));
    fs.mkdirSync(path.join(tmpRepo, 'tests'));
    fs.writeFileSync(path.join(tmpRepo, 'src', 'foo.cjs'), 'const x = 1;\nmodule.exports = x;\n');
    fs.writeFileSync(path.join(tmpRepo, 'tests', 'foo.test.cjs'), 'const x = require("../src/foo.cjs");\n');
    const result = fallbackTestSourceRatio(tmpRepo);
    assert.ok(result && typeof result === 'object', 'returns shape object');
    // Either all fields are numeric, or the fallback null sentinel
    if (result.test_loc !== null) {
      assert.ok(typeof result.test_loc === 'number' && result.test_loc >= 0);
      assert.ok(typeof result.source_loc === 'number' && result.source_loc >= 0);
      assert.ok(typeof result.test_count === 'number' && result.test_count >= 0);
      if (result.test_source_ratio !== null) {
        assert.ok(Number.isFinite(result.test_source_ratio));
        assert.ok(result.test_source_ratio >= 0);
      }
    }
  });
});
