#!/usr/bin/env node
// validate-no-pii.mjs — pre-publish guard for cortex-x public snapshot.
//
// Scans every file in the target directory for blacklist terms defined in
// sanitize-rules.json. Reports hits with file:line:term context. Exits
// non-zero if ANY blacklist term is found outside of documented authorship
// exceptions.
//
// Usage:
//   node scripts/validate-no-pii.mjs --target /tmp/cortex-public-snapshot
//   node scripts/validate-no-pii.mjs --target ../cortex-x-public --quiet
//
// Exit codes:
//   0 — clean, no blacklist hits found in non-exempt files
//   1 — at least one blacklist hit found (publish must be blocked)
//   2 — usage error (missing --target, rules file unreadable, etc.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, 'sanitize-rules.json');

function parseArgs(argv) {
  const args = { target: null, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target' && argv[i + 1]) { args.target = argv[++i]; }
    else if (a.startsWith('--target=')) { args.target = a.slice('--target='.length); }
    else if (a === '--quiet' || a === '-q') { args.quiet = true; }
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node validate-no-pii.mjs --target <dir> [--quiet]');
      process.exit(0);
    }
  }
  return args;
}

function loadRules() {
  try {
    const raw = fs.readFileSync(RULES_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: cannot read sanitize-rules.json at ${RULES_PATH}`);
    console.error(err.message);
    process.exit(2);
  }
}

function buildBlacklistTerms(rules) {
  const terms = [];
  const b = rules.blacklist || {};
  for (const [category, list] of Object.entries(b)) {
    if (category === 'description' || !Array.isArray(list)) continue;
    for (const term of list) {
      if (term) terms.push({ term, category });
    }
  }
  return terms;
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
      // Skip vendor / build / git
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
      yield* walkFiles(full, baseDir);
    } else if (entry.isFile()) {
      yield { full, rel };
    }
  }
}

function isBinary(buffer) {
  // Heuristic: presence of null byte in first 512 bytes = binary.
  const limit = Math.min(buffer.length, 512);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function isAuthorshipExempt(relPath, rules, term) {
  const exempt = rules.blacklistAuthorshipExceptions || {};
  const exemptFiles = exempt.files || [];
  if (exemptFiles.includes(relPath)) return true;

  const patterns = exempt.patterns || {};
  const filePatterns = patterns[relPath];
  if (!filePatterns) return false;

  // If file has a pattern list, term is exempt only if it matches one of those patterns
  return filePatterns.some(p => p.includes(term) || term.includes(p));
}

function scanFile(filePath, relPath, terms, rules) {
  const hits = [];
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return hits;
  }
  if (isBinary(buffer)) return hits;

  const content = buffer.toString('utf8');
  const lines = content.split('\n');

  for (const { term, category } of terms) {
    if (!term) continue;
    if (isAuthorshipExempt(relPath, rules, term)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const idx = line.indexOf(term);
      if (idx >= 0) {
        hits.push({
          file: relPath,
          line: i + 1,
          col: idx + 1,
          term,
          category,
          context: line.trim().slice(0, 120),
        });
      }
    }
  }
  return hits;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.target) {
    console.error('ERROR: --target <dir> required');
    console.error('Usage: node validate-no-pii.mjs --target <dir> [--quiet]');
    process.exit(2);
  }

  const targetAbs = path.resolve(args.target);
  if (!fs.existsSync(targetAbs) || !fs.statSync(targetAbs).isDirectory()) {
    console.error(`ERROR: target not found or not a directory: ${targetAbs}`);
    process.exit(2);
  }

  const rules = loadRules();
  const terms = buildBlacklistTerms(rules);

  if (!args.quiet) {
    console.log(`validate-no-pii: scanning ${targetAbs}`);
    console.log(`  rules version: ${rules.version}`);
    console.log(`  blacklist terms: ${terms.length}`);
  }

  const allHits = [];
  let scannedCount = 0;
  for (const { full, rel } of walkFiles(targetAbs)) {
    scannedCount++;
    const hits = scanFile(full, rel, terms, rules);
    if (hits.length > 0) allHits.push(...hits);
  }

  if (!args.quiet) {
    console.log(`  files scanned: ${scannedCount}`);
    console.log('');
  }

  if (allHits.length === 0) {
    if (!args.quiet) console.log('OK — no PII blacklist hits found.');
    process.exit(0);
  }

  // Group by category
  const byCategory = {};
  for (const h of allHits) {
    if (!byCategory[h.category]) byCategory[h.category] = [];
    byCategory[h.category].push(h);
  }

  console.error(`FAIL — ${allHits.length} blacklist hit(s) across ${Object.keys(byCategory).length} categor${Object.keys(byCategory).length === 1 ? 'y' : 'ies'}:`);
  console.error('');
  for (const [category, hits] of Object.entries(byCategory)) {
    console.error(`  [${category}] ${hits.length} hit(s):`);
    for (const h of hits.slice(0, 20)) {
      console.error(`    ${h.file}:${h.line}:${h.col} — "${h.term}"`);
      console.error(`      | ${h.context}`);
    }
    if (hits.length > 20) {
      console.error(`    ... ${hits.length - 20} more (use without --quiet to see all)`);
    }
    console.error('');
  }

  console.error('Publish blocked. Update sanitize-rules.json or fix source files, then re-run sync.');
  process.exit(1);
}

main();
