// halt-check.cjs — file-based kill-switch detection (MUST-H5).
//
// Steward checks two sentinel paths at every tool-call boundary. Presence of
// either = immediate clean shutdown, journal entry, exit 75 (EX_TEMPFAIL).
//
//   ~/.cortex/STEWARD_HALT          fleet-wide halt (every project)
//   <repo>/.cortex/STEWARD_HALT     per-project halt
//
// Sprint 4.7 rebrand backward-compat: `HERMES_HALT` (legacy filename pre-rebrand)
// is also honored so existing operator setups keep halting through v0.2.0. New
// halts are written as `STEWARD_HALT` (see execute.cjs loop detector).
//
// Steward itself MUST NOT be able to remove either file. block-destructive.cjs
// denylist (Ring 2) extended to forbid `rm`/`unlink`/`Remove-Item` of these
// paths. Removal is human-only — typically `rm ~/.cortex/STEWARD_HALT` after
// the human resolves whatever caused the halt.
//
// Contract:
//   - Read-only (never creates, modifies, or deletes the sentinel)
//   - No network, no process spawn
//   - Returns within ~5ms (single fs.existsSync call per path)
//   - CLI mode: exit 75 if halted, exit 0 if not, prints reason to stderr
//
// Used by:
//   bin/steward/dry-run.cjs       (called at every iteration boundary)
//   bin/steward/execute.cjs       (called at every tool-call boundary)
//   tests/unit/steward/halt-check.test.cjs

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveCortexDataHome } = require('../../../tools/lib/resolve-cortex-home.cjs');

const SENTINEL_FILENAME = 'STEWARD_HALT';
// Legacy pre-Sprint-4.7 filename. Removed in v0.2.0; honored through this
// release so operators with old halts in place keep halting.
const LEGACY_SENTINEL_FILENAME = 'HERMES_HALT';
const EX_TEMPFAIL = 75;

function fleetSentinelPath() {
  return path.join(resolveCortexDataHome(), SENTINEL_FILENAME);
}

function projectSentinelPath(repoRoot) {
  return path.join(repoRoot, '.cortex', SENTINEL_FILENAME);
}

function fleetLegacySentinelPath() {
  return path.join(resolveCortexDataHome(), LEGACY_SENTINEL_FILENAME);
}

function projectLegacySentinelPath(repoRoot) {
  return path.join(repoRoot, '.cortex', LEGACY_SENTINEL_FILENAME);
}

// Returns { halted: boolean, reason?: string, sentinelPath?: string, legacy?: boolean }.
// Fleet sentinel checked first (fleet-wide halt is more severe). New filename
// (`STEWARD_HALT`) checked before legacy (`HERMES_HALT`) so the operator's
// freshest decision wins on machines that have both during migration.
function isHalted(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();

  const fleetPath = fleetSentinelPath();
  if (fs.existsSync(fleetPath)) {
    return {
      halted: true,
      reason: 'fleet_sentinel_present',
      sentinelPath: fleetPath,
    };
  }
  const fleetLegacy = fleetLegacySentinelPath();
  if (fs.existsSync(fleetLegacy)) {
    return {
      halted: true,
      reason: 'fleet_sentinel_present',
      sentinelPath: fleetLegacy,
      legacy: true,
    };
  }

  const projectPath = projectSentinelPath(repoRoot);
  if (fs.existsSync(projectPath)) {
    return {
      halted: true,
      reason: 'project_sentinel_present',
      sentinelPath: projectPath,
    };
  }
  const projectLegacy = projectLegacySentinelPath(repoRoot);
  if (fs.existsSync(projectLegacy)) {
    return {
      halted: true,
      reason: 'project_sentinel_present',
      sentinelPath: projectLegacy,
      legacy: true,
    };
  }

  return { halted: false };
}

module.exports = {
  isHalted,
  fleetSentinelPath,
  projectSentinelPath,
  fleetLegacySentinelPath,
  projectLegacySentinelPath,
  SENTINEL_FILENAME,
  LEGACY_SENTINEL_FILENAME,
  EX_TEMPFAIL,
};

// CLI: steward-halt-check [--json] [--repo-root <path>]
if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const repoRootIdx = args.indexOf('--repo-root');
  const repoRoot = repoRootIdx >= 0 ? args[repoRootIdx + 1] : process.cwd();

  const result = isHalted({ repoRoot });

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.halted) {
    process.stderr.write(`HALTED: ${result.reason} (${result.sentinelPath})\n`);
  }

  process.exit(result.halted ? EX_TEMPFAIL : 0);
}
