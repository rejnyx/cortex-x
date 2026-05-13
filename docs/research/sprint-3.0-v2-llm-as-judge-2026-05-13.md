---
title: Sprint 3.0 v2 R1 — LLM-as-judge rubric scoring landscape
date: 2026-05-13
trigger: Sprint 3.0 v1 shipped smoke scoring (response length); v2 needs rubric-driven scoring
status: complete
---

# Sprint 3.0 v2 R1 — LLM-as-judge rubric scoring (May 2026)

## TL;DR

Use **Claude Sonnet 4.6 via OpenRouter as judge**, not deepseek-flash. Different model family from candidates kills self-preference bias (the #1 documented failure mode). Cost: ~$0.68 per 150-call eval-run, negligible vs cortex-x's $25/week cap. Structured-output schema with **CoT-before-verdict + per-item evidence quotes + explicit refusal_detected flag** addresses anchor / halo / moderation biases.

## State of the art May 2026

The 2026 consensus is **structured multi-dimensional decomposition over holistic pointwise scoring**. Rubric judges reach >80% human agreement on well-structured tasks (criterion-separated, calibrated, examples-per-level). Anchoring each score level with a one-line example reduces drift more than any other prompt trick.

Hybrid pipelines are standard — deterministic checks first, rubric judge only on the open-ended residual. cortex-x already matches this via Sprint 2.11 senior_tester_review Phase A→B split.

Sources:
- [Adnan Masood — Rubric-Based Evaluations 2026](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)
- [Monte Carlo — 7 Best Practices](https://www.montecarlodata.com/blog-llm-as-judge/)

## Concrete libraries with reference prompts

- **Promptfoo `llm-rubric`** — closest match, `{reason, score 0-1, pass}` schema with threshold gating
- **Langfuse evaluations** — versioned rubric prompts + judge model registry
- **Braintrust** — production rubric scorers with regression alerting
- **DSPy** — programmatic judges via `dspy.Predict` signatures
- **Arize Phoenix** — already wired into cortex-x via OTLP, ships pre-built evaluators

Sources:
- [Promptfoo llm-rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
- [Langfuse evaluation methods](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)

## Self-bias defenses (5 documented in 2026)

1. **Different family for judge vs candidate** — judge with Claude Sonnet, candidates with DeepSeek
2. **Structured-output forcing** — `response_format: json_object` + deep validator
3. **CoT prefix before judgment** — written reasoning forces consideration before checkbox commitment
4. **Multi-dimensional decomposition** — split rubric into per-criterion sub-judgments (−31.5% self-preference bias measured)
5. **Position-swap discipline** — run A→B and B→A, count only on agreement (applies to pairwise; cortex-x rubrics are unordered checklists, position bias attenuates naturally)

Sources:
- [Quantifying Self-Preference Bias arXiv 2604.22891](https://arxiv.org/html/2604.22891v1)
- [Judging the Judges — bias mitigation survey arXiv 2604.23178](https://arxiv.org/html/2604.23178v1)
- [Sebastian Sigl — 5 Biases That Silently Kill Your Evals](https://www.sebastiansigl.com/blog/llm-judge-biases-and-how-to-fix-them/)

## Cost ceiling math

- cortex-x v2 sizing: 10 tasks × 5 trials × ~3 variants × 1 judge call = **150 judge calls/eval-run**
- Sonnet 4.6 pricing: $3/Mtok in, $15/Mtok out; rubric prompt ~500 in / 200 out → $0.0045/call → $0.68/eval-run
- DeepSeek-flash judge alternative: ~$0.0001/call → $0.015/eval-run (but self-preference bias risk)
- cortex-x weekly cap: $25 (Sprint 1.9.1) → judge eval-runs sit at <3% of cap

## Failure modes specific to rubric-judge (all documented 2026)

- **Halo bias** — judge inflates all checkboxes if response sounds confident → mitigation: require evidence quotes
- **Moderation bias** — judge marks "should have" boxes pass if response politely refuses → mitigation: explicit `refusal_detected` flag, auto-route to operator review
- **Schema drift** — rubric parsing fails on rich markdown → mitigation: response_format: json_object + deep validator (cortex-x's existing llm-judge-schema.cjs pattern)
- **Anchor bias** — first item in checklist dominates → mitigation: CoT reasoning BEFORE booleans
- **Verbosity bias** — longer responses tick more "should have" boxes spuriously → mitigation: require quote evidence (cannot fabricate quotes)

## v2 design recommendation (committed in same commit as this memo)

1. **Judge model**: `anthropic/claude-sonnet-4.6` via OpenRouter (overridable via `STEWARD_EVAL_JUDGE_MODEL` env or `--judge-model` CLI flag). Defends self-preference bias.

2. **Required structured-output schema** (validated by `bin/steward/_lib/eval-judge.cjs:validateJudgeOutput`):

```json
{
  "reasoning": "<≤1000 chars CoT, written BEFORE booleans>",
  "must_have":     [{"id": "<rubric_id>", "pass": bool, "evidence": "<quote ≤200 chars>"}],
  "should_have":   [{"id": "<rubric_id>", "pass": bool, "evidence": "<quote ≤200 chars>"}],
  "must_not_have": [{"id": "<rubric_id>", "violated": bool, "evidence": "<quote ≤200 chars>"}],
  "refusal_detected": bool
}
```

3. **Score recomputation is harness-side, not judge-side**. Judge returns booleans only; `rubric-extractor.scoreFromRubric()` computes the final 0..1 score deterministically from the booleans (judge can't fudge the math). Weights: must_have 1.0, should_have 0.5, must_not_have 1.0 (violations subtract).

4. **Refusal short-circuit**: `refusal_detected: true` → score 0 regardless of booleans.

5. **Soft-fail to v1 smoke** on judge unavailable / parse failure / shape violation. Mirrors `senior-tester-action.cjs` pattern. Captures `judge_error_code` + `judge_unavailable: true` in result row for debugging.

## Deferred to Sprint 3.0 v2.1+

- Multi-judge ensemble (Sonnet + GPT-5 + DeepSeek + majority vote, 3× cost)
- Position-swap discipline (cortex-x rubrics are unordered → low value at v2)
- Calibration suite (operator-labeled gold-standard task to validate judge agreement with humans)
- Judge model rotation per criterion (e.g. security criterion → security-specialized judge)

## Sources

- [Adnan Masood — Rubric-Based Evaluations 2026](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)
- [Monte Carlo — 7 Best Practices LLM-as-Judge](https://www.montecarlodata.com/blog-llm-as-judge/)
- [Promptfoo llm-rubric docs](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
- [Quantifying Self-Preference Bias arXiv 2604.22891](https://arxiv.org/html/2604.22891v1)
- [Judging the Judges survey arXiv 2604.23178](https://arxiv.org/html/2604.23178v1)
- [Sebastian Sigl — 5 Biases](https://www.sebastiansigl.com/blog/llm-judge-biases-and-how-to-fix-them/)
- [Claude Sonnet 4.6 pricing on OpenRouter](https://openrouter.ai/anthropic/claude-sonnet-4.6)
- [Arize — LLM as a Judge primer](https://arize.com/llm-as-a-judge/)
- [Caylent — Comprehensive Guide to LLM Evaluations](https://caylent.com/blog/a-comprehensive-guide-to-llm-evaluations)
- [Langfuse evaluation methods](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)
