'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseSince,
  readJsonlSafe,
  rollupClaudeJsonl,
  rollupStewardJournal,
  findUnused,
  estimateCostUsd,
  buildReport,
  renderMarkdown,
} = require('../../bin/cortex-insights.cjs');

const NOW_MS = Date.parse('2026-05-14T12:00:00Z');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-insights-'));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n'));
}

test('parseSince: default 7d', () => {
  const r = parseSince(undefined, NOW_MS);
  assert.equal(r.ok, true);
  assert.equal(r.label, '7d');
  assert.equal(r.sinceMs, NOW_MS - 7 * 24 * 3600 * 1000);
});

test('parseSince: 30d window', () => {
  const r = parseSince('30d', NOW_MS);
  assert.equal(r.ok, true);
  assert.equal(r.label, '30d');
  assert.equal(r.sinceMs, NOW_MS - 30 * 24 * 3600 * 1000);
});

test('parseSince: absolute YYYY-MM-DD', () => {
  const r = parseSince('2026-04-01', NOW_MS);
  assert.equal(r.ok, true);
  assert.equal(r.label, '2026-04-01');
  assert.equal(r.sinceMs, Date.parse('2026-04-01T00:00:00Z'));
});

test('parseSince: malformed input rejected', () => {
  assert.equal(parseSince('next week', NOW_MS).ok, false);
  assert.equal(parseSince('30days', NOW_MS).ok, false);
  assert.equal(parseSince('999999d', NOW_MS).ok, false);
});

test('readJsonlSafe: skips malformed lines', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'test.jsonl');
  fs.writeFileSync(f, [
    '{"ok": true}',
    'not json here',
    '',
    '{"ok": false}',
    '   ',
    'plain text debug line',
  ].join('\n'));
  const rows = readJsonlSafe(f);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[1].ok, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('readJsonlSafe: returns [] for missing file', () => {
  assert.deepEqual(readJsonlSafe('/nonexistent/file.jsonl'), []);
});

test('readJsonlSafe: CRLF lines parse cleanly', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'crlf.jsonl');
  fs.writeFileSync(f, '{"ok":true}\r\n{"ok":false}\r\n');
  const rows = readJsonlSafe(f);
  assert.equal(rows.length, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rollupClaudeJsonl: counts skill invocations', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-05-14T08:00:00Z', skill_name: 'cortex-doctor' },
    { timestamp: '2026-05-14T08:01:00Z', skill_name: 'cortex-doctor' },
    { timestamp: '2026-05-14T08:02:00Z', skill_name: 'audit' },
    { timestamp: '2026-05-14T08:03:00Z' },  // no skill
  ]);
  const r = rollupClaudeJsonl([f], NOW_MS - 7 * 24 * 3600 * 1000);
  assert.equal(r.skillsFired.get('cortex-doctor').count, 2);
  assert.equal(r.skillsFired.get('audit').count, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rollupClaudeJsonl: filters by since', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-04-01T08:00:00Z', skill_name: 'cortex-doctor' },  // way older
    { timestamp: '2026-05-14T08:00:00Z', skill_name: 'cortex-doctor' },
  ]);
  const r = rollupClaudeJsonl([f], Date.parse('2026-05-01T00:00:00Z'));
  assert.equal(r.skillsFired.get('cortex-doctor').count, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rollupClaudeJsonl: extracts slash-command from message content', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-05-14T08:00:00Z', message: { content: '/cortex-help' } },
    { timestamp: '2026-05-14T08:05:00Z', message: { content: '/audit' } },
    { timestamp: '2026-05-14T08:10:00Z', message: { content: '/audit again' } },
  ]);
  const r = rollupClaudeJsonl([f], NOW_MS - 7 * 24 * 3600 * 1000);
  assert.equal(r.promptsRun.get('cortex-help').count, 1);
  assert.equal(r.promptsRun.get('audit').count, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rollupClaudeJsonl: aggregates model usage', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-05-14T08:00:00Z', model: 'claude-opus-4-7', usage: { input_tokens: 1000, output_tokens: 500 } },
    { timestamp: '2026-05-14T08:01:00Z', model: 'claude-opus-4-7', usage: { input_tokens: 2000, output_tokens: 1000 } },
    { timestamp: '2026-05-14T08:02:00Z', model: 'claude-haiku-4-5', usage: { input_tokens: 5000, output_tokens: 100 } },
  ]);
  const r = rollupClaudeJsonl([f], NOW_MS - 7 * 24 * 3600 * 1000);
  const opus = r.modelCost.get('claude-opus-4-7');
  assert.equal(opus.input_tokens, 3000);
  assert.equal(opus.output_tokens, 1500);
  assert.ok(opus.est_cost_usd > 0);
  const haiku = r.modelCost.get('claude-haiku-4-5');
  assert.equal(haiku.input_tokens, 5000);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('estimateCostUsd: opus 4.7 rate', () => {
  // 1M input = $15, 1M output = $75 per the conservative rate table
  const cost = estimateCostUsd('claude-opus-4-7', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.equal(cost, 90);
});

test('estimateCostUsd: unknown model returns 0 (better undercount than overcount)', () => {
  assert.equal(estimateCostUsd('gpt-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 0);
});

test('estimateCostUsd: haiku rate', () => {
  const cost = estimateCostUsd('claude-haiku-4-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(cost, 1);
});

test('rollupStewardJournal: tallies action kinds + cost', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'journal.jsonl');
  writeJsonl(f, [
    { started_at: '2026-05-14T10:00:00Z', kind: 'dep_update_patch', status: 'success', cost_usd: 0.001 },
    { started_at: '2026-05-14T11:00:00Z', kind: 'dep_update_patch', status: 'failure', cost_usd: 0.0005, rollback: true },
    { started_at: '2026-05-14T12:00:00Z', kind: 'flaky_test_repair', status: 'success', cost_usd: 0.002 },
  ]);
  const r = rollupStewardJournal([f], NOW_MS - 7 * 24 * 3600 * 1000);
  const dep = r.actionsByKind.get('dep_update_patch');
  assert.equal(dep.count, 2);
  assert.equal(dep.succeeded, 1);
  assert.equal(dep.failed, 1);
  assert.equal(dep.rollbacks, 1);
  assert.equal(r.stewardCost.total_usd, 0.0035);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rollupStewardJournal: anomalies surface halt + breaker', () => {
  const tmp = tmpDir();
  const f = path.join(tmp, 'journal.jsonl');
  writeJsonl(f, [
    { started_at: '2026-05-14T08:00:00Z', kind: 'evolve_daily', status: 'success', cost_usd: 0.001, halt: true },
    { started_at: '2026-05-14T09:00:00Z', kind: 'flaky_test_repair', status: 'success', cost_usd: 0.001, breaker_trip: true },
  ]);
  const r = rollupStewardJournal([f], NOW_MS - 7 * 24 * 3600 * 1000);
  assert.equal(r.anomalies.length, 2);
  assert.ok(r.anomalies.some((a) => a.halt));
  assert.ok(r.anomalies.some((a) => a.breaker));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('findUnused: lists skills that did not fire', () => {
  const tmp = tmpDir();
  const skillsDir = path.join(tmp, 'shared', 'skills');
  fs.mkdirSync(path.join(skillsDir, 'cortex-doctor'), { recursive: true });
  fs.mkdirSync(path.join(skillsDir, 'cortex-help'), { recursive: true });
  fs.mkdirSync(path.join(skillsDir, 'audit'), { recursive: true });
  // No action-kinds.cjs in tmp tree, so unusedActionKinds should be []
  const used = new Set(['cortex-doctor']);
  const r = findUnused(tmp, used, new Set());
  assert.ok(r.unusedSkills.includes('cortex-help'));
  assert.ok(r.unusedSkills.includes('audit'));
  assert.ok(!r.unusedSkills.includes('cortex-doctor'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('buildReport: end-to-end synthetic fixtures', () => {
  const tmp = tmpDir();
  const claudeRoot = path.join(tmp, 'claude-projects');
  const cortexJournal = path.join(tmp, 'journal');
  const skillsRoot = path.join(tmp, 'shared', 'skills');
  fs.mkdirSync(path.join(skillsRoot, 'cortex-doctor'), { recursive: true });
  fs.mkdirSync(path.join(skillsRoot, 'cortex-help'), { recursive: true });
  writeJsonl(path.join(claudeRoot, 'project-a', 'sess1.jsonl'), [
    { timestamp: '2026-05-14T08:00:00Z', skill_name: 'cortex-doctor' },
    { timestamp: '2026-05-14T08:05:00Z', model: 'claude-opus-4-7', usage: { input_tokens: 1000, output_tokens: 500 } },
  ]);
  writeJsonl(path.join(cortexJournal, 'steward.jsonl'), [
    { started_at: '2026-05-14T10:00:00Z', kind: 'dep_update_patch', status: 'success', cost_usd: 0.001 },
  ]);
  const report = buildReport({
    nowMs: NOW_MS,
    since: '7d',
    claudeProjectsDir: claudeRoot,
    cortexJournalDir: cortexJournal,
    repoRoot: tmp,
  });
  assert.equal(report.ok, true);
  assert.equal(report.skills.length, 1);
  assert.equal(report.skills[0].name, 'cortex-doctor');
  assert.ok(report.unused_skills.includes('cortex-help'));
  assert.ok(report.cost.claude_estimated_usd > 0);
  assert.ok(report.cost.steward_total_usd === 0.001);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('renderMarkdown: produces 6 numbered sections', () => {
  const report = {
    range_label: '7d',
    generated_at: '2026-05-14',
    skills: [],
    prompts: [],
    steward_actions: [],
    cost: { steward_total_usd: 0, claude_estimated_usd: 0, by_model: [], by_action_kind: [] },
    unused_skills: [],
    unused_action_kinds: [],
    anomalies: [],
  };
  const md = renderMarkdown(report);
  assert.match(md, /## 1\. Skills fired/);
  assert.match(md, /## 2\. Prompts run/);
  assert.match(md, /## 3\. Steward actions/);
  assert.match(md, /## 4\. \$ spent/);
  assert.match(md, /## 5\. What wasn't used/);
  assert.match(md, /## 6\. Anomalies/);
});

test('renderMarkdown: empty data renders placeholders, not crashes', () => {
  const report = {
    range_label: '7d',
    generated_at: '2026-05-14',
    skills: [],
    prompts: [],
    steward_actions: [],
    cost: { steward_total_usd: 0, claude_estimated_usd: 0, by_model: [], by_action_kind: [] },
    unused_skills: [],
    unused_action_kinds: [],
    anomalies: [],
  };
  const md = renderMarkdown(report);
  assert.match(md, /No skill invocations/);
  assert.match(md, /No slash-command/);
  assert.match(md, /All shipped skills fired/);
});

// === R2 2.25.1 HARDENING REGRESSION TESTS ===

test('R2 edge-case HIGH-1: array message.content extracts slash-command from text block', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-insights-array-'));
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-05-14T08:00:00Z', message: { content: [{ type: 'text', text: '/audit triggered here' }, { type: 'tool_use', name: 'X' }] } },
    { timestamp: '2026-05-14T08:05:00Z', message: { content: [{ type: 'text', text: '/cortex-doctor' }] } },
  ]);
  const r = rollupClaudeJsonl([f], NOW_MS - 7 * 24 * 3600 * 1000);
  assert.equal(r.promptsRun.get('audit').count, 1);
  assert.equal(r.promptsRun.get('cortex-doctor').count, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('R2 correctness HIGH-2: unknown model surfaces as anomaly', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-insights-unknown-'));
  const f = path.join(tmp, 'session.jsonl');
  writeJsonl(f, [
    { timestamp: '2026-05-14T08:00:00Z', model: 'claude-opus-4-8-future', usage: { input_tokens: 1000, output_tokens: 500 } },
  ]);
  const r = rollupClaudeJsonl([f], NOW_MS - 7 * 24 * 3600 * 1000);
  assert.ok(r.anomalies.some((a) => a.type === 'unknown_model_cost' && a.model === 'claude-opus-4-8-future'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('R2 edge-case MED: renderMarkdown sanitizes pipe + backtick + control chars in cells', () => {
  const report = {
    range_label: '7d',
    generated_at: '2026-05-14',
    skills: [{ name: 'evil|name|with`backtick`', count: 1, last_seen: '' }],
    prompts: [],
    steward_actions: [],
    cost: { steward_total_usd: 0, claude_estimated_usd: 0, by_model: [], by_action_kind: [] },
    unused_skills: [],
    unused_action_kinds: [],
    anomalies: [],
  };
  const md = renderMarkdown(report);
  // Pipe must be escaped, backticks replaced with single-quote
  assert.match(md, /evil\\\|name\\\|with'backtick'/);
});

test('buildReport: malformed JSONL line does not abort run', () => {
  const tmp = tmpDir();
  const claudeRoot = path.join(tmp, 'claude-projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.writeFileSync(path.join(claudeRoot, 'broken.jsonl'), '{not json\n{"timestamp":"2026-05-14T08:00:00Z","skill_name":"audit"}');
  const report = buildReport({
    nowMs: NOW_MS,
    since: '7d',
    claudeProjectsDir: claudeRoot,
    cortexJournalDir: path.join(tmp, 'no-journal'),
    repoRoot: tmp,
  });
  assert.equal(report.ok, true);
  assert.equal(report.skills.length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});
