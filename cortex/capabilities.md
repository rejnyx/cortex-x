# cortex-x — capability registry

> **AUTO-GENERATED** by [`bin/cortex-capabilities.cjs`](../bin/cortex-capabilities.cjs). Re-run `npm run capabilities` to refresh. Last generated: 2026-05-11T14:43:14.060Z

> Single source of truth for "what cortex-x can do today." Sprint 2.15 ships this as operator-facing answer to *"I do not even know what we have anymore"* and as future Steward system-prompt injection substrate.

## TL;DR — counts

| Category | Count |
|---|---|
| Steward action_kinds | 16 |
| Steward primitives (`bin/steward/_lib/`) | 37 |
| Universal hooks (`shared/hooks/`) | 7 |
| Standards (rule tiers 0-3) | 25 |
| Profiles (`profiles/`) | 11 |
| Prompts (`prompts/`) | 15 |
| Review-pipeline agents (`agents/`) | 9 |
| GitHub workflows | 17 |
| Tests total | 108 (unit 88 · contract 12 · integration 8 · smoke 0) |
| Runtime LoC (`bin/`) | 21 976 |
| Test LoC (`tests/`) | 28 163 |

## 1. Steward action_kinds (16)

What the Steward autonomous runtime is allowed to DO. Dispatched via cron, manual, or recommendation harvester.

| Action kind | Description |
|---|---|
| `recommendation` | Standard cortex/recommendations.md item. LLM produces edits, gates on npm test, atomic commit, draft PR. |
| `recommendation_harvest` | Read closed PRs + CI failures + open issues, append candidate observations to recommendations.md. Read-only — no LLM, no edits to source code. |
| `dep_update_patch` | npm outdated → patch-only diffs → npm test gate → draft PR. Deterministic, no LLM call. |
| `flaky_test_repair` | Marker-based quarantine: scan source for  |
| `doc_drift` | Scan exported symbols (function/class/const/type), check mention in README/CLAUDE.md/docs/, file gh issues for undocumented public API surface. Deterministic — no LLM call. |
| `todo_triage` | Scan TODO/FIXME/XXX/HACK markers older than N days, dedupe vs open issues, file gh issues with git-blame context. Deterministic — no LLM call. |
| `test_coverage_gap` | Cross-reference coverage report (statements < threshold) + recently-edited files, file gh issue per gap. v1: deterministic detection only — LLM-driven test generation parked v0.9+. Capability #6. |
| `lint_fix_shipper` | Run ESLint --fix (auto-fix style + simple violations) + tsc --noEmit (type-check, file issues for non-fixable errors). Deterministic. Capability #8. |
| `pr_review_responder` | Monitor open Hermes-authored PRs for unresolved reviewer comments, file aggregation issue per PR. v1: deterministic surfacing only — auto-patch parked v0.9+. Capability #9. |
| `mutation_score_drift` | Run incremental mutation tests on touched modules; write reports/mutation.json snapshot; compute drift vs prior baseline. v1: snapshot-only (no PR opening, no auto-test-generation). Deterministic — no LLM call. Sprint 2.3b will land the exe |
| `tech_debt_audit` | Run qlty metrics + qlty smells + knip; snapshot to cortex/debt-snapshot.json; compute drift vs prior snapshot. v1: snapshot-only (no PR opening). Deterministic — no LLM call. |
| `pattern_transfer` | Read allowlisted sibling projects (cortex/sibling-projects.json) read-only, distill cross-project patterns into the CURRENT project\ |
| `workflow_hardener` | Advisory analyzer for .github/workflows/*.yml — flags unpinned action SHAs, missing permissions:/concurrency:/timeout-minutes:. v1 opens ONE gh issue with proposed patches; v1.5 will add auto-fix behind explicit env flag. |
| `secret_history_sweep` | TruffleHog full-history scan with --only-verified. On verified hit: opens gh issue with severity LABEL. NO auto-PR. Read-only against working tree; only writes are journal entries + gh issue create. Fail-open if trufflehog binary missing. |
| `senior_tester_review` | 2-stage hybrid test-quality auditor: deterministic detector (~16 smells with regex; tsDetect 21 + Sandoval ESE 2025 13 + cortex-original 5 in registry) + optional LLM judge for strategic synthesis. Writes journal entry + opens ONE gh issue  |
| `release_notes_drafter` | After merge to main, read merged PRs since last release tag, draft release notes. Future capability for v1.0+ release-management automation. |

## 2. Steward primitives (37)

Zero-deps CJS modules in `bin/steward/_lib/` implementing the safety + dispatch + memory layer.

| Module | Sprint | Description |
|---|---|---|
| [`action-engine`](../bin/steward/_lib/action-engine.cjs) | — | pluggable interface for "apply this action's edits" |
| [`action-kinds`](../bin/steward/_lib/action-kinds.cjs) | Sprint 1.8.1 | Sprint 1.8.1 typed action_kind registry |
| [`autoresearch`](../bin/steward/_lib/autoresearch.cjs) | Sprint 2.1 | Sprint 2.1 N-strategy serial autoresearch loop |
| [`cost-safety`](../bin/steward/_lib/cost-safety.cjs) | Sprint 1.9.1 | Sprint 1.9.1 multi-window cost safety + loop detector |
| [`env`](../bin/steward/_lib/env.cjs) | — |  |
| [`gh-ops`](../bin/steward/_lib/gh-ops.cjs) | Sprint 1.6.19 | GitHub CLI wrapper for Hermes draft-PR creation (Sprint 1.6.19) |
| [`git-ops`](../bin/steward/_lib/git-ops.cjs) | — | atomic git operations for Hermes's commit-per-action contract |
| [`git-trailers`](../bin/steward/_lib/git-trailers.cjs) | — | build commit messages with parseable Git trailers (MUST-H3) |
| [`halt-check`](../bin/steward/_lib/halt-check.cjs) | — | file-based kill-switch detection (MUST-H5) |
| [`journal`](../bin/steward/_lib/journal.cjs) | — | append-only structured journal writer (MUST-H4) |
| [`lessons`](../bin/steward/_lib/lessons.cjs) | Sprint 1.8.3 | Sprint 1.8.3 ReasoningBank-lite memory module |
| [`llm-judge-schema`](../bin/steward/_lib/llm-judge-schema.cjs) | Sprint 2.11.2 | Sprint 2.11.2 Correctness H2 fix |
| [`lock`](../bin/steward/_lib/lock.cjs) | — | per-project mutex for Hermes runs (MUST-H2) |
| [`loop-detector`](../bin/steward/_lib/loop-detector.cjs) | Sprint 2.12 | Sprint 2.12 intra-run tool-call loop detector |
| [`memory-decay`](../bin/steward/_lib/memory-decay.cjs) | Sprint 2.8 | Sprint 2.8 — importance-weighted memory decay primitive. |
| [`otel-emitter`](../bin/steward/_lib/otel-emitter.cjs) | Sprint 2.0 | Sprint 2.0 zero-deps OTLP HTTP emitter for Steward |
| [`otel-protobuf`](../bin/steward/_lib/otel-protobuf.cjs) | Sprint 2.0.1 | Sprint 2.0.1 zero-deps OTLP protobuf encoder |
| [`policy-check`](../bin/steward/_lib/policy-check.cjs) | — | Steward Ring 1 denylist (over block-destructive Ring 2) |
| [`project-ledger`](../bin/steward/_lib/project-ledger.cjs) | Sprint 2.2 | Sprint 2.2 (Ralph-inspired): append-only success-side |
| [`recommendations`](../bin/steward/_lib/recommendations.cjs) | — | parser for cortex/recommendations.md |
| [`research-trigger`](../bin/steward/_lib/research-trigger.cjs) | Sprint 2.14 | Sprint 2.14 research-when-uncertain rule mechanics |
| [`routing-policy`](../bin/steward/_lib/routing-policy.cjs) | Sprint 2.0b | Sprint 2.0b per-action USD cap + journal scan |
| [`routing-table`](../bin/steward/_lib/routing-table.cjs) | Sprint 2.0b | Sprint 2.0b action-kind-based model routing |
| [`safety`](../bin/steward/_lib/safety.cjs) | Sprint 2.5b | Shared SSOT for slug/date guards + markdown sanitization + |
| [`secret-sweep-action`](../bin/steward/_lib/secret-sweep-action.cjs) | Sprint 2.6b | Sprint 2.6b TruffleHog wrapper |
| [`self-invocation`](../bin/steward/_lib/self-invocation.cjs) | Sprint 2.13 | Sprint 2.13 self-invocation tracker + 4 hard guardrails |
| [`senior-tester-action`](../bin/steward/_lib/senior-tester-action.cjs) | Sprint 2.11 | Sprint 2.11 senior_tester_review Phase B + C |
| [`sibling-manifest`](../bin/steward/_lib/sibling-manifest.cjs) | Sprint 2.7 | Sprint 2.7 — sibling-projects manifest validator. |
| [`sibling-reader`](../bin/steward/_lib/sibling-reader.cjs) | Sprint 2.7 | Sprint 2.7 — sibling-projects read-only file access helper. |
| [`snapshot-diff`](../bin/steward/_lib/snapshot-diff.cjs) | Sprint 2.5 | Sprint 2.5 — zero-deps JSON snapshot diff helper. |
| [`spec-verifier`](../bin/steward/_lib/spec-verifier.cjs) | Sprint 1.9.0 | Sprint 1.9.0 spec-driven verification runner |
| [`splice`](../bin/steward/_lib/splice.cjs) | Sprint 2.2.5 | Sprint 2.2.5 v0+v1: position-aware file edit primitive |
| [`tech-debt-audit`](../bin/steward/_lib/tech-debt-audit.cjs) | Sprint 2.5 | Sprint 2.5 — tech_debt_audit executor. |
| [`test-smell-detector`](../bin/steward/_lib/test-smell-detector.cjs) | Sprint 2.11 | Sprint 2.11 senior_tester_review Phase A |
| [`test-smell-registry`](../bin/steward/_lib/test-smell-registry.cjs) | Sprint 2.11 | Sprint 2.11 senior_tester_review smell taxonomy |
| [`verifier`](../bin/steward/_lib/verifier.cjs) | — | runs the project's verification commands (`npm test` and |
| [`workflow-hardener-action`](../bin/steward/_lib/workflow-hardener-action.cjs) | Sprint 2.5b | Sprint 2.5b advisory analyzer |

## 3. Universal hooks (7)

Claude Code session hooks shipped to `~/.claude/shared/hooks/` via install. Apply to every project.

| Hook | Description |
|---|---|
| [`auto-orchestrate`](../shared/hooks/auto-orchestrate.cjs) | cortex-x UserPromptSubmit hook — auto-orchestration soft-gate. |
| [`block-destructive`](../shared/hooks/block-destructive.cjs) | // Filesystem destruction |
| [`post-tool-use`](../shared/hooks/post-tool-use.cjs) | ---- Silent error log (observability for catch-swallowed failures) ---- |
| [`pre-compact`](../shared/hooks/pre-compact.cjs) | Build recovery file |
| [`pre-tool-use`](../shared/hooks/pre-tool-use.cjs) | ---- Silent error log (mirrors post-tool-use.cjs, shares redact lib) ---- |
| [`session-start`](../shared/hooks/session-start.cjs) | // Detect active sprint/phase (### or ####, NOT marked done) |
| [`tirith-scan`](../shared/hooks/tirith-scan.cjs) | cortex-x SessionStart hook — context-file prompt-injection scanner (Tirith wrapper). |

## 4. Standards (25)

Rule tiers — see [`standards/RULE-1.md`](../standards/RULE-1.md) for hierarchy (Rule 0 distribution / 1 invariants / 1.5 coding behavior / 2 critical / 3 process).

| Standard | Title | Snippet |
|---|---|---|
| [`accessibility`](../standards/accessibility.md) | Accessibility — Usable by Everyone | 1. **Perceivable** — content is presented in ways users can perceive (text alternatives, captions, color contrast) |
| [`ai-patterns`](../standards/ai-patterns.md) | AI Patterns — Agentic Architecture Standards | **Agentic-ready by default, agentic-heavy by intent.** |
| [`ai-sdks`](../standards/ai-sdks.md) | AI SDKs — Selection Standard | \| SDK \| Vendor \| Lang \| Model lock-in \| Best at \| |
| [`auto-optimization`](../standards/auto-optimization.md) | Auto-Optimization — Wizard Philosophy | **Rule 1.5 extension.** Not inviolable (Rule 1), but a contract on how cortex-x behaves. Violations degrade UX; don't break projects. |
| [`auto-orchestration`](../standards/auto-orchestration.md) | Standard — Auto-Orchestration (3-fronta rule) | \| Front \| Parallelize? \| Default count \| Evidence \| |
| [`coding-behavior`](../standards/coding-behavior.md) | Coding Behavior — Meta-Rules for LLM Code Generation | 2026-04-17 retrospective: the cortex-x scaffold work itself committed two behavioral anti-patterns caught only after the 5-agent review pipeline ran. Mass find-replace of a maintainer's name (drive-by refactor) and over-engineered 200-line  |
| [`coding-behavior-examples`](../standards/coding-behavior-examples.md) | Coding Behavior — Concrete Examples | **Task:** "Add user export." |
| [`correctness`](../standards/correctness.md) | Correctness — Verification Beyond Structure | **Rule 2 (Critical)** — alongside Security, Testing, Observability. Must-have for any project moving beyond prototype. Review-pipeline flag = blocker. |
| [`documentation`](../standards/documentation.md) | Documentation — Knowledge That Outlives Your Memory | **Document decisions, not code.** Code explains itself (with good naming). Comments explain why. |
| [`error-handling`](../standards/error-handling.md) | Error Handling — Fail Gracefully, Recover Automatically | 1. **Fail fast at boundaries, fail gracefully inside.** Validate at API entry, crash early. Within the app, catch and recover. |
| [`git-workflow`](../standards/git-workflow.md) | Git Workflow — Commit Like a Pro | ``` |
| [`modular`](../standards/modular.md) | Modular — Isolated Subsystems | Tightly coupled code is where bugs hide and velocity dies. When changing X requires touching A, B, C, you don't change X — you avoid it. Modularity buys you the ability to refactor, replace, and scale individual pieces without cascading rew |
| [`observability`](../standards/observability.md) | Observability — See What's Happening in Production | 1. **Logs** — what happened |
| [`performance`](../standards/performance.md) | Performance — Fast by Default | - **Core Web Vitals targets (2026):** |
| [`RULE-1`](../standards/RULE-1.md) | RULE 1 — Inviolable Architectural Invariants | Every piece of knowledge has **exactly one authoritative source**. No duplication. No drift. |
| [`scalable`](../standards/scalable.md) | Scalable — Patterns That Survive 10x Growth | You won't know in advance which project succeeds. The ones that take off punish you for shortcuts taken early. Scalable-by-default means growth is exciting, not a crisis. |
| [`security`](../standards/security.md) | Security — Layered Defense from Day One | 1. **No secrets in git.** `.env` in `.gitignore` from first commit. Pre-commit hook blocks accidental commits. |
| [`self-correction`](../standards/self-correction.md) | Self-Correction — What Actually Works in 2026 | **Rule 2 (Critical).** Alongside Correctness — this standard prevents adopting patterns that measurably degrade agent quality. |
| [`ship-ready`](../standards/ship-ready.md) | Ship-Ready — Governance Invariants for Distribution | Anything a stranger would never need to know about the maintainer must not live in templates, prompts, standards, profiles, hooks, or install scripts. Includes: |
| [`skills`](../standards/skills.md) | Skills — Portable, Progressive-Disclosure Agent Instructions | **Rule 3 (Process)** — should-have convention. Skills are optional for trivial projects but deliver large leverage when you have repeatable procedures. |
| [`ssot`](../standards/ssot.md) | SSOT — Single Source of Truth | Duplicated knowledge drifts. Labels in 3 files become 3 slightly different labels. Constants in 5 places become 5 different values after one hasty edit. Bug fixes get applied to 4 of 5 copies. Entropy wins. |
| [`steward-policy`](../standards/steward-policy.md) | Steward Policy — Refusal List, Denylist, MUST patterns | Steward refuses the following at the tool-wrapper layer, **not via system prompt**. Promptword-only enforcement fails under prompt injection (Replit Agent prod-DB wipe, July 2025, is the canonical incident). All seven refusals are encoded i |
| [`story-sizing`](../standards/story-sizing.md) | Story Sizing — Rule 3 | Cortex-x scaffolds projects whose recommendation backlogs are consumed by autonomous agents (Steward, manual `/audit`, Ralph-style loops). Action items must be sized so an LLM can complete one in a single context window without losing track |
| [`test-types-catalog`](../standards/test-types-catalog.md) | Test Types — Exhaustive 2026 Catalog (SSOT) | **For the audit (Phase 5 selection oracle):** |
| [`testing`](../standards/testing.md) | Testing — Confidence Through Layered Coverage | Without tests: |

## 5. Profiles (11)

Project archetypes used by the scaffold. Each declares stack, ai_sdk, agentic posture.

| Profile | Agentic-ready | AI SDK | Description |
|---|---|---|---|
| [`ai-agent`](../profiles/ai-agent.yaml) | — | claude-agent    # autonomy tier: filesystem/shell, Skills, MCP, subagents | Autonomous multi-step AI agent — Claude Agent SDK primary, Vercel AI SDK optional for web surface, three-layer memory, MCP integration |
| [`astro-static`](../profiles/astro-static.yaml) | — | none | Static site (portfolio, blog, docs) — Astro 5 with Content Layer, Server Islands, zero-JS default |
| [`browser-agent`](../profiles/browser-agent.yaml) | — | — | Agent that drives a real browser (CDP/Playwright) — scraping, RPA, automated testing, onboarding flows, workflow automation. Extends ai-agent profile with browser-specific security + tooling. |
| [`cli-tool`](../profiles/cli-tool.yaml) | — | none            # most CLIs are non-AI. Set to 'claude-agent' for AI-primary CLIs. | Node.js CLI tool distributed via npm — command-line utility with prompts, colored output, cross-platform |
| [`chatbot-platform`](../profiles/chatbot-platform.yaml) | — | vercel          # primary: streaming + provider-agnostic for multi-tenant flexibility | Multi-tenant chatbot platform — channel adapters (Telegram, WhatsApp, Web, Chatwoot), RLS tenant isolation, orchestrator |
| [`kiosek`](../profiles/kiosek.yaml) | — | none | Restaurant self-service touch kiosk — PWA, offline-first, large tap targets, idle timeout |
| [`minimal`](../profiles/minimal.yaml) | — | none | Minimal scaffold for quick prototypes and experiments — no heavy architecture |
| [`nextjs-saas`](../profiles/nextjs-saas.yaml) | ✅ | vercel          # web tier: streaming UI, provider-agnostic, Next.js-native | Next.js 16 + Supabase + AI SaaS — the primary agentic-SaaS stack, AGENTIC-READY by default. Even without AI at MVP, structure allows plug-in without refactor. |
| [`qa-engineer`](../profiles/qa-engineer.yaml) | ✅ | vercel       # web tier; AI-aug agents like Claude Code MCP slot in here | QA-focused profile — for projects where the audit + retrofit goal is testing strategy specifically (existing repo, AI-augmented tester, ISO 25010 + ASVS 5.0 alignment). Pairs with /test-audit prompt. |
| [`tauri-desktop`](../profiles/tauri-desktop.yaml) | — | vercel          # webview frontend; works well for embedded chat UIs | Cross-platform desktop app — Tauri 2 (Rust backend + Web frontend), 3MB binary, iOS/Android targets |
| [`waas-template`](../profiles/waas-template.yaml) | — | vercel          # ready for per-tenant AI features (chatbots, copy gen) | Website-as-a-Service template — multi-tenant website with design system, style presets, per-client customization |

## 6. Prompts (15)

Reusable Claude Code prompts in `prompts/`. Invoke via `/`-commands or paste-into-session.

| Prompt | Title | Purpose |
|---|---|---|
| [`auto-review`](../prompts/auto-review.md) | Auto-Review — post-implementation parallel pipeline |  |
| [`code-review`](../prompts/code-review.md) | Code Review — Parallel Adversarial Pipeline |  |
| [`cortex-doctor`](../prompts/cortex-doctor.md) | Cortex Doctor — Self-Healthcheck + Drift Detection |  |
| [`cortex-evolve`](../prompts/cortex-evolve.md) | Cortex Evolve — Self-Improvement Loop | Účel:** cortex-x se sám zlepšuje z akumulovaných dat napříč uživatelovými projekty. Weekly consolidation + monthly refinement. **Nikdy nepřepisuje sám sebe** — vždy otevře PR, uživatel reviewuje. |
| [`cortex-load`](../prompts/cortex-load.md) | Cortex Load — The Mental Model |  |
| [`cortex-reflect`](../prompts/cortex-reflect.md) | Cortex Reflect Prompt — Manual Deep Reflection |  |
| [`cortex-sync`](../prompts/cortex-sync.md) | Cortex Sync Prompt |  |
| [`existing-project-audit`](../prompts/existing-project-audit.md) | Existing Project Audit — Deep 12-Dimension Analysis + Auto-Research + Retrofit |  |
| [`new-project`](../prompts/new-project.md) | New Project — Discovery + Auto-Research + Architect + Scaffold + Adapt |  |
| [`project-scan`](../prompts/project-scan.md) | Universal Project Scan Prompt (SLIM) |  |
| [`qa-retrofit`](../prompts/qa-retrofit.md) | QA Retrofit — Deep Test-Strategy Audit + Risk Worm-Through + Cited Gap Backlog |  |
| [`retrofit`](../prompts/retrofit.md) | Retrofit — apply cortex-x structure to an existing (messy) project |  |
| [`retrospective`](../prompts/retrospective.md) | Retrospective — Post-Sprint Reflection → cortex library |  |
| [`sprint-status`](../prompts/sprint-status.md) | Sprint Status — Parse PROGRESS.md and Report |  |
| [`steward-setup`](../prompts/steward-setup.md) | Steward setup — guided activation flow |  |

## 7. Review-pipeline agents (9)

Specialized review agents dispatched by R2 review pipeline. Each lives in `agents/` with its own tool allowlist.

| Agent | Tools | Description |
|---|---|---|
| [`acceptance-auditor`](../agents/acceptance-auditor.md) | - Read | Reviews diff against acceptance criteria (story/spec/PROGRESS.md). Checks that the implementation actually does what was asked, no more, no less. Has read access to PROGRESS.md, CLAUDE.md, and specs. |
| [`blind-hunter`](../agents/blind-hunter.md) | - Read | Reviews code diff WITHOUT project context. Catches bugs that contextual reviewers rationalize away. Input: git diff only. No project access, no history, no specs. Surfaces: obvious bugs, typos, logic errors, missing error handling, security |
| [`correctness-auditor`](../agents/correctness-auditor.md) | - Read | Correctness-focused code review against cortex-x/standards/correctness.md. Checks: trust-boundary validation (Zod/Pydantic), property-based test coverage on invariant code, eval suite for LLM endpoints, mutation score on critical modules, s |
| [`cortex-thinker`](../agents/cortex-thinker.md) | - Read | Meta-agent that reflects on cortex-x state, detects cross-project patterns, and surfaces proactive suggestions. Invoked at SessionStart, Stop events, or manually via /cortex-reflect. Reads cortex-x/projects/ library and proposes insights gr |
| [`edge-case-hunter`](../agents/edge-case-hunter.md) | - Read | Walks every branching path and boundary condition in changed code. Reports ONLY unhandled edge cases. Has project read access for context, but focuses on what inputs would break the code. Orthogonal to adversarial review — method-driven, no |
| [`planner`](../agents/planner.md) | — | Reads detected stack + project context, picks 3-5 most relevant research topics from the {profile} × {concern} matrix. Used by Phase 5 Adapt (new-project) and Phase 4 Research (existing-project-audit). Returns a prioritized JSON list of top |
| [`security-auditor`](../agents/security-auditor.md) | - Read | Security-focused code review against cortex-x/standards/security.md 8-layer model. Checks: secrets leakage, RLS violations, injection vectors, auth bypass, missing rate limits, insecure defaults. Flags findings with severity + CWE reference |
| [`ssot-enforcer`](../agents/ssot-enforcer.md) | - Read | Scans diff for SSOT (Single Source of Truth) violations per cortex-x/standards/ssot.md. Detects duplicated constants, hardcoded labels that should be in config, copy-paste code that should be extracted, multiple sources of truth for the sam |
| [`synthesizer`](../agents/synthesizer.md) | — | Reads parallel research outputs (planner-dispatched topics) and writes the per-project recommendations.md plus a § Stack reality check section appended to CLAUDE.md. Enforces three-hop citation traceability (claim → finding ID → source URL) |

## 8. GitHub workflows (17)

CI + Steward cron workflows in `.github/workflows/`.

| Workflow | Triggers | Description |
|---|---|---|
| [`install-smoke`](../.github/workflows/install-smoke.yml) | cron(17 3 * * *) · manual · push · pull_request | 5-lane matrix: linux/macOS bash + Windows (Git Bash, pwsh 7, Windows PowerShell 5.1). |
| [`no-pii`](../.github/workflows/no-pii.yml) | push · pull_request | Two-mode CI gate. |
| [`steward autoresearch (weekly Sunday)`](../.github/workflows/steward-autoresearch.yml) | cron(0 2 * * 0) · manual | steward-autoresearch.example.yml — Sprint 2.1 weekly autoresearch overnight |
| [`steward dep-patch`](../.github/workflows/steward-dep-patch.yml) | cron(0 4 * * 0) · manual | steward-dep-patch.yml — autonomous Steward patch-only dep updater workflow. |
| [`steward doc-drift`](../.github/workflows/steward-doc-drift.yml) | cron(0 5 1 * *) · manual | steward-doc-drift.yml — autonomous Steward documentation-drift detector. |
| [`steward flaky-test-repair`](../.github/workflows/steward-flaky-test-repair.yml) | cron(0 7 * * 2) · manual | steward-flaky-test-repair.yml — autonomous Steward flaky-test quarantiner. |
| [`steward harvest`](../.github/workflows/steward-harvest.yml) | cron(0 3 * * *) · manual | steward-harvest.yml — autonomous Steward recommendation harvester workflow. |
| [`steward lint-fix`](../.github/workflows/steward-lint-fix.yml) | cron(0 8 * * 3) · manual | steward-lint-fix.yml — autonomous Steward eslint --fix shipper. |
| [`steward nightly`](../.github/workflows/steward.yml) | cron(0 4 * * *) · manual | steward.yml — autonomous Steward runtime workflow (renamed from hermes.yml |
| [`steward pr-review-responder`](../.github/workflows/steward-pr-review-responder.yml) | cron(0 */4 * * *) · manual | steward-pr-review-responder.yml — autonomous Steward PR comment responder. |
| [`steward secret-history-sweep`](../.github/workflows/steward-secret-history-sweep.yml) | cron(0 2 * * 0) · manual | steward-secret-history-sweep.yml — Sprint 2.6b weekly cron. |
| [`steward senior-tester-review`](../.github/workflows/steward-senior-tester-review.yml) | cron(0 4 1 * *) · manual | steward-senior-tester-review.yml — Sprint 2.11 monthly cron. |
| [`steward tech-debt-audit`](../.github/workflows/steward-tech-debt-audit.yml) | cron(0 9 * * 4) · manual | steward-tech-debt-audit.yml — autonomous Steward qlty + knip snapshot. |
| [`steward test-coverage-gap`](../.github/workflows/steward-test-coverage-gap.yml) | cron(0 6 * * 1) · manual | steward-test-coverage-gap.yml — autonomous Steward coverage-gap detector. |
| [`steward todo-triage`](../.github/workflows/steward-todo-triage.yml) | cron(0 4 1 * *) · manual | steward-todo-triage.yml — autonomous Steward TODO/FIXME triage workflow. |
| [`steward workflow-hardener`](../.github/workflows/steward-workflow-hardener.yml) | cron(0 3 * * 0) · manual | steward-workflow-hardener.yml — Sprint 2.5b weekly cron. |
| [`test`](../.github/workflows/test.yml) | manual · push · pull_request | Fast lane — Linux only, runs the full test suite on every PR + push. |

---

## Regeneration

```bash
npm run capabilities          # writes cortex/capabilities.md + .json
node bin/cortex-capabilities.cjs --json    # machine output
node bin/cortex-capabilities.cjs           # human markdown to stdout
```

A GitHub Actions workflow (`capabilities-refresh.yml`) re-generates this file on every push to `main`. Manual runs are also OK.
