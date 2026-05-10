# Research: Self-invoking command patterns + research-as-default rule

**Date:** 2026-05-10
**Scope:** Cortex-x global standards proposal — systematize self-invoking `/loop` skill use + add a "research-when-uncertain" trigger rule
**Author:** Research-only pass (no code edits, WebSearch + WebFetch only)

---

## 1. Executive summary

- **Polling is the anti-pattern; event-driven and self-paced wake-up is the 2026 norm.** Industry consensus (Temporal, Fastio, MindStudio "heartbeat") is that an agent that re-enters a loop on a fixed timer wastes tokens; agents should sleep until a signal or use an LLM-paced delay (Claude Code's `ScheduleWakeup` dynamic mode is exactly this pattern).
- **Recursion safety is non-negotiable.** Codex issue #9912 and opencode #18100 both document real runaway-recursion incidents; mitigations that work in production are (a) explicit max-depth, (b) per-chain wall-clock cap, (c) deduplication on identical tool calls within a window, (d) per-session USD budget meter. Cortex-x already has the budget meter — the depth + wall-clock + dedup gates are missing.
- **"Always research" is just as bad as "never research."** Agentic-RAG papers (arXiv 2502.12145, ByteByteGo) measure 3–10x cost inflation when retrieval fires indiscriminately, with no quality gain on simple lookups. The winning pattern is **strategic retrieval**: only when the query crosses a known staleness or stakes threshold.
- **Knowledge-cutoff staleness is measurable.** arXiv 2604.09515 ("When LLMs Lag Behind") found only 42.55% of LLM-generated code examples executed against current APIs without retrieval — strong evidence that *current-API-docs* is a high-value research trigger, while *taxonomy/architecture/security-advisory* are the other three.
- **Recommendation:** ADD a conservative "research trigger" rule to cortex-x global CLAUDE.md (4 trigger conditions, daily $0.50 cap, 7-day project-scoped cache); ADD a self-invocation playbook to `docs/playbooks/` documenting that Claude Code sessions MAY use `Skill(loop)` / `ScheduleWakeup` autonomously when criteria are met.

---

## 2. Q1 findings — self-invoking + control-loop patterns

### 2.1 Mechanisms available in Claude Code today

Claude Code 2.x exposes four self-trigger primitives, each with a different cost/latency profile:

| Primitive | Trigger model | Cache impact | Best for |
|---|---|---|---|
| `Skill(loop)` (fixed interval) | Cron-style, e.g. `/loop 5m /check-deploy` | Re-enters fresh session per beat — cache cold | Polling external systems |
| `Skill(loop)` (dynamic, no interval) | LLM picks delay via `ScheduleWakeup` | Stays warm if delay <300s | Agent-paced check-ins |
| `ScheduleWakeup` (raw) | Single delayed re-entry | Warm under 5min, cold over | One-shot "come back when X done" |
| Subagent dispatch | Synchronous fan-out | Parallel context windows | Independent research/review tasks |

Sources confirm Claude Code subagents **cannot recurse by default** ([VS Code subagents docs](https://code.visualstudio.com/docs/copilot/agents/subagents)) — `chat.subagents.allowInvocationsFromSubagents` is opt-in precisely because of runaway risk. Hub-and-spoke is the recommended topology ([Hightower 2026](https://medium.com/@richardhightower/claude-code-subagents-and-main-agent-coordination-a-complete-guide-to-ai-agent-delegation-patterns-a4f88ae8f46c)).

### 2.2 When to schedule vs proceed inline

OpenAI Agents SDK ([Self-Evolving Agents cookbook](https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining)) and Temporal's "ambient agents" ([Temporal blog](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)) converge on one rule: **schedule only when the wait is dominated by external state changes**, never when the agent could compute the answer locally. Polling-as-wakeup is explicitly named an anti-pattern by Fastio's [Event-Driven AI Agent Architecture Guide 2026](https://fast.io/resources/ai-agent-event-driven-architecture/) and [MindStudio's heartbeat critique](https://www.mindstudio.ai/blog/heartbeat-pattern-paperclip-ai-agents-24-7).

### 2.3 Runaway prevention — the four real-world defenses

Synthesized from [Codex #9912](https://github.com/openai/codex/issues/9912), [opencode #18100](https://github.com/anomalyco/opencode/issues/18100), [Rack2Cloud execution budgets](https://www.rack2cloud.com/ai-inference-execution-budgets/), and [Towards Data Science's "17x error trap"](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/):

1. **Max iterations** — hard cap (15 steps typical, Codex defaults to 1 for sub-agent recursion).
2. **Wall-clock timeout** — global timer per chain (60s common; for cortex-x's nightly scope, 30min is appropriate).
3. **Dedup window** — block calls with identical (tool, args) signature in last N steps.
4. **Cost meter** — per-session USD ceiling that hard-stops the loop. Cortex-x already has this via `STEWARD_DAILY_USD_CAP` / `STEWARD_WEEKLY_USD_CAP`.

### 2.4 "Tool use of tool use" depth limit

Empirically, [Sitepoint's recursive-debugging study](https://www.sitepoint.com/recursive-debugging-agent-patterns/) and [Agentic Design Patterns 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/) report **diminishing returns past depth 3** for recursive self-invocation. Beyond depth 3, error compounding (~17x per "bag of agents" study) dominates any reasoning gain.

---

## 3. Q2 findings — research-as-default heuristics

### 3.1 Cost reality

[ByteByteGo's Agentic RAG breakdown](https://blog.bytebytego.com/p/how-agentic-rag-works) and [arXiv 2502.12145 (Fast or Better)](https://arxiv.org/abs/2502.12145) both report **3–10x token inflation** when retrieval is fired indiscriminately vs. selectively. The dominant finding: 80% of queries don't need it; the remaining 20% absolutely do.

### 3.2 The four research-worthy categories

Cross-referencing [arXiv 2604.09515](https://arxiv.org/html/2604.09515) (API knowledge cutoff), [Verdent's coding-agent KB guide](https://www.verdent.ai/guides/llm-knowledge-base-coding-agents), and [Anthropic's Building Effective Agents](https://www.anthropic.com/research/building-effective-agents), only four categories reliably pay for their tokens:

1. **Current-API-docs** (framework versions, SDK signatures) — staleness empirically high.
2. **Architectural / taxonomy decisions** (naming, folder structure, framework choice) — load-bearing for years.
3. **Security advisories** (CVEs, supply-chain) — small probability, catastrophic miss.
4. **Cross-project patterns** (does another cortex-x project already solve this?) — local knowledge first, then web.

### 3.3 Caching patterns that work

[PyImageSearch on semantic caching for LLMs](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/) and [Maxim AI on top semantic caching solutions 2026](https://www.getmaxim.ai/articles/top-semantic-caching-solutions-for-ai-applications-in-2026/) converge: **time-decay TTL + confidence score gate**. Asteria ([arXiv 2509.17360](https://arxiv.org/html/2509.17360v1)) adds *staticity* metadata — facts that change slowly get longer TTL. ~31% deduplication hit-rate on typical workloads.

### 3.4 Anti-patterns to avoid

- **Research-everything** — burns 3–10x tokens for marginal gain.
- **Stale-cache-trust** — no TTL, no confidence gate. Adversarial-resilience paper ([Nature s41598-026-36721-w](https://www.nature.com/articles/s41598-026-36721-w)) flags this as a real attack surface.
- **Over-confident-no-research** — the failure mode `arXiv 2604.09515` measured (57% of generated code wrong against current APIs).

---

## 4. Cortex-x proposal — research-trigger rule (drop-in YAML)

Conservative. Designed to fire on roughly 1 in 5 turns, never on trivia.

```yaml
# Append to ~/.claude/CLAUDE.md under a new "Research triggers" section
# OR to project CLAUDE.md if behavior should be project-scoped

research_triggers:
  policy: "research-when-uncertain"  # not "always" and not "never"
  daily_usd_cap: 0.50                # hard ceiling per session-day
  cache:
    location: "~/.claude/cache/research/"
    ttl_days: 7                      # default time-decay
    ttl_overrides:
      security_advisory: 1           # CVE feed staleness fast
      api_docs: 14                   # SDK versions slower
      taxonomy: 90                   # naming conventions slow

  fire_on:
    - kind: "current_api_docs"
      condition: "user mentions framework + version OR SDK signature uncertain"
      example: "Next.js 16 router behavior, Vercel AI SDK v6 streaming API"
    - kind: "architectural_decision"
      condition: "load-bearing choice (folder structure, naming, framework)"
      example: "Should this be a server action or API route?"
    - kind: "security_advisory"
      condition: "dependency add/upgrade OR auth/crypto code change"
      example: "Adding new npm package, touching JWT/cookie/CORS"
    - kind: "taxonomy_naming"
      condition: "public-facing identifier (CLI flag, config key, API path)"
      example: "Renaming a flag operators will type for years"

  do_not_fire_on:
    - "trivia (syntax, language built-ins, well-known patterns)"
    - "questions answerable from current repo files"
    - "anything covered by an existing R1 memo in docs/research/"

  precedence:
    1: "Check docs/research/ for existing R1 memo (free, instant)"
    2: "Check ~/.claude/cache/research/ for fresh hit (free, instant)"
    3: "Check sibling cortex-x project memories for prior solution"
    4: "WebSearch/WebFetch only after 1-3 miss"
```

**Why conservative:** R1 ("research-before-implement") in cortex-x is already heavy at sprint-kickoff scale. This rule catches the *mid-session* uncertainty that R1 doesn't cover — without inflating every turn into a research turn.

---

## 5. Cortex-x proposal — self-invocation playbook outline

Proposed file: `docs/playbooks/self-invocation.md` (TOC only — operator approval gate before write):

```
# Self-invocation playbook

1. When to self-invoke (decision tree)
   1.1 External state changes you cannot observe inline → ScheduleWakeup
   1.2 Recurring check on bounded interval → Skill(loop) fixed mode
   1.3 Indeterminate "come back when ready" → Skill(loop) dynamic mode
   1.4 Inline-answerable → DO NOT self-invoke

2. Hard guardrails (mirrors Steward policy)
   2.1 Max recursion depth: 3
   2.2 Wall-clock cap per chain: 30 minutes
   2.3 Cost gate: STEWARD_DAILY_USD_CAP applies
   2.4 Dedup: identical (skill, args) blocked within 3 turns
   2.5 No self-invocation inside a sub-agent (hub-and-spoke only)

3. Cache-warm vs cache-cold delay choices
   3.1 Under 270s — cache stays warm, cheap
   3.2 300–1200s — pay miss; only worth it if real wait
   3.3 1200s+ — true idle, default for "check back later"
   3.4 NEVER pick exactly 300s

4. Telemetry contract
   4.1 Each self-invocation writes a journal entry
   4.2 `cortex-steward status --self-invocations` renders the chain
   4.3 Halt-file killswitch honored at every wake-up

5. Examples (all from real cortex-x sessions)
   5.1 CI-check polling — fixed 5min loop, max 6 beats
   5.2 Long npm test wait — single ScheduleWakeup at 270s
   5.3 Autoresearch overnight burst — Skill(loop) dynamic, 30min budget
   5.4 ANTI-EXAMPLE: re-running detectors that finished
```

---

## 6. Sources

- [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
- [VS Code subagents (recursion opt-in)](https://code.visualstudio.com/docs/copilot/agents/subagents)
- [Hightower — Claude Code Subagents and Main-Agent Coordination](https://medium.com/@richardhightower/claude-code-subagents-and-main-agent-coordination-a-complete-guide-to-ai-agent-delegation-patterns-a4f88ae8f46c)
- [OpenAI Agents SDK — Self-Evolving Agents cookbook](https://developers.openai.com/cookbook/examples/partners/self_evolving_agents/autonomous_agent_retraining)
- [Codex #9912 — Configurable Maximum Agent Recursion Depth](https://github.com/openai/codex/issues/9912)
- [opencode #18100 — Subagents can infinitely recurse](https://github.com/anomalyco/opencode/issues/18100)
- [Rack2Cloud — Execution Budgets for Autonomous Systems](https://www.rack2cloud.com/ai-inference-execution-budgets/)
- [Towards Data Science — 17x error trap of "bag of agents"](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/)
- [Sitepoint — Agentic Design Patterns 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/)
- [Sitepoint — Recursive Debugging Agent Patterns](https://www.sitepoint.com/recursive-debugging-agent-patterns/)
- [Temporal — Orchestrating ambient agents](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)
- [Fastio — Event-Driven AI Agent Architecture Guide 2026](https://fast.io/resources/ai-agent-event-driven-architecture/)
- [MindStudio — Why the Heartbeat Pattern Beats Persistent Sessions](https://www.mindstudio.ai/blog/heartbeat-pattern-paperclip-ai-agents-24-7)
- [arXiv 2502.12145 — Fast or Better? Balancing Accuracy and Cost in RAG](https://arxiv.org/abs/2502.12145)
- [arXiv 2604.09515 — When LLMs Lag Behind: Knowledge Conflicts from Evolving APIs](https://arxiv.org/html/2604.09515)
- [ByteByteGo — How Agentic RAG Works](https://blog.bytebytego.com/p/how-agentic-rag-works)
- [PyImageSearch — Semantic Caching for LLMs: TTLs, Confidence, Cache Safety](https://pyimagesearch.com/2026/05/04/semantic-caching-for-llms-ttls-confidence-and-cache-safety/)
- [Maxim AI — Top Semantic Caching Solutions 2026](https://www.getmaxim.ai/articles/top-semantic-caching-solutions-for-ai-applications-in-2026/)
- [arXiv 2509.17360 — Asteria: Semantic-Aware Cross-Region Caching](https://arxiv.org/html/2509.17360v1)
- [Nature s41598-026-36721-w — Adversarial resilience in semantic caching](https://www.nature.com/articles/s41598-026-36721-w)
- [Anthropic — Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents)
- [Verdent — LLM Knowledge Base for Coding Agents: Beyond RAG](https://www.verdent.ai/guides/llm-knowledge-base-coding-agents)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
