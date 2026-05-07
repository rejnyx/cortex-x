// git-trailers.cjs — build commit messages with parseable Git trailers (MUST-H3).
//
// Trailers are formal Git plumbing parseable by `git interpret-trailers --parse`.
// Future-Hermes reads its own history via:
//
//   git log --format='%H %(trailers:key=Hermes-Action-Id,valueonly)'
//
// without regex, without fuzzy match, without commit-message format drift.
//
// Required trailers per Hermes commit:
//   Hermes-Action-Id: <ulid>
//   Hermes-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl#L<n>
//   Hermes-Trigger: cron|incident|pr-merged|manual
//   Hermes-Recommendation-Source: cortex/recommendations.md#<heading-anchor>
//
// Optional:
//   Hermes-Reverts: <original-sha>     (revert commits only — bidirectional audit)
//   Co-Authored-By: Hermes <hermes@cortex-x.local>
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
  const required = [
    'Hermes-Action-Id',
    'Hermes-Journal-Entry',
    'Hermes-Trigger',
    'Hermes-Recommendation-Source',
  ];
  for (const k of required) {
    if (!trailers[k] || typeof trailers[k] !== 'string') {
      throw new Error(`trailer ${k} is required`);
    }
  }
  if (!VALID_TRIGGERS.includes(trailers['Hermes-Trigger'])) {
    throw new Error(`Hermes-Trigger must be one of: ${VALID_TRIGGERS.join(', ')}`);
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

  const trailers = {
    ...opts.trailers,
    'Co-Authored-By': opts.trailers['Co-Authored-By'] || 'Hermes <hermes@cortex-x.local>',
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
// --parse` behaviour for cases we care about. Used by tests + future-Hermes
// journal lookup (until we shell out to real git interpret-trailers).
//
// Algorithm: trailers are the final paragraph of the message (last contiguous
// block of trailer-shaped lines preceded by a blank line). Trailing newlines
// are stripped before scanning so commits ending with `\n` parse correctly.
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

module.exports = {
  buildCommitMessage,
  buildSubject,
  parseTrailers,
  ulid,
  validateConventionalSubject,
  validateTrailers,
  VALID_TYPES,
  VALID_TRIGGERS,
};
