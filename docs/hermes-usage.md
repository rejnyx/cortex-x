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
| **L3 Triggers** | ⏳ v1 | + GitHub Actions cron fires weekly automatically | Add `ANTHROPIC_API_KEY` secret once |
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

## L2 walkthrough (preview — what v0.5 will do)

When the v0.5 PR lands, the seam at `bin/hermes/execute.cjs` swaps from a
stub to a real call. The flow becomes:

```
$ cortex-hermes dry-run --slug=cortex-x --json > /tmp/plan.json
$ cortex-hermes execute --plan-file=/tmp/plan.json
[hermes] reading plan... action: "Pivot v1 trigger to GitHub Actions"
[hermes] checking halt... ok
[hermes] acquiring lock... ok
[hermes] checking out branch hermes/2026-05-07-pivot-v1-trigger-...
[hermes] calling Claude Agent SDK with action context...
[hermes] applied 3 file edits across docs/, tools/, .github/
[hermes] running npm test... 408/408 pass
[hermes] git add . && git commit -F /tmp/commit-message.txt
[hermes] git push -u origin hermes/2026-05-07-pivot-v1-...
[hermes] gh pr create --draft
[hermes] PR opened: https://github.com/Rejnyx/cortex-x/pull/42
[hermes] journaled 'action_completed' / outcome=success
```

The `execute.cjs` stub today returns `V05_NOT_IMPLEMENTED` and exits 64
(`EX_USAGE`). It deliberately exists in v0 so:

- The CLI surface (`cortex-hermes execute --plan-file=...`) is locked in
- `.github/workflows/hermes.example.yml` can reference the execute step today
- The v0.5 PR is a clean SDK-integration patch, not architectural change
- Dave reviews the seam *before* deciding on the
  `@anthropic-ai/claude-agent-sdk` dependency that crosses the zero-deps
  invariant

## L3 setup (preview — production projects post-v0.5)

Per `docs/hermes-runtime.md` § 1.2, production projects get a GitHub Actions
workflow instead of local crontab:

```bash
# Per-project setup (one-time):
cp .github/workflows/hermes.example.yml .github/workflows/hermes.yml
# Edit hermes.yml to uncomment the schedule: block + the v0.5 SDK steps
# Add ANTHROPIC_API_KEY secret on GitHub:
gh secret set ANTHROPIC_API_KEY --body=$ANTHROPIC_API_KEY

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
npm test                   # 420 tests across all 8 tier gates
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
| `bin/hermes/execute.cjs` | v0.5 LLM seam (stub returning `V05_NOT_IMPLEMENTED`) |
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
