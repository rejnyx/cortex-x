# Termination — 7 exit conditions + 6 circuit breakers + completion-promise

> Companion to [`../SKILL.md`](../SKILL.md). The hardest part of running Ralph is **stopping** it. Bad termination = silent budget burn. This document is the contract the wrapper enforces.

## The 7 exit conditions (priority order)

`ralph.sh` and `ralph.ps1` check these between iterations. The loop stops on the FIRST one that fires.

### 1 — `STEWARD_HALT` killswitch
**File**: `~/.cortex/STEWARD_HALT`
**Why**: operator panic-button. Stops ALL cortex-managed loops (Steward, Ralph, future agents).
**Detection**: `[ -f ~/.cortex/STEWARD_HALT ]` per iteration
**Exit code**: 0 (intentional stop, not a failure)
**Operator command**: `touch ~/.cortex/STEWARD_HALT` (PowerShell: `New-Item -ItemType File -Force "$env:USERPROFILE\.cortex\STEWARD_HALT"`)
**Reset**: `rm ~/.cortex/STEWARD_HALT`

### 2 — Max iterations
**Cap**: `MAX_ITERATIONS` (default 50)
**Why**: hard ceiling on loop count regardless of cost or time
**Detection**: `[ $iter -ge $MAX_ITERATIONS ]`
**Exit code**: 0
**Tune**: raise for known-good prompts, lower for risky ones. Above 200 the skill refuses to scaffold.

### 3 — Max wall-clock hours
**Cap**: `MAX_HOURS` (default 8 — one overnight)
**Why**: prevent runaway loop on a stuck iteration
**Detection**: `(now - start_epoch) / 3600 >= MAX_HOURS`
**Exit code**: 0
**Tune**: lower to 1–2h for daytime ad-hoc loops, raise to 12h for weekend runs

### 4 — Max cost USD
**Cap**: `MAX_COST_USD` (default $20 per run)
**Why**: per-run budget independent of Steward's daily/weekly/monthly caps
**Detection**: sum of `iter_cost_usd` from `journal.jsonl` ≥ `MAX_COST_USD`
**Exit code**: 0
**Tune**: $5 for cheap exploratory, $20 default overnight, $50 for big sweeps (operator must explicitly opt in)
**Note**: This is a per-RUN ceiling. Steward's `STEWARD_DAILY_USD_CAP` ($5 default) is a separate per-DAY ceiling across all cortex spend. Ralph respects both.

### 5 — `fix_plan.md` empty (primary success exit)
**Detection**: `! grep -q '^- \[ \]' fix_plan.md`
**Why**: the worklist is done. This is the happy path.
**Exit code**: 0
**Reporting**: `REPORT.md` lists items closed and run-wide cost / time

### 6 — Completion-promise string (optional)
**Detection**: a line matching `<promise>STRING</promise>` in iteration stdout
**Why**: opt-in Anthropic plugin-compatible termination
**Default**: disabled. Operator can set `COMPLETION_PROMISE="TASK_COMPLETE"` to enable.
**Exit code**: 0
**Anti-pattern**: relying on string-match alone. Always pair with `MAX_ITERATIONS`.

### 7 — Mode = `single-pass`
**Detection**: `RALPH_MODE=single-pass` env var
**Why**: smoke-test mode. Run one iteration, exit.
**Exit code**: 0
**Use BEFORE**: any long run. Always single-pass first to validate the prompt + artifacts work end-to-end.

## The 6 circuit breakers

Circuit breakers fire when the loop is **technically still under caps but practically stuck**. They prevent budget waste on a broken iteration that keeps looking like progress.

### CB-1 — `NO_PROGRESS`
**Trigger**: 3+ consecutive iterations with `items_closed == 0` and `items_added == 0`
**Why**: the loop is spinning without changing the worklist. Almost always means an ambiguous prompt or a misconfigured test harness.
**Recovery**: operator reads `fix_plan.md` for `> blocker:` notes, edits the prompt or item, re-runs

### CB-2 — `STUCK_ERROR`
**Trigger**: 5+ identical error signatures in `journal.jsonl` (`error_sig = last error/failed/exception line of iter log, head 200 chars`)
**Why**: same exception repeating means the model can't escape a code path
**Recovery**: operator reads the iter logs, fixes the root cause manually, re-runs

### CB-3 — `CORRUPTION`
**Trigger**: 2+ consecutive iterations with `git reset --hard` detected in stdout
**Why**: the model is panic-resetting. Tree is in a state the model can't recover from.
**Recovery**: `git reset --hard <baseline-sha>` + investigate why iteration N broke the tree

### CB-4 — `COST_VELOCITY`
**Trigger**: average `iter_cost_usd` over last 5 iterations × remaining MAX_ITERATIONS > MAX_COST_USD
**Why**: extrapolated spend will blow the cap before iter count does
**Recovery**: operator lowers MAX_ITERATIONS, switches to cheaper model, or scopes fix_plan smaller

### CB-5 — `ITER_TIMEOUT`
**Trigger**: single iteration exceeds 60min (MODEL stuck on a tool call or in a tight subagent loop)
**Why**: most iterations should complete in 3–15min; 60min means something is wrong
**Recovery**: kill the iteration, re-run with `RALPH_MODE=single-pass` to reproduce, then debug

### CB-6 — `EMPTY_OUTPUT`
**Trigger**: 3+ consecutive iterations where `journal.jsonl` shows `items_closed == 0` AND `items_added == 0` AND iter_log is < 1KB
**Why**: model is exiting immediately. Usually means the prompt is malformed or the model can't find fix_plan.md.
**Recovery**: validate paths, check `PROMPT.md` is loading correctly, re-run single-pass

## Completion-promise format (when used)

When the operator enables `COMPLETION_PROMISE="X"`, the wrapper scans iteration stdout line-by-line for an exact match against:

```
<promise>X</promise>
```

The match must be on a line by itself (anchored regex `^<promise>X</promise>$`). Embedded matches in prose don't trigger exit.

### Why exact + anchored
- Prevents false-positive when model discusses the promise format in prose
- Aligns with Anthropic plugin's parser

### When NOT to use completion-promise
- Long worklists (fix_plan empty is the natural signal)
- Multi-item runs (one promise can't represent N closures)
- Untrusted prompts (model can be coerced into emitting the promise prematurely)

Stick with `fix_plan.md` empty as the primary success exit. Completion-promise is a niche tool for single-task verifier loops.

## Exit code semantics

The wrapper script exits with:
- `0` for clean termination (any of the 7 conditions, or any circuit breaker)
- `2` for pre-flight failures (missing PROMPT.md / claude CLI / dirty tree)
- `130` if killed by SIGINT (Ctrl+C)

CI/CD callers can `&&`-chain on exit 0 to trigger post-run verification + R2 review + PR open.

## What the wrapper writes when it exits

1. Final `journal.jsonl` line with `"exit_reason"` field
2. `REPORT.md` rendered from the run-summary template
3. `STATUS` symlink left pointing at the last iteration's log (for postmortem)
4. `COST` file with the final total

Operator picks up from `REPORT.md` and the post-loop verification phase (see SKILL.md § Phase 6).

## Cross-reference

- Cost discipline + per-iteration caps → [`cost-discipline.md`](cost-discipline.md)
- Ralph variant patterns → [`patterns.md`](patterns.md)
- Runtime phases → [`../SKILL.md`](../SKILL.md)
