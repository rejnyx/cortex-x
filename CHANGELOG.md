# Changelog

All notable changes to cortex-x. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

### Added (2026-05-06 — Sprint 1.5 onboarding + audit + auto-research engine)
- **Install UX (`bin/cortex-bootstrap{,.ps1}`)** — per-project mode selector. Asks `[N]ew` / `[E]xisting` / `[F]ramework`. Writes `$PWD/.cortex-bootstrap-pending` with mode + ISO timestamp (1h TTL). One-shot semantics; the skill that runs deletes the marker on completion.
- **`shared/skills/start/SKILL.md` + `shared/skills/audit/SKILL.md`** — auto-discovered slash skills mapped to `prompts/new-project.md` and `prompts/existing-project-audit.md`. Auto-primed by `SessionStart` when the bootstrap marker is fresh.
- **`shared/hooks/session-start.cjs`** — extended to detect `.cortex-bootstrap-pending` (auto-prime `/start` or `/audit`) and `cortex/.adapt-pending` (recovery surface if Phase 5 was interrupted).
- **`prompts/existing-project-audit.md`** — NEW deep 12-dimension audit prompt. Six phases: P0 detect → P1 repo-map (with degraded grep+find fallback) → P2 four parallel agents owning three dimensions each → P3 five irreducible human questions → P4 planner-driven auto-research → P5 synthesis to `cortex/AUDIT.md` + `cortex/recommendations.md` + CLAUDE.md patches → P6 ADR backfill (opt-in via `--backfill-adrs`).
- **`agents/planner.md` + `agents/synthesizer.md`** — auto-research engine. Planner picks 3-5 topics from `{profile} × {concern}` matrix; synthesizer merges parallel research into `cortex/recommendations.md` and a `## Stack reality check` section in CLAUDE.md. Three-hop citation traceability mandatory (claim → finding ID → source URL).
- **`config/research.yaml`** — two new triggers: `post_install_adaptation` (Phase 5 Adapt for greenfield) and `existing_project_audit` (Phase 4 of `/audit`). Both `mode: dynamic` (planner-driven). Skip-for-profiles list includes `astro-static` + `minimal`.
- **`prompts/cortex-doctor.md` §14 + §15** — three-hop citation drift check (verifies every CLAUDE.md "Stack reality check" claim traces through finding ID to source URL via HEAD request); canonical-references freshness check (SHA-256 compares local `~/.claude/shared/standards/*` against GitHub raw URL hash, flags drift > 30 days).

### Changed (2026-05-06 — Sprint 1.5)
- **`prompts/new-project.md`** — restructured into FIVE explicit phases each saving an artifact: `cortex/discovery.md` (P1) → `$CORTEX_DATA_HOME/research/<slug>-<date>.md` (P2) → `cortex/proposal.md` (P3) → scaffolded filesystem (P4) → `cortex/recommendations.md` + CLAUDE.md `## Stack reality check` (P5 Adapt — NEW). Phase 3 architect approval gate is structured `[a/e/r/q]` not free-form. Phase 4 §4.1a adds dual-link standards (local path + canonical GitHub URL) in scaffolded CLAUDE.md. Phase 4 §4.5 step 12 writes `cortex/.adapt-pending` recovery marker; P5 §5.5 deletes it on completion.
- **`prompts/retrofit.md`** — added prerequisite gate: defer to `/audit` if `cortex/AUDIT.md` not present. Existing 5-phase retrofit-application flow preserved.
- **`install.sh` + `install.ps1`** — copy `bin/cortex-bootstrap{,.ps1}` to `~/.claude/shared/bin/`, print "next step" hint pointing the user at the per-project bootstrap command.

### Deferred (Sprint 1.5b)
- `detectors/repo-map.cjs` (tree-sitter + PageRank). Audit prompt P1 ships with degraded grep+find fallback; ranking quality is lower until repo-map detector lands.
- `detectors/hotspots.cjs` (git churn × cyclomatic complexity).
- Note: there is no `PostScaffold` event in Claude Code — Phase 5 dispatch happens in-prompt; recovery if the session is interrupted is handled by the existing `SessionStart` hook reading `cortex/.adapt-pending`.

### Added (2026-05-06 — Sprint 1 install-readiness checkpoint)
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 (canonical text via curl, contact `davidrajnoha@gmail.com`)
- `.github/workflows/no-pii.yml` — CI gate that runs `scripts/sync-to-public.mjs` + `validate-no-pii.mjs` + ship-ready denylist scan on every PR/push to `main`
- `scripts/fix-d4-paths.mjs` — one-shot rewriter that resolved D-4 (path convention `~/.claude/shared/` for installed assets, `$CORTEX_HOME` for live source)
- `scripts/sync-to-public.mjs` + `scripts/validate-no-pii.mjs` — public-snapshot tooling (sanitize-rules-driven find/replace + blacklist scan; rules data itself stays gitignored per `scripts/sanitize-rules.json`)
- `module.yaml` — separated `cortex_root` (live source, default `~/cortex-x`) from `cortex_assets_root` (installed, default `~/.claude/shared`); removed Dave's local `~/Desktop/APPs/` default

### Changed (2026-05-06)
- D-4 RESOLVED — 14 source files (README, prompts/*, evals/*, projects/README.md, config/evolve.yaml) rewritten from `~/cortex-x/<subdir>/` to either `~/.claude/shared/<subdir>/` (installed) or `$CORTEX_HOME/<subdir>/` (live); see MIGRATIONS.md §D-4
- `scripts/sync-to-public.mjs` — replacement engine now honors `scope: all-but-authorship`, preserving maintainer contact in `SECURITY.md` and `CODE_OF_CONDUCT.md`
- `.gitignore` — added `/docs/pohovor-*.md` (maintainer interview-prep pattern; mirrors sanitize-rules `fileExclusions`)

### Added
- **Auto-orchestration layer (MVP).** Claude is now prompted automatically to parallelize research + review and single-thread implementation on new-feature prompts. Evidence-grounded in Anthropic's multi-agent research paper, Cognition's counter-position, and 2025–2026 benchmarks (SWE-bench, PlanCraft, ICSE 2025 deprecated-API study). Soft-gate only; never spawns agents silently.
  - `shared/hooks/auto-orchestrate.cjs` — UserPromptSubmit hook with new-implementation detection (cs + en patterns), research cache freshness lookup with topic-aware TTL, session budget warning injection
  - `shared/hooks/_lib/budget.cjs` — token cost estimation (2026 pricing table), session total tracking, `$CORTEX_DATA_HOME/journal/.budget.jsonl` writer
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
