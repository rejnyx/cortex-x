'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCommitMessage,
  buildSubject,
  parseTrailers,
  ulid,
  validateConventionalSubject,
  validateTrailers,
  VALID_TYPES,
  VALID_TRIGGERS,
} = require('../../../bin/hermes/_lib/git-trailers.cjs');

const TRAILERS = {
  'Hermes-Action-Id': '01HXG9F7Z8M2K9ABCDEFGHJKMN',
  'Hermes-Journal-Entry': '~/.cortex/journal/test/2026-05-07.jsonl#L1',
  'Hermes-Trigger': 'cron',
  'Hermes-Recommendation-Source': 'cortex/recommendations.md#do-this-week-1',
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
    const { 'Hermes-Action-Id': _, ...rest } = TRAILERS;
    assert.throws(() => validateTrailers(rest), /Hermes-Action-Id is required/);
  });

  test('invalid Hermes-Trigger rejected', () => {
    assert.throws(
      () => validateTrailers({ ...TRAILERS, 'Hermes-Trigger': 'fairy-godmother' }),
      /Hermes-Trigger must be one of/,
    );
  });

  test('newline in trailer value rejected (Git spec)', () => {
    assert.throws(
      () => validateTrailers({ ...TRAILERS, 'Hermes-Action-Id': 'a\nb' }),
      /contains newline/,
    );
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
      scope: 'hermes',
      subject: 'add subtract function',
      body: 'Hermes adds subtract per recommendations.md week-1.',
      trailers: TRAILERS,
    });

    assert.match(msg, /^feat\(hermes\): add subtract function/);
    assert.match(msg, /Hermes adds subtract per recommendations\.md week-1\./);
    assert.match(msg, /Hermes-Action-Id: 01HXG9F7Z8M2K9ABCDEFGHJKMN/);
    assert.match(msg, /Hermes-Journal-Entry:.*\.jsonl#L1/);
    assert.match(msg, /Hermes-Trigger: cron/);
    assert.match(msg, /Hermes-Recommendation-Source: cortex\/recommendations\.md/);
    assert.match(msg, /Co-Authored-By: Hermes <hermes@cortex-x\.local>/);
  });

  test('omitting body still produces valid message', () => {
    const msg = buildCommitMessage({
      type: 'chore',
      subject: 'minimal commit',
      trailers: TRAILERS,
    });
    assert.match(msg, /^chore: minimal commit/);
    assert.match(msg, /Hermes-Action-Id:/);
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
    const msg = `feat: x\n\nfoo\n\nHermes-Reverts: abc123\nHermes-Reverts: def456\n`;
    const parsed = parseTrailers(msg);
    assert.deepEqual(parsed['Hermes-Reverts'], ['abc123', 'def456']);
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
