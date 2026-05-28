# Code Review — Parallel Adversarial Pipeline

> **How to use:** Paste this at end of feature work (after commits, before PR/merge). Claude spawns 6 specialized review agents in parallel with DIFFERENTIATED context scoping, then runs a **second confidence-validation pass** that independently re-derives each finding and drops anything below the confidence bar before surfacing. Adversarial by design — each agent sees different info to catch different bugs; the validation pass kills false positives.

---

## Your task

Orchestrate 6 parallel review agents on the current diff. Each has different context scoping on purpose:

| Agent | Context access | Catches |
|-------|----------------|---------|
| **blind-hunter** | Diff ONLY — no project access | Obvious bugs + Rule 1.5 §2/§3 violations (Simplicity, Surgical Changes) visible in diff |
| **edge-case-hunter** | Diff + project read | Unhandled edge cases, boundary conditions |
| **acceptance-auditor** | Diff + PROGRESS.md + specs | Spec drift, scope creep (cite Rule 1.5 §3) |
| **security-auditor** | Diff + standards/security.md | 8-layer defense regressions |
| **correctness-auditor** | Diff + standards/correctness.md | Trust-boundary/validation gaps, invariant/property coverage, reward-hacking |
| **ssot-enforcer** | Diff + config/ + constants | Duplicated constants, labels, schemas |

Scale the set to the diff: doc-only changes can run a 3-agent subset (blind + acceptance + ssot); runtime/security-adjacent diffs run all 6. Proportional, not all-6-always.

Every agent should cite the relevant standard when flagging — including [`standards/coding-behavior.md`](standards/coding-behavior.md) principle numbers (1-4) for behavioral findings.

The DIFFERENTIATED context is the killer feature. Blind Hunter catches bugs that contextual reviewers rationalize away ("oh, that's probably handled elsewhere"). Acceptance Auditor catches drift that security reviewer ignores.

## Step 1 — Gather diff context

```bash
git diff main...HEAD  # or git diff HEAD~1 HEAD for last commit
```

Capture as `DIFF_CONTENT`. Include file list, +/- lines.

## Step 2 — Spawn agents in parallel (SINGLE message with parallel Agent tool calls)

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

Agent 5: subagent_type: correctness-auditor
  Input: diff + path to cortex-x/standards/correctness.md.

Agent 6: subagent_type: ssot-enforcer
  Input: diff + project's config/ + cortex-x/standards/ssot.md.
```

**Output contract (every agent):** emit each finding as `{ severity, claim, file:line, confidence (0-100), evidence }`. `confidence` measures only how sure the agent is that the issue is REAL and introduced by this diff — anchor scale: 0 = likely false positive · 50 = plausible but unconfirmed · 75 = clearly real · 100 = certain. **Confidence is orthogonal to `severity`** (how bad it is, the 🔴🟡🔵 triage axis) — a real typo is high-confidence/low-severity; a maybe-race-condition is high-severity/low-confidence. `evidence` = the one-line proof (the quoted line / the violated rule). These two fields are what Pass 2 validates.

**CRITICAL:** spawn all agents in a SINGLE message with parallel Agent tool calls, not sequentially. This is the pipeline pattern — concurrent by design.

If your environment doesn't have the cortex-x agents registered, fall back to `subagent_type: general-purpose` and pass the agent's SKILL.md content in the prompt.

## Step 2.5 — Pass 2: confidence-validation (kill false positives)

Findings from Step 2 are CANDIDATES, not verdicts. Before triage, validate each one independently — this is what makes the pipeline trustworthy enough to auto-surface (modeled on Anthropic's official `/code-review` two-pass design).

1. **One validator dispatch per non-trivial finding, in parallel** (single message). Give the validator ONLY: the relevant diff hunk + the finding's `claim` + the task/PR intent — **NOT** the originating agent's reasoning. Independent re-derivation avoids anchoring + agreement bias.
2. **Validator checks:** (a) is the claim literally true in the diff? (b) is it INTRODUCED by this diff, not pre-existing? (c) for ssot/standards findings, does the cited rule actually scope this file AND is it violated? (d) is it on the do-NOT-flag list (pre-existing · linter-catchable · pedantic nitpick · silenced via ignore comment · "looks like a bug but is correct")?
3. **Default to REJECT.** The burden is on the finding to prove itself real. Validator returns a fresh `confidence` (0-100) + one-line evidence.
4. **Filter at the "clearly real" anchor (75):** drop any finding whose validated confidence is **< 75**. Surviving findings carry into triage. **Severity floor — never silently drop a critical:** a ship-blocking or security-critical finding that fails validation is NOT discarded; surface it in a separate "⚠️ could not validate — eyeball these" list so a human decides. Silent removal only applies to non-critical findings.
5. **Model tier (cost-asymmetric):** validate correctness / security / edge-case findings with **Opus 4.8** (its honesty gain — ~4× less likely to let flaws pass unremarked — is the whole point of a validator); ssot / acceptance rule-checks can use Sonnet. Prefer a different model family or at least a fresh context from the finder to resist rubber-stamping.
6. **Cost control:** skip Pass 2 for trivial diffs (reuse the "needs review?" gate); cap validators at the finding count; don't validate already-`✅ approved`/clean agents.

Record, for the report, how many candidates each agent raised vs how many survived validation (the gap IS the false-positive rate the pipeline just saved the operator from reading).

## Step 3 — Triage findings

Once all 6 agents return and Pass 2 has filtered the candidates, merge the surviving findings into triage buckets:

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

| Agent | Raised → Validated | Severity (validated) |
|-------|----------|----------|
| blind-hunter | 3 → 2 | 1🔴 1🔵 |
| edge-case-hunter | 5 → 3 | 2🟡 1🔵 |
| acceptance-auditor | 2 → 2 | 1🔴 1🟡 |
| security-auditor | 1 → 1 | 0🔴 1🟡 |
| correctness-auditor | 2 → 1 | 1🟡 |
| ssot-enforcer | 4 → 2 | 0🔴 2🟡 |

(Pass 2 dropped N candidates below confidence 80 — that gap is the false-positive load the operator didn't have to read.)

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

- **All agents in SINGLE message.** Sequential spawn defeats the parallel pipeline.
- **Different context per agent.** The differentiation is the feature.
- **Pass 2 validates before triage.** A finding only reaches the user if an independent validator re-derived it at confidence ≥ 75 (criticals that fail validation are surfaced separately, never silently dropped). Default-REJECT. This is what lets the pipeline auto-surface without drowning the operator in false positives.
- **Triage, don't dump.** 30 findings unfiltered = the user ignores. 5 critical + categorized = action.
- **Cite sources.** Every finding shows which agent surfaced it.
- **No editorial editing.** Pass agent findings through — don't rewrite.

## Anti-patterns

- ❌ Sequential agent spawning (kills parallel pipeline)
- ❌ Running only 1-2 agents "to save time" (differentiated coverage is the point)
- ❌ Skipping Pass 2 and surfacing raw candidates (the false positives erode trust — the whole reason for the validation pass)
- ❌ Giving the validator the finder's reasoning (anchors it into rubber-stamping — pass the claim + diff only)
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
- Pass 2 validation (parallel, per finding): ~1 min
- Total wall-clock: ~3-4 min (parallel, not serial)
- Triage: ~30s
- Present: ~30s

Total: ~4-5 min for a comprehensive 6-agent review + validation pass.

## Philosophy

Single-reviewer bias misses bugs that differentiated reviewers catch. BMAD figured this out: Blind Hunter + Edge Case Hunter + Acceptance Auditor as parallel adversarial pipeline > any single "super reviewer."

cortex-x adds security-auditor, correctness-auditor, and ssot-enforcer for the user's specific principles — then a Pass-2 validator so the operator reads confirmed findings, not raw candidates.

This is 4 minutes of compute that saves 40 minutes of bug-hunting later.
