# Multi-agent self-spawning ("anthill") — R1 research memo, 2026-05-08

> Research memo for Tier 2 / Tier 4 trajectory decision: should cortex-x's
> Steward (currently single-process, 9-kind capability palette) evolve into a
> supervisor that dynamically spawns specialist sub-agents under load? Memo
> grounds the operator's "anthill" intuition against 2026 SOTA.

## TL;DR

**Yes, the pattern is real and shipping** — Anthropic, the Claude Agent SDK,
LangGraph, CrewAI, AutoGen v0.4, OpenAI Agents SDK and a fast-growing crop of
self-hosted runtimes (SwarmClaw, Overstory, Mission Control) all ship some
flavor of orchestrator-worker-with-spawn in 2026. Anthropic publicly reports
**+90.2% on research evals** with Opus-coordinator + Sonnet-subagents but warns
it costs **~15× the tokens of a chat session** and is wrong for tasks that need
shared context (most coding work). **The "multi-agent trap" is also real**: a
December 2025 DeepMind result shows unstructured agent networks amplify errors
up to 17.2× over a single-agent baseline, and the public $47K runaway-loop
incident (two agents in a ping-pong handshake for 11 days) is the canonical
cautionary tale. **Recommendation for cortex-x: defer general dynamic spawning
to Tier 2 Sprint 2.2 (worktree supervisor MVP, 1 supervisor + 1 spawned
worker)** behind the same R1–R6 gates that protected 1.9.x. **The "anthill on a
home NAS" vision belongs in Tier 4 Sprint 5.2+** after souls.md, local-Ollama
fallback, and a Phase-equivalent budget breaker for *trees* of agents (not just
single calls). Don't skip the verifier: verifier > spawner.

## 1. Anthropic multi-agent stack

The mid-2025 paper "How we built our multi-agent research system" describes an
explicit **orchestrator-worker** pattern that scales sub-agent count to query
complexity:

- **Architecture:** lead agent (Claude Opus 4) → analyzes query → spawns N
  Sonnet 4 sub-agents in parallel → each sub-agent performs its own
  search-and-summarize loop → returns a *single final message* to the lead →
  lead synthesizes → if not enough, lead spawns *more* sub-agents or refines
  strategy. "Once sufficient information is gathered, the system exits the
  research loop." ([Anthropic engineering blog][1])

- **Spawn count is dynamic and prompted:** "Simple fact-finding: 1 agent with
  3-10 tool calls. Direct comparisons: 2-4 subagents with 10-15 calls each.
  Complex research: 10+ subagents with divided responsibilities." Effort scales
  by embedded rules in the lead-agent prompt. ([Anthropic][1])

- **Performance:** "Outperformed single-agent Claude Opus 4 by 90.2% on
  Anthropic's internal research eval." Parallelization cut research time "by up
  to 90% for complex queries." ([Anthropic][1])

- **Cost overhead is substantial:** "Multi-agent systems use about 15× more
  tokens than chats" while "agents typically use about 4× more tokens than chat
  interactions." Token usage alone "explains 80% of the variance" in BrowseComp
  performance — multi-agent works mostly because it spends more tokens on the
  problem. ([Anthropic][1], [ByteByteGo summary][2])

- **Hand-off protocol:** sub-agents "act as intelligent filters" — they're
  called with an objective, output format, tool list, and task boundaries;
  they return a structured summary, never a raw transcript. The lead never
  sees their tool calls. ([Anthropic][1])

- **Failure modes Anthropic explicitly calls out:** "spawning excessive
  subagents for simple queries; duplicating work due to vague task
  descriptions; selecting SEO-optimized content over authoritative sources;
  continuing searches after finding sufficient results." ([Anthropic][1])

- **Where it does NOT apply:** "valuable tasks that involve heavy
  parallelization" yes; tasks "that require all agents to share the same
  context" or "extensive real-time coordination (e.g., most coding tasks)"
  no. ([Anthropic][1]) — **This is directly relevant to cortex-x**: most of
  Steward's 9 capability kinds are coding-shaped, *not* breadth-research-shaped.

## 2. Claude Agent SDK subagents

The Claude Agent SDK (Sept 2025+) makes sub-agents a first-class primitive via
the `agents` parameter and the built-in `Agent` tool. Documentation is current
as of May 2026. ([Anthropic SDK docs][3])

- **Spawn mechanism:** "Subagents are separate agent instances that your main
  agent can spawn to handle focused subtasks" via the `Agent` tool, which must
  be in `allowedTools`. Three creation modes: programmatic (`agents` param),
  filesystem (`.claude/agents/*.md`), or built-in `general-purpose`. ([SDK
  docs][3])

- **Isolation contract:** "A subagent's context window starts fresh (no parent
  conversation) but isn't empty. The only channel from parent to subagent is
  the Agent tool's prompt string." Tool calls and intermediate results stay
  inside the subagent; only the final message returns. ([SDK docs][3])

- **Per-agent budget controls** (new in 2026 SDK):
  - `maxTurns` — "Maximum number of agentic turns before the agent stops"
  - `effort` — `'low' | 'medium' | 'high' | 'xhigh' | 'max' | number`
  - `model` — override per sub-agent ("Opus for strict review, Sonnet for
    balanced")
  - `permissionMode` — per-sub-agent permission gate
  - `tools` / `disallowedTools` — restrict capability surface
  - `background: true` — non-blocking task ([SDK docs][3])

- **Hard guardrail — no recursive spawning:** "Subagents cannot spawn their
  own subagents. Don't include `Agent` in a subagent's `tools` array."
  ([SDK docs][3]) **This is the SDK's primary defense against tree-of-agents
  cost explosion.** Tree depth is hard-capped at 2 (parent → child).

- **Lifecycle hooks:** Frontmatter and settings.json hooks fire at sub-agent
  spawn and stop. "The SDK supports SubagentStart / SubagentStop hooks that
  fire when subagents are spawned or complete, and PermissionRequest hooks
  that fire when a permission decision is needed." ([Claude Agent SDK Python
  Guide 2026][4])

- **Production pattern Anthropic publishes (Apr 2026):** Planner / Generator /
  Evaluator triad. "Divide work among a Planner agent (structure and goals), a
  Generator agent (execution), and an Evaluator agent (independent quality
  assessment), with agents handing off through structured artifacts." ([Code
  With Seb][5])

- **No built-in cost cap on the parent budget across sub-agents.** Each
  sub-agent has `maxTurns` and `effort`, but the SDK does not ship a
  per-tree token ceiling. **Operator must implement.**

## 3. OpenAI Swarm / Agents SDK

- **Swarm (Oct 2024)** was *explicitly educational*. The repo banner reads:
  "Educational framework exploring ergonomic, lightweight multi-agent
  orchestration. Managed by OpenAI Solution team." ([openai/swarm GitHub][6])
  It is **not** production-ready and is now superseded.

- **OpenAI Agents SDK** is the production successor. As of April 2026 OpenAI
  shipped a major update: "model-native harness that lets agents work across
  files and tools on a computer, plus native sandbox execution." Python first,
  TypeScript planned. ([OpenAI announcement][7], [TechCrunch coverage][8])

- **Three primitives:** "Handoffs for agent-to-agent transfer, Guardrails for
  input/output validation, and Tracing for end-to-end observability of agent
  chains." ([OpenAI docs][9])

- **Dynamic spawning is *not* the model.** OpenAI's Agents SDK uses
  *handoffs*: a primary agent transfers control to a specialised agent. It's a
  **chain**, not a fan-out. To get fan-out you compose multiple handoff stages
  yourself. This is closer to a router than to Anthropic's orchestrator-worker.
  ([OpenAI docs][9])

- **Production status:** actively maintained by OpenAI, cited as
  enterprise-default in 2026 framework comparisons. ([QubitTool 2026
  shootout][10])

## 4. AutoGen v0.4+ (Microsoft) and CrewAI hierarchical

**AutoGen v0.4** (early 2025 GA, current as of 2026):

- Complete redesign — "asynchronous, event-driven architecture. Agents
  communicate through asynchronous messages, supporting both event-driven and
  request/response interaction patterns." ([Microsoft Research blog][11])

- **No built-in hierarchical layer:** "AutoGen 0.4 doesn't come with a
  built-in 'planner agent' or 'hierarchical workflow' layer out of the box."
  You build it on top of `SelectorGroupChat` or the Core API's
  subscription/typing model. ([Microsoft AutoGen GitHub discussion][12])

- **Failure-recovery story is implicit, not explicit.** OpenTelemetry support
  is built-in; circuit breakers and retry budgets are operator's
  responsibility. ([Microsoft Research][11])

**CrewAI hierarchical mode:**

- "A 'manager' agent coordinates the workflow, delegates tasks, and validates
  outcomes." Manager can be auto-created or explicitly configured via
  `manager_agent` / `manager_llm`. ([CrewAI docs][13])

- **"Tasks do not require explicit agent assignment — the manager dynamically
  assigns tasks to agents based on their roles, goals, and capabilities."**
  This is *dynamic routing within a fixed team*, not dynamic *spawning* of
  new agents. ([CrewAI docs][13])

- The manager doesn't create new sub-agent types at runtime — it picks from
  the configured crew. Closer to load-balancer than to fork-on-demand.

## 5. LangGraph supervisor + dynamic spawning

LangGraph is the framework most explicitly designed for the orchestrator-
worker shape via the **Send API** and the `langgraph-supervisor-py` library.

- **Send API enables true dynamic spawning:** "The Send API allows dynamic
  creation of worker nodes and sending them specific inputs." ([LangChain
  docs][14])

- **Routing is LLM-judged:** "The supervisor agent demonstrates LangGraph
  orchestration by routing requests based on content analysis rather than
  rigid rules… dynamic task routing where the coordinator reasons about
  agent capabilities and current task state at each decision point,
  re-routing based on partial results." ([dev.to LangGraph 2026][15])

- **`langgraph-supervisor-py` v0.0.31** (Nov 2025) implements the supervisor
  via tool-based handoffs (`delegate_to_math_expert`-style tools).
  **Importantly: agents are defined upfront — `create_supervisor([agent1,
  agent2], ...)`. Dynamic spawning of *new agent types at runtime* is not
  built in.** Maintainers now recommend "using the supervisor pattern
  directly via tools" rather than the library wrapper. ([langgraph-
  supervisor-py README][16])

- **2026 roadmap signal:** "Features to watch in LangGraph 2026 include
  multi-agent collaboration with agents that spawn sub-agents dynamically."
  ([dev.to LangGraph 2026][15]) — i.e., it's coming, not shipped.

- **GPU-side hazard worth remembering for Tier 4 NAS deployment:** "A
  supervisor spawning 8 workers simultaneously creates 8 concurrent vLLM
  requests, each holding a KV cache slot; if the GPU has headroom for 6
  concurrent sequences, the 7th and 8th requests queue, requiring
  administrators to cap `max_concurrency` in the supervisor node to match
  available KV cache slots." ([Spheron LangGraph deployment guide
  2026][17]) — **the "anthill" gets bottlenecked by VRAM, not by code.**

## 6. Cost runaway + loop detection in multi-agent

This is where the field has matured most visibly between 2025 and 2026, driven
by real incidents.

- **The canonical $47K incident:** "Two agents ran for 11 days before anyone
  noticed. The system produced zero useful output. The API meter ran the
  entire time." Root cause: "two agents locked in an endless handshake, each
  waiting for the other to produce the output that would break the cycle" —
  a Coordinator/Analyst ping-pong with no exit condition. ([Medium —
  msatfi89][18])

- **DeepMind error-amplification result (Dec 2025):** "Unstructured
  multi-agent networks amplify errors up to 17.2 times compared to
  single-agent baselines." ([Towards Data Science — *The Multi-Agent Trap*][19])

- **Failure-mode taxonomy from the same article:**
  1. Compound reliability decay (99% × 10 steps = 90.4% system reliability;
     95% × 20 = 35.8%)
  2. Coordination breakdowns (36.9% of failures — agents interpret ambiguous
     instructions differently)
  3. Cost explosion (3.5× cost multiplier observed; "$40+ in API fees within
     minutes with no useful output")
  4. Security gaps ("prompt injection vulnerabilities in 73% of assessed
     production deployments")
  5. Infinite retry loops ([TDS][19])

- **Mitigation patterns now considered table-stakes** (consensus across
  RelayPlane, AgentBudget, AI Security Gateway, Galileo guides):
  - **Per-request ceiling, per-session budget, per-tree budget** (three
    separate caps). ([RelayPlane][20], [AI Security Gateway][21])
  - **Exact-repeat fingerprinting**: "Hash each iteration's `(tool_name,
    result_preview)` tuple and detect when three identical fingerprints
    appear in a row." ([Modexa Medium][22])
  - **Spend-rate auto-throttle:** "If a key's spend rate exceeds 3× its
    trailing 7-day average in a 15-minute window, auto-throttle it to
    1 request/second and alert the key owner." ([RelayPlane][20])
  - **Retry budget with dead-letter queue:** "Maximum of 3 retries per agent
    per workflow execution, exponential backoff, dead-letter queue for tasks
    past the retry limit." ([dev.to — sapph1re][23])
  - **Budget enforcement *outside* the agent code:** "If the agent checks its
    own budget, a buggy agent can skip the check; if a gateway enforces the
    budget before forwarding the request, the agent literally cannot make an
    LLM call that violates the policy." ([SupraWall][24])

- **Cost-of-runaway numerics for cortex-x calibration:** "A single runaway
  agent loop running GPT-4o at 80K context per iteration for 100 iterations
  costs approximately $24; with Claude Opus that becomes $240+; running 50
  concurrent runaway agents can accumulate $1,200+ in a single night."
  ([RelayPlane][20]) — **Sprint 1.9.1's $25/wk + $80/mo + 50K-tokens/5min
  caps are calibrated for single-process Steward; a tree-of-agents Steward
  needs the cap *per tree* AND a global day cap, not just a daily roll-up.**

## 7. "Anthill" / swarm metaphor — academic + applied

The operator's intuition has solid academic backing in 2026.

- **Stigmergy applied to LLM agents** is now a published research direction.
  "Stigmergy is indirect coordination through environment modification…
  coordination through shared environment modification rather than explicit
  orchestration." ([Smith — Stigmergic Optimization, Medium 2026][25])

- **Pressure-Field Coordination paper (arXiv 2601.08129v3, Jan 2026):**
  "Implicit coordination through shared state outperforms explicit
  hierarchical control — without coordinators, planners, or message passing."
  Agents observe local quality signals, take locally-greedy actions, and
  coordination emerges from shared artifact state. ([arXiv 2601.08129][26])

- **Frontiers in AI 2025 — Multi-agent systems powered by LLMs (swarm
  intelligence):** demonstrates LLMs can act as decentralized behavioral
  engines for swarm-like agents in foraging and flocking simulations.
  Hybrid populations (LLM + rule-based) outperformed homogeneous groups,
  ~95 vs ~85 food units; LLM-driven agents had lower variance (σ≈7 vs
  σ≈20). ([Frontiers in AI][27])

- **Limitations the same paper flags** are directly load-bearing for
  cortex-x's home-NAS aspiration:
  - "Interaction between an agent and the remote LLM at each iteration
    requires significantly more computation time" than local rules.
  - "Token-based API expenses accumulate rapidly."
  - "Minor wording changes substantially alter emergent behavior, demanding
    meticulous tuning."
  - "LLMs interpret spatial concepts differently than formal mathematics."
    ([Frontiers in AI][27])

- **Architecture lesson from biology:** "If you have a system of fifty
  agents, the Supervisor must read the outputs of all fifty agents,
  synthesize the results, resolve merge conflicts, and issue new commands.
  This creates an impossible computational traffic jam." ([Codefinity —
  Architecture of AI Agent Swarms][28]) — pure top-down hierarchy doesn't
  scale; production answers are **hybrid: hierarchical at the team level,
  mesh/stigmergic *inside* each team.**

- **Bottom line:** the anthill metaphor is *not* hype in 2026 — it's a
  research-grade pattern with real benchmarks. But the production lesson
  is "hybrid": treat hierarchy + stigmergy as composable, don't pick one.

## 8. Self-hosted multi-agent on consumer hardware

Real and shipping in 2026, with measurable hardware envelopes.

- **Default home-AI-server hardware:** "Mac Mini M4 ($599) has become the
  default 'AI home server' hardware — with 16-24GB of unified memory, low
  power consumption, and silent operation." For GPU: "RTX 4090 (24GB VRAM)
  is recommended for local LLM work, running 32B models well as the ceiling
  for single-GPU consumer setups." ([Compute Market — Home AI Server Build
  Guide 2026][29])

- **Default local runtime:** "If local LLMs had a default choice in 2026, it
  would be Ollama. … 'Docker for LLMs', where one command pulls and runs
  models locally, bundles llama.cpp under the hood, handles quantization
  automatically, and exposes an OpenAI-compatible API without
  configuration." ([Compute Market 2026][29])

- **NAS-attached pattern:** "A Synology DS1821+ can centralize model
  storage, datasets, and backups across multiple machines, with 10GbE
  expansion capable of transferring model files at ~1GB/s — fast enough
  to load models from NAS to GPU VRAM without noticeable delay."
  ([Compute Market 2026][29], cross-confirmed by [XDA-developers — NAS +
  local LLM][30])

- **Self-hosted multi-agent runtimes that exist today:**
  - **SwarmClaw** (open-source, MIT-spirit): "self-hosted AI agent runtime
    and multi-agent framework for autonomous agent swarms… 23+ LLM
    providers (Claude, GPT, Gemini, OpenRouter, Ollama)." Persistent
    dashboard, durable memory (hybrid recall + graph traversal +
    journaling + automatic reflection), MCP integration, approval gating.
    Self-described as "used in production by teams running autonomous
    agent swarms." ([swarmclawai/swarmclaw GitHub][31])
  - **Overstory:** "multi-agent orchestration for AI coding agents —
    pluggable runtime adapters for Claude Code, Pi, and more. Each agent
    runs in an isolated git worktree." Web UI is the operator surface.
    ([jayminwest/overstory][32])
  - **Mission Control (builderz-labs):** "self-hosted AI agent
    orchestration platform: dispatch tasks, run multi-agent workflows,
    monitor spend, and govern operations from one mission control
    dashboard." Four-layer evaluation: output evals, trace evals
    (convergence/loop detection), component evals, drift detection.
    ([builderz-labs/mission-control][33])

- **Token-cost reality on a 24/7 home NAS:** if the home stack is fully
  local Ollama (e.g. Llama-3.1-8B), the only cost is electricity (~$15-30/mo
  in Czechia for an idle Mac Mini M4 + RTX 4090 box). Hybrid cloud
  (Anthropic Opus for orchestrator, local Llama for workers) is the most
  realistic shape; this is what cortex-x already does in spirit (Steward
  uses OpenRouter for the LLM, deterministic locally). ([Compute Market
  2026][29], [Onyx — best self-hosted LLMs 2026][34])

## 9. Live-swarm visualization

Mature category in 2026; multiple open-source options at every quality tier.

- **Tier-1 commercial / fully managed:** LangSmith (deepest LangChain
  integration, "node-by-node state diffs, full agent execution graphs, model
  + tool call breakdowns, replay against new model versions"), Datadog LLM
  Observability, Honeycomb LLM Observability. ([Digital Applied — agent
  observability platforms 2026][35])

- **Tier-2 open-source self-hostable:**
  - **Langfuse** — "open source leader in this space, with over 19,000
    GitHub stars and an MIT license that lets you self-host without
    restrictions." Full stack: tracing with multi-turn conversation
    support, prompt versioning, LLM-as-judge eval. ([Digital Applied 2026][35])
  - **Arize Phoenix** — "ML-grade rigor… Open-source (Elastic 2.0),
    OpenTelemetry-native via OpenInference. Best for notebook and
    eval-heavy workflows." ([Digital Applied 2026][35])
  - **Weights & Biases Weave** — "records structured execution traces for
    multi-agent systems, preserving parent-child relationships between
    agent calls. Inputs, outputs, intermediate states, latency, and token
    usage are captured per agent and per trace." ([Digital Applied 2026][35])

- **Tier-3 purpose-built swarm dashboards (closer to operator's
  vision):**
  - **agent-swarm-dashboard (Smilkoski):** Django + CrewAI + Groq, Mermaid.js
    flowchart of live agent state, SSE streaming timeline, "Live • X tokens
    • $Y cost" status bar, mission templates (research / feasibility /
    conference). 60-second pauses between agents for rate limiting.
    ([Smilkoski/agent-swarm-dashboard][36])
  - **AgentPrism (Quotient):** "open source React component library that
    cuts debugging time from hours to seconds… works with any
    OpenTelemetry-compatible data, ensuring broad compatibility without
    vendor lock-in." ([Evil Martians — AgentPrism][37])
  - **Overstory's `ov serve`:** "the primary operator surface for the
    swarm where you can watch the fleet, read the mail bus, and inspect
    per-agent timelines." ([Overstory README][32])

- **The "live anthill view" pattern:** all three tier-3 tools converge on
  the same visual language — Mermaid graph + per-agent timeline + token/cost
  ledger + mission status. Re-implementing this from scratch is a Tier-3
  Sprint 4.5 task (matches the BIOS-style dashboard idea already in MEMORY).

## 10. Recommendation for cortex-x trajectory

### Is this real?

**Yes, real.** Specifically:
- Anthropic's +90.2% number is real and quoted across the industry.
- The Claude Agent SDK already supports the orchestrator → sub-agent shape
  with hard depth-cap = 2.
- Self-hosted runtimes (SwarmClaw, Overstory, Mission Control) ship today.
- The visualization category is mature (Langfuse + Phoenix + AgentPrism
  cover open-source).

But:
- The +90.2% applies to **breadth-first research tasks**, not coding tasks.
  Most of Steward's 9-kind palette is coding-shaped (`dep_update_patch`,
  `lint_fix_shipper`, `test_coverage_gap`, `flaky_test_repair`). Anthropic
  itself says don't use multi-agent for "tasks that require all agents to
  share the same context… (e.g., most coding tasks)."
- 15× token overhead is the price floor.
- The $47K incident is a real, public failure pattern that *would have hit
  cortex-x* in Sprint 1.6.13 if not for the Sprint 1.9.1 cost-safety
  module + the $0.20 reproduction proves a single afternoon of monitoring
  bypass can cost more than the entire 1.9.x R&D run.

### Should we build it?

**Selectively, yes.** Three concrete wins for cortex-x:

1. **`recommendation_harvest`** is exactly the breadth-first shape Anthropic
   designed for — fan out a "find-stale-TODOs" Sonnet over each top-level
   directory in parallel, synthesize at the lead. Token overhead is
   defensible because tasks are independent. **Already a 1.8.2 capability
   kind, today done sequentially.**

2. **A whole-repo `security-audit` capability** (operator's stated example)
   is breadth-first by definition: spec-finder, threat-modeler,
   exploit-finder all explore disjoint surfaces. Synthesis at the lead.
   This is the textbook Anthropic pattern.

3. **PR review** is *also* breadth-first: per-file static-analysis +
   security + correctness + style sub-agents in parallel, then synthesize
   into a single PR review comment. (`pr_review_responder` is already kind
   #8.)

Where it would be *wrong* in cortex-x:

- `dep_update_patch`, `lint_fix_shipper`, `flaky_test_repair`,
  `test_coverage_gap` — all need shared context with the codebase mutation.
  Single-agent + spec-verifier (the 1.9.0 architecture) is the right shape.
  Don't multi-agent these.

### Which sprint?

Map to existing roadmap (per `docs/steward-roadmap.md` already in the repo):

- **Tier 2 Sprint 2.2 — "worktree supervisor MVP"** → ship 1 supervisor + 1
  spawned worker for **`recommendation_harvest` only**. Re-use Claude Agent
  SDK's `agents` parameter; cap depth at 1; use the 1.9.1 cost-safety
  module unchanged but add a *per-tree* token cap as a 4th window
  alongside daily/weekly/monthly. **MVP, no new capability kinds.**

- **Tier 2 Sprint 2.3 — "supervisor + N workers"** → generalize to
  `whole_repo_security_audit` as kind #10. Adds Mermaid + Langfuse-or-
  Phoenix tracing as the visualization layer. Loop detector extended to
  cover *cross-tree* patterns (the $47K pattern was a 2-agent ping-pong,
  not a single-agent loop — current detector wouldn't have caught it).

- **Tier 3 Sprint 4.5 — "BIOS-style local dashboard"** (already in
  MEMORY) → consume the Langfuse / Phoenix traces from 2.3 and expose
  them as the operator's "anthill view." Don't reinvent — wrap.

- **Tier 4 Sprint 5.2+ — "home-NAS persistent swarm"** → only after souls
  (5.1), Obsidian SSOT, and local-Ollama fallback are in place. The Mac
  Mini M4 + RTX 4090 + Synology pattern from §8 is the target hardware
  envelope. The KV-cache-slot bottleneck (8 concurrent workers but only 6
  slots = queueing) is the gating constraint.

### What blocks us today?

| Blocker | Sprint to address |
|---|---|
| Per-tree token cap (1.9.1 only has per-call/per-day/week/month) | 2.2 prework |
| Cross-tree loop detector (handshake/ping-pong pattern) | 2.2 prework |
| Verifier needs to handle parallel spec-criteria from N workers | 2.2 |
| Visualization stack (Mermaid + token ledger live UI) | 4.5 (defer; cortex-steward status --forecast covers MVP) |
| Local-Ollama fallback for cost-zero baseline runs | 5.0 (Tier 4) |
| Home-NAS OpenTelemetry collector for offline tracing | 5.2 |

### Concrete acceptance criteria for Sprint 2.2 ("supervisor + 1 spawned worker" MVP)

1. New capability kind: `recommendation_harvest_parallel` (does NOT replace
   the existing 1.8.2c kind — coexists, opt-in via env or flag).
2. Supervisor uses Claude Agent SDK's `agents` param; depth-cap = 1
   (worker cannot spawn). Confirm via `Agent` excluded from worker
   `tools`.
3. Per-tree token cap: new env `STEWARD_TREE_USD_CAP` ($1.50 default,
   roughly 2× a single-call dogfood run). Cap enforced at the supervisor
   level *before* spawning; running tally from `extractUsage` on every
   sub-agent return.
4. Cross-tree loop detector: write criterion-id × parent-tree-id
   fingerprints to journal; if same fingerprint repeats 3× in 24h, write
   `STEWARD_HALT` (mirrors 1.9.1 single-session detector).
5. Spec-verifier runs *per worker output* AND once on the synthesized
   plan. Both must pass before `applyAction`.
6. Journal records: tree-id, supervisor cost, per-worker cost, fan-out
   count, synthesis cost, total tree cost. `cortex-steward status`
   surfaces tree-level rollups.
7. Failure injection test: simulate a single worker returning garbage
   JSON → supervisor must complete with N-1 workers, not retry-storm.
8. Cost-cap test: artificially raise per-call cost so total exceeds
   `STEWARD_TREE_USD_CAP` mid-fan-out → supervisor halts cleanly,
   journals `STEWARD_TREE_CAP_EXCEEDED`, no PR opened.
9. R1 memo + 6-agent review pipeline run *before* merge (mandatory per
   roadmap §1).
10. Backward-compat: existing 9 kinds still single-process; only opt-in
    kinds use the supervisor path.

### Verifier > Spawner

The single most defensible insight from this research: **Sprint 1.9.0's
spec-verifier is the architectural moat**, not the orchestrator. Whether
cortex-x runs 1 process or 50, the verifier is what keeps mistakes out of
PRs. Multi-agent spawning *increases* the surface the verifier protects;
it doesn't replace the verifier. **Don't ship the supervisor before the
per-worker verifier path is rock solid.**

## Sources

[1]: https://www.anthropic.com/engineering/multi-agent-research-system  "How we built our multi-agent research system — Anthropic Engineering"
[2]: https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent  "How Anthropic Built a Multi-Agent Research System — ByteByteGo"
[3]: https://code.claude.com/docs/en/agent-sdk/subagents  "Subagents in the SDK — Claude Agent SDK docs"
[4]: https://aiworkflowlab.dev/article/how-to-build-production-ai-agents-claude-agent-sdk-custom-tools-hooks-subagents  "Claude Agent SDK Python Guide (2026) — AI Workflow Lab"
[5]: https://www.codewithseb.com/blog/claude-code-sub-agents-multi-agent-systems-guide  "Claude Code Sub-agents: The 90% Performance Gain — Code With Seb"
[6]: https://github.com/openai/swarm  "openai/swarm — Educational framework"
[7]: https://openai.com/index/the-next-evolution-of-the-agents-sdk/  "The next evolution of the Agents SDK — OpenAI"
[8]: https://techcrunch.com/2026/04/15/openai-updates-its-agents-sdk-to-help-enterprises-build-safer-more-capable-agents/  "OpenAI updates its Agents SDK — TechCrunch, Apr 2026"
[9]: https://openai.github.io/openai-agents-python/  "OpenAI Agents SDK docs"
[10]: https://qubittool.com/blog/ai-agent-framework-comparison-2026  "2026 AI Agent Framework Showdown — QubitTool"
[11]: https://www.microsoft.com/en-us/research/blog/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/  "AutoGen v0.4 — Microsoft Research"
[12]: https://github.com/microsoft/autogen/discussions/4208  "AutoGen v0.4 status updates discussion — microsoft/autogen"
[13]: https://docs.crewai.com/en/learn/hierarchical-process  "Hierarchical Process — CrewAI docs"
[14]: https://docs.langchain.com/oss/python/langgraph/workflows-agents  "Workflows and agents — LangChain docs"
[15]: https://dev.to/ottoaria/langgraph-in-2026-build-multi-agent-ai-systems-that-actually-work-3h5  "LangGraph in 2026 — dev.to"
[16]: https://github.com/langchain-ai/langgraph-supervisor-py  "langgraph-supervisor-py — GitHub"
[17]: https://www.spheron.network/blog/langgraph-studio-production-deployment-gpu-cloud/  "LangGraph Studio Production Deployment on GPU Cloud (2026) — Spheron"
[18]: https://medium.com/@mohamedmsatfi1/i-spent-0-20-reproducing-the-multi-agent-loop-that-cost-someone-47k-7f57c51f3c06  "I Spent $0.20 Reproducing the $47K Multi-Agent Loop — Msatfi89, Medium"
[19]: https://towardsdatascience.com/the-multi-agent-trap/  "The Multi-Agent Trap — Towards Data Science"
[20]: https://relayplane.com/blog/agent-runaway-costs-2026  "Agent Runaway Costs: How to Set LLM Budget Limits — RelayPlane"
[21]: https://aisecuritygateway.ai/blog/llm-token-budget-strategies-for-agents  "LLM Token Budget Strategies for Agents — AI Security Gateway, 2026"
[22]: https://medium.com/@Modexa/the-agent-loop-problem-when-smart-wont-stop-ccbf8489180f  "The Agent Loop Problem — Modexa, Medium"
[23]: https://dev.to/sapph1re/how-to-stop-ai-agent-cost-blowups-before-they-happen-1ehp  "How to Stop AI Agent Cost Blowups — sapph1re, dev.to"
[24]: https://www.supra-wall.com/en/learn/ai-agent-runaway-costs  "Hard Budget Caps That Work — SupraWall"
[25]: https://medium.com/@jsmith0475/collective-stigmergic-optimization-leveraging-ant-colony-emergent-properties-for-multi-agent-ai-55fa5e80456a  "Collective Stigmergic Optimization — Jerry A. Smith, Medium"
[26]: https://arxiv.org/html/2601.08129v3  "Emergent Coordination in Multi-Agent Systems via Pressure Fields and Temporal Decay — arXiv 2601.08129v3"
[27]: https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1593017/full  "Multi-agent systems powered by LLMs: applications in swarm intelligence — Frontiers in AI 2025"
[28]: https://codefinity.com/blog/The-Architecture-Of-AI-Agent-Swarms  "The Architecture Of AI Agent Swarms — Codefinity"
[29]: https://www.compute-market.com/blog/home-ai-server-build-guide-2026  "Home AI Server Build Guide 2026 — Compute Market"
[30]: https://www.xda-developers.com/i-started-using-my-local-llms-and-an-mcp-server-to-manage-my-nas/  "Local LLMs + MCP server managing NAS — XDA-developers"
[31]: https://github.com/swarmclawai/swarmclaw  "swarmclawai/swarmclaw — open-source self-hosted multi-agent runtime"
[32]: https://github.com/jayminwest/overstory  "jayminwest/overstory — multi-agent orchestration with worktrees"
[33]: https://github.com/builderz-labs/mission-control  "builderz-labs/mission-control — self-hosted agent orchestration"
[34]: https://onyx.app/insights/best-self-hosted-llms-2026  "Best Self-Hosted LLMs in 2026 — Onyx"
[35]: https://www.digitalapplied.com/blog/agent-observability-platforms-langsmith-langfuse-arize-2026  "Agent Observability Platforms 2026 — Digital Applied"
[36]: https://github.com/Smilkoski/agent-swarm-dashboard  "Smilkoski/agent-swarm-dashboard — CrewAI + Groq live mission dashboard"
[37]: https://evilmartians.com/chronicles/debug-ai-fast-agent-prism-open-source-library-visualize-agent-traces  "AgentPrism — Evil Martians"
