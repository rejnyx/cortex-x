// recommendations.cjs — parser for cortex/recommendations.md.
//
// Reads the project's "DO this week / DO this sprint" sections and returns a
// structured action-item list. Hermes uses this to pick its next action
// (Phase 1 of the runHermesIteration() flow in docs/hermes-runtime.md).
//
// Parsable shape:
//
//   ---
//   phase: 5-synthesis
//   date: 2026-05-07
//   slug: <project-slug>
//   ---
//
//   # Recommendations — <project name>
//
//   ## DO this week (cited)
//
//   ### 1. Action title
//   Action description (multi-line allowed).
//   [audit: §X] [src: <url-or-fixture-only>]
//
//   ### 2. Next action
//   ...
//
//   ## DO this sprint (cited)
//   ### N. Sprint-grade action
//   ...
//
// Each action item must carry [audit:] or [src:] citation markers — the same
// 3-hop traceability convention enforced by tools/verify-audit-output.cjs.
//
// Contract:
//   - Pure function, no side effects
//   - Returns { frontmatter: {...}, sections: { 'DO this week': [items], ... } }
//   - Each item: { num, title, body, citations: { audit?, src? }, raw }
//   - Throws on malformed frontmatter or missing required sections; never
//     silently returns empty arrays.

'use strict';

const fs = require('node:fs');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) {
    const e = new Error('recommendations.md missing YAML frontmatter (--- block)');
    e.field = 'frontmatter';
    throw e;
  }

  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter: fm, body: content.slice(m[0].length) };
}

function extractCitations(body) {
  const citations = {};
  const auditMatch = body.match(/\[audit:\s*([^\]]+?)\]/);
  if (auditMatch) citations.audit = auditMatch[1].trim();
  const srcMatch = body.match(/\[src:\s*([^\]]+?)\]/);
  if (srcMatch) citations.src = srcMatch[1].trim();
  return citations;
}

function parseActionItems(sectionBody) {
  // Split on lines starting with `### N.` (action item delimiter).
  // Keep item heading + body together until next `### N.` or end.
  const items = [];
  const lines = sectionBody.split('\n');
  let current = null;

  for (const line of lines) {
    const head = line.match(/^### (\d+)\.\s+(.+)$/);
    if (head) {
      if (current) items.push(current);
      current = {
        num: parseInt(head[1], 10),
        title: head[2].trim(),
        body: '',
        citations: {},
        raw: line + '\n',
      };
      continue;
    }
    if (line.startsWith('## ')) break; // next H2 ends the section
    if (current) {
      current.body += line + '\n';
      current.raw += line + '\n';
    }
  }
  if (current) items.push(current);

  // Extract citations + trim body
  for (const item of items) {
    item.citations = extractCitations(item.body);
    item.body = item.body
      .replace(/\[(audit|src):[^\]]*\]/g, '')
      .trim();
  }

  return items;
}

function parseRecommendations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);

  if (!frontmatter.slug) {
    const e = new Error('recommendations.md frontmatter missing required field: slug');
    e.field = 'frontmatter.slug';
    throw e;
  }

  // Find each "## DO ..." section
  const sections = {};
  const sectionRegex = /^## (DO this [a-z]+(?:\s*\(cited\))?)\s*$/gm;
  const matches = [...body.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const sectionTitle = m[1].replace(/\s*\(cited\)$/, '').trim();
    const startIdx = m.index + m[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const sectionBody = body.slice(startIdx, endIdx);
    sections[sectionTitle] = parseActionItems(sectionBody);
  }

  if (!sections['DO this week'] || sections['DO this week'].length === 0) {
    const e = new Error('recommendations.md missing required "## DO this week" section with ≥1 action item');
    e.field = 'sections';
    throw e;
  }

  return { frontmatter, sections };
}

// Action selection: return first item from DO-this-week not yet present in
// the journal as a completed action_id. Hermes feeds in the journal entries
// it has already processed.
function pickNextAction(parsed, processedActionIds) {
  const doThisWeek = parsed.sections['DO this week'] || [];
  const processed = new Set(processedActionIds || []);

  for (const item of doThisWeek) {
    const actionKey = `${parsed.frontmatter.slug}#week-${item.num}`;
    if (!processed.has(actionKey)) {
      return { ...item, actionKey, sectionTitle: 'DO this week' };
    }
  }
  return null;
}

module.exports = {
  parseRecommendations,
  parseFrontmatter,
  parseActionItems,
  extractCitations,
  pickNextAction,
};
