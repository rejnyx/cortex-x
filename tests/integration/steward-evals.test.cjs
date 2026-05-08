// hermes-evals.test.cjs — Sprint 1.6.22 (T1) eval-suite loader.
//
// Discovers JSON eval cases under `evals/steward/cases/` and runs each as a
// node:test test(). Each case feeds a hand-crafted "model output" via
// HERMES_MOCK_PLAN and asserts pipeline behavior (result.code, touched files,
// journal entry, cost capture).
//
// See evals/steward/README.md for case schema.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const execute = require('../../bin/steward/execute.cjs');
const journal = require('../../bin/steward/_lib/journal.cjs');

const SLUG = 'steward-dryrun';
const CASES_DIR = path.join(__dirname, '..', '..', 'evals', 'hermes', 'cases');

function loadCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const full = path.join(CASES_DIR, f);
      const json = JSON.parse(fs.readFileSync(full, 'utf8'));
      json._file = f;
      return json;
    });
}

function tmpEvalRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hermes-eval-${prefix}-`));
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'eval@test.local'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Eval'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'eval-fixture',
    version: '0.0.0',
    scripts: { test: 'node -e "console.log(\'ok\')"' },
  }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Project\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'placeholder.js'), '// placeholder');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

function buildEvalPlan(plan_overrides = {}) {
  const base = {
    ok: true,
    mode: 'dry-run',
    slug: SLUG,
    action: { num: 1, title: 'eval action', action_key: `${SLUG}#week-1` },
    branch: 'hermes/eval-fixture-branch',
    action_id: '01EVALCASE',
    trigger: 'manual',
    commit_message: 'feat(eval): demo\n\nBody\n\nHermes-Action-Id: 01EVALCASE\nHermes-Journal-Entry: ~/.cortex/journal/x.jsonl\nHermes-Trigger: manual\nHermes-Recommendation-Source: cortex/recommendations.md#1',
  };
  if (plan_overrides.action) {
    base.action = { ...base.action, ...plan_overrides.action };
  }
  return base;
}

async function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

// --- runner ---------------------------------------------------------------

const cases = loadCases();

describe(`hermes evals: ${cases.length} cases discovered`, () => {
  for (const c of cases) {
    test(`[${c.name}] ${c.description}`, async () => {
      const repoRoot = tmpEvalRepo(c.name);
      const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), `eval-data-${c.name}-`));

      // Write plan to tmpfile
      const planFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-plan-')), 'plan.json');
      fs.writeFileSync(planFile, JSON.stringify(buildEvalPlan(c.plan_overrides || {})));

      await withEnv({
        CORTEX_DATA_HOME: dataHome,
        HERMES_ENGINE: 'mock',
        HERMES_MOCK_PLAN: JSON.stringify(c.mock_plan),
        HERMES_NO_PUSH: '1',  // never push during evals
      }, async () => {
        const result = await execute.runExecute({ planFile, repoRoot });

        // Assertions
        const a = c.assertions || {};

        if (typeof a.result_ok === 'boolean') {
          assert.equal(result.ok, a.result_ok, `[${c.name}] result.ok mismatch: ${JSON.stringify(result)}`);
        }
        if (a.result_code !== undefined && a.result_code !== null) {
          assert.equal(result.code, a.result_code, `[${c.name}] result.code mismatch`);
        }
        if (Array.isArray(a.touched_files)) {
          const actual = result.touched_files || [];
          assert.deepEqual(actual.sort(), a.touched_files.slice().sort(),
            `[${c.name}] touched_files mismatch`);
        }

        // Journal assertions
        if (a.journal_event) {
          const entries = journal.readJournal(SLUG);
          const found = entries.find((e) => e.event === a.journal_event);
          assert.ok(found, `[${c.name}] expected journal event '${a.journal_event}' not found`);
          if (a.journal_outcome) {
            assert.equal(found.outcome, a.journal_outcome, `[${c.name}] journal outcome mismatch`);
          }
          if (a.cost_captured === true) {
            assert.equal(typeof found.cost_usd, 'number',
              `[${c.name}] cost_usd should be captured but is ${typeof found.cost_usd}`);
          }
        }

        // Forbidden-paths invariant: assert these were NOT touched
        if (Array.isArray(a.forbidden_paths)) {
          for (const fp of a.forbidden_paths) {
            const fpFull = path.join(repoRoot, fp);
            // Either file shouldn't exist or shouldn't have been modified by this run
            // (we created clean fixture so any presence of these = fail)
            const placeholder = !fs.existsSync(fpFull);
            assert.ok(placeholder, `[${c.name}] forbidden path '${fp}' was touched`);
          }
        }
      });
    });
  }
});
