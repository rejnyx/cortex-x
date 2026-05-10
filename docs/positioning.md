# Positioning — cortex-x in the autonomous-coding landscape (May 2026)

> The 7 tools that materially do "AI ships code without me watching." Where cortex-x sits, what survives competitive scrutiny, what it isn't.

This is the launch-readiness companion to [`docs/positioning-vs-ralph.md`](./positioning-vs-ralph.md). Ralph is the philosophical ancestor; the tools below are the production peers.

## The market in May 2026 — three quadrants

The autonomous-coding category has stabilized into three rough shapes:

1. **Hosted SaaS junior engineers** — Devin, Replit Agent, Cursor Background Agent, GitHub Copilot Coding Agent. You hand them a task; they run on the vendor's infra; pricing is per-quarter-hour or per-checkpoint at $20+/mo floor.
2. **Open-source IDE-tethered tools** — Aider, Sweep, Cline. BYO-LLM, run from terminal or IDE, free except for model bills.
3. **Self-improvement research** — Sakana Darwin Gödel Machine. Population-based agent evolution, SWE-bench 20% → 50% via self-rewrite. Research code, not maintenance autopilot.

cortex-x is shaped for a slot none of these occupy: **self-hosted, zero-deps, cron-driven, atomic-rollback maintenance autopilot for an operator's existing repos**.

## One-sentence positioning

> *"The production-grade descendant of the Ralph pattern — multi-window cost safety + atomic-rollback maintenance autopilot for operator-owned repos at <$0.001/run, with spec verifier + cross-session loop detector + per-kind acceptance criteria that no shipped competitor co-ships."*

The cost gap to SaaS peers is roughly **3 orders of magnitude per task** — Devin's $2.25/ACU (~15 min) vs cortex-x's ~$0.0008/run via OpenRouter + DeepSeek V4 Flash. That gap exists because cortex-x runs on operator infra; the operator owns the cost ceiling.

## Comparison matrix

| Feature | Devin | GH Copilot CA | Replit Agent | Cursor BG Agent | Sakana DGM | OpenClaw | Aider | **cortex-x Steward** |
|---|---|---|---|---|---|---|---|---|
| Self-host (operator infra) | ❌ | ❌ | ❌ | ⚠️ local IDE only | ✅ | ✅ | ✅ | ✅ |
| Atomic-rollback pipeline | ⚠️ session VM | ⚠️ PR-level | ⚠️ checkpoint | ⚠️ branch | ❌ | ❌ | ⚠️ git-only | ✅ per-action |
| Cron-driven unattended runs | ❌ | ⚠️ via Actions cron | ❌ | ⚠️ manual trigger | ❌ research | ✅ | ⚠️ via OS cron | ✅ first-class |
| Multi-window USD cap (D/W/M) | ❌ ACU budget only | ❌ credit pool | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-session loop detection | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 5x/7d |
| Per-kind spec verifier | ❌ | ❌ | ❌ | ❌ | ⚠️ benchmark gate | ❌ | ❌ | ✅ 5 criterion kinds |
| File-based killswitch | ❌ | ⚠️ revoke token | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ STEWARD_HALT |
| "Senior tester" review pass | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ monthly cron |
| Open-source license | ❌ | ❌ | ❌ | ❌ | ✅ research code | ✅ | ✅ Apache-2 | ⚠️ PolyForm Noncommercial |
| Typical operator cost / run | ~$2/15min ACU | credit-debited | $0.25/checkpoint | $0.50–7.50/Mtok | model bill | model bill | ~$0.01/file | **~$0.0008/run** |
| Marketplace / dashboard | ✅ web | ✅ GitHub | ✅ web | ✅ IDE | ❌ | ⚠️ chat surfaces | ❌ | ❌ (CLI + journal) |
| Target audience | Mid-market eng | GitHub orgs | Builders | IDE-first devs | Researchers | Hobbyists | Terminal solo | **Operator w/ many repos** |

Legend: ✅ shipped & first-class · ⚠️ partial / via workaround · ❌ absent.

## Per-competitor short profiles

### Devin (Cognition AI) — the hosted-junior-engineer category leader

**Status:** $25B valuation reported Apr 2026 ([Bloomberg cite](https://www.idlen.io/news/cognition-devin-25-billion-valuation-windsurf-vibe-coding-april-2026/)). Parallel-Devin sessions (Feb 2026) shipped. ARR doubled.
**Pricing:** Core PAYG $20/mo + $2.25 per ACU (≈ 15 min); Team $500/mo with 250 ACUs at $2.00; Enterprise custom incl. VPC/SAML.
**Safety:** Ephemeral isolated VM per session, default-deny network egress with allowlist, secrets scoped per session, six explicit risk-config knobs.
**Why cortex-x doesn't try:** Devin owns "junior teammate that closes Linear tickets." cortex-x sits on operator infra, never sees code outside that machine, runs at <$0.01/run rather than ~$2/quarter-hour. Different shape, different buyer.
**Sources:** [pricing](https://devin.ai/pricing/), [security](https://devin.ai/security)

### GitHub Copilot Coding Agent — closest scheduled-maintenance peer

**Status:** GA on Pro/Pro+/Business/Enterprise. Org firewall settings shipped Apr 2026.
**Pricing:** Pro $10/mo, Pro+ $39/mo, Business $19/seat, Enterprise $39/seat. Usage-based billing transitioning Jun 1 2026.
**Safety:** Built-in agent firewall (allowlist, default-on); ephemeral cloud sandbox VM per task. **Documented limitation:** firewall does NOT apply to MCP servers or setup steps.
**vs cortex-x:** GitHub Coding Agent is the closest "scheduled maintenance" peer — Actions cron can drive the Copilot CLI. But every task burns AI Credits (not free unattended), is locked to GitHub, and lacks per-kind spec verifiers + multi-window USD caps. cortex-x's audit trail lives in operator-owned `cortex/journal/`, not GitHub Actions logs.
**Sources:** [coding-agent docs](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent), [firewall reference](https://docs.github.com/en/copilot/reference/copilot-allowlist-reference), [usage-billing announcement](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)

### Replit Agent — different category (build-and-deploy-from-scratch)

**Status:** Replit Agent 3 GA. Pricing overhauled Feb 2026.
**Pricing:** Starter free, Core $25/mo, Pro $100/mo (15 builders). Effort-based per-checkpoint ($0.25 Agent / $0.05 Assistant). Real bills documented at $158/period (632 Agent checkpoints).
**vs cortex-x:** Replit owns "build-and-deploy app from scratch in cloud." cortex-x maintains operator-owned existing repos that ship to operator's existing CI/host. Adjacent, not competing.
**Source:** [pricing](https://replit.com/pricing)

### Cursor Composer 2 + Background Agents — closest IDE-tethered "while-you-sleep" peer

**Status:** Composer 2 released Mar 19 2026 (CursorBench 61.3 vs 44.2 v1.5). Background Agents GA, parallelism up to 8/user. Cloud Agents with Computer Use shipped Feb 2026 — per-agent VM + browser + video recording.
**Pricing:** Pro $20/mo (incl $20 credits), Pro+ $60/mo (3x), Ultra $200/mo (20x), Business $40/seat. Composer 2 token rates: $0.50/M in, $2.50/M out (standard) / $1.50 + $7.50 (fast).
**Safety:** Formal sandboxing on macOS/Linux/Windows (Seatbelt on macOS); Background Agents in isolated Ubuntu VMs with branch isolation; approval-gated egress.
**vs cortex-x:** Closest "I run while you sleep" peer **inside an IDE workflow**. cortex-x doesn't bind to an IDE — it's a cron job. Cursor's $20/mo + overage floor and IDE tether are the structural differences.
**Sources:** [agent sandboxing](https://cursor.com/blog/agent-sandboxing), [Background Agents guide](https://www.morphllm.com/cursor-background-agents)

### Sakana Darwin Gödel Machine — different problem (evolve the agent itself)

**Status:** Research artifact (arXiv 2505.22954, Mar 2026 update). Reference impl `jennyzzt/dgm` on GitHub.
**Pricing:** Free OSS; runs against any LLM API.
**Performance:** SWE-bench 20.0% → 50.0% via self-modification; Polyglot 14.2% → 30.7%.
**Safety:** Authors explicitly warn it executes untrusted model-generated code; sandboxing + human oversight required during experiments. **Not designed for unattended production.**
**vs cortex-x:** DGM is "evolve the agent itself"; cortex-x is "evolve the operator's repos under invariants." Likely **borrow** DGM-style fitness/lineage ideas (already on Tier 2 roadmap re: AlphaEvolve), not compete.
**Sources:** [DGM page](https://sakana.ai/dgm/), [arXiv 2505.22954](https://arxiv.org/abs/2505.22954), [reference impl](https://github.com/jennyzzt/dgm)

### OpenClaw / OpenClaude — horizontal personal-assistant cousin

**Status:** OpenClaw (Peter Steinberger's Nov 2025 weekend project) hit 60K stars in 72h after Jan 2026 viral moment; transferring to an open-source foundation with reported OpenAI financial backing. OpenClaude / Claw Code is a clean-room rewrite of Claude Code's leaked TypeScript at 48K+ stars. ClaudeClaw is a thin wrapper.
**Pricing:** Free (MIT/Apache-style OSS).
**Distribution:** Self-host CLI + plugin ecosystem ("ClawHub" 5,700+ skills).
**vs cortex-x:** Spiritual cousins — both refuse SaaS posture, both self-host, both BYO-LLM. **Different vertical:** OpenClaw is horizontal personal-assistant (calendar, email, smart home, files); cortex-x is vertical maintenance-of-code-repos. cortex-x's atomic-commit + spec-verifier + cron pipeline is narrower-but-deeper than OpenClaw's broad skills marketplace.
**Naming watch:** the explosive OpenClaw growth makes "open-source autonomous agent" a more crowded conceptual slot than expected. Worth monitoring for cognitive collision the same way the NousResearch Hermes collision triggered the [Sprint 4.7 rebrand](../MIGRATIONS.md).
**Sources:** [openclaw.ai](https://openclaw.ai/), [ClaudeClaw](https://github.com/moazbuilds/claudeclaw), [OpenClaude](https://github.com/Gitlawb/openclaude)

### Aider — closest philosophical neighbor

**Status:** Stable. v2.0+ ships Agent mode + Navigator mode + Architect/Editor split + Watch mode (file-comment trigger).
**Pricing:** Free Apache-2.0; you pay your LLM provider (~$0.007/file).
**Safety:** Git-aware (auto-commit per change), but no spec verifier, no multi-window USD cap, no halt-check killswitch.
**vs cortex-x:** Closest philosophical neighbor — OSS, terminal, BYO-LLM, cheap. cortex-x extends Aider's posture with **production-grade safety mechanics that Aider intentionally doesn't ship**: per-kind acceptance criteria, atomic-pipeline rollback, cross-session loop detection, capability palette beyond pure code-edit (doc_drift, dep_update_patch, secret_history_sweep, senior_tester_review, workflow_hardener, ...). Aider is a chat-edit loop with cron capability; cortex-x is a maintenance autopilot with a chat-edit step inside it.
**Sources:** [chat modes](https://aider.chat/docs/usage/modes.html), [docs](https://aider.chat/docs/)

## Honest weaknesses of cortex-x

If a reviewer asks "where's the catch," the answer is one of these:

1. **Closed beta, dogfooding only.** Every other tool in the matrix has paying users; cortex-x has the operator. Public flip is gated by [`docs/launch-checklist.md`](./launch-checklist.md) P0 items.
2. **No GUI / dashboard.** Cursor / Replit / Devin / GitHub all have polished consoles. cortex-x ships a status CLI + a journal file. The BIOS-style dashboard is parked at Tier 3 Sprint 4.5.
3. **No SaaS option.** Deliberate posture, but it means anyone who wants "click-install, billing handled" walks past cortex-x.
4. **Anthropic / OpenRouter shape lock-in (today).** Engine seam exists (mock / openrouter / claude-sdk / claude-cli), but spec verifier + edit-ops format implicitly assume Claude-style structured output. Multi-provider parity is roadmap-only.
5. **License is PolyForm Noncommercial 1.0.0.** OSS purists who want Apache/MIT (Aider, OpenClaw) get a stricter contract. Commercial use needs separate arrangement. License decision is on the launch-checklist (P0 operator-only).
6. **Capability palette is opinionated, not extensible from outside.** Devin/Cursor/OpenClaw have plugin/skill marketplaces (ClawHub: 5.7K skills). cortex-x's 15 action_kinds are curated by the operator, not open-marketplace.
7. **No browser/computer-use.** Cursor Cloud Agents (Feb 2026) and Devin's parallel sessions can drive a UI to verify changes visually. cortex-x is text-and-test-suite only.
8. **Public benchmark numbers are absent.** DGM publishes SWE-bench 20→50%; cortex-x has eval rubrics ([`evals/eval-001`–`010`](../evals/)) but no public scorecard yet (Sprint LR.1 — `evals/results/2026-MM-DD-real-baseline.json` is the closing gate).

## The differentiator that survives scrutiny

**Multi-window cost safety + atomic-rollback maintenance autopilot for operator-owned repos at <$0.001/run.**

Every competitor either (a) charges per quarter-hour of agent time at minimum $20/mo floor, or (b) is open-source but lacks the pipeline safety primitives, or (c) is research code without production discipline. cortex-x's combination of:

- `STEWARD_DAILY_USD_CAP` ($10) + `STEWARD_WEEKLY_USD_CAP` ($25) + `STEWARD_MONTHLY_USD_CAP` ($80)
- `STEWARD_TOKEN_VELOCITY_CAP` (50K tokens / 5 min)
- Cross-session loop detector (5x same criterion in 7d → halt)
- Intra-run StuckLoopDetection (3 patterns, threshold 3)
- Self-invocation tracker (4 hard guardrails: max-depth=3, wall-clock=30min, dedup-window=3, cost gate)
- Per-kind spec verifier (5 criterion kinds: shell / file_predicate / regex / ears_text / llm_judge)
- Atomic git rollback (branch → LLM apply → spec gate → npm test → commit → push → draft PR; rollback on any failure)
- File-based killswitch (`STEWARD_HALT` sentinel; operator-cleared, never agent-cleared)

… is, as of this 2026-05-10 research sweep, **not co-occurring in any other shipped tool**.

## When to use which

- **Use Devin** if you need a hosted junior engineer that closes Linear tickets and your team is enterprise-shaped.
- **Use GitHub Copilot Coding Agent** if your repos already live on GitHub and you want one console for everything.
- **Use Replit Agent** if you're building from scratch and want IDE + host + agent in one place.
- **Use Cursor Background Agent** if Cursor IS your IDE and you want sleep-while-it-runs inside that workflow.
- **Use Aider** if you want a terminal-first, single-file-iteration loop with full git transparency.
- **Use OpenClaw** if you want a horizontal personal assistant for life automation (not code-repo maintenance).
- **Use Sakana DGM** if you're doing self-improvement research, not production.
- **Use cortex-x Steward** if you have multiple long-lived repos, an OpenRouter key, a strong "no SaaS for my git history" preference, and you want unsupervised overnight maintenance with atomic rollback + multi-window cost caps + audit trail in your own files.

## References

Research dispatch memo: [`docs/research/sprint-lr.6-competitive-landscape-research-2026-05-10.md`](./research/sprint-lr.6-competitive-landscape-research-2026-05-10.md) (25 cited URLs).

Companion: [`docs/positioning-vs-ralph.md`](./positioning-vs-ralph.md) (philosophical ancestor framing).
