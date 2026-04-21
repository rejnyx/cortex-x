#!/usr/bin/env node
// cortex-x sister-project env scanner.
//
// Scans sibling projects (same parent dir) for `.claude/settings.json` `env`
// blocks. Surfaces flags present in ≥2 siblings but missing from target —
// these are candidates for retrofit to add. Prevents the failure mode found
// on portfolio retrofit (2026-04-21): CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
// was set in 3 of Dave's projects, missed on retrofit because detector only
// looked at target project.
//
// Contract (per standards/auto-optimization.md):
//   - <100ms typical, deterministic
//   - Read-only, no LLM, no network, no mutation
//   - Fail-open: any error → empty suggestions, never crash session
//
// Usage:
//   node detectors/detect-sister-env.cjs
//   node detectors/detect-sister-env.cjs --cwd /path/to/project --json
//
// Integration:
//   - retrofit.md Phase 0 (alongside detect-profile + detect-stage)
//   - session-start hook could surface top suggestion if confidence high
//   - cortex-doctor drift flow

'use strict';

const fs = require('fs');
const path = require('path');

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return null; }
}

function findSiblingSettings(cwd) {
  const parent = path.dirname(cwd);
  const out = [];
  try {
    const entries = fs.readdirSync(parent);
    for (const entry of entries) {
      const siblingPath = path.join(parent, entry);
      if (siblingPath === cwd) continue;
      try {
        if (!fs.statSync(siblingPath).isDirectory()) continue;
      } catch (_) { continue; }
      const settingsPath = path.join(siblingPath, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        out.push({ project: entry, path: settingsPath });
      }
    }
  } catch (_) {}
  return out;
}

function collectSharedEnv(siblings) {
  const envCounts = {};
  for (const s of siblings) {
    const content = safeReadJson(s.path);
    const env = (content && content.env) || {};
    for (const [k, v] of Object.entries(env)) {
      if (!envCounts[k]) {
        envCounts[k] = { count: 0, values: new Set(), present_in: [] };
      }
      envCounts[k].count++;
      envCounts[k].values.add(String(v));
      envCounts[k].present_in.push(s.project);
    }
  }
  return envCounts;
}

function detect(cwd, options) {
  const started = Date.now();
  cwd = cwd || process.cwd();
  options = options || {};
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 2;

  try {
    const targetSettingsPath = path.join(cwd, '.claude', 'settings.json');
    const targetSettings = safeReadJson(targetSettingsPath);
    const targetEnv = (targetSettings && targetSettings.env) || {};

    const siblings = findSiblingSettings(cwd);
    const envCounts = collectSharedEnv(siblings);

    const suggested = [];
    for (const [flag, info] of Object.entries(envCounts)) {
      if (info.count >= threshold && !(flag in targetEnv)) {
        const values = Array.from(info.values);
        suggested.push({
          flag,
          count: info.count,
          present_in: info.present_in,
          suggested_value: values[0],
          value_consistent: values.length === 1,
          alternatives: values.length > 1 ? values : undefined,
        });
      }
    }

    // Sort by: count desc, then flag name asc (stable deterministic order)
    suggested.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.flag.localeCompare(b.flag);
    });

    return {
      target: { cwd, env_flags: Object.keys(targetEnv), has_settings: !!targetSettings },
      siblings_scanned: siblings.length,
      sibling_projects: siblings.map(s => s.project),
      shared_env: Object.fromEntries(
        Object.entries(envCounts).map(([k, v]) => [
          k,
          { count: v.count, present_in: v.present_in, values: Array.from(v.values) },
        ])
      ),
      suggested_additions: suggested,
      threshold,
      elapsed_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      target: { cwd, env_flags: [], has_settings: false },
      siblings_scanned: 0,
      sibling_projects: [],
      shared_env: {},
      suggested_additions: [],
      error: String(err && err.message).slice(0, 200),
      elapsed_ms: Date.now() - started,
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
    return;
  }

  console.log(`Sister-env scan (${result.elapsed_ms}ms)`);
  console.log(`  target: ${result.target.cwd}`);
  console.log(`  target env flags: ${result.target.env_flags.join(', ') || '(none)'}`);
  console.log(`  siblings scanned: ${result.siblings_scanned}`);
  if (result.error) console.log(`  error: ${result.error}`);

  if (result.suggested_additions.length > 0) {
    console.log(`\nSuggested additions (${result.threshold}+ siblings have, target doesn't):`);
    for (const s of result.suggested_additions) {
      const note = s.value_consistent ? '' : ' [values differ — review]';
      console.log(`  ${s.flag}="${s.suggested_value}" — ${s.count} siblings (${s.present_in.join(', ')})${note}`);
    }
  } else {
    console.log('\n✓ No shared env flags missing from target.');
  }
}

module.exports = { detect, findSiblingSettings, collectSharedEnv };
