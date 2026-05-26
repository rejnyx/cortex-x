# Cost discipline — budgets, per-iteration caps, reconciliation

> Companion to [`../SKILL.md`](../SKILL.md). Ralph runs cost real money. This document is the budget contract the wrapper enforces and the reconciliation procedure the operator runs post-loop.

## Baseline numbers (May 2026)

| Model | $/1M input tokens | $/1M output tokens | Typical iter cost |
|---|---|---|---|
| `claude-sonnet-4-6` (default) | $3.00 | $15.00 | $0.20–$0.40 |
| `claude-opus-4-7` | $15.00 | $75.00 | $1.00–$2.00 |
| `claude-haiku-4-5` | $0.80 | $4.00 | $0.05–$0.10 |

Verbatim HumanLayer benchmark: *"Sonnet 4.5 on a bash loop, known as Ralph, costs ~$10.42 USD an hour."* Sonnet 4.6 is approximately the same. Pricing here is for **Anthropic direct** — OpenRouter adds ~5% markup but gives provider routing failover, which Ralph defaults to.

Realistic 8h overnight on Sonnet 4.6: **$60–$90**.

## The three caps Ralph respects

### Per-run cap: `MAX_COST_USD`
- Default `$20`
- Hard exit on overshoot
- Operator sets per invocation: `MAX_COST_USD=50 ./ralph.sh`
- The skill **refuses to scaffold** any value above $200 — anything bigger needs a different mechanism (the Steward cron stack with its multi-window caps)

### Per-day cap: Steward's `STEWARD_DAILY_USD_CAP`
- Default `$5` (very conservative — set high enough to allow normal Steward operation but low enough to cap blast radius)
- Path: `~/.cortex/usage/daily-YYYY-MM-DD.json` (Steward writes; Ralph reads)
- Ralph **respects** this cap as a hard pre-flight gate: if today's spend + estimated Ralph cost > daily cap, refuse to start
- Operator can raise temporarily: `STEWARD_DAILY_USD_CAP=50 /ralph-loop ...` then revert

### Per-hour velocity cap: `MAX_TOKENS_PER_HOUR`
- Default `200000` total tokens (in + out)
- If a sliding-window measurement exceeds this, the loop pauses 5min between iterations until velocity drops
- Catches "model spawning 20 subagents per iteration" pathological cases

## Cost prediction (pre-flight)

Before scaffolding, the skill estimates upper-bound spend:

```
estimated_cost = MAX_ITERATIONS × typical_iter_cost(model)
```

For default `MAX_ITERATIONS=50` × Sonnet 4.6 mid-range ($0.30/iter) = **$15**. Sits comfortably under default `MAX_COST_USD=20`.

The estimate is shown in the Phase 1.5 plan gate. Operator approves with the cost visible.

If `estimated_cost > MAX_COST_USD`, skill refuses to proceed. Either raise MAX_COST_USD or lower MAX_ITERATIONS.

## Per-iteration cost extraction

The wrapper extracts cost from each iteration's `claude -p --output-format stream-json` tail. The format Claude emits in a `result` event:

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 12345,
  "num_turns": 7,
  "total_cost_usd": 0.0042,
  "usage": {
    "input_tokens": 12000,
    "cache_read_input_tokens": 8000,
    "output_tokens": 850
  }
}
```

The wrapper greps the last `result` event with `jq` and adds `total_cost_usd` to the running total. If `jq` isn't installed, falls back to `iter_cost=0` (cost tracking is best-effort — primary defense is iteration cap, not cost cap).

## Reconciliation procedure (post-loop)

After the loop exits, run this once a week (or after a notably-expensive run):

1. **Sum journal.jsonl**: `jq -r '.iter_cost_usd // 0' journal.jsonl | awk '{s+=$1} END {print s}'`
2. **Check OpenRouter dashboard** (or Anthropic console) for actual spend in the time window
3. **Diff**: typical drift is < 5% (OpenRouter's caching arbitrage + minor accounting lag). > 10% drift means either:
   - stream-json missed events (rare, recent claude versions)
   - operator was running other Claude sessions concurrently (likely culprit)
4. **Update `~/.cortex/usage/`** if needed for Steward's caps to stay accurate

The reconciliation is paranoia for high-spend operators. For occasional Ralph runs, the in-loop totals are accurate enough.

## Anti-patterns that explode budget

### "Just one more iteration"
Operator sees the loop almost-done and raises MAX_ITERATIONS mid-run by editing the wrapper. **Don't.** Let it exit at the cap, review what's left, run again with a smaller fresh fix_plan. The fresh context window discipline is what makes Ralph cheap.

### Opus baseline
Default to Sonnet 4.6. Opus is 5× more expensive per token. Use it only when sonnet provably stalls on a specific item — and switch back after.

### Subagent spam
Verbatim Huntley rule: *up to 500 sonnet subagents for reads, 1 sonnet subagent for writes*. If the prompt allows the model to spawn 500 writers, you'll bankrupt the run in 2 iterations. The PROMPT.template.md explicitly constrains this.

### No test harness
If `npm test` (or equivalent) doesn't exist, the model has no signal for "done" — it'll iterate forever on what it *thinks* is done. The skill refuses pre-flight if no test harness is detected.

### Long fix_plan items
A single fix_plan item that takes 10 iterations to close is wasting the fresh-context-per-iteration discipline. Split it.

### Ambiguous acceptance criteria
"Refactor X for readability" has no exit signal. Acceptance criteria must be machine-checkable: test passes / file exists / output matches snapshot.

## Cost-aware iteration sizing

A rough heuristic:

- Each iter ≈ 1 item closed
- Each item ≈ 1 small commit (10–200 LoC + a test)
- Each item ≈ 3–15min wall-clock
- Each item ≈ $0.20–$0.40 on Sonnet 4.6
- ⇒ A clean 8h run = ~30–60 items closed, ~$10–$24

If your fix_plan has 200 items, you need 4 sequential runs (or a much higher MAX_ITERATIONS + budget). Don't try to do 200 items in one run — circuit breakers will catch you, but only after burning the budget.

## Surfacing cost in /cortex-doctor

`/cortex-doctor` reads `~/.cortex/usage/` and reports today's + this week's spend. If Ralph is active, it adds the running total. Use it before starting a new Ralph: if today's Steward cron already burned $4 of the $5 daily cap, postpone Ralph or raise the cap explicitly.

## Free-tier and bring-your-own-key

- Ralph defaults to OpenRouter routing (set in cortex-x/config/openrouter.json)
- For Claude Max subscribers (flat fee, not per-token), the `MAX_COST_USD` cap is informational only — Anthropic doesn't charge per token under Max. **But** the model still tracks spend in stream-json events at list price. Set `CORTEX_BUDGET_DISABLED=1` to hide cost warnings; the loop still enforces MAX_ITERATIONS and MAX_HOURS regardless.
- For pure free-tier (no Anthropic billing, no API key), Ralph is not runnable — claude CLI needs auth.

## Cross-reference

- Termination conditions + circuit breakers → [`termination.md`](termination.md)
- Ralph variant patterns → [`patterns.md`](patterns.md)
- Phase mapping + plan gate → [`../SKILL.md`](../SKILL.md)
