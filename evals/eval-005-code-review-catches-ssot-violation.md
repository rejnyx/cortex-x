---
id: eval-005
name: code-review-catches-ssot-violation
category: review
version: 1.0
---

# Eval 005 — Code review pipeline catches planted SSOT violation

## Input

Setup: in any cortex-x-aware project, plant a deliberate SSOT violation:

```typescript
// File 1: src/config/limits.ts
export const MAX_REQUESTS_PER_MINUTE = 60;
export const MAX_TOKENS_PER_DAY = 100_000;

// File 2: src/lib/rate-limit.ts (PLANTED VIOLATION — duplicates limits.ts)
const RATE_LIMIT = 60;  // hard-coded duplicate
const DAILY_TOKEN_CAP = 100_000;  // hard-coded duplicate

export function checkLimit(req: number, tokens: number) {
  if (req > RATE_LIMIT) throw new Error('rate limited');
  if (tokens > DAILY_TOKEN_CAP) throw new Error('budget exceeded');
}

// File 3: src/middleware/throttle.ts (PLANTED VIOLATION — third copy)
const REQUEST_CEILING = 60;
```

Stage these as if they're part of an uncommitted diff. Paste `~/.claude/shared/prompts/code-review.md`.

## Expected properties

### Must have

- [ ] `ssot-enforcer` agent runs as part of the 5-agent pipeline
- [ ] Verdict for `ssot-enforcer` is **BLOCK** (not WARN, not PASS)
- [ ] At least 1 finding cites all 3 file paths (limits.ts, rate-limit.ts, throttle.ts)
- [ ] Finding identifies the duplicated value (60) AND the duplicated semantic (rate limit)
- [ ] Severity assigned: BLOCKER (Rule 1 violation per `~/.claude/shared/standards/RULE-1.md`)
- [ ] Recommended fix specified: import from `src/config/limits.ts` in both other files
- [ ] Final verdict cannot be MERGE (a single BLOCK from any agent prevents merge per `auto-review.md` contract)

### Must NOT have

- [ ] No finding that says "looks fine, ship it" from any agent
- [ ] No suggestion to **delete** `src/config/limits.ts` (that's the correct location)
- [ ] No "auto-fix" — agents flag, don't apply patches
- [ ] No silent pass for `100_000` even though only 2 files duplicate it (still a Rule 1 violation)

### Should have

- [ ] At least 1 OTHER agent (likely `blind-hunter`) independently flags the duplication — cross-validation
- [ ] Finding mentions blast radius: "3 files depend on the drifted value 60"
- [ ] Output follows the auto-review.md anti-slop format (structured, not chat narrative)
- [ ] If 3+ agents return same BLOCK, summary flags it as high-confidence

## Scoring rubric

- **1.0** — `ssot-enforcer` BLOCKs, all file paths cited, fix specified, cross-validated by ≥1 other agent
- **0.9** — `ssot-enforcer` BLOCKs, file paths cited, fix specified, no cross-validation
- **0.8** — `ssot-enforcer` flags as WARN (not BLOCK) — Rule 1 should always be BLOCKER
- **0.5** — At least one agent catches the duplication but `ssot-enforcer` returned PASS
- **0.3** — Pipeline ran but no agent caught the planted violation
- **0.0** — Pipeline didn't run, OR `ssot-enforcer` recommended deleting the SSOT file (`limits.ts`)

## Adversarial probes

- **Did `ssot-enforcer` run at all?** Expected: YES. Per `auto-review.md`, ssot-enforcer is mandatory regardless of scope (Rule 1 gate).
- **Was the verdict BLOCK or WARN?** Expected: BLOCK. Rule 1 violations are blockers, not warnings.
- **Did Claude propose to auto-fix?** Expected: NO. Review is read-only.
- **Did 5 agents actually spawn in parallel?** Expected: YES — count the parallel Agent tool calls in the same message.
- **Did the merge-decision logic correctly refuse MERGE?** Expected: YES — single BLOCK = no merge.

## Notes for evaluator

This is the **canary for "Rule 1 enforcement is real."** Without this eval, ssot-enforcer could quietly degrade to a noisy WARN that ships violations to prod. The whole cortex-x premise of "Rule 1 = automatic blocker" is what this eval verifies.

If a Claude session "feels nice" but ships this eval as PASS, cortex-x has lost its main differentiator. Worth running before any v0.1.0 tag.
