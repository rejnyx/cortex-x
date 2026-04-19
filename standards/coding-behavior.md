# Coding Behavior — Meta-Rules for LLM Code Generation

> **Tier 1.5 — Behavioral.** Sits between Rule 1 (architectural invariants) and Rule 2 (quality-critical). Governs HOW the LLM codes, not WHAT architecture the code has. Four principles, each one-line testable.
>
> **Inspired by** [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills), paraphrased + adapted to the cortex-x lifecycle. Ideas referenced; no text copied verbatim (that repo has no LICENSE at the time of this writing).

---

## Why this exists

2026-04-17 retrospective: the cortex-x scaffold work itself committed two behavioral anti-patterns caught only after the 5-agent review pipeline ran. Mass find-replace of a maintainer's name (drive-by refactor) and over-engineered 200-line standards (premature elaboration). Both were **fixable post-hoc** but the fix cost > the upfront discipline cost.

Baking the four principles into the framework at scaffold + hook + review + evolve gates prevents that class of miss at source.

---

## The four principles

### 1. Think Before Coding — surface assumptions, don't pick silently

When the task has ≥2 plausible interpretations, **name them and ask**. Don't choose one based on the most common interpretation and hope for the best.

**Testable:** After reading a task description, can you list 2+ ways to interpret it? If yes, the first response must ask which, not start coding.

**In cortex-x:** `prompts/new-project.md` Phase 1 (six discovery questions) is this principle at bootstrap time. Extend it to per-session tasks — before multi-file diffs, list assumptions in a single paragraph.

**Anti-pattern:** "Add email validation to the form." Silently choosing one of: client-side only, server-side only, both, Zod schema, manual regex, replacing the existing pattern, extending it. Right behavior: list candidates in one line, ask.

---

### 2. Simplicity First — solve the stated problem, not the imagined one

Implement only what was asked. No speculative abstractions. No "while I'm here" additions. A senior engineer reviewing the diff should not say "overcomplicated."

**Testable:** Every new function / abstraction / config key answers "what current line of code uses this?" — if none, remove.

**In cortex-x:** already in [user global CLAUDE.md](../CLAUDE.md) ("NIKDY nepridavej features/refactoring nad rámec toho, co jsem rekl"). This standard escalates it to framework-enforced.

**Anti-pattern:** scaffolding a "ship-ready" standard with 11 subsections, 9 tables, 4 enforcement gates, and a telemetry roadmap when the ask was "make sure we can give this to testers."

---

### 3. Surgical Changes — edit only what's necessary

The diff must contain only lines that directly serve the stated task. Reformatting untouched code, renaming variables outside the task's scope, improving comments in unrelated files — each is a separate PR or a note in the commit.

**Testable:** For every hunk in `git diff`, you can state the specific task requirement it satisfies. Hunks that don't map → revert.

**In cortex-x:** [`prompts/code-review.md`](../prompts/code-review.md) `acceptance-auditor` already checks "Out-of-scope additions." Extend its prompt to quote this principle directly.

**Anti-pattern (evidenced):** 2026-04-17 commit `b3397a1` replaced "Dave" → "the user" in 72 positions across 20 files when the stated task was "ship-ready for beta testing." The maintainer's name was never a ship-ready violation. Mass replace also broke Czech sentences. Rework cost a follow-up commit.

---

### 4. Goal-Driven Execution — vague → verifiable

Transform any ambiguous task into a test-first loop: write a failing test that captures the goal → change code to make it pass → verify. If the task description doesn't name a verifiable outcome, derive one before touching code.

**Testable:** For every task, exists a script/command/assertion that returns exit 0 iff the task is done.

**In cortex-x:** [`standards/testing.md`](./testing.md) covers test pyramid; this principle mandates test-first ordering for behavioral bugs. For scaffold / prompt work (not test-backed), the "verifiable outcome" is the review pipeline green + grep gate pass.

**Anti-pattern:** "Fix the auth bug" → modifying auth code without first writing a reproduction. Correct: `npm test -- auth.login.invalid-password` fails reproducibly → fix → test passes.

---

## Enforcement (cortex-x lifecycle)

### A) Scaffold time — [`prompts/new-project.md`](../prompts/new-project.md)
Phase 1's six discovery questions enforce Principle 1 (surfacing) and Principle 4 (Q6 success signal = verifiable outcome). Phase 4.4 validation step adds: scaffold output must itself be Surgical (no speculative folders, no "might need later" files).

### B) Development time — hooks
`ssot-guard.cjs` (future) warns before creating duplicate constants — ties to Principle 2. No new hook needed for these principles individually; they're prompt-time discipline.

### C) Review time — [`prompts/code-review.md`](../prompts/code-review.md)
- `blind-hunter` already catches some violations of Principle 3 (dead code, drive-by formatting).
- `acceptance-auditor` checks Principle 3 (scope creep) and Principle 4 (spec coverage).
- Add **explicit principle citation** to `acceptance-auditor` output: if flagging scope creep, cite "Surgical Changes (coding-behavior.md §3)".

### D) Evolve time — [`prompts/cortex-evolve.md`](../prompts/cortex-evolve.md)
Journal mining flags repeated violations as insights. If the framework's own commits violate Principle 3 three times in 14 days, surface as priority insight (Rule-1.5 regression).

---

## Tier relationship

```
Rule 0   — Ship-Ready            (is this distributable?)
Rule 1   — SSOT+Modular+Scalable (architecture correctness)
Rule 1.5 — Coding Behavior       (how the LLM produces code)
Rule 2   — Security+Testing+Obs  (quality-critical)
Rule 3   — Process standards     (should-haves)
```

Rule 1.5 sits below architecture (you can violate Simplicity First without violating SSOT, but the reverse is usually true) and above security (a drive-by refactor is a process problem before it's a security problem).

---

## Concrete examples

See [`coding-behavior-examples.md`](./coding-behavior-examples.md) for 10 before/after scenarios specific to cortex-x's stack (Next.js 16, Supabase, TypeScript strict, agentic tools).

---

## What this standard is NOT

- ❌ **A style guide.** Linters cover formatting. This covers decision behavior.
- ❌ **An excuse for analysis paralysis.** "Think before coding" doesn't mean "ask 10 questions about a one-line typo fix." Use judgment — Karpathy-source observation: "for trivial tasks, just do it."
- ❌ **A replacement for Rule 1.** You can write Surgical, Simple, Goal-Driven code that still violates SSOT. All tiers apply together.

---

## References

- [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) — original observations by Andrej Karpathy, packaged by Multica AI, 60k+ stars as of 2026-04-19. Ideas adopted here via paraphrase; no verbatim copy. If / when Multica adds a LICENSE file permitting redistribution, this standard may incorporate direct examples with attribution.
- [`ssot.md`](./ssot.md), [`modular.md`](./modular.md), [`scalable.md`](./scalable.md) — Rule 1 technical companions.
- [`testing.md`](./testing.md) — Rule 2 companion; Goal-Driven Execution complements test pyramid with test-first ordering.
