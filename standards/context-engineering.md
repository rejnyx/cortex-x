---
title: Context-budget discipline (smart zone / dumb zone)
status: standard
last_review: 2026-05-28
applies_to: every cortex-x project, every Claude Code session, every Steward run
rule_tier: Rule 2 (Critical — context budget = correctness gate)
---

# Context engineering

The working context is a budget, not a backpack. Past a point, every token you add makes the model reason *worse* — not because the window is full, but because attention dilutes. Manage the budget deliberately.

## The smart zone / dumb zone model

Popularized by Dex Horthy (HumanLayer) and an increasingly common framing for coding agents: an LLM has a **smart zone** (early, clean context where it does its best work) and a **dumb zone** (degraded reasoning as context grows). Two facts that matter for how you size work:

1. **Degradation is continuous and starts well below the advertised window.** It is *not* a clean cliff at 100K. Benchmarks show models reliably use only ~50–65% of their stated window (RULER), and "effective length" on associative tasks collapses to single-digit-thousands of tokens (NoLiMa). A 1M-token window does not buy you 1M tokens of *reasoning* — it ships you more dumb zone for retrieval-shaped work.
2. **Reasoning degrades far faster than retrieval.** NoLiMa at 32K: literal retrieval 98.5%, one-hop reasoning 56%, two-hop reasoning 26%. Multi-step coding is reasoning-shaped, so the usable budget for *coding* is much smaller than for *finding a fact*.

**Operational target: keep working-context utilization at ~40–60%** (HumanLayer). Size each task to fit. When a task won't fit, decompose it — don't grow-then-compact.

## Clear vs. compact — the decision that actually matters

The naive advice "always clear, never compact" is an oversimplification (no primary source supports the "compaction leaves sediment" claim). The real practice is **three different moves for three different kinds of context**:

| Context kind | Move | Why |
|---|---|---|
| **Tool-result noise** (file dumps, large command output, exploration scrap) | **Clear aggressively** | Pure bloat once consumed; biggest, cheapest win |
| **Decisions + design concept** (what we agreed, why, the acceptance frontier) | **Compact into a structured artifact** | Losing these costs a re-alignment round; preserve them as a written record, not raw history |
| **A genuinely new task** | **Clear to a clean slate** | Start in the smart zone; CLAUDE.md + artifacts carry the durable state |

"Intentional compaction into artifacts" beats both blind clearing (loses decisions) and blind compaction (keeps noise). cortex-x's `pre-compact.cjs` hook **is** this practice — it writes recovery state to `.claude/compact-state.md` so the next window starts clean but informed. That is the recommended pattern, not an anti-pattern.

## The system prompt / CLAUDE.md budget

Everything in CLAUDE.md loads into **every** turn — it is the most expensive real estate you own. But **minimal does not mean short** (Anthropic): aim for the "right altitude" — durable principles that generalize, not exhaustive procedures. Instruction adherence measurably degrades past ~80K tokens of context, so a bloated CLAUDE.md hurts twice (it costs budget *and* it gets ignored).

- Keep CLAUDE.md to current-state + pointers (see [`ssot.md`](./ssot.md) — institutional wisdom lives in cortex, not CLAUDE.md).
- Route detail to files the agent can pull on demand rather than pushing it into every turn.
- Cap at ~200 lines; route out style guides, business context, reference docs.

## Practice

- **Decompose to fit the smart zone.** Keep steady-state utilization in the ~40–60% band; a task that would push past ~60% is too big — split it (see [`modular.md`](./modular.md) on vertical slices for *how* to split so each piece is independently testable).
- **Clear between unrelated tasks.** Don't carry one feature's exploration into the next.
- **Compact before a long horizon, not after it.** Summarize decisions into an artifact while they're still fresh, not when the window is already degraded.
- **Watch the budget.** Claude Code's `/context` shows what's eating tokens; treat >60% as a signal to clear or compact.

## Cross-references

- [`verification-loop.md`](./verification-loop.md) — fresh-context review (a reviewer in a polluted window is dumber than the implementer was)
- [`correctness.md`](./correctness.md) — eval-driven dev; small focused context improves eval reliability
- [`modular.md`](./modular.md) — vertical slices as the *how* of fitting work into the smart zone
- [`ssot.md`](./ssot.md) — what belongs in CLAUDE.md vs. cortex (the budget rule for the system prompt)

## Sources

- [Chroma — Context Rot](https://www.trychroma.com/research/context-rot) — continuous, non-uniform degradation across 18 frontier models
- [NoLiMa (ICML 2025)](https://arxiv.org/html/2502.05167v1) — effective length collapse; reasoning ≫ retrieval degradation
- [HumanLayer — Advanced context engineering for coding agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) — 40–60% utilization target
- [HumanLayer — 12-factor agents](https://github.com/humanlayer/12-factor-agents) — provenance of "context engineering"
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — "minimal ≠ short", right altitude, tool-result clearing vs. compaction
