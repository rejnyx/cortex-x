#!/usr/bin/env node
// cortex-x user-identity detector.
//
// Auto-detects user identity from deterministic system signals to pre-fill
// the install wizard ("ask only what you can't infer" pattern from gh CLI,
// Bun, Rustup, etc.). Used by install.{sh,ps1} after the language prompt.
//
// Signals (deterministic, <300ms total — git config has stdout I/O):
//   - git config user.name / user.email      (universal, high reliability)
//   - process.env USERNAME / USER             (OS username)
//   - process.platform                        ('win32' | 'darwin' | 'linux')
//   - Intl.DateTimeFormat().resolvedOptions().locale  (Node ≥13 full-ICU)
//   - env LC_ALL / LC_MESSAGES / LANG / LANGUAGE      (Unix fallback chain)
//   - gh api user --jq .login                 (if gh CLI authed; optional)
//   - existing ~/.claude/cortex/user.yaml     (already-confirmed identity)
//
// Returns JSON:
//   {
//     "name": "David Rajnoha",
//     "email": "REDACTED@redacted.invalid",
//     "username": "david",
//     "platform": "win32",
//     "locale": "cs-CZ",
//     "gh_login": "rejnyx" | null,
//     "confirmed": false,
//     "source_signals": {...}            // per-field provenance, for debug
//   }
//
// Fail-open contract: every signal is optional. Missing signals → null.
// The wizard treats null fields as "ask the user" or "use safe default".
//
// CLI:
//   node detectors/detect-user-identity.cjs            # human format
//   node detectors/detect-user-identity.cjs --json     # machine-readable
//   node detectors/detect-user-identity.cjs --shell    # bash eval-friendly

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function safeExec(cmd, timeout) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: timeout || 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function readGitConfig(key) {
  const v = safeExec(`git config --global --get ${key}`);
  return v || null;
}

function readGhLogin() {
  if (!safeExec('gh --version', 1000)) return null;
  // gh api user prints JSON; --jq extracts .login. If not authed, gh exits non-zero.
  const v = safeExec('gh api user --jq .login', 3000);
  return v || null;
}

function readLocale() {
  // Strategy 1: Intl (Node ≥13 full-ICU, reliable on macOS / Linux,
  // unreliable on Windows minimal-ICU where it returns en-US always).
  let intl = null;
  try {
    intl = new Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch (_) {
    intl = null;
  }

  // Strategy 2: env chain (os-locale order). Unix-reliable, mostly empty on Windows.
  // POSIX/C are placeholder values meaning "no real locale" — treat as null
  // (GitHub Actions Linux runners default to LANG=C which would otherwise leak).
  const envChain = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    process.env.LANGUAGE && process.env.LANGUAGE.split(':')[0],
  ].filter(Boolean)
    .map((v) => v.split('.')[0].replace('_', '-'))
    .filter((v) => v !== 'C' && v !== 'POSIX' && v !== 'c');
  const envLocale = envChain[0] || null;

  // Strategy 3: Windows registry (PowerShell Get-Culture) — only on win32 if Intl flopped to en-US.
  let winLocale = null;
  if (process.platform === 'win32' && (intl === 'en-US' || !intl) && !envLocale) {
    winLocale = safeExec('powershell -NoProfile -Command "(Get-Culture).Name"', 2000);
  }

  // Prefer envLocale > winLocale > intl. envLocale is most explicit (user-set);
  // winLocale is OS-truth on Windows; intl is the last-resort default.
  return envLocale || winLocale || intl || null;
}

function readExistingUserYaml() {
  const userYaml = path.join(os.homedir(), '.claude', 'cortex', 'user.yaml');
  if (!fs.existsSync(userYaml)) return null;
  try {
    const txt = fs.readFileSync(userYaml, 'utf8');
    const out = {};
    // Flat-yaml parse — same pattern as cortex-source.yaml. Top-level scalars only.
    txt.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) return;
      const k = m[1];
      const v = m[2].trim().replace(/^"|"$/g, '');
      out[k] = v === '' ? null : v;
    });
    return out;
  } catch (_) {
    return null;
  }
}

function detect() {
  const existing = readExistingUserYaml();

  const signals = {
    git_name:    readGitConfig('user.name'),
    git_email:   readGitConfig('user.email'),
    username:    process.env.USERNAME || process.env.USER || os.userInfo().username || null,
    platform:    process.platform,
    locale:      readLocale(),
    gh_login:    readGhLogin(),
    user_yaml:   existing ? path.join(os.homedir(), '.claude', 'cortex', 'user.yaml') : null,
  };

  // Compose final values — confirmed user.yaml wins over fresh detection.
  const result = {
    name:      (existing && existing.name)     || signals.git_name     || null,
    email:     (existing && existing.email)    || signals.git_email    || null,
    username:  (existing && existing.username) || signals.username     || null,
    platform:  signals.platform,
    locale:    (existing && existing.locale)   || signals.locale       || null,
    gh_login:  (existing && existing.gh_login) || signals.gh_login     || null,
    confirmed: !!(existing && existing.confirmed === 'true'),
    source_signals: signals,
  };

  return result;
}

function formatHuman(r) {
  const lines = [];
  lines.push('Detected user identity:');
  lines.push(`  name      ${r.name || '(none — git config user.name unset)'}`);
  lines.push(`  email     ${r.email || '(none — git config user.email unset)'}`);
  lines.push(`  username  ${r.username || '(none)'}`);
  lines.push(`  platform  ${r.platform}`);
  lines.push(`  locale    ${r.locale || '(none — defaults to en)'}`);
  lines.push(`  gh login  ${r.gh_login || '(none — gh CLI not authed)'}`);
  lines.push(`  status    ${r.confirmed ? 'confirmed (from ~/.claude/cortex/user.yaml)' : 'fresh detection'}`);
  return lines.join('\n');
}

// Single-quote a value safely for bash eval — wraps in '...' and escapes
// any embedded single quotes via the standard '\'' technique. Never trust
// detector outputs unescaped; git config can technically contain anything.
function shellQuote(s) {
  if (s == null) return "''";
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function formatShell(r) {
  return [
    `CORTEX_USER_NAME=${shellQuote(r.name)}`,
    `CORTEX_USER_EMAIL=${shellQuote(r.email)}`,
    `CORTEX_USER_USERNAME=${shellQuote(r.username)}`,
    `CORTEX_USER_PLATFORM=${shellQuote(r.platform)}`,
    `CORTEX_USER_LOCALE=${shellQuote(r.locale)}`,
    `CORTEX_USER_GH_LOGIN=${shellQuote(r.gh_login)}`,
    `CORTEX_USER_CONFIRMED=${shellQuote(r.confirmed ? 'true' : 'false')}`,
  ].join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson  = args.some((a) => a === '--json'  || a === '-j');
  const wantShell = args.some((a) => a === '--shell' || a === '-s');
  const r = detect();
  if (wantJson) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else if (wantShell) {
    process.stdout.write(formatShell(r) + '\n');
  } else {
    process.stdout.write(formatHuman(r) + '\n');
  }
}

module.exports = { detect, formatShell, shellQuote, readGitConfig, readGhLogin, readLocale, readExistingUserYaml };
