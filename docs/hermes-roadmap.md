---
title: Hermes / cortex-x roadmap — v0.8 → v1.0 → enterprise-adjacent
status: living document — updated as sprints land
created: 2026-05-09
last_review: 2026-05-09
scope: Single source of truth for the post-Sprint-1.8.13 trajectory. Captures all directions surfaced in the 2026-05-08 SOTA brainstorm + the 4-repo inspection (NousResearch hermes-agent, agent0ai/agent-zero, browser-use/browser-harness) + Karpathy autoresearch. Every sprint here is a hypothesis to refine, not a commitment to ship as-written.
based_on:
  - Brainstorm research dispatch 2026-05-08 (SOTA autonomous agent techniques)
  - Inspection research dispatch 2026-05-08 (4 inspiration sources)
  - Sprint 1.8.12 + 1.8.13 incident loop (real validation gap demonstration)
  - VentureBeat Karpathy autoresearch piece (March 9, 2026, 8.6M views)
---

# Hermes / cortex-x roadmap

## 0. North Star

> **Cortex-x evolves from "senior dev compressed into a repo" to "self-extending agent ecosystem that runs while the operator sleeps."** Every sprint must demonstrably move us closer to one of three north-star metrics:
>
> 1. **Verification fidelity** — % of agent edits that don't introduce regressions undetected by `npm test`.
> 2. **Throughput per operator-hour** — net useful PRs Hermes opens per hour of operator review time.
> 3. **Self-evolution rate** — # of new capabilities/skills/strategies the agent itself contributes per week.

We currently score: ~70% / ~1 PR per 5 review-min / 0 self-contributions per week.
Frontier (2026-05): ~95% / ~5 PRs per 5 review-min / measurable self-evolution.

## 1. Operating principles for this roadmap

These rules are non-negotiable. Each sprint must satisfy all of them before merge.

| # | Principle | Enforcement |
|---|---|---|
| **R1** | **Research-before-implement.** Every sprint kicks off with a focused web-research dispatch (general-purpose agent, ~600-1200 word brief) on the SOTA for that specific direction *as of the day work starts*. The 2026 frontier shifts in weeks; the cached 2026-05 research expires fast. | Sprint cannot move from "planned" to "in-progress" without a `docs/research/<sprint>-<topic>-<date>.md` decision memo committed. |
| **R2** | **Review pipeline mandatory.** Every sprint that touches `bin/hermes/_lib/` or any Rule 1/2 module gets the 6-agent parallel review (acceptance + blind + correctness + security + ssot + edge-case) before commit lands on main. Pattern proven in Sprint 1.6.18 + reused continuously. | `cortex-evolve` review pipeline run, all blocker-severity findings closed. |
| **R3** | **One incident class = one defense layer = one regression test.** Sprint 1.8.12/1.8.13 set the precedent: every real failure mode shipped today produced a code defense + a regression test. No class is fully closed without both. | Test count grows monotonically. Today: 790. After v1.0: ≥1500. |
| **R4** | **Cost ceiling preserved.** Current full-cadence Hermes spend is ~$0.024/month. Multi-agent / overnight burst sprints will raise this — but never above $5/month at full cadence per project. Anything bigger needs explicit operator authorization. | `HERMES_DAILY_USD_CAP` enforcement + monthly journal cost rollup. |
| **R5** | **No human-only edits become Hermes-able.** `standards/`, `prompts/`, `profiles/`, `agents/`, top-level `CLAUDE.md`/`README.md`/`module.yaml` are human-only forever. Any sprint extending Hermes capability that wants to relax this is automatically rejected. | `bin/hermes/_lib/policy-check.cjs` HUMAN_ONLY_PATH + HUMAN_ONLY_TOPLEVEL rules. |
| **R6** | **Backward-compatible by default.** Existing 9 action_kinds keep working through every sprint. New capabilities are additive. Breaking changes are reserved for explicit `vN.0.0` major bumps. | `MIGRATIONS.md` entry per sprint + tests for all 9 existing kinds stay green. |

## 2. Current state (post Sprint 1.8.13)

| Layer | Status |
|---|---|
| 9-kind action palette | ✅ shipped (v0.8) |
| Safety: halt-check + lock + journal + denylist + policy-check | ✅ shipped |
| Pre-LLM defenses: apiKey trim + KEY_MALFORMED reject | ✅ Sprint 1.8.12b |
| Post-LLM defenses: AUTH_REJECTED distinct + content-preservation | ✅ Sprint 1.8.12c + 1.8.13 |
| Verification: `npm test` boolean gate | ⚠️ insufficient (proven by Sprint 1.8.13 incidents) |
| Multi-agent: parallel workers / supervisor | ❌ single-agent only |
| Self-improvement: ReasoningBank-lite via lessons.jsonl | ⚠️ lessons recorded but not used as training signal |
| Observability: file-based journal + status CLI | ⚠️ no dashboards / regression diffs |
| Cron coverage | ✅ daily 03:00 harvester + 04:00 recommendation, weekly Sunday dep-patch, monthly 1st todo-triage |
| Auto-PR creation | ✅ verified (PR #5, 2026-05-08) |
| Tests | 790/790 ✅ |
| CI grid | test ✅ install-smoke ✅ no-pii ✅ |

## 3. Tier 1 — Foundation for v1.0 (next 6 weeks, Sprint 1.9 → 2.3)

**Goal**: close the verification gap, enable multi-agent throughput, get measurable observability. Each Tier 1 sprint is a hard prerequisite for at least one Tier 2 sprint.

### Sprint 1.9 — Spec-driven verification (M effort, ⭐ HIGHEST PRIORITY)

**Why first**: directly fixes today's incident class (LLM destructive rewrite of MIGRATIONS.md slipped past `npm test`). Industry trend (GitHub Spec Kit at 84k stars + AWS Kiro). Slot into existing per-kind structure (`action-kinds.cjs` registry). Unblocks Sprint 2.2 (worktree workers each verify against same spec) and Sprint 3.0 (evolution needs richer fitness signal than `npm test`).

**Scope**:
- New file `cortex/specs/<kind>.spec.yaml` per action_kind (10 specs total — 9 shipped + release_notes_drafter parked).
- Each spec has `acceptance_criteria: []` — list of shell commands or JS predicates that return 0 (pass) or non-zero (fail) post-edit.
- New module `bin/hermes/_lib/eval-agent.cjs` — runs criteria after `npm test`, journals each criterion's result.
- `execute.cjs` Phase X (after npm test, before commit) runs eval-agent. Any criterion fail → `EDIT_SPEC_VIOLATION`, rollback.
- Sprint 1.8.13's hardcoded 50% rule becomes one criterion in `recommendation.spec.yaml` (universal across all file-edit kinds).

**Pre-implementation research dispatch**:
- "GitHub Spec Kit + AWS Kiro + EvalAgent (arXiv 2510.24358) — 2026-05 SOTA on spec-driven verification for autonomous agents. What schema do they use? What are the acceptance criterion idioms? How do they handle non-deterministic evals?"

**Acceptance criteria** for the sprint itself:
- 10 specs committed
- eval-agent runs all criteria + journals
- Sprint 1.8.13's rule lives as a spec criterion (not hardcoded in action-engine)
- Tests: ≥10 new (1 per kind spec parsing + 5 for criterion runner + 4 for failure paths)
- Full suite stays green
- 6-agent review pipeline clean

**Stolen from**: GitHub Spec Kit + AWS Kiro + EvalAgent paper.

---

### Sprint 2.0 — Observability-as-a-service (S effort, easy win)

**Why second**: zero meaningful evolution without measurement. Current journal is fine for forensics but useless for "did week-over-week prompt change improve recommendation quality?" Self-hosted Langfuse runs in Docker, OpenLLMetry-compatible, no telemetry leak.

**Scope**:
- Self-hosted Langfuse via `docker compose` in `infra/observability/` (new dir, not in main repo — separate `ops/` repo or maintainer-private compose file).
- Wrap OpenRouter `fetch()` call in `action-engine.cjs` with OpenLLMetry tracer.
- Mirror `journal.cjs` writes to Langfuse traces.
- Dashboards: cost per kind / week, prompt regression diff, action_key failure cluster, latency p50/p95.

**Pre-implementation research dispatch**:
- "Langfuse vs Phoenix vs Helicone (RIP) for self-hosted agent observability 2026-05. OpenLLMetry semantic conventions for tool-calling agents. Single-developer setup constraints."

**Stolen from**: Langfuse self-hosted reference architecture.

---

### Sprint 2.0b — Model routing + cheap-model ensembles (S effort)

**Why parallel with 2.0**: doubling runs/$ unlocks Sprint 2.1 (overnight burst) cost-wise.

**Scope**:
- Complexity classifier: simple deterministic kinds (`todo_triage`, `dep_update_patch`) route to cheapest model (e.g. `qwen3-coder-flash`).
- `recommendation` kind: route to ensemble of 3 cheap models (deepseek-v4-flash + qwen3-coder + gpt-5.2-mini), agent-as-judge votes 2/3 consensus before applying.
- New env: `HERMES_ROUTING_PROFILE=cheap|balanced|premium`.

**Pre-implementation research dispatch**:
- "RouteLLM / GorillaLLM / Augment 2026 routing patterns. Cheap-model ensembles vs single-flagship for code edits. Real cost/quality tradeoffs in 2026-05 model landscape."

**Stolen from**: RouteLLM (lm-sys/RouteLLM, Berkeley).

---

### Sprint 2.1 — Hermes autoresearch / overnight burst mode (M effort, ⭐ TRANSFORMATIVE)

**Why third (after 1.9 + 2.0)**: Karpathy autoresearch has 8.6M views in 2 days. The pattern is mainstream as of 2026-03. We are running 1 experiment per night while frontier runs 100+. Order-of-magnitude throughput delta.

**Scope**:
- New mode: `node bin/cortex-hermes.cjs autoresearch --max-actions=20 --max-budget-usd=2 --max-time-min=300 --diverge-strategies=3`.
- New workflow `.github/workflows/hermes-autoresearch.yml` cron `0 22 * * *` (22:00 UTC = 00:00 CEST, true overnight).
- For each picked action: generate 3 candidate strategies (3 LLM calls), apply each, run npm test + spec criteria (Sprint 1.9), judge picks best, others rollback.
- After 20 actions / $2 / 5h, opens a single master draft PR with N atomic commits.
- Cost: ~$2/month at full cadence (still 100× under Devin/Codex).

**Pre-implementation research dispatch**:
- "Karpathy autoresearch follow-ups May-June 2026. Hyperspace AI distributed variants. Failure modes (validation set spoilage, over-fitting). What's the actual best-practice for run-budget shaping + judge prompts in 2026-Q2?"

**Stolen from**: Karpathy's 630-line script (MIT) + Hyperspace AI distributed pattern + AlphaEvolve / OpenEvolve.

---

### Sprint 2.2 — Worktree supervisor + agent-as-judge ensemble (L effort)

**Why after 2.1**: 2.1 proves the multi-strategy pattern serial; 2.2 makes it parallel via git worktrees. Composio Agent Orchestrator is the open-source reference.

**Scope**:
- Split `runExecute()` into `runSupervisor()` + `runWorker(N)`.
- `git worktree add cortex/hermes-run-{N}` per worker.
- Lock manager generalized from 1-mutex to N-mutex.
- Judge agent prompt evaluates N branches against spec criteria + commit clarity + cost.
- 4 workers in parallel = 4× throughput at ~4× cost (still <$10/month full cadence).

**Pre-implementation research dispatch**:
- "Composio Agent Orchestrator + Cursor Parallel Agents + Claude Code Agent Teams + Grok Build worktree patterns. State-of-the-art supervisor↔worker protocols 2026-05. Conflict resolution + judge prompting techniques."

**Stolen from**: Composio AO + agent-zero subordinate hierarchy + Team Atlanta ensemble patching.

---

### Sprint 2.3 — Mutation testing as fitness signal (S-M effort)

**Why round out Tier 1**: makes verification *more* rigorous than just "tests pass". If LLM patch passes tests but mutation score regresses, reject — the existing tests aren't actually exercising the diff.

**Scope**:
- Stryker (JS mutation testing) integrated into `verifier.cjs` as a post-`npm test` gate (only for `recommendation` kind initially, since deterministic kinds don't change code logic).
- Pre-edit baseline mutation score captured to journal.
- Post-edit mutation score must be ≥ baseline; if lower → `EDIT_MUTATION_REGRESSION`.

**Pre-implementation research dispatch**:
- "Stryker for JS in 2026 + Property-Generated Solver (arXiv 2506.18315) + Meta FSE 2026 mutation-guided LLM test gen. Performance budget for incremental mutation testing."

**Stolen from**: Stryker Mutator + Meta FSE 2026 paper.

---

## 4. Tier 2 — Compound learners (weeks 7-12, Sprint 3.0 → 3.3)

**Goal**: turn cortex-x into a self-evolving system. After Tier 2, prompts/strategies/skills get measurably better every week without operator intervention.

### Sprint 3.0 — AlphaEvolve-style prompt evolution (L effort, ⭐ MOONSHOT)

**Why**: this is the only direction that compounds. After 50 generations, Hermes prompts will beat your hand-tuned baselines by measurable margin — and you didn't write any of them.

**Scope**:
- New module `bin/hermes/_lib/prompt-evolver.cjs`.
- For each kind: generate 3 candidate prompts → run on held-out fixture set (`tests/fixtures/`) → score via Sprint 1.9 spec criteria → keep top-1, archive rest.
- After N=50 generations, promote winning prompt to `prompts/<kind>.md`.
- Held-out fixtures rotated periodically to prevent overfitting (Sprint 1.9 + 2.1 community concern flagged).

**Pre-implementation research dispatch**:
- "OpenEvolve / CodeEvolve (arXiv 2510.14150) / AlphaEvolve (arXiv 2506.13131) implementation patterns 2026. Mutation operators for prompt evolution. Validation-set spoilage countermeasures."

**Stolen from**: AlphaEvolve + OpenEvolve + Karpathy autoresearch loop.

---

### Sprint 3.1 — Self-extending capabilities (`skill-experiments/`) (L effort, ⭐ MOONSHOT)

**Why**: from browser-use/browser-harness — agent writes its own missing helpers during execution. Most ambitious of the lot.

**Scope**:
- New dir `cortex/agent-workspace/skill-experiments/<slug>/<kind>.cjs`.
- When LLM identifies a missing capability mid-action, it generates a candidate helper, sandboxes execution, evaluates against test fixtures, commits to skill-experiments if useful.
- After N successful uses (≥ 5), helper graduates to `bin/hermes/_lib/skills/<name>.cjs` via human-reviewed PR.
- Constraint: skills can only `require()` Node built-ins + already-shipped cortex-x modules. No new npm deps.

**Pre-implementation research dispatch**:
- "browser-use/browser-harness self-extending pattern detailed implementation 2026. Sandbox execution for agent-generated code. Promotion criteria from experimental to stable. Security implications of agent-authored helpers."

**Stolen from**: browser-use/browser-harness + Karpathy autoresearch + agent-zero plugin pattern.

---

### Sprint 3.2 — FTS5 skill index + cross-project lesson sharing (M effort)

**Why**: lessons.jsonl is linear-scan, fine for one project. Cross-project federated learning needs indexed query. NousResearch's hermes-agent has FTS5 in production at 139k-star scale.

**Scope**:
- SQLite FTS5 index over `cortex/hermes-lessons.jsonl` (per-project) + `~/.cortex/lessons.federated.jsonl` (cross-project).
- New helpers `lessons.searchByText()` + `lessons.searchByActionKind()` + `lessons.searchByErrorCode()`.
- Action-engine recall step (Sprint 1.8.3) uses FTS lookup instead of scoring full archive.
- Cross-project sync: opt-in via `cortex/cortex-source.yaml` flag, signed entries to prevent poisoning.

**Pre-implementation research dispatch**:
- "SQLite FTS5 patterns for agent memory 2026. NousResearch hermes-agent skill curation implementation. Cross-tenant memory poisoning defenses + signing patterns."

**Stolen from**: NousResearch/hermes-agent skill curation + ReasoningBank federated angle.

---

### Sprint 3.3 — GraphRAG codebase context (M effort)

**Why**: single LLM call sees ~5 files of context. GitNexus reports 6.8× fewer tokens / 49× more capability with Tree-sitter knowledge graph. Critical for client projects (RELO has thousands of files).

**Scope**:
- Tree-sitter parse on `npm install` + on-demand refresh.
- Local SQLite-backed graph (FalkorDB later if needed).
- New helper `codeGraph.findCallSites(symbol)` + `codeGraph.findImporters(file)`.
- Per-kind retrieval: `dep_update_patch` queries call sites of breaking symbol, `recommendation` queries importers of mentioned files.

**Pre-implementation research dispatch**:
- "GitNexus + code-review-graph + AST GraphRAG (arXiv 2601.08773) + FalkorDB 2026 patterns. Tree-sitter incremental update strategies. Semantic search on top of AST graphs."

**Stolen from**: GitNexus + GraphRAG papers.

---

## 5. Tier 3 — Productization + enterprise-adjacent (weeks 13-20)

**Goal**: cortex-x stops being "Dave's personal tool" and becomes "distributable senior-engineer-as-a-service." Each Tier 3 sprint is an independent revenue/positioning lever.

### Sprint 4.0 — Capability marketplace (S-M effort)

**Why**: agentskills.io spec is already shipped. cortex-x can be the npm-of-skills. Drag-drop new action_kind into a project, instant capability.

**Scope**:
- Public registry of community-contributed action_kinds.
- `cortex add-skill <name>` CLI command.
- Sandbox + signing + lint gates before a community skill can land.
- Initial seed: contribute 3-5 community skills cortex-x already has (e.g. publish `dep_update_patch` as standalone skill).

**Stolen from**: agentskills.io spec + npm registry model.

---

### Sprint 4.1 — WaaS angle for clients (M-L effort, $$$ lever)

**Why**: Champions Barber, Amici, Objedname — Dave's existing clients. Each gets own Hermes instance. $50/month per client = recurring revenue + tangible AI value-add.

**Scope**:
- Per-client cortex-x deployment template.
- Client-facing dashboard (Langfuse-derived) showing weekly autonomous improvements.
- Service tier model: starter (deps + lint only), pro (full palette), enterprise (custom kinds).

**Stolen from**: agency / SaaS service-tier conventions.

---

### Sprint 4.2 — Recommendation auto-sourcing (M effort)

**Why**: humans are the bottleneck on recommendations.md curation. Slack message → auto-recommendation. GitHub issue mentioned in Discord → auto-recommendation.

**Scope**:
- Slack/Discord webhook listeners.
- LLM filter: "is this an actionable recommendation, or noise?"
- Auto-append to `cortex/recommendations.md` if filter passes.
- Operator daily digest of new auto-sourced items.

**Stolen from**: Linear / Notion auto-capture patterns.

---

### Sprint 4.3 — Voice → recommendation (S effort, fun)

**Why**: Dave dictates while driving / walking. Telegram bot → voice → Whisper → recommendations.md.

**Scope**:
- Telegram bot endpoint, voice-message receiver, Whisper transcription.
- Same LLM filter as 4.2.
- Operator confirmation step before commit.

---

### Sprint 4.4 — Coding identity transfer / LoRA (XL effort, ambitious)

**Why**: extract Dave's style from his git history (RELO + Chatbot Platform + WaaS + cortex-x), train lightweight LoRA, Hermes adopts. Other Dave projects inherit your voice.

**Scope**:
- Git history → diff samples → instruction-tuning dataset.
- LoRA training (small model, fine-tune on Dave-PR pairs).
- Inference seam in action-engine (LoRA-adapted model as routing option).

**Stolen from**: standard LoRA + RLHF-from-PRs research.

---

### Sprint 4.5 — Cross-repo federated lesson bank (S-M effort)

**Why**: complement to Sprint 3.2. RELO Hermes learns from Kiosek Hermes failures.

**Scope**:
- Shared `~/.cortex/lessons.federated.jsonl` synced via private Supabase row or signed Gist.
- Each entry signed with source-repo SHA to prevent poisoning.
- Opt-in per-project.

---

### Sprint 4.6 — Playwright-MCP UI verification (M effort, client-project unlock)

**Why**: relevant for RELO/Kiosek/portfolio runs where Hermes touches React components.

**Scope**:
- Playwright MCP server in CI.
- Per-project `cortex/ui-checks.yaml` defines acceptance flows.
- Post-edit Hermes runs flows + screenshot-diffs against baseline.

**Stolen from**: Playwright MCP + Agent Wars spec-driven verification.

---

### Sprint 4.7 — Naming-collision decision (S effort, branding)

**Status**: deferred decision.

NousResearch/hermes-agent has 139k stars + production-running messaging assistant. cortex-x's "Hermes" is internal name today. Before public launch:
- **Option A**: rebrand internal Hermes → "Pulse" / "Drift" / "Steward" / "Sentry" / "Forge" (TBD by Dave).
- **Option B**: lean into namespace clarity — public-facing always "cortex-Hermes", never just "Hermes".
- **Option C**: ignore and accept the collision (not recommended).

Decision deadline: before Sprint 4.0 (capability marketplace) or v0.1.0 public tag, whichever first.

---

## 5b. Tier 4 — Personal AI entity / Living cortex-x (weeks 21+, ⭐ VISION)

**Status**: vision tier, not commitment. Surfaced 2026-05-09 by Dave (operator) after seeing a "Personal AI Wiki System" diagram (UGREEN NAS + Obsidian Vault + Hermes + multi-agent worker stack). The diagram resonated because cortex-x already has 80% of the components — just running in GHA cron context, not on a home always-on host.

**Goal**: cortex-x stops being "code maintenance tool" and becomes "personal AI entity that lives on Dave's home NAS, curates knowledge across all life domains (code + meetings + notes + health + LinkedIn), responds to ambient events, persists identity across years."

**This is post-v1.0 territory.** Tier 1+2+3 must ship before this is even proposed. But tracking it here so it's on the radar.

### Sprint 5.0 — Self-hosted always-on Hermes (M-L effort)

**Why first in this tier**: GHA cron is "1 run per scheduled tick." Home NAS is "24/7 responsive listener." Voice memo at 3pm → recommendation harvested by 3:01pm. GitHub issue commented at 11am → Hermes considers + drafts response by 11:05.

**Hardware**: UGREEN NAS / Beelink SER9 / Mac Mini M4 (~$500-1200 one-time).

**Software**: cortex-x packaged as systemd / launchd service. Local LLM via Ollama (Qwen 3 32B or Llama 3.3 70B quantized). Hybrid routing — local for sensitive, OpenRouter for premium.

**Pre-implementation research dispatch**:
- "Self-hosted always-on personal AI agent stacks 2026-Q3. Khoj / Reor / AnythingLLM / Open WebUI architectures. Local LLM hardware sweet spot for 32B-70B inference. Network-isolated agent security patterns."

---

### Sprint 5.1 — Soul abstraction (S-M effort, ⭐ NOVEL)

**Why**: insight from the 2026-05-09 diagram inspection — `souls.md` per agent. Today cortex-x has framework-level identity (`standards/`) but no agent-level identity. Each agent has values, voice, constraints, memory priorities encoded as a "soul" that the agent reads before each action.

**Scope**:
- New dir `cortex/souls/<agent>.md` (frontmatter + structured fields).
- Action engine prepends soul to system prompt.
- Soul mutations are human-only edits (like `standards/`).
- Initial souls: `hermes.md`, `harvester.md`, `judge.md`.

**Why not Tier 1**: cortex-x with single hardcoded `HERMES_SYSTEM_PROMPT` still works. Soul abstraction is real value-add only when multiple agents (worktree workers, judge, harvester, supervisor) coexist with distinct roles. Sprint 2.2 (worktree supervisor) is the prerequisite that makes this matter.

---

### Sprint 5.2 — Obsidian Vault as second SSOT (M effort)

**Why**: Dave's life knowledge isn't in `cortex/recommendations.md` — it's in Obsidian (notes, meetings, ideas). Two-way sync between Obsidian and cortex-x markdown lets Hermes harvest recommendations from real life-context, not just gh signals.

**Scope**:
- Obsidian plugin (or symlink-based bridge) that exposes vault content to cortex-x.
- Recommendations harvester reads Obsidian daily notes / meetings / "ideas inbox."
- Hermes can write back: action items extracted from notes → tracked in `cortex/recommendations.md` → merged PRs reflect back to Obsidian as "shipped this week."

---

### Sprint 5.3 — Multi-source life ingest (L effort)

**Why**: voice memos + email + Slack + calendar + health data → all flow into cortex-x as recommendation signals. The diagram's "Data Sources" arrows.

**Scope**: webhook listeners for each source, LLM filter (actionable vs noise), routing into `cortex/recommendations.md` or domain-specific markdown.

**Privacy critical**: all sensitive data routes through local LLM only. No leak to OpenRouter for personal/health domains.

---

### Sprint 5.4 — "Live entity" UX (XL effort, vision)

**Why**: cortex-x as something Dave can talk to, not just CLI invocation. Voice interface, ambient memory, conversational recall.

**Scope**: Telegram + Whisper + local Hermes inference. "Hej cortex, co jsme řešili minulý týden o RELO?" → Hermes recall + response in operator's voice/style (post Sprint 4.4 LoRA).

**Deferred until**: Tier 1+2+3 fully shipped, Sprint 5.0+5.1+5.2+5.3 stable. This is the moonshot of moonshots.

---

## 6. What we are NOT doing (explicit non-goals)

| Direction | Why not |
|---|---|
| Multi-platform messaging gateway (NousResearch pattern) | cortex-x surface is GHA cron + CLI. Telegram/Discord = scope creep beyond agent — dev tool boundary. |
| Real-time visual workspace (agent-zero Universal Canvas) | Hermes is headless cron, no human in the loop during execution. Demo value, zero operational value for our usecase. |
| Full Linux container in Docker (agent-zero) | GitHub Actions ephemeral runners are already our Linux. Adding Docker = ops complexity for no capability gain. |
| Browser-specific abstractions (browser-harness CDP) | cortex-x is code-first, not UI-first. Tier 3 Sprint 4.6 covers UI verification narrowly via Playwright-MCP — that's enough. |
| Auto-merge Hermes PRs | MUST-H6 hardcoded forever. Humans always merge. |
| Self-modification of `bin/hermes/` core | EDIT_DENYLISTED catches this. Self-extending capabilities (Sprint 3.1) live in `cortex/agent-workspace/skill-experiments/`, not in `bin/hermes/_lib/`. Brain ≠ scratch pad. |

## 7. Per-sprint workflow (the ritual)

For every sprint above, the path from "planned" → "shipped on main" follows this ritual:

```
1. Pick sprint from roadmap (operator-initiated or harvester-suggested).
2. Dispatch focused web-research agent (R1) for SOTA-as-of-today.
3. Save research output to docs/research/<sprint>-<topic>-<date>.md (R1 evidence).
4. Operator + Claude-Code review research, decide go/no-go.
5. If go: Claude implements scope per spec.
6. Tests written WITH each module (no shipped code without test gate).
7. Full suite green locally.
8. Commit to feature branch.
9. Run 6-agent review pipeline (R2): acceptance + blind + correctness + security + ssot + edge-case.
10. All blocker findings closed.
11. Squash-merge to main with sprint commit message + MIGRATIONS.md entry.
12. Auto-memory entry capturing strategic state shift.
13. Roadmap updated: sprint marked ✅ shipped, downstream sprints unblocked.
```

This ritual is the **single most important rule of this roadmap**. Skipping any step turns the roadmap from "trustworthy plan" into "wish-list."

## 8. Mile-marker checks (every 4 weeks)

- **Week 4** (after Sprint 1.9 + 2.0 + 2.0b): observability dashboards live, spec-driven verification operational. Question: is the verification gap measurably closed?
- **Week 8** (after Sprint 2.1 + 2.2 + 2.3): multi-agent overnight burst running. Question: are we shipping ≥3 PRs/night reliably?
- **Week 12** (after Sprint 3.0 + 3.1 + 3.2 + 3.3): self-evolution operational. Question: are agent-authored prompts/skills measurably better than hand-tuned?
- **Week 20** (after Tier 3): client revenue + capability marketplace live. Question: is this distributable beyond Dave?

Miss a milestone? **Pause new sprints, do a retro, fix the ritual** before continuing.

## 9. References

- 2026-05-08 SOTA brainstorm research dispatch (in conversation context, archive recommended)
- 2026-05-08 4-source inspection research dispatch (in conversation context)
- VentureBeat Karpathy autoresearch (March 9, 2026): https://venturebeat.com/programming-development/andrej-karpathys-new-open-source-autoresearch
- GitHub Spec Kit: https://github.com/github/spec-kit
- AWS Kiro: https://kiro.dev/docs/specs/
- EvalAgent paper: https://arxiv.org/html/2510.24358v1
- Composio Agent Orchestrator: https://github.com/ComposioHQ/agent-orchestrator
- AlphaEvolve paper: https://arxiv.org/abs/2506.13131
- OpenEvolve: https://github.com/algorithmicsuperintelligence/openevolve
- ReasoningBank: https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/
- NousResearch/hermes-agent: https://github.com/nousresearch/hermes-agent
- agent0ai/agent-zero: https://github.com/agent0ai/agent-zero
- browser-use/browser-harness: https://github.com/browser-use/browser-harness

---

**This document is a living artifact. Update it on every sprint transition. Older versions live in git history.**
