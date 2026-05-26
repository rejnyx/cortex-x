# Ralph variants — patterns + when each wins

> Companion to [`../SKILL.md`](../SKILL.md). Six documented Ralph patterns from Geoff Huntley's canonical posts, HumanLayer's production reports, and the Anthropic plugin source.

## 1 — Planner / Builder split (Huntley canonical)

Two prompt files, two phases. The split prevents the model from oscillating between "what to do" and "doing it" — each mode has one job.

### When it wins
- Long unstructured asks ("rebuild Tailscale into specs")
- Operator doesn't yet have a fix_plan, just a goal
- Reverse-engineering — needs spec extraction before any code

### `PROMPT_plan.md` (planner mode)

```markdown
# Ralph loop — planner mode

You are in PLANNER MODE. Do NOT implement. Do NOT touch source code.

Each iteration:
1. Read `fix_plan.md` + `specs/`
2. Read the codebase (search, don't assume)
3. Pick one of:
   (a) Add a new item to fix_plan.md if there's an obvious gap
   (b) Add a new spec file under specs/<name>.md if an item needs detail
   (c) Re-prioritize fix_plan.md (P0/P1/P2 tags) based on what you found
   (d) Close the loop: if fix_plan reaches target_item_count and every P0
       has a spec file, emit <promise>PLANNING_DONE</promise>

Run ONE of (a-d) per iteration. Commit the change. Exit.

NO source-code edits. The builder loop will handle implementation.
```

### `PROMPT_build.md` (builder mode)

The standard PROMPT.md template from [`../templates/PROMPT.template.md`](../templates/PROMPT.template.md). Activates only after planner emits `PLANNING_DONE`.

### Run sequence

```bash
RALPH_MODE=planner-only ./ralph.sh   # converge on the worklist
# review fix_plan.md + specs/
RALPH_MODE=builder-only ./ralph.sh   # implement
```

Or single-shell auto-switch: `RALPH_MODE=planner-then-builder` — the loop watches for `<promise>PLANNING_DONE</promise>` and swaps prompts.

---

## 2 — Verifier loop (Anthropic ralph-wiggum plugin, Dec 2025)

Anthropic shipped an official plugin that adds a **Stop hook** intercepting Claude Code's exit signal. The hook re-feeds the prompt until the model emits a specific completion-promise string.

### When it wins
- The acceptance criterion is a single concrete signal (test command exits 0, file matches snapshot, gh check passes)
- Operator wants `--completion-promise` semantics enforced by the harness, not the model

### Loop shape (verbatim Anthropic plugin)

```bash
claude --completion-promise "TASK_COMPLETE" --max-iterations 30 <<EOF
[your prompt]

When the test command exits 0, emit <promise>TASK_COMPLETE</promise> on a line by itself.
EOF
```

The Stop hook scans stdout for the exact string `<promise>TASK_COMPLETE</promise>` (or whatever was passed). If absent, hook re-injects the prompt for another iteration.

### Critique (HumanLayer)

> "Anthropic's plugin dies in cryptic ways and misses the key point of ralph which is not 'run forever' but in 'carve off small bits of work into independent context windows'."

cortex-x's `/ralph-loop` keeps the completion-promise pattern as an **optional** termination condition (Phase 5 §6) but doesn't make it the primary exit — `fix_plan.md` empty is.

---

## 3 — Spec-driven Ralph (Huntley's Nomad/Tailscale runs)

The `@specs/stdlib/*` directory holds extracted-and-curated specs. Each loop re-injects them — the model never re-derives interfaces from scratch.

### When it wins
- Cloning / reverse-engineering an existing system
- Keeping a long-running codebase consistent with a stdlib of contracts
- High-stakes domain code where interface drift = data corruption

### Anatomy

```
cortex/ralph/<usecase>/
├── PROMPT.md
├── fix_plan.md
├── ralph.sh
└── specs/
    ├── stdlib/
    │   ├── auth.md         # canonical interface for auth
    │   ├── storage.md      # canonical interface for storage
    │   └── http-client.md
    └── items/
        ├── 001-handler-x.md
        ├── 002-migrator-y.md
        └── 003-...
```

PROMPT.md re-injects `@specs/stdlib/*` at top of every iteration:

```markdown
Before doing anything, read these stdlib specs verbatim and treat them
as immutable contracts: @specs/stdlib/auth.md, @specs/stdlib/storage.md,
@specs/stdlib/http-client.md. Then read the item-specific spec from
specs/items/ pointed to by your current fix_plan item.
```

Huntley's report: *cloned HashiCorp Nomad and rebuilt Tailscale from specs in days, not years.* The spec re-injection is what made it stable.

---

## 4 — AFK Ralph (streaming JSON, unattended)

For overnight runs the operator isn't watching. Uses `--output-format stream-json` to pipe per-event JSON into a monitoring tool.

### When it wins
- Operator goes to sleep / weekend trip
- Want a dashboard / Slack alert rather than tailing logs

### Loop shape

```bash
# Spawn detached in tmux
tmux new-session -d -s ralph-<usecase> "cd cortex/ralph/<usecase> && ./ralph.sh"

# Operator attaches periodically
tmux a -t ralph-<usecase>     # attach
# (Ctrl+B then D to detach)

# Or pipe stream-json to a dashboard
tail -f cortex/ralph/<usecase>/iter-*.log | jq -c 'select(.type == "assistant" or .type == "result")' | …
```

Optional Slack/email alert when:
- iteration cost > $5
- consecutive_error_count >= 3
- exit_reason fires

### Anti-pattern
Don't AFK Ralph without:
- Set MAX_COST_USD (default $20 protects you)
- Test harness that catches regressions (no test = silent breakage on wake)
- Baseline commit known good

---

## 5 — TDD Ralph (failing-test as next-iteration signal)

The fix_plan item closes only when a specific failing test goes green. The loop is a TDD machine.

### When it wins
- The desired behavior is precisely expressible as a test
- You want each iteration's "done" signal to be unambiguous

### Item shape

```markdown
- [ ] [P0] User can reset password via email link
  - **Acceptance**: `npm test -- tests/auth/reset-password.test.cjs` exits 0
  - **Skeleton test** (operator writes this BEFORE the loop):
    ```js
    test('user resets password via email link', async () => {
      // arrange / act / assert that fails today
    });
    ```
```

PROMPT.md addendum for TDD mode:

```markdown
This loop runs TDD. For each item:
1. Verify the skeleton test exists at the path given in **Acceptance**
2. Run it — confirm it fails today (red baseline)
3. Implement until it goes green
4. Run the full suite to confirm no regression
5. Commit + check off
```

If the skeleton test doesn't exist, the item is malformed — append `> blocker: missing skeleton test` and exit.

---

## 6 — Subagent fanout Ralph (Huntley's reads-vs-writes rule)

Verbatim Huntley: *"up to 500 Sonnet subagents for searches/reads and only 1 Sonnet subagent for build/tests"*.

### When it wins
- Codebase is huge and the next item requires deep cross-file analysis
- You can parallelize the *understanding* phase but not the *writing* phase

### Anatomy

PROMPT.md addendum:

```markdown
You may spawn read-only subagents (Task tool, subagent_type=Explore) in
parallel — up to 500 concurrent — to search, grep, and analyze the
codebase. Use them aggressively before any edit.

When it's time to write or run tests, you have ONE writer subagent (or
just yourself). Never parallelize writes — too easy to corrupt the tree.
```

The "many readers, one writer" rule is a backpressure mechanism: reads are cheap and parallelizable; writes are expensive and serial. Mismatching the parallelism levels is how Ralph corrupts a codebase.

### Anti-pattern
Spawning subagents that *both* read AND write = race conditions, conflicting commits, broken HEAD. Don't.

---

## 7 — Hybrid stack (production default)

In practice elite operators don't pick one pattern — they stack them:

1. Start with **Planner / Builder split** (#1)
2. Author **specs/stdlib/** (#3) during planner phase
3. Switch to **Builder + TDD** (#5) with **Subagent fanout** (#6) for reads
4. Use **AFK Ralph** (#4) for overnight execution
5. Optionally add **verifier completion-promise** (#2) as a backup termination

cortex-x's `/ralph-loop` defaults to this hybrid stack. Operator can opt out of any layer with flags (`--no-planner`, `--no-specs`, `--no-subagents`).

## Cross-reference

- Termination conditions + circuit breakers → [`termination.md`](termination.md)
- Cost discipline + budget enforcement → [`cost-discipline.md`](cost-discipline.md)
- Runtime contract → [`../SKILL.md`](../SKILL.md)
