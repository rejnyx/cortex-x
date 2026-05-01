---
id: eval-002
name: scaffold-minimal-skip
category: bootstrap
version: 1.0
---

# Eval 002 — Scaffold Minimal (BAIL flow)

## Input

Empty folder. Paste `~/.claude/shared/prompts/new-project.md`. Respond to Phase 1 Q1 with:

> "Statický landing page pro mou kapelu, jen jedna stránka, žádný backend, skip"

(The keyword `skip` is the BAIL trigger. Keywords also include `minimal`, `rychle`, `quick`, `barebones`.)

## Expected properties

### Must have

- [ ] Phase 2 research **NOT triggered** (BAIL mode short-circuits)
- [ ] Profile resolved to `minimal` or `astro-static` based on description
- [ ] Directory contains: `CLAUDE.md`, `PROGRESS.md`, `README.md`, `LICENSE`, `.gitignore`, `.claude/`
- [ ] `CLAUDE.md` is present but minimal (≤80 lines) — references cortex-x institutional layer but doesn't pretend to be a heavy SaaS scaffold
- [ ] `PROGRESS.md` has 1 sprint with ≤3 stories (not 5+)
- [ ] No `src/lib/ai/` folder (no AI scaffolding for static page)
- [ ] No `src/app/api/chat/` reserved route (no chat API for non-AI project)
- [ ] No `evals/` folder (only AI-heavy / agent profiles get evals scaffolded)

### Must NOT have

- [ ] No 4-agent research cache file in `cortex-x/research/`
- [ ] No synthesized project-specific agents in `.claude/agents/` beyond defaults
- [ ] No package.json with Supabase/AI SDK/Anthropic deps (static site doesn't need them)
- [ ] No "Phase 2 research complete" output — Phase 2 must be skipped
- [ ] No prompt to confirm research before scaffold (BAIL = skip the prompt)

### Should have

- [ ] Time-to-scaffold < 30 seconds (no parallel agent spawn)
- [ ] Total cost < $0.10 (no Phase 2 = no expensive research calls)
- [ ] `.claude/settings.json` registers global hooks (same as full flow)
- [ ] Git initialized with first commit, message reflects vision (not "initial commit")
- [ ] Final report mentions "BAIL mode used — research phase skipped per user signal"

## Scoring rubric

- **1.0** — All must-have + all must-not-have + all should-have
- **0.9** — All must-have + all must-not-have, 1 should-have missing
- **0.8** — All must-have + all must-not-have, 2 should-have missing
- **0.6** — All must-have, 1 must-not-have violated (e.g., research ran anyway)
- **0.3** — Scaffold exists but research ran (BAIL was ignored — biggest possible failure)
- **0.0** — No scaffold OR full SaaS scaffold produced for static landing (severe profile mismatch)

## Adversarial probes

- **Did Phase 2 research auto-spawn?** Expected: NO. If research agents ran, that's a 0.3 cap.
- **Did Claude ask "are you sure you want minimal?"** Expected: NO. BAIL means proceed.
- **Did the scaffold include AI/chat/api boilerplate "just in case"?** Expected: NO. BAIL = honor user intent.
- **Did Claude re-prompt for Q2-Q7 after BAIL signal?** Expected: NO. BAIL skips remaining questions.

## Notes for evaluator

The whole point of BAIL is **respect user signal of low ambition**. If Claude treats `skip` as just another data point and runs full ceremony anyway, the eval has caught a regression. This is the canary for "scope creep in scaffold prompt." A passing eval-001 + failing eval-002 means the prompt has lost its scope-honoring discipline.

Cost matters here: full Phase 2 = ~$0.40 of research agents. BAIL flow should be ~$0.05. If the scaffold is correct but cost is full-flow, it's still a regression — record as 0.6.
