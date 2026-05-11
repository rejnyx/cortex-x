# Eval Runner — How to actually execute the suite

> The eval suite (`evals/eval-*.md`) defines 10 canonical tasks. This file documents how to run them, score them, and write results. Until an automated runner exists, runs are manual.

## Modes

### 1. Paper baseline (no execution)

Read each eval + the prompt/standard it tests. Predict score based on prompt quality. Write results to `evals/results/<date>-<commit>-paper-baseline.json` with `"type": "paper-baseline"`.

**When useful:** establishing initial baseline without spending hours on real runs. Detects regressions IF subsequent paper baselines on later commits drop scores. Brittle: subjective, does not exercise actual Claude behavior.

**Status:** baseline established 2026-05-01 against `01d9013`. See `evals/results/2026-05-01-01d9013-paper-baseline.json`.

### 2. Manual real execution (preferred)

For each eval:

1. **Set up the test scenario** described in the eval's `## Input` section — empty folder, planted vulnerability, simulated session context, etc.
2. **Open a fresh Claude Code session** at the test scenario root. Fresh = no prior conversation history that could bias the model's behavior.
3. **Paste the prompt** the eval tests (e.g., `~/.claude/shared/prompts/new-project.md`). Provide answers if the prompt asks.
4. **Capture the output** — files written, agents spawned, final report.
5. **Score against the rubric** — go through each `- [ ]` checkbox in `## Expected properties`. Tally must-have / must-not-have / should-have. Apply the `## Scoring rubric` to land on a 0.0–1.0 score.
6. **Record adversarial probe outcomes** — did each probe match the expected answer?
7. **Append the score** to `evals/results/<YYYY-MM-DD>-<commit>.json` (see schema below).

**Per-eval budget:** $0.50–$2.00 depending on whether the eval triggers Phase 2 research. eval-001 (full bootstrap) costs ~$1.50; eval-007 (doctor) costs ~$0.20.

**Total suite cost:** ~$10–$15 per full run. Worth it monthly, not weekly.

### 3. Automated runner (future)

Phase 2 of the eval architecture. Not implemented at commit `01d9013`.

Sketch:
```bash
node ~/.claude/shared/evals/run.js eval-005-code-review-catches-ssot-violation
```

Would:
1. Spawn a sandboxed temp dir with the eval's setup state
2. Use the Anthropic SDK directly (not Claude Code) to send the prompt
3. Capture tool calls + final output
4. Apply the rubric programmatically (where possible) — file existence checks, regex matches, count comparisons
5. Surface the human-judgment portions (e.g., "is this finding well-grounded?") as a follow-up review queue

Until this exists, manual execution is the contract.

## Result file schema (`evals/results/<YYYY-MM-DD>-<commit>.json`)

```json
{
  "date": "2026-MM-DD",
  "commit": "<sha>",
  "type": "paper-baseline" | "real-execution" | "automated",
  "model": "claude-opus-4-7" | "claude-sonnet-4-6" | etc.,
  "evaluator": "maintainer" | "Claude (paper-baseline mode)" | "automated-runner",
  "tasks": {
    "eval-001": {
      "score": 0.0,
      "confidence": "high" | "medium" | "low",
      "notes": "<short explanation of score>",
      "duration_seconds": 0,
      "cost_usd": 0.0,
      "adversarial_probes": {
        "probe-1-text": "PASS" | "FAIL"
      }
    }
  },
  "summary": {
    "total_score": 0.0,
    "max_score": 10.0,
    "percentage": 0.0,
    "delta_from_baseline": "+0.0",
    "delta_from_last": "+0.0"
  },
  "weakest_task": { "id": "...", "score": 0.0, "reason": "..." },
  "strongest_tasks": [{"id": "...", "score": 0.0, "reason": "..."}],
  "next_steps": ["..."],
  "advisory_status": "ADVISORY" | "GATING",
  "schema_version": "1.0"
}
```

## Aider-Polyglot lift discipline (Sprint LR.1.1)

> **Source:** Refact.ai 2025 blog post — Aider Polyglot 76 % → 92.9 % via two harness changes alone. Cited in [`docs/research/cortex-x-sprint-brief-10-5.md`](../docs/research/cortex-x-sprint-brief-10-5.md) §"Aider Polyglot — co tě reálně zajímá pro evals".

The Refact.ai lift came from two protocol invariants, not from a smarter model:

1. **Step limit ≥ 30** — agent gets enough iterations to converge on multi-file fixes (default 15 truncated convergence on ~17 % of tasks).
2. **Test execution before scoring** — agent cannot claim pass without test suite actually green; "I ran the tests in my head" is a non-result.

Both are ENCODED into the runner harness, not asked of the model. They are the spec, not the suggestion.

### Where this applies in cortex-x

| Surface | Status | Mechanism |
|---|---|---|
| **Phase 2 automated runner** (Mode 3 above) | spec only | When built, MUST default `step_limit=30` + reject scoring without `test_executed=true` flag. |
| **Steward action_kinds** (production) | ✅ enforced | `bin/steward/_lib/spec-verifier.cjs` (Phase 6 gate) + `bin/steward/_lib/verifier.cjs::runNpmTest` (Phase 7 gate) — see [`bin/steward/execute.cjs:2315-2342`](../bin/steward/execute.cjs). Atomic rollback if either fails; commit only if both pass. |
| **Steward step-limit equivalent** | ✅ enforced | Multi-window cost caps (`bin/steward/_lib/cost-safety.cjs`) + intra-run StuckLoopDetection (`bin/steward/_lib/loop-detector.cjs`) + cross-session loop detector (Sprint 1.9.1). Bounds iteration count via cost + repetition, not raw step count, but achieves the same convergence-vs-thrash discrimination. |
| **Manual real-execution mode** (above) | ✅ procedural | Step 5 of the protocol requires reading the test outputs in the eval's expected properties before assigning the score. Reviewer is the harness. |
| **Paper baseline mode** (above) | N/A | Predictive only; no agent loop to bound. |

### Implication for the future automated runner

When implementing Mode 3 § "Automated runner (future)", the runner MUST:

- Configure `step_limit` per task with a `MIN_STEPS = 30` floor.
- Refuse to write a `score` to the result file unless the run record contains `test_executed: true` AND `test_exit_code: <number>`.
- Surface `step_count_exceeded` as a distinct outcome from `score_below_threshold` — confusing the two is what Refact.ai's pre-fix harness did.

These are non-negotiable defaults. Operators can opt OUT per task with an explicit `harness_override:` block + rationale, but never silently.

## Cadence

Per `prompts/cortex-evolve.md` § Phase C (Monthly Refinement):
- **Monthly** — full suite run. Compare delta vs prior month. Investigate regressions ≥5%.
- **Per-PR** — only if the PR touches a prompt or standard a specific eval covers. Run JUST that eval, not the suite.
- **Pre-tag** — full suite + manual review of weakest 3 tasks before any `v*` tag.

Do NOT run the suite per-commit (cost + noise per `evolve.yaml` anti-patterns).

## Gating policy

**Until 3+ real-execution runs accumulate**, all results are `ADVISORY`. PR merges are NOT blocked on eval scores. The paper baseline establishes a reference; real runs build the calibration.

After 3+ runs:
- A task scoring ≤ baseline − 0.10 on a PR-touching commit = `GATING`. Merge blocked until investigation or rubric recalibration.
- Calibration drift (rubric is wrong, not the prompt) is acceptable as long as it's documented.

Until then, treat results as feedback signals, not hard gates.

## Manual execution priority order

If running a partial suite, prioritize by canary value:

1. `eval-002` (BAIL flow) — weakest paper baseline; field-test discipline canary
2. `eval-010` (evolve min-support) — highest stakes; framework-honesty canary
3. `eval-005` (SSOT violation) — Rule 1 enforcement canary
4. `eval-006` (security) — Rule 2 Critical canary
5. `eval-001` (full scaffold) — happy path; should pass solidly
6. `eval-003`, `eval-007`, `eval-009` (scan, doctor, retro) — secondary canaries
7. `eval-004`, `eval-008` (sync, sprint-status) — high-confidence; verify last

## Anti-patterns

- ❌ Running the suite from inside an active dev session (cached state pollutes output)
- ❌ Scoring without reading the eval's full rubric (skip-reading inflates scores)
- ❌ Reusing one Claude session across multiple evals (prior context biases later ones)
- ❌ Running paper baseline only and treating it as ground truth (it's a reference, not a measurement)
- ❌ Hiding regression deltas (record honest scores even when they hurt)

## When eval suite is itself broken

If 3+ tasks score ≤0.5 with confidence "high" but you suspect the rubrics are wrong (not the prompts), do NOT update prompts to chase scores. Update the rubrics, document the recalibration in the next results file (`"recalibration_notes": "..."`), and re-baseline.

The eval suite serves the framework, not the other way around. Don't optimize for the rubric; optimize for the field-tested behavior the rubric was approximating.
