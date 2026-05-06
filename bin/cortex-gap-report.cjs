#!/usr/bin/env node
// cortex-gap-report — aggregator for ~/.cortex/insights/gap-log.jsonl
//
// Phase 1.5 of new-project.md appends one line per greenfield run where the
// best-fit profile scored < 0.8 against Q1+Q4+Q7. After enough runs, this
// aggregator surfaces "which profile categories should I add next?" — the
// answer is data-driven instead of speculation-driven.
//
// Usage:
//   cortex-gap-report                              # last 90 days, top-10 grouped
//   cortex-gap-report --since 2026-01-01           # custom window
//   cortex-gap-report --json                       # machine-readable
//   cortex-gap-report --raw                        # dump all entries
//
// Output (default): top runner-up profiles + top missing-signal clusters.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function resolveLogPath() {
  if (process.env.CORTEX_DATA_HOME) return path.join(process.env.CORTEX_DATA_HOME, 'insights', 'gap-log.jsonl');
  try {
    const yaml = fs.readFileSync(path.join(os.homedir(), '.claude', 'shared', 'cortex-source.yaml'), 'utf8');
    const m = yaml.match(/^cortex_data_home:\s*(.+)$/m);
    if (m) return path.join(m[1].trim().replace(/^["']|["']$/g, ''), 'insights', 'gap-log.jsonl');
  } catch {}
  return path.join(os.homedir(), '.cortex', 'insights', 'gap-log.jsonl');
}

function parseArgs(argv) {
  const args = { since: null, json: false, raw: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--raw') args.raw = true;
    else if (a === '--since') args.since = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('cortex-gap-report — aggregate $CORTEX_DATA_HOME/insights/gap-log.jsonl');
      console.log('  --since YYYY-MM-DD   filter window (default: last 90 days)');
      console.log('  --json               machine-readable output');
      console.log('  --raw                dump every entry, no grouping');
      process.exit(0);
    }
  }
  return args;
}

function loadEntries(logPath, since) {
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const cutoff = since ? new Date(since) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return lines.flatMap((line) => {
    try {
      const e = JSON.parse(line);
      if (e.date && new Date(e.date) >= cutoff) return [e];
      return [];
    } catch {
      return [];
    }
  });
}

function aggregate(entries) {
  const profileCount = new Map();
  const signalCount = new Map();
  const q4Cluster = new Map();

  for (const e of entries) {
    if (e.best_match) profileCount.set(e.best_match, (profileCount.get(e.best_match) ?? 0) + 1);
    for (const sig of e.missing_signals ?? []) {
      signalCount.set(sig, (signalCount.get(sig) ?? 0) + 1);
    }
    for (const kw of e.q4_keywords ?? []) {
      q4Cluster.set(kw, (q4Cluster.get(kw) ?? 0) + 1);
    }
  }

  const sortDesc = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]);

  return {
    total: entries.length,
    by_best_match: sortDesc(profileCount),
    top_missing_signals: sortDesc(signalCount).slice(0, 10),
    top_q4_keywords: sortDesc(q4Cluster).slice(0, 10),
  };
}

function renderHuman(report, logPath, since) {
  const w = process.stdout.write.bind(process.stdout);
  if (report.total === 0) {
    w(`cortex-gap-report — ${logPath}\n`);
    w(`  no entries since ${since ?? '90 days ago'}\n`);
    w(`  the log accumulates as you run new-project flows; check back after ~30 runs.\n`);
    return;
  }
  w(`cortex-gap-report — ${report.total} gap entries since ${since ?? '90 days ago'}\n`);
  w(`  source: ${logPath}\n\n`);

  w(`fallback profile distribution (which profile is "closest available"?):\n`);
  for (const [name, count] of report.by_best_match) {
    const bar = '█'.repeat(Math.min(count, 30));
    w(`  ${name.padEnd(20)} ${String(count).padStart(3)}  ${bar}\n`);
  }

  if (report.top_missing_signals.length > 0) {
    w(`\ntop missing signals (libs/runtimes not covered by any profile):\n`);
    for (const [sig, count] of report.top_missing_signals) {
      w(`  ${sig.padEnd(28)} ${String(count).padStart(3)}\n`);
    }
  }

  if (report.top_q4_keywords.length > 0) {
    w(`\ntop Q4 keywords (what users describe building):\n`);
    for (const [kw, count] of report.top_q4_keywords) {
      w(`  ${kw.padEnd(28)} ${String(count).padStart(3)}\n`);
    }
  }

  w(`\nrule of thumb: a missing signal with ≥5 occurrences across ≥3 different slugs\n`);
  w(`= empirical case for adding a profile that covers it.\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const logPath = resolveLogPath();
  const entries = loadEntries(logPath, args.since);

  if (args.raw) {
    console.log(entries.map((e) => JSON.stringify(e)).join('\n'));
    return;
  }

  const report = aggregate(entries);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderHuman(report, logPath, args.since);
}

main();
