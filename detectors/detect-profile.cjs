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
        // Init container by subsection shape: list-of-values (files,
        // config_files, negative_signals) → []; nested map (package_json) → {}.
        // Without this guard, list items below would .push() on {} and crash
        // (browser-agent.yaml regression caught by tests/contract/profile-yaml-schema 2026-05-07).
        if (key === 'files' || key === 'config_files' || key === 'negative_signals') {
          result.detect[key] = [];
        } else {
          result.detect[key] = {};
        }
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

// Find all workspace package.json paths for monorepos (Nx, pnpm, npm/yarn workspaces,
// Turborepo, Cargo workspaces). Returns list of absolute paths to sub-package.json files.
// Gracefully handles missing/malformed configs — fail-open per standards/auto-optimization.md.
function findWorkspacePackages(cwd) {
  const workspaces = new Set();
  let monorepoType = null;

  // 1. npm/yarn/pnpm "workspaces" in root package.json
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    let patterns = null;
    if (Array.isArray(rootPkg.workspaces)) patterns = rootPkg.workspaces;
    else if (rootPkg.workspaces && Array.isArray(rootPkg.workspaces.packages)) patterns = rootPkg.workspaces.packages;
    if (patterns) {
      monorepoType = 'workspaces';
      for (const pat of patterns) expandGlob(cwd, pat, workspaces);
    }
  } catch (_) {}

  // 2. pnpm-workspace.yaml (minimal parse — list items with glob patterns)
  try {
    const ws = fs.readFileSync(path.join(cwd, 'pnpm-workspace.yaml'), 'utf8');
    const lines = ws.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/);
      if (m) {
        monorepoType = monorepoType || 'pnpm';
        expandGlob(cwd, m[1], workspaces);
      }
    }
  } catch (_) {}

  // 3. Nx — if nx.json exists, scan common apps/, libs/, packages/ directories
  try {
    if (fs.existsSync(path.join(cwd, 'nx.json'))) {
      monorepoType = 'nx';
      for (const base of ['apps', 'libs', 'packages']) expandGlob(cwd, `${base}/*`, workspaces);
    }
  } catch (_) {}

  // 4. Turborepo — if turbo.json exists + no workspaces yet picked up, scan apps + packages
  try {
    if (fs.existsSync(path.join(cwd, 'turbo.json'))) {
      monorepoType = monorepoType || 'turbo';
      for (const base of ['apps', 'packages']) expandGlob(cwd, `${base}/*`, workspaces);
    }
  } catch (_) {}

  // 5. Lerna — lerna.json at root with packages array
  try {
    const lernaPath = path.join(cwd, 'lerna.json');
    if (fs.existsSync(lernaPath)) {
      const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf8'));
      monorepoType = monorepoType || 'lerna';
      const patterns = Array.isArray(lerna.packages) ? lerna.packages : ['packages/*'];
      for (const pat of patterns) expandGlob(cwd, pat, workspaces);
    }
  } catch (_) {}

  // 6. Rush — rush.json at root with projects[] array (explicit, not globbed)
  try {
    const rushPath = path.join(cwd, 'rush.json');
    if (fs.existsSync(rushPath)) {
      // Rush uses JSONC (JSON with comments). Strip simple // and /* */ comments.
      const raw = fs.readFileSync(rushPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const rush = JSON.parse(raw);
      monorepoType = monorepoType || 'rush';
      if (Array.isArray(rush.projects)) {
        for (const proj of rush.projects) {
          if (proj.projectFolder) {
            const p = path.join(cwd, proj.projectFolder, 'package.json');
            if (fs.existsSync(p)) workspaces.add(p);
          }
        }
      }
    }
  } catch (_) {}

  // 7. Moonrepo — .moon/workspace.yml
  try {
    if (fs.existsSync(path.join(cwd, '.moon', 'workspace.yml'))) {
      monorepoType = monorepoType || 'moon';
      // Best-effort: scan common project dirs. Full parse would require YAML lib.
      for (const base of ['apps', 'packages', 'services', 'libs']) expandGlob(cwd, `${base}/*`, workspaces);
    }
  } catch (_) {}

  return { packages: Array.from(workspaces), monorepoType };
}

// Detect non-JS language stacks. Used as a gate — if dominant language is not JS/TS,
// we skip JS profile scoring entirely and emit a lang-only result. Prevents the detector
// from hallucinating "nextjs-saas" matches on a Rust or Python project that happens to
// have a stray jest.config.js sitting around.
function detectLanguage(cwd) {
  const markers = [
    { lang: 'rust', files: ['Cargo.toml'] },
    { lang: 'go', files: ['go.mod', 'go.work'] },
    { lang: 'python', files: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'] },
    { lang: 'ruby', files: ['Gemfile', 'Rakefile'] },
    { lang: 'java-maven', files: ['pom.xml'] },
    { lang: 'java-gradle', files: ['build.gradle', 'build.gradle.kts', 'settings.gradle'] },
    { lang: 'dotnet', files: ['*.csproj', '*.fsproj', '*.sln'] },
    { lang: 'php', files: ['composer.json'] },
    { lang: 'deno', files: ['deno.json', 'deno.jsonc'] },
    { lang: 'elixir', files: ['mix.exs'] },
    { lang: 'swift', files: ['Package.swift'] },
    { lang: 'zig', files: ['build.zig'] },
  ];

  const present = [];
  for (const m of markers) {
    for (const f of m.files) {
      try {
        if (f.includes('*')) {
          // Simple glob for *.ext
          const ext = f.replace('*', '');
          const entries = fs.readdirSync(cwd);
          if (entries.some(e => e.endsWith(ext))) { present.push(m.lang); break; }
        } else if (fs.existsSync(path.join(cwd, f))) {
          present.push(m.lang); break;
        }
      } catch (_) {}
    }
  }

  const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
  return {
    non_js_languages: present,
    has_package_json: hasPackageJson,
    // JS-primary if package.json present AND no non-JS language marker
    // OR package.json present AND only Python (Next.js project with a helper script is common)
    is_js_primary: hasPackageJson && present.length === 0,
    // Mixed-stack if both package.json + non-JS markers
    is_mixed_stack: hasPackageJson && present.length > 0,
  };
}

function expandGlob(cwd, pattern, resultSet) {
  try {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const baseDir = path.join(cwd, base);
      if (!fs.statSync(baseDir).isDirectory()) return;
      for (const sub of fs.readdirSync(baseDir)) {
        const p = path.join(baseDir, sub, 'package.json');
        if (fs.existsSync(p)) resultSet.add(p);
      }
    } else {
      const p = path.join(cwd, pattern, 'package.json');
      if (fs.existsSync(p)) resultSet.add(p);
    }
  } catch (_) {}
}

function readDepsFromPackageJson(pkgPath, depsSet) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (pkg[k] && typeof pkg[k] === 'object') {
        for (const dep of Object.keys(pkg[k])) depsSet.add(dep);
      }
    }
  } catch (_) {}
}

function collectSignals(cwd) {
  const signals = { deps: new Set(), files: new Set(), configs: new Set(), monorepo: null, workspaceCount: 0, language: null };

  // Language gate — detect non-JS stacks first. If non-JS-primary, we'll return
  // an empty deps set so JS profiles don't match, and surface the detected
  // language in output for downstream consumers (Phase 0 in retrofit.md).
  const lang = detectLanguage(cwd);
  signals.language = lang;

  // Root package.json dependencies
  readDepsFromPackageJson(path.join(cwd, 'package.json'), signals.deps);

  // Workspace-aware: if monorepo, aggregate deps from all sub-packages.
  // This is the fix for the 2026-04-20 field-test bug: Nx/Turbo/pnpm monorepos keep
  // runtime deps in apps/*/package.json, not root. Without this, detect-profile
  // scored 0.00 on OrderMage and similar mature projects.
  const { packages: wsPkgs, monorepoType } = findWorkspacePackages(cwd);
  if (wsPkgs.length > 0) {
    signals.monorepo = monorepoType;
    signals.workspaceCount = wsPkgs.length;
    for (const wsPkg of wsPkgs) readDepsFromPackageJson(wsPkg, signals.deps);
  }

  // Common folder probes (lightweight — single-level stat on known paths)
  const candidateFolders = [
    'src/app', 'src/app/api', 'src/app/api/chat', 'src/lib/ai', 'src/lib/ai/tools', 'src/lib/ai/memory',
    'supabase/migrations', 'supabase', 'prisma',
    'src-tauri', 'src-tauri/src', 'desktop', 'electron',
    'public', 'pages', 'app',
    'app/api/webhook', 'lib/adapters', 'lib/ai/tools', 'lib/ai/memory',
    'src/lib/browser', 'lib/browser', 'browser', 'infra/docker/browser-runner',
    'tests', 'e2e',
    'evals',
    'themes', 'content',
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
    const evidence = [...s.evidence];
    if (signals.monorepo) {
      evidence.unshift(`monorepo:${signals.monorepo} (${signals.workspaceCount} sub-packages aggregated)`);
    }
    return {
      name: p.name,
      description: p.description,
      extends: p.extends,
      score: s.score,
      confidence: confidenceLevel(s.score),
      evidence,
      matched: s.matched,
      missed: s.missed,
    };
  });

  const ranked = rankCandidates(scored);

  return {
    candidates: ranked,
    top: ranked[0] || null,
    monorepo: signals.monorepo,
    workspaceCount: signals.workspaceCount,
    language: signals.language,
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
