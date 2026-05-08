# Steward setup — guided activation flow

> **What this prompt does:** walks the user from "Steward installed, never run" to "Steward ships nightly draft PRs autonomously." Detects what's missing, fills the gaps, ends with a dry-run smoke test.
>
> **When to invoke:** user said *"set up Steward"*, *"activate the autopilot"*, *"wire the cron"*, or pasted this prompt. Also linked from `prompts/new-project.md` Phase 6 + the `/cortex-init` skill.
>
> **Audience:** the user is technical (uses Claude Code) but may not have read `docs/steward-usage.md`. Don't dump docs at them — execute the flow conversationally.

## What Steward is — 30-second pitch

Open with this exact framing (adapt to detected user.yaml.language):

> **Steward is your AI nightly autopilot.** While you sleep, it reads `cortex/recommendations.md`, picks the next action, asks the LLM (~$0.0008 per run via OpenRouter), applies the edits, runs `npm test` as a gate, opens a **draft PR**. You wake up, review the diff, merge or reject.
>
> **Safety primitives baked in.** Every run: ① always a draft PR (never auto-merge) · ② halt switch `touch ~/.cortex/HERMES_HALT` ③ $5/day spend cap + 3-failure-per-action circuit breaker · ④ atomic rollback on any phase failure (test fail = git reset, no commit).

Wait for "OK" / "let's do it" / equivalent before proceeding. If the user has questions, answer from `docs/steward-usage.md` § 4-level autonomy ladder.

## Phase 1 — Pre-flight check

Run ALL these checks in parallel (single message, multiple Bash calls). Report results as a checklist.

```
□ git repo + remote (gh):     git rev-parse --show-toplevel && gh repo view --json name,owner -q '.owner.login + "/" + .name'
□ recommendations.md present: test -f cortex/recommendations.md && head -3 cortex/recommendations.md
□ recommendations.md slug:    grep -E '^slug:' cortex/recommendations.md
□ workflow file present:      test -f .github/workflows/steward.yml && grep -E "^name:" .github/workflows/steward.yml
□ OPENROUTER_API_KEY in gh:   gh secret list | grep OPENROUTER_API_KEY
□ cortex-steward on PATH:      command -v cortex-steward
□ halt switch state:          test -f ~/.cortex/HERMES_HALT && echo "HALTED" || echo "ready"
□ existing journal traffic:   test -d ~/.cortex/journal && ls ~/.cortex/journal/ | wc -l
```

For each check, mark ✅ found / ❌ missing / ⚠️ wrong. Show the user the table BEFORE proposing fixes.

## Phase 2 — Fill the gaps

Walk gaps in **this order** (dependency chain). For each missing item, propose the action, get user OK, execute. Do NOT batch — each step is reversible alone.

### 2.1 — `cortex/recommendations.md` missing or unparseable

If file missing: scaffold a minimal one. Read `tests/fixtures/steward-dryrun/cortex/recommendations.md` (in the cortex-x repo) for the canonical shape. Adapt slug + content to user's project.

If file present but missing `slug:` frontmatter or `## DO this week (cited)` heading: explain the parse error citing the exact missing piece. Suggest minimal patch.

Required shape:

```markdown
---
slug: <project-slug>      # must match repo basename — Steward uses for journal isolation
phase: 5-adapt
date: <YYYY-MM-DD>
---

# For YOUR project — <name>, <date>

## DO this week (cited)
- [ ] <action item> [src: <citation>]
```

Each unchecked `- [ ]` item is one Steward nightly run.

### 2.2 — `OPENROUTER_API_KEY` not in gh secrets

Direct user to https://openrouter.ai → API keys → **Create Inference Key** (NOT Provisioning Key — provisioning keys can't make LLM calls; field-tested 2026-05-07 incident).

Test the key locally first BEFORE setting as repo secret:

```bash
curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key | jq .data
```

Should return `{ "is_provisioning_key": false, ... }`. If `is_provisioning_key: true`, the user needs a different key.

Then set the secret. **Critical: use `--body` or `printf %s` — never `echo`.** `echo` appends a trailing newline; Node's undici `fetch()` silently strips Authorization headers whose values contain `\r\n`, producing OpenRouter 401 "Missing Authentication header" with no useful diagnostic (field-tested 2026-05-08 incident, run 25550701886):

```bash
# Preferred — --body takes the literal string, no newline
gh secret set OPENROUTER_API_KEY --body "$KEY"

# Equivalent — explicit no-newline pipe
printf %s "$KEY" | gh secret set OPENROUTER_API_KEY

# DO NOT — echo adds \n which corrupts the secret silently
echo "$KEY" | gh secret set OPENROUTER_API_KEY  # ❌
```

Verify with `gh secret list`. Never paste the key into chat — accept it via env var or one-liner only. Remind the user to rotate if they did paste it.

### 2.3 — `.github/workflows/steward.yml` missing

Copy from cortex-x repo: `.github/workflows/steward.yml` (in this repo as the canonical example).

Key knobs the user can tune:
- `cron: '0 4 * * *'` — daily 04:00 UTC. Switch to `'0 4 * * 0'` for weekly Sundays if budget-tight.
- `HERMES_MODEL: deepseek/deepseek-v4-flash` — default cheapest. Override to `anthropic/claude-haiku-4.5` for higher quality at ~3x cost.
- `HERMES_MAX_TOKENS: '16384'` — default. Drop to 4096 for simple recommendations, raise to 32768 for multi-file refactors.
- `HERMES_DAILY_USD_CAP: '5'` — daily ceiling. Override per-team risk tolerance.
- `HERMES_FAILURE_BREAKER: '3'` — per-action circuit breaker (1-hour window).

After commit + push the workflow file, the next 04:00 UTC kicks the loop.

### 2.4 — `cortex-steward` not on PATH

This means install.{sh,ps1} didn't copy the shim, or the user installed cortex-x manually. Direct them to re-run install:

```bash
~/cortex-x/install.sh        # or install.ps1 on Windows
```

Then verify:

```bash
cortex-steward version        # → "cortex-steward 0.1.0-pre"
```

If still missing, fall back to `node ~/cortex-x/bin/cortex-steward.cjs <subcmd>`.

## Phase 3 — Smoke test (no spend, no edits)

After all gaps filled, run dry-run. This is the no-side-effect preview.

```bash
cortex-steward dry-run --slug=$(basename $(git rev-parse --show-toplevel)) --json | jq .
```

Expected output: structured JSON plan with `mode: "dry-run"`, `action.title` (the recommendation), `branch` (planned `hermes/<date>-<slug>-<id>`), `commit_message` (with valid Git trailers).

If output shows `mode: "no_actionable_step"` — recommendations.md is empty or all items already journaled. Add a fresh `- [ ]` entry to test.

If output shows error code (e.g. `RECOMMENDATION_PARSE_FAIL`, `SLUG_MISMATCH`): fix the recommendations.md per the error, re-run.

## Phase 4 — First nightly run

If smoke test passes, summarize what happens next:

```
✓ Steward is wired. The next 04:00 UTC cron will:
   1. Re-run dry-run inside the GH Actions runner
   2. Acquire ~/.cortex/locks/<slug>.lock (mutex)
   3. Make the OpenRouter LLM call (~$0.0008 spend)
   4. Apply edits to a fresh hermes/<date>-<slug>-<id> branch
   5. Run npm test as the gate (rollback on fail)
   6. Atomic commit + push + gh pr create --draft
   7. Journal everything to ~/.cortex/journal/<slug>.jsonl

Tomorrow morning: `gh pr list --state open` → review draft → merge or reject.
```

Offer to halt:
- Full halt: `touch ~/.cortex/HERMES_HALT` (Steward exits clean on next run, no spend)
- Per-repo halt: comment out the `cron:` line in `.github/workflows/steward.yml`
- Permanent disable: delete `.github/workflows/steward.yml`

## Phase 5 — On-demand observation

Tell user how to check Steward status post-activation:

```bash
cortex-steward status --slug=<your-repo>          # halt + lock + recommendations + journal rollup
gh pr list --author "Steward (cortex-x)"          # draft PRs Steward opened
gh run list --workflow=hermes.yml --limit=10     # recent cron runs
tail -20 ~/.cortex/journal/<slug>.jsonl | jq .   # journal entries
```

## On-complete output

End with:

```
Hotovo. Steward je aktivovaný.

Co se teď bude dít:
- Každou noc 04:00 UTC (= ~06:00 středoevropská): jedna recommendation → draft PR
- Ráno: gh pr list, review, merge nebo reject
- Cost ceiling: $5/den (typický run $0.0008 → 6000+ runs/den před cap)
- Halt anytime: touch ~/.cortex/HERMES_HALT

Pokud něco nejde podle plánu:
- Rollup: cortex-steward status --slug=<your-repo>
- Journal: tail ~/.cortex/journal/<your-repo>.jsonl
- Doc: docs/steward-usage.md
```

## Rules

- **Never paste OPENROUTER_API_KEY into chat.** Accept via `gh secret set` only. If user already pasted, immediately remind them to rotate.
- **Never auto-set the secret without user confirmation.** This is a billing-relevant action.
- **Never modify `.github/workflows/steward.yml` if it already exists.** Show the diff vs. canonical, ask before overwriting.
- **Never run `cortex-steward execute` from this prompt.** That's the cron's job. Dry-run only.
- **Never skip the inference-vs-provisioning key distinction.** Field test 2026-05-07 confirmed this is the #1 first-time setup failure.
