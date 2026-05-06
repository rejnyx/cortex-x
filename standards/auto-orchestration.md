# Standard — Auto-Orchestration (3-fronta rule)

> **Contract.** cortex-x scaffolded projects and cortex-x sessions follow these rules for when to parallelize vs serialize AI work. Grounded in Anthropic's multi-agent research paper, Cognition's counter-position, and 2025–2026 benchmarks.

## The 3-fronta rule

| Front | Parallelize? | Default count | Evidence |
|---|---|---|---|
| **Research** (before code) | **YES** | 3–4 agents | Anthropic: +90.2% on internal research evals; breadth-first, read-heavy, low interdependency |
| **Implementation** (writing code) | **NO** | single-thread | Cognition "Flappy Bird" failure; PlanCraft −70% on sequential tasks; coding explicitly "less parallelizable" per Anthropic |
| **Review** (after code) | **YES** | 3–5 agents | Independent audits, no shared write state — SWE-bench multi-agent +7pp via specialization + cross-validation |

**Rule:** parallelize reads and audits; serialize writes. Never fan out `Edit`/`Write` across subagents sharing a file set.

## The 2-minute rule

A subagent task is worth spawning in parallel only if **both**:
1. Estimated task duration ≥ 2 minutes (orchestration overhead dominates below that), AND
2. Operates on a clearly **separable file-set** from sibling subagents.

If either fails, single-thread.

## Task-type taxonomy

| Task | Treat as |
|---|---|
| New feature scaffolding / unfamiliar API integration | **Research parallel → Implementation serial → Review parallel** |
| Large cross-codebase refactor | Research serial (usually cached) → **Implementation: 2–5 parallel subagents on independent file sets** → Review parallel |
| Bulk test generation | Research serial → **Implementation parallel (one agent per module)** → Review serial |
| Bug fix / tightly coupled edit | **Serial everywhere.** Do not spawn subagents. |
| Greenfield UI / shared design context | Serial (shared mental model). |
| Cross-project pattern mining | Research parallel (read-heavy). Single-thread synthesis. |

## Trigger policy (auto-orchestrate hook)

The `UserPromptSubmit` hook (`~/.claude/shared/hooks/auto-orchestrate.cjs`) detects new-implementation prompts and **injects guidance as context** — it NEVER spawns agents silently. Claude receives the hint and decides based on scope.

**Detection signals (trigger if any match):**
- Czech/English keywords: `implementuj`, `přidej feature`, `integruj`, `implement`, `add feature`, `integrate X`, `wire up`
- Long prompt (≥80 words) describing architecture intent
- Reference to lib/tech not present in `package.json` or `module.yaml`

**Skip signals (never trigger):**
- `quick`, `rychle`, `skip research`, `fix typo`, `rename`, `format`, `prettier`, `lint`
- Explicit `quick` prefix on the prompt

## Budget policy

Every Agent/Task subagent invocation must respect the session cap set by `$CORTEX_SESSION_BUDGET_USD` (default `$5.00`).

- Usage recorded by `post-tool-use.cjs` into `$CORTEX_DATA_HOME/journal/.budget.jsonl`
- Session total surfaced back to Claude via `auto-orchestrate.cjs` context injection
- States: `ok` (<80%), `warning` (80–100% → reuse cache, skip redundant subagents), `over` (≥100% → ask user before spawning more)

Hard enforcement is not possible from hooks (they can't cancel Agent dispatch pre-flight with cost reasoning). Enforcement is soft: Claude sees the number and is trusted to stop. Exceeding the cap triggers a visible warning on the next turn, not silent failure.

## Research cache TTL per topic

Freshness rots at different rates. Research frontmatter may declare `ttl_days: N`; default inferred from slug:

| Topic family | Default TTL |
|---|---|
| Hot frameworks (Next, React, Vercel, AI SDKs, Supabase, shadcn, Tailwind, Astro) | **30 days** |
| Specific APIs that deprecate often | 60 days |
| Regulations (tax, GDPR, HIPAA, legal, compliance) | 180 days |
| Architecture patterns / design principles | 365 days |
| Everything else | 180 days |

Override per-file in frontmatter. `cortex-doctor` archives (not deletes) files over TTL to `research/archive/<year>/`.

## Anti-patterns

- ❌ **10× parallel code-writing agents** — benchmarks show multi-agent writes degrade on sequential tasks. If the task is write-heavy, single-thread.
- ❌ **Silent auto-spawn of expensive subagents** — every user-revolt horror story from Cursor/Cline/Aider forums (2025–2026) traces back to silent escalation without consent. Keep expensive paths opt-in per turn.
- ❌ **Research agents in a loop without cache writeback** — always write to `$CORTEX_DATA_HOME/research/<slug>-<date>.md` with frontmatter so next session reuses, not re-fetches.
- ❌ **Parallel subagents on interdependent reasoning** — "Flappy Bird" failure mode: each subagent makes conflicting assumptions, final output is incoherent.
- ❌ **Unlimited recursion depth** — subagents must not spawn subagents beyond 1 level without orchestrator approval (cost + observability collapse).

## Enforcement gates

- `blind-hunter` — flag PRs that parallelize `Edit`/`Write` across subagents (anti-pattern #1)
- `ssot-enforcer` — flag research agents that bypass the cache-write step (anti-pattern #3)
- `acceptance-auditor` — verify scope-matching: if user said `quick`, no auto-orchestrate should fire

## Evidence trail

- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — orchestrator-worker, ~15× token cost, coding "less parallelizable"
- [Anthropic — Building effective agents](https://www.anthropic.com/research/building-effective-agents) — patterns + when not to use
- [Cognition — Don't Build Multi-Agents (HN discussion)](https://news.ycombinator.com/item?id=45096962) — Flappy Bird failure mode, interdependent-reasoning degradation
- [PlanCraft benchmark](https://arxiv.org/abs/2406.09834) — sequential task multi-agent −70%
- [ICSE 2025 Deprecated API study](https://arxiv.org/abs/2406.09834) — 25–38% Deprecated API Usage Rate drives TTL choice
- [Cursor Pro plan burned in 10 min — forum](https://forum.cursor.com/t/pro-plan-burned-in-10-minutes-by-background-agent-calls-completely-unacceptable/118368) — why silent auto-run is not shipped
- [Claude Code 887k tokens/min incident](https://www.aicosts.ai/blog/claude-code-subagent-cost-explosion-887k-tokens-minute-crisis) — why budget caps are non-negotiable
- [Subagent orchestration (alexop.dev)](https://alexop.dev/posts/understanding-claude-code-full-stack/) — native Claude Code primitives

## Related standards

- `standards/coding-behavior.md` — Rule 1.5 (Karpathy): Think Before Coding principle mandates the research step
- `standards/ssot.md` — research cache is the single source of truth for decisions; don't re-derive in CLAUDE.md
- `standards/ship-ready.md` — Rule 0 distribution hygiene
