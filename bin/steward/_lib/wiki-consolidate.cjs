// bin/steward/_lib/wiki-consolidate.cjs — Sprint 2.8.2 v0 (Phase A only)
//
// Karpathy-style human-readable wiki layer over cortex-x's journal+lessons.
// Phase A (this version) = pure-deterministic. No LLM. Reads lessons.jsonl,
// groups by action_kind, emits one wiki article per kind to:
//
//   $CORTEX_DATA_HOME/wiki/capabilities/<action_kind>.md
//
// Phase B (deferred to Sprint 2.8.2 v1) will add LLM-validated merge-or-create
// with provenance labels (observed/confirmed/inferred/imported) using the
// Sprint 3.0 v2 cross-family judge pattern.
//
// Karpathy 2026 dev-day framing:
//   "I really enjoy whenever I read an article I have my wiki that's being
//    built up from these articles ... these are tools to enhance understanding."
//
// File shape (Obsidian-compatible YAML frontmatter + standard markdown):
//
//   ---
//   title: "action_kind: <kind>"
//   slug: <kind>
//   created: <ISO date>
//   updated: <ISO date>
//   last_run_id: <ISO timestamp>
//   source_count: <number of lessons aggregated>
//   confidence_band: low|medium|high
//   provenance: observed  # Phase A only emits observed (no LLM confirmation yet)
//   action_kinds: [<kind>]
//   error_codes: [...]
//   projects: [...]
//   tags: [steward/wiki, kind/<kind>]
//   ---
//
//   # action_kind: <kind>
//
//   > One-paragraph summary.
//
//   ## Recent lessons
//
//   - **<root_cause>**: <lesson_text>
//     - First seen: <date>, Last seen: <date>, Frequency: <n>
//     - Hint: <hint>
//     - Source: `journal/<slug>/<date>.jsonl`
//
//   ## Sources
//   - lessons.jsonl: <n> entries aggregated
//   - Run: <ISO timestamp>

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const crypto = require('node:crypto');

const { resolveCortexDataHome } = require('../../../tools/lib/resolve-cortex-home.cjs');

const DEFAULT_TOP_LESSONS_PER_KIND = 10;
const DEFAULT_MAX_KINDS_PER_RUN = 5; // R1 §7 cost-ceiling pattern (Phase B will use LLM)
const ARTICLE_FRONTMATTER_VERSION = 1;
// R2 security HIGH: cap lessons.jsonl file read to prevent OOM on dogfood
// repos with long-lived lessons history. Same SSOT shape as
// tech-debt-audit.cjs MAX_FILE_BYTES + test-smell-detector.cjs.
const MAX_LESSONS_FILE_BYTES = 8 * 1024 * 1024; // 8 MiB

// R2 edge-case MED: Windows reserved device names cannot be used as filename
// stems even with .md extension — Win32 `path.join(dir, 'con.md')` returns
// EINVAL or black-holes to the CON device. Deny here in addition to the
// allow-list regex.
const WINDOWS_RESERVED_RE = /^(con|aux|nul|prn|com[1-9]|lpt[1-9])$/i;

// ─────────────────────────────────────────────────────────────────────────────
// Path resolution — use the canonical SSOT resolver, not env.cjs's STEWARD_*
// prefix (which would look for STEWARD_CORTEX_DATA_HOME, wrong env var).
// Precedence: process.env.CORTEX_DATA_HOME → cortex-source.yaml → ~/.cortex
// ─────────────────────────────────────────────────────────────────────────────

function resolveDataHome() {
  return resolveCortexDataHome();
}

function wikiDir(slug) {
  return path.join(resolveDataHome(), 'wiki', slug);
}

function wikiCapabilitiesDir(slug) {
  return path.join(wikiDir(slug), 'capabilities');
}

function lessonsPath(slug) {
  return path.join(resolveDataHome(), 'journal', slug, 'lessons.jsonl');
}

// ─────────────────────────────────────────────────────────────────────────────
// Lesson aggregation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read all lessons for a slug and group by action_kind.
 * Each lesson in lessons.jsonl is a single JSON object per line.
 * @param {string} slug
 * @returns {Map<action_kind, Array<lesson>>}
 */
function loadLessonsByKind(slug) {
  // R2 security HIGH + edge-case HIGH: cap file size BEFORE slurp.
  // Operator-controlled file but unbounded growth on dogfood repos.
  const byKind = new Map();
  const p = lessonsPath(slug);
  if (!fs.existsSync(p)) return byKind;

  let stat;
  try { stat = fs.statSync(p); } catch { return byKind; }
  if (stat.size > MAX_LESSONS_FILE_BYTES) {
    // Fail-safe: too large → caller should see no_work, operator alerted via
    // returning a special sentinel. We return empty Map so caller's no_work
    // path fires; the size cap is logged via stderr for operator visibility.
    process.stderr.write(`[wiki-consolidate] skipping — lessons.jsonl size ${stat.size} > MAX_LESSONS_FILE_BYTES ${MAX_LESSONS_FILE_BYTES}\n`);
    return byKind;
  }

  let content;
  try { content = fs.readFileSync(p, 'utf8'); }
  catch { return byKind; }

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    const kind = entry.action_kind || 'unknown';
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(entry);
  }
  return byKind;
}

/**
 * Compute aggregation stats for a single action_kind bucket.
 */
function summarizeKindBucket(lessons) {
  // R2 correctness MED + edge-case MED: normalize timestamps via Date.parse()
  // ms for ordering. Lexicographic compare on mixed `2026-05-10` vs
  // `2026-05-10T12:00:00Z` formats produces wrong min/max. Storage of the
  // human-readable string is preserved separately for emission.
  const errorCodes = new Set();
  const projects = new Set();
  let firstSeenMs = null;
  let firstSeenStr = null;
  let lastSeenMs = null;
  let lastSeenStr = null;
  let totalFrequency = 0;

  const consider = (raw) => {
    if (raw === undefined || raw === null) return;
    const ms = normalizeTs(raw);
    if (ms === null) return;
    if (firstSeenMs === null || ms < firstSeenMs) {
      firstSeenMs = ms;
      firstSeenStr = String(raw);
    }
    if (lastSeenMs === null || ms > lastSeenMs) {
      lastSeenMs = ms;
      lastSeenStr = String(raw);
    }
  };

  for (const l of lessons) {
    if (l.root_cause) errorCodes.add(String(l.root_cause));
    if (l.project) projects.add(String(l.project));
    if (typeof l.frequency === 'number') totalFrequency += l.frequency;
    consider(l.first_seen);
    consider(l.last_seen);
    consider(l.ts);
  }

  return {
    count: lessons.length,
    error_codes: [...errorCodes].sort(),
    projects: [...projects].sort(),
    first_seen: firstSeenStr,
    last_seen: lastSeenStr,
    total_frequency: totalFrequency,
  };
}

/**
 * Determine confidence band from observation count.
 * Heuristic: ≥10 lessons = high, ≥3 = medium, else low.
 */
function confidenceBand(lessonCount) {
  if (lessonCount >= 10) return 'high';
  if (lessonCount >= 3) return 'medium';
  return 'low';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitization (Sprint 2.19 v1 R2 + 3.1 v0 R2 pattern reuse)
// ─────────────────────────────────────────────────────────────────────────────

function safeMarkdownField(s, maxLen = 500) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\r/g, '')
    .slice(0, maxLen);
}

function safeMarkdownBody(s) {
  let out = safeMarkdownField(s, 8000);
  // Defang `---` and `## ` only at line start (prevents frontmatter / heading
  // injection from a hostile lesson_text). Same SSOT as Sprint 3.1 v0
  // sanitizeMarkdownBody.
  out = out.replace(/^---\s*$/gm, '\\---');
  out = out.replace(/^##\s+/gm, '\\## ');
  return out;
}

function escapeYamlString(s) {
  // R2 security LOW + edge-case HIGH: strip ALL control chars (incl. newlines
  // and tabs) before YAML scalar quoting. A `root_cause` with embedded `\n`
  // would emit literal newline inside the double-quoted flow scalar, breaking
  // YAML parsers. Also cap length to 200 chars per scalar — prevents 50KB
  // root_cause from ballooning frontmatter.
  const cleaned = String(s == null ? '' : s)
    .replace(/[\x00-\x1f]/g, '') // strip ALL control + whitespace control
    .slice(0, 200);
  return '"' + cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// R2 correctness MED: mixed-format date compare. Normalize to ms-since-epoch
// for ordering, return null if unparseable. Caller uses null-safety.
function normalizeTs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || v.length === 0) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Article rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderFrontmatter(kind, summary, runIso, contentHash) {
  // R2 correctness HIGH: `updated` + `last_run_id` only set when caller has
  // determined content actually changed. `content_hash` is the SSOT for
  // change detection across runs.
  const today = runIso.slice(0, 10);
  const lines = [
    '---',
    `title: ${escapeYamlString(`action_kind: ${kind}`)}`,
    `slug: ${kind}`,
    `created: ${today}`,
    `updated: ${today}`,
    `last_run_id: ${runIso}`,
    `content_hash: ${contentHash}`,
    `frontmatter_version: ${ARTICLE_FRONTMATTER_VERSION}`,
    `source_count: ${summary.count}`,
    `confidence_band: ${confidenceBand(summary.count)}`,
    'provenance: observed',
    `action_kinds: [${kind}]`,
  ];
  if (summary.error_codes.length > 0) {
    const ecs = summary.error_codes.map((c) => escapeYamlString(c)).join(', ');
    lines.push(`error_codes: [${ecs}]`);
  }
  if (summary.projects.length > 0) {
    const ps = summary.projects.map((p) => escapeYamlString(p)).join(', ');
    lines.push(`projects: [${ps}]`);
  }
  lines.push(`tags: [steward/wiki, kind/${kind}]`);
  lines.push('---');
  return lines.join('\n');
}

function renderArticleBody(kind, lessons, summary, opts) {
  const topK = opts.topK || DEFAULT_TOP_LESSONS_PER_KIND;
  const lines = [];
  lines.push('');
  lines.push(`# action_kind: ${kind}`);
  lines.push('');
  lines.push(`> ${summary.count} lessons aggregated across ${summary.error_codes.length} error code(s) and ${summary.projects.length} project(s). Confidence: **${confidenceBand(summary.count)}**.`);
  lines.push('');
  lines.push('## Recent lessons');
  lines.push('');

  // Sort by frequency desc, then by last_seen desc — most-frequent + recent first
  // R2 edge-case HIGH: String() coerce on a/b ts to prevent .localeCompare()
  // throwing TypeError when ts is non-string (array/object leaked from
  // malformed JSONL). Same defensive coerce pattern as Sprint 3.1 v0.
  const sorted = [...lessons].sort((a, b) => {
    const fa = (typeof a.frequency === 'number') ? a.frequency : 0;
    const fb = (typeof b.frequency === 'number') ? b.frequency : 0;
    if (fb !== fa) return fb - fa;
    const ta = String(a.last_seen || a.ts || '');
    const tb = String(b.last_seen || b.ts || '');
    return tb.localeCompare(ta);
  });

  for (const l of sorted.slice(0, topK)) {
    const cause = safeMarkdownField(l.root_cause || 'unknown', 200);
    const text = safeMarkdownBody(l.lesson_text || '(no lesson_text)');
    lines.push(`- **${cause}** — ${text}`);
    const meta = [];
    if (l.first_seen) meta.push(`first: ${safeMarkdownField(l.first_seen, 40)}`);
    if (l.last_seen) meta.push(`last: ${safeMarkdownField(l.last_seen, 40)}`);
    if (typeof l.frequency === 'number') meta.push(`freq: ${l.frequency}`);
    if (meta.length > 0) lines.push(`  - ${meta.join(' · ')}`);
    if (l.hint) lines.push(`  - hint: ${safeMarkdownBody(l.hint)}`);
  }

  lines.push('');
  lines.push('## Sources');
  lines.push('');
  lines.push(`- \`lessons.jsonl\` — ${summary.count} entries aggregated for kind \`${kind}\``);
  if (summary.first_seen) lines.push(`- First seen: ${safeMarkdownField(summary.first_seen, 40)}`);
  if (summary.last_seen) lines.push(`- Last seen: ${safeMarkdownField(summary.last_seen, 40)}`);
  lines.push(`- Generated: ${opts.runIso}`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('This article is auto-generated by `wiki_consolidate` Phase A (deterministic). Phase B (LLM-validated merge with provenance labels) is deferred to Sprint 2.8.2 v1.');
  lines.push('');

  return lines.join('\n');
}

function renderArticle(kind, lessons, summary, runIso, opts = {}) {
  const contentHash = opts.contentHash || computeContentHash(lessons);
  const fm = renderFrontmatter(kind, summary, runIso, contentHash);
  const body = renderArticleBody(kind, lessons, summary, { ...opts, runIso });
  return fm + body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem write (atomic, contained)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a kind name is safe to use as a filesystem path component.
 * Same allow-list as Sprint 3.4 v0 SLUG_RE.
 */
function isSafeKindSlug(kind) {
  // R2 edge-case MED: reject Windows reserved device names (`con`, `aux`,
  // `nul`, `prn`, `com[1-9]`, `lpt[1-9]`). These pass the allow-list regex
  // but cannot be used as filename stems on Win32.
  return typeof kind === 'string'
    && kind.length > 0
    && kind.length <= 64
    && /^[A-Za-z0-9_-]+$/.test(kind)
    && !WINDOWS_RESERVED_RE.test(kind);
}

function writeArticle(slug, kind, content) {
  // R2 edge-case HIGH: tmp orphan on rename fail. Wrap in try/finally so a
  // failed renameSync (Windows EBUSY when target open in editor) cleans up
  // the .tmp litter. Successive runs would otherwise accumulate .tmp files.
  if (!isSafeKindSlug(kind)) {
    throw new Error(`unsafe kind for filesystem path: ${kind}`);
  }
  const dir = wikiCapabilitiesDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${kind}.md`);
  const tmpPath = filePath + '.tmp';
  let renamed = false;
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    }
  }
  return filePath;
}

// R2 correctness HIGH: idempotency. cron should not produce dirty diffs on
// re-runs with the same input. Compute a stable hash over the lesson set
// (sorted) — bump `updated:` + `last_run_id:` ONLY when the underlying
// content changes. Read the previous article's frontmatter content_hash
// before deciding whether to rewrite.
function computeContentHash(lessons) {
  // Hash a stable representation of the lesson contributions only.
  // Includes: root_cause, lesson_text, hint, frequency. Excludes ts (because
  // ts naturally drifts and we want hash stability when same set persisted
  // across days). Sort by JSON-stringified to be order-independent.
  const stable = lessons
    .map((l) => JSON.stringify({
      root_cause: l.root_cause || null,
      lesson_text: l.lesson_text || null,
      hint: l.hint || null,
      frequency: typeof l.frequency === 'number' ? l.frequency : 0,
      project: l.project || null,
    }))
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function readExistingHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const buf = fs.readFileSync(filePath, 'utf8');
    const m = buf.match(/^content_hash:\s*([a-f0-9]{16})\s*$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run wiki consolidation Phase A for one slug.
 * @param {object} opts
 * @param {string} opts.slug
 * @param {Date}   [opts.now]
 * @param {number} [opts.maxKindsPerRun]
 * @param {number} [opts.topLessonsPerKind]
 * @param {boolean} [opts.dryRun] — don't write to disk
 * @returns {object} {ok, articles_written, articles_skipped, kinds_processed, ...}
 */
function runWikiConsolidate(opts = {}) {
  const slug = opts.slug;
  if (!slug) return { ok: false, error: 'slug required', code: 'MISSING_SLUG' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(slug)) {
    return { ok: false, error: 'invalid slug', code: 'INVALID_SLUG' };
  }

  const now = opts.now instanceof Date ? opts.now : new Date();
  const runIso = now.toISOString();
  const maxKinds = Number.isFinite(opts.maxKindsPerRun)
    ? Math.max(0, Math.min(50, opts.maxKindsPerRun))
    : DEFAULT_MAX_KINDS_PER_RUN;
  const topK = Number.isFinite(opts.topLessonsPerKind)
    ? Math.max(1, Math.min(50, opts.topLessonsPerKind))
    : DEFAULT_TOP_LESSONS_PER_KIND;
  const dryRun = !!opts.dryRun;

  const byKind = loadLessonsByKind(slug);
  if (byKind.size === 0) {
    return {
      ok: true,
      no_work: true,
      reason: 'no_lessons_jsonl_or_empty',
      articles_written: [],
      kinds_processed: 0,
      run_iso: runIso,
    };
  }

  // Rank kinds by lesson count desc — R2 correctness MED tie-break by name
  // for deterministic output across runs that re-shuffle Map insertion order.
  const allKinds = [...byKind.keys()]
    .filter(isSafeKindSlug)
    .sort((a, b) => {
      const diff = byKind.get(b).length - byKind.get(a).length;
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });

  const selectedKinds = allKinds.slice(0, maxKinds);
  const skipped = allKinds.slice(maxKinds);

  const articlesWritten = [];
  const articlesUnchanged = []; // R2 correctness HIGH: idempotency tracker
  const errors = [];

  for (const kind of selectedKinds) {
    const lessons = byKind.get(kind);
    const summary = summarizeKindBucket(lessons);
    const contentHash = computeContentHash(lessons);
    // R2 correctness HIGH idempotency check: skip write when content_hash
    // matches existing article. Cron produces zero diff when no lessons
    // changed, preserving git-diff hygiene.
    if (!dryRun) {
      const targetPath = path.join(wikiCapabilitiesDir(slug), `${kind}.md`);
      const existingHash = readExistingHash(targetPath);
      if (existingHash === contentHash) {
        const relPath = path.relative(resolveDataHome(), targetPath).replace(/\\/g, '/');
        articlesUnchanged.push(relPath);
        continue;
      }
    }
    const content = renderArticle(kind, lessons, summary, runIso, { topK, contentHash });
    if (!dryRun) {
      try {
        const filePath = writeArticle(slug, kind, content);
        const relPath = path.relative(resolveDataHome(), filePath).replace(/\\/g, '/');
        articlesWritten.push(relPath);
      } catch (e) {
        errors.push({ kind, error: e.message });
      }
    } else {
      articlesWritten.push(`wiki/${slug}/capabilities/${kind}.md (dry-run)`);
    }
  }

  return {
    ok: true,
    run_iso: runIso,
    kinds_processed: selectedKinds.length,
    kinds_skipped: skipped.length,
    skipped_kinds: skipped,
    articles_written: articlesWritten,
    articles_unchanged: articlesUnchanged,
    errors,
    cost_usd: 0, // Phase A is deterministic, no LLM
    dry_run: dryRun,
  };
}

module.exports = {
  runWikiConsolidate,
  // exported for tests:
  _internal: {
    loadLessonsByKind,
    summarizeKindBucket,
    confidenceBand,
    renderFrontmatter,
    renderArticle,
    isSafeKindSlug,
    wikiCapabilitiesDir,
    computeContentHash,
    readExistingHash,
    normalizeTs,
    escapeYamlString,
    DEFAULT_TOP_LESSONS_PER_KIND,
    DEFAULT_MAX_KINDS_PER_RUN,
    MAX_LESSONS_FILE_BYTES,
    ARTICLE_FRONTMATTER_VERSION,
  },
};
