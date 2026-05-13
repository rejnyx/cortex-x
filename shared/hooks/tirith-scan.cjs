#!/usr/bin/env node
// cortex-x SessionStart hook — context-file prompt-injection scanner (Tirith wrapper).
//
// Scans the project's context files (CLAUDE.md, AGENTS.md, .cursorrules, .mcp.json,
// SOUL.md) for known prompt-injection signatures BEFORE Claude Code loads them into
// the system prompt. Uses Tirith (https://tirith.sh/, MIT), a Rust binary
// published by NousResearch as part of the Hermes Agent stack.
//
// Contract:
//   stdin  — JSON with { session_id, cwd, ... }
//   stdout — JSON with { continue, hookSpecificOutput? }
//   Fail-open on any error — a security hook must never break a session.
//
// Behavior:
//   - Tirith not installed: silent pass-through, print one-time install hint
//   - Tirith installed, no findings: silent pass-through
//   - Tirith installed, findings: inject summary into SessionStart additionalContext
//     so Claude sees the threat list before first user prompt
//
// Install Tirith: see install.ps1 / install.sh — optional dependency.
// Env flags:
//   CORTEX_TIRITH_DISABLED=1  — hard opt-out (skip even if installed)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CWD = process.cwd();
const TIRITH_INSTALL_HINT_FLAG = path.join(os.homedir(), '.claude', '.tirith-hint-shown');

// Context files we scan — order matters (Claude loads them roughly in this order).
const CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  '.mcp.json',
  'SOUL.md',
  path.join('.claude', 'CLAUDE.md'),
  path.join('.claude', 'AGENTS.md'),
];

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function hasTirith() {
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['tirith'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    return r.status === 0 && r.stdout.trim().length > 0;
  } catch (_) {
    return false;
  }
}

function showInstallHintOnce() {
  try {
    if (fs.existsSync(TIRITH_INSTALL_HINT_FLAG)) return '';
    fs.mkdirSync(path.dirname(TIRITH_INSTALL_HINT_FLAG), { recursive: true });
    fs.writeFileSync(TIRITH_INSTALL_HINT_FLAG, new Date().toISOString(), { mode: 0o600 });
    return [
      '',
      '[cortex/tirith] Context-file injection scanner not installed.',
      'Install: `cargo install tirith` or download from https://tirith.sh/',
      'Once installed, `tirith-scan.cjs` hook auto-detects and scans CLAUDE.md / .mcp.json',
      'for prompt-injection signatures before they reach your session.',
      '(One-time hint. Delete `~/.claude/.tirith-hint-shown` to surface again.)',
    ].join('\n');
  } catch (_) {
    return '';
  }
}

function scanFile(filePath) {
  try {
    const r = spawnSync('tirith', ['scan', '--format', 'json', filePath], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1_000_000,
    });
    // Tirith exit codes: 0 = clean, 1 = findings, >1 = scan error.
    if (r.status === 0) return { file: filePath, status: 'clean' };
    if (r.status === 1) {
      let findings = [];
      try {
        const parsed = JSON.parse(r.stdout || '{}');
        findings = parsed.findings || parsed.matches || [];
      } catch (_) {}
      return { file: filePath, status: 'findings', findings };
    }
    return { file: filePath, status: 'error', error: (r.stderr || '').slice(0, 200) };
  } catch (err) {
    return { file: filePath, status: 'error', error: String(err && err.message).slice(0, 200) };
  }
}

function formatFindings(results) {
  const withFindings = results.filter(r => r.status === 'findings');
  if (withFindings.length === 0) return null;

  const lines = [
    '# [cortex/tirith-findings] Context-file prompt-injection signatures detected',
    '',
    'The following context file(s) matched prompt-injection signatures. Review before trusting the loaded context:',
    '',
  ];

  for (const r of withFindings) {
    lines.push(`## ${r.file}`);
    if (r.findings.length === 0) {
      lines.push('- (Tirith flagged file but provided no detailed findings)');
    } else {
      for (const f of r.findings.slice(0, 10)) {
        const sev = f.severity || f.level || 'unknown';
        const rule = f.rule || f.category || f.name || 'unknown-rule';
        const line = f.line || f.line_number || '?';
        const msg = (f.message || f.description || '').slice(0, 200);
        lines.push(`- **[${sev}] ${rule}** (line ${line}): ${msg}`);
      }
      if (r.findings.length > 10) lines.push(`- … ${r.findings.length - 10} more findings (run \`tirith scan ${r.file}\` for full report)`);
    }
    lines.push('');
  }

  lines.push('Run `tirith scan <file>` for full details. If findings are false-positives, add an allowlist comment per Tirith docs.');
  return lines.join('\n');
}

function main() {
  if (process.env.CORTEX_TIRITH_DISABLED === '1') {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  readStdinJson(); // consume but don't require; sessionstart may not pass payload

  if (!hasTirith()) {
    const hint = showInstallHintOnce();
    if (hint) {
      process.stdout.write(JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: hint,
        },
      }));
    } else {
      process.stdout.write(JSON.stringify({ continue: true }));
    }
    return;
  }

  const toScan = CONTEXT_FILES
    .map(rel => path.join(CWD, rel))
    .filter(f => {
      try { return fs.statSync(f).isFile(); } catch { return false; }
    });

  if (toScan.length === 0) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const results = toScan.map(scanFile);
  const summary = formatFindings(results);

  if (summary) {
    process.stdout.write(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: summary,
      },
    }));
  } else {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

try {
  main();
} catch (_err) {
  // Fail-open: a broken hook must never break a session.
  try { process.stdout.write(JSON.stringify({ continue: true })); } catch (_) {}
  process.exit(0);
}
