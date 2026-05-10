// detectors/workflow-hardener.cjs — Sprint 2.5b pre-flight probe.
//
// Cheap (<100ms) check whether `.github/workflows/` exists with at least
// one .yml file. Returns:
//   - 'ready' — at least one workflow file
//   - 'no-workflows' — no .yml under .github/workflows/
//   - 'opted-out' — operator disabled via .cortex/workflow-hardener-disabled

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isOptedOut(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') return false;
  try {
    fs.statSync(path.join(repoRoot, '.cortex', 'workflow-hardener-disabled'));
    return true;
  } catch {
    return false;
  }
}

function detect(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  if (isOptedOut(repoRoot)) {
    return { status: 'opted-out', reason: '.cortex/workflow-hardener-disabled sentinel present' };
  }
  const dir = path.join(repoRoot, '.github', 'workflows');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return {
      status: 'no-workflows',
      reason: '.github/workflows/ does not exist',
    };
  }
  for (const e of entries) {
    if (e.isFile() && /\.ya?ml$/i.test(e.name)) {
      return { status: 'ready', count: entries.length };
    }
  }
  return {
    status: 'no-workflows',
    reason: '.github/workflows/ exists but contains no .yml files',
  };
}

module.exports = { detect };
