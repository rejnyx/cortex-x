# Sprint 2.44 — Probe Verdict Matrix

> Empirical results of hook-compatibility probes, captured 2026-06-02 after
> workflow run `wf_d2f0c3a4-2c7` completed and the probe test was executed
> from the main loop. Companion to `docs/sprint-2.44-hook-probes.md` (which
> documents the hypotheses); this file documents the actual evidence.

## Probe 1 — `shared/hooks/post-tool-use.cjs` Task tool handling (isolated probe test)

`tests/integration/workflow-hook-compatibility.test.cjs` synthesizes the stdin
fixtures Claude Code would send to PostToolUse hooks when a Task tool fires.
All 4 cases passed:

### T1 verdict — ✅ PASS

Journal entry written on workflow subagent Task call (subagent_type=general-purpose).

```
✔ T1 — post-tool-use writes journal entry on workflow Task call (58.75ms)
```

Hook correctly extracts `tool_name=Task`, summary from `description`/`subagent_type`,
writes JSONL entry to `CORTEX_HOME/journal/YYYY-MM-DD-<slug>.jsonl`.

### T2 verdict — ✅ PASS

Review marker written when `subagent_type` matches the ROSTER (`subagent_type=blind-hunter`).

```
✔ T2 — post-tool-use writes review marker for ROSTER subagent (54.86ms)
```

Hook correctly resolves `subagent_type` against `shared/hooks/_lib/review-agents.cjs:REVIEW_AGENTS`
and writes the session-scoped marker file at `$OS_TMP/cortex-review-<sessionHash>.flag`.
This is the exact signal `pre-commit-review-gate` reads.

### T3 verdict — ✅ PASS

No review marker written for non-ROSTER subagent (`subagent_type=random-name-not-in-roster`).

```
✔ T3 — post-tool-use does NOT write review marker for non-ROSTER subagent (53.35ms)
```

Negative control — marker file does not exist after a Task call from an
arbitrary (non-cortex-review) subagent. The Set lookup against
`review-agents.cjs:REVIEW_AGENTS` is the gate.

### T4 verdict — ✅ PASS

Hook exits 0 on malformed stdin (`tool_input: null`, no required fields).

```
✔ T4 — post-tool-use exits 0 even on malformed stdin (fail-open contract) (53.59ms)
```

Fail-open contract holds. Hook catches all errors, exit 0, logs redacted line
to `.hook-errors.log`.

**Probe 1 verdict: HOOK CODE IS CORRECT.** The 4 cases prove that IF a Task
tool dispatch surfaces to PostToolUse, the cortex hook will handle it as
designed (journal entry + marker + budget).

## Probe 2 — `tools/workflow-compatibility-audit.cjs` static scan

```json
{
  "checks": [
    { "name": "post-tool-use detects tool_name=Task",                  "pass": true,  "evidence": "Task tool branch found in shared\\hooks\\post-tool-use.cjs" },
    { "name": "review-agents SSOT aligned with agents/*.md",           "pass": true,  "evidence": "ROSTER [blind-hunter, edge-case-hunter, acceptance-auditor, security-auditor, correctness-auditor, ssot-enforcer] is subset of 10 agent .md files" },
    { "name": "block-destructive registered for PreToolUse+Bash",      "pass": true,  "evidence": "block-destructive registered for matcher=Bash in C:\\Users\\david\\.claude\\settings.json" },
    { "name": "marker path SSOT (writer == reader)",                   "pass": true,  "evidence": "both files reference `cortex-review-` marker filename prefix" },
    { "name": "shared/workflows files present",                        "pass": true,  "evidence": "2 workflow file(s) in shared\\workflows" }
  ],
  "pass_count": 5,
  "fail_count": 0,
  "overall": "PASS"
}
```

**Probe 2 verdict: 5/5 PASS.** All static cortex-side preconditions for
workflow integration are met.

## Probe 3 — Empirical workflow runtime behavior (THE critical test)

This is what matters. Probe 1 + 2 confirm the cortex SIDE is wired correctly.
Probe 3 asks: does Claude Code's workflow runtime actually DISPATCH workflow
subagents through the Task tool that triggers PostToolUse?

### Test method

The workflow `wf_d2f0c3a4-2c7` ran 22 subagents on 2026-06-02 (5 research +
1 synthesis + 3 probes + 6 implementations + 6 R2 reviews + 1 Pass-2 = 22).

Each subagent should — if hooks fire — produce one PostToolUse Task entry
in `journal/2026-06-02-cortex-x.jsonl` with `tool=Task` and the agent's name
as `subagent_type`.

### Evidence

```bash
$ wc -l journal/2026-06-02-cortex-x.jsonl
305

$ grep -c '"tool":"Task"' journal/2026-06-02-cortex-x.jsonl
0
```

305 total entries (regular Read/Bash/Edit/Write tool calls from main session)
but **ZERO** entries with `tool=Task` from any of the 22 workflow subagents.

### Verdict — ❌ HOOKS DO NOT FIRE FOR WORKFLOW SUBAGENTS

Claude Code's dynamic workflow runtime uses an internal dispatch path that
**bypasses the settings.json hook stack**. The cortex hook layer is correctly
wired (proven by Probe 1) but it cannot observe workflow subagent activity
(proven by Probe 3).

**Confidence: HIGH (was MEDIUM in R1.2 web-research finding).** Direct
observation of journal silence after 22 workflow subagent dispatches.

**Matches R1.2 research evidence:** 4 GitHub issues report this same pattern
— #34692, #45427, #54898, #5812 — all about settings.json hooks failing to
propagate to subagent contexts.

## Combined implications

| Concern | Status |
|---|---|
| `post-tool-use` writes journal entry on workflow Task | NO — runtime bypasses |
| `block-destructive` intercepts workflow agent destructive Bash | NO — same bypass |
| `pre-commit-review-gate` sees marker from workflow review agents | NO — marker never written |
| `cortex-usage` telemetry sees workflow tool usage | NO — not journaled |
| `tirith-scan` scans untrusted content fetched by workflow Read | NO — not in PreToolUse pathway |

**Operational implications for workflow commits:**

1. Use `[skip-review]` in commit message OR `CORTEX_REVIEW_GATE=0` when
   workflow R2 is the only review.
2. Validate destructive operations INSIDE workflow scripts — string-level
   path containment, deny destructive Bash patterns in agent prompts.
3. Workflow runs don't show up in `cortex-usage` rollup — telemetry has a
   blind spot for workflow-driven activity.
4. `tirith-scan`'s prompt-injection defense doesn't extend to workflow
   agents reading untrusted content — fence with `<untrusted>` delimiters
   INSIDE workflow prompts.

## Sprint 2.44.1 follow-up

1. File Anthropic ticket re: hook propagation to workflow subagents (linked
   to existing GH issues #34692, #45427, #54898, #5812).
2. Design workflow-side observability shim: wrap every `agent()` call in
   a helper that emits a journal-compatible line via `Write` to the journal
   file (workflow has no fs access from script itself, but agents can
   `Write` to specific paths).
3. Add `cortex-doctor` check that warns operators about the workflow hook
   blind spot.
4. Build "Probe 2 reproducer" script — `block-destructive` empirical test
   inside a sandboxed workflow agent.

---

*All probes executed in main loop after workflow `wf_d2f0c3a4-2c7` completion.
Probe 1 test file: `tests/integration/workflow-hook-compatibility.test.cjs`.
Probe 2 audit script: `tools/workflow-compatibility-audit.cjs`.
Probe 3 evidence: direct grep of `journal/2026-06-02-cortex-x.jsonl`.*
