# .github/workflows/

GitHub Actions workflows. Two categories:

## CI (always-on, ship-gating)

| Workflow | Triggers | Purpose |
|---|---|---|
| [`test.yml`](./test.yml) | `push` to `main`, every PR | Run `npm test` (full suite, ~22s) + `npm run test:coverage` on Linux. |
| [`install-smoke.yml`](./install-smoke.yml) | `push` to `main`, every PR | 5-lane matrix: ubuntu-bash, macos-bash, windows-gitbash, windows-pwsh7, windows-ps5.1. Runs `install.{sh,ps1}` end-to-end against scratch dirs. |
| [`no-pii.yml`](./no-pii.yml) | `push` to `main`, every PR | PII scanner via `tools/verify-no-pii.cjs` — refuses to merge anything containing operator email / paths / personal data outside of explicitly allowlisted fixtures. |

## Steward autonomous cron (opt-in)

These run on schedule against `cortex/recommendations.md` of the **repo they live in**. They are committed to the repo as `.example` initially; activate by removing the `.example` suffix and configuring secrets (see [`docs/steward-runtime.md`](../../docs/steward-runtime.md)).

| Workflow | Cadence | action_kind |
|---|---|---|
| [`steward.yml`](./steward.yml) | nightly 04:00 UTC | `recommendation` (main loop) |
| [`steward-autoresearch.yml`](./steward-autoresearch.yml) | nightly 02:00 UTC | `recommendation` w/ autoresearch overnight burst |
| [`steward-dep-patch.yml`](./steward-dep-patch.yml) | nightly 04:30 UTC | `dep_update_patch` |
| [`steward-doc-drift.yml`](./steward-doc-drift.yml) | weekly Sat 03:00 UTC | `doc_drift` |
| [`steward-flaky-test-repair.yml`](./steward-flaky-test-repair.yml) | nightly 05:00 UTC | `flaky_test_repair` |
| [`steward-harvest.yml`](./steward-harvest.yml) | nightly 03:30 UTC | `recommendation_harvest` |
| [`steward-lint-fix.yml`](./steward-lint-fix.yml) | nightly 04:15 UTC | `lint_fix_shipper` |
| [`steward-pr-review-responder.yml`](./steward-pr-review-responder.yml) | every 6h | `pr_review_responder` |
| [`steward-secret-history-sweep.yml`](./steward-secret-history-sweep.yml) | weekly Sun 02:00 UTC | `secret_history_sweep` |
| [`steward-senior-tester-review.yml`](./steward-senior-tester-review.yml) | monthly 1st 04:00 UTC | `senior_tester_review` |
| [`steward-tech-debt-audit.yml`](./steward-tech-debt-audit.yml) | weekly Mon 03:30 UTC | `tech_debt_audit` |
| [`steward-test-coverage-gap.yml`](./steward-test-coverage-gap.yml) | weekly Fri 03:30 UTC | `test_coverage_gap` |
| [`steward-todo-triage.yml`](./steward-todo-triage.yml) | weekly Wed 03:30 UTC | `todo_triage` |
| [`steward-workflow-hardener.yml`](./steward-workflow-hardener.yml) | weekly Sun 03:00 UTC | `workflow_hardener` |

## Hardening conventions

Every workflow MUST declare:

- `permissions:` top-level `contents: read` baseline (per-job elevation allowed).
- `concurrency:` block to prevent duplicate runs.
- `timeout-minutes:` on every job (default 30).
- Action SHA pinning (no `@v3` tags — full SHA per GitHub Aug-2025 policy).

The `workflow_hardener` action_kind flags drift against this contract. Lint locally:

```bash
node detectors/workflow-hardener.cjs --analyze
```

## Disabling

Set `STEWARD_HALT` sentinel at `$HOME/.cortex/STEWARD_HALT` to halt all Steward workflows globally without touching the YAML.
