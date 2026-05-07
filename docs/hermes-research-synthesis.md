# Hermes — Research Synthesis (2026-05-07)

> Distillation of three parallel research briefs (topology, triggers/safety, git
> workflow) into the design decisions taken before drafting
> [`standards/hermes-policy.md`](../standards/hermes-policy.md) and
> [`docs/hermes-runtime.md`](./hermes-runtime.md).
>
> Companion to [`docs/hermes-rfc.md`](./hermes-rfc.md). The RFC stub asked nine
> open questions; this document answers each with research-grounded direction.

## Research provenance

Three background research agents dispatched 2026-05-07, each with non-overlapping
scope. Briefs archived at [`research/hermes-2026-05-07/`](../research/hermes-2026-05-07/) (TBD; full text currently in agent output logs):

| # | Brief | Primary question | Decision driver |
|---|---|---|---|
| 1 | **Topology** | Single-agent vs subagent? | Cognition essay + Anthropic SDK constraints |
| 2 | **Triggers + safety** | Cron / incident / mutex / cost / escalation? | OWASP LLM10 + Temporal mutex + ESCALATE.md |
| 3 | **Git workflow** | Branch model + atomic commit + rollback + PR? | Devin / Sweep / Copilot precedent + Aider atomic-commit-per-prompt |

## Decisions taken — summary table

| Concern | RFC's prior assumption | Research finding | Decision (v0) |
|---|---|---|---|
| **Topology** | TBD | Cognition + Anthropic agree single-agent for sequential code work | Single-agent core loop · opt-in read-only `investigate` subagent |
| **Trigger collision** | TBD (open question) | Mutex-by-key (Temporal pattern); GitHub Actions concurrency for idempotent triggers | Mutex-by-project-slug, FIFO `max_pending=1` per trigger-type, P0 incident > P1 manual > P2 cron == on-PR-merged |
| **Cost ceiling** | TBD | OpenAI Agents SDK has no `budget_usd`; meter at gateway | $0.50 soft / $2 hard per session; $3 / $5 daily project; $10 / $15 daily fleet (loop guards under MAX subscription, not bankruptcy protection) |
| **Branch model** | `hermes/<date>` (daily-rolling) | All production agents (Devin, Sweep, Copilot) use **branch-per-action**; long-lived branches drift from main | **Pivot:** `hermes/<YYYY-MM-DD>-<action-slug>-<short-id>` |
| **Commit model** | "Atomic commit per action" (vague) | Aider gold standard: `git status --porcelain` gate + one `git add -- <files>` + post-commit SHA verify | Aider-style discipline + Conventional Commits + Git trailers (`Hermes-Action-Id`, `Hermes-Journal-Entry`, `Hermes-Trigger`, `Hermes-Reverts`) |
| **Conflict on pull** | TBD | All sourced LLM-conflict tools (Sketch merde, LLMinus) propose on side-branch; never auto-merge | Halt + journal + ping. v1+ may opt-in to side-branch conflict-resolution drafts |
| **Rollback** | `git revert HEAD` | Confirmed safe; matches GitOps + saga compensating-transaction pattern. `git reset --hard` on pushed branches forbidden (already in `block-destructive.cjs`) | `git revert --no-edit <sha>` only; revert commit carries `Hermes-Reverts: <sha>` trailer |
| **PR default** | TBD | Copilot precedent: draft, promote-to-ready only after CI green + self-review checklist | Draft default; promote on CI green + atomic-commit contract verified |
| **Escalation** | TBD | ESCALATE.md / KILLSWITCH.md emerging open spec; 4-tier ladder | T0 silent journal → T1 `needs_review` flag → T2 ping (Slack DM, email fallback) + pause → T3 halt + `HERMES_HALT` sentinel |
| **Kill switch** | "block-destructive.cjs is the runtime enforcement layer" | Sakura Sky agent kill-switch primitives: file-based poison pill | `~/.cortex/HERMES_HALT` (fleet) and `<repo>/.cortex/HERMES_HALT` (per-project), checked at every tool-call boundary; Hermes cannot remove (extend `block-destructive.cjs` denylist) |
| **Self-improvement scope** | "Probably no for v0; opt-in flag for v1" | `config/evolve.yaml` already pins `human_only:` paths (standards/, prompts/, profiles/, agents/, module.yaml, CLAUDE.md, README.md) | v0: Hermes can edit `auto_improves:` paths only (insights/, journal/, projects/*.md via PR). Source-of-truth files remain human-only |

## RFC open questions — answered

The nine open questions on [`docs/hermes-rfc.md`](./hermes-rfc.md):

1. **Single-agent vs subagent topology?**
   → **Single-agent** with opt-in read-only `investigate` subagent. Cognition's "writer-uniqueness principle" applies (Hermes is the sole writer). Anthropic SDK confirms: subagents valuable for context-isolation, not for decomposition. Anthropic's own multi-agent paper shows orchestrator-worker wins on **research-shaped breadth-first work** (15× tokens, 90% better) — not Hermes's sequential-write workload.

2. **Trigger sequencing — Sentry alert during cron run?**
   → Mutex-by-project-slug. P0 incident may set `interrupt-at-checkpoint` flag; running session journals state and yields after current tool-call atom, never killed mid-flight. Modeled on Temporal mutex workflows.

3. **Cost ceiling per project?**
   → $3 soft / $5 hard daily per project; $10 / $15 daily fleet-wide. **v0 caveat:** Hermes runs on Dave's MAX subscription (CORTEX_BUDGET_DISABLED=1 already in env per memory) — these are loop-prevention guards, not bill-bomb protection. If Hermes ever moves to API key, ceilings become hard-meaningful.

4. **Self-improvement scope — can Hermes edit cortex-x prompts? Standards?**
   → No. `config/evolve.yaml` already encodes `human_only:` for standards/, prompts/, profiles/, agents/, module.yaml, CLAUDE.md, README.md. Hermes inherits this list as its denylist. v1+ opt-in flag deferred until v0 proves stable in cortex-x dogfood.

5. **Failure escalation — when does Hermes ping?**
   → 4-tier:
   - **T0** silent journal (soft warnings, low-stakes ambiguity)
   - **T1** journal with `needs_review: true` (80% budget burn, 3 retries, confidence < 85% on Rule-2 action)
   - **T2** ping (Slack DM → email fallback after 10min) + **pause** (no auto-retry; hard cap reached, forbidden-action blocked, loop tripped)
   - **T3** halt (T2 unanswered ≥30min, kill-switch present, repeat incident in rolling hour) + `HERMES_HALT` sentinel + `cortex doctor` blocks further runs until human clears

6. **Hermes hosting — MAX subscription or own API key?**
   → MAX (default). Override via env var `HERMES_API_KEY` for projects that should meter against a separate budget.

7. **Default ping channel — Slack vs email vs silent?**
   → Slack DM with email fallback after 10 min (ESCALATE.md spec defaults). Silent log = T0 only.

8. **First v0 target — which project gets Hermes first?**
   → cortex-x itself (eat-your-own-dogfood). Single use case: weekly `cortex-evolve` mining → 0-3 PR proposals to `insights/proposals/`. 3 weeks proven, then expand to RELO + Kiosek.

9. **What counts as "Hermes shipped" (v0 MVP)?**
   → Hermes runs cron-triggered on cortex-x once per week, opens at most 1 draft PR with at most 3 mining proposals, journals the run, halts cleanly. No incident triage, no on-PR-merged, no manual-trigger CLI for v0.

## Architectural pivots from RFC stub

Three places where research changed the RFC's prior assumptions:

### Pivot 1 — Branch model (significant)

RFC §54 says "every Hermes action = atomic git commit on a `hermes/<date>` branch". This is the **daily-rolling** model.

**Research finding:** every public production agent uses **branch-per-action** (Devin, Sweep, Copilot, Renovate, Dependabot). Trunk-based-development literature is unanimous: branches live hours, not days. Long-lived branches drift from main; agent assumptions go stale; conflicts compound.

**New:** `hermes/<YYYY-MM-DD>-<action-slug>-<short-id>`. One open Hermes PR at a time per project (mutex via journal lock file).

### Pivot 2 — Commit metadata (precision)

RFC §52 says "Hermes reads it before each action to know 'what did I already try and what failed?'" — implying journal lookup by free-text parsing.

**Research finding:** Git trailers are parseable by `git interpret-trailers --parse`. No regex, no fuzzy match, no future-Hermes regression when commit message format drifts.

**New:** every Hermes commit carries:
```
Hermes-Action-Id: <ulid>
Hermes-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl#L<n>
Hermes-Trigger: cron|incident|pr-merged|manual
Hermes-Recommendation-Source: cortex/recommendations.md#<heading-anchor>
```
Reverts add `Hermes-Reverts: <original-sha>` for bidirectional audit chain.

### Pivot 3 — Kill switch (concretized)

RFC §57 says "Safety layer — calls into block-destructive.cjs + custom Hermes policy file". Vague.

**Research finding:** Sakura Sky's "agent kill-switch primitives" catalogue identifies **file-based poison pill** as the lowest-friction halt mechanism — survives crashes, no networking required, human-only writable.

**New:** `~/.cortex/HERMES_HALT` (fleet) and `<repo>/.cortex/HERMES_HALT` (per-project). Hermes checks both at every tool-call boundary; presence = immediate clean shutdown, journal `kind: "halted_by_sentinel"`, exit 75. `block-destructive.cjs` denylist extended to forbid Hermes from removing either file.

## What v0 explicitly does NOT include

To prevent scope creep, the v0 spec defers:

- **On-incident triage** (Sentry/PagerDuty webhook → Hermes pulls trace → drafts fix PR). Requires a webhook receiver, signature validation, and incident-context loading. Defer to v1.
- **On-PR-merged consolidation** (after merge, run regression suite, journal outcome). Requires GitHub webhook receiver. Defer to v1.
- **Manual CLI trigger** (`cortex hermes run --action <id>`). Requires bin/ wiring. Defer to v1.
- **Cross-project pattern transfer** (RELO bug-fix pattern → propose in Chatbot Platform). Requires multi-project context; v0 is single-project.
- **Investigate subagent** activation. v0 stays purely main-loop; subagent escape hatch added in v1 when the first concrete need surfaces.
- **`config/evolve.yaml` `auto_improves:` propose_diff PR pipeline.** v0 just reads recommendations.md and runs one mining pass; PR drafting is the deliverable, not the auto-merge contract.

## v0 success criteria

Hermes ships when:

1. ✅ A single weekly cron run on cortex-x repo produces a draft PR with ≤3 mining proposals.
2. ✅ The PR's commits carry valid Git trailers (`Hermes-Action-Id`, `Hermes-Journal-Entry`).
3. ✅ The journal at `~/.cortex/journal/cortex-x/<date>.jsonl` is replayable: re-running Hermes with `--replay <date>` reaches the same end state.
4. ✅ Killing the run mid-flight via `~/.cortex/HERMES_HALT` exits cleanly within 30 sec.
5. ✅ At least one fixture-based dry-run lives at `tests/fixtures/hermes-dryrun/` and verifies the above without network access.
6. ✅ Pre-Hermes hard gates Tier 4 + Tier 5 stay green (no regressions introduced).

## Reversibility note

Every v0 decision is reversible at known refactor cost:

| Decision | Reversal cost |
|---|---|
| Single-agent → multi-agent | ~1-2 days (split `runHermesIteration()` into orchestrator) |
| `hermes/<date>-<slug>-<id>` → daily-rolling | ~few hours (branch-naming function only) |
| Cron-only triggers → cron + incident + PR-merged | ~1 day per trigger source (webhook receivers) |
| Single project (cortex-x) → multi-project fleet | ~few hours (per-slug config loader) |

What is **not** reversible: starting multi-agent first. Multi-writer commits and journal entries can't cleanly resume single-agent. Single-agent → multi-agent is a refactor; multi-agent → single-agent is a data migration. v0 picks the conservative path.

## Cross-references

- Authoritative SSOT: [`config/evolve.yaml`](../config/evolve.yaml) (auto_improves vs human_only)
- Inherited safety: [`shared/hooks/block-destructive.cjs`](../shared/hooks/block-destructive.cjs) (extend denylist)
- Standards: [`standards/security.md`](../standards/security.md) § Agentic Security 2026 (7 MUST patterns), [`standards/observability.md`](../standards/observability.md) § Runtime SLOs, [`standards/correctness.md`](../standards/correctness.md) § Zod boundaries (apply to journal schema)
- Companion docs: [`standards/hermes-policy.md`](../standards/hermes-policy.md) (refusals + denylist), [`docs/hermes-runtime.md`](./hermes-runtime.md) (5-component design + sequence flows)

---

*Drafted 2026-05-07 by cortex-x assistant pre-Hermes design pass. Reviewed by Dave Rajnoha. Each pivot grounded in at least 2 cited precedents from the three research briefs.*
