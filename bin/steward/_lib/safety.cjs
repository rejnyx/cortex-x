// safety.cjs — Shared SSOT for slug/date guards + markdown sanitization +
// secret redaction.
//
// Sprint 2.5b/2.6b/2.11 cross-cutting refactor (R2 review feedback): the
// same regex + sanitization helpers were duplicated across workflow_hardener,
// secret_history_sweep, senior_tester_review. Extracted here so future
// action_kinds inherit a single SSOT — mirror of addCostFields pattern
// (Sprint 1.6.14).
//
// Sprint 2.11.1 P0 fix: redactSecrets unified here. Previously two divergent
// implementations existed at action-engine.cjs:1218 (claude-cli stdout/stderr
// redaction, 2 patterns specific to OAuth + Bearer) and senior-tester-action.cjs:138
// (LLM-judge content redaction, 9 provider patterns + env-style fallback).
// The senior-tester variant lacked a distinct sentinel for Anthropic OAuth
// artifacts (sk-ant-oat##-…) — they were caught only by the generic sk-prefix
// pattern with the generic `sk-<redacted>` replacement, hiding the OAuth-
// specific signal in test excerpts forwarded to the LLM judge. Its Bearer
// regex was also narrow: base64 chars (`+/=`) escaped the character class.
//
// Functions exported:
//   - SAFE_SLUG_REGEX, SAFE_DATE_REGEX, SAFE_SHA_REGEX
//   - assertSafeSlug(slug), assertSafeDate(date), assertSafeSha(sha)
//   - sanitizeForMarkdown(s, opts) — issue/journal body fields
//   - normalizeCRLF(s)
//   - redactSecrets(s) — strip secret-shaped substrings from any text

'use strict';

// SAFE_SLUG_REGEX — must reject path-traversal (`..`) AND be defensive against
// pure-dot or empty strings. The `..` segment in particular can sneak through
// permissive `[A-Za-z0-9._\-]` allowlists if the operator passes `..` or
// `..foo..` literally as slug. We follow GitHub repo-name semantics: 1-100
// chars, alphanumeric + dot + hyphen + underscore, but NOT `..` anywhere.
const SAFE_SLUG_REGEX = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const PATH_TRAVERSAL_REGEX = /\.\./;

const SAFE_DATE_REGEX = /^\d{4}-\d{2}(-\d{2})?$/;
const SAFE_SHA_REGEX = /^[a-f0-9]{40}$/i;

function assertSafeSlug(slug) {
  if (typeof slug !== 'string' || !SAFE_SLUG_REGEX.test(slug) || PATH_TRAVERSAL_REGEX.test(slug)) {
    const e = new Error('UNSAFE_SLUG');
    e.code = 'UNSAFE_SLUG';
    e.invalid = slug;
    throw e;
  }
}

function assertSafeDate(date) {
  if (typeof date !== 'string' || !SAFE_DATE_REGEX.test(date)) {
    const e = new Error('UNSAFE_DATE');
    e.code = 'UNSAFE_DATE';
    e.invalid = date;
    throw e;
  }
}

function assertSafeSha(sha) {
  if (typeof sha !== 'string' || !SAFE_SHA_REGEX.test(sha)) {
    const e = new Error('UNSAFE_SHA');
    e.code = 'UNSAFE_SHA';
    e.invalid = sha;
    throw e;
  }
}

// CRLF normalization — strip trailing \r before logging excerpts. Without
// this, file content from Windows line-endings (or YAML files with mixed
// EOL) bleeds \r into journal/issue output.
function normalizeCRLF(s) {
  if (s == null) return '';
  return String(s).replace(/\r\n/g, '\n').replace(/\r/g, '');
}

// Markdown sanitization for issue/journal body fields. Defense-in-depth:
//   - Hard-cap length (MAX_FIELD_BYTES)
//   - Neutralize HTML angle brackets (entity encoding)
//   - Escape @-mentions (zero-width-space prefix)
//   - By default, collapse backticks (caller can opt back in for code spans)
//   - Strip CRLF for stable line accounting
const MAX_FIELD_BYTES = 2000;
function sanitizeForMarkdown(s, opts = {}) {
  if (s == null) return '';
  let out = normalizeCRLF(String(s));
  const cap = typeof opts.maxBytes === 'number' ? opts.maxBytes : MAX_FIELD_BYTES;
  if (out.length > cap) {
    out = out.slice(0, cap) + ' …[shortened]';
  }
  out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = out.replace(/@([A-Za-z0-9][\w-]{0,38})/g, '@​$1');
  if (!opts.allowBackticks) {
    out = out.replace(/`/g, '‘');
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret redaction (Sprint 2.11.1 SSOT M2 fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// Provider-aware redaction with proper per-match callback semantics. Each
// pattern uses /g for full-content sweep. Order matters: more-specific
// shapes (OAuth, JWT) are listed before generic prefixes (sk-, Bearer) so
// distinct replacement strings reach the right matches. The env-style
// fallback at the end catches assignments that don't match any provider
// pattern but look like credentials in code/config form.
//
// Replacement strings use square-bracket sentinels (`[REDACTED-…]`) so they
// survive `sanitizeForMarkdown` unchanged (angle-bracket variants would be
// HTML-escaped to `&lt;…&gt;` when re-rendered in issue bodies).
const SECRET_PATTERNS = [
  // Anthropic OAuth tokens (Sprint 2.4 R2 fix). MUST run BEFORE sk-prefix
  // because the latter would otherwise match `sk-ant-oat...` with the
  // generic sk- replacement, hiding the OAuth-specific signal.
  { name: 'oauth-anthropic', re: /sk-ant-oat\d{2}-[A-Za-z0-9_-]+/g, repl: '[REDACTED-OAUTH-TOKEN]' },
  // JWT (3-segment dot-separated base64url). MUST run BEFORE sk-prefix —
  // the JWT body could contain a `sk-` substring after base64-decoding
  // collisions; the JWT pattern is structurally distinctive and unambiguous.
  { name: 'jwt', re: /eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, repl: '[REDACTED-JWT]' },
  // Bearer-header tokens. base64 character class (`+/=`) included so
  // base64-encoded Bearer values (Basic-auth style or OAuth refresh tokens
  // in some flows) don't slip past. Case-insensitive `Bearer` keyword.
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._\-+/=]+/gi, repl: 'Bearer [REDACTED]' },
  // Generic sk- prefix (OpenAI, Anthropic legacy, Stripe-test, etc.).
  // Runs after OAuth-Anthropic so the more-specific OAuth shape gets the
  // OAuth replacement, not the generic sk- replacement.
  { name: 'sk-prefix', re: /sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_\-]{20,}/g, repl: 'sk-[REDACTED]' },
  // GitHub PATs (classic + fine-grained).
  { name: 'github-pat-classic', re: /gh[pousr]_[A-Za-z0-9]{20,}/g, repl: 'ghX_[REDACTED]' },
  { name: 'github-pat-fine', re: /github_pat_[A-Za-z0-9_]{30,}/g, repl: 'github_pat_[REDACTED]' },
  // Cloud-provider keys.
  { name: 'aws-access', re: /AKIA[0-9A-Z]{16}/g, repl: 'AKIA[REDACTED]' },
  { name: 'google-api', re: /AIza[0-9A-Za-z\-_]{35,}/g, repl: 'AIza[REDACTED]' },
  // Slack workspace/bot/user tokens.
  { name: 'slack', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, repl: 'xox[REDACTED]' },
  // Stripe live mode (rk_live, sk_live).
  { name: 'stripe-live', re: /(?:sk|rk)_live_[A-Za-z0-9]{16,}/g, repl: 'live_[REDACTED]' },
];

// Generic env-style fallback. Matches `api_key = "..."`, `password: '...'`,
// `token = '...'`, etc. — any line where a credential keyword precedes a
// quoted string literal. Per-match callback ensures the inner literal is
// replaced (not the keyword), preserving log readability.
const ENV_STYLE_FALLBACK_REGEX =
  /(?:api[_-]?key|secret|password|token|credential)\s*[:=]\s*['"`][^'"`\r\n]+['"`]/gi;

function redactSecrets(s) {
  if (s == null) return '';
  let out = String(s);
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, p.repl);
  }
  // Env-style fallback runs AFTER provider patterns. It catches `apiKey: '…'`,
  // `password = "…"`, etc. where the literal isn't a known provider shape.
  // Skip matches whose literal already contains a [REDACTED…] sentinel — a
  // provider pattern already ran on it and we want to preserve the more
  // specific sentinel (e.g. `[REDACTED-OAUTH-TOKEN]` not collapsed to
  // `<REDACTED>`). The `[-A-Z]*` body matches sentinels with any number of
  // hyphenated segments (REDACTED, REDACTED-JWT, REDACTED-OAUTH-TOKEN).
  out = out.replace(ENV_STYLE_FALLBACK_REGEX, (match) => {
    if (/\[REDACTED[-A-Z]*\]/.test(match)) return match;
    return match.replace(/['"`][^'"`\r\n]+['"`]$/, "'<REDACTED>'");
  });
  return out;
}

module.exports = {
  SAFE_SLUG_REGEX,
  SAFE_DATE_REGEX,
  SAFE_SHA_REGEX,
  PATH_TRAVERSAL_REGEX,
  MAX_FIELD_BYTES,
  SECRET_PATTERNS,
  ENV_STYLE_FALLBACK_REGEX,
  assertSafeSlug,
  assertSafeDate,
  assertSafeSha,
  normalizeCRLF,
  sanitizeForMarkdown,
  redactSecrets,
};
