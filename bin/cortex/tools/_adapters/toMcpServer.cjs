'use strict';

// Sprint 2.9 — toMcpServer adapter (primary).
// Turns a cortex-x tool palette into a stdio MCP server (JSON-RPC over
// stdin/stdout). MCP spec 2025-11-25.

const { MCP_MAX_LINE_BYTES } = require('../_lib/limits.cjs');

const PROTOCOL_VERSION = '2025-11-25';

// JSON-RPC error codes (per spec).
const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INTERNAL_ERROR = -32603;

// Sprint 2.9 R2 fix (security CRITICAL-proto-pollution + blind LOW): reject
// argument keys that target Object.prototype. Defense-in-depth even though
// modern V8 has hardened against most pollution paths.
const FORBIDDEN_ARG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

function makeResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

// Sprint 2.9 R2 fix (security CRITICAL): forbid proto-pollution keys at
// validation time. JSON.parse('{"__proto__":{...}}') creates an OWN
// __proto__ property; without this guard it can flow to handlers.
function hasForbiddenKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_ARG_KEYS.has(key)) return key;
    const v = obj[key];
    if (v && typeof v === 'object') {
      const sub = hasForbiddenKeys(v);
      if (sub) return sub;
    }
  }
  return false;
}

// Shallow runtime arg validation against inputSchema.
function validateArgs(args, schema) {
  if (!schema || schema.type !== 'object') return null;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return 'arguments must be object';
  }
  // Sprint 2.9 R2 fix: reject proto-pollution keys at the trust boundary.
  const forbidden = hasForbiddenKeys(args);
  if (forbidden) return `forbidden argument key: ${forbidden}`;
  for (const req of schema.required || []) {
    if (!(req in args)) return `missing required field: ${req}`;
  }
  // Sprint 2.9 R2 fix (edge MEDIUM): enforce additionalProperties:false even
  // when properties is missing or empty.
  if (schema.additionalProperties === false) {
    const props = schema.properties || {};
    for (const key of Object.keys(args)) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) return `unknown field: ${key}`;
    }
  }
  if (schema.properties) {
    for (const [key, def] of Object.entries(schema.properties)) {
      if (!(key in args)) continue;
      const v = args[key];
      if (def.type === 'string' && typeof v !== 'string') return `${key} must be string`;
      if (def.type === 'integer' && !Number.isInteger(v)) return `${key} must be integer`;
      if (def.type === 'number' && typeof v !== 'number') return `${key} must be number`;
      if (def.type === 'boolean' && typeof v !== 'boolean') return `${key} must be boolean`;
      if (def.type === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v))) {
        return `${key} must be object`;
      }
      if (def.type === 'array' && !Array.isArray(v)) return `${key} must be array`;
      if (def.enum && !def.enum.includes(v)) return `${key} must be one of ${def.enum.join(', ')}`;
      if (def.minimum !== undefined && typeof v === 'number' && v < def.minimum) {
        return `${key} must be >= ${def.minimum}`;
      }
      if (typeof def.maxLength === 'number' && typeof v === 'string' && v.length > def.maxLength) {
        return `${key} length must be <= ${def.maxLength}`;
      }
    }
  }
  return null;
}

function createServer(tools, options) {
  options = options || {};
  const ctx = options.ctx || {};
  // Sprint 2.9 R2 fix (security CRITICAL): null-prototype lookup map so
  // tool name 'constructor' or '__proto__' (rejected by validator anyway,
  // but defense in depth) cannot pollute Object.prototype.
  const toolByName = Object.create(null);
  for (const t of tools) toolByName[t.name] = t;

  async function handle(request) {
    const { id, method, params } = request || {};
    if (typeof method !== 'string') {
      return makeError(id, RPC_INVALID_REQUEST, 'method must be string');
    }
    if (method === 'initialize') {
      return makeResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: 'cortex-x-tools', version: '0.1.0' },
        capabilities: { tools: { listChanged: false } },
      });
    }
    if (method === 'tools/list') {
      return makeResult(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      });
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      // Use null-prototype-safe access:
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(toolByName, name)) {
        return makeError(id, RPC_METHOD_NOT_FOUND, `unknown tool: ${name}`);
      }
      const tool = toolByName[name];
      const argError = validateArgs(args, tool.inputSchema);
      if (argError) {
        return makeResult(id, {
          content: [{ type: 'text', text: `argument validation failed: ${argError}` }],
          isError: true,
        });
      }
      try {
        const result = await tool.handler(args, ctx);
        return makeResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false,
        });
      } catch (e) {
        return makeResult(id, {
          content: [{ type: 'text', text: `${e.code || 'TOOL_ERROR'}: ${e.message}` }],
          isError: true,
        });
      }
    }
    return makeError(id, RPC_METHOD_NOT_FOUND, `unknown method: ${method}`);
  }

  return { handle, PROTOCOL_VERSION };
}

// Stdio runner. Reads JSON-RPC requests line-by-line from stdin, writes
// responses line-by-line to stdout. Logs go to stderr.
function runStdio(tools, options) {
  options = options || {};
  const server = createServer(tools, options);
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  let buffer = '';
  stdin.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');
    // Sprint 2.9 R2 fix (security HIGH-buffer-cap + edge MEDIUM): cap line
    // buffer to defend against peers sending unbounded data with no \n.
    if (buffer.length > MCP_MAX_LINE_BYTES) {
      stderr.write(`buffer overflow (>${MCP_MAX_LINE_BYTES} bytes); resetting\n`);
      stdout.write(JSON.stringify(makeError(null, RPC_PARSE_ERROR, 'request line exceeded max size')) + '\n');
      buffer = '';
      return;
    }
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch (e) {
        // Sprint 2.9 R2 fix (edge MEDIUM): respond with JSON-RPC parse error
        // (was previously stderr-only, leaving the client hanging).
        stderr.write(`parse error: ${e.message}\n`);
        stdout.write(JSON.stringify(makeError(null, RPC_PARSE_ERROR, e.message)) + '\n');
        continue;
      }
      // Sprint 2.9 R2 fix (edge MEDIUM): JSON-RPC notifications (no `id`)
      // must NOT receive a response per spec.
      const isNotification = req && req.id === undefined;
      try {
        const resp = await server.handle(req);
        if (!isNotification) stdout.write(JSON.stringify(resp) + '\n');
      } catch (e) {
        stderr.write(`handler crash: ${e.message}\n`);
        if (!isNotification) {
          stdout.write(JSON.stringify(makeError(req && req.id, RPC_INTERNAL_ERROR, e.message)) + '\n');
        }
      }
    }
  });
  stdin.on('end', () => {
    // Allow stdout to flush.
  });
}

module.exports = {
  createServer,
  runStdio,
  PROTOCOL_VERSION,
  validateArgs,
  hasForbiddenKeys,
  FORBIDDEN_ARG_KEYS,
};
