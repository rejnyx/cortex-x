#!/usr/bin/env node
// sync-to-public.mjs — copy private cortex-x → clean public snapshot.
//
// Reads sanitize-rules.json. Walks the private cortex-x source, copies every
// file matching fileInclusions globs (skipping fileExclusions), applying
// text replacements during copy. Skips binary files (passed through). Reports
// a per-file summary of replacements applied, plus a diff vs prior snapshot.
//
// Usage:
//   node scripts/sync-to-public.mjs --source . --target /tmp/cortex-public-snapshot
//   node scripts/sync-to-public.mjs --source . --target ../cortex-x-public --validate
//
// With --validate, automatically invokes validate-no-pii.mjs against the
// target after sync. Exit non-zero if validation fails.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, 'sanitize-rules.json');
const VALIDATE_SCRIPT = path.join(__dirname, 'validate-no-pii.mjs');

function parseArgs(argv) {
  const args = { source: null, target: null, validate: false, dryRun: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && argv[i + 1]) { args.source = argv[++i]; }
    else if (a.startsWith('--source=')) { args.source = a.slice('--source='.length); }
    else if (a === '--target' && argv[i + 1]) { args.target = argv[++i]; }
    else if (a.startsWith('--target=')) { args.target = a.slice('--target='.length); }
    else if (a === '--validate') { args.validate = true; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--quiet' || a === '-q') { args.quiet = true; }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node sync-to-public.mjs --source <dir> --target <dir> [--validate] [--dry-run] [--quiet]');
      process.exit(0);
    }
  }
  return args;
}

function loadRules() {
  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
  } catch (err) {
    console.error(`ERROR: cannot read sanitize-rules.json: ${err.message}`);
    process.exit(2);
  }
}

// Tiny glob → regex compiler. Supports **, *, ?, character classes.
function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$|()'.includes(c)) {
      re += '\\' + c;
    } else if (c === '\\') {
      re += '\\\\';
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAny(relPath, patterns) {
  for (const p of patterns) {
    const re = globToRegex(p);
    if (re.test(relPath)) return true;
  }
  return false;
}

function* walkFiles(dir, baseDir = dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
      yield* walkFiles(full, baseDir);
    } else if (entry.isFile()) {
      yield { full, rel };
    }
  }
}

function isBinary(buffer) {
  const limit = Math.min(buffer.length, 512);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

// Returns true if a given replacement should be skipped for relPath because the
// file is an authorship-exempt destination per blacklistAuthorshipExceptions.
function isAuthorshipScoped(relPath, replacement, rules) {
  if (replacement.scope !== 'all-but-authorship') return false;
  const exempt = rules.blacklistAuthorshipExceptions || {};
  const exemptFiles = new Set(exempt.files || []);
  if (exemptFiles.has(relPath)) return true;
  const patterns = exempt.patterns || {};
  const filePatterns = patterns[relPath];
  if (!filePatterns) return false;
  // If the find term is in the file's allowed-pattern list, this replacement is exempt.
  return filePatterns.some(p => p.includes(replacement.find) || replacement.find.includes(p));
}

function applyReplacements(content, replacements, relPath, rules) {
  let result = content;
  let totalApplied = 0;
  const perReplacement = {};
  for (const r of replacements) {
    if (!r.find || r.replace === undefined) continue;
    if (isAuthorshipScoped(relPath, r, rules)) continue;
    const before = result;
    // Escape special regex chars in find string for literal replacement
    const escaped = r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'g');
    result = result.replace(re, r.replace);
    if (result !== before) {
      // Count occurrences in original
      let n = 0;
      let idx = 0;
      while ((idx = before.indexOf(r.find, idx)) !== -1) { n++; idx += r.find.length; }
      perReplacement[r.find] = n;
      totalApplied += n;
    }
  }
  return { content: result, totalApplied, perReplacement };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clearTarget(target) {
  if (!fs.existsSync(target)) return;
  // Remove contents but keep the dir itself (so the target path is stable)
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.source || !args.target) {
    console.error('ERROR: --source <dir> and --target <dir> both required');
    console.error('Usage: node sync-to-public.mjs --source <dir> --target <dir> [--validate] [--dry-run] [--quiet]');
    process.exit(2);
  }

  const sourceAbs = path.resolve(args.source);
  const targetAbs = path.resolve(args.target);

  if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isDirectory()) {
    console.error(`ERROR: source not found or not a directory: ${sourceAbs}`);
    process.exit(2);
  }

  // Refuse to write target == source (catastrophe protection)
  if (path.relative(sourceAbs, targetAbs) === '' || targetAbs.startsWith(sourceAbs + path.sep)) {
    console.error(`ERROR: refusing to sync to a path inside source. target must be outside source.`);
    console.error(`  source: ${sourceAbs}`);
    console.error(`  target: ${targetAbs}`);
    process.exit(2);
  }

  const rules = loadRules();
  const inclusions = rules.fileInclusions || [];
  const exclusions = rules.fileExclusions || [];
  const replacements = rules.replacements || [];

  if (!args.quiet) {
    console.log(`sync-to-public: ${sourceAbs} → ${targetAbs}${args.dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`  rules version: ${rules.version}`);
    console.log(`  inclusions: ${inclusions.length} patterns`);
    console.log(`  exclusions: ${exclusions.length} patterns`);
    console.log(`  replacements: ${replacements.length} rules`);
    console.log('');
  }

  if (!args.dryRun) {
    ensureDir(targetAbs);
    clearTarget(targetAbs);
  }

  let copiedCount = 0;
  let skippedExcluded = 0;
  let skippedNotIncluded = 0;
  let totalReplacements = 0;
  const replacementByRule = {};

  for (const { full, rel } of walkFiles(sourceAbs)) {
    if (matchesAny(rel, exclusions)) {
      skippedExcluded++;
      continue;
    }
    if (!matchesAny(rel, inclusions)) {
      skippedNotIncluded++;
      continue;
    }

    const buffer = fs.readFileSync(full);
    const targetFile = path.join(targetAbs, rel);

    if (isBinary(buffer)) {
      // Pass through binary files unchanged
      if (!args.dryRun) {
        ensureDir(path.dirname(targetFile));
        fs.writeFileSync(targetFile, buffer);
      }
      copiedCount++;
      continue;
    }

    const text = buffer.toString('utf8');
    const { content, totalApplied, perReplacement } = applyReplacements(text, replacements, rel, rules);
    totalReplacements += totalApplied;
    for (const [find, n] of Object.entries(perReplacement)) {
      replacementByRule[find] = (replacementByRule[find] || 0) + n;
    }

    if (!args.dryRun) {
      ensureDir(path.dirname(targetFile));
      fs.writeFileSync(targetFile, content, 'utf8');
    }
    copiedCount++;
  }

  if (!args.quiet) {
    console.log('Sync complete:');
    console.log(`  copied: ${copiedCount} files`);
    console.log(`  skipped (excluded): ${skippedExcluded}`);
    console.log(`  skipped (not in inclusions): ${skippedNotIncluded}`);
    console.log(`  total replacements applied: ${totalReplacements}`);
    if (Object.keys(replacementByRule).length > 0 && !args.quiet) {
      console.log('');
      console.log('Replacements per rule (top 10):');
      const sorted = Object.entries(replacementByRule).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [find, n] of sorted) {
        const truncFind = find.length > 60 ? find.slice(0, 57) + '...' : find;
        console.log(`  ${n}× "${truncFind}"`);
      }
    }
    console.log('');
  }

  if (args.dryRun) {
    if (!args.quiet) console.log('Dry run — no files written. Re-run without --dry-run to write.');
    process.exit(0);
  }

  if (args.validate) {
    if (!args.quiet) console.log('Running validate-no-pii.mjs against target...');
    const result = spawnSync('node', [VALIDATE_SCRIPT, '--target', targetAbs], {
      stdio: 'inherit',
    });
    process.exit(result.status || 0);
  }

  process.exit(0);
}

main();
