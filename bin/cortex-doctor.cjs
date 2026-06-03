#!/usr/bin/env node
// cortex-doctor — health check + drift detection for a cortex-x install.
//
// Inspects:
//   1. ~/.claude/shared/cortex-source.yaml exists + paths resolve
//   2. Source clone present at cortex_source path + has .git
//   3. $CORTEX_DATA_HOME exists + has expected subdirs
//   4. Skills installed in ~/.claude/skills/<name>/SKILL.md
//   5. Agents installed in ~/.claude/agents/*.md
//   6. Hooks registered in ~/.claude/settings.json (cortex-hooks-register --status)
//   7. CLAUDE.md discipline block present (cortex-claude-md-augment --status)
//   8. Node version ≥ 22 LTS
//   9. Stable git remote on source clone (origin reachable, branch present)
//
// Output: structured report with severity (ok / info / warn / error) per check.
// --json for machine-readable. --fix-suggestions prints the exact command
// the operator should run for each non-ok finding.
//
// Flags:
//   --json         machine-readable
//   --fix-suggestions   include suggested commands per check
//   --help / -h
//
// Exit codes:
//   0   all critical checks pass (warnings allowed)
//   1   at least one error-severity finding
//   2   internal bug

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const HOME = os.homedir();
const CLAUDE_HOME = path.join(HOME, '.claude');
const SHARED = path.join(CLAUDE_HOME, 'shared');
const SETTINGS_PATH = path.join(CLAUDE_HOME, 'settings.json');
const CLAUDE_MD_PATH = path.join(CLAUDE_HOME, 'CLAUDE.md');
const SOURCE_YAML = path.join(SHARED, 'cortex-source.yaml');

// Sprint 2.28.2 R2 hardening (ssot-enforcer #1): single timeout const applied
// to every health-check execFileSync call. Previously 2.28.1 applied 5000ms
// only to the permissions-register call; the same rationale (hung child blocks
// doctor forever) holds for hooks-register + claude-md-augment + git remote.
const HEALTH_CHECK_TIMEOUT_MS = 5000;

// SSOT for skill discovery audit. Keep aligned with install.{sh,ps1}'s
// per-profile skill-promotion loop: `audit, designer, start, cortex-doctor,
// cortex-goal, cortex-update, cortex-uninstall` for all profiles + `test-audit`
// for the qa-tester profile.
// Sprint 2.21.2 R2 hardening (SSOT-enforcer finding #3): cortex-doctor was
// installed unconditionally but missing from this list, causing the doctor
// to not self-verify; test-audit was here but only installed on qa-tester,
// causing spurious "info: not installed" on dev/ai-engineer/minimal profiles.
// Sprint 2.24 added cortex-goal (plan-first wrapper for native /goal).
// v0.3.0 close-chapter added cortex-update + cortex-uninstall (slash wrappers
// around existing CLIs — restore /-discoverability symmetry).
const REQUIRED_SKILLS = ['cortex-init', 'cortex-help'];
const RECOMMENDED_SKILLS = ['audit', 'designer', 'start', 'cortex-doctor', 'cortex-goal', 'cortex-update', 'cortex-uninstall'];
// Profile-specific (not always installed; doctor reports as info when absent).
const PROFILE_SKILLS = ['test-audit'];

function parseArgs(argv) {
  const args = { json: false, fix: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--fix-suggestions') args.fix = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`cortex-doctor: unknown flag '${a}'. Use --help for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log('cortex-doctor — health check + drift detection for cortex-x install');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-doctor                     run all checks, print human-readable report');
  console.log('  cortex-doctor --json              machine-readable findings');
  console.log('  cortex-doctor --fix-suggestions   include suggested fix command per finding');
  console.log('');
  console.log('Severity: ok | info | warn | error');
  console.log('Exit: 0 if no errors, 1 if any error, 2 on internal bug.');
}

function readYamlBomSafe(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function resolveSourceFromYaml() {
  if (!fs.existsSync(SOURCE_YAML)) return null;
  try {
    const m = readYamlBomSafe(SOURCE_YAML).match(/^cortex_source:\s*(.+)$/m);
    if (m) return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
  } catch { /* fall through */ }
  return null;
}

function resolveDataHomeFromYaml() {
  if (process.env.CORTEX_DATA_HOME) return path.normalize(process.env.CORTEX_DATA_HOME);
  if (!fs.existsSync(SOURCE_YAML)) return path.join(HOME, '.cortex');
  try {
    const m = readYamlBomSafe(SOURCE_YAML).match(/^cortex_data_home:\s*(.+)$/m);
    if (m) return path.normalize(m[1].trim().replace(/^["']|["']$/g, ''));
  } catch { /* fall through */ }
  return path.join(HOME, '.cortex');
}

function check(id, severity, message, fix) {
  return { id, severity, message, fix: fix || null };
}

function runChecks() {
  const findings = [];

  // 1. Node version.
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isFinite(nodeMajor) && nodeMajor >= 22) {
    findings.push(check('node_version', 'ok', `Node ${process.versions.node} (>= 22)`));
  } else {
    findings.push(check('node_version', 'error', `Node ${process.versions.node} is too old (need >= 22 LTS)`,
      'Upgrade Node via nvm/fnm/volta or system package manager, then re-run install.sh'));
  }

  // 2. cortex-source.yaml.
  if (!fs.existsSync(SOURCE_YAML)) {
    findings.push(check('source_yaml', 'error', `${SOURCE_YAML} not found — install incomplete`,
      'Re-run install.sh / install.ps1 from your cortex-x clone'));
    return findings; // bail early: nothing else can be resolved.
  }
  findings.push(check('source_yaml', 'ok', `${SOURCE_YAML} present`));

  // 3. cortex_source path resolution + git check.
  const sourceDir = resolveSourceFromYaml();
  if (!sourceDir) {
    findings.push(check('source_path', 'error', 'cortex_source missing from cortex-source.yaml',
      'Re-run install.sh / install.ps1 (writes a fresh yaml)'));
  } else if (!fs.existsSync(sourceDir)) {
    findings.push(check('source_path', 'error', `cortex_source ${sourceDir} does not exist`,
      `Re-clone cortex-x to ${sourceDir} or re-run install.sh with CORTEX_HOME set`));
  } else if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    findings.push(check('source_path', 'warn', `${sourceDir} is not a git repo — updates via cortex-update will fail`,
      `Clone fresh: git clone https://github.com/Rejnyx/cortex-x ${sourceDir}`));
  } else {
    findings.push(check('source_path', 'ok', `source clone at ${sourceDir} (git repo)`));
  }

  // 4. data home.
  const dataHome = resolveDataHomeFromYaml();
  if (!fs.existsSync(dataHome)) {
    findings.push(check('data_home', 'warn', `${dataHome} does not exist — research/journal/insights have nowhere to go`,
      'mkdir -p ' + dataHome + '/{research,projects,insights,journal,evals}'));
  } else {
    const expected = ['research', 'projects', 'insights', 'journal', 'evals'];
    const missing = expected.filter((d) => !fs.existsSync(path.join(dataHome, d)));
    if (missing.length > 0) {
      findings.push(check('data_home', 'warn', `${dataHome} missing subdirs: ${missing.join(', ')}`,
        `mkdir -p ${dataHome}/{${missing.join(',')}}`));
    } else {
      findings.push(check('data_home', 'ok', `${dataHome} (all subdirs present)`));
    }
  }

  // 5. shared dir.
  if (!fs.existsSync(SHARED)) {
    findings.push(check('shared_dir', 'error', `${SHARED} missing — install never completed`,
      'Re-run install.sh / install.ps1'));
  } else {
    const expectedShared = ['hooks', 'skills', 'agents', 'standards', 'prompts'];
    const missingShared = expectedShared.filter((d) => !fs.existsSync(path.join(SHARED, d)));
    if (missingShared.length > 0) {
      findings.push(check('shared_dir', 'warn', `${SHARED} missing subdirs: ${missingShared.join(', ')}`,
        'Re-run install.sh / install.ps1'));
    } else {
      findings.push(check('shared_dir', 'ok', `${SHARED} (all subdirs present)`));
    }
  }

  // 6. user-discoverable skills.
  const skillsDir = path.join(CLAUDE_HOME, 'skills');
  const missingRequired = REQUIRED_SKILLS.filter(
    (s) => !fs.existsSync(path.join(skillsDir, s, 'SKILL.md'))
  );
  if (missingRequired.length > 0) {
    findings.push(check('required_skills', 'error', `missing required skills in ${skillsDir}: ${missingRequired.join(', ')}`,
      'Re-run install.sh / install.ps1'));
  } else {
    findings.push(check('required_skills', 'ok', `required skills present: ${REQUIRED_SKILLS.join(', ')}`));
  }

  const missingRecommended = RECOMMENDED_SKILLS.filter(
    (s) => !fs.existsSync(path.join(skillsDir, s, 'SKILL.md'))
  );
  if (missingRecommended.length > 0) {
    findings.push(check('recommended_skills', 'info', `recommended skills not installed: ${missingRecommended.join(', ')}`,
      'Re-run install.sh / install.ps1 (installs all skills by default)'));
  } else {
    findings.push(check('recommended_skills', 'ok', `all recommended skills present`));
  }

  // 7. agents.
  const agentsDir = path.join(CLAUDE_HOME, 'agents');
  if (!fs.existsSync(agentsDir)) {
    findings.push(check('agents', 'warn', `${agentsDir} not present — Claude Code can't discover review pipeline`,
      'Re-run install.sh / install.ps1'));
  } else {
    const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    if (agentFiles.length < 5) {
      findings.push(check('agents', 'warn', `${agentsDir} has only ${agentFiles.length} agent(s) — expected ≥ 5 (review pipeline)`,
        'Re-run install.sh / install.ps1'));
    } else {
      findings.push(check('agents', 'ok', `${agentFiles.length} agents installed in ${agentsDir}`));
    }
  }

  // 8. hook registration.
  const hooksRegisterScript = sourceDir ? path.join(sourceDir, 'bin', 'cortex-hooks-register.cjs') : null;
  if (hooksRegisterScript && fs.existsSync(hooksRegisterScript)) {
    try {
      const out = execFileSync(process.execPath, [hooksRegisterScript, '--status', '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      const report = JSON.parse(out);
      if (report.cortex_entries_total === 0) {
        findings.push(check('hooks_registered', 'warn',
          'Cortex hooks not registered — block-destructive + SessionStart + auto-orchestrate inactive',
          'cortex-hooks-register'));
      } else {
        findings.push(check('hooks_registered', 'ok',
          `${report.cortex_entries_total} cortex hook entry(s) in ${SETTINGS_PATH}`));
      }
    } catch (err) {
      findings.push(check('hooks_registered', 'warn',
        `could not check hook registration (${err.message || 'unknown'})`,
        'cortex-hooks-register --status'));
    }
  } else {
    findings.push(check('hooks_registered', 'info', 'cortex-hooks-register script not found — skipping check'));
  }

  // 9. Permissions safety-floor (Sprint 2.28).
  // Sprint 2.28.1 R2 hardening (blind-hunter MED #3): execFileSync timeout
  // — without it, a hung child blocks the doctor forever. 5s is generous
  // for a settings.json read; real failures surface immediately.
  const permsScript = sourceDir ? path.join(sourceDir, 'bin', 'cortex-permissions-register.cjs') : null;
  if (permsScript && fs.existsSync(permsScript)) {
    try {
      const out = execFileSync(process.execPath, [permsScript, '--status', '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      const report = JSON.parse(out);
      if (report.cortex_entries_total === 0) {
        findings.push(check('permissions_registered', 'info',
          'Cortex safety-floor permissions not registered — relying on Claude Code defaults',
          'cortex-permissions-register'));
      } else {
        findings.push(check('permissions_registered', 'ok',
          `${report.cortex_entries_total} cortex permission entry(s) in ${SETTINGS_PATH} (deny ${report.per_kind.deny}, allow ${report.per_kind.allow})`));
        // Sprint 2.28.1 R2 hardening (acceptance-auditor gap): detect
        // user-added catch-all `Bash(*)` in allow which negates the
        // deny floor's effective coverage (precedence still holds at
        // runtime, but the allow widens the attack surface).
        if (report.user_catch_all_in_allow) {
          findings.push(check('permissions_allow_catch_all', 'warn',
            'User catch-all `Bash(*)` present in permissions.allow — narrows effective safety floor',
            'Remove Bash(*) from ~/.claude/settings.json permissions.allow if not intentional'));
        }
      }
    } catch (err) {
      findings.push(check('permissions_registered', 'info',
        `could not check permissions registration (${err.message || 'unknown'})`,
        'cortex-permissions-register --status'));
    }
  } else {
    findings.push(check('permissions_registered', 'info', 'cortex-permissions-register script not found — skipping check'));
  }

  // 11. CLAUDE.md discipline block.
  const augmentScript = sourceDir ? path.join(sourceDir, 'bin', 'cortex-claude-md-augment.cjs') : null;
  if (augmentScript && fs.existsSync(augmentScript)) {
    try {
      const out = execFileSync(process.execPath, [augmentScript, '--status', '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: HEALTH_CHECK_TIMEOUT_MS,
      });
      const report = JSON.parse(out);
      if (!report.cortex_block_present) {
        findings.push(check('claude_md_block', 'info',
          'Cortex discipline block not in ~/.claude/CLAUDE.md — ad-hoc work missing R1/R2/parallel defaults',
          'cortex-claude-md-augment'));
      } else if (report.stale) {
        findings.push(check('claude_md_block', 'warn',
          `Cortex block is v${report.cortex_block_version} (current is v${report.cortex_block_current_version}) — stale`,
          'cortex-claude-md-augment --apply  (upgrades in place)'));
      } else if (report.duplicate_blocks > 0) {
        findings.push(check('claude_md_block', 'warn',
          `Cortex block appears ${report.duplicate_blocks} times — duplicates present`,
          'cortex-claude-md-augment --apply  (deduplicates)'));
      } else {
        findings.push(check('claude_md_block', 'ok',
          `discipline block v${report.cortex_block_version} present in ${CLAUDE_MD_PATH}`));
      }
    } catch (err) {
      findings.push(check('claude_md_block', 'info',
        `could not check CLAUDE.md augment status (${err.message || 'unknown'})`));
    }
  } else {
    findings.push(check('claude_md_block', 'info', 'cortex-claude-md-augment script not found — skipping check'));
  }

  // 12. Sprint 2.29 — MCP recommendations (info-severity, opt-out via
  // CORTEX_SUGGEST_MCP=0). MCP config lives at ~/.claude.json (a single file
  // at $HOME, NOT ~/.claude/mcp.json — corrected per R1 memo
  // sprint-2.29-mcp-recommendations-2026-05-14.md citation [^c6]).
  // We read the manifest, parse `mcpServers` object, and just COUNT present
  // entries vs what cortex-init Step 5 may have suggested. No write actions,
  // no auto-install — cortex never auto-modifies user globals.
  if (process.env.CORTEX_SUGGEST_MCP !== '0') {
    const claudeManifestPath = path.join(os.homedir(), '.claude.json');
    if (fs.existsSync(claudeManifestPath)) {
      try {
        const raw = fs.readFileSync(claudeManifestPath, 'utf8');
        const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
        const mcps = parsed && typeof parsed === 'object' && parsed.mcpServers
          && typeof parsed.mcpServers === 'object' ? Object.keys(parsed.mcpServers) : [];
        if (mcps.length > 0) {
          findings.push(check('mcp_servers', 'info',
            `${mcps.length} MCP server(s) registered: ${mcps.slice(0, 6).join(', ')}${mcps.length > 6 ? ' …' : ''}`));
        } else {
          findings.push(check('mcp_servers', 'info',
            'no MCP servers registered (profile may recommend Context7, Supabase, Playwright)',
            'claude mcp list (current state) — run cortex-init Step 5 to see profile recommendations'));
        }
      } catch {
        findings.push(check('mcp_servers', 'info',
          `could not parse ${claudeManifestPath} — skipping MCP check`));
      }
    } else {
      findings.push(check('mcp_servers', 'info',
        'no ~/.claude.json present — MCP servers not configured (optional)'));
    }
  }

  // 14. Sprint 2.46.2 — doc-currency lint (read-only, fail-OPEN).
  // Surfaces hand-prose drift (numeric mismatches vs. cortex-auto-state blocks,
  // expired frontmatter beyond grace) as info-severity. cortex-doctor NEVER
  // invokes --apply or --fix — strictly read-only health probe. If the linter
  // is missing, hangs, or crashes, we report info (unknown) rather than warn
  // so a broken lint tool doesn't poison a doctor run. Opt-out via
  // CORTEX_DOC_LINT_DISABLED=1 (mirrors the env kill-switch in the tool itself).
  if (process.env.CORTEX_DOC_LINT_DISABLED !== '1') {
    // Sprint 2.46.2 R2 fix HIGH (6 reviewers, 99 confidence): the binary
    // ships at bin/cortex-doc-currency.cjs (install.sh / install.ps1 / tests
    // / standards all agree). The original tools/ path probe was dead on
    // arrival on every healthy install.
    const docLintScript = sourceDir ? path.join(sourceDir, 'bin', 'cortex-doc-currency.cjs') : null;
    if (docLintScript && fs.existsSync(docLintScript)) {
      try {
        // Reference instant: prefer caller env, else fall back to a fixed
        // ISO timestamp from process start so the tool's determinism gate
        // (which exits 2 without --now or CORTEX_LINT_NOW) is satisfied.
        // doctor itself is the human-triggered top-of-stack invocation so
        // sampling wall-clock here is acceptable.
        const lintEnv = Object.assign({}, process.env);
        if (!lintEnv.CORTEX_LINT_NOW) {
          lintEnv.CORTEX_LINT_NOW = new Date().toISOString();
        }
        // Sprint 2.46.2 R2 fix HIGH: CLI requires explicit file arguments
        // (exit 2 on empty file list). Lint the curated default set —
        // atlas, capability-tree, operator-recap, plus standards/*.md.
        const defaultTargets = [];
        const cortexDir = path.join(sourceDir, 'cortex');
        if (fs.existsSync(cortexDir)) {
          for (const name of fs.readdirSync(cortexDir)) {
            if (/^(atlas-|capability-tree-|operator-recap-).*\.md$/.test(name)) {
              defaultTargets.push(path.join(cortexDir, name));
            }
          }
        }
        const standardsDir = path.join(sourceDir, 'standards');
        if (fs.existsSync(standardsDir)) {
          for (const name of fs.readdirSync(standardsDir)) {
            if (/\.md$/.test(name)) defaultTargets.push(path.join(standardsDir, name));
          }
        }
        // Sprint 2.46.2 R2 fix HIGH: CLI accepts --json (NOT --format json).
        const out = execFileSync(process.execPath, [docLintScript, '--json', ...defaultTargets], {
          cwd: sourceDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          env: lintEnv,
        });
        const report = JSON.parse(out);
        const summary = report && report.summary ? report.summary : null;
        if (!summary) {
          findings.push(check('doc_currency', 'info',
            'cortex-doc-currency returned no summary — skipping'));
        } else {
          // Sprint 2.46.2 R2 fix HIGH: CLI emits { files, high, medium }
          // (NOT violations / warnings / claims). Align reader to shipped shape.
          const high = summary.high || 0;
          const medium = summary.medium || 0;
          const files = summary.files || 0;
          if (high === 0 && medium === 0) {
            findings.push(check('doc_currency', 'ok',
              `doc-currency clean: 0 findings across ${files} file(s)`));
          } else if (high === 0) {
            findings.push(check('doc_currency', 'info',
              `doc-currency: ${medium} medium finding(s) across ${files} file(s)`,
              'node bin/cortex-doc-currency.cjs --check  (review findings)'));
          } else {
            findings.push(check('doc_currency', 'info',
              `doc-currency: ${high} high + ${medium} medium finding(s) across ${files} file(s)`,
              'node bin/cortex-doc-currency.cjs --check  (review findings)'));
          }
        }
      } catch (err) {
        findings.push(check('doc_currency', 'info',
          `could not run doc-currency lint (${err.message || 'unknown'}) — status unknown`));
      }
    } else {
      findings.push(check('doc_currency', 'info',
        'cortex-doc-currency.cjs not found in source clone — skipping doc-currency lint'));
    }
  }

  // 15. git remote reachability (optional, only if source clone is git).
  if (sourceDir && fs.existsSync(path.join(sourceDir, '.git'))) {
    try {
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: sourceDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: HEALTH_CHECK_TIMEOUT_MS,
      }).trim();
      findings.push(check('git_remote', 'ok', `origin: ${remote}`));
    } catch {
      findings.push(check('git_remote', 'warn', 'source clone has no origin remote — cortex-update will fail',
        'cd ' + sourceDir + ' && git remote add origin https://github.com/Rejnyx/cortex-x.git'));
    }
  }

  return findings;
}

function severityColor(sev) {
  // Not actually colored — keep output ASCII for cross-platform clarity.
  return sev.toUpperCase().padEnd(5);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  const findings = runChecks();
  const counts = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const exitCode = counts.error > 0 ? 1 : 0;

  if (args.json) {
    console.log(JSON.stringify({
      ok: exitCode === 0,
      counts, findings,
      cortex_data_home: resolveDataHomeFromYaml(),
      cortex_source: resolveSourceFromYaml(),
    }, null, 2));
    return exitCode;
  }

  console.log('cortex-doctor — health check');
  console.log('');
  for (const f of findings) {
    console.log(`  [${severityColor(f.severity)}] ${f.id}: ${f.message}`);
    if (args.fix && f.fix) {
      console.log(`              → ${f.fix}`);
    }
  }
  console.log('');
  const tally = Object.entries(counts).filter(([, n]) => n > 0).map(([sev, n]) => `${n} ${sev}`).join(' · ');
  console.log(`  Summary: ${tally}`);
  if (exitCode === 1) {
    console.log('  → run with --fix-suggestions for the exact commands to fix each error.');
  }
  return exitCode;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('cortex-doctor: internal error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

module.exports = { runChecks, parseArgs, REQUIRED_SKILLS, RECOMMENDED_SKILLS, PROFILE_SKILLS };
