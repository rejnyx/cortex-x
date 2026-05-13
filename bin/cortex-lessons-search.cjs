#!/usr/bin/env node
// bin/cortex-lessons-search.cjs — Sprint 3.2 v0 operator-facing CLI
//
// FTS5-backed lookup over $CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl.
// Build the index once, query repeatedly. Index re-build is fast (<10ms
// for <1K lessons).
//
// Usage:
//   cortex-lessons-search build --slug=<slug>
//   cortex-lessons-search text  --slug=<slug> --query="..."
//   cortex-lessons-search kind  --slug=<slug> --action-kind=recommendation
//   cortex-lessons-search code  --slug=<slug> --error-code=OPENROUTER_KEY_MISSING

'use strict';

const search = require('./steward/_lib/lessons-search.cjs');

function flag(name, args) {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  return args[idx + 1];
}

function showHelp() {
  process.stdout.write(`Usage: cortex-lessons-search <command> --slug=<slug> [options]

Commands:
  build                  rebuild the FTS5 index for a slug
  text                   full-text search across lesson_text/hint/root_cause
  kind                   filter by action_kind
  code                   lookup by error code (root_cause)

Options:
  --slug=<slug>          (required) project slug
  --query=<q>            for `text` command — natural-language query
  --action-kind=<kind>   for `kind` command — exact action_kind to filter
  --error-code=<code>    for `code` command — error code to find
  --data-home=<path>     CORTEX_DATA_HOME override
  --limit=<n>            cap result count (default 10/20 by command)
  --json                 emit JSON instead of human-readable text
  --help, -h             show this help

Requires Node ≥22.5 with node:sqlite enabled.
`);
}

function emit(result, wantJson, label) {
  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    process.stderr.write(`Error: ${result.error || result.code || 'unknown'}\n`);
    return;
  }
  if (label === 'build') {
    console.log(`Indexed ${result.indexed} lessons → ${result.indexPath}`);
    return;
  }
  if (!result.hits || result.hits.length === 0) {
    console.log('No matches.');
    return;
  }
  for (let i = 0; i < result.hits.length; i += 1) {
    const h = result.hits[i];
    console.log(`${i + 1}. [${h.action_kind}] ${h.root_cause} — ${h.lesson_text}`);
    if (h.hint) console.log(`     hint: ${h.hint}`);
    console.log(`     ${h.ts}  action_key=${h.action_key || '—'}  impact=${h.impact}  freq=${h.frequency}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }

  if (!search.isAvailable()) {
    process.stderr.write(`Error: ${search.unavailableReason()}\n`);
    return 2;
  }

  const command = args[0];
  const slug = flag('slug', args);
  if (!slug) {
    process.stderr.write('Error: --slug=<slug> is required\n');
    return 2;
  }
  const dataHome = flag('data-home', args);
  const limit = flag('limit', args);
  const wantJson = args.includes('--json');
  const limitN = limit ? Number(limit) : undefined;

  try {
    if (command === 'build') {
      const r = search.buildIndex(slug, { dataHome });
      emit(r, wantJson, 'build');
      return r.ok ? 0 : 1;
    }
    if (command === 'text') {
      const q = flag('query', args);
      if (!q) { process.stderr.write('Error: --query=<text> is required for `text` command\n'); return 2; }
      const r = search.searchByText(slug, q, { dataHome, limit: limitN });
      emit(r, wantJson);
      return r.ok ? 0 : 1;
    }
    if (command === 'kind') {
      const k = flag('action-kind', args);
      if (!k) { process.stderr.write('Error: --action-kind=<kind> is required for `kind` command\n'); return 2; }
      const r = search.searchByActionKind(slug, k, { dataHome, limit: limitN });
      emit(r, wantJson);
      return r.ok ? 0 : 1;
    }
    if (command === 'code') {
      const c = flag('error-code', args);
      if (!c) { process.stderr.write('Error: --error-code=<code> is required for `code` command\n'); return 2; }
      const r = search.searchByErrorCode(slug, c, { dataHome, limit: limitN });
      emit(r, wantJson);
      return r.ok ? 0 : 1;
    }
    process.stderr.write(`Error: unknown command "${command}"\n`);
    showHelp();
    return 2;
  } catch (err) {
    process.stderr.write(`Error: ${err && err.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main };
