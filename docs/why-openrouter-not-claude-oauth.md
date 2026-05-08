# Why cortex-x uses OpenRouter API keys, not Claude Pro/Max OAuth

> **Status:** Architectural decision record · Captured 2026-05-09 during pre-Sprint-2.0 audit

## TL;DR

cortex-x's autonomous runtime ("Hermes" today; **Steward** post-Sprint 4.7) calls `https://openrouter.ai/api/v1/chat/completions` with an `OPENROUTER_API_KEY` set as a GitHub Actions secret. We do **not** use Claude Code OAuth tokens, Claude Pro/Max session credentials, or any subscription-tied authentication.

This is a deliberate architectural choice that became load-bearing in **April 2026** when Anthropic enforced a usage-policy change.

## What changed in April 2026

Effective **April 4, 2026**, Anthropic banned the use of Claude Free / Pro / Max OAuth tokens by **any third-party tool**, including Anthropic's own Claude Agent SDK. Only API-key access (paid per-token) is permitted for agentic / programmatic use.

Public coverage:
- [Anthropic Usage Policy update](https://www.anthropic.com/news/usage-policy-update)
- [VentureBeat — Anthropic crackdown on unauthorized Claude usage by third-party harnesses](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses)
- [VentureBeat — Anthropic cuts off Claude subscription use with OpenClaw and other tools](https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and)
- [aihackers.net Feb 2026 explainer on the OAuth policy](https://aihackers.net/posts/anthropic-claude-code-oauth-policy-feb-2026/)

Tools named in coverage that lost subscription-OAuth access include OpenClaw (370k stars personal AI gateway), various Claude Code third-party harnesses, and several self-hosted assistants that had been bridging Claude.ai sessions into automated pipelines.

## Why cortex-x is on the safe side

Sprint **1.6.13** (2026-05-07) replaced the prior Claude-SDK seam with a real-LLM path via Node's built-in `fetch()` against OpenRouter's OpenAI-compatible endpoint, using a paid `OPENROUTER_API_KEY`. We never used:

- Claude Pro / Max subscription tokens
- Claude.ai session cookies
- Anthropic Agent SDK with OAuth login
- Browser-harnessed Claude.ai access

This means the April 2026 enforcement event was a **non-event** for cortex-x. No remediation, no scrambling for an alternative provider, no broken cron runs. The decision in May 2026 to lean further into OpenRouter (Sprint 2.0b model routing) is reinforced by this — OpenRouter is the multi-provider abstraction layer that protects us against single-vendor policy shocks.

## Trade-offs we accepted

| Choice | Cost | Benefit |
|---|---|---|
| OpenRouter API key (paid per-token) | ~$0.0008/run via DeepSeek V4 Flash; ~$5/month at full cadence | Vendor-neutral; survives Anthropic policy shocks; multi-model routing trivial |
| **Not** using Claude Pro/Max | Operator's $200/month MAX subscription unused for Steward | Steward keeps running when Anthropic restricts third-party harnesses |
| **Not** building Claude SDK seam | Higher ceiling on Anthropic-flagship model quality unreachable | Zero-dependency posture; `fetch()` is enough |

## What this means for downstream consumers

Anyone forking cortex-x for their own project:

- **Don't** wire Claude Pro/Max OAuth into the runtime. Anthropic's policy explicitly disallows it for agentic use, and your runtime will break the next time they tighten enforcement.
- **Do** use OpenRouter (or Anthropic's paid API key directly, if you only want Anthropic models). Paid-per-token is the only sustainable agentic path with Anthropic models.
- **Do** route through OpenRouter even if you only intend to use Anthropic — single-line model swap when their pricing/policy changes.

## What this means for the operator's MAX subscription

The operator's Claude Pro/Max subscription remains useful for **interactive Claude Code sessions** (this current session, where the operator pairs with Claude Code on cortex-x development). Those sessions are user-driven, in-IDE, and entirely within the bounds of Anthropic's usage policy. Steward's autonomous nightly runs are a separate concern, paid via OpenRouter API key.

## Future-proofing

When Anthropic eventually relaxes the OAuth policy (or introduces a sanctioned agent OAuth scope), cortex-x can add a `claude-sdk` engine alongside `openrouter` (the seam already exists at `bin/hermes/_lib/action-engine.cjs ENGINES`). Until then, single-engine simplicity wins.

When OpenRouter is the source of an outage (rare but possible), cortex-x's circuit breakers (`HERMES_FAILURE_BREAKER` consecutive-fail counter, `HERMES_DAILY_USD_CAP`) prevent cost runaway and Sprint 1.9.1's planned monthly cap + token velocity gate add another layer.

## References

- [`bin/hermes/_lib/action-engine.cjs`](../bin/hermes/_lib/action-engine.cjs) — `OPENROUTER_ENDPOINT` + `DEFAULT_MODEL` + engine selection.
- [`docs/hermes-runtime.md`](./hermes-runtime.md) — runtime architecture.
- [`MIGRATIONS.md`](../MIGRATIONS.md) Sprint 1.6.13 entry — original OpenRouter pivot.
- [`standards/hermes-policy.md`](../standards/hermes-policy.md) § 4 — cost ceilings.
