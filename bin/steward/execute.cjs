// execute.cjs — Steward v0.5a action executor (Hermes v0.5a pre-rebrand).
//
// Takes a JSON plan from `cortex-steward dry-run --json` and runs it
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
// Override via env `STEWARD_ENGINE=mock` for tests + dogfood.
//
// CLI:
//   node bin/steward/execute.cjs --plan-file=<path-to-dry-run-json>
//                               [--repo-root=<path>] [--engine=<mock|openrouter|claude-sdk>]
//                               [--json] [--quiet] [--no-push]
//
// Exit codes:
//   0  — action committed successfully
//   1  — generic error
//   64 — engine-not-implemented (claude-sdk explicit opt-in path)
//   75 — halted (STEWARD_HALT or HERMES_HALT sentinel)

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const haltCheck = require('./_lib/halt-check.cjs');
const lock = require('./_lib/lock.cjs');
const journal = require('./_lib/journal.cjs');
const verifier = require('./_lib/verifier.cjs');
const gitOps = require('./_lib/git-ops.cjs');
const ghOps = require('./_lib/gh-ops.cjs');
const actionEngine = require('./_lib/action-engine.cjs');
const actionKinds = require('./_lib/action-kinds.cjs');
// Sprint 1.9.0 — spec-driven verification gate. Runs BETWEEN applyAction and
// runNpmTest. Generalizes Sprint 1.8.13 hardcoded EDIT_DESTRUCTIVE_REWRITE
// into per-kind acceptance criteria. See docs/research/sprint-1.9-spec-driven-
// verification-2026-05-09.md for the design memo.
const specVerifier = require('./_lib/spec-verifier.cjs');
// Sprint 4.7 — STEWARD_* env vars with HERMES_* backward-compat alias.
const { readEnv } = require('./_lib/env.cjs');
// Sprint 2.0 — zero-deps OTLP HTTP emitter for OpenInference + gen_ai spans.
// Tracer is no-op when STEWARD_OTEL_ENDPOINT is unset; otherwise spans flush
// at runExecute end. Journal SSOT preserved — Phoenix is additive.
const otelEmitter = require('./_lib/otel-emitter.cjs');
// Sprint 1.9.1 — multi-window cost safety + loop detector. Pre-flight gates
// layer above existing daily cap + per-action_key failure breaker.
const costSafety = require('./_lib/cost-safety.cjs');
// Sprint 2.0b — action-kind-based model routing. selectModel() resolves the
// model slug for an LLM action_kind under the active profile + per-kind +
// CLI overrides. routingPolicy.checkPerActionBudget gates each LLM action
// against a $1 default per-action_kind cap (defense in depth above the
// daily/weekly/monthly caps from 1.9.1).
const routingTable = require('./_lib/routing-table.cjs');
const routingPolicy = require('./_lib/routing-policy.cjs');
// Sprint 2.1 — autoresearch orchestrator. Used when --mode=autoresearch (or
// STEWARD_MODE=autoresearch) on a recommendation kind. Single-process serial
// N-strategy loop; worktree fan-out is Sprint 2.2.
const autoresearch = require('./_lib/autoresearch.cjs');
// Sprint 1.8.2c — recommendation_harvest is the first non-recommendation kind.
// Detector lives in detectors/ (read-only signal source); the executor
// runHarvestAction helper below handles the deterministic append-to-recs path.
const harvester = require('../../detectors/recommendation-harvest.cjs');
// Sprint 1.8.4 — dep_update_patch deterministic capability. npm outdated
// → patch-only diffs → npm install --save → npm test gate. No LLM call on
// happy path; verifier rejection rolls back exactly like the LLM path.
const depPatch = require('../../detectors/dep-update-patch.cjs');
// Sprint 1.8.7 — todo_triage deterministic capability. Scan TODO/FIXME
// markers, age-filter via git blame, dedupe vs open issues, file gh issues
// with code-context body. No LLM call, no file edits — only opens gh issues.
const todoTriage = require('../../detectors/todo-triage.cjs');
// Sprint 1.8.5 — flaky_test_repair marker-based quarantine. Scan source for
// `// HERMES-FLAKY: reason` above test/it/describe → replace with .skip +
// remove marker + open gh issue. Deterministic, no LLM, file edits + issue.
const flakyRepair = require('../../detectors/flaky-test-repair.cjs');
// Sprint 1.8.6 — doc_drift scans exported symbols, checks doc mentions,
// files gh issues for undocumented public API. Deterministic, no LLM,
// gh-only side effects (skip_commit pattern).
const docDrift = require('../../detectors/doc-drift.cjs');
// Sprint 1.8.9 — lint_fix_shipper runs eslint --fix + tsc --noEmit. Auto-fixes
// ship as a commit; non-auto-fixable type errors get filed as gh issues.
const lintFix = require('../../detectors/lint-fix.cjs');
// Sprint 1.8.10 — test_coverage_gap cross-references coverage summary +
// recent git history, files gh issues for low-coverage hot-spots.
const coverageGap = require('../../detectors/test-coverage-gap.cjs');
// Sprint 1.8.11 — pr_review_responder monitors Hermes-authored PRs for
// reviewer comments, files aggregation issue per PR. No auto-patch in v1.
const prResponder = require('../../detectors/pr-review-responder.cjs');
// Sprint 1.8.3 — ReasoningBank-lite memory. Every failed run records a lesson
// (root cause + hint) so the next run can recall + avoid repeating the same
// mistake. Append-only JSONL at $CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl.
const lessons = require('./_lib/lessons.cjs');

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
    // Sprint 1.8.1 — typed action_kind validation. Default to backwards-compat
    // 'recommendation' if missing (pre-1.8.1 plans don't have the field).
    // Reject unknown kinds (typo guard) and not-yet-shipped kinds (registry
    // declares the contract; executor implementations land in 1.8.2+).
    const kind = plan.action_kind || actionKinds.DEFAULT_KIND;
    if (!actionKinds.isSupportedKind(kind)) {
      return {
        ok: false,
        code: 'PLAN_UNKNOWN_ACTION_KIND',
        error: `action_kind '${kind}' is not registered. Supported: ${actionKinds.listKinds().join(', ')}`,
      };
    }
    if (!actionKinds.isShippedKind(kind)) {
      return {
        ok: false,
        code: 'PLAN_ACTION_KIND_NOT_SHIPPED',
        error: `action_kind '${kind}' is declared but not yet shipped. Shipped kinds: ${actionKinds.listShippedKinds().join(', ')}`,
      };
    }
    plan.action_kind = kind; // normalize back into plan for downstream use
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

// Sprint 1.8.3 — record a lesson when an executor failure path returns.
// Best-effort, never blocks the failure return. Caller passes the result
// object (must have .code) and plan (for action_kind + action_key context).
function safeRecordLesson(slug, result, plan) {
  try {
    const lesson = lessons.lessonFromExecuteResult(result, {
      action_kind: plan && plan.action_kind,
      action_key: plan && plan.action && plan.action.action_key,
    });
    if (lesson) lessons.recordLesson(slug, lesson);
  } catch (_) {
    // Never let lesson recording sink the failure return.
  }
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

// Sprint 1.6.21 (T4): SSOT rollback helper for stateful-pipeline failure paths.
// Discards working-tree edits, returns to originalBranch, deletes the dead
// hermes/<...> branch. Best-effort — each step's failure is intentionally
// swallowed because we're already in a failure path; bubbling up here would
// mask the real failure code (STAGE_FAILED, COMMIT_FAILED, etc.).
//
// The pre-1.6.21 layout duplicated this 3-step sequence at 3 sites
// (action_failed, verify_failed, post_verify_failed) — but STAGE_FAILED and
// COMMIT_FAILED returned WITHOUT rolling back, leaving the user on dead
// branch with edits applied. T4 stateful simulation made the bug observable.
function rollbackToOriginal(repoRoot, originalBranch, deadBranch) {
  // Discard working-tree changes (tracked + untracked) so the dead branch
  // can be deleted cleanly. `git checkout -- .` reverts modified tracked
  // files; `git clean -fd` removes untracked files + empty directories.
  try { gitOps.git(repoRoot, ['checkout', '--', '.']); } catch { /* best effort */ }
  try { gitOps.git(repoRoot, ['clean', '-fd']); } catch { /* best effort */ }
  if (originalBranch) {
    try { gitOps.git(repoRoot, ['checkout', originalBranch]); } catch { /* best effort */ }
    if (deadBranch && deadBranch !== originalBranch) {
      try { gitOps.git(repoRoot, ['branch', '-D', deadBranch]); } catch { /* best effort */ }
    }
  }
}

// Sprint 1.6.19: push branch + draft PR — best-effort, non-blocking.
// Degradation matrix:
//   skipPush=true                      → status='skipped'         (--no-push or STEWARD_NO_PUSH=1)
//   no origin remote                   → status='no_remote'       (fresh `git init`, never linked)
//   git push fails                     → status='push_failed'     (auth, conflict, permission)
//   gh CLI absent                      → status='no_gh_cli'       (cron will have it; local may not)
//   gh pr create fails                 → status='pr_failed'       (no GH_TOKEN, repo permission, etc.)
//   all OK                             → status='created', url=<PR url>
async function maybePushAndOpenPR({ repoRoot, plan, slug, skipPush, prLabels }) {
  if (skipPush) return { status: 'skipped', reason: 'opt-out via --no-push or STEWARD_NO_PUSH' };

  if (!gitOps.hasRemote(repoRoot)) {
    return { status: 'no_remote', reason: 'no `origin` remote configured' };
  }

  const pushResult = gitOps.pushBranch(repoRoot, plan.branch);
  if (!pushResult.ok) {
    return {
      status: 'push_failed',
      error: pushResult.stderr || pushResult.error,
      exitCode: pushResult.exitCode,
    };
  }

  if (!ghOps.hasGhCli()) {
    return {
      status: 'no_gh_cli',
      reason: 'gh CLI not on PATH; branch pushed but no draft PR opened',
      pushed: true,
    };
  }

  // Title from commit subject (first line). Body from rest of commit message
  // — already includes the action body + Hermes-* trailers, which is exactly
  // what a Hermes PR description should be.
  const lines = (plan.commit_message || '').split('\n');
  const title = lines[0] || `Hermes: ${plan.action.title}`;
  const body = lines.slice(2).join('\n').trim() || plan.action.body || '';

  const prResult = ghOps.createDraftPR({
    title,
    body,
    base: plan.base_branch || 'main',
    head: plan.branch,
    repoRoot,
    labels: Array.isArray(prLabels) ? prLabels : undefined,
  });

  if (!prResult.ok) {
    return {
      status: 'pr_failed',
      error: prResult.error,
      code: prResult.code,
      pushed: true,
    };
  }

  return { status: 'created', url: prResult.url, pushed: true };
}

// Sprint 1.6.19: pre-flight budget gates. The autonomous-cron use case (Phase
// 7 v1) makes spend-runaway a real risk — one poisoned recommendation that no
// model can satisfy + cron driver = unbounded $/day burn. Two gates:
//
//   1. STEWARD_DAILY_USD_CAP (default $5) — refuses when today's journal
//      cost_usd_total reaches the cap. OpenRouter has its own per-key cap in
//      the UI; this is defense in depth at the agent layer.
//
//   2. STEWARD_FAILURE_BREAKER (default 3) — refuses when this action_key
//      has N consecutive `execute_*_failed` entries in last hour. Prevents
//      retry loops on actions the model can't satisfy (saw this with V4 Flash
//      on Tier 8 multi-file action — 4 failed attempts in succession).
//
// Both gates skipped when env unset OR set to 0 (opt-out for tests / explicit
// cap-disabled). Tests set the env vars to small values to exercise the path.
const DEFAULT_DAILY_USD_CAP = 5;
const DEFAULT_FAILURE_BREAKER = 3;
const FAILURE_BREAKER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function readDailyUsdCap() {
  const raw = readEnv('DAILY_USD_CAP');
  if (raw === undefined) return DEFAULT_DAILY_USD_CAP;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_USD_CAP;
  return n; // 0 = explicit opt-out
}

function readFailureBreaker() {
  const raw = readEnv('FAILURE_BREAKER');
  if (raw === undefined) return DEFAULT_FAILURE_BREAKER;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FAILURE_BREAKER;
  return n; // 0 = explicit opt-out
}

function checkDailyBudget(slug) {
  const cap = readDailyUsdCap();
  if (cap === 0) return { ok: true, cap: 0, spent: 0, reason: 'cap disabled' };
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const entries = journal.readJournal(slug);
  let spent = 0;
  for (const e of entries) {
    if (e._corrupted) continue;
    if (typeof e.cost_usd !== 'number') continue;
    if (typeof e.ts !== 'string' || !e.ts.startsWith(today)) continue;
    spent += e.cost_usd;
  }
  if (spent >= cap) {
    return { ok: false, cap, spent, code: 'BUDGET_CAP_REACHED' };
  }
  return { ok: true, cap, spent };
}

function checkFailureBreaker(slug, actionKey) {
  const breaker = readFailureBreaker();
  if (breaker === 0) return { ok: true, breaker: 0, recentFailures: 0, reason: 'breaker disabled' };
  if (!actionKey) return { ok: true, breaker, recentFailures: 0, reason: 'no action_key' };

  const cutoff = Date.now() - FAILURE_BREAKER_WINDOW_MS;
  const entries = journal.readJournal(slug);
  let recentFailures = 0;
  for (const e of entries) {
    if (e._corrupted) continue;
    if (e.action_key !== actionKey) continue;
    if (typeof e.event !== 'string' || !e.event.startsWith('execute_') || !e.event.endsWith('_failed')) continue;
    if (typeof e.ts !== 'string') continue;
    const tsMs = Date.parse(e.ts);
    if (!Number.isFinite(tsMs) || tsMs < cutoff) continue;
    recentFailures += 1;
  }
  if (recentFailures >= breaker) {
    return { ok: false, breaker, recentFailures, code: 'FAILURE_BREAKER_TRIPPED' };
  }
  return { ok: true, breaker, recentFailures };
}

// Filter out Hermes's own runtime artifacts (lock files, journal dir) from
// the tree status — those are bookkeeping, not user data.
// Sprint 1.8.2c — Insert harvested candidate lines into cortex/recommendations.md
// under the existing "## DO this week (cited)" section. If section is absent,
// append at end of file with a fresh heading. Idempotent — repeated runs against
// the same body produce the same output (dedup is enforced upstream by the
// harvester's extractDedupKeys).
function appendCandidatesToRecsBody(body, appendableLines) {
  if (!appendableLines) return body;
  // Match the section header + zero-or-more existing checklist items.
  // Captures the whole block so we can append before the next section / EOF.
  const sectionRegex = /^## DO this week(?:\s*\(cited\))?\s*\n(?:- \[[ x]\][^\n]*\n)*/m;
  const match = body.match(sectionRegex);
  if (match) {
    // Insert appendable lines at the end of the section block (before any
    // subsequent ## heading or EOF).
    const insertAt = match.index + match[0].length;
    return body.slice(0, insertAt) + appendableLines + '\n' + body.slice(insertAt);
  }
  // Section missing — append fresh block with heading.
  const sep = body.endsWith('\n') ? '\n' : '\n\n';
  return body + sep + '## DO this week (cited)\n' + appendableLines + '\n';
}

// Sprint 1.8.2c — recommendation_harvest executor branch.
// Read-only path: no LLM call, no source-code edits, just append candidates
// to cortex/recommendations.md. Returns same shape as actionEngine.applyAction
// so the rest of the runExecute pipeline (stage → commit → push → PR) reuses
// existing logic verbatim.
async function runHarvestAction(plan, { repoRoot, harvestSignals }) {
  const recsPath = path.join(repoRoot, 'cortex', 'recommendations.md');
  if (!fs.existsSync(recsPath)) {
    return {
      ok: false,
      code: 'HARVEST_RECS_MISSING',
      error: `cortex/recommendations.md not found at ${recsPath} — harvester needs an existing file to append to`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }
  const existingBody = fs.readFileSync(recsPath, 'utf8');
  const result = harvester.harvest({
    recommendationsBody: existingBody,
    maxCandidates: 3,
    signals: harvestSignals, // DI seam for testing without real gh calls
  });

  if (result.candidates.length === 0) {
    return {
      ok: false,
      code: 'HARVEST_NO_CANDIDATES',
      error: 'no fresh candidates from CI/PR/issue signals (all dedup vs existing recs)',
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      total_signals: result.total_signals,
      deduped_count: result.deduped_count,
    };
  }

  const appendableLines = harvester.formatAsRecommendationLines(result.candidates);
  const newBody = appendCandidatesToRecsBody(existingBody, appendableLines);
  fs.writeFileSync(recsPath, newBody, 'utf8');

  return {
    ok: true,
    touchedFiles: ['cortex/recommendations.md'],
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    harvested_count: result.candidates.length,
    total_signals: result.total_signals,
    deduped_count: result.deduped_count,
  };
}

// Sprint 1.8.4 — dep_update_patch executor branch. Deterministic, no LLM:
//   1. Detect candidates via npm outdated --json (or DI mockOutdatedJson)
//   2. Run npm install --save pkg@wanted, ... for the candidates
//   3. Verifier (runNpmTest) is the gate — same as LLM path
//
// Returns same shape as actionEngine.applyAction so the runExecute pipeline
// (stage → commit → push → PR) reuses existing logic verbatim.
async function runDepUpdateAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = depPatch.detectPatchUpdates({
    cwd: repoRoot,
    mockOutdatedJson: opts.mockOutdatedJson, // DI for tests
    maxCandidates: opts.maxCandidates || 5,
  });

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'DEP_UPDATE_NO_CANDIDATES',
      error: `no patch-only updates available (${detected.total_outdated} outdated, ${detected.skipped_minor} minor, ${detected.skipped_major} major)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  // Run npm install for the patch candidates (unless DI flag says skip).
  if (!opts.skipNpmInstall) {
    const args = depPatch.buildInstallArgs(detected.candidates);
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('npm', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000, // 5 min cap
    });
    if (result.status !== 0) {
      return {
        ok: false,
        code: 'DEP_UPDATE_INSTALL_FAILED',
        error: `npm install failed: ${(result.stderr || '').slice(0, 500)}`,
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
        candidates: detected.candidates,
      };
    }
  }

  // npm install touches package.json + lock files; report both as touched
  // so the staging step adds them. Detect which lockfile actually changed
  // by checking which files were modified in the working tree.
  const touchedFiles = ['package.json'];
  const fs = require('node:fs');
  const path = require('node:path');
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    const lockPath = path.join(repoRoot, lock);
    if (fs.existsSync(lockPath)) {
      // Check if it changed via git status
      const { execSync } = require('node:child_process');
      try {
        const out = execSync(`git diff --name-only -- "${lock}"`, { cwd: repoRoot, encoding: 'utf8' }).trim();
        if (out) touchedFiles.push(lock);
      } catch { /* ignore */ }
    }
  }

  return {
    ok: true,
    touchedFiles,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    updated_count: detected.candidates.length,
    candidates: detected.candidates,
  };
}

// Sprint 1.8.11 — pr_review_responder executor branch. Surface reviewer
// feedback on Hermes-authored PRs as aggregation issues. Issues-only
// side effect (skip_commit pattern). No auto-patch in v1.
async function runPRResponderAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = prResponder.detectReviewComments({
    cwd: repoRoot,
    maxCandidates: opts.maxCandidates || 5,
    mockOpenPRs: opts.mockOpenPRs,
    mockCommentsByPR: opts.mockCommentsByPR,
  });

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'PR_RESPONDER_NO_CANDIDATES',
      error: `no Hermes-authored PRs with unresolved reviewer comments (${detected.total_open_prs} Hermes PRs total)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  const openedIssues = [];
  if (opts.skipGh || opts.dryRunGh) {
    for (const cand of detected.candidates) {
      openedIssues.push({
        title: prResponder.formatIssueTitle(cand),
        url: 'mock://dry-run',
        candidate: cand,
        dry_run: true,
      });
    }
  } else {
    const ghOpsLib = require('./gh-ops.cjs');
    if (!ghOpsLib.hasGhCli()) {
      return {
        ok: false,
        code: 'GH_CLI_MISSING',
        error: 'gh CLI not available — pr_review_responder needs gh',
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      };
    }
    for (const cand of detected.candidates) {
      const title = prResponder.formatIssueTitle(cand);
      const body = prResponder.formatIssueBody(cand);
      const tmpFile = path.join(os.tmpdir(), `hermes-prresp-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
      fs.writeFileSync(tmpFile, body, 'utf8');
      const result = require('node:child_process').spawnSync('gh', [
        'issue', 'create',
        '--title', title,
        '--body-file', tmpFile,
        '--label', 'pr-review-feedback',
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (result.status === 0) {
        openedIssues.push({ title, url: (result.stdout || '').trim(), candidate: cand });
      }
    }
  }

  return {
    ok: true,
    touchedFiles: [],
    skip_commit: true,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    opened_issues: openedIssues,
    surfaced_count: detected.candidates.length,
  };
}

// Sprint 1.8.10 — test_coverage_gap executor branch. Issues-only side effect
// (skip_commit pattern). Reads coverage/coverage-summary.json + recent git
// log, files gh issue per file with low coverage AND recent edits.
async function runCoverageGapAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = coverageGap.detectCoverageGaps({
    cwd: repoRoot,
    threshold: opts.threshold,
    lookbackDays: opts.lookbackDays,
    maxCandidates: opts.maxCandidates || 5,
    mockSummary: opts.mockSummary,
    mockRecentFiles: opts.mockRecentFiles,
  });

  if (!detected.coverage_available) {
    return {
      ok: false,
      code: 'COVERAGE_REPORT_MISSING',
      error: 'no coverage/coverage-summary.json found — run `npm run test:coverage` (or equivalent) first',
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'COVERAGE_GAP_NO_CANDIDATES',
      error: `no low-coverage hot-spots (${detected.total_low_coverage} files below threshold, ${detected.skipped_unchanged} not recently edited)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  const openedIssues = [];
  if (opts.skipGh || opts.dryRunGh) {
    for (const cand of detected.candidates) {
      openedIssues.push({
        title: coverageGap.formatIssueTitle(cand),
        url: 'mock://dry-run',
        candidate: cand,
        dry_run: true,
      });
    }
  } else {
    const ghOpsLib = require('./gh-ops.cjs');
    if (!ghOpsLib.hasGhCli()) {
      return {
        ok: false,
        code: 'GH_CLI_MISSING',
        error: 'gh CLI not available — test_coverage_gap needs gh to file issues',
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      };
    }
    for (const cand of detected.candidates) {
      const title = coverageGap.formatIssueTitle(cand);
      const body = coverageGap.formatIssueBody(cand);
      const tmpFile = path.join(os.tmpdir(), `hermes-coverage-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
      fs.writeFileSync(tmpFile, body, 'utf8');
      const result = require('node:child_process').spawnSync('gh', [
        'issue', 'create',
        '--title', title,
        '--body-file', tmpFile,
        '--label', 'coverage-gap',
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (result.status === 0) {
        openedIssues.push({ title, url: (result.stdout || '').trim(), candidate: cand });
      }
    }
  }

  return {
    ok: true,
    touchedFiles: [],
    skip_commit: true,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    opened_issues: openedIssues,
    gap_count: detected.candidates.length,
  };
}

// Sprint 1.8.9 — lint_fix_shipper executor branch. Two-phase deterministic:
//   1. Run `npx eslint --fix` — auto-fixes ship as a commit (touchedFiles)
//   2. Run `npx tsc --noEmit` — non-auto-fixable type errors get filed as gh
//      issues (separate side effect, no commit)
// If eslint produced edits AND tsc produced errors, ship the eslint commit
// AND open issues for the tsc errors. Mixed flow uses skip_commit: false.
async function runLintFixAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = lintFix.detectLintFix({
    cwd: repoRoot,
    apply: !opts.dryRunFix, // actually run eslint --fix unless DI says skip
    mockEslint: opts.mockEslint,
    mockTsc: opts.mockTsc,
  });

  const hasFixes = detected.touched_files.length > 0;
  const hasErrors = detected.type_errors.length > 0;

  if (!hasFixes && !hasErrors) {
    return {
      ok: false,
      code: 'LINT_FIX_NO_WORK',
      error: `nothing to ship (eslint_available=${detected.eslint_available}, tsc_available=${detected.tsc_available}, touched=0, errors=0)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  // Optionally file gh issues for type errors (non-auto-fixable)
  const openedIssues = [];
  if (hasErrors && !opts.skipGh && !opts.dryRunGh) {
    const ghOpsLib = require('./gh-ops.cjs');
    if (ghOpsLib.hasGhCli()) {
      const errorsToFile = detected.type_errors.slice(0, opts.maxIssues || 5);
      for (const err of errorsToFile) {
        const title = lintFix.formatIssueTitle(err);
        const body = lintFix.formatIssueBody(err);
        const tmpFile = path.join(os.tmpdir(), `hermes-lint-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
        fs.writeFileSync(tmpFile, body, 'utf8');
        const result = require('node:child_process').spawnSync('gh', [
          'issue', 'create',
          '--title', title,
          '--body-file', tmpFile,
          '--label', 'lint-fix',
        ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        if (result.status === 0) {
          openedIssues.push({ title, url: (result.stdout || '').trim(), error: err });
        }
      }
    }
  } else if (hasErrors && opts.dryRunGh) {
    for (const err of detected.type_errors.slice(0, opts.maxIssues || 5)) {
      openedIssues.push({ title: lintFix.formatIssueTitle(err), url: 'mock://dry-run', error: err, dry_run: true });
    }
  }

  return {
    ok: true,
    touchedFiles: detected.touched_files, // empty array if eslint had no edits
    // skip_commit only if eslint produced ZERO edits — we're issue-only mode
    skip_commit: !hasFixes,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    fixed_count: detected.touched_files.length,
    type_errors_count: detected.type_errors.length,
    opened_issues: openedIssues,
  };
}

// Sprint 1.8.6 — doc_drift executor branch. Scan exports, check docs, file
// gh issues for undocumented symbols. NO file edits, NO commit, NO PR — same
// skip_commit pattern as todo_triage. The side effect IS the gh issue creation.
async function runDocDriftAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = docDrift.detectDocDrift({
    cwd: repoRoot,
    mockFiles: opts.mockFiles,
    mockDocsCorpus: opts.mockDocsCorpus,
    maxCandidates: opts.maxCandidates || 5,
  });

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'DOC_DRIFT_NO_CANDIDATES',
      error: `no undocumented exports found (${detected.total_exports} exports total, ${detected.documented_count} documented)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  const openedIssues = [];
  if (opts.skipGh || opts.dryRunGh) {
    for (const cand of detected.candidates) {
      openedIssues.push({
        title: docDrift.formatIssueTitle(cand),
        url: 'mock://dry-run',
        candidate: cand,
        dry_run: true,
      });
    }
  } else {
    const ghOpsLib = require('./gh-ops.cjs');
    if (!ghOpsLib.hasGhCli()) {
      return {
        ok: false,
        code: 'GH_CLI_MISSING',
        error: 'gh CLI not available — doc_drift needs gh to file issues',
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      };
    }
    for (const cand of detected.candidates) {
      const title = docDrift.formatIssueTitle(cand);
      const body = docDrift.formatIssueBody(cand);
      const tmpFile = path.join(os.tmpdir(), `hermes-docdrift-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
      fs.writeFileSync(tmpFile, body, 'utf8');
      const result = require('node:child_process').spawnSync('gh', [
        'issue', 'create',
        '--title', title,
        '--body-file', tmpFile,
        '--label', 'doc-drift',
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (result.status === 0) {
        openedIssues.push({ title, url: (result.stdout || '').trim(), candidate: cand });
      } else {
        openedIssues.push({ title, error: result.stderr || 'unknown', candidate: cand });
      }
    }
  }

  return {
    ok: true,
    touchedFiles: [],
    skip_commit: true, // gh issues only — no commit needed
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    opened_issues: openedIssues,
    drifted_count: detected.drifted_count,
    documented_count: detected.documented_count,
  };
}

// Sprint 1.8.5 — flaky_test_repair executor branch. Marker-based quarantine
// (deterministic, no LLM):
//   1. Scan source for `// HERMES-FLAKY: <reason>` markers
//   2. For each match within 3 lines of a test/it/describe declaration:
//      - Replace declaration with `<kind>.skip(...)` form
//      - Remove the HERMES-FLAKY marker line (action consumed)
//   3. Optionally open gh issue per quarantined test (skipGh=false)
//   4. Return touchedFiles for atomic commit + draft PR pipeline
async function runFlakyRepairAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = flakyRepair.detectFlakyMarkers({
    cwd: repoRoot,
    mockFiles: opts.mockFiles, // DI for tests
    maxCandidates: opts.maxCandidates || 5,
  });

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'FLAKY_REPAIR_NO_CANDIDATES',
      error: 'no HERMES-FLAKY markers found in source — mark a flaky test with `// HERMES-FLAKY: <reason>` above its declaration',
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  // Group candidates by file (we apply edits per-file to preserve line indices)
  const byFile = new Map();
  for (const cand of detected.candidates) {
    if (!byFile.has(cand.file)) byFile.set(cand.file, []);
    byFile.get(cand.file).push(cand);
  }

  const touchedFiles = [];
  const editLog = [];
  for (const [relFile, fileCands] of byFile.entries()) {
    const fullPath = path.join(repoRoot, relFile);
    let content;
    try { content = fs.readFileSync(fullPath, 'utf8'); } catch (err) {
      return {
        ok: false,
        code: 'FLAKY_REPAIR_READ_FAILED',
        error: `cannot read ${relFile}: ${err.message}`,
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      };
    }
    const { newContent, edits } = flakyRepair.applyQuarantineEdits(content, fileCands);
    if (newContent !== content) {
      fs.writeFileSync(fullPath, newContent, 'utf8');
      touchedFiles.push(relFile);
      editLog.push({ file: relFile, edits });
    }
  }

  // Optional: open gh issues for each quarantined test
  const openedIssues = [];
  if (!opts.skipGh && !opts.dryRunGh) {
    const ghOpsLib = require('./gh-ops.cjs');
    if (ghOpsLib.hasGhCli()) {
      for (const cand of detected.candidates) {
        const title = flakyRepair.formatIssueTitle(cand);
        const body = flakyRepair.formatIssueBody(cand);
        const tmpFile = path.join(os.tmpdir(), `hermes-flaky-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
        fs.writeFileSync(tmpFile, body, 'utf8');
        const result = require('node:child_process').spawnSync('gh', [
          'issue', 'create',
          '--title', title,
          '--body-file', tmpFile,
          '--label', 'flaky-test',
        ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        openedIssues.push({
          title,
          url: result.status === 0 ? (result.stdout || '').trim() : null,
          error: result.status !== 0 ? (result.stderr || '').trim() : null,
        });
      }
    }
  } else if (opts.dryRunGh) {
    for (const cand of detected.candidates) {
      openedIssues.push({ title: flakyRepair.formatIssueTitle(cand), url: 'mock://dry-run', dry_run: true });
    }
  }

  return {
    ok: true,
    touchedFiles,
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    quarantined_count: detected.candidates.length,
    edit_log: editLog,
    opened_issues: openedIssues,
  };
}

// Sprint 1.8.7 — todo_triage executor branch. Opens gh issues for fresh TODO
// markers; NO file edits, NO commit, NO PR. The signal `skip_commit: true`
// in the result tells runExecute to bypass the stage/commit/push/PR pipeline
// after this action — the gh issue creation IS the side effect.
async function runTodoTriageAction(plan, opts = {}) {
  const repoRoot = opts.repoRoot;
  const detected = todoTriage.triageTodos({
    cwd: repoRoot,
    minAgeDays: opts.minAgeDays,
    maxCandidates: opts.maxCandidates || 5,
    mockFiles: opts.mockFiles,
    mockOpenIssues: opts.mockOpenIssues,
    skipBlame: opts.skipBlame,
    skipGh: opts.skipGh,
  });

  if (detected.candidates.length === 0) {
    return {
      ok: false,
      code: 'TODO_TRIAGE_NO_CANDIDATES',
      error: `no fresh TODO markers (${detected.total_markers} found, ${detected.skipped_recent} too recent, ${detected.skipped_dup} dup vs open issues)`,
      touchedFiles: [],
      usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    };
  }

  const openedIssues = [];
  if (opts.skipGh || opts.dryRunGh) {
    // DI / dry-run path — don't actually create issues
    for (const cand of detected.candidates) {
      openedIssues.push({
        title: todoTriage.formatIssueTitle(cand),
        url: 'mock://dry-run',
        candidate: cand,
        dry_run: true,
      });
    }
  } else {
    const ghOpsLib = require('./gh-ops.cjs');
    if (!ghOpsLib.hasGhCli()) {
      return {
        ok: false,
        code: 'GH_CLI_MISSING',
        error: 'gh CLI not available — todo_triage needs gh to create issues',
        touchedFiles: [],
        usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
      };
    }
    for (const cand of detected.candidates) {
      const title = todoTriage.formatIssueTitle(cand);
      const body = todoTriage.formatIssueBody(cand);
      // Write body to tmp file (gh issue create accepts --body-file for multi-line)
      const tmpFile = path.join(os.tmpdir(), `hermes-todo-${Date.now()}-${process.pid}-${openedIssues.length}.md`);
      fs.writeFileSync(tmpFile, body, 'utf8');
      const result = require('node:child_process').spawnSync('gh', [
        'issue', 'create',
        '--title', title,
        '--body-file', tmpFile,
        '--label', 'hermes-triage',
      ], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 });
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (result.status === 0) {
        openedIssues.push({ title, url: (result.stdout || '').trim(), candidate: cand });
      } else {
        // Per-issue failure shouldn't kill the whole batch; log + continue
        openedIssues.push({ title, error: result.stderr || 'unknown', candidate: cand });
      }
    }
  }

  return {
    ok: true,
    touchedFiles: [], // no file edits
    skip_commit: true, // tell runExecute to bypass commit/push/PR pipeline
    usage: { cost_usd: 0, tokens_in: 0, tokens_out: 0 },
    opened_issues: openedIssues,
    triaged_count: openedIssues.length,
  };
}

function isStewardArtifact(p) {
  if (!p) return false;
  // Normalize Windows backslashes to forward slashes for matching
  const norm = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  // Legacy local-dogfood path (CORTEX_DATA_HOME defaults to repo cortex/).
  if (norm === 'cortex' || norm === 'cortex/journal' || norm.startsWith('cortex/journal/')) {
    return true;
  }
  // GitHub Actions path: workflows set CORTEX_DATA_HOME=$GITHUB_WORKSPACE/.cortex-data
  // so the upload-artifact step can reach the journal. Without ignoring it,
  // the dry-run step's journal write trips DIRTY_TREE on the next execute step.
  if (norm === '.cortex-data' || norm.startsWith('.cortex-data/')) {
    return true;
  }
  return false;
}

function getCleanTreeIgnoringSteward(repoRoot) {
  const status = gitOps.getCleanTreeStatus(repoRoot);
  if (status.error) return status;
  return {
    clean: (status.modified || []).filter((p) => !isStewardArtifact(p)).length === 0
        && (status.untracked || []).filter((p) => !isStewardArtifact(p)).length === 0,
    modified: (status.modified || []).filter((p) => !isStewardArtifact(p)),
    untracked: (status.untracked || []).filter((p) => !isStewardArtifact(p)),
    dirty: (status.dirty || []).filter((l) => !isStewardArtifact(l.slice(3).trim())),
  };
}

// Sprint 2.1 — autoresearch executor branch.
//
// Wires autoresearch.runAutoresearch with deps for action-engine, spec-
// verifier, npm-test, and a journal-aware judge call. Returns the same
// applyAction-shape (ok, touchedFiles, edits, cost_usd, etc.) so the rest
// of the execute pipeline (stage → commit → push → PR) is unchanged.
//
// The candidate loop runs SERIAL within one process. Each candidate:
//   1. applyAction with strategy persona + temperature
//   2. spec-verifier as deterministic gate
//   3. npm test as integration gate
//   4. rollback (git checkout -- . && git clean -fd)
// Then judge picks among passing candidates. Winner is re-applied to the
// working tree before this function returns; downstream pipeline commits.
async function runAutoresearchAction(plan, ctx) {
  const { repoRoot, engine, tracer, parentSpan, model, slug, opts } = ctx;
  const arSpan = tracer && typeof tracer.startSpan === 'function'
    ? tracer.startSpan({
      name: 'autoresearch.run',
      kind: otelEmitter.KINDS.AGENT,
      parent: parentSpan,
      attributes: {
        'gen_ai.operation.name': 'autoresearch',
        'steward.action_kind': plan.action_kind,
      },
    })
    : null;

  // Build deps for autoresearch.runAutoresearch.
  const deps = {
    applyAction: async (planArg, applyOpts) => actionEngine.applyAction(planArg, {
      repoRoot, engine, tracer, parentSpan: arSpan || parentSpan,
      model,
      personaOverlay: applyOpts && applyOpts.personaOverlay,
      temperature: applyOpts && applyOpts.temperature,
    }),
    runSpec: async (planArg, applyResult) => {
      try {
        return specVerifier.runChecks(planArg, applyResult, { repoRoot });
      } catch (err) {
        return { ok: false, code: 'SPEC_MALFORMED', error: err && err.message };
      }
    },
    runNpmTest: async () => verifier.runNpmTest({ repoRoot, timeoutMs: opts.verifyTimeoutMs }),
    rollback: async () => {
      // Discard candidate edits cleanly so the next candidate starts from
      // pre-action working tree state. checkout -- . reverts modified
      // tracked files; clean -fd removes untracked files + dirs.
      try { gitOps.git(repoRoot, ['checkout', '--', '.']); } catch { /* best-effort */ }
      try { gitOps.git(repoRoot, ['clean', '-fd']); } catch { /* best-effort */ }
    },
    judge: async ({ plan: judgePlan, candidates, judgeModel }) => {
      // Build judge prompt + call OpenRouter via fetch.
      //
      // Sprint 2.1 R2 security BLOCKER #1 fix: validate judge model against
      // the routing-table allowlist (vendor-prefix + slug regex) before any
      // egress. Compromised env or operator typo can no longer pivot judge
      // calls to arbitrary frontier models.
      if (!routingTable.isAllowedJudgeModel(judgeModel)) {
        return {
          ok: false,
          error: `judge model '${String(judgeModel).slice(0, 80)}' not in routing-table allowlist (must match vendor prefix + slug regex)`,
          code: 'AUTORESEARCH_JUDGE_MODEL_REJECTED',
          winnerIndex: null,
        };
      }
      // Sprint 2.1 R2 security BLOCKER #2 fix: re-introduce Sprint 1.6.20 H1
      // apiKey whitespace gate. Pre-fix: judge fetch path silently let
      // undici strip the Authorization header on whitespace-poisoned keys,
      // producing ambiguous 401s. Now: distinct OPENROUTER_KEY_MALFORMED.
      const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
      if (!apiKey) {
        return { ok: false, error: 'OPENROUTER_API_KEY missing for judge call', winnerIndex: null };
      }
      if (/[\s\x00-\x1f\x7f]/.test(apiKey)) {
        return {
          ok: false,
          error: 'OPENROUTER_API_KEY contains whitespace or control characters (judge call); re-set via printf %s "$KEY" | gh secret set ...',
          code: 'OPENROUTER_KEY_MALFORMED',
          winnerIndex: null,
        };
      }
      const fetchImpl = globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        return { ok: false, error: 'global fetch unavailable for judge call', winnerIndex: null };
      }
      const { systemPrompt, userPrompt } = autoresearch.buildJudgePrompt(judgePlan, candidates);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        // Use the SSOT endpoint constant from action-engine instead of the
        // duplicated literal that ssot-enforcer flagged.
        const resp = await fetchImpl(actionEngine.OPENROUTER_ENDPOINT, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/Rejnyx/cortex-x',
            'X-Title': 'cortex-x Steward (autoresearch judge)',
          },
          body: JSON.stringify({
            model: judgeModel,
            response_format: { type: 'json_object' },
            max_tokens: 512,
            temperature: 0.0, // judge is deterministic
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
          }),
        });
        clearTimeout(timer);
        if (!resp.ok) {
          // Distinguish auth (401/403) from generic transport errors so
          // operator gets the same diagnostic guidance as the openrouter engine.
          if (resp.status === 401 || resp.status === 403) {
            return { ok: false, error: `judge auth rejected HTTP ${resp.status}`, code: 'OPENROUTER_AUTH_REJECTED', winnerIndex: null };
          }
          return { ok: false, error: `judge HTTP ${resp.status}`, winnerIndex: null };
        }
        const data = await resp.json();
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        let parsed = {};
        let parseFailed = false;
        try { parsed = JSON.parse(actionEngine.stripJsonFences(content || '{}')); }
        catch { parseFailed = true; }
        if (parseFailed || !Number.isInteger(parsed.winner_index)) {
          return {
            ok: false,
            error: parseFailed ? 'judge returned malformed JSON' : 'judge response missing winner_index integer',
            winnerIndex: null,
          };
        }
        const cost = data && data.usage && Number(data.usage.cost);
        return {
          ok: true,
          winnerIndex: Math.max(0, Math.min(parsed.winner_index, candidates.length - 1)),
          rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 1000) : undefined,
          cost_usd: Number.isFinite(cost) ? cost : 0,
        };
      } catch (err) {
        clearTimeout(timer);
        return { ok: false, error: err && err.message, winnerIndex: null };
      }
    },
  };

  const N = autoresearch.readN();
  const arResult = await autoresearch.runAutoresearch(plan, deps, {
    repoRoot,
    N,
    runUsdCap: autoresearch.readRunUsdCap(),
    maxTimeMin: autoresearch.readMaxTimeMin(),
    similarityThreshold: autoresearch.readSimilarityThreshold(),
  });

  if (arSpan) {
    try {
      arSpan.setAttribute('autoresearch.N', N);
      arSpan.setAttribute('autoresearch.candidates_total', (arResult.candidates || []).length);
      const passing = (arResult.candidates || []).filter((c) => c.ok).length;
      arSpan.setAttribute('autoresearch.candidates_passing', passing);
      if (arResult.collapse) arSpan.setAttribute('autoresearch.collapse_detected', !!arResult.collapse.collapsed);
      if (arResult.judgeUsed !== undefined) arSpan.setAttribute('autoresearch.judge_used', !!arResult.judgeUsed);
      if (arResult.delta && arResult.delta.anomaly) arSpan.setAttribute('autoresearch.delta_anomaly', true);
      if (arResult.budget && typeof arResult.budget.spent_usd === 'number') {
        arSpan.setAttribute('autoresearch.spent_usd', arResult.budget.spent_usd);
      }
      arSpan.setStatus(arResult.ok ? otelEmitter.OTEL_STATUS.OK : otelEmitter.OTEL_STATUS.ERROR, arResult.error);
    } catch { /* best-effort */ }
    try { arSpan.end(); } catch { /* idempotent */ }
  }

  // Per-candidate journal entries (R1 memo §5.2 + Q6 operator decision).
  // Each candidate gets its own journal line so cortex-steward status can
  // surface candidate-level cost + spec-pass breakdown when --detailed is set.
  for (const cand of (arResult.candidates || [])) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T0',
      event: 'autoresearch_candidate',
      outcome: cand.ok ? 'success' : 'failure',
      actor: 'steward',
      action_kind: plan.action_kind,
      action_key: plan.action.action_key,
      action_id: plan.action_id,
      candidate_index: cand.index,
      strategy_label: cand.strategy_label,
      cost_usd: cand.cost_usd || 0,
      tokens_in: cand.tokens_in || 0,
      tokens_out: cand.tokens_out || 0,
      spec_pass: !!cand.spec_pass,
      npm_pass: !!cand.npm_pass,
    });
    // R2 acceptance MAJOR fix: lessons ALL-N (winners + rejected) per Q1.
    // Pre-fix: only rejected candidates with spec_failures got a lesson —
    // winners were dropped + rejected applyAction-failures (no spec_failures)
    // also dropped. Sprint 3.0 AlphaEvolve corpus needs both classes.
    if (cand.ok) {
      // Winner lessons let AlphaEvolve learn what works.
      safeRecordLesson(slug, {
        ok: true,
        code: `AUTORESEARCH_WINNER_CANDIDATE:${cand.strategy_label}`,
        info: `strategy '${cand.strategy_label}' passed spec+npm with criteria_passed=${cand.spec_criteria_passed}/${cand.spec_criteria_total}`,
      }, plan);
    } else {
      const reasonId = (cand.spec_failures && cand.spec_failures[0] && cand.spec_failures[0].id)
        || cand.code
        || (cand.spec_pass ? 'NPM_FAILED' : 'SPEC_FAILED');
      safeRecordLesson(slug, {
        ok: false,
        code: `AUTORESEARCH_REJECTED:${reasonId}`,
        error: `strategy '${cand.strategy_label}' rejected by ${reasonId}`,
      }, plan);
    }
  }

  if (!arResult.ok) {
    return {
      ok: false,
      code: arResult.code || 'AUTORESEARCH_FAILED',
      error: arResult.error,
      autoresearch: {
        candidates: (arResult.candidates || []).length,
        passing: ((arResult.candidates || []).filter((c) => c.ok)).length,
        collapse: !!(arResult.collapse && arResult.collapse.collapsed),
        spent_usd: arResult.budget && arResult.budget.spent_usd,
      },
    };
  }

  // Re-apply winner edits so the working tree has them for the downstream
  // commit pipeline. Reuse applyEditsToFilesystem directly (winner.edits
  // already passed every gate; no need to re-call the LLM).
  //
  // R2 edge MAJOR fix: filter out edits with non-string path so a malformed
  // winner.edits array (mock-engine quirk, partial response upstream) can't
  // crash applyEditsToFilesystem with a confusing error. Skip + log count.
  const winner = arResult.winner;
  const sanitizedEdits = (winner.edits || [])
    .filter((e) => e && typeof e.path === 'string' && e.path.length > 0)
    .map((e) => ({
      path: e.path,
      content: typeof e.content === 'string' ? e.content : '',
      replace_all: !!e.replace_all,
    }));
  const reapplyResult = sanitizedEdits.length > 0
    ? actionEngine.applyEditsToFilesystem(sanitizedEdits, {
      repoRoot,
      summary: `autoresearch winner (${winner.strategy_label}) re-applied`,
    })
    : { ok: false, code: 'AUTORESEARCH_WINNER_NO_VALID_EDITS', error: 'winner has no edits with non-empty path after sanitization' };

  // R2 edge MAJOR fix: write autoresearch_winner journal entry AFTER re-apply
  // confirms ok. Pre-fix: journal claimed `outcome: success` even when re-apply
  // failed. Now: outcome reflects actual ship state.
  safeJournal(slug, {
    ts: new Date().toISOString(),
    trigger: plan.trigger || 'manual',
    tier: reapplyResult.ok ? 'T0' : 'T2',
    event: 'autoresearch_winner',
    outcome: reapplyResult.ok ? 'success' : 'failure',
    actor: 'steward',
    action_kind: plan.action_kind,
    action_key: plan.action.action_key,
    action_id: plan.action_id,
    strategy_label: winner.strategy_label,
    // spec_margin = absolute criteria-passed count. Operator-approved
    // approximation per R1 memo (true baseline=0 for narrow per-recommendation
    // criteria); revisit when criteria become cross-action.
    spec_margin: winner.spec_criteria_passed || 0,
    winner_method: arResult.winner_method,
    judge_used: !!arResult.judgeUsed,
    delta_anomaly: !!(arResult.delta && arResult.delta.anomaly),
    cost_usd: arResult.budget && arResult.budget.spent_usd,
  });

  // R2 acceptance MAJOR fix: tick the Sprint 1.9.1 cross-session loop detector
  // at run-level (not candidate-level). R1 §6.5: 5× same criterion id in 7
  // days for the same action_key → STEWARD_HALT. Without this, autoresearch
  // runs that all fail on the same criterion never trip the safeguard.
  // The loop detector runs read-only inside cost-safety.cjs; here we just
  // ensure failures are journaled with action_key + spec_failures[0].id so
  // the next pre-flight gate detects the pattern.
  if (!reapplyResult.ok) {
    // Failure shape — return to caller so downstream rolls back.
    return {
      ok: false,
      code: reapplyResult.code || 'AUTORESEARCH_WINNER_REAPPLY_FAILED',
      error: reapplyResult.error || 'failed to re-apply autoresearch winner edits',
      autoresearch: {
        N: (arResult.candidates || []).length,
        passing: ((arResult.candidates || []).filter((c) => c.ok)).length,
        winner_method: arResult.winner_method,
        judge_used: !!arResult.judgeUsed,
        spent_usd: arResult.budget && arResult.budget.spent_usd,
      },
    };
  }

  // Match the applyAction return shape so downstream is happy.
  return {
    ok: true,
    touchedFiles: reapplyResult.touchedFiles || winner.touchedFiles,
    edits: reapplyResult.edits || sanitizedEdits,
    previousSizes: reapplyResult.previousSizes,
    summary: reapplyResult.summary,
    cost_usd: arResult.budget && arResult.budget.spent_usd,
    tokens_in: winner.tokens_in,
    tokens_out: winner.tokens_out,
    engine: 'autoresearch',
    autoresearch: {
      N: (arResult.candidates || []).length,
      passing: ((arResult.candidates || []).filter((c) => c.ok)).length,
      winner_method: arResult.winner_method,
      judge_used: !!arResult.judgeUsed,
      judge_disagreement: arResult.judgeDisagreement || null,
      judge_error: arResult.judgeError || null,
      collapse_detected: !!(arResult.collapse && arResult.collapse.collapsed),
      delta_anomaly: !!(arResult.delta && arResult.delta.anomaly),
      delta: arResult.delta,
      spent_usd: arResult.budget && arResult.budget.spent_usd,
    },
  };
}

// Sprint 2.0 — wraps the existing runExecute body so EVERY exit path
// (including pre-flight rejections that return early) gets an AGENT span
// in the trace. The inner function still does the actual work; this
// outer shell just owns tracer lifecycle.
async function runExecute(opts = {}) {
  const tracer = otelEmitter.createTracer({ agentName: 'steward' });
  const agentSpan = tracer.startSpan({
    name: 'steward.run',
    kind: otelEmitter.KINDS.AGENT,
    attributes: {
      'gen_ai.operation.name': 'agent',
      'steward.engine': opts.engine || readEnv('ENGINE') || 'openrouter',
    },
  });

  let result;
  try {
    result = await _runExecuteInner(opts, { tracer, agentSpan });
    return result;
  } finally {
    try {
      // Tag AGENT span with the run's result-shape so the trace is useful
      // even before the operator drills into children.
      if (result && typeof result === 'object') {
        if (result.code) agentSpan.setAttribute('steward.code', result.code);
        if (result.commit_sha) agentSpan.setAttribute('steward.commit_sha', result.commit_sha);
        if (result.branch) agentSpan.setAttribute('steward.branch', result.branch);
        if (result.exitCode !== undefined) agentSpan.setAttribute('steward.exit_code', result.exitCode);
        agentSpan.setStatus(result.ok ? otelEmitter.OTEL_STATUS.OK : otelEmitter.OTEL_STATUS.ERROR, result.error);
      }
    } catch (_) { /* best-effort tagging */ }
    try { agentSpan.end(); } catch (_) { /* idempotent */ }
    try {
      const flushResult = await tracer.flush();
      if (!flushResult.ok && tracer.enabled) {
        process.stderr.write(`[steward:otel] flush failed (reason=${flushResult.reason}${flushResult.error ? ', error=' + flushResult.error : ''})\n`);
      }
    } catch (_) { /* tracer flush must never fail the run */ }
  }
}

async function _runExecuteInner(opts, ctx) {
  const tracer = ctx.tracer;
  const agentSpan = ctx.agentSpan;
  const repoRoot = opts.repoRoot || process.cwd();
  const engine = opts.engine || readEnv('ENGINE');
  const skipVerify = opts.skipVerify === true;
  // Sprint 1.6.19: --no-push opts out of remote push + draft PR creation.
  // Default: attempt both. If remote missing or gh CLI absent, degrade
  // gracefully (commit + journal succeed; push/PR step is "optional best-effort").
  const skipPush = opts.skipPush === true || readEnv('NO_PUSH') === '1';

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

  // Phase 2.5 — Budget + circuit-breaker gates (Sprint 1.6.19)
  // Both run before lock acquisition: a tripped gate journals the refusal
  // and exits cleanly, leaving no lock for next run to recover. Cron drivers
  // see exit-code 1 + journal entry and back off until cap resets / hour
  // window passes.
  const budget = checkDailyBudget(slug);
  if (!budget.ok) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_budget_capped',
      outcome: 'skipped',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'BUDGET_CAP_REACHED',
      error: `daily spend $${budget.spent.toFixed(4)} >= cap $${budget.cap.toFixed(2)} (STEWARD_DAILY_USD_CAP)`,
      cap: budget.cap,
      spent: budget.spent,
    };
  }

  const breaker = checkFailureBreaker(slug, plan.action.action_key);
  if (!breaker.ok) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_breaker_tripped',
      outcome: 'skipped',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'FAILURE_BREAKER_TRIPPED',
      error: `${breaker.recentFailures} consecutive failures for action_key=${plan.action.action_key} in last hour >= breaker ${breaker.breaker} (STEWARD_FAILURE_BREAKER)`,
      breaker: breaker.breaker,
      recentFailures: breaker.recentFailures,
    };
  }

  // Sprint 1.9.1 — multi-window cost safety + loop detection. Layered gates
  // run BEFORE lock acquisition (same posture as daily cap above). Order:
  // weekly → monthly → token velocity → loop detector. Each gate honors `0`
  // as explicit opt-out via env. Real-incident anchor: April 2026 dev's $437
  // retry-loop bill — daily cap $5 alone would have allowed 30 days × $5 = $150
  // before any single day tripped. Weekly + monthly close that hole; token
  // velocity catches sub-daily bursts (RouteLLM ensemble, Sprint 2.1 autoresearch).
  const weekly = costSafety.checkWeeklyBudget(slug);
  if (!weekly.ok) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_budget_weekly_capped',
      outcome: 'skipped',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'BUDGET_WEEKLY_CAP_REACHED',
      error: `7-day spend $${weekly.spent.toFixed(4)} >= cap $${weekly.cap.toFixed(2)} (STEWARD_WEEKLY_USD_CAP)`,
      cap: weekly.cap,
      spent: weekly.spent,
    };
  }

  const monthly = costSafety.checkMonthlyBudget(slug);
  if (!monthly.ok) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_budget_monthly_capped',
      outcome: 'skipped',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'BUDGET_MONTHLY_CAP_REACHED',
      error: `calendar-month spend $${monthly.spent.toFixed(4)} >= cap $${monthly.cap.toFixed(2)} (STEWARD_MONTHLY_USD_CAP)`,
      cap: monthly.cap,
      spent: monthly.spent,
    };
  }

  const velocity = costSafety.checkTokenVelocity(slug);
  if (!velocity.ok) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_velocity_capped',
      outcome: 'skipped',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'TOKEN_VELOCITY_CAP_REACHED',
      error: `${velocity.total} tokens in last ${Math.round(velocity.windowMs / 1000)}s >= cap ${velocity.cap} (STEWARD_TOKEN_VELOCITY_CAP)`,
      cap: velocity.cap,
      total: velocity.total,
      windowMs: velocity.windowMs,
    };
  }

  // Cross-session loop detector — same SPEC_VIOLATION criterion id firing
  // ≥ STEWARD_LOOP_THRESHOLD times in the last STEWARD_LOOP_WINDOW_DAYS days
  // for the same action_key indicates the model cannot satisfy this
  // criterion. Halt is operator-cleared (write STEWARD_HALT, return).
  const loop = costSafety.detectCriterionLoop(slug);
  if (loop.tripped) {
    const reason = `LOOP_DETECTED:${loop.criterionId}:${loop.actionKey} count=${loop.count} threshold=${loop.threshold} window=${loop.windowDays}d`;
    try {
      const haltDir = path.join(repoRoot, '.cortex');
      fs.mkdirSync(haltDir, { recursive: true });
      fs.writeFileSync(path.join(haltDir, 'STEWARD_HALT'), `${reason}\n${new Date().toISOString()}\n`, 'utf8');
    } catch { /* halt-write best-effort; journal still records the event */ }
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_loop_detected',
      outcome: 'halted',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'LOOP_DETECTED',
      error: reason,
      criterionId: loop.criterionId,
      actionKey: loop.actionKey,
      count: loop.count,
      threshold: loop.threshold,
      windowDays: loop.windowDays,
    };
  }

  // Sprint 2.0b — per-action_kind USD cap. Layered above daily/weekly/monthly
  // caps from 1.9.1. Skipped for deterministic kinds (no LLM call, cap is
  // moot — recommendation_harvest, dep_update_patch, etc. all stay free).
  // Honors STEWARD_PER_ACTION_USD_CAP global default ($1) and
  // STEWARD_PER_ACTION_USD_CAP_<KIND> per-kind overrides. Set to 0 = opt-out.
  //
  // 2.0b R2 ssot-enforcer + edge-hunter MAJOR: derive LLM-kind set from
  // routing-table SSOT instead of hardcoded duplicate. New LLM kinds added
  // in Sprint 2.1+ (e.g. recommendation_autoresearch) automatically inherit
  // the cap without editing this file.
  if (routingTable.isLLMKind(plan.action_kind)) {
    const perAction = routingPolicy.checkPerActionBudget(slug, plan.action_kind);
    if (!perAction.ok) {
      safeJournal(slug, {
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_per_action_budget_capped',
        outcome: 'skipped',
        actor: 'steward',
        action_kind: plan.action_kind,
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      });
      return {
        ok: false,
        code: 'PER_ACTION_BUDGET_CAP_REACHED',
        error: `24-h spend on action_kind '${plan.action_kind}' reached $${perAction.spent.toFixed(4)} >= cap $${perAction.cap.toFixed(2)} (STEWARD_PER_ACTION_USD_CAP[_<KIND>])`,
        action_kind: plan.action_kind,
        cap: perAction.cap,
        spent: perAction.spent,
      };
    }
  }

  // Phase 3 — Pre-flight repo checks
  if (!gitOps.isInGitRepo(repoRoot)) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_not_git_repo',
      outcome: 'failure',
      actor: 'steward',
    });
    return { ok: false, code: 'NOT_GIT_REPO', error: `repoRoot is not a git repository: ${repoRoot}` };
  }

  // Pre-flight clean-tree check, ignoring Hermes's own runtime artifacts
  // (cortex/journal/<slug>/.lock and the journal dir itself).
  const treeStatus = getCleanTreeIgnoringSteward(repoRoot);
  if (!treeStatus.clean) {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_dirty_tree',
      outcome: 'failure',
      actor: 'steward',
    });
    return {
      ok: false,
      code: 'DIRTY_TREE',
      error: 'working tree has uncommitted changes; commit or stash before running Hermes',
      modified: treeStatus.modified,
      untracked: treeStatus.untracked,
    };
  }

  // Phase 3.5 — Detached HEAD pre-flight check (Sprint 1.6.20 H5)
  // Per edge-case audit: if `gitOps.getCurrentBranch` returns null (detached
  // HEAD) and execute proceeds, the rollback paths skip branch-checkout and
  // user is left on `plan.branch` with edits applied but not on original
  // ref. Refuse early so cron drivers see clean BAD_HEAD_STATE + retry next
  // run after Dave fixes the working state.
  const currentBranch = gitOps.getCurrentBranch(repoRoot);
  if (!currentBranch || currentBranch === 'HEAD') {
    safeJournal(slug, {
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T2',
      event: 'execute_detached_head',
      outcome: 'failure',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
    });
    return {
      ok: false,
      code: 'DETACHED_HEAD',
      error: 'HEAD is detached (or unborn); checkout a branch before running Hermes',
      currentBranch,
    };
  }

  // Phase 4 — Lock acquire
  let lockHandle;
  try {
    lockHandle = lock.acquireLock(repoRoot, slug, { actionId: plan.action_id });
  } catch (err) {
    if (err.code === 'EEXIST_FRESH') {
      return { ok: false, code: 'LOCK_HELD', error: 'Steward lock held by another process', heldBy: err.heldBy };
    }
    throw err;
  }

  // Sprint 2.0 — refine AGENT span attributes now that the plan is loaded.
  // Tracer + base AGENT span were created at the top of runExecute; we just
  // enrich them with plan-derived metadata once we have a valid plan in hand.
  agentSpan.setAttribute('steward.action_kind', plan.action_kind || 'recommendation');
  agentSpan.setAttribute('steward.action_key', plan.action.action_key);
  agentSpan.setAttribute('steward.action_id', plan.action_id);
  agentSpan.setAttribute('steward.trigger', plan.trigger || 'manual');
  agentSpan.setAttribute('steward.slug', slug);

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
        actor: 'steward',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
        branch: plan.branch,
      });
      return { ok: false, code: 'CHECKOUT_FAILED', error: checkout.stderr || checkout.error || 'unknown checkout error' };
    }

    // Phase 6 — Apply action (async — engines may make network calls).
    // Sprint 1.8.2c — typed kind dispatch. recommendation_harvest is the
    // first non-recommendation kind; runs deterministically without LLM,
    // appends to cortex/recommendations.md only. Future kinds (dep_update_patch,
    // flaky_test_repair, etc.) follow the same dispatch shape.
    let applyResult;
    if (plan.action_kind === 'recommendation_harvest') {
      applyResult = await runHarvestAction(plan, { repoRoot, harvestSignals: opts.harvestSignals });
    } else if (plan.action_kind === 'dep_update_patch') {
      applyResult = await runDepUpdateAction(plan, {
        repoRoot,
        mockOutdatedJson: opts.mockOutdatedJson,
        skipNpmInstall: opts.skipNpmInstall,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'todo_triage') {
      applyResult = await runTodoTriageAction(plan, {
        repoRoot,
        mockFiles: opts.mockFiles,
        mockOpenIssues: opts.mockOpenIssues,
        skipBlame: opts.skipBlame,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        minAgeDays: opts.minAgeDays,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'flaky_test_repair') {
      applyResult = await runFlakyRepairAction(plan, {
        repoRoot,
        mockFiles: opts.mockFiles,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'doc_drift') {
      applyResult = await runDocDriftAction(plan, {
        repoRoot,
        mockFiles: opts.mockFiles,
        mockDocsCorpus: opts.mockDocsCorpus,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'lint_fix_shipper') {
      applyResult = await runLintFixAction(plan, {
        repoRoot,
        mockEslint: opts.mockEslint,
        mockTsc: opts.mockTsc,
        dryRunFix: opts.dryRunFix,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        maxIssues: opts.maxIssues,
      });
    } else if (plan.action_kind === 'test_coverage_gap') {
      applyResult = await runCoverageGapAction(plan, {
        repoRoot,
        mockSummary: opts.mockSummary,
        mockRecentFiles: opts.mockRecentFiles,
        threshold: opts.threshold,
        lookbackDays: opts.lookbackDays,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'pr_review_responder') {
      applyResult = await runPRResponderAction(plan, {
        repoRoot,
        mockOpenPRs: opts.mockOpenPRs,
        mockCommentsByPR: opts.mockCommentsByPR,
        skipGh: opts.skipGh,
        dryRunGh: opts.dryRunGh,
        maxCandidates: opts.maxCandidates,
      });
    } else if (plan.action_kind === 'pattern_transfer') {
      // Sprint 2.7.1 hardening (R2 retro HIGH-4): kind is registered + routed
      // but executor not yet wired (LLM dispatch deferred to dedicated Sprint
      // 2.7.1 commit). Until then, fail loud rather than fall through to the
      // default LLM branch with no sibling manifest gate.
      applyResult = {
        ok: false,
        code: 'ACTION_KIND_NOT_DISPATCHABLE',
        error: 'pattern_transfer kind is registered but executor not yet implemented. Wait for Sprint 2.7.1 dedicated commit that wires sibling-reader + LLM dispatch + assertEditWithinCwd spec-verifier hook. To prevent silent runs, this branch returns a hard failure so cron operators see the gap explicitly.',
      };
    } else if (plan.action_kind === 'tech_debt_audit') {
      // Sprint 2.5 — deterministic tech debt snapshot. No LLM call.
      const techDebtAudit = require('./_lib/tech-debt-audit.cjs');
      applyResult = await techDebtAudit.runTechDebtAudit({ repoRoot });
      // Sprint 2.5 R2 fix: surface roadmap-documented signals via journal
      // so operator visibility matches the docs/steward-roadmap.md contract.
      if (applyResult.priorCorrupt) {
        safeJournal(slug, {
          ts: new Date().toISOString(),
          tier: 'T2',
          event: 'tech_debt_snapshot_corrupt',
          actor: 'steward',
          action_kind: 'tech_debt_audit',
          outcome: 'recovered',
          code: 'TECH_DEBT_SNAPSHOT_CORRUPT',
          detail: 'Prior cortex/debt-snapshot.json was malformed; treated as fresh baseline.',
        });
      }
      if (applyResult.thresholdExceeded) {
        safeJournal(slug, {
          ts: new Date().toISOString(),
          tier: 'T2',
          event: 'tech_debt_threshold_exceeded',
          actor: 'steward',
          action_kind: 'tech_debt_audit',
          outcome: 'advisory',
          code: 'TECH_DEBT_THRESHOLD_EXCEEDED',
          triggered_count: (applyResult.drift && applyResult.drift.triggered) ? applyResult.drift.triggered.length : 0,
        });
      }
    } else {
      // Sprint 2.0b — resolve LLM model via routing-table. Profile precedence:
      // CLI --routing-profile > STEWARD_ROUTING_PROFILE env > 'balanced'.
      // Model precedence (in selectModel): CLI --model > STEWARD_ROUTING_<KIND>
      // > legacy STEWARD_MODEL > profile-table[kind][profile].
      const routingProfile = opts.routingProfile || routingTable.getDefaultProfile();
      const routingResult = routingTable.selectModel({
        actionKind: plan.action_kind,
        profile: routingProfile,
        override: opts.model,
      });
      if (!routingResult.ok) {
        rollbackToOriginal(repoRoot, originalBranch, plan.branch);
        safeJournal(slug, {
          ts: new Date().toISOString(),
          trigger: plan.trigger || 'manual',
          tier: 'T2',
          event: 'execute_routing_failed',
          outcome: 'failure',
          actor: 'steward',
          action_kind: plan.action_kind,
          action_key: plan.action.action_key,
          action_id: plan.action_id,
        });
        return {
          ok: false,
          code: routingResult.code,
          error: routingResult.error,
          action_kind: plan.action_kind,
          profile: routingProfile,
        };
      }
      // Tag AGENT span with routing metadata so the trace UI can group by profile.
      agentSpan.setAttribute('steward.routing.profile', routingResult.profile);
      agentSpan.setAttribute('steward.routing.source', routingResult.source);
      if (routingResult.model) agentSpan.setAttribute('steward.routing.model', routingResult.model);

      // Sprint 2.1 — autoresearch dispatch. When mode=autoresearch is active
      // (CLI --mode flag or STEWARD_MODE env), run the N-strategy serial loop
      // instead of single-shot. Eligibility comes from routingTable SSOT
      // (R2 ssot-enforcer fix — pre-fix the equality `=== 'recommendation'`
      // duplicated the kind set, same pattern flagged in Sprint 2.0b).
      const mode = opts.mode || readEnv('MODE');
      if (mode === 'autoresearch' && routingTable.isAutoresearchEligible(plan.action_kind)) {
        applyResult = await runAutoresearchAction(plan, {
          repoRoot,
          engine,
          tracer,
          parentSpan: agentSpan,
          model: routingResult.model || undefined,
          slug,
          opts,
        });
      } else {
        applyResult = await actionEngine.applyAction(plan, {
          repoRoot,
          engine,
          tracer,
          parentSpan: agentSpan,
          model: routingResult.model || undefined,
        });
      }
    }

    if (!applyResult.ok) {
      // Sprint 1.9.0 review (correctness/HIGH): when applyEditsToFilesystem
      // rejects mid-loop (denylist / unsafe path on edit N of M), files
      // 0..N-1 are already on disk. Pre-1.9 only checked out the original
      // branch + deleted the dead branch, leaving the partial writes on
      // the working tree. Use rollbackToOriginal() — same SSOT helper as
      // STAGE_FAILED / COMMIT_FAILED.
      rollbackToOriginal(repoRoot, originalBranch, plan.branch);
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? 'T1' : 'T2',
        event: 'execute_action_failed',
        outcome: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? 'skipped' : 'failure',
        actor: 'steward',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      }, applyResult));
      // Sprint 1.8.3 — record lesson so next run avoids the same root cause
      safeRecordLesson(slug, applyResult, plan);
      return {
        ok: false,
        code: applyResult.code || 'ACTION_FAILED',
        error: applyResult.error || 'action engine returned failure',
        engine: applyResult.engine,
        next_steps: applyResult.next_steps,
        exitCode: applyResult.code === 'CLAUDE_SDK_NOT_IMPLEMENTED' ? EX_USAGE : 1,
      };
    }

    // Sprint 1.8.7 — skip_commit is the signal from runTodoTriageAction
    // (and any future no-file-edits kind) that the action's effect was via
    // gh issue creation / external system, NOT via working-tree edits.
    // Bypass stage/commit/push/PR pipeline; journal completion + return ok.
    if (applyResult.skip_commit === true) {
      if (originalBranch) {
        gitOps.git(repoRoot, ['checkout', originalBranch]);
        gitOps.git(repoRoot, ['branch', '-D', plan.branch]);
      }
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T0',
        event: 'action_completed',
        outcome: 'success',
        actor: 'steward',
        action_kind: plan.action_kind,
        action_key: plan.action.action_key,
        action_id: plan.action_id,
        skip_commit: true,
      }, applyResult));
      return {
        ok: true,
        action_kind: plan.action_kind,
        skip_commit: true,
        opened_issues: applyResult.opened_issues || [],
        triaged_count: applyResult.triaged_count || 0,
        usage: applyResult.usage,
      };
    }

    const touchedFiles = applyResult.touchedFiles || [];
    if (touchedFiles.length === 0) {
      // Sprint 1.9.0: deterministic kinds whose acceptance_criteria explicitly
      // declares `touchedFiles.length === 0` (doc_drift, todo_triage, etc.)
      // should not reach this branch — they set skip_commit=true above. If we
      // get here with no edits, it's a contract violation by the kind handler.
      if (originalBranch) {
        gitOps.git(repoRoot, ['checkout', originalBranch]);
        gitOps.git(repoRoot, ['branch', '-D', plan.branch]);
      }
      return { ok: false, code: 'NO_FILES_TOUCHED', error: 'action engine reported success but produced no edits' };
    }

    // Sprint 1.9.0 — spec-driven verification gate. Runs BEFORE npm test (Q5
    // default: cheap deterministic checks fail-fast, expensive npm test runs
    // only if spec passes). The gate enforces per-kind acceptance_criteria
    // declared in action-kinds.cjs. Generalizes the Sprint 1.8.13 hardcoded
    // EDIT_DESTRUCTIVE_REWRITE check.
    //
    // Failure model:
    //   - SPEC_VIOLATION → block-severity criterion failed → rollback
    //   - SPEC_WARNING   → only warn-severity → continue, log warnings
    //   - SPEC_MALFORMED, SPEC_PREDICATE_THREW, SPEC_SHELL_TIMEOUT,
    //     SPEC_LLM_JUDGE_NOT_IMPLEMENTED, SPEC_REGEX_NO_MATCH, SPEC_OVERRIDE_REJECTED
    //                    → fail-closed (rollback)
    let specResult = null;
    if (!opts.skipSpecVerifier) {
      // Sprint 1.9.0 review (edge HIGH-E): wrap runChecks in try/catch so a
      // bug in any runner (path.resolve(undefined), regex throw at runtime,
      // etc.) cannot leave the working tree dirty + dead branch checked out.
      // Treat uncaught throws as SPEC_MALFORMED — fail-closed.
      const specSpan = tracer.startSpan({
        name: 'spec_verifier.runChecks',
        kind: otelEmitter.KINDS.TOOL,
        parent: agentSpan,
        attributes: {
          'tool.name': 'spec_verifier',
          'gen_ai.operation.name': 'tool',
          'steward.action_kind': plan.action_kind || 'recommendation',
        },
      });
      try {
        specResult = specVerifier.runChecks(plan, applyResult, { repoRoot });
        specSpan.setAttribute('spec.ok', !!specResult.ok);
        if (!specResult.ok) {
          specSpan.setAttribute('spec.code', specResult.code || 'unknown');
          specSpan.setAttribute('spec.failure_count', (specResult.spec_failures || []).length);
          specSpan.setStatus(otelEmitter.OTEL_STATUS.ERROR, specResult.error || specResult.code);
        } else {
          specSpan.setStatus(otelEmitter.OTEL_STATUS.OK);
        }
      } catch (err) {
        specSpan.setStatus(otelEmitter.OTEL_STATUS.ERROR, err && err.message);
        specResult = {
          ok: false,
          code: 'SPEC_MALFORMED',
          error: `spec-verifier threw uncaught: ${err && err.message ? err.message : String(err)}`,
          spec_failures: [{
            id: '<runner-throw>',
            kind: 'unknown',
            severity: 'block',
            code: 'SPEC_MALFORMED',
            error: err && err.message ? err.message : String(err),
          }],
        };
      } finally {
        specSpan.end();
      }
      if (!specResult.ok) {
        // Discard working-tree edits, return to original branch, drop dead branch.
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
          event: 'execute_spec_failed',
          outcome: 'failure',
          actor: 'steward',
          action_kind: plan.action_kind,
          action_key: plan.action.action_key,
          action_id: plan.action_id,
          spec_failures: specResult.spec_failures || [],
        }, applyResult));
        // Sprint 1.8.3 — record lesson so next run avoids the same root cause.
        // Sprint 1.9.0 review (acceptance/MED): root_cause encodes the failing
        // criterion id as `<CODE>:<criterion_id>` per the R1 memo's AC. This
        // lets recallLessons surface "no_destructive_rewrite keeps firing on
        // recommendation kind" without parsing free-text lesson_text.
        const failureId = (specResult.spec_failures && specResult.spec_failures[0] && specResult.spec_failures[0].id) || 'unknown';
        safeRecordLesson(slug, {
          ok: false,
          code: `${specResult.code}:${failureId}`,
          error: specResult.error || `criterion '${failureId}' rejected the action`,
        }, plan);
        return {
          ok: false,
          code: specResult.code,
          error: specResult.error || `spec-verifier rejected at criterion ${failureId}`,
          spec_failures: specResult.spec_failures || [],
          touchedFiles,
        };
      }
    }

    // Phase 7 — Verifier
    let verifyResult = null;
    if (!skipVerify) {
      // Sprint 2.0 review (blind/edge HIGH): wrap in try/finally so the span
      // always ends even if runNpmTest itself throws (e.g. EBUSY on Windows
      // npm cache, EAGAIN on spawned process). Throw still propagates.
      const verifySpan = tracer.startSpan({
        name: 'verifier.npm_test',
        kind: otelEmitter.KINDS.TOOL,
        parent: agentSpan,
        attributes: {
          'tool.name': 'npm_test',
          'gen_ai.operation.name': 'tool',
        },
      });
      try {
        verifyResult = verifier.runNpmTest({ repoRoot, timeoutMs: opts.verifyTimeoutMs });
        verifySpan.setAttribute('verify.ok', !!verifyResult.ok);
        if (verifyResult.exitCode !== undefined) verifySpan.setAttribute('verify.exit_code', verifyResult.exitCode);
        if (verifyResult.durationMs !== undefined) verifySpan.setAttribute('verify.duration_ms', verifyResult.durationMs);
        verifySpan.setStatus(verifyResult.ok ? otelEmitter.OTEL_STATUS.OK : otelEmitter.OTEL_STATUS.ERROR);
      } catch (err) {
        verifySpan.setStatus(otelEmitter.OTEL_STATUS.ERROR, err && err.message);
        throw err;
      } finally {
        verifySpan.end();
      }
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
          actor: 'steward',
          action_key: plan.action.action_key,
          action_id: plan.action_id,
        }, applyResult));
        // Sprint 1.8.3 — record lesson on verify-fail (most common LLM regression)
        safeRecordLesson(slug, {
          ok: false,
          code: 'NPM_TEST_FAILED',
          error: 'npm test failed after action edits; rolled back',
        }, plan);
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
      // Sprint 1.6.21 (T4): STAGE_FAILED previously returned without rollback
      // — leaving user on dead branch with edits applied. Now: discard working
      // tree changes, return to originalBranch, delete dead branch, journal.
      rollbackToOriginal(repoRoot, originalBranch, plan.branch);
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_stage_failed',
        outcome: 'failure',
        actor: 'steward',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      }, applyResult));
      return { ok: false, code: 'STAGE_FAILED', error: stageResult.stderr || stageResult.error };
    }

    const commitMsgFile = writeCommitMessageToTmp(plan.commit_message);
    const commitResult = gitOps.commitWithMessageFile(repoRoot, commitMsgFile);
    try { fs.unlinkSync(commitMsgFile); } catch { /* tmpfile cleanup best-effort */ }

    if (!commitResult.ok) {
      // Sprint 1.6.21 (T4): COMMIT_FAILED previously returned without rollback.
      // Same recovery as STAGE_FAILED: discard tree, return to original ref,
      // delete dead branch.
      rollbackToOriginal(repoRoot, originalBranch, plan.branch);
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_commit_failed',
        outcome: 'failure',
        actor: 'steward',
        action_key: plan.action.action_key,
        action_id: plan.action_id,
      }, applyResult));
      return { ok: false, code: 'COMMIT_FAILED', error: commitResult.stderr || commitResult.error };
    }

    // Phase 9 — Post-commit verification
    // Only fail if there are MODIFIED (tracked) files left over — those would
    // indicate a partial commit. Untracked files are expected (the lock file
    // at cortex/journal/<slug>/.lock is itself an untracked runtime artifact
    // by design, and projects often have other untracked working files).
    const postStatus = getCleanTreeIgnoringSteward(repoRoot);
    if (postStatus.modified && postStatus.modified.length > 0) {
      safeJournal(slug, addCostFields({
        ts: new Date().toISOString(),
        trigger: plan.trigger || 'manual',
        tier: 'T2',
        event: 'execute_post_verify_failed',
        outcome: 'failure',
        actor: 'steward',
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

    // Phase 10 — Push branch + open draft PR (Sprint 1.6.19)
    //
    // Best-effort, non-blocking for journal-success. Push and PR creation
    // each have their own degradation modes (no remote / no gh CLI / auth
    // failure) — when any step fails, journal an info entry and return
    // success with a `pr` substruct describing what got skipped or failed.
    // The commit ALWAYS lands locally; remote propagation is the optional
    // upgrade path. cron + GHA contexts will have remote + GH_TOKEN +
    // gh CLI; local dogfood may not.
    // Sprint 2.0 review (blind/edge HIGH): wrap in try/finally so the span
    // always ends even if maybePushAndOpenPR throws (gh CLI may exit with
    // unexpected error shapes; auth races; network drops mid-call).
    const prSpan = tracer.startSpan({
      name: 'gh.push_and_pr',
      kind: otelEmitter.KINDS.TOOL,
      parent: agentSpan,
      attributes: {
        'tool.name': 'git_commit_and_pr',
        'gen_ai.operation.name': 'tool',
        'steward.skip_push': !!skipPush,
      },
    });
    // Sprint 2.1 R2 acceptance MAJOR fix: when autoresearch's both-orderings
    // judge disagreed and we fell back to spec-margin, label the PR
    // `judge-disagreement` so the operator can review with extra scrutiny
    // (Q2 operator decision: don't block, but surface).
    const prLabels = [];
    if (applyResult && applyResult.autoresearch) {
      if (applyResult.autoresearch.judge_disagreement) prLabels.push('judge-disagreement');
      if (applyResult.autoresearch.delta_anomaly) prLabels.push('autoresearch-delta-anomaly');
      if (applyResult.autoresearch.collapse_detected) prLabels.push('autoresearch-collapse');
    }
    let prResult;
    try {
      prResult = await maybePushAndOpenPR({
        repoRoot, plan, slug, skipPush, prLabels,
      });
      prSpan.setAttribute('pr.status', prResult.status || 'unknown');
      if (prResult.url) prSpan.setAttribute('pr.url', prResult.url);
      if (prResult.reason) prSpan.setAttribute('pr.reason', prResult.reason);
      prSpan.setStatus(
        prResult.status === 'created' || prResult.status === 'pushed' || prResult.status === 'skipped'
          ? otelEmitter.OTEL_STATUS.OK
          : otelEmitter.OTEL_STATUS.ERROR,
      );
    } catch (err) {
      prSpan.setStatus(otelEmitter.OTEL_STATUS.ERROR, err && err.message);
      throw err;
    } finally {
      prSpan.end();
    }

    // Phase 11 — Journal success (cost/tokens via shared addCostFields helper)
    safeJournal(slug, addCostFields({
      ts: new Date().toISOString(),
      trigger: plan.trigger || 'manual',
      tier: 'T0',
      event: 'action_completed',
      outcome: 'success',
      actor: 'steward',
      action_key: plan.action.action_key,
      action_id: plan.action_id,
      branch: plan.branch,
      pr_url: prResult.url,
      pr_status: prResult.status,
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
      pr: prResult,
      trace_id: tracer.traceId,
    };
  } finally {
    // Sprint 2.0 — AGENT span end + tracer flush moved to the outer wrapper
    // (runExecute), so even pre-flight returns get a trace. Lock release
    // stays here because lockHandle scope is local to this inner function.
    lock.releaseLock(lockHandle);
  }
}

module.exports = {
  runExecute,
  loadPlan,
  addCostFields,
  // Sprint 2.1 — autoresearch dispatch helper exported for unit testing.
  runAutoresearchAction,
  // Sprint 1.8.2c — harvester helpers exported for unit testing
  appendCandidatesToRecsBody,
  runHarvestAction,
  // Sprint 1.8.4 — dep_update_patch helpers exported for unit testing
  runDepUpdateAction,
  // Sprint 1.8.7 — todo_triage helper exported for unit testing
  runTodoTriageAction,
  // Sprint 1.8.5 — flaky_test_repair helper exported for unit testing
  runFlakyRepairAction,
  // Sprint 1.8.6 — doc_drift helper exported for unit testing
  runDocDriftAction,
  // Sprint 1.8.9 — lint_fix_shipper helper exported for unit testing
  runLintFixAction,
  // Sprint 1.8.10 — test_coverage_gap helper exported for unit testing
  runCoverageGapAction,
  // Sprint 1.8.11 — pr_review_responder helper exported for unit testing
  runPRResponderAction,
  // Sprint 1.8.12 — halt-check artifact filter exported for unit testing
  isStewardArtifact,
  EX_USAGE,
};

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  // Sprint 2.0b R2 edge-hunter MAJOR fix: when `--name` is followed by another
  // flag (e.g. `--model --skip-verify`), `args[idx+1]` was previously
  // returned as the value, silently shipping `--skip-verify` to OpenRouter
  // as a model slug. Reject values that start with `--` so the next flag is
  // treated as missing-value (returns undefined, falls through to env/default).
  const flagValue = (name) => {
    const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (idx === -1) return undefined;
    const eq = args[idx].indexOf('=');
    if (eq >= 0) return args[idx].slice(eq + 1);
    const next = args[idx + 1];
    if (typeof next !== 'string') return undefined;
    if (next.startsWith('--')) return undefined;
    return next;
  };

  if (args.includes('--help') || args.includes('-h')) {
    console.log('steward execute — run a dry-run plan against the working tree');
    console.log('');
    console.log('Usage: steward execute --plan-file=<path-to-dry-run-json> [options]');
    console.log('  --plan-file <path>     path to a JSON file from `steward dry-run --json`');
    console.log('  --repo-root <path>     project root (default: cwd)');
    // Sprint 2.4 R2 fix (SSOT MAJOR-1): derive engine list from the registry
    // exported by action-engine.cjs to prevent help-text drift.
    const { ENGINES } = require('./_lib/action-engine.cjs');
    const engineList = Object.keys(ENGINES).join(' | ');
    console.log(`  --engine <name>        action engine: ${engineList} (default: openrouter)`);
    console.log('  --routing-profile <p>  cheap | balanced | premium | ensemble (default: balanced)');
    console.log('  --model <slug>         one-shot model override (wins over profile table + envs)');
    console.log('  --mode <name>          execution mode: single (default) | autoresearch (Sprint 2.1)');
    console.log('  --skip-verify          skip the npm test gate (DANGEROUS; tests only)');
    console.log('  --no-push              commit locally only — skip git push + draft PR (default: push if remote exists)');
    console.log('  --json                 machine-readable output');
    console.log('  --quiet                silent on success');
    console.log('  --help                 this help');
    console.log('');
    console.log('Engine selection (precedence): --engine flag > STEWARD_ENGINE env > openrouter');
    console.log('Model selection (precedence): --model flag > STEWARD_ROUTING_<KIND> env >');
    console.log('  STEWARD_MODEL legacy env > profile-table[kind][profile] > balanced default');
    console.log('Profile selection (precedence): --routing-profile flag > STEWARD_ROUTING_PROFILE env > balanced');
    console.log('');
    console.log('openrouter engine: real LLM via fetch (zero-deps). Requires OPENROUTER_API_KEY.');
    console.log('  See docs/steward-routing.md for the per-action_kind × profile model table.');
    console.log('claude-cli engine (Sprint 2.4): spawns local `claude -p` under Max sub OAuth.');
    console.log('  Requires CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`). Marginal cost = $0.');
    console.log('  Three-layer billing-leak defense: env scrub + total_cost_usd===0 assert + STEWARD_HALT.');
    console.log('claude-sdk engine: stub returning CLAUDE_SDK_NOT_IMPLEMENTED + exit 64 (opt-in).');
    console.log('mock engine reads STEWARD_MOCK_PLAN env var as the edit script.');
    process.exit(0);
  }

  const wantJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  const skipVerify = args.includes('--skip-verify');
  const skipPush = args.includes('--no-push');
  const planFile = flagValue('plan-file');
  const engine = flagValue('engine');
  // Sprint 2.0b — routing flags.
  const routingProfile = flagValue('routing-profile');
  const modelOverride = flagValue('model');
  // Sprint 2.1 — autoresearch mode flag.
  const mode = flagValue('mode');

  // CLI is async because runExecute now awaits the action engine
  (async () => {
    const result = await runExecute({
      planFile,
      repoRoot: flagValue('repo-root'),
      engine,
      skipPush,
      skipVerify,
      routingProfile,
      model: modelOverride,
      mode,
    });
    return result;
  })().then(handleResult).catch((err) => {
    process.stderr.write(`Steward execute crashed: ${err.message}\n`);
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
      console.log(`[steward execute] ✓ slug=${result.slug}`);
      console.log(`  branch: ${result.branch}`);
      console.log(`  commit: ${result.commit_sha}`);
      console.log(`  files:  ${result.touched_files.join(', ')}`);
      console.log(`  verify: ${result.verifier}`);
      console.log(`  engine: ${result.engine}`);
      if (result.pr) {
        if (result.pr.status === 'created') {
          console.log(`  PR:     ${result.pr.url}`);
        } else if (result.pr.status === 'pushed') {
          console.log('  PR:     branch pushed (PR creation skipped)');
        } else {
          console.log(`  PR:     ${result.pr.status}${result.pr.reason ? ' — ' + result.pr.reason : ''}${result.pr.error ? ' — ' + result.pr.error : ''}`);
        }
      }
    } else if (result.code === 'CLAUDE_SDK_NOT_IMPLEMENTED') {
      console.log('steward execute — claude-sdk engine NOT_IMPLEMENTED (stub only)');
      console.log('');
      console.log('  Use the openrouter engine instead (default since Sprint 1.6.13):');
      console.log('    --engine=openrouter   (or unset --engine for the default)');
      console.log('  Or the mock engine for offline tests:');
      console.log('    --engine=mock   (STEWARD_MOCK_PLAN env var supplies the edit JSON)');
    } else {
      process.stderr.write(`Error: ${result.error || result.code}\n`);
    }
  }

    if (result.ok) process.exit(0);
    if (result.exitCode) process.exit(result.exitCode);
    process.exit(1);
  }
}
