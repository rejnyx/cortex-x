// Sprint LR.C — regression test for the 2026-05-12 nightly cron failure.
//
// Incident: bin/steward/execute.cjs had six `require('./gh-ops.cjs')` calls
// (correct path: `./_lib/gh-ops.cjs`). Module loads at the top of the file
// resolved correctly; runtime requires inside non-dry-run code paths
// crashed with "Cannot find module './gh-ops.cjs'" during the Steward
// nightly cron run (workflow_runs/25714699025).
//
// Root cause: copy-paste drift across multiple call sites. Tests didn't
// catch it because the non-dry-run gh-push path is mocked / not exercised
// in the test suite.
//
// R3 discipline (one incident class = one defense layer + one regression
// test): every static `require('./...')` call in the Steward runtime
// entrypoints must resolve at parse time. This contract test enumerates
// each `require('./...')` in execute.cjs + dry-run.cjs + status.cjs and
// asserts the resolved path exists on disk.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STEWARD_DIR = path.join(REPO_ROOT, 'bin', 'steward');

// Match every `require('./<path>.cjs')` or `require("./...cjs")` — static
// relative requires only. Dynamic / variable-based requires are skipped
// by intent; this gate catches the copy-paste path-drift class.
const REQUIRE_REGEX = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

const ENTRYPOINTS = [
  'execute.cjs',
  'dry-run.cjs',
  'status.cjs',
];

describe('Sprint LR.C — Steward require() paths resolve (regression for 2026-05-12 nightly crash)', () => {
  for (const entry of ENTRYPOINTS) {
    test(`bin/steward/${entry} — every static relative require() resolves`, () => {
      const filePath = path.join(STEWARD_DIR, entry);
      assert.ok(fs.existsSync(filePath), `entrypoint missing: ${filePath}`);
      const src = fs.readFileSync(filePath, 'utf8');
      const requires = [...src.matchAll(REQUIRE_REGEX)].map((m) => m[1]);
      assert.ok(requires.length > 0, `${entry}: expected ≥1 relative require()`);

      const failures = [];
      for (const rel of requires) {
        // Resolve relative to the entrypoint's directory.
        const resolved = path.resolve(STEWARD_DIR, rel);
        // Accept either exact path or with .cjs / .js extension already present.
        const candidates = [resolved];
        if (!/\.(cjs|js|json)$/.test(resolved)) {
          candidates.push(resolved + '.cjs', resolved + '.js', resolved + '.json');
        }
        const exists = candidates.some((p) => fs.existsSync(p));
        if (!exists) failures.push({ rel, resolved });
      }

      if (failures.length > 0) {
        const detail = failures.map((f) => `  require('${f.rel}') → ${f.resolved} (NOT FOUND)`).join('\n');
        assert.fail(`${entry}: ${failures.length} unresolved require(s):\n${detail}`);
      }
    });
  }

  test('execute.cjs gh-ops require uses ./_lib/ path (2026-05-12 incident pin)', () => {
    // Specific regression pin: the original incident was require('./gh-ops.cjs')
    // (missing _lib/). Hard-code the assertion so the exact prior bug can't
    // regress silently.
    const src = fs.readFileSync(path.join(STEWARD_DIR, 'execute.cjs'), 'utf8');
    const badPattern = /require\(\s*['"]\.\/gh-ops\.cjs['"]\s*\)/;
    assert.ok(
      !badPattern.test(src),
      "execute.cjs contains require('./gh-ops.cjs') — must be require('./_lib/gh-ops.cjs')"
    );
  });
});
