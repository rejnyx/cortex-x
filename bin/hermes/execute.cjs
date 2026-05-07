// execute.cjs — Hermes v0.5a action executor.
//
// Takes a JSON plan from `cortex-hermes dry-run --json` and runs it
// end-to-end:
//   1. Halt check (kill switch)
//   2. Lock acquire
//   3. Clean-tree gate (no uncommitted work)
//   4. Branch checkout (per the plan)
//   5. Action-engine.applyAction() — file edits (mock | openrouter | claude-sdk)
//   6. Verifier.runNpmTest() — verification gate
//   7. Stage touched files (explicit paths only — never `git add -A`)
//   8. Commit via planned commit message
//   9. Post-verify (clean tree + journaled SHA)
//   10. Journal success / failure / rollback per outcome
//   11. Lock release
//
// Default engine is `openrouter` (Sprint 1.6.13 — real LLM via fetch).
// `claude-sdk` is a stub kept reachable via explicit `--engine=claude-sdk`.
// Override via env `HERMES_ENGINE=mock` for tests + dogfood.
//
// CLI:
//   node bin/hermes/execute.cjs --plan-file=<path-to-dry-run-json>
//                               [--repo-root=<path>] [--engine=<mock|openrouter|claude-sdk>]
//                               [--json] [--quiet] [--no-push]
//
// Exit codes:
//   0  — action committed successfully
//   1  — generic error
//   64 — engine-not-implemented (claude-sdk explicit opt-in path)
//   75 — halted (HERMES_HALT sentinel)

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const haltCheck = require('./_lib/halt-check.cjs');
const lock = require('./_lib/lock.cjs');
const journal = require('./_lib/journal.cjs');
const verifier = require('./_lib/verifier.cjs');
const gitOps = require('./_lib/git-ops.cjs');
const actionEngine = require('./_lib/action-engine.cjs');

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
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    if (!plan.ok || plan.mode !== 'dry-run') {
      return { ok: false, code: 'PLAN_INVALID', error: 'plan file does not contain a successful dry-run plan' };
    }
    if (!plan.action || !plan.action.action_key || !plan.branch || !plan.action_id || !plan.commit_message) {
      return { ok: false, code: 'PLAN_INCOMPLETE', error: 'plan missing required fields (action, branch, action_id, commit_message)' };
    }
    return { ok: true, plan };
  } catch (err) {
    return { ok: false, code: 'PLAN_PARSE_ERROR', error: `cannot parse plan: ${err.message}` };
  }
}

function writeCommitMessageToTmp(message) {
  const tmpFile = path.join(os.tmpdir(), `hermes-commit-${Date.now()}-${process.pid}.txt`);
  fs.writeFileSync(tmpFile, message, 'utf8');
  return tmpFile;
}

function safeJournal(slug, entry) {
  try {
    return journal.appendJournal(slug, entry);
  } catch {
    // Journal write failure must not bubble up — observability is best-effort
    return null;
  }
}

// Sprint 1.6.15: failure paths must capture cost_usd/tokens too — the LLM
// call already incurred spend even if edits broke npm test or applyAction
// returned ok:false. Without this, status's cost_usd_total under-reports.
// Conditional add (only when value is a number) keeps journal validateEntry
// happy when engines emit null cost (e.g., OpenRouter response without
// data.usage.cost field).
function addCostFields(entry, applyResult) {
  if (!applyResult) return entry;
  if (typeof applyResult.cost_usd === 'number') entry.cost_usd = applyResult.cost_usd;
  if (typeof applyResult.tokens_in === 'number') entry.tokens_in = applyResult.tokens_in;
  if (typeof applyResult.tokens_out === 'number') entry.tokens_out = applyResult.tokens_out;
  return entry;
}

// Filter out Hermes's own runtime artifacts (lock files, journal dir) from
// the tree status — those are bookkeeping, not user data.
function isHermesArtifact(p) {
  if (!p) return false;
  // Normalize Windows backslashes to forward slashes for matching
  const norm = String(p).replace(/\\/g, '/');
  return norm.startsWith('cortex/journal/') || norm === 'cortex/journal' || norm === 'cortex/';
}

function getCleanTreeIgnoringHermes(repoRoot) {
  const status = gitOps.getCleanTreeStatus(repoRoot);
  if (status.error) return status;
  return {
    clean: (status.modified || []).filter((p) => !isHermesArtifact(p)).length === 0
        && (status.untracked || []).filter((p) => !isHermesArtifact(p)).length === 0,
    modified: (status.modified || []).filter((p) => !isHermesArtifact(p)),
    untracked: (status.untracked || []).filter((p) => !isHermesArtifact(p)),
    dirty: (status.dirty || []).filter((l) => !isHermesArtifact(l.slice(3).trim())),
  };
}

async function runExecute(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const engine = opts.engine || process.env.HERMES_ENGINE;
  const skipVerify = opts.skipVerify === true;

  // Phase 1 — Halt check
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

  // Phase 2 — Plan validation
  const loaded = loadPlan(opts.planFile);
  if (!loaded.ok) {
    return loaded;
  }
  const plan = loaded.plan;
  const slug = plan.slug;

  // Phase 3 — Pre-flight repo checks
  if (!gitOps.isInGitRepo(repoRoot)) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_not_git_repo',
      outcome: 'failure',
      actor: 'hermes',
    });
    return { ok: false, code: 'NOT_GIT_REPO', error: `repoRoot is not a git repository: ${repoRoot}` };
  }

  // Pre-flight clean-tree check, ignoring Hermes's own runtime artifacts
  // (cortex/journal/<slug>/.lock and the journal dir itself).
  const treeStatus = getCleanTreeIgnoringHermes(repoRoot);
  if (!treeStatus.clean) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_dirty_tree',
      outcome: 'failure',
      actor: 'hermes',
    });
    return {
      ok: false,
      code: 'DIRTY_TREE',
      error: 'working tree has uncommitted changes; commit or stash before running Hermes',
      modified: treeStatus.modified,
      untracked: treeStatus.untracked,
    };
  }

  // Phase 4 — Lock acquire
  let lockHandle;
  try {
    lockHandle = lock.acquireLock(repoRoot, slug, { actionId: plan.action_id });
  } catch (err) {
    if (err.code === 'EEXIST_FRESH') {
      return { ok: false, code: 'LOCK_HELD', error: 'Hermes lock held by another process', heldBy: err.heldBy };
    }
    throw err;
  }

  let originalBranch = null;

  try {
    originalBranch = gitOps.getCurrentBranch(repoRoot);

    // Phase 5 — Branch checkout
    const checkout = gitOps.checkoutNewBranch(repoRoot, plan.branch);
    if (!checkout.ok) {
      safeJournal(slug, {
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_checkout_failed',
        outcome: 'failure',
        actor: 'hermes',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
        branch: plan.branch,
      });
      return { ok: false, code: 'CHECKOUT_FAILED', error: checkout.stderr || checkout.error || 'unknown checkout error' };
    }

    // Phase 6 — Apply action (async — engines may make network calls)
    const applyResult = await actionEngine.applyAction(plan, { repoRoot, engine });

    if (!applyResult.ok) {
      // Rollback to original branch + delete the dead branch
      if (originalBranch) {
        gitOps.git(repoRoot, ['checkout', originalBranch]);
        gitOps.git(repoRoot, ['branch', '-D', plan.branch]);
      }
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? 'T1' : 'T2',
        event: 'execute_action_failed',
        outcome: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? 'skipped' : 'failure',
        actor: 'hermes',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      }, applyResult));
      return {
        ok: false,
        code: applyResult.code || 'ACTION_FAILED',
        error: applyResult.error || 'action engine returned failure',
        engine: applyResult.engine,
        next_steps: applyResult.next_steps,
        exitCode: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? EX_USAGE : 1,
      };
    }

    const touchedFiles = applyResult.touchedFiles || [];
    if (touchedFiles.length === 0) {
      if (originalBranch) {
        gitOps.git(repoRoot, ['checkout', originalBranch]);
        gitOps.git(repoRoot, ['branch', '-D', plan.branch]);
      }
      return { ok: false, code: 'NO_FILES_TOUCHED', error: 'action engine reported success but produced no edits' };
    }

    // Phase 7 — Verifier
    let verifyResult = null;
    if (!skipVerify) {
      verifyResult = verifier.runNpmTest({ repoRoot, timeoutMs: opts.verifyTimeoutMs });
      if (!verifyResult.ok) {
        // Discard the working-tree edits, return to original branch, drop the
        // dead branch — pre-commit failures DON'T leave a tainted commit.
        gitOps.git(repoRoot, ['checkout', '--', '.']);
        gitOps.git(repoRoot, ['clean', '-fd']);
        if (originalBranch) {
          gitOps.git(repoRoot, ['checkout', originalBranch]);
          gitOps.git(repoRoot, ['branch', '-D', plan.branch]);
        }
        safeJournal(slug, addCostFields({
          ts: new Date().toISOString(),
          trigger: plan.trigger || 'manual',
          tier: 'T2',
          event: 'execute_verify_failed',
          outcome: 'failure',
          actor: 'hermes',
          action_key: plan.action.action_key,
          action_id: plan.action_id,
        }, applyResult));
        return {
          ok: false,
          code: 'VERIFY_FAILED',
          error: 'npm test failed after action edits; rolled back',
          verifier: verifier.summarizeResult(verifyResult),
          touchedFiles,
        };
      }
    }

    // Phase 8 — Stage + commit (atomic per MUST-H1)
    const stageResult = gitOps.stage(repoRoot, touchedFiles);
    if (!stageResult.ok) {
      return { ok: false, code: 'STAGE_FAILED', error: stageResult.stderr || stageResult.error };
    }

    const commitMsgFile = writeCommitMessageToTmp(plan.commit_message);
    const commitResult = gitOps.commitWithMessageFile(repoRoot, commitMsgFile);
    fs.unlinkSync(commitMsgFile); // cleanup

    if (!commitResult.ok) {
      return { ok: false, code: 'COMMIT_FAILED', error: commitResult.stderr || commitResult.error };
    }

    // Phase 9 — Post-commit verification
    // Only fail if there are MODIFIED (tracked) files left over — those would
    // indicate a partial commit. Untracked files are expected (the lock file
    // at cortex/journal/<slug>/.lock is itself an untracked runtime artifact
    // by design, and projects often have other untracked working files).
    const postStatus = getCleanTreeIgnoringHermes(repoRoot);
    if (postStatus.modified && postStatus.modified.length > 0) {
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_post_verify_failed',
        outcome: 'failure',
        actor: 'hermes',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      }, applyResult));
      return {
        ok: false,
        code: 'POST_VERIFY_DIRTY',
        error: 'post-commit working tree has modified tracked files; possible partial commit',
        modified: postStatus.modified,
      };
    }

    // Phase 10 — Journal success (cost/tokens via shared addCostFields helper)
    safeJournal(slug, addCostFields({
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T0',
      event: 'action_completed',
      outcome: 'success',
      actor: 'hermes',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
      branch: plan.branch,
    }, applyResult));

    return {
      ok: true,
      mode: 'execute',
      slug,
      branch: plan.branch,
      action_id: plan.action_id,
      action_key: plan.action.action_key,
      commit_sha: commitResult.sha,
      touched_files: touchedFiles,
      verifier: verifyResult ? verifier.summarizeResult(verifyResult) : 'skipped',
      engine: applyResult.engine,
      cost_usd: applyResult.cost_usd,
      tokens_in: applyResult.tokens_in,
      tokens_out: applyResult.tokens_out,
      model: applyResult.model,
    };
  } finally {
    lock.releaseLock(lockHandle);
  }
}

module.exports = {
  runExecute,
  loadPlan,
  addCostFields,
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
    console.log('hermes execute — run a dry-run plan against the working tree');
    console.log('');
    console.log('Usage: hermes execute --plan-file=<path-to-dry-run-json> [options]');
    console.log('  --plan-file <path>   path to a JSON file from `hermes dry-run --json`');
    console.log('  --repo-root <path>   project root (default: cwd)');
    console.log('  --engine <name>      action engine: mock | openrouter | claude-sdk (default: openrouter)');
    console.log('  --skip-verify        skip the npm test gate (DANGEROUS; tests only)');
    console.log('  --json               machine-readable output');
    console.log('  --quiet              silent on success');
    console.log('  --help               this help');
    console.log('');
    console.log('Engine selection (precedence): --engine flag > HERMES_ENGINE env > openrouter');
    console.log('');
    console.log('openrouter engine: real LLM via fetch (zero-deps). Requires OPENROUTER_API_KEY.');
    console.log('  See docs/hermes-usage.md § Model selection for HERMES_MODEL recommendations.');
    console.log('claude-sdk engine: stub returning CLAUDE_SDK_NOT_IMPLEMENTED + exit 64 (opt-in).');
    console.log('mock engine reads HERMES_MOCK_PLAN env var as the edit script.');
    process.exit(0);
  }

  const wantJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  const skipVerify = args.includes('--skip-verify');
  const planFile = flagValue('plan-file');
  const engine = flagValue('engine');

  // CLI is async because runExecute now awaits the action engine
  (async () => {
    const result = await runExecute({
      planFile,
      repoRoot: flagValue('repo-root'),
      engine,
      skipVerify,
    });
    return result;
  })().then(handleResult).catch((err) => {
    process.stderr.write(`Hermes execute crashed: ${err.message}\n`);
    process.exit(1);
  });

  function handleResult(result) {

  if (result.halted) {
    if (!quiet) process.stderr.write(`HALTED: ${result.reason}\n`);
    process.exit(result.exitCode || EX_TEMPFAIL);
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    if (result.ok) {
      console.log(`[hermes execute] ✓ slug=${result.slug}`);
      console.log(`  branch: ${result.branch}`);
      console.log(`  commit: ${result.commit_sha}`);
      console.log(`  files:  ${result.touched_files.join(', ')}`);
      console.log(`  verify: ${result.verifier}`);
      console.log(`  engine: ${result.engine}`);
    } else if (result.code === 'CLAUDE_SDK_NOT_IMPLEMENTED') {
      console.log('hermes execute — claude-sdk engine NOT_IMPLEMENTED (stub only)');
      console.log('');
      console.log('  Use the openrouter engine instead (default since Sprint 1.6.13):');
      console.log('    --engine=openrouter   (or unset --engine for the default)');
      console.log('  Or the mock engine for offline tests:');
      console.log('    --engine=mock   (HERMES_MOCK_PLAN env var supplies the edit JSON)');
    } else {
      process.stderr.write(`Error: ${result.error || result.code}\n`);
    }
  }

    if (result.ok) process.exit(0);
    if (result.exitCode) process.exit(result.exitCode);
    process.exit(1);
  }
}
