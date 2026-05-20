# Autonomous development playbook

> **Status:** v0 draft (2026-05-10) — DRAFT for operator review. Actual code-side guardrails (max-depth, wall-clock, dedup) ship in Sprint 2.13. Until then this document is **behavioral policy** for Claude Code sessions running cortex-x.

This is a minidoc for operators (and for Claude Code sessions reading their own project context) that codifies how to use cortex-x's autonomous capabilities responsibly. Grounded in the May 2026 deep-dive memo at `docs/research/autonomous-deep-dive-2026-05-10.md`.

---

## 1. When Claude Code may self-invoke commands autonomously

Claude Code has built-in mechanisms for an agent to schedule its own continuation:

- `Skill(loop)` — invoke a slash command on a fixed cadence or self-paced
- `ScheduleWakeup` — single delayed re-entry (cache-warm <300s, cold ≥300s)
- `Monitor` — event-driven wake from log lines, file changes, CI events
- `CronCreate` — cloud-side schedule (persists across session close)
- Subagent dispatch — synchronous fan-out via `Agent` tool

**Default rule:** Claude Code MAY use these autonomously when **all** of the following hold:

1. The user has indicated multi-step or autonomous-mode intent (auto-mode, `/loop`, "run autonomously", "několik hodin")
2. The task is genuinely waiting on **external state** (CI run, build, dependent process), not on local computation
3. The task fits one of the 4 cases in §2 below
4. The 4 hard guardrails in §3 below are honored

**Anti-rule:** Claude Code MUST NOT self-invoke when:

- The same answer could be computed inline by reading files / running a command directly
- The user is actively conversing — re-entry interrupts that flow
- It's a trivial polling loop on an unbounded condition (hide the bug, don't paper it over)
- Recursion depth would exceed 3 (see §3)

---

## 2. Decision tree — which mechanism to use

| Situation | Mechanism | Example |
|---|---|---|
| External state changes you cannot observe inline | `ScheduleWakeup` single delay | Long `npm test` running → sleep 270s, check exit code |
| Recurring check on bounded interval | `Skill(loop)` fixed mode | `/loop check the deploy every 5m` (max 6 beats unless user says otherwise) |
| Indeterminate "come back when ready" | `Skill(loop)` dynamic mode | "Watch for the CI run to land," LLM picks delay |
| Truly daily/weekly cadence beyond session lifetime | `CronCreate` (cloud) or GitHub Actions cron | Steward action_kinds (already wired) |
| Independent subtask with discardable context | `Agent` subagent dispatch | "Audit X while I do Y" |
| Inline-answerable | **DO NOT self-invoke** — just compute it | "What does function X return?" — read the file |

**Cache-aware delay choices** (anthropic prompt cache TTL = 5 min default):

- **Under 270s:** cache stays warm, cheap to wake
- **300–1200s:** pay cache miss; only worth it if real wait
- **1200s+:** true idle, default for "check back later" or daily polling
- **NEVER pick exactly 300s** — worst-of-both: pay miss without amortizing

---

## 3. The four hard guardrails (currently behavioral; codified in Sprint 2.13)

1. **Max recursion depth: 3.** Self-invocation chain ≤ 3 levels deep. Beyond depth 3, error compounding (~17× per "bag of agents" study) dominates any reasoning gain.
2. **Wall-clock cap per chain: 30 minutes.** If a self-paced loop accumulates >30 min wall-clock without operator interaction, halt and surface the unresolved state.
3. **Dedup window:** identical (skill, args) signature blocked within last 3 turns. Prevents the "47 identical calls burning $12" failure mode (pydantic-deep case study).
4. **Cost gate:** existing `STEWARD_DAILY_USD_CAP` ($10), `STEWARD_WEEKLY_USD_CAP` ($25), `STEWARD_MONTHLY_USD_CAP` ($80), and `STEWARD_TOKEN_VELOCITY_CAP` (50K/5min) apply across self-invocations exactly as they apply to direct runs.

**No self-invocation inside a sub-agent.** Hub-and-spoke topology only. Sub-agents return; they don't recurse. (Claude Code's `chat.subagents.allowInvocationsFromSubagents` is opt-in *precisely because of runaway risk*.)

---

## 4. Research-when-uncertain rule (Sprint 2.14 — code-enforced)

The cortex-x R1 principle ("research-before-implement is mandatory") covers sprint-kickoff scale. The **mid-session uncertainty trigger** is the gap. Conservative rule:

**FIRE WebSearch / WebFetch when:**

1. **Current-API-docs uncertain** — user mentions a framework with a version, or you're about to use an SDK whose signature you're not sure about
2. **Architectural / taxonomy decision** — a load-bearing choice (folder structure, naming, framework selection)
3. **Security advisory check** — any dependency add/upgrade, any auth/crypto/CORS code change
4. **Public-facing identifier** — CLI flag, config key, API path that operators will type for years

**DO NOT fire when:**

- Trivia (syntax, language built-ins, well-known patterns)
- Question is answerable from current repo files
- An existing R1 memo in `docs/research/` already covers it
- The cortex-x cache at `~/.claude/cache/research/` has a fresh hit

**Cost ceiling:** $0.50/day per session. Stop researching past that point.

**Cache:** 7-day TTL default (`~/.claude/cache/research/`), with overrides:
- `security_advisory`: 1 day (CVE feeds change fast)
- `api_docs`: 14 days
- `taxonomy`: 90 days

---

## 5. Telemetry contract

Every self-invocation **must** be auditable:

- Each `Skill(loop)` / `ScheduleWakeup` / subagent dispatch writes a journal entry under `cortex/journal/`
- `cortex-steward status --self-invocations` (forthcoming, Sprint 2.13) renders the chain
- Halt-file killswitch (`STEWARD_HALT`) is honored at every wake-up, no exceptions

If you self-invoke without a journal entry, that's a bug.

---

## 6. Worked examples (real cortex-x sessions)

### 6.1 CI-check polling (good)

User: "check the CI run conclusion for commit 7f6c3c6 and report final status"

Right approach:
- Single inline `gh run list` first; if pending, **single** `ScheduleWakeup` 270s; on wake, check again; if still pending, second `ScheduleWakeup` 600s with hard 4-attempt cap.
- Wrong approach: `/loop check the CI every 1m` — burns cache, polls 30× for a 15-minute run, $0.50 wasted.

### 6.2 Long npm test wait (good)

Inline: kick off `npm test` in background, then `ScheduleWakeup` once at 270s (typical green run). On wake, read exit. If still running, `ScheduleWakeup` 270s again with max 3 beats.

### 6.3 Autoresearch overnight burst (good)

Cortex's existing `recommendation_harvest` action_kind dispatches sibling research agents on a fixed nightly cron — that's the Skill(loop)-dynamic equivalent at the cron level, not session level. Stay there. Don't replicate inside a single Claude Code session.

### 6.4 ANTI-EXAMPLE: re-running detectors that finished

Wrong: `/loop run detectors every 5m` to "make sure nothing changed."
Right: detectors are deterministic; if you ran them and got a result, trust it for the session. Re-run only on explicit user request or when a file the detector reads has been modified.

### 6.5 ANTI-EXAMPLE: subagent dispatch for trivia

Wrong: spawning a `general-purpose` subagent to read a single file you could `Read` directly. Subagents cost ~7× the tokens of inline tool use (Nimbalyst 2026); reserve them for parallel + discardable + isolated-tool-set work.

---

## 7. When to break these rules

- **Operator explicit override:** "ignore the playbook, just keep polling" wins. The playbook is *defaults*, not laws.
- **Research-trigger overrides:** if the operator says "don't research this," respect it. If the operator says "research this thoroughly," ignore the daily cap.
- **Wall-clock cap:** if the operator says "run for the next 4 hours autonomously," the 30-min default no longer applies; instead, log progress every 30 min so the operator can verify when they return.

---

## 8. Status — what is code-enforced vs behavioral

| Guardrail | Status | Reference |
|---|---|---|
| Max recursion depth: 3 | ✅ code-enforced (Sprint 2.13) | `bin/steward/_lib/self-invocation.cjs` `MAX_DEPTH_EXCEEDED` |
| Wall-clock cap per chain: 30 minutes | ✅ code-enforced (Sprint 2.13) | `WALL_CLOCK_EXCEEDED` |
| Dedup window: identical (skill, args) blocked within 3 turns | ✅ code-enforced (Sprint 2.13) | `DEDUP_BLOCKED` |
| Intra-run loop detection (3 patterns) | ✅ code-enforced (Sprint 2.12) | `bin/steward/_lib/loop-detector.cjs` |
| Cost gate (daily $10 / weekly $25 / monthly $80) | ✅ code-enforced (Sprint 1.6.19 + 1.9.1) | `bin/steward/_lib/cost-safety.cjs` |
| `cortex-steward status --self-invocations` chain tree | ✅ shipped (Sprint 2.13) | `bin/steward/status.cjs` |
| Research-when-uncertain trigger rule (§4) | ✅ code-enforced (Sprint 2.14) | `bin/steward/_lib/research-trigger.cjs` `shouldResearch()` |
| Multi-action checkpoint primitive | ⏳ Sprint 3.x | prerequisite to 4h+ sessions |
| Plan-mode-nudge primitive (`STEWARD_PAUSE`) | ⏳ Sprint 4.x | prerequisite to 10h sessions |

**Sprint 2.13 makes the §3 rules code-enforced contract**, not just behavioral policy. Code-enforcement gates fire even if the operator forgets the playbook; behavioral policy still applies for items not yet in the table (research trigger, plan-mode-nudge).

Persistence: each invocation event lands in `$CORTEX_DATA_HOME/self-invocations/<slug>.jsonl` (cross-session readable). Inspect via `cortex-steward status --slug=<slug> --self-invocations`.
