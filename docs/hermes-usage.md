# Hermes — User Guide

> **What Hermes is today (v0):** an autonomous *planning* loop. Reads
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
> **Companion docs:** [`docs/hermes-rfc.md`](./hermes-rfc.md) (motivation),
> [`docs/hermes-runtime.md`](./hermes-runtime.md) (5-component design),
> [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md) (research),
> [`standards/hermes-policy.md`](../standards/hermes-policy.md) (refusals + MUST patterns).

## The 4-level autonomy ladder

Hermes ships in deliberate stages. Each level layers on the previous; you can
stop at any level and still get value.

| Level | Status | What runs autonomously | What you still do manually |
|---|---|---|---|
| **L1 Planning** | ✅ shipped (v0) | Reads recommendations, picks action, emits plan with valid commit message + trailers | Make the file edits yourself, run `npm test`, commit, push, PR |
| **L2 Execution** | ⏳ v0.5 (1 PR away) | + Claude SDK calls → makes the file edits → runs `npm test` → atomic commit → draft PR | Review the draft PR, merge |
| **L3 Triggers** | ⏳ v1 | + GitHub Actions cron fires weekly automatically | Add `OPENROUTER_API_KEY` secret once |
| **L4 Recommendations** | ⏳ Phase 5 + v1 | + cortex-evolve weekly mining auto-generates new DO-this-week items | Review proposals occasionally |

**Hardcoded NEVER autonomous (per `standards/hermes-policy.md` MUST-H6):**
auto-merging PRs. Hermes opens drafts; humans always merge.

## Quick start (L1 — what you can do today)

### Prerequisites

- Project has a `cortex/recommendations.md` file with a parseable
  `## DO this week (cited)` section. See
  [`tests/fixtures/hermes-dryrun/cortex/recommendations.md`](../tests/fixtures/hermes-dryrun/cortex/recommendations.md)
  for the canonical shape, or copy + edit `cortex-x/cortex/recommendations.md`.
- `bin/cortex-hermes.cjs` exists (it does — this repo).

### See what Hermes WOULD do (no side effects)

```bash
# From any project root with a cortex/recommendations.md:
npm run hermes -- dry-run --slug=$(basename $PWD) --json

# or shorter:
node bin/cortex-hermes.cjs dry-run --slug=cortex-x
```

Output: a structured JSON plan describing the next action — branch name,
Conventional Commits subject, body, full Git trailers (`Hermes-Action-Id`,
`Hermes-Journal-Entry`, `Hermes-Trigger`, `Hermes-Recommendation-Source`).

### Inspect Hermes's current state

```bash
node bin/cortex-hermes.cjs status --slug=cortex-x
```

Reports: halt status, lock status, recommendations health, journal rollup
(entries by outcome, cost + tokens totals, last 5 today). Use this to
diagnose "is Hermes stuck?" or "did this week's run journal correctly?".

### Use the plan as a manual checklist

The plan is a JSON document. You can:

1. **Read the action:** `jq -r .action.title` + `jq -r .action.body`
2. **Read the planned commit message:** `jq -r .commit_message` — copy this
   wholesale into `git commit -F -` once you've made the edits manually
3. **Use the branch name:** `jq -r .branch` — `git checkout -b "$(jq -r .branch < plan.json)"`
4. **Trace the recommendation:** `jq -r .planned_commit.trailers["Hermes-Recommendation-Source"]`
   tells you which line in recommendations.md drove the action

In other words: **at L1 you do the work, Hermes does the bookkeeping.**

### Halt Hermes immediately (the kill switch)

Two paths checked at every tool-call boundary:

```bash
# Halt all Hermes runs across the fleet:
touch ~/.cortex/HERMES_HALT

# Halt only this project:
touch <repo>/.cortex/HERMES_HALT
```

Hermes refuses to remove either file (Ring 1 policy denylist). When you've
resolved whatever caused the halt, **you** remove the sentinel:

```bash
rm ~/.cortex/HERMES_HALT
```

## L2 walkthrough — what v0.5a does TODAY (mock engine)

v0.5a (Sprint 1.6.11) shipped the FULL execute pipeline minus the LLM call.
You can run it end-to-end RIGHT NOW with the mock engine:

```bash
# Step 1 — produce a plan
cortex-hermes dry-run --slug=$(basename $PWD) --json > /tmp/plan.json

# Step 2 — execute with mock engine (writes specified files instead of LLM)
HERMES_ENGINE=mock \
  HERMES_MOCK_PLAN='{"edits":[{"path":"docs/example.md","content":"hello"}]}' \
  cortex-hermes execute --plan-file=/tmp/plan.json
```

What this does:
- Halt-check + lock acquire
- Pre-flight clean-tree check
- Branch checkout (`hermes/<YYYY-MM-DD>-<slug>-<id>`)
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
`fetch()`** preserves the zero-deps invariant. See `docs/hermes-runtime.md`
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
export HERMES_MODEL=deepseek/deepseek-v4-flash   # see § Model selection
export HERMES_MAX_TOKENS=16384                   # default 4096 truncates multi-file edits
```

```powershell
# PowerShell (persistent + current session in one command)
$env:OPENROUTER_API_KEY="sk-or-v1-..."; $env:HERMES_MODEL="deepseek/deepseek-v4-flash"; $env:HERMES_MAX_TOKENS="16384"; [Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY",$env:OPENROUTER_API_KEY,"User"); [Environment]::SetEnvironmentVariable("HERMES_MODEL",$env:HERMES_MODEL,"User"); [Environment]::SetEnvironmentVariable("HERMES_MAX_TOKENS",$env:HERMES_MAX_TOKENS,"User")
```

### Run

```bash
cortex-hermes dry-run --slug=$(basename $PWD) --json > /tmp/plan.json
cortex-hermes execute --plan-file=/tmp/plan.json --engine=openrouter
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
| `anthropic/claude-haiku-4.5` | $1.00 / $5.00 | Anthropic-family voice match for `hermes-policy.md` |
| `anthropic/claude-sonnet-4.5` | $3.00 / $15.00 | Complex multi-file actions; expensive for cron |

Cost per typical Hermes call (~3K in / ~1.5K out): **DeepSeek V4 Flash ≈
$0.0008 → $8 budget = ~9500 runs**. Set per-key spend limit in OpenRouter
UI as a safety net.

### What gets captured in the journal

Every run records `cost_usd`, `tokens_in`, `tokens_out`, and `model` —
even on **failure paths** (action_failed, verify_failed,
post_verify_failed). LLM spend is incurred regardless of test outcome,
so the journal must reflect real spend per Sprint 1.6.15.

```bash
cortex-hermes status --slug=$(basename $PWD)
# Shows: cost_usd_total: $X.YYYY, tokens: in=N, out=M (when > 0)
```

### Troubleshooting

- **`OPENROUTER_PLAN_NOT_JSON`** + truncation around char 14000: bump
  `HERMES_MAX_TOKENS` to 16384 or higher. Default 4096 truncates
  multi-file edit plans mid-string.
- **`401 User not found`**: inference key has the wrong type. Check
  `is_provisioning_key:false` per setup step 1.
- **DIRTY_TREE**: stash or commit unrelated working changes before
  running. Hermes pre-flight enforces clean tree for deterministic
  rollback.
- **Same action keeps being skipped**: the journal marks an action as
  "processed" once any `dry_run_completed` event exists. Selection
  picks the next un-processed `DO this week` action; if all are
  processed for the day, dry-run returns `no_actionable_step`.

The flow:

## L3 setup (preview — production projects post-v0.5)

Per `docs/hermes-runtime.md` § 1.2, production projects get a GitHub Actions
workflow instead of local crontab:

```bash
# Per-project setup (one-time):
cp .github/workflows/hermes.example.yml .github/workflows/hermes.yml
# Edit hermes.yml: uncomment the schedule: block + set HERMES_MODEL/HERMES_MAX_TOKENS env
# Add OPENROUTER_API_KEY secret on GitHub:
gh secret set OPENROUTER_API_KEY --body=$OPENROUTER_API_KEY

# Optional: trigger a manual run to verify
gh workflow run hermes.yml
```

Sunday 04:00 UTC → workflow fires → checkout → `npm ci` → `cortex-hermes
dry-run` → if plan produced → `cortex-hermes execute` → draft PR opened.

You'll see the run in the GitHub Actions UI. Journal artifact uploads with
30-day retention.

## How to know it's working (today, L1)

### Local dogfood test (cortex-x on cortex-x)

```bash
cd cortex-x
node bin/cortex-hermes.cjs dry-run --slug=cortex-x --json
# Expect: ok=true, action.num=1 (or first un-journaled action)

node bin/cortex-hermes.cjs status --slug=cortex-x
# Expect: not halted, recommendations OK, N journal entries today
```

### Programmatic test (CI-gated)

```bash
npm test                   # 475 tests across all 8 tier gates
npm run test:hermes        # Hermes-only suite (132 tests in ~600ms)
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

1. **Run dogfood weekly on cortex-x** — `cortex-hermes status` Mondays;
   `cortex-hermes dry-run` to see what action #N would be. Use the plan as
   your checklist for that week's framework work.

2. **Add `<!-- denylist-example -->` markers to docs that quote forbidden
   strings** — when writing about PII regexes / denylists, mark the example
   line. Three sightings of the self-referential-PII-bug in one week =
   the helper exists for a reason.

3. **Decide on v0.5 timing.** The seam is documented. The CLI surface is
   stable. The GitHub Actions workflow is ready (disabled). The single
   architectural question is: **when do we cross zero-deps?** Recommendation:
   wait until cortex-x dogfood produces 3+ successful weekly runs (per
   `docs/hermes-research-synthesis.md` v0 assumption #4) — that proves the
   plumbing is stable enough to layer the LLM on top.

4. **Don't try to enable `.github/workflows/hermes.example.yml` today.** The
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
- Create one (see `tests/fixtures/hermes-dryrun/cortex/recommendations.md`
  for the canonical shape)
- Or pass `--repo-root=<path>` if the file is somewhere else

### `LOCK_HELD` from dry-run

A previous Hermes run didn't release its lock cleanly. Two fixes:
- Wait 60 minutes (auto-recovery: stale-lock detection if mtime > 2× the
  default 30-minute action timeout)
- Manually delete `<repo>/cortex/journal/<slug>/.lock` if you're certain
  no other process is running

### `SLUG_MISMATCH` from dry-run

The `--slug=` flag value differs from the `slug:` field in the
recommendations.md frontmatter. They MUST match — Hermes uses the slug as
the journal directory name. Fix the recommendations.md frontmatter or pass
the matching `--slug`.

### `HALTED` from any subcommand (exit 75)

A `HERMES_HALT` sentinel exists. Check `~/.cortex/HERMES_HALT` (fleet) and
`<repo>/.cortex/HERMES_HALT` (per-project). Remove the file when you've
resolved whatever caused the halt.

## File-by-file reference

| Path | Role |
|---|---|
| `bin/cortex-hermes.cjs` | Unified CLI dispatcher (dry-run / status / execute) |
| `bin/hermes/dry-run.cjs` | Plan emitter (no Claude SDK) — L1 today |
| `bin/hermes/status.cjs` | Observability CLI |
| `bin/hermes/execute.cjs` | Full execute pipeline (v0.5a). Pluggable engine via `HERMES_ENGINE` env. |
| `bin/hermes/_lib/verifier.cjs` | `npm test` runner with timeout + Win-shell fix |
| `bin/hermes/_lib/git-ops.cjs` | Atomic git ops (no shell injection) |
| `bin/hermes/_lib/action-engine.cjs` | Pluggable engines: `mock` (env-driven, ships v0.5a) + `openrouter` (v0.5b default — fetch + zero-deps) + `claude-sdk` (stub, opt-in via `--engine=claude-sdk`) |
| `bin/hermes/_lib/halt-check.cjs` | MUST-H5 kill switch detection |
| `bin/hermes/_lib/lock.cjs` | MUST-H2 mutex-by-slug |
| `bin/hermes/_lib/journal.cjs` | MUST-H4 append-only writer + Zod-equivalent validation |
| `bin/hermes/_lib/recommendations.cjs` | Parser for `cortex/recommendations.md` |
| `bin/hermes/_lib/git-trailers.cjs` | MUST-H3 commit-message + ULID + parser |
| `bin/hermes/_lib/policy-check.cjs` | Ring 1 denylist (over `block-destructive.cjs` Ring 2) |
| `cortex/recommendations.md` | Cortex-x's own DO-list (Hermes target for self-dogfood) |
| `.github/workflows/hermes.example.yml` | Reference GHA workflow (disabled until v0.5) |
| `tests/fixtures/hermes-dryrun/` | Deterministic test target |
| `tests/unit/hermes/` | 95+ unit tests across primitives + dispatcher + execute |
| `tests/integration/hermes-dryrun.test.cjs` | 16 fixture-driven integration tests |

## Cross-references

- [`docs/hermes-rfc.md`](./hermes-rfc.md) — motivation + open questions
- [`docs/hermes-runtime.md`](./hermes-runtime.md) — 5-component implementation design
- [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md) — research-grounded decisions
- [`standards/hermes-policy.md`](../standards/hermes-policy.md) — refusals + MUST patterns
- [`MIGRATIONS.md`](../MIGRATIONS.md) — Sprint 1.6.7 / 1.6.8 / 1.6.9 entries

---

*Updated 2026-05-07 alongside the Sprint 1.6.9 commit. Will be re-versioned
when v0.5 lands the Claude Agent SDK seam.*
