#!/usr/bin/env node
// todo-triage.cjs — Sprint 1.8.7 TODO/FIXME → GitHub issue triage detector.
//
// Scans source code for TODO/FIXME/XXX/HACK markers, filters by git-blame
// age (older than threshold = stable enough to ticket), dedupes against
// open issues, returns the candidates that warrant a fresh gh issue.
//
// Used by Hermes when action_kind === 'todo_triage'. Deterministic — no LLM.
// Each candidate produces ONE gh issue with body assembled from the source
// line + surrounding context + git blame author/date. No code edits.
//
// CLI:
//   node detectors/todo-triage.cjs              # human report
//   node detectors/todo-triage.cjs --json       # machine output
//   node detectors/todo-triage.cjs --max=5      # cap candidates
//   node detectors/todo-triage.cjs --age=30     # min age in days (default 30)

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIGNAL_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_MIN_AGE_DAYS = 30;
const TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b[:\s]*([^\n]*)/g;
const SCAN_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.go', '.rs', '.py', '.rb', '.java', '.kt', '.swift', '.cs', '.cpp', '.c', '.h', '.hpp']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cortex', 'target', '__pycache__']);

function safeExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || SIGNAL_TIMEOUT_MS,
      cwd: opts.cwd || process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function gitAvailable(cwd) {
  return !!safeExec('git rev-parse --is-inside-work-tree', { cwd });
}

function ghAvailable() {
  return !!safeExec('gh --version', { timeout: 1000 });
}

function ghAuthed() {
  if (!ghAvailable()) return false;
  return !!safeExec('gh auth status', { timeout: 2000 });
}

// Walk a directory tree synchronously, yielding file paths matching SCAN_EXTENSIONS.
function* walkSourceFiles(root, options = {}) {
  const skip = options.skipDirs || SKIP_DIRS;
  const exts = options.extensions || SCAN_EXTENSIONS;
  const maxFiles = options.maxFiles || 5000; // hard cap to avoid runaway scans
  let count = 0;
  function* walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        yield* walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (exts.has(ext)) {
          count += 1;
          yield full;
        }
      }
    }
  }
  yield* walk(root);
}

// Find TODO markers in a single file. Returns [{ marker, text, lineNumber }].
function scanFileForMarkers(filePath) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    TODO_PATTERN.lastIndex = 0;
    const match = TODO_PATTERN.exec(line);
    if (match) {
      out.push({
        marker: match[1],
        text: (match[2] || '').trim(),
        lineNumber: i + 1,
        rawLine: line.trim().slice(0, 200),
      });
    }
  }
  return out;
}

// Get git-blame info for a specific line. Returns { author, authorDate, sha }
// or null if blame fails.
function getBlame(filePath, lineNumber, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const blame = safeExec(
    `git blame -L ${lineNumber},${lineNumber} --porcelain "${filePath}"`,
    { cwd },
  );
  if (!blame) return null;
  const lines = blame.split('\n');
  const sha = (lines[0] || '').split(' ')[0];
  let author = null;
  let authorDate = null;
  for (const l of lines) {
    if (l.startsWith('author ')) author = l.slice(7);
    else if (l.startsWith('author-time ')) {
      const ts = parseInt(l.slice(12), 10);
      if (!Number.isNaN(ts)) authorDate = new Date(ts * 1000).toISOString();
    }
  }
  return { sha, author, authorDate };
}

// Compute age in days from an ISO date string. Returns null if unparseable.
function ageDays(isoDate) {
  if (!isoDate) return null;
  const ms = Date.parse(isoDate);
  if (Number.isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
}

// Read open gh issues for dedup. Returns Set of normalized title keywords
// for fuzzy match against TODO text.
function getOpenIssueKeywords(opts = {}) {
  if (!opts.skipGh && !ghAuthed()) return new Set();
  if (opts.mockOpenIssues) {
    return buildKeywordSet(opts.mockOpenIssues);
  }
  const json = safeExec('gh issue list --state open --limit 50 --json title', {
    timeout: SIGNAL_TIMEOUT_MS,
    cwd: opts.cwd,
  });
  if (!json) return new Set();
  let issues;
  try { issues = JSON.parse(json); } catch { return new Set(); }
  return buildKeywordSet(issues);
}

function buildKeywordSet(issues) {
  const keywords = new Set();
  for (const issue of issues || []) {
    const title = (issue.title || '').toLowerCase();
    // Add the whole lowercased title as one fingerprint
    if (title.length > 0) keywords.add(title);
  }
  return keywords;
}

// Build dedup key from TODO marker + text. Used to compare against open
// issue titles (also normalized).
function todoFingerprint(todo) {
  return String(todo.text || '').toLowerCase().trim();
}

// Score whether an existing issue title matches the TODO. Simple substring +
// shared-token heuristic — sufficient for typical TODO-vs-issue dedup.
function isLikelyDuplicate(todoFingerprintStr, issueKeywords) {
  if (!todoFingerprintStr) return false;
  for (const kw of issueKeywords) {
    if (kw.length === 0) continue;
    // If the issue title contains a 5+ char chunk of the TODO text, treat as dup
    const tokens = todoFingerprintStr.split(/\s+/).filter((t) => t.length >= 5);
    for (const tok of tokens) {
      if (kw.includes(tok)) return true;
    }
  }
  return false;
}

// Main entry point — scan repo for TODO markers, age-filter via blame,
// dedup vs open issues, return candidates.
function triageTodos({
  cwd,
  minAgeDays,
  maxCandidates,
  mockOpenIssues,
  mockFiles, // DI for tests: array of { path, content }
  skipBlame, // DI: skip git blame (tests don't have blame)
  skipGh,    // DI: skip gh calls (tests)
} = {}) {
  const repoRoot = cwd || process.cwd();
  const minAge = (minAgeDays != null) ? minAgeDays : DEFAULT_MIN_AGE_DAYS;
  const max = maxCandidates || DEFAULT_MAX_CANDIDATES;

  // Collect markers either from mock files or by scanning the filesystem
  const markers = [];
  if (mockFiles) {
    for (const f of mockFiles) {
      const lines = (f.content || '').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        TODO_PATTERN.lastIndex = 0;
        const m = TODO_PATTERN.exec(line);
        if (m) {
          markers.push({
            file: f.path,
            marker: m[1],
            text: (m[2] || '').trim(),
            lineNumber: i + 1,
            rawLine: line.trim().slice(0, 200),
          });
        }
      }
    }
  } else {
    if (!gitAvailable(repoRoot)) {
      return {
        candidates: [],
        total_markers: 0,
        skipped_recent: 0,
        skipped_dup: 0,
        git_available: false,
      };
    }
    for (const filePath of walkSourceFiles(repoRoot)) {
      const found = scanFileForMarkers(filePath);
      for (const m of found) {
        markers.push({
          file: path.relative(repoRoot, filePath),
          ...m,
        });
      }
    }
  }

  let skippedRecent = 0;
  let skippedDup = 0;

  // Age filter via git blame
  const ageFiltered = [];
  for (const m of markers) {
    if (skipBlame) {
      // For tests: assume all markers are old enough
      ageFiltered.push({ ...m, age_days: minAge + 1, blame: null });
      continue;
    }
    const blame = getBlame(m.file, m.lineNumber, { cwd: repoRoot });
    const age = blame && ageDays(blame.authorDate);
    if (age == null) {
      // Can't determine age — include with null age to not lose entries
      ageFiltered.push({ ...m, age_days: null, blame });
      continue;
    }
    if (age < minAge) {
      skippedRecent += 1;
      continue;
    }
    ageFiltered.push({ ...m, age_days: age, blame });
  }

  // Dedup vs open issues
  const issueKeywords = getOpenIssueKeywords({ cwd: repoRoot, mockOpenIssues, skipGh });
  const candidates = [];
  for (const m of ageFiltered) {
    const fp = todoFingerprint(m);
    if (isLikelyDuplicate(fp, issueKeywords)) {
      skippedDup += 1;
      continue;
    }
    candidates.push(m);
    if (candidates.length >= max) break;
  }

  return {
    candidates,
    total_markers: markers.length,
    skipped_recent: skippedRecent,
    skipped_dup: skippedDup,
    git_available: true,
    gh_available: ghAvailable(),
    gh_authed: skipGh ? null : ghAuthed(),
  };
}

// Build a deterministic gh issue body from a candidate. No LLM.
function formatIssueBody(candidate) {
  const lines = [];
  lines.push(`## Source location`);
  lines.push('');
  lines.push(`\`${candidate.file}:${candidate.lineNumber}\``);
  lines.push('');
  lines.push(`## Marker`);
  lines.push('');
  lines.push(`**${candidate.marker}**: ${candidate.text || '(no text)'}`);
  lines.push('');
  if (candidate.rawLine) {
    lines.push('## Code context');
    lines.push('');
    lines.push('```');
    lines.push(candidate.rawLine);
    lines.push('```');
    lines.push('');
  }
  if (candidate.blame) {
    lines.push('## git blame');
    lines.push('');
    if (candidate.blame.author) lines.push(`- author: ${candidate.blame.author}`);
    if (candidate.blame.authorDate) lines.push(`- date: ${candidate.blame.authorDate}`);
    if (candidate.age_days != null) lines.push(`- age: ${candidate.age_days} days`);
    if (candidate.blame.sha) lines.push(`- commit: ${candidate.blame.sha.slice(0, 8)}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('Filed by Hermes (cortex-x) automated TODO triage. Close if no longer applicable.');
  return lines.join('\n');
}

function formatIssueTitle(candidate) {
  const text = candidate.text ? candidate.text.slice(0, 60) : 'unspecified';
  return `${candidate.marker}: ${text}`;
}

// ── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const wantJson = args.some((a) => a === '--json');
  const maxArg = args.find((a) => a.startsWith('--max='));
  const ageArg = args.find((a) => a.startsWith('--age='));
  const result = triageTodos({
    maxCandidates: maxArg ? parseInt(maxArg.slice(6), 10) : DEFAULT_MAX_CANDIDATES,
    minAgeDays: ageArg ? parseInt(ageArg.slice(6), 10) : DEFAULT_MIN_AGE_DAYS,
  });

  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`TODO triage report:\n`);
    process.stdout.write(`  total markers found:  ${result.total_markers}\n`);
    process.stdout.write(`  skipped (too recent): ${result.skipped_recent}\n`);
    process.stdout.write(`  skipped (dup issue):  ${result.skipped_dup}\n`);
    process.stdout.write(`  candidates:           ${result.candidates.length}\n`);
    if (result.candidates.length > 0) {
      process.stdout.write('\nCandidates:\n');
      for (const c of result.candidates) {
        process.stdout.write(`  ${c.file}:${c.lineNumber}  [${c.marker}] ${(c.text || '').slice(0, 80)}\n`);
      }
    }
  }
}

module.exports = {
  triageTodos,
  scanFileForMarkers,
  getBlame,
  ageDays,
  todoFingerprint,
  isLikelyDuplicate,
  formatIssueTitle,
  formatIssueBody,
  buildKeywordSet,
};
