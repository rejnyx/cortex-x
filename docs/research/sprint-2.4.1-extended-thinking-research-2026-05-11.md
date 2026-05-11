---
title: Sprint 2.4.1 R1 — Anthropic extended thinking / effort tuning
date: 2026-05-11
sprint: 2.4.1
status: SHIPPED (commit pending)
dispatched_by: autonomous research while operator away
---

# Anthropic Extended Thinking — Research for Sprint 2.4.1 per-action_kind effort tuning

## TL;DR verdict (ship now)

Sprint 2.4.1 ships TODAY as half-day work: add `effort` field to LLM-requiring
ACTION_KINDS entries + wire `--effort <level>` into `claudeCliEngine` argv +
journal capture for retro analysis.

Per-kind defaults:
- `recommendation` → **high** (COMPLEX, LLM-driven multi-file edits)
- `pattern_transfer` → **high** (COMPLEX cross-project synthesis)
- `senior_tester_review` → **medium** (deterministic + optional LLM judge)
- `release_notes_drafter` → **medium** (narrative from structured input)

Operator escape hatch: `CLAUDE_CODE_EFFORT_LEVEL` env var overrides everything.

## 1. API mechanics 2026

Parameter shape has bifurcated as of Claude 4.6/4.7. The legacy
`thinking: { type: "enabled", budget_tokens: N }` is **deprecated on Opus 4.6 /
Sonnet 4.6** and **rejected with HTTP 400 on Opus 4.7**. The new control
plane has three knobs:

| Knob | JSON shape | Position |
|---|---|---|
| Adaptive thinking | `thinking: { type: "adaptive" }` | Top-level request |
| Effort (soft guidance) | `output_config: { effort: "low\|medium\|high\|xhigh\|max" }` | Top-level request |
| Display | `thinking: { type: "adaptive", display: "summarized\|omitted" }` | Inside thinking |

**Model support matrix:**
- Opus 4.7 (`claude-opus-4-7`): adaptive-only, default effort = `high` on API,
  `xhigh` in Claude Code v2.1.117+, supports `low/medium/high/xhigh/max`.
- Opus 4.6, Sonnet 4.6: adaptive recommended, manual `budget_tokens` still
  works but deprecated. Supports `low/medium/high/max` (no `xhigh`).
- Haiku 4.5: NOT in supported list — no extended-thinking surface.

**Billing:** thinking tokens billed at output rate ($25/MTok on Opus 4.7,
$15/MTok on Sonnet 4.6). `display: "omitted"` does NOT reduce cost — only
latency. Opus 4.7 tokenizer can emit up to 35% more tokens per char vs 4.6
for code-heavy prompts.

## 2. claude-cli + extended thinking

**Sprint 2.4 path is fully supported.** Claude Code exposes first-class flags
mapping onto the API parameters:

- `--effort <level>` at launch
- `/effort` in-session slash command
- `CLAUDE_CODE_EFFORT_LEVEL` env var (highest precedence)
- `effortLevel` in `.claude/settings.json` (persistent default)
- `effort: <level>` in skill/subagent frontmatter
- `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` reverts Opus 4.6/Sonnet 4.6 to
  fixed-budget mode (does NOT apply to Opus 4.7 — adaptive mandatory there)
- `MAX_THINKING_TOKENS=0` disables thinking entirely
- `ultrathink` keyword in prompt body triggers one-off deep reasoning

**Default behavior on Opus 4.7 in Claude Code v2.1.117+:** effort = `xhigh`.
So if Steward spawns `claude` without specifying effort, it's paying for
xhigh-level thinking on EVERY action — including trivial deterministic ones.

## 3. Per-action complexity heuristics (cortex-x mapping)

| Tier | action_kinds | Recommended effort |
|---|---|---|
| TRIVIAL | dep_update_patch, lint_fix_shipper, secret_history_sweep, workflow_hardener, recommendation_harvest, doc_drift, todo_triage, test_coverage_gap, mutation_score_drift, tech_debt_audit, flaky_test_repair, pr_review_responder | `low` (most don't even spawn LLM) |
| MEDIUM | senior_tester_review, release_notes_drafter | `medium` (Anthropic Sonnet 4.6 default + resolve.ai production benchmarks) |
| COMPLEX | recommendation, pattern_transfer | `high` (Anthropic "recommended starting point for coding + agentic work") |

**Note:** TRIVIAL kinds are deterministic — they don't invoke `claudeCliEngine`
at all. Setting `effort` on them would be dead config. Sprint 2.4.1 v1
adds `effort` only to LLM-requiring kinds. Deterministic kinds fall through
to engine default 'medium' which is unused for them anyway.

**Cost shift signal:** Finout's Opus 4.7 tear-down notes token costs rise
0-35% vs 4.6 from new tokenizer alone, BEFORE effort multiplier. Empirically
`xhigh` vs `high` on coding workloads roughly doubles thinking-token spend.
So a TRIVIAL action at default xhigh costs ~2x what it needs to.

## 4. Anti-patterns 2026

**`max` effort overthinks measurably.** Anthropic's own docs warn: "On most
workloads `max` adds significant cost for relatively small quality gains,
and on some structured-output or less intelligence-sensitive tasks it can
lead to **overthinking**." Community surfaced this hardest in the Feb/Mar-2026
Claude Code regression incident:

- AMD-executive HN post measured **67% drop in reasoning depth** across
  6,852 sessions when adaptive thinking shipped silently as default at
  `medium`. Boris Cherny confirmed regression on HN.
- `max`-effort regressions: community reports `max` can degrade into
  "desperate" behavior — over-explaining, second-guessing, **looping**.
  This is exactly the failure mode Sprint 1.9.1 cross-session loop-detector
  was built to catch — but it would trip on every recommendation action
  if cortex-x naively cranks every kind to `max`.
- Adaptive-thinking + tools = silent cache breaks. Switching between
  adaptive and disabled mid-conversation invalidates prompt-cache
  breakpoints.
- Hallucinated artifacts under-thinking: dev.to deep-dive documented
  fabricated commit SHAs, non-existent npm packages, API references that
  never existed under medium-default + adaptive.

**Sprint 2.4.1 explicit defenses:**
1. No action_kind defaults to `max` or `xhigh` (test enforces this).
2. `xhigh`/`max` only reachable via `CLAUDE_CODE_EFFORT_LEVEL` operator
   override.
3. Sprint 1.9.1 cross-session loop detector catches overthinking loops if
   they emerge.

## 5. Implementation in cortex-x — what shipped

**Files touched:**
- `bin/steward/_lib/action-kinds.cjs` — added `effort: '<level>'` field to
  4 LLM-requiring kinds (recommendation, pattern_transfer,
  senior_tester_review, release_notes_drafter).
- `bin/steward/_lib/action-engine.cjs` — added `resolveEffortLevel(plan,
  opts, env)` helper with 4-tier precedence (env > opts > action_kind >
  default 'medium'); injected `--effort <level>` into claudeCliEngine
  argv; surfaced `effort_level` + `effort_source` in result for journal
  capture.
- `tests/unit/steward/effort-tuning.test.cjs` — 16 contract tests covering
  precedence, allowlist, action_kind contract (LLM kinds declare effort,
  no defaults to xhigh/max).

**LoC:** ~80 (matches research estimate).

**Backwards compat:** if `CLAUDE_CODE_EFFORT_LEVEL` not set + action_kind
omits effort field → engine adds `--effort medium`. Pre-2.4.1 callers
keep working; behavior shift is "all actions now get explicit `--effort medium`
on the spawned claude" which matches Anthropic Sonnet 4.6 default anyway.

## References

- [Anthropic — Building with extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
- [Anthropic — Adaptive thinking](https://platform.claude.com/docs/en/docs/build-with-claude/adaptive-thinking)
- [Anthropic — Effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude Code — Model configuration / effort levels](https://code.claude.com/docs/en/model-config)
- [MindStudio — Claude Code Effort Levels Explained](https://www.mindstudio.ai/blog/claude-code-effort-levels-explained)
- [novaknown.com — Claude Code regression analysis (AMD-exec HN data)](https://novaknown.com/2026/04/12/claude-code-regression/)
- [pasqualepillitteri.it — Effort + Adaptive Thinking guide](https://pasqualepillitteri.it/en/news/805/claude-code-effort-adaptive-thinking-guida)
- [dev.to shuicici — Feb-Mar 2026 deep-dive](https://dev.to/shuicici/claude-codes-feb-mar-2026-updates-quietly-broke-complex-engineering-heres-the-technical-5b4h)
- [Finout — Opus 4.7 real cost story / tokenizer 35%](https://www.finout.io/blog/claude-opus-4.7-pricing-the-real-cost-story-behind-the-unchanged-price-tag)
- [resolve.ai — Production-agent benchmarks on Sonnet 4.6 adaptive](https://resolve.ai/blog/Our-early-impressions-of-Claude-Sonnet-4.6)
