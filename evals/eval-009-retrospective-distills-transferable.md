---
id: eval-009
name: retrospective-distills-transferable
category: reflect
version: 1.0
---

# Eval 009 — Retrospective extracts [TRANSFERABLE] insight

## Input

Simulate end-of-sprint state. Inject prior session context:

> "Sprint 2 done. Top events:
> - Implemented user auth (Story 2.1, 2.2) — used Supabase + RLS, worked first try
> - Tried mocking Supabase in unit tests for speed, MIGRATION 023 broke prod when mocked tests passed but real schema diverged. Reverted. Now use real test DB.
> - User feedback during sprint mid: requested chat instead of notifications panel. Re-prioritized 2.4 from Notifications to Chat. Cost ~5h replan.
> - Performance: api/search response time 800ms → 120ms by adding pgvector HNSW index instead of seqscan."

Paste `~/.claude/shared/prompts/retrospective.md`. Respond to Q1-Q4:
- Q1: "Auth + RLS šlo first try. HNSW index dropped query time 7×."
- Q2: "Mock Supabase v testech mě to stálo prod incident — mock divergence."
- Q3: "Mid-sprint user feedback shifted scope o 5h. Notifications panel → chat."
- Q4: (claude leads — should mark TRANSFERABLE explicitly)

## Expected properties

### Must have

- [ ] Output produces ≥2 [TRANSFERABLE]-tagged Lessons Learned entries
- [ ] One [TRANSFERABLE] entry on **mock-vs-real test DB divergence** with concrete evidence (Migration 023 reverted, prod incident)
- [ ] One [TRANSFERABLE] entry on **HNSW index over seqscan for vector queries** with measurable impact (800ms → 120ms = 6.7×)
- [ ] One project-specific (NOT [TRANSFERABLE]) entry on user-feedback-driven scope shift (project-specific, not a pattern other projects need)
- [ ] Each entry has 4 fields: What happened / Lesson / Why it matters / Evidence
- [ ] Output written to `~/.claude/shared/projects/<slug>.md` Lessons Learned section (append, not overwrite)
- [ ] Suggested commit message: `retro: <slug> sprint 2 — <short summary>`
- [ ] Forward-look: at least 1 concrete recommendation for next sprint based on captured lessons

### Must NOT have

- [ ] **No more than 5 entries total** — retrospective fatigue, the user disengages
- [ ] **No emotional framing** — "frustrated", "tired" not in output
- [ ] **No generic "communication could be better"** — must be concrete, transferable
- [ ] **No survivorship-only positive entries** — must include what didn't work
- [ ] **No skip of Q4 transferable check** — that's the load-bearing question

### Should have

- [ ] Output uses the structured format from `retrospective.md`: `## What worked ✨` / `## What didn't ⚠️` / `## Surprises 🎯` / `## Captured to cortex library` / `## Next sprint planning`
- [ ] If HNSW lesson is marked [TRANSFERABLE], it cites which other projects (`relo`, `chatbot-platform`, `morning-digest`) where vector search is used — explicit cross-project link
- [ ] Mock-vs-real lesson explicitly references `~/.claude/shared/standards/testing.md` (real-DB-tests-required principle)
- [ ] Total user time invested ≤ 15 minutes (4 questions, distillation, commit)

## Scoring rubric

- **1.0** — ≥2 [TRANSFERABLE] entries, 4 fields each, structured output, cross-project cites, ≤5 total entries
- **0.9** — ≥2 [TRANSFERABLE] entries, 4 fields, structured output, no cross-project cites
- **0.8** — 1 [TRANSFERABLE] entry only (missed the second clear pattern)
- **0.6** — Captured everything but skipped [TRANSFERABLE] tagging entirely (the unique cortex-x value)
- **0.4** — 6+ entries (fatigue territory) OR captures all positives no negatives
- **0.0** — Skipped Q4, OR overwrote existing Lessons Learned, OR generic essay output

## Adversarial probes

- **Did Q4 (transferable check) get asked?** Expected: YES. Without it, the cortex-x unique value is gone.
- **Did Claude tag insights with [TRANSFERABLE] explicitly?** Expected: YES.
- **Did the mock-test lesson get classified as project-specific instead of transferable?** Expected: NO. That pattern recurs across all DB-backed projects (RELO, chatbot-platform, WaaS) — must be transferable.
- **Did Claude produce a long-form essay style retrospective?** Expected: NO. Structured, scannable.
- **Did Claude survivorship-bias toward positives only?** Expected: NO. The mock-test failure is the most valuable single insight.

## Notes for evaluator

The Q4 [TRANSFERABLE] tagging is the load-bearing differentiator — without it, cortex-x just becomes a slightly nicer template for sprint retros. The test DB pattern in particular is **gold**: it's exactly the kind of negative knowledge that would get lost in a project-isolated retro and silently bite the next project.

If this eval consistently scores < 0.8, the retrospective prompt has lost its cross-project orientation and needs a refresh.
