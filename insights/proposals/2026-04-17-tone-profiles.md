---
date: 2026-04-17
type: new-feature-proposal
confidence: 0.85
evidence_count: 0  # research-grounded, no journal data yet
projects: [cortex-x]
source: "research/tone-adaptation-2026-04-17.md"
status: pending_review
---

## Problem statement

Dave uses "máma-mode" in the AMD hackathon project — an explicit tone that explains concepts using laypeople analogies ("each Node project is a recipe in a cookbook..."). He asked whether cortex-x should **auto-detect** a user's preferred tone from their session behavior and adapt across projects.

Web research ([`research/tone-adaptation-2026-04-17.md`](../../research/tone-adaptation-2026-04-17.md)) returned a clear verdict: **industry converged on declarative tone profiles, NOT behavioral inference**. Every major tool (Claude Styles, ChatGPT Custom Instructions, Cursor Rules, Copilot 3-tier) landed there. Auto-inference is the documented failure mode of GPT-4o's April 2025 rollback (sycophancy drift, arXiv 2509.12517).

Without a declarative tone system, cortex-x has:
- No first-class way for Dave to encode "talk to me like a peer with deep systems knowledge" across all projects at once
- No mechanism to surface "tone mismatch" signals from journal (e.g. repeated follow-up clarifications)
- A gap the moment a second user tries cortex-x — they'd have no way to personalize without forking standards

## Evidence (research-grounded, journal data pending)

1. [research/tone-adaptation-2026-04-17.md](../../research/tone-adaptation-2026-04-17.md):L24-L37 — industry convergence finding (Anthropic, OpenAI, Cursor, GitHub all deprecated behavioral inference)
2. [arXiv 2509.12517](https://arxiv.org/pdf/2509.12517) — 2026 evidence that persistent context amplifies sycophancy drift (why auto-detect fails)
3. [DSPy MIPROv2 docs](https://dspy.ai/api/optimizers/MIPROv2/) — correct mental model: trace-driven instruction PROPOSAL (PR-gated), not in-session adaptation

Journal citations will be available after 1 week of real usage post hook-registration.

## Proposed change

Three small additions, **not implemented in this proposal** — this is a handoff so weekly evolve can pick it up with real data:

### 1. New directory: `profiles/tone/`

Four YAMLs (~20 lines each), declarative:

```yaml
# profiles/tone/mama.yaml
name: mama
description: Explain concepts through everyday analogies before technical detail
traits:
  lexical_level: accessible
  use_analogies: true
  code_density: low         # prefer prose ratio
  prerequisite_assumption: none
  jokes: light
  length_preference: medium-verbose
example_opening: "Představ si to takhle..."
```

Plus `peer.yaml`, `terse.yaml`, `mentor.yaml` at same schema.

### 2. Extend `config/evolve.yaml` with `tone_mismatch` insight type

New section under evidence_gates:
```yaml
tone_signals:
  follow_up_clarification:   # Dave re-asks same question → maybe too terse
    weight: 0.3
  correction_rate:            # "ne, ne to, myslím..." → possible style mismatch
    weight: 0.5
  session_abandonment:        # Dave stops mid-task → investigate
    weight: 0.2
min_mismatch_score: 0.6       # trigger only when strong
```

Weekly miner (B.1 in `prompts/cortex-evolve.md`) would produce suggestion PRs: "journal shows 12 follow-up clarifications on scaffold output — consider `tone: mama`?" — never auto-flip.

### 3. Add paragraph to `standards/ai-patterns.md`

Section title: **"Tone: declarative, never inferred."**

Content: ~8 lines citing arXiv 2509.12517, Claude Styles docs, explaining why cortex-x opts out of the sycophancy-prone auto-adaptation path. Reference `profiles/tone/` for the declarative alternative.

## Expected impact

- **For Dave now:** single line in project CLAUDE.md (`cortex.tone: peer`) replaces ad-hoc tone instructions scattered per-project. Cross-project consistency.
- **For future multi-user cortex-x:** no retraining needed — new user picks a profile. GDPR Art. 22 profiling concern sidestepped (explicit consent via explicit choice).
- **For evolve loop:** gives the loop a clean low-risk insight type to exercise before graduating to more consequential pattern surfacing.

## Rollback plan

Trivial: delete `profiles/tone/` directory. No code dependencies — tone profiles are only referenced when a project's CLAUDE.md opts in via `cortex.tone: <name>`. Missing key = current behavior (default voice).

## Dependencies

- Journal must be populating (hook landed in this session — needs real usage)
- Weekly evolve must have run at least once with real data before the `tone_mismatch` miner can be validated

## Acceptance criteria (when Dave reviews)

- [ ] Does Dave want 4 profiles or more/fewer? (máma/peer/terse/mentor proposed)
- [ ] Is `profiles/tone/` the right location, or should it be `config/tone/` (config-like) or `standards/tone/` (normative)?
- [ ] Should `CLAUDE.md.hbs` template include a commented `cortex.tone: peer` line by default?
