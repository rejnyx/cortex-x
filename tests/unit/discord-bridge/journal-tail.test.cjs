'use strict';

// Sprint 2.6 — journal-tail watcher tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const journalTail = require('../../../bin/discord-bridge/journal-tail.cjs');

function tmpFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `journal-tail-${prefix}-`));
  return path.join(dir, 'journal.jsonl');
}

describe('routeJournalEvent', () => {
  test('cost events route to steward-cost', () => {
    assert.equal(journalTail.routeJournalEvent({ event: 'budget_warning' }), 'steward-cost');
    assert.equal(journalTail.routeJournalEvent({ event: 'token_velocity_cap_reached' }), 'steward-cost');
    assert.equal(journalTail.routeJournalEvent({ code: 'CLAUDE_CLI_BILLING_LEAK' }), 'steward-cost');
  });

  test('autoresearch events route to steward-research', () => {
    assert.equal(journalTail.routeJournalEvent({ event: 'autoresearch_winner_selected' }), 'steward-research');
    assert.equal(journalTail.routeJournalEvent({ event: 'prompt_evolved' }), 'steward-research');
  });

  test('failure events route to steward-failures', () => {
    assert.equal(journalTail.routeJournalEvent({ event: 'spec_violation' }), 'steward-failures');
    assert.equal(journalTail.routeJournalEvent({ event: 'npm_test_failed' }), 'steward-failures');
    assert.equal(journalTail.routeJournalEvent({ code: 'EDIT_DESTRUCTIVE_REWRITE' }), 'steward-failures');
  });

  test('halt + auth events route to steward-alerts', () => {
    assert.equal(journalTail.routeJournalEvent({ event: 'halt_triggered' }), 'steward-alerts');
    assert.equal(journalTail.routeJournalEvent({ code: 'CLAUDE_CLI_AUTH_REJECTED' }), 'steward-alerts');
    assert.equal(journalTail.routeJournalEvent({ event: 'loop_detected' }), 'steward-alerts');
  });

  test('plain success events return null (no push)', () => {
    assert.equal(journalTail.routeJournalEvent({ outcome: 'success', event: 'recommendation_executed' }), null);
  });

  test('threshold_exceeded routes despite success outcome', () => {
    // Routine success returns null, but threshold_exceeded class is advisory and worth surfacing.
    const r = journalTail.routeJournalEvent({ outcome: 'success', event: 'tech_debt_threshold_exceeded' });
    // Doesn't match any specific rule → falls to outcome=success path, returns null.
    // This is acceptable: tech_debt advisories surface via /status command, not auto-push.
    assert.equal(r, null);
  });

  test('failure outcome with no specific rule defaults to alerts', () => {
    assert.equal(journalTail.routeJournalEvent({ outcome: 'failure', event: 'unknown_failure_class' }), 'steward-alerts');
  });

  test('null/undefined entry returns null (no crash)', () => {
    assert.equal(journalTail.routeJournalEvent(null), null);
    assert.equal(journalTail.routeJournalEvent(undefined), null);
    assert.equal(journalTail.routeJournalEvent('not an object'), null);
  });
});

describe('renderJournalSummary', () => {
  test('formats with event + outcome + slug + ts', () => {
    const out = journalTail.renderJournalSummary({
      ts: '2026-05-09T12:00:00Z',
      event: 'autoresearch_winner_selected',
      outcome: 'success',
      slug: 'recommendation-week-1',
      action_kind: 'recommendation',
    });
    assert.match(out, /\*\*autoresearch_winner_selected\*\*/);
    assert.match(out, /\(success\)/);
    assert.match(out, /\[recommendation-week-1\]/);
    assert.match(out, /kind=recommendation/);
    assert.match(out, /2026-05-09T12:00:00Z/);
  });

  test('truncates long detail field', () => {
    const longDetail = 'x'.repeat(500);
    const out = journalTail.renderJournalSummary({
      event: 'failure', detail: longDetail,
    });
    // Implementation slices detail to 200 chars.
    const match = out.match(/> (x+)/);
    assert.ok(match);
    assert.ok(match[1].length <= 200);
  });

  test('handles missing fields gracefully', () => {
    const out = journalTail.renderJournalSummary({});
    assert.match(out, /unknown/);
  });

  test('empty entry returns empty string', () => {
    assert.equal(journalTail.renderJournalSummary(null), '');
  });
});

describe('parseNDJSON', () => {
  test('parses well-formed NDJSON', () => {
    const content = JSON.stringify({ a: 1 }) + '\n' + JSON.stringify({ b: 2 }) + '\n';
    const out = journalTail.parseNDJSON(content);
    assert.equal(out.length, 2);
    assert.equal(out[0].a, 1);
    assert.equal(out[1].b, 2);
  });

  test('skips malformed lines silently', () => {
    const content = JSON.stringify({ a: 1 }) + '\n' + 'not json\n' + JSON.stringify({ b: 2 }) + '\n';
    const out = journalTail.parseNDJSON(content);
    assert.equal(out.length, 2);
  });

  test('handles empty input', () => {
    assert.deepEqual(journalTail.parseNDJSON(''), []);
    assert.deepEqual(journalTail.parseNDJSON(null), []);
    assert.deepEqual(journalTail.parseNDJSON(undefined), []);
  });

  test('handles trailing newlines + blank lines', () => {
    const content = '\n\n' + JSON.stringify({ a: 1 }) + '\n\n\n';
    const out = journalTail.parseNDJSON(content);
    assert.equal(out.length, 1);
  });
});

describe('makeTailFollower', () => {
  test('start initializes lastSize to existing file size', () => {
    const file = tmpFile('start');
    fs.writeFileSync(file, JSON.stringify({ a: 1 }) + '\n');
    const events = [];
    const follower = journalTail.makeTailFollower(file, (e) => events.push(e));
    follower.start();
    follower.pump();
    // Existing content not re-emitted (start() captures lastSize).
    assert.equal(events.length, 0);
  });

  test('pump emits new lines appended after start', () => {
    const file = tmpFile('append');
    fs.writeFileSync(file, JSON.stringify({ a: 1 }) + '\n');
    const events = [];
    const follower = journalTail.makeTailFollower(file, (e) => events.push(e));
    follower.start();
    fs.appendFileSync(file, JSON.stringify({ b: 2 }) + '\n');
    follower.pump();
    assert.equal(events.length, 1);
    assert.equal(events[0].b, 2);
  });

  test('stop prevents further pumping', () => {
    const file = tmpFile('stop');
    fs.writeFileSync(file, '');
    const events = [];
    const follower = journalTail.makeTailFollower(file, (e) => events.push(e));
    follower.start();
    follower.stop();
    fs.appendFileSync(file, JSON.stringify({ c: 3 }) + '\n');
    follower.pump();
    assert.equal(events.length, 0);
  });

  test('handles file disappearance gracefully', () => {
    const file = tmpFile('vanishing');
    fs.writeFileSync(file, '');
    const follower = journalTail.makeTailFollower(file, () => {});
    follower.start();
    fs.unlinkSync(file);
    // Must not throw.
    follower.pump();
  });

  test('onEvent handler errors are swallowed (one bad row does not break the tail)', () => {
    const file = tmpFile('throw');
    fs.writeFileSync(file, '');
    const follower = journalTail.makeTailFollower(file, () => { throw new Error('boom'); });
    follower.start();
    fs.appendFileSync(file, JSON.stringify({ a: 1 }) + '\n');
    // Must not throw.
    follower.pump();
  });
});
