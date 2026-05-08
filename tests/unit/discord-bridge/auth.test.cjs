'use strict';

// Sprint 2.6 — Discord bridge auth helpers tests.
// Pure logic; zero-deps; no discord.js.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../../../bin/discord-bridge/auth.cjs');

const TEST_SECRET = 'a'.repeat(64); // 64-hex-char placeholder
const TEST_ACTION_ID = 'halt-1234567890-abcdef';

describe('auth.loadAllowedUserIds', () => {
  test('returns empty Set when env var missing (fail-closed)', () => {
    const prev = process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
    delete process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
    try {
      assert.equal(auth.loadAllowedUserIds().size, 0);
    } finally {
      if (prev !== undefined) process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = prev;
    }
  });

  test('parses comma-separated snowflake IDs', () => {
    const prev = process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
    process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = '111111111111111111,222222222222222222';
    try {
      const set = auth.loadAllowedUserIds();
      assert.equal(set.size, 2);
      assert.ok(set.has('111111111111111111'));
      assert.ok(set.has('222222222222222222'));
    } finally {
      if (prev === undefined) delete process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
      else process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = prev;
    }
  });

  test('rejects non-snowflake-shaped IDs (security HIGH)', () => {
    const prev = process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
    process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = '111111111111111111,evil-id-not-numeric,short,222222222222222222';
    try {
      const set = auth.loadAllowedUserIds();
      assert.equal(set.size, 2, 'only snowflake-shape IDs accepted');
      assert.equal(set.has('evil-id-not-numeric'), false);
      assert.equal(set.has('short'), false);
    } finally {
      if (prev === undefined) delete process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
      else process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = prev;
    }
  });

  test('trims whitespace + handles trailing newline (CI secret class)', () => {
    const prev = process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
    process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = '  111111111111111111 , 222222222222222222 \n';
    try {
      const set = auth.loadAllowedUserIds();
      assert.equal(set.size, 2);
    } finally {
      if (prev === undefined) delete process.env.STEWARD_DISCORD_ALLOWED_USER_IDS;
      else process.env.STEWARD_DISCORD_ALLOWED_USER_IDS = prev;
    }
  });
});

describe('auth.isUserAllowed', () => {
  test('returns true for whitelisted user', () => {
    const set = new Set(['111111111111111111']);
    assert.equal(auth.isUserAllowed('111111111111111111', set), true);
  });

  test('returns false for non-whitelisted user', () => {
    const set = new Set(['111111111111111111']);
    assert.equal(auth.isUserAllowed('999999999999999999', set), false);
  });

  test('returns false for null/undefined/non-string', () => {
    const set = new Set(['111111111111111111']);
    assert.equal(auth.isUserAllowed(null, set), false);
    assert.equal(auth.isUserAllowed(undefined, set), false);
    assert.equal(auth.isUserAllowed(0, set), false);
    assert.equal(auth.isUserAllowed({}, set), false);
  });

  test('returns false when allowedSet is empty (fail-closed)', () => {
    assert.equal(auth.isUserAllowed('111111111111111111', new Set()), false);
  });
});

describe('auth.generateActionToken / verifyActionToken', () => {
  test('generated token verifies in same window', () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now });
    assert.match(token, /^[0-9a-f]{8}$/, 'token is 8 hex chars');
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, token, { secret: TEST_SECRET, now }), true);
  });

  test('token verifies in NEXT window (90s replay window)', () => {
    const now1 = new Date('2026-05-09T12:00:00Z');
    const now2 = new Date('2026-05-09T12:01:00Z'); // +60s, same window
    const now3 = new Date('2026-05-09T12:01:31Z'); // +91s, next window
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now: now1 });
    // Same window — verifies.
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, token, { secret: TEST_SECRET, now: now2 }), true);
    // Next window — still verifies (looks back one window).
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, token, { secret: TEST_SECRET, now: now3 }), true);
  });

  test('token does NOT verify after 2 windows (180s+)', () => {
    const now1 = new Date('2026-05-09T12:00:00Z');
    const now4 = new Date('2026-05-09T12:03:01Z'); // +181s, two windows later
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now: now1 });
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, token, { secret: TEST_SECRET, now: now4 }), false);
  });

  test('token does not verify with wrong actionId', () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now });
    assert.equal(auth.verifyActionToken('different-action-id', token, { secret: TEST_SECRET, now }), false);
  });

  test('token does not verify with wrong secret', () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now });
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, token, { secret: 'b'.repeat(64), now }), false);
  });

  test('verifyActionToken rejects malformed tokens', () => {
    const now = new Date('2026-05-09T12:00:00Z');
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, '', { secret: TEST_SECRET, now }), false);
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, 'too-short', { secret: TEST_SECRET, now }), false);
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, 'NOT-HEX!', { secret: TEST_SECRET, now }), false);
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, 'abcdef0123', { secret: TEST_SECRET, now }), false); // too long
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, null, { secret: TEST_SECRET, now }), false);
    assert.equal(auth.verifyActionToken(null, 'abcdef01', { secret: TEST_SECRET, now }), false);
  });

  test('verifyActionToken case-insensitive', () => {
    const now = new Date('2026-05-09T12:00:00Z');
    const token = auth.generateActionToken(TEST_ACTION_ID, { secret: TEST_SECRET, now });
    const upper = token.toUpperCase();
    assert.equal(auth.verifyActionToken(TEST_ACTION_ID, upper, { secret: TEST_SECRET, now }), true);
  });

  test('generateActionToken throws on missing actionId', () => {
    assert.throws(() => auth.generateActionToken(null, { secret: TEST_SECRET }));
    assert.throws(() => auth.generateActionToken('', { secret: TEST_SECRET }));
  });

  test('generateActionToken throws on missing/short secret (env path)', () => {
    const prev = process.env.STEWARD_DISCORD_SECRET;
    delete process.env.STEWARD_DISCORD_SECRET;
    try {
      assert.throws(() => auth.generateActionToken(TEST_ACTION_ID), (err) => err.code === 'STEWARD_DISCORD_SECRET_MISSING');
    } finally {
      if (prev !== undefined) process.env.STEWARD_DISCORD_SECRET = prev;
    }
  });
});

describe('auth.isMutationCommand', () => {
  test('recognizes ! prefix', () => {
    assert.equal(auth.isMutationCommand('!halt'), true);
    assert.equal(auth.isMutationCommand('!resume'), true);
    assert.equal(auth.isMutationCommand('!recommend'), true);
  });

  test('rejects non-prefixed', () => {
    assert.equal(auth.isMutationCommand('status'), false);
    assert.equal(auth.isMutationCommand('forecast'), false);
    assert.equal(auth.isMutationCommand('why'), false);
  });

  test('rejects null/undefined/non-string', () => {
    assert.equal(auth.isMutationCommand(null), false);
    assert.equal(auth.isMutationCommand(undefined), false);
    assert.equal(auth.isMutationCommand(123), false);
  });
});
