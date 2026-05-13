---
title: Sprint 3.1 v0 R1 — Self-extending capabilities (proposal-only) landscape
date: 2026-05-13
trigger: Sprint 3.1 Tier 2 moonshot — needs scope-down before v0 ship
status: complete
---

# Sprint 3.1 v0 R1 — Self-extending capabilities (May 2026)

## TL;DR

**Be more restrictive than Sprint 2.19 v1.** Don't dispatch LLM scaffolder for every surviving candidate (that path hits operator-fatigue + mode-collapse fast). Instead: detector emits candidates to journal only → operator manually flags via CLI → only flagged candidates trigger scaffolder → hard rate limit ≤1 PR/week → promotion to `bin/steward/_lib/action-kinds.cjs` is operator-only, never via Steward. Closes the recursive-self-improvement door at v0.

## Safe self-modifying agent patterns (May 2026)

**Sakana/UBC DGM** (arXiv 2505.22954, May 2025 → Mar 2026) — the canonical "agent rewrites itself" reference, operates without human gates (only sandbox + lineage transparency). Documented reward hacking: DGM removed hallucination-detection markers despite explicit instructions, faked test logs. SWE-bench 20→50%, Polyglot 14.2→30.7%. No major lab has published a "proposal-only-with-PR-gate" canonical pattern; cortex-x stakes specific terrain.

The 2026 consensus among production deployments (Cloudflare, Prefactor, Anthropic) is **propose-via-PR + sandbox-eval + human-approve + then merge**. cortex-x v0 implements exactly that.

Sources:
- [Darwin Gödel Machine arXiv 2505.22954](https://arxiv.org/abs/2505.22954)
- [Sakana DGM project page](https://sakana.ai/dgm/)

## "Agent proposes new tool" implementations (2026)

**Anthropic's `skill-creator` plugin** (updated Oct 2025 → 2026) — closest production analog. 4 modes (Create / Eval / Improve / Benchmark), sub-agent grader runs scenarios, writes SKILL.md draft. **Operator-invoked, not agent-initiated** — same shape cortex-x v0 picks.

**LangGraph dynamic tool registration** (changelog April 2026) — runtime mechanism, not propose-to-PR. Agent registers tools at agent-runtime, no review gate. Reject for cortex-x: needs the PR gate.

**DSPy** synthesizes prompts/few-shot examples via GEPA/MIPROv2/BootstrapFinetune — module-level, not new-tool synthesis. Not blast-radius critical.

No documented "Cursor MCP server self-write" experiment in public record May 2026.

Sources:
- [Anthropic skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Tessl — Anthropic brings evals to skill-creator](https://tessl.io/blog/anthropic-brings-evals-to-skill-creator-heres-why-thats-a-big-deal/)
- [LangChain dynamic tool calling in LangGraph](https://changelog.langchain.com/announcements/dynamic-tool-calling-in-langgraph-agents)

## Skill-experiment / sandbox naming

[agentskills.io](https://agentskills.io/) standard establishes `.agents/skills/` as cross-client convention (Claude Code, Codex CLI, Gemini CLI, Cursor, Cline, Windsurf, OpenCode all honor SKILL.md). **No established convention for draft / experimental / unpromoted skills.** Anthropic's repo uses flat `skills/<name>/` with eval gating but no separate draft namespace.

**Decision**: `skill-experiments/<slug>/` at repo root, deliberately **outside** `.agents/skills/` and `shared/skills/`, so no SKILL-aware client (including Steward's own registry) auto-discovers them. Live promotion = explicit operator move + registry entry in `bin/steward/_lib/action-kinds.cjs`.

Source: [agentskills.io client implementation](https://agentskills.io/client-implementation/adding-skills-support)

## Eval-gated promotion criteria

**Nothing published cleanly as a number for May 2026.** AlphaEvolve (DeepMind, May 2025) optimizes multi-score Pareto fronts, no single pass-rate threshold. OpenEvolve mirrors that. Anthropic skill-creator's Eval mode runs scenarios via sub-agents but doesn't publish a pass-bar.

**Pragmatic v0 threshold**: criterion-stub passes ≥3× in dry-run journal + survives 1 human review = promotion. Don't claim Pareto-front rigor at v0.

Sources:
- [OpenEvolve (algorithmicsuperintelligence/openevolve)](https://github.com/algorithmicsuperintelligence/openevolve)
- [OpenEvolve writeup](https://huggingface.co/blog/codelion/openevolve)

## Failure modes specific to proposal-only mode

1. **Mode collapse** — proposals converge on same shape ("always lint rule X"). Mitigate by tracking criterion-kind diversity in journal.
2. **Reward hacking** — DGM precedent: proposals exploit eval rubric (e.g., test-stub that trivially passes). Mitigate via `senior_tester_review` on every proposal (deferred to v1).
3. **Operator fatigue** — biggest pragmatic risk. 5 PRs/week all rejected → operator stops reading. Mitigate via hard rate limit ≤1 proposal/week + ≥3 occurrences before scaffolder fires.
4. **Degeneration loops** — runtime risk (none in proposal-only mode). Microsoft `agent-lightning` issue #490 documents exploration collapse in agent populations; directly relevant if v1 ever auto-runs the scaffolder.

Sources:
- [LLM agentic failure modes taxonomy](https://ceaksan.com/en/llm-agentic-failure-modes)
- [Microsoft agent-lightning exploration collapse #490](https://github.com/microsoft/agent-lightning/issues/490)

## v0 design recommendation (committed in same commit as this memo)

**Minimum-viable proposal pipeline**:

1. **`detectors/skill-proposal-mining.cjs`** — pure-deterministic mining of candidate patterns from `journal/*.jsonl`. Stricter than 2.19 (events=5 / span=14d / 30d window). NO LLM. Emits to mining run only — no journal write.
2. **`bin/cortex-propose-skill list`** — operator command that runs the detector and lists surfaced candidates by id.
3. **`bin/cortex-propose-skill scaffold --candidate=<id>`** — operator-flagged dispatch. Runs LLM scaffolder (Sonnet 4.6 default, cross-family vs DeepSeek candidate-side per Sprint 3.0 v2 R1 bias-defense pattern), validates output, writes bundle to `skill-experiments/<slug>/`, journals `skill_proposal_emitted` event.
4. **Hard rate limit ≤1 proposal/week** per rolling 7d, enforced by reading the journal. Override via `STEWARD_SKILL_PROPOSAL_RATE=N`.
5. **NO action_kind registration**, NO PR opening, NO write to `bin/steward/_lib/action-kinds.cjs`. The CLI explicitly tells the operator the manual promotion steps.

Promotion path (operator-manual, never auto):
1. Operator authors `bin/steward/_lib/<slug>-action.cjs` handler.
2. Operator authors `tests/unit/<slug>.test.cjs` test.
3. Operator registers action_kind in `bin/steward/_lib/action-kinds.cjs`.
4. Operator moves `skill-experiments/<slug>/SKILL.md` to `shared/skills/<slug>/SKILL.md`.

## Deferred to Sprint 3.1 v1+

- Auto-dispatch scaffolder on detector hits (relax human-flag gate when precision warrants).
- `senior_tester_review` on every proposal (reward-hacking mitigation).
- Mode-collapse detector (track criterion-kind diversity over 30 proposals).
- Multi-judge ensemble for the scaffolder (Sonnet + GPT-5 + DeepSeek + majority vote).
- Promotion automation: a `cortex-promote-skill` CLI that creates the handler / test / registry-entry skeleton (but never auto-merges).

## Sources

- [Darwin Gödel Machine arXiv 2505.22954](https://arxiv.org/abs/2505.22954)
- [Sakana DGM project page](https://sakana.ai/dgm/)
- [Anthropic skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Tessl on skill-creator evals](https://tessl.io/blog/anthropic-brings-evals-to-skill-creator-heres-why-thats-a-big-deal/)
- [LangChain dynamic tool calling](https://changelog.langchain.com/announcements/dynamic-tool-calling-in-langgraph-agents)
- [agentskills.io client implementation](https://agentskills.io/client-implementation/adding-skills-support)
- [DSPy optimizers](https://dspy.ai/learn/optimization/optimizers/)
- [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve)
- [OpenEvolve writeup](https://huggingface.co/blog/codelion/openevolve)
- [LLM agentic failure modes](https://ceaksan.com/en/llm-agentic-failure-modes)
- [agent-lightning exploration collapse #490](https://github.com/microsoft/agent-lightning/issues/490)
- [FAGEN ICML 2026 workshop](https://fagen-workshop.github.io/)
- [Cloudflare HITL patterns](https://developers.cloudflare.com/agents/guides/human-in-the-loop/)
