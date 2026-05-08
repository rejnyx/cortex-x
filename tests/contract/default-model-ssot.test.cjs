'use strict';

/**
 * Contract test — DEFAULT_MODEL SSOT (Sprint pre-2.0 housekeeping).
 *
 * Project audit (2026-05-09) found `deepseek/deepseek-v4-flash` hardcoded in
 * 9 sites. The runtime SSOT is `bin/steward/_lib/action-engine.cjs DEFAULT_MODEL`.
 * The workflow file `.github/workflows/steward.yml` carries an explicit
 * `STEWARD_MODEL:` env override (with legacy `HERMES_MODEL:` alias honored
 * through v0.2.0) that MUST stay in sync with the code SSOT — otherwise the
 * GHA cron silently uses a different model than dev/local runs.
 *
 * This test fails loudly when the two diverge. Doc-narrative references in
 * MIGRATIONS.md / CLAUDE.md / README.md / steward-runtime.md / steward-usage.md
 * are intentionally NOT covered: those describe runtime behaviour at a point
 * in time and are allowed to mention the model by name without binding to
 * the SSOT (Rule of Three — humans read docs once).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_MODEL } = require('../../bin/steward/_lib/action-engine.cjs');

describe('DEFAULT_MODEL SSOT (action-engine.cjs ↔ workflow)', () => {
  test('action-engine.cjs exports a non-empty DEFAULT_MODEL', () => {
    assert.equal(typeof DEFAULT_MODEL, 'string');
    assert.ok(DEFAULT_MODEL.length > 0, 'DEFAULT_MODEL must be non-empty');
    assert.match(DEFAULT_MODEL, /\//, 'DEFAULT_MODEL should be vendor/model shape (e.g. "openrouter/foo")');
  });

  test('.github/workflows/steward.yml STEWARD_MODEL matches DEFAULT_MODEL', () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '.github', 'workflows', 'steward.yml'),
      'utf8',
    );
    // Match `STEWARD_MODEL: <value>` (YAML scalar; allow optional surrounding whitespace).
    // Sprint 4.7: legacy HERMES_MODEL key remains honored at runtime via env.cjs
    // backward-compat layer, but the workflow file SoT uses the canonical name.
    const match = workflow.match(/^\s*STEWARD_MODEL:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
    assert.ok(match, 'workflow must declare STEWARD_MODEL on its own line');
    const workflowModel = match[1].trim();
    assert.equal(
      workflowModel,
      DEFAULT_MODEL,
      `workflow STEWARD_MODEL='${workflowModel}' diverges from action-engine.cjs DEFAULT_MODEL='${DEFAULT_MODEL}' — update both together`,
    );
  });
});
