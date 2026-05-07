// status.cjs — Hermes observability CLI.
//
// Reports the current state of a Hermes-managed project:
//   - HALTED status (which sentinel, if any)
//   - Lock status (held? by whom? stale?)
//   - Journal summary (last N entries, action counts, cost rollup)
//   - Recommendations health (parses cleanly? how many DO-this-week items?)
//
// CLI:
//   node bin/hermes/status.cjs --slug=<slug> [--repo-root=<path>]
//                              [--days=14] [--json] [--quiet]
//
// Exit codes:
//   0 — status reported (regardless of halt/lock state — this is informational)
//   1 — error (slug missing, recommendations parse failure)

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const haltCheck = require('./_lib/halt-check.cjs');
const lock = require('./_lib/lock.cjs');
const journal = require('./_lib/journal.cjs');
const recommendations = require('./_lib/recommendations.cjs');

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function summarizeJournal(slug, daysBack) {
  const today = Date.now();
  const summary = {
    days_scanned: daysBack,
    entries_total: 0,
    entries_corrupted: 0,
    by_outcome: {},
    by_event: {},
    by_trigger: {},
    by_tier: {},
    cost_usd_total: 0,
    tokens_in_total: 0,
    tokens_out_total: 0,
    last_entries: [],
  };

  for (let i = 0; i < daysBack; i += 1) {
    const ts = today - i * 24 * 60 * 60 * 1000;
    const d = new Date(ts).toISOString().slice(0, 10);
    const entries = journal.readJournal(slug, { date: d });

    for (const e of entries) {
      summary.entries_total += 1;
      if (e._corrupted) {
        summary.entries_corrupted += 1;
        continue;
      }
      if (e.outcome) summary.by_outcome[e.outcome] = (summary.by_outcome[e.outcome] || 0) + 1;
      if (e.event) summary.by_event[e.event] = (summary.by_event[e.event] || 0) + 1;
      if (e.trigger) summary.by_trigger[e.trigger] = (summary.by_trigger[e.trigger] || 0) + 1;
      if (e.tier) summary.by_tier[e.tier] = (summary.by_tier[e.tier] || 0) + 1;
      if (typeof e.cost_usd === 'number') summary.cost_usd_total += e.cost_usd;
      if (typeof e.tokens_in === 'number') summary.tokens_in_total += e.tokens_in;
      if (typeof e.tokens_out === 'number') summary.tokens_out_total += e.tokens_out;
    }
  }

  // Last entries: today only, last 5
  const todayEntries = journal.readJournal(slug, { date: todayISODate() });
  summary.last_entries = todayEntries
    .filter((e) => !e._corrupted)
    .slice(-5);

  return summary;
}

function lockStatus(repoRoot, slug, actionTimeoutMs) {
  const lockFilePath = lock.lockPath(repoRoot, slug);
  if (!fs.existsSync(lockFilePath)) {
    return { held: false };
  }
  const heldBy = lock.readLock(lockFilePath);
  const stale = lock.isStale(lockFilePath, actionTimeoutMs || lock.DEFAULT_ACTION_TIMEOUT_MS);
  return { held: true, stale, heldBy, lockFilePath };
}

function recommendationsStatus(repoRoot) {
  const recsPath = path.join(repoRoot, 'cortex', 'recommendations.md');
  if (!fs.existsSync(recsPath)) {
    return { ok: false, error: `not found at ${recsPath}` };
  }
  try {
    const parsed = recommendations.parseRecommendations(recsPath);
    const week = parsed.sections['DO this week'] || [];
    const sprint = parsed.sections['DO this sprint'] || [];
    return {
      ok: true,
      slug: parsed.frontmatter.slug,
      do_this_week_count: week.length,
      do_this_sprint_count: sprint.length,
      week_items: week.map((i) => ({ num: i.num, title: i.title })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getStatus(opts = {}) {
  const slug = opts.slug;
  if (!slug) {
    return { ok: false, error: 'slug is required', code: 'MISSING_SLUG' };
  }
  const repoRoot = opts.repoRoot || process.cwd();
  const daysBack = opts.daysBack || 14;

  return {
    ok: true,
    slug,
    repo_root: repoRoot,
    timestamp: new Date().toISOString(),
    halt: haltCheck.isHalted({ repoRoot }),
    lock: lockStatus(repoRoot, slug, opts.actionTimeoutMs),
    recommendations: recommendationsStatus(repoRoot),
    journal: summarizeJournal(slug, daysBack),
  };
}

function formatHumanReadable(status) {
  const lines = [];
  lines.push(`Hermes status — slug=${status.slug}`);
  lines.push(`  timestamp: ${status.timestamp}`);

  // Halt
  if (status.halt.halted) {
    lines.push(`  halt: HALTED (${status.halt.reason} at ${status.halt.sentinelPath})`);
  } else {
    lines.push('  halt: not halted');
  }

  // Lock
  if (status.lock.held) {
    const ageStr = status.lock.stale ? ' [STALE]' : '';
    lines.push(`  lock: held${ageStr} by pid=${status.lock.heldBy.pid} action=${status.lock.heldBy.action_id} since ${status.lock.heldBy.start_ts}`);
  } else {
    lines.push('  lock: free');
  }

  // Recommendations
  if (status.recommendations.ok) {
    lines.push(`  recommendations: OK — DO-this-week=${status.recommendations.do_this_week_count}, DO-this-sprint=${status.recommendations.do_this_sprint_count}`);
  } else {
    lines.push(`  recommendations: ERROR — ${status.recommendations.error}`);
  }

  // Journal summary
  const j = status.journal;
  lines.push(`  journal: ${j.entries_total} entries over ${j.days_scanned} days`);
  if (j.entries_corrupted > 0) {
    lines.push(`    ⚠ ${j.entries_corrupted} corrupted entries`);
  }
  if (Object.keys(j.by_outcome).length > 0) {
    const parts = Object.entries(j.by_outcome).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`    by_outcome: ${parts}`);
  }
  if (j.cost_usd_total > 0) {
    lines.push(`    cost_usd_total: $${j.cost_usd_total.toFixed(4)}`);
    lines.push(`    tokens: in=${j.tokens_in_total}, out=${j.tokens_out_total}`);
  }
  if (j.last_entries.length > 0) {
    lines.push('    last entries (today):');
    for (const e of j.last_entries) {
      const tsShort = e.ts.slice(11, 19);
      lines.push(`      ${tsShort} ${e.tier} ${e.event}${e.outcome ? ` → ${e.outcome}` : ''}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  getStatus,
  formatHumanReadable,
  summarizeJournal,
  lockStatus,
  recommendationsStatus,
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
    process.stderr.write('Usage: hermes-status --slug=<slug> [--repo-root=<path>] [--days=14] [--json] [--quiet]\n');
    process.exit(1);
  }

  const wantJson = args.includes('--json');
  const quiet = args.includes('--quiet');
  const daysStr = flagValue('days');
  const daysBack = daysStr ? Math.max(1, Number(daysStr)) : 14;

  const status = getStatus({
    slug,
    repoRoot: flagValue('repo-root'),
    daysBack,
  });

  if (!status.ok) {
    if (wantJson) console.log(JSON.stringify(status, null, 2));
    else if (!quiet) process.stderr.write(`Error: ${status.error}\n`);
    process.exit(1);
  }

  if (wantJson) {
    console.log(JSON.stringify(status, null, 2));
  } else if (!quiet) {
    console.log(formatHumanReadable(status));
  }
  process.exit(0);
}
