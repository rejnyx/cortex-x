'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendJournal,
  readJournal,
  validateEntry,
  redactPII,
  journalPath,
  todayISODate,
} = require('../../../bin/hermes/_lib/journal.cjs');

function tmpDataHome(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hermes-journal-${prefix}-`));
}

function withDataHome(dataHome, fn) {
  const prev = process.env.CORTEX_DATA_HOME;
  process.env.CORTEX_DATA_HOME = dataHome;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CORTEX_DATA_HOME;
    else process.env.CORTEX_DATA_HOME = prev;
  }
}

function validEntry(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    trigger: 'cron',
    tier: 'T0',
    event: 'test_event',
    ...overrides,
  };
}

describe('journal: schema validation', () => {
  test('valid entry passes', () => {
    assert.doesNotThrow(() => validateEntry(validEntry()));
  });

  test('non-object throws', () => {
    assert.throws(() => validateEntry('hi'), /must be an object/);
    assert.throws(() => validateEntry(null), /must be an object/);
  });

  test('missing ts throws', () => {
    assert.throws(() => validateEntry(validEntry({ ts: undefined })), /ts must be ISO-8601/);
  });

  test('invalid trigger throws', () => {
    assert.throws(() => validateEntry(validEntry({ trigger: 'cosmic-ray' })), /trigger must be one of/);
  });

  test('invalid tier throws', () => {
    assert.throws(() => validateEntry(validEntry({ tier: 'T9' })), /tier must be one of/);
  });

  test('empty event throws', () => {
    assert.throws(() => validateEntry(validEntry({ event: '' })), /event must be non-empty/);
  });

  test('negative cost_usd throws', () => {
    assert.throws(() => validateEntry(validEntry({ cost_usd: -1 })), /cost_usd must be non-negative/);
  });

  test('non-integer tokens throws', () => {
    assert.throws(() => validateEntry(validEntry({ tokens_in: 1.5 })), /tokens_in must be non-negative integer/);
  });

  test('invalid actor throws', () => {
    assert.throws(() => validateEntry(validEntry({ actor: 'human' })), /actor must be one of/);
  });
});

describe('journal: PII redaction', () => {
  test('home directory paths redacted to <HOME>', () => {
    const homedir = os.homedir();
    const out = redactPII({ event: `something at ${homedir}/foo/bar` });
    assert.match(out.event, /<HOME>\/foo\/bar/);
    assert.equal(out.event.includes(homedir), false);
  });

  test('OpenAI sk- credentials redacted', () => {
    const out = redactPII({ event: 'using key sk-AAAAAAAAAAAAAAAAAAAA1234' });
    assert.match(out.event, /sk-<REDACTED>/);
    assert.equal(out.event.includes('AAAAAAAAAAAAAAAAAAAA1234'), false);
  });

  test('OpenRouter sk-or-v1- credentials redacted (caught by sk- regex)', () => {
    const out = redactPII({ event: 'OPENROUTER_API_KEY=sk-or-v1-1234567890abcdef1234567890abcdef' });
    assert.match(out.event, /sk-<REDACTED>/);
    assert.equal(out.event.includes('1234567890abcdef'), false);
  });

  test('GitHub PAT ghp_ redacted', () => {
    const out = redactPII({ event: 'token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.match(out.event, /ghp_<REDACTED>/);
  });

  test('Bearer tokens redacted', () => {
    const out = redactPII({ event: 'auth Bearer AAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.match(out.event, /Bearer <REDACTED>/);
  });

  test('non-string values pass through unchanged', () => {
    const out = redactPII({ ts: 'x', cost_usd: 0.5, tokens_in: 100 });
    assert.equal(out.cost_usd, 0.5);
    assert.equal(out.tokens_in, 100);
  });
});

describe('journal: append + read', () => {
  test('appendJournal writes one JSON line per call', () => {
    const dataHome = tmpDataHome('append');
    withDataHome(dataHome, () => {
      const slug = 'test-slug';
      appendJournal(slug, validEntry({ event: 'one' }));
      appendJournal(slug, validEntry({ event: 'two' }));
      appendJournal(slug, validEntry({ event: 'three' }));

      const entries = readJournal(slug);
      assert.equal(entries.length, 3);
      assert.deepEqual(entries.map(e => e.event), ['one', 'two', 'three']);
    });
  });

  test('appendJournal creates dir if missing', () => {
    const dataHome = tmpDataHome('mkdir');
    withDataHome(dataHome, () => {
      const slug = 'nested-slug';
      const result = appendJournal(slug, validEntry());
      assert.ok(fs.existsSync(result.filePath));
    });
  });

  test('readJournal returns [] for missing file', () => {
    const dataHome = tmpDataHome('empty');
    withDataHome(dataHome, () => {
      const entries = readJournal('never-written');
      assert.deepEqual(entries, []);
    });
  });

  test('readJournal surfaces corrupted lines without throwing', () => {
    const dataHome = tmpDataHome('corrupt');
    withDataHome(dataHome, () => {
      const slug = 'corrupt-slug';
      appendJournal(slug, validEntry({ event: 'good' }));
      // Manually append a bad line
      fs.appendFileSync(journalPath(slug), 'this is not json\n');
      appendJournal(slug, validEntry({ event: 'good-again' }));

      const entries = readJournal(slug);
      assert.equal(entries.length, 3);
      assert.equal(entries[0].event, 'good');
      assert.equal(entries[1]._corrupted, true);
      assert.equal(entries[2].event, 'good-again');
    });
  });
});

describe('journal: append-only contract', () => {
  test('cost_usd + tokens preserved across roundtrip', () => {
    const dataHome = tmpDataHome('cost');
    withDataHome(dataHome, () => {
      const slug = 'cost-slug';
      appendJournal(slug, validEntry({
        event: 'metered',
        cost_usd: 0.42,
        tokens_in: 1500,
        tokens_out: 800,
      }));
      const entries = readJournal(slug);
      assert.equal(entries[0].cost_usd, 0.42);
      assert.equal(entries[0].tokens_in, 1500);
      assert.equal(entries[0].tokens_out, 800);
    });
  });

  test('PII redaction applied at write time, not read time', () => {
    const dataHome = tmpDataHome('redact');
    withDataHome(dataHome, () => {
      const slug = 'redact-slug';
      const homedir = os.homedir();
      appendJournal(slug, validEntry({ event: `path ${homedir}/secret` }));
      const entries = readJournal(slug);
      assert.equal(entries[0].event.includes(homedir), false);
      assert.match(entries[0].event, /<HOME>\/secret/);
    });
  });
});

describe('journal: contract surfaces', () => {
  test('todayISODate is YYYY-MM-DD', () => {
    assert.match(todayISODate(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
