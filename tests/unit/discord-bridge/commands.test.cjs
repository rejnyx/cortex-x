'use strict';

// Sprint 2.6 — Discord bridge commands.cjs tests.
// Pure logic; no discord.js runtime needed.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const commands = require('../../../bin/discord-bridge/commands.cjs');

const TEST_SECRET = 'a'.repeat(64);

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `disc-cmd-${prefix}-`));
}

describe('commands — registry shape', () => {
  test('COMMANDS map exposes 6 commands', () => {
    const names = Object.keys(commands.COMMANDS);
    assert.ok(names.includes('status'));
    assert.ok(names.includes('forecast'));
    assert.ok(names.includes('why'));
    assert.ok(names.includes('!halt'));
    assert.ok(names.includes('!resume'));
    assert.ok(names.includes('!recommend'));
    assert.equal(names.length, 6);
  });

  test('COMMAND_SPECS metadata aligns with registry', () => {
    assert.equal(commands.COMMAND_SPECS.length, 6);
    const specNames = commands.COMMAND_SPECS.map((s) => s.name);
    for (const name of Object.keys(commands.COMMANDS)) {
      assert.ok(specNames.includes(name), `spec entry missing for ${name}`);
    }
  });

  test('mutation commands all have name prefixed with !', () => {
    for (const spec of commands.COMMAND_SPECS) {
      if (spec.mutation) assert.ok(spec.name.startsWith('!'), `mutation spec ${spec.name} must use ! prefix`);
      else assert.ok(!spec.name.startsWith('!'), `read-only spec ${spec.name} must NOT use ! prefix`);
    }
  });
});

describe('commands.dispatch', () => {
  test('routes status to handler', () => {
    const reply = commands.dispatch('status', {}, {
      repoRoot: '/tmp/x',
      haltCheck: () => ({ halted: false }),
    });
    assert.ok(reply);
    assert.match(reply.content, /halted/);
    assert.equal(reply.ephemeral, true);
  });

  test('returns null for unknown command', () => {
    const reply = commands.dispatch('unknown_cmd', {}, {});
    assert.equal(reply, null);
  });
});

describe('commands.handleWhy', () => {
  test('rejects invalid SHA shape', () => {
    const reply = commands.handleWhy({ sha: 'not-hex!' }, {});
    assert.match(reply.content, /Invalid SHA/);
  });

  test('rejects empty SHA', () => {
    const reply = commands.handleWhy({ sha: '' }, {});
    assert.match(reply.content, /Invalid SHA/);
  });

  test('returns no-entry message when journal lookup misses', () => {
    const reply = commands.handleWhy({ sha: 'abc1234' }, { lookupJournalForCommit: () => null });
    assert.match(reply.content, /No journal entry/);
  });

  test('returns formatted entry on hit', () => {
    const reply = commands.handleWhy({ sha: 'abc1234' }, {
      lookupJournalForCommit: (sha) => ({ ts: '2026-05-09T00:00:00Z', event: 'recommendation_executed', sha }),
    });
    assert.match(reply.content, /abc1234/);
    assert.match(reply.content, /recommendation_executed/);
  });
});

describe('commands.handleHalt — two-step HMAC flow', () => {
  test('step 1: returns requiresHmac with action token', () => {
    const reply = commands.handleHalt({ reason: 'testing' }, { secret: TEST_SECRET });
    assert.equal(reply.requiresHmac, true);
    assert.ok(reply.actionId);
    assert.match(reply.content, /Confirm halt/);
    assert.match(reply.content, /[0-9a-f]{8}/);
  });

  test('step 1: rejects empty reason', () => {
    const reply = commands.handleHalt({ reason: '' }, { secret: TEST_SECRET });
    assert.match(reply.content, /reason required/);
  });

  test('step 2: writes halt file when _confirmed', () => {
    const repoRoot = tmpRepo('halt-confirmed');
    let written = null;
    const ctx = {
      repoRoot,
      writeHalt: (reason) => { written = reason; },
    };
    const reply = commands.handleHalt({ reason: 'ops issue', _confirmed: true }, ctx);
    assert.match(reply.content, /Halt written/);
    assert.equal(written, 'ops issue');
  });

  test('step 2: surfaces missing primitive', () => {
    const reply = commands.handleHalt({ reason: 'x', _confirmed: true }, {});
    assert.match(reply.content, /writeHalt primitive not available/);
  });
});

describe('commands.handleResume', () => {
  test('step 1: returns requiresHmac', () => {
    const reply = commands.handleResume({}, { secret: TEST_SECRET });
    assert.equal(reply.requiresHmac, true);
    assert.match(reply.content, /Confirm resume/);
  });

  test('step 2: clears halt when _confirmed', () => {
    let cleared = false;
    const reply = commands.handleResume({ _confirmed: true }, {
      clearHalt: () => { cleared = true; },
    });
    assert.match(reply.content, /Halt cleared/);
    assert.equal(cleared, true);
  });
});

describe('commands.handleRecommend', () => {
  test('rejects empty text', () => {
    const reply = commands.handleRecommend({ text: '' }, { secret: TEST_SECRET });
    assert.match(reply.content, /text required/);
  });

  test('step 1: returns requiresHmac for non-empty text', () => {
    const reply = commands.handleRecommend({ text: 'add Sprint 3.5 idea' }, { secret: TEST_SECRET });
    assert.equal(reply.requiresHmac, true);
    assert.match(reply.content, /Confirm recommendation/);
    assert.match(reply.content, /add Sprint 3\.5 idea/);
  });

  test('step 1: truncates very long text in confirmation message', () => {
    const longText = 'x'.repeat(5000);
    const reply = commands.handleRecommend({ text: longText }, { secret: TEST_SECRET });
    // Reply preview cap is 200 chars per implementation.
    const previewMatch = reply.content.match(/> (x+)/);
    assert.ok(previewMatch);
    assert.ok(previewMatch[1].length <= 200);
  });

  test('step 2: appends to recommendations.md when _confirmed', () => {
    const repoRoot = tmpRepo('rec-confirmed');
    fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'cortex/recommendations.md'), '# existing\n');
    let appended = null;
    const reply = commands.handleRecommend({ text: 'new rec', _confirmed: true }, {
      appendRecommendation: (t) => { appended = t; },
    });
    assert.match(reply.content, /Recommendation appended/);
    assert.equal(appended, 'new rec');
  });
});

describe('commands.defaultCtx primitives', () => {
  test('appendRecommendation writes block to recommendations.md', () => {
    const repoRoot = tmpRepo('default-ctx');
    fs.mkdirSync(path.join(repoRoot, 'cortex'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'cortex/recommendations.md'), '# header\n');
    const ctx = commands.defaultCtx({ repoRoot });
    ctx.appendRecommendation('first thought');
    const content = fs.readFileSync(path.join(repoRoot, 'cortex/recommendations.md'), 'utf8');
    assert.match(content, /# header/);
    assert.match(content, /first thought/);
    assert.match(content, /via Discord bridge/);
  });

  test('lastJournalEntry returns null when no journal dir', () => {
    const repoRoot = tmpRepo('no-journal');
    const ctx = commands.defaultCtx({ repoRoot });
    assert.equal(ctx.lastJournalEntry(), null);
  });

  test('lastJournalEntry returns last NDJSON line on hit', () => {
    const repoRoot = tmpRepo('journal-tail');
    const journalDir = path.join(repoRoot, 'cortex/journal');
    fs.mkdirSync(journalDir, { recursive: true });
    fs.writeFileSync(path.join(journalDir, '2026-05-09.jsonl'),
      JSON.stringify({ ts: '2026-05-09T00:00:00Z', event: 'first' }) + '\n' +
      JSON.stringify({ ts: '2026-05-09T01:00:00Z', event: 'last' }) + '\n');
    const ctx = commands.defaultCtx({ repoRoot });
    const entry = ctx.lastJournalEntry();
    assert.ok(entry);
    assert.equal(entry.event, 'last');
  });
});
