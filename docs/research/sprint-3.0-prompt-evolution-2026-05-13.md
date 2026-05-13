---
title: Sprint 3.0 R1 — AlphaEvolve-style prompt evolution v0 landscape
date: 2026-05-13
trigger: Sprint 3.0 (Tier 2 moonshot) — scope-down decision needed before v0 ship
status: complete
---

# Sprint 3.0 R1 — Prompt evolution landscape (May 2026)

## TL;DR for v0 scope

**Ship a measurement harness, not a full evolution engine.** Single-prompt champion-vs-challenger A/B over the `recommendation` action_kind, scored against existing 10-rubric eval suite + 3-task held-out validation set, decision rule = (point-estimate Δ ≥ 0.05) ∧ (challenger lower CI > champion mean) ∧ (validation spec_pass_rate non-regression). Defer population search, island models, full DGM-scale generation counts to v1.

**Crucial honesty caveat**: N=10 is well below the published threshold of N≈400–600 for 5% delta detection at 95% confidence. v0 results are *directional signal*, not statistical verdict. The PR body and harness output must say this explicitly.

## Question-by-question synthesis

### 1. AlphaEvolve current state (Google DeepMind, 2025 → 2026)

AlphaEvolve was unveiled May 2025 and received a published May 2026 impact update — now running in production across Google infra (continuously recovers ~0.7% of worldwide compute), genomics (30% variant-error reduction at PacBio), quantum, and commercial pilots. **No official open-source release from DeepMind.** The recognized community reference is **OpenEvolve** (`codelion/openevolve`, Apache 2.0): Python orchestrator with `max_iterations: 1000`, `population_size: 500`, `num_islands: 5`, `exploitation_ratio: 0.7`. Recommended bootstrap is 100–200 iterations on `gemini-2.0-flash-lite` for cost-effective exploration. No cost-per-generation numbers disclosed by DeepMind; OpenEvolve doesn't publish them either.

Sources:
- [AlphaEvolve May 2026 impact (DeepMind)](https://deepmind.google/blog/alphaevolve-impact/)
- [AlphaEvolve arXiv 2506.13131](https://arxiv.org/abs/2506.13131)
- [OpenEvolve HuggingFace writeup](https://huggingface.co/blog/codelion/openevolve)

### 2. Sakana Darwin Gödel Machine (DGM) as of May 2026

Paper `arXiv:2505.22954` (Zhang/Hu/Lu/Lange/Clune, May 2025, revised Sep 2025 + Mar 2026). Headline claim **SWE-bench 20% → 50%** stands in the v3 revision; on Polyglot 14.2% → 30.7%, surpassing Aider's hand-designed agent. No public independent reproduction with full numbers; OpenReview shows accepted/under-review status. The reference impl `jennyzzt/dgm` is live but small-team — iteration is patches-to-its-own-Python with archived lineage (Darwinian), not a clean library.

Sources:
- [Darwin Gödel Machine arXiv 2505.22954](https://arxiv.org/abs/2505.22954)
- [jennyzzt/dgm reference impl](https://github.com/jennyzzt/dgm)

### 3. Production prompt-evolution patterns 2026

(a) **DSPy 2.x** is the live production standard — `MIPROv2` optimizer uses Bayesian optimization over instructions + demonstrations; targeted at chatbots/agents/RAG, not raw prompt-strings. (b) **Langfuse A/B testing** is shipping: label two prompt versions, route traffic randomly, track latency/cost/eval metrics — closest match to cortex-x's "one prompt, two variants, score" need. **LangSmith pairwise queues** do side-by-side run comparison. (c) **No public cost ceilings** disclosed by either vendor for typical A/B runs — operators set their own.

Sources:
- [DSPy MIPROv2 optimizer](https://dspy.ai/learn/optimization/optimizers/)
- [Langfuse A/B testing docs](https://langfuse.com/docs/prompt-management/features/a-b-testing)

### 4. Eval suite size — Aider vs cortex-x's 10 rubrics

Published guidance: detecting a **5% absolute pass-rate delta at 95% confidence + 80% power requires ~400–600 cases per condition**. Practical baselines: 50–200 for regression-on-every-change, 500+ for generalization claims. **10 tasks is insufficient for statistical significance** — it's a smoke-screen, not a verdict. Mitigation: bootstrap CIs + 3–5 trials per case to express uncertainty honestly, and treat v0 results as *directional* until the suite grows.

Sources:
- [Braintrust prompt evaluation guide](https://www.braintrust.dev/articles/what-is-prompt-evaluation)
- [Evaluation-Driven Iteration arXiv 2601.22025](https://arxiv.org/html/2601.22025v1)

### 5. Failure modes to pre-empt

Documented in 2026: **metric overfitting** (prompts exploit eval signals without real gains), **mode collapse** (optimizer converges to single shape, loses novelty), **reward hacking** under multi-step/tool-use, **eval-suite stagnation** (overfit to historical cases). Mitigation: train/validation/test splits, multi-objective scoring, periodic eval refresh.

**cortex-x already mitigates** atomic rollback + spec-verifier 6-kind acceptance criteria (Sprint 1.9/2.18) — a mutated prompt that wins on score but fails `read_set`/`ears_text` verification gets rolled back. The exposure that architecture does *not* solve is **eval-set overfit** — requires a held-out validation set.

Sources:
- [Reward Hacking 2026 guide](https://www.articsledge.com/post/reward-hacking)
- [Evidently AI auto-prompt optimization](https://www.evidentlyai.com/blog/automated-prompt-optimization)

## v0 design recommendation (committed in same commit as this memo)

**Ship a single-prompt mutate→score→commit harness** over the `recommendation` action_kind (lowest blast radius, already runs nightly, already produces structured JSON for spec-verifier). Wire it to the existing 10-rubric eval suite + add a held-out validation set marker (3 of the 10 tasks tagged `validation: true`).

Use **Langfuse-style A/B labeling** (champion vs challenger, 2 variants only, no population) with ≥5 trials per task to compute bootstrap 95% CIs.

Promote a challenger only when **ALL** of:
1. Point-estimate delta ≥ 0.05 (configurable via `--min-delta`)
2. Challenger lower CI bound > champion point estimate
3. Validation-set `spec_pass_rate` does not regress vs champion

Honest framing in CLI output + PR body: "N=10 << N=400 published threshold for 5% delta at 95% confidence. v0 results are directional, not statistical verdict."

## Deferred to Sprint 3.0 v1+

- Population search + island models (OpenEvolve pattern, `num_islands: 5`)
- Genetic-programming mutate operators (crossover, slot-swap, instruction-merge)
- DGM-scale generation counts (1000+ iterations)
- Real-LLM executor wiring (operator-paced; current v0 ships only `mockExecutor`)
- Cross-action_kind generalization (current v0 is `recommendation`-only by recommendation)
- DSPy `MIPROv2` Bayesian optimizer integration
- Eval-suite growth toward N=400 (architectural concern; ad-hoc operator authoring of new evals is fine but distant from statistical threshold)

## Sources

- [AlphaEvolve May 2026 impact (DeepMind)](https://deepmind.google/blog/alphaevolve-impact/)
- [AlphaEvolve arXiv 2506.13131](https://arxiv.org/abs/2506.13131)
- [OpenEvolve writeup](https://huggingface.co/blog/codelion/openevolve)
- [Darwin Gödel Machine arXiv 2505.22954](https://arxiv.org/abs/2505.22954)
- [jennyzzt/dgm reference impl](https://github.com/jennyzzt/dgm)
- [DSPy optimizers](https://dspy.ai/learn/optimization/optimizers/)
- [Langfuse A/B testing](https://langfuse.com/docs/prompt-management/features/a-b-testing)
- [Braintrust eval guide](https://www.braintrust.dev/articles/what-is-prompt-evaluation)
- [Evaluation-Driven Iteration arXiv 2601.22025](https://arxiv.org/html/2601.22025v1)
- [Reward Hacking 2026 guide](https://www.articsledge.com/post/reward-hacking)
- [Evidently AI auto-prompt optimization](https://www.evidentlyai.com/blog/automated-prompt-optimization)
