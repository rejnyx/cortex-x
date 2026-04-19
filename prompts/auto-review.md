# Auto-Review — post-implementation parallel pipeline

> **How to use:** After an implementation lands (new feature, non-trivial refactor, or any change bigger than a typo), paste this prompt. Claude spawns 3–5 adversarial agents in parallel, each with differentiated context scope, and returns one consolidated verdict. Replaces the manual `code-review.md` invocation when the change is "big enough to audit but small enough to not warrant the full ceremony."

---

## Your task

Spawn parallel adversarial review agents over the current uncommitted diff (or the last commit, if working tree is clean). Each agent sees a **different scope of context** to avoid the single-agent blind spot. Merge findings into one verdict.

Applies the 3-fronta rule (`~/.claude/shared/standards/auto-orchestration.md`): review is parallelizable — independent audits, no shared write state.

## Pre-conditions

1. Working tree has a diff OR `HEAD` commit is the change being reviewed
2. Session budget (`$CORTEX_SESSION_BUDGET_USD`, default $5) has remaining headroom ≥ $1.50

If either fails:
- No diff → `git log -1` the most recent commit and review that
- Budget low → run a single `blind-hunter` pass only (≤$0.50 cost), not the full pipeline

## Phase 1 — Scope classification (1 fast classifier call)

Read `git diff HEAD` (or `git show HEAD`). Classify:

| Scope | LOC changed | Agents to spawn |
|---|---|---|
| **Trivial** | <10 | `blind-hunter` only |
| **Small** | 10–100 | `blind-hunter` + `edge-case-hunter` + `ssot-enforcer` |
| **Medium** | 100–500 | above + `acceptance-auditor` |
| **Large** | >500 or touches auth/payments/AI-core | above + `security-auditor` |
| **Synth-applicable** | any + project has `.claude/agents/*-auditor.md` synthesized during scaffold | ALL of the above + the matching synthesized agents |

Output the classification visibly so the user can override:
```
Classified: medium (214 LOC across 4 files, touches src/features/digest/).
Spawning: blind-hunter + edge-case-hunter + ssot-enforcer + acceptance-auditor.
```

## Phase 2 — Parallel dispatch

Use the Agent tool to spawn each agent **in the same message** (parallel, not sequential). Each receives a DIFFERENT slice of context — see `prompts/code-review.md` for the context-partitioning rules. Summary:

| Agent | Context scope |
|---|---|
| `blind-hunter` | Diff ONLY. No surrounding files. Catches what's wrong purely from the change. |
| `edge-case-hunter` | Diff + test files in same modules. Looks for untested paths. |
| `acceptance-auditor` | Diff + user's original request (from session context). Scope match + §3 Surgical Changes (Rule 1.5). |
| `security-auditor` | Diff + any file importing sensitive libs (`@supabase`, `jsonwebtoken`, `stripe`, `@ai-sdk`). OWASP top 10. |
| `ssot-enforcer` | Diff + `config/` + `supabase/migrations/`. Rule 1 SSOT gate. |
| Synthesized project-specific agents | Whatever `description:` frontmatter declares. |

Each agent receives this brief (templated, pass the specific slice):
```
Context scope: <scope description>

Input files: <list>

Diff under review:
<git diff HEAD output, truncated to agent's scope>

Your job: <one-line role from agent's frontmatter>

Report verdict: PASS | WARN | BLOCK with evidence (file:line + expected vs actual).
```

## Phase 3 — Merge + verdict

After all agents return (budget permitting — kill stragglers past 90s), consolidate using this pattern (anti-slop, inspired by smolagents `provide_run_summary`):

```markdown
# Auto-review verdict — <commit/diff short ref>

## Summary
- <N> PASS · <M> WARN · <K> BLOCK
- Scope: <trivial|small|medium|large>
- Spawned agents: <list>
- Budget this round: $<cost> (session total: $<running>/$<cap>)

## Blocks (must fix before merge)
- [agent] <file:line> — <one-line issue>
  Evidence: <quoted span>
  Fix: <concrete>

## Warnings (worth addressing, not blocking)
- [agent] <file:line> — <issue>

## Pass with notes
- [agent] <short observation if any>

## Decision
- **MERGE** | **FIX BLOCKS FIRST** | **HUMAN REVIEW REQUIRED**
```

If any agent returns `BLOCK`, the decision cannot be `MERGE`.

If 3+ agents return the SAME block, it's a high-confidence issue — flag in the summary.

## Phase 4 — Writeback

1. Append the verdict summary (top 300 chars) to the current PR description if one exists (`gh pr view --json number`), else skip.
2. If `cortex-thinker` has access, surface patterns worth adding to `insights/`.
3. Budget update — `post-tool-use.cjs` has already recorded each Agent call; no manual writeback needed.

## Rules

- **Parallel, not sequential** — the whole point. One message with multiple Agent tool uses.
- **Fail-open on stragglers** — if one agent times out, report partial verdict, don't block others.
- **Respect budget** — if session budget is `over`, ask user before running; don't auto-spawn.
- **Don't duplicate code-review.md** — this is the lightweight auto-variant. Use `code-review.md` for pre-merge pipelines where every agent is mandatory.
- **Synthesized agents always included when present** — they exist precisely because they know project-specific invariants default agents don't.

## Anti-patterns

- ❌ Spawning 5 agents for a 3-line typo fix — respect the scope classifier
- ❌ Sequential spawning (one Agent call per message) — parallel is the contract
- ❌ Omitting synthesized project-specific agents when they exist
- ❌ Merging without reporting BLOCK → MERGE transition (audit trail matters)
- ❌ Silent failure if budget exceeded — ALWAYS report the state

## When to use

- After every non-trivial commit (small+ scope)
- Before creating a PR
- After a merge conflict resolution
- When you feel uncertain about a change you just wrote

## When NOT to use

- Typos, renames, comments
- Dependency bumps without code changes
- Generated code (migrations, types from schema)
- Docs-only changes
