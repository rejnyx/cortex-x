# Sprint 2.45 — Living Documentation + `/cortex-sprint` Skill

> Plan-first cortex-goal-style document. Sprint 2.44 validated the workflow
> dogfood pattern + R2 + Pass-2 confidence flow ([`sprint-2-44-r2-summary.md`](./sprint-2-44-r2-summary.md)).
> Sprint 2.45 builds on it: (a) wraps the Sprint-sized integration pattern into
> a reusable `/cortex-sprint` skill so future sprints don't need hand-orchestration,
> (b) auto-maintains cortex documentation (atlas + capability-tree + CLAUDE.md
> stats) via `cortex-doc-regen` so counts/paths stay accurate by construction.

## Brief

Sprint 2.44 demonstrated that one big dynamic workflow (research × N parallel +
synthesize + implement × M parallel + R2 × 6 + Pass-2) is the most efficient
shape for Sprint-sized integration tasks. Operator validated as "extrémně
efektivní" (memory: `feedback_sprint_workflow_dogfood_pattern.md`).

**Two problems remain:**

1. **Manual orchestration friction.** Operator has to manually: write plan doc,
   dispatch workflow, triage findings, write R2 summary, run probes, commit.
   Each Sprint repeats the same ~7-step main-loop flow.
2. **Documentation drift.** Atlas + capability-tree are point-in-time snapshots.
   Counts ("30 standards", "20 CLIs") + paths + LOC drift on every commit;
   today's snapshot becomes stale within 1 week. Sprint 4 productization
   requires trustworthy current docs.

This Sprint solves both — **`/cortex-sprint` skill** wraps the validated flow
into one trigger; **`cortex-doc-regen`** keeps documentation accurate by scanning
filesystem + git + test output and regenerating bounded "state blocks" in atlas
+ capability-tree.

## Scope

### IN SCOPE (must ship before commit)

| # | Deliverable | Path | Type |
|---|---|---|---|
| 1 | This plan document | `cortex/sprint-2-45-plan.md` | meta |
| 2 | `/cortex-sprint` skill | `shared/skills/cortex-sprint/SKILL.md` | impl |
| 3 | Doc regeneration CLI | `bin/cortex-doc-regen.cjs` | impl |
| 4 | Doc regen tests | `tests/unit/tools/cortex-doc-regen.test.cjs` | impl |
| 5 | New standard | `standards/documentation.md` | impl |
| 6 | Atlas state snapshot section | `cortex/atlas-2026-06-01.md` (in-place edit) | impl |
| 7 | Capability tree state snapshot section | `cortex/capability-tree-2026-06-01.md` (in-place edit) | impl |
| 8 | R2 summary | `cortex/sprint-2-45-r2-summary.md` | meta |

### OUT OF SCOPE (Sprint 2.45.1+)

- `cortex-doctor` extension for stale state-block warning (deferred — separate concern)
- Steward `doc_drift` action_kind extension to atlas/capability-tree (deferred — Steward integration)
- Pre-commit hook auto-running `cortex-doc-regen` (deferred — opt-in policy decision)
- Refactoring inline-prose counts (e.g., "30 standards" mid-sentence) to use state-block references (deferred — heavy churn for marginal gain)

## R1 — Research before assert

Four parallel research dimensions. Each agent writes findings to
`$CORTEX_DATA_HOME/research/sprint-2.45-<topic>-2026-06-02.md` with frontmatter
(per `standards/web-research.md`, default `ttl_days: 180` for stable patterns).

| # | Topic | Why we need it |
|---|---|---|
| R1.1 | Living documentation patterns 2026 (Diátaxis · mkdocs · Sphinx auto-doc · rustdoc · Doxygen · TypeDoc) | We're inventing cortex's living-doc convention; ground it in 2026 SoTA, don't reinvent |
| R1.2 | State-block markup conventions (HTML-comment markers vs frontmatter vs hidden YAML vs Markdown extensions) | Picking the right convention matters for diff readability + tooling compat |
| R1.3 | Claude Code skill authoring conventions current state (SKILL.md spec, trigger phrase libraries, skill chaining, AskUserQuestion patterns) | `/cortex-sprint` is a complex orchestration skill — ground it in current best practices |
| R1.4 | Repository auto-scanning patterns (filesystem counting, AST parsing, git introspection, deterministic output for diff stability) | `cortex-doc-regen` does this — must be deterministic (Date.now/Math.random forbidden in workflow scripts is a parallel discipline) |

## DoD — Definition of Done (spec-verifier-compatible acceptance criteria)

### AC-1 — Plan document exists with required sections
- **Kind:** `file_predicate`
- **Check:** `cortex/sprint-2-45-plan.md` exists with headings `Brief`, `Scope`, `R1 — Research before assert`, `DoD`, `R2 — Review pipeline`, `Risks`, `Rollback`

### AC-2 — Research cache written (4 files)
- **Kind:** `shell`
- **Check:** `ls "$CORTEX_DATA_HOME/research/sprint-2.45-"*"-2026-06-02.md" | wc -l` == 4

### AC-3 — `/cortex-sprint` skill exists with required structure
- **Kind:** `file_predicate` + `regex`
- **Check:** `shared/skills/cortex-sprint/SKILL.md` exists AND has frontmatter with `name:`, `description:`, AND body covers: Discovery phase (interactive scope/AC/risks) · Plan artifact generation · Workflow dispatch · Empirical phase · Triage phase · Doc update phase · Status report

### AC-4 — `cortex-doc-regen` CLI exists and is executable
- **Kind:** `shell`
- **Check:** `node bin/cortex-doc-regen.cjs --check` exit code is 0 or 1 (NOT crash), AND `--json` flag emits valid JSON to stdout

### AC-5 — Doc regen tests pass
- **Kind:** `shell`
- **Check:** `node tests/unit/tools/cortex-doc-regen.test.cjs` exit 0

### AC-6 — `standards/documentation.md` exists with policy
- **Kind:** `file_predicate` + `regex`
- **Check:** `standards/documentation.md` exists AND contains headings: `When to use auto-regeneration`, `State block convention`, `Hand-curated vs auto-generated`, `Composition with cortex-doc-regen`

### AC-7 — Atlas state-snapshot section added
- **Kind:** `regex`
- **Check:** `cortex/atlas-2026-06-01.md` contains `<!-- BEGIN state:snapshot -->` AND `<!-- END state:snapshot -->` markers AND a "State snapshot (auto-regenerated)" heading

### AC-8 — Capability tree state-snapshot section added
- **Kind:** `regex`
- **Check:** `cortex/capability-tree-2026-06-01.md` contains `<!-- BEGIN state:snapshot -->` AND `<!-- END state:snapshot -->` markers

### AC-9 — Doc regen actually regenerates when run
- **Kind:** `shell` (empirical probe)
- **Check:** Run `node bin/cortex-doc-regen.cjs` once → snapshot file timestamps; run again → no diff (idempotent). Edit a marker section by hand → run again → marker section restored.

### AC-10 — Doc regen `--check` reports stale on uncommitted state
- **Kind:** `shell`
- **Check:** Tamper with a state block, run `--check` → exit 1 with structured report

### AC-11 — R2 review pipeline run, HIGH findings either resolved or documented
- **Kind:** `llm_judge` (via post-workflow triage)
- **Check:** `cortex/sprint-2-45-r2-summary.md` documents every HIGH finding with disposition (applied / deferred with rationale / refuted with refutation reason)

### AC-12 — npm test green
- **Kind:** `shell`
- **Check:** `npm test` exit 0, ≤ existing 2 skips

### AC-13 — All 4 push CI workflows green (post-push)
- **Kind:** `shell`
- **Check:** `gh run list --branch main --limit 4` shows 4 success states

### AC-14 — `/cortex-sprint` skill is discoverable
- **Kind:** `file_predicate` + path test
- **Check:** Skill SKILL.md has triggers in description AND is in `shared/skills/cortex-sprint/` (auto-discovered by Claude Code skill registry)

## R2 — Review pipeline (mandatory before commit)

Six adversarial reviewers in parallel + Pass-2 confidence validation per
Sprint 2.44 validated flow. Same roster: `blind-hunter`, `edge-case-hunter`,
`acceptance-auditor`, `security-auditor`, `correctness-auditor`, `ssot-enforcer`.

HIGH → applied in-commit OR deferred to Sprint 2.45.1 with rationale.
MEDIUM → documented; apply if surgical.
LOW → noted.

## Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| RISK-1 | `cortex-doc-regen` regen is non-deterministic (random file order, timestamp formatting) | 25% | High | Sort all filesystem reads; use git-extracted timestamps; tests assert idempotency |
| RISK-2 | State-block markers conflict with existing markdown rendering | 15% | Medium | HTML comment syntax `<!-- ... -->` chosen specifically — invisible in all renderers (verified pattern in cortex-claude-md-augment) |
| RISK-3 | `/cortex-sprint` skill scope creep (operator wants more features than 1 sprint can hold) | 30% | Medium | Skill ships MVP: plan + workflow dispatch + minimal triage. Steward integration / pre-commit hook = Sprint 2.45.1 |
| RISK-4 | Workflow runtime bypasses cortex hooks (Sprint 2.44 confirmed) | 100% known | Operational | Use `[skip-review]` in commit message; R2 ran in workflow; documented per Sprint 2.44 |
| RISK-5 | Atlas / capability-tree state-block insertion conflicts with existing structure | 20% | Medium | Implement agent must Read file first, find clean insertion point (after frontmatter, before main content), preserve all existing wisdom verbatim |
| RISK-6 | `/cortex-sprint` discovery questionnaire too long → operator friction | 25% | Low | Cap at 3-5 questions max; defaults baked in (e.g., "use Sprint 2.44 workflow pattern by default") |
| RISK-7 | Doc-regen reads files outside cortex-x repo | 5% | Critical | Path validation: only scan inside repo root; reject `..`, symlinks pointing outside (mirrors Sprint 2.44 audit.js pattern) |

## Rollback

If commit fails npm test OR R2 review surfaces unaddressable findings:
1. `git restore --staged .` + `git checkout .` (preserve research cache)
2. Document failure in `docs/sprint-2-45-postmortem-2026-06-02.md`
3. Re-plan Sprint 2.45.0.1 with reduced scope (skill OR doc-regen, not both)

## Authorization

| Required | Status |
|---|---|
| User explicit opt-in to multi-agent orchestration | ✅ "udělej to celé one workflows" |
| Workflow tool authorized | ✅ "rovnou to otestujeme znova" (validates Sprint 2.44 pattern, dogfood again) |
| Cost concern | ✅ Max x20 flat sub |
| Plan-first protocol | ✅ this document |
| Sprint 2.44 validated pattern carries over | ✅ memory: `feedback_sprint_workflow_dogfood_pattern.md` |
| Workflow hook-bypass operational reality | ✅ documented Sprint 2.44, `[skip-review]` planned |

## Execution model

Single dynamic workflow with 5 phases (Sprint 2.44 validated topology):

```
Phase 1 — Research      | 4 parallel R1 agents       ~8 min
Phase 2 — Synthesize    | 1 design synthesis         ~3 min
Phase 3 — Implement     | 6 parallel implementations ~12 min
Phase 4 — Review        | 6 R2 reviewers parallel    ~10 min
Phase 5 — Confidence    | 1 Pass-2 validator         ~3 min
                                                    -------
                                                    ~36 min
```

After workflow returns (main loop):

```
1. Triage R2 findings → apply HIGH, defer architectural
2. Write sprint-2-45-r2-summary.md from Pass-2 output
3. Empirical probe: run cortex-doc-regen, verify idempotency
4. Run npm test
5. Commit + push (with [skip-review] rationale)
6. Verify 4/4 CI green
```

**Cost estimate:** ~18 agent calls (4+1+6+6+1) · ~150K-200K output tokens ·
~$10-15 list price · Max x20 flat sub absorbs.

## Success criteria summary

✅ All 14 AC pass after commit. CI 4/4 green on push.
✅ `/cortex-sprint` is invocable: typing `/cortex-sprint` triggers the skill.
✅ `cortex-doc-regen` is deterministic and idempotent.
✅ Atlas + capability-tree have state-snapshot sections with `<!-- BEGIN/END -->` markers.
✅ R2 HIGH findings either applied in-commit or explicitly deferred.
✅ Sprint 2.46+ can use `/cortex-sprint` instead of manual orchestration.

## Failure modes that abort

- ❌ AC-12 npm test red after implementation → rollback, postmortem
- ❌ AC-3 `/cortex-sprint` skill missing required structure → rollback
- ❌ AC-9 doc-regen not idempotent → fix or defer to 2.45.0.1
- ❌ R2 finds 5+ HIGH findings I can't address → rollback, smaller scope

## References

- standards/sprint-pipeline.md — canonical Sprint pipeline (extracted in Sprint 2.46; this plan predates extraction and references it retroactively for traceability)

---

*Plan complete. Ready for workflow dispatch.*
