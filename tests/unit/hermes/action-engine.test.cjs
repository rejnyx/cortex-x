'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../../../bin/hermes/_lib/action-engine.cjs');

function tmpRepo(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `engine-${prefix}-`));
}

function withMockPlan(plan, fn) {
  const prev = process.env.HERMES_MOCK_PLAN;
  process.env.HERMES_MOCK_PLAN = JSON.stringify(plan);
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.HERMES_MOCK_PLAN;
    else process.env.HERMES_MOCK_PLAN = prev;
  }
}

describe('action-engine: mock engine', () => {
  test('applies single edit', () => {
    const repoRoot = tmpRepo('single');
    const result = withMockPlan({
      edits: [{ path: 'src/foo.js', content: 'module.exports = 42;' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.touchedFiles, ['src/foo.js']);
    assert.equal(fs.readFileSync(path.join(repoRoot, 'src/foo.js'), 'utf8'), 'module.exports = 42;');
  });

  test('applies multiple edits', () => {
    const repoRoot = tmpRepo('multi');
    const result = withMockPlan({
      edits: [
        { path: 'a.js', content: 'a' },
        { path: 'sub/b.js', content: 'b' },
      ],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));

    assert.equal(result.ok, true);
    assert.equal(result.touchedFiles.length, 2);
    assert.equal(fs.readFileSync(path.join(repoRoot, 'a.js'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(repoRoot, 'sub/b.js'), 'utf8'), 'b');
  });

  test('returns MOCK_NOT_SET when env var missing', () => {
    const repoRoot = tmpRepo('not-set');
    const prev = process.env.HERMES_MOCK_PLAN;
    delete process.env.HERMES_MOCK_PLAN;
    try {
      const result = engine.applyAction({}, { engine: 'mock', repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MOCK_NOT_SET');
    } finally {
      if (prev !== undefined) process.env.HERMES_MOCK_PLAN = prev;
    }
  });

  test('returns MOCK_PARSE_ERROR on invalid JSON', () => {
    const repoRoot = tmpRepo('bad-json');
    const prev = process.env.HERMES_MOCK_PLAN;
    process.env.HERMES_MOCK_PLAN = '{ not valid json';
    try {
      const result = engine.applyAction({}, { engine: 'mock', repoRoot });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'MOCK_PARSE_ERROR');
    } finally {
      if (prev === undefined) delete process.env.HERMES_MOCK_PLAN;
      else process.env.HERMES_MOCK_PLAN = prev;
    }
  });

  test('rejects empty edits array', () => {
    const repoRoot = tmpRepo('empty');
    const result = withMockPlan({ edits: [] },
      () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_NO_EDITS');
  });

  test('rejects absolute paths (defense in depth)', () => {
    const repoRoot = tmpRepo('abs');
    const result = withMockPlan({
      edits: [{ path: '/etc/passwd', content: 'evil' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_EDIT_UNSAFE');
  });

  test('rejects path traversal', () => {
    const repoRoot = tmpRepo('traversal');
    const result = withMockPlan({
      edits: [{ path: '../../../escape.js', content: 'evil' }],
    }, () => engine.applyAction({}, { engine: 'mock', repoRoot }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MOCK_EDIT_UNSAFE');
  });
});

describe('action-engine: claude-sdk engine (stub until v0.5b)', () => {
  test('returns CLAUDE_SDK_NOT_IMPLEMENTED', () => {
    const result = engine.applyAction({}, { engine: 'claude-sdk' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CLAUDE_SDK_NOT_IMPLEMENTED');
    assert.ok(Array.isArray(result.next_steps));
  });
});

describe('action-engine: engine selection', () => {
  test('opts.engine takes precedence over env', () => {
    const prev = process.env.HERMES_ENGINE;
    process.env.HERMES_ENGINE = 'claude-sdk';
    try {
      const { name } = engine.selectEngine({ engine: 'mock' });
      assert.equal(name, 'mock');
    } finally {
      if (prev === undefined) delete process.env.HERMES_ENGINE;
      else process.env.HERMES_ENGINE = prev;
    }
  });

  test('HERMES_ENGINE env var as fallback', () => {
    const prev = process.env.HERMES_ENGINE;
    process.env.HERMES_ENGINE = 'mock';
    try {
      const { name } = engine.selectEngine({});
      assert.equal(name, 'mock');
    } finally {
      if (prev === undefined) delete process.env.HERMES_ENGINE;
      else process.env.HERMES_ENGINE = prev;
    }
  });

  test('default is claude-sdk', () => {
    const prev = process.env.HERMES_ENGINE;
    delete process.env.HERMES_ENGINE;
    try {
      const { name } = engine.selectEngine({});
      assert.equal(name, 'claude-sdk');
    } finally {
      if (prev !== undefined) process.env.HERMES_ENGINE = prev;
    }
  });

  test('unknown engine name returns UNKNOWN_ENGINE on apply', () => {
    const result = engine.applyAction({}, { engine: 'frobnicate' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'UNKNOWN_ENGINE');
  });
});
