# Research memo — long-running autonomy + subagent specialization

**Date:** 2026-05-10
**Author:** Research-only sweep for next-development planning
**Scope:** Q1 long-running session frameworks · Q2 subagent specialization · Q3 cortex-x fit
**Operating principles anchor:** R1 research-before-implement · R2 review-pipeline-mandatory · R3 one-class=one-defense+regression · R4 cost-ceiling preserved · R5 no human-only edits become Steward-able · R6 backward-compat by default

---

## 1. Executive summary

- **No production framework today reliably runs 10+ hours unattended.** Anthropic's own measured 99.9th-percentile Claude Code turn is **~45 min** (Oct 2025 → Jan 2026 doubling), with METR's lab benchmark of "5-hour human-equivalent at 50% success" cited as a *theoretical* ceiling, not a *practical* one. ([Anthropic measuring-agent-autonomy](https://www.anthropic.com/news/measuring-agent-autonomy))
- **Externalizing memory to files is the universal pattern.** Manus uses a virtual FS; Anthropic's own scientific-computing case-study uses `CLAUDE.md` + `CHANGELOG.md` as "portable long-term memory"; Ralph Loop keeps `prd.json` + `progress.txt` outside context. cortex-x already does this (journal + lessons) — keep going.
- **Loop detection is now table-stakes.** pydantic-deep v0.3.8's `StuckLoopDetection` ships 3 patterns (identical-calls / A-B-A / no-op) with default threshold 3 and `warn`/`error` modes. cortex-x already has cross-session same-criterion detection (5x/7d) — needs the *intra-run* variant.
- **Cheap-first model routing is the cost lever.** Industry data: tiering cuts 40-60% on multi-agent workflows. cortex-x has the engine seam (`mock`/`openrouter`/`claude-sdk`) but no router across action_kinds yet — Sprint 2.4 (claude-cli engine) was already flagged COST PIVOT.
- **Subagents save context but burn ~7x tokens.** Multiple 2026 sources converge on this number. Inline-first, isolate-only-when-discardable is the senior pattern.

---

## 2. Q1 findings — long-running session frameworks

### State of the art (May 2026)

| System | Practical session cap | Memory strategy | Resume after crash |
|---|---|---|---|
| **Claude Code Auto Mode** | ~45 min p99.9 (5h limit doubled May 2026); reports of "context loss after 2h" | `CLAUDE.md` + compaction (server-side, beta on Opus 4.7/4.6 + Sonnet 4.6) | Routines (preview); no first-class checkpoint |
| **Devin (Cognition)** | "Hours" claimed; parallel-Devin VMs; recurring sessions maintain state | Per-VM isolation, state-between-runs | Yes — recurring-session state persistence |
| **Manus** | "Multi-hour background tasks" marketed | Virtual file system, files-as-memory, episodic checkpoints | Yes — cloud FS outlives session |
| **Codex CLI** | `/goal` workflow (give objective, walk away) | Cloud containers survive disconnect | Pause/resume via /goal |
| **Aider** | Single-task focus, "doesn't orchestrate 40 files" | Git-first auto-commits per change | Git history is the checkpoint |
| **LangGraph 2.0** | Persistence layer = reference design for resumable | Typed checkpoints | Yes — durable state machine |

Sources: ([thoughts.jock.pl harness 2026](https://thoughts.jock.pl/p/ai-coding-harness-agents-2026)), ([InfoQ Claude Code Auto Mode](https://www.infoq.com/news/2026/05/anthropic-claude-code-auto-mode/)), ([Manus how it works](https://www.revolutioninai.com/2026/04/how-manus-ai-works.html)), ([Anthropic long-running scientific-computing](https://www.anthropic.com/research/long-running-Claude)).

### Context management

- **Compaction (Anthropic, beta 2026):** server-side summarization, 5-min default cache + 1-hour-TTL option (2× write-cost). Cache reads 0.1× base. ([prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))
- **Workspace-isolated caches** since Feb 2026 — relevant for multi-tenant Steward.
- **Files-as-memory (universal):** Manus + Anthropic scientific-computing + Ralph Loop all use external files; the model writes intermediate results, reads them next iteration. cortex-x's journal already follows this.
- **Don't break the cache (arXiv 2601.06007):** appending-only patterns retain cache; mid-context edits invalidate, forcing re-pay. Steward's prompt builder should append-only when possible.

### Unstuck patterns

- **StuckLoopDetection (pydantic-deep 0.3.8):** identical-calls / A-B-A / no-op, threshold-3 default, ModelRetry with "try a different approach" message. ([Medium StuckLoopDetection](https://medium.com/@kacperwlodarczyk/stuckloopdetection-how-we-stopped-an-agent-burning-12-on-47-identical-calls-a12b5ea1f193))
- **Circuit-breaker baseline:** 3 retries · 60s cooldown · 50 actions/session cap · $-threshold kill. ([cipherbuilds 4 patterns](https://cipherbuilds.ai/blog/ai-agent-crash-recovery-patterns))
- **Plan-mode nudge (Codex /goal):** agent stops at checkpoints to confirm direction, surfaces "action-required" via terminal-title. Pattern: explicit pause-and-confirm beats "I'll just keep trying."
- **Anthropic measured behavior:** Claude asks for clarification 2× more on complex tasks. Self-pause is real and measurable, not just instructed. ([Anthropic autonomy research](https://www.anthropic.com/news/measuring-agent-autonomy))

### Cost control for multi-hour runs

- **Model tiering:** cheap for triage/routing, frontier for reasoning → 40-60% reduction. ([MindStudio multi-model routing](https://www.mindstudio.ai/blog/ai-agent-token-cost-optimization-multi-model-routing))
- **Token cost is 20-40% of fully-loaded cost** (rest = retry waste, orchestration, review). Capping just $/run misses the rest. ([Augment Code build-vs-buy](https://www.augmentcode.com/tools/multi-agent-orchestration-platforms-build-vs-buy))
- **Subagents = ~7× tokens** vs single-thread. Use for parallel/discardable, not as default. ([Nimbalyst subagents guide](https://nimbalyst.com/blog/claude-code-subagents-guide/))

### Checkpoint/resume

- **LangGraph** is the reference: pause node, save state (vars + tool outputs + dialogue), resume identically.
- **Restate** durable-loops: wrap the step, runtime persists inputs+results, agent picks up after restart, framework-agnostic.
- **Anthropic scientific-computing case:** SLURM 48h allocations + tmux + git-commit-per-unit. Sessions span "days," resume = git checkout + re-read CLAUDE.md.

---

## 3. Q2 findings — subagent specialization

### Production decomposition (2026 consensus)

- **Operator/orchestrator pattern dominant:** main agent owns plan + integration; specialists are bounded, single-result, isolated-context. ([developersdigest 2026 playbook](https://www.developersdigest.tech/blog/claude-code-agent-teams-subagents-2026))
- **Common roles:** code-reviewer · test-writer · security-auditor · researcher · coordinator. Each: focused prompt, scoped tool list, single deliverable. ([Nimbalyst](https://nimbalyst.com/blog/claude-code-subagents-guide/))
- **Planner / executor / verifier triad:** plan owned by orchestrator, execution per-subagent bounded changeset, verify = tests+lint after every meaningful change. ([MindStudio 5 patterns](https://www.mindstudio.ai/blog/claude-code-agentic-workflow-patterns))

### When to spawn

| Spawn subagent | Inline (main thread) |
|---|---|
| Parallel exploration | Tightly coupled state |
| Heavy/discardable context | Trivial tasks (startup overhead > value) |
| Genuinely isolated tool-set | Token-constrained run |

### Anti-patterns

- **Over-specialization gatekeeps context:** "If you create `PythonTests` subagent, you've hidden testing context from the main agent — now it has to invoke just to validate its own code." ([techtaek context discipline](https://techtaek.com/claude-code-context-discipline-memory-mcp-subagents-2026/))
- **Vague descriptions → random invocation.** Triage rules need precision.
- **Subagent-of-subagent:** sources don't cite a hard depth limit, but 7× token multiplier compounds — *I had to guess* that 2 levels is the practical ceiling.
- **Self-grading bias** if generator = evaluator. Cursor case: GPT > Opus for extended autonomy specifically because Opus prematurely declared completion. ([Addy Osmani long-running](https://addyosmani.com/blog/long-running-agents/))

---

## 4. Cortex-x fit assessment

| Pattern | Fit | Why |
|---|---|---|
| Files-as-memory (journal/lessons) | ✅ shipped | Already SSOT in Steward |
| Cross-session loop detector (5x/7d) | ✅ shipped | Sprint 1.9.1 |
| **Intra-run StuckLoopDetection (3 identical / A-B-A / no-op)** | ⚠ gap | Cross-session is for criterion-level repeats; intra-run tool-call loops not yet caught — high-value add |
| **Append-only prompt builder (cache-preserving)** | ⚠ gap | Need to verify prompt assembly doesn't invalidate cache mid-window |
| Cost ledger + multi-window caps | ✅ shipped | Daily/weekly/monthly + 50K/5min velocity |
| **Model tiering across action_kinds** | ⚠ partial | Engine seam exists, no router; Sprint 2.4 claude-cli COST PIVOT addresses this |
| Compaction (Anthropic server-side) | ⏳ future | Not relevant until sessions exceed Claude Code's native window — fits Tier 1+ |
| **Checkpoint/resume on host-daemon crash** | ⚠ gap | Lock + journal are partial; no replay-from-checkpoint primitive — required before 10h runs |
| Subagent decomposition (planner/executor/verifier) | ✅ aligned | Spec-driven verifier (Sprint 1.9.0) + senior_tester_review = verifier role; capability palette ≈ executor specialization |
| Plan-mode-nudge / explicit pause-and-confirm | ⚠ gap | Steward today is fire-and-forget per cron; long sessions need mid-run human-gate |
| Subagent depth limit | ⚠ guideline-only | Should encode max depth = 2 in policy |
| Files-outside-context journaling pattern (Ralph Loop) | ✅ effectively | Journal does this |

---

## 5. Concrete recommendations

1. **Sprint 2.x (S effort) — Add intra-run StuckLoopDetection primitive.** New `bin/steward/_lib/loop-detector.cjs`: detect identical-call / A-B-A / no-op across the *current* run's tool-call log; threshold 3 default; on detect → write `STEWARD_HALT` with reason. R3-compliant: one new defense layer + regression test. Pairs cleanly with existing cross-session detector (different scope, same SSOT).

2. **Sprint 2.x or 2.4 (M effort) — Action-kind → model tier router.** Lightweight router: `recommendation_harvest`/`todo_triage`/`doc_drift` → cheap model (deepseek-v4-flash); `senior_tester_review`/`pattern_transfer`/`tech_debt_audit` → frontier. Aligns with Sprint 2.4 COST PIVOT already in roadmap. Industry-cited 40-60% savings.

3. **Sprint 2.x (M effort) — Checkpoint primitive for multi-action runs.** Today: per-action atomic commit + journal. For 10h sessions need: action-level resume tokens (criterion id + cursor + cost-so-far) so a host crash mid-way doesn't lose accumulated context. Reference: LangGraph persistence shape, but zero-deps file-based. Required *before* host-daemon work in Tier 4.

4. **Sprint 2.x (S effort) — Append-only prompt assembly + 1h cache TTL toggle.** Audit `bin/steward/_lib/` prompt builders to ensure no mid-context mutation. Add `STEWARD_CACHE_TTL_HOURS=1` env (default 0=5min). Anthropic data: 1h-TTL is 2× write-cost but for repeated-criterion runs in a single host session, savings dominate. Pre-Tier-4 cost-control prerequisite.

5. **Sprint 3.x (L effort) — Plan-mode-nudge / explicit pause primitive for >2h sessions.** When the session exceeds N actions or detects ambiguity (LLM returns low-confidence plan), write a `STEWARD_PAUSE` artifact with the unresolved decision and exit; operator resumes by deleting it. Mirrors Codex `/goal` plan-mode-nudge + Anthropic's empirical "Claude pauses 2× more on complex tasks." This is the human-only-path preservation (R5) under longer autonomy.

**Reality check:** real-world frameworks all hit the same wall cortex-x will hit at hour 2-3: context drift + cumulative tool-error compounding. Even Claude Code itself reports "context loss on sessions longer than 2h." Don't promise 10h sessions until items 1-4 ship; treat 10h as Tier-3 territory, not Tier-1.

---

## 6. Sources

- [Anthropic — Measuring AI agent autonomy in practice (Feb 2026)](https://www.anthropic.com/news/measuring-agent-autonomy)
- [Anthropic — Long-running Claude for scientific computing](https://www.anthropic.com/research/long-running-Claude)
- [Anthropic — Prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [InfoQ — Inside Claude Code Auto Mode (May 2026)](https://www.infoq.com/news/2026/05/anthropic-claude-code-auto-mode/)
- [thoughts.jock.pl — AI Coding Harness Agents 2026 comparison](https://thoughts.jock.pl/p/ai-coding-harness-agents-2026)
- [Addy Osmani — Long-running Agents](https://addyosmani.com/blog/long-running-agents/)
- [Medium — StuckLoopDetection (April 2026, pydantic-deep 0.3.8)](https://medium.com/@kacperwlodarczyk/stuckloopdetection-how-we-stopped-an-agent-burning-12-on-47-identical-calls-a12b5ea1f193)
- [eunomia — Checkpoint/Restore Systems for AI Agents](https://eunomia.dev/blog/2025/05/11/checkpointrestore-systems-evolution-techniques-and-applications-in-ai-agents/)
- [Restate — Durable AI Loops](https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs)
- [Developers Digest — Claude Code Agent Teams 2026 Playbook](https://www.developersdigest.tech/blog/claude-code-agent-teams-subagents-2026)
- [Nimbalyst — Claude Code Subagents Practical 2026 Guide](https://nimbalyst.com/blog/claude-code-subagents-guide/)
- [techtaek — Claude Code context discipline 2026](https://techtaek.com/claude-code-context-discipline-memory-mcp-subagents-2026/)
- [MindStudio — 5 Claude Code Workflow Patterns](https://www.mindstudio.ai/blog/claude-code-agentic-workflow-patterns)
- [MindStudio — AI Agent Token Cost Optimization Multi-Model Routing](https://www.mindstudio.ai/blog/ai-agent-token-cost-optimization-multi-model-routing)
- [Augment Code — 7 Multi-Agent Orchestration Platforms 2026](https://www.augmentcode.com/tools/multi-agent-orchestration-platforms-build-vs-buy)
- [cipherbuilds — Why Your AI Agent Crashes at 3 AM (4 recovery patterns)](https://cipherbuilds.ai/blog/ai-agent-crash-recovery-patterns)
- [revolutioninai — How Manus AI Works (April 2026)](https://www.revolutioninai.com/2026/04/how-manus-ai-works.html)
- [Cognition — Devin product page](https://cognition.ai/)
- [Don't Break the Cache — arXiv 2601.06007](https://arxiv.org/html/2601.06007v2)

---

**Word count:** ~970 words.
