'use strict';

// Sprint 2.9 — cortex-x tools palette index.
// Single entry point: requiring this file returns the canonical 6-tool palette
// + the validator + the adapter map. Sprint 2.9.5 adds webfetch/websearch.

const read = require('./read.cjs');
const write = require('./write.cjs');
const edit = require('./edit.cjs');
const glob = require('./glob.cjs');
const grep = require('./grep.cjs');
const bash = require('./bash.cjs');

const { validateDescriptor, validateAll, CODES } = require('./_lib/validate-descriptor.cjs');

const TOOLS = Object.freeze([read, write, edit, glob, grep, bash]);

// Sprint 2.9 R2 fix (security CRITICAL + blind LOW): null-prototype map
// so a future tool literally named '__proto__' cannot pollute Object.prototype.
const TOOL_BY_NAME = (() => {
  const map = Object.create(null);
  for (const t of TOOLS) map[t.name] = t;
  return Object.freeze(map);
})();

// Map module filename → expected name; used by validatePaletteAtLoad to
// catch filename/name drift (Sprint 2.9 R2 fix correctness BLOCKER + acceptance partial).
const FILENAME_BY_TOOL = Object.freeze({
  read: 'read.cjs',
  write: 'write.cjs',
  edit: 'edit.cjs',
  glob: 'glob.cjs',
  grep: 'grep.cjs',
  bash: 'bash.cjs',
});

// Eager-validate the shipped palette at require-time. Surface errors loudly
// during development; production loads fail-fast, not silently.
function validatePaletteAtLoad() {
  for (const t of TOOLS) {
    const expected = FILENAME_BY_TOOL[t.name];
    const result = validateDescriptor(t, expected ? { expectedFilename: expected } : {});
    if (!result.ok) {
      throw new Error(`cortex tool palette failed validation: ${t.name} → ${result.code} (${result.message})`);
    }
  }
  // Aggregate uniqueness check.
  const result = validateAll(TOOLS);
  if (!result.ok) {
    const codes = result.errors.map((e) => `${e.descriptorName || '?'}:${e.code}`).join(', ');
    throw new Error(`cortex tool palette failed aggregate validation: ${codes}`);
  }
}
validatePaletteAtLoad();

module.exports = {
  TOOLS,
  TOOL_BY_NAME,
  validateDescriptor,
  validateAll,
  CODES,
};
