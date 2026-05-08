'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseRecommendations,
  parseFrontmatter,
  parseActionItems,
  extractCitations,
  pickNextAction,
} = require('../../../bin/steward/_lib/recommendations.cjs');

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-recs-'));
  const filePath = path.join(dir, 'recommendations.md');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

const MINIMAL_VALID = `---
slug: test-slug
phase: 5-synthesis
date: 2026-05-07
---

# Recommendations — test

## DO this week (cited)

### 1. First action
Description of the first action.
Multi-line content stays in the body.
[audit: §1] [src: https://example.com/1]

### 2. Second action
Short description.
[audit: §2]

## DO this sprint (cited)

### 3. Sprint-grade item
Bigger work.
[src: https://example.com/3]
`;

describe('recommendations: frontmatter parsing', () => {
  test('parses --- delimited YAML', () => {
    const { frontmatter, body } = parseFrontmatter(MINIMAL_VALID);
    assert.equal(frontmatter.slug, 'test-slug');
    assert.equal(frontmatter.phase, '5-synthesis');
    assert.match(body, /^\s*\n# Recommendations/);
  });

  test('throws on missing frontmatter', () => {
    assert.throws(
      () => parseFrontmatter('# No frontmatter here'),
      /missing YAML frontmatter/,
    );
  });

  test('handles quoted values', () => {
    const fm = parseFrontmatter(`---
slug: "quoted-slug"
date: '2026-05-07'
---

body`);
    assert.equal(fm.frontmatter.slug, 'quoted-slug');
    assert.equal(fm.frontmatter.date, '2026-05-07');
  });
});

describe('recommendations: action item extraction', () => {
  test('extracts numbered items from a section body', () => {
    const sectionBody = `
### 1. First
Body of first.
[audit: §1]

### 2. Second
Body of second.
[src: http://example.com]
`;
    const items = parseActionItems(sectionBody);
    assert.equal(items.length, 2);
    assert.equal(items[0].num, 1);
    assert.equal(items[0].title, 'First');
    assert.match(items[0].body, /Body of first/);
    assert.equal(items[0].citations.audit, '§1');
    assert.equal(items[1].citations.src, 'http://example.com');
  });

  test('citation extraction from item body', () => {
    const c = extractCitations('Some text [audit: §3] and [src: https://foo.bar/baz] more.');
    assert.equal(c.audit, '§3');
    assert.equal(c.src, 'https://foo.bar/baz');
  });

  test('item without citations returns empty citations object', () => {
    const items = parseActionItems('### 1. Bare title\nNo citations.');
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].citations, {});
  });
});

describe('recommendations: full parse', () => {
  test('parses minimal valid recommendations.md', () => {
    const filePath = tmpFile(MINIMAL_VALID);
    const parsed = parseRecommendations(filePath);

    assert.equal(parsed.frontmatter.slug, 'test-slug');
    assert.ok(parsed.sections['DO this week']);
    assert.equal(parsed.sections['DO this week'].length, 2);
    assert.equal(parsed.sections['DO this week'][0].num, 1);
    assert.equal(parsed.sections['DO this week'][1].num, 2);
    assert.ok(parsed.sections['DO this sprint']);
    assert.equal(parsed.sections['DO this sprint'].length, 1);
  });

  test('throws on missing slug', () => {
    const filePath = tmpFile(`---
phase: 5-synthesis
---

## DO this week (cited)

### 1. Hi
[audit: §1]
`);
    assert.throws(
      () => parseRecommendations(filePath),
      /missing required field: slug/,
    );
  });

  test('throws on missing DO this week section', () => {
    const filePath = tmpFile(`---
slug: x
---

## DO this sprint

### 1. Sprint
[audit: §1]
`);
    assert.throws(
      () => parseRecommendations(filePath),
      /missing required "## DO this week"/,
    );
  });

  test('throws on empty DO this week section', () => {
    const filePath = tmpFile(`---
slug: x
---

## DO this week

(no items)

## DO this sprint
### 1. Other
[audit: §1]
`);
    assert.throws(
      () => parseRecommendations(filePath),
      /≥1 action item/,
    );
  });
});

describe('recommendations: action picker', () => {
  test('picks first DO-this-week item when journal is empty', () => {
    const filePath = tmpFile(MINIMAL_VALID);
    const parsed = parseRecommendations(filePath);
    const picked = pickNextAction(parsed, []);
    assert.ok(picked);
    assert.equal(picked.num, 1);
    assert.equal(picked.actionKey, 'test-slug#week-1');
    assert.equal(picked.sectionTitle, 'DO this week');
  });

  test('skips already-processed items', () => {
    const filePath = tmpFile(MINIMAL_VALID);
    const parsed = parseRecommendations(filePath);
    const picked = pickNextAction(parsed, ['test-slug#week-1']);
    assert.ok(picked);
    assert.equal(picked.num, 2);
  });

  test('returns null when all items are processed', () => {
    const filePath = tmpFile(MINIMAL_VALID);
    const parsed = parseRecommendations(filePath);
    const picked = pickNextAction(parsed, ['test-slug#week-1', 'test-slug#week-2']);
    assert.equal(picked, null);
  });
});

describe('recommendations: integration with steward-dryrun fixture', () => {
  test('parses the real steward-dryrun fixture without error', () => {
    const fixturePath = path.resolve(
      __dirname, '..', '..', 'fixtures', 'steward-dryrun', 'cortex', 'recommendations.md'
    );
    const parsed = parseRecommendations(fixturePath);
    assert.equal(parsed.frontmatter.slug, 'steward-dryrun');
    assert.ok(parsed.sections['DO this week']);
    assert.ok(parsed.sections['DO this week'].length >= 1);
    // Every item should have citations (3-hop traceability)
    for (const item of parsed.sections['DO this week']) {
      assert.ok(
        item.citations.audit || item.citations.src,
        `Item ${item.num} "${item.title}" missing citations`,
      );
    }
  });
});
