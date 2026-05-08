---
sprint: 2.9
title: Tools Foundation v0 — neutral tool descriptor spec + MCP-as-lingua-franca
date: 2026-05-09
status: research-complete
based_on: web research dispatch 2026-05-09 (14 sources cited inline)
---

# Sprint 2.9 — Tools Foundation v0 R1 memo

## 1. Question

Operator instinct: Claude Code's built-in tool palette (Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch / NotebookEdit / Task / TodoWrite + 13 others) is a curated standard worth borrowing as cortex-x's reusable tools library, rather than inventing from scratch. **Question:** how should cortex-x expose tools so that the same descriptor works across Steward (CJS, zero-deps), Vercel AI SDK projects, OpenAI Agents SDK, Claude Agent SDK, and SKILL.md-consuming runtimes — without locking into one vendor's harness conventions?

Three options on the table:

- **(a)** Re-implement Claude Code's tools verbatim as zero-deps CJS modules, callable directly by Steward.
- **(b)** Define a neutral tool-descriptor spec inspired by the Claude Code palette + ship per-runtime adapters.
- **(c)** Pure documentation — point at Claude Code's tools as the "recommended palette" via SKILL.md, no executable code.

## 2. Findings

### 2.1 — Claude Code 2.1.x built-in tool catalog

24 built-in tools exposed to the model. Core palette: `Read` (absolute path → numbered output), `Write` (create/overwrite, requires prior `Read` for existing files), `Edit` (exact-string replace, fails if `old_string` absent), `Glob` (filename patterns, mtime-sorted), `Grep` (ripgrep wrapper, regex), `Bash` (shell, soft-discouraged when a built-in fits), `WebFetch`, `WebSearch`, `NotebookEdit`, `Task` (sub-agents), `TodoWrite`, plus 13 others including `Plan` / `ExitPlanMode` / `EnterWorktree`.

**Permission model is harness-level, not embedded in the tool schema.** `allowedTools` / `disabledTools` / `permissionMode` live in `settings.json` or session config. The tool descriptor itself does not encode "is this allowed?" — that's a runtime decision.

Sources:
- [Claude Code built-in tools explained (israynotarray, 2026-04)](https://israynotarray.com/en/ai/2026/04/29/claude-code-built-in-tools-explained/)
- [Claude Code Tool System (callsphere)](https://callsphere.ai/blog/claude-code-tool-system-explained)
- [Piebald-AI/claude-code-system-prompts (24 builtin tool descriptions)](https://github.com/Piebald-AI/claude-code-system-prompts)

### 2.2 — Comparable tool catalogs in 2026 SOTA stacks

| Framework | Tool shape | Schema flavor | Notes |
|---|---|---|---|
| **Vercel AI SDK v6** | `tool({ description, inputSchema, execute })` | Zod or JSON Schema | `.describe()` / `.meta()` must be the **last** chained Zod method or it's stripped (footgun) |
| **OpenAI Agents SDK** | `FunctionTool { name, description, params_json_schema, on_invoke_tool, strict_json_schema }` | Pydantic-derived JSON Schema | Strict mode strongly recommended |
| **Claude Agent SDK** | `tool(name, description, zodSchema, handler, { annotations: { readOnlyHint, openWorldHint } })` | Zod surface, JSON Schema wire | Bundled via `createSdkMcpServer` — **already speaks MCP under the hood** |
| **LangChain BaseTool** | `name`, `description`, `args_schema` (Pydantic), `_run` / `_arun`, `response_format`, `InjectedToolArg` | Pydantic | Most ergonomic, also heaviest deps |
| **SKILL.md / agentskills.io** | YAML frontmatter (`name`, `description`) + markdown body + sidecar files | Implementation-defined per runtime | Open spec donated by Anthropic; **12 runtimes** support it natively (Claude Code, Codex, Cursor, Gemini CLI, Aider, Windsurf, etc.) |

Sources:
- [Vercel AI SDK Foundations: Tools](https://ai-sdk.dev/docs/foundations/tools)
- [Vercel AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6)
- [OpenAI Agents SDK function_schema](https://openai.github.io/openai-agents-python/ref/function_schema/)
- [Claude Agent SDK custom tools](https://docs.claude.com/en/docs/agent-sdk/custom-tools)
- [LangChain BaseTool reference](https://reference.langchain.com/python/langchain-core/tools/base/BaseTool)
- [Agent Skills open standard explainer (agensi.io)](https://www.agensi.io/learn/agent-skills-open-standard)

### 2.3 — Cross-stack design patterns (consistent in all 5 above)

1. **JSON Schema is the universal wire format.** Zod and Pydantic are surface sugar that compile down to JSON Schema at the API boundary. **For zero-deps cortex-x core: use raw JSON Schema. Zod only in TS-flavored adapters.**
2. **Safe-tool wrappers** (timeout / retry / circuit breaker) are **runtime-side**, not part of the descriptor. cortex-x already has the wrapper in `standards/ai-patterns.md` (safe-tool v2 with loop detector + circuit breaker + per-tool retry budget — Sprint 1.8.x).
3. **Permission gates are harness concerns** (`allowedTools`, `disabledTools`, MCP `tools/list_changed`). Don't encode permissions in the descriptor.
4. **Read/write classification = MCP tool annotations.** Standardized 2026-03: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Informational, not enforceable — but ChatGPT app store and Claude both gate auto-approval on them.
5. **Idempotency is an annotation**, not a runtime mechanism.
6. **Audit/journal hooks are universally runtime-side.** Steward's existing journal already does this.

Sources:
- [Tool Annotations as Risk Vocabulary (MCP blog, 2026-03-16)](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
- [MCP Tool Annotations Explained (ChatForest)](https://chatforest.com/guides/mcp-tool-annotations-explained/)

### 2.4 — Lock-in tradeoff + the neutral standard

**Mirroring Claude Code's API verbatim** ties cortex-x to Anthropic's harness conventions: parameter naming (`file_path` vs `path`), Bash-tool gating semantics, sub-agent shape. Anthropic ships frequent shape changes (e.g. `Plan` / `ExitPlanMode` are recent; `EnterWorktree` is Claude Code 2.x). Verbatim mirror = our descriptor breaks every time they evolve.

**The vendor-neutral standard is MCP** (Model Context Protocol):

- **Donated to the Linux Foundation December 2025**, governed jointly by Anthropic + OpenAI + Google + Microsoft + AWS.
- Claude Agent SDK's `createSdkMcpServer` proves MCP is the lingua franca — even Anthropic's own SDK exposes tools as MCP servers internally.
- Tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`) are now part of MCP's risk vocabulary.
- ACP (Agent Communication Protocol) and A2A (Agent-to-Agent) are **orthogonal** — they handle agent-to-agent comms, not tool exposure.

Sources:
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP 2026 Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [Model Context Protocol — Wikipedia (LF donation Dec 2025)](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- [ACP vs MCP vs A2A (neosalpha)](https://neosalpha.com/blogs/ai-agent-protocols-acp-vs-mcp-vs-a2a/)

## 3. Recommendation

**Option (b) — neutral spec + adapters, where "neutral spec" = MCP-shaped JSON Schema descriptors.** Justification:

1. **MCP already won the neutrality fight** (LF-governed, multi-vendor, embedded in Claude Agent SDK). Re-implementing Claude Code tools as zero-deps CJS (option a) duplicates work and locks Steward to one harness convention. Pure documentation (option c) gives nothing executable to Steward, autoresearch, or future runtimes.
2. **Concrete shape:**

   ```
   bin/cortex/tools/
     read.cjs          → exports { name, description, inputSchema (JSON Schema),
                                    annotations: { readOnlyHint, destructiveHint,
                                                   idempotentHint, openWorldHint },
                                    async handler(args, ctx) }
     write.cjs
     edit.cjs
     glob.cjs
     grep.cjs
     bash.cjs
     webfetch.cjs
     websearch.cjs
     _spec.md          → human-readable spec for the descriptor format
     _adapters/
       toMcpServer.cjs       (~30 LoC, primary adapter)
       toClaudeAgentSdk.cjs  (~30 LoC)
       toVercelAiSdk.cjs     (~30 LoC, TS file with Zod re-wrap)
       toOpenAiAgents.cjs    (~30 LoC)
   ```

3. **Borrow Claude Code's tool *taxonomy* (the names Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch) as the curated palette** — operator's instinct is right that the design is solid — but express each in the neutral descriptor shape. Steward already runs Bash / edit / grep semantics natively via its primitives; wrapping them as MCP-shaped tool descriptors is incremental work, ~150 LoC per tool average.

4. **SKILL.md stays the distribution unit** (YAML frontmatter + markdown body); the JSON-Schema-with-annotations descriptor lives next to each skill. Matches how Claude Agent SDK + Codex + Cursor already consume skills.

5. **Annotations are the safety lever Steward already wants.** Free integration with existing mechanics:
   - `readOnlyHint=true` → spec-verifier can skip destructive-edit gates (Sprint 1.9.0); skip halt-check pre-condition; skip journal write-trailers.
   - `destructiveHint=true` → mandatory `acceptance_criteria[]` (Sprint 1.9.0 spec-verifier); mandatory journal entry; mandatory policy-check.
   - `idempotentHint=true` → safe to retry on transient failure (cost-safety v2 hint).
   - `openWorldHint=true` (network access) → daily/weekly/monthly cost windows from Sprint 1.9.1 apply; rate-limit gate enforced.

   **This is the unique cortex-x value-add the other tool catalogs don't ship**: a tool descriptor that automatically wires into spec-driven verification + cost safety + halt-check.

## 4. Acceptance criteria proposal (10 items)

1. New module `bin/cortex/tools/_spec.md` — human-readable descriptor spec, JSON Schema validator example, mapping table to MCP / Claude Agent SDK / Vercel / OpenAI tool shapes.
2. `bin/cortex/tools/_lib/validate-descriptor.cjs` — runtime validator (JSON Schema check, name regex `^[a-z][a-z0-9_]{0,31}$`, annotation enum values).
3. Six reference tools shipped: `read.cjs`, `write.cjs`, `edit.cjs`, `glob.cjs`, `grep.cjs`, `bash.cjs` — each with descriptor + handler + zero-deps. (`webfetch` / `websearch` deferred to v0.5 — they need `openWorldHint` cost wiring.)
4. `_adapters/toMcpServer.cjs` (primary) — emits a JSON-RPC MCP server over stdio that any MCP client can connect to.
5. Steward `bin/steward/_lib/action-engine.cjs` consumes a tool descriptor and routes through annotations:
   - `destructiveHint=true` enforces Sprint 1.9.0 `acceptance_criteria[]`.
   - `readOnlyHint=true` skips halt-check + skips journal write-trailer.
6. Sample SKILL.md in `templates/skills/example.md` references one tool from the new palette via descriptor pointer.
7. Tier 4 contract test — every shipped descriptor passes the validator + roundtrips through `toMcpServer` + `toClaudeAgentSdk` adapters losslessly.
8. Tier 5 prompt-regression test — system prompt contains a stable hash of the tool catalog (so prompt drift is detectable).
9. Defense-in-depth — `bash.cjs` reuses `bin/steward/_lib/policy-check.cjs` denylist; `read.cjs` / `write.cjs` reuse `assertEditWithinCwd` (Sprint 2.7).
10. Backward-compat (R6) — existing 11 action_kinds keep working with current direct-primitive code; tool descriptors are additive, not replacing.

## 5. Out of scope (Sprint 3.x territory)

- **Tool marketplace / registry** (Sprint 4.0 capability marketplace handles this).
- **WebFetch + WebSearch tool implementations** — deferred to Sprint 2.9.5 because they need `openWorldHint` cost wiring + integration with `STEWARD_DAILY_USD_CAP`.
- **NotebookEdit / Task / TodoWrite / Plan tools** — Steward doesn't run notebooks, sub-agents are dispatched via existing autoresearch (Sprint 2.1) which has its own pattern, and `TodoWrite` is conversational-runtime concept that doesn't fit autonomous Steward.
- **Vercel AI SDK adapter implementation in TS** — write the spec, ship the JS adapter, defer the actual TS file to a follow-up because cortex-x core stays JS-only. Operator-driven projects pulling the adapter into their TS codebase is the natural integration point.
- **MCP server packaging as standalone binary** — Sprint 4.0 marketplace concern.

## 6. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| MCP spec churns and our descriptor format breaks | Medium | Pin to MCP `2025-11-25` schema; bump intentionally per minor release |
| Adapter divergence (4 adapters drift independently) | Medium | Single contract test that roundtrips one canonical descriptor through all 4 and asserts equivalence |
| Annotation semantics misused (e.g. `readOnlyHint=true` on a destructive tool) | Low-Medium | Validator cross-checks: if handler invokes `assertEditWithinCwd`, `readOnlyHint=true` is rejected at descriptor-validate time |
| Operator-perceived "yet another tool spec" fatigue | Low | Spec doc opens with a one-page "this IS MCP, just packaged for cortex-x" framing |
| Bash tool descriptor opens shell-injection surface | High if naive | Reuse Sprint 2.7 path-traversal hardening; reuse Sprint 2.4 `containsShellMetacharacters` + `_FORBIDDEN_FLAGS`; add Tier 4 `npm-audit-style` test for known shell-injection inputs |

## 7. Stolen from

- Anthropic Claude Code tool catalog (Read/Write/Edit/Glob/Grep/Bash names + descriptor shape)
- Model Context Protocol spec (descriptor format + annotation taxonomy)
- Claude Agent SDK `createSdkMcpServer` (proof MCP is lingua franca even at Anthropic)
- Vercel AI SDK v6 `tool()` + `inputSchema` (TS surface ergonomics)
- OpenAI Agents SDK `FunctionTool` (strict_json_schema discipline)
- agentskills.io / SKILL.md (open distribution format, 12-runtime portability)
- cortex-x's own Sprint 1.9.0 spec-verifier (the integration point that makes annotations earn their keep)

## 8. Open questions for operator

1. **Naming**: do we keep Claude Code's exact tool names (`Read`, `Write`, `Edit` — capitalized) or normalize to MCP convention (`read`, `write`, `edit` — lowercase per MCP `name` regex)? Recommendation: lowercase, because the descriptor's `name` field has to match MCP's regex `^[a-z0-9_-]{1,32}$`. Document the mapping.
2. **Bash tool**: ship from day 1, or punt to Sprint 2.9.5? Adds the most operator value but also the most attack surface. Recommendation: ship with policy-check + metachar guard reused from Sprint 2.4 / 2.7 (already battle-tested).
3. **Adapter languages**: ship CJS + TS adapters together, or CJS-only first? Recommendation: CJS-only first (zero-deps, fast to verify); TS adapter as Sprint 2.9.5 along with WebFetch/WebSearch.
4. **MCP server transport**: stdio (default) only, or also stdio+sse? Recommendation: stdio only for v0; SSE adds HTTP server complexity for zero gain at this stage.

## 9. Cost + effort estimate

- **Token cost (R1 already paid)**: ~$0.0008 (single research dispatch this memo synthesizes).
- **Token cost (R2 review pipeline projected)**: ~$0.05 (6 agents, similar to 2.6/2.7/2.8).
- **Implementation effort**: ~1 evening session (~6h focused), comparable to Sprint 2.6 / 2.7 in shape.
- **LoC budget**: ~600 lines new code (~150 per tool × 4 + 6 tools, but most reuse existing primitives) + ~150 lines adapters + ~80 lines validator + ~250 lines tests.
- **Test growth**: +~40 tests target (descriptor validator + 6 tool handlers + 4 adapter roundtrips + 2 integration with action-engine).

## 10. Decision

Awaiting operator approval. If green-lit, sequencing:

1. R1 memo (this file) committed → roadmap entry merged.
2. Implementation session: descriptor spec doc + validator first, then 6 tools in parallel, then 4 adapters, then action-engine integration, then tests.
3. R2 review pipeline (mandatory per principle R2).
4. Hardening pass if findings warrant.
5. Push + CI verify.

## 11. References (full URL list, citation-traceable)

1. https://israynotarray.com/en/ai/2026/04/29/claude-code-built-in-tools-explained/
2. https://callsphere.ai/blog/claude-code-tool-system-explained
3. https://github.com/Piebald-AI/claude-code-system-prompts
4. https://ai-sdk.dev/docs/foundations/tools
5. https://vercel.com/blog/ai-sdk-6
6. https://openai.github.io/openai-agents-python/ref/function_schema/
7. https://docs.claude.com/en/docs/agent-sdk/custom-tools
8. https://reference.langchain.com/python/langchain-core/tools/base/BaseTool
9. https://www.agensi.io/learn/agent-skills-open-standard
10. https://modelcontextprotocol.io/specification/2025-11-25
11. https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
12. https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
13. https://chatforest.com/guides/mcp-tool-annotations-explained/
14. https://en.wikipedia.org/wiki/Model_Context_Protocol
15. https://neosalpha.com/blogs/ai-agent-protocols-acp-vs-mcp-vs-a2a/
