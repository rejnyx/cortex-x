# Steward routing — action-kind based model selection

> Sprint 2.0b shipped 2026-05-08. Routing is opt-in additive: existing
> `STEWARD_MODEL=...` env vars and workflow files keep working unchanged.
> R1 memo: `docs/research/sprint-2.0b-action-kind-model-routing-2026-05-08.md`.

## Why routing

Pre-2.0b, every Steward action used the same model (`STEWARD_MODEL` env or
`DEFAULT_MODEL` constant). The cortex-x roadmap adds three more LLM-backed
action kinds in 2026 (`architecture_review`, `release_notes_drafter`,
`security_review`). They have different cost/quality trade-offs:

- **`recommendation`** — small structured output, balanced quality good enough.
- **`architecture_review`** — cascading decisions, premium reasoning helps.
- **`release_notes_drafter`** — generation, not reasoning; cheap is fine.
- **`security_review`** — cross-family review reduces single-family blind spots.

Routing makes the trade-off explicit and pinnable, with a 4-tier profile
overlay so operators can dial cost vs. quality without editing source.

## The 4 profiles

| Profile | Intent | Default model for `recommendation` |
|---|---|---|
| `cheap` | Cost floor for high-volume kinds | `google/gemini-3.1-flash-lite-preview` |
| `balanced` (DEFAULT) | Production setting since v0.5b | `deepseek/deepseek-v4-flash` |
| `premium` | Higher-stakes work, single best model | `anthropic/claude-sonnet-4.6` |
| `ensemble` | 3 cross-family workers + Haiku judge | `deepseek/deepseek-v4-flash` (worker 1) |

The full table (covering all currently-LLM-backed and future kinds) lives in
[`bin/steward/_lib/routing-table.cjs`](../bin/steward/_lib/routing-table.cjs).

## Override hierarchy

When Steward picks a model for an LLM action, it walks the following layers
**from highest to lowest precedence**. The first match wins:

1. **CLI `--model <slug>`** — one-shot override on `cortex-steward execute`.
   Bypasses the profile allowlist (operator escape hatch).
2. **`STEWARD_ROUTING_<ACTION_KIND>` env** — per-kind override. Action_kind
   name is upper-cased and non-alpha chars normalized to underscores.
   Example: `STEWARD_ROUTING_RECOMMENDATION=anthropic/claude-sonnet-4.6`.
3. **`STEWARD_MODEL` env** (legacy, pre-2.0b) — global pin that overrides
   the profile table for every kind. Kept working for backward compat with
   existing workflow files / operator dotfiles. Dropping a `STEWARD_MODEL`
   pin re-engages the profile table.
4. **`STEWARD_ROUTING_PROFILE` env** — selects which profile slot the table
   reads. Default `balanced` when unset.
5. **Routing table default** — `routing-table.cjs ROUTING_TABLE[kind][profile]`.

## Default behaviour (no env vars set)

- Profile = `balanced`.
- Model for `recommendation` = `deepseek/deepseek-v4-flash` (~$0.0008/run).
- Per-action USD cap = $1.00 (24-hour rolling window per action_kind).
- All future LLM kinds (architecture_review, release_notes_drafter,
  security_review) declared in the table but not yet shipped — calling
  them today returns `PLAN_ACTION_KIND_NOT_SHIPPED` from the executor.

## Profile-allowlist gate

Some kinds restrict which profiles they accept, defending against config
errors that route a low-stakes action to an expensive model:

- `release_notes_drafter` — `cheap`, `balanced`, `premium` (no `ensemble`).
- All other kinds — all 4 profiles allowed.

If a profile is denied, `selectModel()` returns
`{ ok: false, code: 'ROUTING_PROFILE_NOT_ALLOWED' }` and execute.cjs aborts
the run cleanly. **CLI `--model` bypasses the allowlist** (operator-explicit
escape hatch).

## Per-action USD cap (Sprint 2.0b defense)

Layered above Sprint 1.9.1's daily/weekly/monthly caps. Defends specifically
against the ensemble profile's ~6× per-run cost spike:

- `STEWARD_PER_ACTION_USD_CAP=1.00` (default) — global ceiling for any LLM
  action_kind, summed over a 24-hour rolling window.
- `STEWARD_PER_ACTION_USD_CAP_<KIND>=0.05` — per-kind override.
- `0` = explicit opt-out.

Tripped cap returns `PER_ACTION_BUDGET_CAP_REACHED` and journals
`execute_per_action_budget_capped`. Operator clears by waiting for the
24-hour window to roll, or raising the cap.

## Operator recipes

### Run today's daily cron exactly as before

No changes needed. `STEWARD_MODEL=deepseek/deepseek-v4-flash` in
`.github/workflows/steward.yml` keeps winning over the routing table
(layer 3 above). When you're ready to engage routing, drop the
`STEWARD_MODEL:` line from the workflow.

### A/B test Sonnet 4.6 on the recommendation kind for one week

```bash
# In .github/workflows/steward.yml under env:
STEWARD_ROUTING_RECOMMENDATION: anthropic/claude-sonnet-4.6
```

This pins recommendation to Sonnet 4.6 without touching other kinds (today
none of which use the LLM, but future-proofs when architecture_review lands).

### Switch to ensemble profile for one ad-hoc run

```bash
node bin/steward/execute.cjs --plan-file=plan.json --routing-profile=ensemble
```

Materializes the ensemble shape: 3 workers (DeepSeek + Qwen + Mistral) +
Haiku 4.5 judge. Sprint 2.2 (worktree supervisor) is required for actual
parallel fan-out — Sprint 2.0b currently picks worker[0] from the ensemble
shape and runs single-process. The full ensemble dispatch ships with 2.2.

### Force a specific model for one run (debugging)

```bash
node bin/steward/execute.cjs --plan-file=plan.json --model=anthropic/claude-opus-4.6
```

Wins over everything. Use for "is this action's failure model-specific or
universal?" diagnostics.

### Tighten the per-kind USD cap to $0.05 for production

```bash
export STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION=0.05
```

Shrinks the safety margin against runaway. Today's typical recommendation
costs ~$0.0008, so $0.05 is still ~60× headroom but will catch a
misconfigured ensemble or token-explosion on an LLM regression.

## Trace tags

When a run touches an LLM action_kind, the AGENT span emits three new
attributes (visible in Phoenix at `localhost:6006` when
`STEWARD_OTEL_ENDPOINT` is set):

- `steward.routing.profile` — `cheap` / `balanced` / `premium` / `ensemble`
- `steward.routing.source` — `cli` / `env-kind` / `env-legacy` / `table`
- `steward.routing.model` — resolved slug

Operators can filter Phoenix traces by `routing.source = "env-legacy"` to
find which projects still use the pre-2.0b `STEWARD_MODEL` pin.

## Caveats encoded in the routing table

1. **Avoid Opus 4.7 in premium tier.** Anthropic's 4.7 tokenizer adds ~35%
   input tokens per request despite unchanged rate card. Use Opus 4.6 until
   tokenizer-billing parity ships. Contract test
   `tests/unit/steward/routing-table.test.cjs` enforces this.
2. **`stripJsonFences` (Sprint 1.6.16) stays.** Anthropic-via-OpenRouter
   wraps JSON output in markdown fences for some routes; the strip layer
   is a precondition for routing to DeepSeek via Anthropic-provider
   fallback chains.
3. **Provider fallbacks not pinned by routing-table.** OpenRouter's
   `provider.order` + `allow_fallbacks` is a Sprint 2.0c follow-up. For
   now, the `cheap` profile is one model deep; if the provider routes
   to a more expensive substitute, Sprint 1.9.1 weekly cap catches it.

## Related sprints

- **Sprint 1.9.1** — multi-window cost safety (daily/weekly/monthly USD
  caps + token velocity + cross-session loop detector). Sprint 2.0b
  per-action cap layers above these.
- **Sprint 2.0** — Phoenix observability + OTLP spans. Routing tags surface
  in the trace UI.
- **Sprint 2.1** — autoresearch overnight burst. Will add a judge model
  config that overlays on top of routing-table.
- **Sprint 2.2** — worktree supervisor. Activates the full ensemble
  fan-out (today's 2.0b ensemble shape returns worker[0] only).

## SSOT

Routing table — [`bin/steward/_lib/routing-table.cjs`](../bin/steward/_lib/routing-table.cjs).
Per-action cap policy — [`bin/steward/_lib/routing-policy.cjs`](../bin/steward/_lib/routing-policy.cjs).
Operator-facing standards — [`standards/steward-policy.md`](../standards/steward-policy.md) § Routing profile policy.
