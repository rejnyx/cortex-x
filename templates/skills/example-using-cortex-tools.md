---
name: example-using-cortex-tools
description: Example SKILL.md showing how to reference cortex-x tools via the Sprint 2.9 descriptor palette. Use this as a starting template when authoring a skill that consumes the read/write/edit/glob/grep/bash palette.
allowed-tools:
  - read
  - glob
  - grep
metadata:
  version: 0.1.0
  cortex-tool-spec: v0
  references:
    - bin/cortex/tools/_spec.md
    - bin/cortex/tools/index.cjs
license: PolyForm-Noncommercial-1.0.0
---

# Example skill — using cortex-x tools via descriptor palette

This skill demonstrates the Sprint 2.9 tool-descriptor pattern: a portable
SKILL.md that runs unchanged in any runtime that consumes the cortex-x
palette (Steward, Claude Agent SDK, Vercel AI SDK, OpenAI Agents, MCP).

## How tools resolve

The `allowed-tools` frontmatter list above MUST match descriptor names in
the cortex-x palette (lowercase, MCP regex `^[a-z0-9_-]{1,32}$`). At skill
load time, the runtime imports `bin/cortex/tools/index.cjs` and binds each
listed name to the matching descriptor.

For each runtime, the binding goes through a different adapter:

- **Steward** — palette imported directly; `requiredGates(tool)` from
  `bin/cortex/tools/_lib/annotation-routing.cjs` decides which safety gates
  apply per tool annotation profile.
- **Claude Agent SDK** — `toClaudeAgentSdk(palette)` produces an array
  passed to `createSdkMcpServer`.
- **Vercel AI SDK / OpenAI Agents** — corresponding adapter.
- **MCP client** (Cursor, Codex, Aider, Windsurf) — connects to a stdio
  MCP server emitting `tools/list` from `toMcpServer(palette)`.

## What this skill does

The skill itself is illustrative: it does not run autonomously. It
documents the pattern an author follows to keep the same skill working
across all five runtimes.

A real skill that uses this pattern would, for example:

1. Use `glob` to enumerate `**/*.test.cjs`.
2. Use `read` on each file to extract test names.
3. Use `grep` to find lines matching `describe(`.

The skill does NOT include `write`, `edit`, or `bash` in `allowed-tools` —
this skill is read-only by design (tool annotations: `readOnlyHint=true`
across all listed tools, no halt-check or journal trailer needed).

## Runtime-specific notes

- **Steward**: this skill's read-only profile means `policy-check.cjs` is
  not invoked, `STEWARD_HALT` does not block invocation, and no journal
  write-trailer is required (Sprint 1.9.0 + 2.9 annotation routing).
- **Direct MCP**: the `toMcpServer.cjs` adapter at
  `bin/cortex/tools/_adapters/toMcpServer.cjs` exposes `tools/list` +
  `tools/call` over stdio JSON-RPC. Buffer cap 10 MiB, parse errors
  return JSON-RPC `-32700`, notifications (no `id`) get no response.

## References

- Sprint 2.9 R1 memo — `docs/research/sprint-2.9-tools-foundation-2026-05-09.md`
- Tool descriptor spec — `bin/cortex/tools/_spec.md`
- Annotation routing — `bin/cortex/tools/_lib/annotation-routing.cjs`
- Validator — `bin/cortex/tools/_lib/validate-descriptor.cjs`
- MCP 2025-11-25 spec — https://modelcontextprotocol.io/specification/2025-11-25
