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
- [ ] Hermes-policy.md drafted in `standards/` and reviewed by Dave.
- [ ] Hermes-runtime.md design doc with sequence diagrams for the 4 main
      flows (cron, incident, PR-merged, manual).
- [ ] First Hermes-driven PR auto-generated against a fixture project
      (`tests/fixtures/hermes-dryrun/`), reviewed by Dave, before any
      live project gets Hermes wiring.

## Next steps

When Dave returns to this RFC:

1. Read this stub.
2. Decide topology (single-agent vs subagent).
3. Draft `standards/hermes-policy.md` from the "What Hermes is NOT" list
   above.
4. Sketch the core loop in `docs/hermes-runtime.md`.
5. Build a fixture project + first dry-run iteration in
   `tests/fixtures/hermes-dryrun/`.
6. Open the first non-trivial PR.

Estimated 2h research + 4h design + 4-8h initial implementation across
2-3 sessions. NOT a single-session task.
