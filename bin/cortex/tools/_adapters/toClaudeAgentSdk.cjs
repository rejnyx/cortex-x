'use strict';

// Sprint 2.9 — toClaudeAgentSdk adapter.
// Produces an array suitable for Claude Agent SDK's createSdkMcpServer:
//   const tools = toClaudeAgentSdk(palette, { claudeCodeNaming: false });
//   createSdkMcpServer({ tools });
//
// The Claude Agent SDK speaks MCP under the hood — this adapter is just
// a shape-translator (1:1 in our case). Optional claudeCodeNaming flag
// capitalizes names to match Claude Code convention (Read/Write/Edit/Glob/Grep/Bash).

const CLAUDE_CODE_CAPITALIZATION = Object.freeze({
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  bash: 'Bash',
});

function toClaudeAgentSdk(tools, options) {
  options = options || {};
  const useClaudeCodeNaming = options.claudeCodeNaming === true;
  const ctx = options.ctx || {};

  return tools.map((tool) => {
    const name = useClaudeCodeNaming && CLAUDE_CODE_CAPITALIZATION[tool.name]
      ? CLAUDE_CODE_CAPITALIZATION[tool.name]
      : tool.name;
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      handler: async (args) => {
        try {
          const result = await tool.handler(args, ctx);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          };
        } catch (e) {
          return {
            content: [{ type: 'text', text: `${e.code || 'TOOL_ERROR'}: ${e.message}` }],
            isError: true,
          };
        }
      },
    };
  });
}

module.exports = {
  toClaudeAgentSdk,
  CLAUDE_CODE_CAPITALIZATION,
};
