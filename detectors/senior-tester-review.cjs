// detectors/senior-tester-review.cjs — Sprint 2.11 pre-flight probe.
//
// Fast probe (<100ms) to confirm whether senior_tester_review can do useful
// work in the current repo. Returns one of:
//   - 'ready' — at least one test file under recognized roots
//   - 'no-test-files' — nothing to scan; dispatcher writes no_actionable_step
//   - 'opted-out' — operator disabled audit via .cortex/senior-tester-disabled
//
// No filesystem walk in the detector — that's the executor's Phase A. We
// only check that one of the canonical test roots exists + has at least
// one descendant matching the test-file pattern. Cheap shallow scan.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'specs'];
const TEST_FILE_REGEX = /\.(test|spec)\.(c?js|m?js|tsx?)$/;
const SHALLOW_DEPTH = 3; // probe only top-level + 2 subdirs

function isOptedOut(repoRoot) {
  // Sprint 2.11 R2 (edge-case HIGH): accept either a file OR a directory
  // sentinel — most operator CLI guides say `mkdir -p .cortex && touch
  // sentinel`, but if user accidentally `mkdir .cortex/senior-tester-disabled`
  // (no `touch`) the prior strict isFile() check silently ignored opt-out.
  if (!repoRoot || typeof repoRoot !== 'string') return false;
  try {
    const sentinel = path.join(repoRoot, '.cortex', 'senior-tester-disabled');
    fs.statSync(sentinel); // throws if absent; presence (file OR dir) = opt-out
    return true;
  } catch {
    return false;
  }
}

function shallowProbe(rootDir, depth = 0) {
  if (depth > SHALLOW_DEPTH) return false;
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (entry.isFile() && TEST_FILE_REGEX.test(name)) return true;
    if (entry.isDirectory()) {
      if (shallowProbe(path.join(rootDir, name), depth + 1)) return true;
    }
  }
  return false;
}

function detect(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  if (isOptedOut(repoRoot)) {
    return { status: 'opted-out', reason: '.cortex/senior-tester-disabled sentinel present' };
  }
  for (const dir of TEST_DIRS) {
    const full = path.join(repoRoot, dir);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      if (shallowProbe(full)) {
        return { status: 'ready', root: dir };
      }
    } catch {
      // dir doesn't exist; skip
    }
  }
  return {
    status: 'no-test-files',
    reason: `no test files matching ${TEST_FILE_REGEX} under ${TEST_DIRS.join(', ')}`,
  };
}

module.exports = { detect };
