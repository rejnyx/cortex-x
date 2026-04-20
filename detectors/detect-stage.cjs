#!/usr/bin/env node
// cortex-x project-stage detector.
//
// Classifies project maturity: greenfield / prototype / mvp / growth / mature.
// Used by session-start hook + cortex-doctor to tailor suggestions to stage.
//
// Signals (deterministic, <100ms):
//   - git commit count + age
//   - presence of tests / CI / deploy config
//   - production deploy evidence (vercel.json, netlify.toml, Dockerfile)
//   - presence of institutional wisdom docs (CLAUDE.md, PROGRESS.md)
//
// Stages:
//   greenfield — no git OR ≤ 5 commits, no tests, no deploy config
//   prototype  — git present, 5-50 commits, some code, no tests/CI
//   mvp        — 50-200 commits, tests OR CI present, first deploy
//   growth     — 200-1000 commits, tests + CI + deploy + monitoring
//   mature     — 1000+ commits, full test pyramid + CI/CD + observability

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function safeExec(cmd, cwd, timeout) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: timeout || 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function has(cwd, rel) {
  try { return fs.statSync(path.join(cwd, rel)).isFile() || fs.statSync(path.join(cwd, rel)).isDirectory(); }
  catch (_) { return false; }
}

// Count subdirectories under a given parent that contain a package.json.
// Used as structural fallback when .git is absent (downloaded zip, archived project,
// freshly cloned project where user hasn't run `git init` yet).
function countPackageSubdirs(cwd, parent) {
  try {
    const base = path.join(cwd, parent);
    if (!fs.statSync(base).isDirectory()) return 0;
    return fs.readdirSync(base).filter(sub => {
      try { return fs.statSync(path.join(base, sub, 'package.json')).isFile(); }
      catch (_) { return false; }
    }).length;
  } catch (_) { return 0; }
}

function collectSignals(cwd) {
  const signals = {
    is_git: has(cwd, '.git'),
    commit_count: 0,
    first_commit_age_days: null,
    last_commit_age_days: null,
    has_tests_dir: has(cwd, 'tests') || has(cwd, 'test') || has(cwd, '__tests__'),
    has_e2e_dir: has(cwd, 'e2e') || has(cwd, 'tests/e2e') || has(cwd, 'playwright'),
    has_ci: has(cwd, '.github/workflows') || has(cwd, '.gitlab-ci.yml') || has(cwd, '.circleci'),
    has_deploy_config: (
      has(cwd, 'vercel.json') || has(cwd, 'netlify.toml') ||
      has(cwd, 'Dockerfile') || has(cwd, 'docker-compose.yml') ||
      has(cwd, 'fly.toml') || has(cwd, 'railway.toml') ||
      has(cwd, 'infra') || has(cwd, 'k8s') ||
      // Infer Docker presence from any docker-compose-*.yaml variant.
      // Wrap readdir in try/catch — root may be unreadable on some projects
      // (permissions, filesystem anomalies). Fail-open per auto-optimization contract.
      (() => {
        try { return fs.readdirSync(cwd).some(f => /^docker-compose[-.]/.test(f)); }
        catch (_) { return false; }
      })()
    ),
    has_claude_md: has(cwd, 'CLAUDE.md'),
    has_progress_md: has(cwd, 'PROGRESS.md'),
    has_memory_system: has(cwd, 'MEMORY.md') || has(cwd, '.claude/memory') || has(cwd, 'memory'),
    has_evals: has(cwd, 'evals'),
    has_monitoring: has(cwd, 'sentry.client.config.ts') || has(cwd, 'sentry.server.config.ts') || has(cwd, 'instrumentation.ts'),
    // Structural signals — used as git-absent fallback
    apps_count: countPackageSubdirs(cwd, 'apps'),
    libs_count: countPackageSubdirs(cwd, 'libs'),
    packages_count: countPackageSubdirs(cwd, 'packages'),
    has_nx: has(cwd, 'nx.json'),
    has_turbo: has(cwd, 'turbo.json'),
    has_pnpm_workspace: has(cwd, 'pnpm-workspace.yaml'),
  };
  signals.workspace_total = signals.apps_count + signals.libs_count + signals.packages_count;

  if (signals.is_git) {
    const countStr = safeExec('git rev-list --count HEAD', cwd);
    signals.commit_count = countStr ? parseInt(countStr, 10) || 0 : 0;

    const firstStr = safeExec('git log --reverse --format=%ct --max-count=1', cwd);
    if (firstStr) {
      const firstTs = parseInt(firstStr, 10);
      if (Number.isFinite(firstTs)) {
        signals.first_commit_age_days = Math.floor((Date.now() / 1000 - firstTs) / 86400);
      }
    }

    const lastStr = safeExec('git log -1 --format=%ct', cwd);
    if (lastStr) {
      const lastTs = parseInt(lastStr, 10);
      if (Number.isFinite(lastTs)) {
        signals.last_commit_age_days = Math.floor((Date.now() / 1000 - lastTs) / 86400);
      }
    }
  }

  return signals;
}

// Structural classifier — used when .git is missing OR commit_count is too low
// relative to clearly-mature structural signals (monorepo with many packages + CI + deploy).
// Prevents false "greenfield" on downloaded zips, fresh clones before git init, or
// archived/exported project copies. Fix for 2026-04-20 field-test on admin-main.
function classifyStructurally(signals) {
  const evidence = [signals.is_git ? `git:yes(low-commits:${signals.commit_count})` : 'git:absent'];

  // Monorepo with 5+ packages + CI + deploy = mature-by-structure
  if (signals.workspace_total >= 5 && signals.has_ci && signals.has_deploy_config) {
    evidence.push(`monorepo:${signals.workspace_total}-packages`);
    if (signals.has_nx) evidence.push('nx:yes');
    if (signals.has_turbo) evidence.push('turbo:yes');
    evidence.push('ci:yes', 'deploy:yes');
    return { stage: 'mature', confidence: 0.7, evidence };
  }

  // 3+ packages OR CI + deploy OR tests + deploy = growth-by-structure
  if (signals.workspace_total >= 3 || (signals.has_ci && signals.has_deploy_config)) {
    evidence.push(`workspace:${signals.workspace_total}`);
    if (signals.has_tests_dir) evidence.push('tests:yes');
    if (signals.has_ci) evidence.push('ci:yes');
    if (signals.has_deploy_config) evidence.push('deploy:yes');
    return { stage: 'growth', confidence: 0.6, evidence };
  }

  // Tests + CI OR tests + deploy = mvp-by-structure
  if ((signals.has_tests_dir && signals.has_ci) || (signals.has_tests_dir && signals.has_deploy_config)) {
    if (signals.has_tests_dir) evidence.push('tests:yes');
    if (signals.has_ci) evidence.push('ci:yes');
    if (signals.has_deploy_config) evidence.push('deploy:yes');
    return { stage: 'mvp', confidence: 0.55, evidence };
  }

  // Tests OR CI alone = prototype-by-structure
  if (signals.has_tests_dir || signals.has_ci || signals.has_deploy_config) {
    if (signals.has_tests_dir) evidence.push('tests:yes');
    if (signals.has_ci) evidence.push('ci:yes');
    if (signals.has_deploy_config) evidence.push('deploy:yes');
    return { stage: 'prototype', confidence: 0.5, evidence };
  }

  // Has scaffolding files but no infra = prototype
  if (signals.has_claude_md || signals.has_progress_md) {
    evidence.push('claude-scaffolded');
    return { stage: 'prototype', confidence: 0.4, evidence };
  }

  // Nothing — greenfield
  return { stage: 'greenfield', confidence: 0.5, evidence };
}

function classifyStage(signals) {
  const evidence = [];

  // Missing git OR very low commit count BUT strong structural signals → classify structurally
  // This handles: downloaded zips, fresh clones, exported archives, git-init-pending.
  if (!signals.is_git || signals.commit_count <= 5) {
    const hasStructuralSignals = (
      signals.workspace_total >= 3 ||
      signals.has_ci ||
      signals.has_deploy_config ||
      signals.has_tests_dir
    );
    if (hasStructuralSignals) return classifyStructurally(signals);
    evidence.push(`commits:${signals.commit_count}`);
    evidence.push(signals.is_git ? 'git:yes' : 'git:absent');
    return { stage: 'greenfield', confidence: 0.85, evidence };
  }

  // Mature: 1000+ commits with full infra
  if (signals.commit_count >= 1000) {
    evidence.push(`commits:${signals.commit_count}`);
    evidence.push(`age-days:${signals.first_commit_age_days}`);
    if (signals.has_ci && signals.has_tests_dir && signals.has_deploy_config) {
      return { stage: 'mature', confidence: 0.9, evidence };
    }
    return { stage: 'growth', confidence: 0.7, evidence };
  }

  // Growth: 200-1000 commits with tests + CI + deploy
  if (signals.commit_count >= 200) {
    evidence.push(`commits:${signals.commit_count}`);
    if (signals.has_tests_dir) evidence.push('tests:yes');
    if (signals.has_ci) evidence.push('ci:yes');
    if (signals.has_deploy_config) evidence.push('deploy:yes');
    if (signals.has_tests_dir && signals.has_ci && signals.has_deploy_config) {
      return { stage: 'growth', confidence: 0.85, evidence };
    }
    return { stage: 'mvp', confidence: 0.7, evidence };
  }

  // MVP: 50-200 commits, some infra
  if (signals.commit_count >= 50) {
    evidence.push(`commits:${signals.commit_count}`);
    if (signals.has_tests_dir || signals.has_ci || signals.has_deploy_config) {
      if (signals.has_tests_dir) evidence.push('tests:yes');
      if (signals.has_ci) evidence.push('ci:yes');
      if (signals.has_deploy_config) evidence.push('deploy:yes');
      return { stage: 'mvp', confidence: 0.8, evidence };
    }
    return { stage: 'prototype', confidence: 0.7, evidence };
  }

  // Prototype: 5-50 commits
  evidence.push(`commits:${signals.commit_count}`);
  return { stage: 'prototype', confidence: 0.75, evidence };
}

function suggestedUpgrades(signals, stage) {
  const suggestions = [];

  if (stage === 'greenfield' || stage === 'prototype') {
    if (!signals.has_claude_md) suggestions.push('create CLAUDE.md (cortex-x scaffold)');
    if (!signals.has_progress_md) suggestions.push('create PROGRESS.md (sprint tracking)');
  }

  if (stage === 'prototype' || stage === 'mvp') {
    if (!signals.has_tests_dir) suggestions.push('add test suite (testing.md → vitest + playwright)');
    if (!signals.has_ci) suggestions.push('add CI workflow (.github/workflows/ci.yml)');
  }

  if (stage === 'mvp' || stage === 'growth') {
    if (!signals.has_evals) suggestions.push('add evals/ directory (correctness.md → eval-driven dev)');
    if (!signals.has_monitoring) suggestions.push('add monitoring (observability.md → Sentry + SLOs)');
  }

  if (stage === 'growth' || stage === 'mature') {
    if (!signals.has_memory_system) suggestions.push('add three-layer memory (ai-patterns.md Pattern 2)');
  }

  return suggestions;
}

function detect(cwd, options) {
  const started = Date.now();
  cwd = cwd || process.cwd();
  options = options || {};

  try {
    const signals = collectSignals(cwd);
    const { stage, confidence, evidence } = classifyStage(signals);
    const suggestions = suggestedUpgrades(signals, stage);

    return {
      stage,
      confidence,
      evidence,
      signals,
      suggestions,
      elapsed_ms: Date.now() - started,
      cwd,
    };
  } catch (err) {
    return {
      stage: 'unknown',
      confidence: 0,
      evidence: [`error:${String(err && err.message).slice(0, 100)}`],
      signals: {},
      suggestions: [],
      error: String(err && err.message),
      elapsed_ms: Date.now() - started,
      cwd,
    };
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) { cwd = args[i + 1]; i++; }
  }

  const result = detect(cwd);
  if (process.env.CORTEX_DETECT_JSON === '1' || args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    console.log(`Stage detection (${result.elapsed_ms}ms):`);
    console.log(`  stage:      ${result.stage}`);
    console.log(`  confidence: ${(result.confidence || 0).toFixed(2)}`);
    console.log(`  evidence:   ${(result.evidence || []).join(', ')}`);
    if (result.error) console.log(`  error:      ${result.error}`);
    if (result.suggestions && result.suggestions.length > 0) {
      console.log(`\nSuggested upgrades (${result.suggestions.length}):`);
      result.suggestions.forEach(s => console.log(`  • ${s}`));
    }
  }
}

module.exports = { detect, classifyStage, collectSignals };
