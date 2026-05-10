// test-smell-detector.cjs — Sprint 2.11 senior_tester_review Phase A.
//
// Deterministic, zero-LLM static analyzer over JS/TS test files. Walks the
// tests/ tree, applies regex heuristics from the 34-smell registry, returns
// ranked findings + layer-balance assessment.
//
// Design rules (per memo §4):
//   - Zero deps. Pure node:fs + regex.
//   - JS/TS only in v1 (cortex-x's Tier-1 audience). Java/Python deferred.
//   - False positives are acceptable — Phase B LLM judge re-ranks.
//   - Detectors for ~15-18 of the 34 smells where regex is clean. The
//     remaining smells stay in the registry for Phase B citation but have
//     `detector: 'llm-only'` here.
//   - Bounded by file count + per-file size + per-pattern timeout to prevent
//     ReDoS on adversarial test corpora.
//
// Output shape (consumed by Phase B + Phase C):
//   {
//     files_scanned: <int>,
//     test_files: [<rel-path>...],
//     total_findings: <int>,
//     findings: [{ smell_id, file, line, severity, excerpt }, ...],
//     layer_balance: { unit, integration, e2e, total, ratio, target, skew },
//     skipped: [{ file, reason }, ...]
//   }

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const registry = require('./test-smell-registry.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// Limits — defense against ReDoS / adversarial corpora.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TEST_FILES = 5_000;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB per file
const MAX_FINDINGS = 200; // hard cap on aggregate findings
const MAX_DEPTH = 12;
const PER_PATTERN_DEADLINE_MS = 50; // per-line regex deadline

// Default glob roots + filename patterns. Operator can override via opts.
const DEFAULT_TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'specs'];
const TEST_FILE_REGEX = /\.(test|spec)\.(c?js|m?js|tsx?)$/;

// Layer classification — used by layer_balance assessment.
const LAYER_PATTERNS = {
  e2e: /(^|\/)(e2e|end-to-end)(\/|\.|$)/i,
  integration: /(^|\/)integration(\/|\.|$)/i,
  unit: /(^|\/)unit(\/|\.|$)/i,
  contract: /(^|\/)contract(\/|\.|$)/i, // cortex-x has contract tests; map → integration
};
const DEFAULT_LAYER_TARGET = { unit: 70, integration: 20, e2e: 10 }; // pct

// ─────────────────────────────────────────────────────────────────────────────
// Detection patterns. Each pattern: { id, regex, capture? }. `capture` lets
// the detector extract a focused excerpt; default = matched line.
//
// Smells without a regex pattern are still in the 39-smell registry but
// their detector is null — Phase B LLM judge cites them based on overall
// file reading. Coverage stats:
//   - 16 / 39 with deterministic regex (~41%)
//   - 23 / 39 LLM-only (registry presence enables Phase B citation)
// ─────────────────────────────────────────────────────────────────────────────

const REGEX_DETECTORS = {
  // tsDetect FSE'20 — JS/TS detectable
  assertion_roulette: {
    // ≥ 3 expect()/assert() calls in a single test/it body without trailing
    // message argument. Heuristic: collect expect/assert calls per block.
    block: true,
    detect: (block) => {
      const calls = [...block.matchAll(/(?:expect|assert)\s*\(/g)];
      if (calls.length < 3) return null;
      // Look for explanatory comment within block — cheap heuristic
      if (/\b(?:test|it|expect|assert)[^,]+,\s*['"`][^'"`]{8,}['"`]/.test(block)) return null;
      return { count: calls.length };
    },
  },
  conditional_test_logic: {
    block: true,
    detect: (block) => {
      // Branching only — `if/switch/try` create distinct paths through the
      // test. Iteration (`for`/`while`) is fine when sweeping case tables.
      // Lift the matched line excerpt for actionable PR-body output.
      const m = block.match(/^[ \t]*(?:if\s*\([^)]+\)|switch\s*\([^)]+\)|try\s*\{)[\s\S]*?$/m);
      return m ? { excerpt: m[0].trim().slice(0, 80) } : null;
    },
  },
  empty_test: {
    block: true,
    detect: (block) => {
      // test('...', () => {}) or async () => {} with whitespace/comments only
      if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*$/.test(block)) {
        return { excerpt: '<empty>' };
      }
      return null;
    },
  },
  exception_catching_throwing: {
    block: true,
    detect: (block) => {
      // try { ... } catch (e) { ... } without subsequent expect.toThrow / assertThrows
      if (!/try\s*\{[\s\S]*?\}\s*catch/.test(block)) return null;
      if (/\.toThrow|assert\.throws|assertThrows|expectThrows/.test(block)) return null;
      return { excerpt: 'try/catch without toThrow' };
    },
  },
  ignored_test: {
    line: true,
    pattern: /\b(?:test|it|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(/,
  },
  magic_number_test: {
    line: true,
    // expect(x).toBe(<long literal>) — heuristic for magic number/string
    pattern: /\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*(?:\d{4,}|['"`][^'"`]{30,}['"`])\s*\)/,
  },
  mystery_guest: {
    block: true,
    detect: (block) => {
      // Per-alternative word boundaries — a single trailing \b after the
      // group blocks matches on alternatives ending in `(` (non-word) like
      // `fetch(` because the next char (typically a quote) is also non-word
      // so no boundary is present. Sprint 2.11.2 eval-suite finding.
      // Sprint 2.11.2 R2 edge-hunter MEDIUM: leading \b on the `require`
      // alternative — without it, `myrequire('../foo')` substring-matches
      // `require('../foo')` and triggers a false positive.
      const m = block.match(
        /\bfs\.readFileSync\b|\brequire\s*\(\s*['"`]\.\.?\/(?!fixtures)|\bfetch\s*\(|\baxios\.|\bhttp\.get\b|\bhttps\.get\b/,
      );
      return m ? { excerpt: m[0] } : null;
    },
  },
  print_statement: {
    line: true,
    pattern: /\bconsole\.(?:log|warn|info|debug|error)\s*\(/,
  },
  sensitive_equality: {
    line: true,
    pattern: /(?:expect\s*\([^)]*\.toString\s*\(\s*\)\s*\)|JSON\.stringify\s*\(\s*[^)]+\s*\)\s*\)\s*\.(?:toBe|toEqual))/,
  },
  sleepy_test: {
    block: true,
    detect: (block) => {
      const m = block.match(/\b(?:setTimeout|setInterval)\s*\(|await\s+(?:sleep|delay|wait)\s*\(/);
      return m ? { excerpt: m[0] } : null;
    },
  },
  unknown_test: {
    block: true,
    detect: (block) => {
      // No expect / assert / should / chai-style calls
      const has = /(?:\bexpect\s*\(|\bassert(?:\.|\s*\()|\bshould\.|\.should\b)/.test(block);
      if (has) return null;
      // But the block must be non-empty (not also caught by empty_test)
      if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*$/.test(block)) return null;
      return { excerpt: '<no assertion>' };
    },
  },
  verbose_test: {
    block: true,
    detect: (block) => {
      const lines = block.split('\n').length;
      if (lines <= 30) return null;
      return { excerpt: `${lines} lines` };
    },
  },
  // SNUTS-aligned + cortex-original — JS/TS detectable
  suboptimal_assert: {
    line: true,
    // expect(x).toBe(undefined) / .toBeUndefined() / .toBeTruthy() etc — weaker
    // than structural assertion the SUT supports. Per SNUTS.js (SBES 2024).
    pattern: /\.(?:toBeTruthy|toBeFalsy|toBeDefined|toBeUndefined|toBeNull|toBeNaN)\s*\(\s*\)|\.toBe\s*\(\s*undefined\s*\)|\.length\s*\)\s*\.toBe\s*\(/,
  },
  generic_test_name: {
    line: true,
    pattern: /(?:\btest\s*\(|\bit\s*\()\s*['"`](?:test\s*\d*|works?|should work|it works|spec\s*\d*|sample|todo|tbd)['"`]/i,
  },
  comments_only_test: {
    block: true,
    detect: (block) => {
      // Comment like "// expected: X" or "// should be Y" within block,
      // no expect call within 3 lines after. Per SNUTS.js Comments-Only Test.
      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/\/\/\s*(?:expected?[:\s]|should\s+(?:be|return|equal|throw))/i.test(lines[i])) {
          // Check next 3 lines for expect
          const window = lines.slice(i + 1, Math.min(i + 4, lines.length)).join('\n');
          if (!/\bexpect\s*\(|\bassert/.test(window)) {
            return { excerpt: lines[i].trim().slice(0, 80) };
          }
        }
      }
      return null;
    },
  },
  no_reproducibility_marker: {
    block: true,
    detect: (block) => {
      // Math.random() / faker. used; no seed pinning detected. cortex-original,
      // anchored in standards/correctness.md (Sprint 2.3a property-based testing).
      if (!/\bMath\.random\s*\(\s*\)|\bfaker\./i.test(block)) return null;
      // Heuristic: file-level seed call near the top is OK
      if (/\bfaker\.seed\s*\(|\.seed\s*\(\s*\d/.test(block)) return null;
      return { excerpt: 'random data without seed' };
    },
  },
};

// `redundant_print_statement` is the same shape as `print_statement` for v1.
// Sandoval ESE'25 13 smells (NASE / NARV / OIMT / DS / TSES / TSVM / NNA /
// EDNA / EDED / EDIS / TOFA / AC / ARPM) are registry-only in v1 — Phase B
// LLM judge cites them; deterministic regex detectors land in Sprint 2.11.1.
// `shared_mutable_state` was a v0 cortex-x draft now superseded by tsDetect's
// `mystery_guest` + `general_fixture` (verified by SBES 2024 / FSE 2020).

// ─────────────────────────────────────────────────────────────────────────────
// File walker
// ─────────────────────────────────────────────────────────────────────────────

function walkTestFiles(repoRoot, opts = {}) {
  const dirs = opts.testDirs || DEFAULT_TEST_DIRS;
  const found = [];
  const skipped = [];
  for (const dir of dirs) {
    const full = path.join(repoRoot, dir);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      walkDir(full, repoRoot, found, skipped, 0);
      if (found.length >= MAX_TEST_FILES) break;
    } catch {
      // dir doesn't exist; skip
    }
  }
  return { files: found, skipped };
}

function walkDir(dirPath, repoRoot, accum, skipped, depth) {
  if (depth > MAX_DEPTH) return;
  if (accum.length >= MAX_TEST_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    skipped.push({ file: path.relative(repoRoot, dirPath), reason: `readdir: ${err.code || err.message}` });
    return;
  }
  for (const entry of entries) {
    if (accum.length >= MAX_TEST_FILES) return;
    const name = entry.name;
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
    const full = path.join(dirPath, name);
    if (entry.isDirectory()) {
      walkDir(full, repoRoot, accum, skipped, depth + 1);
    } else if (entry.isFile() && TEST_FILE_REGEX.test(name)) {
      try {
        const st = fs.statSync(full);
        if (st.size > MAX_FILE_BYTES) {
          skipped.push({ file: path.relative(repoRoot, full), reason: `oversize-${st.size}` });
          continue;
        }
        accum.push(path.relative(repoRoot, full));
      } catch (err) {
        skipped.push({ file: path.relative(repoRoot, full), reason: `stat: ${err.code || err.message}` });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test-block extraction. Find each test()/it() block + its body. Uses a simple
// brace-matching state machine — not a full JS parser, but adequate for the
// regex-heuristic discipline.
// ─────────────────────────────────────────────────────────────────────────────

function extractTestBlocks(content) {
  // Find each `test(` / `it(` open-call, then walk braces to find the body.
  const blocks = [];
  const opener = /\b(?:test|it)\s*(?:\.[a-z]+\s*)?\(/g;
  let m;
  while ((m = opener.exec(content)) !== null) {
    if (blocks.length >= 1000) break; // sanity
    const start = m.index;
    // walk forward to find the `=>` or `function` then the opening `{`
    let i = m.index + m[0].length;
    let parenDepth = 1;
    while (i < content.length && parenDepth > 0) {
      const ch = content[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      i++;
    }
    if (parenDepth !== 0) continue;
    // Now scan back from `i` to find the `{` that opens the body.
    // Go forward from start of args looking for `{` at depth 0 of our search.
    // Simpler: rescan args region for the body fn.
    const argsRegion = content.slice(m.index + m[0].length, i - 1);
    const bodyStartRel = argsRegion.search(/=>\s*\{|function\s*[^)]*\)\s*\{/);
    if (bodyStartRel === -1) continue;
    const braceStart = m.index + m[0].length + argsRegion.indexOf('{', bodyStartRel);
    if (braceStart < 0) continue;
    let braceDepth = 1;
    let j = braceStart + 1;
    while (j < content.length && braceDepth > 0) {
      const ch = content[j];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      j++;
    }
    if (braceDepth !== 0) continue;
    const body = content.slice(braceStart + 1, j - 1);
    const lineStart = content.slice(0, start).split('\n').length;
    const nameMatch = m[0].match(/(test|it)\s*(?:\.([a-z]+))?\s*\(/);
    const blockKind = nameMatch ? nameMatch[1] : 'test';
    const blockMod = nameMatch ? nameMatch[2] || null : null;
    // Title is the first arg (before comma) if string literal.
    const argsBeforeBody = content.slice(start, braceStart);
    const titleMatch = argsBeforeBody.match(/['"`]([^'"`]+)['"`]/);
    blocks.push({
      kind: blockKind, // 'test' | 'it'
      mod: blockMod,   // 'skip' | 'only' | null
      title: titleMatch ? titleMatch[1] : null,
      line: lineStart,
      body,
      bodyStart: braceStart + 1,
      bodyEnd: j - 1,
    });
  }
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file scan
// ─────────────────────────────────────────────────────────────────────────────

function scanFile(relPath, content) {
  const findings = [];

  // File-level detectors
  for (const [smellId, det] of Object.entries(REGEX_DETECTORS)) {
    if (!det.file) continue;
    const result = det.detect(content);
    if (result && Array.isArray(result)) {
      for (const hit of result) {
        findings.push({
          smell_id: smellId,
          file: relPath,
          line: hit.line,
          severity: registry.getSmellById(smellId).severity,
          excerpt: hit.excerpt,
        });
      }
    }
  }

  // Line-level detectors (run once over the file)
  const lines = content.split('\n');
  for (const [smellId, det] of Object.entries(REGEX_DETECTORS)) {
    if (!det.line) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines for line-level smells (false-positive defense)
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue;
      const t0 = Date.now();
      let m;
      try {
        m = det.pattern.exec(line);
      } catch {
        m = null;
      }
      if (Date.now() - t0 > PER_PATTERN_DEADLINE_MS) break; // ReDoS defense
      if (m) {
        findings.push({
          smell_id: smellId,
          file: relPath,
          line: i + 1,
          severity: registry.getSmellById(smellId).severity,
          excerpt: line.trim().slice(0, 120),
        });
      }
    }
  }

  // Block-level detectors — extract test/it blocks once, then run per-block detectors
  const blocks = extractTestBlocks(content);
  for (const block of blocks) {
    for (const [smellId, det] of Object.entries(REGEX_DETECTORS)) {
      if (!det.block) continue;
      const result = det.detect(block.body);
      if (result) {
        findings.push({
          smell_id: smellId,
          file: relPath,
          line: block.line,
          severity: registry.getSmellById(smellId).severity,
          excerpt: result.excerpt || block.title || '<unnamed>',
          test_title: block.title,
        });
      }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer balance
// ─────────────────────────────────────────────────────────────────────────────

function classifyLayer(relPath) {
  // Normalize Windows backslashes so segment matching is portable.
  const norm = String(relPath).replace(/\\/g, '/');
  if (LAYER_PATTERNS.e2e.test(norm)) return 'e2e';
  if (LAYER_PATTERNS.integration.test(norm)) return 'integration';
  if (LAYER_PATTERNS.contract.test(norm)) return 'integration'; // contract → integration
  if (LAYER_PATTERNS.unit.test(norm)) return 'unit';
  return 'unit'; // default
}

// Layer balance — SMURF-aligned (Google 2024-10), not strict 70/20/10.
//
// Rationale (per Sprint 2.11 R1 research): the 70/20/10 ratio is folklore
// (Google internal docs leaked into Fowler 2018), NOT in Cohn 2009. Google's
// current guidance (testing.googleblog.com, Oct 2024) is SMURF — Speed,
// Maintainability, Utilization, Reliability, Fidelity — context-dependent
// 5-axis tradeoff with NO fixed ratio. We follow that: detect *gross
// imbalances* (anti-patterns), not strict-ratio compliance.
//
// Anti-patterns we flag:
//   - ice-cream cone: e2e_pct > 40 — top-heavy, slow CI, fragile
//   - no foundation: unit_count == 0 AND (integration + e2e) > 0
//   - all-in-one-tier: a single tier holds > 95% (suggests classification gap)
function computeLayerBalance(testFiles, target = DEFAULT_LAYER_TARGET) {
  const counts = { unit: 0, integration: 0, e2e: 0 };
  for (const f of testFiles) {
    counts[classifyLayer(f)]++;
  }
  const total = testFiles.length || 1;
  const ratio = {
    unit: Math.round((counts.unit / total) * 100),
    integration: Math.round((counts.integration / total) * 100),
    e2e: Math.round((counts.e2e / total) * 100),
  };
  const antiPatterns = [];
  if (ratio.e2e > 40) {
    antiPatterns.push({
      id: 'ice_cream_cone',
      severity: 'high',
      detail: `${ratio.e2e}% of tests are e2e — top-heavy pyramid (slow, brittle, weak isolation).`,
    });
  }
  if (counts.unit === 0 && (counts.integration + counts.e2e) > 0) {
    antiPatterns.push({
      id: 'no_unit_foundation',
      severity: 'high',
      detail: 'Zero unit tests despite integration/e2e tests existing — no fast feedback floor.',
    });
  }
  if (ratio.unit > 95 && (counts.integration + counts.e2e) === 0) {
    antiPatterns.push({
      id: 'unit_only',
      severity: 'low',
      detail: '100% unit tests — could indicate either pure-library scope (fine) OR classification gap (integration/e2e tests live elsewhere or under non-canonical paths).',
    });
  }
  // Optional informational delta vs target — kept as advisory metric, not
  // enforced as anti-pattern.
  const tiers = ['unit', 'integration', 'e2e'];
  let maxDelta = 0;
  let skewedTier = null;
  for (const tier of tiers) {
    const delta = Math.abs(ratio[tier] - target[tier]);
    if (delta > maxDelta) {
      maxDelta = delta;
      skewedTier = tier;
    }
  }
  let skew;
  if (antiPatterns.length === 0) {
    skew = 'no anti-patterns detected';
  } else {
    skew = antiPatterns.map((a) => `${a.id} (${a.severity})`).join('; ');
  }
  return {
    counts,
    total,
    ratio,
    target,
    skew,
    anti_patterns: antiPatterns,
    advisory_max_delta_pp: maxDelta,
    advisory_skewed_tier: skewedTier,
    pyramid_model_ref: 'SMURF (Google 2024-10) — testing.googleblog.com/2024/10/smurf-beyond-test-pyramid.html',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function detectAll(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const target = opts.layerTarget || DEFAULT_LAYER_TARGET;
  const { files, skipped } = walkTestFiles(repoRoot, opts);
  // Sprint 2.11 R2 (correctness HIGH-1): truncate-AFTER-sort, not before.
  // Previously we capped during file walk (alphabetical), then sorted —
  // dropped late-walked HIGH severity findings while filling cap with
  // early-walked LOW. Now collect ALL findings (bounded by per-file cap +
  // file count cap so memory stays bounded), then sort, then trim.
  // Defensive aggregate cap: 5x MAX_FINDINGS during collection so we never
  // collect more than ~1000 finding objects total.
  const COLLECT_CAP = MAX_FINDINGS * 5;
  const allFindings = [];
  for (const rel of files) {
    if (allFindings.length >= COLLECT_CAP) break;
    const full = path.join(repoRoot, rel);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch (err) {
      skipped.push({ file: rel, reason: `read: ${err.code || err.message}` });
      continue;
    }
    const fileFindings = scanFile(rel, content);
    for (const f of fileFindings) {
      if (allFindings.length >= COLLECT_CAP) break;
      allFindings.push(f);
    }
  }
  // Rank: severity weight (high=3, medium=2, low=1). Stable sort across ties
  // by smell_id then file:line for deterministic output across runs.
  const severityWeight = { high: 3, medium: 2, low: 1 };
  allFindings.sort((a, b) => {
    const sd = (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
    if (sd !== 0) return sd;
    const id = String(a.smell_id || '').localeCompare(String(b.smell_id || ''));
    if (id !== 0) return id;
    const f = String(a.file || '').localeCompare(String(b.file || ''));
    if (f !== 0) return f;
    return (a.line || 0) - (b.line || 0);
  });
  const truncated = allFindings.length > MAX_FINDINGS;
  const findings = allFindings.slice(0, MAX_FINDINGS);
  const layer_balance = computeLayerBalance(files, target);
  return {
    files_scanned: files.length,
    test_files: files,
    total_findings: allFindings.length, // pre-truncation total — operator sees the full count
    findings,                            // post-truncation top-N for display
    layer_balance,
    skipped,
    truncated,
  };
}

module.exports = {
  detectAll,
  scanFile,
  extractTestBlocks,
  walkTestFiles,
  computeLayerBalance,
  classifyLayer,
  REGEX_DETECTORS,
  DEFAULT_LAYER_TARGET,
  MAX_TEST_FILES,
  MAX_FILE_BYTES,
  MAX_FINDINGS,
};
