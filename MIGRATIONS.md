# Migration Log

This file tracks all completed sprints and migration events for the cortex-x project.

## Sprint 1.8.0 — Baseline (2026-04-10)

Initial project scaffold, standards library, and profile system.

## Sprint 1.8.1 — CI hardening + detector framework (2026-04-11)

Added detector auto-framework, first three detectors (package-manager, ts-presence, test-framework).

## Sprint 1.8.2 — Template rendering engine (2026-04-12)

Handlebars-based template rendering with partials, helpers, and layout inheritance.

## Sprint 1.8.3 — Profile + filter merging (2026-04-13)

Profile overlay merging, filter composition across detector/profile/system layers.

## Sprint 1.8.4 — Halt-check safety gate (2026-04-14)

Halt-check pre-execution safety filter for outbound tool calls. Prevents dangerous commands (rm -rf /, dd, etc.).

## Sprint 1.8.5 — Installer parity + test coverage (2026-04-15)

Cross-platform install.sh / install.ps1 parity, 100% install path coverage, first test for installer.

## Sprint 1.8.6 — Observability foundation (2026-04-16)

Structured logging, first metrics (test count + coverage trend), runtime SLO tracking, circ-breaker for API calls.

## Sprint 1.8.7 — Project detection + profile rename (2026-04-17)

New project detection module (package.json, tsconfig, next.config, vite.config). Profile renamed from `nextjs-saas` to `nextjs-ai`.

## Sprint 1.8.8 — Cost guard + budget enforcement (2026-04-18)

Cost guard module per project, budget enforcement, cost-per-repo tracking, burn-rate alerts.

## Sprint 1.8.9 — Agentic-ready scaffold (2026-04-19)

Three-layer memory scaffold (short-term, long-term, episodic). Safe-tool wrapper. `/api/chat` reservation. API cost guards.

## Sprint 1.8.10 — Template finalization + test stabilization (2026-04-20)

Template freeze for v1.0, all templates reviewed + finalized. Test suite stable, no flaky tests.

## Sprint 1.8.11 — AI SDK decision tree + profile audit (2026-04-21)

Added AI SDK decision tree (Vercel AI SDK / Claude Agent SDK / OpenAI Agents SDK). All profiles audited for `ai_sdk:` declaration.

## Sprint 1.8.12 — halt-check + apiKey + AUTH_REJECTED hardening (2026-05-08)

Extended halt-check filter to `.cortex-data/` workspace path, added apiKey trim defending against trailing-newline GH secret trap, introduced KEY_MALFORMED reject for internal whitespace, added AUTH_REJECTED distinct error code for 401/403, updated lessons.cjs hints, documented printf-vs-echo in workflow, and updated hermes-setup.md. Root causes included workspace path collision in halt-check filter, GH secret `echo` trailing-newline silent header strip, and provisioning-vs-inference key confusion.
