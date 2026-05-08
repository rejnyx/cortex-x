# Steward — User Guide

> **What Steward is today (v0):** an autonomous *planning* loop. Reads
> `cortex/recommendations.md`, picks the next action, emits a structured plan
> with a valid Conventional-Commits message + Git trailers, journals the run.
> **It does NOT edit files or open PRs yet** — that's v0.5 (the Claude
> Agent SDK seam).
>
> **Why ship v0 without the LLM call:** every plumbing piece (halt-check,
> lock, journal, recommendations parser, git-trailer builder, policy
> denylist) is testable, deterministic, network-free. The Claude Agent SDK
> integration becomes one isolated PR instead of a refactor across 6 modules.
>
> **Companion docs:** [`docs/steward-rfc.md`](./steward-rfc.md) (motivation),
> [`docs/steward-runtime.md`](./steward-runtime.md) (5-component design),
> [`docs/steward-research-synthesis.md`](./steward-research-synthesis.md) (research),
> [`standards/steward-policy.md`](../standards/steward-policy.md) (refusals + MUST patterns).

## The 4-level autonomy ladder

Steward ships in deliberate stages. Each level layers on the previous; you can
stop at any level and still get value.

| Level | Status | What runs autonomously | What you still do manually |
|---|---|---|---|
| **L1 Planning** | ✅ shipped (v0) | Reads recommendations, picks action, emits plan with valid commit message + trailers | Make the file edits yourself, run `npm test`, commit, push, PR |
| **L2 Execution** | ⏳ v0.5 (1 PR away) | + Claude SDK calls → makes the file edits → runs `npm test` → atomic commit → draft PR | Review the draft PR, merge |
| **L3 Triggers** | ⏳ v1 | + GitHub Actions cron fires weekly automatically | Add `OPENROUTER_API_KEY` secret once |
| **L4 Recommendations** | ⏳ Phase 5 + v1 | + cortex-evolve weekly mining auto-generates new DO-this-week items | Review proposals occasionally |

**Hardcoded NEVER autonomous (per `standards/steward-policy.md` MUST-H6):**
auto-merging PRs. Steward opens drafts; humans always merge.

## Quick start (L1 — what you can do today)

### Prerequisites

- Project has a `cortex/recommendations.md` file with a parseable
  `## DO this week (cited)` section. See
  [`tests/fixtures/steward-dryrun/cortex/recommendations.md`](../tests/fixtures/steward-dryrun/cortex/recommendations.md)
  for the canonical shape, or copy + edit `cortex-x/cortex/recommendations.md`.
- `bin/cortex-steward.cjs` exists (it does — this repo).

### See what Steward WOULD do (no side effects)

```bash
# From any project root with a cortex/recommendations.md:
npm run hermes -- dry-run --slug=$(basename $PWD) --json

# or shorter:
node bin/cortex-steward.cjs dry-run --slug=cortex-x
```

Output: a structured JSON plan describing the next action — branch name,
Conventional Commits subject, body, full Git trailers (`Steward-Action-Id`,
`Steward-Journal-Entry`, `Steward-Trigger`, `Steward-Recommendation-Source`).

### Inspect Steward's current state

```bash
node bin/cortex-steward.cjs status --slug=cortex-x
```

Reports: halt status, lock status, recommendations health, journal rollup
(entries by outcome, cost + tokens totals, last 5 today). Use this to
diagnose "is Steward stuck?" or "did this week's run journal correctly?".

### Use the plan as a manual checklist

The plan is a JSON document. You can:

1. **Read the action:** `jq -r .action.title` + `jq -r .action.body`
2. **Read the planned commit message:** `jq -r .commit_message` — copy this
   wholesale into `git commit -F -` once you've made the edits manually
3. **Use the branch name:** `jq -r .branch` — `git checkout -b "$(jq -r .branch < plan.json)"`
4. **Trace the recommendation:** `jq -r .planned_commit.trailers["Steward-Recommendation-Source"]`
   tells you which line in recommendations.md drove the action

In other words: **at L1 you do the work, Steward does the bookkeeping.**

### Halt Steward immediately (the kill switch)

Two paths checked at every tool-call boundary:

```bash
# Halt all Steward runs across the fleet:
touch ~/.cortex/STEWARD_HALT

# Halt only this project:
touch <repo>/.cortex/STEWARD_HALT
```

Steward refuses to remove either file (Ring 1 policy denylist). When you've
resolved whatever caused the halt, **you** remove the sentinel:

```bash
rm ~/.cortex/STEWARD_HALT
```

## L2 walkthrough — what v0.5a does TODAY (mock engine)

v0.5a (Sprint 1.6.11) shipped the FULL execute pipeline minus the LLM call.
You can run it end-to-end RIGHT NOW with the mock engine:

```bash
# Step 1 — produce a plan
cortex-steward dry-run --slug=$(basename $PWD) --json > /tmp/plan.json

# Step 2 — execute with mock engine (writes specified files instead of LLM)
STEWARD_ENGINE=mock \
  STEWARD_MOCK_PLAN='{"edits":[{"path":"docs/example.md","content":"hello"}]}' \
  cortex-steward execute --plan-file=/tmp/plan.json
```

What this does:
- Halt-check + lock acquire
- Pre-flight clean-tree check
- Branch checkout (`steward/<YYYY-MM-DD>-<slug>-<id>`)
- Apply mock edits
- Run `npm test` (verification gate)
- Stage explicit paths + commit with full Git trailers
- Post-verify clean tree + journal `action_completed`
- Lock release

Verified end-to-end on a real cortex-x clone in Sprint 1.6.11 dogfood:
460/460 tests passed during verification, branch + commit + trailers all
correct, journal entry written. The only thing missing is the LLM that
produces the edit JSON — which is v0.5b.

## L2 walkthrough — what v0.5b does TODAY (real LLM via OpenRouter)

Shipped Sprint 1.6.13/14/15 (2026-05-07). **OpenRouter via built-in
`fetch()`** preserves the zero-deps invariant. See `docs/steward-runtime.md`
§ 4.5 for the architecture. v0.5b is the post-Sprint-1.6.13 default
engine — `claude-sdk` remains reachable via explicit `--engine=claude-sdk`.

### One-time setup

**1. Get an OpenRouter inference key** (NOT a provisioning/management key —
those return 401 "User not found" on completion calls):

- Sign up at [openrouter.ai](https://openrouter.ai), top up credits
- [openrouter.ai/keys](https://openrouter.ai/keys) → **Create Key** → standard
  inference key (the default — UI distinguishes inference vs provisioning)
- Verify it's an inference key:
  ```bash
  curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    https://openrouter.ai/api/v1/auth/key
  # Expect: "is_provisioning_key": false, "is_management_key": false
  ```

**2. Set env vars:**

```bash
# Bash / WSL
export OPENROUTER_API_KEY=sk-or-v1-...
export STEWARD_MODEL=deepseek/deepseek-v4-flash   # see § Model selection
export STEWARD_MAX_TOKENS=16384                   # default 4096 truncates multi-file edits
```

```powershell
# PowerShell (persistent + current session in one command)
$env:OPENROUTER_API_KEY="sk-or-v1-..."; $env:STEWARD_MODEL="deepseek/deepseek-v4-flash"; $env:STEWARD_MAX_TOKENS="16384"; [Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY",$env:OPENROUTER_API_KEY,"User"); [Environment]::SetEnvironmentVariable("STEWARD_MODEL",$env:STEWARD_MODEL,"User"); [Environment]::SetEnvironmentVariable("STEWARD_MAX_TOKENS",$env:STEWARD_MAX_TOKENS,"User")
```

### Run

```bash
cortex-steward dry-run --slug=$(basename $PWD) --json > /tmp/plan.json
cortex-steward execute --plan-file=/tmp/plan.json --engine=openrouter
```

`--engine=openrouter` is now the default — the explicit flag is shown for
clarity. Pipeline: dry-run produces plan → execute creates branch → real
LLM call returns `{edits: [...]}` → applied via path-safety guards →
`npm test` gate → atomic commit with Git trailers (or rollback on failure).

### Model selection (May 2026)

| Model | Cost (in/out per 1M) | When to use |
|---|---|---|
| `deepseek/deepseek-v4-flash` ⭐ | $0.14 / $0.28 | **Default** — cheapest viable, JSON mode reliable |
| `deepseek/deepseek-v3.2` | $0.28 / $0.42 | Battle-tested fallback if V4 Flash misbehaves |
| `anthropic/claude-haiku-4.5` | $1.00 / $5.00 | Anthropic-family voice match for `steward-policy.md` |
| `anthropic/claude-sonnet-4.5` | $3.00 / $15.00 | Complex multi-file actions; expensive for cron |

Cost per typical Steward call (~3K in / ~1.5K out): **DeepSeek V4 Flash ≈
$0.0008 → $8 budget = ~9500 runs**. Set per-key spend limit in OpenRouter
UI as a safety net.

### What gets captured in the journal

Every run records `cost_usd`, `tokens_in`, `tokens_out`, and `model` —
even on **failure paths** (action_failed, verify_failed,
post_verify_failed). LLM spend is incurred regardless of test outcome,
so the journal must reflect real spend per Sprint 1.6.15.

```bash
cortex-steward status --slug=$(basename $PWD)
# Shows: cost_usd_total: $X.YYYY, tokens: in=N, out=M (when > 0)
```

### Observability — live trace view (Sprint 2.0)

Optional. When unset, Steward runs identically; the journal stays the
single source of truth. When set, every run emits OpenInference + OTel
gen_ai spans to the configured OTLP HTTP endpoint, giving you a live
tree view of `AGENT → LLM/TOOL → ...` per run.

**Recommended local stack: Phoenix (Arize)** — single container, SQLite,
native OpenInference + native OpenRouter, the Tier-2 prompt-evolution
features Steward will need (Prompt Playground, LLM-as-Judge evals,
annotation queues) are open in the self-host (paywalled in Langfuse).
See [`docs/research/sprint-2.0-langfuse-observability-2026-05-08.md`](./research/sprint-2.0-langfuse-observability-2026-05-08.md)
for the full comparison + decision rationale.

```bash
# 1. (one-time) Start Phoenix as a sidecar:
docker compose -f templates/observability/docker-compose.phoenix.yml up -d

# 2. Phoenix UI: http://localhost:6006
#    OTLP receiver: http://localhost:6006/v1/traces

# 3. Tell Steward where to flush spans (per-shell or in your env file):
export STEWARD_OTEL_ENDPOINT=http://localhost:6006/v1/traces

# 4. Run a Steward action — spans batch + flush at run end:
cortex-steward execute --plan-file=plan.json

# 5. Open http://localhost:6006 → projects → cortex-x → traces
```

**Span tree per run:**

```
AGENT (workflow=steward-nightly)
├── LLM   (provider=openrouter, model=..., op=chat)         # recommendation kind only
├── TOOL  (name=spec_verifier)
├── TOOL  (name=npm_test)
└── TOOL  (name=git_commit_and_pr)
```

Every span carries BOTH OpenInference attributes (`openinference.span.kind`,
`llm.token_count.{prompt,completion,total}`, `llm.cost_usd`) AND OTel
gen_ai semconv (`gen_ai.system`, `gen_ai.usage.{input,output}_tokens`).
Phoenix renders OpenInference natively; future OTel-compatible backends
(Jaeger, Tempo, Grafana, future Langfuse upgrade) read gen_ai.

**Fail-open contract:**

- Endpoint unset → tracer is a no-op; run is identical to pre-2.0.
- Endpoint unreachable → run completes; one stderr warning per run
  (not per span); journal still written.
- Tracer errors NEVER fail the action.
- Journal SSOT preserved — every event a span captures is also in the
  JSONL journal at `~/.cortex/journal/<slug>/<date>.jsonl`. Phoenix is
  the **visual surface**, not the canonical record.

**Privacy posture:** Phoenix runs locally in Docker, binds to
`127.0.0.1` only, no telemetry leaves your machine. The `STEWARD_OTEL_ENDPOINT`
env var is the single switch — turn it off and you're back to journal-only.

### Troubleshooting

- **`OPENROUTER_PLAN_NOT_JSON`** + truncation around char 14000: bump
  `STEWARD_MAX_TOKENS` to 16384 or higher. Default 4096 truncates
  multi-file edit plans mid-string.
- **`401 User not found`**: inference key has the wrong type. Check
  `is_provisioning_key:false` per setup step 1.
- **DIRTY_TREE**: stash or commit unrelated working changes before
  running. Steward pre-flight enforces clean tree for deterministic
  rollback.
- **Same action keeps being skipped**: the journal marks an action as
  "processed" once any `dry_run_completed` event exists. Selection
  picks the next un-processed `DO this week` action; if all are
  processed for the day, dry-run returns `no_actionable_step`.

The flow:

## L3 setup (preview — production projects post-v0.5)

Per `docs/steward-runtime.md` § 1.2, production projects get a GitHub Actions
workflow instead of local crontab:

```bash
# Per-project setup (one-time):
cp .github/workflows/steward.example.yml .github/workflows/steward.yml
# Edit hermes.yml: uncomment the schedule: block + set STEWARD_MODEL/STEWARD_MAX_TOKENS env
# Add OPENROUTER_API_KEY secret on GitHub:
gh secret set OPENROUTER_API_KEY --body=$OPENROUTER_API_KEY

# Optional: trigger a manual run to verify
gh workflow run hermes.yml
```

Sunday 04:00 UTC → workflow fires → checkout → `npm ci` → `cortex-steward
dry-run` → if plan produced → `cortex-steward execute` → draft PR opened.

You'll see the run in the GitHub Actions UI. Journal artifact uploads with
30-day retention.

## How to know it's working (today, L1)

### Local dogfood test (cortex-x on cortex-x)

```bash
cd cortex-x
node bin/cortex-steward.cjs dry-run --slug=cortex-x --json
# Expect: ok=true, action.num=1 (or first un-journaled action)

node bin/cortex-steward.cjs status --slug=cortex-x
# Expect: not halted, recommendations OK, N journal entries today
```

### Programmatic test (CI-gated)

```bash
npm test                   # ~490 tests across all 8 tier gates (count current at HEAD)
npm run test:hermes        # Steward-only suite (132 tests in ~600ms)
npm run test:standards     # Tier 7 link integrity (13 tests)
npm run test:bin           # Tier 6 bin/ tools (13 tests)
```

CI lanes (`.github/workflows/test.yml` + `install-smoke.yml` + `no-pii.yml`)
gate every push to main.

### Validator suite (catches regressions)

```bash
npm run verify:standards   # 24 standards files: 0 broken links, 0 PII leaks
node tools/verify-prompts.cjs --strict   # 13 prompts: 0 broken links, 0 PII
node tools/verify-skills.cjs --strict    # 3 skills: agentskills.io v1 spec compliant
                                         # + Anthropic extensions when present
```

## What to do with this (concrete next steps)

1. **Run dogfood weekly on cortex-x** — `cortex-steward status` Mondays;
   `cortex-steward dry-run` to see what action #N would be. Use the plan as
   your checklist for that week's framework work.

2. **Add `<!-- denylist-example -->` markers to docs that quote forbidden
   strings** — when writing about PII regexes / denylists, mark the example
   line. Three sightings of the self-referential-PII-bug in one week =
   the helper exists for a reason.

3. **Decide on v0.5 timing.** The seam is documented. The CLI surface is
   stable. The GitHub Actions workflow is ready (disabled). The single
   architectural question is: **when do we cross zero-deps?** Recommendation:
   wait until cortex-x dogfood produces 3+ successful weekly runs (per
   `docs/steward-research-synthesis.md` v0 assumption #4) — that proves the
   plumbing is stable enough to layer the LLM on top.

4. **Don't try to enable `.github/workflows/steward.example.yml` today.** The
   v0.5 step is commented out for a reason — without the SDK call, the
   workflow runs `dry-run` (which works) but no actual code changes happen.
   Net result = a daily empty PR. Wait for v0.5.

5. **D-1 closes** before any first `v0.1.0` tag (external review priority #2).
   The git history PII purge requires a destructive force-push only Dave
   should run. Until D-1 closes, the repo stays private.

## Troubleshooting

### `MISSING_RECOMMENDATIONS` from dry-run

The slug doesn't have a `cortex/recommendations.md` at the project root.
Two fixes:
- Create one (see `tests/fixtures/steward-dryrun/cortex/recommendations.md`
  for the canonical shape)
- Or pass `--repo-root=<path>` if the file is somewhere else

### `LOCK_HELD` from dry-run

A previous Steward run didn't release its lock cleanly. Two fixes:
- Wait 60 minutes (auto-recovery: stale-lock detection if mtime > 2× the
  default 30-minute action timeout)
- Manually delete `<repo>/cortex/journal/<slug>/.lock` if you're certain
  no other process is running

### `SLUG_MISMATCH` from dry-run

The `--slug=` flag value differs from the `slug:` field in the
recommendations.md frontmatter. They MUST match — Steward uses the slug as
the journal directory name. Fix the recommendations.md frontmatter or pass
the matching `--slug`.

### `HALTED` from any subcommand (exit 75)

A `STEWARD_HALT` sentinel exists. Check `~/.cortex/STEWARD_HALT` (fleet) and
`<repo>/.cortex/STEWARD_HALT` (per-project). Remove the file when you've
resolved whatever caused the halt.

## File-by-file reference

| Path | Role |
|---|---|
| `bin/cortex-steward.cjs` | Unified CLI dispatcher (dry-run / status / execute) |
| `bin/steward/dry-run.cjs` | Plan emitter (no Claude SDK) — L1 today |
| `bin/steward/status.cjs` | Observability CLI |
| `bin/steward/execute.cjs` | Full execute pipeline (v0.5a). Pluggable engine via `STEWARD_ENGINE` env. |
| `bin/steward/_lib/verifier.cjs` | `npm test` runner with timeout + Win-shell fix |
| `bin/steward/_lib/git-ops.cjs` | Atomic git ops (no shell injection) |
| `bin/steward/_lib/action-engine.cjs` | Pluggable engines: `mock` (env-driven, ships v0.5a) + `openrouter` (v0.5b default — fetch + zero-deps) + `claude-sdk` (stub, opt-in via `--engine=claude-sdk`) |
| `bin/steward/_lib/halt-check.cjs` | MUST-H5 kill switch detection |
| `bin/steward/_lib/lock.cjs` | MUST-H2 mutex-by-slug |
| `bin/steward/_lib/journal.cjs` | MUST-H4 append-only writer + Zod-equivalent validation |
| `bin/steward/_lib/recommendations.cjs` | Parser for `cortex/recommendations.md` |
| `bin/steward/_lib/git-trailers.cjs` | MUST-H3 commit-message + ULID + parser |
| `bin/steward/_lib/policy-check.cjs` | Ring 1 denylist (over `block-destructive.cjs` Ring 2) |
| `cortex/recommendations.md` | Cortex-x's own DO-list (Steward target for self-dogfood) |
| `.github/workflows/steward.example.yml` | Reference GHA workflow (disabled until v0.5) |
| `tests/fixtures/steward-dryrun/` | Deterministic test target |
| `tests/unit/steward/` | 95+ unit tests across primitives + dispatcher + execute |
| `tests/integration/steward-dryrun.test.cjs` | 16 fixture-driven integration tests |

## Cross-references

- [`docs/steward-rfc.md`](./steward-rfc.md) — motivation + open questions
- [`docs/steward-runtime.md`](./steward-runtime.md) — 5-component implementation design
- [`docs/steward-research-synthesis.md`](./steward-research-synthesis.md) — research-grounded decisions
- [`standards/steward-policy.md`](../standards/steward-policy.md) — refusals + MUST patterns
- [`MIGRATIONS.md`](../MIGRATIONS.md) — Sprint 1.6.7 / 1.6.8 / 1.6.9 entries

---

*Updated 2026-05-07 alongside the Sprint 1.6.9 commit. Will be re-versioned
when v0.5 lands the Claude Agent SDK seam.*
