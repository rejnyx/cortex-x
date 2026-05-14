---
title: Sprint 3.X — Anthropic Memory Tool + context-editing R1 memo (fresh 2026-05-14)
date: 2026-05-14
sprint: 3.X (deferred — refreshed)
status: REFRESH of 2026-05-11 memo, R1 web research, no implementation
dispatched_by: operator-directed fresh research, ~1500 words, 10-15 URLs
supersedes: docs/research/anthropic-memory-tool-deferred-research-2026-05-11.md
---

# Sprint 3.X — Anthropic Memory Tool R1 memo (fresh 2026-05-14)

> Refresh of the 2026-05-11 deferred research memo. Captured 2026-05-14.
> One of the three blockers (Sprint 2.8 schema gate) has cleared; the other two
> have **hardened**, not softened, since the original verdict.

## TL;DR

**Still defer.** The 2026-05-11 memo identified 3 blockers. As of 2026-05-14:

1. **claude-cli engine collision — STILL BLOCKING + WORSE.** Anthropic's 2026-04-04 subscription-policy cutoff explicitly forbids using Max-OAuth tokens against third-party harnesses. cortex-x **is** a third-party harness. Memory Tool still requires direct `/v1/messages` with an API key.
2. **Sprint 2.8 Memory Foundation gate — RESOLVED.** Sprint 2.8 v0 shipped 2026-05-09 (commit `86b2472`) with 2.8.1 lessons-exporter + 2.8.2 wiki layer following 2026-05-13. ReasoningBank schema is in place. This is no longer a blocker.
3. **OpenRouter cannot proxy this — NEW BLOCKER (was assumed-OK before).** GitHub issue `OpenRouterTeam/ai-sdk-provider#111` confirms OpenRouter does **not** reliably forward arbitrary `anthropic-beta` headers. Tested betas (`output-128k`, `interleaved-thinking`) silently drop. There is no documented allow-list, and `context-management-2025-06-27` is not on any known supported list.

Net effect: shipping Memory Tool today means **adding a new direct-Anthropic-API engine path** (parallel to OpenRouter + claude-cli), with a fresh API-key cost line, while we are still living off OpenRouter cents + Max sub for the existing two engines. That is not a Sprint 3.X investment — it is an engine-strategy decision that should land at Sprint 2.4 cost-pivot cadence, not as a side effect.

Also new since 2026-05-11: **CVE-2026-41686** on the official Anthropic SDK TypeScript memory helper (insecure default file perms `0o666`/`0o777`). If/when we ship, our `memory-store-fs.cjs` must explicitly set `0o600`/`0o700`. Free hardening artifact: Anthropic walked into the same trap we already gate against in cortex-x via `_lib/safety.cjs`.

## Findings

### 1. Memory Tool current state (commands, beta header, paths)

**Tool type string unchanged:** `"memory_20250818"`. Six commands unchanged: `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. All paths under virtual `/memories/...` prefix; entirely client-managed storage (Anthropic stores nothing).

**Beta header status — SOFTENED:** The May 2026 docs page for Memory Tool no longer shows `anthropic-beta: context-management-2025-06-27` in the basic-usage cURL. The header now only appears when **paired with context-editing**. Memory Tool alone may have moved to GA (or at least beta-without-header) — the docs are ambiguous; SDK helpers still live under `@anthropic-ai/sdk/helpers/beta/memory`. **Behavior worth verifying** with one curl test before shipping: try a `memory_20250818` request **without** the beta header and confirm whether Anthropic accepts it.

**Path-traversal guidance** — Anthropic's docs page now has an explicit **Warning** box: "Malicious path inputs could attempt to access files outside `/memories`. Your implementation **MUST** validate all paths to prevent directory traversal attacks." Recommended defenses (verbatim from docs): canonical resolve + `relative_to('/memories')`, reject `../` `..\\` `%2e%2e%2f`, language built-ins (`pathlib.Path.resolve()`).

**Pricing** — every Memory Tool `tool_use` block + `tool_result` block sits in the context window. Each round-trip is billed at the model's input + output token rate. Memory Tool itself adds no separate fee, but **directory listings and file reads compound** in agentic loops. This is the real cost model; the value is supposed to come from compaction-via-memory.

**Storage model** — fully client-managed. Anthropic eligible for ZDR (Zero Data Retention) when used. Anthropic-side stores nothing between requests.

**Updates since Sept 2025 launch:**
- Compaction integration documented (server-side `/v1/messages` compaction beta pairs naturally with memory).
- Multi-session software-development pattern formalized (progress.md + checklist.md bootstrap) — matches what cortex-x already does via PROGRESS.md.
- SDK helpers `BetaAbstractMemoryTool` (Python), `betaMemoryTool` (TypeScript) shipped — but TS helper now has CVE (see §7).

### 2. Context-editing `clear_tool_uses_20250919`

**Still beta-gated.** Header `anthropic-beta: context-management-2025-06-27` is required. Server-side: clearing happens before the prompt reaches Claude; client keeps full conversation history unchanged.

**What it does:** When `input_tokens` crosses the configured `trigger.value` (default unspecified, advanced config example uses 30k), the oldest `tool_result` blocks are replaced with a placeholder. By default **only `tool_result` blocks are cleared**; setting `clear_tool_inputs: true` also clears the `tool_use` call parameters. Parameters: `trigger` (input_tokens threshold), `keep` (recent N tool uses always preserved), `clear_at_least` (minimum tokens cleared per pass, important for prompt-cache invalidation amortization), `exclude_tools` (allowlist of tool names not to clear — e.g. `web_search` results worth keeping).

**New strategy 2026:** `clear_thinking_20251015` for extended-thinking blocks. Defaults are now model-class dependent — Opus 4.5+ keeps all prior thinking; Opus 4.1 and earlier clear all but last turn. cortex-x doesn't yet use extended thinking, so this is informational only.

**Does it work without the memory tool?** Yes. Context-editing is independent. **Memory tool alone is also independent.** They are designed to compose, but neither requires the other.

### 3. OpenRouter pass-through status — NEW BLOCKER

`OpenRouterTeam/ai-sdk-provider#111`: user attempted to pass `anthropic-beta: output-128k-2025-02-19,interleaved-thinking-2025-05-14` through OpenRouter; headers silently dropped at the OpenRouter edge. Quote from issue: "OpenRouter headers are not being passed down to downstream providers." Comment notes only "certain downstream providers respect the beta header (Anthropic & Bedrock iirc)" — i.e. forwarding is not the default.

OpenRouter docs mention pass-through for **specific** betas: `fine-grained-tool-streaming-2025-05-14`, `structured-outputs-2025-11-13`. The Anthropic Memory Tool's required header `context-management-2025-06-27` is **not on any documented allow-list**. No evidence in OpenRouter docs (`/docs/cookbook`, `/docs/guides`, `/anthropic`) that `memory_20250818` is supported as a tool type.

**Implication:** if we want Memory Tool, we need a **fourth engine** in `action-engine.cjs`: direct-Anthropic-API (`engine=anthropic`). OpenRouter cannot proxy it today. This is an architectural decision, not a small wrap.

### 4. claude-cli OAuth billing-leak detector — STILL VALID, BUT POLICY CHANGED

The 2026-04-04 Anthropic policy cutoff (shareuhack.com, claudefa.st) ruled that **subscription quotas no longer apply to third-party tools**. Pro/Max subscriptions cover only "official tools" (Claude Code CLI, claude.ai, Desktop apps). Third-party harnesses must use API-key billing or Anthropic's new pay-as-you-go "extra usage" system.

**cortex-x is a third-party harness.** Steward execute.cjs invokes `claude -p` via subprocess against the operator's local Claude Code install. Under the new policy this is **explicitly out-of-scope for the Max subscription** even though it technically still works because the operator is using the real CLI binary on their own machine.

The `total_cost_usd === 0` detector in `action-engine.cjs:1682` is still mechanically correct: the response envelope still includes that field, and `0` still indicates the request was attributed to the OAuth subscription rather than to an API key. But the policy meaning has shifted from "free path" to "borderline-compliant path you should not be advertising publicly." For Sprint 3.X positioning, claude-cli stays as an operator-opt-in engine, not a marketed default.

For Memory Tool specifically: claude-cli still doesn't expose `memory_20250818` as a flag. The tool type is API-only.

### 5. Token + perf claim — Anthropic-internal eval, replicable scope limited

Source: Anthropic's `claude.com/blog/context-management` and ContextEngineering blog posts. Numbers:
- **+39% over baseline** on "internal evaluation set for agentic search" — Memory + context editing **combined**.
- **+29% over baseline** — context editing alone.
- **−84% token reduction** in a 100-turn web-search evaluation (specifically about token consumption, not directly performance).

Independent benchmarks in adjacent literature land in similar territory but not at exactly 39%:
- Anthropic cookbook self-cites −48% peak context with clearing alone on long agent loops.
- SupervisorAgent: −29.68% tokens at pass@1 on GAIA (no memory tool).
- SMAS(AWorld) Guard: −36.54% token savings.
- Mem0 token-optimization playbook 2026: 3-4x cost cut, methodology differs.

**Honest read:** the 39% number is Anthropic-internal, baseline = no-memory-no-clearing, task = multi-turn agentic search. **Not** a short-context generative-edit task like Steward's typical action (single LLM call producing 1-3 file edits with verifier gate). Steward's actions don't accumulate 30k+ tokens of stale tool results. **The 39% claim does not directly apply to cortex-x's Steward runtime.** It would apply to a future cortex-x autoresearch-style long-running session (Sprint 2.1+) or to a `/cortex-goal` session loop (Sprint 2.24+, transcripted).

### 6. Coexistence with operator-edited memory

cortex-x has **three** memory layers today:
- `lessons.jsonl` — machine-written, scored, decayed (Sprint 2.8 ReasoningBank).
- `MEMORY.md` topic files in `~/.cortex/projects/<slug>.md` — operator-edited + Sprint 2.8.1 lessons-exporter writes.
- `lessons-<kind>.md` + wiki insights — Sprint 2.8.2 human-readable Karpathy-style wiki.

Anthropic Memory Tool would add a **fourth** layer rooted at `.steward/memories/<action-id>/` (per the 2026-05-11 plan).

Web search for "two memory layers coexistence Letta Mem0 sync conflict" returned no direct prior art. Mem0's 2026-playbook discusses one-time **migration** from existing MEMORY.md → Mem0, not ongoing two-way sync. **The pattern operators land on in practice is single-source-of-truth-per-question + one-way derived views.** Recommendation for Sprint 3.X if it ships:

- Memory Tool `.steward/memories/<action-id>/` = **ephemeral within-action scratchpad**. Discarded or archived to JSONL at action end.
- ReasoningBank `lessons.jsonl` = durable cross-action SSOT.
- `~/.cortex/projects/<slug>.md` = operator-curated SSOT, derived from but not equal to lessons.

Never two-way sync. Memory Tool is **not** a long-term store; it's a working-memory primitive between LLM turns inside one Steward action.

### 7. Security incidents 2026

- **CVE-2026-41686 / GHSA-p7fg-763f-g4gf** (Anthropic SDK TypeScript): `BetaLocalFilesystemMemoryTool` created memory files at default Node modes `0o666` (world-readable) and dirs at `0o777` (world-writable). Affected `@anthropic-ai/sdk >= 0.79.0`, fixed in `0.91.1`. **Direct read-across:** if our `bin/steward/_lib/memory-store-fs.cjs` lands, it MUST explicitly set `{mode: 0o600}` on `writeFileSync` and `{mode: 0o700, recursive: true}` on `mkdirSync`. Add to the criterion-kind acceptance tests.
- **CVE-2026-39861** (Claude Code sandbox escape via symlink, fixed in 2.1.64): symlink-out-of-workspace + prompt injection = arbitrary file write. Same attack class our path-traversal hardening already gates against — our memory-store needs `lstat` + symlink rejection, not just `realpath` containment.
- **MCP STDIO command injection cluster** (CVE-2026-30623 + CVE-2026-22252 + CVE-2026-22688) — unrelated to memory tool directly, but reinforces "Anthropic's tool surfaces ship with subtle defaults that turn lethal under prompt injection." Our memory tool sandboxing must be **stricter than reference helpers**, not equal.
- **Claudy Day** (Oasis Security, Claude.ai): three-vuln pipeline ending in exfil from conversation history. Memory Tool is a richer exfil target than chat history because files persist. Implication: **never write user-PII or secrets to memory files** even though Claude usually refuses; defense-in-depth = regex pre-write filter.

## Block status — are the 3 blockers from 2026-05-11 still active?

| 2026-05-11 blocker | 2026-05-14 status |
|---|---|
| 1. claude-cli engine collision | **STILL BLOCKING** + **policy worsened** (Apr-2026 cutoff). claude-cli still cannot reach Memory Tool. Max-OAuth path is now explicitly out-of-policy for third-party harnesses, though `total_cost_usd === 0` detector still mechanically correct. |
| 2. Sprint 2.8 Memory Foundation schema gate | **RESOLVED.** Sprint 2.8 v0 shipped 2026-05-09 (commit `86b2472`). 2.8.1 + 2.8.2 followed. ReasoningBank schema is in place; cortex-x can now safely position Memory Tool as the ephemeral working layer above durable lessons.jsonl. |
| 3. Value/ceremony ratio | **STILL GATED on combined Memory + context-edit.** 39% perf claim requires both. Memory Tool alone applied to Steward's short-context actions = ~20% of the eval-set wins (since Steward actions don't accumulate the tool-result piles that context-editing clears). |

**New blocker added 2026-05-14:** OpenRouter does not pass `context-management-2025-06-27` through. A direct-Anthropic-API engine is required. That's an engine-strategy decision worthy of its own sprint, not a side-effect of Sprint 3.X.

## Decision

**DEFER Sprint 3.X until at least one of these conditions holds:**

A. **Direct-Anthropic-API engine ships independently.** Either as a Sprint 2.4-class follow-up (re-pivot cost model, accept that some actions go through API keys for capability reasons) or as a side path opt-in under env flag `STEWARD_ENGINE=anthropic`. Once that path exists, Memory Tool becomes a feature flag on top of it.

B. **OpenRouter publicly adds `context-management-2025-06-27` to its supported betas.** Track issue `OpenRouterTeam/ai-sdk-provider#111`. If they generalize beta pass-through, the new-engine cost vanishes.

C. **A cortex-x action class lands that genuinely needs long-context working memory** — most likely `/cortex-goal` session-loop wrapper (Sprint 2.24+) or autoresearch-burst v2 (Sprint 2.1+). Today's Steward actions are short-context; the 39% win doesn't apply.

Until one of those triggers fires, the 2026-05-11 verdict stands: ~420 LoC + ~19 tests + 1-2 days is **not** justified by current action shapes, and the engine implication is now visible enough that shipping it sideways would create technical debt at the engine layer.

If the operator overrides this defer (e.g. wants to ship Memory Tool **just** as the ephemeral-scratchpad layer for `/cortex-goal` sessions, accepting API-key billing for that one engine path), the scope becomes:

- `bin/steward/_lib/anthropic-api-engine.cjs` (~150 LoC) — new HTTP path with `betas` array, API-key gated.
- `bin/steward/_lib/memory-tool.cjs` (~180 LoC) — 6-command dispatcher.
- `bin/steward/_lib/memory-store-fs.cjs` (~120 LoC) — **explicit `0o600`/`0o700` perms** per CVE-2026-41686, symlink rejection per CVE-2026-39861, path-traversal defense per Anthropic warning.
- Pair with `clear_tool_uses_20250919` (~40 LoC) — required to capture the 39% win.
- Cost ceiling: gate new engine behind `STEWARD_ENGINE=anthropic` env + new daily/weekly USD caps under existing cost-safety.cjs (Sprint 1.9.1) so the cost-pivot promise stays intact for OpenRouter+Max users.

Total ~490 LoC, ~22 tests, 2 working days, but **only justified inside a `/cortex-goal` or autoresearch sprint**, not as a standalone capability.

## Recommendations

1. **Hold Sprint 3.X.** Park as roadmap entry conditional on triggers A/B/C above.
2. **Watch `OpenRouterTeam/ai-sdk-provider#111`.** If OpenRouter adds context-management pass-through, ~80% of the new-engine cost evaporates.
3. **Pre-write the file-perms tests now.** Even before shipping, add an acceptance-criterion-kind unit test that any future `memory-store-fs.cjs` writes at `0o600`/`0o700` and rejects symlinks. Cheap insurance against CVE-2026-41686 read-across.
4. **Do not market the claude-cli engine path** publicly post-2026-04-04 Anthropic policy cutoff. Keep it as operator-opt-in under `STEWARD_ENGINE=claude-cli`, document the policy nuance in `docs/steward-usage.md`.
5. **Re-frame the 39% claim** in cortex-x marketing copy: it's a long-context-agentic-search win, not a Steward-action win. Don't quote 39% for cortex-x's current action shapes.
6. **When Sprint 2.24 `/cortex-goal` ships**, the value calculus flips: long-context session loop is exactly the eval set Anthropic measured against. Re-open Sprint 3.X memo at that point.
7. **Keep cortex-x's three-memory-layer model.** Adding Memory Tool would be layer four (ephemeral working). Never two-way sync; Memory Tool discards at action end, derived facts go to lessons.jsonl.
8. **Reject the "Memory Tool alone now" path.** 2026-05-11 verdict still right: 20% of value at 80% of integration cost, and the 80% now includes a new engine.
9. **Investigate Anthropic compaction** (`/v1/messages` compaction beta) as a lower-cost alternative for the autoresearch-burst sprint. Server-side, may not need our memory-store-fs at all.
10. **Document `total_cost_usd === 0` detector's policy-vs-mechanics distinction** in `bin/steward/_lib/safety.cjs` comments. Future contributors deserve to know the field still works but the policy underlying it changed 2026-04-04.

## Sources

- [Memory tool — Claude API Docs (May 2026)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Context editing — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Managing context — Anthropic blog](https://claude.com/blog/context-management)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Context engineering: memory, compaction, and tool clearing — Cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)
- [Anthropic SDK TypeScript helpers — memory example](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools-helpers-memory.ts)
- [CVE-2026-41686 / GHSA-p7fg-763f-g4gf — Anthropic SDK TS insecure default perms](https://github.com/anthropics/anthropic-sdk-typescript/security/advisories/GHSA-p7fg-763f-g4gf)
- [CVE-2026-39861 — Claude Code sandbox escape (SentinelOne)](https://www.sentinelone.com/vulnerability-database/cve-2026-39861/)
- [OpenRouter Anthropic Agent SDK integration](https://openrouter.ai/docs/guides/community/anthropic-agent-sdk)
- [OpenRouter beta header pass-through issue (#111)](https://github.com/OpenRouterTeam/ai-sdk-provider/issues/111)
- [OpenRouter Anthropic provider page](https://openrouter.ai/anthropic)
- [Claude Code subscription cutoff April 2026 — shareuhack](https://www.shareuhack.com/en/posts/openclaw-claude-code-oauth-cost)
- [Claudefa.st Claude Code subscription safe-use guide](https://claudefa.st/blog/guide/development/claude-code-subscription)
- [Mem0 2026 token-optimization playbook](https://mem0.ai/blog/the-2026-token-optimization-playbook-cut-ai-agent-memory-costs-3%E2%80%934x)
- [Claudy Day prompt-injection vuln (Oasis Security)](https://www.oasis.security/blog/claude-ai-prompt-injection-data-exfiltration-vulnerability)
