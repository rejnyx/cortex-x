---
date: 2026-04-17
project: amd-hackathon-2026 (ReplayAgent)
trigger: retrofit of amd-hackathon-2026 to the cortex-x Phase 4.3 stack (commits 1ac7be5, b167e7a, 58fcd1c)
input_for: cortex-evolve (should cortex defaults grow to absorb these gaps?)
---

# AMD retrofit — gaps that legacy project-custom agents covered

## Context

On 2026-04-17 I retrofitted `amd-hackathon-2026` (ReplayAgent) with the new cortex-x default agents + Phase 4.3 synthesis protocol. As part of RULE 1 cleanup (the irony: the project had just committed RULE 1 and immediately violated it by carrying 3 duplicate reviewer agents), I removed three legacy agents that overlapped cortex defaults:

- `code-reviewer.md` — removed. Overlapped `blind-hunter` + `ssot-enforcer`.
- `security-reviewer.md` — removed. Overlapped `security-auditor` (cortex default has a richer 8-layer model).
- `architecture-guard.md` — removed. SSOT pillar migrates to `ssot-enforcer`; modularita + škálovatelnost pillars migrate to `blind-hunter`.

The remaining 11 agents = 6 cortex defaults + 4 project-unique + 1 synthesized. Full roster at `amd-hackathon-2026/.claude/README.md`.

## What got lost (potential cortex-evolve input)

These are behaviors the removed legacy agents did well that the cortex defaults don't explicitly cover. Each is a candidate for adding to the cortex default set in a future evolve pass — OR for documenting as "out of scope for cortex defaults, synthesize per-project."

### 1. TypeScript-specific strictness review

The legacy `code-reviewer.md` explicitly checked: `any` usage, missing `readonly`, implicit return types on exported functions, unchecked indexed access violations.

**Cortex default coverage:** `blind-hunter` could find these if prompted, but nothing in the default set makes TS-strictness a first-class check.

**Recommendation:** either (a) enrich `blind-hunter` with a "language strictness" bullet for TS projects, or (b) document that TS-strict projects synthesize a `ts-strict-auditor` per Phase 4.3. Option (b) is lower-maintenance and matches the "defaults stay general" principle.

### 2. Next.js / React-19 / Server-Component boundary bugs

The legacy `code-reviewer.md` explicitly checked: misuse of Server Components vs client boundaries, `'use client'` sprinkling, `next/*` imports from `src/lib/`.

**Cortex default coverage:** no default hits Next.js boundary rules. `ssot-enforcer` catches duplicate-truth issues but not layer leaks per se.

**Recommendation:** framework-specific layer rules are exactly what Phase 4.3 synthesis is for. Keep out of cortex defaults. But: it may be worth adding a `framework-boundary-auditor` profile-level synthesized agent for the `nextjs-saas` profile in `cortex-x/profiles/nextjs-saas.yaml` so every new Next project gets it.

### 3. RULE 1 consolidated gate (all three pillars)

The legacy `architecture-guard.md` gave a single consolidated RULE 1 verdict (SSOT + modularita + škálovatelnost) with explicit pillar-by-pillar pass/fail.

**Cortex default coverage:** pillars are split across `ssot-enforcer` (pillar 1), `blind-hunter` (pillars 2-3 implicitly). No single agent says "RULE 1 verdict: PASS/FAIL."

**Recommendation:** consider adding a lightweight `rule-1-auditor` to cortex defaults that runs AFTER the other auditors and produces a 3-line consolidated verdict by reading their outputs. Low code, high signal. Alternative: bake this into `cortex-thinker`'s end-of-session summary.

### 4. Prompt-injection delimiter enforcement (project-specific)

The legacy `security-reviewer.md` had a concrete rule: "user-controlled text flowing into an LLM prompt must be fenced, templated, or sanitized." This caught the `analyze.ts` prompt-injection issue during pipeline v1.

**Cortex default coverage:** `security-auditor`'s 8-layer model includes "input validation" but doesn't call out LLM-prompt fencing specifically.

**Recommendation:** add an LLM-prompt-injection bullet to `security-auditor`'s input-validation layer. Every 2026 project has LLM-prompt content assembly; the default should recognize that.

## What was correctly migrated

- **SSOT (RULE 1 pillar 1)** → `ssot-enforcer`: direct and complete. `ssot-enforcer` is actually richer than the old `architecture-guard` SSOT check.
- **Secrets / HMAC / RLS / CORS / secret-commit hygiene** → `security-auditor`: richer 8-layer model catches more than the legacy reviewer did.
- **Hackathon-specific invariants** (byte-exact replay determinism, AMD MI300X env) → project-synthesized `determinism-auditor` + `rocm-env-validator.cjs` hook, grounded in `amd-hackathon-2026-2026-04-17.md` research cache per Phase 4.3.

## Overall verdict for cortex-evolve

The retrofit was a **net improvement in signal-to-noise** (11 agents each with distinct purpose > 13 agents with 3 duplicates). Gaps 1-2 are correctly "synthesize per project." Gap 3 (consolidated RULE 1 verdict) is a worthwhile addition to defaults. Gap 4 (LLM-prompt fencing) is a minor enrichment to `security-auditor`.

**Priority for next cortex-evolve:**
1. 🟢 Add LLM-prompt-injection fencing bullet to `security-auditor` (trivial, high value in 2026)
2. 🟡 Add `rule-1-auditor` consolidated verdict agent (or bake into `cortex-thinker`)
3. 🟢 Document "TS strictness / framework boundary audits are profile-level synthesized, not cortex defaults" in Phase 4.3 rules

Gaps 1-2 become learning material for future scaffolds: when a new TypeScript project runs `new-project.md`, Phase 4.3 research should consider synthesizing `ts-strict-auditor` for any project declaring `typescript: strict`.
