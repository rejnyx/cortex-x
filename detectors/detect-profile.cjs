#!/usr/bin/env node
// cortex-x profile detector.
//
// Scans CWD signals (package.json deps, file patterns, config files) against
// `profiles/*.yaml` detect blocks, ranks candidates by confidence.
//
// Contract (per standards/auto-optimization.md):
//   - <100ms on typical projects
//   - No LLM, no network, no process spawn
//   - Read-only (never mutates fs)
//   - Fail-open: return { candidates: [], error } on any failure
//
// Usage:
//   node detectors/detect-profile.cjs
//   node detectors/detect-profile.cjs --cwd /path/to/project
//   const { detect } = require('./detect-profile.cjs')
//   const result = detect(process.cwd())

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { scoreCandidate, rankCandidates, confidenceLevel } = require('./_lib/score.cjs');

// Resolve cortex-x profiles directory. Prefer $CORTEX_HOME, then installed
// shared copy, then common local dev paths.
function resolveProfilesDir() {
  const candidates = [];
  if (process.env.CORTEX_HOME) candidates.push(path.join(process.env.CORTEX_HOME, 'profiles'));
  candidates.push(path.join(os.homedir(), '.claude', 'shared', 'profiles'));
  candidates.push(path.join(os.homedir(), 'cortex-x', 'profiles'));
  candidates.push(path.join(os.homedir(), 'Desktop', 'APPs', 'cortex-x', 'profiles'));
  candidates.push(path.join(os.homedir(), '.cortex-x', 'profiles'));

  for (const p of candidates) {
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch (_) {}
  }
  return null;
}

// Minimal YAML parser — profiles use flat key: value + simple lists.
// Full YAML library not worth the dep for detector-only use.
function parseProfileYaml(content) {
  const result = { detect: {} };
  const lines = content.split(/\r?\n/);

  let section = null; // 'detect', 'detect.package_json', 'detect.files', etc.
  let subsection = null;
  let currentList = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;

    // top-level key: value
    const topMatch = line.match(/^([a-z_]+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1];
      const val = topMatch[2].trim();
      if (key === 'name') result.name = val;
      if (key === 'description') result.description = val;
      if (key === 'extends') result.extends = val;
      if (key === 'detect') {
        section = 'detect';
        subsection = null;
      } else if (val === '') {
        // nested block opener
        if (section === 'detect') subsection = key;
      } else {
        section = null;
        subsection = null;
      }
      continue;
    }

    // nested 2-space key: value (inside detect block)
    const nested = line.match(/^\s{2}([a-z_]+):\s*(.*)$/);
    if (nested && section === 'detect') {
      const key = nested[1];
      const val = nested[2].trim();
      if (val === '') {
        subsection = key;
        result.detect[key] = {};
        currentList = null;
      } else {
        result.detect[key] = val;
      }
      continue;
    }

    // deeper nested FIRST: "    dependencies:" (4-space subkey of package_json)
    // Must be checked before listItem since both could match; pick most specific.
    const deeper = line.match(/^\s{4,}([a-z_]+):\s*$/);
    if (deeper && section === 'detect' && subsection === 'package_json') {
      currentList = deeper[1];
      result.detect.package_json = result.detect.package_json || {};
      result.detect.package_json[currentList] = [];
      continue;
    }

    // nested list item — route by current subsection + optional currentList
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && section === 'detect') {
      const val = listItem[1].trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim();
      if (subsection === 'package_json' && currentList) {
        result.detect.package_json[currentList] = result.detect.package_json[currentList] || [];
        result.detect.package_json[currentList].push(val);
      } else if (subsection === 'files') {
        result.detect.files = result.detect.files || [];
        if (Array.isArray(result.detect.files)) result.detect.files.push(val);
      } else if (subsection === 'config_files') {
        result.detect.config_files = result.detect.config_files || [];
        result.detect.config_files.push(val);
      } else if (subsection === 'negative_signals') {
        result.detect.negative_signals = result.detect.negative_signals || [];
        result.detect.negative_signals.push(val);
      }
      continue;
    }
  }

  // Flatten: tests use `package_json.dependencies` directly
  return result;
}

function loadProfiles(profilesDir) {
  const profiles = [];
  try {
    const files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.yaml'));
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(profilesDir, f), 'utf8');
        const parsed = parseProfileYaml(content);
        if (parsed.name && parsed.detect) {
          profiles.push(parsed);
        }
      } catch (_) {
        // Skip malformed profiles — fail-open principle
      }
    }
  } catch (_) {}
  return profiles;
}

function collectSignals(cwd) {
  const signals = { deps: new Set(), files: new Set(), configs: new Set() };

  // package.json dependencies
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[k] && typeof pkg[k] === 'object') {
        for (const dep of Object.keys(pkg[k])) signals.deps.add(dep);
      }
    }
  } catch (_) {}

  // Common folder probes (lightweight — single-level stat on known paths)
  const candidateFolders = [
    'src/app', 'src/app/api', 'src/app/api/chat', 'src/lib/ai', 'src/lib/ai/tools',
    'supabase/migrations', 'supabase', 'prisma',
    'src-tauri', 'desktop', 'electron',
    'public', 'pages', 'app',
    'lib/browser', 'browser',
    'tests', 'e2e',
    'evals',
    '.claude', '.claude/agents', '.claude/skills',
  ];
  for (const rel of candidateFolders) {
    try {
      if (fs.statSync(path.join(cwd, rel)).isDirectory()) signals.files.add(rel + '/');
    } catch (_) {}
  }

  // Common config files
  const candidateConfigs = [
    'next.config.ts', 'next.config.js', 'next.config.mjs',
    'astro.config.ts', 'astro.config.js', 'astro.config.mjs',
    'tauri.conf.json', 'src-tauri/tauri.conf.json',
    'vite.config.ts', 'vite.config.js',
    'svelte.config.js', 'svelte.config.ts',
    'vitest.config.ts', 'vitest.config.js',
    'playwright.config.ts', 'playwright.config.js',
    'tsconfig.json',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
    'package.json',
    'pnpm-lock.yaml', 'bun.lockb', 'yarn.lock', 'package-lock.json',
    '.mcp.json',
    'CLAUDE.md', 'AGENTS.md',
  ];
  for (const f of candidateConfigs) {
    try {
      if (fs.statSync(path.join(cwd, f)).isFile()) signals.configs.add(f);
    } catch (_) {}
  }

  return signals;
}

function detect(cwd, options) {
  const started = Date.now();
  cwd = cwd || process.cwd();
  options = options || {};

  const profilesDir = options.profilesDir || resolveProfilesDir();
  if (!profilesDir) {
    return {
      candidates: [],
      error: 'profiles-dir-not-found',
      elapsed_ms: Date.now() - started,
    };
  }

  const profiles = loadProfiles(profilesDir);
  if (profiles.length === 0) {
    return {
      candidates: [],
      error: 'no-profiles-loaded',
      elapsed_ms: Date.now() - started,
    };
  }

  const signals = collectSignals(cwd);
  const scored = profiles.map(p => {
    const s = scoreCandidate(p, signals);
    return {
      name: p.name,
      description: p.description,
      extends: p.extends,
      score: s.score,
      confidence: confidenceLevel(s.score),
      evidence: s.evidence,
      matched: s.matched,
      missed: s.missed,
    };
  });

  const ranked = rankCandidates(scored);

  return {
    candidates: ranked,
    top: ranked[0] || null,
    elapsed_ms: Date.now() - started,
    cwd,
  };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[i + 1];
      i++;
    }
  }

  const result = detect(cwd);
  if (process.env.CORTEX_DETECT_JSON === '1' || args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
    console.log(`Profile detection (${result.elapsed_ms}ms) for: ${result.cwd}`);
    console.log('');
    if (result.candidates.length === 0) {
      console.log('No candidates found. Greenfield project?');
    } else {
      const top = result.candidates.slice(0, 5);
      for (const c of top) {
        const conf = c.score.toFixed(2);
        console.log(`  ${c.score === result.top.score ? '→' : ' '} ${c.name.padEnd(20)} ${conf} [${c.confidence}]`);
        if (c.matched.length > 0) console.log(`      matched: ${c.matched.join('; ')}`);
      }
    }
  }
}

module.exports = { detect, collectSignals, resolveProfilesDir };
