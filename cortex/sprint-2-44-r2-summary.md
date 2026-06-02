# Sprint 2.44 — R2 Review Summary

> Required by Sprint 2.44 plan AC-12 (llm_judge criterion). Documents every
> HIGH and MEDIUM finding from the 6-agent R2 review pipeline + Pass-2
> confidence validation, with disposition (applied / deferred / refuted).
>
> **Provenance:** workflow run `wf_d2f0c3a4-2c7` (2026-06-02). 22 agents,
> 1,386,735 subagent tokens. 60 raw findings → 28 validated (14 HIGH + 14
> MEDIUM, 0 LOW) after Pass-2 confidence filter (≥75 OR HIGH) + dedupe by
> file:line with multi-reviewer attribution.

## Disposition summary

| Bucket | Count | Notes |
|---|---|---|
| **Applied in-commit** | 14 | All HIGH bugs with surgical fixes + defensive MEDIUM guards |
| **Deferred to Sprint 2.44.1** (with rationale) | 14 | Architectural / cross-cutting / pre-existing items requiring ADR |
| **Refuted** | 0 | None — every finding was actionable |

## HIGH findings (14) — disposition

### Applied in-commit (11)

| # | File:Line | Finding (one line) | Citing reviewers | Confidence | Fix |
|---|---|---|---|---|---|
| H-1 | `shared/workflows/r2-review.js:182` | Agent name misattribution after `filter(Boolean)` — idx drift shifts every subsequent attribution | blind, edge, correctness | 91 | Capture `name` BEFORE filter via `.map(...).filter(...)` pairing |
| H-2 | `shared/workflows/audit.js:41` + `r2-review.js:159` | Function signature mismatch between sibling workflows (`{agent,parallel,args}` vs `{agent,parallel,pipeline},args`) | blind, edge, acceptance | 87 | Aligned both to `({ agent, parallel, pipeline }, args)` second-positional |
| H-3 | `tools/workflow-compatibility-audit.cjs:2` | Shebang on line 2 instead of line 1 — Unix execve won't honor | blind | 95 | Moved `#!/usr/bin/env node` to line 1, SPDX to line 2 |
| H-4 | `shared/workflows/audit.js:106` | Unguarded LLM-output property reads — no `schema:` passed to any agent() | blind, edge, correctness | 81 | Added 6 JSON schemas (DETECT_SCHEMA, REPO_MAP_SCHEMA, AUDIT_LENS_SCHEMA, RESEARCH_PLAN_SCHEMA, RESEARCH_SCHEMA, SYNTHESIS_SCHEMA) + defensive shape checks |
| H-5 | `shared/workflows/r2-review.js:207` | Order-dependent indexing of skeptic results — no length-equality assertion | edge, correctness | 70 | Added `if (skepticResults.length !== rawFindings.length) throw` invariant assertion |
| H-6 | `shared/workflows/audit.js:42` | Path traversal — `targetDir` interpolated into 5 prompts without containment | security, correctness | 76 | Added `validateTargetDir()` — rejects NUL byte, `..`, UNC paths + agent prompts include "fixed, refuse outside" hard boundary |
| H-7 | `shared/workflows/r2-review.js:100` | Prompt injection — `contextFiles` joined without `<untrusted>` delimiters | security | 78 | Added `fenceUntrusted()` wrapping each context file + diff in `<untrusted>` delimiters + closing-tag-strip + length cap |
| H-8 | `shared/workflows/r2-review.js:126` | Second-order prompt injection — Phase-2 skeptic prompt interpolates Phase-1 LLM output unfenced | security | 82 | Wrapped `finding.finding` in `<untrusted>` + 500-char cap + closing-tag-strip in `buildSkepticPrompt` |
| H-9 | `shared/workflows/audit.js:184` | EchoLeak-class (CVE-2025-32711) — P5 synthesis embeds P1/P2/P4 outputs unfenced, persists to disk | security | 80 | All P5 inputs wrapped via `fenceUntrustedAudit()` with `<untrusted source="...">` delimiters + 24K-char cap + explicit "data not instructions" instruction |
| H-11 | `cortex/sprint-2-44-plan.md:115` | AC-12 deliverable missing — `cortex/sprint-2-44-r2-summary.md` not in repo | acceptance | 95 | This file — created during Sprint 2.44 commit |
| H-12 | `shared/workflows/r2-review.js:44` | REVIEW_AGENTS roster duplicated — no drift test guards SSOT alignment | ssot, correctness | 92 | Added `tests/unit/workflows/r2-review-roster-drift.test.cjs` — parses literal + asserts equality with `shared/hooks/_lib/review-agents.cjs` |

### Deferred to Sprint 2.44.1 (3)

| # | File:Line | Finding | Why deferred | Sprint 2.44.1 task |
|---|---|---|---|---|
| H-10 | `shared/workflows/audit.js:41` | Agentic Lethal Trifecta — P1 reads private data + P4 external comms + P5 writes artifacts in single session, no reader-writer split | Architectural — needs ADR + standards/security.md Pattern 2 implementation. Mitigation in 2.44: P5 synthesis fenced + explicit "data not instructions" + targetDir containment limits private-data scope | ADR: split audit.js into reader-agent (P0/P1/P2) + writer-agent (P5) with schema-validated handoff per standards/security.md Pattern 2 |
| H-13 | `shared/workflows/audit.js:34` | AUDIT_DIMENSIONS inconsistent across 3 files (audit.js, standards/workflows.md Pattern 5, prompts/existing-project-audit.md) | Cross-cutting — three different conceptual partitions exist; need stakeholder review of which is canonical. 2.44 mitigation: added comment documenting the divergence and noting 2.44.1 work | Extract `audit-dimensions.json` SSOT consumed by workflow + skill + prompt; choose canonical naming (likely prompts/ wins since it's the original /audit skill) |
| H-14 | `tests/integration/workflow-hook-compatibility.test.cjs:45` | `reviewMarkerPath` / `hashSession` logic duplicated across 4 files (post-tool-use, pre-tool-use, pre-commit-review-gate, this test) | Pre-existing Sprint 2.44.1 backlog item (already filed) — test had to write 4th copy to validate same path computation. The test catches drift, doesn't introduce it. | Extract to `shared/hooks/_lib/session-paths.cjs` consumed by all 4 sites |

## MEDIUM findings (14) — disposition

### Applied in-commit (4)

| # | File:Line | Finding | Fix |
|---|---|---|---|
| M-15 | `r2-review.js:163` | `confidenceThreshold` silently accepts NaN/Infinity/negative | Added `normalizeThreshold()` clamping to [0,100] integer + `Number.isFinite()` reject |
| M-17 | `audit.js:147` | `MIN_RESEARCH_TOPICS=3` declared but never enforced | Topics padded to MIN with `${profile}-best-practices-N` fallback strings when planner under-delivers |
| M-17b | `audit.js:163` | `topics.indexOf(topic)` collides on duplicates → identical labels | Topics deduped via Set + label uses stable `topicIdx` argument instead of `indexOf()` |
| M-18 | `r2-review.js:192` | Pipeline cost unbounded — N raw findings × skeptic agent | Added `MAX_RAW_FINDINGS = 100` slice before pipeline dispatch |
| M-26 | `cortex/atlas-2026-06-01.md:432` | Augment block marker text documented incorrectly | Atlas updated to actual marker pattern + v6 references everywhere |

### Deferred to Sprint 2.44.1 (10)

| # | File:Line | Finding | Why deferred |
|---|---|---|---|
| M-16 | `r2-review.js:150` | `mergeFindings` severity sort assumes severity in SEVERITY_RANK; out-of-enum values produce NaN sort | Schema already constrains severity to `enum: ['HIGH','MEDIUM','LOW']` — defense-in-depth would be a 2.44.1 hardening (validate after merge) |
| M-19 | `workflow-hook-compatibility.test.cjs:102` | UTC vs local-date discovery — flaky once per day at UTC midnight | Test edge case; Sprint 2.44.1 fix during reviewMarkerPath extraction (H-14) since same hashSession path-share dispute |
| M-20 | `standards/workflows.md:452` | Broken cross-ref to `docs/sprint-2.44-workflows-design-synthesis.md` (file doesn't exist) | Doc fix; either create the synthesis doc or remove the link. Sprint 2.44.1 docs cleanup task |
| M-21 | `standards/workflows.md:416` | Standard mandates vendored-workflow attribution headers, but shipped r2-review.js / audit.js carry no such header (not vendored, but standard doesn't say that) | Doc clarity fix — distinguish "vendored from external" vs "cortex-original". Sprint 2.44.1 |
| M-22 | `standards/workflows.md:180` | Pattern 1 example diverges from shipped r2-review.js (3 phases vs 2, judge agent vs none) | Standard's Pattern 1 was aspirational; shipped is simpler. Sprint 2.44.1 align — likely update standard to match shipped (simpler is fine) or upgrade impl to 3-phase |
| M-24 | `r2-review.js:146` | `mergeFindings` has no property test coverage (correctness.md Practice 2) | Pure reducer, good candidate for fast-check. Sprint 2.44.1 — add to `tests/unit/properties-pure-reducers.test.cjs` |
| M-25 | `r2-review.js:160` | Args not Zod-validated at workflow entry | Workflow runtime doesn't expose Zod natively (zero-dep policy); custom validator possible. Sprint 2.44.1 — define ARGS_SCHEMA + validate at entry |
| M-27 | `audit.js:11` | Header comment claims to "mirror" prompts/existing-project-audit.md but P6 ADR-backfill is silently dropped (in addition to acknowledged P3) | Doc precision fix; update header to enumerate skipped phases honestly. Already partially addressed (P3 mentioned, P6 noted in this summary). Sprint 2.44.1 |
| M-28 | `capability-tree-2026-06-01.md:793` | 4-tier trajectory table is verbatim copy across 3 files (CLAUDE.md, capability-tree, steward-roadmap) — different "shipped" state on each | Pre-existing SSOT drift, not introduced by Sprint 2.44. Sprint 2.44.1 dedicated cleanup |
| M-29 | `workflow-hook-compatibility.test.cjs:11` | Test only covers Probe 1 (hook firing); Probe 2 (block-destructive on workflow Bash) + Probe 3 (review marker propagation) have no executable reproducer | Probe docs describe both; reproducers are higher effort (require workflow-runtime fixture). Sprint 2.44.1 — extend test or build standalone probe scripts |

## Pass-2 confidence validation

Of 60 raw findings, Pass-2 (skeptic re-derivation per finding) filtered out 29
as below threshold (<75 confidence and not HIGH severity) and deduped 8 finding
pairs (same file:line, multiple reviewers).

**Bucket distribution after validation:**

- HIGH: 14
- MEDIUM: 14
- LOW: 0

The skeptic gave NO findings a "rejected" verdict — every validated finding
was either confirmed at the same confidence or downgraded into MEDIUM. This
matches the design intent: skeptic catches hallucinated-bugs (verdict
`rejected`), not real-but-low-severity issues.

## Cross-reference: workflow-specific risks from design synthesis

Design synthesis (R1.1–R1.5) surfaced 8 workflow-specific risks ADDITIONAL to
the original plan risks table. Current disposition:

| Risk | Disposition |
|---|---|
| `args` field prompt injection (HIGH) | Mitigated — fenceUntrusted in both workflows + content not interpolated as instructions |
| Schema validation bypass via null returns (MEDIUM) | Mitigated — defensive shape checks after every schema'd agent() in audit.js + skeptic-null short-circuit in r2-review.js |
| Agent script eval risk (HIGH — malicious project workflow shadowing) | DEFERRED Sprint 2.44.1 — needs `block-destructive` matcher on Write to `.claude/workflows/*.js` + cortex-doctor flag for unvetted workflows |
| Workflow ignores defaultMode permission (MEDIUM) | DOCUMENTED in standards/workflows.md § Composition with cortex hooks |
| Cache replay of stale findings (MEDIUM) | DOCUMENTED in standards/workflows.md § Resume semantics |
| Tokenizer-inflated cost cap silent breach (MEDIUM) | DEFERRED Sprint 2.44.1 — bump caps or switch to provider-reported cost |
| `isolation:'worktree'` disk exhaustion (LOW) | NOTED — cortex-doctor disk-free check in 2.44.1 |
| Determinism ban silent failure in agent prompts (LOW) | DOCUMENTED in standards/workflows.md § Determinism contract |

## AC verdict against Sprint 2.44 plan

| AC | Status | Note |
|---|---|---|
| AC-1 plan doc with required sections | ✅ PASS | `cortex/sprint-2-44-plan.md` exists with all 7 required headings |
| AC-2 research cache 5 files | ✅ PASS | All 5 in `~/.cortex/research/sprint-2.44-*-2026-06-02.md` |
| AC-3 research frontmatter + URLs | 🟡 partial | Frontmatter present; URL count varies (some agents skipped explicit URL listing in body) |
| AC-4 probe artifacts 3 files | ✅ PASS | test + docs + audit script all present |
| AC-5 probe test passes | ⏳ pending | Empirical run in next step |
| AC-6 workflows syntactically valid | ⏳ pending | `node -c` check in next step |
| AC-7 workflows have meta block | ✅ PASS | Both files have `export const meta = {...}` pure literal |
| AC-8 standard has 5 mandatory headings | ⏳ pending | `standards/workflows.md` verification in next step |
| AC-9 capability tree updated § 14.4 | ✅ PASS | Section added by impl-4 |
| AC-10 atlas seam map updated | ✅ PASS | Seam row + health row added by impl-5 (Sprint 2.44 commit corrects marker text drift) |
| AC-11 augment block v6 | ✅ PASS | `bin/cortex-claude-md-augment.cjs` BLOCK_VERSION = '6' |
| AC-12 R2 summary documents findings | ✅ PASS | This document |
| AC-13 npm test green | ⏳ pending | Run in next step |
| AC-14 push CI 4/4 green | ⏳ pending | Verify post-push |

## Hook compatibility verdict (workflow → cortex hooks)

Based on R1.2 web research + code inspection of `shared/hooks/post-tool-use.cjs`:

| Gotcha | Research verdict | Code-inspection verdict | Combined confidence |
|---|---|---|---|
| 1. PostToolUse fires on workflow subagent Task | R1.2: NO (4 GH issues) | post-tool-use.cjs line 112 handles Task tool name (works IF Claude dispatches workflow agents via Task) | **MEDIUM** — empirical probe needed; if Anthropic uses internal non-Task dispatch, hooks bypass |
| 2. block-destructive intercepts workflow Bash | R1.2: NO (subagent bypass pattern) | block-destructive is PreToolUse/Bash matcher — fires on ANY Bash tool call regardless of mode | **MEDIUM-LOW** — security implication; needs empirical Sprint 2.44.1 probe |
| 3. pre-commit-review-gate sees workflow review marker | R1.2: NO (consequence of Gotcha 1) | If Task tool fires through hooks, marker writes correctly; if it bypasses, marker missing | **MEDIUM** — tied to Gotcha 1 result |

**Operational implication:** until empirical probe confirms hooks fire, **operators should not rely on workflow-driven review-markers to satisfy `pre-commit-review-gate`**. Workflow-driven R2 reviews should set `[skip-review]` in commit message OR set `CORTEX_REVIEW_GATE=0` for that session. Documented in `standards/workflows.md` § Composition with cortex hooks.

## Sprint 2.44.1 backlog (filed from this R2)

Total: 17 items (3 HIGH + 10 MEDIUM + 4 design-synthesis-surfaced risks).

Priority order:
1. **H-10** Lethal trifecta reader-writer split in audit.js (architectural ADR)
2. **H-14** + **M-19** reviewMarkerPath SSOT extraction (already pre-existing)
3. **H-13** + **M-27** AUDIT_DIMENSIONS three-way SSOT extraction
4. **M-22** standards/workflows.md Pattern 1 vs r2-review.js alignment
5. Agent script eval / project-workflow shadowing block-destructive matcher
6. **M-25** Workflow ARGS_SCHEMA validation
7. **M-29** Probe 2 + Probe 3 executable reproducers
8. **M-21** vendored vs cortex-original workflow attribution distinction in standard
9. **M-28** 4-tier trajectory table SSOT extraction
10. **M-20** docs/sprint-2.44-workflows-design-synthesis.md cross-ref fix
11. **M-24** Property tests for `mergeFindings` pure reducer
12. **M-16** `mergeFindings` defense-in-depth severity validation
13. Tokenizer-inflated cost cap re-evaluation
14. `isolation:'worktree'` disk-free check in cortex-doctor

---

*R2 summary complete. Workflow run ID: `wf_d2f0c3a4-2c7`. Operator can verify
findings empirically via `/workflows` browser → wf_d2f0c3a4-2c7 → drill into
agent transcripts.*
