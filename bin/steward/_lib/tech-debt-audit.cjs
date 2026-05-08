// Sprint 2.5 — tech_debt_audit executor.
//
// Runs qlty metrics + knip → produces flat metrics object →
// writes snapshot to cortex/debt-snapshot.json → optionally compares
// against prior snapshot to surface drift triggers in the journal.
//
// v1 scope (per R1 memo §9): SNAPSHOT-ONLY. No PR opening. Drift triggers
// are recorded as a `drift_triggered` field on the result so execute.cjs
// can emit a journal `tech_debt_drift` event for operator visibility via
// `cortex-steward status`. PR generation deferred to v2 once operator
// action-rate on advisory rows is measured.
//
// Fail-open semantics: when qlty is missing, returns
//   { ok: true, skipped: true, skipReason: 'QLTY_NOT_INSTALLED' }
// which execute.cjs treats as a non-failure outcome (no breaker increment).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const { computeSnapshotDrift, DEFAULT_TRIGGERS } = require('./snapshot-diff.cjs');
const detector = require('../../../detectors/tech-debt-audit.cjs');

const SNAPSHOT_PATH = 'cortex/debt-snapshot.json';
const SNAPSHOT_VERSION = 1;
const QLTY_TIMEOUT_MS = 120_000; // 2 min hard kill (R1 memo §2.9)
const TOP_OFFENDERS_LIMIT = 10;
// Sprint 2.5 R2 fix (security HIGH-2, edge HIGH): byte-length cap on subprocess
// stdout/stderr to prevent OOM from runaway qlty/knip output.
const SUBPROCESS_OUTPUT_BUFFER_CAP = 16 * 1024 * 1024; // 16 MB
// Sprint 2.5 R2 fix (security HIGH-3): bounds on fallback fs walk to prevent
// symlink-loop / runaway-monorepo DoS.
const FS_WALK_MAX_FILES = 20_000;
const FS_WALK_MAX_DEPTH = 20;
const FS_WALK_MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file
// Sprint 2.5 R2 fix (security HIGH-1): scrubbed env keeps only minimal
// platform variables. Prevents OPENROUTER_API_KEY / ANTHROPIC_API_KEY /
// GITHUB_TOKEN from leaking to qlty / knip subprocesses (CWE-200/526).
const SCRUBBED_ENV_KEEP_KEYS = Object.freeze([
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL', 'LC_CTYPE',
  // Allow Node-required chrome
  'NODE_PATH', 'NODE_OPTIONS',
]);

function buildScrubbedEnv(baseEnv) {
  const src = baseEnv || process.env;
  const env = {};
  for (const k of SCRUBBED_ENV_KEEP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k)) env[k] = src[k];
  }
  return env;
}

// Sprint 2.5 R2 fix (correctness MAJOR-1, edge MAJOR): clamp numeric values
// to non-negative finite range. Used by parseQlty* / parseKnip* to reject
// adversarial / buggy CLI output.
function safeNonNegFinite(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

// Spawn helper: runs cmd + args with timeout, returns
// { ok, stdout, stderr, exitCode, code? }. Mirrors Sprint 2.4 subprocess
// hardening: AbortController timeout, scrubbed env, byte-length output cap.
async function runCommand(cmd, args, opts = {}) {
  // Sprint 2.5 R2 fix (edge MINOR): guard empty/invalid cmd.
  if (!cmd || typeof cmd !== 'string') {
    return { ok: false, code: 'BINARY_NOT_FOUND', error: 'cmd argument must be a non-empty string' };
  }
  if (cmd.indexOf('\0') !== -1) {
    return { ok: false, code: 'SPAWN_FAILED', error: 'cmd contains NUL byte' };
  }
  const spawnImpl = opts.spawnImpl || childProcess.spawn;
  // Sprint 2.5 R2 fix (edge MINOR): clamp timeout into safe range.
  const rawTimeout = opts.timeoutMs || QLTY_TIMEOUT_MS;
  const timeoutMs = Math.max(1_000, Math.min(rawTimeout, 10 * 60 * 1000));
  const cwd = opts.cwd || process.cwd();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let stdoutBuf = '';
  let stderrBuf = '';
  let stdoutOver = false;
  let stderrOver = false;

  try {
    let child;
    try {
      child = spawnImpl(cmd, args, {
        cwd,
        // Sprint 2.5 R2 fix (security HIGH-1, CWE-200/526): scrub env so
        // OPENROUTER_API_KEY / ANTHROPIC_* / GITHUB_TOKEN don't leak into
        // qlty/knip subprocesses. Knip in particular runs project config
        // (knip.config.ts) which can read arbitrary process.env.
        env: opts.env || buildScrubbedEnv(),
        signal: ctrl.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: /\.(cmd|bat)$/i.test(cmd),
      });
    } catch (err) {
      return { ok: false, code: err.code === 'ENOENT' ? 'BINARY_NOT_FOUND' : 'SPAWN_FAILED', error: err.message };
    }

    // Sprint 2.5 R2 fix (security HIGH-2, edge HIGH): byte-length cap on
    // stdout/stderr. UTF-8-aware via Buffer.byteLength.
    child.stdout.on('data', (c) => {
      if (stdoutOver) return;
      stdoutBuf += c.toString('utf8');
      if (Buffer.byteLength(stdoutBuf, 'utf8') > SUBPROCESS_OUTPUT_BUFFER_CAP) {
        stdoutOver = true;
        try { child.kill('SIGTERM'); } catch { /* race-tolerant */ }
        // Truncate to ~cap (UTF-16 char units approximate; Buffer.byteLength
        // remains the gate for the over-flag).
        while (stdoutBuf.length > 0 && Buffer.byteLength(stdoutBuf, 'utf8') > SUBPROCESS_OUTPUT_BUFFER_CAP) {
          stdoutBuf = stdoutBuf.slice(0, Math.floor(stdoutBuf.length * 0.9));
        }
      }
    });
    child.stderr.on('data', (c) => {
      if (stderrOver) return;
      stderrBuf += c.toString('utf8');
      if (Buffer.byteLength(stderrBuf, 'utf8') > SUBPROCESS_OUTPUT_BUFFER_CAP) {
        stderrOver = true;
        while (stderrBuf.length > 0 && Buffer.byteLength(stderrBuf, 'utf8') > SUBPROCESS_OUTPUT_BUFFER_CAP) {
          stderrBuf = stderrBuf.slice(0, Math.floor(stderrBuf.length * 0.9));
        }
      }
    });

    const result = await new Promise((resolve) => {
      let resolved = false;
      const finish = (p) => { if (!resolved) { resolved = true; resolve(p); } };
      child.on('close', (code, signal) => finish({ code, signal }));
      child.on('error', (err) => finish({ err }));
      ctrl.signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch { /* race-tolerant */ }
        finish({ aborted: true });
      }, { once: true });
    });
    try { child.on('error', () => {}); } catch { /* idempotent */ }

    // Sprint 2.5 R2 fix (blind MAJOR-2): include buffered stdout/stderr in
    // timeout/error returns so partial output isn't discarded.
    if (result.aborted) return { ok: false, code: 'TIMEOUT', error: `${cmd} timed out after ${timeoutMs}ms`, stdout: stdoutBuf, stderr: stderrBuf, truncated: stdoutOver || stderrOver };
    if (result.err) return { ok: false, code: 'SPAWN_FAILED', error: result.err.message, stdout: stdoutBuf, stderr: stderrBuf };
    if (typeof result.code === 'number' && result.code !== 0) {
      return { ok: false, code: 'NONZERO_EXIT', exitCode: result.code, stdout: stdoutBuf, stderr: stderrBuf, truncated: stdoutOver || stderrOver };
    }
    return { ok: true, stdout: stdoutBuf, stderr: stderrBuf, truncated: stdoutOver || stderrOver };
  } finally {
    clearTimeout(timer);
  }
}

// Parse `qlty metrics --all --json` output. Returns flat metrics object.
// Schema may shift across qlty versions; we accept either an array of
// per-file rows OR a single { summary, files } object — both observed in
// 2026-Q3 release notes. Defensive fallback: if structure unexpected,
// return zero metrics rather than crash.
//
// Sprint 2.5 R2 fix (correctness MAJOR-1, edge MAJOR): null-guard parsed
// root + clamp values to non-negative finite range.
function parseQltyMetrics(stdout) {
  const NULLS = { total_loc: null, files_count: null, max_file_complexity: null, max_function_complexity: null, top_offenders: [] };
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return NULLS;

    let files = [];
    if (Array.isArray(parsed)) {
      files = parsed;
    } else if (Array.isArray(parsed.files)) {
      files = parsed.files;
    } else if (parsed.summary && typeof parsed.summary === 'object') {
      return {
        total_loc: safeNonNegFinite(parsed.summary.total_loc),
        files_count: safeNonNegFinite(parsed.summary.files),
        max_file_complexity: safeNonNegFinite(parsed.summary.max_complexity),
        max_function_complexity: safeNonNegFinite(parsed.summary.max_function_complexity),
        top_offenders: [],
      };
    }
    let totalLoc = 0;
    let maxFile = 0;
    let maxFunc = 0;
    const offenders = [];
    for (const f of files) {
      // Skip non-object rows (null, undefined, primitives).
      if (!f || typeof f !== 'object') continue;
      const loc = safeNonNegFinite(f.lines) ?? safeNonNegFinite(f.loc) ?? 0;
      const fileComplexity = safeNonNegFinite(f.complexity) ?? 0;
      // R2 review: function-level complexity is a separate field if qlty
      // exposes it; fall back to file complexity only when missing.
      const funcComplexity = safeNonNegFinite(f.function_complexity) ?? fileComplexity;
      totalLoc += loc;
      if (fileComplexity > maxFile) maxFile = fileComplexity;
      if (funcComplexity > maxFunc) maxFunc = funcComplexity;
      if (loc > 100 || fileComplexity > 10) {
        const namePath = (typeof f.name === 'string' && f.name) || (typeof f.path === 'string' && f.path) || 'unknown';
        offenders.push({ path: namePath, loc, complexity: fileComplexity });
      }
    }
    offenders.sort((a, b) => b.complexity - a.complexity || b.loc - a.loc);
    return {
      total_loc: totalLoc,
      files_count: files.length,
      max_file_complexity: maxFile,
      max_function_complexity: maxFunc,
      top_offenders: offenders.slice(0, TOP_OFFENDERS_LIMIT),
    };
  } catch {
    return NULLS;
  }
}

// Parse `qlty smells --all --json` for duplication %.
function parseQltySmells(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return { duplication_pct: null, smells_count: 0 };
    if (Array.isArray(parsed)) return { duplication_pct: null, smells_count: parsed.length };
    const dup = safeNonNegFinite(parsed.duplication_pct);
    if (dup !== null) return { duplication_pct: dup, smells_count: safeNonNegFinite(parsed.count) ?? 0 };
    return { duplication_pct: null, smells_count: 0 };
  } catch {
    return { duplication_pct: null, smells_count: 0 };
  }
}

// Parse `knip --reporter json` output.
// SSOT precedence: array form (`exports: [...]`) authoritative; scalar
// `unusedExports` number is fallback for older knip schema.
function parseKnipReport(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') {
      return { knip_unused_exports: null, knip_unused_files: null, knip_unused_deps: null };
    }
    return {
      knip_unused_exports: Array.isArray(parsed.exports) ? parsed.exports.length : (safeNonNegFinite(parsed.unusedExports)),
      knip_unused_files: Array.isArray(parsed.files) ? parsed.files.length : (safeNonNegFinite(parsed.unusedFiles)),
      knip_unused_deps: Array.isArray(parsed.dependencies) ? parsed.dependencies.length : (safeNonNegFinite(parsed.unusedDependencies)),
    };
  } catch {
    return { knip_unused_exports: null, knip_unused_files: null, knip_unused_deps: null };
  }
}

// Heuristic test:source ratio from filesystem walk (zero-deps fallback if
// no other source is available). Counts lines under `tests/` / `__tests__/`
// / `spec/` vs `bin/` + `src/`. File ending in `.test.<ext>` or `.spec.<ext>`
// also counted as test even if outside test dirs.
//
// Sprint 2.5 R2 hardening (security HIGH-3 / edge HIGH):
//   - track visited inodes via fs.realpathSync to break symlink loops
//   - skip symlink entries (e.isSymbolicLink())
//   - cap recursion depth at FS_WALK_MAX_DEPTH
//   - cap total file count at FS_WALK_MAX_FILES (DoS-resistant)
//   - cap per-file size at FS_WALK_MAX_FILE_BYTES via statSync
//   - extend skip list: dist, build, coverage, out, .next, target
const TEST_DIR_REGEX = /^(__)?tests?(__)?$|^spec$/i;
const TEST_FILE_REGEX = /\.(test|spec)\.(cjs|mjs|js|ts|tsx|jsx)$/i;
const SOURCE_FILE_REGEX = /\.(cjs|mjs|js|ts|tsx|jsx)$/i;
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out',
  '.next', '.nuxt', '.cache', '.turbo', 'target',
]);

function fallbackTestSourceRatio(repoRoot) {
  try {
    let testLoc = 0;
    let sourceLoc = 0;
    let fileCount = 0;
    const visited = new Set();
    function walk(dir, isTest, depth) {
      if (depth > FS_WALK_MAX_DEPTH) return;
      if (fileCount >= FS_WALK_MAX_FILES) return;
      let realDir;
      try { realDir = fs.realpathSync(dir); } catch { return; }
      if (visited.has(realDir)) return; // symlink loop break
      visited.add(realDir);

      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (fileCount >= FS_WALK_MAX_FILES) return;
        // Sprint 2.5 R2 fix: skip symlinks (security HIGH).
        if (e.isSymbolicLink()) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIR_NAMES.has(e.name) || e.name.startsWith('.')) continue;
          walk(full, isTest || TEST_DIR_REGEX.test(e.name), depth + 1);
        } else if (e.isFile()) {
          if (!SOURCE_FILE_REGEX.test(e.name)) continue;
          // Cap per-file size to prevent OOM on minified bundles.
          let size;
          try { size = fs.statSync(full).size; } catch { continue; }
          if (size > FS_WALK_MAX_FILE_BYTES) continue;
          let content;
          try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
          fileCount += 1;
          const lines = content.split('\n').length;
          const fileIsTest = isTest || TEST_FILE_REGEX.test(e.name);
          if (fileIsTest) testLoc += lines;
          else sourceLoc += lines;
        }
      }
    }
    walk(repoRoot, false, 0);
    return {
      test_loc: testLoc,
      source_loc: sourceLoc,
      test_source_ratio: sourceLoc > 0 ? testLoc / sourceLoc : null,
    };
  } catch {
    return { test_loc: null, source_loc: null, test_source_ratio: null };
  }
}

// Main executor — orchestrates qlty + knip + ratio walk and writes snapshot.
async function runTechDebtAudit(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();

  // Probe step (also delegated to detector for dispatch-time check).
  const probe = detector.detect({ repoRoot });
  if (probe.status === 'opted-out') {
    return { ok: true, skipped: true, skipReason: 'AUDIT_OPTED_OUT', detail: probe.reason };
  }
  if (probe.status === 'qlty-missing') {
    // Sprint 2.5 R2 fix (acceptance BLOCKER + ssot BLOCKER): use roadmap-
    // documented error code TECH_DEBT_QLTY_MISSING. skipReason kept for
    // backward-compat with tests that asserted it; new `code` field
    // matches roadmap docs/steward-roadmap.md error-code table.
    return {
      ok: true,
      skipped: true,
      skipReason: 'QLTY_NOT_INSTALLED',
      code: 'TECH_DEBT_QLTY_MISSING',
      detail: probe.reason,
    };
  }

  const knipAvailable = probe.status === 'ready';

  // Run qlty metrics.
  const metricsRun = await runCommand(probe.qltyPath, ['metrics', '--all', '--json'], { cwd: repoRoot });
  if (!metricsRun.ok) {
    return {
      ok: false,
      code: 'TECH_DEBT_QLTY_METRICS_FAILED',
      error: `qlty metrics failed: ${metricsRun.error || metricsRun.stderr || `exit ${metricsRun.exitCode}`}`,
    };
  }
  const qltyMetrics = parseQltyMetrics(metricsRun.stdout);

  // Run qlty smells (best-effort — skip on failure, snapshot still useful).
  const smellsRun = await runCommand(probe.qltyPath, ['smells', '--all', '--json'], { cwd: repoRoot });
  const qltySmells = smellsRun.ok ? parseQltySmells(smellsRun.stdout) : { duplication_pct: null, smells_count: null };

  // Run knip if available.
  let knipMetrics = { knip_unused_exports: null, knip_unused_files: null, knip_unused_deps: null };
  if (knipAvailable && probe.knipPath) {
    const knipRun = await runCommand(probe.knipPath, ['--reporter', 'json'], { cwd: repoRoot });
    if (knipRun.ok || knipRun.stdout) {
      // knip exits non-zero when issues found — that's expected; parse stdout regardless.
      knipMetrics = parseKnipReport(knipRun.stdout);
    }
  }

  // Test:source ratio.
  const ratio = fallbackTestSourceRatio(repoRoot);

  // Compose final metrics.
  const metrics = {
    total_loc: qltyMetrics.total_loc,
    test_loc: ratio.test_loc,
    source_loc: ratio.source_loc,
    test_source_ratio: ratio.test_source_ratio,
    files_count: qltyMetrics.files_count,
    max_file_complexity: qltyMetrics.max_file_complexity,
    max_function_complexity: qltyMetrics.max_function_complexity,
    duplication_pct: qltySmells.duplication_pct,
    smells_count: qltySmells.smells_count,
    knip_unused_exports: knipMetrics.knip_unused_exports,
    knip_unused_files: knipMetrics.knip_unused_files,
    knip_unused_deps: knipMetrics.knip_unused_deps,
  };

  // Sprint 2.5 R2 fix (edge MINOR): guard opts.now is a Date.
  const capturedAt = (opts.now instanceof Date && !isNaN(opts.now.getTime()))
    ? opts.now.toISOString()
    : new Date().toISOString();

  // Build snapshot envelope. R1 §2.4 schema includes qlty_version + knip_version
  // when available (best-effort, derived from binary path basename).
  const snapshot = {
    snapshot_version: SNAPSHOT_VERSION,
    captured_at: capturedAt,
    qlty_path: probe.qltyPath,
    qlty_version: null,
    knip_path: probe.knipPath || null,
    knip_version: null,
    metrics,
    top_offenders: qltyMetrics.top_offenders,
  };

  // Load prior snapshot for drift comparison.
  // Sprint 2.5 R2 fix (correctness MINOR): expose priorCorrupt flag to
  // execute.cjs so it can journal a TECH_DEBT_SNAPSHOT_CORRUPT event when
  // operator's prior snapshot is malformed (instead of silently re-baselining).
  const snapshotPath = path.join(repoRoot, SNAPSHOT_PATH);
  let prior = null;
  let priorCorrupt = false;
  try {
    if (fs.existsSync(snapshotPath)) {
      try {
        prior = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        // Validate prior shape; corrupt = treat as fresh baseline + flag.
        if (!prior || typeof prior !== 'object' || Array.isArray(prior) ||
            !prior.metrics || typeof prior.metrics !== 'object' || Array.isArray(prior.metrics) ||
            prior.snapshot_version !== SNAPSHOT_VERSION) {
          priorCorrupt = true;
          prior = null;
        }
      } catch {
        priorCorrupt = true;
      }
    }
  } catch { /* fs error — treat as no prior */ }

  // Write new snapshot.
  try {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  } catch (err) {
    return {
      ok: false,
      code: 'TECH_DEBT_SNAPSHOT_WRITE_FAILED',
      error: `Failed to write ${SNAPSHOT_PATH}: ${err.message}`,
    };
  }

  // Compute drift if prior exists.
  let drift = null;
  if (prior && prior.metrics) {
    drift = computeSnapshotDrift(prior, snapshot, DEFAULT_TRIGGERS);
  }

  // Sprint 2.5 R2 fix: roadmap-documented TECH_DEBT_THRESHOLD_EXCEEDED event
  // surfaces via `thresholdExceeded` flag for execute.cjs to journal as a
  // distinct event (advisory, not failure).
  const thresholdExceeded = !!(drift && drift.triggered.length > 0);

  return {
    ok: true,
    touchedFiles: [SNAPSHOT_PATH],
    summary: thresholdExceeded
      ? `tech_debt_audit captured snapshot with ${drift.triggered.length} drift trigger(s) fired`
      : 'tech_debt_audit captured snapshot (baseline or no significant drift)',
    snapshot,
    prior,
    priorCorrupt,
    drift,
    thresholdExceeded,
    knipUsed: knipAvailable,
  };
}

module.exports = {
  runTechDebtAudit,
  parseQltyMetrics,
  parseQltySmells,
  parseKnipReport,
  fallbackTestSourceRatio,
  SNAPSHOT_PATH,
  SNAPSHOT_VERSION,
};
