---
id: eval-001
name: scaffold-nextjs-saas
category: bootstrap
version: 1.0
---

# Eval 001 — Scaffold Next.js SaaS

## Input

Empty folder. Paste `~/.claude/shared/prompts/new-project.md`. Respond to Phase 1 questions:

- Q1: "SaaS pro property managery aby tracky-li pronájmy a payments"
- Q2: "Včera jsem viděl přítele jak to řeší v Excelu, stěžoval si že ztrácí přehled"
- Q3: "Tom Novák, property manager se 30 jednotkami"
- Q4: "Seznam jednotek + tracking plateb + alert na zpoždění"
- Q5: "Účetnictví, daně, komunikace s nájemníky přes chat"
- Q6: "Tom používá aplikaci aspoň 2× týdně za 2 týdny"
- Q7: "b) AI-ready"

Confirm `y` at proposal stage.

## Expected properties

### Must have
- [ ] Directory contains: `CLAUDE.md`, `PROGRESS.md`, `MEMORY.md`, `README.md`, `.claude/`, `LICENSE`, `.gitignore`
- [ ] `CLAUDE.md` references cortex-x mental model (SSOT split)
- [ ] `PROGRESS.md` has ≥3 stories reflecting Q4 answer (not generic)
- [ ] `README.md` has 1-sentence description derived from Q1 (not template placeholder)
- [ ] `memory/project_overview.md` captures Q1-Q7 answers
- [ ] `src/app/api/chat/` folder exists (AI-ready per Q7=b)
- [ ] `src/lib/ai/` folder exists with tools/ + memory/ subfolders
- [ ] `evals/` folder exists with README placeholder

### Must NOT have
- [ ] No generic placeholders like "TODO: add description" or "your project name"
- [ ] No references to "Dave" or "RELO" hardcoded in template outputs
- [ ] No absolute paths (should use `~/` or relative)

### Should have
- [ ] `.claude/settings.json` references global hooks (`~/.claude/shared/hooks/`)
- [ ] Research cache file exists: `cortex-x/research/<slug>-<date>.md`
- [ ] Git initialized with 1 commit, message reflecting vision (not "initial commit")

## Scoring rubric

- **1.0** — All must-have + all must-not-have + all should-have
- **0.9** — All must-have + all must-not-have, 1 should-have missing
- **0.8** — All must-have + all must-not-have, 2+ should-have missing
- **0.5** — 1-2 must-have missing BUT core scaffold exists
- **0.3** — Scaffold exists but multiple must-haves failed
- **0.0** — No scaffold produced, or must-not-have violated (generic placeholders, hardcoded paths, etc.)

## Adversarial probes

- Did discovery run? (≥80 words didn't trigger because Q1 is 14 words) — expect yes
- Did research run? (4 parallel agents auto-spawned) — expect yes
- Did proposal ask for confirmation before scaffold? — expect yes

## Notes for evaluator

When running this eval, measure not just output files but the **flow**:
1. Did Claude ask all 6 (or 7) questions before proposing?
2. Did Claude auto-spawn research agents without being asked?
3. Did scaffold content reference the USER'S actual answers (property managers, Tom Novák) rather than generic SaaS template?

If flow is wrong, even perfect files score ≤0.5.
