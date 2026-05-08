'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCommitMessage,
  buildSubject,
  parseTrailers,
  getTrailer,
  ulid,
  validateConventionalSubject,
  validateTrailers,
  VALID_TYPES,
  VALID_TRIGGERS,
} = require('../../../bin/steward/_lib/git-trailers.cjs');

// Trailers use canonical Steward-* prefix. Pre-Sprint-4.7 commits in repo
// history retain their original Hermes-* trailers — those are immutable;
// parseTrailers is prefix-agnostic and getTrailer reads either prefix from
// the parsed map (read-only backward-compat for history walking).
const TRAILERS = {
  'Steward-Action-Id': '01HXG9F7Z8M2K9ABCDEFGHJKMN',
  'Steward-Journal-Entry': '~/.cortex/journal/test/2026-05-07.jsonl#L1',
  'Steward-Trigger': 'cron',
  'Steward-Recommendation-Source': 'cortex/recommendations.md#do-this-week-1',
};

describe('git-trailers: ULID', () => {
  test('ulid returns 26-char Crockford-base32 string', () => {
    const id = ulid();
    assert.equal(id.length, 26);
    assert.match(id, /^[0-9A-HJKMNP-TV-Z]+$/);
  });

  test('ulids monotonic across calls (timestamp-prefixed)', () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    assert.ok(a.slice(0, 10) <= b.slice(0, 10), 'ULIDs from later timestamps must sort after earlier');
  });
});

describe('git-trailers: subject validation', () => {
  test('valid type accepted', () => {
    assert.doesNotThrow(() => validateConventionalSubject({
      type: 'feat',
      subject: 'add a thing',
    }));
  });

  test('invalid type rejected', () => {
    assert.throws(
      () => validateConventionalSubject({ type: 'whatever', subject: 'x' }),
      /type must be one of/,
    );
  });

  test('empty subject rejected', () => {
    assert.throws(
      () => validateConventionalSubject({ type: 'feat', subject: '' }),
      /subject must be non-empty/,
    );
  });

  test('long subject rejected (>72 chars)', () => {
    const long = 'a'.repeat(73);
    assert.throws(
      () => validateConventionalSubject({ type: 'feat', subject: long }),
      /subject too long/,
    );
  });
});

describe('git-trailers: trailer validation', () => {
  test('valid trailers accepted', () => {
    assert.doesNotThrow(() => validateTrailers(TRAILERS));
  });

  test('missing required trailer rejected', () => {
    const { 'Steward-Action-Id': _, ...rest } = TRAILERS;
    assert.throws(() => validateTrailers(rest), /Steward-Action-Id is required/);
  });

  test('invalid Steward-Trigger rejected', () => {
    assert.throws(
      () => validateTrailers({ ...TRAILERS, 'Steward-Trigger': 'fairy-godmother' }),
      /Steward-Trigger must be one of/,
    );
  });

  test('newline in trailer value rejected (Git spec)', () => {
    assert.throws(
      () => validateTrailers({ ...TRAILERS, 'Steward-Action-Id': 'a\nb' }),
      /contains newline/,
    );
  });
});

describe('git-trailers: read-only legacy support (history walking)', () => {
  test('getTrailer reads either prefix from parsed map (Steward wins; Hermes fallback)', () => {
    const legacyParsed = { 'Hermes-Action-Id': 'OLD' };
    const currentParsed = { 'Steward-Action-Id': 'NEW' };
    const both = { 'Hermes-Action-Id': 'OLD', 'Steward-Action-Id': 'NEW' };
    assert.equal(getTrailer(legacyParsed, 'Action-Id'), 'OLD');
    assert.equal(getTrailer(currentParsed, 'Action-Id'), 'NEW');
    // Steward-* wins when both present (canonical takes precedence).
    assert.equal(getTrailer(both, 'Action-Id'), 'NEW');
  });
});

describe('git-trailers: buildSubject', () => {
  test('type + subject', () => {
    assert.equal(buildSubject({ type: 'feat', subject: 'add a thing' }), 'feat: add a thing');
  });

  test('type + scope + subject', () => {
    assert.equal(
      buildSubject({ type: 'fix', scope: 'auth', subject: 'token expiry' }),
      'fix(auth): token expiry',
    );
  });

  test('breaking flag emits !', () => {
    assert.equal(
      buildSubject({ type: 'feat', scope: 'api', breaking: true, subject: 'rename endpoint' }),
      'feat(api)!: rename endpoint',
    );
  });
});

describe('git-trailers: buildCommitMessage end-to-end', () => {
  test('full message with body + trailers + Co-Authored-By', () => {
    const msg = buildCommitMessage({
      type: 'feat',
      scope: 'steward',
      subject: 'add subtract function',
      body: 'Steward adds subtract per recommendations.md week-1.',
      trailers: TRAILERS,
    });

    assert.match(msg, /^feat\(steward\): add subtract function/);
    assert.match(msg, /Steward adds subtract per recommendations\.md week-1\./);
    assert.match(msg, /Steward-Action-Id: 01HXG9F7Z8M2K9ABCDEFGHJKMN/);
    assert.match(msg, /Steward-Journal-Entry:.*\.jsonl#L1/);
    assert.match(msg, /Steward-Trigger: cron/);
    assert.match(msg, /Steward-Recommendation-Source: cortex\/recommendations\.md/);
    assert.match(msg, /Co-Authored-By: Steward <steward@cortex-x\.local>/);
  });

  test('omitting body still produces valid message', () => {
    const msg = buildCommitMessage({
      type: 'chore',
      subject: 'minimal commit',
      trailers: TRAILERS,
    });
    assert.match(msg, /^chore: minimal commit/);
    assert.match(msg, /Steward-Action-Id:/);
  });
});

describe('git-trailers: parseTrailers (round-trip)', () => {
  test('round-trip: build → parse extracts the same trailers', () => {
    const msg = buildCommitMessage({
      type: 'feat',
      subject: 'roundtrip test',
      body: 'Some context here.',
      trailers: TRAILERS,
    });
    const parsed = parseTrailers(msg);
    for (const [k, v] of Object.entries(TRAILERS)) {
      assert.equal(parsed[k], v, `expected trailer ${k} to roundtrip`);
    }
  });

  test('multiple values on the same key collected as array', () => {
    const msg = `feat: x\n\nfoo\n\nSteward-Reverts: abc123\nSteward-Reverts: def456\n`;
    const parsed = parseTrailers(msg);
    assert.deepEqual(parsed['Steward-Reverts'], ['abc123', 'def456']);
  });

  test('parseTrailers reads legacy Hermes-* keys from pre-Sprint-4.7 history', () => {
    const msg = `feat: legacy commit\n\nbody\n\nHermes-Action-Id: OLD\nHermes-Trigger: manual\n`;
    const parsed = parseTrailers(msg);
    assert.equal(parsed['Hermes-Action-Id'], 'OLD');
    assert.equal(getTrailer(parsed, 'Action-Id'), 'OLD');
  });
});

describe('git-trailers: contract surfaces', () => {
  test('VALID_TYPES is a Conventional-Commits-shaped enum', () => {
    assert.ok(VALID_TYPES.includes('feat'));
    assert.ok(VALID_TYPES.includes('fix'));
    assert.ok(VALID_TYPES.includes('chore'));
    assert.ok(VALID_TYPES.includes('revert'));
  });

  test('VALID_TRIGGERS matches journal triggers', () => {
    assert.deepEqual(
      VALID_TRIGGERS.slice().sort(),
      ['cron', 'incident', 'manual', 'pr-merged'],
    );
  });
});
