#!/usr/bin/env node
// run-hermes-evals.cjs — Sprint 1.6.22 (T1) CLI runner for Hermes eval cases.
//
// Invokes the same loader logic as tests/integration/hermes-evals.test.cjs
// but produces a human-readable report (plus optional --json for CI) instead
// of relying on the node --test runner.
//
// Usage:
//   node tools/run-hermes-evals.cjs            # human report
//   node tools/run-hermes-evals.cjs --json     # JSON for CI / scripting
//   node tools/run-hermes-evals.cjs --filter=denylist   # substring filter

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const execute = require('../bin/hermes/execute.cjs');
const journal = require('../bin/hermes/_lib/journal.cjs');

const SLUG = 'hermes-dryrun';
const CASES_DIR = path.join(__dirname, '..', 'evals', 'hermes', 'cases');

function arg(name) {
  for (const a of process.argv.slice(2)) {
    if (a === `--${name}`) return true;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return null;
}

function loadCases(filter) {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !filter || f.includes(filter))
    .sort()
    .map((f) => {
      const json = JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8'));
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
  if (plan_overrides.action) base.action = { ...base.action, ...plan_overrides.action };
  return base;
}

async function runCase(c) {
  const repoRoot = tmpEvalRepo(c.name);
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), `eval-data-${c.name}-`));
  const planFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eval-plan-')), 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(buildEvalPlan(c.plan_overrides || {})));

  const prev = {
    CORTEX_DATA_HOME: process.env.CORTEX_DATA_HOME,
    HERMES_ENGINE: process.env.HERMES_ENGINE,
    HERMES_MOCK_PLAN: process.env.HERMES_MOCK_PLAN,
    HERMES_NO_PUSH: process.env.HERMES_NO_PUSH,
  };
  process.env.CORTEX_DATA_HOME = dataHome;
  process.env.HERMES_ENGINE = 'mock';
  process.env.HERMES_MOCK_PLAN = JSON.stringify(c.mock_plan);
  process.env.HERMES_NO_PUSH = '1';

  let result;
  const failures = [];
  const a = c.assertions || {};
  try {
    result = await execute.runExecute({ planFile, repoRoot });

    // Run assertions WHILE env is still set — readJournal reads
    // CORTEX_DATA_HOME from process.env, and the finally clause restores it.
    if (typeof a.result_ok === 'boolean' && result.ok !== a.result_ok) {
      failures.push(`result.ok expected ${a.result_ok}, got ${result.ok}`);
    }
    if (a.result_code !== undefined && a.result_code !== null && result.code !== a.result_code) {
      failures.push(`result.code expected '${a.result_code}', got '${result.code}'`);
    }
    if (Array.isArray(a.touched_files)) {
      const actual = (result.touched_files || []).slice().sort();
      const expected = a.touched_files.slice().sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`touched_files expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
    if (a.journal_event) {
      const entries = journal.readJournal(SLUG);
      const found = entries.find((e) => e.event === a.journal_event);
      if (!found) failures.push(`journal event '${a.journal_event}' not found`);
      else {
        if (a.journal_outcome && found.outcome !== a.journal_outcome) {
          failures.push(`journal outcome expected '${a.journal_outcome}', got '${found.outcome}'`);
        }
        if (a.cost_captured === true && typeof found.cost_usd !== 'number') {
          failures.push(`cost_usd should be captured but is ${typeof found.cost_usd}`);
        }
      }
    }
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }

  return { name: c.name, passed: failures.length === 0, failures, result };
}

async function main() {
  const wantJson = arg('json');
  const filter = arg('filter');
  const cases = loadCases(typeof filter === 'string' ? filter : null);

  if (cases.length === 0) {
    process.stderr.write('No eval cases found.\n');
    process.exit(1);
  }

  if (!wantJson) {
    process.stdout.write(`Running ${cases.length} Hermes eval case(s)...\n\n`);
  }

  const results = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    if (!wantJson) {
      const tag = r.passed ? '✓ PASS' : '✗ FAIL';
      process.stdout.write(`${tag}  ${c.name}\n`);
      if (!r.passed) {
        for (const f of r.failures) process.stdout.write(`         - ${f}\n`);
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  if (wantJson) {
    process.stdout.write(JSON.stringify({ ok: passed === total, passed, total, results }, null, 2) + '\n');
  } else {
    process.stdout.write(`\n${passed}/${total} eval cases passed`);
    if (passed === total) process.stdout.write(' ✓\n');
    else process.stdout.write(` ✗ — ${total - passed} failure(s)\n`);
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`run-hermes-evals crashed: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
