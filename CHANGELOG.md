# Changelog

All notable changes to cortex-x. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Auto-orchestration layer (MVP).** Claude is now prompted automatically to parallelize research + review and single-thread implementation on new-feature prompts. Evidence-grounded in Anthropic's multi-agent research paper, Cognition's counter-position, and 2025–2026 benchmarks (SWE-bench, PlanCraft, ICSE 2025 deprecated-API study). Soft-gate only; never spawns agents silently.
  - `shared/hooks/auto-orchestrate.cjs` — UserPromptSubmit hook with new-implementation detection (cs + en patterns), research cache freshness lookup with topic-aware TTL, session budget warning injection
  - `shared/hooks/_lib/budget.cjs` — token cost estimation (2026 pricing table), session total tracking, `$CORTEX_HOME/journal/.budget.jsonl` writer
  - `shared/hooks/post-tool-use.cjs` — extended to record Agent/Task/WebSearch/WebFetch token usage when exposed by Claude Code
  - `shared/hooks/session-start.cjs` — surfaces last 3 session budgets at session start
  - `standards/auto-orchestration.md` — 3-fronta rule (research parallel / implementation serial / review parallel), 2-minute rule, task-type taxonomy, anti-patterns, evidence trail with citations
  - `prompts/auto-review.md` — scope-classified parallel review pipeline (trivial/small/medium/large → 1–5 agents), anti-slop merge
  - `docs/auto-orchestration-rfc.md` — full design rationale + research transcript
- `CORTEX_SESSION_BUDGET_USD` env var (default `$5.00`)
- `standards/ship-ready.md` — governance invariants for beta/stable distribution
- `research/beta-distribution-2026-04-17.md` — research-grounded staging/prod decision matrix
- `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATIONS.md`, `CHANGELOG.md` — ship-ready artifacts
- PolyForm Noncommercial 1.0.0 license (replaces `Proprietary` stub)

### Changed
- `prompts/cortex-doctor.md` §9 — research hygiene now checks per-topic TTL (hot frameworks 30d, regulations 180d, architecture 365d) instead of blanket 180 days

### Added (continued)
- `prompts/retrofit.md` — apply cortex-x structure to an existing (messy) project without touching runtime code. Four phases: parallel audit → retrofit plan → additive application (user-gated) → post-retrofit report. Strict non-destruction contract: no runtime edits, no overwrites without diff, no auto-fix of Rule 1 violations (those become sprints). Closes the gap between `new-project.md` (greenfield) and `project-scan.md` (library capture) for legacy/client projects
- **Eval suite expanded from 1 → 10 canonical tasks.** Aider-style benchmark (Paul Gauthier 2024-2026) now covers all major prompt + standard surfaces:
  - `eval-002` BAIL-flow scaffold respect (canary for scope creep in `new-project.md`)
  - `eval-003` project-scan slim 5-section schema (canary for SSOT-drift in `project-scan.md`)
  - `eval-004` cortex-sync architectural decision capture
  - `eval-005` code-review SSOT violation BLOCK (Rule 1 enforcement canary)
  - `eval-006` security-auditor SQL injection + RLS bypass (Rule 2 Critical canary)
  - `eval-007` cortex-doctor missing-hook drift detection
  - `eval-008` sprint-status PROGRESS.md parser correctness
  - `eval-009` retrospective [TRANSFERABLE] tagging discipline
  - `eval-010` evolve hard-gate enforcement (framework-honesty canary, prevents pattern hallucination)
- `evals/runner.md` — manual + future-automated execution instructions, result schema, cadence policy (monthly full suite, per-PR for touched prompts, pre-tag full + weakest-3 manual)
- `evals/results/2026-05-01-01d9013-paper-baseline.json` — first baseline established. Paper-baseline mode (per-task scores predicted from prompt review, NOT from real Claude session execution). Total: 8.25 / 10 (82.5%). Weakest: eval-002 (0.65). Strongest: eval-008, eval-010 (0.90). ADVISORY status until 3+ real-execution runs accumulate

### Changed
- LICENSE from "Proprietary" to **PolyForm Noncommercial 1.0.0**. Backwards-incompatible license change; prior collaborators with any access receive the new terms on any subsequent pull.
- Personal data (private project entries, dated insights, journal, dated research caches) moved out of the shipped distribution via `.gitignore` patterns. Files remain on maintainer's local install.

### Fixed
- `prompts/new-project.md`, `prompts/cortex-doctor.md` — replaced hardcoded `~/Desktop/APPs/cortex-x/` with `{cortex_root}` placeholder / `~/cortex-x/` default.
- Personal email removed from public `README.md`.

## [0.0.0] — Pre-beta (pre-2026-04-17)

Internal development. Phases 1–5 foundations: hooks, standards, agents, profiles, self-improvement loop, auto-research primitive. Not distributed.
