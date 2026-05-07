# Hermes Agent — RFC (placeholder)

> **Status:** placeholder. Detailed design in next session — this file
> exists only to anchor the discussion and define the entrance criteria.
>
> **Date:** 2026-05-07
> **Author:** Dave Rajnoha (with Claude assistance)
> **Pre-Hermes gates:** Tier 4 ✓ (commits 2766fce, 7a067e1) — hook contract
> tests · Tier 5 ✓ (commit a70bdd8) — prompt + SKILL.md regression. Both
> are HARD GATES per the 8-tier QA architecture in [tests/README.md](../tests/README.md).

## Why Hermes

Cortex-x today is a **build-time** framework: bootstraps SaaS / tool /
agent projects in <3 minutes with rule-1 architecture + standards + safety
baked-in. After scaffold, it does nothing autonomously.

Hermes powers up cortex-x to a **runtime** framework: an autonomous loop
that lives in the project after launch. Reads `cortex/recommendations.md`
"DO this week", executes one step at a time, verifies via tests + evals,
logs progress, decides next step. Self-healing on incidents: Sentry alert
or failed deploy or red CI lane re-loads audit context, drafts fix, opens
PR.

The differentiator: scaffolding is commodity (every framework has a CLI).
**Maintaining project health autonomously** is rare and durable moat.

## What Hermes is NOT (must list)

Hardcoded Hermes refusals — non-negotiable:

- **No force-push to main.** Hermes can push branches, open PRs, comment
  on PRs. Never `git push --force` to a protected branch.
- **No merge without human review.** Hermes opens PRs; humans merge.
- **No data deletion.** Hermes never `rm -rf`, `DROP TABLE`, `truncate`,
  `supabase db reset`. block-destructive.cjs hook is the runtime
  enforcement layer (Tier 4 verified).
- **No prod restart / migration.** Hermes proposes; humans execute.
- **No tool-call beyond declared budget.** Per-session USD cap +
  per-action retry budget (per safe-tool v2 in standards/ai-patterns.md).
- **No silent context modification.** Every memory write to
  `~/.cortex/journal/` is structured, timestamped, and replayable.

## Architecture sketch (TBD)

5 components anticipated:

1. **Hermes core loop** — reads recommendations, picks next action,
   spawns subagent, verifies, logs, repeats.
2. **Trigger model** — cron (daily/weekly), on-incident (Sentry hook),
   on-PR-merged (GitHub webhook), manual.
3. **Memory model** — append-only `~/.cortex/journal/<slug>/<date>.jsonl`
   with replay-friendly structure. Hermes reads it before each action
   to know "what did I already try and what failed?".
4. **Rollback contract** — every Hermes action = atomic git commit on a
   `hermes/<date>` branch. Revert path is `git revert HEAD`.
5. **Safety layer** — calls into block-destructive.cjs + custom Hermes
   policy file (this RFC § What Hermes is NOT becomes the policy).

## Open questions (next session)

- Single-agent vs subagent topology? (Per Cognition "Don't Build Multi-
  Agents" 2025, single-agent for sequential work is often better.)
- Trigger sequencing — what if Sentry alert fires during cron run? Mutex?
- Cost ceiling per project (Hermes is metered — Claude API USD).
- Self-improvement scope — can Hermes edit cortex-x prompts? Standards?
  (Probably no for v0; opt-in flag for v1.)
- Failure escalation — at what point does Hermes ping Dave (Slack? Email?
  silent log?) vs. retry vs. give up?

## Pre-Hermes verification checklist

Both must be green before any Hermes runtime code merges:

- [x] Tier 4 hook contract — `npm run test:fast` includes 35 contract +
      57 unit hook tests, all blockers in CI (`.github/workflows/test.yml`).
- [x] Tier 5 prompt + SKILL.md regression — `npm run test:fast` includes
      17 contract tests verifying every prompt and SKILL.md is structurally
      valid. CI lane gates merges.
- [x] Hermes-policy.md drafted in `standards/` (2026-05-07) — see
      [`standards/hermes-policy.md`](../standards/hermes-policy.md).
- [x] Hermes-runtime.md design doc with cron sequence flow + halt flow +
      verification flow + PR-promotion flow (2026-05-07) — see
      [`docs/hermes-runtime.md`](./hermes-runtime.md). Note: only cron flow
      ships in v0; incident / PR-merged / manual flows are designed-but-deferred.
- [x] First Hermes-driven dry-run against fixture project
      (`tests/fixtures/hermes-dryrun/`) — fixture + 18-test contract landed
      2026-05-07 commit `9fc3a5b`; dry-run orchestrator + 16-test integration
      suite landed 2026-05-07 (this commit). Real Hermes-driven PR (with
      Claude Agent SDK call) is the v0.5 milestone.

## Decisions taken from research (2026-05-07)

Three parallel research briefs (topology, triggers/safety, git workflow)
synthesized into [`docs/hermes-research-synthesis.md`](./hermes-research-synthesis.md).
Key decisions:

- **Single-agent core loop** with opt-in read-only `investigate` subagent
  (Cognition "Don't Build Multi-Agents" + Anthropic SDK guidance).
- **Branch-per-action**, not daily-rolling — `hermes/<YYYY-MM-DD>-<slug>-<id>`
  matches Devin / Sweep / Copilot precedent.
- **Mutex-by-project-slug** with FIFO `max_pending=1` per trigger-type;
  P0 incident may interrupt-at-checkpoint (never mid-tool-call).
- **Cost ceilings:** $0.50 / $2 per session, $3 / $5 daily project,
  $10 / $15 daily fleet — loop-prevention guards under MAX subscription.
- **4-tier escalation** T0 silent journal → T1 needs_review flag → T2
  Slack/email + pause → T3 halt + sentinel.
- **File-based kill switch** at `~/.cortex/HERMES_HALT` (fleet) and
  `<repo>/.cortex/HERMES_HALT` (per-project).
- **Git trailers** (`Hermes-Action-Id`, `Hermes-Journal-Entry`,
  `Hermes-Trigger`, `Hermes-Reverts`) — machine-parseable via
  `git interpret-trailers`.
- **Draft PR by default**, promote-to-ready on CI green +
  atomic-commit-contract verified. Humans always merge.
- **v0 dogfood target:** cortex-x itself, weekly cron only, 3 weeks proven
  before expanding to RELO / Kiosek / Chatbot Platform.

Five of the original nine open questions are answered in the synthesis;
the remaining four (default ping channel detail, hosting credential split,
multi-action-per-run, PR body templating) defer to first implementation PR.

## Next steps

When Dave returns to this RFC:

1. ~~Read this stub.~~ ✅
2. ~~Decide topology (single-agent vs subagent).~~ ✅ single-agent
3. ~~Draft `standards/hermes-policy.md`.~~ ✅
4. ~~Sketch the core loop in `docs/hermes-runtime.md`.~~ ✅
5. ~~Build a fixture project + first dry-run iteration in `tests/fixtures/hermes-dryrun/`.~~ ✅
6. ~~Wire 6 primitives + dry-run orchestrator (no Claude SDK yet).~~ ✅
7. **v0.5 milestone:** integrate Claude Agent SDK so the dry-run plan becomes
   an actual Hermes commit + PR. The dry-run already produces a valid
   Conventional-Commits-shaped commit message with Git trailers; v0.5 just
   feeds it to `git commit -F -` after the LLM produces the file edits.
8. **v1 milestone:** wire cron / on-incident / on-PR-merged triggers; expand
   from cortex-x dogfood to RELO + Kiosek.

Estimated remaining: 4-8h Claude Agent SDK integration (v0.5) + 4-8h
trigger wiring (v1) across 2 sessions.
