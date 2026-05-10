# Sprint LR.6 — Competitive Landscape Research (2026-05-10)

> Research-only memo. Inputs: WebSearch + WebFetch sweep, May 2026 sources. Frame: how does cortex-x Steward (autonomous Claude Code framework, closed beta) survive competitive scrutiny against the 7 named tools that materially do "AI ships code without me watching"?

## 1. Executive summary

- **The autonomous-coding market in May 2026 is dominated by hosted SaaS** (Devin, Replit, Cursor Background Agent, GitHub Copilot Coding Agent) and **open-source IDE-tethered tools** (Aider, Sweep, Cline). Almost nobody else occupies cortex-x's exact slot: **self-hosted, zero-deps, cron-driven, atomic-rollback maintenance autopilot for an operator's existing repos**.
- **Cost asymmetry is the sharpest differentiator.** Devin starts at $20/mo + ~$2.25 per ACU (~15 min of work); Replit Agent runs $0.25/checkpoint with documented bills of $158 in a single period; Cursor Pro is $20/mo with overage; cortex-x via OpenRouter/deepseek-v4-flash runs **~$0.0008/run** with hard daily/weekly/monthly caps. For a nightly cron operator that's roughly 3 orders of magnitude below SaaS pricing.
- **No competitor pairs cron-style unsupervised maintenance with multi-window cost caps + cross-session loop detection + per-kind spec-verifier.** Cursor and GitHub Copilot Coding Agent both have sandbox VMs; neither has multi-window USD ceilings or velocity caps. Sakana DGM has self-improvement evolution but is a research artifact, not a maintenance autopilot.
- **The "self-improving" research crown is taken by Sakana's Darwin Gödel Machine** (arXiv 2505.22954, Mar 2026 paper update; SWE-bench 20% → 50% via self-rewriting). cortex-x doesn't compete on benchmark-evolution; it competes on **safe, audited, atomic delivery** of nightly maintenance into operator-owned repos.
- **Honest positioning:** cortex-x is not a Devin replacement and is not for teams that want a managed SaaS dashboard. It's the right shape for a **single operator with multiple long-lived repos, an OpenRouter key, and a strong "no SaaS for my git history" preference**.

## 2. Per-competitor profiles

### 2.1 Devin (Cognition AI)

**Status (May 2026):** Production at scale. Reports of Cognition raising at $25B valuation Apr 2026 (Bloomberg); ARR doubled; Windsurf integrated. Parallel-Devin sessions shipped Feb 2026.
**Pricing:** Core PAYG from $20 + $2.25/ACU (1 ACU ≈ 15 min); Team $500/mo with 250 ACUs at $2.00 each; Enterprise custom incl. VPC/SAML.
**Distribution:** Web app + Slack + IDE plugins. Hosted SaaS only (Enterprise Cloud is multi-tenant Cognition cloud; no operator-side install).
**Safety:** Ephemeral isolated VM per session, default-deny network egress with allowlist, secrets scoped per session. Six explicit risk-config knobs (push permissions, branch protection, deploy keys, review gates).
**Audience:** Mid-market and enterprise eng teams; "junior teammate that closes Linear tickets."
**vs cortex-x:** Devin owns the hosted-junior-engineer category. cortex-x doesn't try; it sits on operator infra, never sees the code outside that machine, and runs at <$0.01/run rather than ~$2/quarter-hour.
**Source:** https://devin.ai/pricing/, https://devin.ai/security

### 2.2 GitHub Copilot Coding Agent

**Status (May 2026):** GA on Pro/Pro+/Business/Enterprise. Org-level firewall settings shipped Apr 2026. Renamed from "Workspace" branding.
**Pricing:** Pro $10/mo, Pro+ $39/mo, Business $19/seat, Enterprise $39/seat. Usage-based billing with monthly AI Credits transitioning Jun 1, 2026.
**Distribution:** Inside github.com (assign issue → Copilot opens PR). Runs on GitHub Actions infra.
**Safety:** Built-in agent firewall (allowlist, default-on); ephemeral cloud sandbox VM per task; firewall does **not** apply to MCP servers or setup steps (documented limitation). Docker-sandbox path for local CLI agent.
**Audience:** GitHub-native teams; org admins who want one console.
**vs cortex-x:** Closest "scheduled maintenance" peer — workflows can cron the Copilot CLI. But it is **not free** to run unattended (every task burns AI Credits), is locked to GitHub, and lacks per-kind spec verifiers and multi-window USD caps. Audit trail lives in GitHub Actions, not in operator-owned journal.
**Sources:** https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent, https://docs.github.com/copilot/customizing-copilot/customizing-or-disabling-the-firewall-for-copilot-coding-agent, https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/

### 2.3 Replit Agent

**Status (May 2026):** Replit Agent 3 GA. Pricing overhauled Feb 2026 — Starter (free), Core $25/mo, Pro $100/mo (15 builders), Enterprise custom. Old Teams tier retired.
**Pricing:** Effort-based per-checkpoint ($0.25 Agent / $0.05 Assistant). Real bills documented at $158/period (632 Agent checkpoints).
**Distribution:** Web SaaS (Repls run in Replit cloud). No self-host.
**Safety:** Isolated Repl per project; deployment isolation; sandbox is implicit in the Repl model.
**Audience:** Solo builders + small teams who want the IDE + the host + the agent in one place.
**vs cortex-x:** Different category. Replit owns "build-and-deploy app from scratch in cloud." cortex-x maintains operator-owned existing repos that ship to operator's existing CI/host.
**Source:** https://replit.com/pricing

### 2.4 OpenClaw / OpenClaude / ClaudeClaw (open-source Claude-Code clones)

**Status (May 2026):** OpenClaw (Peter Steinberger's weekend project, Nov 2025) hit 60K stars in 72 hours after viral moment late Jan 2026; per reporting, transferring to an open-source foundation with OpenAI financial backing post Steinberger's move there. **OpenClaude / Claw Code** is a clean-room rewrite of Claude Code's leaked TypeScript (~512K LoC) at 48K+ stars. **ClaudeClaw** is a thin "OpenClaw inside Claude Code" wrapper.
**Pricing:** Free (MIT/Apache-style OSS).
**Distribution:** Self-host CLI + plugin ecosystem ("ClawHub" 5,700+ skills).
**Safety:** Inherited from each project — generally permissive sandboxing, depends on host config.
**Audience:** Hobbyists, OSS maximalists, "I refuse SaaS" operators.
**vs cortex-x:** Spiritual cousins. OpenClaw is **horizontal personal-assistant** (calendar, email, smart home, files); cortex-x is **vertical maintenance-of-code-repos**. Both share zero-vendor-lock posture. cortex-x's atomic-commit + spec-verifier + cron pipeline is narrower-but-deeper than OpenClaw's broad skills marketplace.
**Sources:** https://openclaw.ai/, https://github.com/moazbuilds/claudeclaw, https://github.com/Gitlawb/openclaude

### 2.5 Sakana AI Darwin Gödel Machine

**Status (May 2026):** Research artifact. arXiv 2505.22954 (last revised Mar 2026). Reference implementation `jennyzzt/dgm` on GitHub; community port `lemoz/darwin-godel-machine` MIT-licensed.
**Pricing:** Free OSS; runs against any LLM API (so cost = your model bill).
**Distribution:** Python repo, sandboxed execution, population-based evolution.
**Safety:** Authors explicitly warn it executes untrusted model-generated code; sandboxing + human oversight required during experiments. **Not** designed for unattended production.
**Performance claim:** SWE-bench 20.0% → 50.0% via self-modification; Polyglot 14.2% → 30.7%.
**Audience:** ML researchers, agent self-improvement labs.
**vs cortex-x:** Different problem. DGM is "evolve the agent itself"; cortex-x is "evolve the operator's repos under invariants." cortex-x will likely **borrow** DGM-style fitness/lineage ideas (already on Tier 2 roadmap re: AlphaEvolve prompt evolution), not compete with them.
**Sources:** https://sakana.ai/dgm/, https://arxiv.org/abs/2505.22954, https://github.com/jennyzzt/dgm

### 2.6 Cursor — Composer 2 + Background Agents

**Status (May 2026):** Composer 2 released Mar 19 2026 (CursorBench 61.3 vs 44.2 v1.5). Background Agents GA, parallelism up to 8 per user. Feb 2026 "Cloud Agents with Computer Use" added per-agent VM with browser + video recording.
**Pricing:** Pro $20/mo (incl $20 credits), Pro+ $60/mo (3x usage), Ultra $200/mo (20x), Business $40/seat. Composer 2 token rates: $0.50/M in, $2.50/M out (standard) / $1.50 + $7.50 (fast).
**Distribution:** Cursor IDE (VS Code fork) + cloud VMs for Background Agent.
**Safety:** Cursor shipped formal sandboxing on macOS/Linux/Windows (Seatbelt on macOS, others); Background Agents in isolated Ubuntu VMs with branch isolation; "sandboxed agents stop 40% less often" per Cursor blog. Approval-gated egress.
**Audience:** Individual devs and teams using Cursor as their primary IDE.
**vs cortex-x:** Cursor's Background Agent is the closest "I run while you sleep" peer **inside an IDE workflow**. cortex-x doesn't bind to an IDE — it's a cron job. Cursor's price floor ($20/mo + overage) and IDE-tether are the structural differences.
**Sources:** https://cursor.com/blog/agent-sandboxing, https://www.morphllm.com/cursor-background-agents

### 2.7 Aider (representative OSS autonomous mode)

**Status (May 2026):** Stable. v2.0+ ships Agent mode + Navigator mode + Architect/Editor split + Watch mode (file-comment trigger).
**Pricing:** Free Apache-2.0; you pay your LLM provider (~$0.007/file; $0.01–$0.10 per feature on cheap models).
**Distribution:** Python CLI, terminal-native, model-agnostic.
**Safety:** Git-aware (auto-commit per change), but no spec verifier, no multi-window USD cap, no halt-check killswitch.
**Audience:** Terminal-first solo devs; cost-sensitive AI coders.
**vs cortex-x:** Aider is the **closest philosophical neighbor** — OSS, terminal, BYO-LLM, cheap. cortex-x extends Aider's posture with **production-grade safety mechanics that Aider intentionally doesn't ship**: per-kind acceptance criteria, atomic-pipeline rollback, cross-session loop detection, capability palette beyond pure code-edit (doc_drift, dep_update_patch, secret_history_sweep, senior_tester_review). Aider is a chat-edit loop with cron capability; cortex-x is a maintenance autopilot with a chat-edit step inside it.
**Sources:** https://aider.chat/docs/usage/modes.html, https://aider.chat/docs/

## 3. Comparison matrix

| Feature | Devin | GH Copilot CA | Replit Agent | Cursor BG Agent | Sakana DGM | OpenClaw | Aider | **cortex-x Steward** |
|---|---|---|---|---|---|---|---|---|
| Self-host (operator infra) | ❌ | ❌ | ❌ | ⚠️ local IDE only | ✅ | ✅ | ✅ | ✅ |
| Atomic-rollback pipeline | ⚠️ session VM | ⚠️ PR-level | ⚠️ checkpoint | ⚠️ branch | ❌ | ❌ | ⚠️ git-only | ✅ per-action |
| Cron-driven unattended runs | ❌ (interactive) | ⚠️ via Actions cron | ❌ | ⚠️ manual trigger | ❌ research | ✅ | ⚠️ via OS cron | ✅ first-class |
| Multi-window USD cap (D/W/M) | ❌ ACU budget only | ❌ credit pool | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-session loop detection | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 5x/7d |
| Per-kind spec verifier | ❌ | ❌ | ❌ | ❌ | ⚠️ benchmark gate | ❌ | ❌ | ✅ 5 criterion kinds |
| File-based killswitch | ❌ | ⚠️ revoke token | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ STEWARD_HALT |
| "Senior tester" review pass | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ monthly cap |
| Open-source license | ❌ | ❌ | ❌ | ❌ | ✅ research code | ✅ | ✅ Apache-2 | ⚠️ PolyForm Noncommercial |
| Typical operator cost / run | ~$2/15min | credit-debited | $0.25/ckpt | $0.50–7.50/Mtok | model bill | model bill | ~$0.01/file | **~$0.0008/run** |
| Marketplace dashboard / UI | ✅ web | ✅ GitHub | ✅ web | ✅ IDE | ❌ | ⚠️ chat surfaces | ❌ | ❌ (CLI + journal only) |
| Target audience | Mid-market eng | GitHub orgs | Builders | IDE-first devs | Researchers | Hobbyists | Terminal solo | **Operator w/ many repos** |

Legend: ✅ shipped & first-class; ⚠️ partial / via workaround; ❌ absent.

## 4. Honest weaknesses of cortex-x

1. **Closed beta, dogfooding only.** Every other tool in the matrix has paying users; cortex-x has the operator. Until public flip happens (post-Sprint 4.7 launch plan), trust signal is weak.
2. **No GUI / dashboard.** Cursor, Replit, Devin, GitHub all have polished consoles. cortex-x ships a status CLI + a journal file. The BIOS-style dashboard idea is parked at Tier 3 Sprint 4.5.
3. **No SaaS option.** That's a deliberate posture, but it means anyone who wants "click-install, billing handled" walks past cortex-x.
4. **Anthropic/OpenRouter shape lock-in (today).** Engine seam exists (mock/openrouter/claude-sdk/claude-cli), but spec verifier + edit-ops format implicitly assume Claude-style structured output. Multi-provider parity is roadmap-only.
5. **License is PolyForm Noncommercial.** OSS purists who want Apache/MIT (Aider, OpenClaw) get a stricter contract. Commercial use needs separate arrangement.
6. **Capability palette is opinionated, not extensible from outside.** Devin/Cursor/OpenClaw have plugin/skill marketplaces (ClawHub: 5.7K skills). cortex-x's 15 action_kinds are curated by the operator, not open-marketplace.
7. **No browser/computer-use.** Cursor Cloud Agents (Feb 2026) and Devin's parallel sessions can drive a UI to verify changes visually. cortex-x is text-and-test-suite only.
8. **Tier-1 verification depth is excellent; benchmark numbers are absent.** DGM publishes SWE-bench 20→50%; cortex-x has no public eval suite scorecard yet (Sprint 2.11.2 is still research). Reviewer may ask "where are your numbers."

## 5. The differentiator that survives scrutiny

**Multi-window cost safety + atomic-rollback maintenance autopilot for operator-owned repos at <$0.001/run.** Every competitor either (a) charges per quarter-hour of agent time at minimum $20/mo floor, or (b) is open-source but lacks the pipeline safety primitives, or (c) is research code without production discipline. cortex-x's combination of `STEWARD_DAILY_USD_CAP` + `STEWARD_WEEKLY_USD_CAP` + `STEWARD_MONTHLY_USD_CAP` + `STEWARD_TOKEN_VELOCITY_CAP` + cross-session loop detector + spec-verifier + atomic git rollback is, as of this research sweep, **not co-occurring in any other shipped tool**.

## 6. Sources

- [Devin Pricing](https://devin.ai/pricing/)
- [Devin Security](https://devin.ai/security)
- [Cognition $25B valuation report (Idlen / Bloomberg cite)](https://www.idlen.io/news/cognition-devin-25-billion-valuation-windsurf-vibe-coding-april-2026/)
- [GitHub Copilot Plans & Pricing](https://github.com/features/copilot/plans)
- [About GitHub Copilot cloud agent](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent)
- [GitHub Copilot firewall reference](https://docs.github.com/en/copilot/reference/copilot-allowlist-reference)
- [Customizing the Copilot cloud agent firewall](https://docs.github.com/copilot/customizing-copilot/customizing-or-disabling-the-firewall-for-copilot-coding-agent)
- [GitHub usage-based billing announcement](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)
- [Schedule GitHub Coding Agents with Copilot CLI + Actions](https://luke.geek.nz/azure/schedule-github-coding-agents/)
- [Replit Pricing](https://replit.com/pricing)
- [Replit effort-based pricing](https://blog.replit.com/effort-based-pricing)
- [Sakana DGM](https://sakana.ai/dgm/)
- [Darwin Gödel Machine paper (arXiv 2505.22954)](https://arxiv.org/abs/2505.22954)
- [jennyzzt/dgm reference implementation](https://github.com/jennyzzt/dgm)
- [Cursor agent sandboxing post](https://cursor.com/blog/agent-sandboxing)
- [Cursor Background Agents complete guide](https://www.morphllm.com/cursor-background-agents)
- [Cursor 2.0 agent-first architecture](https://www.digitalapplied.com/blog/cursor-2-0-agent-first-architecture-guide)
- [OpenClaw home](https://openclaw.ai/)
- [ClaudeClaw GitHub](https://github.com/moazbuilds/claudeclaw)
- [OpenClaude / Claw Code GitHub](https://github.com/Gitlawb/openclaude)
- [Aider chat modes](https://aider.chat/docs/usage/modes.html)
- [Aider docs](https://aider.chat/docs/)
- [Sweep AI](https://sweep.dev/)
- [Sweep AI YC profile](https://www.ycombinator.com/companies/sweep)
- [NousResearch Hermes Agent (cron self-host reference)](https://github.com/nousresearch/hermes-agent)
