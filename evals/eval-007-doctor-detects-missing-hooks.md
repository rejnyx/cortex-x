---
id: eval-007
name: doctor-detects-missing-hooks
category: doctor
version: 1.0
---

# Eval 007 — cortex-doctor detects missing hooks registration

## Input

Setup: cortex-x is installed (`~/.claude/shared/hooks/*.cjs` exist) but `~/.claude/settings.json` is **missing the `UserPromptSubmit` registration** for `auto-orchestrate.cjs`. This is a realistic regression: user installed cortex-x before auto-orchestrate existed, never re-registered.

```jsonc
// ~/.claude/settings.json (PARTIAL — UserPromptSubmit missing)
{
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "SessionStart": [...]
    // UserPromptSubmit ← MISSING despite hook file existing
  }
}
```

Paste `~/.claude/shared/prompts/cortex-doctor.md`.

## Expected properties

### Must have

- [ ] Doctor's check #1 (Installation integrity) flags the missing `UserPromptSubmit` registration
- [ ] Output severity is 🟡 Warning (not 🔴 Critical — hooks not registered is degraded but not broken)
- [ ] Issue identifies BOTH:
  - Hook file exists at `~/.claude/shared/hooks/auto-orchestrate.cjs`
  - But `~/.claude/settings.json` doesn't reference it under `UserPromptSubmit`
- [ ] Concrete fix provided: copy-paste-ready JSON snippet to add to `~/.claude/settings.json`
- [ ] Output mentions running `~/.claude/shared/install.sh` (or `install.ps1`) as alternative remediation

### Must NOT have

- [ ] No "auto-fix" — doctor is read-only diagnostic
- [ ] No fabricated check (e.g., flagging hooks that don't exist as missing)
- [ ] No critical (🔴) escalation for non-critical drift
- [ ] No silent pass — drift between installed hook + registered hook is the canary
- [ ] No "go run install.sh" without explaining what it will do (idempotent, additive)

### Should have

- [ ] Doctor also lists which OTHER hooks ARE correctly registered (positive feedback)
- [ ] Final summary line: `Hook registration: 4/5 hooks active. 1 drift: UserPromptSubmit (auto-orchestrate.cjs)`
- [ ] Mention CORTEX_BUDGET_DISABLED env var if user has it set (so they know the budget UI suppression is intentional)
- [ ] Suggest scaffolded-project cross-ref check (#12) if any client projects have CLAUDE.md files

## Scoring rubric

- **1.0** — All must-have, all must-not-have, all should-have nice-to-haves
- **0.9** — All must-have, all must-not-have, 1 should-have missed
- **0.8** — Drift detected but fix snippet has wrong syntax (e.g., comma errors)
- **0.6** — Drift detected, escalated to 🔴 Critical (over-escalation)
- **0.4** — Doctor ran but missed the UserPromptSubmit drift entirely
- **0.0** — Doctor didn't run, OR auto-modified `settings.json` without permission

## Adversarial probes

- **Did doctor try to auto-fix `~/.claude/settings.json`?** Expected: NO. Read-only diagnostic.
- **Did doctor escalate to Critical?** Expected: NO. Auto-orchestrate is value-add, not load-bearing.
- **Did doctor flag hooks that exist correctly as broken?** Expected: NO. False positives kill trust.
- **Did doctor's fix snippet match the exact JSON shape from `install.sh` echo output?** Expected: YES. Must be copy-paste-ready, not paraphrased.

## Notes for evaluator

This eval tests a realistic scenario: cortex-x evolves, new hooks ship, users don't re-install. Doctor must detect this drift and explain the fix without creating panic. The test isn't "doctor detects bugs" — it's "doctor surfaces install-vs-config drift correctly."

If doctor scores < 0.8 on this, the doctor prompt has either become too quiet (missing real drift) or too loud (false positives, over-escalation). Both kill its usefulness.
