'use strict';

// Sprint 2.9 — toVercelAiSdk adapter (CJS stub; full TS impl deferred to 2.9.5).
//
// Vercel AI SDK v6 expects:
//   tool({ description, inputSchema (Zod or JSON Schema), execute })
//
// cortex-x core stays JS-only. This stub returns a JSON-Schema-flavored
// version of the descriptor that the operator's TS project can wrap manually.
// A future 2.9.5 ships an actual TS adapter with Zod re-wrap.
//
// The stub deliberately produces a value compatible with Vercel AI SDK's
// `jsonSchema()` helper, which accepts plain JSON Schema objects.

function toVercelAiSdk(tools, options) {
  options = options || {};
  const ctx = options.ctx || {};

  const map = {};
  for (const tool of tools) {
    map[tool.name] = {
      description: tool.description,
      // Vercel AI SDK accepts plain JSON Schema via the jsonSchema() helper.
      // Operator's TS project: `inputSchema: jsonSchema(stub.inputSchema)`.
      inputSchema: tool.inputSchema,
      // Vercel AI SDK calls `execute(args, options)` with args as JS object.
      execute: async (args /* , execOptions */) => {
        try {
          const result = await tool.handler(args, ctx);
          return result;
        } catch (e) {
          // Vercel AI SDK propagates thrown errors to the model.
          // Re-throw with code preserved.
          throw e;
        }
      },
      // Forward annotations for harnesses that use them (Vercel AI SDK v6
      // does not consume them today, but Sprint 2.9.5 may revisit).
      _annotations: tool.annotations,
    };
  }
  return map;
}

module.exports = {
  toVercelAiSdk,
  _stub_version: 'cjs-v0',
  _follow_up: 'Sprint 2.9.5 ships TS adapter with Zod re-wrap.',
};
