# Self-Correction — What Actually Works in 2026

> **Premise:** "self-healing agent" is a marketing term covering four distinct patterns. Three have strong positive research. **One is largely demo-theater with negative research evidence.** This standard codifies which patterns cortex-x endorses and which it explicitly rejects — so every scaffolded project resists cargo-culting the hype.

## Tier

**Rule 2 (Critical).** Alongside Correctness — this standard prevents adopting patterns that measurably degrade agent quality.

## The four patterns — taxonomy

| # | Pattern | Status | Evidence |
|---|---------|--------|----------|
| **1** | **Tool-call retry + semantic error classification** | ✅ **Endorse** | Universal, used by Claude Code, Aider, LangGraph; no negative research |
| **2** | **Reflection + self-correction** | 🟡 **Conditional** | Works ONLY with external verifier (tests, schema, compiler, user); **degrades without** |
| **3** | **Autonomous skill auto-creation** | ❌ **Reject as default** | SkillsBench: LLM-auto-skills **−1.3pp vs baseline**; HITL variant only |
| **4** | **Episodic → semantic memory consolidation** | 🟡 **HITL required** | Planned cortex-x Phase 6 autoDream; layer-1 promotions gated on approval |

## Pattern #1 — Tool-call retry + error classification (ENDORSED)

**What it is:** wrapper catches tool error, classifies (timeout / auth / not_found / validation / rate_limit / unknown), returns structured `{success, data|error}` to agent loop. Agent continues with alternative arg or fallback tool.

**Evidence:** universal pattern. Claude Code feeds stderr back to model with circuit breaker after 3 failures. Aider has exponential backoff on file-lock retries. LangGraph uses conditional edges for retry. No negative research.

**cortex-x baseline:** `safe-tool` wrapper in `ai-patterns.md` Pattern #1 implements this. See `safe-tool v2` section below for 2026 upgrades.

**When to use:** every agent project. Zero cost, pure upside.

**When NOT to use:** nowhere. This is a hard baseline.

## Pattern #2 — Reflection / self-correction (CONDITIONAL)

**What it is:** agent critiques its own trajectory, generates verbal "lesson," retries with updated plan. Examples: Reflexion (2023), Self-Refine, Tree of Thoughts, MAR (2025).

**Positive evidence:**
- Reflexion: +18pp on ALFWorld / ScienceWorld multi-choice
- GEPA (ICLR 2026 Oral): reflective prompt evolution outperforms RL by 6-20% with 35× fewer rollouts

**Negative evidence (critical):**
- **"Can LLMs Correct Themselves?"** (arXiv 2510.16062, NeurIPS 2025) — intrinsic self-correction **does not improve or degrades** on arithmetic, closed-book QA, code-gen, plan-gen, graph coloring
- **Self-Correction Bench (2025)** — models have ~64.5% "blind spot": fail to fix errors in own output but fix the same error from user input
- **ReliabilityBench (2026)** — Reflexion showed **10% degradation under fault injection** vs ReAct's 7.5%; reflection **amplified** faults
- **LLM-as-judge overconfidence** (arXiv 2508.06225) — same-family self-verification has high false-positive rate vs cross-family

**Rule — when reflection is safe:**

| Verifier present? | Use reflection? |
|---|---|
| ✅ Tests pass/fail (Aider's test-driven loop) | YES |
| ✅ Zod/schema validation succeeds/fails | YES |
| ✅ Compiler accepts/rejects | YES |
| ✅ User confirmation in loop | YES |
| ✅ Cross-model judge (different provider than worker) | YES |
| ❌ Same-model self-judge on open-ended output | **NO — negative research** |
| ❌ Intrinsic "let me think about whether that was right" | **NO — blind spot 64.5%** |

**cortex-x rule:** scaffolded code MUST NOT include intrinsic self-critique without an external verifier. Agent loops always terminate on `stopWhen`, never on "model thinks it's done."

**Offline exception:** **GEPA-style eval-driven prompt evolution** is endorsed for Phase 5 `evals/` — run quarterly against golden set, propose prompt changes, the operator reviews, merges. Offline + eval-gated + HITL = safe. Not the same as runtime reflection.

## Pattern #3 — Autonomous skill auto-creation (REJECTED as default)

**What it is:** after successful N-step task, agent writes reusable SKILL.md / code function, caches for reuse. Hermes Agent's `skill_manage` tool; Voyager's skill library (Minecraft).

**Evidence (cautionary):**
- **SkillsBench** (arXiv 2602.12670): LLM auto-generated skills **−1.3pp vs baseline**; curated +16.2pp
- **EvoSkill** (arXiv 2603.02766): only ensemble/multi-run merging gets auto-skills to +7.3%; single-run auto = noise
- **Hermes Agent production reality check:** 95K GitHub stars, v0.10 (Apr 2026), **zero published retention/quality metrics**. Documentation describes capability; no field data on whether user skill libraries actually grow net-positive.

**cortex-x rule:**
- Autonomous skill creation is **off by default** (profile flag `autoSkills: false`)
- **HITL skill-proposer pattern permitted:** agent drafts SKILL.md into `.claude/skills/_proposed/` queue; user reviews and moves to active `.claude/skills/` when approved
- Mirrors Anthropic's `skill-creator` meta-skill model (HITL by default)
- Re-evaluate after 6+ months of manual skill-proposer telemetry. If data shows net-positive, consider lowering the gate.

**Why rejected as default:** institutional wisdom SSOT (Rule 1) — cortex-x's `standards/`, `agents/`, `skills/` are curated. Autonomous mutation of institutional wisdom is blocker-level violation.

## Pattern #4 — Episodic → semantic memory consolidation (HITL)

**What it is:** vector DB of past agent trajectories; periodic compression into long-term rules / preferences. Examples: MemGPT / Letta, Hermes three-layer memory, cortex-x planned `autoDream` (Phase 6).

**cortex-x plan (Phase 6):**
- Nightly cron (3:00 UTC) runs 6-signal scoring (relevance 30% + frequency 24% + diversity 15% + recency 15% + consolidation 10% + richness 6%)
- Promotes high-score memories from Layer 3 (activity log) → Layer 2 (pgvector semantic) → Layer 1 (core index, always-in-context)
- **Layer 1 promotions require HITL approval.** Surfaced in `DREAMS.md` as human-readable diff. the operator signs off before promotion.
- Layer 2 dedup + Layer 3 pruning can proceed autonomously (low blast radius, reversible).

**Why HITL on Layer 1:** Layer 1 is "always-in-context" — corrupting it = corrupting every future agent decision. Blast radius too large for silent mutation.

## Anti-patterns (explicit rejections for cortex-x)

- ❌ **Default intrinsic self-critique** in agent loops without external verifier
- ❌ **Autonomous skill creation** writing to `.claude/skills/` without user review
- ❌ **Auto-promotion to Layer 1 memory** without diff review
- ❌ **Multi-agent reflection loops (MAR-style)** as default — 3× API cost for +3pp EM on some benchmarks, but negative on others; not worth orchestration complexity for solo ship
- ❌ **Conflating offline prompt optimization with runtime self-healing** — GEPA (offline) is safe; runtime reflection without verifier is not
- ❌ **Self-verifying review agents** on their own output. Route auditor agents to cross-model or cross-family verifier (e.g., Sonnet worker + Opus auditor, or Claude worker + GPT auditor)

## Safe-tool v2 — 2026 upgrades to Pattern #1

Inherits from `ai-patterns.md` Pattern #1. Adds:

- **Loop detector:** if the same tool is called N≥5 times with near-identical args within a single session, halt loop with explicit "stopping to avoid tool-call loop" signal
- **Circuit breaker:** after 3 consecutive same-error-code failures on one tool, disable that tool for the remainder of the session; agent continues with alternative tools
- **Retry budget per tool:** not just per-request; budget of 10 retries per tool per session, exhausted = disable that tool

Implementation detail lives in `ai-patterns.md`. This standard documents the WHY: loop detectors + circuit breakers prevent runaway cost (OWASP LLM10 Unbounded Consumption) and keep Pattern #1 effective without opening Pattern #2 risks.

## Cross-model verification (endorsed for review pipeline)

When running review agents (security-auditor, correctness-auditor, blind-hunter, etc.) on work produced by the main worker model, **route auditor to a different model** than the worker if possible:

- Worker: Claude Sonnet 4.6 → Auditor: Claude Opus 4.7 (cross-tier, same family — acceptable)
- Worker: Claude → Auditor: GPT or Gemini (cross-family — best signal)

Same-model self-verification has the 64.5% blind-spot problem. Cross-family judgement catches what the worker cannot see in its own output.

## Verification checklist

- [ ] No scaffolded code includes intrinsic self-critique step without external verifier
- [ ] All `safe-tool` implementations include loop detector + circuit breaker (Pattern #1 v2)
- [ ] Any skill-proposer feature defaults `autoSkills: false`; HITL queue is default UX
- [ ] Layer 1 memory promotions require diff approval (autoDream gate)
- [ ] Review pipeline attempts cross-model auditor routing when feasible
- [ ] GEPA-style offline prompt evolution is sandboxed to `evals/` — never runtime

## Research sources (primary only)

- [Reflexion paper (arXiv 2303.11366)](https://arxiv.org/abs/2303.11366)
- [Can LLMs Correct Themselves? (arXiv 2510.16062, NeurIPS 2025)](https://arxiv.org/abs/2510.16062)
- [When Can LLMs Actually Correct Their Own Mistakes? (TACL 2024)](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00713/125177/)
- [GEPA: Reflective Prompt Evolution (arXiv 2507.19457, ICLR 2026 Oral)](https://arxiv.org/abs/2507.19457)
- [SkillsBench (arXiv 2602.12670)](https://arxiv.org/html/2602.12670v1)
- [EvoSkill (arXiv 2603.02766)](https://arxiv.org/html/2603.02766v1)
- [Overconfidence in LLM-as-a-Judge (arXiv 2508.06225)](https://arxiv.org/html/2508.06225v2)
- [Voyager paper (arXiv 2305.16291)](https://arxiv.org/abs/2305.16291)
- [Cognition: Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents)
- [Anthropic skill-creator SKILL.md (HITL pattern)](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

## Cross-references

- `standards/ai-patterns.md` — Pattern #1 safe-tool base implementation
- `standards/correctness.md` — eval-driven dev as spec for non-deterministic code
- `standards/auto-optimization.md` — wizard philosophy
- `standards/skills.md` — agentskills.io spec for HITL skill proposals
- `prompts/cortex-evolve.md` — offline GEPA-style evolution lane (Phase 5)
