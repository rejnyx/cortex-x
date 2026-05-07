// denylist-examples.cjs — opt-out marker for PII denylist scans.
//
// Three sightings of self-referential PII bugs (Tier 5 fixture README,
// Tier 7 ship-ready.md, cortex-doctor §13.7) showed the same anti-pattern:
// docs explain a denylist by quoting forbidden strings, the regex catches
// its own documentation. Each fix was per-file string-replace ("davidrajnoha@"
// → "the maintainer's email"). Bad: docs become wishy-washy + future writers
// repeat the bug.
//
// Solution: a single-line opt-out marker validators honor before scanning.
//
//   The PII regex matches `davidrajnoha@example.com` <!-- denylist-example -->
//
// Any line containing the marker is excluded from PII scanning. The marker
// MUST be on the same line as the example string. Multi-line opt-out blocks
// are intentionally NOT supported — granular per-line opt-out forces authors
// to think about each example.
//
// Used by: tools/verify-prompts.cjs, tools/verify-skills.cjs,
//          tools/verify-standards.cjs.

'use strict';

const DENYLIST_EXAMPLE_MARKER = /<!--\s*denylist-example\s*-->/i;

// Strip any line containing the denylist-example marker.
// Returns the content with marker-bearing lines removed (replaced with
// empty strings to preserve line numbers in error messages).
function stripDenylistExamples(content) {
  if (!content || typeof content !== 'string') return content;
  return content
    .split('\n')
    .map((line) => (DENYLIST_EXAMPLE_MARKER.test(line) ? '' : line))
    .join('\n');
}

// Return the count of marker-bearing lines (for tests + observability).
function countMarkers(content) {
  if (!content || typeof content !== 'string') return 0;
  return content.split('\n').filter((l) => DENYLIST_EXAMPLE_MARKER.test(l)).length;
}

module.exports = {
  DENYLIST_EXAMPLE_MARKER,
  stripDenylistExamples,
  countMarkers,
};
