---
phase: 5-synthesis
date: 2026-05-09
slug: cortex-x
based_on:
  audit: Sprint 1.8.12 incident series (2026-05-08) + 2026-05-09 vision lock-in (persistent agent) + 2026-05-07 external review residuals
  research: today's diagnostic curl + 3 parallel research briefs from 2026-05-07 (topology, triggers/safety, git workflow) + 2026-05-08 SOTA brainstorm + 4-repo inspection
---

# Recommendations — cortex-x

This is cortex-x's own `recommendations.md`. Hermes runtime dogfood target.
Action items below derived from (a) the 2026-05-08 Sprint 1.8.12 incident
series (3 cron failures → 3 hardening commits → end-to-end auth path
verified + Hermes' first autonomous PR #5 merged 2026-05-09),
(b) the 2026-05-09 v1+ roadmap landing (`docs/hermes-roadmap.md`),
(c) the 2026-05-07 external review's still-open ship-blockers.

## DO this week (cited)

### 1. APPEND a Sprint 1.8.12 + 1.8.13 entry at the END of MIGRATIONS.md (preserve all existing content)
This task requires preserving the entire existing `MIGRATIONS.md` (66+ KB, 600+ lines of Sprint 1.6.x → 1.8.11 history). Set `"replace_all": false` (default) on the edit. Open `MIGRATIONS.md`, copy ALL existing content verbatim into the new edit content, then append at the very end (after the last section): a new heading `## Sprint 1.8.12 + 1.8.13 — halt-check, apiKey, AUTH_REJECTED, content-preservation guardrail (2026-05-08)` followed by ~5-8 sentences summarizing scope (4 commits 0deb71c → 182c310, +18 tests bringing 772 → 790), root causes (workspace path collision + GH secret `\n` trap + provisioning-vs-inference confusion + LLM destructive-rewrite pattern with fabricated content), defenses shipped (halt-check filter on `.cortex-data/`, apiKey trim + KEY_MALFORMED, AUTH_REJECTED distinct, EDIT_DESTRUCTIVE_REWRITE with 50% shrink threshold + replace_all opt-out, lesson hint normalization), and follow-ups for downstream consumers. **Do NOT remove, modify, or summarize any content above the new heading. The file should grow, not shrink.**
[audit: git log 0deb71c..182c310] [src: today's incident loop end-to-end verified]

### 2. Sprint 1.9 — Spec-driven verification (per docs/hermes-roadmap.md Tier 1)
Generalize Sprint 1.8.13's hardcoded content-preservation guardrail into per-kind acceptance criteria. New schema `cortex/specs/<kind>.spec.yaml` with `acceptance_criteria: []` (shell predicates or JS functions). New module `bin/hermes/_lib/eval-agent.cjs` runs criteria after `npm test`, journals each result. New error code `EDIT_SPEC_VIOLATION`. R1 research dispatch for SOTA (GitHub Spec Kit, AWS Kiro, EvalAgent paper) precedes implementation per roadmap operating principle R1. Effort M (2-3 days focused work). Unblocks Sprint 2.1 (autoresearch fitness signal) + Sprint 2.2 (worktree workers verify against same spec) + Sprint 3.0 (evolution needs richer fitness than `npm test` boolean).
[audit: docs/hermes-roadmap.md § 3 Sprint 1.9 spec + Sprint 1.8.13 incident class] [src: persistent-agent vision 2026-05-09 + Spec Kit 84k stars + arXiv 2510.24358]

## DO this sprint (cited)

### 3. D-1 git history PII purge + v0.1.0 tag
1+ month ship-blocker. Per external review: "Phase 1 'in progress' už 1+ měsíc bez v0.1.0 tagu" + "D-1 (git history PII purge) je 🔴 Critical OPEN ship-blocker". Destructive force-push of git history → human-only operation. After D-1 closes: tag v0.1.0, flip repo public, soft-launch closed-beta.
[audit: external review 2026-05-07] [src: MIGRATIONS.md D-1 entry]

### 4. First production Hermes target — pick one of RELO / Kiosek / Chatbot Platform
After cortex-x dogfood proves stable for 3 weeks (per `docs/hermes-research-synthesis.md` v0 assumption #4), expand Hermes to one production project. RELO is the highest-value (most active, most tests, most patterns), Kiosek is the lowest-risk (smaller codebase, less customer impact). 2026-05-08 update: dogfood now has end-to-end auth path verified (run 25555718573 LLM call succeeded after Sprint 1.8.12 hardening). 2026-05-09 update: Hermes' first autonomous PR #5 (docs/troubleshooting.md) merged successfully — first end-to-end self-evolving cycle complete. Decision deferred until cortex-x dogfood produces ≥3 successful weekly runs with draft PRs merged.
[audit: hermes-research-synthesis.md § v0 assumption #4 + Sprint 1.8.12 dogfood verification + 2026-05-09 PR #5 merge] [src: 3-week-dogfood-window]

## DONE — moved out of "DO this week" 2026-05-08+09

The following items were on the original 2026-05-07 list but are now shipped or moot. Kept here for traceability:

- **~~Pivot v1 trigger model from crontab to GitHub Actions~~** — DONE. `.github/workflows/hermes.yml` + `hermes-harvest.yml` + `hermes-dep-patch.yml` + `hermes-todo-triage.yml` all live as of Sprint 1.8.8.
- **~~Self-referential PII helper for verify-* validators~~** — MOOT. The three flagged validators stabilized in Sprint 1.6.18; pattern not recurring.
- **~~Tier 8 agentskills.io v1 spec extensions~~** — DONE. `tools/verify-skills.cjs` validates Tier 8 extensions (allowed-tools, disable-model-invocation, model, metadata, license) per Sprint 1.6.10. Tests in 776/776 grid.
- **~~v0.5 milestone Claude Agent SDK integration~~** — SUPERSEDED. Sprint 1.6.13 pivoted to OpenRouter via built-in `fetch()` (zero-deps preserved). Claude SDK seam still reachable via explicit `--engine=claude-sdk` flag but parked indefinitely.
- **~~CREATE docs/troubleshooting.md~~** — DONE 2026-05-09. Hermes' first autonomous PR (#5, run 25557000551) shipped this end-to-end. 35 lines, 4 sections (DIRTY_TREE, OPENROUTER_KEY_MALFORMED, OPENROUTER_AUTH_REJECTED, EDIT_DESTRUCTIVE_REWRITE). Merged on main.
- **~~Refresh CLAUDE.md Phase 7 to v0.6/0.7/0.8 + 1.8.12 status~~** — DONE 2026-05-09. Commit ad8d1e5 reframed CLAUDE.md H1 to "Persistent agent, not just a tool" + added 4-tier trajectory table reflecting current state.
