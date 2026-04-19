/**
 * Redaction — Shared Secret Scrubbing Library
 *
 * Single source of truth for SECRET_PATTERNS + redact() used by
 * post-tool-use.cjs, pre-tool-use.cjs, and logErr() in both.
 *
 * Rule of Three trigger (ssot.md): extracted once a 3rd usage site appeared
 * (logErr per hook = 3rd consumer of these patterns).
 *
 * Usage:
 *   const { redact, truncate, homeStrip } = require('./_lib/redact');
 *
 * Privacy contract:
 *   - No content, no PII, no credentials may survive redact() when a
 *     known pattern matches.
 *   - Patterns ordered so scheme-prefix (Bearer/Basic) runs BEFORE
 *     generic keyword catch-all; otherwise keyword consumes scheme
 *     word and leaves the token intact.
 *   - URL-decoded once before regex pass so %3D-encoded secrets match.
 */
const os = require('os');

const SECRET_PATTERNS = [
  // HTTP auth schemes — value after the scheme is the secret
  [/\b(Bearer|Basic|Digest|Token|JWT)\s+[A-Za-z0-9._~+/=:-]{8,}/gi, '$1 <redacted>'],
  // curl -u user:pass / --user user:pass (word-boundary doesn't fire before `-`)
  [/((?:^|\s)-u\s+|(?:^|\s)--user[\s=]+)[^\s:]+:[^\s]+/g, '$1<redacted>'],
  // URLs with inline credentials (postgres/mysql/mongo/redis/http(s)).
  // Greedy `[^\s]+@` backs off to the LAST @ so passwords containing @ still get caught.
  [/(\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\/[^:\s/@]+):[^\s]+@/g, '$1:<redacted>@'],
  // URL query-string secrets
  [/([?&](?:access[_-]?token|api[_-]?token|api[_-]?key|auth[_-]?token|authorization|secret|password)=)[^&\s"']+/gi, '$1<redacted>'],
  // Known provider key shapes
  [/\bsk-(?:ant-)?[a-zA-Z0-9_-]{20,}/g, '<redacted>'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}/g, '<redacted>'],
  [/\b(AKIA|ASIA|ANPA|AIDA|AROA|AIPA|ABIA|ACCA)[0-9A-Z]{16}\b/g, '<redacted>'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '<redacted>'],
  [/\bghp_[a-zA-Z0-9]{20,}/g, '<redacted>'],
  [/\bghs_[a-zA-Z0-9]{20,}/g, '<redacted>'],
  [/\bxox[baprs]-[a-zA-Z0-9-]{10,}/g, '<redacted>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<redacted>'],
  // Generic keyword=value (after scheme patterns above, so Bearer/Basic already handled)
  // Excluded from keyword list: `pwd` (collides with shell command)
  [/\b(password|passwd|token|secret|api[-_]?key|authorization)[\s:=]+["']?([^\s"'&]+)/gi, '$1=<redacted>'],
];

function redact(str) {
  if (!str) return '';
  let out = String(str);
  try { out = decodeURIComponent(out); } catch {}
  for (const [re, repl] of SECRET_PATTERNS) {
    out = out.replace(re, repl);
  }
  return out;
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function homeStrip(p) {
  if (!p) return p;
  const home = os.homedir();
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

/**
 * Collapse whitespace and strip newlines so log entries stay single-line.
 * Use on error messages before writing to .hook-errors.log.
 */
function singleLine(s) {
  if (!s) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Validate CORTEX_HOME env var as a trustworthy cortex-x source directory.
 * Returns canonical path if valid, null otherwise. Defenses:
 * - Must be an absolute path that exists and is a directory (not a file/symlink-to-file).
 * - Must contain framework signature file (standards/ship-ready.md) to prevent
 *   pointing the hook at an attacker-controlled scratch dir.
 * - Must be inside the current user's $HOME unless CORTEX_HOME_ALLOW_EXTERNAL=1
 *   is also set (explicit opt-in for unusual layouts).
 */
function validateCortexHome(envHome) {
  if (!envHome) return null;
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  try {
    const resolved = path.resolve(envHome);
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return null;
    // Signature file check — rejects attacker-controlled arbitrary dir
    if (!fs.existsSync(path.join(resolved, 'standards', 'ship-ready.md'))) return null;
    // $HOME containment unless explicit opt-out
    const home = os.homedir();
    if (home && process.env.CORTEX_HOME_ALLOW_EXTERNAL !== '1') {
      const homeRes = path.resolve(home);
      if (!resolved.startsWith(homeRes + path.sep) && resolved !== homeRes) return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

module.exports = { SECRET_PATTERNS, redact, truncate, homeStrip, singleLine, validateCortexHome };
