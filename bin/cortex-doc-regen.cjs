#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// bin/cortex-doc-regen.cjs — Sprint 2.45 living-documentation regenerator.
//
// Walks the cortex-x repo filesystem, extracts a deterministic state
// snapshot (counts of skills/agents/CLIs/standards/prompts/detectors/
// workflows/profiles + tests + coverage + LOC + recent git activity),
// and replaces in-place the managed BEGIN/END markers inside operator-
// facing docs (atlas + capability-tree).
//
// SSOT for the marker contract: standards/documentation.md § State block convention
// SSOT for the file list (manifest): MANAGED constant in this file.
//
// CLI:
//   node bin/cortex-doc-regen.cjs               # print state snapshot to stdout
//   node bin/cortex-doc-regen.cjs --check       # exit 1 if any managed block is stale
//   node bin/cortex-doc-regen.cjs --json        # emit raw extracted data
//   node bin/cortex-doc-regen.cjs --apply       # write snapshots into managed files
//   node bin/cortex-doc-regen.cjs --help        # usage
//
// Exit codes:
//   0 — success (or --check found no drift)
//   1 — --check found stale block(s), or --apply / extractor error
//   2 — usage / unsafe-root error
//
// Determinism guarantees:
//   - All readdir results sorted via codepoint comparator (locale-free).
//   - No Date.now(), no Math.random(). Timestamp derives from latest git
//     commit date, --date arg, or SOURCE_DATE_EPOCH env (in that order).
//   - Zero external dependencies — Node built-ins only.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Root resolution + path-safety guard (mirrors Sprint 2.44 audit validateTargetDir).
// ---------------------------------------------------------------------------

const ENV_ROOT = process.env.CORTEX_DOC_REGEN_ROOT;
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function validateRoot(raw) {
  const value = String(raw || '').trim();
  if (value.length === 0) {
    throw new Error('cortex-doc-regen: empty root path');
  }
  if (value.includes('\0')) {
    throw new Error('cortex-doc-regen: root contains NUL byte — refusing');
  }
  if (value.includes('..')) {
    throw new Error("cortex-doc-regen: root contains '..' — refuse path traversal");
  }
  if (value.startsWith('\\\\')) {
    throw new Error('cortex-doc-regen: root is UNC path — refusing');
  }
  const resolved = path.resolve(value);
  let real;
  try { real = fs.realpathSync(resolved); } catch { real = resolved; }
  // Ensure resolved + real are the same prefix (no symlink escape).
  if (real !== resolved && !real.startsWith(path.dirname(resolved))) {
    throw new Error('cortex-doc-regen: symlink points outside expected location');
  }
  // Minimum: root must contain a package.json AND a bin/ dir to look like cortex-x.
  if (!fs.existsSync(path.join(resolved, 'package.json'))) {
    throw new Error(`cortex-doc-regen: root ${resolved} has no package.json — refusing`);
  }
  if (!fs.existsSync(path.join(resolved, 'bin'))) {
    throw new Error(`cortex-doc-regen: root ${resolved} has no bin/ — not a cortex-x repo`);
  }
  return resolved;
}

const ROOT = validateRoot(ENV_ROOT || DEFAULT_ROOT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Codepoint sort — locale-free, byte-identical across machines.
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function safeReadJson(p) {
  const raw = safeRead(p);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function safeReaddirSorted(absDir) {
  try {
    return fs.readdirSync(absDir).slice().sort(byCodepoint);
  } catch { return []; }
}

function safeReaddirEntsSorted(absDir) {
  try {
    return fs.readdirSync(absDir, { withFileTypes: true })
      .slice()
      .sort((a, b) => byCodepoint(a.name, b.name));
  } catch { return []; }
}

function countLines(absFile) {
  const txt = safeRead(absFile);
  if (txt === null) return 0;
  return txt.split('\n').length;
}

// ---------------------------------------------------------------------------
// Extractors — each fail-open: returns sensible default on failure, never throws.
// ---------------------------------------------------------------------------

function extractSkills(root) {
  const dir = path.join(root, 'shared', 'skills');
  const ents = safeReaddirEntsSorted(dir);
  const skills = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const skillMd = path.join(dir, e.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) skills.push(e.name);
  }
  return skills.slice().sort(byCodepoint);
}

function extractAgents(root) {
  const dir = path.join(root, 'agents');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort(byCodepoint);
}

function extractCLIs(root) {
  // CLIs under bin/, ending in .cjs, exclude internal _underscore-prefixed.
  const dir = path.join(root, 'bin');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.cjs'))
    .filter((f) => !f.startsWith('_'))
    .map((f) => f.replace(/\.cjs$/, ''))
    .sort(byCodepoint);
}

function extractStandards(root) {
  const dir = path.join(root, 'standards');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort(byCodepoint);
}

function extractPrompts(root) {
  const dir = path.join(root, 'prompts');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''))
    .sort(byCodepoint);
}

function extractDetectors(root) {
  const dir = path.join(root, 'detectors');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => f.replace(/\.cjs$/, ''))
    .sort(byCodepoint);
}

function extractWorkflows(root) {
  const dir = path.join(root, '.github', 'workflows');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter((f) => !f.includes('.example.'))
    .sort(byCodepoint);
}

function extractProfiles(root) {
  const dir = path.join(root, 'profiles');
  return safeReaddirSorted(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort(byCodepoint);
}

function extractTestCounts(root) {
  // Count .test.cjs files per bucket (unit / contract / integration / smoke).
  const buckets = ['unit', 'contract', 'integration', 'smoke'];
  const counts = {};
  let total = 0;
  for (const b of buckets) {
    const bdir = path.join(root, 'tests', b);
    if (!fs.existsSync(bdir)) { counts[b] = 0; continue; }
    let n = 0;
    const stack = [bdir];
    const seen = new Set();
    while (stack.length) {
      const d = stack.pop();
      let real;
      try { real = fs.realpathSync(d); } catch { continue; }
      if (seen.has(real)) continue;
      seen.add(real);
      const ents = safeReaddirEntsSorted(d);
      for (const ent of ents) {
        if (ent.isSymbolicLink()) continue;
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.name.endsWith('.test.cjs')) {
          n += 1;
        }
      }
    }
    counts[b] = n;
    total += n;
  }
  return { counts, total };
}

function extractCoverage(root) {
  const p = path.join(root, 'coverage', 'coverage-summary.json');
  const j = safeReadJson(p);
  if (!j || !j.total) return null;
  const t = j.total;
  const pct = (k) => (t[k] && typeof t[k].pct === 'number') ? t[k].pct : null;
  return {
    lines_pct: pct('lines'),
    statements_pct: pct('statements'),
    functions_pct: pct('functions'),
    branches_pct: pct('branches'),
  };
}

function extractGitActivity(root) {
  // git log via spawnSync — latest 5 commits: sha, date (ISO), subject.
  // Fail-open: if git missing or not a repo, return empty array + null date.
  try {
    const res = spawnSync(
      'git',
      ['-C', root, 'log', '-5', '--pretty=format:%H%x09%cI%x09%s'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (res.status !== 0 || !res.stdout) return { commits: [], latest_date: null };
    const lines = String(res.stdout).split('\n').filter(Boolean);
    const commits = lines.map((l) => {
      const [sha, date, ...subjectParts] = l.split('\t');
      return {
        sha: (sha || '').slice(0, 7),
        date: date || null,
        subject: (subjectParts.join('\t') || '').slice(0, 100),
      };
    });
    const latest_date = commits.length > 0 ? commits[0].date : null;
    return { commits, latest_date };
  } catch {
    return { commits: [], latest_date: null };
  }
}

function extractLoc(root) {
  // Top 15 largest .cjs files under bin/ by line count. Skip symlinks.
  const binDir = path.join(root, 'bin');
  const files = [];
  const stack = [binDir];
  const seen = new Set();
  while (stack.length) {
    const d = stack.pop();
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    const ents = safeReaddirEntsSorted(d);
    for (const ent of ents) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.name.endsWith('.cjs')) {
        const lines = countLines(full);
        const rel = path.relative(root, full).replace(/\\/g, '/');
        files.push({ path: rel, lines });
      }
    }
  }
  // Sort by lines desc, tie-break by path asc (deterministic).
  files.sort((a, b) => b.lines - a.lines || byCodepoint(a.path, b.path));
  return files.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

function buildSnapshot(root) {
  const skills = extractSkills(root);
  const agents = extractAgents(root);
  const clis = extractCLIs(root);
  const standards = extractStandards(root);
  const prompts = extractPrompts(root);
  const detectors = extractDetectors(root);
  const workflows = extractWorkflows(root);
  const profiles = extractProfiles(root);
  const tests = extractTestCounts(root);
  const coverage = extractCoverage(root);
  const git = extractGitActivity(root);
  const topLoc = extractLoc(root);

  // Deterministic timestamp source order:
  //   1. --date CLI arg (handled in main, passed in via snapshot)
  //   2. SOURCE_DATE_EPOCH env (POSIX reproducible-builds standard)
  //   3. latest git commit date
  //   4. null (rendered as "unknown")
  let snapshotDate = null;
  if (process.env.SOURCE_DATE_EPOCH) {
    const epoch = parseInt(process.env.SOURCE_DATE_EPOCH, 10);
    if (Number.isFinite(epoch)) {
      snapshotDate = new Date(epoch * 1000).toISOString();
    }
  }
  if (!snapshotDate && git.latest_date) {
    snapshotDate = git.latest_date;
  }

  const snap = {
    // Sprint 2.45 R2 HIGH-3 fix: renamed from snapshot_date to generated
    // to match test contract (tests/unit/tools/cortex-doc-regen.test.cjs:157)
    // and the conventional "generated" naming used by mkdocs / Sphinx.
    generated: snapshotDate,
    counts: {
      skills: skills.length,
      agents: agents.length,
      clis: clis.length,
      standards: standards.length,
      prompts: prompts.length,
      detectors: detectors.length,
      workflows: workflows.length,
      profiles: profiles.length,
      tests_total: tests.total,
    },
    skills,
    agents,
    clis,
    standards,
    prompts,
    detectors,
    workflows,
    profiles,
    tests,
    coverage,
    git,
    top_loc: topLoc,
  };
  return Object.freeze(snap);
}

// ---------------------------------------------------------------------------
// Renderers — deterministic markdown.
// ---------------------------------------------------------------------------

function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toFixed(2)}%`;
}

function renderStateSnapshot(snap, dateOverride) {
  const lines = [];
  const date = dateOverride || snap.generated || 'unknown';
  lines.push('');
  lines.push(`**Snapshot date:** \`${date}\`  `);
  if (snap.git && snap.git.commits.length > 0) {
    lines.push(`**HEAD:** \`${snap.git.commits[0].sha}\` — ${snap.git.commits[0].subject.replace(/\|/g, '\\|')}`);
  }
  lines.push('');
  lines.push('### Counts');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|---|---|');
  lines.push(`| Skills (\`shared/skills/*/SKILL.md\`) | ${snap.counts.skills} |`);
  lines.push(`| Agents (\`agents/*.md\`) | ${snap.counts.agents} |`);
  lines.push(`| CLIs (\`bin/*.cjs\`) | ${snap.counts.clis} |`);
  lines.push(`| Standards (\`standards/*.md\`) | ${snap.counts.standards} |`);
  lines.push(`| Prompts (\`prompts/*.md\`) | ${snap.counts.prompts} |`);
  lines.push(`| Detectors (\`detectors/*.cjs\`) | ${snap.counts.detectors} |`);
  lines.push(`| Workflows (\`.github/workflows/*.yml\`) | ${snap.counts.workflows} |`);
  lines.push(`| Profiles (\`profiles/*.yaml\`) | ${snap.counts.profiles} |`);
  lines.push(`| Tests total (\`tests/**/*.test.cjs\`) | ${snap.counts.tests_total} |`);
  lines.push('');
  if (snap.tests && snap.tests.counts) {
    const c = snap.tests.counts;
    lines.push(`> Test breakdown — unit ${c.unit || 0} · contract ${c.contract || 0} · integration ${c.integration || 0} · smoke ${c.smoke || 0}.`);
    lines.push('');
  }
  if (snap.coverage) {
    lines.push('### Coverage');
    lines.push('');
    lines.push('| Metric | Pct |');
    lines.push('|---|---|');
    lines.push(`| Lines | ${fmtPct(snap.coverage.lines_pct)} |`);
    lines.push(`| Statements | ${fmtPct(snap.coverage.statements_pct)} |`);
    lines.push(`| Functions | ${fmtPct(snap.coverage.functions_pct)} |`);
    lines.push(`| Branches | ${fmtPct(snap.coverage.branches_pct)} |`);
    lines.push('');
  } else {
    lines.push('### Coverage');
    lines.push('');
    lines.push('_No `coverage/coverage-summary.json` found — run `npm run test:coverage` to populate._');
    lines.push('');
  }
  if (snap.git && snap.git.commits.length > 0) {
    lines.push('### Recent activity');
    lines.push('');
    lines.push('| SHA | Date | Subject |');
    lines.push('|---|---|---|');
    for (const c of snap.git.commits) {
      const subj = c.subject.replace(/\|/g, '\\|');
      lines.push(`| \`${c.sha}\` | ${c.date || '—'} | ${subj} |`);
    }
    lines.push('');
  }
  if (snap.top_loc && snap.top_loc.length > 0) {
    lines.push('### Top 15 largest CLIs (by LOC)');
    lines.push('');
    lines.push('| File | Lines |');
    lines.push('|---|---|');
    for (const f of snap.top_loc) {
      lines.push(`| \`${f.path}\` | ${f.lines} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Block-replace engine. The marker contract uses HTML comments at column 0:
//   <!-- BEGIN state:snapshot -->
//   ...content...
//   <!-- END state:snapshot -->
// ---------------------------------------------------------------------------

function buildBlockRegex(blockId) {
  // Sprint 2.45 R2 HIGH-4 fix: canonical marker contract mandates LONG form
  // `<!-- BEGIN cortex-x <id> (v<N>) - managed by <tool> -->` (mirrors
  // cortex-claude-md-augment v6 pattern). Earlier shipped a SHORT form that
  // diverged from standards/documentation.md spec and test assertions.
  // The version number captured (v\d+) is exposed for schema-bump detection
  // by future Sprint 2.45.1+ when block schemas evolve.
  const esc = blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    '(<!--\\s*BEGIN\\s+cortex-x\\s+' + esc + '\\s+\\(v\\d+\\)\\s*-\\s*managed\\s+by\\s+[a-z][a-z0-9-]*\\s*-->)' +
      '([\\s\\S]*?)' +
      '(<!--\\s*END\\s+cortex-x\\s+' + esc + '\\s*-->)',
    'g'
  );
}

function findBlock(content, blockId) {
  const re = buildBlockRegex(blockId);
  const m = re.exec(content);
  if (!m) return null;
  return {
    full: m[0],
    begin: m[1],
    inner: m[2],
    end: m[3],
    index: m.index,
  };
}

function replaceBlock(content, blockId, newInner) {
  const re = buildBlockRegex(blockId);
  // Ensure inner is sandwiched with newlines per contract.
  const wrapped = '\n' + newInner.replace(/^\n+|\n+$/g, '') + '\n';
  let replacedCount = 0;
  const out = content.replace(re, (_, begin, _inner, end) => {
    replacedCount += 1;
    return begin + wrapped + end;
  });
  return { out, replacedCount };
}

// ---------------------------------------------------------------------------
// Managed-files manifest (SSOT).
// Glob-style: we accept a directory + filename-prefix and resolve to all matches.
// ---------------------------------------------------------------------------

// Sprint 2.45 R2 HIGH-4 fix: block IDs use kebab-case to match canonical
// marker contract. Was 'state:snapshot' (colon — SHORT form legacy).
const MANAGED = [
  { dir: 'cortex', prefix: 'atlas-', suffix: '.md', blocks: ['state-snapshot'] },
  { dir: 'cortex', prefix: 'capability-tree-', suffix: '.md', blocks: ['state-snapshot'] },
];

function resolveManagedFiles(root) {
  const out = [];
  for (const m of MANAGED) {
    const dir = path.join(root, m.dir);
    const entries = safeReaddirSorted(dir);
    for (const f of entries) {
      if (!f.startsWith(m.prefix)) continue;
      if (!f.endsWith(m.suffix)) continue;
      out.push({
        absPath: path.join(dir, f),
        relPath: path.posix.join(m.dir, f),
        blocks: m.blocks,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function operationCheck(snap, dateOverride) {
  const files = resolveManagedFiles(ROOT);
  const drift = [];
  const expected = renderStateSnapshot(snap, dateOverride);
  const expectedNorm = '\n' + expected.replace(/^\n+|\n+$/g, '') + '\n';
  for (const f of files) {
    const txt = safeRead(f.absPath);
    if (txt === null) {
      drift.push({ file: f.relPath, reason: 'unreadable' });
      continue;
    }
    for (const blockId of f.blocks) {
      const block = findBlock(txt, blockId);
      if (!block) {
        drift.push({ file: f.relPath, blockId, reason: 'marker-missing' });
        continue;
      }
      if (block.inner !== expectedNorm) {
        drift.push({ file: f.relPath, blockId, reason: 'content-stale' });
      }
    }
  }
  return drift;
}

function operationApply(snap, dateOverride) {
  const files = resolveManagedFiles(ROOT);
  const expected = renderStateSnapshot(snap, dateOverride);
  const results = [];
  for (const f of files) {
    const before = safeRead(f.absPath);
    if (before === null) {
      results.push({ file: f.relPath, status: 'unreadable' });
      continue;
    }
    let working = before;
    let blocksChanged = 0;
    let blocksMissing = 0;
    for (const blockId of f.blocks) {
      const block = findBlock(working, blockId);
      if (!block) {
        blocksMissing += 1;
        continue;
      }
      const { out, replacedCount } = replaceBlock(working, blockId, expected);
      if (replacedCount > 0 && out !== working) {
        blocksChanged += 1;
        working = out;
      }
    }
    if (working !== before) {
      try {
        fs.writeFileSync(f.absPath, working);
        results.push({ file: f.relPath, status: 'updated', blocks_changed: blocksChanged, blocks_missing: blocksMissing });
      } catch (err) {
        results.push({ file: f.relPath, status: 'write-error', error: String(err && err.message) });
      }
    } else {
      results.push({ file: f.relPath, status: 'unchanged', blocks_missing: blocksMissing });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function getFlagValue(args, name) {
  // Supports --name=val and --name val.
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function showHelp() {
  process.stdout.write(`Usage: cortex-doc-regen [options]

Sprint 2.45 living-documentation regenerator. Walks the cortex-x repo
and replaces managed BEGIN/END marker blocks inside operator-facing docs
(atlas + capability-tree) with a deterministic state snapshot.

Options:
  (default)       Print state-snapshot markdown to stdout (no writes).
  --check         Compare managed blocks vs current snapshot. Exit 1 if stale.
  --apply         Write snapshot into managed files in place. Idempotent.
  --json          Emit raw extracted snapshot as JSON to stdout. Exit 0.
  --date=<iso>    Override timestamp shown in snapshot (ISO 8601).
  --help, -h      Show this help.

Environment:
  CORTEX_DOC_REGEN_ROOT   Override repo root (default: derived from this file).
  SOURCE_DATE_EPOCH       POSIX reproducible-builds timestamp (Unix seconds).

Exit codes:
  0   success / no drift
  1   --check found drift, --apply error, extractor error
  2   usage / unsafe-root error
`);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const dateOverride = getFlagValue(args, 'date') || null;
  const isCheck = args.includes('--check');
  const isJson = args.includes('--json');
  const isApply = args.includes('--apply');

  let snap;
  try {
    snap = buildSnapshot(ROOT);
  } catch (err) {
    process.stderr.write(`cortex-doc-regen: snapshot build failed: ${err && err.message}\n`);
    return 1;
  }

  if (isJson) {
    const payload = {
      root: ROOT,
      snapshot: snap,
      managed_files: resolveManagedFiles(ROOT).map((f) => ({
        path: f.relPath,
        blocks: f.blocks,
      })),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  if (isCheck) {
    const drift = operationCheck(snap, dateOverride);
    if (drift.length === 0) {
      process.stdout.write('cortex-doc-regen: all managed blocks are up to date.\n');
      return 0;
    }
    process.stderr.write(`cortex-doc-regen: ${drift.length} managed block(s) are stale:\n`);
    for (const d of drift) {
      const blk = d.blockId ? ` [${d.blockId}]` : '';
      process.stderr.write(`  - ${d.file}${blk} — ${d.reason}\n`);
    }
    process.stderr.write('\nRun: node bin/cortex-doc-regen.cjs --apply\n');
    return 1;
  }

  if (isApply) {
    const results = operationApply(snap, dateOverride);
    let hadError = false;
    for (const r of results) {
      const extra = r.blocks_changed !== undefined ? ` (blocks_changed=${r.blocks_changed}, missing=${r.blocks_missing})` : '';
      process.stdout.write(`  ${r.status.padEnd(12)} ${r.file}${extra}\n`);
      if (r.status === 'write-error' || r.status === 'unreadable') hadError = true;
    }
    return hadError ? 1 : 0;
  }

  // Default: print state-snapshot markdown to stdout.
  process.stdout.write(renderStateSnapshot(snap, dateOverride) + '\n');
  return 0;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main(process.argv) || 0;
  } catch (err) {
    process.stderr.write(`cortex-doc-regen: fatal: ${err && err.message}\n`);
    code = 2;
  }
  process.exit(code);
}

module.exports = {
  buildSnapshot,
  renderStateSnapshot,
  replaceBlock,
  findBlock,
  resolveManagedFiles,
  operationCheck,
  operationApply,
  main,
};
