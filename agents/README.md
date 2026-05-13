# agents/

Specialized review-pipeline + planning subagents shipped to `~/.claude/agents/` by the installer. Each agent has a narrow lens; you compose them in parallel for code review (typically 6 in parallel after a non-trivial diff).

**Voice charter:** all agents in this directory respect [`standards/voice.md`](../standards/voice.md) when surfacing findings — no emotion words, no greetings, `[cortex/<event>]` structural prefix for load-bearing signals, `[^cN]` footnote citations for any claim grounded in memory. Severity emoji (✅/⚠️/🔴/🟠/🟡/🔵) are allowed as structural status markers in report tables; not as preambles.

## Review pipeline (parallel)

| Agent | Lens | When to invoke |
|---|---|---|
| [`acceptance-auditor.md`](./acceptance-auditor.md) | Story / spec / PROGRESS.md acceptance criteria | After implementing a story — does the diff do what was asked? |
| [`blind-hunter.md`](./blind-hunter.md) | Pure diff review, NO project context | Always. Catches bugs context-aware reviewers rationalize away. |
| [`correctness-auditor.md`](./correctness-auditor.md) | Trust-boundary validation, property tests, eval coverage, mutation-score drift | After changes to load-bearing modules (verifiers, parsers, schemas). |
| [`security-auditor.md`](./security-auditor.md) | OWASP 8-layer + Layer 9 (agentic security — lethal trifecta, 7 MUST patterns) | Always on PRs touching auth, network, secrets, LLM I/O. |
| [`ssot-enforcer.md`](./ssot-enforcer.md) | Duplicated constants, drift candidates, Rule of Three trips | On every diff. Cheap, catches a lot. |
| [`edge-case-hunter.md`](./edge-case-hunter.md) | Branching paths + boundary conditions | After a non-trivial diff; pairs well with blind-hunter. |

## Planning + reflection

| Agent | Purpose |
|---|---|
| [`planner.md`](./planner.md) | Picks 3-5 research topics from {profile} × {concern} matrix for parallel R1 dispatch (Phase 5 Adapt / Phase 4 Audit). |
| [`synthesizer.md`](./synthesizer.md) | Reads R1 outputs, writes per-project `recommendations.md` + appends § Stack reality check to `CLAUDE.md`. Enforces three-hop citation traceability. |
| [`cortex-thinker.md`](./cortex-thinker.md) | Cross-project pattern reflection. Invoked at SessionStart, Stop events, or `/cortex-reflect`. Grounds every insight in a file path. |

## Invocation pattern

```text
# 6-agent parallel review after a feature commit
Send one message with 6 Agent tool calls — they run concurrently.
Each returns ≤500 word findings; you triage by severity (BLOCK / HIGH / MED / LOW)
and fix pre-merge.
```

The R1+R2+R3 discipline in CLAUDE.md is: **research before implement → review pipeline mandatory → one incident = one defense layer + one regression test**. These agents are R2.
