// execute.cjs — Hermes v0.5 LLM seam (NOT YET IMPLEMENTED).
//
// This is the file where the Claude Agent SDK plugs in. v0 produces a
// structured plan via dry-run.cjs; v0.5 takes that plan and feeds it to an
// LLM that:
//   1. Reads the project's CLAUDE.md / source files for context
//   2. Makes the surgical edits the action's body describes
//   3. Runs `npm test` to verify
//   4. If green: git add → git commit -F (with the planned trailers) →
//      git push → gh pr create --draft
//   5. If red: revert, journal failure, halt + ping per Tier 2 escalation
//
// Until v0.5 lands, this file is intentionally a stub. Calling it returns
// { ok: false, code: 'V05_NOT_IMPLEMENTED' } and exits 64 (EX_USAGE).
//
// Why the stub exists in v0:
//   - Locks the CLI surface (`cortex-hermes execute --plan-file=...`) so the
//     v0.5 PR is a clean SDK-integration patch, not an architectural change
//   - Documents the seam visibly — Dave reviews the boundary BEFORE deciding
//     on the @anthropic-ai/claude-agent-sdk dependency that crosses the
//     zero-deps invariant
//   - Lets `.github/workflows/hermes.example.yml` reference the execute step
//     today; v0.5 just removes the early-return
//
// CLI:
//   node bin/hermes/execute.cjs --plan-file=<path-to-dry-run-json>
//                               [--repo-root=<path>] [--json] [--quiet]

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const haltCheck = require('./_lib/halt-check.cjs');
const journal = require('./_lib/journal.cjs');

const EX_USAGE = 64;
const EX_TEMPFAIL = 75;

function loadPlan(planFile) {
  if (!planFile) {
    return { ok: false, code: 'MISSING_PLAN_FILE', error: '--plan-file is required' };
  }
  if (!fs.existsSync(planFile)) {
    return { ok: false, code: 'PLAN_FILE_NOT_FOUND', error: `plan file not found: ${planFile}` };
  }
  try {
    const raw = fs.readFileSync(planFile, 'utf8');
    const plan = JSON.parse(raw);
    if (!plan.ok || plan.mode !== 'dry-run') {
      return { ok: false, code: 'PLAN_INVALID', error: 'plan file does not contain a successful dry-run plan' };
    }
    if (!plan.action || !plan.action.action_key || !plan.branch || !plan.action_id) {
      return { ok: false, code: 'PLAN_INCOMPLETE', error: 'plan missing required fields (action, branch, action_id)' };
    }
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, code: 'PLAN_PARSE_ERROR', error: `cannot parse plan: ${err.message}` };
  }
}

function runExecute(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();

  // Halt check first — the same boundary as dry-run + status
  const halted = haltCheck.isHalted({ repoRoot });
  if (halted.halted) {
    return {
      ok: false,
      halted: true,
      reason: halted.reason,
      sentinelPath: halted.sentinelPath,
      exitCode: EX_TEMPFAIL,
    };
  }

  // Validate the plan file shape (does NOT consume it — v0.5 will)
  const loaded = loadPlan(opts.planFile);
  if (!loaded.ok) {
    return { ok: false, code: loaded.code, error: loaded.error };
  }

  // v0.5 stub: journal an "execute_not_implemented" entry so observability
  // shows Hermes was invoked but didn't act. When v0.5 ships, replace this
  // block with the actual Claude Agent SDK call.
  if (loaded.plan.slug) {
    try {
      journal.appendJournal(loaded.plan.slug, {
        ts: new Date().toISOString(),
        trigger: loaded.plan.trigger || 'manual',
        tier: 'T1',
        event: 'execute_not_implemented',
        outcome: 'skipped',
        actor: 'hermes',
        action_key: loaded.plan.action.action_key,
        action_id: loaded.plan.action_id,
      });
    } catch {
      // Journaling failure shouldn't block the stub return — v0.5 will
      // tighten this contract
    }
  }

  return {
    ok: false,
    code: 'V05_NOT_IMPLEMENTED',
    error: 'Hermes execute is the v0.5 seam — Claude Agent SDK integration pending',
    seam_documented_at: 'docs/hermes-runtime.md § "v0.5 milestone"',
    next_steps: [
      'Decide whether to cross the zero-deps invariant (add @anthropic-ai/claude-agent-sdk)',
      'Wire the SDK call inside this file (replace the stub return)',
      'Update .github/workflows/hermes.example.yml — uncomment the v0.5 block',
      'Add ANTHROPIC_API_KEY repo secret on GitHub before enabling the workflow',
    ],
    plan_validated: {
      slug: loaded.plan.slug,
      action_key: loaded.plan.action.action_key,
      branch: loaded.plan.branch,
      action_id: loaded.plan.action_id,
    },
  };
}

module.exports = {
  runExecute,
  loadPlan,
  EX_USAGE,
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const flagValue = (name) => {
    const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (idx === -1) return undefined;
    const eq = args[idx].indexOf('=');
    if (eq >= 0) return args[idx].slice(eq + 1);
    return args[idx + 1];
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('hermes execute — v0.5 LLM seam (stub until Claude Agent SDK lands)');
    console.log('');
    console.log('Usage: hermes execute --plan-file=<path-to-dry-run-json>');
    console.log('  --plan-file <path>   path to a JSON file from `hermes dry-run --json`');
    console.log('  --repo-root <path>   project root (default: cwd)');
    console.log('  --json               machine-readable output');
    console.log('  --quiet              silent on non-error');
    console.log('');
    console.log('Returns exit 64 (EX_USAGE) until v0.5 lands the SDK integration.');
    process.exit(0);
  }

  const wantJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  const planFile = flagValue('plan-file');

  const result = runExecute({
    planFile,
    repoRoot: flagValue('repo-root'),
  });

  if (result.halted) {
    if (!quiet) process.stderr.write(`HALTED: ${result.reason}\n`);
    process.exit(result.exitCode || EX_TEMPFAIL);
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    if (result.code === 'V05_NOT_IMPLEMENTED') {
      console.log('hermes execute — v0.5 stub');
      console.log('');
      console.log('  Plan validated:');
      console.log(`    slug: ${result.plan_validated.slug}`);
      console.log(`    action_key: ${result.plan_validated.action_key}`);
      console.log(`    branch: ${result.plan_validated.branch}`);
      console.log('');
      console.log('  Status: NOT IMPLEMENTED (v0.5 milestone)');
      console.log('  Seam:   docs/hermes-runtime.md § "v0.5 milestone"');
      console.log('  Action needed: Dave\'s zero-deps decision before SDK integration.');
    } else {
      process.stderr.write(`Error: ${result.error}\n`);
    }
  }

  // Exit 64 (EX_USAGE) for the V05_NOT_IMPLEMENTED case so CI catches anyone
  // who tries to actually run it before v0.5
  process.exit(result.code === 'V05_NOT_IMPLEMENTED' ? EX_USAGE : (result.ok ? 0 : 1));
}
