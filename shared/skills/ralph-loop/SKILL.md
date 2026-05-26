---
name: ralph-loop
description: Scaffolds and runs a Ralph Wiggum loop — Geoff Huntley's "stupid simple while-loop" pattern for autonomous overnight coding sessions. Authors PROMPT.md + fix_plan.md + ralph.sh, gates them through a plan review, then runs `while: cat PROMPT.md | claude -p` in a fresh context window per iteration (defeats compaction + context-rot). Useful for long worklists with clear acceptance criteria (test suite passes, fix_plan items checked off), reverse-engineering, spec-driven refactors, "fix all the failing crons overnight" sweeps. Composes with `/cortex-goal` — Ralph is the third option alongside native `/loop` (interval-based) + `/goal` (haiku-verifier). Inherits cortex-x R1+R2 discipline, cost ceilings, and the operator killswitch file. Triggers (EN+CZ) "/ralph-loop", "/ralph", "ralph wiggum", "run ralph", "spusť ralph", "loop until done", "loop dokud nebude hotovo", "overnight loop", "autonomous overnight", "fix all X until tests pass", "oprav všechny X dokud projdou testy", "vibe-clone".
disable-model-invocation: false
---

# /ralph-loop — Ralph Wiggum autonomous loop scaffolder + runner

> **Status: v0-experimental (2026-05-25).** The R2 security review flagged this skill as carrying the canonical lethal-trifecta blueprint when run with `--dangerously-skip-permissions`. Do not run on production code or any repo where you cannot `git reset --hard` to recover. See [§ Known risks v0](#known-risks-v0) at the bottom of this document. Hardened path forward in [`references/cost-discipline.md`](references/cost-discipline.md) § Roadmap.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, counts-not-praise. When invoked you are scaffolding a real shell loop that will spend real money — observe + tune, not perform.

Grounded in Geoff Huntley's June 2025 pattern (`ghuntley.com/ralph/`) and the HumanLayer post-mortems. Key insight: a one-line shell loop with a fresh context window per iteration outperforms multi-agent orchestration on convergent worklists because it defeats compaction and context-rot. The skill is mostly *discipline*, not code — the loop itself is 3 lines of bash.

## When to invoke

- `/ralph-loop` or `/ralph` explicit invocation
- "loop until done" / "loop dokud nebude hotovo"
- "overnight" / "autonomous overnight" / "weekend run" / "běhej v noci"
- "fix all X until tests pass" / "oprav všechny X" / "ship them all"
- "vibe-clone" / "reverse-engineer X into specs"
- After an audit produces a long fix_plan and the operator wants it done overnight

**Don't invoke** for:
- Single-shot tasks (use direct chat — overhead not worth it)
- Tasks without an automated verifier (no `npm test` / no acceptance criterion → loop drifts forever)
- High-stakes prod code with no rollback (DB migrations, payment flows, anything irreversible)
- Ambiguous specs ("make it better" — garbage in → infinite iteration)
- Codebases the loop user can't `git reset --hard` (no recovery path)

## How Ralph differs from /loop and /goal

| | When to use | Context window | Termination |
|---|---|---|---|
| **`/loop` (Claude Code native)** | Recurring poll on interval ("check deploy every 5 min") | Reuses session context across iterations | Operator stops |
| **`/goal` (Claude Code native)** | Long focused session 14h–5d on one acceptance frontier | Single context with haiku verifier | Verifier emits COMPLETE |
| **`/ralph-loop` (this skill)** | Convergent worklist, fresh context per iteration | **Brand new context every loop** | fix_plan.md empty OR completion-promise OR max-iterations OR circuit breakers |

Ralph's unique value = the **fresh context window per iteration**. /loop and /goal reuse session context, so they rot on long worklists. Ralph re-injects the same artifacts (PROMPT.md + fix_plan.md + specs/) into a blank window each loop — every iteration starts fresh.

## Phase 0 — Pre-flight refuse-conditions

Before scaffolding any artifacts, check **all 6** conditions. If any fails, refuse with a specific reason — don't bargain.

| Condition | Check | Fix if fails |
|---|---|---|
| Git tree clean | `git status --porcelain` empty | Commit/stash work first |
| Branch is not main | `git branch --show-current` ≠ main (Ralph commits per iteration) | `git switch -c ralph/<usecase>` |
| Test harness exists | `npm test` / `pytest` / equivalent succeeds today | No test = no termination signal; refuse |
| `STEWARD_HALT` killswitch absent | `~/.cortex/STEWARD_HALT` doesn't exist | Operator chose to halt all spend — respect it |
| Daily cost cap headroom | Estimated cost (iterations × avg-tokens × model-price) ≤ remaining `STEWARD_DAILY_USD_CAP` | Lower iteration cap or wait until reset |
| Recovery point | The last commit must be a known-good baseline so `git reset --hard HEAD~N` is meaningful | Commit a baseline before scaffolding |

Surface a 6-row table back to the operator with each check pass/fail and the fix.

## Phase 1 — Author the three artifacts

Ralph runs on **three files**. The skill writes all three into `cortex/ralph/<usecase-slug>/` (gitignored — these are scratch).

### 1.1 — `PROMPT.md` (the loop body)
What the prompt does each iteration:
1. Loads `fix_plan.md`
2. Loads `specs/` (if any)
3. Picks the highest-priority unchecked item
4. Searches the codebase (verbatim guardrail from Huntley: *"Before making changes search codebase, don't assume not implemented"*)
5. Implements it (verbatim guardrail: *"DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS"*)
6. Runs tests
7. If green → commits + checks the item off in `fix_plan.md` + emits completion signal
8. If red → leaves a note in `fix_plan.md` (`> blocker: X — retry next loop`) and stops the iteration

The skill generates PROMPT.md from [`templates/PROMPT.template.md`](templates/PROMPT.template.md) by substituting `{{USECASE}}`, `{{SUCCESS_CRITERIA}}`, `{{NON_GOALS}}`, `{{COST_CEILING}}`.

### 1.2 — `fix_plan.md` (the worklist)
Markdown checklist, one item per task. Each item has:
- `- [ ] [priority] short title`
- 2-3 lines of context (file paths, expected behavior, acceptance test)
- Optional: link to `specs/<item>.md` for long-form spec

The skill generates fix_plan.md skeleton from [`templates/fix_plan.template.md`](templates/fix_plan.template.md). Operator fills in the list before the loop starts.

### 1.3 — `ralph.sh` (the loop wrapper)
The actual shell loop. Generated from [`templates/ralph.template.sh`](templates/ralph.template.sh) (bash) and [`templates/ralph.template.ps1`](templates/ralph.template.ps1) (PowerShell). The loop:
- Caps iterations (`MAX_ITERATIONS=50` default)
- Caps wall-clock (`MAX_HOURS=8` default)
- Caps per-hour token spend (`MAX_TOKENS_PER_HOUR=200000` default)
- Checks termination after each iteration (fix_plan empty / completion-promise / circuit breaker)
- Writes journal lines to `cortex/ralph/<usecase>/journal.jsonl`
- Reads `~/.cortex/STEWARD_HALT` between iterations (operator killswitch)

## Phase 1.5 — Plan gate (operator approval)

After Phase 1 generates all three artifacts, **pause** and show the operator:
1. The pre-flight table (Phase 0)
2. `fix_plan.md` content (so they can edit it)
3. `PROMPT.md` content (so they spot drift triggers)
4. Estimated cost ceiling at full iteration cap
5. Termination conditions for this run
6. Recovery instruction (`git reset --hard <baseline-sha>` + path to scratch dir)

Operator approves with `y` / adjusts / cancels. **Never start the loop without this gate** — the loop spends money and modifies the repo.

## Phase 2 — Run mode selection

| Mode | When to use | Behavior |
|---|---|---|
| `--planner-only` | Spec hasn't been written yet | Loop only edits `fix_plan.md` + `specs/` — never touches source code. Used to converge on a worklist before opening implementation. Huntley's canonical "plan" mode. |
| `--builder-only` (default) | fix_plan + specs already exist | Loop only implements items from fix_plan, runs tests, commits, checks off. Never adds new items. |
| `--planner-then-builder` | Long unstructured ask | First N iterations are planner mode (write fix_plan + specs); then auto-switch to builder mode when fix_plan reaches `target_item_count` |
| `--single-pass` | Just one iteration as a smoke test | Run the loop body once, exit. Cheapest validation that the prompt + artifacts work. Use BEFORE long runs. |

Default to `--single-pass` first, then `--builder-only`. Never start with unbounded builder mode without a single-pass dry run.

## Phase 3 — Spawn the loop

Three execution surfaces:
- **Foreground bash** — `./cortex/ralph/<usecase>/ralph.sh` directly. Use for short runs (< 1h), to watch live, to abort fast.
- **tmux pane** — `tmux new-session -d -s ralph-<usecase> 'cd cortex/ralph/<usecase> && ./ralph.sh'`. Use for unattended overnight. Operator attaches with `tmux a -t ralph-<usecase>` and detaches with Ctrl+B → D.
- **`run_in_background` Bash tool** — when invoked from this session, spawn the loop in the background and monitor via journal.jsonl tail. Use sparingly — operator should drive long runs themselves.

For unattended runs, **default to tmux + stream-json output** (`claude -p --output-format stream-json`). The journal.jsonl is appended per iteration with: `{iteration, started_at, ended_at, items_checked_off, cost_usd, exit_reason}`.

## Phase 4 — Monitor + tune ("sit on the loop, not in it")

Huntley's verbatim guidance: *"Sit on the loop, observe + tune like a guitar — don't sit in it."*

The skill exposes 3 monitoring contracts:
- `cortex/ralph/<usecase>/journal.jsonl` — append-only per-iteration record
- `cortex/ralph/<usecase>/STATUS` — symlink to current iteration's stdout (overwritten each loop)
- `cortex/ralph/<usecase>/COST` — running cost total

When the operator says "how's ralph doing" mid-run, read all three + report: iteration count / items closed / items added / current spend / time elapsed / estimated time to fix_plan empty.

Tuning during the run = editing `PROMPT.md` between iterations (the next loop picks up the new prompt). Don't edit `fix_plan.md` while a loop is running — race condition with the model's own check-off writes.

## Phase 5 — Termination conditions

The loop stops when **any one** of these fires (in priority order):

1. **`fix_plan.md` has zero unchecked `- [ ]` items** — primary success exit
2. **`~/.cortex/STEWARD_HALT` exists** — operator killswitch, immediate exit
3. **Iteration cap reached** (`MAX_ITERATIONS`, default 50)
4. **Wall-clock cap reached** (`MAX_HOURS`, default 8)
5. **Cost cap reached** (`MAX_COST_USD`, default $20 for the whole run, separate from daily Steward cap)
6. **Completion promise** — if `PROMPT.md` declares one, the loop matches `<promise>COMPLETE</promise>` in stdout and exits
7. **Circuit breakers**:
   - 3+ consecutive iterations without items checked off → `NO_PROGRESS`
   - 5+ identical errors in journal.jsonl → `STUCK_ERROR`
   - 2+ consecutive `git reset --hard` events → `CORRUPTION`

Each exit reason logs a final line to `journal.jsonl` and writes a one-screen summary to `cortex/ralph/<usecase>/REPORT.md`.

Full termination semantics + 6 circuit breakers + opt-in completion-promise format → [`references/termination.md`](references/termination.md).

## Phase 6 — Post-loop verification

After the loop exits (for any reason), run a final sweep:
1. **`git status`** — confirm tree is clean (loop commits per iteration, so it should be)
2. **`npm test`** — full suite, not just the last iteration's slice
3. **R2 review pipeline** — spawn `acceptance-auditor` + `blind-hunter` + `ssot-enforcer` + `edge-case-hunter` against the full diff (loop commits aggregate into one PR-sized change)
4. **Cost reconciliation** — sum `journal.jsonl` cost_usd, compare to OpenRouter dashboard
5. **Recommendations file** — surface any items the loop *added* to fix_plan but didn't close (debt for next run)

Then write `REPORT.md` (paste-ready PR description) and surface it. Operator decides: merge / iterate again / abandon + `git reset --hard <baseline>`.

## Anti-patterns the skill refuses to scaffold

- **fix_plan.md item with no acceptance test** → reject, force operator to add a verifier
- **PROMPT.md asking for "improvement" / "refactoring" without target** → reject, ambiguous
- **MAX_ITERATIONS unset or > 200** → reject, cost cap discipline
- **Running on main branch** → reject, force `ralph/<usecase>` branch
- **Running with dirty tree** → reject
- **Running without baseline commit** → reject (no recovery path)
- **Running when STEWARD_HALT exists** → respect the killswitch

## Cost discipline

Defaults that the skill enforces unless operator explicitly overrides:
- `MAX_ITERATIONS=50`
- `MAX_HOURS=8` (one overnight window)
- `MAX_COST_USD=20` per run
- `MAX_TOKENS_PER_HOUR=200000`
- Model: `claude-sonnet-4-6` (Ralph baseline; switch to opus only when sonnet stalls)

The benchmark from HumanLayer: *"Sonnet 4.5 on a bash loop, known as Ralph, costs ~$10.42/hour."* Sonnet 4.6 is similar. Budget realistically: 8h overnight = ~$80 spend ceiling on the upper bound.

Full cost-discipline framework + per-iteration spend caps + circuit breakers → [`references/cost-discipline.md`](references/cost-discipline.md).

## Variants

Ralph isn't one pattern — it's three. Full anatomy + verbatim prompt templates for each → [`references/patterns.md`](references/patterns.md):

- **Planner / Builder split** (Huntley canonical) — two prompt files, planner-only first run, then builder
- **Verifier loop** (Anthropic plugin) — Stop hook intercepts exit, re-feeds prompt until `<promise>COMPLETE</promise>`
- **Spec-driven Ralph** — `@specs/stdlib/*` re-injected each loop, used to reverse-engineer codebases into specs
- **AFK Ralph** — streaming JSON variant for unattended runs
- **TDD Ralph** — failing test is the next iteration's signal, items close when test goes green
- **Subagent fanout Ralph** — Huntley's verbatim rule: *"500 sonnet subagents for reads, 1 sonnet for writes"*

## Companion references

The main SKILL.md keeps the runtime contract. Deep guidance lives in companion files:

- [`templates/PROMPT.template.md`](templates/PROMPT.template.md) — paste-ready PROMPT.md skeleton with substitution slots + Huntley's verbatim guardrails
- [`templates/fix_plan.template.md`](templates/fix_plan.template.md) — fix_plan.md skeleton + 1 worked example
- [`templates/ralph.template.sh`](templates/ralph.template.sh) — bash loop wrapper with caps + termination + journal
- [`templates/ralph.template.ps1`](templates/ralph.template.ps1) — PowerShell variant for Windows
- [`references/patterns.md`](references/patterns.md) — 6 Ralph variants with verbatim prompts + when each wins
- [`references/termination.md`](references/termination.md) — 7 exit conditions + 6 circuit breakers + completion-promise syntax
- [`references/cost-discipline.md`](references/cost-discipline.md) — budgets, per-iteration caps, OpenRouter cost tracking, daily/weekly/monthly reconciliation

## Output discipline (matches voice.md)

- No greetings before scaffolding ("Tady je váš Ralph loop!" — banned)
- No emoji in operator-facing text
- Counts not praise: "Generated PROMPT.md + fix_plan.md + ralph.sh into cortex/ralph/cron-stability/. 7 items in fix_plan, estimated cost $14 at MAX_ITERATIONS=50." not "Krásný plán!"
- When unsure of a fix_plan item, ask one tight question instead of guessing
- Cite `[cortex/recall]` + footnote when recalling prior Ralph runs from `cortex/ralph/*/REPORT.md`

## Slot validation (substitution safety)

When the skill writes `ralph.sh` / `ralph.ps1` it substitutes operator-provided values into shell heredocs and double-quoted strings. Unsanitized values are a command-injection vector. Before substitution the skill MUST validate every slot against an allowlist regex:

| Slot | Regex | Example accept | Example reject |
|---|---|---|---|
| `{{USECASE_SLUG}}` | `^[a-z0-9-]{1,40}$` | `cron-stability` | `cron"; rm -rf ~` |
| `{{USECASE}}` (display) | `^[A-Za-z0-9 _\-./]{1,80}$` | `Cron stability sweep` | embedded backticks / `$()` / shell metas |
| `{{BRANCH}}` | `^[a-zA-Z0-9._/-]{1,80}$` | `ralph/cron-stability` | `main; git push` |
| `{{BASELINE_SHA}}` | `^[0-9a-f]{7,40}$` | `abc1234` | `--upload-pack=…` |
| `{{TIMESTAMP}}` | `^[0-9TZ:.-]{1,30}$` | ISO-8601 string | shell metas |

Reject on first violation. The scaffolder refuses to write the loop until the operator picks valid values.

## Known risks v0

The R2 security review (2026-05-25) returned **CANNOT SHIP AS-IS** for production environments. The skill ships as **v0-experimental** with these caveats documented:

### Architectural risks (require operator awareness)

1. **Lethal trifecta in one process** — Ralph reads private repo data + ingests untrusted `fix_plan.md` + has external network egress (model can `curl` / `git push`). `--dangerously-skip-permissions` disables Claude Code's in-band defense (including the block-destructive hook). **Mitigation v0**: run only on repos you can `git reset --hard`; use a fresh `ralph/<usecase>` branch; never run on prod credentials. **Roadmap v1**: default to `git worktree add` for FS isolation; document container/devcontainer execution path.
2. **Cost cap is model-self-reported** — `total_cost_usd` is extracted from the model's own stream-json output. A prompt-injected `fix_plan.md` could ask the model to falsify the field, bypassing `MAX_COST_USD`. **Mitigation v0**: `MAX_ITERATIONS` cap is hard-enforced by the shell — that's your real budget ceiling. **Roadmap v1**: out-of-band billing-API cost gate between iterations.
3. **block-destructive hook disabled** — when running with `--dangerously-skip-permissions`, the cortex-x block-destructive hook does NOT intercept `rm -rf`, `git push --force`, `git reset --hard`, `DROP TABLE`, etc. **Mitigation v0**: set `RALPH_REQUIRE_HOOKS=1` to run without the dangerous flag (slower, prompts on each tool call, but defense-in-depth intact). **Roadmap v1**: ship a Ralph-aware permission allowlist that pre-approves the safe tool subset (Read/Grep/Glob/Edit/npm test) while leaving destructive ones gated.

### Implementation risks (operator monitoring)

4. **Branch protection not auto-verified** — Phase 0 refuses main/master, but doesn't probe GitHub branch-protection rules. If the repo has no branch protection, the model can still `git push origin main --force` via tool use. **Mitigation v0**: enable branch protection on the target remote before running. **Roadmap v1**: `gh api repos/:owner/:repo/branches/main/protection` pre-flight check.
5. **PROMPT.md / journal.jsonl persist on disk** — `cortex/ralph/` is gitignored but stays on disk forever. If you include secrets in the usecase description, they land in 50+ iteration logs. **Mitigation v0**: never paste credentials into usecase / fix_plan content; pre-flight scans `PROMPT.md` for `sk-`, `ghp_`, `xox[bp]-`, `AKIA`, `-----BEGIN` and refuses. **Roadmap v1**: auto-purge logs > 30 days; `chmod 700` on the scratch dir.
6. **Pre-commit hooks requiring TTY** — if the repo has husky / lefthook / pre-commit hooks that prompt interactively, `--dangerously-skip-permissions` doesn't help (non-interactive bash blocks). The loop will close 0 items, trip `NO_PROGRESS` after 3 iter and exit. **Mitigation v0**: disable interactive hooks for the run, or set `HUSKY=0` / equivalent in the env. **Roadmap v1**: Phase 0 hook probe.

### Acceptance for v0 use

Ralph v0 is safe to run when **all** apply:
- Personal repo or test fixture, never production
- `ralph/<usecase>` branch (never main/master)
- Clean tree at baseline + you remember the baseline SHA
- You can `git reset --hard <baseline>` to recover
- No secrets in `PROMPT.md` or fix_plan items
- Branch protection enabled on origin/main
- `MAX_ITERATIONS=20` for first run (caps blast radius)
- You check on it every 30 min ("sit on the loop, not in it")

If any of those don't hold, defer Ralph and use `/cortex-goal` (which runs in your foreground session under normal Claude Code permissions) instead.

## Sources

Research May 2026:
- [ghuntley.com/ralph/](https://ghuntley.com/ralph/) — canonical post (Jul 2025)
- [ghuntley.com/loop/](https://ghuntley.com/loop/) — "everything is a ralph loop"
- [github.com/ghuntley/how-to-ralph-wiggum](https://github.com/ghuntley/how-to-ralph-wiggum) — reference repo
- [humanlayer.dev/blog/brief-history-of-ralph](https://www.humanlayer.dev/blog/brief-history-of-ralph) — production reports
- [github.com/anthropics/claude-code plugins/ralph-wiggum](https://github.com/anthropics/claude-code) — official plugin (Dec 2025)
- [github.com/frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code) — circuit-breaker variant
- HumanLayer: *6 repos shipped overnight, 6-hour autonomous frontend refactor*
- Cost benchmark: *Sonnet 4.5/4.6 on bash loop ~$10.42/hour*

R2 review reports (2026-05-25): acceptance-auditor (approved-conditional), blind-hunter (8 P0, 12 P1), edge-case-hunter (5 P0, 6 P1), security-auditor (CANNOT SHIP AS-IS, 4 CRIT + 5 HIGH). The CRIT findings drove the v0-experimental label + Known risks section above.
