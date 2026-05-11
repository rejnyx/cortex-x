// project-ledger.cjs — Sprint 2.2 (Ralph-inspired): append-only success-side
// activity log for projects/<slug>.md.
//
// Companion to lessons.cjs (failure-side ReasoningBank-lite). Where lessons
// captures "what failed and why" for next-run recall, project-ledger captures
// "what shipped and where" for human-readable institutional wisdom — the
// success-side analog of Ralph's progress.txt.
//
// Storage:
//   <repoRoot>/projects/<slug>.md  (in-repo, committed alongside Steward PRs)
//
//   The file is the per-project entry in cortex-x's projects library
//   (curated `## Wikipedia` of the operator's projects). The ledger appends a new
//   line under a `## Steward activity log` section, creating the section
//   if missing. The rest of the file (overview, stack, MVP, success signal)
//   is human-curated and never touched.
//
// Each ledger entry (one markdown line):
//   - YYYY-MM-DD HH:MM — <action_kind>: <one-line summary> (PR #N)
//
// Design constraints:
//   - Append-only — never rewrite, never delete entries
//   - Idempotent — re-appending the same action_id is a no-op
//   - Section-aware — finds existing `## Steward activity log` section or
//     creates one at the end of the file
//   - Fail-open — every error swallowed at caller boundary; ledger writes
//     must never block Steward's success path. Returns { ok, reason? }.
//   - Bounded — caps section growth at 100 entries; oldest entries pruned
//     into a `## Steward activity log archive` section to keep the live
//     section readable.
//   - Resilient to missing project file — if projects/<slug>.md doesn't
//     exist yet, returns { ok: false, reason: 'project_file_missing' }
//     instead of creating a stub. Project file creation is a manual
//     curation step (project-scan.md prompt), not a Steward concern.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SECTION_HEADING = '## Steward activity log';
const ARCHIVE_HEADING = '## Steward activity log archive';
const MAX_LIVE_ENTRIES = 100;

function projectsDir(repoRoot) {
  return path.join(repoRoot, 'projects');
}

function projectFilePath(repoRoot, slug) {
  return path.join(projectsDir(repoRoot), `${slug}.md`);
}

function formatTimestamp(iso) {
  // YYYY-MM-DD HH:MM (UTC)
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16).replace('T', ' ');
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function shortSummary(s, max = 120) {
  if (typeof s !== 'string') return '';
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + '…';
}

function formatEntry(entry) {
  const ts = formatTimestamp(entry.ts);
  const kind = entry.action_kind || 'recommendation';
  const summary = shortSummary(entry.summary || entry.action_key || 'action_completed');
  const prRef = entry.pr_url
    ? ` ([PR](${entry.pr_url}))`
    : entry.pr_number
      ? ` (PR #${entry.pr_number})`
      : '';
  const idTag = entry.action_id ? ` <!--id:${entry.action_id}-->` : '';
  return `- ${ts} — ${kind}: ${summary}${prRef}${idTag}`;
}

// Detect duplicate by action_id comment marker. If the marker appears anywhere
// in the file (live section or archive), we consider this entry already
// recorded.
function isAlreadyRecorded(content, actionId) {
  if (!actionId) return false;
  return content.includes(`<!--id:${actionId}-->`);
}

// Locate the live `## Steward activity log` section in the file.
// Returns { startIdx, endIdx, headingIdx } where startIdx is the first
// content line after the heading, endIdx is the next H2 (or EOF), and
// headingIdx is the position of the heading line itself.
// Returns null if the section is not present.
function findSection(content, heading) {
  const lines = content.split('\n');
  let headingLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === heading) {
      headingLine = i;
      break;
    }
  }
  if (headingLine === -1) return null;
  let endLine = lines.length;
  for (let i = headingLine + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) {
      endLine = i;
      break;
    }
  }
  return { headingLine, endLine, lines };
}

function listEntries(sectionLines) {
  return sectionLines.filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l));
}

// Append an entry to projects/<slug>.md `## Steward activity log` section.
// Creates the section (at EOF) if it doesn't exist. Idempotent on action_id.
//
// opts:
//   repoRoot — required; path to the cortex-x repo root (where projects/ lives)
//   slug     — required; project slug (matches recommendations.md frontmatter.slug)
//   entry    — { ts, action_kind, action_key, action_id, summary, pr_url, pr_number }
//
// Returns:
//   { ok: true, recorded: true,  filePath }   — newly recorded
//   { ok: true, recorded: false, reason: 'duplicate', filePath }  — action_id seen
//   { ok: false, reason: 'project_file_missing', filePath }       — no projects/<slug>.md
//   { ok: false, reason: 'invalid_input', message: '...' }        — bad args
//
// Never throws. Caller wraps in additional try/catch for defense-in-depth.
function appendLedgerEntry({ repoRoot, slug, entry } = {}) {
  if (!repoRoot || typeof repoRoot !== 'string') {
    return { ok: false, reason: 'invalid_input', message: 'repoRoot required' };
  }
  if (!slug || typeof slug !== 'string') {
    return { ok: false, reason: 'invalid_input', message: 'slug required' };
  }
  if (!entry || typeof entry !== 'object') {
    return { ok: false, reason: 'invalid_input', message: 'entry object required' };
  }

  const filePath = projectFilePath(repoRoot, slug);

  let content;
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, reason: 'project_file_missing', filePath };
    }
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'read_failed', message: err.message, filePath };
  }

  if (isAlreadyRecorded(content, entry.action_id)) {
    return { ok: true, recorded: false, reason: 'duplicate', filePath };
  }

  const newLine = formatEntry(entry);
  let updated;

  const section = findSection(content, SECTION_HEADING);
  if (!section) {
    // Section missing — append heading + blank line + entry at EOF.
    const trailing = content.endsWith('\n') ? '' : '\n';
    updated = `${content}${trailing}\n${SECTION_HEADING}\n\n${newLine}\n`;
  } else {
    // Section present — insert new entry as the FIRST entry under heading
    // (newest-first ordering). Find the position right after the heading
    // line and any contiguous blank lines.
    const { lines, headingLine, endLine } = section;
    let insertAt = headingLine + 1;
    while (insertAt < endLine && lines[insertAt].trim() === '') insertAt += 1;

    const before = lines.slice(0, insertAt);
    const sectionBody = lines.slice(insertAt, endLine);
    const after = lines.slice(endLine);

    // Pre-prune: if live section already has MAX_LIVE_ENTRIES, move oldest
    // overflow into archive section before adding the new line.
    const existingEntries = listEntries(sectionBody);
    let prunedSectionBody = sectionBody;
    let archiveOverflow = [];
    if (existingEntries.length >= MAX_LIVE_ENTRIES) {
      // Keep newest (MAX_LIVE_ENTRIES - 1), so adding the new one totals MAX.
      const keepCount = Math.max(0, MAX_LIVE_ENTRIES - 1);
      const allEntries = existingEntries; // already in newest-first order by convention
      const keepEntries = allEntries.slice(0, keepCount);
      archiveOverflow = allEntries.slice(keepCount);
      // Rebuild sectionBody with only kept entries + preserve any non-entry
      // lines (blank lines, etc.) at the end.
      prunedSectionBody = [...keepEntries];
      // Trailing blank line for readability.
      if (prunedSectionBody.length > 0 && prunedSectionBody[prunedSectionBody.length - 1] !== '') {
        prunedSectionBody.push('');
      }
    }

    const rebuiltLines = [
      ...before,
      newLine,
      // Blank line separating new entry from existing entries (only if there are existing entries).
      ...(prunedSectionBody.length > 0 ? [''] : []),
      ...prunedSectionBody,
      ...after,
    ];

    let candidate = rebuiltLines.join('\n');

    if (archiveOverflow.length > 0) {
      candidate = appendToArchive(candidate, archiveOverflow);
    }

    updated = candidate;
  }

  try {
    fs.writeFileSync(filePath, updated, 'utf8');
  } catch (err) {
    return { ok: false, reason: 'write_failed', message: err.message, filePath };
  }

  return { ok: true, recorded: true, filePath };
}

// Append overflow entries to the `## Steward activity log archive` section.
// Creates the archive section at EOF if missing. Archive is unbounded
// (older entries accumulate; manual prune via cortex-doctor recommended
// once archive exceeds 1000 entries).
function appendToArchive(content, overflowEntries) {
  if (!Array.isArray(overflowEntries) || overflowEntries.length === 0) return content;
  const archive = findSection(content, ARCHIVE_HEADING);
  if (!archive) {
    const trailing = content.endsWith('\n') ? '' : '\n';
    return `${content}${trailing}\n${ARCHIVE_HEADING}\n\n${overflowEntries.join('\n')}\n`;
  }
  const { lines, headingLine, endLine } = archive;
  let insertAt = headingLine + 1;
  while (insertAt < endLine && lines[insertAt].trim() === '') insertAt += 1;
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, ...overflowEntries, '', ...after].join('\n');
}

module.exports = {
  appendLedgerEntry,
  formatEntry,
  formatTimestamp,
  shortSummary,
  isAlreadyRecorded,
  findSection,
  projectFilePath,
  projectsDir,
  SECTION_HEADING,
  ARCHIVE_HEADING,
  MAX_LIVE_ENTRIES,
};
