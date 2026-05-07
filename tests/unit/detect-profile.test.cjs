// detect-profile.test.cjs — every shipped profile matches its fixture.
//
// Fixtures live in tests/fixtures/<profile>-mini/ as real-shape mini projects
// (package.json + minimum auxiliary files to satisfy the profile's detect:
// block). The detector spawns as a child process with --cwd pointed at the
// fixture and CORTEX_HOME pointed at the repo (so it finds the in-repo
// profiles, not whatever is in ~/.claude/shared/profiles).
//
// Invariants asserted per fixture:
//   1. The expected profile is the top-1 candidate
//   2. The score is at or above the floor (default 0.7)
//   3. The confidence is at least 'medium' (or as configured per-fixture)
//
// Edge case fixtures (minimal-mini, monorepo-edge) have explicit lower
// expectations because they intentionally don't match any single profile
// strongly — they exercise the fail-graceful path.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runDetector } = require('../_helpers/run-detector.cjs');

const EXPECTATIONS = [
  { fixture: 'nextjs-saas-mini',     topMatch: 'nextjs-saas',      minScore: 1.0, minConfidence: 'high' },
  { fixture: 'ai-agent-mini',        topMatch: 'ai-agent',         minScore: 1.0, minConfidence: 'high' },
  { fixture: 'astro-static-mini',    topMatch: 'astro-static',     minScore: 1.0, minConfidence: 'high' },
  { fixture: 'browser-agent-mini',   topMatch: 'browser-agent',    minScore: 0.9, minConfidence: 'high' },
  { fixture: 'chatbot-platform-mini',topMatch: 'chatbot-platform', minScore: 1.0, minConfidence: 'high' },
  { fixture: 'cli-tool-mini',        topMatch: 'cli-tool',         minScore: 1.0, minConfidence: 'high' },
  { fixture: 'kiosek-mini',          topMatch: 'kiosek',           minScore: 1.0, minConfidence: 'high' },
  { fixture: 'tauri-desktop-mini',   topMatch: 'tauri-desktop',    minScore: 0.6, minConfidence: 'medium' },
  { fixture: 'waas-template-mini',   topMatch: 'waas-template',    minScore: 0.5, minConfidence: 'low' },
];

const CONFIDENCE_RANK = { none: 0, low: 1, medium: 2, high: 3 };

for (const exp of EXPECTATIONS) {
  test(`detect-profile: ${exp.fixture} → ${exp.topMatch}`, () => {
    const result = runDetector('profile', `tests/fixtures/${exp.fixture}`);
    assert.ok(Array.isArray(result.candidates), 'detector must return { candidates: [] }');
    assert.ok(result.candidates.length >= 5, `expected >=5 candidates ranked, got ${result.candidates.length}`);

    const top = result.candidates[0];
    assert.equal(
      top.name,
      exp.topMatch,
      `expected top-1 = ${exp.topMatch}, got ${top.name} (score ${top.score}); full ranking: ${result.candidates.slice(0, 3).map((c) => `${c.name}:${c.score}`).join(', ')}`
    );
    assert.ok(
      top.score >= exp.minScore,
      `expected score >= ${exp.minScore}, got ${top.score}`
    );
    assert.ok(
      CONFIDENCE_RANK[top.confidence] >= CONFIDENCE_RANK[exp.minConfidence],
      `expected confidence >= ${exp.minConfidence}, got ${top.confidence}`
    );
  });
}

// Edge case: minimal-mini has no detect signals and is the explicit fallback.
// Assert the detector doesn't crash and returns SOME candidates (with low scores).
test('detect-profile: minimal-mini does not crash, returns ranked candidates', () => {
  const result = runDetector('profile', 'tests/fixtures/minimal-mini');
  assert.ok(Array.isArray(result.candidates));
  assert.ok(result.candidates.length >= 5);
  // No assertion on which profile wins — minimal has no detect block, all
  // profiles tie at score 0 and the order is alphabetical.
  for (const c of result.candidates) {
    assert.ok(typeof c.score === 'number');
    assert.ok(typeof c.name === 'string');
  }
});

// Edge case: monorepo-edge has package.json with workspaces — top match
// should not crash, but score will be moderate (sub-package deps bubble up).
test('detect-profile: monorepo-edge does not crash', () => {
  const result = runDetector('profile', 'tests/fixtures/monorepo-edge');
  assert.ok(Array.isArray(result.candidates));
  assert.ok(result.candidates.length >= 5);
});

// Contract: every shipped profile YAML appears in the detector candidate list
// at least once when the detector runs against ANY fixture. This catches
// "profile YAML failed to load" silently — exactly the bug schema test
// surfaced for browser-agent on 2026-05-07.
test('detect-profile: all shipped profiles appear in candidate list', () => {
  const result = runDetector('profile', 'tests/fixtures/minimal-mini');
  const candidateNames = new Set(result.candidates.map((c) => c.name));
  const expectedProfiles = [
    'ai-agent', 'astro-static', 'browser-agent', 'chatbot-platform',
    'cli-tool', 'kiosek', 'minimal', 'nextjs-saas', 'tauri-desktop',
    'waas-template',
  ];
  for (const name of expectedProfiles) {
    assert.ok(
      candidateNames.has(name),
      `Profile ${name} missing from detector candidates — likely a YAML parse failure. Seen: ${[...candidateNames].join(', ')}`
    );
  }
});
