---
sprint: 2.46
name: Sprint 2.46 — Sprint pipeline hardening (signed r2-verdict + untrusted fencing + pipeline SSOT)
date: 2026-06-03
status: in-progress
owner: cortex-x maintainers
discovery_source: cortex/sprint-2-45-r2-summary.md § Deferred to Sprint 2.45.1 (H-10 + H-11 + H-12)
---

# Sprint 2.46 — Sprint pipeline hardening

> **Operator brief (verbatim):** "tak to otestujeme znova, jaký je další sprint? Použij /cortex-sprint a udělej to fakt kvalitně … Doufám, že v tom skillu je i analýza před vším."
>
> **Discovery (auto-selected, Auto Mode active):** sprint scope = the 3 HIGH items the Sprint 2.45 R2 review deferred to Sprint 2.45.1 (H-10 signed verdict, H-11 untrusted fencing, H-12 pipeline SSOT). These are the deferred items from the most-recent sprint, top of mind, scoped, and they make the FIRST `/cortex-sprint` dogfood (this very sprint) more robust through the operation it performs.

## Goal

Replace the `[skip-review]` commit bypass with a machine-checkable signed R2 verdict artifact, fence operator inputs flowing into the `/cortex-sprint` plan emission step, and extract the canonical Sprint pipeline definition to a single SSOT consumed by skill + standards + future plans. These three deliverables close the architectural HIGH backlog from Sprint 2.45 and remove the load-bearing footgun ("operator MUST validate that R2 was actually executed before tagging this") with structural proof instead of human discipline.

## Deliverables

1. **`bin/steward/_lib/r2-verdict.cjs`** — zero-dep verdict builder + verifier.
   - `buildVerdict({ findings, applied, deferred, refuted, sprintId, workflowRunId, agentRoster, timestamp })` → JSON payload + HMAC signature
   - `verifyVerdict(json, secret)` → `{ ok: bool, reason: string, parsed?: object }`
   - `loadVerdict(rootDir)` → reads `cortex/r2-verdict.json` if present
   - Signature: HMAC-SHA256 over canonicalized JSON (sort keys, no whitespace), secret from `CORTEX_R2_VERDICT_SECRET` env (fallback to host-machine hash for local-dev signature continuity)
   - Schema version field (`schema_version: 1`)
2. **`shared/hooks/pre-commit-review-gate.cjs`** — extend `decide()` with `verdictValid` 6th input.
   - New path: if `cortex/r2-verdict.json` exists AND `verifyVerdict()` returns ok AND verdict's `sprintId`/`workflowRunId` match commit message → ALLOW even without session marker
   - Verdict path is parallel to existing marker path; either satisfies gate
   - Existing escape hatches (`[skip-review]`, `CORTEX_REVIEW_GATE=0`) preserved unchanged
   - Verdict file path resolved against repo root via `git rev-parse --show-toplevel`
3. **`shared/skills/cortex-sprint/SKILL.md`** — 2 surgical additions.
   - Section "Untrusted-input fencing" (mirror `standards/workflows.md § fenceUntrusted` pattern) — every AskUserQuestion answer + free-form paste gets wrapped in `<untrusted source="operator-paste">…</untrusted>` before being interpolated into plan.md
   - Section "Emitting the R2 verdict" — new step 6.5 between Triage and Doc-regen+commit: write `cortex/r2-verdict.json` via `r2-verdict.cjs buildVerdict()`. Commit message references its hash. `[skip-review]` removed as default; kept as documented manual escape hatch.
4. **`standards/sprint-pipeline.md`** — canonical Sprint pipeline SSOT.
   - 7 mandatory headings (mirrors `standards/documentation.md` shape): Pipeline overview / Phase contract / Workflow vs session runtime / Verdict-driven gate / Triage discipline / Doc-regen step / Anti-patterns
   - Single canonical 7-step pipeline definition (Discovery → Plan → Workflow dispatch → Empirical → Triage → Doc-regen + verdict + commit → Status report)
   - SKILL.md, sprint-2-44-plan.md, sprint-2-45-plan.md, and `standards/workflows.md § Sprint orchestration` all REFERENCE this file
5. **`standards/workflows.md`** — replace inline 5-phase listing with reference to `standards/sprint-pipeline.md`.
6. **`shared/skills/cortex-sprint/SKILL.md`** — `[skip-review]` paragraph rewritten as fallback (verdict is primary)
7. **`tests/unit/steward/r2-verdict.test.cjs`** — ≥10 tests covering buildVerdict, verifyVerdict, signature determinism, replay defense (timestamp), schema_version guard, secret-missing fail-closed, tampered-payload reject, sprintId mismatch reject, canonicalization order invariance, empty-findings ok.
8. **`tests/integration/sprint-pipeline-verdict-gate.test.cjs`** — end-to-end: synthesize verdict → stage non-trivial diff → run pre-commit-review-gate.cjs → expect allow with verdict reason. Tampered verdict → expect deny.
9. **`cortex/sprint-2-46-plan.md`** — this file
10. **`cortex/sprint-2-46-r2-summary.md`** — to be written after Review phase
11. **doc-regen** — `node bin/cortex-doc-regen.cjs --apply` (atlas + cap-tree state-snapshot refresh)

## Acceptance criteria

Each criterion is mechanically verifiable per cortex spec-verifier kinds.

- **AC-1** `file_predicate` — `cortex/sprint-2-46-plan.md` exists with 8 required sections (Goal / Deliverables / Acceptance criteria / Workflow phases / Risks / Out of scope / References / Triage policy).
- **AC-2** `file_predicate` — `bin/steward/_lib/r2-verdict.cjs` exists and exports `buildVerdict`, `verifyVerdict`, `loadVerdict`, `canonicalize` (4 named exports).
- **AC-3** `regex` — `bin/steward/_lib/r2-verdict.cjs` contains `crypto.createHmac('sha256'` (HMAC-SHA256 enforcement).
- **AC-4** `regex` — `shared/hooks/pre-commit-review-gate.cjs` `decide()` signature accepts `verdictValid` (renamed: `decide({ ..., verdictValid })`).
- **AC-5** `file_predicate` — `standards/sprint-pipeline.md` exists with 7 mandatory headings (Pipeline overview / Phase contract / Workflow vs session runtime / Verdict-driven gate / Triage discipline / Doc-regen step / Anti-patterns).
- **AC-6** `regex` — `shared/skills/cortex-sprint/SKILL.md` contains `Untrusted-input fencing` heading AND `<untrusted source=` example.
- **AC-7** `regex` — `shared/skills/cortex-sprint/SKILL.md` contains `Emitting the R2 verdict` heading AND references `r2-verdict.cjs`.
- **AC-8** `regex` — `standards/workflows.md` references `standards/sprint-pipeline.md` (and removes inline 5-phase duplicate or marks it as quote-from-SSOT).
- **AC-9** `shell` — `node --test tests/unit/steward/r2-verdict.test.cjs` exits 0 with ≥10 passing tests.
- **AC-10** `shell` — `node --test tests/integration/sprint-pipeline-verdict-gate.test.cjs` exits 0.
- **AC-11** `shell` — `npm test` exits 0 (full suite green; baseline 3290 → expect ≥3300).
- **AC-12** `shell` — `node bin/cortex-doc-regen.cjs --check` exits 0 after `--apply` (idempotency proof).
- **AC-13** `file_predicate` — `cortex/sprint-2-46-r2-summary.md` exists with HIGH/MEDIUM disposition table.
- **AC-14** `shell` — `git push origin main` returns 0 + post-push CI 4/4 green (test + install-smoke + no-pii + capabilities-refresh).

## Workflow phases

Mirror Sprint 2.44 Probe 3 5-phase pattern (Research → Synthesize → Implement → Review → Confidence). One workflow dispatch; phases run in subagent contexts.

| Phase | Scope | Output |
|---|---|---|
| **Research** | 3 parallel R1 dispatches: (a) signed-artifact patterns in CI/CD (HMAC vs Ed25519 vs git-trailers), (b) AskUserQuestion injection landscape + 2026 cortex fencing precedents, (c) pipeline-spec SSOT examples (mkdocs / Sphinx / agentskills.io / OpenInference) | `cortex/sprint-2-46-research.md` (combined) |
| **Synthesize** | 1 agent merges research into concrete implementation plan: HMAC choice + canonicalization spec + fencing delimiter convention + 7-heading sprint-pipeline.md skeleton | Inline plan refinement (output passed to Implement) |
| **Implement** | 4 parallel impl agents: (1) `r2-verdict.cjs` + unit tests, (2) `pre-commit-review-gate.cjs` extension + integration test, (3) `cortex-sprint/SKILL.md` fencing + verdict-emit sections, (4) `standards/sprint-pipeline.md` + cross-ref updates in `standards/workflows.md` + plan backfills | Edits to repo |
| **Review** | 6 R2 reviewers in parallel via cortex review-agent roster: security-auditor / correctness-auditor / acceptance-auditor / ssot-enforcer / blind-hunter / edge-case-hunter | Per-agent JSON findings |
| **Confidence** | Pass-2 skeptic re-derive per finding, filter <75 confidence (unless HIGH), dedupe by file:line | Final triaged list |

Workflow concurrency cap: 16. Workflow agent count budget: ~22 (3 R + 1 S + 4 I + 6 R2 + N skeptic + 1 confidence aggregator).

## Risks (8) — each with mitigation

| # | Risk | Mitigation in this sprint |
|---|---|---|
| R-1 | **Crypto choice debate**: HMAC vs Ed25519 vs detached signature could spin in design loop | Lock HMAC-SHA256 + secret-from-env upfront (v0); explicit out-of-scope: PKI / asymmetric / revocation deferred to Sprint 2.46.1 |
| R-2 | **`pre-commit-review-gate.cjs` regression risk** — existing 3 tests must stay green | Extension is additive (new `verdictValid` input defaults to false); existing decide() behavior unchanged when verdict absent |
| R-3 | **Workflow runtime hook bypass** (Sprint 2.44 Probe 3) — verdict file may not exist when subagent commits | Verdict written by PARENT agent (this main session) AFTER workflow returns, BEFORE commit. Subagents only write code; commit is in main session. |
| R-4 | **Sprint-pipeline.md ↔ SKILL.md drift** — same SSOT problem we're solving could recur | Add drift test: integration test reads pipeline-step count from sprint-pipeline.md + SKILL.md, asserts equality |
| R-5 | **Secret rotation** — HMAC secret in env may not match across operator machines (CI vs local) | Document: secret is host-local; verdict valid only on machine that signed it. CI verifies only structure + schema, not signature, when `CORTEX_R2_VERDICT_SECRET` unset (fail-open with warning). |
| R-6 | **Fencing convention conflict** with `cortex-claude-md-augment` BEGIN/END block markers | Use `<untrusted source="…">…</untrusted>` XML-style delimiter; markedly distinct from cortex `<!-- BEGIN cortex-x … -->` HTML-comment marker syntax |
| R-7 | **Doc-regen captures pipeline-step count** — drift could fire false-positive on every sprint | sprint-pipeline.md is hand-curated (not regen-managed); doc-regen only touches state-snapshot blocks per `standards/documentation.md` contract |
| R-8 | **Section anchors in sprint-pipeline.md must be stable** because plans + SKILL.md + standards/workflows.md reference them | Use simple kebab-case heading anchors (`#phase-contract`, `#verdict-driven-gate`); document anchor stability as standard invariant |

## Out of scope (deliberately not in 2.46)

- **Asymmetric/PKI signatures, revocation, TTL, multi-reviewer attestation chains** — deferred to Sprint 2.46.1 if signed verdict pattern proves useful
- **Sprint 2.44.1 backlog** (lethal trifecta split, AUDIT_DIMENSIONS SSOT, reviewMarkerPath SSOT) — separate sprint
- **AskUserQuestion schema validation** (M-19 from 2.45) — addresses input *shape*, this sprint addresses input *fencing*; orthogonal concerns
- **Eval-style verdict trust scoring** — current binary ok/not-ok is sufficient for v0
- **Web UI for verdict inspection** — JSON file + status CLI is enough
- **Pre-commit-review-gate verdict cache** — re-verify per commit is cheap (< 50ms)

## References

- `cortex/sprint-2-45-r2-summary.md` § Deferred to Sprint 2.45.1 (H-10 / H-11 / H-12) — origin of all 3 deliverables
- `shared/skills/cortex-sprint/SKILL.md` — target of H-10 (verdict emit), H-11 (fencing), H-12 (extract SSOT)
- `shared/hooks/pre-commit-review-gate.cjs` — target of H-10 (verdict-driven allow path)
- `shared/hooks/_lib/review-agents.cjs` — SSOT for REVIEW_AGENTS roster (verdict embeds this)
- `bin/steward/_lib/journal.cjs` — pattern reference for canonicalized JSON + HMAC append-only ledger (precedent inside cortex)
- `standards/workflows.md § Composition with cortex hooks` — current documentation of bypass risk
- `standards/documentation.md` — model for 7-heading standards file shape
- `cortex/sprint-2-44-plan.md`, `cortex/sprint-2-45-plan.md` — plan-shape reference (will gain backfill ref to sprint-pipeline.md)

## Triage policy

- **HIGH severity findings from R2** → apply in-commit. Cap effort at ~15 min per HIGH; escalate if blocked.
- **MEDIUM severity** → apply if surgical (1–2 files, <30 LoC diff, no API change). Otherwise defer with rationale.
- **Architectural / cross-cutting** → defer to Sprint 2.46.1 with one-line task description in r2-summary.md.
- **LOW / informational** → log only; do not act unless operator asks.

---

*Plan finalized 2026-06-03 by `/cortex-sprint` dogfood (FIRST real usage of skill after Sprint 2.45 shipped it). Auto Mode active; discovery answered from R2 backlog without operator interactive Q&A per Auto Mode bias.*
