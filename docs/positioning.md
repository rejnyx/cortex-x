# Positioning — cortex-x in the autonomous-coding landscape (May 2026)

> The tools that materially do "AI ships code without me watching." Where cortex-x sits, what survives competitive scrutiny, what it isn't.

This is the launch-readiness companion to [`docs/positioning-vs-ralph.md`](./positioning-vs-ralph.md). Ralph is the philosophical ancestor; the tools below are the production peers.

**Refresh history**: drafted 2026-05-10, brain-kit memory lens added 2026-05-13 morning (Sprint 2.20), **landscape refresh 2026-05-13 evening (Sprint LR.X)** after operator-driven web research caught three material deltas: OpenClaw's April 2026 pivot into vertical code-maintenance, Block Goose shipping `goose serve` + Recipe cron, OpenHands RFC #13275 cron primitive. Pricing for Devin / Replit / Cursor refreshed against current public pricing pages.

## The market in May 2026 — four quadrants (refreshed 2026-05-13)

The autonomous-coding category has stabilized into four rough shapes:

1. **Hosted SaaS junior engineers** — Devin, Replit Agent, Cursor Background Agent, GitHub Copilot Coding Agent. You hand them a task; they run on the vendor's infra; pricing is metered usage or per-checkpoint at $20+/mo floor.
2. **Open-source vertical code-maintenance agents** *(new quadrant 2026-05-13 — previously merged into OSS-IDE-tethered)* — **OpenClaw** (April 2026 pivot to "Fix Bugs and Open PRs While You Sleep" — HEARTBEAT.md cron, dep-update PRs, issue→PR pipeline; **direct positional overlap with cortex-x Steward**), **Block Goose** (Apache-2.0, `goose serve` background mode + Recipe cron), **OpenHands** (MIT core + enterprise paywall after 1 month, cron via RFC #13275 March 2026).
3. **Open-source IDE-tethered tools** — Aider, Cline, OpenCode (147K stars, 4.5× Claude Code velocity), Continue.dev (now async CLI via `cn -p` headless). BYO-LLM, run from terminal or IDE, free except for model bills.
4. **Self-improvement research** — Sakana Darwin Gödel Machine. Population-based agent evolution, SWE-bench 20% → 50% via self-rewrite. Research code, not maintenance autopilot.

cortex-x is in **quadrant 2** but sits in a slot none of the other quadrant-2 entries fully occupy: **self-hosted, zero-deps CJS, cron-driven, atomic-rollback maintenance autopilot with full safety stack (multi-window USD caps + cross-session loop detector + STEWARD_HALT killswitch + 6-kind spec verifier) for an operator's existing repos under Apache 2.0**.

## One-sentence positioning

> *"The production-grade descendant of the Ralph pattern — multi-window cost safety + atomic-rollback maintenance autopilot for operator-owned repos at <$0.001/run, with spec verifier + cross-session loop detector + per-kind acceptance criteria that no shipped competitor co-ships."*

The cost gap to SaaS peers is roughly **3 orders of magnitude per task** — Devin's $2.25/ACU (~15 min) vs cortex-x's ~$0.0008/run via OpenRouter + DeepSeek V4 Flash. That gap exists because cortex-x runs on operator infra; the operator owns the cost ceiling.

## Comparison matrix (refreshed 2026-05-13)

| Feature | Devin | GH Copilot CA | Replit Agent | Cursor BG | Sakana DGM | **OpenClaw** | Goose | OpenHands | Aider | **cortex-x Steward** |
|---|---|---|---|---|---|---|---|---|---|---|
| Self-host (operator infra) | ❌ | ❌ | ❌ | ⚠️ local IDE | ✅ | ✅ | ✅ | ⚠️ MIT core, enterprise paid | ✅ | ✅ |
| Atomic-rollback pipeline | ⚠️ session VM | ⚠️ PR-level | ⚠️ checkpoint | ⚠️ branch | ❌ | ⚠️ test-gated, no rollback frame | ⚠️ recipe-level | ⚠️ task-level | ⚠️ git-only | ✅ per-action |
| Cron-driven unattended runs | ❌ | ⚠️ via Actions cron | ❌ | ⚠️ manual | ❌ research | ✅ HEARTBEAT.md | ✅ Recipe cron | ✅ RFC #13275 (Mar '26) | ⚠️ via OS cron | ✅ first-class |
| Multi-window USD cap (D/W/M) | ❌ ACU budget | ❌ credit pool | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-session loop detection | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 5x/7d |
| Per-kind spec verifier | ❌ | ❌ | ❌ | ❌ | ⚠️ benchmark gate | ❌ | ❌ | ❌ | ❌ | ✅ 6 criterion kinds |
| File-based killswitch | ❌ | ⚠️ revoke token | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ STEWARD_HALT |
| Token-velocity cap | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 50K/5min |
| "Senior tester" monthly review | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ monthly cron |
| 6-agent parallel review pipeline | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Open-source license | ❌ | ❌ | ❌ | ❌ | ✅ research | ✅ Apache-2 | ✅ Apache-2 | ⚠️ MIT+paid | ✅ Apache-2 | ✅ Apache-2 |
| Zero npm/pip deps | n/a | n/a | n/a | n/a | n/a | ❌ framework + plugins | ❌ Rust + plugins | ❌ Python + frontend | ⚠️ npm/pip | ✅ zero-deps CJS |
| Typical operator cost / run | metered (Pro/Max/Teams) | credit-debited | Effort-Based Pricing | $0.50–7.50/Mtok | model bill | model bill | model bill | model bill | ~$0.01/file | **~$0.0008/run** |
| Marketplace / dashboard | ✅ web | ✅ GitHub | ✅ web | ✅ IDE | ❌ | ✅ ClawHub (5.7K skills) | ⚠️ recipes | ⚠️ web UI | ❌ | ⏳ Sprint 4.8 |
| Target audience | Mid-market eng | GitHub orgs | Builders | IDE-first devs | Researchers | Hobbyist + dev | Block-style devs | Devin alternative | Terminal solo | **Operator w/ many repos** |

Legend: ✅ shipped & first-class · ⚠️ partial / via workaround · ❌ absent · ⏳ planned/deferred.

**Quick-read**: OpenClaw, Goose, OpenHands all check ✅ on **cron-driven unattended** and **self-host**. None of them check ✅ on **multi-window USD cap**, **cross-session loop detection**, **token-velocity cap**, **per-kind spec verifier**, **STEWARD_HALT killswitch**, **6-agent parallel review pipeline**, or **zero-deps**. **That 7-row gap is the cortex-x moat**.

## Per-competitor short profiles

### Devin (Cognition AI) — the hosted-junior-engineer category leader

**Status:** $25B valuation reported Apr 2026. Parallel-Devin sessions (Feb 2026) shipped. ARR doubled. **Pricing structurally changed mid-May 2026** — old Core/Team plans retired.
**Pricing (refreshed 2026-05-13):** New self-serve ladder — Free / Pro / Max / Teams / Enterprise. Usage shifted from ACU-fixed-quantity to USD-metered overage. "Ask Devin" + "Devin Review" (previously free) now metered. Teams entry-point lowered vs old $500/mo Team plan.
**Safety:** Ephemeral isolated VM per session, default-deny network egress with allowlist, secrets scoped per session, six explicit risk-config knobs.
**Why cortex-x doesn't try:** Devin owns "junior teammate that closes Linear tickets." cortex-x sits on operator infra, never sees code outside that machine, runs at <$0.01/run rather than usage-metered SaaS pricing. Different shape, different buyer.
**Sources:** [new self-serve plans (2026-05)](https://cognition.ai/blog/new-self-serve-plans-for-devin), [pricing page](https://devin.ai/pricing/), [security](https://devin.ai/security)

### GitHub Copilot Coding Agent — closest scheduled-maintenance peer

**Status:** GA on Pro/Pro+/Business/Enterprise. Org firewall settings shipped Apr 2026.
**Pricing:** Pro $10/mo, Pro+ $39/mo, Business $19/seat, Enterprise $39/seat. Usage-based billing transitioning Jun 1 2026.
**Safety:** Built-in agent firewall (allowlist, default-on); ephemeral cloud sandbox VM per task. **Documented limitation:** firewall does NOT apply to MCP servers or setup steps.
**vs cortex-x:** GitHub Coding Agent is the closest "scheduled maintenance" peer — Actions cron can drive the Copilot CLI. But every task burns AI Credits (not free unattended), is locked to GitHub, and lacks per-kind spec verifiers + multi-window USD caps. cortex-x's audit trail lives in operator-owned `cortex/journal/`, not GitHub Actions logs.
**Sources:** [coding-agent docs](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent), [firewall reference](https://docs.github.com/en/copilot/reference/copilot-allowlist-reference), [usage-billing announcement](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)

### Replit Agent — different category (build-and-deploy-from-scratch)

**Status:** Replit Agent 3 GA. **Pricing model swapped Q2 2026.**
**Pricing (refreshed 2026-05-13):** Effort-Based Pricing replaces old $0.25/checkpoint model — new users immediate, Core/Teams rollout starts July 1 2026. Plans unchanged ($25 Core / $40/seat Teams / Enterprise).
**vs cortex-x:** Replit owns "build-and-deploy app from scratch in cloud." cortex-x maintains operator-owned existing repos that ship to operator's existing CI/host. Adjacent, not competing.
**Sources:** [Effort-Based Pricing](https://blog.replit.com/effort-based-pricing), [pricing](https://replit.com/pricing)

### Cursor Composer 2 + Background Agents — closest IDE-tethered "while-you-sleep" peer

**Status:** Composer 2 released Mar 19 2026 (CursorBench 61.3 vs 44.2 v1.5). Background Agents GA, parallelism up to 8/user. Cloud Agents with Computer Use shipped Feb 2026 — per-agent VM + browser + video recording. Composer 2 input pricing dropped 86% to $0.50/M tokens.
**Pricing (refreshed 2026-05-13):** 5-tier ladder — Hobby $0 / Pro $20 / Pro+ $60 / Ultra $200 / Teams $40/seat. Background Agents bill against same metered pool as in-editor Composer.
**Safety:** Formal sandboxing on macOS/Linux/Windows (Seatbelt on macOS); Background Agents in isolated Ubuntu VMs with branch isolation; approval-gated egress.
**vs cortex-x:** Closest "I run while you sleep" peer **inside an IDE workflow**. cortex-x doesn't bind to an IDE — it's a cron job. Cursor's $20/mo + overage floor and IDE tether are the structural differences.
**Sources:** [Composer 2 pricing analysis](https://www.vantage.sh/blog/cursor-composer-2), [pricing](https://cursor.com/pricing), [agent sandboxing](https://cursor.com/blog/agent-sandboxing), [Background Agents guide](https://www.morphllm.com/cursor-background-agents)

### Sakana Darwin Gödel Machine — different problem (evolve the agent itself)

**Status:** Research artifact (arXiv 2505.22954, Mar 2026 update). Reference impl `jennyzzt/dgm` on GitHub.
**Pricing:** Free OSS; runs against any LLM API.
**Performance:** SWE-bench 20.0% → 50.0% via self-modification; Polyglot 14.2% → 30.7%.
**Safety:** Authors explicitly warn it executes untrusted model-generated code; sandboxing + human oversight required during experiments. **Not designed for unattended production.**
**vs cortex-x:** DGM is "evolve the agent itself"; cortex-x is "evolve the operator's repos under invariants." Likely **borrow** DGM-style fitness/lineage ideas (already on Tier 2 roadmap re: AlphaEvolve), not compete.
**Sources:** [DGM page](https://sakana.ai/dgm/), [arXiv 2505.22954](https://arxiv.org/abs/2505.22954), [reference impl](https://github.com/jennyzzt/dgm)

### OpenClaw — **PRIMARY DIRECT COMPETITOR** (April 2026 pivot from horizontal to vertical-code)

**Status (refreshed 2026-05-13)**: OpenClaw (Peter Steinberger's Nov 2025 weekend project) hit 60K stars in 72h after Jan 2026 viral moment. **April 2026 update repositioned from horizontal personal-assistant into vertical code-maintenance**: explicit pitch *"Fix Bugs and Open PRs While You Sleep"*. April release added TaskFlow Orchestration Layer + Memory Wiki with provenance labels + Codex OAuth-over-HTTP route + model routing across Claude/GPT-5.5/Gemini/DeepSeek/Ollama/Gemma 4 + Slack/Telegram/Discord/Teams/Matrix channel maturity.
**Pricing:** Free (Apache-2.0). Self-host CLI + plugin ecosystem ("ClawHub" 5,700+ skills).
**Code-maintenance features (per official blink.new pitch)**: HEARTBEAT.md scheduled tasks · "check for assigned issues every morning, attempt fix, open PR" · "Monday dep-update PR if tests pass" · branch + commit + PR + issue + comment GitHub integration · PR-only safety model ("never commits to main") · unit test generation · PR review with comments.
**vs cortex-x — what overlaps**: both self-host, both Apache-2.0, both cron-driven, both PR-only safety, both BYO-LLM, both pitch "while you sleep." Memory layer is **architectural twin** — markdown SSOT + SQLite + semantic search + zero external API.
**vs cortex-x — what cortex-x has that OpenClaw doesn't (per matrix above + April 2026 article scan)**:
- Multi-window USD cap (D/W/M) + token-velocity cap
- Cross-session loop detector (5x/7d → halt)
- Per-kind spec verifier (6 criterion kinds)
- File-based `STEWARD_HALT` killswitch (operator-only clear)
- "Senior tester" monthly review cron
- 6-agent parallel review pipeline (acceptance + blind + correctness + security + ssot + edge-case)
- Self-invocation tracker (max-depth + wall-clock + dedup + cost gate)
- Zero-deps CJS (OpenClaw is framework + plugin ecosystem)
- Atomic-rollback pipeline framing (OpenClaw tests-pass-then-PR, no explicit rollback)

**vs cortex-x — what OpenClaw has that cortex-x doesn't**:
- 60K stars (vs 0)
- ClawHub marketplace (5.7K skills)
- Multi-channel chat integration (Slack/Telegram/Discord/Teams/Matrix)
- Multiple memory backends (LanceDB / Honcho / QMD sidecar / Memory Wiki)
- TaskFlow Orchestration Layer with durable multi-step state recovery
- OAuth-over-HTTP route for paid ChatGPT subscriptions (cortex-x has claude-cli engine which is conceptually equivalent for Anthropic Max sub)

**Verdict**: cortex-x is **narrower but deeper-in-safety** than OpenClaw. The marketing battle for "open-source PR-while-you-sleep agent" is OpenClaw's to lose — they have the star momentum. cortex-x's lane is **the production-grade safety stack** — anyone running unattended maintenance on a portfolio of long-lived repos who has been burned by a runaway agent (USD overrun, infinite loop, spurious commit) is the cortex-x buyer.

**Sources:** [openclaw.ai](https://openclaw.ai/), [April 2026 update — MindStudio](https://www.mindstudio.ai/blog/openclaw-april-2026-update-new-features-agentic-runtime), [blink.new code-maintenance pitch](https://blink.new/blog/openclaw-autonomous-coding-agent), [OpenClaw memory architecture](https://docs.openclaw.ai/concepts/memory), [memory masterclass](https://velvetshark.com/openclaw-memory-masterclass)

### Block Codename Goose — Apache-2.0 license twin, different runtime shape (NEW 2026-05-13)

**Status:** Open-sourced by Block in 2024, 29K stars, donated to Linux Foundation AAIF. **`goose serve` background mode + Recipes shipped Q1 2026 with cron support** — this is the strongest license-overlap competitor.
**Pricing:** Free (Apache-2.0). BYO-LLM.
**Safety:** CLI/desktop-grade — no atomic-rollback framing, no USD caps, no halt killswitch. Recipes can be scheduled via cron expressions for unattended workflows.
**vs cortex-x:** Same license (Apache-2.0), same self-host posture, same Apache-2 + Linux Foundation governance trajectory. **Different shape**: Goose is CLI/desktop-first, the cron support is task-runner-grade, **not GHA-cron-PR-on-operator-infra** like cortex-x. Goose is more general-purpose; cortex-x is narrowly maintenance-of-code-repos with PR-only commits. If your unattended task is *"run a recipe once a day to summarize Slack"* — Goose wins. If it's *"open dep-update PR with $5/day USD cap, atomic rollback on test failure, halt killswitch"* — cortex-x wins.
**Sources:** [Block announcement](https://block.xyz/inside/block-open-source-introduces-codename-goose), [docs](https://block-goose.mintlify.app/), [review](https://www.openaitoolshub.org/en/blog/goose-ai-agent-block-review)

### OpenHands (formerly OpenDevin) — cron-via-RFC, license-trap caveat (NEW 2026-05-13)

**Status:** Active dev through OpenHands 1.5.0 / openhands-ai 1.6.0 (PyPI Mar 30 2026). **RFC #13275 (March 2026) added cron-trigger automations**; CLI runs headlessly in CI/cron.
**License caveat:** Core repo is **MIT**, but `enterprise/` directory is **source-available with paid license required after 1 month** of revenue or external use. This makes "I'll self-host OpenHands and use it commercially" non-trivially expensive at scale.
**Pricing:** Free core + paid enterprise tier above threshold.
**vs cortex-x:** OpenHands has cron support and is self-host-capable, but the enterprise paywall + cloud-first design (Docker + frontend + browser UI) is heavier than cortex-x's zero-deps CJS. cortex-x has stricter safety (atomic rollback, multi-window USD caps, halt killswitch); OpenHands has wider language support + computer-use + browser automation. Different bets.
**Sources:** [OpenHands releases](https://github.com/OpenHands/OpenHands/releases), [RFC #13275](https://github.com/OpenHands/OpenHands/issues/13275), [self-hosted update March 2026](https://openhands.dev/blog/openhands-product-update---march-2026)

### Aider — closest philosophical neighbor

**Status:** Stable. v2.0+ ships Agent mode + Navigator mode + Architect/Editor split + Watch mode (file-comment trigger).
**Pricing:** Free Apache-2.0; you pay your LLM provider (~$0.007/file).
**Safety:** Git-aware (auto-commit per change), but no spec verifier, no multi-window USD cap, no halt-check killswitch.
**vs cortex-x:** Closest philosophical neighbor — OSS, terminal, BYO-LLM, cheap. cortex-x extends Aider's posture with **production-grade safety mechanics that Aider intentionally doesn't ship**: per-kind acceptance criteria, atomic-pipeline rollback, cross-session loop detection, capability palette beyond pure code-edit (doc_drift, dep_update_patch, secret_history_sweep, senior_tester_review, workflow_hardener, ...). Aider is a chat-edit loop with cron capability; cortex-x is a maintenance autopilot with a chat-edit step inside it.
**Sources:** [chat modes](https://aider.chat/docs/usage/modes.html), [docs](https://aider.chat/docs/)

## Honest weaknesses of cortex-x

If a reviewer asks "where's the catch," the answer is one of these:

1. **Fresh public preview, single-operator dogfooding.** Every other tool in the matrix has paying users; cortex-x has the operator + early adopters from launch day. 0★ on day 1 is structural, not a quality signal.
2. **No GUI / dashboard.** Cursor / Replit / Devin / GitHub all have polished consoles. cortex-x ships a status CLI + a journal file. The BIOS-style dashboard is parked at Tier 3 Sprint 4.5.
3. **No SaaS option.** Deliberate posture, but it means anyone who wants "click-install, billing handled" walks past cortex-x.
4. **Anthropic / OpenRouter shape lock-in (today).** Engine seam exists (mock / openrouter / claude-sdk / claude-cli), but spec verifier + edit-ops format implicitly assume Claude-style structured output. Multi-provider parity is roadmap-only.
5. **License is Apache 2.0** (relicensed 2026-05-12 from PolyForm Noncommercial pre-public-launch). Permissive commercial use + patent grant; CLA model still operator-only — external PRs land under inbound-equals-outbound until governance scales.
6. **Capability palette is opinionated, not extensible from outside.** Devin/Cursor/OpenClaw have plugin/skill marketplaces (ClawHub: 5.7K skills). cortex-x's 15 action_kinds are curated by the operator, not open-marketplace.
7. **No browser/computer-use.** Cursor Cloud Agents (Feb 2026) and Devin's parallel sessions can drive a UI to verify changes visually. cortex-x is text-and-test-suite only.
8. **Public benchmark numbers are absent.** DGM publishes SWE-bench 20→50%; cortex-x has eval rubrics ([`evals/eval-001`–`010`](../evals/)) but no public scorecard yet (Sprint LR.1 — `evals/results/2026-MM-DD-real-baseline.json` is the closing gate).

## The differentiator that survives scrutiny

**Multi-window cost safety + atomic-rollback maintenance autopilot for operator-owned repos at <$0.001/run.**

Every competitor either (a) charges per quarter-hour of agent time at minimum $20/mo floor, or (b) is open-source but lacks the pipeline safety primitives, or (c) is research code without production discipline. cortex-x's combination of:

- `STEWARD_DAILY_USD_CAP` ($5 default in shipped workflows; $10 documented ceiling) + `STEWARD_WEEKLY_USD_CAP` ($25) + `STEWARD_MONTHLY_USD_CAP` ($80)
- `STEWARD_TOKEN_VELOCITY_CAP` (50K tokens / 5 min)
- Cross-session loop detector (5x same criterion in 7d → halt)
- Intra-run StuckLoopDetection (3 patterns, threshold 3)
- Self-invocation tracker (4 hard guardrails: max-depth=3, wall-clock=30min, dedup-window=3, cost gate)
- Per-kind spec verifier (6 criterion kinds: shell / file_predicate / regex / ears_text / llm_judge / read_set)
- Atomic git rollback (branch → LLM apply → spec gate → npm test → commit → push → draft PR; rollback on any failure)
- File-based killswitch (`STEWARD_HALT` sentinel; operator-cleared, never agent-cleared)

… is, as of this 2026-05-10 research sweep, **not co-occurring in any other shipped tool**.

## When to use which

- **Use Devin** if you need a hosted junior engineer that closes Linear tickets and your team is enterprise-shaped.
- **Use GitHub Copilot Coding Agent** if your repos already live on GitHub and you want one console for everything.
- **Use Replit Agent** if you're building from scratch and want IDE + host + agent in one place.
- **Use Cursor Background Agent** if Cursor IS your IDE and you want sleep-while-it-runs inside that workflow.
- **Use Aider** if you want a terminal-first, single-file-iteration loop with full git transparency.
- **Use OpenClaw** if you want the largest-community-of-the-moment open-source agent with the broadest skill ecosystem (ClawHub), and you accept the safety-stack gap (no USD caps, no halt killswitch, no spec verifier, no atomic-rollback framing). Best for solo devs + hobbyists who value momentum over safety floor.
- **Use Block Goose** if you want CLI/desktop-style scheduled tasks under Apache-2.0 with the Block + Linux Foundation governance brand, and your scheduled tasks are not specifically GitHub-PR-driven.
- **Use OpenHands** if you need wider language coverage + computer-use + browser automation, you're staying below their enterprise paywall threshold, and the cloud-first stack (Docker + frontend) is fine for you.
- **Use Sakana DGM** if you're doing self-improvement research, not production.
- **Use cortex-x Steward** if you have multiple long-lived repos, an OpenRouter key (or Anthropic Max sub), a strong "no SaaS for my git history" preference, and you want unsupervised overnight maintenance with atomic rollback + multi-window cost caps + audit trail in your own files. **Defining buyer profile**: an operator who has been burned by a runaway agent (USD overrun, infinite loop, spurious commit) and wants the production-grade safety stack as a hard floor.

## Second lens — vs agent-memory systems (Sprint 2.20, 2026-05-13)

The brain-kit / Claude Code Memory category is a second axis where reviewers compare cortex-x. cortex-x is **adjacent** to memory-SaaS, not competing — but reviewers will ask "vs Mem0 / Zep / Letta / MAF+Neo4j" and the answer needs to exist.

> *Note: this matrix drops the autonomous-coding peers (Devin, GH Copilot CA, Replit Agent, Cursor BG, Sakana DGM, Aider) covered in §"Comparison matrix" above, and replaces them with memory-category peers. Different lens, same artifact. Refreshed 2026-05-13 evening — added Memori Labs (2026-05-07 launch).*

| Feature | Mem0 | Zep / Graphiti | Letta | MAF + Neo4j | OpenClaw Dreaming | Anthropic Auto Dream | Memori Labs | **cortex-x Steward** |
|---|---|---|---|---|---|---|---|---|
| Persistent KV memory | ✅ vector | ✅ temporal graph | ✅ durable state | ✅ KG provider | ✅ daily cron | ✅ native primitive | ✅ trace-derived | ✅ MEMORY.md + `~/.cortex` |
| Structured KG / entity relationships | ⚠️ partial | ✅ Graphiti core | ❌ | ✅ Neo4j first-party | ⚠️ flat | ❌ | ⚠️ from traces | ⏸️ Sprint 3.3 deferred |
| Temporal-graph memory | ❌ | ✅ winner LongMemEval (63.8%) | ❌ | ✅ via Neo4j | ❌ | ❌ | ⚠️ ordered traces | ❌ |
| Nightly consolidation ("Dreaming" / "Auto Dream") | ❌ | ❌ | ❌ | ❌ | ✅ default 3 AM cron | ✅ native | ❌ continuous | ✅ Sprint 2.19 v0+v1 shipped 2026-05-13 |
| LLM-validated consolidation pass | ❌ | ❌ | ❌ | ❌ | ⚠️ optional | ❌ | ❌ | ✅ Sprint 2.19 v1 (weekly Sonnet) |
| MCP-native | ✅ | ✅ | ⚠️ partial | ✅ | ✅ via OpenClaw | ✅ via Claude Code | ⚠️ early | ⚠️ skills, no MCP server yet |
| Atomic-rollback on bad memory write | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ via Steward execute |
| Multi-window USD caps (D/W/M) | ❌ tier cap only | ❌ | ❌ | ❌ vendor billing | ❌ | ❌ | ❌ | ✅ |
| Draft-PR human approval on memory mutation | ❌ | ❌ | ❌ | ❌ | ⚠️ optional | ❌ | ❌ | ✅ first-class |
| OSS license | Apache-2 | Apache-2 | Apache-2 | MIT (MAF), GPL (Neo4j CE) | Apache-2 | proprietary | proprietary | ✅ Apache-2 |
| Typical operator cost | $19–249/mo | $0–25/mo | model bill | Neo4j Aura $65+/mo | model bill | bundled in Claude Max | not disclosed | **~$0.0008 / run** |
| Stars / adoption | 47K★ | 5K★ Graphiti | 14K★ | MAF v1.0 GA Q1 2026 | 60K★ (Jan '26) | shipped 2026 | new (2026-05-07) | fresh public preview |
| Target | LLM apps needing recall | apps needing time-aware recall | OSS MemGPT successor | enterprise MAF users | personal-life automation | Claude Code users | LLM apps via agent traces | **operator w/ many repos doing maintenance** |

Legend: ✅ shipped & first-class · ⚠️ partial / via workaround · ❌ absent · ⏸️ planned/deferred.

**Verdict.** cortex-x's memory layer (MEMORY.md + `~/.cortex` library + Phase 5 dream-cycle, wiring in Sprint 2.19) is functionally similar to Mem0 / Auto Dream / OpenClaw Dreaming. **But that's not the lane.** cortex-x is *maintenance autopilot WITH a memory layer*, not *memory-SaaS for agents*. The differentiator stack — atomic-rollback Steward + spec verifier + multi-window USD caps + draft-PR approval + 9-agent review pipeline — has **zero co-occurrence** in any named memory system above. Use Mem0/Zep for "remembering your conversation across LLM apps." Use cortex-x for "maintaining 30 long-lived repos overnight while sleeping." Different shape, different buyer.

**Don't pivot.** Mem0 dominates with 47K★ + temporal-graph (Zep) wins benchmarks; entering memory-SaaS from behind is a losing fight. Stay in the maintenance-autopilot lane; the memory layer is *infrastructure for it*, not the product.

Sources for this lens: brain-kit landscape memo [`docs/research/brain-kit-landscape-2026-05-13.md`](./research/brain-kit-landscape-2026-05-13.md), [5-system agent-memory benchmark 2026](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3), [Microsoft Learn Neo4j Memory Provider](https://learn.microsoft.com/en-us/agent-framework/integrations/neo4j-memory), [OpenClaw Dreaming guide](https://dev.to/czmilo/openclaw-dreaming-guide-2026-background-memory-consolidation-for-ai-agents-585e), [Anthropic Auto Dream](https://claudefa.st/blog/guide/mechanics/auto-dream), [Memori Labs trace-derived memory launch (2026-05-07)](https://www.prweb.com/releases/memori-labs-releases-new-agent-native-memory-infrastructure-automatically-creating-structured-memory-from-agent-trace-302765715.html).

## Third lens — skill / capability marketplaces (NEW 2026-05-13)

The agent-skills.io ecosystem matured from 1 → 8 registries between Q4 2025 and Q2 2026, dominated by **Tessl**. Snyk's *ToxicSkills* audit (May 2026) found prompt injection in **36% of audited public skills** across these marketplaces — making skill curation a real safety problem. cortex-x's pre-curated 16-kind capability palette is **deliberately not marketplace-extensible** (operator-only authoring path) — that's a positioning trade-off:

- **Use Tessl / ClawHub / agent-skills.io marketplace** when you need breadth + community velocity, and you accept the 36% prompt-injection rate as your problem to filter.
- **Use cortex-x** when you need a small set of curated capabilities you can audit personally and you treat the marketplace's surface area as adversarial.

This positions cortex-x's **Sprint 4.0 capability marketplace** (deferred to Tier 3 productization) as a *signed-and-audited* marketplace — closer to the npm package-signing model than the bare git-pull-and-run that Tessl publishes today. **Don't ship Sprint 4.0 until the audit/signing infra is in place** — the cortex-x brand is "safety stack first," not "biggest marketplace."

Sources: [Tessl](https://tessl.io/), [agensi comparison](https://www.agensi.io/learn/best-ai-agent-skills-marketplaces-2026), [Snyk ToxicSkills](https://www.snyk.io/), agentskills.io spec.

## References

Research dispatch memo: [`docs/research/sprint-lr.6-competitive-landscape-research-2026-05-10.md`](./research/sprint-lr.6-competitive-landscape-research-2026-05-10.md) (25 cited URLs).

**2026-05-13 evening refresh dispatch**: 3 parallel general-purpose agents (autonomous coding deltas, memory-SaaS deltas, self-hosted cron-driven landscape). Findings synthesized in this doc; full output captured in commit message of `feat(sprint-lr.x): positioning refresh after 2026-05-13 landscape scan`.

Companion: [`docs/positioning-vs-ralph.md`](./positioning-vs-ralph.md) (philosophical ancestor framing).
