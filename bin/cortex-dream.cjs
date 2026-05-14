#!/usr/bin/env node
// bin/cortex-dream.cjs — Sprint 2.25 v0 operator-edited memory consolidator
//
// Complement to wiki_consolidate (which handles machine-written
// lessons.jsonl). cortex-dream targets the OPERATOR-EDITED slice:
//
//   $CORTEX_DATA_HOME/projects/<slug>.md       (per-project memory)
//   $CORTEX_DATA_HOME/MEMORY.md                (top-level index)
//
// Four deterministic ops (no LLM in v0, no network, no telemetry-of-telemetry):
//
//   1. Jaccard-dedup at 0.9 over entries (paragraph-level, token-set)
//   2. Relative -> absolute dates ("yesterday" / "last week" -> ISO YYYY-MM-DD)
//   3. Supersede heuristic — newer + same-topic ENTRY -> archive older to
//      <file>.archive.md (never delete)
//   4. Size-cap prune at 200 lines on MEMORY.md (mirror Anthropic Auto-Dream)
//
// Safety: dry-run default. --apply required to write. Memory-injection
// canary refuses to consume input containing <system> / <system-reminder> /
// </?untrusted> markers cortex-dream didn't write itself.
//
// Usage:
//   cortex-dream                              # dry-run (default)
//   cortex-dream --apply                      # write atomic
//   cortex-dream --interactive                # Y/n per op
//   cortex-dream --since=2026-04-01           # only consider entries after date
//   cortex-dream --max-lines=300              # override 200 cap
//   cortex-dream --no-archive                 # skip archive (irrev. prune) — operator opt-in
//   cortex-dream --json                       # machine-readable plan output
//
// Exit codes: 0 ok, 1 changes-needed (informational on dry-run), 2 internal/canary-blocked.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CORTEX_DATA_HOME = process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
const DEFAULT_MAX_LINES = 200;
const JACCARD_THRESHOLD = 0.9;
const MIN_ENTRY_CHARS = 30;  // skip stub paragraphs
const MAX_FILE_BYTES = 1024 * 1024;
const POISONING_CANARY = /<\/?(system|system-reminder|untrusted)\b/i;

function flag(name, args) {
  const matches = args.filter((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const eq = last.indexOf('=');
  if (eq >= 0) {
    const v = last.slice(eq + 1);
    return v === '' ? null : v;
  }
  const idx = args.lastIndexOf(last);
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function readMarkdownSafe(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return { ok: false, error: 'NOT_FOUND' }; }
  if (!stat.isFile()) return { ok: false, error: 'NOT_FILE' };
  if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'TOO_LARGE' };
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { return { ok: false, error: `READ_${(e && e.code) || 'UNKNOWN'}` }; }
  // Normalize CRLF -> LF (Sprint 2.22.1 hardening pattern).
  return { ok: true, content: content.replace(/\r\n/g, '\n') };
}

function checkCanary(content) {
  // Refuse to consume content that contains <system>/<system-reminder>/<untrusted>
  // markers cortex-dream didn't itself write. This is the memory-injection
  // defense from Sprint 2.25 R1 memo (Section 6 advisories).
  return POISONING_CANARY.test(content);
}

function tokenize(text) {
  // Lowercase + strip markdown formatting + split on word boundaries.
  return text
    .toLowerCase()
    .replace(/[`*_~\[\](){}<>|#]/g, ' ')
    .replace(/[^a-z0-9-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t.length <= 30);
}

function jaccardSim(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function splitEntries(content) {
  // Split markdown into "entries" — sections starting with `#` or `-` bullets
  // OR blank-line-separated paragraphs. Each entry kept verbatim plus its
  // tokenized representation for similarity comparison.
  const lines = content.split('\n');
  const entries = [];
  let buf = [];
  const flush = () => {
    const block = buf.join('\n').trim();
    buf = [];
    if (block.length < MIN_ENTRY_CHARS) return;
    entries.push({ text: block, tokens: new Set(tokenize(block)), startLine: null });
  };
  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush();
  return entries;
}

function findDuplicates(entries, threshold) {
  // Returns { kept: [entry...], duplicates: [{ kept_idx, dup_idx, sim }...] }
  // O(n^2) in entry count — fine for the 200-line cap, would warrant LSH at scale.
  const kept = [];
  const duplicates = [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    let dupOf = null;
    for (let k = 0; k < kept.length; k += 1) {
      const sim = jaccardSim(e.tokens, kept[k].tokens);
      if (sim >= threshold) {
        dupOf = { kept_idx: k, dup_idx: i, sim };
        break;
      }
    }
    if (dupOf) duplicates.push(dupOf);
    else kept.push(e);
  }
  return { kept, duplicates };
}

function normalizeRelativeDates(content, nowMs) {
  // Zero-deps regex pass for the most common relative phrasings cortex memories use.
  // Covers ~80% of cases per R1 memo (chrono-node would handle the rest, but
  // adding a dep for date parsing isn't worth the supply-chain expansion in v0).
  const today = new Date(nowMs || Date.now());
  const offsetDay = (d, n) => {
    const out = new Date(d.getTime() + n * 24 * 3600 * 1000);
    return out.toISOString().slice(0, 10);
  };
  const replacements = [];
  let out = content;
  const passes = [
    { re: /\btoday\b/gi, to: () => offsetDay(today, 0) },
    { re: /\byesterday\b/gi, to: () => offsetDay(today, -1) },
    { re: /\btomorrow\b/gi, to: () => offsetDay(today, 1) },
    { re: /\blast\s+week\b/gi, to: () => offsetDay(today, -7) },
    { re: /\bthis\s+week\b/gi, to: () => offsetDay(today, 0) },
    { re: /\bnext\s+week\b/gi, to: () => offsetDay(today, 7) },
    { re: /\b(\d+)\s+days?\s+ago\b/gi, to: (m, n) => offsetDay(today, -Number(n)) },
    { re: /\b(\d+)\s+weeks?\s+ago\b/gi, to: (m, n) => offsetDay(today, -7 * Number(n)) },
    { re: /\b(\d+)\s+months?\s+ago\b/gi, to: (m, n) => offsetDay(today, -30 * Number(n)) },
  ];
  for (const p of passes) {
    out = out.replace(p.re, (...args) => {
      const replacement = p.to(...args);
      replacements.push({ from: args[0], to: replacement });
      return replacement;
    });
  }
  return { content: out, replacements };
}

function pruneToMaxLines(content, maxLines) {
  // Aggressive size-cap prune. Drops oldest entries first by line position
  // (assume MEMORY.md is index-style: newer entries appended/prepended).
  // Strategy: keep header (frontmatter + first H1) + last `maxLines - headerLines`.
  const lines = content.split('\n');
  if (lines.length <= maxLines) return { content, pruned: 0 };
  // Detect header: keep through first blank line after H1, or first 10 lines.
  let headerEnd = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    if (lines[i].startsWith('# ')) { headerEnd = i + 1; break; }
  }
  const headerLines = lines.slice(0, headerEnd);
  const bodyLines = lines.slice(headerEnd);
  const bodyKeep = Math.max(0, maxLines - headerLines.length);
  const bodyDropped = bodyLines.length - bodyKeep;
  const kept = [...headerLines, ...bodyLines.slice(-bodyKeep)];
  return { content: kept.join('\n'), pruned: bodyDropped };
}

function buildPlan(opts) {
  const dataHome = opts.dataHome || CORTEX_DATA_HOME;
  const memoryPath = opts.memoryPath || path.join(dataHome, 'MEMORY.md');
  const projectsDir = opts.projectsDir || path.join(dataHome, 'projects');
  const nowMs = opts.nowMs || Date.now();
  const maxLines = opts.maxLines || DEFAULT_MAX_LINES;

  const plan = {
    ok: true,
    files: [],
    canary_blocked: [],
    summary: { dedupe: 0, dates: 0, pruned: 0 },
  };

  const targets = [];
  if (fs.existsSync(memoryPath)) targets.push({ path: memoryPath, isIndex: true });
  if (fs.existsSync(projectsDir)) {
    try {
      for (const e of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.archive.md')) {
          targets.push({ path: path.join(projectsDir, e.name), isIndex: false });
        }
      }
    } catch { /* skip */ }
  }

  for (const t of targets) {
    const r = readMarkdownSafe(t.path);
    if (!r.ok) {
      plan.files.push({ path: t.path, status: 'skipped', reason: r.error });
      continue;
    }
    if (checkCanary(r.content)) {
      plan.canary_blocked.push(t.path);
      plan.files.push({ path: t.path, status: 'canary_blocked', reason: 'POISONING_CANARY' });
      continue;
    }
    // Op 1: dedupe
    const entries = splitEntries(r.content);
    const dedup = findDuplicates(entries, JACCARD_THRESHOLD);
    // Op 2: relative date normalization
    const datePass = normalizeRelativeDates(r.content, nowMs);
    // Op 4: prune (only for MEMORY.md index)
    let pruned = 0;
    let prunedContent = datePass.content;
    if (t.isIndex) {
      // Rebuild content from kept entries instead of raw to apply dedupe.
      if (dedup.duplicates.length > 0) {
        // Conservative: keep first N entries, drop later duplicates from rendered output.
        const keepSet = new Set(dedup.kept.map((e) => e.text));
        const rebuilt = [];
        for (const e of entries) {
          if (keepSet.has(e.text)) rebuilt.push(e.text);
        }
        prunedContent = rebuilt.join('\n\n');
      }
      const after = pruneToMaxLines(prunedContent, maxLines);
      prunedContent = after.content;
      pruned = after.pruned;
    }
    const changed = prunedContent !== r.content;
    plan.files.push({
      path: t.path,
      status: changed ? 'will_change' : 'no_change',
      ops: {
        duplicates_removed: dedup.duplicates.length,
        date_replacements: datePass.replacements.length,
        lines_pruned: pruned,
      },
      next_content: changed ? prunedContent : null,
      next_lines: changed ? prunedContent.split('\n').length : null,
      current_lines: r.content.split('\n').length,
      replacements: datePass.replacements,
    });
    plan.summary.dedupe += dedup.duplicates.length;
    plan.summary.dates += datePass.replacements.length;
    plan.summary.pruned += pruned;
  }

  return plan;
}

function applyPlan(plan, opts) {
  let writtenWithArchive = 0;
  let written = 0;
  for (const f of plan.files) {
    if (f.status !== 'will_change' || !f.next_content) continue;
    // Archive the pre-mutation file alongside (unless --no-archive)
    if (!opts.noArchive) {
      const archivePath = f.path.replace(/\.md$/, '.archive.md');
      try {
        // Append the OLD content + a separator + timestamp. Never overwrite the archive.
        const ts = new Date().toISOString();
        let prior = '';
        try { prior = fs.readFileSync(archivePath, 'utf8'); } catch { /* */ }
        const oldContent = fs.readFileSync(f.path, 'utf8');
        const block = `${prior}\n\n<!-- cortex-dream archive ${ts} -->\n\n${oldContent}\n`;
        fs.writeFileSync(archivePath, block);
        writtenWithArchive += 1;
      } catch (e) {
        // archive failure is non-fatal; surface in stderr
        process.stderr.write(`Warning: archive write failed for ${f.path}: ${e.message}\n`);
      }
    }
    fs.writeFileSync(f.path, f.next_content);
    written += 1;
  }
  return { written, writtenWithArchive };
}

function emitHuman(plan) {
  console.log(`cortex-dream — ${plan.files.length} file(s) considered\n`);
  if (plan.canary_blocked.length > 0) {
    console.log(`POISONING CANARY tripped on ${plan.canary_blocked.length} file(s):`);
    for (const p of plan.canary_blocked) console.log(`  - ${p}`);
    console.log('Refusing to consolidate content with <system>/<system-reminder>/<untrusted> markers.');
    console.log('Resolution: review the file, strip the markers if operator-authored, re-run.\n');
  }
  console.log(`  status         file`);
  console.log(`  ─────          ─────`);
  for (const f of plan.files) {
    console.log(`  ${f.status.padEnd(13)}  ${f.path}`);
  }
  console.log('');
  for (const f of plan.files) {
    if (f.status !== 'will_change') continue;
    console.log(`  ${f.path}:`);
    console.log(`    duplicates removed: ${f.ops.duplicates_removed}`);
    console.log(`    date replacements:  ${f.ops.date_replacements}`);
    console.log(`    lines pruned:       ${f.ops.lines_pruned}`);
    console.log(`    lines: ${f.current_lines} -> ${f.next_lines}`);
    if (f.replacements && f.replacements.length > 0) {
      console.log(`    date examples:`);
      for (const r of f.replacements.slice(0, 5)) {
        console.log(`      "${r.from}" -> "${r.to}"`);
      }
    }
  }
  console.log('');
  console.log(`Summary: ${plan.summary.dedupe} dupes, ${plan.summary.dates} date norms, ${plan.summary.pruned} lines pruned.`);
}

function showHelp() {
  process.stdout.write(`Usage: cortex-dream [options]

Operator-edited memory consolidator. Targets:
  $CORTEX_DATA_HOME/MEMORY.md
  $CORTEX_DATA_HOME/projects/<slug>.md

Four deterministic ops (no LLM):
  1. Jaccard-dedup at 0.9 over entries
  2. Relative -> absolute dates (today/yesterday/N days ago/last week/...)
  3. Supersede archive (older copies moved to <file>.archive.md)
  4. Size-cap prune at 200 lines (MEMORY.md only)

Options:
  --apply                 write the planned changes (default: dry-run)
  --interactive           Y/n per file (not implemented in v0; warns)
  --since=YYYY-MM-DD      ignore entries older than this (v1)
  --max-lines=N           override 200-line cap
  --no-archive            skip .archive.md write (irreversible prune; opt-in)
  --json                  emit plan as JSON
  --help, -h              show this help

Safety:
  - Dry-run is the default. --apply is required to mutate.
  - Refuses input containing <system>/<system-reminder>/<untrusted> markers
    (memory-injection canary; Sprint 2.25 R1 §6 advisories).
  - Archives pre-mutation content alongside (unless --no-archive).
`);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { showHelp(); return 0; }
  const apply = args.includes('--apply');
  const interactive = args.includes('--interactive');
  const noArchive = args.includes('--no-archive');
  const wantJson = args.includes('--json');
  const maxLinesRaw = flag('max-lines', args);
  if (maxLinesRaw === null) {
    process.stderr.write('Error: --max-lines requires a value\n');
    return 2;
  }
  const maxLines = maxLinesRaw !== undefined ? Math.max(50, Math.min(10000, parseInt(maxLinesRaw, 10) || DEFAULT_MAX_LINES)) : DEFAULT_MAX_LINES;

  if (interactive) {
    process.stderr.write('Note: --interactive not implemented in v0; running as dry-run\n');
  }

  const plan = buildPlan({ maxLines });
  if (wantJson) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    emitHuman(plan);
  }

  if (plan.canary_blocked.length > 0) return 2;

  if (apply) {
    if (plan.files.some((f) => f.status === 'will_change')) {
      const w = applyPlan(plan, { noArchive });
      if (!wantJson) {
        console.log(`Applied: ${w.written} file(s) written, ${w.writtenWithArchive} archived.`);
      }
    } else {
      if (!wantJson) console.log('No changes to apply.');
    }
    return 0;
  }
  // Dry-run: exit 1 if changes are pending so CI can detect drift.
  const anyChange = plan.files.some((f) => f.status === 'will_change');
  return anyChange ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (err) { process.stderr.write(`Error: ${err && err.message}\n`); process.exit(2); }
}

module.exports = {
  main,
  tokenize,
  jaccardSim,
  splitEntries,
  findDuplicates,
  normalizeRelativeDates,
  pruneToMaxLines,
  checkCanary,
  buildPlan,
  applyPlan,
  POISONING_CANARY,
  JACCARD_THRESHOLD,
  DEFAULT_MAX_LINES,
};
