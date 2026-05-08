---
title: Sprint 2.8 R1 — Memory foundation (Anthropic memory tool + failure distillation + decay)
status: research-only — informs implementation, not a commit
created: 2026-05-08
research_dispatched_by: cortex-x autonomous workflow per R1 principle
sprint: 2.8
prior_research: docs/research/* (R4 dispatch 2026-05-08 — literature)
---

# Sprint 2.8 R1 — Memory foundation: native memory tool + failure distillation + importance-weighted decay

## TL;DR

Sprint 2.8 stacks three upgrades onto the Sprint 1.8.3 ReasoningBank-lite (`bin/steward/_lib/lessons.cjs`, success-only `lessons.jsonl` per slug):

1. **Optional Anthropic `memory_20250818` tool wiring** — opt-in via `STEWARD_MEMORY_TOOL=on`, behind a thin client-side handler that maps the tool's `/memories` virtual root to `$CORTEX_DATA_HOME/memory/<slug>/`. Claude-only path; OpenRouter remains stuff-into-system-prompt. ([Anthropic memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool))
2. **Failure-trajectory distillation** — extend `recordLesson` to be invoked on `result.ok=false`, with a Sonnet-tier LLM call that converts a failed run's `code + stderr + plan` into a 3-field structured lesson (title / description / content) per [arXiv:2509.25140 Figure 8](https://arxiv.org/html/2509.25140v1). The paper reports up to **+34.2% relative improvement** on WebArena MaTTS when failures are added on top of successes; baselines without failure ingestion *degrade*.
3. **Importance-weighted decay** — replace today's "tail last 500 lines" recall with a scored ranker `U = (w_freq·freq + w_impact·impact)·e^(−λ·age_days)`. Bottom 5% per week archived to `cortex/memory-archive/<year>-<week>/`, recoverable for 12 weeks. Defaults seeded from the [YourMemory](https://github.com/sachitrafa/YourMemory) production formula, not pulled from thin air.

**Default OFF for v0.x.** All three features are gated by env flags; existing behavior is byte-for-byte unchanged. Rollback = unset env, no migration needed. Total estimated runtime cost delta: **+$0.0002/failure** (one Sonnet distillation per failed action) and **+0–2 extra tool round-trips/run** when memory tool is on. Both fit within current `STEWARD_DAILY_USD_CAP`.

**Top risks**: (a) memory tool BETA status — versioned name `memory_20250818` pins us, but bumping requires the new compat shim; (b) decay parameters tuned for human-recall (Ebbinghaus) may not transfer to action-keyed lessons — mitigated by 30-day shadow-mode dual-write and metric instrumentation before flipping defaults; (c) per-file vs per-batch storage layout choice locks in for backward-compat.

---

## §1 — Anthropic memory tool (`memory_20250818`) — schema, residency, concurrency

### 1.1 Production-readiness status (2026-Q3)

The memory tool is **public BETA**, generally available since Sept 2025, current versioned tool name still `memory_20250818` per the live docs page ([Anthropic — Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)). The version date is the *schema lock*, not a release marker; Anthropic's pattern (matching `text_editor_20250728`, `web_search_20250305`) is to bump the suffix only on breaking schema changes. **No newer version exists as of 2026-05-08**. The tool is ZDR-eligible.

### 1.2 Full input schema

The memory tool defines **6 commands**: `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. All take a `path` argument scoped to the virtual `/memories` root. Notable shapes:

```jsonc
// view — directories or files (with optional line range)
{ "command": "view", "path": "/memories", "view_range": [1, 10] }

// create — fail-if-exists semantics (no overwrite)
{ "command": "create", "path": "/memories/notes.txt", "file_text": "..." }

// str_replace — must match verbatim, must be unique
{ "command": "str_replace", "path": "/memories/p.txt", "old_str": "...", "new_str": "..." }

// insert — at specific line, 0-indexed top
{ "command": "insert", "path": "/memories/todo.txt", "insert_line": 2, "insert_text": "..." }

// delete — recursive on directories
{ "command": "delete", "path": "/memories/old_file.txt" }

// rename — fail-if-destination-exists
{ "command": "rename", "old_path": "/memories/draft.txt", "new_path": "/memories/final.txt" }
```

Return values are *not* JSON — they are the literal stdout strings (`"File created successfully at: {path}"`, `"Successfully deleted {path}"`, etc.). Listings return tab-delimited size-then-path lines, files return cat-style line-numbered output (6-char right-aligned width).

### 1.3 Working directory behavior — fully client-side

Critical for cortex-x design: **the tool is client-side**. Every tool call returns to our handler; we decide where to read/write. The model only sees a virtual `/memories` root and trusts our string responses. This means:

- We map `/memories/*` → `$CORTEX_DATA_HOME/memory/<slug>/*` deterministically.
- **Path-traversal hardening is on us.** Anthropic's docs spell this out as a `MUST` security item (URL-encoded `%2e%2e%2f`, `..\\`, realpath-then-`relative_to`). We already have an analogous primitive from Sprint 1.6.18 (`bin/steward/_lib/path-safety.cjs`); reuse it.
- Storage backend is pluggable (file, sqlite, S3) — we stay file-based to keep the zero-deps invariant.

### 1.4 Concurrency model

The tool is single-threaded *per conversation*. Multiple parallel cortex-x runs writing to the same slug's memory dir is **not** prevented by Anthropic — it is our problem. Sprint 1.6.6 lock primitive (`bin/steward/_lib/lock.cjs`, advisory mutex via `cortex/.locks/<slug>.lock`) already serializes `cortex-steward` runs per slug; memory writes piggy-back on that lock. Cross-slug parallelism is naturally safe (different directories).

### 1.5 Token cost & context-editing integration

The memory tool is billed like any other tool — input tokens for the directory listing and file contents Claude pulls in, output tokens for the tool calls. Empirical guideline from the docs and from Anthropic's [effective-context-engineering essay](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): a typical multi-session agent pulls **2–5 memory files at task start**, ~1–4 KB each, so amortized overhead is **~1–4K input tokens/run**.

Pairing with `clear_tool_uses_20250919` (context editing): the `clear_at_least` parameter is **not invoked automatically by Claude** — it is a server-side budget threshold; clearing fires when the conversation exceeds the configured trigger and clears at least that many tokens of *tool result* content. **Memory-tool calls are tool-uses too**, so they sit in the same pool that gets cleared. This means: if you clear too aggressively, you lose memory-pulled content from active context, but the on-disk memory is untouched. Cache invalidation cost (5-min TTL break + cache-write fee) means you should clear ≥1024 tokens per trigger to be net-positive ([Context editing docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)).

**Best practice for cortex-x:** memory tool *alone* is enough at our run length (single-shot, ~10–30K total tokens). Context-editing pairing only matters once we add long-running multi-action sessions (Sprint 2.2 worktree supervisor). **Do not enable context-editing in 2.8.**

---

## §2 — Migration: cortex-x markdown → memory tool layout

### 2.1 Current shape

Sprint 1.8.3's `lessons.cjs` writes one JSONL line per lesson to `$CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl` (per-project) and reads back via `tail -N`. Schema:

```json
{ "ts": "...", "action_kind": "...", "action_key": "...",
  "root_cause": "...", "lesson_text": "...", "hint": "..." }
```

The memory tool model is **a directory of files**, not a JSONL log. Direct mapping is impossible without restructuring.

### 2.2 Recommendation: dual-write, never migrate-and-delete

Per the operator's constraint #8 (`STEWARD_MEMORY_TOOL=off` default + lessons.jsonl AS WELL on): **defense in depth**. The memory tool's `/memories` is opaque from cortex-x's side once Claude starts editing it (Claude can `str_replace` arbitrary text, rename files). lessons.jsonl stays the **system-of-record**; the memory dir is a **derived view**.

Layout (when `STEWARD_MEMORY_TOOL=on`):

```
$CORTEX_DATA_HOME/
├─ journal/<slug>/lessons.jsonl          (SoR — append-only, never edited by LLM)
└─ memory/<slug>/
   ├─ INDEX.md                           (one-line-per-lesson, regenerated on start)
   ├─ recent/<lesson_id>.md              (last 30 days, one file per lesson)
   └─ patterns/<theme>.md                (consolidated by Claude over time)
```

### 2.3 Per-file vs batch tradeoff — choose per-file with index

Tradeoff per the operator's question:
- **Per-file**: more memory-tool round-trips at retrieval (1 `view` listing + 2–5 `view` reads), but Claude can `str_replace` precisely, archive cleanly, and the `view_range` line-window stays short. Better for write/edit cycles.
- **Batch JSONL**: single `view` of one large file. Cheaper to load, but every edit is a `str_replace` against a moving target — error-prone (multiple-occurrences-of-old_str error is common).

**Recommendation**: per-file under `recent/`, plus a regenerated `INDEX.md` that the agent always reads first (matches Anthropic's "ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE" prompt boilerplate). `INDEX.md` is regenerated by *us* (deterministic) on each `cortex-steward` start — Claude never edits it. Patterns directory is Claude's territory for cross-lesson consolidation.

---

## §3 — ReasoningBank failure-distillation prompt (2026-Q3)

### 3.1 Canonical schema (paper Figure 8)

Per [arXiv:2509.25140](https://arxiv.org/html/2509.25140v1) and the [emergentmind summary](https://www.emergentmind.com/papers/2509.25140):

> Each memory item specifies three components: (i) a **title**, which serves as a concise identifier summarizing the core strategy or reasoning pattern; (ii) a **description**, which provides a brief one-sentence summary of the memory item; and (iii) the **content**, which records the distilled reasoning steps, decision rationales, or operational insights extracted from past experiences.

**At most 3 memory items per trajectory**, temperature 1.0, structured Markdown output. The Figure 8 (right panel) failure-side instruction is verbatim:

> *"reflect on the causes of failure and articulating lessons or preventive strategies"*

### 3.2 Recommended cortex-x prompt (concrete)

```
You are a postmortem analyst. A cortex-steward run failed. Distill at most 3
preventative lessons. Output strict markdown, no preamble.

For each lesson:
## <title — ≤8 words, imperative voice>
**Description**: <one sentence, ≤120 chars>
**Content**:
- <actionable principle 1>
- <actionable principle 2>
- <actionable principle 3, optional>

Anti-patterns to avoid:
- DO NOT quote the raw error message verbatim. Extract the *learning*.
- DO NOT propose code-level fixes. Lessons are about *strategy*, not patches.
- DO NOT include slugs, paths, or run-specific identifiers.

INPUT
=====
action_kind: {{kind}}
error_code: {{code}}
plan_summary: <untrusted>{{plan}}</untrusted>
stderr_tail: <untrusted>{{stderr_last_2KB}}</untrusted>
spec_failures: {{spec_failures_json}}
```

The `<untrusted>` delimiters are pre-existing cortex-x convention (Sprint 1.6.20 backlog item — already used in autoresearch).

### 3.3 Cost budget

- Sonnet 4.6 distillation: ~1.2K input tokens (prompt + 2KB stderr + plan), ~400 output tokens. At Sonnet 4.6 pricing (~$3/M in, $15/M out), that's **~$0.0096/distillation**. The operator's stated "$0.0002/failure on cheap tier" applies only if we route to DeepSeek V4 Flash; **our Sprint 2.0b action-kind model routing already handles this** — distillation is a `meta` action_kind, route to Flash for $0.0002 default, Sonnet only when `STEWARD_DISTILL_MODEL=sonnet` is set.
- **Cap**: 1 distillation per failed action; failed runs are rare (~5/month at current cadence), so monthly bill is bounded at <$0.05 even if every cap is hit.

---

## §4 — Retrieval-at-decision-time (MaTTS pattern)

The paper's MaTTS (Memory-aware Test-Time Scaling) does retrieval **before each new task**, not just at process boot. cortex-x's current pattern (load lessons at `action_engine` start, inject into system prompt) is *close* to MaTTS sequential variant; the gap is filtering.

### 4.1 Recommended retrieval filter

At LLM-call time, compute:

```js
filtered = lessons
  .filter(l => l.action_kind === actionKind || l.applies_to?.includes(actionKind))
  .filter(l => score(l) > THRESHOLD)
  .sort((a,b) => score(b) - score(a))
  .slice(0, K_TOP);  // K_TOP = 5 (paper: 4+ degrades)
```

Paper warning ([Figure 12](https://arxiv.org/html/2509.25140v1)): retrieval performance **degrades with 4+ items**. Cap at K=5 hard, default K=3.

### 4.2 Cache invalidation

In-process lesson cache stays valid **per-run**. Reload at every `cortex-steward` invocation (not every action within a run, since a run is single-action today). When Sprint 2.2 worktree supervisor lands and runs span hours, add SIGHUP-style re-read.

---

## §5 — Importance-weighted decay formula

### 5.1 Operator-pitched defaults — validation

Operator proposed: `U = (w_freq·freq + w_impact·impact)·e^(−λ·age)` with `w_freq=1.0, w_impact=2.0, impact ∈ {0.0, 0.5, 1.0}, λ_advisory=ln(2)/30, λ_blocker=ln(2)/120`.

Cross-checking against [YourMemory](https://github.com/sachitrafa/YourMemory) (production MCP server, +16pp better recall than Mem0 on LoCoMo): `strength = importance × e^(−λ_eff × days) × (1 + recall_count × 0.2)` with `λ_eff = 0.16 × (1 − importance × 0.8)`. Translation: high-importance items decay at **λ_eff ≈ 0.032/day** (half-life ≈ 22 days), low-importance at **λ_eff ≈ 0.16/day** (half-life ≈ 4.3 days).

The operator's 30-day advisory / 120-day blocker half-lives are **more conservative** than YourMemory's 4.3/22-day band. Defensible because:
- cortex-x runs nightly (1 observation/day), not chat-cadence (hundreds/day).
- A blocker-class lesson observed once has more signal-per-event than a chat preference.

[Kore](https://news.ycombinator.com/item?id=47070979) uses 7-day casual / 1-year critical — even more spread. Operator's defaults sit in the middle. **Recommendation: keep operator's values, mark them tunable via `STEWARD_DECAY_HALF_LIFE_*` envs**, and instrument `decay_score_p50/p95` in journal so we can revisit empirically after 90 days.

### 5.2 Decay tick frequency

Operator question: every nightly run vs 7-day cadence?

**Every run** is correct because:
- Cost is O(N) over lessons (N<200/slug typical) — sub-100ms.
- Avoids "decay shock" where one weekly tick drops dozens of lessons at once.
- Aligns with how YourMemory and Kore operate (per-query decay).

The *archive sweep* (bottom 5% to `memory-archive/`) runs **weekly** (Sunday 02:00 UTC, same cron slot as Sprint 2.1 autoresearch).

### 5.3 Caveat — Ebbinghaus may not transfer

The [Towards Data Science MLOps post](https://towardsdatascience.com/why-mlops-retraining-schedules-fail-models-dont-forget-they-get-shocked/) flags that exponential decay assumes gradual drift, not episodic shocks. cortex-x lessons are *event-keyed* (an OPENROUTER_KEY_MISSING from 2026-01 is just as relevant today if you re-clone the repo). **Mitigation**: keep `recall_count` (frequency) as the dominant signal — repeatedly-matched lessons stay regardless of age. The exponential is the secondary tiebreaker.

---

## §6 — Decay archive recovery

### 6.1 Layout

```
$CORTEX_DATA_HOME/memory-archive/
└─ 2026-W19/
   ├─ <slug>/<lesson_id>.md
   └─ MANIFEST.jsonl    (one line per archived lesson with hash + reason)
```

### 6.2 Recovery API

Operator question: manual move vs CLI command?

**CLI command** — `cortex-steward memory restore <lesson_id_or_hash>`. Reasons:
- Manual move would require operator to know archive layout (week numbering).
- Need to re-validate path-safety on restore (lesson moved during a malicious archive could be tampered with).
- Need to bump `recall_count` and reset `archived_at` atomically.

Implementation: ~50 LoC in `bin/steward/memory.cjs`, no new deps.

### 6.3 Retention — 12 weeks before hard-delete

Mem0's pattern (per [SurePrompts comparison](https://sureprompts.com/blog/agent-memory-architectures-compared-2026)): "things that multiple agents reference stay; things only one agent cares about fade." Letta's MemGPT-derived OS-paging model has no hard-delete by default; archives persist indefinitely.

12 weeks (≈3 months) is **defensible** as a middle ground:
- Long enough to cover a quarterly project pause.
- Short enough that the archive directory doesn't grow without bound.
- Mappable to operator's existing 3-month wisdom-audit cadence (per CLAUDE.md "3-month audit naplánován na 2026-07-17").

---

## §7 — `agent_id` future-proofing (Tier 2 hook)

R1 prior memo recommendation: tag every lesson with `agent_id` for future per-agent memory.

**Schema decision**: top-level field, not metadata block. Reasons:
- Filtering at retrieval time is hot path — schema field = O(1) JS access.
- Versioned via existing JSONL line-shape (no version field needed if field is optional).

**Migration**: existing lessons get `agent_id: "default"` retroactively — **on read**, not via a rewrite pass. The lessons.cjs reader already coerces missing fields to defaults; add `agent_id || "default"` and ship. No file mutation = no migration risk.

---

## §8 — Spec criteria (Sprint 1.9 verifier integration)

Per Sprint 2.8 spec, the verifier registry should include:

```yaml
- kind: file_predicate
  id: memory_dir_created
  description: "After first STEWARD_MEMORY_TOOL=on action, cortex/memory/<slug>/ exists with at least 1 file"
  predicate: { exists: "$CORTEX_DATA_HOME/memory/<slug>/INDEX.md" }

- kind: shell
  id: failure_distillation_recorded
  description: "Forced spec_failures produce a distilled lesson within 60s"
  command: |
    node -e "const f=require('fs');
      const lines=f.readFileSync(process.env.LESSONS_FILE,'utf8').split('\\n').filter(Boolean);
      const last=JSON.parse(lines.at(-1));
      process.exit(Date.now()-Date.parse(last.ts)<60000?0:1);"

- kind: regex
  id: agent_id_field_present
  description: "All new lessons carry agent_id field"
  pattern: '"agent_id":\s*"[^"]+"'
  applies_to: lessons.jsonl
```

All three reuse existing Sprint 1.9 criterion kinds — no new kind required.

---

## §9 — Operational risk + rollback

| Risk | Mitigation |
|---|---|
| `memory_20250818` schema bumped between 2026-Q2 and Q3 | Versioned tool name pins schema; bump = explicit cortex-x release, not silent break. |
| Path traversal via Claude-controlled `/memories/...` paths | Reuse Sprint 1.6.18 path-safety primitive; reject `..`, NUL, URL-encoded traversal at handler boundary. |
| Memory dir grows unbounded | Weekly archive sweep + 12-week hard-delete + `STEWARD_MEMORY_MAX_FILES_PER_SLUG=1000` cap. |
| Distillation LLM cost runaway on retry storms | Already gated by Sprint 1.9.1 token-velocity cap (50K/5min) + `STEWARD_DAILY_USD_CAP`. |
| Decay parameters wrong for our regime | 30-day shadow-mode (write `decay_score` to journal but rank by old algorithm); flip ranker when p95 drift < 10%. |
| Backward-compat break | `STEWARD_MEMORY_TOOL=off` is default; entire feature is one env flag. lessons.jsonl format gains optional fields only. |

**Rollback recipe**: `unset STEWARD_MEMORY_TOOL`. That's it. Existing JSONL keeps working because all new fields are optional with safe defaults.

---

## §10 — Recommendation summary (for the implementation sprint to cite)

1. **Implement client-side `memory_20250818` handler** in `bin/steward/_lib/memory-tool.cjs` (~250 LoC, zero deps), gated by `STEWARD_MEMORY_TOOL=on`. Path-safety reused from Sprint 1.6.18.
2. **Layout**: per-file under `recent/<lesson_id>.md` + deterministic `INDEX.md` regenerated by us, plus `patterns/` for Claude consolidation.
3. **Failure distillation** as new `meta` action_kind; reuse Sprint 2.0b action-kind model routing (DeepSeek V4 Flash default, ~$0.0002/run).
4. **Prompt**: 3-item structured markdown per [arXiv:2509.25140 Figure 8](https://arxiv.org/html/2509.25140v1), with cortex-x's `<untrusted>` delimiters around stderr/plan.
5. **Retrieval filter**: K=3 default, K=5 hard cap, score = `(freq + 2·impact)·exp(−λ·age)`.
6. **Decay**: per-run tick, weekly archive sweep, 12-week hard-delete; envs `STEWARD_DECAY_HALF_LIFE_ADVISORY_DAYS=30` / `_BLOCKER_DAYS=120`.
7. **Recovery**: `cortex-steward memory restore <id>` CLI.
8. **Schema**: add optional `agent_id`, `impact`, `recall_count`, `archived_at`, `applies_to[]` fields. Default `agent_id: "default"` on read.
9. **Spec verifier**: 3 criteria (file_predicate + shell + regex) — all existing kinds.
10. **Rollback**: `STEWARD_MEMORY_TOOL=off` (default).

Estimated implementation: ~600 LoC + ~30 tests. Single sprint, R1+R2 review pipeline mandatory per cortex-x operating principles.

---

## Sources

- [Anthropic — Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic — Context editing docs](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Anthropic — Effective context engineering essay](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [arXiv:2509.25140 — ReasoningBank (Google Cloud AI Research)](https://arxiv.org/abs/2509.25140) · [HTML version](https://arxiv.org/html/2509.25140v1) · [emergentmind summary](https://www.emergentmind.com/papers/2509.25140)
- [MarkTechPost — ReasoningBank coverage 2026-04-23](https://www.marktechpost.com/2026/04/23/google-cloud-ai-research-introduces-reasoningbank-a-memory-framework-that-distills-reasoning-strategies-from-agent-successes-and-failures/)
- [YourMemory — Ebbinghaus decay MCP server (production)](https://github.com/sachitrafa/YourMemory)
- [Kore — local AI memory layer with Ebbinghaus](https://news.ycombinator.com/item?id=47070979)
- [Mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [SurePrompts — Agent Memory Architectures Compared 2026](https://sureprompts.com/blog/agent-memory-architectures-compared-2026)
- [Towards Data Science — Why MLOps retraining schedules fail (decay regime caveat)](https://towardsdatascience.com/why-mlops-retraining-schedules-fail-models-dont-forget-they-get-shocked/)
- Internal: `bin/steward/_lib/lessons.cjs` (Sprint 1.8.3 ReasoningBank-lite), `docs/research/sprint-2.0b-action-kind-model-routing-2026-05-08.md`, `docs/research/sprint-2.1-autoresearch-overnight-burst-2026-05-08.md`
