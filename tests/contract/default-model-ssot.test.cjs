'use strict';

/**
 * Contract test — DEFAULT_MODEL SSOT (Sprint pre-2.0 housekeeping).
 *
 * Project audit (2026-05-09) found `deepseek/deepseek-v4-flash` hardcoded in
 * 9 sites. The runtime SSOT is `bin/hermes/_lib/action-engine.cjs DEFAULT_MODEL`.
 * The workflow file `.github/workflows/hermes.yml` carries an explicit
 * `HERMES_MODEL:` env override that MUST stay in sync with the code SSOT —
 * otherwise the GHA cron silently uses a different model than dev/local runs.
 *
 * This test fails loudly when the two diverge. Doc-narrative references in
 * MIGRATIONS.md / CLAUDE.md / README.md / hermes-runtime.md / hermes-usage.md
 * are intentionally NOT covered: those describe runtime behaviour at a point
 * in time and are allowed to mention the model by name without binding to
 * the SSOT (Rule of Three — humans read docs once).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_MODEL } = require('../../bin/hermes/_lib/action-engine.cjs');

describe('DEFAULT_MODEL SSOT (action-engine.cjs ↔ workflow)', () => {
  test('action-engine.cjs exports a non-empty DEFAULT_MODEL', () => {
    assert.equal(typeof DEFAULT_MODEL, 'string');
    assert.ok(DEFAULT_MODEL.length > 0, 'DEFAULT_MODEL must be non-empty');
    assert.match(DEFAULT_MODEL, /\//, 'DEFAULT_MODEL should be vendor/model shape (e.g. "openrouter/foo")');
  });

  test('.github/workflows/hermes.yml HERMES_MODEL matches DEFAULT_MODEL', () => {
    const workflow = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '.github', 'workflows', 'hermes.yml'),
      'utf8',
    );
    // Match `HERMES_MODEL: <value>` (YAML scalar; allow optional surrounding whitespace).
    const match = workflow.match(/^\s*HERMES_MODEL:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
    assert.ok(match, 'workflow must declare HERMES_MODEL on its own line');
    const workflowModel = match[1].trim();
    assert.equal(
      workflowModel,
      DEFAULT_MODEL,
      `workflow HERMES_MODEL='${workflowModel}' diverges from action-engine.cjs DEFAULT_MODEL='${DEFAULT_MODEL}' — update both together`,
    );
  });
});
