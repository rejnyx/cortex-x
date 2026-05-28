#!/usr/bin/env node
// cortex-usage — read-only usage rollup over the tool-use journal.
//
// The post-tool-use hook (shared/hooks/post-tool-use.cjs) already logs every
// Read with its file path to {root}/journal/YYYY-MM-DD-<slug>.jsonl. This CLI
// turns that raw stream into an answer to the question the operator actually
// has about the institutional-wisdom library: "which standards / prompts /
// agents / skills do I REALLY pull into sessions, and which are dead weight?"
//
// Hot = earns its context cost (reinforce). Cold = exists on disk but never
// surfaced in the window → prune candidate, feeds the usage-driven audit.
//
// Usage:
//   cortex-usage                       # last 90 days, human rollup
//   cortex-usage --since 2026-01-01    # custom window
//   cortex-usage --kind standards      # one kind only (standards|prompts|agents|skills)
//   cortex-usage --json                # machine-readable
//   cortex-usage --cold                # just the prune-candidate list
//
// Contract: read-only, zero-dep, fail-open (never throws, missing data → empty).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { resolveCortexDataHome, resolveCortexAssetsRoot } = require('../tools/lib/resolve-cortex-home.cjs');

const KIND_DIRS = ['standards', 'prompts', 'agents', 'skills'];
const CORTEX_MARKERS = ['cortex-x/', '.claude/shared/', '.claude/skills/'];
const WINDOW_DAYS = 90;

// Candidate locations of the editable cortex-x repo (operator-owned source —
// distinct from $CORTEX_DATA_HOME and the installed ~/.claude/shared copy).
// SSOT note: post-tool-use.cjs / pre-tool-use.cjs / session-start.cjs each
// carry their own copy of this triple; folding all of them into a shared
// resolveCortexRepoRoot() in tools/lib/resolve-cortex-home.cjs is tracked as
// the Sprint 2.38.1 follow-up (this file keeps a single in-module copy).
function repoCandidates() {
  const home = os.homedir();
  return [
    path.join(home, 'cortex-x'),
    path.join(home, 'Desktop', 'APPs', 'cortex-x'),
    path.join(home, '.cortex-x'),
  ];
}

// ---- Path resolution ----------------------------------------------------

// Knowledge root = where the artifact universe lives (the repo the operator
// edits/prunes; falls back to the installed copy for non-repo users).
function resolveKnowledgeRoot() {
  const cwd = process.cwd();
  if (looksLikeCortexRepo(cwd)) return cwd;
  const candidates = [process.env.CORTEX_HOME, ...repoCandidates()].filter(Boolean);
  for (const c of candidates) {
    if (looksLikeCortexRepo(c)) return c;
  }
  return resolveCortexAssetsRoot(); // ~/.claude/shared — installed-copy fallback
}

function looksLikeCortexRepo(dir) {
  try {
    return (
      fs.statSync(path.join(dir, 'standards')).isDirectory() &&
      fs.existsSync(path.join(dir, 'bin', 'cortex-doctor.cjs'))
    );
  } catch {
    return false;
  }
}

// Journal dirs = everywhere the hook might have written. Scan all, dedupe.
function resolveJournalDirs() {
  const roots = [
    process.env.CORTEX_HOME,
    process.cwd(),
    ...repoCandidates(),
    resolveCortexDataHome(),
  ].filter(Boolean);
  const dirs = [];
  const seen = new Set();
  for (const r of roots) {
    const jd = path.join(r, 'journal');
    let real;
    try { real = fs.realpathSync(jd); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    dirs.push(jd);
  }
  return dirs;
}

// ---- Artifact classification --------------------------------------------

// Map a journal `file` path to a canonical artifact key, or null if it isn't
// a cortex knowledge artifact. Key is root-independent (a read of
// repo/standards/x.md and ~/.claude/shared/standards/x.md count as one).
function classifyArtifact(filePath) {
  if (!filePath) return null;
  const norm = String(filePath).replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  if (!CORTEX_MARKERS.some((m) => lower.includes(m))) return null;

  let m;
  if ((m = norm.match(/\/standards\/([^/]+\.md)$/i))) return { kind: 'standards', key: `standards/${m[1]}` };
  if ((m = norm.match(/\/prompts\/([^/]+\.md)$/i))) return { kind: 'prompts', key: `prompts/${m[1]}` };
  if ((m = norm.match(/\/agents\/([^/]+\.md)$/i))) return { kind: 'agents', key: `agents/${m[1]}` };
  if ((m = norm.match(/\/skills\/([^/]+)\/SKILL\.md$/i))) return { kind: 'skills', key: `skills/${m[1]}` };
  return null;
}

// ---- Universe enumeration (existing artifacts on disk) -------------------

function listMd(dir, kind) {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n.toLowerCase().endsWith('.md')) out.push({ kind, key: `${kind}/${n}` });
  }
  return out;
}

function enumerateUniverse(root) {
  const universe = new Map(); // key -> kind
  for (const kind of ['standards', 'prompts', 'agents']) {
    for (const a of listMd(path.join(root, kind), kind)) universe.set(a.key, a.kind);
  }
  // skills live under shared/skills/<name>/SKILL.md
  const skillsRoot = path.join(root, 'shared', 'skills');
  let dirs;
  try { dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }); } catch { dirs = []; }
  for (const d of dirs) {
    if (d.isDirectory() && fs.existsSync(path.join(skillsRoot, d.name, 'SKILL.md'))) {
      universe.set(`skills/${d.name}`, 'skills');
    }
  }
  return universe;
}

// ---- Read aggregation ----------------------------------------------------

function loadReads(journalDirs, cutoff, now = Date.now()) {
  const stats = new Map(); // key -> { kind, count, lastRead(ms), projects:Set }
  for (const dir of journalDirs) {
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.jsonl$/.test(f)) continue;
      let lines;
      try { lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n'); } catch { continue; }
      for (const line of lines) {
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        // typeof check (not just truthiness): a non-string `file` (array/number)
        // would otherwise be String()-coerced in classifyArtifact and an array
        // like ["x","cortex-x/standards/y.md"] would join into a marker-matching
        // string → counted as a phantom read.
        if (!e || e.tool !== 'Read' || typeof e.file !== 'string') continue;
        const tsMs = Date.parse(e.ts);
        // Closed window: a future / clock-skewed ts must NOT count — it would set
        // lastRead ahead of now (negative days_since) and keep a genuinely-cold
        // artifact out of the prune set, the dangerous direction for this tool.
        if (!Number.isFinite(tsMs) || tsMs < cutoff || tsMs > now) continue;
        const cls = classifyArtifact(e.file);
        if (!cls) continue;
        let s = stats.get(cls.key);
        if (!s) { s = { kind: cls.kind, count: 0, lastRead: 0, projects: new Set() }; stats.set(cls.key, s); }
        s.count += 1;
        if (tsMs > s.lastRead) s.lastRead = tsMs;
        if (e.project) s.projects.add(e.project);
      }
    }
  }
  return stats;
}

// ---- Report --------------------------------------------------------------

function daysSince(ms, now) {
  return Math.floor((now - ms) / (24 * 60 * 60 * 1000));
}

function buildReport(stats, universe, kindFilter, now = Date.now()) {
  const inKind = (k) => !kindFilter || k === kindFilter;

  const hot = [];
  for (const [key, s] of stats) {
    if (!inKind(s.kind)) continue;
    hot.push({
      key,
      kind: s.kind,
      reads: s.count,
      last_read: new Date(s.lastRead).toISOString().slice(0, 10),
      days_since: daysSince(s.lastRead, now),
      projects: s.projects.size,
    });
  }
  hot.sort((a, b) => b.reads - a.reads || a.days_since - b.days_since);

  // Cold = exists in universe but zero reads in window.
  const cold = [];
  for (const [key, kind] of universe) {
    if (!inKind(kind)) continue;
    if (!stats.has(key)) cold.push({ key, kind });
  }
  cold.sort((a, b) => a.key.localeCompare(b.key));

  // used = universe files actually read (intersection); orphan reads — keys read
  // but absent from the universe (renamed/removed/project-local) — are excluded
  // here so `used + cold === universe` always holds, but still appear in `hot`.
  const byKind = {};
  for (const kind of KIND_DIRS) {
    if (!inKind(kind)) continue;
    const kindKeys = Array.from(universe.entries()).filter(([, k]) => k === kind);
    const total = kindKeys.length;
    const used = kindKeys.filter(([key]) => stats.has(key)).length;
    byKind[kind] = { universe: total, used, cold: total - used };
  }

  return { hot, cold, by_kind: byKind, total_reads: hot.reduce((n, h) => n + h.reads, 0) };
}

function renderHuman(report, journalDirs, sinceLabel, coldOnly) {
  const w = process.stdout.write.bind(process.stdout);

  if (report.total_reads === 0 && report.cold.length === 0) {
    w('cortex-usage — no journal data found.\n');
    w(`  scanned: ${journalDirs.join(', ') || '(none)'}\n`);
    w('  the journal accrues as you Read cortex artifacts in sessions (post-tool-use hook).\n');
    return;
  }

  if (coldOnly) {
    renderCold(w, report);
    return;
  }

  w(`cortex-usage — artifact reads since ${sinceLabel}\n`);
  w(`  journals: ${journalDirs.length} dir(s) · ${report.total_reads} qualifying reads\n\n`);

  w('per-kind coverage (universe = files on disk · used = read ≥1× in window):\n');
  for (const [kind, c] of Object.entries(report.by_kind)) {
    w(`  ${kind.padEnd(11)} ${String(c.used).padStart(3)}/${String(c.universe).padEnd(3)} used   ${String(c.cold).padStart(3)} cold\n`);
  }

  const top = report.hot.slice(0, 15);
  if (top.length) {
    w('\nhottest artifacts (earn their context cost):\n');
    for (const h of top) {
      const bar = '█'.repeat(Math.min(h.reads, 24));
      w(`  ${h.key.padEnd(36)} ${String(h.reads).padStart(4)}  ${bar}\n`);
    }
  }

  renderCold(w, report);

  w('\nrule of thumb: an artifact cold for a full audit window (90d) with no read\n');
  w('across any project is a prune candidate — verify before deleting (it may be\n');
  w('load-bearing for a path you simply have not exercised recently).\n');
}

function renderCold(w, report) {
  if (!report.cold.length) {
    w('\nno cold artifacts — every file on disk was read in the window.\n');
    return;
  }
  w(`\ncold — exists on disk, 0 reads in window (${report.cold.length} prune candidates):\n`);
  let lastKind = null;
  for (const c of report.cold) {
    if (c.kind !== lastKind) { w(`  [${c.kind}]\n`); lastKind = c.kind; }
    w(`    ${c.key}\n`);
  }
}

// ---- CLI -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { since: null, json: false, kind: null, coldOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--cold') args.coldOnly = true;
    else if (a === '--since') {
      args.since = argv[++i];
      if (args.since === undefined) { console.error('--since requires a YYYY-MM-DD value'); process.exit(2); }
    }
    else if (a === '--kind') {
      args.kind = argv[++i];
      if (args.kind === undefined) { console.error(`--kind requires one of: ${KIND_DIRS.join(' | ')}`); process.exit(2); }
    }
    else if (a === '--help' || a === '-h') {
      console.log('cortex-usage — which cortex artifacts actually get read in sessions');
      console.log('  --since YYYY-MM-DD   window start (default: last 90 days)');
      console.log('  --kind <k>           filter: standards | prompts | agents | skills');
      console.log('  --cold               only the prune-candidate list');
      console.log('  --json               machine-readable output');
      console.log('\nnote: memory + lessons have their own decay tooling (memory-decay.cjs,');
      console.log('cortex-wiki-consolidate); this CLI scopes to the wisdom library.');
      process.exit(0);
    }
  }
  if (args.kind && !KIND_DIRS.includes(args.kind)) {
    console.error(`unknown --kind "${args.kind}" (expected: ${KIND_DIRS.join(' | ')})`);
    process.exit(2);
  }
  // Enforce the YYYY-MM-DD contract the help text promises. Reject (don't
  // silently degrade to an epoch / all-time window, which misleads the operator
  // into trusting a "hot" verdict built off ancient reads). Regex gates shape;
  // Date.parse gates real calendar validity (e.g. 2026-13-99 passes the regex).
  if (args.since && (!/^\d{4}-\d{2}-\d{2}$/.test(args.since) || !Number.isFinite(Date.parse(args.since)))) {
    console.error(`invalid --since "${args.since}" (expected YYYY-MM-DD)`);
    process.exit(2);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const now = Date.now();
  const cutoff = args.since ? Date.parse(args.since) : now - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const sinceLabel = args.since || `${WINDOW_DAYS} days ago`;

  if (Number.isFinite(cutoff) && cutoff > now) {
    process.stderr.write(`note: --since ${args.since} is in the future — no reads can match.\n`);
  }

  const journalDirs = resolveJournalDirs();
  const knowledgeRoot = resolveKnowledgeRoot();
  const stats = loadReads(journalDirs, Number.isFinite(cutoff) ? cutoff : 0, now);
  const universe = enumerateUniverse(knowledgeRoot);
  const report = buildReport(stats, universe, args.kind, now);

  if (args.json) {
    const root = knowledgeRoot.replace(os.homedir(), '~'); // don't emit raw home path
    const payload = args.coldOnly
      ? { since: sinceLabel, knowledge_root: root, cold: report.cold }
      : { since: sinceLabel, knowledge_root: root, ...report };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  renderHuman(report, journalDirs, sinceLabel, args.coldOnly);
}

module.exports = {
  classifyArtifact,
  enumerateUniverse,
  loadReads,
  buildReport,
  parseArgs,
  looksLikeCortexRepo,
};

if (require.main === module) main();
