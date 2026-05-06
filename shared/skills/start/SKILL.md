---
name: start
description: Bootstrap a NEW project from an empty folder via cortex-x five-phase onboarding (Discover → Research → Architect → Scaffold → Adapt). Saves artifacts to cortex/ at each phase. Auto-primed by SessionStart hook when .cortex-bootstrap-pending marker is present.
disable-model-invocation: false
---

# /start — New project bootstrap (cortex-x)

You are running the cortex-x new-project bootstrap. Read and execute the
prompt at `~/.claude/shared/prompts/new-project.md` from start to finish.

## Phase summary

1. **Discover** — 6 questions (Czech), save to `cortex/discovery.md`
2. **Research** — 3-4 parallel agents, save to `$CORTEX_HOME/research/<slug>-<date>.md`
3. **Architect** — proposal saved to `cortex/proposal.md`, structured `[a/e/r/q]` approval gate
4. **Scaffold** — render filesystem (CLAUDE.md, PROGRESS.md, MEMORY.md, .claude/, package.json, …)
5. **Adapt** — post-scaffold auto-research on realized stack → `cortex/recommendations.md` + `## Stack reality check` in CLAUDE.md

## On completion

After Phase 5 finalizes:
- Delete `.cortex-bootstrap-pending` marker (if present) — one-shot semantics
- Print Phase 6 closing instructions per the prompt's `## Phase 6 — Final on_complete`

## Skip conditions

- User typed `skip` or `quick` in initial message → BAIL → quick scaffold
- Initial message ≥ 80 words with name + description + profile → BAIL
- `--no-research` flag → skip Phase 5 Adapt only

## Reference

Full prompt: `~/.claude/shared/prompts/new-project.md`
Sprint 1.5 design rationale: `$CORTEX_HOME/docs/sprint-1.5-design.md` §2.2
