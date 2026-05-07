#!/usr/bin/env node
// dep-update-patch.cjs — Sprint 1.8.4 patch-only dependency update detector.
//
// Runs `npm outdated --json`, filters to patch-level diffs only (semver patch
// component bumped, major + minor unchanged), returns the safe-to-update list.
// Patch updates are bug fixes by convention — Renovate, Dependabot, and every
// modern auto-update tool treats them as auto-mergeable when tests pass.
//
// Used by Hermes when action_kind === 'dep_update_patch'. Deterministic — no
// LLM call. Happy path: detect → npm install patches → npm test → commit + PR.
// Failure path: tests rejected → rollback + lesson recorded for next run.
//
// CLI:
//   node detectors/dep-update-patch.cjs              # human report
//   node detectors/dep-update-patch.cjs --json       # machine output
//   node detectors/dep-update-patch.cjs --max=5      # cap candidates
//
// Output (JSON):
//   {
//     candidates: [{ package, current, wanted, latest, type: "patch" }, ...],
//     total_outdated: <int>,
//     skipped_minor: <int>,
//     skipped_major: <int>,
//     gh_available: bool,
//     npm_available: bool,
//   }

'use strict';

const { execSync } = require('child_process');

const SIGNAL_TIMEOUT_MS = 30_000; // npm outdated can be slow on large lockfiles
const DEFAULT_MAX_CANDIDATES = 5;

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || SIGNAL_TIMEOUT_MS,
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (err) {
    // npm outdated exits 1 when there ARE outdated packages — that's normal,
    // not an error. Capture stdout from the err object.
    if (err && err.stdout != null) {
      return Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8').trim() : String(err.stdout).trim();
    }
    return null;
  }
}

function npmAvailable() {
  return !!safeExec('npm --version', { timeout: 2000 });
}

// Parse a semver string into [major, minor, patch]. Returns null if not parseable.
// Strips leading ^ ~ etc. Tolerates pre-release suffixes (drops them — patch
// updates inside a pre-release range are still semver-patch).
function parseSemver(s) {
  if (!s || typeof s !== 'string') return null;
  const cleaned = s.replace(/^[\^~>=<v]+/, '').split(/[-+]/)[0];
  const parts = cleaned.split('.');
  if (parts.length < 3) return null;
  const nums = parts.slice(0, 3).map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return nums;
}

// Classify a current → wanted bump:
//   "patch"  major.minor unchanged, patch bumped
//   "minor"  major unchanged, minor bumped
//   "major"  major bumped
//   "none"   identical OR downgrade (rare; treat as no-op)
function classifyBump(current, wanted) {
  const c = parseSemver(current);
  const w = parseSemver(wanted);
  if (!c || !w) return 'unknown';
  if (c[0] !== w[0]) return 'major';
  if (c[1] !== w[1]) return 'minor';
  if (c[2] !== w[2]) return 'patch';
  return 'none';
}

// Run `npm outdated --json` in repoRoot, parse output, classify bumps.
// Returns { candidates: [], total_outdated, skipped_minor, skipped_major, ... }.
// Fail-open: missing npm / no outdated → empty candidates.
function detectPatchUpdates({ cwd, mockOutdatedJson, maxCandidates } = {}) {
  const repoRoot = cwd || process.cwd();
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;

  let outdatedJson;
  if (mockOutdatedJson != null) {
    outdatedJson = mockOutdatedJson;
  } else if (npmAvailable()) {
    outdatedJson = safeExec('npm outdated --json', { cwd: repoRoot });
  } else {
    return {
      candidates: [],
      total_outdated: 0,
      skipped_minor: 0,
      skipped_major: 0,
      npm_available: false,
    };
  }

  if (!outdatedJson) {
    return {
      candidates: [],
      total_outdated: 0,
      skipped_minor: 0,
      skipped_major: 0,
      npm_available: true,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(outdatedJson);
  } catch {
    return {
      candidates: [],
      total_outdated: 0,
      skipped_minor: 0,
      skipped_major: 0,
      npm_available: true,
      parse_error: true,
    };
  }

  // npm outdated --json output shape:
  //   { "package-name": { current, wanted, latest, dependent, location, ... } }
  let totalOutdated = 0;
  let skippedMinor = 0;
  let skippedMajor = 0;
  const candidates = [];

  for (const [pkg, info] of Object.entries(parsed || {})) {
    if (!info || !info.current || !info.wanted) continue;
    totalOutdated += 1;

    const bumpType = classifyBump(info.current, info.wanted);
    if (bumpType === 'patch') {
      candidates.push({
        package: pkg,
        current: info.current,
        wanted: info.wanted,
        latest: info.latest || info.wanted,
        type: 'patch',
      });
    } else if (bumpType === 'minor') {
      skippedMinor += 1;
    } else if (bumpType === 'major') {
      skippedMajor += 1;
    }
    // 'none' / 'unknown' silently dropped
  }

  // Sort by package name for deterministic output (alphabetical)
  candidates.sort((a, b) => a.package.localeCompare(b.package));

  return {
    candidates: candidates.slice(0, max),
    total_outdated: totalOutdated,
    skipped_minor: skippedMinor,
    skipped_major: skippedMajor,
    total_patch_available: candidates.length,
    npm_available: true,
  };
}

// Format candidates as a human-readable summary line for commit messages.
function formatCandidatesForCommit(candidates) {
  if (!candidates || candidates.length === 0) return '';
  const parts = candidates.map((c) => `${c.package} ${c.current}→${c.wanted}`);
  return parts.join(', ');
}

// Build the npm install command for the patch-only candidates.
// Pinned to exactly the wanted version: `pkg@<wanted>`.
function buildInstallArgs(candidates) {
  if (!candidates || candidates.length === 0) return [];
  return ['install', '--save', ...candidates.map((c) => `${c.package}@${c.wanted}`)];
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const maxN = maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES;

  const result = detectPatchUpdates({ maxCandidates: maxN });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`Patch-update report:\n`);
    process.stdout.write(`  npm available:        ${result.npm_available ? 'yes' : 'no'}\n`);
    process.stdout.write(`  total outdated:       ${result.total_outdated}\n`);
    process.stdout.write(`  patch candidates:     ${result.candidates.length}\n`);
    process.stdout.write(`  skipped (minor):      ${result.skipped_minor}\n`);
    process.stdout.write(`  skipped (major):      ${result.skipped_major}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nCandidates:\n');
      for (const c of result.candidates) {
        process.stdout.write(`  ${c.package.padEnd(40)} ${c.current} → ${c.wanted}  (latest ${c.latest})\n`);
      }
    }
  }
}

module.exports = {
  detectPatchUpdates,
  parseSemver,
  classifyBump,
  formatCandidatesForCommit,
  buildInstallArgs,
};
