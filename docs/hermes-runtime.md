# Hermes Runtime — Implementation Design

> **Status:** Pre-implementation design (v0). Implementation 2-3 sessions ahead.
>
> **Date:** 2026-05-07 · **Author:** Dave Rajnoha (with Claude assistance) · **Reviewers:** TBD before first Hermes code merge.
>
> **Companions:**
> - [`docs/hermes-rfc.md`](./hermes-rfc.md) — motivation + open questions
> - [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md) — research decisions
> - [`standards/hermes-policy.md`](../standards/hermes-policy.md) — refusals + denylist + 7 MUST patterns

## 0. v0 scope (hardcoded)

Single-project, single-trigger, single-action-per-run. Everything beyond is **v1+** and explicitly out of scope.

| Concern | v0 | v1+ |
|---|---|---|
| Trigger sources | cron only | + on-incident, + on-PR-merged, + manual CLI |
| Target projects | cortex-x itself (dogfood) | RELO, Kiosek, Chatbot Platform, WaaS, Portfolio |
| Subagent escape hatch | none | opt-in read-only `investigate` |
| Cross-project pattern transfer | none | RELO pattern → propose in Chatbot Platform |
| `auto_improves:` PR pipeline (full self-improvement loop) | partial — runs `cortex-evolve` mining + drafts proposal PR | full multi-cadence pipeline |
| Conflict-on-pull resolution | halt + ping | opt-in side-branch LLM-drafted resolution |

**v0 success criteria** ([cited from synthesis](./hermes-research-synthesis.md#v0-success-criteria)):
1. Single weekly cron run on cortex-x produces a draft PR with ≤3 mining proposals
2. PR commits carry valid Git trailers
3. Journal is replayable
4. Kill switch produces clean exit within 30 sec
5. Fixture-based dry-run lives at `tests/fixtures/hermes-dryrun/`
6. Pre-Hermes hard gates Tier 4 + Tier 5 stay green

## 1. Five components

### 1.1 Core loop

Single-agent Claude Agent SDK session per Hermes run. Reads `cortex/recommendations.md`, picks the next action, executes via project's own tooling, verifies, atomic commits, opens draft PR, journals, exits.

**Pseudocode contract** (actual implementation TBD):

```typescript
async function runHermesIteration(opts: HermesRunOpts): Promise<HermesRunResult> {
  // Phase 0 — Pre-flight gates
  await ensureNotHalted()              // check ~/.cortex/HERMES_HALT + <repo>/.cortex/HERMES_HALT
  const lock = await acquireProjectLock(opts.slug)  // cortex/journal/<slug>/.lock
  await ensureCleanWorkingTree()       // git status --porcelain → empty (or stash)

  // Phase 1 — Action selection
  const recs = await readRecommendations(opts.repoRoot)
  const action = pickNextAction(recs, journal: await readJournal(opts.slug))
  if (!action) return { outcome: 'no_actionable_step' }

  // Phase 2 — Branch + execute
  const branch = `hermes/${today()}-${slug(action.title)}-${shortId()}`
  await git.checkoutB(branch)
  const result = await executeAction(action, opts.budget)
  if (result.tier >= 'T2') return await haltAndPing(action, result, lock)

  // Phase 3 — Atomic commit (MUST-H1)
  await git.add(result.touchedFiles)         // explicit paths only, never -A
  const commitSha = await git.commitWithTrailers(action, result)
  await verifyCommit(commitSha, result)      // post-commit SHA + clean tree

  // Phase 4 — Draft PR
  const pr = await gh.prCreateDraft({
    branch,
    title: conventionalCommit(action),
    body: prBodyFromAction(action, result),
  })

  // Phase 5 — Journal + release
  await appendJournal(opts.slug, {
    ts: now(), trigger: opts.trigger, tier: result.tier,
    event: 'action_completed',
    cost_usd: result.costUsd, tokens_in: result.tokensIn, tokens_out: result.tokensOut,
    outcome: 'success',
    actor: 'hermes',
  })
  await releaseLock(lock)
  return { outcome: 'success', pr: pr.url, commitSha, branch }
}
```

**Where it lives (planned):** `bin/hermes/` (TypeScript, compiled to one JS bundle). Loads `~/.cortex/hermes.yaml` for per-fleet defaults, then `<repo>/.cortex/hermes.yaml` for per-project overrides.

### 1.2 Trigger model

**v0 ships cron only.** Two cron variants by deployment target (decided 2026-05-07 after isolation discussion):

#### v0a — Local crontab (cortex-x dogfood only)

Installed during `cortex init` on Dave's machine, for the cortex-x self-dogfood phase:

```cron
# ~/.cortex/cron.d/hermes-cortex-x
0 4 * * 0  cd /path/to/cortex-x && ~/.cortex/bin/hermes run --slug=cortex-x --trigger=cron
```

Sunday 04:00 UTC matches `config/evolve.yaml` `cadence.weekly.cron` so Hermes mining stays aligned with the manual cadence.

**Constraints:** local-only, requires Dave's machine to be on, no isolation, no audit trail beyond `~/.cortex/journal/`. Acceptable for cortex-x dogfood (3-week proving window per `docs/hermes-research-synthesis.md` v0 assumption #4) but **not for production projects**.

#### v0b — GitHub Actions cron (production projects, default after dogfood)

For RELO / Kiosek / Chatbot Platform / WaaS and any Hermes-enabled project beyond cortex-x:

```yaml
# .github/workflows/hermes.yml
name: hermes
on:
  schedule:
    - cron: '0 4 * * 0'   # Sunday 04:00 UTC, matches local default
  workflow_dispatch:       # manual trigger via GH UI / gh cli

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write     # commit on hermes/<branch>
      pull-requests: write # gh pr create --draft
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0    # Hermes journal lookup needs full git history
      - uses: actions/setup-node@v5
        with: { node-version: '22' }
      - run: npm ci || npm install
      - run: node bin/cortex-hermes.cjs dry-run --slug=${{ github.event.repository.name }} --trigger=cron --json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}  # v0.5 only
          CORTEX_DATA_HOME: ${{ github.workspace }}/.cortex-data
      # v0.5+: if dry-run produced an action plan, run the real Hermes loop
      # (Claude Agent SDK call → file edits → git commit → gh pr create --draft)
```

**Why GitHub Actions over local crontab for production:**
- Free for personal repos (within minute limits)
- Built-in secret store (`ANTHROPIC_API_KEY` per repo)
- Ephemeral runner = no leftover state, no shared FS, isolation by default
- Audit trail in Actions UI (every run journaled by GitHub)
- Mirrors project's existing CI env (Hermes needs `npm test` / `npm run lint` to work — Actions already configures this)
- Built-in PR creation via `gh` CLI (no SSH-key juggling)
- Concurrency groups for mutex (`concurrency: { group: hermes-${{ github.event.repository.name }}, cancel-in-progress: false }`) — natural mapping of MUST-H2 mutex-by-slug

**When to use a self-hosted runner instead:** if minute limits become a constraint, or if 24/7 availability matters more than ephemeral isolation (Actions cold-start ~30s is fine for cron, slow for on-incident triage). Hetzner $5/mo VPS with `actions-runner` install = the pragmatic upgrade path.

**Mutex semantics** (per [`standards/hermes-policy.md`](../standards/hermes-policy.md) MUST-H2): the lock file `cortex/journal/<slug>/.lock` enforces "one Hermes run per project at a time". On GitHub Actions, the workflow `concurrency:` key provides a second layer of protection at the runner-orchestration level — the file lock + GHA concurrency together = belt-and-suspenders. Stale-lock recovery: if mtime > `2 × declared_action_timeout`, log `lock_recovered` and proceed.

**v1+ trigger sources** (designed, not shipped):
- **on-incident** — Sentry / PagerDuty webhook → triggers `repository_dispatch` event → GHA workflow runs Hermes with `--trigger=incident` and the incident payload as input
- **on-PR-merged** — GHA `pull_request` event with `types: [closed]` filter + `merged == true` check
- **manual** — `cortex hermes run --action <id> [--dry-run]` CLI subcommand for local development; GHA `workflow_dispatch` for triggered-by-human runs in production

A reference workflow template lives at [`.github/workflows/hermes.example.yml`](../.github/workflows/hermes.example.yml) — disabled (renamed to `.example.yml`) until v0.5 lands the LLM seam. Copy + rename to `hermes.yml` + add `ANTHROPIC_API_KEY` secret to enable.

### 1.3 Memory model

Three storage tiers, all under `~/.cortex/`:

```
~/.cortex/
├── journal/<slug>/<YYYY-MM-DD>.jsonl    # append-only event stream (MUST-H4)
├── hermes/state/<slug>.json              # last-known-good state for replay
├── hermes/cache/<slug>/                  # research / eval intermediate results
└── projects/<slug>.md                    # institutional wisdom (cortex SSOT, separate from Hermes)
```

**Journal contract** ([Zod schema in policy doc](../standards/hermes-policy.md#must-h4--append-only-structured-journal)). Future-Hermes reads its own history via `git log --format='%(trailers:key=Hermes-Journal-Entry)'` mapping to journal lines.

**State file** is a JSON snapshot updated on every iteration boundary. Lets a fresh Hermes session resume mid-run after a crash:

```json
{
  "slug": "cortex-x",
  "last_run": "2026-05-07T04:00:11Z",
  "last_action_id": "01HXG9F7Z8M2K9",
  "last_branch": "hermes/2026-05-07-evolve-mining-3a7f",
  "last_commit": "abc123def",
  "last_pr": "https://github.com/Rejnyx/cortex-x/pull/...",
  "lock_held": false
}
```

**Replayability** (v0 success criterion #3): `hermes run --replay <date>` re-reads the journal for that date and produces the same end state, modulo external API non-determinism (which is bounded by deterministic prompt + `replay_seed`).

### 1.4 Rollback contract

Per [`standards/hermes-policy.md`](../standards/hermes-policy.md) MUST-H1 + the saga compensating-transaction pattern:

| Failure | Rollback action | Journal entry |
|---|---|---|
| Verification failed (post-commit `git rev-parse` mismatch) | `git revert --no-edit <action-sha>` | `{event: "rollback_verification_failure", reverted: <sha>}` |
| Eval suite regression after Hermes commit | `git revert --no-edit <action-sha>` | `{event: "rollback_eval_regression", reverted: <sha>, eval_score: <delta>}` |
| Human marks PR `do not merge / revert` (label) | `git revert --no-edit <action-sha>` on next iteration | `{event: "rollback_human_request", reverted: <sha>}` |
| Branch deleted by human | None (state file marks branch dead, next iteration starts fresh) | `{event: "branch_dead_human"}` |

**Forbidden rollback methods** (already in `block-destructive.cjs`): `git reset --hard`, `git push --force`, `git filter-branch`, `git rebase -i` on pushed branches.

**Bidirectional audit chain:** every revert commit carries `Hermes-Reverts: <original-sha>`. Future-Hermes (and humans) can `git log --format='%(trailers:key=Hermes-Reverts)' --grep <sha>` to find the rollback for any action.

### 1.5 Safety layer

Three nested rings:

```
┌──────────────────────────────────────────────────────────┐
│  Ring 1: Hermes own policy check (this doc + policy.md)  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Ring 2: shared/hooks/block-destructive.cjs        │  │
│  │  (global hook, blocks human + subagent + Hermes)   │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Ring 3: branch-protection on protected      │  │  │
│  │  │  branches (main, master, release/*)          │  │  │
│  │  │  Hermes never authenticates as merge bot     │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

If Ring 1 has a bug, Ring 2 catches it. If Ring 2 has a bug (or is bypassed via direct `child_process.spawn`), Ring 3 catches it at the GitHub layer.

**Ring 1 (Hermes policy)** is the per-action denylist defined in [`standards/hermes-policy.md`](../standards/hermes-policy.md) § 3. It runs **before** any tool call, on the args struct (not a regex on `argv`).

**Ring 2 (block-destructive)** runs as a Claude Code PreToolUse hook on every Bash tool call. Already production. Hermes inherits.

**Ring 3 (GitHub branch protection)** is configured per-project in `.github/settings.yml` or via `gh repo edit` — Hermes never gets a token with `admin:org` or merge-bot permissions; the GitHub auth flow caps it at PR-creator scope.

## 2. Sequence flows

### 2.1 Cron flow (v0 — the only flow that ships)

```
┌─────────┐     ┌────────┐     ┌──────────┐     ┌────────┐     ┌────────┐
│  cron   │────>│ Hermes │────>│  policy  │────>│  exec  │────>│ commit │
└─────────┘     │  loop  │     │  check   │     │ tools  │     │   +    │
                └────┬───┘     └──────────┘     └───┬────┘     │  PR    │
                     │                              │          └────┬───┘
                     ▼                              ▼               │
                ┌────────┐                     ┌─────────┐          │
                │  HALT  │                     │ verify  │<─────────┘
                │ check  │                     │ + jrnl  │
                └────────┘                     └─────────┘
                     │                              │
              halt? ─┴───> exit 75            tier?─┴──> T0/T1: continue
                                                         T2: ping + pause
                                                         T3: halt + sentinel
```

Step-by-step:

1. **04:00 UTC Sunday** — cron fires `~/.cortex/bin/hermes run --slug=cortex-x --trigger=cron`
2. **HALT check** — if `~/.cortex/HERMES_HALT` or `<repo>/.cortex/HERMES_HALT` present → exit 75 with journal entry
3. **Lock acquire** — `cortex/journal/cortex-x/.lock` written with `{pid, start_ts, action_id}`
4. **Clean tree gate** — `git status --porcelain` empty (or stash + restore)
5. **Read recommendations** — parse `cortex/recommendations.md` "DO this week" section
6. **Pick action** — `pickNextAction()` selects first item not yet in journal as `{event: "action_completed", action_id: ...}`
7. **Branch checkout** — `git checkout -b hermes/2026-05-07-evolve-mining-a3f2`
8. **Execute** — run cortex-evolve mining (or whatever action #6 chose); collect `touchedFiles`, `costUsd`, `tier`
9. **Tier gate** — if `tier ≥ T2`, halt + ping (skip remaining)
10. **Atomic stage** — `git add -- <touchedFiles>` (explicit paths)
11. **Atomic commit** — Conventional Commits subject + Git trailers (`Hermes-Action-Id`, `Hermes-Journal-Entry`, `Hermes-Trigger=cron`, `Hermes-Recommendation-Source`)
12. **Post-verify** — `git status --porcelain` empty + `git rev-parse HEAD` matches journaled SHA
13. **Push** — `git push -u origin hermes/2026-05-07-evolve-mining-a3f2`
14. **Draft PR** — `gh pr create --draft --base main --head <branch>`
15. **Journal entry** — `{event: "action_completed", outcome: "success", pr_url, ...}`
16. **Lock release** — delete `.lock` file
17. **Exit 0**

### 2.2 Halt flow (kill switch + T3 escalation)

```
┌────────────────┐
│ tool-call      │
│ boundary       │
└──────┬─────────┘
       │
       ▼
┌──────────────────┐    no    ┌──────────────────┐
│ HERMES_HALT      ├────────> │ continue         │
│ exists?          │          └──────────────────┘
└──────┬───────────┘
       │ yes
       ▼
┌──────────────────────────────────────────┐
│ append journal: {event: "halted_by_..."}│
│ release lock                             │
│ exit 75 (EX_TEMPFAIL)                    │
└──────────────────────────────────────────┘
```

T3 escalation also writes `~/.cortex/journal/<slug>/HALTED` sentinel; `cortex doctor` refuses to start a new Hermes run while it exists. Human clears via `rm ~/.cortex/journal/<slug>/HALTED` after triage.

### 2.3 Verification + journal flow

```
ACT (edit files)
  │
  ▼
git add -- <explicit paths>
  │
  ▼
git commit -m "<conventional-subject>" \
   --trailer "Hermes-Action-Id=<ulid>" \
   --trailer "Hermes-Journal-Entry=~/.cortex/journal/<slug>/<date>.jsonl#L<n>" \
   --trailer "Hermes-Trigger=cron" \
   --trailer "Hermes-Recommendation-Source=cortex/recommendations.md#evolve-weekly"
  │
  ▼
verify: git rev-parse HEAD == journaled SHA
verify: git status --porcelain == empty
  │
  ├── pass ─> append journal: {outcome: "success", commit_sha, ...}
  └── fail ─> tier=T2; rollback: git revert --no-edit HEAD;
              journal: {outcome: "tainted", verify_failure: ...}
```

### 2.4 PR creation + draft-promotion flow

```
git push -u origin <branch>
  │
  ▼
gh pr create --draft \
   --title "<conventional commit subject>" \
   --body "<body with action-id, journal-link, recommendation-source>" \
   --base main --head <branch>
  │
  ▼
journal: {event: "pr_drafted", pr_url, ...}
  │
  ▼
[wait for CI to complete on next Hermes invocation, OR human review]
  │
  ▼
on next iteration:
  if CI green && atomic-commit-contract green && (eval green when applicable):
     gh pr ready <pr_url>
     journal: {event: "pr_promoted_to_ready", pr_url, ...}
  else:
     journal: {event: "pr_remains_draft", reason: ...}
     [no auto-merge, ever]
```

## 3. Inputs / outputs (per run)

### Inputs
- `cortex/recommendations.md` — "DO this week" section parsed for actionable items
- `~/.cortex/journal/<slug>/<date>.jsonl` (last 7 days) — for "what did I already try?"
- `~/.cortex/hermes.yaml` + `<repo>/.cortex/hermes.yaml` — config overrides
- `config/evolve.yaml` — `auto_improves:` / `human_only:` SSOT
- Project's own `package.json` / `tests/` / `evals/` — for verification commands

### Outputs
- One Git branch `hermes/<YYYY-MM-DD>-<slug>-<id>`
- One commit on that branch with Git trailers
- One draft PR against `main`
- One or more journal entries appended to `~/.cortex/journal/<slug>/<date>.jsonl`
- Updated `~/.cortex/hermes/state/<slug>.json`
- Released lock at `cortex/journal/<slug>/.lock`

### Idempotency
- Re-running the same trigger event (same `idempotency_key = {slug, trigger, event_hash}`) within 24 h is a no-op (journal lookup returns "already processed")
- Re-running with `--replay <date>` is deterministic given identical model + prompt cache

## 4. Open implementation questions (defer to first PR)

These do not need answers before drafting; they surface during implementation:

1. **Language/runtime.** TypeScript (compiled to one JS bundle) or Node CLI in `bin/`? Inclining toward TypeScript for type-safe journal schema + Zod boundary validation.
2. **Concurrent multi-action per run?** v0 spec says one action per run. Should the loop run until budget exhausted (multi-action) or one-action-only (simpler)? Answer in §0: **one action per run**, multi-action defers to v1.
3. **PR body templating.** Static template vs LLM-generated body? Lean toward static template with the action's recommendation-source + journal-pointer + action-id; PR body is metadata, not narrative.
4. **Investigate subagent tool-list.** `[Read, Grep, Glob]` per research brief — confirm at first need.
5. **Per-project `hermes.yaml` schema.** Override defaults: `cost_ceilings`, `cron_schedule`, `target_recommendations_section`, `eval_required`. Schema + Zod validator at first PR.

## 5. Out-of-scope explicitly (DO NOT BUILD in v0)

- ❌ Webhook receivers (incident, PR-merged) — Unix-socket listener + signature validation
- ❌ Manual CLI (`cortex hermes run --action <id>`)
- ❌ Investigate subagent activation (the carve-out from research stays paper-only in v0)
- ❌ Cross-project pattern transfer
- ❌ Auto-merge under any conditions (always draft → human review → human merge)
- ❌ Self-modifying Hermes prompts / standards / profiles (forbidden by `human_only:`)
- ❌ LLM-drafted conflict resolution
- ❌ Multi-action per run

## 6. Cross-references

- [`docs/hermes-rfc.md`](./hermes-rfc.md) — motivation + open questions (most now answered in synthesis)
- [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md) — research-grounded design decisions
- [`standards/hermes-policy.md`](../standards/hermes-policy.md) — refusals + denylist + 7 MUST patterns
- [`config/evolve.yaml`](../config/evolve.yaml) — auto_improves / human_only SSOT
- [`shared/hooks/block-destructive.cjs`](../shared/hooks/block-destructive.cjs) — Ring 2 safety
- [`tests/fixtures/hermes-dryrun/`](../tests/fixtures/hermes-dryrun/) — first dry-run target (TBD)

---

*Drafted 2026-05-07 alongside [`standards/hermes-policy.md`](../standards/hermes-policy.md) and [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md). Reviewed by Dave Rajnoha before first Hermes runtime PR.*
