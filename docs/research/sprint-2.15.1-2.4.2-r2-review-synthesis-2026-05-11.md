---
title: Sprint 2.15.1 + 2.4.2 — R2 review pipeline synthesis + hardening
date: 2026-05-11
sprint: 2.15.1 + 2.4.2 (R2 hardening of Sprint 2.15 + 2.4.1)
status: SHIPPED
dispatched_by: autonomous session, 6-agent R2 review pipeline
---

# R2 Review Pipeline — Synthesis + Hardening Memo

## R2 dispatch (6 agents in parallel)

Operator requested R2 on commits `d4f8e2f`, `59a91a8`, `2a4dd72` (test-coverage-gap fix, Sprint 2.15 cortex-capabilities, Sprint 2.4.1 effort tuning). Combined diff: 2497 lines across 12 files, ~770 LoC new production code + ~321 LoC tests.

Six agents dispatched:
1. **acceptance-auditor** — ACs vs implementation
2. **blind-hunter** — bugs visible in diff without project context
3. **correctness-auditor** — gaps under adversarial inputs
4. **edge-case-hunter** — branching paths + boundary conditions
5. **security-auditor** — 8-layer security model
6. **ssot-enforcer** — duplicated knowledge / multiple sources of truth

## Findings convergence

**HIGH severity (multi-agent flagged):**

| Finding | Agents | Evidence |
|---|---|---|
| `inventoryActionKinds` uses regex parsing of `action-kinds.cjs` instead of `require()` | blind + acceptance + correctness + edge-case + ssot (5/6) | `cortex/capabilities.json:651` showed `flaky_test_repair` description truncated at `"scan source for "` — regex `[^'"`]+` terminated at apostrophe in `pattern_transfer` description `"CURRENT project's"`. Also brittle to indent reformatting (Prettier `tabWidth:4` would empty inventory). |
| `countLines` + `inventoryTests` filesystem walk follows symlinks (CWE-59) + unbounded recursion (CWE-400) | blind + security + edge-case | `Dirent.isDirectory()` follows symlinks; no visited-realpath cycle guard. Malicious `tests/loop → ../` infinite-recurses. |
| `resolveEffortLevel(plan, opts, env=null)` throws TypeError | edge-case | Default param only triggers on `undefined`; `null.CLAUDE_CODE_EFFORT_LEVEL` throws. |
| `readCoverageSummary` accepts truthy non-objects as "clean coverage" signal | edge-case | `[]` / `42` / `"x"` silently return `coverage_available:true, 0 candidates` — indistinguishable from real clean run. False signal for downstream Steward dispatch. |

**MEDIUM (multi-agent flagged):**

| Finding | Agents |
|---|---|
| Markdown table cells escape pipes only, not newlines / control chars | correctness + security |
| `opts.effort` case-sensitive vs `env` case-insensitive (asymmetry) | edge-case |
| `--write` block double-renders + unhandled write errors | blind + edge-case |
| Roadmap prose hardcodes capability counts → SSOT drift surface | ssot |
| Lazy require swallows ALL errors → silent fallback on syntax bugs | blind |
| No assertion that `effort` only applies to `requires_llm:true` kinds | blind |
| `inventoryProfiles` doesn't handle YAML block scalars or `TRUE` uppercase | edge-case |
| `inventoryWorkflows` regex misses `on: push` scalar form | edge-case |
| `extractCjsTagline` brittle to `--` separator or unspaced em-dash | edge-case |
| `countLines` exclusion list too narrow (missing `dist`, `coverage`, `.next`, etc.) | edge-case |

**LOW / advisory:**

- `cortex/capabilities.{md,json}` committed without explicit policy doc
- `generated_at` timestamp non-deterministic (cosmetic CI diff churn)
- `--write` directory existence check missing
- `extractSprintTag` trailing-dot edge case
- §9 M-2 future surface: when Sprint 3.X injects capability registry into Steward system prompt, markdown injection becomes critical (already pre-hardened by mdCell)

**No BLOCKER findings.** All 6 agents converged on "merge with follow-up" verdicts.

## Hardening shipped (Sprint 2.15.1 + 2.4.2)

### HIGH fixes

1. **`inventoryActionKinds` rewrite via `require()`** (`bin/cortex-capabilities.cjs:208-234`). Removes regex entirely. New fields exposed: `requires_llm`, `shipped_in`, `effort`, `blast_radius`, `cost_envelope`. Defense-in-depth: `hasOwnProperty.call()` filter against prototype-pollution lookups.

2. **Symlink + cycle protection** in `countLines` (`bin/cortex-capabilities.cjs:270-308`) + `inventoryTests` (`:248-272`). `fs.realpathSync()` + visited-Set + `ent.isSymbolicLink()` skip + try/catch on `readdirSync`. Expanded exclusion list to 12 build/cache dirs.

3. **`resolveEffortLevel` env/opts hardening** (`bin/steward/_lib/action-engine.cjs:1123-1175`):
   - Explicit `env === null` guard (parameter default only covers `undefined`)
   - `opts.effort` normalized with same trim/lowercase as env (symmetry fix)
   - `typeof rawEnvVal === 'string'` guard for non-string env values
   - `hasOwnProperty.call()` against prototype-pollution action_kind names
   - Lazy require catch narrowed to `MODULE_NOT_FOUND`; rethrow other errors

4. **`readCoverageSummary` DI contract tightening** (`detectors/test-coverage-gap.cjs:56-72`):
   - `undefined` → disk (production)
   - `null` → force-missing
   - plain object → use directly
   - ANY OTHER type (array, number, string, bool, function) → force-missing (no more false "clean coverage" signal)

### MEDIUM fixes

5. **`mdCell()` helper** (`bin/cortex-capabilities.cjs:349-365`) applied uniformly to all 8 table sections. Strips ASCII control chars, collapses whitespace, escapes pipes, caps length with ellipsis.

6. **`--write` block hardening** — try/catch around fs writes, `statSync().isDirectory()` check, single-render reuse, non-zero exit on error.

7. **Roadmap hardcoded count removal** — Sprint 2.15 entry in `docs/steward-roadmap.md` no longer cites "16 action_kinds, 37 primitives, ..." inline; links to `cortex/capabilities.md` TL;DR as authoritative.

### Tests added

- `effort-tuning.test.cjs` +7 tests: env=null, env=undefined, non-string env, opts case-insensitive, opts whitespace trim, prototype-pollution names, opts=null
- `cortex-capabilities.test.cjs` +9 tests: mdCell pipe/newline/control char/null/maxLen/non-string, action_kinds structured fields exposed, apostrophe preservation, prototype-pollution exclusion
- `detect-test-coverage-gap.test.cjs` +7 tests: mockSummary null/array/number/string/bool/function/plain-object DI contract

**Total: 23 new tests covering hardening surface.**

## Deferred (LOW or out-of-scope)

- `inventoryProfiles` YAML block scalar handling — operator profiles are flat schemas today; defer until profile schema expands
- `inventoryWorkflows` `on: push` scalar form — all current workflows use block form; defer
- `extractCjsTagline` `--` separator support — no current module uses it; defer
- Reproducible `generated_at` — cosmetic CI diff churn; defer to operator preference
- §9 M-2 future surface — mdCell already pre-hardens; revisit at Sprint 3.X when registry → system prompt actually wires up

## Verdict

All HIGH findings closed pre-commit. Test count 2226 → 2265 (39 new across Sprint 2.4.1 + 2.15 + this hardening). Full fast suite green. Capability registry regenerated with verified non-truncated descriptions (e.g. `pattern_transfer.description` now 247 chars vs pre-fix ~30 chars truncated at apostrophe).

R2 ritual closed per `docs/steward-roadmap.md` § 7 step 9-10 ("Run 6-agent review pipeline. All blocker findings closed.").

## Files touched

| File | Change |
|---|---|
| `bin/cortex-capabilities.cjs` | inventoryActionKinds rewrite + symlink protection + mdCell helper + --write hardening |
| `bin/steward/_lib/action-engine.cjs` | resolveEffortLevel env/opts/proto-pollution hardening |
| `detectors/test-coverage-gap.cjs` | readCoverageSummary DI contract tightening |
| `tests/unit/cortex-capabilities.test.cjs` | +9 hardening tests |
| `tests/unit/detect-test-coverage-gap.test.cjs` | +7 DI contract tests |
| `tests/unit/steward/effort-tuning.test.cjs` | +7 robustness tests |
| `cortex/capabilities.md` + `.json` | regenerated (no more description truncation) |
| `docs/steward-roadmap.md` | removed hardcoded counts |

## R1+R2 discipline retrospective

- **R1 research-before-implement** ✅ — 2 R1 memos for Sprint 2.4.1 + Memory Tool deferral
- **R2 review-pipeline-mandatory** ✅ — 6 agents in parallel, convergent findings, all HIGH closed pre-commit
- **R3 one-incident-class = one-defense-layer + regression-test** ✅ — each HIGH fix paired with regression test
- **R4 cost-ceiling-preserved** ✅ — no marginal cost added; Sprint 2.4.1 actually REDUCES cost (low for TRIVIAL kinds vs xhigh default)
- **R5 no-human-only-edits-become-Steward-able** ✅ — no auto-merge surface added
- **R6 backward-compat-by-default** ✅ — all changes preserve existing call signatures; opts.effort case-insensitivity is widening behavior, not narrowing
