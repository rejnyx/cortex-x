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

### 1. CREATE a NEW file docs/troubleshooting.md documenting the Sprint 1.8.12+1.8.13 error codes
**This is a CREATE task — `docs/troubleshooting.md` does NOT exist yet.** Generate the file from scratch with this exact structure:

- Top-level heading: `# Hermes Runtime Troubleshooting`
- A 1-2 sentence preamble explaining the file's purpose (operator-facing diagnostic guide for Hermes runtime errors).
- Section `## DIRTY_TREE` with three labeled paragraphs: **Symptom** (the literal error string `working tree has uncommitted changes; commit or stash before running Hermes` and which step it fires from), **Diagnostic** (run `git status --porcelain` and check whether `.cortex-data/` or workflow-generated artifacts appear; correlate with `CORTEX_DATA_HOME` env in the workflow), **Remediation** (ensure `CORTEX_DATA_HOME` either points outside the repo or its target directory is gitignored; mention Sprint 1.8.12 added `.cortex-data/` to the framework gitignore + the halt-check filter recognizes the path).
- Section `## OPENROUTER_KEY_MALFORMED` with same three labeled paragraphs: **Symptom** (error message includes "whitespace or control characters"), **Diagnostic** (the runtime now trims the env var and rejects internal whitespace before the fetch), **Remediation** (re-set the secret with `gh secret set OPENROUTER_API_KEY --body "$KEY"` or `printf %s "$KEY" | gh secret set OPENROUTER_API_KEY` — never `echo "$KEY" | gh secret set` because trailing `\n` silently strips the Authorization header in undici).
- Section `## OPENROUTER_AUTH_REJECTED` with same three labeled paragraphs: **Symptom** (HTTP 401/403 from OpenRouter, distinct error code from generic HTTP_ERROR), **Diagnostic** (`curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key | jq .data` should return `is_provisioning_key:false`), **Remediation** (generate a new Inference Key in the OpenRouter dashboard — provisioning keys cannot make /chat/completions calls — and re-set the secret with `--body` or `printf` above).
- Section `## EDIT_DESTRUCTIVE_REWRITE` with same three labeled paragraphs: **Symptom** (error mentions "would shrink existing file" with byte counts; from Sprint 1.8.13), **Diagnostic** (existing file is ≥ 200 bytes, LLM returned new content < 50% of existing size), **Remediation** (reword the recommendation with explicit "APPEND/INSERT only, preserve existing content" language; if rewrite is intentional, set `"replace_all": true` on the edit in the plan; watch for fabricated content as the LLM may invent prior history when rewriting).

Use `docs/troubleshooting.md` as the path. Do NOT edit any existing file as part of this action.
[audit: 2026-05-08 runs 25537776797 + 25550701886 + 25551454871 + 25555966159 + 25556237198 + 25556792186] [src: Sprint 1.8.12 + 1.8.13 commits 0deb71c..182c310]

### 2. APPEND a Sprint 1.8.12 + 1.8.13 entry at the END of MIGRATIONS.md (preserve all existing content)
This task requires preserving the entire existing `MIGRATIONS.md` (66+ KB, 600+ lines of Sprint 1.6.x → 1.8.11 history). Set `"replace_all": false` (default) on the edit. Open `MIGRATIONS.md`, copy ALL existing content verbatim into the new edit content, then append at the very end (after the last section): a new heading `## Sprint 1.8.12 + 1.8.13 — halt-check, apiKey, AUTH_REJECTED, content-preservation guardrail (2026-05-08)` followed by ~5-8 sentences summarizing scope (4 commits 0deb71c → 182c310, +18 tests bringing 772 → 790), root causes (workspace path collision + GH secret `\n` trap + provisioning-vs-inference confusion + LLM destructive-rewrite pattern with fabricated content), defenses shipped (halt-check filter on `.cortex-data/`, apiKey trim + KEY_MALFORMED, AUTH_REJECTED distinct, EDIT_DESTRUCTIVE_REWRITE with 50% shrink threshold + replace_all opt-out, lesson hint normalization), and follow-ups for downstream consumers. **Do NOT remove, modify, or summarize any content above the new heading. The file should grow, not shrink.**
[audit: git log 0deb71c..182c310] [src: today's incident loop end-to-end verified]

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
