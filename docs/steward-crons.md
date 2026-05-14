---
title: Steward cron lanes — reference + operator playbook
audience: operator + downstream user + AI agent debugging or extending cortex-x
date: 2026-05-14
---

# Steward cron lanes — what runs when, what it produces, how to debug

> **TL;DR**: cortex-x ships **17 GitHub Actions workflows** under `.github/workflows/steward-*.yml` (plus `steward.yml`). **15 are scheduled crons**, 2 are manual-trigger only. Each cron lane is one Steward `action_kind` running at its own cadence. Output is either a draft PR (write-path lanes) or a journal artifact + maybe a `gh issue` (read-only lanes). All gated on `npm test` passing before commit, atomic rollback on any failure phase.
>
> **Companion docs**: [`steward-usage.md`](./steward-usage.md) (overall user guide), [`steward-runtime.md`](./steward-runtime.md) (5-component design), [`steward-routing.md`](./steward-routing.md) (per-kind LLM model selection), [`standards/steward-policy.md`](../standards/steward-policy.md) (refusal rules).

## 1. Inventory — all 17 workflows at a glance

### Daily

| Workflow | UTC schedule | action_kind | LLM call? | Write path | Typical output |
|---|---|---|---|---|---|
| `steward.yml` (nightly main) | `0 4 * * *` (04:00) | `recommendation` (default) | ✅ yes | ✅ commits + draft PR | One PR closing first unchecked `## DO this week` item from `cortex/recommendations.md` |
| `steward-harvest` | `0 3 * * *` (03:00) | `recommendation_harvest` | ❌ no (deterministic) | ✅ appends to recs.md + draft PR | New candidate rows added to `recommendations.md ## Backlog` based on closed PRs / CI failures / open issues |
| `steward-evolve-daily` | `0 3 * * *` (03:00) | `evolve_daily` | ❌ no | ❌ read-only | Advisory rollup written to `~/.cortex/insights/proposals/<date>-evolve-daily.md` |

### Every 4 hours

| Workflow | UTC schedule | action_kind | LLM call? | Write path | Typical output |
|---|---|---|---|---|---|
| `steward-pr-review-responder` | `0 */4 * * *` | `pr_review_responder` | ❌ no (deterministic v1) | ❌ files gh issue | One `gh issue` per Steward-authored PR with unresolved review comments (no auto-patch in v1) |

### Weekly

| Workflow | UTC schedule | action_kind | LLM call? | Write path | Typical output |
|---|---|---|---|---|---|
| `steward-autoresearch` | `0 2 * * 0` (Sun 02:00) | `autoresearch` | ✅ yes (3 candidates → judge) | ✅ commits + draft PR | Best of 3 LLM-generated edits on selected recs item, judged by an evaluator pass |
| `steward-dep-patch` | `0 4 * * 0` (Sun 04:00) | `dep_update_patch` | ❌ no | ✅ commits + draft PR | One PR per patch-only `npm outdated` update (e.g. `4.7.0 → 4.7.1`); minor and major versions are NOT picked |
| `steward-evolve-weekly` | `0 4 * * 0` (Sun 04:00) | `evolve_weekly` | ✅ yes (haiku-judge) | ✅ appends to recs.md + draft PR | Promotes repeated-mistake patterns from 14-day journal window into new recommendations.md candidates |
| `steward-secret-history-sweep` | `0 2 * * 0` (Sun 02:00) | `secret_history_sweep` | ❌ no (TruffleHog) | ❌ files gh issue | One `gh issue` per verified secret hit; fail-open if trufflehog binary missing |
| `steward-workflow-hardener` | `0 3 * * 0` (Sun 03:00) | `workflow_hardener` | ❌ no | ✅ commits + draft PR | YAML edits enforcing least-privilege `permissions:` blocks on workflows missing them |
| `steward-test-coverage-gap` | `0 6 * * 1` (Mon 06:00) | `test_coverage_gap` | ❌ no (v1: snapshot only) | ❌ read-only | Snapshot of coverage drift to `cortex/coverage-snapshot.json`; no PR opening in v1 |
| `steward-flaky-test-repair` | `0 7 * * 2` (Tue 07:00) | `flaky_test_repair` | ❌ no | ✅ commits + draft PR | Replaces `// HERMES-FLAKY: <reason>` markers above test declarations with `.skip` + opens issue |
| `steward-lint-fix` | `0 8 * * 3` (Wed 08:00) | `lint_fix_shipper` | ❌ no | ✅ commits + draft PR | ESLint `--fix` + `tsc --noEmit`; auto-fixable diffs committed, non-fixable opened as issue |
| `steward-tech-debt-audit` | `0 9 * * 4` (Thu 09:00) | `tech_debt_audit` | ❌ no (qlty + knip) | ❌ read-only | Snapshot to `cortex/debt-snapshot.json`; v1 snapshot-only, no PR |

### Monthly (1st of month)

| Workflow | UTC schedule | action_kind | LLM call? | Write path | Typical output |
|---|---|---|---|---|---|
| `steward-doc-drift` | `0 5 1 * *` (1st 05:00) | `doc_drift` | ❌ no | ❌ files gh issues | One `gh issue` per exported symbol missing from `README.md` / `CLAUDE.md` / `docs/` |
| `steward-senior-tester-review` | `0 4 1 * *` (1st 04:00) | `senior_tester_review` | ✅ yes (optional judge) | ❌ files gh issue | Hybrid detector (~16 smells) + optional LLM strategic synthesis; ONE `gh issue` per run |
| `steward-todo-triage` | `0 4 1 * *` (1st 04:00) | `todo_triage` | ❌ no | ❌ files gh issue | Scans `// TODO` markers; files `gh issue` aggregating untriaged ones |

### Manual-trigger only (not scheduled)

| Workflow | Trigger | Purpose |
|---|---|---|
| `steward-eval-baseline` | `workflow_dispatch` | Runs `tools/run-steward-evals.cjs` to baseline LLM-engine quality across the 10 task rubrics under `evals/`. Use after switching default model or after a major prompt edit. |
| `steward-key-probe` | `workflow_dispatch` | One-off check that `OPENROUTER_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) secret is set + valid. Use after rotating keys. |

## 2. How to manually trigger a cron lane

Three ways:

```bash
# A) Via gh CLI (preferred — branch-aware, output capture)
gh workflow run steward-harvest.yml --ref main
gh run list --workflow=steward-harvest.yml --limit 1
gh run view <run_id>

# B) Via GitHub UI
# Repo → Actions → pick workflow → "Run workflow" button → branch=main

# C) Locally via the CLI (skips GitHub Actions; useful for fast iteration)
node bin/cortex-steward.cjs dry-run \
  --slug=<repo-name> \
  --trigger=cron \
  --kind=<action_kind> \
  --json
```

The local dry-run prints the plan as JSON (branch name, commit message, action_id) without acting. Set `STEWARD_ENGINE=mock` to skip the LLM call entirely while developing.

## 3. Output anatomy — what to read after a run

Every Steward run produces three artifacts:

### 3.1 Draft PR (write-path lanes only)

```
Title:  feat(<slug>): <action subject from recommendations.md>
Body:   <recommendations.md item body verbatim + spec_failures block on failure>
Branch: steward/<YYYY-MM-DD>-<kebab-title>-<ULID-suffix>
Author: Steward (cortex-x) <steward@cortex-x.local>
Trailers (in commit message):
  Steward-Action-Id: <ULID>
  Steward-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl
  Steward-Trigger: cron
  Steward-Recommendation-Source: cortex/recommendations.md#<num>-<slug>
```

The PR is **always** opened as `--draft`. Per `standards/steward-policy.md` MUST-H6, auto-merging is hardcoded NEVER autonomous. Operator merges.

### 3.2 Journal entry

One line of JSONL appended to `~/.cortex/journal/<slug>/<date>.jsonl` per phase of the run. Schema (Sprint 1.8.4+):

```json
{
  "ts": "2026-05-14T04:17:50.460Z",
  "action_id": "01KRJTMKCC51J6G7KCGVXC9JB4",
  "phase": "engine_apply | spec_verify | npm_test | commit | push | pr_create",
  "outcome": "success | failure",
  "error_code": "SPEC_VIOLATION | NPM_TEST_FAILED | ...",
  "cost_usd": 0.0008,
  "tokens_in": 1240,
  "tokens_out": 320,
  "model": "deepseek/deepseek-v4-flash",
  "duration_ms": 4200
}
```

`cortex-steward status` rolls this up into a per-action cost ledger.

### 3.3 GitHub Actions artifact

Each workflow uploads `.cortex-data/journal/` as artifact `steward-<lane>-journal-<run_id>` (30-day retention). Useful for post-mortem on lanes that ran offline (no PR opened).

```bash
gh run download <run_id> -n steward-<lane>-journal-<run_id>
cat journal/<slug>/<date>.jsonl | jq .
```

## 4. Common failures + fixes

Mapping from error code (in journal `error_code` field or workflow log) to root cause and remediation.

| Error code | Cause | Fix |
|---|---|---|
| `PARSE_FAILED` | `cortex/recommendations.md` missing required `## DO this week` section with ≥1 H3 item | Use `### N. <title>` format per `bin/steward/_lib/recommendations.cjs:77` parser contract — NOT `- [ ]` checkboxes (scaffold template drift, see backlog) |
| `placeholder_slug_in_recommendations_md` | Frontmatter `slug: TODO` not yet replaced | Edit `cortex/recommendations.md` frontmatter: replace `slug: TODO` with actual repo name (e.g. `slug: cortex-x`) |
| `SPEC_VIOLATION` | One of 6 acceptance-criterion kinds (`shell` / `file_predicate` / `regex` / `ears_text` / `llm_judge` / `read_set`) tripped | Read journal `spec_failures` block; either fix the action to pass the criterion, or relax the criterion in the action_kind's registry entry if the criterion was wrong |
| `EDIT_DESTRUCTIVE_REWRITE` | LLM produced edits that shrink the file by >50% (likely hallucinated rewrite) | Re-trigger; if persistent, narrow the recommendation body to be more specific about which lines to touch |
| `NPM_TEST_FAILED` | `npm test` red after applying LLM edits | Atomic rollback already happened. Re-trigger after fixing the underlying test, or refine the recs item to scope edits more narrowly |
| `CLAUDE_SDK_NOT_IMPLEMENTED` | `STEWARD_ENGINE=claude-sdk` selected but engine is stub | Use `STEWARD_ENGINE=claude-cli` (real OAuth path, post-2026-06-15 draws on Anthropic $200/mo credit) or `openrouter` |
| `STEWARD_HALT` | `STEWARD_HALT` file present in `.cortex-data/` | Investigate; remove the halt file once root cause addressed. The file is the kill-switch — Steward refuses to do ANYTHING until it's gone |
| `OPENROUTER_*` (8 codes) | OpenRouter API rejection — see `bin/steward/_lib/openrouter-engine.cjs` constants | Check `OPENROUTER_API_KEY` secret + balance + model availability |
| `PLAN_INCOMPLETE` | Workflow YAML invoked execute step with a no-op plan (no `action.action_key` / `action_id`) | Fixed 2026-05-14 in commit `be5b556` — gate condition now checks for required fields. Should not recur. |
| `STEWARD_WORKTREE_DENIED` (Sprint 2.30, planned) | Steward triggered from non-primary git worktree | Run from main worktree, or set `STEWARD_ALLOW_WORKTREE=1` if intentional |

## 5. Cost + budget controls (per Sprint 1.9.1)

Three env-var caps gate LLM-call lanes. Defaults shown.

| Env var | Default | Trips when | Effect |
|---|---|---|---|
| `STEWARD_DAILY_USD_CAP` | $5.00 | Cumulative spend across all lanes in one UTC day exceeds cap | Refuses to dispatch LLM call; writes journal entry, exits clean |
| `STEWARD_WEEKLY_USD_CAP` | $25.00 | Cumulative spend in rolling 7-day window | Same |
| `STEWARD_MONTHLY_USD_CAP` | $80.00 | Cumulative spend in rolling 30-day window | Same |
| `STEWARD_TOKEN_VELOCITY_CAP` | 50,000 / 5min | Token burn rate spike | Same |
| `STEWARD_FAILURE_BREAKER` | 3 | Consecutive failures of any kind | Halts further dispatches for the day |
| Cross-session loop detector | 5× same criterion id / 7d | Detects spin loops | Writes `STEWARD_HALT`, requires operator intervention |

After 2026-06-15 (Anthropic Agent SDK $200/mo credit launch), Sprint 2.31 generalizes these caps to multi-currency. Until then, only `STEWARD_ENGINE=claude-cli` users with their own `CLAUDE_CODE_OAUTH_TOKEN` need to think about that.

## 6. For AI agents debugging or extending Steward

If you (Claude or another agent) need to act on a Steward problem, this is the lookup table:

| You are trying to ... | Read this first | Then look at |
|---|---|---|
| Understand why a cron lane fired but produced nothing | `cortex/recommendations.md` (placeholder slug? all items HUMAN-ONLY or already journaled?) | `~/.cortex/journal/<slug>/<date>.jsonl` for the run |
| Add a new cron lane | `bin/steward/_lib/action-kinds.cjs` (registry shape) + nearest existing workflow YAML as template | `docs/steward-runtime.md` § Action kind registry |
| Debug a `PARSE_FAILED` | `bin/steward/_lib/recommendations.cjs:108-140` (parser entry point) | Format example: `docs/dogfood-examples/recommendations-cortex-x-2026-05-09.md` |
| Debug a `SPEC_VIOLATION` | `bin/steward/_lib/spec-verifier.cjs` + the action_kind's `acceptance_criteria[]` in `action-kinds.cjs` | Journal `spec_failures` block in the run's JSONL entry |
| Change which model an action uses | `docs/steward-routing.md` § Routing config | `bin/steward/_lib/model-router.cjs` |
| Add a new acceptance-criterion kind | `docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md` § 5-kind table | `bin/steward/_lib/spec-verifier.cjs` § kind handlers |
| Investigate why all lanes returned `no_actionable_step` | Cortex is just clean (no outdated deps, no lint, no doc drift, etc.) — NOT a bug | `cortex/recommendations.md` may be the only lane still hungry; seed with real items |
| Trigger a one-off run on the new code without waiting for cron | `gh workflow run steward-<lane>.yml --ref main` | `gh run view <id>` for status; `gh run download <id>` for journal |

**Hard MUST per `standards/steward-policy.md`:**
- Never auto-merge a draft PR (operator-only)
- Never write outside the project workspace (path-traversal guard in `applyEditsToFilesystem`)
- Never run if `STEWARD_HALT` file exists in `.cortex-data/`
- Never skip the `npm test` gate before commit
- Never push to `main` directly (always branch + draft PR)

## 7. Reading PR cadence (what "healthy" looks like)

A healthy cortex-x dogfood week produces approximately:

- **1-3 PRs from `steward.yml`** (nightly recommendation lane) — one per actionable `## DO this week` item, until the section drains
- **0-1 PR from `steward-dep-patch`** — only if npm has shipped patch-only updates for cortex's deps that week (typical: 0-2 per month)
- **0-1 PR from `steward-lint-fix`** — only if someone introduced an ESLint violation (typical: 0)
- **0-1 PR from `steward-harvest`** — only if PR/CI/issue signals surfaced new candidates not already in recs.md
- **1 advisory rollup per day** from `steward-evolve-daily` (file, not PR)
- **0-N `gh issues`** from doc-drift / senior-tester / todo-triage / secret-sweep (monthly + weekly cadence)

**If your week shows 0 PRs across all lanes**, check `cortex/recommendations.md` — either slug is placeholder or `## DO this week` is empty / all-HUMAN-ONLY / all-already-journaled.

**If your week shows ≥5 PRs from `steward.yml`**, you either seeded a lot of items or something is loop-detecting wrong; check `cortex-steward status --forecast`.

## 8. Cross-references

- [`docs/steward-usage.md`](./steward-usage.md) — overall user guide + 4-level autonomy ladder
- [`docs/steward-runtime.md`](./steward-runtime.md) — 5-component design (planner / engine / verifier / committer / journaler)
- [`docs/steward-routing.md`](./steward-routing.md) — per-action_kind model selection (Sprint 2.0b)
- [`docs/steward-autoresearch.md`](./steward-autoresearch.md) — autoresearch lane deep-dive (Sprint 2.1)
- [`docs/steward-rfc.md`](./steward-rfc.md) — motivation + design rationale
- [`docs/steward-research-synthesis.md`](./steward-research-synthesis.md) — research artifacts
- [`docs/steward-roadmap.md`](./steward-roadmap.md) — sprint trajectory (Tier 0-4)
- [`standards/steward-policy.md`](../standards/steward-policy.md) — refusal rules + MUST patterns
- [`bin/steward/_lib/action-kinds.cjs`](../bin/steward/_lib/action-kinds.cjs) — typed registry of all shipped action kinds (count tracked authoritatively in [`cortex/capabilities.md`](../cortex/capabilities.md))
- [`bin/steward/_lib/recommendations.cjs`](../bin/steward/_lib/recommendations.cjs) — `recommendations.md` parser contract
- [`cortex/capabilities.md`](../cortex/capabilities.md) — auto-generated capability registry (`npm run capabilities`)
