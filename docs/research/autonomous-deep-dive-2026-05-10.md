---
title: Autonomous deep-dive — synthesis 2026-05-10
date: 2026-05-10
based_on:
  research_a: docs/research/sprint-research-long-running-autonomy-2026-05-10.md
  research_b: docs/research/sprint-research-self-invoking-and-research-default-2026-05-10.md
  audit_c: docs/research/cortex-x-state-audit-2026-05-10.md
operator_brief: 10h+ autonomous sessions on dedicated PC + self-invoking commands + research-as-default rule + minidoc + audit
---

# Autonomous deep-dive — synthesis 2026-05-10

Operator wants three things: (1) dedicated-PC 10h autonomous sessions, (2) systematize the `/loop`-style self-invocation pattern, (3) "research-as-default" rule into cortex-x global standards. This memo synthesizes the three parallel research/audit memos written today and commits to a **prioritized, R1-R6-anchored recommendation list**. No code edits. Operator approval required before any sprint ships.

---

## 0. TL;DR — operator's three ideas, scored

| Operator's idea | Score | Honest take |
|---|---|---|
| **10h+ autonomous sessions on dedicated PC** | 6/10 — *plausible but Tier-3, not Tier-1* | No production framework today reliably runs 10h. Anthropic's own measured Claude Code 99.9th-percentile session is **~45 min**, with reports of "context loss after 2h." METR's "5h human-equivalent" is a *theoretical lab cap*. cortex-x will hit the same wall at 2-3h. **Buildable**, but only after items 1-4 in §3 ship — treat as Tier-3 milestone, not next sprint. |
| **Systematize self-invoking `/loop` patterns** | 9/10 — *high-leverage, low-risk* | Polling is named anti-pattern in 2026; event-driven + LLM-paced wake-up is the consensus norm. cortex-x's `ScheduleWakeup` dynamic mode already aligns. **Documenting + adding 3 missing guardrails (max-depth, wall-clock cap, dedup) is S-effort, ships immediate value.** |
| **Research-as-default rule** | 7/10 — *yes, but conservative version* | "Always research" inflates token cost 3-10× for zero gain on trivia. "Never research" failed 57% of generated code against current APIs (arXiv 2604.09515). The win is **strategic retrieval on 4 trigger categories**: current-API-docs, architecture, security, taxonomy. R1 ("research-before-implement at sprint kickoff") already covers the heavy case; the *mid-session* uncertainty trigger is the gap. **Ship a conservative version with $0.50/day cap + 7-day cache.** |

**Risk operator should know:** uncertainty is self-reported by the same model the rule constrains. Without a deterministic gate (hook-level signal: framework-version-mentioned, dependency-add detected), the rule degrades into "vibes." Pair with detector-level triggers, not pure LLM judgment.

---

## 1. State of the art (May 2026) — what real frameworks do

| System | Practical session cap | Memory | Resume | Notable for cortex-x |
|---|---|---|---|---|
| **Claude Code Auto Mode** | ~45 min p99.9 (reports "context loss after 2h") | `CLAUDE.md` + server-side compaction beta | Routines preview; no first-class checkpoint | This **is** cortex-x's underlying engine. Don't promise more than Anthropic does. |
| **Devin (Cognition)** | "Hours" claimed; recurring sessions | Per-VM isolation, state-between-runs | Recurring-session persistence | Reference for resumable design |
| **Manus** | Multi-hour background | Virtual FS, files-as-memory | Cloud FS outlives session | cortex-x already does files-as-memory (journal/lessons) |
| **Codex CLI** | `/goal` workflow (give objective, walk away) | Cloud containers survive disconnect | Pause/resume | Reference for plan-mode-nudge pattern |
| **Aider** | Single-task focus | Git-first auto-commits per change | Git history is checkpoint | cortex-x already does atomic-commit-per-action |
| **LangGraph 2.0** | Persistence layer ref design | Typed checkpoints | Yes — durable state machine | Reference shape for §3.3 checkpoint primitive |

**Synthesis:** cortex-x is closer to production-grade than I assumed before this research. Files-as-memory ✅, atomic commits ✅, cost ledger ✅, cross-session loop detector ✅. The five real gaps are §3 below.

---

## 2. The critical-path findings — read these even if skipping rest

### 2.1 P0 SECURITY — `redactSecrets` divergence between two action_kinds

From audit C item 5:
- `bin/steward/_lib/action-engine.cjs:1218` has Sprint 2.4 `sk-ant-oat##` OAuth shape coverage
- `bin/steward/_lib/senior-tester-action.cjs:138` has the **older body without OAuth shape**

On the monthly senior-tester cron (next fire **2026-06-01**), if any test code excerpt contains an Anthropic OAuth artifact, it leaks to the LLM judge. This is a **real secret-leak vector**, not just SSOT cleanup. **Recommendation:** P0 fix, before next autonomous mandate, S-effort. Extract to `bin/steward/_lib/safety.cjs` (already exists from Sprint 2.5b — this is its natural home).

### 2.2 P1 DOGFOOD-EXPOSURE — 12 of 14 action_kinds have zero real OpenRouter cron evidence

Only `recommendation` and `recommendation_harvest` have actual production runs. **Tomorrow's 04:00 UTC nightly (rec #6 JSDoc str_replace via Sprint 2.2.5 v1.5)** is the single load-bearing prod fire before any external launch evidence exists. If it fails, the v1-ops-graduate-from-designed-to-exercised story collapses.

**Recommendation:** before 22:00 CEST tonight (2026-05-10), `gh workflow run steward.yml` manually and verify the run lands a green draft PR. If it fails, that is a real bug, not flaky cron.

### 2.3 P1 DOGFOOD-NOISE — 40 mutable `@v5`/`@v4` workflow tags

`workflow_hardener` first cron 2026-05-17 will produce an issue with ~40 finding entries. Nine were ack'd in session summary; remaining 31 are non-Sprint-2.5b workflows from earlier sprints. **Recommendation:** spend 30 min before 2026-05-17 doing a one-shot SHA-pin sweep. Turns the first cron into a clean signal instead of self-flagging wall.

### 2.4 P2 CALIBRATION — `senior_tester_review` eval suite never built

R1 memo specified 5 fixture repos with known-bad test suites + expected findings as a **pre-ship gate**. Sprint 2.11 shipped without it. 39-smell registry is therefore an unvalidated heuristic. First cron 2026-06-01 will produce findings whose accuracy we cannot quantify. **Recommendation:** build 5 fixtures before 2026-06-01 (M-L effort, ~1 day). Otherwise the AI-augmented-tester launch pitch rests on no evidence.

---

## 3. Concrete recommendations (R1-R6 anchored, prioritized by leverage × risk)

### 3.1 ⭐ Sprint 2.11.1 — *Pre-mandate hardening* (S-effort, days)

**Anchored:** R3 (one incident class = one defense + regression test), R5 (no human-only edits become Steward-able stays inviolate).

1. **P0 SSOT M2 — extract redactSecrets to `safety.cjs`** with full OAuth coverage. Closes secret-leak vector before 2026-06-01 senior-tester cron. (S, ~1h)
2. **P0 manual `gh workflow run steward.yml` tonight** + green PR verification. (S, 5 min)
3. **P1 SHA-pin sweep on 31 remaining mutable workflow `uses:` lines.** Hand-edited, single commit, brings cortex-x in compliance with its own forthcoming hardener. (S, ~30 min)
4. **P2 SSOT M1 + m1 dedup** (OPENROUTER_ENDPOINT, DEFAULT_MODEL, NO_WORKING_TREE_EDITS_CRITERION). Mechanical refactor. (S, ~1h)

**Total:** ~2.5h. Closes audit findings 1, 2, 3, plus the smaller SSOT items. **No new functionality** — pure pre-flight.

### 3.2 Sprint 2.12 — *Intra-run loop detector* (S effort)

**Anchored:** R3, R4 (cost ceiling preserved).

Source: pydantic-deep 0.3.8 `StuckLoopDetection` (3 patterns: identical-calls / A-B-A / no-op, threshold-3, ModelRetry).

cortex-x has the *cross-session* same-criterion detector (5x/7d via Sprint 1.9.1). What's missing is the **intra-run tool-call** detector — for the host-daemon scenario where a single multi-hour run could burn $12 on 47 identical calls (Medium case study).

New module: `bin/steward/_lib/loop-detector.cjs`
- Detect identical (tool, args) hash repeated 3× in current run's tool-call log
- Detect A-B-A oscillation (tool switching between two states)
- Detect no-op (tool ran but state unchanged)
- On detect → write `STEWARD_HALT` with reason
- Plus regression test fixture

**Why S-effort:** algorithm is simple, log is already journaled, halt-file mechanism exists.

### 3.3 Sprint 2.13 — *Self-invocation playbook + 4 hard guardrails* (S effort)

**Anchored:** R5 (preserve human-only paths under longer autonomy).

Operator noticed I self-invoked `/loop` autonomously in this session — that's the right instinct, but cortex-x has **only 1 of the 4 production-grade guardrails** (cost meter). Missing: max-depth, wall-clock cap, dedup window.

New file: `docs/playbooks/autonomous-development-playbook.md` (drafted in this commit batch — see §5).

Plus updates to global `CLAUDE.md` documenting the 4 guardrails as session policy:
- max recursion depth: 3
- wall-clock cap per chain: 30 minutes
- dedup window: identical (skill, args) blocked within 3 turns
- cost gate: existing daily/weekly caps apply

These are *behavioral guardrails* (operator-instructed self-discipline), not new code — until 3.5 below.

### 3.4 Sprint 2.14 — *Research-trigger rule* (M effort)

**Anchored:** R1 (research-before-implement) extended to mid-session uncertainty.

Conservative drop-in YAML in §4 of memo B. 4 fire categories (current-API-docs, architectural, security, taxonomy), 4 do-not-fire categories, $0.50/day cap, 7-day cache at `~/.claude/cache/research/` with TTL overrides per kind.

**Why M-effort:** the YAML is small, but adding it to global standards needs (a) a deterministic detector signal alongside the LLM judgment (so it's not just vibes), (b) cache infrastructure, (c) audit trail in journal. The detector signal is the load-bearing piece — without it the rule degrades. Recommend hooking into existing `detectors/` infrastructure: framework-version-mentioned probe, dependency-add probe, security-keyword probe.

### 3.5 Sprint 3.x — *Multi-action checkpoint primitive* (M effort, prerequisite to 10h sessions)

**Anchored:** R6 (backward-compat preserved).

For host-daemon 10h sessions, need action-level resume tokens (criterion id + cursor + cost-so-far) so a host crash mid-way doesn't lose accumulated context. Reference: LangGraph persistence shape, but zero-deps file-based. Today: per-action atomic commit + journal handles the *post-action* state but not *intra-action* progress.

New module: `bin/steward/_lib/checkpoint.cjs` — write resume token after each phase (LLM call complete / edits applied / tests run / commit prepared); on restart, lock-mutex check + token replay.

**Required before** any host-daemon work in Tier 4. Don't promise 10h sessions until this ships.

### 3.6 Sprint 3.x — *Action-kind → model tier router* (M effort)

**Anchored:** R4 (cost ceiling preserved). Already in roadmap as **Sprint 2.4 claude-cli COST PIVOT** but with a different framing. Industry data: tiering cuts 40-60% on multi-agent workflows.

Lightweight router: `recommendation_harvest`/`todo_triage`/`doc_drift` → cheap deepseek-v4-flash; `senior_tester_review`/`pattern_transfer`/`tech_debt_audit`/`recommendation` → frontier model (claude-sonnet-4-6 via OpenRouter).

### 3.7 Sprint 3.x — *Append-only prompt assembly + 1h cache TTL toggle* (S effort)

**Anchored:** R4. Anthropic data: 1h-TTL = 2× write-cost but for repeated-criterion runs in single host session, savings dominate. Audit `bin/steward/_lib/` prompt builders to ensure no mid-context mutation. Add `STEWARD_CACHE_TTL_HOURS=1` env (default 0=5min). Pre-Tier-4 cost-control prerequisite.

### 3.8 Sprint 4.x — *Plan-mode-nudge / explicit-pause primitive* (L effort, Tier-3 milestone)

**Anchored:** R5 (human-only paths inviolate even under multi-hour autonomy).

When session exceeds N actions or detects ambiguity (LLM returns low-confidence plan), write `STEWARD_PAUSE` artifact with unresolved decision and exit; operator resumes by deleting it. Mirrors Codex `/goal` plan-mode-nudge + Anthropic empirical data: "Claude pauses 2× more on complex tasks."

**This is the gate** for promising 10h sessions. Without it, an autonomous session that hits an ambiguity will either stall or hallucinate forward; with it, ambiguity becomes a clean handoff.

---

## 4. What we're explicitly NOT doing

- **Not building "research-everything" mode.** Industry data is unambiguous: 3-10× cost for marginal gain on trivia. Conservative trigger rule only.
- **Not promising 10h sessions in marketing copy** until Sprint 3.5 (checkpoint) + Sprint 4.x (plan-mode-nudge) ship. Anthropic itself reports ~45 min p99.9 — claiming more is dishonest.
- **Not adding subagent-of-subagent recursion.** Hub-and-spoke topology (Claude Code's default) is the documented norm; recursion opt-in is precisely because of runaway risk.
- **Not over-specializing subagents** beyond the existing R2 review pipeline (acceptance + blind + correctness + security + ssot + edge-case). The "PythonTests subagent gatekeeps testing context" anti-pattern (techtaek 2026) is a real failure mode.
- **Not building a generic LLM-judge subagent** for every action_kind. Senior_tester_review's opt-in judge is the right scope; replicating across kinds re-creates the 7× token problem.

---

## 5. Operator's three ideas — final disposition

| Idea | Disposition | First sprint |
|---|---|---|
| 10h dedicated-PC sessions | **Yes, but Tier-3 milestone.** Need 3.5 (checkpoint) + 3.7 (1h cache) + 4.x (plan-mode-nudge) first. Until then, max ~2h sessions, like everyone else. | Sprint 3.5 |
| Systematize self-invoking `/loop` | **Yes, ship now (Sprint 2.13).** Document in playbook, add 3 missing guardrails (max-depth, wall-clock, dedup). | Sprint 2.13 |
| Research-as-default rule | **Yes, conservative version (Sprint 2.14).** 4 fire categories, $0.50/day, 7-day cache, paired with detector-level signals. | Sprint 2.14 |

**Reality-check on the operator brief:** all three ideas are technically sound. The risk is *order* — doing 10h sessions before the checkpoint primitive lands means an operator-confidence-destroying crash at hour 7 with no resume path. The recommended sequence is **2.11.1 hardening → 2.12 intra-run loop detector → 2.13 self-invocation guardrails → 2.14 research trigger → 3.x checkpoint + cache + router → 4.x plan-mode-nudge → THEN 10h promises.**

---

## 6. Sources (all 3 contributing memos)

- [Long-running autonomy + subagents](./sprint-research-long-running-autonomy-2026-05-10.md) — 18 cited URLs
- [Self-invoking + research-default](./sprint-research-self-invoking-and-research-default-2026-05-10.md) — 22 cited URLs
- [cortex-x state audit](./cortex-x-state-audit-2026-05-10.md) — file:line evidence

Combined evidence base: ~40 distinct industry/academic sources from May 2025–May 2026, plus full project-state walkthrough.
