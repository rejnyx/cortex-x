---
title: Steward unsupervised dogfood plan
date: 2026-05-09
status: planning — awaiting operator approval
scope: First fully unsupervised Steward run on cortex-x repo itself. 7-day burn-in.
related:
  - docs/steward-roadmap.md (Tier 1 + Sprint 2.4 cost pivot context)
  - docs/steward-runtime.md (execution model)
  - docs/steward-usage.md (operator commands)
---

# Steward unsupervised dogfood plan

## 0. Why this exists

**Status as of 2026-05-09:**

- `.github/workflows/steward.yml` is **wired and merged** (cron `0 4 * * *` UTC, manual `workflow_dispatch` available).
- Repo secret `OPENROUTER_API_KEY` is **set** (created 2026-05-08 12:31 UTC).
- **Zero successful runs to date.** The first 04:00 UTC scheduled trigger is either pending (recent merge) or the workflow has never been invoked. Every Sprint 2.x to date has been operator-triggered and operator-reviewed before commit.
- Sprint 2.4 (claude-cli engine via Max sub) is shipped, so the unsupervised burn-in can run on operator's existing Anthropic Max x20 subscription at ~$0 marginal cost — falling back to OpenRouter only on auth failure.

**Dogfood = "eat your own dog food" = use your own product internally before shipping it to anyone else.** cortex-x has done this *partially*:

- Steward primitives ran on cortex-x repo during sprint dogfood (operator-supervised).
- 6-agent R2 review pipeline runs on cortex-x PRs continuously (this session, every sprint).
- `/cortex-init` field-tested 8× on real projects (RELO, Kiosek, Portfolio, OrderMage, lasertgame, osvc-tax, pix-prep, webovky_hustle).

**What we have NOT done:** let Steward run *autonomously, overnight, without operator review* against a production-track repo. This plan closes that gap. The cortex-x repo is the right first target because:

1. Steward primitives + spec-verifier + cost-safety + halt-check are all hardened (Sprints 1.6.x–1.9.1).
2. The repo is **operator-only** — no second contributor can be impacted by a runaway commit.
3. cortex-x has the most exhaustive test coverage of any repo we own (1349 tests).
4. Every action is gated by `npm test` + spec-verifier + draft PR (not merge) — operator reviews each PR manually before merge.

## 1. Pre-conditions (must hold before enabling)

Each pre-condition is a binary check. **All must be ✅** before kicking off Day 0.

| # | Check | How to verify | Status |
|---|---|---|---|
| 1 | Steward nightly workflow exists + is enabled | `gh workflow list \| grep steward` | ✅ (steward.yml committed 2026-05-08) |
| 2 | `OPENROUTER_API_KEY` repo secret set + valid | `gh secret list` shows entry; manual `OPENROUTER_API_KEY=… node bin/cortex-steward.cjs execute --dry-run` returns plan | ✅ secret set 2026-05-08; runtime validation pending |
| 3 | `STEWARD_DAILY_USD_CAP` configured | env in workflow yaml or repo variable; default `$5` | ⚠️ verify in `.github/workflows/steward.yml` |
| 4 | `STEWARD_FAILURE_BREAKER` configured | default `3` consecutive failures within 1h | ⚠️ verify in workflow yaml |
| 5 | `STEWARD_WEEKLY_USD_CAP` + `STEWARD_MONTHLY_USD_CAP` set | Sprint 1.9.1 caps; default `$25` / `$80` | ⚠️ verify in workflow env |
| 6 | `cortex/recommendations.md` has ≥ 3 actionable items | manual file read; if empty, harvester populates first | ⚠️ check current state |
| 7 | Halt file absent | `test ! -f .cortex/STEWARD_HALT` | ⚠️ check |
| 8 | Spec-verifier passes on all 11 action_kinds | run `npm run test:contract` includes spec-verifier checks | ✅ implicit (CI green) |
| 9 | Last 5 commits on main are clean | `git log -5 --oneline` shows green CI history | ✅ |
| 10 | Operator notification channel reachable | Sprint 2.6 Discord bridge OR email-on-workflow-failure | ⚠️ Discord bridge v0 alpha — Gateway WebSocket not yet wired (Sprint 2.6.1 v2 pending) |

**Items 3, 4, 5, 6, 7, 10 need verification before Day 0.**

## 2. Day 0 — pre-flight (operator + me, ~30 min)

**Goal**: confirm all 10 pre-conditions, run one operator-supervised cron-equivalent run end-to-end, freeze main.

Sequence:

1. **Verify env in `.github/workflows/steward.yml`**: confirm `STEWARD_DAILY_USD_CAP`, `STEWARD_WEEKLY_USD_CAP`, `STEWARD_MONTHLY_USD_CAP`, `STEWARD_FAILURE_BREAKER`, `STEWARD_TOKEN_VELOCITY_CAP` all present. If missing, add as workflow `env:` block (not secrets — these are ceiling values, not secrets).
2. **Recommendations primer**: ensure `cortex/recommendations.md` has at least 3 small, low-risk recommendations seeded. If empty, run harvester manually first: `node bin/cortex-steward.cjs harvest --since=7d`.
3. **Operator-supervised first run**: trigger workflow manually via `gh workflow run steward.yml`. Watch output. Confirm:
   - Plan generated (dry-run output in step logs).
   - Action selected from recommendations.md (one item consumed).
   - Spec-verifier gate passed (or cleanly rejected — both are valid).
   - `npm test` ran green.
   - Branch pushed: `steward/<action_id>`.
   - Draft PR opened (operator can manually review + merge or close).
   - Journal entry written: `cortex/journal/<date>.jsonl` has new event.
   - Cost ≤ $0.005.
4. **If Day-0 supervised run is clean**: leave cron enabled; document the run in `cortex/journal/`.
5. **If Day-0 supervised run fails or surfaces unexpected behavior**: **abort dogfood plan**, fix root cause via normal sprint workflow, retry Day 0 next session.

## 3. Days 1–7 — unsupervised burn-in

**Daily routine** (operator side, ~5 min morning):

1. Open Discord (when 2.6.1 v2 Gateway WebSocket lands) OR open `gh run list --workflow=steward.yml --limit=2` in terminal.
2. Read journal entries for last 24h: `node bin/cortex-steward.cjs status --since=24h`.
3. Review any draft PRs Steward opened: `gh pr list --search "is:draft author:app/github-actions"`.
4. Decide per PR: merge / request changes / close.
5. Spot-check cost rollup: `node bin/cortex-steward.cjs status --forecast` (Sprint 1.9.1 cmd).

**Halt triggers** (Steward stops itself, no operator action needed):

| Trigger | Mechanism | Ship state |
|---|---|---|
| Daily $5 cap exhausted | `STEWARD_DAILY_USD_CAP` | ✅ Sprint 1.6.19 |
| Weekly $25 cap exhausted | `STEWARD_WEEKLY_USD_CAP` | ✅ Sprint 1.9.1 |
| Monthly $80 cap exhausted | `STEWARD_MONTHLY_USD_CAP` | ✅ Sprint 1.9.1 |
| 50K tokens / 5min velocity spike | `STEWARD_TOKEN_VELOCITY_CAP` | ✅ Sprint 1.9.1 |
| 3 consecutive failures of same action_id | `STEWARD_FAILURE_BREAKER` | ✅ Sprint 1.6.19 |
| Cross-session loop detector (5× same criterion in 7d) | Sprint 1.9.1 detector → writes `STEWARD_HALT` | ✅ Sprint 1.9.1 |
| `total_cost_usd ≠ 0` from claude-cli (billing leak) | Sprint 2.4 three-layer defense → writes `STEWARD_HALT` | ✅ Sprint 2.4 |
| Spec-verifier rejects action | per Sprint 1.9.0 `acceptance_criteria[]` | ✅ Sprint 1.9.0 |
| `npm test` regresses | atomic rollback per Sprint 1.6.11 | ✅ Sprint 1.6.11 |

**Operator-issued halt** (anytime, manual override):

```bash
# Terminal:
echo "$(date -Iseconds): operator halt" > .cortex/STEWARD_HALT
git add .cortex/STEWARD_HALT && git commit -m "chore: operator halt" && git push

# Or via Discord (Sprint 2.6 alpha):
!halt manual operator stop
```

## 4. Daily success criteria

Each day's run is "successful" if **all** of:

1. ≤ $5 daily cost (per workflow run logs).
2. ≤ 2 failed actions in 24h (excluding clean spec-verifier rejections — those are signal, not failure).
3. ≥ 1 draft PR opened OR clean exit "no actionable recommendation" (both valid).
4. Zero `STEWARD_HALT` writes (other than operator-issued).
5. All 3 CI lanes green on every Steward-opened PR (test / install-smoke / no-pii).
6. Journal `cortex/journal/<date>.jsonl` has expected event sequence (one per action attempt).

**Day 7 acceptance gate** (decides Tier 2 progression):

- ≥ 5 days in 7 hit "successful" definition above.
- ≤ 1 emergency operator halt across full burn-in.
- Total spend across 7 days ≤ $20 (well under $25 weekly cap).
- ≥ 3 Steward-opened PRs merged successfully by operator.
- Zero spec-verifier escapes (every committed change passed verification).
- No regression in `npm test` count or coverage.

If gate passes → green-light Tier 2 (Sprint 3.0 AlphaEvolve + Sprint 3.1 self-extending capabilities). If gate fails → **diagnose root cause**, file findings in `cortex/lessons.jsonl` via Sprint 2.8 schema, fix, retry burn-in next sprint.

## 5. Failure mode catalog (what we expect to break + how)

Honest list of failure modes Steward might hit during burn-in. Each one has a known defense; this is a sanity check that the defense actually fires.

| Failure mode | Defense | Test during burn-in |
|---|---|---|
| OpenRouter 401 mid-run | `OPENROUTER_KEY_MALFORMED` clean reject + workflow exit | If happens → check secret value (trailing newline?) |
| Anthropic Max cap exhausted | `CLAUDE_CLI_AUTH_REJECTED` → fallback to OpenRouter engine | If happens → confirm fallback engaged in journal |
| LLM produces malformed JSON | `OPENROUTER_PLAN_SHAPE_INVALID` → retry budget exhausted → clean abort | If happens → check edit-plan rendering in step logs |
| Recommendation requires destructive edit + no `acceptance_criteria[]` | spec-verifier rejects → action skipped, recommendations.md item NOT consumed | Confirm criterion gate fired in journal |
| Race: two cron triggers within 1h | `concurrency` group queues second run | Check workflow concurrency log |
| GitHub API rate limit on `gh pr create` | exponential backoff + journal `GITHUB_API_THROTTLE` | If happens → confirm backoff entry, no duplicate PRs |
| Discord bridge silent (Sprint 2.6 alpha not yet wired) | Operator falls back to email-on-failure (GitHub default) | Discord bridge is bonus, not gate |
| Disk full on runner | GHA runner ephemeral; retry next cron trigger | N/A — GHA handles |
| Operator-introduced merge conflict on main | Steward branches off latest main; if conflict → push fails → journal `GIT_PUSH_REJECTED` | Manual merge clears |

## 6. What we will learn (success looks like data)

After 7 days, we have:

- **Cost ledger**: exact $/day spent, breakdown by action_kind, baseline for Tier 2 budget.
- **Action distribution**: which action_kinds Steward chose most often (probably `recommendation` if items in recommendations.md; `dep_update_patch` weekly; `tech_debt_audit` if drift).
- **Failure frequency**: real measurement of how often each defense fires. Today this is theoretical.
- **PR quality signal**: of Steward's draft PRs, what % did operator merge unchanged vs. request changes vs. close? This is the **actual throughput-per-operator-hour** number from North Star metric #2.
- **First real lesson harvest**: Sprint 2.8 lessons.jsonl gets its first 7 days of unsupervised operation data.
- **Spec-verifier reject rate**: how often does the verifier catch what `npm test` would have missed? Sprint 1.9.0's value, finally measured.

These metrics feed Sprint 2.2 (worktree supervisor sizing — how many parallel workers can $5/day support?) and Sprint 3.0 (AlphaEvolve baseline — what's the prompt-quality starting point we're trying to beat?).

## 7. Rollback procedure (kill switch)

If at any point during burn-in something goes wrong:

```bash
# 1. Halt Steward immediately:
echo "$(date -Iseconds): emergency halt" > .cortex/STEWARD_HALT
git add .cortex/STEWARD_HALT && git commit -m "halt: emergency" && git push

# 2. Disable cron:
gh workflow disable steward.yml

# 3. (Optional) Cancel any in-flight run:
gh run cancel <run-id>

# 4. (Optional) Revert any Steward commits since burn-in start:
git log --author="github-actions" --since="7 days ago"
git revert <sha>  # one at a time, with operator review

# 5. File post-mortem in cortex/lessons.jsonl per Sprint 2.8 schema.
```

**Re-enabling after rollback**: only after root cause is fixed + a fresh Day-0 supervised run is clean. Don't just re-enable cron and hope.

## 8. Decision

Awaiting operator approval to:

1. **Verify pre-conditions 3-10** (small workflow audit, ~10 min).
2. **Trigger Day-0 supervised run** (`gh workflow run steward.yml` + watch).
3. **If clean: leave cron enabled for 7-day burn-in.**
4. **Daily 5-min review + Day 7 acceptance gate.**

Cost projection: ≤ $20 across 7 days at full daily-cap utilization (most likely ≤ $1 actual based on $0.0008/run baseline).

## 9. Why "dogfood" is the right metaphor

Term origin: 1980s Microsoft / IBM ("eating your own dog food" — using internal product builds before shipping). The metaphor captures three things:

1. **Skin in the game**: if it's bad, *you* suffer first, not the customer. cortex-x running on cortex-x means *we* eat the bad PRs.
2. **Real-world surface**: synthetic tests miss what production exposes. 7-day burn-in reveals failure modes that 1349 unit tests don't.
3. **Confidence transfer**: if it works on us, we've earned the right to say "this works" to anyone else (RELO, Kiosek, future cortex-x users).

The R3 principle (one incident class = one defense + one regression test) compounds with dogfood: every burn-in failure becomes a permanent test. After 7 days, cortex-x's defenses are not theoretical — they're battle-tested.
