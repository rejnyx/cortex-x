// run-detector.cjs — invoke a cortex-x detector against a fixture path.
//
// Spawns the detector as a child process via `node detectors/<name>.cjs --cwd
// <fixturePath> --json`. Returns parsed JSON output. Detectors are CLI-first,
// so this tests the same surface end users hit.
//
// Why spawn instead of require()? The detector resolves $CORTEX_HOME / homedir
// paths internally; spawning lets us pass an isolated CWD without hijacking
// process.cwd() (which would race other parallel tests).

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DETECTORS_DIR = path.join(REPO_ROOT, 'detectors');

function runDetector(name, fixturePath, extraArgs = []) {
  const detectorPath = path.join(DETECTORS_DIR, `detect-${name}.cjs`);
  const result = spawnSync(
    process.execPath,
    [detectorPath, '--cwd', fixturePath, '--json', ...extraArgs],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        // Force detector to use the in-repo profiles, not whatever is in
        // ~/.claude/shared/profiles (which may be stale or absent in CI).
        CORTEX_HOME: REPO_ROOT,
      },
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `Detector ${name} exited ${result.status} for fixture ${fixturePath}\n` +
      `stderr:\n${result.stderr}\nstdout:\n${result.stdout}`
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (e) {
    throw new Error(
      `Detector ${name} stdout was not valid JSON for fixture ${fixturePath}\n` +
      `error: ${e.message}\nstdout:\n${result.stdout}`
    );
  }
}

module.exports = {
  runDetector,
  REPO_ROOT,
  DETECTORS_DIR,
};
