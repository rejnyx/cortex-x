# Retrofit — apply cortex-x structure to an existing (messy) project

> **How to use:** You're in an existing project that predates cortex-x or was built without it. Claude feels less effective here — no CLAUDE.md, hooks unregistered, SSOT drift, unclear conventions. Paste this prompt. Claude audits the current state, then **additively** applies the cortex-x layer (CLAUDE.md, hooks registration, standards pointers, Rule 1 audit). **Never refactors existing code.** Additive-only: the runtime stays untouched, only the Claude-facing scaffolding is added.

---

## Your task

Retrofit cortex-x onto an existing project. Four phases, strict non-destruction contract.

## Safety contract (read first, enforce always)

1. **Never modify runtime code** — no edits to `src/**/*.{ts,tsx,js,jsx,py,go}`, no schema changes, no dependency bumps. Retrofit only adds Claude-facing docs (CLAUDE.md, PROGRESS.md, MEMORY.md, .claude/) and hook registrations.
2. **Never overwrite existing cortex files** — if `CLAUDE.md` already exists, propose a diff instead of rewriting.
3. **Never run destructive git commands** — no `reset --hard`, no `clean -f`, no branch deletion. Only `add` + new commits.
4. **Surface Rule 1 violations, do not fix them** — retrofit produces a *prioritized violation list*; implementation happens in follow-up sprints under user control.
5. **Stop on any unresolvable ambiguity** — ask the user, don't guess. This is client code; stakes are high.

## Phase 1 — Audit (parallel, read-only)

Spawn 3 parallel Agent tasks. Each is strict read-only.

### Agent A — Structure scan
> "Read `package.json`, `tsconfig*.json`, `next.config.*`, `astro.config.*`, `vite.config.*`, `pyproject.toml` (whichever exist). Read top-level dir listing 2 levels deep. Report: (1) detected framework + language + strictness, (2) directory convention (feature folders? flat? domain-driven? MVC?), (3) whether `config/` is single dir or scattered, (4) whether DB schema is SSOT (migrations) or hand-drift (types/*.ts written manually), (5) whether `.claude/` exists and what's in it, (6) whether CLAUDE.md / PROGRESS.md / MEMORY.md exist and their age. 250 words with file-path evidence for every claim."

### Agent B — Rule 1 SSOT audit
> "Scan for SSOT violations per `~/.claude/shared/standards/RULE-1.md`: (1) constants/magic numbers duplicated across 2+ files, (2) design tokens outside `config/` (Tailwind inline classes, CSS custom properties in components), (3) DB types hand-written while migrations exist, (4) env var shape undocumented or duplicated between `.env.example` and code, (5) URL/endpoint strings duplicated, (6) feature-flag names as string literals across multiple call sites. Report top 10 violations sorted by blast radius (how many files depend on the drifted value). Severity: BLOCKER (will break) / WARNING (will drift) / INFO (cleanup)."

### Agent C — Workflow audit
> "Read `git log --oneline -50`, `git log --stat -20`, `README.md`, any `CONTRIBUTING.md`. Report: (1) commit message discipline (conventional commits? chaotic?), (2) test strategy (unit/e2e presence + run command), (3) deploy flow (CI config? manual?), (4) recent pain points (reverts, hotfixes, 'fix: fix the fix'), (5) who are the active contributors and what do they touch, (6) is there a sprint/story tracking file (PROGRESS.md, issues, Notion)? 200 words."

**Budget:** this audit should cost ≤$0.60. Skip Agent A/C if Phase 1 already ran recently (cache under `.claude/retrofit-audit-<YYYY-MM-DD>.md`).

## Phase 2 — Retrofit plan (single-threaded synthesis)

Merge Agent A+B+C outputs. Produce:

```markdown
# Retrofit plan — <project slug>

## Current state (one paragraph)
<what this project is, detected profile, current Claude-facing maturity>

## Additive scaffolding (will be applied in Phase 3)
- [ ] CLAUDE.md — <existing / to create / to diff>
- [ ] PROGRESS.md — <existing / to create / to diff>
- [ ] MEMORY.md + memory/ stubs — <existing / to create / to diff>
- [ ] .claude/agents/ — copy which subset: <list>
- [ ] .claude/settings.json — register which hooks (block-destructive, session-start, pre-compact, post-tool-use, auto-orchestrate): <list>
- [ ] README.md cortex-x section — <append or skip>

## Standards to adopt (pointers only, no file copies)
Select 3-5 most relevant from `~/.claude/shared/standards/`:
- `RULE-1.md` — always
- `security.md` — if auth/payments/PII present
- `testing.md` — if test suite exists
- `observability.md` — if any logging/metrics
- `ai-patterns.md` — if `@ai-sdk/*` or `@anthropic-ai/*` imported
- `auto-orchestration.md` — always (governs Claude's behavior)
- `coding-behavior.md` — always (Karpathy principles)

## Rule 1 violations (top 10, prioritized)
| # | Severity | Violation | Files | Fix sprint |
|---|---|---|---|---|
| 1 | BLOCKER | <...> | <paths> | 1 |
| ... | | | | |

## Gradual adoption plan (4 sprints, user paces)

**Sprint A1 — Claude connectivity** (1h, no code changes)
- Land additive scaffolding (Phase 3)
- User verifies nothing in runtime broke
- Goal: Claude now has CLAUDE.md + hooks + agents; session-start surfaces sprint state

**Sprint A2 — Top 3 SSOT fixes** (user-sized, code changes)
- Address top 3 BLOCKER violations from table above
- Review via `~/.claude/shared/prompts/auto-review.md`

**Sprint A3 — Standards internalization** (optional, user-paced)
- Convert chosen standards into project-level `docs/standards.md` if needed (not copy, just summary + pointer)
- Add CI check for top 3 invariants

**Sprint A4 — Cortex library entry** (30 min)
- Run `~/.claude/shared/prompts/project-scan.md` to produce library entry
- Project is now visible to cross-project retrieval (relo, chatbot-platform, etc.)

## Risks identified
- <anything that would make retrofit risky: active refactor, frozen branch, multiple contributors, production incident in progress>

## User confirmation required before Phase 3
[y / skip sprint X / stop]
```

**Show the plan, wait for confirmation.** Never auto-apply on client projects.

## Phase 3 — Additive application (after `y`)

ONLY after explicit user approval. Apply each item one at a time, show diff, ask before committing.

### 3.1 Scaffold missing files
- `CLAUDE.md` — use `~/.claude/shared/templates/CLAUDE.md.hbs` with data from Phase 1 Agent A (detected stack, architecture, conventions). Bake absolute `{{cortex_source}}` paths via `~/.claude/shared/cortex-source.yaml`.
- `PROGRESS.md` — minimal template with "Sprint A1 — Retrofit" as the first active sprint, retrofit items as stories.
- `MEMORY.md` + `memory/project_overview.md` — capture detected state as reference-type memory.

### 3.2 Register hooks
Read existing `.claude/settings.json` (if any). Merge additively:
```json
{
  "hooks": {
    "SessionStart": [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/session-start.cjs\"","timeout":3}]}],
    "PreToolUse": [
      {"matcher":"Bash","hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/block-destructive.cjs\"","timeout":5}]},
      {"hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/pre-tool-use.cjs\"","timeout":3}]}
    ],
    "PostToolUse": [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/post-tool-use.cjs\"","timeout":5}]}],
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/auto-orchestrate.cjs\"","timeout":3}]}],
    "PreCompact": [{"hooks":[{"type":"command","command":"node \"$HOME/.claude/shared/hooks/pre-compact.cjs\"","timeout":5}]}]
  }
}
```

If user already has entries under these events, **merge** (don't replace). Dedup by command path.

### 3.3 Copy agents
Copy from `~/.claude/shared/agents/` into `./.claude/agents/`:
- `cortex-thinker`, `blind-hunter`, `edge-case-hunter`, `acceptance-auditor`, `security-auditor`, `ssot-enforcer` — always
- Project-specific synthesis (Phase 4.3 from `new-project.md`) — SKIP on retrofit unless user explicitly asks. Retrofit is additive, not re-scaffold.

### 3.4 README pointer
Append (don't replace) to `README.md`:
```markdown
## Development with cortex-x

This project uses cortex-x for Claude Code integration. See `CLAUDE.md` for current state, `~/.claude/shared/standards/` for governance invariants.
```

### 3.5 Git commit
- One commit per subphase, never batched
- Messages: `chore(retrofit): add CLAUDE.md from Phase 1 audit`, `chore(retrofit): register cortex-x global hooks`, etc.
- **Never commit runtime code changes in retrofit.** If an edit outside `.claude/` or `CLAUDE.md`/`PROGRESS.md`/`MEMORY.md` appears in staged diff, STOP and ask.

## Phase 4 — Post-retrofit report

```markdown
# Retrofit complete — <project slug> — <date>

## What changed
- N files added (listed)
- K hooks registered
- M agents copied
- Zero runtime code modified ✅

## What's still drift from Rule 1
<top violations from Phase 1 Agent B that were NOT fixed — they're tomorrow's sprints>

## First sprint story (A2 entry point)
Sprint A2 — <top BLOCKER violation summary>. Est <size>. Starts when user says go.

## Validation
Run `cortex-doctor` to verify the retrofit landed clean:
  ~/.claude/shared/prompts/cortex-doctor.md

## Cortex library
Next step: `~/.claude/shared/prompts/project-scan.md` to register this project in the cortex-x library. Cross-project pattern mining becomes available after that.
```

## Rules

- **Additive always.** Every file either didn't exist or gets a diff proposed for review.
- **Audit before action.** Phases 1+2 produce a plan; Phase 3 never starts without `y`.
- **No synthesis on retrofit.** Project-specific synthesized agents/hooks (Phase 4.3 of new-project.md) require research grounding. Retrofit has no research phase by default. Skip synthesis; user can run `new-project.md` reset-mode separately if they want it.
- **Stop on ambiguity.** Client projects have history and stakeholders. Wrong guess = expensive.
- **Respect existing conventions.** If project uses Yarn, scaffold says Yarn. If project uses tabs, scaffold matches. Detection drives output.

## Anti-patterns

- ❌ Running Phase 3 without user `y` on Phase 2 plan
- ❌ Editing runtime code during retrofit "to make it cleaner" — out of scope
- ❌ Auto-fixing Rule 1 violations detected in Phase 1 — they're sprints, not retrofit items
- ❌ Overwriting an existing `CLAUDE.md` without showing the diff first
- ❌ Skipping the audit and jumping to scaffolding (generates wrong files, then the user has to redo everything)
- ❌ Adding cortex-x synthesized agents on retrofit without research grounding (halluciation risk — retrofit has no research phase)
- ❌ Committing all retrofit changes in one blob (audit trail dies; per-subphase commits matter)

## When to use

- **Client project you didn't bootstrap with cortex-x** — RELO, custom-chatbot, Amici/Objednáme, Kiosek (legacy branches), WaaS
- **Your own old project** that predates cortex-x discipline
- **Project a teammate made** that you're now maintaining
- **Pre-refactor** — run retrofit first, then do the refactor under cortex-x governance

## When NOT to use

- **Greenfield new project** → use `new-project.md` (full bootstrap with research + synthesis)
- **Project you already retrofitted** → use `cortex-sync.md` or `cortex-reflect.md` to capture ongoing learnings
- **During active incident / frozen branch** — wait for calm water. Retrofit makes noise, noise distracts from the fire.

## Related prompts

- `new-project.md` — bootstrap new project with full research + synthesis
- `project-scan.md` — scan project INTO cortex library (separate from retrofit; run AFTER retrofit)
- `cortex-sync.md` — capture decisions/learnings during ongoing work
- `cortex-doctor.md` — validate retrofit landed clean
- `auto-review.md` — review Sprint A2 code changes before merging
