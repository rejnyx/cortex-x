// dry-run.cjs — Steward dry-run orchestrator (no LLM call).
//
// Implements every step of the Steward core loop EXCEPT the actual LLM call:
//   1. Halt check (kill switch)
//   2. Lock acquire
//   3. Read journal (skip already-processed actions)
//   4. Parse recommendations.md
//   5. Pick next action
//   6. Build the commit plan (subject + body + trailers + branch name)
//   7. Append journal entry (event: dry_run_completed | no_actionable_step)
//   8. Lock release
//
// Output: a structured plan object printed to stdout (or returned from runDryRun
// when called as a library). The plan describes WHAT Steward would do; the
// actual file edits + git operations require the LLM and are deferred to v0.5.
//
// CLI:
//   node bin/steward/dry-run.cjs --slug=<slug> [--repo-root=<path>]
//                              [--trigger=cron|incident|pr-merged|manual]
//                              [--json] [--quiet]
//
// Exit codes:
//   0  — plan produced (or no_actionable_step; both are success states)
//   1  — error (parse failure, lock collision, schema violation)
//   75 — halted (STEWARD_HALT sentinel present)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const haltCheck = require('./_lib/halt-check.cjs');
const lock = require('./_lib/lock.cjs');
const journal = require('./_lib/journal.cjs');
const recommendations = require('./_lib/recommendations.cjs');
const trailers = require('./_lib/git-trailers.cjs');
const policy = require('./_lib/policy-check.cjs');
const actionKinds = require('./_lib/action-kinds.cjs');
const worktreeGuard = require('./_lib/worktree-guard.cjs');

const DEFAULT_TRIGGER = 'manual';

// Slugify a title for branch naming. "Add subtract function" → "add-subtract-function"
function slugifyTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '');
}

function shortId(actionId) {
  // Last 4 chars of the ulid for readable branch suffix
  return String(actionId).slice(-4).toLowerCase();
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function buildBranchName(action, actionId, isoDate) {
  const slug = slugifyTitle(action.title);
  const id = shortId(actionId);
  return `steward/${isoDate}-${slug}-${id}`;
}

function buildHeadingAnchor(item) {
  // GitHub-style anchor: lowercase, spaces→hyphens, drop punctuation
  return slugifyTitle(`${item.num}-${item.title}`);
}

// Read journal entries for this slug across the last N days (default 14).
// Returns the set of action_ids that were marked outcome:success or
// dry_run_completed — those are "already processed" and should be skipped.
function readProcessedActionIds(slug, daysBack = 14) {
  const processed = new Set();
  const todayMs = Date.now();
  for (let i = 0; i < daysBack; i += 1) {
    const ts = todayMs - i * 24 * 60 * 60 * 1000;
    const d = new Date(ts).toISOString().slice(0, 10);
    const entries = journal.readJournal(slug, { date: d });
    for (const entry of entries) {
      if (entry._corrupted) continue;
      const completed = entry.outcome === 'success'
        || entry.event === 'dry_run_completed'
        || entry.event === 'action_completed';
      if (completed && entry.action_key) {
        processed.add(entry.action_key);
      }
    }
  }
  return processed;
}

// Sprint 2.9.6 dispatcher fix — synthetic plan builder for deterministic kinds.
// Returns the same shape as recommendation_harvest plan so execute.cjs can
// pick it up and dispatch to runTodoTriageAction / runDepUpdateAction / etc.
//
// All fields are stub-shaped because the actual detector run happens at
// execute-time (live-tree re-detection for atomic rollback semantics). The
// dry-run plan exists for journaling + lock acquisition + cron-skip on
// no_actionable_step (which the dry-run does NOT determine for these kinds —
// the executor decides per-detector at run-time).
function buildDeterministicPlan({ slug, trigger, isoDate, kind, synthTitle, synthBodyPrefix, skipCommit }) {
  const actionId = trailers.ulid();
  const actionKey = `${slug}#${kind}-${isoDate}`;
  const branchName = skipCommit
    ? null
    : `steward/${isoDate}-${slug}-${kind.replace(/_/g, '-')}-${shortId(actionId)}`;
  const plan = {
    ok: true,
    mode: 'dry-run',
    slug,
    action_kind: kind,
    action: {
      num: null,
      title: synthTitle,
      body: synthBodyPrefix,
      citations: [],
      section: null,
      action_key: actionKey,
    },
    branch: branchName,
    action_id: actionId,
    trigger,
    skip_commit: skipCommit,
  };
  if (!skipCommit) {
    plan.planned_commit = {
      type: 'feat',
      scope: slug,
      subject: synthTitle.slice(0, 72),
      body: synthBodyPrefix,
      trailers: {
        'Steward-Action-Id': actionId,
        'Steward-Journal-Entry': `~/.cortex/journal/${slug}/${isoDate}.jsonl`,
        'Steward-Trigger': trigger,
        'Steward-Action-Kind': kind,
        // Sprint 2.9.6: deterministic kinds don't pick from recommendations.md;
        // the source IS the detector that produced the candidates.
        'Steward-Recommendation-Source': `deterministic-detector (${kind})`,
      },
    };
    plan.commit_message = trailers.buildCommitMessage(plan.planned_commit);
  }
  journal.appendJournal(slug, {
    ts: new Date().toISOString(),
    trigger,
    tier: 'T0',
    event: 'dry_run_completed',
    outcome: 'success',
    actor: 'steward',
    action_kind: kind,
    action_key: actionKey,
    action_id: actionId,
    branch: branchName,
  });
  return plan;
}

function runDryRun(opts = {}) {
  const slug = opts.slug;
  if (!slug) {
    return { ok: false, error: 'slug is required', code: 'MISSING_SLUG' };
  }

  const repoRoot = opts.repoRoot || process.cwd();
  const trigger = opts.trigger || DEFAULT_TRIGGER;
  const isoDate = opts.isoDate || todayISODate();
  // Sprint 1.8.2c — typed kind dispatch. Default 'recommendation'
  // (backwards-compat with all 1.6.X / 1.7.X usage).
  const kind = opts.kind || actionKinds.DEFAULT_KIND;
  if (!actionKinds.isSupportedKind(kind)) {
    return {
      ok: false,
      error: `unknown action_kind '${kind}'. Supported: ${actionKinds.listKinds().join(', ')}`,
      code: 'UNKNOWN_KIND',
    };
  }

  // Sprint 2.30: worktree pre-flight. Steward commits + pushes against
  // `main` of the PRIMARY worktree. Running from a secondary worktree would
  // land commits on the wrong branch. STEWARD_ALLOW_WORKTREE=1 opts out.
  const worktreeCheck = worktreeGuard.checkWorktree({ cwd: repoRoot });
  if (!worktreeCheck.ok && worktreeCheck.code === 'STEWARD_WORKTREE_DENIED') {
    return {
      ok: false,
      code: worktreeCheck.code,
      current: worktreeCheck.current,
      primary: worktreeCheck.primary,
      bypassEnv: worktreeCheck.bypassEnv,
      message: worktreeCheck.message,
      exitCode: haltCheck.EX_TEMPFAIL,
    };
  }

  // Step 1 — Halt check
  const halted = haltCheck.isHalted({ repoRoot });
  if (halted.halted) {
    return {
      ok: false,
      halted: true,
      reason: halted.reason,
      sentinelPath: halted.sentinelPath,
      exitCode: haltCheck.EX_TEMPFAIL,
    };
  }

  // Step 2 — Recommendations file location.
  // Sprint 2.9.6: only enforce existence for kinds that actually read from
  // recommendations.md. Deterministic kinds (todo_triage, dep_update_patch,
  // doc_drift, etc.) run their own detectors and don't need the file.
  const recsPath = opts.recommendationsPath
    || path.join(repoRoot, 'cortex', 'recommendations.md');
  const kindNeedsRecommendations = (kind === actionKinds.DEFAULT_KIND
    || kind === 'recommendation_harvest');
  if (kindNeedsRecommendations && !fs.existsSync(recsPath)) {
    return {
      ok: false,
      error: `recommendations.md not found at ${recsPath}`,
      code: 'MISSING_RECOMMENDATIONS',
    };
  }

  // Step 3 — Acquire lock
  let lockHandle;
  try {
    lockHandle = lock.acquireLock(repoRoot, slug, {
      actionId: 'pending',
      actionTimeoutMs: opts.actionTimeoutMs,
    });
  } catch (err) {
    if (err.code === 'EEXIST_FRESH') {
      return {
        ok: false,
        error: 'Steward lock held by another process',
        code: 'LOCK_HELD',
        heldBy: err.heldBy,
      };
    }
    throw err;
  }

  try {
    // Sprint 2.9.6 dispatcher fix — deterministic kinds run their own
    // detectors and don't read from recommendations.md. Skip the
    // parse + slug-check gate for them. Only `recommendation` and
    // `recommendation_harvest` need recommendations.md.
    const KINDS_REQUIRING_RECOMMENDATIONS_MD = new Set([
      actionKinds.DEFAULT_KIND,        // 'recommendation'
      'recommendation_harvest',
    ]);

    let parsed = null;
    if (KINDS_REQUIRING_RECOMMENDATIONS_MD.has(kind)) {
      // Step 4 — Parse recommendations (only for kinds that need it).
      // recommendation_harvest appends NEW items, so an empty `## DO this week`
      // is not an error — skip the strict ≥1-action-item gate for harvest.
      const requireActionItems = kind !== 'recommendation_harvest';
      try {
        parsed = recommendations.parseRecommendations(recsPath, { requireActionItems });
      } catch (err) {
        journal.appendJournal(slug, {
          ts: new Date().toISOString(),
          trigger,
          tier: 'T2',
          event: 'recommendations_parse_failed',
          outcome: 'failure',
          actor: 'steward',
        });
        return {
          ok: false,
          error: `recommendations parse failed: ${err.message}`,
          code: 'PARSE_FAILED',
        };
      }

      if (parsed.frontmatter.slug !== slug) {
        // Sprint LR.Y 2026-05-13: distinguish "placeholder template ships in
        // repo, no real recommendations yet" from "wrong project's file."
        // Placeholder slugs (TODO, <your project>, ...) come from the fresh-
        // install scaffold template — `cortex/recommendations.md` ships with
        // these so /cortex-init can populate them. The harvest + nightly crons
        // running against an un-edited template should gracefully no-op, not
        // hard-fail. Real mismatches (different real slug) keep SLUG_MISMATCH.
        //
        // R2 review pipeline hardening (2026-05-13):
        //   - case-insensitive + extended placeholder set (TBD, FIXME, XXX)
        //     per edge-case-hunter HIGH #2 (operator typing `slug: todo` was
        //     getting SLUG_MISMATCH instead of graceful skip)
        //   - null/undefined slug treated as placeholder (operator intent:
        //     "I haven't set this yet" — same as `slug: TODO`)
        //   - journal outcome:'skipped' for consistency with other no-action
        //     paths in dry-run.cjs (correctness-auditor MED)
        //   - file_slug shape unified to null (no '(empty)' string sentinel)
        const raw = parsed.frontmatter.slug;
        const fileSlug = String(raw == null ? '' : raw).trim();
        const PLACEHOLDER_LITERALS = new Set(['TODO', 'TBD', 'FIXME', 'XXX', 'PLACEHOLDER']);
        const isPlaceholder = raw == null
          || fileSlug === ''
          || PLACEHOLDER_LITERALS.has(fileSlug.toUpperCase())
          || /^<[^>]*>$/.test(fileSlug);
        if (isPlaceholder) {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T2',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            reason: 'placeholder_slug_in_recommendations_md',
            file_slug: fileSlug || null,
          });
          return {
            ok: true,
            mode: 'dry-run',
            no_actionable_step: true,
            reason: 'placeholder_slug_in_recommendations_md',
            slug,
            file_slug: fileSlug || null,
          };
        }
        return {
          ok: false,
          error: `slug mismatch: CLI=${slug}, recommendations.md=${parsed.frontmatter.slug}`,
          code: 'SLUG_MISMATCH',
        };
      }
    }

    // Sprint 1.8.2c — kind dispatch. recommendation_harvest skips action
    // selection (it's not picking an existing item — it's appending NEW ones).
    if (kind === 'recommendation_harvest') {
      const harvester = require('../../detectors/recommendation-harvest.cjs');
      const recsBody = fs.readFileSync(recsPath, 'utf8');
      const harvest = harvester.harvest({
        recommendationsBody: recsBody,
        maxCandidates: opts.maxCandidates || 3,
      });

      if (harvest.candidates.length === 0) {
        journal.appendJournal(slug, {
          ts: new Date().toISOString(),
          trigger,
          tier: 'T0',
          event: 'no_actionable_step',
          outcome: 'skipped',
          actor: 'steward',
          action_kind: 'recommendation_harvest',
        });
        return {
          ok: true,
          no_actionable_step: true,
          slug,
          action_kind: 'recommendation_harvest',
          harvest_signals: harvest.total_signals,
          deduped_count: harvest.deduped_count,
        };
      }

      // Build harvest-shaped plan. Synthetic action because harvest doesn't
      // pick from recommendations.md — it appends to it.
      const actionId = trailers.ulid();
      const harvestActionKey = `${slug}#harvest-${isoDate}`;
      const branchName = `steward/${isoDate}-recommendation-harvest-${shortId(actionId)}`;
      const harvestTitle = `Harvest ${harvest.candidates.length} recommendation${harvest.candidates.length > 1 ? 's' : ''} from gh signals`;
      const harvestBody = `Read-only harvest of closed PRs + CI failures + open issues, appended ${harvest.candidates.length} candidate${harvest.candidates.length > 1 ? 's' : ''} to cortex/recommendations.md (${harvest.total_signals} signals examined, ${harvest.deduped_count} deduped vs existing).`;

      const plan = {
        ok: true,
        mode: 'dry-run',
        slug,
        action_kind: 'recommendation_harvest',
        action: {
          num: null,
          title: harvestTitle,
          body: harvestBody,
          citations: harvest.candidates.map((c) => c.source_url).filter(Boolean),
          section: null,
          action_key: harvestActionKey,
        },
        harvest: {
          candidates: harvest.candidates,
          appendable_lines: harvester.formatAsRecommendationLines(harvest.candidates),
          total_signals: harvest.total_signals,
          deduped_count: harvest.deduped_count,
        },
        branch: branchName,
        action_id: actionId,
        trigger,
        planned_commit: {
          type: 'feat',
          scope: slug,
          subject: harvestTitle.slice(0, 72),
          body: harvestBody,
          trailers: {
            'Steward-Action-Id': actionId,
            'Steward-Journal-Entry': `~/.cortex/journal/${slug}/${isoDate}.jsonl`,
            'Steward-Trigger': trigger,
            'Steward-Recommendation-Source': `harvester (${harvest.candidates.length} new)`,
            'Steward-Action-Kind': 'recommendation_harvest',
          },
        },
      };
      plan.commit_message = trailers.buildCommitMessage(plan.planned_commit);

      journal.appendJournal(slug, {
        ts: new Date().toISOString(),
        trigger,
        tier: 'T0',
        event: 'dry_run_completed',
        outcome: 'success',
        actor: 'steward',
        action_kind: 'recommendation_harvest',
        action_key: harvestActionKey,
        action_id: actionId,
        branch: branchName,
        harvest_count: harvest.candidates.length,
      });
      return plan;
    }

    // Sprint 2.9.6 dispatcher fix — deterministic kinds (todo_triage,
    // dep_update_patch) had cron workflows since Sprint 1.8.4/1.8.7 but never
    // worked end-to-end because the dry-run dispatcher only knew about
    // recommendation + recommendation_harvest. Other kinds fell through to
    // the default recommendation flow and tried to invoke the LLM.
    //
    // Pattern: each deterministic kind runs its detector here in dry-run
    // (cheap, no LLM, no side effects), checks for candidates, and either
    // returns no_actionable_step or builds a synthetic plan. The executor
    // (execute.cjs) re-runs the detector itself — that's intentional duplication
    // for atomic rollback semantics: dry-run output is advisory, executor
    // re-detects against the live tree at execution time.
    if (kind === 'todo_triage') {
      // Sprint 2.9.6 fix: run detector at dry-run time so we get clean
      // no_actionable_step exits when there's nothing to triage. Detector is
      // cheap (filesystem walk + git blame), no network. Saves an execute-side
      // failure when there are no fresh TODOs.
      try {
        const todoTriage = require('../../detectors/todo-triage.cjs');
        const detected = todoTriage.triageTodos({ cwd: repoRoot, skipBlame: true, skipGh: true });
        if (detected.candidates.length === 0) {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T0',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            action_kind: 'todo_triage',
            total_markers: detected.total_markers,
            skipped_recent: detected.skipped_recent,
            skipped_dup: detected.skipped_dup,
          });
          return {
            ok: true,
            no_actionable_step: true,
            slug,
            action_kind: 'todo_triage',
            total_markers: detected.total_markers,
          };
        }
      } catch (e) {
        // Detector failure is not fatal — fall through to plan-shape so
        // executor can re-detect with full context (and surface its own error).
      }
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: 'Triage stale TODO markers',
        synthBodyPrefix: 'Open gh issues for fresh TODO/FIXME/XXX/HACK markers older than threshold (deterministic; no LLM, no file edits).',
        skipCommit: true,
      });
    }

    if (kind === 'dep_update_patch') {
      // Sprint 2.9.6 fix: dry-run detector probe — exit clean if no patch
      // updates available rather than failing at execute-time.
      try {
        const depPatch = require('../../detectors/dep-update-patch.cjs');
        const detected = depPatch.detectPatchUpdates({ cwd: repoRoot });
        if (!detected || !detected.candidates || detected.candidates.length === 0) {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T0',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            action_kind: 'dep_update_patch',
            outdated_count: (detected && detected.outdated_count) || 0,
          });
          return {
            ok: true,
            no_actionable_step: true,
            slug,
            action_kind: 'dep_update_patch',
            outdated_count: (detected && detected.outdated_count) || 0,
          };
        }
      } catch (e) {
        // Probe failure (npm not in PATH on weird hosts) → fall through.
      }
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: 'Patch-only npm dependency updates',
        synthBodyPrefix: 'Run npm outdated, classify wanted vs current as patch-only, npm install --save the patch upgrades, npm test gate (deterministic; no LLM).',
        skipCommit: false,
      });
    }

    if (kind === 'doc_drift' || kind === 'flaky_test_repair' || kind === 'lint_fix_shipper'
        || kind === 'test_coverage_gap' || kind === 'pr_review_responder'
        || kind === 'tech_debt_audit' || kind === 'evolve_daily' || kind === 'evolve_weekly') {
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: `Run ${kind} detector`,
        synthBodyPrefix: `Sprint 2.9.6: deterministic ${kind} kind dispatched via dry-run. Executor will run the detector against the live tree.`,
        // tech_debt_audit + flaky_test_repair + lint_fix_shipper EDIT files;
        // others (doc_drift, test_coverage_gap, pr_review_responder, todo_triage,
        // evolve_daily, evolve_weekly) are issue-only / rollup-only with skip_commit=true.
        skipCommit: kind === 'doc_drift' || kind === 'test_coverage_gap'
                    || kind === 'pr_review_responder' || kind === 'evolve_daily'
                    || kind === 'evolve_weekly',
      });
    }

    // Sprint 2.5b — workflow_hardener. Advisory analyzer for
    // .github/workflows/*.yml. Always skip_commit (audit-only in v1).
    if (kind === 'workflow_hardener') {
      try {
        const probe = require('../../detectors/workflow-hardener.cjs');
        const detected = probe.detect({ repoRoot });
        if (detected.status !== 'ready') {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T0',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            action_kind: 'workflow_hardener',
            reason: detected.reason || detected.status,
          });
          return {
            ok: true,
            no_actionable_step: true,
            slug,
            action_kind: 'workflow_hardener',
            probe_status: detected.status,
            reason: detected.reason || detected.status,
          };
        }
      } catch (e) { /* fall through to plan-shape */ }
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: `Workflow hardener weekly audit ${isoDate}`,
        synthBodyPrefix: 'Sprint 2.5b: scan .github/workflows/*.yml for unpinned SHAs / missing permissions / missing concurrency / missing timeout-minutes; open advisory gh issue. Audit-only — no workflow edits.',
        skipCommit: true,
      });
    }

    // Sprint 2.6b — secret_history_sweep. TruffleHog full-history scan.
    // Always skip_commit (read-only — only writes are journal + gh issue).
    if (kind === 'secret_history_sweep') {
      try {
        const probe = require('../../detectors/secret-history-sweep.cjs');
        const detected = probe.detect({ repoRoot });
        if (detected.status !== 'ready') {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T0',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            action_kind: 'secret_history_sweep',
            reason: detected.reason || detected.status,
          });
          return {
            ok: true,
            no_actionable_step: true,
            slug,
            action_kind: 'secret_history_sweep',
            probe_status: detected.status,
            reason: detected.reason || detected.status,
          };
        }
      } catch (e) { /* fall through */ }
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: `Secret history sweep ${isoDate}`,
        synthBodyPrefix: 'Sprint 2.6b: TruffleHog full-history scan with --only-verified. On verified hit: open gh issue. NO auto-PR. Read-only.',
        skipCommit: true,
      });
    }

    // Sprint 2.11 — senior_tester_review. Hybrid kind: deterministic
    // detector + optional LLM judge. Dry-run probes for at least one test
    // file; full Phase A walk happens at execute time. Always skip_commit
    // (audit-only — never edits source/test files in v1).
    if (kind === 'senior_tester_review') {
      try {
        const probe = require('../../detectors/senior-tester-review.cjs');
        const detected = probe.detect({ repoRoot });
        if (detected.status !== 'ready') {
          journal.appendJournal(slug, {
            ts: new Date().toISOString(),
            trigger,
            tier: 'T0',
            event: 'no_actionable_step',
            outcome: 'skipped',
            actor: 'steward',
            action_kind: 'senior_tester_review',
            reason: detected.reason || detected.status,
          });
          return {
            ok: true,
            no_actionable_step: true,
            slug,
            action_kind: 'senior_tester_review',
            probe_status: detected.status,
            reason: detected.reason || detected.status,
          };
        }
      } catch (e) {
        // Probe failure → fall through to plan-shape; executor will surface
        // its own error if Phase A walks 0 files.
      }
      return buildDeterministicPlan({
        slug, trigger, isoDate, kind,
        synthTitle: `Senior tester review ${isoDate.slice(0, 7)}`,
        synthBodyPrefix: 'Sprint 2.11: walk tests/, run 16-smell deterministic detector, optional LLM judge synthesis, write journal + open ONE gh issue. Audit-only — no source/test edits.',
        skipCommit: true,
      });
    }

    if (kind === 'pattern_transfer') {
      // Sprint 2.7.1: registered + routed through executor as
      // ACTION_KIND_NOT_DISPATCHABLE. Mirror the same hard-fail at dry-run so
      // operators get the gap explicitly.
      const actionId = trailers.ulid();
      journal.appendJournal(slug, {
        ts: new Date().toISOString(),
        trigger,
        tier: 'T0',
        event: 'no_actionable_step',
        outcome: 'skipped',
        actor: 'steward',
        action_kind: 'pattern_transfer',
        reason: 'pattern_transfer LLM dispatch not yet implemented (Sprint 2.7.1)',
      });
      return {
        ok: true,
        no_actionable_step: true,
        slug,
        action_kind: 'pattern_transfer',
        reason: 'pattern_transfer LLM dispatch not yet implemented (Sprint 2.7.1)',
      };
    }

    // Step 5 — Pick next action (skip already-processed)
    const processed = readProcessedActionIds(slug);
    const action = recommendations.pickNextAction(parsed, [...processed]);

    if (!action) {
      journal.appendJournal(slug, {
        ts: new Date().toISOString(),
        trigger,
        tier: 'T0',
        event: 'no_actionable_step',
        outcome: 'skipped',
        actor: 'steward',
      });
      return {
        ok: true,
        no_actionable_step: true,
        slug,
        processed: [...processed],
      };
    }

    // Step 6 — Build the plan
    const actionId = trailers.ulid();
    const branchName = buildBranchName(action, actionId, isoDate);
    const headingAnchor = buildHeadingAnchor(action);

    const plan = {
      ok: true,
      mode: 'dry-run',
      slug,
      // Sprint 1.8.1 — typed action_kind for Steward capability dispatcher.
      // Default 'recommendation' = backwards-compatible with all 1.6.X / 1.7.X
      // plans. Future kinds (recommendation_harvest, dep_update_patch, ...)
      // will be set by their own dry-run paths in Sprint 1.8.2+.
      action_kind: actionKinds.DEFAULT_KIND,
      action: {
        num: action.num,
        title: action.title,
        body: action.body,
        citations: action.citations,
        section: action.sectionTitle,
        action_key: action.actionKey,
      },
      branch: branchName,
      action_id: actionId,
      trigger,
      planned_commit: {
        type: 'feat',
        scope: slug,
        subject: `${action.title}`.slice(0, 72),
        body: action.body,
        trailers: {
          'Steward-Action-Id': actionId,
          'Steward-Journal-Entry': `~/.cortex/journal/${slug}/${isoDate}.jsonl`,
          'Steward-Trigger': trigger,
          'Steward-Recommendation-Source': `cortex/recommendations.md#${headingAnchor}`,
        },
      },
    };

    // Validate the planned commit shape via the trailer module
    plan.commit_message = trailers.buildCommitMessage(plan.planned_commit);

    // Step 7 — Pre-flight policy check on a representative tool call.
    // The dry-run doesn't actually edit, but we sanity-check the action's
    // implied target paths against the policy denylist so users see policy
    // violations BEFORE running the real Steward.
    const implied = action.body.toLowerCase();
    if (
      /\b(standards|prompts|profiles|agents)\//.test(implied)
      || /\b(claude|readme|module)\.(md|yaml)\b/i.test(implied)
    ) {
      plan.policy_warning = {
        message: 'Action body references human_only paths; the real Steward run will be policy-blocked',
        recommendation: 'Reword the recommendation, or move the change to an auto_improves path',
      };
    }

    // Step 8 — Append journal entry
    journal.appendJournal(slug, {
      ts: new Date().toISOString(),
      trigger,
      tier: 'T0',
      event: 'dry_run_completed',
      outcome: 'success',
      actor: 'steward',
      action_key: action.actionKey,
      action_id: actionId,
      branch: branchName,
    });

    return plan;
  } finally {
    // Always release lock, even on error
    lock.releaseLock(lockHandle);
  }
}

module.exports = {
  runDryRun,
  slugifyTitle,
  shortId,
  buildBranchName,
  buildHeadingAnchor,
  readProcessedActionIds,
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

  const slug = flagValue('slug');
  if (!slug) {
    process.stderr.write('Usage: steward-dry-run --slug=<slug> [--repo-root=<path>] [--trigger=<source>] [--kind=recommendation|recommendation_harvest] [--json] [--quiet]\n');
    process.exit(1);
  }

  const wantJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  // Sprint 1.8.2c — typed kind support for recommendation_harvest CLI invocation
  const kind = flagValue('kind') || actionKinds.DEFAULT_KIND;

  const result = runDryRun({
    slug,
    repoRoot: flagValue('repo-root'),
    trigger: flagValue('trigger') || DEFAULT_TRIGGER,
    kind,
  });

  if (result.halted) {
    if (!quiet) process.stderr.write(`HALTED: ${result.reason} (${result.sentinelPath})\n`);
    process.exit(result.exitCode || haltCheck.EX_TEMPFAIL);
  }

  if (!result.ok) {
    if (wantJson) console.log(JSON.stringify(result, null, 2));
    else if (!quiet) process.stderr.write(`Error: ${result.error}\n`);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!quiet) {
    if (result.no_actionable_step) {
      console.log(`[steward dry-run] slug=${result.slug} → no actionable step (${result.processed.length} processed)`);
    } else {
      console.log(`[steward dry-run] slug=${result.slug}`);
      console.log(`  branch: ${result.branch}`);
      console.log(`  action: ${result.action.num}. ${result.action.title}`);
      console.log(`  action_key: ${result.action.action_key}`);
      console.log('');
      console.log('--- planned commit ---');
      console.log(result.commit_message);
      if (result.policy_warning) {
        console.log('');
        console.log(`⚠ policy: ${result.policy_warning.message}`);
      }
    }
  }
  process.exit(0);
}
