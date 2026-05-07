// lessons.cjs — Sprint 1.8.3 ReasoningBank-lite memory module.
//
// Append-only log of "what failed and why" lessons, captured after every
// failed Hermes run. Lessons are deterministically recalled into the next
// LLM prompt so Hermes does not repeat the same mistake.
//
// Design refs:
//   - Google Research ReasoningBank (2026) — distill failure rationales,
//     not raw transcripts; counterfactual signals; LLM-as-judge.
//   - Cloudflare Agent Memory (2026) — append-only, infrastructure-free,
//     keyword-shaped recall (no embedding service needed for v1).
//
// Storage:
//   $CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl
//   One JSON object per line. No truncation; growth bounded by frequency
//   of failures (typically <1KB/day). Readers tail the last N lines.
//
// Each lesson:
//   {
//     ts:           ISO 8601 timestamp
//     action_kind:  "recommendation" | "recommendation_harvest" | ...
//     action_key:   "<slug>#week-1"            — for repeat-failure dedup
//     root_cause:   "OPENROUTER_KEY_MISSING"  — short error code from result.code
//     lesson_text:  one-sentence what went wrong, plain prose
//     hint:         one-sentence "next time, do X" guidance (optional)
//   }
//
// Recall API picks top-K matching the upcoming action by:
//   1. Exact match on action_key (highest priority — same action failed before)
//   2. Match on action_kind (same kind failed before)
//   3. Recency tiebreaker (newer wins)
//
// No embeddings, no semantic search. Keyword shape is enough for v1.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_RECALL_K = 5;
const MAX_RECALL_LINES = 500; // hard cap on jsonl tail read

function resolveDataHome() {
  return process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
}

function lessonsPath(slug) {
  return path.join(resolveDataHome(), 'journal', slug, 'lessons.jsonl');
}

// Append-only JSONL write. Idempotent at the line level; safe under concurrent
// Hermes runs because each line is atomic (lessons are short).
function recordLesson(slug, lesson) {
  if (!slug) throw new Error('lessons.recordLesson: slug is required');
  if (!lesson || typeof lesson !== 'object') throw new Error('lessons.recordLesson: lesson object is required');

  const file = lessonsPath(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const enriched = {
    ts: lesson.ts || new Date().toISOString(),
    action_kind: lesson.action_kind || 'recommendation',
    action_key: lesson.action_key || null,
    root_cause: lesson.root_cause || 'UNKNOWN',
    lesson_text: lesson.lesson_text || '',
    hint: lesson.hint || null,
  };

  fs.appendFileSync(file, JSON.stringify(enriched) + '\n', 'utf8');
  return enriched;
}

// Read the last N lessons from the jsonl tail. Returns an array (possibly
// empty if file missing or all entries malformed).
function readAllLessons(slug, { maxLines = MAX_RECALL_LINES } = {}) {
  const file = lessonsPath(slug);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n').filter(Boolean).slice(-maxLines);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch (_) {
      // Malformed line — skip silently. Append-only writes shouldn't produce
      // these, but we don't want one corrupted entry to kill all recall.
    }
  }
  return out;
}

// Score a single lesson against an upcoming action context. Higher score =
// more relevant. Score components:
//   +100  exact action_key match (same recommendation failed before)
//   +30   same action_kind
//   +10   recency boost (newer lessons preferred when keys/kinds tie)
function scoreLesson(lesson, ctx) {
  let score = 0;
  if (ctx.action_key && lesson.action_key === ctx.action_key) score += 100;
  if (ctx.action_kind && lesson.action_kind === ctx.action_kind) score += 30;
  if (lesson.ts) {
    const ageMs = Date.now() - Date.parse(lesson.ts);
    if (!Number.isNaN(ageMs) && ageMs >= 0) {
      // 0 days old → +10, 30 days old → 0, 60+ days → 0
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - ageDays / 3);
    }
  }
  return score;
}

// Recall top-K most relevant lessons for an upcoming action. Returns array
// sorted by score (highest first), capped at K.
function recallLessons(slug, ctx = {}, { topK = DEFAULT_RECALL_K, maxLines = MAX_RECALL_LINES } = {}) {
  const all = readAllLessons(slug, { maxLines });
  if (all.length === 0) return [];
  const scored = all
    .map((lesson) => ({ lesson, score: scoreLesson(lesson, ctx) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((entry) => entry.lesson);
}

// Format an array of lessons as a compact markdown block for prompt injection.
// Empty input returns empty string (caller can ?? the result).
function formatLessonsForPrompt(lessons) {
  if (!Array.isArray(lessons) || lessons.length === 0) return '';
  const lines = ['## Past lessons (from prior failed Hermes runs)'];
  for (const l of lessons) {
    const hint = l.hint ? ` Hint: ${l.hint}` : '';
    const akey = l.action_key ? ` [${l.action_key}]` : '';
    lines.push(`- ${l.root_cause}${akey}: ${l.lesson_text}.${hint}`);
  }
  lines.push('');
  lines.push('Read these as cautionary signal. Do not repeat the same root cause without addressing the hint.');
  return lines.join('\n');
}

// Convenience: convert an executor result.code + error string into a default
// lesson_text. Captures the typical "what went wrong" without requiring
// callers to hand-craft prose every time.
function lessonFromExecuteResult(result, ctx = {}) {
  if (!result || result.ok) return null; // success — nothing to learn from
  const lesson = {
    action_kind: ctx.action_kind || 'recommendation',
    action_key: ctx.action_key || null,
    root_cause: result.code || 'UNKNOWN',
    lesson_text: result.error || 'no error message provided',
  };
  // Heuristic hints for known root causes
  switch (result.code) {
    case 'OPENROUTER_KEY_MISSING':
      lesson.hint = 'Set OPENROUTER_API_KEY env var or gh secret before next run';
      break;
    case 'OPENROUTER_PLAN_SHAPE_INVALID':
      lesson.hint = 'LLM returned invalid edits[] shape; check max_tokens (default 4096 may truncate)';
      break;
    case 'EDIT_DENYLISTED':
      lesson.hint = 'LLM tried to edit a hardcoded-denylist path; reword recommendation to target auto_improves area';
      break;
    case 'NPM_TEST_FAILED':
      lesson.hint = 'Verifier rejected; LLM produced syntactically valid but semantically broken code';
      break;
    case 'BUDGET_CAP_REACHED':
      lesson.hint = 'Daily $5 spend cap exceeded; raise HERMES_DAILY_USD_CAP or wait for UTC midnight reset';
      break;
    case 'FAILURE_BREAKER_TRIPPED':
      lesson.hint = 'Same action_key failed 3+ times within 1h window; manual investigation required';
      break;
    default:
      lesson.hint = null;
  }
  return lesson;
}

module.exports = {
  recordLesson,
  readAllLessons,
  recallLessons,
  scoreLesson,
  formatLessonsForPrompt,
  lessonFromExecuteResult,
  lessonsPath,
};
