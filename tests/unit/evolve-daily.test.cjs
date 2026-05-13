// evolve-daily.test.cjs — Sprint 2.19 detector + action handler tests.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const detector = require('../../detectors/evolve-daily.cjs');
const action = require('../../bin/steward/_lib/evolve-action.cjs');
const actionKinds = require('../../bin/steward/_lib/action-kinds.cjs');

function tmpRepo(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-evolve-${name}-`));
  fs.mkdirSync(path.join(root, 'journal'));
  fs.mkdirSync(path.join(root, 'insights'));
  fs.mkdirSync(path.join(root, 'insights', 'proposals'));
  fs.mkdirSync(path.join(root, 'cortex'));
  fs.mkdirSync(path.join(root, 'cortex', 'projects'));
  return root;
}

function writeJsonl(repo, date, project, lines) {
  const fname = `${date}-${project}.jsonl`;
  fs.writeFileSync(path.join(repo, 'journal', fname), lines.map((l) => JSON.stringify(l)).join('\n'), 'utf8');
}

describe('Sprint 2.19 — evolve_daily detector', () => {
  test('isJsonlFile regex matches canonical names + rejects garbage', () => {
    assert.equal(detector.isJsonlFile('2026-05-13-cortex-x.jsonl'), true);
    assert.equal(detector.isJsonlFile('2026-05-13-replayagent.jsonl'), true);
    assert.equal(detector.isJsonlFile('README.md'), false);
    assert.equal(detector.isJsonlFile('garbage.jsonl'), false);
    assert.equal(detector.isJsonlFile('2026-05-13.jsonl'), false); // missing project segment
  });

  test('safeReadJsonl counts valid lines + flags malformed', () => {
    const repo = tmpRepo('jsonl-parse');
    writeJsonl(repo, '2026-05-13', 'cortex-x', [
      { ts: '2026-05-13T10:00:00Z', tool: 'Bash', ok: true },
      { ts: '2026-05-13T10:05:00Z', tool: 'Read', ok: true },
    ]);
    const fp = path.join(repo, 'journal', '2026-05-13-cortex-x.jsonl');
    const parsed = detector.safeReadJsonl(fp);
    assert.equal(parsed.lines, 2);
    assert.equal(parsed.malformed.length, 0);
  });

  test('runEvolveDaily — fresh tree returns no_actionable_step-shaped output', () => {
    const repo = tmpRepo('fresh');
    writeJsonl(repo, '2026-05-13', 'cortex-x', [
      { ts: '2026-05-13T10:00:00Z', tool: 'Bash', ok: true },
    ]);
    const result = detector.runEvolveDaily({ repoRoot: repo, now: new Date('2026-05-13T12:00:00Z') });
    assert.equal(result.ok, true);
    assert.equal(result.journal_summary.files_scanned, 1);
    assert.equal(result.journal_summary.total_entries, 1);
    assert.equal(result.journal_summary.total_malformed, 0);
    assert.equal(result.stale_candidates.length, 0);
    assert.match(result.rollup_markdown, /Daily evolve rollup/);
    assert.match(result.rollup_markdown, /Dreaming.*OpenClaw/);
  });

  test('runEvolveDaily — flags malformed journal lines', () => {
    const repo = tmpRepo('malformed');
    const fname = '2026-05-13-cortex-x.jsonl';
    fs.writeFileSync(
      path.join(repo, 'journal', fname),
      '{"ts":"2026-05-13T10:00:00Z"}\n{not_valid_json}\n{}\n',
      'utf8',
    );
    const result = detector.runEvolveDaily({ repoRoot: repo, now: new Date('2026-05-13T12:00:00Z') });
    assert.equal(result.journal_summary.total_entries, 1);
    assert.equal(result.journal_summary.total_malformed, 2);
    assert.equal(result.journal_summary.malformed_refs.length, 1);
  });

  test('runEvolveDaily — flags stale insight past 30d threshold', () => {
    const repo = tmpRepo('stale-insight');
    const stalePath = path.join(repo, 'insights', '2026-03-01-old-insight.md');
    fs.writeFileSync(stalePath, '# old', 'utf8');
    // backdate mtime to 50 days ago relative to fixed now
    const now = new Date('2026-05-13T00:00:00Z');
    const fiftyDaysAgo = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, fiftyDaysAgo, fiftyDaysAgo);
    const result = detector.runEvolveDaily({ repoRoot: repo, now });
    assert.equal(result.stale_candidates.length, 1);
    assert.equal(result.stale_candidates[0].kind, 'insight');
    assert.equal(result.stale_candidates[0].age_days, 50);
  });

  test('runEvolveDaily — flags stale project entry past 90d threshold', () => {
    const repo = tmpRepo('stale-project');
    const stalePath = path.join(repo, 'cortex', 'projects', 'old-project.md');
    fs.writeFileSync(stalePath, '# project', 'utf8');
    const now = new Date('2026-05-13T00:00:00Z');
    const hundredDaysAgo = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    fs.utimesSync(stalePath, hundredDaysAgo, hundredDaysAgo);
    const result = detector.runEvolveDaily({ repoRoot: repo, now });
    assert.equal(result.stale_candidates.length, 1);
    assert.equal(result.stale_candidates[0].kind, 'project_entry');
    assert.equal(result.stale_candidates[0].path, 'cortex/projects/old-project.md');
  });

  test('runEvolveDaily — README.md inside insights/ is skipped', () => {
    const repo = tmpRepo('skip-readme');
    const readme = path.join(repo, 'insights', 'README.md');
    fs.writeFileSync(readme, '# README', 'utf8');
    const now = new Date('2026-05-13T00:00:00Z');
    const longAgo = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
    fs.utimesSync(readme, longAgo, longAgo);
    const result = detector.runEvolveDaily({ repoRoot: repo, now });
    assert.equal(result.stale_candidates.length, 0);
  });

  test('runEvolveDaily — missing journal/ directory does not crash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-evolve-empty-'));
    const result = detector.runEvolveDaily({ repoRoot: root, now: new Date() });
    assert.equal(result.ok, true);
    assert.equal(result.journal_summary.files_scanned, 0);
  });
});

describe('Sprint 2.19 — evolve_daily action handler', () => {
  test('runEvolveDaily writes rollup to insights/proposals/ when dir exists', async () => {
    const repo = tmpRepo('action-writes');
    writeJsonl(repo, '2026-05-13', 'cortex-x', [
      { ts: '2026-05-13T10:00:00Z', tool: 'Bash', ok: true },
    ]);
    const result = await action.runEvolveDaily({
      repoRoot: repo,
      slug: 'cortex-x',
      now: new Date('2026-05-13T12:00:00Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, true);
    assert.equal(result.rollup_path, 'insights/proposals/2026-05-13-evolve-daily.md');
    const written = fs.readFileSync(path.join(repo, result.rollup_path), 'utf8');
    assert.match(written, /Daily evolve rollup — 2026-05-13/);
    assert.deepEqual(result.touchedFiles, []);
  });

  test('runEvolveDaily fail-opens when insights/proposals/ is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-evolve-no-proposals-'));
    fs.mkdirSync(path.join(root, 'journal'));
    writeJsonl(root, '2026-05-13', 'cortex-x', [
      { ts: '2026-05-13T10:00:00Z', tool: 'Bash', ok: true },
    ]);
    const result = await action.runEvolveDaily({
      repoRoot: root,
      slug: 'cortex-x',
      now: new Date('2026-05-13T12:00:00Z'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.skip_commit, true);
    assert.equal(result.rollup_path, null);
    assert.match(result.summary, /no rollup written/);
  });
});

describe('Sprint 2.19 — evolve_daily action_kind registry', () => {
  test('evolve_daily is registered + shipped', () => {
    assert.equal(actionKinds.isSupportedKind('evolve_daily'), true);
    assert.equal(actionKinds.isShippedKind('evolve_daily'), true);
    const kind = actionKinds.getActionKind('evolve_daily');
    assert.equal(kind.requires_llm, false);
    assert.equal(kind.cost_envelope, 'free');
    assert.equal(kind.detector, 'detectors/evolve-daily.cjs');
  });

  test('evolve_daily acceptance criteria enforce writes-only-to-proposals invariant', () => {
    const kind = actionKinds.getActionKind('evolve_daily');
    const ids = kind.acceptance_criteria.map((c) => c.id);
    assert.ok(ids.includes('evolve_daily_rollup_writes_under_proposals'));
    assert.ok(ids.includes('evolve_daily_audit_only_ears'));
    const earsCrit = kind.acceptance_criteria.find((c) => c.kind === 'ears_text');
    assert.match(earsCrit.ears, /SHALL only write under insights\/proposals/);
  });
});
