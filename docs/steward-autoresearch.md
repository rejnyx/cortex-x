# Steward autoresearch — N-strategy serial overnight burst mode

> Sprint 2.1 shipped 2026-05-08. Autoresearch is opt-in — default flow stays
> single-shot. Enable via `--mode=autoresearch` CLI flag or `STEWARD_MODE=autoresearch` env.
> R1 memo: [`docs/research/sprint-2.1-autoresearch-overnight-burst-2026-05-08.md`](research/sprint-2.1-autoresearch-overnight-burst-2026-05-08.md).

## What it does

Today's nightly cron runs **1 LLM call per recommendation**: apply → spec-verifier
→ npm test → atomic PR. If the call fails or the result regresses, the action
is retried up to 3 times (Sprint 1.6.19 failure breaker), but each retry uses
the **same prompt and model**.

Autoresearch turns that into **N=3 diverse candidate strategies in one run**:

1. **Generate**: 3 candidates with different personas + temperatures
   - `minimize_edits` (T=0.2) — surgical, smallest possible change
   - `balanced_1` (T=0.6) — middle ground
   - `exploratory` (T=1.0) — willing to refactor for clarity
2. **Apply each** (serial, with `git checkout -- . && git clean -fd` between
   candidates so they don't contaminate)
3. **Gate each** with spec-verifier + npm test
4. **Judge** selects the best among passing candidates (cross-family judge:
   Sonnet 4.6 picking among DeepSeek V4 Flash candidates)
5. **Re-apply winner**, atomic commit, draft PR

Pattern from Karpathy's autoresearch loop (March 2026, 41k+ stars), adapted
to single-process serial execution. Sprint 2.2 (worktree supervisor) will
fan the candidates out to N parallel workers.

## When to use it

- **Yes**: Sunday weekly autoresearch cron — slow, low-traffic window, room
  for higher-quality output than nightly speed-runs.
- **Yes**: any recommendation that nightly cron has failed on 2+ times — the
  diversity prompt + judge often unsticks edge-case actions.
- **No**: routine deps update, lint fix, harvester — those are deterministic
  kinds, autoresearch is moot.
- **No**: time-sensitive recommendations (autoresearch takes ~5 min vs ~30s
  for single-shot).

## Cost + latency

Typical Sunday autoresearch run:

- 3 candidate LLM calls × ~$0.0008 (DeepSeek V4 Flash) = ~$0.0024
- Judge call (Sonnet 4.6) ~$0.02
- **Total: ~$0.022/run**, ~$0.10/month for weekly cadence
- **Wall-clock**: ~4-5 min for 3 candidates × (10s LLM + 30s spec+npm) + 10s judge

Well under all caps:
- 1.9.1 daily $5 cap → 0.4% per run
- 1.9.1 weekly $25 cap → 0.1% per run
- 1.9.1 monthly $80 cap → 0.1% per month
- 2.1 per-run $1 cap → 2% per run (80× headroom)

## Safety mechanics

### Validation hacking defense (Tennis-XGBoost class)

Sprint 2.1 hashes critical files (`action-kinds.cjs`, `spec-verifier.cjs`,
`policy-check.cjs`) at run start; on completion, recomputes and compares.
Mismatch = a candidate edited the criteria → halt with
`STEWARD_AUTORESEARCH_VERIFIER_TAMPERED`.

This complements the path-traversal hardening from Sprint 1.6.18 (which
prevents the agent from writing to `bin/steward/_lib/**` in the first place)
— defense in depth.

### Strategy collapse detection

If all N candidates produce >85% Jaccard-similar diffs (configurable via
`STEWARD_AUTORESEARCH_SIMILARITY_THRESHOLD`), the run is flagged as collapsed.
Winner becomes the first passing candidate without a judge call (no
qualitative diversity to judge between).

### Delta anomaly detector

After the winner is picked, its `spec_margin` (criteria passed) is compared
to the rolling 7-day mean of past autoresearch winners. If today's value
exceeds `mean × 3.0` (configurable), the journal records `delta_anomaly: true`
as a soft signal. **Not a hard halt** — operator reviews the PR with extra
scrutiny.

### Cost + time caps

- `STEWARD_AUTORESEARCH_RUN_USD_CAP` (default $1) — pre-each-candidate gate
- `STEWARD_AUTORESEARCH_MAX_TIME_MIN` (default 60, max 300) — pre-each-candidate gate
- Token velocity cap (50K/5min from 1.9.1) inherited

When tripped mid-run, autoresearch reconciles whatever candidates have run
so far: if any passed, that's the winner; otherwise → all-failed error.

### Loop detector interaction

The Sprint 1.9.1 cross-session loop detector (5× same `criterion id` in 7 days
→ HALT) operates at **run-level**, not candidate-level. 3 candidates within
ONE autoresearch run targeting the same criterion = 1 tick, not 3 ticks.
Otherwise autoresearch would trip the detector after the second weekly run.

## CLI usage

### Single ad-hoc run

```bash
node bin/steward/execute.cjs --plan-file=plan.json --mode=autoresearch
```

### Custom N + cap

```bash
STEWARD_AUTORESEARCH_N=5 STEWARD_AUTORESEARCH_RUN_USD_CAP=2.00 \
  node bin/steward/execute.cjs --plan-file=plan.json --mode=autoresearch
```

### Premium judge override

```bash
STEWARD_AUTORESEARCH_JUDGE_MODEL=anthropic/claude-opus-4.6 \
  node bin/steward/execute.cjs --plan-file=plan.json --mode=autoresearch
```

### Cron — weekly Sunday autoresearch

Copy `.github/workflows/steward-autoresearch.example.yml` to
`.github/workflows/steward-autoresearch.yml`. Schedule: `0 2 * * 0`
(Sunday 02:00 UTC, lowest-traffic GHA window).

## Result shape

When autoresearch runs successfully, the journal records:

- **N per-candidate entries** (`event: autoresearch_candidate`):
  - `candidate_index`, `strategy_label`, `cost_usd`, `tokens_in/out`
  - `spec_pass`, `npm_pass`
  - `outcome: success` for passing, `failure` for rejected
- **1 winner entry** (`event: autoresearch_winner`):
  - `strategy_label` (which persona won)
  - `spec_margin` (criteria passed — feeds delta-anomaly detector next run)
  - `winner_method` — `consensus` (judge agreed) / `spec_margin_fallback`
    (judge disagreed, fell back to most-criteria-passed) / `sole_passing_candidate`
    / `strategy_collapse_first_pass`
  - `judge_used` — false when only 1 candidate passed or all collapsed
  - `delta_anomaly` — true when today exceeded rolling 7-day × multiplier

Lessons.jsonl (per Sprint 1.8.3) gets all-N entries — winners + rejected.
The rejected-candidate corpus seeds Sprint 3.0 AlphaEvolve prompt evolution.

## Failure modes + error codes

- `STEWARD_AUTORESEARCH_VERIFIER_TAMPERED` — criteria/policy hash changed
  during run; halt + investigate which candidate edited the registry
- `STEWARD_AUTORESEARCH_STRATEGY_COLLAPSE` — all N candidates >85% similar;
  diversity prompt isn't working, consider Verbalized Sampling (Sprint 2.1.1)
- `STEWARD_AUTORESEARCH_JUDGE_DISAGREEMENT` — both-orderings judge disagreed;
  PR labeled `judge-disagreement`, fallback winner = highest spec margin
- `STEWARD_AUTORESEARCH_RUN_USD_EXCEEDED` — $1/run cap tripped mid-run
- `STEWARD_AUTORESEARCH_TIME_EXCEEDED` — wall-clock cap tripped mid-run
- `STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED` — no candidate passed both
  spec-verifier AND npm test

## Operator-approved decisions (R1 memo §9)

The R1 memo flagged 6 open questions; operator-pre-approved decisions:

1. **Lessons.jsonl writes ALL-N** — winners + rejected. Seed for Sprint 3.0.
2. **Judge disagreement** → auto-fallback to most-spec-criteria-passed +
   PR label `judge-disagreement` for human awareness. Don't block.
3. **Verbalized Sampling** → defer to Sprint 2.1.1 (token budget interaction).
4. **N capped at [1, 10]**. Default 3. Contract test exercises 1/3/5/10.
5. **Sunday autoresearch** coexists with nightly cron — journal dedup handles.
6. **Run-level cost rollup primary**, candidate-level in journal phase entries.

## Caveats

- **Single-process serial today.** Sprint 2.2 (worktree supervisor) will
  parallelize. Until then, N candidates run sequentially via `git checkout`
  + `git clean` between them. Slightly slower but zero risk of inter-candidate
  contamination.
- **Judge cost is variable.** Sonnet 4.6 at $3/M input tokens is the default,
  but a 5K-input + 500-output judge call ≈ $0.02. Bumping to Opus 4.6 raises
  this to ~$0.04 per judge.
- **Token velocity cap (1.9.1)** at 50K/5min is fine for serial fan-out but
  Sprint 2.2's parallel workers will need either per-worker velocity sub-caps
  or a global bump.

## Related sprints

- **Sprint 1.9** — spec-verifier (the deterministic gate every candidate passes through)
- **Sprint 1.9.1** — multi-window cost safety + loop detector (autoresearch inherits)
- **Sprint 2.0** — Phoenix observability (autoresearch emits AGENT span with N + collapse + judge tags)
- **Sprint 2.0b** — model routing (autoresearch judge model honors `STEWARD_AUTORESEARCH_JUDGE_MODEL`)
- **Sprint 2.2** — worktree supervisor (parallel fan-out replaces serial loop)
- **Sprint 3.0** — AlphaEvolve prompt evolution (consumes rejected-candidate lessons)

## SSOT

Orchestrator + primitives — [`bin/steward/_lib/autoresearch.cjs`](../bin/steward/_lib/autoresearch.cjs).
Wire-up — [`bin/steward/execute.cjs runAutoresearchAction`](../bin/steward/execute.cjs).
Cron template — [`.github/workflows/steward-autoresearch.example.yml`](../.github/workflows/steward-autoresearch.example.yml).
