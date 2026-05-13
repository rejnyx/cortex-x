#!/usr/bin/env node
// bin/cortex-wiki-consolidate.cjs — Sprint 2.8.2 v0 operator-facing CLI
//
// Generates human-readable wiki articles from lessons.jsonl. Phase A is pure-
// deterministic — no LLM, no cost. Articles land at:
//
//   $CORTEX_DATA_HOME/wiki/<slug>/capabilities/<action_kind>.md
//
// Usage:
//   cortex-wiki-consolidate --slug=cortex-x
//   cortex-wiki-consolidate --slug=cortex-x --dry-run
//   cortex-wiki-consolidate --slug=cortex-x --max-kinds=3 --top-k=15
//   cortex-wiki-consolidate --slug=cortex-x --json

'use strict';

const { runWikiConsolidate } = require('./steward/_lib/wiki-consolidate.cjs');

function flag(name, args) {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function showHelp() {
  process.stdout.write(`Usage: cortex-wiki-consolidate --slug=<slug> [options]

Karpathy-style wiki layer over lessons.jsonl. Pure-deterministic Phase A —
groups lessons by action_kind, emits one Obsidian-compatible article per kind.

Options:
  --slug=<slug>            (required) project slug
  --max-kinds=<n>          cap articles per run (default 5, env: STEWARD_WIKI_MAX_KINDS_PER_RUN)
  --top-k=<n>              top N lessons per article (default 10)
  --dry-run                report what would be written, don't touch disk
  --json                   emit JSON instead of human-readable text
  --help, -h               show this help

Phase B (LLM-validated merge with provenance labels) deferred to Sprint 2.8.2 v1.
`);
}

function emitHuman(result) {
  if (!result.ok) {
    process.stderr.write(`Error: ${result.code}: ${result.error || ''}\n`);
    return 1;
  }
  if (result.no_work) {
    console.log(`No work: ${result.reason}`);
    return 0;
  }
  console.log(`wiki consolidation — ${result.kinds_processed} article(s) written${result.dry_run ? ' (dry-run)' : ''}`);
  for (const p of result.articles_written) console.log(`  ${p}`);
  if (result.kinds_skipped > 0) {
    console.log(`\n${result.kinds_skipped} kind(s) skipped (max-kinds cap):`);
    for (const k of result.skipped_kinds) console.log(`  - ${k}`);
  }
  if (result.errors && result.errors.length > 0) {
    console.log(`\n${result.errors.length} error(s):`);
    for (const e of result.errors) console.log(`  - ${e.kind}: ${e.error}`);
  }
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const slug = flag('slug', args);
  if (!slug) {
    process.stderr.write('Error: --slug=<slug> is required\n');
    return 2;
  }
  const wantJson = args.includes('--json');
  const dryRun = args.includes('--dry-run');

  const envMaxKinds = Number(process.env.STEWARD_WIKI_MAX_KINDS_PER_RUN);
  const cliMaxKinds = Number(flag('max-kinds', args));
  const maxKindsPerRun = Number.isFinite(cliMaxKinds) && cliMaxKinds > 0
    ? cliMaxKinds
    : (Number.isFinite(envMaxKinds) && envMaxKinds > 0 ? envMaxKinds : undefined);

  const cliTopK = Number(flag('top-k', args));
  const topLessonsPerKind = Number.isFinite(cliTopK) && cliTopK > 0 ? cliTopK : undefined;

  const result = runWikiConsolidate({
    slug,
    maxKindsPerRun,
    topLessonsPerKind,
    dryRun,
  });

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  return emitHuman(result);
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (err) {
    process.stderr.write(`Error: ${err && err.message}\n`);
    process.exit(1);
  }
}

module.exports = { main };
