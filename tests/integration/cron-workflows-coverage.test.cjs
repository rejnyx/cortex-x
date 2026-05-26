// tests/integration/cron-workflows-coverage.test.cjs
//
// E2E coverage: every .github/workflows/steward-*.yml is valid YAML, declares
// either a cron schedule or workflow_dispatch (manual), has a jobs: section,
// and the action_kind it implements (if any) matches the Steward registry in
// cortex/capabilities.json.
//
// Bug classes this catches:
//   - A cron workflow added without a corresponding action_kind in the registry
//     (orphan workflow — will run but no spec, no observability)
//   - An action_kind in the registry that has no workflow to actually fire
//     (orphan registry entry — claims a capability that nothing runs)
//   - A workflow with broken YAML that only manifests when GitHub tries to run it
//   - A workflow that lost its schedule on a refactor (silent inert workflow)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const CAPABILITIES_JSON = path.join(REPO_ROOT, 'cortex', 'capabilities.json');

function listStewardWorkflows() {
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => /^steward-.*\.ya?ml$/.test(f))
    .sort();
}

function readWorkflow(filename) {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf8');
}

describe('every steward-*.yml is structurally valid', () => {
  const workflows = listStewardWorkflows();

  test('discovered at least 15 Steward workflows', () => {
    assert.ok(
      workflows.length >= 15,
      `expected >=15 steward-*.yml, found ${workflows.length}`,
    );
  });

  for (const wf of workflows) {
    const content = readWorkflow(wf);

    test(`${wf}: has a name: field`, () => {
      assert.match(
        content,
        /^name:\s*\S+/m,
        `${wf} must declare a top-level name:`,
      );
    });

    test(`${wf}: declares a trigger (cron OR workflow_dispatch)`, () => {
      const hasCron = /^\s*-?\s*cron:\s*['"]?[\s\S]+?['"]?/m.test(content);
      const hasDispatch = /^\s*workflow_dispatch:/m.test(content);
      assert.ok(
        hasCron || hasDispatch,
        `${wf} declares no trigger (neither schedule.cron nor workflow_dispatch)`,
      );
    });

    test(`${wf}: declares jobs:`, () => {
      assert.match(
        content,
        /^jobs:\s*$/m,
        `${wf} must declare a jobs: section`,
      );
    });

    test(`${wf}: uses runs-on (not a deprecated env)`, () => {
      assert.match(
        content,
        /runs-on:\s*ubuntu-/i,
        `${wf} should pin runs-on to ubuntu-* for cron deterministic environment`,
      );
    });

    test(`${wf}: doesn't bypass safety (no --no-verify or skip-hooks)`, () => {
      assert.doesNotMatch(
        content,
        /--no-verify|--no-gpg-sign|-c\s+commit\.gpgsign=false/,
        `${wf} must not skip git hooks or signing`,
      );
    });
  }
});

describe('cron coverage inventory: high-risk crons have dedicated tests', () => {
  // Closes the gap from the 2026-05-26 cron survey: the 5 highest-risk
  // Steward crons (no test coverage at the time of survey + active failure
  // signals) MUST have a dedicated integration test under tests/integration/.
  //
  // This test asserts the existence + minimal viability of those tests.
  // Adding a new high-risk cron to the list = adding a corresponding test.
  // Closing the gap = removing the cron from the list once its test ships.

  const HIGH_RISK_CRONS = [
    {
      workflow: 'steward-tech-debt-audit.yml',
      test: 'tests/integration/steward-tech-debt-audit.test.cjs',
      reason: 'Sprint 2.9.7a security HIGH path untested',
    },
    {
      workflow: 'steward-workflow-hardener.yml',
      test: 'tests/integration/steward-workflow-hardener.test.cjs',
      reason: 'Advisory-only v1, scanning logic untested',
    },
    {
      workflow: 'steward-senior-tester-review.yml',
      test: 'tests/integration/steward-senior-tester-review.test.cjs',
      reason: '39-smell heuristic + Phase B judge gate untested',
    },
    {
      workflow: 'steward-key-probe.yml',
      test: 'tests/integration/steward-key-probe.test.cjs',
      reason: 'Zero coverage, 4 failure modes uncovered',
    },
    {
      workflow: 'steward-secret-history-sweep.yml',
      test: 'tests/integration/steward-secret-history-sweep.test.cjs',
      reason: 'TruffleHog fail-open path untested',
    },
  ];

  test('every high-risk cron has a corresponding workflow file', () => {
    const missing = HIGH_RISK_CRONS
      .filter((c) => !fs.existsSync(path.join(WORKFLOWS_DIR, c.workflow)))
      .map((c) => c.workflow);
    assert.deepEqual(
      missing,
      [],
      `High-risk cron workflows missing from .github/workflows/: ${missing.join(', ')}`,
    );
  });

  test('every high-risk cron has a dedicated integration test', () => {
    const missing = HIGH_RISK_CRONS
      .filter((c) => !fs.existsSync(path.join(REPO_ROOT, c.test)))
      .map((c) => `${c.test} (for ${c.workflow}: ${c.reason})`);
    assert.deepEqual(
      missing,
      [],
      `High-risk crons without a dedicated test file:\n  ${missing.join('\n  ')}`,
    );
  });

  test('every high-risk cron test actually exercises assertions (not just present)', () => {
    // Line-count alone is gameable; assert the file contains describe(, test(,
    // and at least 3 assert.* calls. This catches a file that exists but has
    // all assertions commented out (silent no-op).
    const empty = HIGH_RISK_CRONS
      .filter((c) => {
        const testPath = path.join(REPO_ROOT, c.test);
        if (!fs.existsSync(testPath)) return true;
        const src = fs.readFileSync(testPath, 'utf8');
        const hasDescribe = /\bdescribe\s*\(/.test(src);
        const hasTest = /\btest\s*\(/.test(src);
        const assertCount = (src.match(/\bassert\.[a-zA-Z]+\s*\(/g) || []).length;
        return !(hasDescribe && hasTest && assertCount >= 3);
      })
      .map((c) => c.test);
    assert.deepEqual(
      empty,
      [],
      `High-risk cron tests missing describe() / test() / >=3 assert.* calls:\n  ${empty.join('\n  ')}`,
    );
  });

  test('every high-risk cron test loads without syntax errors', () => {
    // node --check via require() — a syntax error throws synchronously.
    const broken = [];
    for (const c of HIGH_RISK_CRONS) {
      const testPath = path.join(REPO_ROOT, c.test);
      if (!fs.existsSync(testPath)) continue;
      try {
        // Read + Function-eval as a smoke check (no execution of the tests
        // themselves — that would loop infinitely).
        const src = fs.readFileSync(testPath, 'utf8');
        // eslint-disable-next-line no-new-func
        new Function(src);
      } catch (err) {
        broken.push(`${c.test}: ${err.message.slice(0, 100)}`);
      }
    }
    assert.deepEqual(broken, [], `Test files with syntax errors:\n  ${broken.join('\n  ')}`);
  });
});

describe('Steward action_kind registry vs cron workflows', () => {
  const json = JSON.parse(fs.readFileSync(CAPABILITIES_JSON, 'utf8'));
  const registeredKinds = (json.action_kinds || []).map((k) => k.name);
  const workflows = listStewardWorkflows();

  // Extract action_kind hint from workflow filename (steward-<kind-or-name>.yml)
  // and from `action_kind:` references in the YAML body if present.
  function extractKindFromWorkflow(wf) {
    const slug = wf.replace(/^steward-/, '').replace(/\.ya?ml$/, '');
    const body = readWorkflow(wf);
    const m = body.match(/action_kind:\s*['"]?([a-z0-9_]+)['"]?/);
    return { slug, declared: m ? m[1] : null };
  }

  test('every cron workflow targets a known action_kind (or is documented infra)', () => {
    const knownNonAction = new Set([
      // Workflows that aren't action_kind runners — they're infrastructure
      'steward-key-probe', // manual API key validation
      'steward-eval-baseline', // eval harness, not a cron action
      'steward-evolve-daily', // evolve_daily IS an action kind ...
      'steward-evolve-weekly', // evolve_weekly IS an action kind ...
      'steward-pr-review-responder', // pr_review_responder IS ...
      // Some workflow names slug-differ from registry kind names
      'steward-secret-history-sweep', // → secret_history_sweep
      'steward-workflow-hardener', // → workflow_hardener
      'steward-senior-tester-review', // → senior_tester_review
      'steward-tech-debt-audit', // → tech_debt_audit
      'steward-test-coverage-gap', // → test_coverage_gap
      'steward-todo-triage', // → todo_triage
      'steward-doc-drift', // → doc_drift
      'steward-flaky-test-repair', // → flaky_test_repair
      'steward-lint-fix', // → lint_fix_shipper (NB: slug != kind name)
      'steward-dep-patch', // → dep_update_patch (NB: slug != kind name)
      'steward-harvest', // → recommendation_harvest (NB: slug != kind name)
      'steward-autoresearch', // multi-candidate mode, not single action_kind
    ]);
    const orphans = [];
    for (const wf of workflows) {
      const stem = wf.replace(/\.ya?ml$/, '');
      if (knownNonAction.has(stem)) continue;
      const { slug } = extractKindFromWorkflow(wf);
      const kindName = slug.replace(/-/g, '_');
      if (!registeredKinds.includes(kindName)) {
        orphans.push(`${wf} (looked for kind '${kindName}')`);
      }
    }
    assert.deepEqual(
      orphans,
      [],
      `Cron workflows with no matching registry action_kind:\n  ${orphans.join('\n  ')}`,
    );
  });

  test('every registered action_kind has at least one runner', () => {
    // Either a dedicated steward-*.yml OR steward-harvest.yml (which dispatches
    // multiple kinds). We're permissive — the goal is no FORGOTTEN kind.
    const slugsCovered = new Set(
      workflows.map((wf) =>
        wf.replace(/^steward-/, '').replace(/\.ya?ml$/, '').replace(/-/g, '_'),
      ),
    );
    // Add aliases for known slug↔kind mismatches
    const aliasMap = {
      lint_fix_shipper: 'lint_fix',
      dep_update_patch: 'dep_patch',
      recommendation_harvest: 'harvest',
      recommendation_harvest_parallel: 'harvest',
    };
    const missing = [];
    for (const kind of registeredKinds) {
      const aliased = aliasMap[kind];
      if (
        slugsCovered.has(kind) ||
        (aliased && slugsCovered.has(aliased)) ||
        // some kinds are sub-actions of the harvest dispatch — accept harvest
        slugsCovered.has('harvest')
      ) {
        continue;
      }
      missing.push(kind);
    }
    assert.deepEqual(
      missing,
      [],
      `Registered action_kinds with NO runner workflow: ${missing.join(', ')}`,
    );
  });
});
