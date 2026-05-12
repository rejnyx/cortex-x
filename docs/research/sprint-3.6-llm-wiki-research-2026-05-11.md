---
title: "Sprint 3.6 — LLM Wiki research (Karpathy pattern vs existing Sprint 3.2/3.3/5.2)"
date: 2026-05-11
sprint: "3.6 (proposed) — decision: fold into 3.2/3.3 vs new sprint"
status: research-complete
authors: ["autoresearch agent"]
inputs:
  - "Callum/Waterloos YouTube transcript: 'Why LLM Wiki'"
  - "Karpathy gist 442a6bf555914893e9891c11519de94f"
  - "Sprint 3.2 (FTS5), 3.3 (GraphRAG codebase), 5.2 (Obsidian via Khoj) — already on roadmap"
---

# LLM Wiki pattern — research memo

## 1. Karpathy's LLM Wiki — primary source

**F1.** The post is real and primary-sourceable: tweet 2026-04-03 followed by gist `karpathy/442a6bf555914893e9891c11519de94f` (~two days later) titled `llm-wiki.md`. Wide community reception within days; spawned the Farzapedia example which Karpathy himself amplified on X. Sources: gist URL (`https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`), `https://x.com/karpathy/status/2040572272944324650`, VentureBeat coverage (`https://venturebeat.com/data/karpathy-shares-llm-knowledge-base-architecture-that-bypasses-rag-with-an`).

**F2.** Karpathy ships **no reference implementation**. The gist is explicitly abstract: "This document is intentionally abstract... The exact directory structure, the schema conventions, the page formats, the tooling — all of that will depend on your domain." It is meant to be copy-pasted into Claude Code / Codex / "any agent" as a pattern prompt. Source: gist fetch.

**F3.** The three-layer architecture matches the transcript: (a) **raw sources** (immutable curated docs), (b) **the wiki** (LLM-generated cross-referenced markdown), (c) **the schema** (a `CLAUDE.md`-style configuration doc). Maintenance is event-driven, not scheduled: ingest on arrival, query on demand, lint periodically. Hints at `index.md` (content catalog) and `log.md` (append-only timeline). Source: gist fetch.

**F4.** Core anti-RAG argument is verbatim: *"the LLM is rediscovering knowledge from scratch on every question."* The wiki is positioned as a "persistent, compounding artifact" where cross-references and contradiction-flags are pre-materialized. Source: gist fetch. **This exactly mirrors cortex-x's existing institutional-wisdom layer (lessons.jsonl + cortex/projects/<slug>.md).** The pattern is not new to us; it just has a name now.

## 2. GraphRAG state of the art — 2026

**F5.** The "RAG vs GraphRAG" debate moved past the original 2024 Microsoft paper. The ICLR'26 benchmark "When to use Graphs in RAG" (`https://arxiv.org/abs/2506.05690`) finds GraphRAG **wins on multi-hop QA** (+4.5% on HotpotQA, best on HotPotQA/MultiHop-RAG) but **loses on single-hop and time-sensitive queries** (-13.4% accuracy on Natural Questions, -16.6% on real-time queries). 2.3x median latency penalty. Independent confirmation: `https://arxiv.org/abs/2502.11371` (Feb 2026 systematic eval).

**F6.** Cost economics are the headline 2026 shift: original Microsoft GraphRAG indexing was **10-40x vector RAG cost** (`https://medium.com/graph-praxis/graph-rag-in-2026-a-practitioners-guide-to-what-actually-works-dca4962e7517`). **LazyGraphRAG** (Microsoft Research, in cleanup for Q1-Q2 2026 release) shrinks indexing to **0.1% of full GraphRAG** — same as vector RAG — and **700x lower query cost** for global queries (`https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/`). Production deployments report 70-97% reductions (`https://medium.com/graph-praxis/the-graphrag-cost-cliff-how-33-000-became-33-in-eighteen-months-be1b0fbe37e4`). **Implication for cortex-x**: if we wait 1-2 sprints, the cost calculus for GraphRAG flips.

**F7.** Maintained 2026 implementations: Microsoft GraphRAG (active, LazyGraphRAG cleanup in flight per `https://github.com/microsoft/graphrag`), LlamaIndex PropertyGraphIndex with Neo4j (primary) + FalkorDB (alternative) backends (`https://developers.llamaindex.ai/python/examples/property_graph/property_graph_neo4j/`, `https://docs.falkordb.com/genai-tools/llamaindex.html`). Memgraph integration with LlamaIndex was **not confirmed in 2026 docs** (unverified). All three production-grade backends require a server process — **violates cortex-x zero-deps invariant**.

## 3. Auto-maintained wikis in agent frameworks — who actually ships

**F8.** **Letta (ex-MemGPT)** ships a tiered memory model (core / archival / recall) with the agent calling tools to swap pages in/out. Archival memory can be backed by vector OR graph stores (graph is **Pro-tier**, not OSS-default). Source: `https://github.com/letta-ai/letta`, `https://www.letta.com/blog/agent-memory`. **Not wiki-shaped** — agent reads/writes blocks, no interlinked markdown surface.

**F9.** **Anthropic memory tool (`memory_20250818` beta)** is **explicitly file-based, not graph-based**: 6 operations (view, create, str_replace, insert, delete, rename) over a `/memories` directory of plain markdown / `CLAUDE.md` hierarchies. No built-in graph structure; community ships a separate **MCP Knowledge Graph Memory Server** (`memory.json` of entities + relations + observations) if graph semantics are wanted. Sources: `https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool`, `https://www.pulsemcp.com/servers/modelcontextprotocol-knowledge-graph-memory`. **This is the closest existing primitive to the Karpathy wiki, and it shipped before Karpathy's post.**

**F10.** **Cursor / Windsurf / codebase memory in 2026**: Windsurf's Memories feature is convention-learning (RAG-shaped + temporal), not wiki-shaped (`https://tech-insider.org/cursor-vs-windsurf-2026/`). The wiki-shaped pattern for codebases is shipped by **GitNexus** (10k+ stars early 2026, MCP server for Claude Code / Cursor — open-source property-graph backend, `https://github.com/CodeGraphContext/CodeGraphContext`, `https://www.marktechpost.com/2026/04/24/meet-gitnexus-an-open-source-mcp-native-knowledge-graph-engine-...`) and **Nomik** (`https://nomik.co/`). Both are MCP-native. **These already overlap heavily with our planned Sprint 3.3.**

**F11.** **Obsidian + AI agents 2026**: real wiki-shaped pattern ships. Eugeniu Ghelbur's `obsidian-second-brain` skill (`https://github.com/eugeniughelbur/obsidian-second-brain`) — 31 Claude Code commands, vault-first research, scheduled agents, auto-`[[backlink]]` insertion, daily delta reports. Pattern: agent drops a link in chat → page fetched → topic-tagged → markdown note written → end-of-day scan adds backlinks. Source: `https://www.nxcode.io/resources/news/obsidian-ai-second-brain-complete-guide-2026`. The **human-vault vs agentic-vault** split mentioned in the transcript is not yet formalized as a named pattern in 2026 docs (unverified — community discussion exists, no canonical reference).

## 4. Trade-offs for cortex-x

**T1. Graph DB (Neo4j / FalkorDB / Memgraph)** — violates zero-deps invariant. Requires server process, schema management, backup story. Indexing cost premium 10-40x without LazyGraphRAG. **Reject for Tier 1-2.** Reconsider only post-Tier 3 if Sprint 4.x productization justifies a hosted graph backend.

**T2. Pure-markdown wiki with regex-extracted `[[wikilinks]]`** — preserves zero-deps. Maps cleanly onto existing `$CORTEX_DATA_HOME/projects/<slug>.md` (already markdown), and Sprint 2.7 pattern_transfer already cross-references projects. Query power limited (no multi-hop traversal without a layer-on-top), but Karpathy's pattern doesn't need traversal — it needs **co-location + cross-references + LLM as the query engine**. This is what cortex-x already does; we just don't enforce `[[link]]` syntax yet.

**T3. Hybrid: SQLite FTS5 (Sprint 3.2 already planned) + markdown-linked notes (cortex/projects/)** — best fit. FTS5 gives O(log n) lookup over a markdown corpus, zero-deps (SQLite ships in Node ≥22). LazyGraphRAG-style "summarize on read, not on index" matches our R6 (backward-compatible by default) and avoids ~$50-200 indexing premiums (F6). The graph traversal capability of GraphRAG is **not the value-add** for an operator with ≤500 markdown notes; the value-add is **interlinking + contradiction-lint + orphan detection**, which are all LLM-on-corpus operations, not graph-DB operations.

**T4. Karpathy gist as installable prompt** — the gist is literally a copy-paste prompt. We can ship it as `prompts/wiki-curator.md` in <1 day, parameterized over `$CORTEX_DATA_HOME/projects/`. **Highest ROI / lowest risk move.**

## 5. Recommendation

**For cortex-x: fold the LLM Wiki pattern into existing Sprint 3.2, do NOT create new Sprint 3.6, and do NOT add a graph DB.**

Specifically:

1. **Sprint 3.2 (FTS5)** — extend scope to include (a) `[[wikilink]]` regex extractor + orphan-page lint, (b) a new `prompts/wiki-curator.md` invokable nightly (cadence: same cron lane as Steward) to flag contradictions and missing entity pages across `lessons.jsonl` + `cortex/projects/*.md`. Cost: ~2 days of work, zero new deps. Backed by F2 (Karpathy ships no impl — pattern only), F9 (Anthropic memory tool is file-based and already production), T3 (FTS5 is enough for our corpus size).
2. **Sprint 3.3 (GraphRAG codebase)** — defer 1 sprint and re-evaluate against **LazyGraphRAG** (F6) once Microsoft ships Q1-Q2 2026. The cost cliff is real; building on full-fat GraphRAG now would be amortizing yesterday's economics. If we need codebase structural awareness sooner, evaluate **GitNexus MCP** as a drop-in (F10) before writing our own Tree-sitter pipeline.
3. **Sprint 5.2 (Obsidian via Khoj)** — keep as planned; the `obsidian-second-brain` skill (F11) confirms the human-vault landing pattern works in 2026. Khoj remains the right choice for vault search; do not swap to Letta or Mem0 (F8 — wrong shape).

**Net effect:** zero new sprints, one sprint scope extension, one defer. Preserves zero-deps, captures the Karpathy mindshare via a prompt asset, and avoids the LazyGraphRAG timing trap.

## Open questions / unverified

- Human-vault vs agentic-vault as a **formal named pattern** — community discusses, no canonical 2026 reference found (unverified).
- Memgraph + LlamaIndex active 2026 integration — search results did not confirm (unverified). Stick with Neo4j or FalkorDB if we ever pick a graph backend.
- Whether the FTS5 + `[[wikilink]]` lint approach scales past ~5000 notes — out of scope for current operator corpus (~50-200 notes), revisit at Tier 3.
