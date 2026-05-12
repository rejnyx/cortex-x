# bin/steward/

Steward autonomous-maintenance runtime. Three orchestrators that share `_lib/` primitives.

## Orchestrators

| File | Mode | What it does |
|---|---|---|
| [`dry-run.cjs`](./dry-run.cjs) | `cortex-steward dry-run` | Reads `cortex/recommendations.md`, picks first actionable item, plans an LLM call + edits + commit, emits JSON plan. **No side effects.** |
| [`execute.cjs`](./execute.cjs) | `cortex-steward execute --plan-file=...` | Takes a dry-run plan, runs end-to-end: halt check → lock → branch checkout → LLM apply → spec-verifier gate → npm test gate → atomic commit → push → `gh pr create --draft` → journal. Atomic rollback on any failure. |
| [`status.cjs`](./status.cjs) | `cortex-steward status [--slug=...]` | Reports halt state, lock state, recommendations health, journal rollup, cost ledger. Zero-config — no API key needed. |

## How they compose

```
cron / manual
   ↓
cortex-steward dry-run --slug=<project> --json > plan.json
   ↓
cortex-steward execute --plan-file=plan.json
   ↓ (success)
draft PR opened, journal entry written, lock released
   ↓ (failure at any phase)
atomic rollback: working tree restored, branch deleted, lesson recorded
```

## Primitives in `_lib/`

See [`_lib/`](./_lib/) for the 37 zero-dependency CommonJS primitives. Notable:

- **`spec-verifier.cjs`** — 6 acceptance-criterion kinds (shell, file_predicate, regex, ears_text, llm_judge, read_set). The defense layer between LLM edits and `npm test`.
- **`action-engine.cjs`** — LLM dispatch (`mock` / `openrouter` / `claude-cli`) + edit application with hard denylist (secrets, `.github/workflows/`, `package.json`, bin/steward self).
- **`action-kinds.cjs`** — typed registry of 16 action kinds (recommendation, dep_update_patch, flaky_test_repair, doc_drift, todo_triage, recommendation_harvest, tech_debt_audit, lint_fix_shipper, test_coverage_gap, pr_review_responder, pattern_transfer, senior_tester_review, workflow_hardener, secret_history_sweep, release_notes_drafter, mutation_score_drift).
- **`halt-check.cjs`** — kill-switch (`STEWARD_HALT` sentinel + `HERMES_HALT` legacy alias).
- **`lock.cjs`** — process-mutex (one Steward action per repo at a time).
- **`journal.cjs`** — append-only JSONL trace per project under `$CORTEX_DATA_HOME/journal/<slug>.jsonl`.
- **`cost-safety.cjs`** — daily / weekly / monthly USD caps + token-velocity cap + cross-session loop detector.
- **`git-trailers.cjs`** — `Steward-*` trailers in commit messages (with `Hermes-*` legacy alias parsed for back-compat).

## Documentation

- Operator setup: [`docs/steward-runtime.md`](../../docs/steward-runtime.md)
- Daily usage: [`docs/steward-usage.md`](../../docs/steward-usage.md)
- Architecture RFC: [`docs/steward-rfc.md`](../../docs/steward-rfc.md)
- Policy contract: [`standards/steward-policy.md`](../../standards/steward-policy.md)
- Roadmap: [`docs/steward-roadmap.md`](../../docs/steward-roadmap.md)
