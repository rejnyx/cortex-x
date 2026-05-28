# Claude Managed Agents (CMA) — positioning memo

> **Status:** landscape/positioning memo (Sprint LR.CMA, 2026-05-28). Verified by parallel web research against official Anthropic docs. **Snapshot — re-verify before acting months later.** Companion to the OpenClaw deep-dive (Sprint LR.Z) and the competitive landscape refresh (Sprint LR.X).

## TL;DR

CMA is Anthropic's **managed/hosted platform for production agents** — a beta clone of much of cortex-x's evolve/spec-verifier/Steward stack, but Anthropic-cloud-owned. It **validates cortex's design** and is a **competitor to monitor**, but it is a **poor 4th Steward engine seam** (the agent loop cannot be self-hosted). cortex's response is positioning, not feature-chasing: lean into the operator-owned markdown SSOT + safety stack + institutional wisdom — the layer CMA does *not* provide. This is the Boris-Cherny "harness commoditizes → value migrates to wisdom" thesis playing out.

## What CMA is

The evolution Anthropic frames: Messages API (2023, raw tokens) → Agent SDK (programmatic Claude Code, dev manages hosting) → **Claude Managed Agents** (Anthropic handles hosting, scaling, sandboxing, observability, compaction, caching).

Four resources (the workshop said three; docs confirm four):

| Resource | Role |
|---|---|
| **Agent** | model + system prompt + tools + MCP + skills = the "brain" |
| **Environment** | container (`cloud` or `self_hosted`) = the "hands" |
| **Session** | a running instance binding an Agent to an Environment |
| **Events** | append-only log (SSE streaming, full server-side history) — "events not tokens" |

Architectural keystone: **decoupling brain from hands** → credential sandboxing + lazy container spin-up → P50 TTFT ~60% / P95 >90% reduction.

## Status + pricing (beta — not GA)

- Public beta (~April 2026), `managed-agents-2026-04-01` beta header, enabled by default for API accounts.
- Pricing = **standard model token rates (no Batch discount) + $0.08 / session-hour**, billed to the millisecond, **only while `running`** (idle is free). Beta-era, not GA-committed.
- **Not ZDR / HIPAA-eligible** (stateful, server-side retention).
- Accessed via Agent SDK: `client.beta.{agents,environments,sessions,vaults,memory_stores}.*`. Partners may **not** brand it "Claude Code."

Sources: [overview](https://platform.claude.com/docs/en/managed-agents/overview) · [engineering](https://www.anthropic.com/engineering/managed-agents) · [pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## Feature overlap with cortex-x

| CMA feature | cortex-x equivalent | Read |
|---|---|---|
| **Dreaming** (async: read memory store + 1–100 transcripts → new store, merge dups / replace stale / surface insights; input never mutated; research preview) | `evolve_daily` / `evolve_weekly` action_kinds + `wiki_consolidate` ("Dreaming") | **Managed clone** of cortex autoDream. Same shape. |
| **Outcomes** (rubric-graded iterate loop: `define_outcome` + grader + `outcome_evaluation`) | spec-verifier `llm_judge` / `ears_text` acceptance criteria | Direct parallel. |
| **Memory stores** | three-layer memory + Memory Tool deferral (Sprint 3.X) | Managed; cortex's is local/markdown. |
| **Multiagent / sub-agents** | review pipeline + `multi-agent-supervisor.md` | Managed coordinator. |
| **Vaults** (encrypted MCP creds, auto-refresh OAuth) | n/a (cortex defers to operator's own secret store) | Genuinely new convenience. |
| **Webhooks / session states** | Steward cron triggers (GitHub Actions) | Different trigger substrate. |

## The engine-seam question — answer: no

Could Steward run *on* CMA as a 4th engine (`mock` / `openrouter` / `claude-sdk` / `claude-managed-agents`)?

**No, not usefully.** CMA's `self_hosted` sandboxes relocate **only tool execution (the hands)** to your worker; **the orchestration loop stays in Anthropic's cloud and cannot be self-hosted**. That is the exact inverse of Steward's value proposition (operator-owned, local-first, GitHub-Actions cron, zero-dep, ZDR-by-construction). Add the $0.08/hr runtime meter and no-ZDR posture, and CMA is at most an *optional cloud execution target for long-horizon batch tasks* — never the home of the operator's second brain.

Source: [self-hosted-sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes).

## Positioning verdict

1. **Keep Steward local-first.** Nothing CMA offers that matters to a *wisdom library* requires giving up loop ownership.
2. **Treat CMA as a competitor to monitor**, not a dependency. Its managed Dreaming/Outcomes/Memory erode the "only cortex does this" pitch — so the pitch must move.
3. **Moat = operator-owned markdown SSOT + safety stack + institutional wisdom.** CMA gives you a great *runtime*; it does not give you "my lessons from project N show up on day 1 of project N+1." That compounding, operator-owned judgment layer is what survives harness commoditization.
4. This confirms the **Boris-Cherny "harness less important over time"** signal: Anthropic now *sells* the harness. cortex's value is the layer above it.

## Non-goals

- Do NOT build a CMA adapter as a Steward engine now (loop is not self-hostable; revisit only if Anthropic ships a self-hostable loop).
- Do NOT chase feature parity with Dreaming/Outcomes/Vaults — cortex already has the wisdom-layer equivalents; the differentiator is ownership + portability, not managed convenience.
