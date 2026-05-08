// git-trailers.cjs — build commit messages with parseable Git trailers (MUST-H3).
//
// Trailers are formal Git plumbing parseable by `git interpret-trailers --parse`.
// Future-Steward reads its own history via:
//
//   git log --format='%H %(trailers:key=Steward-Action-Id,valueonly)'
//
// without regex, without fuzzy match, without commit-message format drift.
//
// Required trailers per Steward commit (Sprint 4.7 rebrand):
//   Steward-Action-Id: <ulid>
//   Steward-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl#L<n>
//   Steward-Trigger: cron|incident|pr-merged|manual
//   Steward-Recommendation-Source: cortex/recommendations.md#<heading-anchor>
//
// Optional:
//   Steward-Reverts: <original-sha>     (revert commits only — bidirectional audit)
//   Co-Authored-By: Steward <steward@cortex-x.local>
//
// Past commits in repo history retain their original `Hermes-*` trailers
// from before the Sprint 4.7 rename — those are immutable. parseTrailers is
// prefix-agnostic (matches any `Word-Word: value` shape) and `getTrailer`
// reads either prefix from the parsed map so future-Steward can walk history
// without two lookups. Builder + validator are Steward-* only (v0.2.0
// dropped the legacy normalization shim).
//
// Contract:
//   - Pure function, no side effects, no fs, no process spawn
//   - Output is a single multi-line string, ready to pass to `git commit -F -`
//   - Conventional Commits subject (type + optional scope + ! + colon + subject)
//   - Body / trailers separated by blank line per Conventional Commits + Git spec

'use strict';

const VALID_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test',
  'build', 'ci', 'chore', 'revert',
];

const VALID_TRIGGERS = ['cron', 'incident', 'pr-merged', 'manual'];

const REQUIRED_TRAILER_SUFFIXES = [
  'Action-Id',
  'Journal-Entry',
  'Trigger',
  'Recommendation-Source',
];

// Generate a Crockford-base32-ish ULID without external deps.
// 26 chars: 10 timestamp + 16 random. Monotonic-enough for action ordering.
function ulid(now) {
  const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const ts = now ?? Date.now();
  let tsPart = '';
  let t = ts;
  for (let i = 0; i < 10; i += 1) {
    tsPart = ENC[t & 0x1f] + tsPart;
    t = Math.floor(t / 32);
  }
  let randPart = '';
  for (let i = 0; i < 16; i += 1) {
    randPart += ENC[Math.floor(Math.random() * 32)];
  }
  return tsPart + randPart;
}

function validateConventionalSubject(opts) {
  if (!VALID_TYPES.includes(opts.type)) {
    throw new Error(`type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (typeof opts.subject !== 'string' || opts.subject.length === 0) {
    throw new Error('subject must be non-empty string');
  }
  if (opts.subject.length > 72) {
    throw new Error(`subject too long: ${opts.subject.length} chars (max 72 for Conventional Commits)`);
  }
}

function validateTrailers(trailers) {
  for (const suffix of REQUIRED_TRAILER_SUFFIXES) {
    const k = `Steward-${suffix}`;
    if (!trailers[k] || typeof trailers[k] !== 'string') {
      throw new Error(`trailer ${k} is required`);
    }
  }
  if (!VALID_TRIGGERS.includes(trailers['Steward-Trigger'])) {
    throw new Error(`Steward-Trigger must be one of: ${VALID_TRIGGERS.join(', ')}`);
  }
  // Trailer values must not contain newlines (Git spec)
  for (const [k, v] of Object.entries(trailers)) {
    if (typeof v === 'string' && /[\r\n]/.test(v)) {
      throw new Error(`trailer ${k} contains newline (forbidden by Git trailer format)`);
    }
  }
}

// Build a Conventional-Commits-shaped subject string.
function buildSubject({ type, scope, breaking, subject }) {
  const scopeStr = scope ? `(${scope})` : '';
  const bang = breaking ? '!' : '';
  return `${type}${scopeStr}${bang}: ${subject}`;
}

// Build the complete commit message: subject + blank + body + blank + trailers.
function buildCommitMessage(opts) {
  validateConventionalSubject(opts);

  const incoming = opts.trailers || {};
  const trailers = {
    ...incoming,
    'Co-Authored-By': incoming['Co-Authored-By'] || 'Steward <steward@cortex-x.local>',
  };
  validateTrailers(trailers);

  const subject = buildSubject(opts);
  const body = (opts.body || '').trim();

  const trailerLines = Object.entries(trailers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const parts = [subject];
  if (body) parts.push('', body);
  parts.push('', trailerLines);

  return parts.join('\n');
}

// Parse trailers out of a commit message body. Mirrors `git interpret-trailers
// --parse` behaviour for cases we care about. Prefix-agnostic: a commit
// authored before Sprint 4.7 rename keeps its original `Hermes-*` keys, while
// a fresh commit shows `Steward-*`. Callers asking for a specific value
// should check both prefixes (helper `getTrailer` below).
function parseTrailers(commitMessage) {
  const trailers = {};
  const lines = commitMessage.split('\n');

  // Strip trailing empty lines (commits often end with \n)
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) return trailers;

  // Find the LAST blank line — trailers are everything after it
  let lastBlankIdx = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i] === '') {
      lastBlankIdx = i;
      break;
    }
  }

  // Walk forward from after the last blank line, collecting trailer-shaped lines
  for (let i = lastBlankIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9-]*): (.+)$/);
    if (m) {
      const k = m[1];
      if (trailers[k] === undefined) trailers[k] = m[2];
      else if (Array.isArray(trailers[k])) trailers[k].push(m[2]);
      else trailers[k] = [trailers[k], m[2]];
    }
  }

  return trailers;
}

// Read a Steward-* trailer with fall-through to legacy Hermes-* prefix.
// Used by future-Steward to walk pre-rebrand history without two lookups.
function getTrailer(parsed, suffix) {
  return parsed[`Steward-${suffix}`] !== undefined
    ? parsed[`Steward-${suffix}`]
    : parsed[`Hermes-${suffix}`];
}

module.exports = {
  buildCommitMessage,
  buildSubject,
  parseTrailers,
  getTrailer,
  ulid,
  validateConventionalSubject,
  validateTrailers,
  VALID_TYPES,
  VALID_TRIGGERS,
  REQUIRED_TRAILER_SUFFIXES,
};
