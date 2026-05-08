---
phase: 5-synthesis
date: 2026-05-08
slug: cortex-x
based_on:
  audit: Sprint 1.8.12 incident series (2026-05-08 nightly cron diagnostic loop) + 2026-05-07 external review residuals
  research: today's diagnostic curl + 3 parallel research briefs from 2026-05-07 (topology, triggers/safety, git workflow)
---

# Recommendations — cortex-x

This is cortex-x's own `recommendations.md`. Hermes runtime dogfood target.
Action items below derived from (a) the 2026-05-08 Sprint 1.8.12 incident
series (3 cron failures → 3 hardening commits → end-to-end auth path
verified), (b) Sprint 1.6.7 + 1.6.8 architectural decisions still pending,
(c) the 2026-05-07 external review's still-open ship-blockers.

## DO this week (cited)

### 1. Document Sprint 1.8.12 incident series in docs/hermes-usage.md Troubleshooting section
The 2026-05-08 cron failure series surfaced three distinct safety paths that future operators will hit: `DIRTY_TREE` (halt-check workspace artifact filter — root cause: workflow `CORTEX_DATA_HOME=$WORKSPACE/.cortex-data` collided with halt-check filter that only knew `cortex/journal/` legacy path), `OPENROUTER_KEY_MALFORMED` (whitespace defense — root cause: `echo "key" | gh secret set` adds trailing newline, undici fetch silently strips Authorization header), and `OPENROUTER_AUTH_REJECTED` (401/403 distinct from generic HTTP error — root cause: provisioning vs inference key confusion). docs/hermes-usage.md currently has no Troubleshooting section. Add one as a new top-level §, with one sub-section per error code containing: symptom (the literal error message users will see), diagnostic command (e.g. `curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key | jq .data` for AUTH_REJECTED), and remediation steps. Edit only `docs/hermes-usage.md`.
[audit: 2026-05-08 runs 25537776797 + 25550701886 + 25551454871 + 25555718573] [src: Sprint 1.8.12 commits 0deb71c + 4dc5e6d + 15f347a]

### 2. Add Sprint 1.8.12 entry to MIGRATIONS.md
MIGRATIONS.md tracks shipped sprints. Sprint 1.8.12 (3 commits, 12 new tests, halt-check + apiKey + AUTH_REJECTED hardening) is not yet documented. Add an entry with: date 2026-05-08, scope (halt-check filter extension to `.cortex-data/` + apiKey trim + KEY_MALFORMED reject + AUTH_REJECTED distinct error code + lessons.cjs hint updates + printf-vs-echo doc), test count delta (772 → 784), root-cause analysis (workspace path collision + GH secret newline trap + provisioning-vs-inference key confusion), and follow-ups for downstream consumers (existing Hermes deployments should cherry-pick or upgrade). Edit only `MIGRATIONS.md`.
[audit: git log 0deb71c..15f347a] [src: today's incident loop, in-conversation context]

### 3. Refresh CLAUDE.md Phase 7 status to reflect v0.6 + v0.7 + v0.8 + Sprint 1.8.12
CLAUDE.md § Phase 7 currently lists v0.5b shipped (Sprint 1.6.13–1.6.18) plus Sprint 1.6.19 in-progress, but does NOT reflect: v0.6 onboarding (Sprint 1.7.x — locale-aware templates, identity capture, hermes-setup prompt, session-start nudge), v0.7 capability foundation (Sprint 1.8.1–1.8.4 + 1.8.7 — typed action_kind dispatcher, harvester, dep-patch, todo-triage, ReasoningBank-lite memory), v0.8 9-kind capability palette complete (Sprint 1.8.5/6/9/10/11 — flaky-test, doc-drift, lint-fix, coverage-gap, pr-responder), or Sprint 1.8.12 hardening. Update the §Phase 7 bullets to reflect current state: 9 capabilities shipped, 3 cron schedules live (daily 03:00 harvester, daily 04:00 recommendation, weekly Sunday dep-patch, monthly 1st todo-triage), 784 tests, halt-check defense-in-depth landed. Edit only `CLAUDE.md`.
[audit: CLAUDE.md vs git log range f7f8134..15f347a] [src: README ↔ reality alignment per Sprint 1.6.5 norm + 2026-05-07 memory entries]

## DO this sprint (cited)

### 4. D-1 git history PII purge + v0.1.0 tag
1+ month ship-blocker. Per external review: "Phase 1 'in progress' už 1+ měsíc bez v0.1.0 tagu" + "D-1 (git history PII purge) je 🔴 Critical OPEN ship-blocker". Destructive force-push of git history → human-only operation. After D-1 closes: tag v0.1.0, flip repo public, soft-launch closed-beta.
[audit: external review 2026-05-07] [src: MIGRATIONS.md D-1 entry]

### 5. First production Hermes target — pick one of RELO / Kiosek / Chatbot Platform
After cortex-x dogfood proves stable for 3 weeks (per `docs/hermes-research-synthesis.md` v0 assumption #4), expand Hermes to one production project. RELO is the highest-value (most active, most tests, most patterns), Kiosek is the lowest-risk (smaller codebase, less customer impact). 2026-05-08 update: dogfood now has end-to-end auth path verified (run 25555718573 LLM call succeeded after Sprint 1.8.12 hardening). Decision deferred until cortex-x dogfood produces ≥3 successful weekly runs with draft PRs merged.
[audit: hermes-research-synthesis.md § v0 assumption #4 + Sprint 1.8.12 dogfood verification] [src: 3-week-dogfood-window]

## DONE — moved out of "DO this week" 2026-05-08

The following items were on the original 2026-05-07 list but are now shipped or moot. Kept here for traceability:

- **~~Pivot v1 trigger model from crontab to GitHub Actions~~** — DONE. `.github/workflows/hermes.yml` + `hermes-harvest.yml` + `hermes-dep-patch.yml` + `hermes-todo-triage.yml` all live as of Sprint 1.8.8.
- **~~Self-referential PII helper for verify-* validators~~** — MOOT. The three flagged validators stabilized in Sprint 1.6.18; pattern not recurring.
- **~~Tier 8 agentskills.io v1 spec extensions~~** — DONE. `tools/verify-skills.cjs` validates Tier 8 extensions (allowed-tools, disable-model-invocation, model, metadata, license) per Sprint 1.6.10. Tests in 776/776 grid.
- **~~v0.5 milestone Claude Agent SDK integration~~** — SUPERSEDED. Sprint 1.6.13 pivoted to OpenRouter via built-in `fetch()` (zero-deps preserved). Claude SDK seam still reachable via explicit `--engine=claude-sdk` flag but parked indefinitely.
