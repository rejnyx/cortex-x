// dry-run.cjs — Hermes v0 dry-run orchestrator (no Claude SDK).
//
// Implements every step of the Hermes core loop EXCEPT the actual LLM call:
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
// when called as a library). The plan describes WHAT Hermes would do; the
// actual file edits + git operations require the LLM and are deferred to v0.5.
//
// CLI:
//   node bin/hermes/dry-run.cjs --slug=<slug> [--repo-root=<path>]
//                              [--trigger=cron|incident|pr-merged|manual]
//                              [--json] [--quiet]
//
// Exit codes:
//   0  — plan produced (or no_actionable_step; both are success states)
//   1  — error (parse failure, lock collision, schema violation)
//   75 — halted (HERMES_HALT sentinel present)

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
  return `hermes/${isoDate}-${slug}-${id}`;
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

  // Step 2 — Recommendations file location
  const recsPath = opts.recommendationsPath
    || path.join(repoRoot, 'cortex', 'recommendations.md');
  if (!fs.existsSync(recsPath)) {
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
        error: 'Hermes lock held by another process',
        code: 'LOCK_HELD',
        heldBy: err.heldBy,
      };
    }
    throw err;
  }

  try {
    // Step 4 — Parse recommendations
    let parsed;
    try {
      parsed = recommendations.parseRecommendations(recsPath);
    } catch (err) {
      // Journal the parse failure before we exit
      journal.appendJournal(slug, {
        ts: new Date().toISOString(),
        trigger,
        tier: 'T2',
        event: 'recommendations_parse_failed',
        outcome: 'failure',
        actor: 'hermes',
      });
      return {
        ok: false,
        error: `recommendations parse failed: ${err.message}`,
        code: 'PARSE_FAILED',
      };
    }

    if (parsed.frontmatter.slug !== slug) {
      return {
        ok: false,
        error: `slug mismatch: CLI=${slug}, recommendations.md=${parsed.frontmatter.slug}`,
        code: 'SLUG_MISMATCH',
      };
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
          actor: 'hermes',
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
      const branchName = `hermes/${isoDate}-recommendation-harvest-${shortId(actionId)}`;
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
            'Hermes-Action-Id': actionId,
            'Hermes-Journal-Entry': `~/.cortex/journal/${slug}/${isoDate}.jsonl`,
            'Hermes-Trigger': trigger,
            'Hermes-Recommendation-Source': `harvester (${harvest.candidates.length} new)`,
            'Hermes-Action-Kind': 'recommendation_harvest',
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
        actor: 'hermes',
        action_kind: 'recommendation_harvest',
        action_key: harvestActionKey,
        action_id: actionId,
        branch: branchName,
        harvest_count: harvest.candidates.length,
      });
      return plan;
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
        actor: 'hermes',
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
      // Sprint 1.8.1 — typed action_kind for Hermes capability dispatcher.
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
          'Hermes-Action-Id': actionId,
          'Hermes-Journal-Entry': `~/.cortex/journal/${slug}/${isoDate}.jsonl`,
          'Hermes-Trigger': trigger,
          'Hermes-Recommendation-Source': `cortex/recommendations.md#${headingAnchor}`,
        },
      },
    };

    // Validate the planned commit shape via the trailer module
    plan.commit_message = trailers.buildCommitMessage(plan.planned_commit);

    // Step 7 — Pre-flight policy check on a representative tool call.
    // The dry-run doesn't actually edit, but we sanity-check the action's
    // implied target paths against the policy denylist so users see policy
    // violations BEFORE running the real Hermes.
    const implied = action.body.toLowerCase();
    if (
      /\b(standards|prompts|profiles|agents)\//.test(implied)
      || /\b(claude|readme|module)\.(md|yaml)\b/i.test(implied)
    ) {
      plan.policy_warning = {
        message: 'Action body references human_only paths; the real Hermes run will be policy-blocked',
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
      actor: 'hermes',
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
    process.stderr.write('Usage: hermes-dry-run --slug=<slug> [--repo-root=<path>] [--trigger=<source>] [--kind=recommendation|recommendation_harvest] [--json] [--quiet]\n');
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
      console.log(`[hermes dry-run] slug=${result.slug} → no actionable step (${result.processed.length} processed)`);
    } else {
      console.log(`[hermes dry-run] slug=${result.slug}`);
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
