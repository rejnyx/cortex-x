// SPDX-License-Identifier: Apache-2.0
'use strict';

/**
 * r2-review-roster-drift.test.cjs
 *
 * Sprint 2.44 HIGH-12 mitigation — SSOT drift guard for the 6-agent R2 roster.
 *
 * Background: shared/workflows/r2-review.js can't `require()` the canonical
 * shared/hooks/_lib/review-agents.cjs SSOT because workflow scripts run in an
 * isolated runtime with no filesystem/module access. The roster is therefore
 * duplicated as a verbatim literal in r2-review.js with a comment pointing to
 * the SSOT. This test asserts the two stay aligned — if review-agents.cjs is
 * updated (e.g. a 7th review agent added), r2-review.js will fail this test
 * until the literal is hand-mirrored.
 *
 * Sprint 2.44.1 may extract roster to a shared JSON config that workflow
 * scripts can read via an agent at runtime — once that's in place, this
 * test can be relaxed or removed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SSOT_PATH = path.join(REPO_ROOT, 'shared', 'hooks', '_lib', 'review-agents.cjs');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'shared', 'workflows', 'r2-review.js');

test('REVIEW_AGENTS roster in r2-review.js matches review-agents.cjs SSOT', () => {
  // Load SSOT directly — this is a .cjs module, safe to require.
  const ssot = require(SSOT_PATH);
  assert.ok(Array.isArray(ssot.REVIEW_AGENTS), 'review-agents.cjs must export REVIEW_AGENTS array');
  assert.ok(ssot.REVIEW_AGENTS.length >= 6, 'SSOT must have at least 6 agents');

  // Parse the literal from r2-review.js by regex — the file isn't a CJS module
  // so we can't require() it. The literal is a const declaration with a JS
  // string-array body.
  const workflowSrc = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const match = workflowSrc.match(/const\s+REVIEW_AGENTS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, 'r2-review.js must declare const REVIEW_AGENTS = [...]');

  const literal = [];
  const stringRe = /['"]([a-zA-Z0-9_\-]+)['"]/g;
  let m;
  while ((m = stringRe.exec(match[1])) !== null) {
    literal.push(m[1]);
  }

  // Sort-independent equality — order should match but if it ever diverges
  // intentionally, the assertion message is clearer with both arrays shown.
  const ssotSorted = [...ssot.REVIEW_AGENTS].sort();
  const literalSorted = [...literal].sort();

  assert.deepStrictEqual(
    literalSorted,
    ssotSorted,
    `r2-review.js REVIEW_AGENTS literal drifted from shared/hooks/_lib/review-agents.cjs SSOT.\n` +
      `  SSOT:     ${JSON.stringify(ssotSorted)}\n` +
      `  workflow: ${JSON.stringify(literalSorted)}\n` +
      `Re-sync the literal in r2-review.js, or extract to a shared JSON config (Sprint 2.44.1).`
  );
});
