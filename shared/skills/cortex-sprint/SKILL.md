---
name: cortex-sprint
description: One-shot wrapper for the Sprint-sized integration pattern validated in Sprint 2.44. Drives the full flow - discovery questionnaire → plan artifact → workflow dispatch → empirical phase (if applicable) → triage of R2 findings → doc-regen + commit → status report. Use when N>=5 deliverables, framework-touching, and clear acceptance criteria are possible. Triggers (CZ+EN) "/cortex-sprint", "začni sprint", "spustit sprint", "udělej sprint", "sprint kickoff", "start sprint", "ship sprint X", "new sprint", "kickoff sprint". Composes with prompts/cortex-goal.md (turn budget framing), standards/workflows.md (decision tree), standards/documentation.md (doc-regen step), and the multi-phase workflow dispatch pattern from Sprint 2.44 Probe 3.
disable-model-invocation: false
---

# /cortex-sprint — Sprint-sized integration wrapper

You are operating inside cortex-x. Goal: take an operator brief, run a structured 7-step pipeline (Discovery → Plan → Workflow dispatch → Empirical → Triage → Doc-regen + commit → Status), and ship a coherent sprint commit. This skill **wraps** the validated Sprint 2.44 integration pattern so the operator does not have to assemble it by hand each time.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words. Counts not praise. Match operator's language (Czech/English) from prior turns.

## Overview

A "sprint" in cortex-x parlance is a bounded unit of integration work — typically 5–15 deliverables across framework code + standards + tests, with an explicit acceptance frontier and a single integration commit at the end. Sprint 2.44 (workflow-runtime probe) and Sprint 2.45 (living documentation) validated that this pattern works best when the **full flow is one operator gesture**: kickoff the sprint, the agent assembles the plan, dispatches a multi-phase workflow, triages the R2 findings, regenerates managed docs, and lands the commit. This skill is that gesture.

## When to use

Decision tree from [`standards/workflows.md`](../../../standards/workflows.md):

- **N ≥ 5 deliverables** — anything smaller should be a /cortex-goal session or a direct edit. Sprints have setup cost; don't pay it for trivia.
- **Framework-touching** — changes to `bin/`, `standards/`, `shared/skills/`, `templates/`, or registry files. Pure-application work in a downstream project usually doesn't need the sprint discipline.
- **Clear acceptance criteria possible** — if you cannot enumerate AC in 3–5 lines after the discovery questionnaire, the brief is not ready; loop back to [`prompts/95-confidence.md`](../../../prompts/95-confidence.md) first.
- **Reviewable diff** — sprints land as one logical commit (or a tight chain). If the work is exploratory and you cannot predict the diff shape, use a /cortex-goal autonomous run instead and convert findings into a sprint later.

**When NOT to use:**

- Cron / unattended maintenance → Steward (`docs/steward-runtime.md`).
- Single-file fix or one-off question → answer directly.
- Multi-week exploratory research arc → roadmap-level work, not a sprint.

## Pipeline

The 7 steps below are the canonical sprint flow. Do them in order; do not skip.

### 1. Discovery

Use `AskUserQuestion` (or inline prompt if model invocation is constrained) to gather the 3–5 inputs in the Discovery questionnaire section below. Defaults are honored — when operator answers "default" or stays silent, use the default. Do not pad with questions you can answer yourself from repo state.

### 2. Plan artifact

Write `cortex/sprint-<N>-plan.md` where `<N>` is the sprint number (operator-supplied or auto-incremented from the highest existing plan file). Mirror the structure of [`cortex/sprint-2-44-plan.md`](../../../cortex/sprint-2-44-plan.md) and [`cortex/sprint-2-45-plan.md`](../../../cortex/sprint-2-45-plan.md). See "Plan template reference" below.

### 3. Workflow dispatch

Dispatch the multi-phase workflow using the inline-script convention from Sprint 2.44 (see "Workflow dispatch convention" below). The phases are: **Research → Synthesize → Implement → Review → Confidence**. The workflow runtime returns artifacts; do not interpret them yet.

### 4. Empirical phase (conditional)

If the sprint includes a *probe* / *spike* / *measurement* deliverable, run it now and write a verdict file (`cortex/sprint-<N>-probe-verdict.md` or similar). Probes feed the Implement phase; if the workflow already has the probe inside it, this step is a no-op.

### 5. Triage R2 findings

Read the Review phase output. Classify each finding:

- **HIGH** — apply in-commit. If a HIGH cannot be applied within ~15 min, escalate to operator: either widen the sprint or split.
- **MEDIUM** — apply if surgical (1–2 files, <30 lines diff). Otherwise log under "Deferred" in `cortex/sprint-<N>-r2-summary.md`.
- **Architectural / cross-cutting** — defer to a follow-up sprint (`N.1`, `N.2`, …). Capture rationale in `r2-summary.md`. Do not silently drop.

Write `cortex/sprint-<N>-r2-summary.md` summarizing applied vs deferred with one-line rationale each. Mirror the Sprint 2.44 r2-summary.md shape.

### 6. Doc-regen + commit

Run `node bin/cortex-doc-regen.cjs --apply` (Sprint 2.45) to refresh all managed state-blocks in atlas + capability-tree + any other managed docs. If the regen produces a diff, stage it alongside the sprint work. Then commit using the convention below — single commit, `[skip-review]` tag in the message body, conventional-commits subject line.

### 7. Status report

End-of-sprint report (1–2 sentences, voice-charter compliant):

- Sprint number + name
- Deliverables shipped (count + delta vs plan)
- Tests: before → after
- R2: HIGH applied / MEDIUM deferred counts
- Files touched
- Commit SHA

## Discovery questionnaire

Default to 3 questions; ask 4–5 only if the brief is ambiguous. Use `AskUserQuestion` with the following slots:

1. **Sprint name + number** — what should this sprint be called? (e.g. "Sprint 2.46 — capability marketplace skeleton"). Default: auto-increment from latest `cortex/sprint-*-plan.md`.
2. **Scope summary (1–2 sentences)** — what does this sprint ship? Used as the plan's "Goal" heading.
3. **Deliverables list (3–10 items)** — bulleted enumeration. Each item should be a single concrete artifact (a file path, a CLI flag, a standards section, etc.). Operator can paste a list or describe in prose; the skill normalizes.
4. **Acceptance criteria template** (optional) — defaults to: tests green, R2 HIGH applied, managed docs regenerated, commit lands clean. Override if the sprint has measurable thresholds (e.g. "mutation score ≥ 60%", "coverage ≥ 85%").
5. **Risks register** (optional) — 1–3 known risks. If operator skips, the skill derives risks from the deliverable list (e.g. "new CLI surface = backward-compat risk").

## Plan template reference

The canonical sprint plan template mirrors [`cortex/sprint-2-44-plan.md`](../../../cortex/sprint-2-44-plan.md) and [`cortex/sprint-2-45-plan.md`](../../../cortex/sprint-2-45-plan.md). Required sections in order:

1. **Frontmatter** — sprint id, date, status (`planned` / `in-progress` / `shipped`), owner.
2. **Goal** — 1–2 sentence scope. Quote operator's brief verbatim where possible.
3. **Deliverables** — numbered list, one artifact per item, with path or symbol.
4. **Acceptance criteria** — bulleted, each one verifiable mechanically (test passes, file exists, regex matches). Mirror cortex spec-verifier kinds: `shell` / `file_predicate` / `regex` / `ears_text` / `llm_judge` / `read_set`.
5. **Workflow phases** — list the 5 phases (Research / Synthesize / Implement / Review / Confidence) with a 1-line scope per phase.
6. **Risks** — bulleted, with mitigation per risk.
7. **Out of scope** — what this sprint explicitly does NOT do. Important to prevent scope creep mid-flight.
8. **References** — links to prior sprints, related standards docs, related ADRs.

Plan length target: 80–200 lines. Longer plans are usually a sign the sprint should be split.

## Workflow dispatch convention

Use the **Workflow tool inline-script pattern** validated in Sprint 2.44 Probe 3. The script orchestrates 5 sequential phases and returns their artifacts to the parent agent.

**Phase scopes:**

| Phase | Purpose | Typical output |
|---|---|---|
| Research | R1 web-research current state + prior art for the deliverables that touch external surfaces (versions, APIs, landscape, best practices). | `cortex/sprint-<N>-research.md` |
| Synthesize | Convert research + plan into concrete implementation steps. No code yet. | Inline plan refinement |
| Implement | Write code + tests + standards updates per the synthesis. This is the longest phase. | Edits to repo |
| Review | R2 6-agent parallel review pipeline (security / correctness / acceptance / ssot / blind / edge). | Per-agent reports |
| Confidence | Final aggregator: tests green, R2 triaged, all AC met. Emits go/no-go for commit. | Confidence verdict |

**Key dispatch invariants:**

- Each phase runs in its own subagent context so blast radius is contained.
- Phase outputs are written to disk (or returned as structured strings); the parent agent reads them between phases.
- The Implement phase is the only one that mutates the working tree. Research / Synthesize / Review are read-only.
- The Confidence phase MUST run; do not skip it even if you think the sprint is clearly done.

## Triage convention

When Review (Phase 4 of the workflow) returns findings:

- **HIGH severity** → apply in the same sprint commit. Cap effort at ~15 min per HIGH; if blocked, escalate.
- **MEDIUM severity** → apply if the fix is surgical (1–2 files, <30 lines diff, no API change). Otherwise defer to `r2-summary.md`.
- **LOW / informational** → log in `r2-summary.md` only; do not act unless operator explicitly asks.
- **Architectural / cross-cutting** → defer to follow-up sprint `<N>.1`. Record rationale: why this can't be fixed in-sprint, what the follow-up will do, who owns it.

The `r2-summary.md` artifact is the auditable trail. Mirror [`cortex/sprint-2-44-r2-summary.md`](../../../cortex/sprint-2-44-r2-summary.md) for shape.

## Commit convention

Single commit at the end of the pipeline. Conventional-commits subject line, body in the format below:

```
<type>(<scope>): <subject>

Sprint <N>: <sprint name>

Deliverables shipped:
- ...

R2: <H applied>/<H total> HIGH, <M applied>/<M total> MEDIUM, <X> deferred → sprint <N>.1
Tests: <before> → <after>
Docs: cortex-doc-regen --apply (no drift / N blocks refreshed)

[skip-review]

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Why `[skip-review]`:** workflow agents bypass the cortex pre-commit review hooks (per Sprint 2.44 Probe 3 finding — hooks fire on `git commit` from the harness, but workflow-runtime commits run in a subagent context where hooks may not be inherited). The `[skip-review]` tag signals to downstream automation that R2 was already run *inside* the workflow, not on the post-commit diff. Operator MUST validate that R2 was actually executed before tagging this — never paste `[skip-review]` on a commit that did not go through the workflow.

## Composition

This skill composes with:

- [`standards/workflows.md`](../../../standards/workflows.md) — when-to-use decision tree.
- [`standards/documentation.md`](../../../standards/documentation.md) — doc-regen step + managed-block contract.
- [`prompts/cortex-goal.md`](../../../prompts/cortex-goal.md) — turn-budget framing for the workflow phases.
- [`prompts/95-confidence.md`](../../../prompts/95-confidence.md) — Discovery questionnaire discipline.
- [`bin/cortex-doc-regen.cjs`](../../../bin/cortex-doc-regen.cjs) — managed-doc regeneration (Sprint 2.45).
- [`cortex/sprint-2-44-plan.md`](../../../cortex/sprint-2-44-plan.md), [`cortex/sprint-2-45-plan.md`](../../../cortex/sprint-2-45-plan.md) — canonical plan-shape references.
- [`cortex/sprint-2-44-r2-summary.md`](../../../cortex/sprint-2-44-r2-summary.md) — canonical r2-summary shape.

## Honest caveats

These are not edge cases — they will hit you. Plan for them.

1. **Workflow agents bypass cortex hooks.** The block-destructive hook, session-start hook, and pre-commit review hooks register against the operator's interactive Claude Code session. Subagents dispatched via the Workflow tool inherit a different harness context and may not see these hooks. The `[skip-review]` tag in the commit is the workaround; the operator MUST validate that the workflow's Review phase actually executed before trusting the commit.

2. **Plan files can rot if the workflow drifts.** If the Implement phase diverges from the plan (deliverables added / dropped mid-flight), the plan file must be updated *before* commit. Do not commit a plan that doesn't match what shipped. Either revise the plan or annotate the deviation in `r2-summary.md`.

3. **Doc-regen is idempotent but not free.** Running `cortex-doc-regen --apply` on a clean tree should produce no diff. If it does produce a diff on what you thought was a clean tree, that means a previous sprint forgot to regen — investigate before adding to your sprint's diff (the drift may not be yours).

4. **Triage discipline is the load-bearing piece.** The whole point of this skill is that triage doesn't happen 3 days later when the context is gone. Triage immediately after Review; defer deliberately, not by forgetting.

5. **Operator can cancel mid-pipeline.** If the operator interrupts after Phase 3 (Workflow dispatch), the working tree may be partially modified. Leave a `cortex/sprint-<N>-INTERRUPTED.md` note with the last completed phase + recovery instructions before exiting.

## Examples

### Example 1 — Sprint 2.46 capability marketplace skeleton

Operator: `/cortex-sprint Sprint 2.46 — capability marketplace skeleton`

Discovery answers:
- Name: "Sprint 2.46 — capability marketplace skeleton"
- Scope: "Stand up minimal capability marketplace surface: registry schema, fetch CLI, publish CLI, no UI yet."
- Deliverables: `bin/cortex-cap-fetch.cjs`, `bin/cortex-cap-publish.cjs`, `schemas/capability.json`, `standards/capability-marketplace.md`, `tests/unit/cap-fetch.test.cjs`, `tests/unit/cap-publish.test.cjs`
- AC: default + "schemas/capability.json validates against 3 example capabilities"
- Risks: backward-compat with existing action_kind registry

Pipeline output: `cortex/sprint-2-46-plan.md` (138 lines), workflow runs ~22 min, R2 surfaces 2 HIGH (applied) + 4 MEDIUM (2 applied, 2 deferred to 2.46.1), doc-regen refreshes capability-counts block in capability-tree, single commit lands.

### Example 2 — Sprint 2.47 OpenRouter beta-header migration

Operator: `udělej sprint na openrouter beta header — blocker pro Sprint 3.X`

Discovery answers:
- Name: "Sprint 2.47 — OpenRouter beta-header support"
- Scope: "Add Anthropic beta-header pass-through in OpenRouter engine so Memory Tool API can be unblocked."
- Deliverables: `bin/steward/_lib/openrouter.cjs` (3 functions), 2 new error codes, `standards/openrouter-policy.md` §beta-headers, 4 unit tests, 1 integration smoke
- AC: default + "smoke test against real OpenRouter with claude-opus-4-7 beta header succeeds"
- Risks: rate-limit on smoke test path

Pipeline runs Research phase first (R1 on OpenRouter docs current state), then Implement, R2 catches a HIGH security finding (header injection vector), applied in-commit, doc-regen no-op, ships in single commit.

### Example 3 — Sprint 2.48 living-docs polish

Operator: `start sprint to polish the living-docs system from Sprint 2.45`

Discovery answers:
- Name: "Sprint 2.48 — living-docs polish + extractor extensions"
- Scope: "Add 3 new extractors to cortex-doc-regen (skills count, agents count, prompts count) and wire them into capability-tree."
- Deliverables: 3 new extractor functions, 3 new renderer functions, capability-tree.md template update, 6 unit tests
- AC: default + "cortex-doc-regen --check exits 0 on clean tree"
- Risks: none beyond template-rendering edge cases

Pipeline is shorter (no Research phase needed — it's a follow-up), Implement + Review + Confidence, R2 surfaces 1 MEDIUM (deferred), doc-regen produces expected diff (this sprint's whole point), commit lands.

## Exit

When the status report has been printed and the commit has landed, you're done. Do not loop. The operator drives the next sprint kickoff manually.
