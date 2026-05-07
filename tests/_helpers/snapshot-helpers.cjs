// snapshot-helpers.cjs — manual JSON snapshot pattern.
//
// Why manual instead of node --test's built-in t.assert.snapshot()?
// Because t.assert.snapshot() is stable only in Node 23.4+, and cortex-x's
// engines floor is Node 22 LTS (Active until October 2026). Manual JSON
// commit + assert.deepStrictEqual works on every Node version we target.
//
// Usage in a test:
//   const { assertMatchesSnapshot } = require('../_helpers/snapshot-helpers.cjs');
//
//   test('detect profile against nextjs-saas-mini', () => {
//     const result = detect('tests/fixtures/nextjs-saas-mini');
//     assertMatchesSnapshot('detect-profile/nextjs-saas-mini', result);
//   });
//
// Snapshots live in tests/snapshots/<name>.json (slashes in name → subdirs).
// Update mode: CORTEX_TEST_UPDATE_SNAPSHOTS=1 npm test  (or test:update-snapshots)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const SNAPSHOT_ROOT = path.join(__dirname, '..', 'snapshots');
const UPDATE_MODE = process.env.CORTEX_TEST_UPDATE_SNAPSHOTS === '1';

function snapshotPath(name) {
  return path.join(SNAPSHOT_ROOT, `${name}.json`);
}

function loadSnapshot(name) {
  const p = snapshotPath(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeSnapshot(name, value) {
  const p = snapshotPath(name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function assertMatchesSnapshot(name, actual) {
  if (UPDATE_MODE) {
    writeSnapshot(name, actual);
    return;
  }
  const expected = loadSnapshot(name);
  if (expected === null) {
    throw new Error(
      `Snapshot ${name} does not exist. Run with CORTEX_TEST_UPDATE_SNAPSHOTS=1 to create it ` +
      `(or 'npm run test:update-snapshots'), then review the diff before committing.`
    );
  }
  assert.deepStrictEqual(actual, expected, `Snapshot mismatch for ${name}`);
}

module.exports = {
  assertMatchesSnapshot,
  loadSnapshot,
  writeSnapshot,
  snapshotPath,
  UPDATE_MODE,
};
