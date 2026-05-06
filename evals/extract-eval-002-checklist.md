# Eval-002 — extraction checklist (when ready)

> When the eval-002 Claude session finishes (the one you started in temp dir), use this checklist to extract the 5 data points without needing me. Then paste the results back to me.

## Where to look

In the eval-002 session, gather:

### 1. Files + directories created
**How:** in the temp dir (`c:/tmp/eval-002-test/` or wherever you started), run:
```bash
ls -la
ls -la .claude 2>/dev/null
```
List everything that exists. Don't skip dotfiles.

### 2. Phase 2 research — ANO/NE?
**How:** scroll back in the eval-002 session transcript. Look for:
- Any `Agent` tool calls (with `subagent_type: general-purpose`) spawned in **parallel** (multiple in one assistant message)
- Files written to `$CORTEX_HOME/research/` during the session
- Mentions of "Phase 2" / "spawning research" / "parallel agents" in Claude's text output

If yes → list which agents (descriptions) and what topics
If no → write "NE, BAIL flow honored"

### 3. Cost estimate
**How:** in the eval-002 session check:
- The auto-orchestrate hint at top of session probably said `Session budget cap: $5.00` (no spend yet) or similar
- If you have CORTEX_BUDGET_DISABLED=1 set, no budget UI appeared (which is your case per memory)
- Rough estimate: count how many Agent calls Claude made × ~$0.30/agent typical

If no Agent calls → < $0.10 (just LLM turns + file writes)
If 1-2 Agent calls → ~$0.30-$0.80
If 3-4 parallel Agent calls (full Phase 2) → ~$1.20-$2.00

### 4. Q-flow — kde Claude zastavil?
**How:** scroll back in the eval-002 session. Did Claude:
- (a) Stop after Q1 answer (`skip` honored) — write "BAIL po Q1"
- (b) Continue to Q2 / Q3 / etc. asking more questions — write which Q reached
- (c) Skip Phase 1 entirely and go straight to scaffold — write "shortcircuit to scaffold"

### 5. Profile used
**How:** look in the scaffolded project:
- `package.json` deps tell you a lot — `astro` + `@astrojs/...` = astro-static profile
- `next` + `next/font` = nextjs-saas profile
- minimal HTML/CSS no framework = minimal profile
- If `.claude/cortex-source.yaml` or scaffold output text mentioned profile name explicitly → that's the answer

## Format to send me back

```
EVAL-002 RESULTS:

1. Files: <list>
2. Phase 2 research: ANO/NE — <details>
3. Cost: ~$<estimate> — <basis>
4. Q-flow: <BAIL po Q1 | continued to Q<N> | shortcircuit>
5. Profile: <astro-static | minimal | nextjs-saas | other>

Misc observations: <anything weird>
```

I'll then score against `evals/eval-002-scaffold-minimal-skip.md` rubric and write the real-execution result file. Takes ~2 min on my side once I have your data.

**No rush.** This can sit until tomorrow or whenever lasergame CI is fixed.
