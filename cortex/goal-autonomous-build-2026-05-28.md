# Autonomous build session — 2026-05-28 — `/goal` plan

> Authored by cortex-x discipline (operator: "dej si /goal, 10 sprintů, research před každým, review pipeline po každém"). Executor = this Opus session (the loop). Per-sprint: R1 web research (when external state) → implement → review pipeline → `npm test` → commit.

## Brief

Work a prioritized backlog of cortex-x sprints autonomously today. Each sprint that touches external/current state gets web research FIRST; each sprint gets a review pipeline AFTER; commit per sprint. **Quality over count — do NOT pad to hit "10"** (padding to a number is the reward-hacking failure class documented in `standards/correctness.md`). Stop when the high-value backlog is exhausted OR the working context degrades out of the smart zone (per `standards/context-engineering.md` → recommend `/clear`).

## In scope (prioritized backlog)

1. **Two-pass review-pipeline confidence-validation** — port the official `/code-review` validate-each-finding pass into cortex's R2 pipeline (research SOTA first).
2. **Sprint 2.37 unblock** — verify whether OpenRouter passes the `mid_conv_system` beta block; migrate `execute.cjs` ONLY if verified, else keep BLOCKED with the finding recorded.
3. **Sprint 2.2.2** — amend `multi-agent-supervisor.md` to position cortex's supervisor as the headless/cron complement to native dynamic workflows + `ultracode` adapter note.
4. **Ecosystem doc refresh** — add Opus 4.8 / dynamic workflows / CMA / mid_conv_system to `docs/claude-code-ecosystem.md`.
5. **Effort-control alignment** — document Opus 4.8 effort tiers (high default / xhigh / max) against cortex's per-action_kind effort tuning.
6. **Sprint 2.25** — operator-file memory consolidation (4-op consolidator: merge dups / remove contradicted / relative→absolute dates / 200-line prune).
7. **designer SKILL.md trim** <500 lines (quarantined debt, mustFixBy 2026-06-30).
8. **Sprint 2.3.1** — `mutation_score` acceptance-criterion kind (reserved in spec-verifier).
9. **Skills standard refresh** — fold dynamic-workflows + effort tiers into `standards/skills.md` / verification-loop guidance.
10. (Stretch) next highest-value roadmap `📋 PLANNED` entry if 1-9 land with context to spare.

## Out of scope

- Any runtime change blocked on UNVERIFIED external behavior (e.g. 2.37 migration unless OpenRouter passthrough is confirmed) — record the finding, don't wire blind.
- Inventing filler sprints to reach a count.
- `--dangerously-skip-permissions`, force-push, history rewrite.

## Definition of Done (per sprint)

- R1: if the sprint depends on external state, a web-research pass ran with cited URLs BEFORE implementing.
- Implementation matches the sprint's stated scope; no scope creep.
- R2: review pipeline (proportional agent set) ran; consensus HIGH/valid findings fixed in-commit.
- `npm test` exits 0.
- Committed with a descriptive message; pushed (or batched) per operator rhythm.

## Acceptance criteria (cortex spec-verifier kinds)

- **shell**: `npm test` exits 0 after every sprint.
- **file_predicate**: each sprint's stated artifact (file/section/registry entry) exists.
- **R1.web-research** (`file_predicate`): external-state sprints cite ≥3 URLs.
- **R2.review-pipeline** (`shell`/process): review ran, zero unaddressed HIGH.
- **R4.no-secrets** (`regex`): no secret patterns in any commit.

## Turn budget

The day. Checkpoint = one commit per sprint + a one-line status. Halt + surface to operator on: a research finding that invalidates a sprint's premise, anything irreversible, or smart-zone degradation.

## Task type — HITL vs AFK

- **AFK**: research, implement, review, test, commit of the agreed-scope sprints above.
- **HITL** (pause + surface): scope/premise changes from research, anything irreversible/destructive, a decision between materially different approaches, and the `/clear` recommendation when context degrades.

## Risks

- **Context degradation** over many sprints → dumb zone (mitigate: recommend `/clear` between batches; this plan file is the durable state to resume from).
- **Research invalidates a premise** → skip/re-scope that sprint, don't force it.
- **Count-gaming** → explicitly mitigated: quality over hitting 10.
- **Push contention** with Steward cron → `git pull --rebase` then push (seen twice today).
