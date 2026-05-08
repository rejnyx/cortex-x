---
title: Sprint 2.0b R1 — Action-kind-based model routing (research memo)
status: research-only — informs implementation, not a commit
created: 2026-05-08
research_dispatched_by: cortex-x autonomous workflow per R1 principle
sprint: 2.0b
---

# Sprint 2.0b R1 — Action-kind-based model routing

## TL;DR

Drop the RouteLLM-style query-difficulty classifier. Route by `action_kind` directly — every cortex-x action carries a known role label by construction, so a learned classifier would be solving a problem we have already factored away. May 2026 SOTA in production agentic tooling (Augment Code, Anthropic multi-agent research, Claude Code, Cline, Hermes Agent) has converged on the same pattern: **role/task-type → model**, encoded as a small static table with cheap/balanced/premium/ensemble overrides.

For Sprint 2.0b, ship a 4-profile knob (`STEWARD_ROUTING_PROFILE=cheap|balanced|premium|ensemble`) with `balanced` as default. Concrete pairings recommended in the final section. The single LLM kind today (`recommendation`) stays on **DeepSeek V4 Flash** in `balanced`, with **Qwen3 Coder Flash** as the auto-fallback when DeepSeek's known JSON-fence quirk surfaces, and a **Haiku 4.5 → Sonnet 4.6 → Opus 4.7** ladder reserved for `premium`/future-`architecture_review`.

---

## 1. Q2 2026 model pricing + capability snapshot

Pricing is in USD per million tokens (input / output) on OpenRouter unless stated. All prices verified 2026-05-08.

### 1.1 Cheap tier (sub-$1/M output)

| Model | Input | Output | Context | JSON mode | Notes |
|---|---|---|---|---|---|
| **DeepSeek V4 Flash** | $0.14 | $0.28 | 1M | Yes (fence quirk via Anthropic provider; native DeepSeek clean) | 284B MoE / 13B active. Cortex-x default since Sprint 1.6.13. ~$0.0008/run dogfood. ([1][1], [2][2]) |
| **Qwen3 Coder Flash** | $0.195 | $0.975 | 1M | Yes, native | Alibaba's "coding agent" sibling to V4. June 2025 cutoff. Strong tool-call discipline. ([3][3]) |
| **Mistral Small 4** | $0.15 | $0.60 | — | Yes | Magistral reasoning + Devstral coding. Reliable JSON. ([4][4]) |
| **Gemini 3.1 Flash Lite Preview** | $0.25 | $1.50 | — | Yes (json_schema) | Cheapest Google entry. ([5][5]) |
| **Gemini 3 Flash Preview** | $0.50 | $3.00 | — | Yes | "Thinking" model for agentic workflows. Hermes Agent uses it as default for `title_generation`. ([6][6]) |
| **GLM-4.7** | $0.60 | $2.20 | — | Yes | Z.ai flagship; multi-step reasoning emphasized. ([7][7]) |
| **Kimi K2.6** | $0.75 | $3.50 | — | Yes | Long-horizon code, multi-agent orchestration. ([8][8]) |
| **GPT-5.4 Mini** | $0.75 | $4.50 | 1M | Yes (strict json_schema) | OpenAI's currently-priced mini. ([9][9]) |
| **Grok 4.20** | $1.25 | $2.50 | — | Yes | March 2026 release; xAI flagship-cheap. Less mature ecosystem. ([10][10]) |

**DeepSeek V4 Flash JSON reliability** — DeepSeek's own docs warn the model "can generate invalid JSON and may hallucinate parameters not defined in your function schema" for complex multi-tool orchestration; for single-action structured output (the recommendation kind today) it is reliable. ([2][2]) The cortex-x JSON-fence stripping (`stripJsonFences`, Sprint 1.6.16) already handles the Anthropic-via-OpenRouter quirk.

### 1.2 Balanced tier ($3-$5/M output)

| Model | Input | Output | Notes |
|---|---|---|---|
| **Claude Haiku 4.5** | $1.00 | $5.00 | 73.3% SWE-bench. Strong JSON, strong tool use. Default Anthropic "navigator" tier in Augment + Claude Code Explore agent. ([11][11], [12][12]) |
| **GPT-5.2** | $1.75 | $14.00 | 80% SWE-bench (with thinking). Augment Code's recommended **review** model. Higher output cost is the catch. ([11][11]) |

### 1.3 Premium tier

| Model | Input | Output | Notes |
|---|---|---|---|
| **Claude Sonnet 4.6** | $3.00 | $15.00 | 79.6% SWE-bench, 21% fewer tool calls than 4.5. Augment's "implementer." Anthropic's multi-agent research subagent model. ([11][11], [13][13]) |
| **GPT-5.4** | $2.50 | $15.00 | 75% computer-use, 1M context. ([14][14]) |
| **Grok 4** | $3.00 | $15.00 | ([10][10]) |
| **Claude Opus 4.7** | $5.00 | $25.00 | Augment's "coordinator." Anthropic multi-agent lead. **Caveat:** new tokenizer can produce up to 35% more tokens for the same input — real bill per request rises ~30% even though rate card is unchanged. ([15][15], [11][11]) |
| **Claude Opus 4.6** | $5.00 | $25.00 | Same rate card; lower token-overhead. Often the better choice over 4.7 until billing parity ships. ([11][11]) |
| **GPT-5.5** | $5.00 | $30.00 | Highest-quality OpenAI. ([16][16]) |
| **GPT-5.5 Pro** | $30.00 | $180.00 | Reserved for hardest reasoning; not a routine option. ([16][16]) |

### 1.4 New May-2026 entrants worth tracking

- **Gemini 3.1 Flash Lite Preview** — at $0.25/$1.50 it's the new cost floor with json_schema. Worth A/B vs DeepSeek V4 Flash for `recommendation`. ([5][5])
- **Mistral Small 4** — Devstral lineage means it's purpose-built for the "code edit" role; cheap enough to A/B in `cheap` profile. ([4][4])
- **Grok 4.20** — newer than the rest of this list (March 31, 2026); ecosystem maturity around tool-calling reliability is still thin. **Defer**.

---

## 2. Role-based routing patterns shipping in 2026

### 2.1 Augment Code (the canonical 2026 reference)

Augment publishes the most explicit role table of any vendor. Their April 2026 routing guide ([11][11]):

| Role | Model | Why |
|---|---|---|
| **Coordinator / Orchestration** | Claude Opus 4.6 | Decisions cascade; 1M context; manages dependencies |
| **Implementer / Code Generation** | Claude Sonnet 4.6 | 79.6% SWE-bench, 21% fewer tool calls, $3/MTok |
| **File Navigation / Quick Tasks** | Claude Haiku 4.5 | High-frequency retrieval; 5x cheaper input than Opus |
| **Code Review (Async)** | GPT-5.2 | Exhaustive tool use; cross-family bug-detection diversity |

Cost claim: 51% savings on a typical 104K input / 60K output session ($0.98 routed vs $2.02 uniform-Opus). MCP Atlas reasoning gap of 15.7 points justifies keeping Opus on the orchestrator slot. The named **failure modes** are reproduced in §4 below. ([11][11])

### 2.2 Anthropic multi-agent research

The deployed pattern: **Opus 4 lead + Sonnet 4 subagents** outperformed single-agent Opus 4 by **90.2%** on Anthropic's internal research eval. Subagents run in parallel with their own context windows, condensing findings up to the lead. Scaling rules embedded in prompts: simple fact-find = 1 agent + 3-10 tool calls; comparison = 2-4 subagents @ 10-15 calls each; complex research = 10+ subagents. ([13][13], [17][17])

Direct read-across to cortex-x: today's `recommendation` is roughly the "subagent" role (single-shot, structured output, low coordination). It deserves Sonnet-class quality at Haiku-class price — i.e. exactly what DeepSeek V4 Flash and Qwen3 Coder Flash offer in mid-2026.

### 2.3 NousResearch hermes-agent (the closest external analog)

The user prompt mentioned `cheap`/`fix`/`code`/`plan` modes; the **current** docs (May 2026, v0.11.0+) do not expose those names. The shipped UX is:

- **Main model** for the conversation (`/model gpt-5.4 --provider openrouter`), and
- **Eight auxiliary task slots** with per-task overrides, every slot defaulting to `auto` (= main model): `title_gen`, `vision`, `compression`, `session_search`, `approval`, `web_extract`, `skills_hub`, `mcp`. ([18][18])

The mode-name vocabulary (`plan`, `code`, `fix`, `cheap`) appears to come from earlier 0.x releases or community docs, not the current shipping docs. **The current Hermes pattern is closer to "auxiliary slots with per-task overrides" than "named modes"** — and that's a directly transplantable pattern for cortex-x's `action_kind`-keyed routing.

### 2.4 Claude Code (orchestrator-worker primitive)

- Subagent `model:` field accepts `sonnet`, `opus`, `haiku`, `inherit`, or a full ID.
- Plan defaults: Max/Team Premium → Opus 4.6; Pro/Team Standard → Sonnet 4.6; **built-in Explore agent always runs Haiku** for fast read-only codebase searches. ([19][19], [20][20])
- Issue #44976 ("Auto model routing by task type: plan → opus, code → sonnet, chat → haiku") is open, suggesting Anthropic itself has not yet automated what cortex-x is about to build. ([21][21])

### 2.5 Cline / Cursor / Composio

- **Cline:** model-agnostic, supports OpenRouter / Anthropic / OpenAI / Bedrock / Azure / Vertex / Cerebras / Groq / Ollama / LM Studio. No built-in routing — user chooses one model per session.
- **Cursor:** auto-mode picks frontier models within plan; internal routing is opaque. Heavy users report $40-50/mo overage spend. ([22][22])
- **Composio:** tool-integration framework; not a model router itself.

### 2.6 Karpathy compound-systems framing

Karpathy's 2026 writing emphasizes **agentic engineering** — orchestrating agents rather than writing code 99% of the time — and **AutoResearch** as a many-agent SETI@home pattern with cheap workers + smarter orchestrator. He has not published a specific role-table, but the framing is consistent with everything above: small, specialized, role-keyed agents > one giant model. ([23][23], [24][24])

---

## 3. Specific recommendations for cortex-x's 4 routing profiles

### 3.1 `cheap` profile

**Recommendation:** support it, keep it minimal.

8 of cortex-x's 9 action_kinds (`recommendation_harvest`, `dep_update_patch`, `flaky_test_repair`, `doc_drift`, `todo_triage`, `test_coverage_gap`, `lint_fix_shipper`, `pr_review_responder`) are deterministic and don't call an LLM today. So `cheap` only meaningfully affects the one LLM kind (`recommendation`).

**Pairing:**

- `recommendation` → **Gemini 3.1 Flash Lite Preview** ($0.25/$1.50) or stay on **DeepSeek V4 Flash** ($0.14/$0.28).

DeepSeek V4 Flash is already cheaper per token than Gemini 3.1 Flash Lite, so `cheap` may collapse to `balanced` for now. **Treat `cheap` as an override knob for the future `chat`/`title_gen`/auxiliary kinds that v0.7+ harvester executor will introduce, not as a primary daily driver.**

### 3.2 `balanced` profile (DEFAULT)

**Recommendation:** keep DeepSeek V4 Flash for `recommendation`, add Qwen3 Coder Flash as auto-fallback on JSON-validation failure.

- `recommendation` → **DeepSeek V4 Flash** primary, **Qwen3 Coder Flash** fallback.
- Future LLM kinds (when added): default everything to DeepSeek V4 Flash unless action_kind config overrides.

Rationale: DeepSeek V4 Flash is the price floor with acceptable JSON for single-action structured output; Qwen3 Coder Flash is purpose-built for the agent-coding role and ~3x more expensive but well within budget. The fallback ladder protects against the known "Anthropic-via-OpenRouter JSON fence" quirk and DeepSeek's documented hallucinated-parameter risk. ([2][2], [3][3])

### 3.3 `premium` profile

**Recommendation:** Sonnet 4.6 for `recommendation` and future `architecture_review`; Haiku 4.5 for high-volume sub-tasks; Opus only on explicit override.

- `recommendation` (premium) → **Claude Sonnet 4.6** ($3/$15).
- Future `architecture_review` → **Claude Sonnet 4.6** primary; **Opus 4.6** on `STEWARD_ROUTING_OVERRIDE=opus` (NOT 4.7 until tokenizer-overhead billing parity ships, see §1.2 caveat).
- Future `release_notes_drafter` → **Claude Haiku 4.5** ($1/$5). Generation, not reasoning — Haiku is correctly sized.
- **GPT-5.3** is not a current SKU (superseded by 5.4 in March 2026, 5.5 in 2026); use **GPT-5.4** at $2.50/$15 if cross-family diversity is wanted, or skip OpenAI entirely in premium.

Trade-off table for the architecture_review slot:

| Model | Input | Output | SWE-bench | When to pick |
|---|---|---|---|---|
| Sonnet 4.6 | $3 | $15 | 79.6% | Default; balanced reasoning + cost |
| GPT-5.4 | $2.50 | $15 | ~78% | Cross-family bug-finding; computer-use heavy |
| Opus 4.6 | $5 | $25 | 80.84% | Cascading-decision tasks, MCP orchestration |
| Opus 4.7 | $5 | $25 (effective ~$33) | 80.84% | **Skip** until token-overhead billing parity |

### 3.4 `ensemble` profile

**Recommendation:** Mixture-of-Agents with **3 cheap diverse models + 1 mid-tier judge**, gated by an explicit `STEWARD_ENSEMBLE=on` flag. Cost ceiling required.

Diversity research (LLM-TOPLA, MoA, "Wisdom and Delusion of LLM Ensembles for Code Generation") confirms the gain comes from **family diversity**, not raw model count. Pick one model from each major family. ([25][25], [26][26])

- **Worker 1:** DeepSeek V4 Flash ($0.14/$0.28) — DeepSeek family
- **Worker 2:** Qwen3 Coder Flash ($0.195/$0.975) — Alibaba/Qwen family
- **Worker 3:** Mistral Small 4 ($0.15/$0.60) — Mistral/Devstral family
- **Judge:** Claude Haiku 4.5 ($1/$5) — Anthropic family, cheap enough to use as voting tiebreaker; better tool-use discipline than the workers

**Cost ceiling:** ~$0.005/run (vs $0.0008/run for balanced) — 6x balanced. Hard-cap via `STEWARD_ENSEMBLE_USD_CAP=0.01` to prevent runaway. The MoA paper showed 65.1% AlpacaEval 2.0 win rate beating GPT-4's 57.5% — diversity beats single-model frontier when problem is "soft" (taste, recommendation), but for "hard" structured output (code edit JSON plan) the gain is smaller. **Ensemble should be reserved for `recommendation` and future `architecture_review`, not for deterministic kinds.**

---

## 4. Failure modes + 2026 best-practices

### 4.1 When role-routing degrades vs single-model

From Augment Code's production data ([11][11]):

- **Over-provisioning:** Routing Opus to file navigation inflates input costs ~5x without quality gain.
- **Under-provisioning:** Weak coordinators emit "malformed subtask specs that no downstream agent can correct" — the error compounds. Cortex-x's risk equivalent: a Haiku-tier model writing the `recommendation` JSON that downstream `applyAction` consumes; a malformed `acceptance_criteria[]` spec gets caught by `spec-verifier.cjs` (Sprint 1.9.0), but only after a wasted commit cycle.
- **Quality degradation:** DryRun Security March 2026 report — Claude agents left IDOR + unauthenticated endpoints unresolved; GPT-5.2 finished cleaner. Mitigation: cross-family review (Sonnet implements, GPT-5.2 reviews). Read-across: when cortex-x adds `security_review` action_kind, route it cross-family.

### 4.2 Latency penalty

- **Dynamic routing decision overhead:** Augment reports 50-200ms per routing decision. ([11][11])
- **Static per-action_kind table (cortex-x's pattern):** O(1) — no penalty.
- **Ensemble parallel execution:** wall-clock = max(worker latency); judge adds one extra round-trip (~1-3s for Haiku 4.5).
- **Cascade strategy** (try cheap, escalate on failure): adds 1 extra LLM call on the ~5-10% failure path. Worth it when cheap-tier success rate >90%.

### 4.3 Cost runaway risk

Real production failure modes to defend against:

1. **Premium-tier accidentally invoked on commodity action.** Defense: per-action_kind allowlist of profiles (e.g. `recommendation_harvest` cannot be `premium`).
2. **Ensemble loop on retry.** If the judge disagrees with all 3 workers and retry triggers, ensemble cost compounds. Defense: max-1-retry; on 2nd failure, escalate to single-Sonnet, not re-ensemble.
3. **OpenRouter provider fallback to expensive provider.** Defense: pin `provider: { order: ["deepseek", "fireworks"], allow_fallbacks: false }` for `cheap`/`balanced`. ([27][27])
4. **Sprint 1.9.1 multi-window cost caps already cover most of this** — `STEWARD_DAILY_USD_CAP`, `STEWARD_WEEKLY_USD_CAP`, `STEWARD_MONTHLY_USD_CAP`, `STEWARD_TOKEN_VELOCITY_CAP`. Sprint 2.0b should add `STEWARD_PER_ACTION_USD_CAP` keyed on action_kind.

### 4.4 JSON mode compatibility

OpenRouter's `response_format: { type: "json_schema" }` is honored only by providers that **declare support** in their model card. Use `require_parameters: true` to **refuse fallback** to providers that ignore `response_format` — otherwise OpenRouter routes silently and the model returns plaintext. ([27][27], [28][28])

Provider matrix for our shortlist:

| Model | json_object | json_schema | Notes |
|---|---|---|---|
| DeepSeek V4 Flash | Yes | Partial | Anthropic-via-OpenRouter wraps in fences; native DeepSeek clean ([2][2]) |
| Qwen3 Coder Flash | Yes | Yes | ([3][3]) |
| Mistral Small 4 | Yes | Yes | ([4][4]) |
| Gemini 3 Flash | Yes | Yes | ([6][6]) |
| GPT-5.4 / Mini | Yes | Yes (strict) | OpenAI native ([9][9]) |
| Claude Haiku/Sonnet/Opus | Yes | Yes (since 4.5) | ([12][12]) |

**Cortex-x action item:** when adding the routing config, pass `require_parameters: true` to OpenRouter for any json_schema action_kind. Today's `recommendation` already uses `response_format: { type: "json_object" }` — keep that until a stricter schema is registered.

---

## 5. CLI + env knob UX patterns

### 5.1 Survey of production patterns

- **Hermes Agent:** `/model gpt-5.4 --provider openrouter` slash-command, `--global` flag for persistence, plus `model_aliases:` in YAML config for per-task overrides keyed by auxiliary slot. **No env-var primary path**. ([18][18], [29][29])
- **Claude Code:** `/model` slash-command, subagent `model:` field in YAML frontmatter (`sonnet|opus|haiku|inherit`), CLI `--model` flag. **Env var `ANTHROPIC_MODEL` exists** but is rarely the primary surface.
- **Cline / Cursor:** UI dropdown; no env-var path documented as canonical.
- **Augment Code:** automatic role-routing under the hood; user does not pick model per-call.
- **OpenAI Agents SDK / Anthropic Agent SDK:** model is a constructor argument; env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) handle auth, not routing.

### 5.2 Pain points reported by Hermes users

The `--mode plan|code|fix|cheap` UX referenced in the prompt **is not the current surface**. Community posts and the v0.11.0 release notes show the team moved away from named modes toward the auxiliary-slot model. Reasons (inferred from issue threads):

- Mode names became ambiguous as task taxonomy grew (what mode for `dep_update`?).
- Per-task slots scale better — adding a new task type adds a slot, not a new mode name.
- Users wanted to override one task at a time, not switch the whole agent's persona.

This is **direct guidance for cortex-x:** prefer the per-`action_kind` override pattern over named "modes."

### 5.3 Recommended cortex-x UX

**Default:** `STEWARD_ROUTING_PROFILE=balanced` (env), unset = `balanced`.

**Override layers** (lowest precedence first):

1. Built-in default per action_kind (in `bin/steward/_lib/routing-table.cjs`).
2. `STEWARD_ROUTING_PROFILE` env (cheap | balanced | premium | ensemble) — applies a profile-wide overlay.
3. `STEWARD_ROUTING_<ACTION_KIND>=<model>` env (e.g. `STEWARD_ROUTING_RECOMMENDATION=anthropic/claude-sonnet-4.6`) — single-action override.
4. CLI flag `--model <slug>` on `cortex-steward run` — one-shot override.

**Default = `balanced` not `cheap`.** Cortex-x already runs DeepSeek V4 Flash at ~$0.0008/run. `cheap` would only switch to a marginally cheaper model with thinner JSON-mode track record (Gemini 3.1 Flash Lite). The cost saving is rounding error against the cost-cap envelope; the quality risk is real on a single-LLM-kind system. **`balanced` default keeps the proven Sprint 1.6.13 → 1.9.1 stack and lets `cheap` be the explicit opt-in for high-volume future kinds.**

**Naming:** prefer `STEWARD_ROUTING_PROFILE` over `STEWARD_MODE` — "mode" collides with Hermes Agent's deprecated vocabulary and with Sprint 1.8.13's "approval mode."

---

## 6. Recommendation for cortex-x Sprint 2.0b

### 6.1 Concrete model pairings table

| action_kind | cheap | **balanced (DEFAULT)** | premium | ensemble |
|---|---|---|---|---|
| `recommendation` | Gemini 3.1 Flash Lite | **DeepSeek V4 Flash** (Qwen3 Coder Flash fallback) | Sonnet 4.6 | DeepSeek V4 Flash + Qwen3 Coder Flash + Mistral Small 4 → Haiku 4.5 judge |
| `recommendation_harvest` | n/a (deterministic) | n/a | n/a | n/a |
| `dep_update_patch` | n/a | n/a | n/a | n/a |
| `flaky_test_repair` | n/a (deterministic v0.8) | n/a | n/a | n/a |
| `doc_drift` | n/a (deterministic v0.8) | n/a | n/a | n/a |
| `todo_triage` | n/a | n/a | n/a | n/a |
| `test_coverage_gap` | n/a | n/a | n/a | n/a |
| `lint_fix_shipper` | n/a | n/a | n/a | n/a |
| `pr_review_responder` | n/a | n/a | n/a | n/a |
| **future** `architecture_review` | DeepSeek V4 Flash | Sonnet 4.6 | Opus 4.6 | Sonnet 4.6 + GPT-5.4 + Opus 4.6 → Sonnet 4.6 judge |
| **future** `release_notes_drafter` | Gemini 3.1 Flash Lite | Haiku 4.5 | Sonnet 4.6 | n/a (overkill) |
| **future** `security_review` | n/a (always cross-family) | Sonnet 4.6 + GPT-5.4 (cross-family) | Opus 4.6 + GPT-5.5 | full ensemble |

### 6.2 Caveats to encode in implementation

1. **DeepSeek V4 Flash JSON quirk** — keep `stripJsonFences` (Sprint 1.6.16) live; it is a precondition for routing to DeepSeek via Anthropic-provider fallback chains.
2. **Opus 4.7 token-overhead** — prefer **Opus 4.6** as the explicit premium choice until Anthropic ships tokenizer-overhead billing parity. ([15][15])
3. **`STEWARD_PER_ACTION_USD_CAP`** — required for ensemble profile; without it, Sprint 1.9.1's daily cap can be blown by a single runaway ensemble retry.
4. **`require_parameters: true`** on OpenRouter calls when the action_kind requires `json_schema`. Today's `json_object` works without it, but Sprint 2.0b is the right time to harden.
5. **Provider-pin `cheap` / `balanced`** to avoid silent fallback-to-expensive-provider. Use OpenRouter's `provider.order` with `allow_fallbacks: false` for these tiers; let `premium` keep fallback enabled because reliability outranks cost there. ([27][27])
6. **Profile-allowlist per action_kind** — block premium for commodity kinds (e.g. `lint_fix_shipper` cannot escalate to Opus even by override). Encoded in `routing-table.cjs`.
7. **Tier-5 prompt regression suite must cover all 4 profiles** before merging Sprint 2.0b — same JSON output should be producible across profiles within tolerance, otherwise routing introduces silent drift.

### 6.3 Suggested file layout

- `bin/steward/_lib/routing-table.cjs` — pure function `(action_kind, profile, override) => { model, provider, max_tokens, json_mode }`
- `bin/steward/_lib/routing-policy.cjs` — `assertProfileAllowed(action_kind, profile)` + per-action USD cap check
- `tests/contract/routing-table.contract.cjs` — table-driven tests for all 9 kinds × 4 profiles
- `docs/steward-routing.md` — operator guide with the table from §6.1
- `standards/steward-policy.md` — append §"Routing profile policy"

---

## 7. Open questions

1. **Should `cheap` profile be supported at all in Sprint 2.0b?** — Today there is exactly one LLM kind (`recommendation`), already on a near-floor model. `cheap` would only be exercised by harvester-executor LLM kinds added in v0.7+. Could defer to Sprint 2.0c. **Lean: ship the knob now, default the table to `balanced` everywhere, accept that `cheap` is mostly latent until v0.7 LLM kinds land.**
2. **Should the ensemble judge be Haiku 4.5 or Sonnet 4.6?** — Haiku is 3x cheaper but 6.3 SWE-bench points behind Sonnet. For the recommendation kind, Haiku is likely sufficient (the workers have already done the hard part); for future architecture_review, Sonnet is the right judge. **Lean: keep judge configurable per-action_kind, default Haiku for recommendation, Sonnet for future kinds.**
3. **Cross-family diversity vs single-family-cheap-stack?** — The MoA literature suggests cross-family (DeepSeek + Qwen + Mistral) > same-family (3 DeepSeek seeds). But cortex-x doesn't have empirical data on its own action_kinds yet. **Lean: launch cross-family ensemble; capture per-run agreement-rate metric in journal; revisit after 100 runs.**
4. **Should `STEWARD_ROUTING_PROFILE=auto` exist as a 5th profile** that picks profile based on action_kind? — Tempting, but it duplicates what the routing-table already encodes. Skip.
5. **Grok 4.20 in `cheap` profile?** — At $1.25/$2.50 it is competitive on output-cost-per-quality, but tool-call ecosystem maturity is thin (March 2026 release, less production validation than Qwen/DeepSeek). **Defer to Sprint 2.0c after one month of production data.**
6. **Latency budget per profile?** — Augment cites 50-200ms for dynamic routing decisions; cortex-x's static table is O(1). But ensemble adds parallel-worker max-latency + judge round-trip (~3-5s wall-clock vs ~1-2s for balanced). Should `STEWARD_LATENCY_BUDGET_MS` be a separate knob, or absorbed into profile? **Lean: separate knob, defaulting to `null` (no enforcement) for v1.**

---

## Sources

[1]: https://openrouter.ai/deepseek/deepseek-v4-flash "DeepSeek V4 Flash on OpenRouter"
[2]: https://api-docs.deepseek.com/guides/json_mode "DeepSeek JSON Output guide"
[3]: https://openrouter.ai/qwen/qwen3-coder-flash "Qwen3 Coder Flash on OpenRouter"
[4]: https://openrouter.ai/mistralai/mistral-small-2603 "Mistral Small 4 on OpenRouter"
[5]: https://openrouter.ai/google/gemini-3.1-flash-lite-preview "Gemini 3.1 Flash Lite Preview on OpenRouter"
[6]: https://openrouter.ai/google/gemini-3-flash-preview "Gemini 3 Flash Preview on OpenRouter"
[7]: https://openrouter.ai/zai/glm-4.7 "GLM-4.7 on OpenRouter"
[8]: https://openrouter.ai/moonshotai/kimi-k2.6 "Kimi K2.6 on OpenRouter"
[9]: https://pricepertoken.com/pricing-page/model/openai-gpt-5.4-mini "GPT-5.4 Mini API Pricing 2026"
[10]: https://openrouter.ai/x-ai/grok-4.20 "Grok 4.20 on OpenRouter"
[11]: https://www.augmentcode.com/guides/ai-model-routing-guide "Best AI Model for Coding Agents in 2026: A Routing Guide — Augment Code"
[12]: https://platform.claude.com/docs/en/about-claude/pricing "Claude API Pricing — Claude API Docs"
[13]: https://www.anthropic.com/engineering/multi-agent-research-system "How we built our multi-agent research system — Anthropic"
[14]: https://www.nxcode.io/resources/news/gpt-5-4-release-date-features-pricing-2026 "GPT-5.4 (March 2026): 75% Computer Use, 1M Context"
[15]: https://www.finout.io/blog/claude-opus-4.7-pricing-the-real-cost-story-behind-the-unchanged-price-tag "Claude Opus 4.7 Pricing — the real cost story"
[16]: https://openai.com/index/introducing-gpt-5-5/ "Introducing GPT-5.5 — OpenAI"
[17]: https://blog.bytebytego.com/p/how-anthropic-built-a-multi-agent "How Anthropic Built a Multi-Agent Research System"
[18]: https://hermes-agent.nousresearch.com/docs/user-guide/configuring-models "Configuring Models — Hermes Agent"
[19]: https://code.claude.com/docs/en/sub-agents "Create custom subagents — Claude Code Docs"
[20]: https://www.mindstudio.ai/blog/claude-code-advisor-strategy-opus-sonnet-haiku "Claude Code Advisor Strategy"
[21]: https://github.com/anthropics/claude-code/issues/44976 "Feature: Auto model routing by task type — anthropics/claude-code#44976"
[22]: https://cursor.com/docs/models-and-pricing "Cursor Models & Pricing"
[23]: https://www.the-ai-corner.com/p/andrej-karpathy-ai-workflow-shift-agentic-era-2026 "Andrej Karpathy: The AI Workflow Shift Explained 2026"
[24]: https://blockchain.news/ainews/autoresearch-breakthrough-karpathy-calls-for-massively-asynchronous-collaborative-ai-agents-seti-home-style-2026-analysis "Karpathy AutoResearch — 2026 Analysis"
[25]: https://arxiv.org/pdf/2510.21513 "Wisdom and Delusion of LLM Ensembles for Code Generation and Repair"
[26]: https://aclanthology.org/2024.findings-emnlp.698.pdf "LLM-TOPLA: Efficient LLM Ensemble by Maximising Diversity"
[27]: https://openrouter.ai/docs/guides/routing/provider-selection "Provider Routing — OpenRouter Documentation"
[28]: https://openrouter.ai/docs/guides/features/structured-outputs "Structured Outputs — OpenRouter Documentation"
[29]: https://hermes-agent.nousresearch.com/docs/user-guide/configuration "Hermes Agent Configuration"
