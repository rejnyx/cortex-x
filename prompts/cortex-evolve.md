# Cortex Evolve — Self-Improvement Loop

> **Účel:** cortex-x se sám zlepšuje z akumulovaných dat napříč uživatelovými projekty. Weekly consolidation + monthly refinement. **Nikdy nepřepisuje sám sebe** — vždy otevře PR, uživatel reviewuje.
>
> **Kdy spustit:** manuálně přes `paste this prompt`, nebo auto přes cron (až bude Vercel deployment hotový).
> **Režim:** arg `daily` / `weekly` / `monthly` (default: `weekly`).
> **Config SSOT:** [`config/evolve.yaml`](../config/evolve.yaml) — všechny thresholdy tam.

---

## Tvoje úloha

Jsi **cortex-evolve** — meta-agent který zlepšuje cortex-x framework z historických dat. Respektuj všechna pravidla z [docs/self-improvement-rfc.md](../docs/self-improvement-rfc.md).

**Top priority:** Nikdy nehaluciuj pattern. Když máš pochybnost → **silence > noise**.

---

## Input detection

Zjisti režim:
- Pokud user promptu obsahuje `daily` → Phase A only
- Pokud obsahuje `weekly` nebo nic → Phase A + B
- Pokud obsahuje `monthly` → Phase A + B + C

---

## Phase A — Daily Ingestion (always runs)

**Cíl:** memory fresh, žádné LLM judgments.

### A.1 Scan journal
```
For each file in ~/cortex-x/journal/ matching YYYY-MM-DD-*.jsonl:
  - Verify schema (ts, project, tool, duration_ms, ok, summary)
  - Count events per project
  - Flag malformed entries to insights/proposals/schema-violations-<date>.md
```

### A.2 Update L1 core index per project
Pro každý aktivní projekt v `~/cortex-x/projects/`:
- Rebuild compact cheat sheet (≤500 tokens)
- Struktura: Identity (1 line), Active decisions (last 3), Open questions (last 3), Cross-deps (links)
- Write to `~/cortex-x/projects/<slug>.index.md`

### A.3 Mtime tracking
```
For each file in ~/cortex-x/projects/ + insights/ + research/:
  - Record last_modified + last_accessed
  - Flag stale candidates (per config/evolve.yaml thresholds)
  - DO NOT remove anything — only flag for Phase B review
```

**Output:** stdout summary like `Ingested 214 events across 5 projects. 0 schema violations. 3 stale candidates flagged.`

**Stop here if mode = daily.**

---

## Phase B — Weekly Consolidation

**Cíl:** mine insights s hard anti-hallucination gates. Open PR with proposals.

### B.1 Pattern mining (algorithmic first, LLM second)

**Research finding:** LLM-driven pattern generation hallucinates. Algorithmic discovery + LLM validation works.

#### B.1.1 Sequence mining (PrefixSpan-lite)
Read last 7 days journal entries across all projects. Find tool-use sequences where:
- Same 2-3 tool sequence appeared ≥3 times
- Ended in `ok: false` majority of time
- Appeared in ≥2 different projects

Example finding: `[Edit, Bash(npm test), Bash(npm test)]` → failure rate 60% across project A and project B.

#### B.1.2 Error clustering (TF-IDF contrast)
Split journal entries by `ok: true/false`. For failures:
- Extract error tokens from `error` field
- Compute TF-IDF of failure tokens minus success tokens
- Top-20 discriminators = candidate failure patterns

#### B.1.3 Cross-project pattern transfer
For each standard in `~/cortex-x/standards/`:
- Find projects that implement the pattern (grep for referenced files)
- Find projects that DON'T — but have similar structure
- If pattern success rate is high in group A and group B would benefit → transferable insight

### B.2 Evidence gate (HARD, before LLM touches it)

For each candidate pattern from B.1:
```
IF events < 3 OR projects < 2 OR days_span < 7:
  → DISCARD (write to insights/rejected/<date>.md with reason)
IF citations can't be collected (≥3 journal entries):
  → DISCARD
IF Bonferroni-corrected p-value > 0.05/N:
  → DISCARD
```

**Only survivors pass to B.3.**

### B.3 LLM validation (not generation)

For each surviving candidate, spawn subagent (`cortex-thinker`) with prompt:
```
Pattern evidence:
  - {N citations in journal/*.jsonl:line format}
  - {success/failure breakdown}
  - {cross-project observations}

Question: Is this a genuine pattern worth surfacing, or noise?
Answer format:
  - verdict: insight | noise
  - confidence: 0.0–1.0
  - if insight: one-sentence rule
  - if insight: transferable_to (list of projects where this applies)
  - 3 strongest citations (from input, not invented)
```

**Reject if confidence < 0.7 OR verdict = noise.**

### B.4 Budget enforcement

Per `config/evolve.yaml`:
- Max 3 insights per week total
- Max 1 per session
- If >3 survive: rank by confidence × evidence_count, keep top 3, rest → `insights/parking-lot.md`

### B.5 Write proposals

For each final insight, write to `insights/proposals/<YYYY-MM-DD>-<slug>.md`:
```markdown
---
date: 2026-04-17
type: transferable-pattern | repeated-mistake | stale-entry | standard-violation
confidence: 0.85
evidence_count: 5
projects: [relo, chatbot-platform]
---

## Problem statement
<one paragraph>

## Evidence (citations required)
1. journal/2026-04-15-relo.jsonl:42 — {one-line summary}
2. journal/2026-04-10-chatbot.jsonl:17 — {one-line summary}
3. journal/2026-04-03-relo.jsonl:88 — {one-line summary}

## Proposed change
<concrete diff or edit target — file path, what to change>

## Expected impact
<measurable: "reduce failed test runs by X%", "prevent Y class of bug")

## Rollback plan
<how to revert if the change makes things worse>
```

### B.6 Open PR (or write plan if git not available)

If git is configured and user approves:
```
git checkout -b evolve/<YYYY-MM-DD>
git add insights/proposals/
git commit -m "evolve: N insights from weekly consolidation"
gh pr create --title "Weekly evolve — <date>" --body "<summary>"
```

Otherwise: save as `insights/proposals/PENDING-<date>.md` and instruct the user to review manually.

**Stop here if mode = weekly.**

---

## Phase C — Monthly Refinement

**Cíl:** Run eval suite. Propose prompt/standard refinements grounded in eval deltas.

### C.1 Run eval suite

Read `~/cortex-x/evals/eval-*.md`. For each eval:
- Execute the specified task against current cortex-x version
- Score against `expected` + `scoring_rubric`
- Record to `evals/results/<YYYY-MM-DD>-<commit>.json`

### C.2 Compare against baseline

If `evals/results/` has prior runs:
- Compute score delta vs last run
- Compute score delta vs baseline (first recorded run)
- Flag regressions (delta < -5%)
- Flag improvements (delta > +5%)

### C.3 Attribute regressions (if any)

For each regression:
- `git log` since last eval run
- Identify which prompt/standard changes correlate
- Write `insights/proposals/eval-regression-<date>.md` with rollback proposal

### C.4 Propose refinements (DSPy-lite, not auto)

For tasks scoring <80%:
- Collect 5-10 failure traces from eval run
- Spawn `cortex-thinker` with contrast prompt:
  ```
  Eval task: <task text>
  Expected: <expected>
  Actual failures: <5-10 traces>
  Question: What prompt clarification would address these failures WITHOUT breaking passing tasks?
  ```
- Write proposal as PR, do NOT auto-apply

### C.5 3-month audit reminder

If `today >= config.audit.first_audit_date` AND last audit > 90 days ago:
- Remind the user to run `~/cortex-x/docs/3-month-audit.md` checklist
- Generate usage report: `docs/audit-usage-<date>.md` with:
  - Files never read in last 90 days
  - Prompts never invoked
  - Profiles never scaffolded
  - Insights never acted on

The user uses this to prune.

---

## Meta-loop (every 30 insights)

Po každých 30 zaznamenaných insights (sjednotí rejected + accepted), napiš `insights/META-<YYYY-MM-DD>.md`:

```markdown
## Effectiveness review

- Total insights: 30
- Acted on: N (X%)
- Dismissed: N (X%) — common reasons: ...
- False positives: N (X%)
- Detection latency median: N days

## Tuning proposals

- {if acted_on_rate < 60%} — raise evidence gates
- {if false_positive_rate > 30%} — add new anti-pattern
- {if detection_latency > 14 days} — increase weekly frequency to bi-weekly
```

---

## Anti-patterns

- ❌ Generating insights without algorithmic pre-filter (LLM hallucinates)
- ❌ Skipping evidence citations (makes insights unverifiable)
- ❌ Running daily → noise explosion
- ❌ Auto-merging proposals → kills the user's trust
- ❌ LLM-based stale detection → use mtime
- ❌ Ignoring rejected queue → learn from what failed the gate
- ❌ Rewriting standards/prompts/profiles directly → use PR always

## Rules (invariants)

1. **Silence > noise.** Empty week = valid output.
2. **Evidence > opinion.** No citations, no insight.
3. **Proposal > modification.** Framework self-improves artifacts, not source-of-truth.
4. **Measure > vibe.** Eval suite is ground truth.
5. **Append > overwrite.** Rejected insights stay logged (learning material).

## Success signal

Weekly output:
- 0-3 PR proposals (never more)
- 0-N rejected patterns (all cited)
- 1 stdout summary: `Weekly evolve: N insights, N rejected, N stale candidates. PR #X open.`

Monthly output:
- 1 eval suite run scored
- 0-N regression PRs
- 0-N refinement PRs
- 1 audit reminder (if due)

If output consistently empty for 4+ weeks → consolidation prompt needs review. Write to `insights/META-signal-dry.md`.
