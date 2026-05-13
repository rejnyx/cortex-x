// bin/steward/_lib/rubric-extractor.cjs — Sprint 3.0 v2
//
// Pure-deterministic parser that extracts the `## Expected properties`
// rubric from an eval task body and returns it as a structured object
// the judge LLM can score against.
//
// Eval task body shape (existing evals/eval-*.md):
//
//   ## Expected properties
//
//   ### Must have
//   - [ ] property A
//   - [ ] property B
//
//   ### Must NOT have
//   - [ ] property C
//
//   ### Should have
//   - [ ] property D
//
// Output:
//   {
//     must_have:     [{ id: "must-have-1", text: "property A" }, ...],
//     must_not_have: [{ id: "must-not-have-1", text: "property C" }, ...],
//     should_have:   [{ id: "should-have-1", text: "property D" }, ...],
//   }
//
// Ids are stable across runs (positional) so the judge schema can pin
// per-item booleans and the harness recomputes scores deterministically
// from those booleans (judge can't fudge the math).

'use strict';

const SECTION_RE = /^###\s+(Must have|Must NOT have|Should have)\s*$/i;
const BULLET_RE = /^-\s+\[[ x]\]\s+(.+)$/;

function slugifyTag(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Extract the rubric from an eval task body.
 * @param {string} body — full markdown body (after frontmatter)
 * @returns {object} { must_have[], must_not_have[], should_have[] }
 */
function extractRubric(body) {
  const result = {
    must_have: [],
    must_not_have: [],
    should_have: [],
  };
  if (typeof body !== 'string' || body.length === 0) return result;

  const lines = body.split(/\r?\n/);
  let inExpected = false;
  let currentSection = null;
  let perSectionCounters = { must_have: 0, must_not_have: 0, should_have: 0 };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Enter the "## Expected properties" section
    if (/^##\s+Expected properties\s*$/i.test(line)) {
      inExpected = true;
      currentSection = null;
      continue;
    }
    // Leave on next ## heading (excluding ### subheadings)
    if (inExpected && /^##\s+/.test(line) && !line.startsWith('### ')) {
      break;
    }
    if (!inExpected) continue;

    // Subsection header
    const secMatch = line.match(SECTION_RE);
    if (secMatch) {
      const tag = secMatch[1].toLowerCase();
      if (tag === 'must have') currentSection = 'must_have';
      else if (tag === 'must not have') currentSection = 'must_not_have';
      else if (tag === 'should have') currentSection = 'should_have';
      else currentSection = null;
      continue;
    }

    if (!currentSection) continue;

    // Bullet line
    const bulletMatch = line.match(BULLET_RE);
    if (!bulletMatch) continue;
    const text = bulletMatch[1].trim();
    if (!text) continue;
    perSectionCounters[currentSection] += 1;
    const idPrefix = currentSection.replace(/_/g, '-');
    result[currentSection].push({
      id: `${idPrefix}-${perSectionCounters[currentSection]}`,
      text,
    });
  }

  return result;
}

/**
 * Score a parsed rubric against judge-returned per-item booleans.
 * Pure math, deterministic — judge LLM cannot fudge the score because
 * the harness recomputes from booleans, not from a judge-provided
 * `raw_score` field.
 *
 * Weights (Sprint 3.0 v2 default):
 *   must_have:     1.0 / count_must_have
 *   should_have:   0.5 / count_should_have
 *   must_not_have: -1.0 / count_must_not_have (negative; violations subtract)
 *
 * Final score clamped to [0, 1]. Refusal detection (judge sets
 * refusal_detected:true) → score 0 regardless of booleans.
 *
 * @param {object} rubric — from extractRubric()
 * @param {object} judgeOutput — { must_have: [{id,pass}], should_have: [{id,pass}], must_not_have: [{id,violated}], refusal_detected }
 * @returns {object} { score: 0..1, breakdown }
 */
function scoreFromRubric(rubric, judgeOutput) {
  if (judgeOutput && judgeOutput.refusal_detected === true) {
    return { score: 0, breakdown: { refusal_detected: true } };
  }

  const must = (rubric && rubric.must_have) || [];
  const should = (rubric && rubric.should_have) || [];
  const mustNot = (rubric && rubric.must_not_have) || [];

  // Build judge maps
  const judgeMust = new Map();
  const judgeShould = new Map();
  const judgeMustNot = new Map();
  if (judgeOutput && Array.isArray(judgeOutput.must_have)) {
    for (const it of judgeOutput.must_have) judgeMust.set(it && it.id, !!(it && it.pass));
  }
  if (judgeOutput && Array.isArray(judgeOutput.should_have)) {
    for (const it of judgeOutput.should_have) judgeShould.set(it && it.id, !!(it && it.pass));
  }
  if (judgeOutput && Array.isArray(judgeOutput.must_not_have)) {
    for (const it of judgeOutput.must_not_have) judgeMustNot.set(it && it.id, !!(it && it.violated));
  }

  const mustPass = must.filter((r) => judgeMust.get(r.id)).length;
  const shouldPass = should.filter((r) => judgeShould.get(r.id)).length;
  const mustNotViolations = mustNot.filter((r) => judgeMustNot.get(r.id)).length;

  // Weighted score
  const mustWeight = must.length > 0 ? 1.0 : 0;
  const shouldWeight = should.length > 0 ? 0.5 : 0;
  const mustNotWeight = mustNot.length > 0 ? 1.0 : 0;
  const totalWeight = mustWeight + shouldWeight + mustNotWeight;
  if (totalWeight === 0) return { score: 0, breakdown: { reason: 'EMPTY_RUBRIC' } };

  const mustScore = must.length > 0 ? (mustPass / must.length) * mustWeight : 0;
  const shouldScore = should.length > 0 ? (shouldPass / should.length) * shouldWeight : 0;
  const mustNotScore = mustNot.length > 0
    ? ((mustNot.length - mustNotViolations) / mustNot.length) * mustNotWeight : 0;

  const raw = (mustScore + shouldScore + mustNotScore) / totalWeight;
  const score = Math.max(0, Math.min(1, raw));

  return {
    score,
    breakdown: {
      must_have: { pass: mustPass, total: must.length },
      should_have: { pass: shouldPass, total: should.length },
      must_not_have: { violations: mustNotViolations, total: mustNot.length },
      weights: { must: mustWeight, should: shouldWeight, must_not: mustNotWeight },
    },
  };
}

module.exports = {
  extractRubric,
  scoreFromRubric,
  // exported for tests
  slugifyTag,
};
