<!-- SPDX-License-Identifier: Apache-2.0 -->

# Sprint 2.44 Hook Compatibility Probes (2026-06-02)

## Background

Cortex-x ships three load-bearing safety/observability mechanics that depend on Claude Code's hook contract: (1) `block-destructive` as PreToolUse Bash matcher, (2) `post-tool-use` budget + review marker writer keyed on Task tool calls, and (3) `pre-commit-review-gate` reading the review-marker sentinel. The atlas (`docs/atlas-2026-06-01.md` §11 "Cortex Gotchas") flags that the Sprint 2.43 workflow subagents (orchestrator-dispatched agents via `shared/workflows/`) have not been audit-verified against the hook contract — only the legacy Task-tool subagent path has explicit fixture coverage.

Anthropic's Claude Code documentation states that **subagents inherit the parent's tool allowlist** (which gates *which* tools a subagent can call) and that **File edits are auto-approved in subagent context** (implying that permission-mode gating may behave differently in subagent dispatch than in the main session). The interaction between these two facts and our hook layer is unverified:

- Permission gating (allowlist + `acceptEdits` mode) ≠ hook firing. Hooks fire on tool *calls*; permissions decide whether the call is *allowed*. Whether workflow subagents preserve this separation is the empirical question.
- The atlas notes that `post-tool-use.cjs` line 112-113 handles `tool_name === 'Task'` specifically, and the review marker logic (line 256-257) is keyed on `tool_input.subagent_type` matching the SSOT list in `shared/hooks/_lib/review-agents.cjs`. If workflow subagents dispatch via a different tool name (e.g., `WorkflowAgent` or a renamed internal), the marker writer is silently bypassed.
- Budget recording at line 307 covers `Task / Agent / WebSearch / WebFetch`. Same risk: a renamed dispatch tool drops out of budget tracking.

These three probes pin down whether the existing hook stack covers workflow subagents or whether Sprint 2.44.1 needs to ship a compatibility layer **before** any further workflow expansion lands.

References: Anthropic Claude Code docs on subagents and hooks at https://docs.claude.com/en/docs/claude-code/sub-agents and https://docs.claude.com/en/docs/claude-code/hooks .

---

## Probe 1: Do hooks fire on workflow subagent tool calls?

**Hypothesis:** YES — workflow subagent tool calls trigger PreToolUse and PostToolUse hooks identically to legacy Task-tool subagent calls.

**Confidence: HIGH (~85%)**

Grounded in code inspection:
- `shared/hooks/post-tool-use.cjs` line 112-113: the hook explicitly handles `tool_name === 'Task'` and assumes Claude Code emits the standard stdin contract for Task tool invocations.
- Line 256-257: review marker logic is keyed on `tool_input.subagent_type` matching the SSOT list in `shared/hooks/_lib/review-agents.cjs`. If workflow subagents dispatch via the same Task-tool internal machinery and preserve `subagent_type` in `tool_input`, this code path activates unchanged.
- Line 307: budget recording covers `Task / Agent / WebSearch / WebFetch`. The presence of both `Task` and `Agent` suggests the existing code already handles at least two dispatch tool-name variants.

**Reasoning for HIGH not VERY-HIGH:** the 15% gap is the possibility that workflow subagents use a fully new dispatch tool name (e.g., `WorkflowDispatch`) that doesn't match any current matcher, or that they bypass the tool-call event emitter entirely (unlikely per Anthropic docs — hooks are described as universal across tool calls).

### Test design

Synthesize three fixture stdin payloads matching the Claude Code PostToolUse hook contract for Task tool, run `shared/hooks/post-tool-use.cjs` as a child process with each fixture piped to stdin, assert side effects on the OS temp directory and journal.

- **T1 — Legacy Task subagent baseline.** Fixture: `tool_name: "Task"`, `tool_input: { subagent_type: "blind-hunter", description: "..." }`, `tool_response: { ok: true }`, session metadata matching contract. Expect: review marker written to `OS_TMP/cortex-review-<sessionHash>.flag`; budget entry appended; exit 0.
- **T2 — Workflow review subagent (hypothesis target).** Fixture: same shape as T1 but with `tool_input.subagent_type: "security-auditor"` and an additional `tool_input.workflow_id: "r2-review"` field to simulate workflow context. Expect: marker written with `security-auditor` subagent type recorded; if hook ignores `workflow_id` cleanly, hypothesis confirmed.
- **T3 — Workflow non-review subagent.** Fixture: `tool_input.subagent_type: "edge-case-hunter"` with workflow context. Expect: marker written (edge-case-hunter is in the review SSOT); budget entry; exit 0.

Assertions:
1. Marker file exists at the expected path after each invocation.
2. Marker contents include the subagent_type value.
3. Budget journal records the call with non-zero cost estimate.
4. Hook exits 0 (non-blocking) in all three cases.

### Workaround if disproven

If the hypothesis fails (hooks do NOT fire on workflow subagent tool calls):
- `shared/workflows/r2-review.js` and other workflow scripts manually invoke a sentinel touch as the **last action of the workflow**, writing `OS_TMP/cortex-review-<sessionHash>.flag` directly to satisfy `pre-commit-review-gate`.
- Add Sprint 2.44.1 backlog item: refactor workflow dispatch to emit synthetic PostToolUse events, or extend `pre-commit-review-gate` to also accept workflow-output markers via a parallel sentinel path.

---

## Probe 2: Does `block-destructive` intercept workflow agent destructive bash?

**Hypothesis:** YES — `block-destructive` fires on workflow subagent Bash calls and blocks destructive commands.

**Confidence: MEDIUM (~65%)**

Reasoning:
- `block-destructive` is registered as **PreToolUse** with **Bash matcher**. Per Anthropic docs, hooks fire on tool calls regardless of permission mode — the permission system decides *if* the tool runs, but the hook event is emitted before the permission decision and is independent of the allowlist.
- The MEDIUM (~65%) confidence reflects the documented Anthropic behavior that **subagents auto-approve File edits** — this language is ambiguous about whether the auto-approval *bypasses hooks* or merely *bypasses interactive permission prompts*. If hooks are bypassed in subagent context, `block-destructive` is silently neutered for workflow subagents — a CRITICAL security gap.
- The atlas does not currently cover this — Sprint 2.44 Probe 2 is the canonical answer.

### Test design

Write a minimal probe workflow (one agent, one Bash call) that attempts a destructive-looking but actually safe command:

```
Bash: echo "PROBE rm -rf /tmp/nonexistent"
```

The `echo` prefix prevents actual filesystem harm — the regex matcher in `block-destructive` is expected to match `rm -rf /` anywhere in the command string (false-positive-by-design for safety). If the workflow agent's call is intercepted, the Bash tool returns a denial; if it executes, the echo runs harmlessly and `PROBE rm -rf /tmp/nonexistent` is captured in tool output.

Procedure:
1. Spawn a fresh workflow with `shared/workflows/probe-destructive.js` (one-shot, single agent).
2. Agent prompt: "Run the bash command `echo 'PROBE rm -rf /tmp/nonexistent'` exactly once."
3. Capture the agent's tool call result.
4. Assert:
   - If `block-destructive` fired: tool response includes the canonical denial message from `shared/hooks/block-destructive.cjs`; hypothesis confirmed.
   - If the echo executed normally and stdout contains `PROBE rm -rf /tmp/nonexistent`: hypothesis disproven; CRITICAL security gap.

### Workaround if disproven

**Sprint 2.44.1 MANDATORY** if disproven. CRITICAL security gap mitigation:
- Extend `shared/hooks/post-tool-use.cjs` to also enforce the `block-destructive` regex set as **post-hoc detection** on PostToolUse Bash events.
- On post-hoc match: write a `STEWARD_HALT`-style file sentinel (`OS_TMP/cortex-destructive-detected-<sessionHash>.flag`) and emit a loud journal entry.
- Add a halt-check in the next workflow phase (or any subsequent Steward iteration) that aborts on sentinel presence.
- Document the gap loudly in `standards/security.md` and the atlas until Anthropic ships a PreToolUse subagent hook fix.
- Optional defense-in-depth: prepend a synthetic "destructive intent guard" as the first prompt token in every workflow subagent system prompt, instructing the model to refuse any `rm -rf`, `git push --force`, `DROP TABLE`, etc. Soft mitigation but reduces blast radius.

---

## Probe 3: Does `pre-commit-review-gate` see review marker from workflow review-agents?

**Hypothesis:** YES — the review marker written by `post-tool-use` is visible to `pre-commit-review-gate` in the same session.

**Confidence: HIGH (~80%)**

Reasoning:
- The marker is written by `post-tool-use.cjs` based on Task tool subagent_type (line 256-257). If Probe 1 confirms hooks fire on workflow subagents AND `subagent_type` is preserved in `tool_input`, the marker writes happen.
- `pre-commit-review-gate` reads the marker from `OS_TMP/cortex-review-<sessionHash>.flag`. Same session = same hash = marker visible.
- The 20% gap is the dependency on Probe 1: if Probe 1 fails, Probe 3 fails by transitivity. The independent risk is that `pre-commit-review-gate` reads from a *different* path computation than `post-tool-use` writes to — possible if there's a session-hash drift between hook invocations (e.g., one uses `sessionId`, the other uses a hash of CWD + sessionId).

### Test design

Probe 1 test cases T2 and T3 already cover this. After T2/T3 run, invoke `shared/hooks/pre-commit-review-gate.cjs` with a matching session-hash stdin payload and assert:
1. Hook exits 0 (gate passes — marker found).
2. Hook stdout/stderr does NOT include the "missing review marker" warning.

If marker path computation drifts between `post-tool-use` (writer) and `pre-commit-review-gate` (reader), the gate will report missing-marker even though the file exists on disk — surfaceable by a `ls OS_TMP/cortex-review-*.flag` check between the two hook invocations.

### Workaround if disproven

- `shared/workflows/r2-review.js` manually touches the marker file at the end of the Review phase, using whatever path computation `pre-commit-review-gate` uses (canonicalize via shared helper in `shared/hooks/_lib/`).
- Alternative: add a `cortex-review-completed` log line to workflow stdout that satisfies the gate via grep-based fallback (less robust than file sentinel).
- Sprint 2.44.1 backlog item: extract session-hash computation to a single SSOT module in `shared/hooks/_lib/session-hash.cjs` and have all three hooks consume it (eliminates drift class entirely).

---

## Composite verdict

**Status: TBD** — filled in after Probes 1-3 run in the main Sprint 2.44 loop.

Template structure for the verdict (to be filled in):

- **Probe 1 result:** PASS / FAIL — _evidence_
- **Probe 2 result:** PASS / FAIL — _evidence_
- **Probe 3 result:** PASS / FAIL — _evidence_
- **Composite:** Workflow subagents are / are NOT hook-compatible.
- **Sprint 2.44.1 required:** YES / NO — _scope_

## Sprint 2.44.1 backlog (conditional)

Items below activate if the corresponding probe is disproven:

- **If Probe 1 fails:** Manual marker-touch in `shared/workflows/*.js` end-of-phase; OR extend dispatch tool-name matcher in `post-tool-use.cjs`; OR refactor workflows to emit synthetic PostToolUse events.
- **If Probe 2 fails — CRITICAL:** Post-hoc destructive-detection in `post-tool-use.cjs`; `STEWARD_HALT`-style sentinel; defense-in-depth prompt guards in every workflow subagent system prompt; documentation update in `standards/security.md` + atlas.
- **If Probe 3 fails:** Session-hash SSOT extraction to `shared/hooks/_lib/session-hash.cjs`; OR manual marker-touch in r2-review workflow; OR grep-based fallback in `pre-commit-review-gate`.
- **Regardless:** Add Probe 1/2/3 as permanent regression fixtures under `tests/contract/hook-workflow-compat/` so future workflow expansions don't silently break the hook contract.

## References

- `docs/atlas-2026-06-01.md` §11 "Cortex Gotchas" — the three gotchas this sprint addresses.
- `shared/hooks/post-tool-use.cjs` lines 112-113 (Task tool handler), 256-257 (review marker writer keyed on `subagent_type`), 307 (budget recording for `Task / Agent / WebSearch / WebFetch`).
- `shared/hooks/_lib/review-agents.cjs` — SSOT list of review-agent `subagent_type` values that trigger the marker.
- `shared/hooks/block-destructive.cjs` — PreToolUse Bash matcher with destructive-command regex set.
- `shared/hooks/pre-commit-review-gate.cjs` — marker reader; consumes `OS_TMP/cortex-review-<sessionHash>.flag`.
- Anthropic Claude Code subagents docs: https://docs.claude.com/en/docs/claude-code/sub-agents
- Anthropic Claude Code hooks docs: https://docs.claude.com/en/docs/claude-code/hooks
- Sprint 2.43 workflow subagent ship notes (see PROGRESS.md).
