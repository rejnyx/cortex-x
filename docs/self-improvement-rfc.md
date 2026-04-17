# Self-Improvement Loop — RFC

> Status: **Draft v1** · Date: 2026-04-17 · Author: cortex-x + the user
>
> Architecture decision record for cortex-x's self-improvement system. Read this once to understand WHY each piece exists; the implementation details live in [`prompts/cortex-evolve.md`](../prompts/cortex-evolve.md).

---

## Goal

cortex-x should **compound across projects**. Every session the maintainer runs across their portfolio of projects produces traces. Those traces should make the next project better — without manual curation.

**Non-goal:** agents that rewrite their own prompts autonomously. Research (DGM, Reflexion, self-refine) shows this works in narrow domains with verifiable outcomes. cortex-x outputs are soft (documentation, scaffolds) — auto-modification drifts.

**Therefore:** cortex-x proposes, the user disposes. Every change lands through a reviewable diff.

---

## Three-cadence architecture

Research finding (Anthropic constitutional AI, 2212.08073): reflection loops need ≥50 samples to stabilize. At the user's scale (~200 events/day × 6 projects), that means **weekly is the right insight cadence — daily is noise**.

```
  DAILY (cron 3:00 UTC)        WEEKLY (cron Sun 4:00 UTC)       MONTHLY (manual)
  ─────────────────────        ────────────────────────────     ───────────────────
  journal/ ingestion           insight mining + consolidation   prompt / standard
  embedding backfill           stale-entry detection            refinement (DSPy-lite)
  (no judgments)               PR to insights/proposals/        eval suite re-run
                                                                 3-month audit cadence
```

**Why split:** daily keeps memory fresh (retrieval works), weekly does the expensive LLM work (insight generation), monthly needs human attention anyway (prompt PRs).

---

## Hard rules against hallucination

The killer anti-pattern from research: LLMs invent patterns from 2 occurrences. Deep Research post-mortem (OpenAI 2025) showed self-review converges to generic advice ("add more tests") within 3 iterations.

**Mitigations baked into [`config/evolve.yaml`](../config/evolve.yaml):**

1. **Min support = 3 events across ≥2 projects, observed >7 days apart** — kills single-project flukes.
2. **Evidence citations required** — every insight must link to ≥3 journal entries or it's discarded by the scorer. No citations = no insight.
3. **Bonferroni correction** — when testing N patterns, require `p < 0.05/N`. For 50 candidate patterns, p<0.001.
4. **Insight budget** — max 3 insights per week across ALL projects. Spam kills trust.
5. **No auto-merge** — every proposed change is a PR the user reviews. Framework never modifies its own standards.
6. **Stale-entry detection uses `mtime + access_count`, NOT LLM** — deterministic rules for deterministic problems.

---

## Memory architecture (Letta sleep-time compute)

Mirrors the autoDream pattern (three-layer memory with nightly consolidation) proven in prior agent projects, extended cross-project:

| Layer | What | When written | Size budget |
|---|---|---|---|
| **L1 — Core index** | Compact cheat sheet per project | Nightly rebuild | ≤500 tokens/project |
| **L2 — Semantic memory** | Embedded journal + insights | Daily ingestion | Unbounded (pgvector) |
| **L3 — Activity log** | Append-only event stream | Real-time (PostToolUse hook) | 30d active, archive older |

L1 is always-in-context for cortex-thinker. L2 is retrieval-only. L3 is pattern-mining source.

---

## Eval suite (Aider pattern)

Paul Gauthier's Aider benchmark is the **only legitimate solo-dev self-improvement pattern** in 2026: small deterministic task set, scored per framework version, reproducible via `{model, prompt_hash, commit_sha}`.

**cortex-x eval suite** ([`evals/`](../evals/)):

- 10 canonical tasks (scaffold new project, scan existing, sync after sprint, review diff, etc.)
- Each task has expected properties (not exact outputs) — e.g. "scaffolded PROGRESS.md has ≥3 stories", "scan produces exactly 5 sections"
- Run before merging any prompt/standard change
- Track deltas in `evals/results/<date>-<commit>.json`

Without evals, prompt changes are vibes. With evals, they're data.

---

## What auto-improves vs what doesn't

| Auto-improves (cron writes PR) | Human-only (the user edits directly) |
|---|---|
| Insights in `insights/` | Standards in `standards/` |
| Stale-entry removal proposals | Prompts in `prompts/` |
| Skill candidates in `insights/proposals/skills/` | Profiles in `profiles/` |
| `MEMORY.md` index rebuilds per project | Agents in `agents/` |
| Lessons-learned appends (cited only) | `module.yaml` config |
| `journal/**` append-only via hooks | `CLAUDE.md`, `README.md` |
| `projects/*.md` via `propose_diff` PR | |

**Authoritative list:** [`config/evolve.yaml`](../config/evolve.yaml) `auto_improves` / `human_only` keys. This table is illustrative; the YAML is SSOT.

**Rule:** the framework's *generated artifacts* self-improve. The framework's *source of truth* (standards, prompts, profiles, agents, `module.yaml`, `CLAUDE.md`, `README.md`) only changes through human-approved PRs.

---

## Anti-patterns rejected

From research synthesis — explicitly NOT doing these:

- ❌ **Cursor-style real-time RL** — requires fine-tuning pipeline + billions of tokens. Not solo-dev viable.
- ❌ **Self-modifying prompts** — Anthropic explicitly does not endorse this for subagents. Drifts badly.
- ❌ **Daily insight generation** — <50 samples/day = noise. Weekly is the floor.
- ❌ **BERTopic on <200 documents** — density-based clustering needs scale the user doesn't have.
- ❌ **LLM-driven stale detection** — hallucinates "this is outdated" from fresh files. Use mtime.
- ❌ **Voyager-style tool autogeneration** — tools need testing. Auto-generated tools break silently.
- ❌ **Reward hacking via vague metrics** — "quality improved" ≠ measurable. Use eval suite.

---

## Success criteria (measured by eval suite)

At 3-month audit (2026-07-17):

1. **Eval score trending up** — monthly re-run of eval suite shows positive delta from baseline
2. **Insight actionability ≥60%** — of insights surfaced, ≥60% marked "acted on" (not dismissed)
3. **Zero hallucinated insights** — no insight surfaced without 3+ journal citations
4. **Cross-project transfer ≥3 times** — a pattern from project A applied to project B, measurably

If any fail: prune that sub-system. Don't keep broken self-improvement.

---

## Sources

- Letta sleep-time compute: https://www.letta.com/blog/sleep-time-compute (arXiv 2504.13171)
- Aider benchmark: https://aider.chat/docs/leaderboards/
- Reflexion pattern: https://agent-patterns.readthedocs.io/en/stable/patterns/reflexion.html
- DGM (archive-based): https://arxiv.org/abs/2505.22954
- Constitutional AI (reflection N≥50): https://arxiv.org/abs/2212.08073
- Claude Skills 2.0 (triggered, not always-on): https://github.com/alirezarezvani/claude-skills
- DSPy MIPROv2: https://github.com/stanfordnlp/dspy
- Anti-patterns overview: https://o-mega.ai/articles/self-improving-ai-agents-the-2026-guide
