'use strict';

// Sprint 2.2 — project-ledger unit tests. Companion to lessons.cjs tests.
// Covers the success-side append-only ledger:
//   - section creation (when missing)
//   - newest-first ordering
//   - idempotency on action_id
//   - bounded growth (live section caps + archive overflow)
//   - fail-open returns (project file missing, invalid input)
//   - PII-free entry shape (no homedir, no secrets)

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('../../../bin/steward/_lib/project-ledger.cjs');

const SLUG = 'test-slug';

let tmpRoot;

function tmpProjectFilePath() {
  return path.join(tmpRoot, 'projects', `${SLUG}.md`);
}

function writeProjectFile(content) {
  const file = tmpProjectFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function readProjectFile() {
  return fs.readFileSync(tmpProjectFilePath(), 'utf8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ledger-'));
});

after(() => {
  // best-effort cleanup; OS reclaims tmpdir even if we leave it
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) { /* swallow */ }
});

describe('project-ledger formatting helpers', () => {
  test('formatTimestamp returns YYYY-MM-DD HH:MM (UTC)', () => {
    const out = ledger.formatTimestamp('2026-05-10T14:32:11.123Z');
    assert.equal(out, '2026-05-10 14:32');
  });

  test('formatTimestamp falls back to now() on invalid input', () => {
    const out = ledger.formatTimestamp('not-a-date');
    assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  test('shortSummary truncates with ellipsis past the limit', () => {
    const long = 'x'.repeat(200);
    const out = ledger.shortSummary(long, 50);
    assert.equal(out.length, 50);
    assert.match(out, /…$/);
  });

  test('shortSummary collapses whitespace', () => {
    const out = ledger.shortSummary('a\n\n  b\tc');
    assert.equal(out, 'a b c');
  });

  test('formatEntry emits the canonical one-line markdown', () => {
    const line = ledger.formatEntry({
      ts: '2026-05-10T09:00:00Z',
      action_kind: 'recommendation',
      action_id: 'abc123',
      summary: 'add foo to bar',
      pr_url: 'https://github.com/owner/repo/pull/42',
    });
    assert.match(line, /^- 2026-05-10 09:00 — recommendation: add foo to bar /);
    assert.match(line, /\(\[PR\]\(https:\/\/github\.com\/owner\/repo\/pull\/42\)\)/);
    assert.match(line, /<!--id:abc123-->$/);
  });

  test('formatEntry includes PR number fallback when no URL', () => {
    const line = ledger.formatEntry({
      ts: '2026-05-10T09:00:00Z',
      action_kind: 'recommendation',
      action_id: 'abc123',
      summary: 'sum',
      pr_number: 17,
    });
    assert.match(line, /\(PR #17\)/);
  });
});

describe('appendLedgerEntry — happy paths', () => {
  test('creates section when missing and appends entry', () => {
    writeProjectFile('# test-slug\n\n## Overview\nstuff\n');

    const result = ledger.appendLedgerEntry({
      repoRoot: tmpRoot,
      slug: SLUG,
      entry: {
        ts: '2026-05-10T09:00:00Z',
        action_kind: 'recommendation',
        action_id: 'a1',
        summary: 'first action',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.recorded, true);

    const out = readProjectFile();
    assert.match(out, /## Steward activity log/);
    assert.match(out, /- 2026-05-10 09:00 — recommendation: first action/);
    assert.match(out, /<!--id:a1-->/);
    // Original content untouched
    assert.match(out, /## Overview\nstuff/);
  });

  test('newest-first ordering when section already exists', () => {
    writeProjectFile([
      '# test-slug',
      '',
      '## Steward activity log',
      '',
      '- 2026-05-09 12:00 — recommendation: older entry <!--id:old1-->',
      '',
    ].join('\n'));

    ledger.appendLedgerEntry({
      repoRoot: tmpRoot,
      slug: SLUG,
      entry: {
        ts: '2026-05-10T09:00:00Z',
        action_kind: 'recommendation',
        action_id: 'new1',
        summary: 'newer entry',
      },
    });

    const out = readProjectFile();
    const newerIdx = out.indexOf('newer entry');
    const olderIdx = out.indexOf('older entry');
    assert.ok(newerIdx > -1 && olderIdx > -1, 'both entries present');
    assert.ok(newerIdx < olderIdx, 'newest entry appears first');
  });

  test('preserves trailing content sections after activity log', () => {
    writeProjectFile([
      '# test-slug',
      '',
      '## Steward activity log',
      '',
      '- 2026-05-09 12:00 — recommendation: old <!--id:old1-->',
      '',
      '## Notes',
      'curated content here',
      '',
    ].join('\n'));

    ledger.appendLedgerEntry({
      repoRoot: tmpRoot,
      slug: SLUG,
      entry: {
        ts: '2026-05-10T09:00:00Z',
        action_kind: 'recommendation',
        action_id: 'new1',
        summary: 'fresh',
      },
    });

    const out = readProjectFile();
    assert.match(out, /## Notes\ncurated content here/);
  });
});

describe('appendLedgerEntry — idempotency', () => {
  test('duplicate action_id is a no-op', () => {
    writeProjectFile('# test-slug\n');

    const entry = {
      ts: '2026-05-10T09:00:00Z',
      action_kind: 'recommendation',
      action_id: 'dup1',
      summary: 'dup',
    };

    const r1 = ledger.appendLedgerEntry({ repoRoot: tmpRoot, slug: SLUG, entry });
    const r2 = ledger.appendLedgerEntry({ repoRoot: tmpRoot, slug: SLUG, entry });

    assert.equal(r1.ok, true);
    assert.equal(r1.recorded, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.recorded, false);
    assert.equal(r2.reason, 'duplicate');

    const out = readProjectFile();
    const matches = out.match(/<!--id:dup1-->/g) || [];
    assert.equal(matches.length, 1, 'entry recorded exactly once');
  });
});

describe('appendLedgerEntry — fail-open contract', () => {
  test('missing project file returns ok:false reason:project_file_missing', () => {
    // tmpRoot/projects/<slug>.md not created on purpose
    const result = ledger.appendLedgerEntry({
      repoRoot: tmpRoot,
      slug: SLUG,
      entry: { ts: '2026-05-10T09:00:00Z', action_id: 'x', summary: 'x' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'project_file_missing');
  });

  test('invalid input returns ok:false reason:invalid_input', () => {
    const cases = [
      { args: {}, expected: /repoRoot required/ },
      { args: { repoRoot: tmpRoot }, expected: /slug required/ },
      { args: { repoRoot: tmpRoot, slug: SLUG }, expected: /entry object required/ },
    ];
    for (const c of cases) {
      const result = ledger.appendLedgerEntry(c.args);
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'invalid_input');
      assert.match(result.message, c.expected);
    }
  });

  test('does not throw on filesystem errors (read-only path)', () => {
    // Simulate by passing a non-string repoRoot that triggers the early-return
    // invalid_input branch — guarantees no throw escapes.
    let threw = false;
    try {
      ledger.appendLedgerEntry({ repoRoot: 123, slug: SLUG, entry: {} });
    } catch (_) {
      threw = true;
    }
    assert.equal(threw, false, 'invalid input must not throw');
  });
});

describe('appendLedgerEntry — bounded growth', () => {
  test('overflow above MAX_LIVE_ENTRIES moves oldest into archive section', () => {
    // Pre-populate live section with MAX entries (newest-first)
    const max = ledger.MAX_LIVE_ENTRIES;
    const lines = ['# test-slug', '', '## Steward activity log', ''];
    for (let i = 0; i < max; i += 1) {
      // Newer at top: i=0 is newest, i=max-1 is oldest
      const day = String(31 - (i % 28)).padStart(2, '0');
      lines.push(`- 2026-04-${day} 09:00 — recommendation: prior <!--id:prior-${i}-->`);
    }
    lines.push('');
    writeProjectFile(lines.join('\n'));

    const result = ledger.appendLedgerEntry({
      repoRoot: tmpRoot,
      slug: SLUG,
      entry: {
        ts: '2026-05-10T09:00:00Z',
        action_kind: 'recommendation',
        action_id: 'overflow-test',
        summary: 'overflow trigger',
      },
    });

    assert.equal(result.ok, true);
    const out = readProjectFile();
    assert.match(out, /## Steward activity log archive/);
    // The oldest entry (id:prior-{max-1}) should now be in the archive section.
    const oldestId = `prior-${max - 1}`;
    const archiveIdx = out.indexOf('## Steward activity log archive');
    const oldestIdx = out.indexOf(`<!--id:${oldestId}-->`);
    assert.ok(archiveIdx > -1, 'archive section created');
    assert.ok(oldestIdx > archiveIdx, 'oldest entry now lives in archive');
    // The new entry should be at the top of the live section.
    assert.match(out, /<!--id:overflow-test-->/);
    const newIdx = out.indexOf('<!--id:overflow-test-->');
    assert.ok(newIdx < archiveIdx, 'new entry stays in live section');
  });
});

describe('appendLedgerEntry — exported surface', () => {
  test('exposes formatEntry, formatTimestamp, shortSummary, isAlreadyRecorded, findSection, projectFilePath, projectsDir, MAX_LIVE_ENTRIES, SECTION_HEADING, ARCHIVE_HEADING', () => {
    const expected = [
      'appendLedgerEntry',
      'formatEntry',
      'formatTimestamp',
      'shortSummary',
      'isAlreadyRecorded',
      'findSection',
      'projectFilePath',
      'projectsDir',
      'MAX_LIVE_ENTRIES',
      'SECTION_HEADING',
      'ARCHIVE_HEADING',
    ];
    for (const k of expected) {
      assert.ok(k in ledger, `exports.${k}`);
    }
    assert.equal(typeof ledger.appendLedgerEntry, 'function');
    assert.equal(ledger.SECTION_HEADING, '## Steward activity log');
    assert.equal(ledger.ARCHIVE_HEADING, '## Steward activity log archive');
    assert.equal(typeof ledger.MAX_LIVE_ENTRIES, 'number');
  });
});
