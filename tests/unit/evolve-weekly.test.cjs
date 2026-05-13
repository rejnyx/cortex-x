// evolve-weekly.test.cjs — Sprint 2.19 v1

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const detector = require('../../detectors/evolve-weekly.cjs');
const action = require('../../bin/steward/_lib/evolve-weekly-action.cjs');
const actionKinds = require('../../bin/steward/_lib/action-kinds.cjs');

function tmpRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-evolve-w-${name}-`));
  fs.mkdirSync(path.join(root, 'journal'));
  fs.mkdirSync(path.join(root, 'insights'));
  fs.mkdirSync(path.join(root, 'insights', 'proposals'));
  return root;
}

function writeJournal(repo, isoDate, project, events) {
  const fname = `${isoDate}-${project}.jsonl`;
  const content = events.map((e) => JSON.stringify({ ts: `${isoDate}T10:00:00Z`, ...e })).join('\n');
  fs.writeFileSync(path.join(repo, 'journal', fname), content, 'utf8');
}

describe('Sprint 2.19 v1 — evolve-weekly detector', () => {
  test('returns empty when journal dir missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-journal-'));
    const r = detector.mineWeeklyCandidates({ repoRoot: root });
    assert.equal(r.ok, true);
    assert.equal(r.candidates.length, 0);
  });

  test('mines candidate that meets all 3 evidence gates', () => {
    const repo = tmpRepo('happy');
    const now = new Date('2026-05-20T00:00:00Z');
    // 3 events, 2 projects, 8-day span
    writeJournal(repo, '2026-05-10', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-15', 'projB', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-18', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].root_cause, 'TIMEOUT');
    assert.equal(r.candidates[0].events, 3);
    assert.equal(r.candidates[0].projects.length, 2);
  });

  test('rejects when events < min_events', () => {
    const repo = tmpRepo('low-events');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-15', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-16', 'projB', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.candidates.length, 0); // 2 events < 3
  });

  test('rejects when projects < min_projects', () => {
    const repo = tmpRepo('low-projects');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-13', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-18', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.candidates.length, 0); // 1 project < 2
  });

  test('rejects when days_span < min_days_span', () => {
    const repo = tmpRepo('low-span');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-18', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-19', 'projB', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-19', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.candidates.length, 0); // 1-day span < 7
  });

  test('skips success-outcome events', () => {
    const repo = tmpRepo('success');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'success' },
    ]);
    writeJournal(repo, '2026-05-15', 'projB', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'success' },
    ]);
    writeJournal(repo, '2026-05-18', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'success' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.candidates.length, 0);
  });

  test('window excludes events older than 14 days', () => {
    const repo = tmpRepo('window');
    const now = new Date('2026-05-20T00:00:00Z');
    // 30 days ago — outside window
    writeJournal(repo, '2026-04-20', 'projA', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    writeJournal(repo, '2026-05-15', 'projB', [
      { code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' },
    ]);
    const r = detector.mineWeeklyCandidates({ repoRoot: repo, now });
    assert.equal(r.window_files, 1);
  });
});

describe('Sprint 2.19 v1 — validator schema validation', () => {
  test('accepts well-formed insight verdict', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'Pattern shows structural cause',
      verdict: 'insight',
      confidence: 0.85,
      rule: 'Validate config before action',
      transferable_to: ['nextjs-saas'],
    });
    assert.equal(out.ok, true);
  });

  test('accepts well-formed noise verdict with null rule', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'just network flakes',
      verdict: 'noise',
      confidence: 0.4,
      rule: null,
      transferable_to: [],
    });
    assert.equal(out.ok, true);
  });

  test('rejects invalid verdict', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x', verdict: 'maybe', confidence: 0.5, rule: null, transferable_to: [],
    });
    assert.equal(out.ok, false);
  });

  test('rejects confidence outside [0,1]', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x', verdict: 'insight', confidence: 1.5, rule: 'x', transferable_to: [],
    });
    assert.equal(out.ok, false);
  });

  test('rejects non-array transferable_to', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x', verdict: 'insight', confidence: 0.8, rule: 'x', transferable_to: 'foo',
    });
    assert.equal(out.ok, false);
  });
});

describe('Sprint 2.19 v1 — runEvolveWeekly integration', () => {
  test('returns no_work when zero candidates pass evidence gates', async () => {
    const repo = tmpRepo('no-candidates');
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now: new Date('2026-05-20T00:00:00Z'),
      validateImpl: async () => { throw new Error('should not be called'); },
    });
    assert.equal(result.ok, true);
    assert.equal(result.no_work, true);
    assert.equal(result.skip_commit, true);
    assert.deepEqual(result.proposals_written, []);
  });

  test('writes proposal for surviving + insight-classified candidate', async () => {
    const repo = tmpRepo('insight');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [{ code: 'KEY_MISSING', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-15', 'projB', [{ code: 'KEY_MISSING', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-18', 'projA', [{ code: 'KEY_MISSING', action_kind: 'recommendation', outcome: 'failure' }]);
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now,
      validateImpl: async () => ({
        ok: true,
        judge: { reasoning: 'structural', verdict: 'insight', confidence: 0.9, rule: 'validate key', transferable_to: [] },
        cost_usd: 0.001,
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.proposals_written.length, 1);
    const written = fs.readFileSync(path.join(repo, result.proposals_written[0]), 'utf8');
    assert.match(written, /type: repeated-mistake/);
    assert.match(written, /KEY_MISSING/);
  });

  test('skips proposal when validator returns noise', async () => {
    const repo = tmpRepo('noise');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [{ code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-15', 'projB', [{ code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-18', 'projA', [{ code: 'TIMEOUT', action_kind: 'recommendation', outcome: 'failure' }]);
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now,
      validateImpl: async () => ({
        ok: true,
        judge: { reasoning: 'network flaky', verdict: 'noise', confidence: 0.4, rule: null, transferable_to: [] },
        cost_usd: 0.001,
      }),
    });
    assert.equal(result.proposals_written.length, 0);
    assert.equal(result.no_work, true);
  });

  test('caps at MAX_INSIGHTS_PER_RUN candidates validated', async () => {
    const repo = tmpRepo('cap');
    const now = new Date('2026-05-20T00:00:00Z');
    // Create 5 distinct candidates that all pass evidence gates
    for (let i = 0; i < 5; i += 1) {
      const code = `ERR_${i}`;
      writeJournal(repo, '2026-05-10', `projA${i}`, [{ code, action_kind: 'recommendation', outcome: 'failure' }]);
      writeJournal(repo, '2026-05-15', `projB${i}`, [{ code, action_kind: 'recommendation', outcome: 'failure' }]);
      writeJournal(repo, '2026-05-18', `projA${i}`, [{ code, action_kind: 'recommendation', outcome: 'failure' }]);
    }
    let validatorCalls = 0;
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now,
      validateImpl: async () => {
        validatorCalls += 1;
        return { ok: true, judge: { reasoning: 'x', verdict: 'noise', confidence: 0.4, rule: null, transferable_to: [] }, cost_usd: 0 };
      },
    });
    assert.equal(validatorCalls, 3); // MAX_INSIGHTS_PER_RUN cap
  });
});

describe('Sprint 2.19 v1 R2 — security hardening', () => {
  test('touchedFiles reflects actually-written proposals (R2 HIGH Finding 0)', async () => {
    const repo = tmpRepo('touchedFiles-real');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-15', 'projB', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-18', 'projA', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now,
      validateImpl: async () => ({
        ok: true,
        judge: { reasoning: 'r', verdict: 'insight', confidence: 0.9, rule: 'do x', transferable_to: [] },
        cost_usd: 0.001,
      }),
    });
    // touchedFiles must equal proposals_written (was [] pre-fix — decorative criterion)
    assert.deepEqual(result.touchedFiles, result.proposals_written);
    assert.equal(result.touchedFiles.length, 1);
    assert.match(result.touchedFiles[0], /^insights\/proposals\//);
  });

  test('validator rule.length capped at 500 chars (R2 MED Q4)', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x',
      verdict: 'insight',
      confidence: 0.8,
      rule: 'y'.repeat(600),
      transferable_to: [],
    });
    assert.equal(out.ok, false);
    assert.equal(out.path, 'rule');
  });

  test('validator transferable_to capped at 10 items (R2 MED Q4)', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x',
      verdict: 'insight',
      confidence: 0.8,
      rule: 'y',
      transferable_to: Array.from({ length: 11 }, (_, i) => `item${i}`),
    });
    assert.equal(out.ok, false);
    assert.equal(out.path, 'transferable_to');
  });

  test('validator transferable_to item.length capped at 80 chars (R2 MED Q4)', () => {
    const out = action.validateValidatorOutput({
      reasoning: 'x',
      verdict: 'insight',
      confidence: 0.8,
      rule: 'y',
      transferable_to: ['x'.repeat(100)],
    });
    assert.equal(out.ok, false);
    assert.match(out.path, /transferable_to\[0\]/);
  });

  test('proposal markdown sanitizes frontmatter injection in validator output', async () => {
    const repo = tmpRepo('sanitize');
    const now = new Date('2026-05-20T00:00:00Z');
    writeJournal(repo, '2026-05-10', 'projA', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-15', 'projB', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    writeJournal(repo, '2026-05-18', 'projA', [{ code: 'X', action_kind: 'recommendation', outcome: 'failure' }]);
    const result = await action.runEvolveWeekly({
      repoRoot: repo,
      slug: 'cortex-x',
      now,
      validateImpl: async () => ({
        ok: true,
        judge: {
          reasoning: 'normal\n---\nspoofed: frontmatter',
          verdict: 'insight',
          confidence: 0.9,
          rule: 'rule\n## Fake heading',
          transferable_to: [],
        },
        cost_usd: 0.001,
      }),
    });
    assert.equal(result.proposals_written.length, 1);
    const written = fs.readFileSync(path.join(repo, result.proposals_written[0]), 'utf8');
    // Frontmatter forgery neutralized (escaped, not bare `---`)
    const frontmatterEnds = (written.match(/^---\s*$/gm) || []).length;
    assert.equal(frontmatterEnds, 2); // only the 2 legitimate frontmatter delimiters
    // Heading-override neutralized
    assert.match(written, /\\## Fake heading/);
  });
});

describe('Sprint 2.19 v1 — evolve_weekly action_kind registry', () => {
  test('evolve_weekly is registered + shipped', () => {
    assert.equal(actionKinds.isSupportedKind('evolve_weekly'), true);
    assert.equal(actionKinds.isShippedKind('evolve_weekly'), true);
    const kind = actionKinds.getActionKind('evolve_weekly');
    assert.equal(kind.requires_llm, true);
    assert.equal(kind.cost_envelope, 'low');
  });
});
