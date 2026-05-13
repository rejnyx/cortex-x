// eval-runner.test.cjs — Sprint 3.0 v0

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runner = require('../../bin/steward/_lib/eval-runner.cjs');

function tmpEvalsDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-evals-${name}-`));
  return dir;
}

function writeEval(dir, filename, frontmatter, body = '') {
  const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(dir, filename), `---\n${fm}\n---\n\n${body}\n`, 'utf8');
}

describe('Sprint 3.0 — eval-runner pure helpers', () => {
  test('parseFrontmatter extracts typed values', () => {
    const { frontmatter } = runner.parseFrontmatter(`---
id: eval-001
name: test
version: 1.0
validation: true
---

body content
`);
    assert.equal(frontmatter.id, 'eval-001');
    assert.equal(frontmatter.name, 'test');
    assert.equal(frontmatter.version, 1.0);
    assert.equal(frontmatter.validation, true);
  });

  test('parseFrontmatter returns body without frontmatter prefix', () => {
    const { body } = runner.parseFrontmatter('---\nid: x\n---\n\n# Title\n');
    assert.match(body, /^\s*# Title/);
  });

  test('parseFrontmatter handles no-frontmatter case', () => {
    const { frontmatter, body } = runner.parseFrontmatter('# Bare\n');
    assert.deepEqual(frontmatter, {});
    assert.match(body, /# Bare/);
  });

  test('mockExecutor returns deterministic shape', () => {
    const a = runner.mockExecutor({ variant_id: 'champion', task_id: 'eval-001', trial: 0 });
    const b = runner.mockExecutor({ variant_id: 'champion', task_id: 'eval-001', trial: 0 });
    assert.equal(a.score, b.score); // deterministic
    assert.ok(a.score >= 0 && a.score <= 1);
    assert.equal(typeof a.spec_pass, 'boolean');
    assert.ok(a.duration_ms >= 100);
    assert.equal(a.cost_usd, 0.0001);
  });

  test('mockExecutor differs across trials', () => {
    const a = runner.mockExecutor({ variant_id: 'champion', task_id: 'eval-001', trial: 0 });
    const b = runner.mockExecutor({ variant_id: 'champion', task_id: 'eval-001', trial: 1 });
    assert.notEqual(a.score, b.score);
  });
});

describe('Sprint 3.0 — discoverTasks', () => {
  test('skips non-eval files', () => {
    const dir = tmpEvalsDir('discover');
    fs.writeFileSync(path.join(dir, 'README.md'), '# README\n');
    writeEval(dir, 'eval-001-x.md', { id: 'eval-001', name: 'x' });
    writeEval(dir, 'eval-002-y.md', { id: 'eval-002', name: 'y', validation: 'true' });
    fs.writeFileSync(path.join(dir, 'not-an-eval.md'), 'noise');
    const tasks = runner.discoverTasks(dir);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, 'eval-001');
    assert.equal(tasks[1].validation, true);
  });

  test('returns empty when dir missing', () => {
    const tasks = runner.discoverTasks('/nonexistent-eval-dir');
    assert.deepEqual(tasks, []);
  });

  test('skips eval-prefixed files without frontmatter.id', () => {
    const dir = tmpEvalsDir('no-id');
    fs.writeFileSync(path.join(dir, 'eval-001-x.md'), '# bare\n'); // no frontmatter
    const tasks = runner.discoverTasks(dir);
    assert.equal(tasks.length, 0);
  });
});

describe('Sprint 3.0 — runVariant integration', () => {
  test('runs each task N times and aggregates', async () => {
    const dir = tmpEvalsDir('integration');
    writeEval(dir, 'eval-001-a.md', { id: 'eval-001', name: 'a' });
    writeEval(dir, 'eval-002-b.md', { id: 'eval-002', name: 'b', validation: 'true' });
    const result = await runner.runVariant({
      variantId: 'champion',
      evalsDir: dir,
      trials: 3,
    });
    assert.equal(result.tasks_count, 2);
    assert.equal(result.trials_total, 6);
    assert.equal(result.train_tasks_count, 1);
    assert.equal(result.validation_tasks_count, 1);
    assert.equal(result.trainScores.length, 3);
    assert.equal(result.validationScores.length, 3);
    assert.equal(result.by_task.length, 2);
  });

  test('validationOnly filter restricts to held-out tasks', async () => {
    const dir = tmpEvalsDir('val-filter');
    writeEval(dir, 'eval-001-a.md', { id: 'eval-001', name: 'a' });
    writeEval(dir, 'eval-002-b.md', { id: 'eval-002', name: 'b', validation: 'true' });
    const result = await runner.runVariant({
      variantId: 'champion',
      evalsDir: dir,
      trials: 2,
      validationOnly: true,
    });
    assert.equal(result.tasks_count, 1);
    assert.equal(result.validation_tasks_count, 1);
  });

  test('taskIds filter restricts to subset', async () => {
    const dir = tmpEvalsDir('subset');
    writeEval(dir, 'eval-001-a.md', { id: 'eval-001', name: 'a' });
    writeEval(dir, 'eval-002-b.md', { id: 'eval-002', name: 'b' });
    writeEval(dir, 'eval-003-c.md', { id: 'eval-003', name: 'c' });
    const result = await runner.runVariant({
      variantId: 'champion',
      evalsDir: dir,
      trials: 1,
      taskIds: ['eval-001', 'eval-003'],
    });
    assert.equal(result.tasks_count, 2);
  });

  test('writeVariantResult writes JSON to date-stamped file', async () => {
    const dir = tmpEvalsDir('write');
    writeEval(dir, 'eval-001-a.md', { id: 'eval-001', name: 'a' });
    const result = await runner.runVariant({
      variantId: 'test-variant',
      evalsDir: dir,
      trials: 1,
    });
    const resultsDir = path.join(dir, 'results');
    const written = runner.writeVariantResult(result, resultsDir);
    assert.ok(fs.existsSync(written));
    const parsed = JSON.parse(fs.readFileSync(written, 'utf8'));
    assert.equal(parsed.variant_id, 'test-variant');
    assert.equal(parsed.tasks_count, 1);
  });

  test('runVariant accepts custom executor', async () => {
    const dir = tmpEvalsDir('custom-exec');
    writeEval(dir, 'eval-001-a.md', { id: 'eval-001', name: 'a' });
    let calls = 0;
    const customExec = async () => { calls += 1; return { score: 0.5, spec_pass: true, duration_ms: 10, cost_usd: 0 }; };
    const result = await runner.runVariant({
      variantId: 'custom',
      evalsDir: dir,
      trials: 3,
      executor: customExec,
    });
    assert.equal(calls, 3);
    assert.equal(result.trainScores.length, 3);
    assert.equal(result.trainScores[0], 0.5);
  });

  test('throws when evalsDir missing', async () => {
    await assert.rejects(
      () => runner.runVariant({ variantId: 'x' }),
      /evalsDir is required/,
    );
  });
});

describe('Sprint 3.0 v1 — openrouter executor', () => {
  test('throws when OPENROUTER_API_KEY missing', () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      assert.throws(
        () => runner.makeOpenRouterExecutor({}),
        /OPENROUTER_API_KEY required/,
      );
    } finally {
      if (prev) process.env.OPENROUTER_API_KEY = prev;
    }
  });

  test('returns smoke score 1.0 on non-empty response', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: 'A reasonably long response from the LLM that should clear the smoke threshold easily.' } }],
        usage: { cost: 0.0001 },
      }),
    });
    const exec = runner.makeOpenRouterExecutor({
      apiKey: 'sk-or-fake',
      fetchImpl: mockFetch,
    });
    const r = await exec({ variant_id: 'champion', task_id: 'eval-001', trial: 0, task: { body: 'do thing' } });
    assert.equal(r.score, 1.0);
    assert.equal(r.spec_pass, true);
    assert.ok(r.cost_usd > 0);
    assert.equal(r.response_text.length > 32, true);
  });

  test('returns score 0 on empty response', async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '' } }],
        usage: { cost: 0.0001 },
      }),
    });
    const exec = runner.makeOpenRouterExecutor({
      apiKey: 'sk-or-fake',
      fetchImpl: mockFetch,
    });
    const r = await exec({ variant_id: 'x', task_id: 'eval-001', trial: 0, task: { body: 'x' } });
    assert.equal(r.score, 0);
    assert.equal(r.spec_pass, false);
  });

  test('returns error on HTTP non-2xx', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Auth rejected',
    });
    const exec = runner.makeOpenRouterExecutor({
      apiKey: 'sk-or-fake',
      fetchImpl: mockFetch,
    });
    const r = await exec({ variant_id: 'x', task_id: 'eval-001', trial: 0, task: { body: 'x' } });
    assert.equal(r.score, 0);
    assert.match(r.error, /http_401/);
  });

  test('cost cap aborts further trials', async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: 'reasonably long response that clears the smoke threshold' } }],
          usage: { cost: 0.5 },
        }),
      };
    };
    const exec = runner.makeOpenRouterExecutor({
      apiKey: 'sk-or-fake',
      fetchImpl: mockFetch,
      maxCostUsd: 0.5,
    });
    const r1 = await exec({ variant_id: 'x', task_id: 'eval-001', trial: 0, task: { body: 'x' } });
    assert.equal(r1.cost_usd, 0.5);
    const r2 = await exec({ variant_id: 'x', task_id: 'eval-002', trial: 0, task: { body: 'x' } });
    assert.equal(r2.skipped, true);
    assert.equal(r2.skip_reason, 'COST_CAP_REACHED');
    assert.equal(calls, 1); // second call short-circuited
  });

  test('fetch exception captured as error', async () => {
    const mockFetch = async () => { throw new Error('net unreachable'); };
    const exec = runner.makeOpenRouterExecutor({
      apiKey: 'sk-or-fake',
      fetchImpl: mockFetch,
    });
    const r = await exec({ variant_id: 'x', task_id: 'eval-001', trial: 0, task: { body: 'x' } });
    assert.equal(r.score, 0);
    assert.match(r.error, /fetch_failed/);
  });
});
