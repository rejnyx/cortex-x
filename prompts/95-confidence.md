---
title: 95% confidence baseline
status: reusable prompt fragment
origin: docs/transcripts/32-tricks-claude-code.md hack #9 (2026-05-13)
last_review: 2026-05-14
---

# 95% confidence prompt fragment

Paste this fragment at the start of a new session OR reference it from `/cortex-init` / `/start` / `/audit` to bias the agent toward asking clarifying questions before producing partial answers.

## Canonical phrasing

> Before you write code, ask me clarifying questions until you're at ~95% confidence about scope, acceptance criteria, and edge cases. Don't pattern-match my brief to the closest sample in your training data — ask. One round of questions now saves 3-4 rounds of corrections later.

That's the load-bearing line. The rest of this doc is examples of WHEN to apply it.

## Three worked examples

### Example A — new feature

**User says:** "Add a password reset flow to the auth page."

**Confident agent (skip the questions):** Writes the page, picks a token expiry, picks a delivery channel, picks copy.

**95%-confidence agent:** "Before I implement, three questions:
1. Delivery channel — email link, SMS code, or both?
2. Token lifetime — Anthropic-standard 15 min, or your existing session policy?
3. Rate-limit behavior — silent throttle, visible error, or CAPTCHA gate?
After I have those, I'll produce the plan + first commit."

The 95%-confidence path saves the operator from a feature shipped with the wrong delivery channel.

### Example B — ambiguous bug

**User says:** "Login is broken on Safari."

**Confident agent:** Inspects auth code, picks a likely culprit (cookie flags? CORS?), edits.

**95%-confidence agent:** "Before I dig in:
1. Repro — does login fail at /login submit, or after redirect to /dashboard?
2. Console errors — any visible in DevTools (4xx/5xx, CSP, mixed content)?
3. iOS Safari, macOS Safari, or both? Version?
4. Started after a specific deploy, or always been broken?
Tell me which of those you can answer; I'll narrow before touching code."

The 95%-confidence path catches the case where "broken" actually means "logo doesn't render" — fixed in 2 lines, not 200.

### Example C — large refactor

**User says:** "Move auth from custom JWT to Supabase Auth."

**Confident agent:** Starts editing `lib/auth.ts`, doesn't know which call sites get touched, breaks the build, recovers, ships a half-migration.

**95%-confidence agent:** "Before I start migration:
1. Scope — auth provider only, OR also rewrite session storage / row-level security?
2. Compatibility window — both auth systems coexisting for N weeks, or hard cutover?
3. User data migration — re-prompt users to log in (drops 30% session), or backfill via Supabase admin API (1-week ops project)?
4. Tests — do you have integration coverage for the existing JWT path? If not, that's prerequisite.
Each of those flips the implementation. I'll produce a plan once I know."

The 95%-confidence path turns "30 commits over 2 weeks" into "1 plan + 5 reviewed commits."

## When to SKIP

Trivial mechanical edits skip the 95% bar:

- Rename a variable across the codebase
- Bump a dependency
- Fix a typo in copy
- Apply a `cortex-doctor` fix-suggestion verbatim

For those, the cost of a wrong assumption is bounded by `git revert`. Skip the round of questions; pattern-matching is fine.

## When the operator says "just do it"

Honor it. The 95% bar exists to reduce rework, not to delay output. If the operator explicitly waives the questions ("just pick something reasonable", "you have full autonomy"), proceed. Document your assumptions inline in the first response so the operator can interrupt cheaply if you got one wrong.

## Cross-references

- [standards/verification-loop.md](standards/verification-loop.md) — what to do AFTER you've implemented (the verification pair)
- [standards/coding-behavior.md](standards/coding-behavior.md) — Think Before Coding, Goal-Driven Execution
- [docs/transcripts/32-tricks-claude-code.md](docs/transcripts/32-tricks-claude-code.md) hack #9 — origin transcript
- `bin/cortex-claude-md-augment.cjs` BLOCK_VERSION 3 — auto-injects this baseline into operator sessions
