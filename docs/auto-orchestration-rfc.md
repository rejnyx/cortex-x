# RFC — Auto-Orchestration Layer

**Status:** Accepted · MVP implemented 2026-04-19
**Owner:** Dave
**Standard:** [`standards/auto-orchestration.md`](../standards/auto-orchestration.md)

## Problem

User reports: "I keep having to write 'use parallel agents' and 'research this first' into every prompt. Most Claude Code users don't even know these are an option, and they get mediocre results. Can cortex-x make this automatic?"

Subtle version of the problem: **implicit vs explicit agentic behavior**.
- Too implicit (silent auto-spawn): runaway costs, unwanted noise, user-revolt (Cursor $47k/3d incident, 887k tokens/min Claude Code incident)
- Too explicit (every turn requires reminder): cognitive overhead, users stop using the good patterns

The correct answer is a **soft-gate with observability**: detect the patterns, inject guidance into Claude's context, let Claude make the per-turn decision, track budget.

## Goals

1. When a new-implementation prompt fires, Claude is **automatically reminded** to: (a) check research cache, (b) spawn research agents if stale, (c) single-thread the implementation, (d) spawn review agents after.
2. Running session **token cost is visible** at every turn; Claude respects caps without needing reminders.
3. Research cache **TTL is topic-aware** — Next.js research rots in weeks, tax regulations in months, architecture patterns in years.
4. **No silent escalation** on expensive paths. Claude sees the guidance, user sees what Claude is about to do, user can override.
5. Scaffolded projects **inherit the behavior** automatically (hook ships via `install.sh`, standard ships in `~/.claude/shared/standards/`).

## Non-goals

- **Hard pre-flight enforcement.** Hooks can't cancel an Agent dispatch based on predicted cost. Enforcement is post-hoc (record usage → surface → Claude respects). A hard gate would need a wrapper CLI intercepting Agent invocation — out of scope for MVP.
- **Auto-parallel implementation.** Benchmarks (Cognition "Flappy Bird", PlanCraft −70%) show multi-agent code-writing degrades. Cortex-x explicitly rejects this pattern.
- **Model routing.** Picking Haiku vs Sonnet vs Opus per task stays on Claude Code's built-in router.

## Evidence base

4 parallel research agents on 2026-04-19. Full transcripts archived in conversation; key findings:

### Anthropic multi-agent research system (Jun 2024)
- Orchestrator (Opus) → parallel Sonnet workers → synthesis. +90.2% vs single-agent on internal research evals.
- **~15× token cost** vs chat; ~4× for single-subagent delegation.
- Anthropic explicitly: "coding is less parallelizable than research" — shared context + tight interdependencies.
- Scaling rules: simple fact = 1 agent, comparison = 2–4, complex = 10+.
- [Source](https://www.anthropic.com/engineering/multi-agent-research-system)

### Cognition counter-position (Jun 2025)
- "Don't Build Multi-Agents" (HN 45096962): Flappy Bird failure mode — subagents make conflicting assumptions, output incoherent.
- Counters to Anthropic: they tested on *research* (read-heavy, no interdependency). Coding is different.
- [Source](https://news.ycombinator.com/item?id=45096962)

### Benchmark evidence
- **SWE-bench Verified:** multi-agent 72.2% vs single 65% — modest +7pp from specialization + cross-validation.
- **Finance-Agent (parallelizable domain):** +81% multi-agent gain.
- **PlanCraft (sequential domain):** −70% degradation from parallelism.
- **Aider polyglot leaderboard:** top scores from single-agent + iterative feedback, NOT from orchestration.
- **ICSE 2025 Deprecated API study:** 25–38% Deprecated API Usage Rate across models — motivates short TTL for hot frameworks.

### Competitive landscape (2026)
- **Claude Code** — sub-agents via Task tool (LLM judgement, no token threshold); Explore vs general-purpose routing.
- **Cline** — explicit Plan/Act toggle, zero auto-escalation by design.
- **Cursor** — Background Agents user/schedule-triggered only. Recursive Opus-loop incidents traced to silent escalation.
- **Windsurf Cascade** — auto web search on "needs live internet" intent detection (cheap path only).
- **Aider, RooCode** — opt-in explicit mode toggles.
- **Consensus:** silent auto-run only where cost is bounded (read-only cheap paths). Expensive parallel = explicit toggle.

### Framework patterns worth stealing
- **OpenHands:** structured `outputs` dict + per-delegate fresh budget delta + parent pauses while child runs.
- **LangGraph:** `Send()` + reducer for map-reduce parallelism.
- **smolagents:** `provide_run_summary=True` — condensed report instead of full trace (anti-slop trick).

## Design

### 3-fronta rule (central invariant)

| Front | Parallelize? | Default count |
|---|---|---|
| Research (before code) | YES | 3–4 |
| Implementation | NO (single-thread) | 1 |
| Review (after code) | YES | 3–5 |

### Trigger policy — UserPromptSubmit hook

`shared/hooks/auto-orchestrate.cjs` fires on every user prompt. Multi-factor detection:
1. Regex matches `implementuj|přidej feature|integrate|build|wire up` (cs + en)
2. Regex does NOT match `quick|rychle|skip research|fix typo|rename`

When triggered, injects a `hookSpecificOutput.additionalContext` block into Claude's prompt including:
- The 3-fronta rule reminder
- Research cache state (sorted by age, flagged fresh/stale per topic-aware TTL)
- Session budget running total + cap + warning level
- Decision tree (fresh cache → implement; stale/missing → research first; trivial → skip hint; user said quick → skip hint)

**Never spawns agents silently.** Never blocks the turn. Fails open on any error.

### Budget observability

`shared/hooks/_lib/budget.cjs` library exports:
- `estimateCostUsd(model, input_tokens, output_tokens)` — 2026 pricing table
- `recordUsage(cortexRoot, payload)` — appends to `$CORTEX_DATA_HOME/journal/.budget.jsonl`
- `sessionTotal(cortexRoot, session_id)` — sums rows
- `getCapUsd()` — reads `CORTEX_SESSION_BUDGET_USD` env, default $5
- `warningLevel(cost, cap)` — returns `ok` / `warning` (>80%) / `over` (≥100%)

`post-tool-use.cjs` calls `recordUsage` when the completed tool is `Agent` or `Task` and usage metadata is present in the response. `auto-orchestrate.cjs` reads `sessionTotal` on every UserPromptSubmit and surfaces to Claude.

### Research TTL per-topic

Frontmatter optional `ttl_days: N`. Fallback inferred from slug:
- Hot frameworks (Next, React, AI SDKs, Supabase, Tailwind, shadcn, Astro, Tone): **30 days**
- Regulations (tax, GDPR, HIPAA, legal): 180 days
- Architecture / design patterns: 365 days
- Default: 180 days

`cortex-doctor` §9 auto-prune action archives (not deletes) per-file to `research/archive/<year>/` based on per-file TTL.

### Review pipeline — `prompts/auto-review.md`

Separate prompt invoked after implementation. Differs from `code-review.md` in:
- **Scope classifier first** — trivial/small/medium/large from `git diff --stat`
- **Agent count scales with scope** — 1 for trivial, 5+ for large
- **Single message parallel dispatch** — all Agent calls in one turn, no sequential
- **Anti-slop merge** — smolagents-style condensed summary

## What ships in MVP (2026-04-19)

1. `shared/hooks/_lib/budget.cjs` — new
2. `shared/hooks/auto-orchestrate.cjs` — new
3. `shared/hooks/post-tool-use.cjs` — extended to record Agent/Task usage
4. `shared/hooks/session-start.cjs` — extended to surface last-session budget summary
5. `standards/auto-orchestration.md` — new standard (3-fronta rule, evidence trail)
6. `prompts/auto-review.md` — new prompt
7. `prompts/cortex-doctor.md` — extended TTL check per topic
8. `install.sh` / `install.ps1` — register `auto-orchestrate.cjs` under UserPromptSubmit
9. `docs/auto-orchestration-rfc.md` — this file

## What's deferred (post-MVP)

- **Hard pre-flight budget enforcement** — requires wrapper CLI, not just hooks
- **Config YAML for trigger patterns** — MVP inlines in hook; YAML when Dave wants per-project overrides
- **Budget dashboard** — `cortex spend` command reading `.budget.jsonl` (out of scope for MVP)
- **Skill-based invocation of auto-review** — currently paste-the-prompt; could become a Claude Code skill with `/auto-review` slash
- **Test suite for budget.cjs** — `redact.test.cjs` pattern exists; add when a regression happens

## Validation plan

Field-test on the next 2 queued projects:
1. **OSVČ daňový optimizér 2026** (`nextjs-saas` profile, AI-ready)
   - Expect auto-orchestrate to fire on `implementuj novou sekci...` prompts
   - Verify research cache reads correct TTL (regulations = 180d)
   - Verify budget increments visible across turns
2. **Guitar chord progression playground** (`astro-static`, no AI)
   - Expect zero fire on bug-fix / typo prompts
   - Expect fire on `přidej feature: save progression to URL`
   - Research cache likely empty — verify hook handles gracefully

## Open questions

1. **Should `auto-orchestrate.cjs` write to `journal/` too**, or just read budget? Decision: read-only for now. Writes happen in `post-tool-use.cjs` (single writer = no race).
2. **Should trigger patterns be configurable per project?** Yes eventually, inline for MVP. Add `config/auto-orchestrate.yaml` when Dave hits a false-positive he wants to silence project-side.
3. **Model pricing drift?** Budget estimator uses a static table. Acceptable drift: ±20% for observability purposes. Refresh on every cortex-x major-tag.

## Rollback plan

If auto-orchestrate produces false positives / noise:
1. User sets `CORTEX_AUTO_ORCHESTRATE=0` env var → hook short-circuits (not implemented in MVP, add if needed)
2. User removes registration from `~/.claude/settings.json` manually
3. Hard disable: `chmod -x ~/.claude/shared/hooks/auto-orchestrate.cjs`

No data loss — `.budget.jsonl` is append-only and owned by user.

## References

- [`standards/auto-orchestration.md`](../standards/auto-orchestration.md)
- [`prompts/auto-review.md`](../prompts/auto-review.md)
- [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Cognition Don't Build Multi-Agents](https://news.ycombinator.com/item?id=45096962)
- [Claude Code hooks docs](https://code.claude.com/docs/en/hooks)
- [Claude Code sub-agents docs](https://code.claude.com/docs/en/sub-agents)
