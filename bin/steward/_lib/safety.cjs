// safety.cjs — Shared SSOT for slug/date guards + markdown sanitization.
//
// Sprint 2.5b/2.6b/2.11 cross-cutting refactor (R2 review feedback): the
// same regex + sanitization helpers were duplicated across workflow_hardener,
// secret_history_sweep, senior_tester_review. Extracted here so future
// action_kinds inherit a single SSOT — mirror of addCostFields pattern
// (Sprint 1.6.14).
//
// Functions exported:
//   - SAFE_SLUG_REGEX, SAFE_DATE_REGEX, SAFE_SHA_REGEX
//   - assertSafeSlug(slug), assertSafeDate(date), assertSafeSha(sha)
//   - sanitizeForMarkdown(s, opts) — issue/journal body fields
//   - normalizeCRLF(s)

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

module.exports = {
  SAFE_SLUG_REGEX,
  SAFE_DATE_REGEX,
  SAFE_SHA_REGEX,
  PATH_TRAVERSAL_REGEX,
  MAX_FIELD_BYTES,
  assertSafeSlug,
  assertSafeDate,
  assertSafeSha,
  normalizeCRLF,
  sanitizeForMarkdown,
};
