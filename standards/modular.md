# Modular — Isolated Subsystems

> Each subsystem does one thing, has a clear interface, and can be replaced without breaking others.

## Why

Tightly coupled code is where bugs hide and velocity dies. When changing X requires touching A, B, C, you don't change X — you avoid it. Modularity buys you the ability to refactor, replace, and scale individual pieces without cascading rewrites.

## Rules

1. **Interface > implementation.** Consumers depend on types/contracts, not internal details.
2. **Vertical slices > horizontal layers.** Feature folder > "components/hooks/utils" layered by tech. **For AI agents especially:** they default to building *horizontally* (all schema, then all API, then all UI), which delays integration feedback to the final phase. Force thin vertical slices (schema → service → API → UI → test), each independently demoable, so the loop gets feedback on the critical path in slice 1 — "tracer bullets" (*Pragmatic Programmer*).
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

## Module depth for AI codeability

John Ousterhout (*A Philosophy of Software Design*) splits modules into **deep** (small/simple interface hiding a lot of functionality — e.g. Unix file I/O: 5 calls, enormous machinery behind them) and **shallow** (lots of interface surface, little behind it — "classitis": many tiny chunks each exposing internals). **Deep is better**, and the reason matters more with AI agents than with humans:

1. **Information hiding = token economy.** A shallow, leaky interface forces an agent to load more context to use a module correctly (it must read the internals to know how the pieces fit). A deep module is usable from its interface alone — fewer tokens spent, more budget left in the [smart zone](./context-engineering.md). The agent navigates a graph of *interfaces*, not a graph of *implementations*.

2. **Deep modules have a clean test boundary.** One test boundary around a deep module exercises a lot of real functionality. Shallow modules force a bad choice: wrap every tiny function in its own boundary (mock-heavy, asserts nothing) or test big groups and hope. *(This "deep → more testable" link is a defensible synthesis, not part of Ousterhout's original canon — but it holds in practice.)*

3. **Feedback loops are the floor, not a nice-to-have.** The quality of your test/type-check/lint loop sets the ceiling on how well an agent can work in your codebase — if it can't get fast, trustworthy feedback, it codes blind. SWE-bench Verified makes this concrete: agent success hinges on a reliable fail→pass test harness, and most passing runs iterate against real tests for >10 minutes. Bad agent output? Improve the feedback loop before you touch the prompt. See [`correctness.md`](./correctness.md) for how to *build* that loop (Zod boundaries, property + mutation tests). ([SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/))

4. **Design the interface, delegate the implementation.** Treat deep modules as "gray boxes": you own and review the interface + behavior contract; you let the agent fill the inside. This keeps your mental model of the codebase intact while moving fast — you don't have to read every line, only verify the module behaves as specified under its tests.

**Practical signal:** unaided agents tend to *produce* shallow modules (many small files, leaky interfaces). When directing implementation, specify the module map up front (which deep modules exist, their interfaces, what's tested around them) and keep it in mind through planning and review. The [`/improve-codebase-architecture`](../shared/skills/improve-codebase-architecture/SKILL.md) skill audits an existing repo for shallow-module clusters + zero-test modules and proposes deepening candidates.

## When to break modularity

When performance demands co-location. Example: hot-loop code that reads 5 tables should be 1 query, not 5 modular calls. **Measure first, then decide.**
