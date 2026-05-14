# Steward vs Cloud Routines — positioning + composition

> **Tier:** docs (operator-facing). One-pager answering *"do I still need Steward if Anthropic shipped Cloud Routines?"*

Anthropic launched [Claude Code Cloud Routines](https://code.claude.com/docs/en/routines) in Apr 2026. Routines and cortex's Steward overlap in **trigger surface** (both can run on a schedule, both can react to GitHub events) but diverge in **billing model, safety mechanika, and where the code runs**. This doc resolves the choice + describes the composition pattern.

## At a glance

|                          | Cloud Routines                                  | Cortex Steward                                                |
|--------------------------|--------------------------------------------------|---------------------------------------------------------------|
| Trigger                  | schedule · API · GitHub event                    | GitHub Actions cron + workflow_dispatch + push events         |
| Where it runs            | Anthropic infra                                  | Your GitHub Actions runners (your repos)                      |
| Billing                  | Subscription (Pro $20/mo: 5 runs/day · Max $200/mo: 15/day · Team: 25/day) | OpenRouter pay-as-you-go (~$0.0008/run @ DeepSeek default) + your CI minutes |
| Safety mechanika         | Anthropic's runtime checks + plan-mode defaults | 17 typed action_kinds + STEWARD_HALT + atomic rollback + spec-verifier + D/W/M USD caps + circuit breakers |
| Audit trail              | Anthropic dashboard                              | Append-only `journal/` + `git log` + PR drafts + `cortex-steward status --forecast` |
| Repo coupling            | None (runs from cloud against any repo)          | Workflow files committed in your repo (`.github/workflows/steward-*.yml`) |
| Latency to mutation      | Direct (Claude edits the workspace)              | LLM → JSON edit-plan → spec-verifier gate → atomic commit → draft PR |
| Best-fit task            | "Triage this label / summarize last 24h PRs / regenerate README" | "Patch deps + fix flaky tests + sweep secrets + harvest todos" — anything where rollback matters |

## When to pick Routines

- You want **zero infra**. Anthropic runs it, Anthropic bills it, you write a prompt.
- The task is **idempotent or read-only** (digests, triage, audit reports) — rollback isn't needed.
- You're already on **Pro / Max / Team** and the per-day run cap fits your cadence (5 / 15 / 25 runs).
- The mutation surface is **inside Claude Code's own safety floor** (plan mode, permissions denylist) and you don't need cortex's 17 action_kind taxonomy.
- You don't want workflow YAML in your repo.

## When to pick Steward

- You want **operator-owned cost ceiling**. `STEWARD_DAILY_USD_CAP=5` is enforced on your runner, not opaquely.
- The task is **mutating + auto-merged via PR**: dep patch, flaky-test fix, coverage backfill, lint sweep, tech-debt rotation, workflow hardener, secret-history sweep, senior-tester review, doc-drift, todo triage, PR-review responder. Eleven scheduled action kinds, all with atomic rollback.
- You need **byte-level reproducibility** months later: every run leaves a journal entry with model, tokens, USD spent, edits attempted, spec-verifier outcome, and the resulting commit SHA.
- The repo lives outside Anthropic's billing reach (operator-private, multi-customer SaaS, regulated context, air-gapped).
- You want **OpenRouter model choice** (DeepSeek-V4-flash at $0.0008/run vs Anthropic-billed Sonnet at ~$0.04/run for the same task).

## Composition pattern (you can use both)

Routines and Steward are not mutually exclusive. The cleanest composition:

1. **Routines for high-frequency / low-risk triage** — daily PR digest, label suggestions, README sync after merge.
2. **Steward for nightly / weekly substantive mutations** — dep patch, flaky-test fix, secret sweep, coverage backfill.
3. **Cortex skills are auto-discovered in both** — a Cloud Routine prompt can invoke `/audit` or `/test-audit` exactly the same way an interactive session does, because skills live in `~/.claude/skills/` and Claude Code loads them regardless of runtime origin. So you get cortex's review-pipeline discipline inside Routine runs at zero extra cost.

### Worked example

A SaaS operator on Claude Max wants:
- Daily morning PR-digest in Slack — **Routine** (Anthropic-billed, read-only, perfect fit)
- Weekly dependabot-on-steroids that runs the full test suite + atomic-rolls-back on red — **Steward** (mutation + rollback + USD cap is the value)
- After merge, regenerate the changelog section in README — **Routine** (read PR titles, write a markdown block, no rollback needed)
- Monthly senior-tester review of the test suite — **Steward** (uses the 12th capability + the spec-verifier + drafts a PR with findings)

Both can call `/audit` mid-run for Rule 1 gate. Both write to `journal/` if cortex hooks are installed (Routine writes go through `~/.claude.json` MCP wiring; Steward writes go through its own primitive).

## Anti-patterns

- ❌ **Reimplementing Cloud Routines as a cortex feature.** Different value prop. Steward is operator-owned mutation; Routines is Anthropic-hosted triage. Don't merge them.
- ❌ **Routing Routine runs through Steward "for safety."** Routines run inside Claude Code's own permission floor. Steward's safety mechanika is for **OpenRouter LLM → filesystem mutation**; layering it on Anthropic-direct flows doubles cost and latency.
- ❌ **Steward as a Routines replacement.** Steward is a 17-action-kind autonomous runner with strict rollback semantics — overkill for "every morning at 9am, summarize yesterday's commits." Use Routines for that.
- ❌ **Two systems running the same mutation.** If both Routines and Steward open PRs against the same problem class (e.g., dep patches), you'll get conflicting PRs and waste tokens. Pick one per task class.

## Migration questions operators ask

**"I'm already on Claude Max. Why pay for OpenRouter too?"** — You don't have to. Run Routines for everything that fits. Steward kicks in when you need operator-owned cost cap, atomic rollback on red tests, or multi-month-old audit trails. If neither matters, Routines alone is fine.

**"Can Steward call a Routine?"** — Not directly today. Steward emits PRs; Routines triggers don't include "Steward finished a run." You can wire a GitHub event Routine to fire when Steward opens a PR (since Steward uses `gh pr create --draft`).

**"Can Routines call Steward?"** — Indirectly. A Routine can run `gh workflow run steward-flaky-test.yml` via the GitHub API tool — Steward then executes inside your runner with its own safety mechanika.

## See also

- [`docs/steward-rfc.md`](./steward-rfc.md) — Steward design RFC
- [`docs/steward-runtime.md`](./steward-runtime.md) — runtime architecture
- [`docs/steward-usage.md`](./steward-usage.md) — operator usage guide
- [`standards/steward-policy.md`](../standards/steward-policy.md) — Rule 2 safety contract
- [Claude Code Cloud Routines docs](https://code.claude.com/docs/en/routines) — Anthropic
- [The New Stack — Claude Code can now do your job overnight](https://thenewstack.io/claude-code-can-now-do-your-job-overnight/)
- [Nimbalyst — Routines practical guide](https://nimbalyst.com/blog/claude-code-routines-practical-guide/)
- [Verdent — Claude Code pricing 2026](https://www.verdent.ai/guides/claude-code-pricing-2026)
