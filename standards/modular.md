# Modular — Isolated Subsystems

> Each subsystem does one thing, has a clear interface, and can be replaced without breaking others.

## Why

Tightly coupled code is where bugs hide and velocity dies. When changing X requires touching A, B, C, you don't change X — you avoid it. Modularity buys you the ability to refactor, replace, and scale individual pieces without cascading rewrites.

## Rules

1. **Interface > implementation.** Consumers depend on types/contracts, not internal details.
2. **Vertical slices > horizontal layers.** Feature folder > "components/hooks/utils" layered by tech.
3. **Adapter pattern for external services.** Stripe, Supabase, OpenAI all hidden behind app-specific adapters.
4. **Tool-based architecture for AI agents.** LEGO tools assembled by orchestrator, not monolithic mega-tools.
5. **Explicit imports, no barrel re-exports.** Barrel files (`index.ts` re-exporting everything) kill tree-shaking and hide dependencies.

## Test for modularity

Pick any file. Ask:
- Can I delete this module and have TypeScript tell me every place that breaks? (If no → too coupled)
- Can I swap the implementation without changing consumers? (If no → leaky abstraction)
- Does this module know about its callers? (If yes → reverse dependency, refactor)

## Module size heuristics

- **File:** <300 lines. Beyond that, split.
- **Function:** <50 lines. Beyond that, extract.
- **Subsystem (folder):** 5-15 files. Beyond that, split into sub-subsystems.

## Anti-patterns

- ❌ `utils.ts` with 47 unrelated helpers → split by domain
- ❌ "Shared" folder of 200 files imported everywhere → too much shared = nothing is separate
- ❌ Circular imports → one of two modules is in wrong place
- ❌ Giant `lib/types.ts` with every type in the app → types go with features
- ❌ Feature knows about another feature's internals → should go through shared interface

## Modular AI agent pattern (LEGO tools)

Each tool does ONE thing:
- `query_clients` — reads clients with filters
- `manage_clients` — CRUD for clients
- `generate_chart` — produces chart config

The agent **composes** these via tool chaining. No "mega-tool" that does 5 things conditionally.

Orchestrator subagent coordinates specialists (reviewer, security, architect). Lead agent doesn't duplicate their logic.

## When to break modularity

When performance demands co-location. Example: hot-loop code that reads 5 tables should be 1 query, not 5 modular calls. **Measure first, then decide.**
