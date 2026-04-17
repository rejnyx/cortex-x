# RULE 1 — Inviolable Architectural Invariants

> **Tier-1 primitive.** Every cortex-x project respects these from day 1. Not docs to read, not aspirations — **contracts**. Violations block merges, fail reviews, and surface as high-priority evolve insights.

---

## The Three Pillars (equal weight, always together)

### 1. SSOT — Single Source of Truth
Every piece of knowledge has **exactly one authoritative source**. No duplication. No drift.

- Labels, enums, constants → `config/constants.ts` (or equivalent)
- Design tokens (colors, spacing, typography) → `config/design-tokens.ts`
- Environment config → `.env` + one parser
- Data schema → one source (Supabase migration / Prisma schema / etc.), DB types generated, never hand-written twice
- Docs: institutional wisdom in cortex-x library, current state in project CLAUDE.md — **zero overlap**

Details: [`ssot.md`](./ssot.md)

### 2. Modular — Isolated Subsystems
Subsystems have **clean public interfaces**, hide implementation, and can be swapped without cascading changes.

- LEGO tools: one file per tool/feature, composable
- Adapter pattern for external services (OAuth provider, AI model, payment processor = swappable)
- No circular imports
- Test boundary = module boundary (unit tests test one module)
- Feature folders isolate concerns — `src/features/<x>/` knows only its own domain

Details: [`modular.md`](./modular.md)

### 3. Scalable — Patterns That Survive 10x Growth
Architecture decisions made today must **not break when load/team/data 10x's**.

- DB: indexes on foreign keys + query predicates from day 1
- Queries: pagination from day 1, no `select *` in loops
- Auth: RLS from day 1 (even for single-tenant MVP — migrating later = painful)
- State: server-side source of truth, client is cache
- Streaming > polling where applicable (SSE for long-running, webhooks for events)
- Rate limiting + cost guards at boundaries — not after a bill shock

Details: [`scalable.md`](./scalable.md)

---

## Tier hierarchy (for priority decisions)

When two standards conflict or budget is limited, Rule 1 wins.

| Tier | Standards | Status | Enforcement |
|---|---|---|---|
| **Rule 1** | SSOT, Modular, Scalable | Inviolable | Scaffold validation + ssot-enforcer always-on + PR gate |
| **Critical (Rule 2)** | Security, Testing, Observability | Must-have | Review pipeline flag = blocker |
| **Process (Rule 3)** | Accessibility, Performance, Error handling, Git, Docs, AI patterns | Should-have | Review pipeline flag = warning |

**Rule 1 violations = blocker.** No "we'll fix it later." Later never comes, and by then the whole codebase is the violation.

---

## Active enforcement (how it propagates)

Rule 1 is not a document. It's a **contract enforced at four lifecycle points**:

### A) At scaffold time (`prompts/new-project.md` Phase 4)
- Scaffold structure must already demonstrate Rule 1
- Phase 4.4 validation step: check SSOT (single `config/`), Modular (feature folders), Scalable (RLS enabled, indexes on FK, rate-limit stub)
- Missing any Rule 1 property → scaffold fails, regenerate

### B) At development time (hooks)
- `ssot-guard.cjs` hook (PreToolUse on Write/Edit): warn if about to create a duplicate of existing config/type/constant
- `session-start.cjs` surfaces current Rule 1 violations flagged in `insights/`

### C) At review time (code-review pipeline)
- `ssot-enforcer` agent is **ALWAYS spawned**, not optional — sees diff + `config/` + existing types
- Verdict: `BLOCK` if Rule 1 violation found, not just warning
- `blind-hunter` + `edge-case-hunter` also flag Rule 1 in their scope

### D) At evolve time (cortex-evolve weekly)
- Rule 1 violations mined from journal get **priority surfacing** — surfaced before other insight types
- Cross-project Rule 1 drift → urgent evolve proposal (transferable pattern)

---

## Concrete checklist (for every commit/PR)

Before merging any non-trivial change, verify:

**SSOT**
- [ ] No new string literal duplicated ≥2 places (extract to constant)
- [ ] No new type/interface duplicated (import from shared types)
- [ ] No config value hardcoded in 2 files (single env var + config parser)
- [ ] Docs change: is this institutional wisdom (→ cortex-x) or current state (→ CLAUDE.md)?

**Modular**
- [ ] New feature lives in `features/<slug>/` (or equivalent), not scattered
- [ ] External service access goes through adapter (no direct SDK import in business logic)
- [ ] No new circular dependency
- [ ] Tests import from module's public interface, not internals

**Scalable**
- [ ] New DB query: index on filtered/joined columns?
- [ ] New list endpoint: pagination?
- [ ] New external call: rate-limit + cost budget?
- [ ] New feature: works at 10x user count without rewrite?

---

## Anti-patterns (blocker-level)

These are **automatic PR blocks**, not debates:

- ❌ **Constant redefined** — `const API_URL = '...'` in 2 files
- ❌ **Direct external SDK in UI component** — `<Button onClick={() => openai.chat(...)}>` bypasses adapter
- ❌ **Copy-paste business logic** — "same code slightly adapted" = extract or refactor
- ❌ **Hand-written DB types that drift from schema** — generate from migration
- ❌ **RLS disabled on user-facing table** — even in "MVP"
- ❌ **`SELECT *` inside a loop** — N+1 + over-fetch
- ❌ **Feature code scattered across folders** — `manage-X` logic in 6 files without `features/X/` boundary
- ❌ **Docs duplicated between cortex-x and CLAUDE.md** — Dave's own bug caught in projects/relo.md April 2026

---

## What Rule 1 is NOT

Avoid wrong-side overreach:

- ❌ Rule 1 ≠ "no duplication ever" — Rule of Three applies (3 occurrences before abstraction)
- ❌ Rule 1 ≠ "extract every string to constant" — single-use strings are fine
- ❌ Rule 1 ≠ "premature microservices" — modular = boundary, not deployment unit
- ❌ Rule 1 ≠ "scale for 1M users from day 1" — scalable = pattern doesn't break at 10x, not that it's fast at 10M

Pragmatic > dogmatic. But once Rule 1 violation is identified, it's a blocker.

---

## Why Rule 1 is the meta-rule

Security can be added. Testing can be retrofitted. Observability can be layered on.

**But SSOT violation in a 50-file codebase = rewrite.** Modular violation = architectural debt that compounds. Scalable violation = works at MVP scale, dies at product-market fit.

Rule 1 is the only tier you can't fix later. That's why it's tier 1.

---

## Enforcement metrics (measured by cortex-evolve)

Every 3 months audit checks:

- **SSOT drift rate** — files where same constant/type lives in 2 places
- **Modular violations** — direct SDK imports in UI, cross-feature imports
- **Scalable regressions** — unindexed queries, unpaginated lists, missing RLS

Trending up → Rule 1 enforcement is degrading → tighten scaffolds/hooks. Trending down → working.

Baseline: established at first monthly evolve run post-2026-04-17.
