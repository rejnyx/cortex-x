# Sprint 2.44 — cortex × Claude Code Dynamic Workflows Integration

> **Plan-first cortex-goal-style document.** Authored 2026-06-02 before execution.
> Format follows `prompts/cortex-goal.md` template + cortex spec-verifier
> acceptance-criterion kinds (shell / file_predicate / regex / llm_judge / ears_text / read_set).

## Brief

Anthropic shipped **dynamic workflows** in Claude Code (research preview,
v2.1.154+). They're JavaScript scripts that orchestrate subagents at scale —
fan out dozens to hundreds of agents per run, isolate intermediate results
from the conversation context, and resume across pauses. cortex should:

1. **Verify** the runtime is hook-compatible (the 3 gotchas from atlas § 11)
2. **Adopt** workflows as the preferred primitive for high-fan-out tasks
   (R2 pipeline ≥6 agents, multi-stage audits, sibling-repo reads)
3. **Document** when workflows beat Skill/Agent/Steward and when they don't
4. **Compose** them with cortex's existing safety floor (hooks, spec-verifier,
   commit gate)

The work itself is **dogfood** of the new primitive: a single Workflow run
delivers Sprint 2.44 — research + implementation + review in one pipelined
fan-out. This is the integration test.

## Scope

### IN SCOPE (must ship before commit)

| # | Deliverable | Path | Type |
|---|---|---|---|
| 1 | This plan document | `cortex/sprint-2-44-plan.md` | meta |
| 2 | R1 cached research × 5 | `$CORTEX_DATA_HOME/research/sprint-2.44-*.md` | research |
| 3 | Empirical hook-firing test | `tests/integration/workflow-hook-compatibility.test.cjs` | probe |
| 4 | Probe hypotheses document | `docs/sprint-2.44-hook-probes.md` | probe |
| 5 | Compatibility audit script | `tools/workflow-compatibility-audit.cjs` | probe |
| 6 | R2 review pipeline as workflow | `shared/workflows/r2-review.js` | impl |
| 7 | `/audit` as workflow | `shared/workflows/audit.js` | impl |
| 8 | New standard | `standards/workflows.md` | impl |
| 9 | Capability-tree update | `cortex/capability-tree-2026-06-01.md` § 14.4 | impl |
| 10 | Atlas update | `cortex/atlas-2026-06-01.md` § 8 + § 9 | impl |
| 11 | Augment block update | `bin/cortex-claude-md-augment.cjs` heredoc v6 | impl |

### OUT OF SCOPE (Sprint 2.44.1+)

- Installer integration — `cortex-update` sync of `shared/workflows/` → `~/.claude/workflows/`
- `cortex-doctor` workflow registration check
- `pattern_transfer` / `cortex-dream` workflow rewrites
- Workflow-aware `pre-commit-review-gate` (only if probes show marker doesn't propagate)
- `install.sh` / `install.ps1` `INSTALL_NOTES` heredoc update

## R1 — Research before assert

Five parallel research dimensions. Each agent writes findings to
`$CORTEX_DATA_HOME/research/sprint-2.44-<topic>-2026-06-02.md` with frontmatter
(per `standards/web-research.md` — `ttl_days: 60` for API/version-specific,
`365` for patterns). Citations mandatory (URL + accessed-date).

| # | Topic | Why we need it |
|---|---|---|
| R1.1 | Anthropic Workflow tool API surface (meta object, agent/parallel/pipeline semantics, schema validation, isolation flags) | We're authoring 2 workflows + 1 standard; need ground truth |
| R1.2 | Subagent hook lifecycle (do `PreToolUse`/`PostToolUse` fire on workflow-dispatched subagents?) | Determines whether cortex hooks compose with workflows |
| R1.3 | Multi-agent orchestration patterns 2026 (LangGraph, CrewAI, AutoGen vs Anthropic workflows) | Are we adopting the right pattern? |
| R1.4 | Cost economics — workflow vs sequential Agent calls vs single-message multi-Agent dispatch | When does workflow beat alternatives? |
| R1.5 | Anthropic landscape current state (June 2026) — workflows GA status, related primitives (agent teams, skills, sub-agents) | Don't bet on research preview if GA timeline matters |

## DoD — Definition of Done (spec-verifier-compatible acceptance criteria)

Each criterion is **independently verifiable** by an agent or shell. Fail = revert.

### AC-1 — Plan document exists with required sections
- **Kind:** `file_predicate`
- **Check:** `cortex/sprint-2-44-plan.md` exists AND contains headings: `Brief`, `Scope`, `R1 — Research before assert`, `DoD`, `R2 — Review pipeline`, `Risks`, `Rollback`

### AC-2 — Research cache written (5 files)
- **Kind:** `shell`
- **Check:** `ls "$CORTEX_DATA_HOME/research/sprint-2.44-"*"-2026-06-02.md" | wc -l` == 5

### AC-3 — All 5 research files have frontmatter + URL citations
- **Kind:** `regex`
- **Check:** Each research file matches `^---\n.*ttl_days:` AND contains ≥3 `https?://` URLs in body

### AC-4 — Probe artifacts written (3 files)
- **Kind:** `file_predicate`
- **Files:** `tests/integration/workflow-hook-compatibility.test.cjs`, `docs/sprint-2.44-hook-probes.md`, `tools/workflow-compatibility-audit.cjs`

### AC-5 — Probe test passes (or documents specific failure)
- **Kind:** `shell`
- **Check:** `node tests/integration/workflow-hook-compatibility.test.cjs` exit 0 OR test file documents specific failure with reproducer

### AC-6 — Two workflows authored and syntactically valid
- **Kind:** `shell`
- **Check:** `node -c shared/workflows/r2-review.js && node -c shared/workflows/audit.js` exit 0

### AC-7 — Workflows have meta block with name + description + phases
- **Kind:** `regex`
- **Check:** Each workflow matches `export const meta = \{[^}]*name:` AND `description:` AND `phases:`

### AC-8 — New standard exists with mandatory sections
- **Kind:** `file_predicate` + `regex`
- **Check:** `standards/workflows.md` exists AND contains headings: `When to use`, `When NOT to use`, `Composition with cortex hooks`, `Cost economics`, `Authoring patterns`

### AC-9 — Capability tree updated
- **Kind:** `regex`
- **Check:** `cortex/capability-tree-2026-06-01.md` contains `§ 14.4` OR `14.4` AND `dynamic workflows`

### AC-10 — Atlas seam map updated
- **Kind:** `regex`
- **Check:** `cortex/atlas-2026-06-01.md` contains line matching `workflow.*runtime.*hooks` in § 8 (Seam map)

### AC-11 — Augment block heredoc bumped to v6
- **Kind:** `regex`
- **Check:** `bin/cortex-claude-md-augment.cjs` contains `BEGIN cortex-x augment` AND `v6` AND `workflows` keyword

### AC-12 — R2 review pipeline run, all HIGH findings either resolved or documented
- **Kind:** `llm_judge`
- **Check:** Agent reviews `cortex/sprint-2-44-r2-summary.md` and reports: are HIGH severity findings (a) fixed in commit, (b) deferred to backlog with rationale, or (c) marked as false positives? If (c), must include refutation reason.

### AC-13 — npm test green
- **Kind:** `shell`
- **Check:** `npm test` exit 0 (allow ≤ existing 2 pre-existing skips)

### AC-14 — All 4 push CI workflows green
- **Kind:** `shell` (post-push)
- **Check:** `gh run list --branch main --limit 4 --workflow=test.yml --workflow=install-smoke.yml --workflow=no-pii.yml --workflow=capabilities-refresh.yml | grep -v success | wc -l` == 0

## R2 — Review pipeline (mandatory before commit)

Per `standards/coding-behavior.md` Rule 1.5 + `agents/*.md` SSOT. **Six adversarial
reviewers in parallel** (the workflow's Phase 5):

| Agent | Lens |
|---|---|
| `blind-hunter` | Diff only, no context. Catches typos + logic errors. |
| `edge-case-hunter` | Walks every branch. Reports only unhandled cases. |
| `acceptance-auditor` | This plan vs delivery. Scope creep? Missing AC? |
| `security-auditor` | OWASP 8-layer + agentic lethal trifecta + workflow-specific risks (prompt injection in `args`, path traversal in agent file ops) |
| `correctness-auditor` | Trust-boundary validation, property test coverage, eval coverage |
| `ssot-enforcer` | Duplication. review-agents.cjs ROSTER duplicated? Hardcoded paths? |

**Pass-2 confidence-validation** (per Sprint 1 standard): re-derive each
finding via a separate agent → filter < 75 confidence. Catches false positives.

**HIGH findings:** applied in-commit OR explicitly deferred with rationale.
**MEDIUM findings:** documented in `cortex/sprint-2-44-r2-summary.md`.
**LOW findings:** noted, possibly ignored.

## Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| RISK-1 | Workflow runtime doesn't fire `PostToolUse` on workflow subagents → cortex journal blind to workflow tools → `cortex-usage` blind | 30% | Medium | Probe AC-5 verifies empirically. If true, document limitation + Sprint 2.44.1 file ticket with Anthropic. |
| RISK-2 | `block-destructive` doesn't intercept workflow agent destructive Bash | 15% | Critical (security) | Probe verifies. If true, workflow agents inherit allowlist per Anthropic docs but block-destructive is PreToolUse hook on Bash matcher — should fire regardless. Mitigation: document + Sprint 2.44.1 add `STEWARD_HALT`-style sentinel. |
| RISK-3 | `pre-commit-review-gate` doesn't see review marker written by workflow review-agents → workflow-driven commits all blocked | 25% | High | Probe AC-5 verifies. If true, workflow itself can `touch $TMP/cortex-review-<sessionHash>.flag` as the last step. Mitigation: graceful fallback. |
| RISK-4 | Workflow agent writes wrong path | 10% | High | Explicit absolute paths in all agent prompts + acceptance-auditor R2 catches scope drift |
| RISK-5 | R2 finds HIGH findings I can't address in budget | 20% | Medium | Apply in-commit if surgical; defer to Sprint 2.44.1 with explicit rationale; never silent skip. |
| RISK-6 | Workflow tool itself crashes / timeouts mid-run | 5% | High | Resume via `resumeFromRunId`; fallback to sequential Agent calls if unrecoverable |
| RISK-7 | Race condition: 2 agents edit same file in parallel implementations | 5% | High | 1 agent = 1 unique file. Reviewed in plan. No same-file overlap. |

## Rollback

If commit fails the npm test gate OR Sprint 2.44 R2 review surfaces critical
findings I can't address:

1. `git restore --staged .` and `git checkout .` working tree
2. Keep `$CORTEX_DATA_HOME/research/sprint-2.44-*` cached (R1 not wasted)
3. Document failure in `docs/sprint-2-44-postmortem-2026-06-02.md` per
   `standards/correctness.md` Reward Hacking § (root cause + corrective action)
4. Re-plan Sprint 2.44.0.1 with reduced scope

## Authorization

| Required | Status |
|---|---|
| User explicit opt-in to multi-agent orchestration | ✅ explicit ("paralelně web researche + implementace + review pipeline") |
| Workflow tool authorized | ✅ user said "máš autonomní povolení pracovat paralelně jak chceš" |
| Cost concern within bounds | ✅ Max x20 flat sub, "token cost is noise" (memory `user_claude_subscription_max.md`) |
| block-destructive risk check | ✅ no `rm -rf` / `git push --force` / `DROP TABLE` in this sprint |
| pre-commit-review-gate satisfaction | ✅ R2 pipeline Phase 5 writes marker |
| Plan-first protocol followed | ✅ this document |
| Surgical changes discipline | ✅ each agent has explicit path + LOC budget |

## Execution model

**Single dynamic workflow** with 5 phases. The workflow IS the integration
test of the primitive we're documenting:

```
Phase 1 — Research      | 5 agents parallel | ~10 min
Phase 2 — Synthesize    | 1 agent           | ~3 min
Phase 3 — Probes        | 3 agents parallel | ~5 min
Phase 4 — Implement     | 6 agents parallel | ~15 min
Phase 5 — R2 Review     | 6 agents parallel | ~10 min
Phase 5.5 — Pass-2 conf | 1 agent           | ~3 min
                                            -------
                                            ~46 min
```

After workflow returns:

```
Main loop:
  → Run empirical hook-firing probe (Bash tests)
  → Triage R2 findings (apply HIGH in-commit, file MEDIUM as Sprint 2.44.1)
  → npm test green check
  → git commit + push
  → gh run list verify 4/4 CI green
```

**Cost estimate:** ~22 agent calls · ~150-250K output tokens · ~$5-15 list
price. Within budget (Max x20 flat).

## Success criteria summary

✅ All 14 AC pass after commit. CI 4/4 green on push.
✅ Probe verdict: 3-of-3 hook gotchas either confirmed compatible OR documented with workaround.
✅ R2 HIGH findings either applied in-commit or explicitly deferred with rationale.
✅ Capability tree + atlas reflect the new workflow integration.

## Failure modes that abort

- ❌ AC-13 npm test red after implementation → rollback, postmortem
- ❌ AC-6 syntactic invalid workflows → rollback, fix, re-attempt
- ❌ AC-12 R2 finds 5+ HIGH findings → rollback, redesign with smaller scope
- ❌ Probe finds critical hook bypass (RISK-2 confirmed) → defer commit pending Sprint 2.44.1 mitigation

## References

- standards/sprint-pipeline.md — canonical Sprint pipeline (extracted in Sprint 2.46; this plan predates extraction and references it retroactively for traceability)

---

*Plan complete. Ready for workflow dispatch.*
