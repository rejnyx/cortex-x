// Sprint 2.28.3 — SSOT confirm helper tests.
//
// Verifies the extracted bin/_lib/confirm.cjs has the contract sister CLIs
// (hooks-register / claude-md-augment / permissions-register) depend on.
// The interactive path is intentionally not tested here (TTY plumbing); the
// pure decision helper parseConfirmReply carries the security semantics.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'bin', '_lib', 'confirm.cjs');
const { parseConfirmReply } = require(LIB);

test('parseConfirmReply — y / yes (any case + whitespace) → true', () => {
  for (const reply of ['y', 'Y', 'yes', 'YES', 'Yes', ' y ', '  yes\n', '\ty\r\n']) {
    assert.equal(parseConfirmReply(reply), true, `reply ${JSON.stringify(reply)} should confirm`);
  }
});

test('parseConfirmReply — empty / whitespace / EOF → false (abort)', () => {
  for (const reply of ['', ' ', '\n', '\r\n', '\t\t', '   \r\n   ']) {
    assert.equal(parseConfirmReply(reply), false, `reply ${JSON.stringify(reply)} must abort`);
  }
});

test('parseConfirmReply — anything other than y/yes → false', () => {
  for (const reply of ['n', 'no', 'NO', 'maybe', 'sure', 'ok', '1', 'true', 'YEEEES', 'y!', '?']) {
    assert.equal(parseConfirmReply(reply), false, `reply ${JSON.stringify(reply)} must NOT confirm`);
  }
});

test('parseConfirmReply — non-string input → false', () => {
  for (const reply of [null, undefined, 0, 1, true, false, [], {}, Buffer.from('y')]) {
    assert.equal(parseConfirmReply(reply), false);
  }
});

test('parseConfirmReply — matches Sprint 2.28.1 explicit-confirm contract', () => {
  // The exact semantics shipped into cortex-permissions-register Sprint 2.28.1
  // (edge HIGH #11) — backported to sister CLIs in Sprint 2.28.3 via this helper.
  assert.equal(parseConfirmReply('y'), true);
  assert.equal(parseConfirmReply('yes'), true);
  assert.equal(parseConfirmReply(''), false);
  assert.equal(parseConfirmReply('\n'), false);
});
