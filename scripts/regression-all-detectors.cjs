#!/usr/bin/env node
// Comprehensive regression test — runs both detectors against a maintainer-
// configured list of real projects on disk.
//
// Target list is sourced from (in priority order):
//   1. $CORTEX_REGRESSION_TARGETS  — JSON env var (CI / scripts)
//   2. scripts/regression-targets.local.json  — gitignored, maintainer-owned
//   3. scripts/regression-targets.example.json  — committed scaffold, edit yours
//
// Each target is { name: string, dir: string } where `dir` may contain
// `${HOME}` (resolves to os.homedir()) for portability.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detect: detectProfile } = require(path.join(os.homedir(), '.claude', 'shared', 'detectors', 'detect-profile.cjs'));
const { detect: detectStage } = require(path.join(os.homedir(), '.claude', 'shared', 'detectors', 'detect-stage.cjs'));

const SCRIPT_DIR = __dirname;
const LOCAL_TARGETS = path.join(SCRIPT_DIR, 'regression-targets.local.json');
const EXAMPLE_TARGETS = path.join(SCRIPT_DIR, 'regression-targets.example.json');

function loadTargets() {
  if (process.env.CORTEX_REGRESSION_TARGETS) {
    try {
      return JSON.parse(process.env.CORTEX_REGRESSION_TARGETS);
    } catch (err) {
      console.error(`ERROR: CORTEX_REGRESSION_TARGETS is not valid JSON: ${err.message}`);
      process.exit(2);
    }
  }
  const file = fs.existsSync(LOCAL_TARGETS) ? LOCAL_TARGETS : EXAMPLE_TARGETS;
  if (!fs.existsSync(file)) {
    console.error(`ERROR: no regression-targets config found.`);
    console.error(`  Expected one of:`);
    console.error(`    ${LOCAL_TARGETS} (gitignored, maintainer-owned)`);
    console.error(`    ${EXAMPLE_TARGETS} (committed scaffold)`);
    console.error(`  Or set $CORTEX_REGRESSION_TARGETS to a JSON array.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveDir(dir) {
  return dir.replace(/\$\{HOME\}|\$HOME/g, os.homedir());
}

const targets = loadTargets();

for (const t of targets) {
  const name = t.name || t.dir;
  const dir = resolveDir(t.dir);
  console.log(`\n=== ${name} ===`);
  console.log(`  path:       ${dir}`);
  const pr = detectProfile(dir);
  const st = detectStage(dir);
  const top = pr.top;
  if (top) {
    console.log(`  profile:    ${top.name.padEnd(20)} ${top.score.toFixed(2)} [${top.confidence}]`);
    if (top.matched.length > 0) console.log(`  matched:    ${top.matched.join('; ')}`);
  } else {
    console.log(`  profile:    none`);
  }
  if (pr.monorepo) console.log(`  monorepo:   ${pr.monorepo} (${pr.workspaceCount} sub-packages)`);
  if (pr.language) {
    const L = pr.language;
    console.log(`  language:   js_primary=${L.is_js_primary} mixed=${L.is_mixed_stack} non_js=${L.non_js_languages.join(',') || '-'}`);
  }
  console.log(`  stage:      ${st.stage} (confidence ${(st.confidence || 0).toFixed(2)})`);
  console.log(`  evidence:   ${(st.evidence || []).join(', ')}`);
  if (st.error) console.log(`  error:      ${st.error}`);
}
