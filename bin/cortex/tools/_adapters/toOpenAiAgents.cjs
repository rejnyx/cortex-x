'use strict';

// Sprint 2.9 — toOpenAiAgents adapter.
// Produces array of FunctionTool POJOs for OpenAI Agents SDK.
// Strict JSON Schema mode enabled by default (matches OpenAI 2026 best practice).
//
// FunctionTool shape (per openai-agents-python ref):
//   {
//     name: string,
//     description: string,
//     params_json_schema: object,
//     on_invoke_tool: async function,
//     strict_json_schema: boolean,
//   }

function toOpenAiAgents(tools, options) {
  options = options || {};
  const ctx = options.ctx || {};
  const strictJsonSchema = options.strictJsonSchema !== false;

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    params_json_schema: tool.inputSchema,
    strict_json_schema: strictJsonSchema,
    // OpenAI Agents SDK invokes tools via on_invoke_tool(ctx, args_json_string).
    // Args arrive as JSON string per OpenAI convention; parse before passing
    // to handler.
    on_invoke_tool: async (_invocationCtx, argsJsonString) => {
      let args;
      try {
        args = typeof argsJsonString === 'string' ? JSON.parse(argsJsonString) : argsJsonString;
      } catch (e) {
        return JSON.stringify({
          error: 'TOOL_ARGS_PARSE_FAILED',
          message: e.message,
        });
      }
      try {
        const result = await tool.handler(args, ctx);
        return JSON.stringify(result);
      } catch (e) {
        return JSON.stringify({
          error: e.code || 'TOOL_ERROR',
          message: e.message,
        });
      }
    },
  }));
}

module.exports = {
  toOpenAiAgents,
};
