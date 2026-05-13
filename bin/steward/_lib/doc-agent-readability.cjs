// bin/steward/_lib/doc-agent-readability.cjs — Sprint 2.8.3 v0
//
// Pure-deterministic agent-readability scorer for markdown docs.
//
// Rubric derived from Sprint 2.8.3 R1 web research synthesis (May 2026):
// agentskills.io spec, Anthropic skill-creator best practices, Cloudflare
// Markdown-for-Agents, Dachary Carey "agent-friendly docs", Augment AGENTS.md
// guide, llmstxt.org. No canonical "agent-readability score" exists yet —
// cortex-x ships this as an early-mover convention.
//
// Karpathy 2026 dev-day framing:
//   "Why are people still telling me what to do? What is the thing I should
//    copy paste to my agent?"
//
// 6 signals, weighted, scored 0..100. Pure regex + char counting. No LLM.
//
// SCORING FORMULA:
//   score = clamp(0..100,
//     100
//     + 30 * codeBlockDensity                  // signal 1 (copy-paste-ready)
//     - 25 * min(urlNavTriggers, 4)            // signal 2 (human-UI breadcrumbs)
//     + 20 * frontmatterValid                  // signal 3 (machine-readable)
//     + 15 * frontLoadedActionable             // signal 4 (early-action)
//     - 10 * proseHeavy                        // signal 5 (token waste)
//     +  5 * anchorDensity                     // signal 6 (deep-linkable)
//   )

'use strict';

// Phrase-based human-UI breadcrumbs. Each requires a noun/preposition that
// makes it unambiguously a "you, human, do this with your eyeballs" instruction.
// Bare verbs ("open", "click") were causing false positives — "fail-open",
// "open a draft PR", "Open PRs While You Sleep" all matched. Now requires
// the human-UI context to follow. Built-up from Dachary Carey + Augment
// AGENTS.md guides which flag *contextual* UI verbs, not bare verbs.
const URL_NAV_RE = /\b(?:go to (?:the |our |your |https?:\/\/|www\.)|navigate to (?:the |our |your |https?:\/\/)|click (?:the |on (?:the |a |our )?|here|to (?:open|view|see))|visit (?:the |our |https?:\/\/|www\.)|head over to|press the [A-Za-z]+ (?:button|key)|in the sidebar|in the menu|on the dashboard|open (?:your )?browser|open (?:up )?(?:the )?(?:settings|preferences|terminal|file manager|tab))\b/gi;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const FENCED_CODE_RE = /^```[a-zA-Z0-9_-]*\r?\n[\s\S]*?\r?\n```\s*$/gm;
const FENCED_OPEN_RE = /^```/gm;
const HEADING_2_3_RE = /^#{2,3}\s+\S/gm;
const ANCHOR_RE = /\{#[a-z0-9-]+\}|<a\s+(?:id|name)="[^"]+"\s*\/?>/gi;
const COMMAND_LINE_RE = /^\s*\$\s+\S|^\s*(?:npm|node|git|gh|cortex-\w+|curl|bash|powershell)\s/m;
// R2 blind-hunter MED: negative lookahead direction bug. (?!\W) means
// "not followed by non-word", so `MUSTard` matched (a = word char passes
// the lookahead). Switched to (?!\w) meaning "not followed by word char"
// so `MUSTard` no longer matches but `MUST.`, `MUST,`, `MUST!` still do.
// The trailing \b anchor is also stricter than the lookahead in modern
// JS engines, but keep both for explicit intent.
const ALL_CAPS_RULE_RE = /\b(ALWAYS|NEVER|MUST)\b(?!\w)/g;

// 800 chars covers a normal-shape README: title + 1-line tagline + badges row
// + horizontal rule + ## Install heading + 1-line requirement note + first
// fenced code block. Tighter window (500) was missing the bash block by a few
// dozen chars in typical READMEs.
const FRONTLOAD_WINDOW = 800;
const PROSE_HEAVY_RATIO = 5;
const URL_NAV_CAP = 4;
const SIGNAL_WEIGHTS = Object.freeze({
  codeBlockDensity: 30,
  urlNavTriggers: -25,
  frontmatterValid: 20,
  frontLoadedActionable: 15,
  proseHeavy: -10,
  anchorDensity: 5,
});

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function countMatches(s, re) {
  // R2 blind-hunter + edge-case CRITICAL: previous implementation used a
  // re.exec() loop with `if (re.lastIndex === 0) break;` guard. That was
  // fragile for any non-global regex (lastIndex stays 0 → undercounts to 0
  // or 1) and for zero-width matches. Switching to String.match() with a /g
  // regex returns the full match array; safer + consistent with the
  // URL_NAV_RE / ANCHOR_RE / ALL_CAPS_RULE_RE call sites. Assert /g flag at
  // entry so any future caller passing a non-global regex fails loudly.
  if (!re.global) {
    throw new Error('countMatches: regex must have /g flag (lastIndex semantics)');
  }
  re.lastIndex = 0;
  const matches = s.match(re);
  return matches ? matches.length : 0;
}

function parseFrontmatter(content) {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { present: false, valid: false, fields: {} };
  const body = m[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (km) fields[km[1]] = km[2].trim();
  }
  const name = fields.name || '';
  const desc = fields.description || '';
  const valid = name.length > 0 && name.length <= 64
    && desc.length > 0 && desc.length <= 1024;
  return { present: true, valid, fields };
}

function countCodeBlocks(content) {
  const opens = countMatches(content, FENCED_OPEN_RE);
  return Math.floor(opens / 2);
}

function countHeadings(content) {
  return countMatches(content, HEADING_2_3_RE);
}

function frontLoadedActionable(content, fmEnd) {
  // R2 edge-case + blind-hunter MED: previous version reset
  // FENCED_OPEN_RE.lastIndex AFTER `.test()` only on the false branch,
  // leaving stale lastIndex for the next call when .test() returned true.
  // Multi-doc audit runs (cortex-doc-audit on N files) bled state across
  // docs. Reset unconditionally BEFORE .test() to guarantee fresh state.
  const startOffset = fmEnd || 0;
  const window = content.slice(startOffset, startOffset + FRONTLOAD_WINDOW);
  FENCED_OPEN_RE.lastIndex = 0;
  if (FENCED_OPEN_RE.test(window)) {
    FENCED_OPEN_RE.lastIndex = 0;
    return true;
  }
  if (COMMAND_LINE_RE.test(window)) return true;
  return false;
}

function proseToCodeRatio(content) {
  const codeMatches = content.match(FENCED_CODE_RE) || [];
  const codeChars = codeMatches.reduce((acc, b) => acc + b.length, 0);
  const proseChars = content.length - codeChars;
  if (codeChars === 0) return Infinity;
  return proseChars / codeChars;
}

function frontmatterEndOffset(content) {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return 0;
  return m.index + m[0].length;
}

/**
 * Score a markdown document on the agent-readability axis.
 * @param {string} content — full markdown text
 * @param {object} [opts]
 * @returns {{
 *   score: number,
 *   signals: object,
 *   penalties: string[],
 *   bonuses: string[],
 *   yellow_flags: string[],
 * }}
 */
function scoreMarkdown(content, opts = {}) {
  if (typeof content !== 'string') {
    return {
      score: 0,
      signals: {},
      penalties: ['NOT_STRING'],
      bonuses: [],
      yellow_flags: [],
    };
  }
  if (content.length === 0) {
    return {
      score: 0,
      signals: {},
      penalties: ['EMPTY'],
      bonuses: [],
      yellow_flags: [],
    };
  }

  const fm = parseFrontmatter(content);
  const fmEnd = frontmatterEndOffset(content);
  const codeBlocks = countCodeBlocks(content);
  const headings = countHeadings(content);
  const codeBlockDensity = headings === 0
    ? Math.min(codeBlocks, 1)
    : Math.min(codeBlocks / headings, 2);
  const urlNavMatches = (content.match(URL_NAV_RE) || []).length;
  const urlNavTriggers = Math.min(urlNavMatches, URL_NAV_CAP);
  const frontLoaded = frontLoadedActionable(content, fmEnd);
  const ratio = proseToCodeRatio(content);
  const proseHeavy = ratio > PROSE_HEAVY_RATIO;
  const anchorMatches = (content.match(ANCHOR_RE) || []).length;
  const anchorDensity = headings === 0
    ? 0
    : Math.min(anchorMatches / headings, 1);

  const signals = {
    codeBlockDensity: Number(codeBlockDensity.toFixed(2)),
    urlNavTriggers,
    urlNavMatches,
    frontmatterPresent: fm.present,
    frontmatterValid: fm.valid,
    frontLoadedActionable: frontLoaded,
    proseToCodeRatio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
    proseHeavy,
    anchorDensity: Number(anchorDensity.toFixed(2)),
    headings,
    codeBlocks,
  };

  const raw = 100
    + SIGNAL_WEIGHTS.codeBlockDensity * codeBlockDensity
    + SIGNAL_WEIGHTS.urlNavTriggers * urlNavTriggers
    + SIGNAL_WEIGHTS.frontmatterValid * (fm.valid ? 1 : 0)
    + SIGNAL_WEIGHTS.frontLoadedActionable * (frontLoaded ? 1 : 0)
    + SIGNAL_WEIGHTS.proseHeavy * (proseHeavy ? 1 : 0)
    + SIGNAL_WEIGHTS.anchorDensity * anchorDensity;
  const score = Math.round(clamp(raw, 0, 100));

  const penalties = [];
  const bonuses = [];
  if (urlNavTriggers > 0) penalties.push(`URL_NAV_TRIGGERS x${urlNavMatches}`);
  if (proseHeavy) penalties.push(`PROSE_HEAVY ratio=${signals.proseToCodeRatio}`);
  if (!fm.present) penalties.push('NO_FRONTMATTER');
  else if (!fm.valid) penalties.push('FRONTMATTER_INCOMPLETE');
  if (!frontLoaded) penalties.push('NO_FRONT_LOAD_ACTIONABLE');

  if (codeBlockDensity >= 1.0) bonuses.push(`CODE_BLOCK_DENSITY=${signals.codeBlockDensity}`);
  if (fm.valid) bonuses.push('FRONTMATTER_VALID');
  if (frontLoaded) bonuses.push('FRONT_LOADED_ACTIONABLE');
  if (anchorDensity > 0) bonuses.push(`ANCHOR_DENSITY=${signals.anchorDensity}`);

  // Yellow flags (no score impact, advisory only — per Anthropic skill-creator):
  // ALL-CAPS rule words (ALWAYS/NEVER/MUST) >3× signal scolding voice that
  // models can drift past. Skill-creator: "reframe with why."
  const yellow_flags = [];
  const allCapsCount = (content.match(ALL_CAPS_RULE_RE) || []).length;
  if (allCapsCount > 3) {
    yellow_flags.push(`ALL_CAPS_RULES x${allCapsCount} (consider reframing with why)`);
  }

  return { score, signals, penalties, bonuses, yellow_flags };
}

module.exports = {
  scoreMarkdown,
  SIGNAL_WEIGHTS,
  // exported for test instrumentation only:
  _internal: {
    parseFrontmatter,
    countCodeBlocks,
    countHeadings,
    URL_NAV_RE,
    FRONTLOAD_WINDOW,
    PROSE_HEAVY_RATIO,
  },
};
