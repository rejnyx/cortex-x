// resolve-cortex-home.cjs — single source of truth for the
// $CORTEX_DATA_HOME resolution chain.
//
// Used by:
//   shared/hooks/session-start.cjs  (runtime hook)
//   bin/cortex-gap-report.cjs       (CLI aggregator)
//   tests/smoke/verify-install.cjs  (post-install verifier)
//   tools/verify-audit-output.cjs   (audit output validator)
//
// Precedence:
//   1. process.env.CORTEX_DATA_HOME (explicit override)
//   2. cortex_data_home: line in ~/.claude/shared/cortex-source.yaml
//   3. ~/.cortex (Sprint 1.6 sane default)
//
// All three target the SAME location at $CORTEX_DATA_HOME/{projects,research,
// insights,journal,evals}/. Legacy ~/cortex-x/projects/ paths are NOT a
// resolution target — `cortex-migrate-data.{sh,ps1}` moves them to ~/.cortex/
// during install (Sprint 1.6 migration).
//
// Contract:
//   - Read-only (never mutates fs)
//   - No network, no process spawn
//   - Fail-open: invalid YAML → fall through to default, never throw
//   - Returns absolute path string with platform-native separators

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Strip UTF-8 BOM (EF BB BF) if present at file start. install.ps1 in
// older versions (or any tool that writes via PS 5.1 `Set-Content -Encoding
// UTF8`) emits a BOM, which makes the regex `^cortex_source:` fail because
// the first line technically starts with 3 BOM bytes, not the 'c' character.
// All YAML reads in this resolver MUST go through this helper.
function readYamlBomSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function resolveCortexDataHome() {
  if (process.env.CORTEX_DATA_HOME) {
    return path.normalize(process.env.CORTEX_DATA_HOME);
  }
  try {
    const yaml = readYamlBomSafe(
      path.join(os.homedir(), '.claude', 'shared', 'cortex-source.yaml')
    );
    const m = yaml.match(/^cortex_data_home:\s*(.+)$/m);
    if (m) {
      return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
    }
  } catch {
    // cortex-source.yaml missing or unreadable — fall through
  }
  return path.join(os.homedir(), '.cortex');
}

function resolveCortexAssetsRoot() {
  if (process.env.CORTEX_ASSETS_ROOT) {
    return path.normalize(process.env.CORTEX_ASSETS_ROOT);
  }
  try {
    const yaml = readYamlBomSafe(
      path.join(os.homedir(), '.claude', 'shared', 'cortex-source.yaml')
    );
    const m = yaml.match(/^cortex_assets_root:\s*(.+)$/m);
    if (m) {
      return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
    }
  } catch { /* fall through */ }
  return path.join(os.homedir(), '.claude', 'shared');
}

module.exports = {
  resolveCortexDataHome,
  resolveCortexAssetsRoot,
};

// CLI mode: print resolved paths for debugging / shell use
if (require.main === module) {
  const dataHome = resolveCortexDataHome();
  const assetsRoot = resolveCortexAssetsRoot();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      cortex_data_home: dataHome,
      cortex_assets_root: assetsRoot,
    }, null, 2));
  } else {
    console.log(`CORTEX_DATA_HOME=${dataHome}`);
    console.log(`CORTEX_ASSETS_ROOT=${assetsRoot}`);
  }
}
