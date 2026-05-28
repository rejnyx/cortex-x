---
name: improve-codebase-architecture
description: Read-only audit of an EXISTING codebase for module-depth problems that make it hard for AI agents to work in. Surfaces shallow modules (leaky interfaces, many tiny files exporting internals), zero-test modules, and tightly-coupled clusters, then proposes deepening candidates with coupling rationale + a test-boundary recommendation. Produces a prioritized markdown report — NEVER auto-refactors. Grounded in Ousterhout's A Philosophy of Software Design (deep vs shallow modules) + the principle that test/feedback-loop quality sets the ceiling on AI coding quality (SWE-bench Verified). Use after /audit or /test-audit, before a big AI-assisted refactor, or when agents keep producing low-quality changes in one area. Triggers (CZ+EN) "/improve-codebase-architecture", "improve architecture", "deepen modules", "make this codebase agent-friendly", "why does AI write bad code in this repo", "shallow modules audit", "prohlub moduly", "zlepši architekturu", "proč tu AI píše špatný kód", "najdi shallow moduly".
disable-model-invocation: false
---

# /improve-codebase-architecture — make a codebase AI agents can work in

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). Counts and findings, not praise. No emoji.

You are auditing an existing codebase for **module depth** (Ousterhout: deep = simple interface / lots of functionality; shallow = leaky interface / little functionality). The thesis: a codebase of deep, well-tested modules gives an AI agent a clean interface graph to navigate and fast feedback loops to code against; a codebase of shallow modules forces the agent to load implementation details into context and guess at test boundaries — which is *the* lever on agent output quality. See [`standards/modular.md`](../../../standards/modular.md) § "Module depth for AI codeability".

**This is a READ-ONLY audit.** You produce a prioritized report. You do NOT refactor, edit source, or open PRs. The operator picks what to act on.

## Phase 0 — locate the code

Detect the stack and the source roots (don't audit `node_modules`, `dist`, `.next`, `vendor`, generated files, or secret/config files — `.env*`, `*.pem`, `*.key`, lockfiles). Note the test framework + how tests map to source (co-located `*.test.ts` vs. a `tests/` tree). If there's a `cortex/AUDIT.md` or `repo-map.md` from a prior `/audit`, read it for context first.

## Phase 1 — scan for shallow-module signals

Walk the source tree and flag modules exhibiting these signals (each is a *hint*, not a verdict — weight them together):

- **Leaky interface** — a file/module that exports many symbols relative to the functionality behind them (barrel re-exports, `utils.ts` with N unrelated helpers, types files exporting everything).
- **Many tiny chunks** — a folder of many <30-line files that only make sense read together (classitis); callers must understand all of them to use any.
- **Zero-test modules** — source with meaningful logic and no test boundary around it. This is the highest-priority signal: no test = no feedback loop = agent codes blind here.
- **High coupling** — a module that imports from / is imported by many others, or that reaches into another module's internals rather than its interface (reverse dependency, circular import).
- **Interface ≈ implementation** — a "module" whose interface surface is as large as its body (no information hiding; nothing is actually encapsulated).

Use Grep/Glob to gather evidence (import counts, export counts, file sizes, presence of a sibling test). Cite real `file:line` for every signal — never assert a pattern you haven't seen.

## Phase 2 — cluster + rank deepening candidates

Group related shallow modules into **deepening candidates** — a cluster that could become one deep module with a single clean interface + one test boundary. For each candidate report:

- **Modules involved** (file paths) + the signals that flagged them.
- **Coupling rationale** — why these belong together (shared state, always-changed-together, one calls the others' internals).
- **Proposed deep interface** — the small surface the cluster *should* expose (1-line sketch, not a full design).
- **Test-boundary recommendation** — where to draw the test boundary, and whether substitutability is local (in-memory/SQLite) or needs a seam.
- **Priority** — P0 (zero-test + high-coupling on a critical path), P1 (zero-test or high-coupling), P2 (cosmetic shallowness, low risk).

Order by priority. Cap the report at the top ~7 candidates — a wall of findings is noise (see anti-patterns).

## Phase 3 — write the report

Write `cortex/architecture-audit.md` in the project (create `cortex/` if absent). Sections:

1. **Summary** — N candidates found, breakdown by priority, the single biggest gap in one line.
2. **Deepening candidates** — the Phase 2 list, P0 first.
3. **Quick wins** — any zero-test deep-ish module that just needs a test boundary added (cheap, high feedback-loop payoff).
4. **What this audit did NOT do** — restate: no refactor applied; operator picks targets.

Announce the artifact with one concrete line (path + candidate count). Then stop — do not start refactoring.

## Out of scope (explicit)

- **No auto-refactor.** This skill never edits source or moves files. Deepening a module is a human-reviewed change (it alters interfaces — high blast radius). If the operator wants to act, that's a separate, scoped task.
- **No metric theater.** Don't invent a "depth score" number; the signals + rationale are the output. (Coupling metrics like fan-in/fan-out are evidence, not a grade.)
- **No GraphRAG / full dependency graph build** — that's deferred (roadmap Sprint 3.3). Use Grep/Glob evidence, not a heavyweight analyzer.

## Composes with

- `/audit` (12-dimension general audit) — run that first for repo context; this skill is the architecture-depth lens.
- `/test-audit` (QA lens) — pairs naturally: zero-test modules surface in both; this one frames them as feedback-loop gaps.
- [`standards/modular.md`](../../../standards/modular.md) — the standard this skill enforces.
- [`standards/context-engineering.md`](../../../standards/context-engineering.md) — why deep modules save agent context budget.

## Sources

- [Ousterhout — deep modules](https://softengbook.org/articles/deep-modules) — deep vs shallow, information hiding, classitis
- [aihero — how to make codebases AI agents love](https://www.aihero.dev/how-to-make-codebases-ai-agents-love) — the AI-codeability framing
- [SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) — testability gates agent success
