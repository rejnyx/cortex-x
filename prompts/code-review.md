# Code Review — Parallel Adversarial Pipeline

> **How to use:** Paste this at end of feature work (after commits, before PR/merge). Claude spawns 5 specialized review agents in parallel with DIFFERENTIATED context scoping. Adversarial by design — each agent sees different info to catch different bugs.

---

## Your task

Orchestrate 5 parallel review agents on the current diff. Each has different context scoping on purpose:

| Agent | Context access | Catches |
|-------|----------------|---------|
| **blind-hunter** | Diff ONLY — no project access | Obvious bugs + Rule 1.5 §2/§3 violations (Simplicity, Surgical Changes) visible in diff |
| **edge-case-hunter** | Diff + project read | Unhandled edge cases, boundary conditions |
| **acceptance-auditor** | Diff + PROGRESS.md + specs | Spec drift, scope creep (cite Rule 1.5 §3) |
| **security-auditor** | Diff + standards/security.md | 8-layer defense regressions |
| **ssot-enforcer** | Diff + config/ + constants | Duplicated constants, labels, schemas |

Every agent should cite the relevant standard when flagging — including [`standards/coding-behavior.md`](standards/coding-behavior.md) principle numbers (1-4) for behavioral findings.

The DIFFERENTIATED context is the killer feature. Blind Hunter catches bugs that contextual reviewers rationalize away ("oh, that's probably handled elsewhere"). Acceptance Auditor catches drift that security reviewer ignores.

## Step 1 — Gather diff context

```bash
git diff main...HEAD  # or git diff HEAD~1 HEAD for last commit
```

Capture as `DIFF_CONTENT`. Include file list, +/- lines.

## Step 2 — Spawn 5 agents in parallel (SINGLE message with 5 Agent tool calls)

Use the Agent tool with these subagent_type values (cortex-x agents):

```
Agent 1: subagent_type: blind-hunter
  Input: ONLY the diff. NO other context.

Agent 2: subagent_type: edge-case-hunter
  Input: diff + project root path for context lookups.

Agent 3: subagent_type: acceptance-auditor
  Input: diff + path to PROGRESS.md + any specs.

Agent 4: subagent_type: security-auditor
  Input: diff + path to cortex-x/standards/security.md.

Agent 5: subagent_type: ssot-enforcer
  Input: diff + project's config/ + cortex-x/standards/ssot.md.
```

**CRITICAL:** spawn all 5 in SINGLE message with 5 parallel Agent tool calls, not sequentially. This is the pipeline pattern — concurrent by design.

If your environment doesn't have the cortex-x agents registered, fall back to `subagent_type: general-purpose` and pass the agent's SKILL.md content in the prompt.

## Step 3 — Triage findings

Once all 5 agents return, merge their findings into triage buckets:

### 🔴 Critical — must fix before merge
- Security critical from security-auditor
- Bugs from blind-hunter at severity "ship-blocking"
- Missing criteria from acceptance-auditor
- SSOT violations that will cause drift

### 🟡 Important — address or justify
- Unhandled edge cases from edge-case-hunter
- Scope creep from acceptance-auditor
- Medium-severity security issues
- SSOT extractions at Rule of Three

### 🔵 Nitpick — fix if easy
- Style consistency
- Minor improvements
- Advisory items

### ✅ Approved by all agents
- Items where all agents returned clean

## Step 4 — Present to the user

```markdown
# Code Review Report — <date>

## Diff summary
- <N> files changed, <X> +<Y> -<Z> lines
- Commits: <list>

## Triage

### 🔴 Critical (<count>)
1. **[security-auditor]** <finding> — `file:line`
2. **[acceptance-auditor]** <finding> — `file:line`
...

### 🟡 Important (<count>)
1. **[edge-case-hunter]** <finding>
2. **[ssot-enforcer]** <finding>
...

### 🔵 Nitpick (<count>)
...

## Agent coverage

| Agent | Findings | Severity |
|-------|----------|----------|
| blind-hunter | 3 | 1🔴 2🔵 |
| edge-case-hunter | 5 | 3🟡 2🔵 |
| acceptance-auditor | 2 | 1🔴 1🟡 |
| security-auditor | 1 | 0🔴 1🟡 |
| ssot-enforcer | 4 | 0🔴 3🟡 1🔵 |

## Verdict
- 🔴 **Cannot merge** — <count> critical findings
- 🟡 **Merge with caveats** — <count> important findings to address
- ✅ **Ready to merge** — all green

## Suggested next actions
1. Fix <critical finding 1>
2. Decide on <important finding 1> (fix or justify)
3. Consider <nitpick> at leisure
```

## Step 5 — Offer follow-up

Ask the user:

```
Chceš abych:
1. Fixnul critical issues teď?
2. Vytvořil GitHub issues pro každou kategorii?
3. Commitnul fixy jako "fix: code review findings"?
4. Přidal insight do $CORTEX_DATA_HOME/insights/ když je vzorec?
```

## Rules

- **5 agents in SINGLE message.** Sequential spawn defeats the parallel pipeline.
- **Different context per agent.** The differentiation is the feature.
- **Triage, don't dump.** 30 findings unfiltered = the user ignores. 5 critical + categorized = action.
- **Cite sources.** Every finding shows which agent surfaced it.
- **No editorial editing.** Pass agent findings through — don't rewrite.

## Anti-patterns

- ❌ Sequential agent spawning (kills parallel pipeline)
- ❌ Running only 1-2 agents "to save time" (differentiated coverage is the point)
- ❌ Overwriting findings with orchestrator's opinion
- ❌ No triage (dumping all findings without severity)
- ❌ Re-running review on unchanged code (waste)

## When to run

- Before merging feature branch → main
- After major refactor
- Weekly on long-lived branches
- Before demo / deploy
- On request: `/code-review` or paste this prompt

## Time budget

- Agent parallel spawn: ~30s startup
- Each agent runs ~1-2 min
- Total wall-clock: ~2-3 min (parallel, not 10 min serial)
- Triage: ~30s
- Present: ~30s

Total: ~3-4 min for comprehensive 5-agent review.

## Philosophy

Single-reviewer bias misses bugs that differentiated reviewers catch. BMAD figured this out: Blind Hunter + Edge Case Hunter + Acceptance Auditor as parallel adversarial pipeline > any single "super reviewer."

cortex-x adds security-auditor and ssot-enforcer for the user's specific principles.

This is 4 minutes of compute that saves 40 minutes of bug-hunting later.
