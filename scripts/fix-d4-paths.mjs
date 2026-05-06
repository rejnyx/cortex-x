#!/usr/bin/env node
// fix-d4-paths.mjs — one-shot D-4 mass rename per MIGRATIONS.md §D-4 convention.
//
// Convention:
//   ~/cortex-x/<installed-subdir>/  →  ~/.claude/shared/<installed-subdir>/
//     installed-subdir ∈ {prompts, standards, agents, profiles, templates,
//                         shared, skills, detectors, hooks}
//   ~/cortex-x/<live-subdir>/       →  $CORTEX_HOME/<live-subdir>/
//     live-subdir ∈ {projects, insights, research, journal, evals, config, docs}
//
// Files in includeOnly[] get rewrite. Files in skipFiles[] are NOT rewritten
// because they document the migration itself (CHANGELOG, MIGRATIONS, public-launch-plan,
// historical eval results).
//
// Usage:
//   node scripts/fix-d4-paths.mjs           # write
//   node scripts/fix-d4-paths.mjs --dry-run # preview only

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const installed = ['prompts', 'standards', 'agents', 'profiles', 'templates', 'shared', 'skills', 'detectors', 'hooks'];
const live = ['projects', 'insights', 'research', 'journal', 'evals', 'config', 'docs'];

// Files that SHOULD be rewritten (runtime-bound references CLAUDE will follow)
const includeOnly = [
  'README.md',
  'projects/README.md',
  'config/evolve.yaml',
  'prompts/sprint-status.md',
  'prompts/cortex-sync.md',
  'prompts/cortex-evolve.md',
  'prompts/cortex-load.md',
  'prompts/cortex-reflect.md',
  'prompts/project-scan.md',
  'prompts/retrospective.md',
  'prompts/code-review.md',
  'prompts/cortex-doctor.md',  // careful — has intentional "broken-prefix" diagnostic mentions
  'evals/eval-001-scaffold-nextjs-saas.md',
  'evals/README.md',
];

// Files NOT rewritten — they document the D-4 task / historical record
const skipFiles = new Set([
  'MIGRATIONS.md',
  'CHANGELOG.md',
  'docs/public-launch-plan.md',
  'evals/results/2026-05-01-01d9013-paper-baseline.json',
]);

// In cortex-doctor.md, certain mentions of `~/cortex-x/` are INTENTIONAL —
// they describe the legacy-broken-prefix detector. We must preserve these.
// Pattern: lines that talk about the broken prefix as a diagnostic target.
const doctorPreserveLines = new Set([
  // Build line-content-substring matches; we keep lines where these substrings appear.
  'legacy broken prefix',
  'known-broken',
  '(legacy broken prefix)',
  "grep -oE '(~/\\.claude/shared/[^`]+|~/cortex-x/[^`]+)'",
]);

function shouldPreserveLine(file, line) {
  if (file !== 'prompts/cortex-doctor.md') return false;
  for (const sub of doctorPreserveLines) {
    if (line.includes(sub)) return true;
  }
  return false;
}

function rewriteLine(line) {
  let out = line;
  // installed subdirs
  for (const sub of installed) {
    out = out.replaceAll(`~/cortex-x/${sub}/`, `~/.claude/shared/${sub}/`);
  }
  // live subdirs
  for (const sub of live) {
    out = out.replaceAll(`~/cortex-x/${sub}/`, `$CORTEX_HOME/${sub}/`);
  }
  // bare ~/cortex-x/install.sh / install.ps1 references → $CORTEX_HOME
  out = out.replaceAll('~/cortex-x/install.sh', '$CORTEX_HOME/install.sh');
  out = out.replaceAll('~/cortex-x/install.ps1', '$CORTEX_HOME/install.ps1');
  return out;
}

function rewriteFile(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return { rel, status: 'missing', changed: 0 };
  const src = fs.readFileSync(full, 'utf8');
  const lines = src.split('\n');
  let changed = 0;
  const out = lines.map((line) => {
    if (shouldPreserveLine(rel, line)) return line;
    const next = rewriteLine(line);
    if (next !== line) changed++;
    return next;
  });
  return { rel, status: 'rewritten', changed, content: out.join('\n') };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results = [];
  for (const rel of includeOnly) {
    if (skipFiles.has(rel)) continue;
    const r = rewriteFile(rel);
    results.push(r);
    if (r.status === 'rewritten' && r.changed > 0 && !dryRun) {
      fs.writeFileSync(path.join(ROOT, rel), r.content, 'utf8');
    }
  }
  console.log(`D-4 path rewrite (${dryRun ? 'DRY RUN' : 'APPLIED'}):`);
  let total = 0;
  for (const r of results) {
    if (r.status === 'missing') {
      console.log(`  MISSING  ${r.rel}`);
      continue;
    }
    if (r.changed > 0) {
      console.log(`  ${String(r.changed).padStart(3)} lines  ${r.rel}`);
      total += r.changed;
    }
  }
  console.log(`Total lines changed: ${total}`);
  console.log(`Files rewritten: ${results.filter(r => r.changed > 0).length}`);
  console.log(`Files in skipFiles (not rewritten — docs the migration): ${skipFiles.size}`);
}

main();
