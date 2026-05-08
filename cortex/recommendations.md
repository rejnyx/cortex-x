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

### 1. APPEND a Sprint 1.8.12 entry to MIGRATIONS.md (append-only, do NOT modify existing entries)
`MIGRATIONS.md` tracks shipped sprints in chronological order, newest entries appended. Sprint 1.8.12 (commits 0deb71c + 4dc5e6d + 15f347a, dated 2026-05-08, +12 tests bringing 772 → 784) is not yet documented. **Critical: this is an APPEND task. Open `MIGRATIONS.md`, locate the END of the file, and append a new section at the bottom (or under any existing "Sprint 1.8.x" parent heading). DO NOT modify, remove, or rewrite any existing content above the insertion point — preserve everything else byte-for-byte.** New section content: heading `## Sprint 1.8.12 — halt-check + apiKey + AUTH_REJECTED hardening (2026-05-08)`, one paragraph summarizing scope (halt-check filter extension to `.cortex-data/` workspace path + apiKey trim defending against trailing-newline GH secret trap + KEY_MALFORMED reject for internal whitespace + AUTH_REJECTED distinct error code for 401/403 + lessons.cjs hint updates + printf-vs-echo doc in workflow + hermes-setup.md), one paragraph on root causes (workspace path collision in halt-check filter + GH secret `echo` trailing-newline silent header strip + provisioning-vs-inference key confusion). Edit only `MIGRATIONS.md`.
[audit: git log 0deb71c..15f347a + Sprint 1.8.12 narrative confirmed by run 25555966159 end-to-end] [src: today's incident loop, in-conversation context]

### 2. Document Sprint 1.8.12 incident series in docs/hermes-usage.md Troubleshooting section
**Critical: this is an APPEND task. Open `docs/hermes-usage.md`, locate the END of the file, and append a new top-level section. DO NOT modify, remove, or rewrite any existing content above the insertion point — preserve all 350+ existing lines byte-for-byte.** Append a new top-level section `## Troubleshooting` containing three sub-sections, one per error code: `### DIRTY_TREE` (symptom: "working tree has uncommitted changes; commit or stash before running Hermes" / diagnostic: `git status --porcelain` / remediation: ensure CORTEX_DATA_HOME is gitignored or set to a path outside the workspace), `### OPENROUTER_KEY_MALFORMED` (symptom: error mentions whitespace or control characters / diagnostic: `echo "$OPENROUTER_API_KEY" | xxd | head` / remediation: re-set with `gh secret set OPENROUTER_API_KEY --body "$KEY"` or `printf %s "$KEY" | gh secret set OPENROUTER_API_KEY` — never `echo "$KEY"`), `### OPENROUTER_AUTH_REJECTED` (symptom: 401 or 403 from OpenRouter / diagnostic: `curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key | jq .data` should return `is_provisioning_key:false` / remediation: generate a new Inference Key from openrouter.ai/keys, NOT a Provisioning Key, and re-set with the printf or --body method above). Edit only `docs/hermes-usage.md`.
[audit: 2026-05-08 runs 25537776797 + 25550701886 + 25551454871 + 25555718573 + 25555966159 + Sprint 1.8.12 commits] [src: today's incident loop]

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
