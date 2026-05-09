'use strict';

// Sprint 2.9 — adapter roundtrip + behavior tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const palette = require('../../../bin/cortex/tools/index.cjs');
const { toClaudeAgentSdk, CLAUDE_CODE_CAPITALIZATION } = require('../../../bin/cortex/tools/_adapters/toClaudeAgentSdk.cjs');
const { toOpenAiAgents } = require('../../../bin/cortex/tools/_adapters/toOpenAiAgents.cjs');
const { toVercelAiSdk } = require('../../../bin/cortex/tools/_adapters/toVercelAiSdk.cjs');
const mcp = require('../../../bin/cortex/tools/_adapters/toMcpServer.cjs');

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `cx-adapt-${prefix}-`)));
}

describe('toMcpServer adapter', () => {
  test('createServer responds to initialize', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(r.result.protocolVersion, mcp.PROTOCOL_VERSION);
    assert.ok(r.result.serverInfo.name);
  });

  test('tools/list returns 6 tools with correct shape', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const r = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(r.result.tools.length, 6);
    for (const t of r.result.tools) {
      assert.ok(t.name);
      assert.ok(t.description);
      assert.ok(t.inputSchema);
      assert.ok(t.annotations);
      // Handler should NOT leak through MCP wire shape.
      assert.equal(t.handler, undefined);
    }
  });

  test('tools/call invokes handler + wraps result in MCP envelope', async () => {
    const server = mcp.createServer(palette.TOOLS);
    // Use bash echo as a side-effect-free test.
    const cmd = process.platform === 'win32' ? 'echo hi' : 'echo hi';
    const r = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'bash', arguments: { command: cmd, timeout_ms: 5000 } },
    });
    assert.equal(r.result.isError, false);
    assert.ok(r.result.content[0].text.includes('hi'));
  });

  test('tools/call returns isError on validation failure', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const r = await server.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'read', arguments: { /* missing path */ } },
    });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /missing required field/);
  });

  test('tools/call returns isError on unknown tool', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const r = await server.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    });
    assert.ok(r.error);
    assert.match(r.error.message, /unknown tool/);
  });

  test('rejects unknown method', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const r = await server.handle({ jsonrpc: '2.0', id: 6, method: 'foo/bar' });
    assert.ok(r.error);
  });

  test('Sprint 2.9 R2 fix: rejects __proto__ key in arguments (proto-pollution defense)', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const args = JSON.parse('{"command": "echo hi", "__proto__": {"polluted": 1}}');
    const r = await server.handle({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'bash', arguments: args },
    });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /forbidden argument key/);
  });

  test('Sprint 2.9 R2 fix: rejects nested constructor key', async () => {
    const server = mcp.createServer(palette.TOOLS);
    const args = JSON.parse('{"command": "echo hi", "timeout_ms": {"constructor": "x"}}');
    // The nested object will be caught even though tool schema says timeout_ms is integer.
    const r = await server.handle({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'bash', arguments: args },
    });
    assert.equal(r.result.isError, true);
  });

  test('Sprint 2.9 R2 fix: hasForbiddenKeys detects __proto__/constructor/prototype', () => {
    assert.equal(mcp.hasForbiddenKeys({ a: 1 }), false);
    assert.equal(mcp.hasForbiddenKeys(JSON.parse('{"__proto__":{}}')), '__proto__');
    assert.equal(mcp.hasForbiddenKeys({ inner: { constructor: 'x' } }), 'constructor');
    assert.equal(mcp.hasForbiddenKeys({ a: { b: { prototype: 'x' } } }), 'prototype');
  });

  test('Sprint 2.9 R2 fix: validateArgs rejects unknown field even when properties is empty', () => {
    const schema = {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    };
    assert.equal(mcp.validateArgs({ extra: 'value' }, schema), 'unknown field: extra');
  });

  test('validateArgs catches additionalProperties violation', () => {
    const schema = {
      type: 'object',
      properties: { foo: { type: 'string', description: 'd' } },
      required: ['foo'],
      additionalProperties: false,
    };
    assert.equal(mcp.validateArgs({ foo: 'x', extra: 'y' }, schema), 'unknown field: extra');
  });

  test('validateArgs catches type mismatch', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer', description: 'd' } },
      required: ['count'],
      additionalProperties: false,
    };
    assert.equal(mcp.validateArgs({ count: 'not int' }, schema), 'count must be integer');
  });
});

describe('toClaudeAgentSdk adapter', () => {
  test('returns one entry per tool', () => {
    const arr = toClaudeAgentSdk(palette.TOOLS);
    assert.equal(arr.length, 6);
  });

  test('preserves lowercase names by default', () => {
    const arr = toClaudeAgentSdk(palette.TOOLS);
    assert.deepEqual(arr.map((t) => t.name).sort(), ['bash', 'edit', 'glob', 'grep', 'read', 'write']);
  });

  test('claudeCodeNaming option capitalizes', () => {
    const arr = toClaudeAgentSdk(palette.TOOLS, { claudeCodeNaming: true });
    const names = arr.map((t) => t.name).sort();
    assert.deepEqual(names, ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
  });

  test('handler preserved + wraps in MCP envelope', async () => {
    const dir = tmpDir('claude');
    const arr = toClaudeAgentSdk(palette.TOOLS, { ctx: { cwd: dir } });
    const readTool = arr.find((t) => t.name === 'read');
    const result = await readTool.handler({ path: path.join(dir, 'missing.txt') });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /TOOL_READ_/);
  });

  test('CLAUDE_CODE_CAPITALIZATION map is correct', () => {
    assert.equal(CLAUDE_CODE_CAPITALIZATION.read, 'Read');
    assert.equal(CLAUDE_CODE_CAPITALIZATION.bash, 'Bash');
  });
});

describe('toOpenAiAgents adapter', () => {
  test('returns FunctionTool shape', () => {
    const arr = toOpenAiAgents(palette.TOOLS);
    assert.equal(arr.length, 6);
    for (const t of arr) {
      assert.ok(t.name);
      assert.ok(t.description);
      assert.ok(t.params_json_schema);
      assert.equal(typeof t.on_invoke_tool, 'function');
      assert.equal(t.strict_json_schema, true);
    }
  });

  test('strict_json_schema can be disabled', () => {
    const arr = toOpenAiAgents(palette.TOOLS, { strictJsonSchema: false });
    for (const t of arr) assert.equal(t.strict_json_schema, false);
  });

  test('on_invoke_tool parses JSON args', async () => {
    const dir = tmpDir('openai');
    const arr = toOpenAiAgents(palette.TOOLS, { ctx: { cwd: dir } });
    const readTool = arr.find((t) => t.name === 'read');
    const result = await readTool.on_invoke_tool({}, JSON.stringify({ path: path.join(dir, 'missing.txt') }));
    const parsed = JSON.parse(result);
    assert.equal(parsed.error, 'TOOL_READ_NOT_FOUND');
  });

  test('on_invoke_tool surfaces parse error cleanly', async () => {
    const arr = toOpenAiAgents(palette.TOOLS);
    const readTool = arr.find((t) => t.name === 'read');
    const result = await readTool.on_invoke_tool({}, 'not valid json{');
    const parsed = JSON.parse(result);
    assert.equal(parsed.error, 'TOOL_ARGS_PARSE_FAILED');
  });
});

describe('toVercelAiSdk adapter (CJS stub)', () => {
  test('returns map keyed by tool name', () => {
    const map = toVercelAiSdk(palette.TOOLS);
    assert.equal(Object.keys(map).length, 6);
    assert.ok(map.read);
    assert.ok(map.bash);
  });

  test('each entry has description + inputSchema + execute', () => {
    const map = toVercelAiSdk(palette.TOOLS);
    for (const tool of Object.values(map)) {
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.inputSchema);
      assert.equal(typeof tool.execute, 'function');
    }
  });

  test('execute throws on handler error (Vercel propagates)', async () => {
    const dir = tmpDir('vercel');
    const map = toVercelAiSdk(palette.TOOLS, { ctx: { cwd: dir } });
    await assert.rejects(
      () => map.read.execute({ path: path.join(dir, 'missing.txt') }),
      (err) => err.code === 'TOOL_READ_NOT_FOUND',
    );
  });

  test('annotations forwarded as _annotations', () => {
    const map = toVercelAiSdk(palette.TOOLS);
    assert.equal(map.read._annotations.readOnlyHint, true);
    assert.equal(map.bash._annotations.destructiveHint, true);
  });
});

describe('Adapter contract — descriptor roundtrips losslessly through all adapters', () => {
  test('every shipped tool produces consistent name + description across adapters', () => {
    const claude = toClaudeAgentSdk(palette.TOOLS);
    const openai = toOpenAiAgents(palette.TOOLS);
    const vercel = toVercelAiSdk(palette.TOOLS);

    for (const tool of palette.TOOLS) {
      const c = claude.find((t) => t.name === tool.name);
      const o = openai.find((t) => t.name === tool.name);
      const v = vercel[tool.name];

      assert.ok(c, `claude adapter has ${tool.name}`);
      assert.ok(o, `openai adapter has ${tool.name}`);
      assert.ok(v, `vercel adapter has ${tool.name}`);

      assert.equal(c.description, tool.description);
      assert.equal(o.description, tool.description);
      assert.equal(v.description, tool.description);

      // inputSchema reference equality is fine — adapters don't mutate.
      assert.equal(c.inputSchema, tool.inputSchema);
      assert.equal(o.params_json_schema, tool.inputSchema);
      assert.equal(v.inputSchema, tool.inputSchema);
    }
  });
});
