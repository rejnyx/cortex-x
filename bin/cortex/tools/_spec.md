# cortex-x tool descriptor spec v0

> **Status**: Sprint 2.9 v0 — first implementation. Spec is operator-curated, MCP-shaped, JSON-Schema-typed. Subject to revision per Tier 4 contract test feedback.

## 0. Purpose + non-goals

cortex-x exposes a **portable tool descriptor format** that runs unchanged in:

- Steward autonomous runtime (CJS, zero-deps)
- Claude Agent SDK (`createSdkMcpServer` route)
- Vercel AI SDK v6 (`tool()` API)
- OpenAI Agents SDK (`FunctionTool`)
- Any MCP-compliant client (Cursor, Codex, Aider, Windsurf, Claude Code via MCP)

**The spec IS MCP**, packaged for cortex-x ergonomics. We don't invent a new protocol — we adopt MCP's tool descriptor + annotation taxonomy and add cortex-x-specific safety hooks.

**Non-goals**:

- Tool marketplace / registry (Sprint 4.0).
- Permission gating in the descriptor (harness-side concern; we use `allowedTools` patterns).
- Runtime execution semantics (timeouts, retries, circuit breakers — those are runtime concerns; Sprint 1.8 safe-tool wrapper handles them).

## 1. Descriptor shape

A tool is a CJS module that exports an object with this shape:

```js
module.exports = {
  // Required identification (matches MCP regex /^[a-z0-9_-]{1,32}$/).
  name: 'read',
  description: 'Read a file from local filesystem. Returns content + line count.',

  // JSON Schema (Draft 2020-12 subset). Required.
  // Used directly by Steward; transformed to Zod / Pydantic by adapters.
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute path to file' },
      offset: { type: 'integer', minimum: 0, description: 'Skip first N lines' },
      limit: { type: 'integer', minimum: 1, description: 'Read at most N lines' },
    },
    required: ['path'],
    additionalProperties: false,
  },

  // MCP tool annotations (informational, per MCP 2026-03-16 spec).
  // Routed by Steward action-engine to wire safety mechanics:
  //   readOnlyHint=true    → skip halt-check, skip journal write-trailer.
  //   destructiveHint=true → mandatory acceptance_criteria[] (Sprint 1.9.0).
  //   idempotentHint=true  → safe to retry on transient failure.
  //   openWorldHint=true   → cost-window enforcement (Sprint 1.9.1).
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },

  // Async handler. Receives validated args + ctx (cwd, journal, abortSignal).
  // Throws errors with .code property; runtime translates to error envelope.
  async handler(args, ctx) {
    // implementation
  },
};
```

## 2. Field reference

### 2.1 `name` (required, string)

Tool identifier. Must match `/^[a-z0-9_-]{1,32}$/` (MCP 2025-11-25 spec).

**Why lowercase + dashed**: matches MCP regex exactly so descriptors round-trip through `toMcpServer` adapter losslessly. Claude Code's capitalized names (`Read`, `Write`, `Edit`) are documented as `read`, `write`, `edit` in cortex-x. Adapter `toClaudeAgentSdk` handles capitalization mapping.

### 2.2 `description` (required, string, ≥ 10 chars)

Human-readable description for the LLM. Per MCP best practice: **lead with the verb**, mention return shape, mention key safety constraints in one sentence.

Bad: `"Reads a file"`
Good: `"Read a file from local filesystem. Returns content + line count. Refuses paths outside cwd."`

### 2.3 `inputSchema` (required, JSON Schema 2020-12 subset)

Strict JSON Schema. cortex-x validator enforces:

- `type: 'object'` at root.
- `additionalProperties: false` REQUIRED (prevents arg smuggling).
- Every property has a `description` (helps the LLM choose).
- `required` array present (even if empty).
- No `$ref` (validator is shallow; defer to MCP server for ref support).

### 2.4 `annotations` (required, object)

All four MCP annotations are required for cortex-x descriptors (no defaults — be explicit):

| Annotation | Type | Meaning | Steward routing |
|---|---|---|---|
| `readOnlyHint` | `boolean` | Tool does not mutate filesystem / network state | Skip halt-check pre-condition + skip journal write-trailer |
| `destructiveHint` | `boolean` | Tool can corrupt or delete data if misused | Sprint 1.9.0 spec-verifier `acceptance_criteria[]` mandatory |
| `idempotentHint` | `boolean` | Repeated calls with same args produce same result | Safe-to-retry hint for transient failure recovery |
| `openWorldHint` | `boolean` | Tool reaches network or external systems | Sprint 1.9.1 daily/weekly/monthly cost windows enforced |

**Validator cross-checks** (Sprint 2.9.0 hardening from R1 §6 risk table):

- `readOnlyHint=true` + `destructiveHint=true` → reject (`TOOL_ANNOTATION_INCONSISTENT`).
- `readOnlyHint=true` + handler reuses `assertEditWithinCwd` → reject (handler signature contradicts annotation).
- `destructiveHint=false` + tool name matches `/(write|edit|delete|remove)/` → warn (likely misclassified).

### 2.5 `handler` (required, async function)

Signature: `async (args, ctx) => result`.

**Args** are the validated input — validator runs `inputSchema` check before calling handler. Handler can assume args conform.

**Ctx** has these fields, all optional (handler may use what it needs):

```js
{
  cwd: string,                    // Working directory (default: process.cwd())
  abortSignal: AbortSignal,       // From AbortController; check .aborted before long ops
  journal: { write(event, data) },// Optional — Steward injects; tests inject mock
  env: { [key]: string },         // Optional scrubbed env (default: process.env minus secrets)
  fs: { readFile, writeFile, ... }, // Optional fs-like override (for testing)
}
```

**Result** must be a plain JSON-serializable value. No streams, no buffers, no functions. The MCP server adapter wraps this in MCP's `{ content: [{ type: 'text', text: ... }] }` envelope.

**Errors**: throw an Error with `.code` set to a string identifier. The runtime converts to MCP's `isError: true` envelope. cortex-x convention: `TOOL_<NAME>_<REASON>` (e.g. `TOOL_READ_PATH_TRAVERSAL`, `TOOL_BASH_FORBIDDEN_FLAG`).

## 3. Naming + organization

Each tool is a single CJS file at `bin/cortex/tools/<name>.cjs`. The filename matches the descriptor's `name` field exactly (regex: `/^[a-z0-9_-]{1,32}\.cjs$/`).

Adapters live in `bin/cortex/tools/_adapters/<adapter>.cjs`.

Validator + safety helpers live in `bin/cortex/tools/_lib/`.

`_spec.md` (this file) is the canonical spec. Don't add a JSON-Schema-of-the-spec — it's circular (the spec describes JSON Schema descriptors).

## 4. Mapping table — cortex-x ↔ Claude Code ↔ MCP ↔ Vercel AI SDK ↔ OpenAI Agents

| cortex-x | Claude Code | MCP `tools/list` | Vercel AI SDK v6 | OpenAI Agents |
|---|---|---|---|---|
| `read` | `Read` | `{ name: 'read', description, inputSchema, annotations }` | `tool({ description, inputSchema, execute })` | `FunctionTool { name, description, params_json_schema, on_invoke_tool }` |
| `write` | `Write` | same | same | same |
| `edit` | `Edit` | same | same | same |
| `glob` | `Glob` | same | same | same |
| `grep` | `Grep` | same | same | same |
| `bash` | `Bash` | same | same | same |
| (deferred 2.9.5) | `WebFetch` | — | — | — |
| (deferred 2.9.5) | `WebSearch` | — | — | — |

Adapter responsibilities:

- **`toMcpServer.cjs`** (primary): emits stdio-mode MCP server (JSON-RPC over stdin/stdout). Exposes `tools/list` + `tools/call`.
- **`toClaudeAgentSdk.cjs`**: produces array suitable for `createSdkMcpServer({ tools: [...] })`. Capitalizes name to match Claude Code convention if `claudeCodeNaming: true` option set.
- **`toVercelAiSdk.cjs`**: returns `{ [name]: tool({ description, inputSchema, execute }) }` map. Currently a stub — TS implementation deferred to Sprint 2.9.5 because cortex-x core is JS-only.
- **`toOpenAiAgents.cjs`**: returns array of `FunctionTool` POJOs with `strict_json_schema: true`.

## 5. Validation

### 5.1 Static (load-time)

`bin/cortex/tools/_lib/validate-descriptor.cjs` checks:

1. `name` matches regex `/^[a-z0-9_-]{1,32}$/`.
2. `description` is string with length ≥ 10.
3. `inputSchema` is object with `type: 'object'` + `additionalProperties: false` + `required` array.
4. `inputSchema.properties` is object; each property has `description`.
5. `annotations` has all 4 required boolean fields.
6. `annotations.readOnlyHint` + `annotations.destructiveHint` are not both `true`.
7. `handler` is `async function` (or function returning Promise).
8. Filename matches `name`.

Returns `{ ok: true }` or `{ ok: false, code, message, field }`.

### 5.2 Runtime (per-invocation)

Adapter or runtime validates `args` against `inputSchema` before calling handler. Failures return MCP error envelope; handler is not invoked.

## 6. Cortex-x-specific extensions over plain MCP

cortex-x descriptors add these conventions on top of MCP:

1. **Handler is local CJS code** (not a remote MCP server URL). The adapter `toMcpServer` is what turns local handlers into a stdio server.
2. **Annotations are required, not optional.** MCP spec allows omission; cortex-x rejects descriptors without all 4 annotations to force operator intent.
3. **Validator cross-checks annotation vs. handler signature** (e.g. `readOnlyHint` vs. `assertEditWithinCwd` import).
4. **Filename = name** convention (file resolution simpler; no `tool-id ↔ filename` map needed).
5. **Steward annotation routing** in `action-engine.cjs` — annotations map to existing safety mechanics (halt-check, spec-verifier, cost-windows).

These extensions are **purely additive** over MCP — a cortex-x descriptor is always a valid MCP descriptor, but not every MCP descriptor is a valid cortex-x descriptor.

## 7. Versioning

This spec is `cortex-tool-spec-v0`. Future versions:

- `v0.5` — adds `webfetch` + `websearch` tools with `openWorldHint` cost-window integration.
- `v1.0` — TS adapter (`toVercelAiSdk.cjs` actual implementation).
- `v1.5` — SSE transport for `toMcpServer` (currently stdio-only).

Breaking changes between versions are major bumps; descriptors must declare `cortexToolSpec: 'v0'` field optionally for forward-compat detection (validator infers v0 if absent).

## 8. References

- MCP Specification 2025-11-25 — https://modelcontextprotocol.io/specification/2025-11-25
- MCP Tool Annotations 2026-03-16 — https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- Claude Agent SDK custom tools — https://docs.claude.com/en/docs/agent-sdk/custom-tools
- Vercel AI SDK Foundations: Tools — https://ai-sdk.dev/docs/foundations/tools
- OpenAI Agents SDK function_schema — https://openai.github.io/openai-agents-python/ref/function_schema/
- agentskills.io / SKILL.md — https://www.agensi.io/learn/agent-skills-open-standard
- Sprint 2.9 R1 memo — `docs/research/sprint-2.9-tools-foundation-2026-05-09.md`
- Sprint 1.9.0 spec-verifier — `bin/steward/_lib/spec-verifier.cjs`
- Sprint 1.9.1 cost windows — `bin/steward/_lib/cost-safety.cjs`
