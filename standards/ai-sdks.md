# AI SDKs — Selection Standard

> cortex-x is **AI-agentic-first**. Every profile declares `ai_sdk:` explicitly. This standard defines the three supported SDKs (as of 2026-04-19), their tradeoffs, and the decision rules cortex-x uses to auto-recommend.

## Supported SDKs

| SDK | Vendor | Lang | Model lock-in | Best at |
|---|---|---|---|---|
| **Vercel AI SDK** (`vercel`) | Vercel | TS only | Provider-agnostic (Anthropic/OpenAI/Google/…) | Streaming UI, Next.js, tool-loop agents in web apps |
| **Claude Agent SDK** (`claude-agent`) | Anthropic | TS + Python | Claude only | Autonomous agents with filesystem/shell, Skills, MCP, subagents |
| **OpenAI Agents SDK** (`openai-agents`) | OpenAI | Python-first, TS catching up | Works with 100+ models via Chat Completions, optimized for OpenAI | Sandboxed code execution, multi-agent orchestration, Codex-style dev agents |
| **none** (`none`) | — | — | — | Static sites, offline kiosks, non-AI tooling |

## The decision tree

```
Is AI part of the product?
├── NO → ai_sdk: none (astro-static, minimal, kiosek if no AI)
└── YES
    ├── Is the surface a web UI (chat, streaming, copilot)?
    │   └── YES → ai_sdk: vercel (default for nextjs-saas, chatbot-platform, waas-template)
    ├── Does the agent need shell / filesystem / long-horizon autonomy?
    │   └── YES → ai_sdk: claude-agent (ai-agent profile, cli-tool if AI-heavy)
    ├── Python backend OR sandboxed codegen OR OpenAI-native org?
    │   └── YES → ai_sdk: openai-agents
    └── Mixed web UI + autonomous agent?
        └── Use vercel for UI + claude-agent for the autonomous worker (two-SDK topology)
```

## SDK profiles

### 1. Vercel AI SDK (`ai_sdk: vercel`)

**Package:** `ai@6` (plus `@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.)

**When to use:**
- Streaming chat UI in Next.js / React / Vue / Svelte
- Tool-calling inside web requests
- Provider-agnostic (avoid model vendor lock-in)
- `/api/chat` endpoints reserved by `agentic_scaffolding.reserve_chat_endpoint: true`

**Core primitives:**
```typescript
import { streamText, tool, stepCountIs, ToolLoopAgent } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

const result = streamText({
  model: anthropic('claude-sonnet-4-6'),
  tools: { search: safeTool(...) },
  stopWhen: stepCountIs(8),
  messages,
})
return result.toDataStreamResponse()
```

**Strengths:**
- Best streaming UI story for React (useChat, useCompletion, AI Elements)
- Model-agnostic — swap providers by changing one import
- AI SDK 6 added `ToolLoopAgent`, human-in-the-loop approval, DevTools
- Integrates with `experimental_telemetry` → OpenTelemetry spans

**Tradeoffs:**
- TypeScript only — Python backends can't share this layer
- No built-in filesystem/shell tools (bring your own)
- Agent loop semantics are simpler than Claude Agent SDK (no Skills/hooks/subagents as first-class concepts)

**cortex-x defaults using it:**
- `nextjs-saas` (default)
- `chatbot-platform`
- `waas-template` (if AI features added)

---

### 2. Claude Agent SDK (`ai_sdk: claude-agent`)

**Package:** `@anthropic-ai/claude-agent-sdk` (TS) or `claude-agent-sdk` (Python)

**When to use:**
- Autonomous agents that need shell + filesystem + subagents
- Background workers doing multi-hour tasks
- CLI tools that wrap Claude Code primitives
- Projects that want Skills, hooks lifecycle, MCP servers as first-class concepts
- Anywhere you'd "just run Claude Code headless"

**Core primitives:**
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const msg of query({
  prompt: 'Refactor the auth module',
  options: {
    cwd: projectRoot,
    allowedTools: ['Read', 'Edit', 'Bash'],
    permissionMode: 'acceptEdits',
    hooks: { PreToolUse: [...] },
  },
})) {
  // stream messages
}
```

**Strengths:**
- 10+ built-in tools (Read/Edit/Bash/Grep/Glob/WebFetch/WebSearch/Task/…)
- Skills system (progressive disclosure of large instruction sets)
- Subagents with isolated context windows
- Session forking, `get_context_usage()`, auto-compaction
- MCP-native (tools portable to Claude Desktop, Cursor, Cline)
- Free distribution, pay only for tokens

**Tradeoffs:**
- Claude-only (no Gemini/GPT)
- Heavier runtime — bundles the Claude Code binary (TS) or spawns it (Python)
- Overkill for simple chat UIs — use Vercel AI SDK for those

**cortex-x defaults using it:**
- `ai-agent` (default)
- `cli-tool` when `ai_primary: true`

---

### 3. OpenAI Agents SDK (`ai_sdk: openai-agents`)

**Package:** `openai-agents` (Python), `@openai/agents` (TS), `@openai/codex-sdk`

**When to use:**
- Python-native backends (Django, FastAPI, data pipelines)
- Sandboxed code execution (the April 2026 harness update)
- Multi-agent orchestration (handoffs, routing) without custom infra
- Organizations already standardized on OpenAI
- Codex-style autonomous developer workflows

**Core primitives:**
```python
from agents import Agent, Runner, function_tool

@function_tool
def search(query: str) -> str:
    ...

agent = Agent(
    name="Researcher",
    instructions="You research topics thoroughly.",
    tools=[search],
)
result = await Runner.run(agent, "Research X")
```

**Strengths:**
- First-class Python (parity lead over TS)
- Sandboxed execution harness (April 2026 update) for safe codegen
- Works with 100+ models via Chat Completions — NOT OpenAI-only despite the name
- Handoffs + routing for multi-agent systems
- `apply_patch`, AGENTS.md, Skills — converging feature set with Claude Agent SDK

**Tradeoffs:**
- TS lags Python — check parity before committing
- Sandboxing infra adds operational complexity (Docker / Firecracker)
- gpt-5.x Responses API has documented `tool_call_id` bugs — stick to Chat Completions (see `ai-patterns.md` Pattern 4)

**cortex-x profiles using it:**
- Opt-in via `ai_sdk: openai-agents` override
- Rare as primary — usually layered behind a Python worker that a Vercel AI SDK frontend calls

---

## Two-SDK topology (common for agentic SaaS)

Large agentic products often run **two SDKs**:

```
Browser ──SSE── Next.js /api/chat ──queue── Worker
                 (Vercel AI SDK)             (Claude Agent SDK or OpenAI Agents)
                 fast streaming UI            long-horizon autonomy
```

**Rule:** The web tier always uses Vercel AI SDK. The worker tier uses whichever autonomy SDK fits the job.

cortex-x supports this via profile-level overrides:

```yaml
# profiles/ai-agent.yaml
ai_sdk: claude-agent          # primary worker
ai_sdk_web: vercel             # optional web UI layer
```

## Interop with cortex-x patterns

All 10 patterns in [`ai-patterns.md`](./ai-patterns.md) apply across SDKs, but implementation differs:

| Pattern | Vercel AI SDK | Claude Agent SDK | OpenAI Agents SDK |
|---|---|---|---|
| 1. safe-tool wrapper | Wrap `tool()` from `ai` | Wrap custom tools; built-ins already safe | Wrap `@function_tool` |
| 2. Three-layer memory | BYO (pgvector + markdown) | Layer 1 via Skills + `CLAUDE.md`; Layer 2 BYO | BYO; AGENTS.md for Layer 1 hint |
| 3. LEGO tools | One file per `tool()` | One file per tool; expose via MCP | One file per `@function_tool` |
| 4. Chat Completions > Responses | N/A (SDK picks) | N/A (Claude native) | **Enforce** — use Chat Completions endpoint |
| 5. stopWhen + step budget | `stopWhen: stepCountIs(N)` | `max_turns` option in `query()` | `max_turns` in `Runner.run()` |
| 6. Prompt injection defense | System prompt + Zod | System prompt + hooks (PreToolUse validator) | System prompt + guardrails |
| 7. Cost guards | Middleware before `streamText` | Hooks + `get_context_usage()` budgets | Usage tracking via `RunResult.usage` |
| 8. MCP portability | Via `experimental_mcpClient` | **First-class** (`mcpServers` option) | Supported via bridge |
| 9. Streaming | `toDataStreamResponse()` | Async iterator over messages | `Runner.run_streamed()` |
| 10. Eval suite | promptfoo / braintrust / Vitest | Same + Anthropic eval API | Same + OpenAI evals |

## Migration between SDKs

**Vercel AI SDK → Claude Agent SDK** (when you need autonomy):
- Tools: rewrite Zod schemas → JSON schemas; tools become Claude Agent SDK tools or MCP server
- System prompt: split into `CLAUDE.md` + Skills
- Streaming: replace `toDataStreamResponse()` with async iterator bridge to SSE

**OpenAI Agents SDK ↔ Claude Agent SDK:**
- Both have converging Skills + subagent concepts
- Tool definitions are similar shape — conversion is mostly mechanical
- Biggest gap: sandboxing model (OpenAI sandbox vs Claude Code filesystem permissions)

**Any → Vercel AI SDK** (when you add a web UI):
- Usually additive — keep the autonomous worker, add Vercel AI SDK in Next.js for the chat surface
- See "Two-SDK topology" above

## Versioning & pinning

Pin SDK versions in `package.json` / `pyproject.toml`:

```json
{
  "dependencies": {
    "ai": "^6.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@anthropic-ai/claude-agent-sdk": "^1.0.0"
  }
}
```

SDK majors ship ~every 12 months. cortex-x `research/ai-sdks-<date>.md` tracks current state — refresh every 6 months or on major bump (see `research/README.md` cache invalidation rules).

## Red flags

- ❌ Using Claude Agent SDK for a simple chat UI (use Vercel AI SDK)
- ❌ Using Vercel AI SDK for a multi-hour autonomous worker (use Claude Agent SDK)
- ❌ Building a custom agent loop when `ToolLoopAgent` / `query()` / `Runner.run()` already exist
- ❌ Using OpenAI Responses API for tool calling with gpt-5.x (Chat Completions)
- ❌ Hardcoding `openai` SDK when Vercel AI SDK would give you provider-agnosticism for free
- ❌ Profile declares `ai_sdk` but doesn't install the package during scaffold
- ❌ Profile `agentic_ready: true` but `ai_sdk: none` — contradiction

## Verification (per scaffolded project)

- [ ] Profile declares `ai_sdk` explicitly (not implicit)
- [ ] `ai_sdk: none` only on `astro-static`, `minimal`, or `kiosek` (without AI)
- [ ] Two-SDK topology uses `ai_sdk` + `ai_sdk_web` both
- [ ] SDK version pinned in `package.json` / `pyproject.toml`
- [ ] `/api/chat` endpoint uses the declared `ai_sdk` (no mix-and-match within a layer)
- [ ] Patterns 1, 5, 6, 7 from `ai-patterns.md` implemented in the SDK's idiomatic way
- [ ] Migration path documented if the project might later swap SDKs

## Why this is a standard (not just a profile detail)

SDK choice ripples through:
- **Memory architecture** — Skills (Claude/OpenAI) vs BYO (Vercel)
- **Tool portability** — MCP-native (Claude) vs wrappers (Vercel/OpenAI)
- **Cost model** — provider lock-in vs agnosticism
- **Deployment** — edge-compatible (Vercel AI SDK) vs long-running worker (Claude Agent / OpenAI Agents)

Changing SDKs mid-project = partial rewrite. Picking the right one at init = cortex-x's job.

**Default to Vercel AI SDK for web, Claude Agent SDK for autonomy. Opt into OpenAI Agents SDK only with reason.**
