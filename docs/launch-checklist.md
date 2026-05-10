---
title: cortex-x — public-launch readiness checklist
created: 2026-05-10
status: living document — updated as items close
based_on:
  - operator brief: docs/research/cortex-x-sprint-brief-10-5.md
  - housekeeping audit: docs/research/cortex-x-housekeeping-audit-2026-05-10.md
  - 2026 launch best-practices research (Sprint LR.4)
---

# cortex-x — public-launch readiness checklist

> Single source of truth for "what must close before flipping cortex-x repo public + tagging v0.1.0." Items grouped by gate priority. Operator-only items are flagged explicitly — engineer cannot ship them autonomously.

## P0 — blocks public flip (MUST close)

These items MUST close before the GitHub repo goes from private → public. Each is either a security gap, a brand collision, or a license blocker.

### Security baseline (Sprint 2.5b + 2.6b enforced)

- [ ] **Secret history sweep** — run `secret_history_sweep` cron at least once on full history with TruffleHog `--only-verified`. Zero verified findings, OR all flagged credentials rotated + history rewritten if non-trivial.
- [ ] **Workflow hardening** — run `workflow_hardener` cron at least once. All HIGH findings (unpinned actions, missing `permissions:`) addressed in workflows that ship to public branch.
- [ ] **D-1 git history PII purge** — see `MIGRATIONS.md` D-1 entry. Destructive force-push of git history; human-only operation.
- [ ] **`npm audit --audit-level=high`** — Sprint 2.3a gate. Zero high/critical CVEs in dev dep tree at flip-time.
- [ ] **`no-pii.yml` workflow** — green on every PR + push. PII scanner shipped pre-Sprint-1.6 (existing).

### Brand + license

- [ ] **Naming decision** — `cortex-x` has known kolize (Cortex Labs defunct ML platform, Cortex.dev k8s, Snowflake Cortex Search). [HUMAN-ONLY] strategic operator decision. Output: `docs/naming-decision.md` rationale + final rename PR.
- [ ] **License decision** — current `PolyForm Noncommercial 1.0.0` blocks all commercial adoption (including operator's own client work). [HUMAN-ONLY] strategic decision: full open-source (MIT/Apache-2.0) / dual-license / BSL 1.1 / status quo. Output: `docs/license-decision-rationale.md` + updated `LICENSE`.
- [ ] **GitHub repo description + topics** — populate before flipping. Topics suggestions: `claude-code` `agentic` `autonomous-agents` `dev-tools`.

### README narrative

- [ ] **Opening line rewrite** — current opening is abstract ("A persistent agent, not just a tool"). Replace with: 1 concrete benefit + 1 concrete proof (number/fact) + 1 differentiation vs Devin/Copilot/Replit Agent.
- [ ] **Status banner near top** — "Pre-alpha. Phase 1-4 + Tier 1 (Sprint 1.9 → 2.11) shipped. Phase 5-7 (self-improvement automation, memory upgrades, Steward cron runtime) pre-launch dogfood. Production use at your own risk; PR review mandatory."
- [ ] **"Built by"** — David Rajnoha intro: design engineer Ostrava, 17 years design + 15 months self-directed AI engineering since Karpathy's Feb 2025 vibe-coding cutoff. Architecture human, code AI-assisted, integration testing manual. Link to portfolio + LinkedIn.
- [ ] **"Why not Devin / Copilot / Replit Agent" comparison table** — 4-row matrix per [`docs/positioning-vs-ralph.md`](./positioning-vs-ralph.md) framing. cortex-x's differentiation: self-hosted, atomic-rollback safety, monthly cron senior-tester, multi-window cost caps.
- [ ] **Phase 5 disclaimer** — Sprint LR.3 — already shipped 2026-05-10; verify still accurate at flip-time.

## P1 — strong signal but not blocker

### Eval baseline

- [ ] **LR.1 — Real-run eval baseline** — run 5 executions × 3 canonical tasks from `evals/eval-001` to `evals/eval-009` against default model `deepseek/deepseek-v4-flash`. Capture pass/fail, token cost, wall clock, retry count. Output: `evals/results/2026-MM-DD-real-baseline.json`. Cost ~$0.05 total. **This unblocks Phase 5 statistical claims.**
- [x] **LR.1.1 — Aider-Polyglot lift discipline** — ✅ shipped 2026-05-10 as [`evals/runner.md`](../evals/runner.md) § "Aider-Polyglot lift discipline (Sprint LR.1.1)". Discipline encoded as Phase 2 runner spec (`MIN_STEPS=30` + `test_executed:true` before score write). Verified Steward action_kinds already enforce test-execution-before-scoring via spec-verifier (Phase 6 gate) + runNpmTest (Phase 7 gate) + atomic rollback in [`bin/steward/execute.cjs`](../bin/steward/execute.cjs). Step-limit equivalent enforced via cost-safety multi-window caps + intra-run StuckLoopDetection + cross-session loop detector. Note: `evals/run.cjs` itself does not exist (Phase 2 future); discipline shipped as the spec for when it gets built.
- [x] **Cross-model transfer protocol** — ✅ shipped 2026-05-10 as [`docs/eval-cross-model-protocol.md`](./eval-cross-model-protocol.md). Defines transfer_ratio formula (≥ 1.0 required), required model set (deepseek-v4-flash baseline + claude-sonnet-4-6 OR gpt-5-mini secondary), GATE-MANDATORY/OPTIONAL/WAIVED path classification, result schema additions, fail-closed posture on missing runs, DGM tiered subset-first cost discipline. Integrated as Phase C.5 in [`prompts/cortex-evolve.md`](../prompts/cortex-evolve.md) + SSOT config under `eval_suite.cross_model_transfer:` in [`config/evolve.yaml`](../config/evolve.yaml). Grounded in DGM cross-model transfer test (o3-mini 23 % → 33 %, Claude 3.7 Sonnet 19 % → 59.5 %).

### Visibility

- [ ] **Demo asset** — 60-sec asciinema cast OR MP4: `cd ~/empty` → `cortex-bootstrap` → answer 3 questions → `claude` → working `/start` flow → final project tree. Embed at top of README. Bonus: 30-sec Steward dry-run cast (recommendations.md → draft PR diff preview).
- [x] **Competitive positioning page expansion** — `docs/positioning-vs-ralph.md` covers Ralph; ✅ shipped 2026-05-10 as [`docs/positioning.md`](./positioning.md) — 7-tool comparison matrix (Devin / GitHub Copilot Coding Agent / Replit Agent / Cursor BG Agent / Sakana DGM / OpenClaw / Aider) + per-competitor profiles + honest weaknesses + differentiator that survives scrutiny. Grounded in 25 cited URLs from May 2026 research sweep.
- [ ] **`docs/positioning-vs-ralph.md` § Sprint 2.3 mutation hook** — already shipped 2026-05-10; verify at flip-time that mutation-as-fitness positioning reads naturally for new audience.

### Operator dogfood evidence

- [ ] **2-week Steward dogfood log** — collect cost ledger + journal data from cortex-x's own dogfood runs over 14 days. Brief blogpost / GH Discussion: "What 14 days of Steward dogfood looked like" — N PRs, M $ spent, X regressions caught. **Real evidence > marketing copy.**
- [ ] **Operator testimonial OR case study** — cortex-x running on RELO / Kiosek / Chatbot Platform (operator's other repos) for 1 week each. Document patterns transferred via `pattern_transfer` action_kind.

## P2 — nice-to-have, post-launch refinement

- [ ] **`Show HN` draft** — 2-paragraph submission text, ready for paste at `news.ycombinator.com/submit`. Include: cortex-x positioning sentence + 1 link to demo cast + 1 link to RFC.
- [ ] **Reddit `r/ClaudeAI` announcement** — same content adapted to subreddit norms.
- [ ] **LinkedIn post** — operator-narrated version of the launch, anchored to "designer who shipped 14 cortex-x capabilities in 15 months by treating AI as senior teammate, not as autocomplete."
- [ ] **First external PR / contributor onboarding** — `CONTRIBUTING.md` already exists; verify `good-first-issue` label has 3-5 entries before public flip.
- [x] **`docs/positioning.md`** — full competitive landscape table. ✅ shipped 2026-05-10. (Same item as P1 above; documenting close in both places for traceability.)
- [ ] **GitHub Discussions enabled** — categories: Q&A, Show & Tell, Ideas.

## P3 — operational hygiene (continuous)

- [ ] **Sprint 2.11 senior-tester monthly run** — first cron should fire 2026-06-01 04:00 UTC. Verify the issue lands in this repo + reviewer reads it.
- [ ] **Sprint 2.5b workflow-hardener weekly run** — first Sunday after merge. Self-reports cortex-x's own workflow hardening gaps (intentional dogfood).
- [ ] **Sprint 2.6b secret-sweep weekly run** — first Sunday after merge. Required gate before public flip; runs concurrently with workflow_hardener.

## Operator-only items (cannot delegate)

| Item | Why operator-only |
|---|---|
| Naming decision (P0) | Strategic + brand identity, not engineering |
| License decision (P0) | Legal posture; affects all future contributors |
| Demo asset recording (P1) | Operator-narrated voice/cursor; cannot synthesize |
| LinkedIn / HN post (P2) | First-person narrative; not autonomous content |
| 2-week dogfood log (P1) | Authenticity — must be operator's actual usage |

## Tracking

- This file is the SSOT for launch readiness. Update checkboxes as items close.
- Each P0 close should reference the closing commit / PR SHA.
- When all P0 + at least 4 of 6 P1 close → eligible for `v0.1.0` tag + repo flip public.

## References

- Operator brief: [`docs/research/cortex-x-sprint-brief-10-5.md`](./research/cortex-x-sprint-brief-10-5.md) (2026-05-10 morning analysis, mostly still valid)
- Housekeeping synthesis: [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](./research/cortex-x-housekeeping-audit-2026-05-10.md) §1 Sprint LR track
- Security baseline: [`MIGRATIONS.md`](../MIGRATIONS.md) Sprint 2.5b + 2.6b entries
- Roadmap: [`docs/steward-roadmap.md`](./steward-roadmap.md) Tier 1 + Sprint LR section
