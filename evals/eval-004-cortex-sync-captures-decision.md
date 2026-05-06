---
id: eval-004
name: cortex-sync-captures-decision
category: sync
version: 1.0
---

# Eval 004 — cortex-sync captures architectural decision

## Input

Simulate a session that ended with a real architectural decision. Set up state:

1. Open Claude Code at `$CORTEX_HOME` (default `~/cortex-x`, or any project with a `$CORTEX_DATA_HOME/projects/<slug>.md` library entry)
2. Inject session context (prior turn) describing a concrete decision:
   > "Rozhodli jsme se použít Trigger.dev místo Vercel Cron pro digest job. Důvod: Vercel Cron má 300s limit, náš scrape+score job trvá 2-5 min. Failover plán: pokud Trigger.dev selže, máme manual cron fallback přes GitHub Actions. Commit `e1b231a` aplikuje volbu."
3. Paste `~/.claude/shared/prompts/cortex-sync.md`

## Expected properties

### Must have

- [ ] Output adds a **Key Decisions** entry to `cortex-x/projects/<slug>.md` with all 4 required fields:
  - Date in ISO format (YYYY-MM-DD)
  - "What happened" — 1-2 sentences ("zvolili jsme Trigger.dev")
  - "Decision/Lesson" — the actual rule ("Trigger.dev > Vercel Cron when job duration > 300s")
  - "Why it matters" — transferable context ("future projects with long-running cron jobs should default to Trigger.dev")
  - "Evidence" — at least one of: commit SHA, file path, issue number
- [ ] Entry is appended (not overwriting existing entries)
- [ ] Commit suggested: `knowledge: <slug> — Trigger.dev choice` or similar
- [ ] Output reports what was captured + what was skipped

### Must NOT have

- [ ] **No emotional context** — "the user was tired", "frustrated debugging" not appropriate
- [ ] **No diff-level detail** — sync captures INSIGHTS not DIFFS. "Edited line 42 to use trigger.dev SDK" is wrong-level.
- [ ] **No speculation about future work** — that's PROGRESS.md's job
- [ ] **No overwrite of existing Key Decisions** — append only
- [ ] **No 5+ entries from one session** — should produce 1, maybe 2 distilled entries

### Should have

- [ ] `[TRANSFERABLE]` prefix added if the decision applies beyond current project (e.g., long-running cron pattern is transferable)
- [ ] Cross-Project Dependencies section updated if decision creates dependency on shared standard
- [ ] Final report identifies which checkpoint type triggered the sync (end-of-sprint / post-incident / post-refactor / new-decision)

## Scoring rubric

- **1.0** — All 4 fields populated, entry appended cleanly, commit suggestion correct, [TRANSFERABLE] flagged where applicable
- **0.9** — All 4 fields, no [TRANSFERABLE] flag where it would help
- **0.8** — 1 of 4 fields shallow (e.g., evidence missing commit SHA)
- **0.6** — Entry added but contains diff-level detail or emotional context
- **0.4** — 2+ fields missing or shallow
- **0.0** — Overwrote existing entries OR captured nothing OR produced 5+ entries from one session (signal-to-noise destroyed)

## Adversarial probes

- **Did sync invent details not present in session context?** Expected: NO. Halucinated "Why it matters" is the most common failure mode.
- **Did sync overwrite existing Key Decisions?** Expected: NO. Append-only contract.
- **Did sync include a diff-level summary** ("changed file X line Y")? Expected: NO. INSIGHTS not DIFFS.
- **Did sync produce more than 2 entries from a single decision?** Expected: NO. One decision = one entry.

## Notes for evaluator

cortex-sync is the **micro-capture loop** — each notable session writes one focused entry. retrospective.md is the macro-capture loop — sprint-end aggregation of multiple lessons. They overlap intentionally: sync catches things while fresh, retrospective de-duplicates and adds [TRANSFERABLE] tags.

If sync starts producing retrospective-shaped output (4+ entries, broad themes), it's drifted. Catch via this eval.
