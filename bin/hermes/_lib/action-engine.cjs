// action-engine.cjs — pluggable interface for "apply this action's edits".
//
// v0.5a ships TWO engines:
//   - mock: env-driven; reads HERMES_MOCK_PLAN and writes the listed files.
//           Used for tests + dogfood without crossing zero-deps.
//   - claude-sdk: NOT YET IMPLEMENTED (v0.5b). Same interface, real LLM call.
//
// Engine contract:
//
//   applyAction(plan, opts) -> {
//     ok: boolean,
//     touchedFiles: string[],   // relative paths to repo root
//     summary: string,          // 1-line human description
//     error?: string,           // present if ok=false
//     code?: string,            // machine-readable error code
//   }
//
// The engine is responsible ONLY for file edits. Everything else (verify,
// commit, journal) is wired by execute.cjs.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Mock engine
// ---------------------------------------------------------------------------
//
// Reads HERMES_MOCK_PLAN env var as JSON:
//
//   { "edits": [{ "path": "src/foo.js", "content": "..." }, ...] }
//
// Writes each `content` to `path` (relative to repoRoot). Creates directories
// as needed. Returns the touched file paths.
//
// If HERMES_MOCK_PLAN is missing OR malformed, returns an error so tests can
// distinguish "no mock provided" from "mock applied".

function mockEngine(plan, opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  const raw = process.env.HERMES_MOCK_PLAN;

  if (!raw) {
    return {
      ok: false,
      code: 'MOCK_NOT_SET',
      error: 'HERMES_MOCK_PLAN env var not set; mock engine has nothing to apply',
    };
  }

  let mock;
  try {
    mock = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      code: 'MOCK_PARSE_ERROR',
      error: `HERMES_MOCK_PLAN is not valid JSON: ${err.message}`,
    };
  }

  if (!mock.edits || !Array.isArray(mock.edits) || mock.edits.length === 0) {
    return {
      ok: false,
      code: 'MOCK_NO_EDITS',
      error: 'HERMES_MOCK_PLAN.edits must be a non-empty array',
    };
  }

  const touched = [];
  for (const edit of mock.edits) {
    if (!edit.path || typeof edit.content !== 'string') {
      return {
        ok: false,
        code: 'MOCK_EDIT_INVALID',
        error: `mock edit missing required fields: ${JSON.stringify(edit)}`,
        touchedFiles: touched,
      };
    }
    // Defense: forbid absolute paths + path traversal
    if (path.isAbsolute(edit.path) || edit.path.includes('..')) {
      return {
        ok: false,
        code: 'MOCK_EDIT_UNSAFE',
        error: `mock edit path must be relative + traversal-free: ${edit.path}`,
        touchedFiles: touched,
      };
    }

    const fullPath = path.join(repoRoot, edit.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, edit.content, 'utf8');
    touched.push(edit.path);
  }

  return {
    ok: true,
    touchedFiles: touched,
    summary: `mock applied ${touched.length} edit(s) to ${touched.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Claude SDK engine (v0.5b — NOT YET IMPLEMENTED)
// ---------------------------------------------------------------------------

function claudeSdkEngine(_plan, _opts = {}) {
  return {
    ok: false,
    code: 'CLAUDE_SDK_NOT_IMPLEMENTED',
    error: 'Claude Agent SDK engine is the v0.5b milestone — pending Dave\'s zero-deps decision',
    next_steps: [
      'npm install @anthropic-ai/claude-agent-sdk',
      'Replace this stub with: const { Agent } = require("@anthropic-ai/claude-agent-sdk")',
      'Wire plan.action.body → agent.run() with project CLAUDE.md + edit tool',
      'Return { ok, touchedFiles, summary } per the engine contract',
    ],
  };
}

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

const ENGINES = {
  mock: mockEngine,
  'claude-sdk': claudeSdkEngine,
};

// Default engine: claude-sdk (will fail until v0.5b lands).
// Override via opts.engine ('mock' | 'claude-sdk') or env var HERMES_ENGINE.
function selectEngine(opts = {}) {
  const name = opts.engine || process.env.HERMES_ENGINE || 'claude-sdk';
  const engine = ENGINES[name];
  if (!engine) {
    return {
      name,
      apply: () => ({
        ok: false,
        code: 'UNKNOWN_ENGINE',
        error: `unknown action engine: ${name}; available: ${Object.keys(ENGINES).join(', ')}`,
      }),
    };
  }
  return { name, apply: engine };
}

function applyAction(plan, opts = {}) {
  const { name, apply } = selectEngine(opts);
  const result = apply(plan, opts);
  return { ...result, engine: name };
}

module.exports = {
  applyAction,
  selectEngine,
  mockEngine,
  claudeSdkEngine,
  ENGINES,
};
