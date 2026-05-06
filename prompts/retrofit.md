# Retrofit — apply cortex-x structure to an existing (messy) project

> **How to use:** You're in an existing project that predates cortex-x or was built without it. Claude feels less effective here — no CLAUDE.md, hooks unregistered, SSOT drift, unclear conventions. Paste this prompt. Claude audits the current state, then **additively** applies the cortex-x layer (CLAUDE.md, hooks registration, standards pointers, Rule 1 audit). **Never refactors existing code.** Additive-only: the runtime stays untouched, only the Claude-facing scaffolding is added.
>
> **Works even when another AI framework already lives in the project.** If `.claude/`, `.codex/`, `.cursor/`, `.mcp.json`, `AGENTS.md`, or `.cursorrules` are already populated (Claude Code, Codex, Cursor, other AI tools), Phase 0 detects them and Phase 1 Agent D plans **coexistence** — cortex-x adds a sibling sub-directory + appends clearly-delimited sections, never overwrites existing AI context. See § "Coexistence decision matrix."

> **2026-05-06 — relationship with `/audit` (existing-project-audit.md):** This prompt **applies** cortex-x patterns. The new `/audit` skill (`prompts/existing-project-audit.md`) is the **deeper diagnostic** that runs FIRST when you want to truly understand a project. Recommended flow:
>
> 1. Run `/audit` first → produces `cortex/AUDIT.md` (12 dimensions, 5 human questions, recommendations.md)
> 2. Run `/retrofit` (this prompt) second → uses AUDIT.md as input, applies cortex-x patterns where they fit per the audit findings
>
> If `cortex/AUDIT.md` is **not present** when this prompt runs, suggest the user run `/audit` first ("get the diagnostic before applying treatment"). They can override and proceed retrofit-only by saying `proceed without audit` — the safety contract still applies, but the fit-quality is lower because retrofit guesses what `/audit` would have measured.

---

## Your task

Retrofit cortex-x onto an existing project. **Five phases**, strict non-destruction contract.

## Safety contract (read first, enforce always)

1. **Never modify runtime code** — no edits to `src/**/*.{ts,tsx,js,jsx,py,go}`, no schema changes, no dependency bumps. Retrofit only adds Claude-facing docs (CLAUDE.md, PROGRESS.md, MEMORY.md, .claude/) and hook registrations.
2. **Never overwrite existing cortex files** — if `CLAUDE.md` already exists, propose a diff instead of rewriting.
3. **Never run destructive git commands** — no `reset --hard`, no `clean -f`, no branch deletion. Only `add` + new commits.
4. **Surface Rule 1 violations, do not fix them** — retrofit produces a *prioritized violation list*; implementation happens in follow-up sprints under user control.
5. **Stop on any unresolvable ambiguity** — ask the user, don't guess. This is client code; stakes are high.
6. **Never modify populated AI-context artifacts of other frameworks without explicit user approval.** If any of the following exist AND contain content, treat as **read-only**: `.claude/CLAUDE.md`, `.claude/settings.local.json`, `.claude/settings.json`, `.claude/docs/*`, `.claude/skills/*`, `.claude/agents/*` (non-cortex), `.codex/**`, `.cursor/**`, `.cursorrules`, `.continue/**`, `.windsurf/**`, `.windsurfrules`, `.openhands/microagents/**`, `.clinerules/**`, `.clinerules`, `.roo/**`, `.factory/droids/**`, `.kilocode/**`, `kilo.jsonc`, `.kilocodemodes`, `.augment/**`, `.augment-guidelines`, `.amazonq/rules/**`, `.gemini/**`, `.devin/wiki.json`, `.aider.conf.yml`, `CONVENTIONS.md`, `replit.md`, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.mcp.json`, existing project-root `AGENTS.md` / `AGENT.md` / `.rules`. Add cortex-x artifacts as **sibling namespace** (`.claude/cortex-x/`) or **clearly-delimited appended sections** only.

7. **Never recurse into git submodules.** If `.gitmodules` exists at root, parse it, list submodule paths, and skip them during Phase 1 Agent A directory scans. Submodules are foreign repos with their own governance — retrofitting them silently = overstepping.

8. **Respect `.gitignore`.** Before staging any cortex-x file in Phase 3.6 commit, check if the path is gitignored. If `.claude/` is fully gitignored (user intent: AI context stays local), only commit root-level cortex-x files (`CLAUDE.md`, `PROGRESS.md`, `MEMORY.md`, `AGENTS.md` section) — do NOT force `.claude/*` into tracking.

9. **Soft-block on archived repos.** If `stage.last_commit_age_days > 365` OR README contains "DEPRECATED" / "no-maintenance-intended" / GitHub "Archived" flag, abort Phase 3 unless user passes explicit `--force-stale` override. Retrofit on dead code wastes time.

10. **Never npm install / pip install / cargo build during retrofit.** Detectors are `<100ms` read-only; no package manager invocations. Preserves air-gapped / corporate-registry compatibility.

## Phase 0 — Deterministic scan (runs first, before any Agent dispatch)

Invoke the detectors silently. They're <100ms each, no LLM, no network. Output feeds into Phase 1 agents + Phase 2 plan.

```bash
node ~/.claude/shared/detectors/detect-profile.cjs    --json --cwd <project-root>
node ~/.claude/shared/detectors/detect-stage.cjs      --json --cwd <project-root>
node ~/.claude/shared/detectors/detect-sister-env.cjs --json --cwd <project-root>
```

Capture for use downstream:
- `profile.top.name` + `score` + `monorepo` (if Nx/Turbo/pnpm workspaces detected) + `workspaceCount`
- `stage.stage` (greenfield/prototype/mvp/growth/mature) + `evidence`
- Note explicitly if `stage.signals.is_git === false` (downloaded zip, fresh clone, archived export) — Agent C won't have commit history and will flag this
- `sister_env.suggested_additions` — env flags present in ≥2 sibling projects (same parent directory) but missing from target. Common case: user's personal experimental flags (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), workspace-wide defaults, tool API keys. In Phase 3.2 settings.json merge, **surface these as suggestions with user confirmation**, never auto-apply — values may be intentionally absent (e.g., user opted out).

If `profile.top.score < 0.3` and `stage.stage === 'greenfield'`, the project is truly empty. **Abort retrofit** — recommend `new-project.md` instead.

## Phase 1 — Audit (parallel, read-only)

Spawn **5 parallel Agent tasks**. Each is strict read-only. Give each the Phase 0 detector output as context.

### Agent A — Structure scan
> "Read `package.json`, `tsconfig*.json`, `next.config.*`, `astro.config.*`, `vite.config.*`, `pyproject.toml` (whichever exist). Read top-level dir listing 2 levels deep. Report: (1) detected framework + language + strictness, (2) directory convention (feature folders? flat? domain-driven? MVC?), (3) whether `config/` is single dir or scattered, (4) whether DB schema is SSOT (migrations) or hand-drift (types/*.ts written manually), (5) whether `.claude/` exists and what's in it, (6) whether CLAUDE.md / PROGRESS.md / MEMORY.md exist and their age. 250 words with file-path evidence for every claim."

### Agent B — Rule 1 SSOT audit
> "Scan for SSOT violations per `~/.claude/shared/standards/RULE-1.md`: (1) constants/magic numbers duplicated across 2+ files, (2) design tokens outside `config/` (Tailwind inline classes, CSS custom properties in components), (3) DB types hand-written while migrations exist, (4) env var shape undocumented or duplicated between `.env.example` and code, (5) URL/endpoint strings duplicated, (6) feature-flag names as string literals across multiple call sites. Report top 10 violations sorted by blast radius (how many files depend on the drifted value). Severity: BLOCKER (will break) / WARNING (will drift) / INFO (cleanup)."

### Agent C — Workflow audit
> "Read `git log --oneline -50`, `git log --stat -20`, `README.md`, any `CONTRIBUTING.md`. Report: (1) commit message discipline (conventional commits? chaotic?), (2) test strategy (unit/e2e presence + run command), (3) deploy flow (CI config? manual?), (4) recent pain points (reverts, hotfixes, 'fix: fix the fix'), (5) who are the active contributors and what do they touch, (6) is there a sprint/story tracking file (PROGRESS.md, issues, Notion)? If `.git` is absent (downloaded zip / fresh clone), skip git-based signals and report that explicitly. 200 words."

### Agent D — Existing AI context coexistence (MANDATORY — do not skip)
> "Scan the project for existing AI-tool context layers that cortex-x must coexist with (never overwrite). 2026 AI coding ecosystem has 20+ tools; check ALL these paths. For each, list top-level contents + 1-line purpose + whether the file/folder is populated (>30 lines content OR ≥1 non-empty file) or empty scaffold:
>
> **Claude family:**
> - `.claude/` (CLAUDE.md, settings.json, settings.local.json, agents/, skills/, hooks/, rules/, commands/, docs/, memory/)
> - `CLAUDE.md` at project root
> - `.mcp.json` at root
>
> **Cross-tool shared (AGENTS.md cohort — 10+ tools read this):**
> - `AGENTS.md` at root
> - `AGENT.md` at root (legacy Amp)
> - `CONVENTIONS.md` at root (Aider primary; cohort secondary)
>
> **Per-vendor namespaces (each definitive signal of that tool in use):**
> - `.codex/` (Codex CLI, `.codex/config.toml`)
> - `.cursor/rules/*.mdc` + `.cursorrules` (legacy) + `.cursor/mcp.json`
> - `.continue/` (config.yaml, rules/, agents/, assistants/, configs/)
> - `.windsurf/rules/*.md` + `.windsurfrules` (legacy)
> - `.openhands/microagents/*.md`
> - `.clinerules/*.md` + `.clinerules` (file, legacy)
> - `.roo/rules/` + `.roo/rules-{mode}/`
> - `.factory/droids/*.md`
> - `.kilocode/rules/` + `kilo.jsonc` + `.kilocodemodes`
> - `.augment/rules/` + `.augment-guidelines`
> - `.amazonq/rules/*.md`
> - `.gemini/styleguide.md` + `.gemini/config.yaml`
> - `.devin/wiki.json`
> - `.aider.conf.yml`
> - `replit.md`
>
> **GitHub-family (Copilot shared team config — NEVER overwrite, owned by team):**
> - `.github/copilot-instructions.md`
> - `.github/instructions/*.instructions.md`
> - `.github/prompts/*.prompt.md`
> - `.github/chatmodes/*.chatmode.md`
>
> **Zed / misc:**
> - `.rules` at root
>
> **Docs knowledge indexes:**
> - `docs/codex/`, `docs/claude/`, `docs/agents/`
>
> Then produce a 3-column overlap matrix (cortex-x asset × existing counterpart × verdict: conflict / overlap / complement / preserve-read-only) — referenced in `~/.claude/shared/prompts/retrofit.md` § 'Coexistence decision matrix'.
>
> Finally recommend a retrofit path:
> - **Option 1** (no existing AI context — full scaffold)
> - **Option 2** (partial existing — append-only, diff existing files)
> - **Option 3** (rich existing — sibling namespace `.claude/cortex-x/` + AGENTS.md appended section, NEVER modify existing CLAUDE.md / settings.local.json / docs/* / skills/* / agents/* of other frameworks, NEVER touch populated `.github/copilot-instructions.md` — it's shared team config)
>
> Trigger Option 3 if ANY of: `.claude/CLAUDE.md` populated, `AGENTS.md` populated (can't know which of 10+ tools owns it), `.cursor/rules/` ≥2 files, `.continue/` populated, `.windsurf/rules/` populated, `.clinerules/` populated, `.roo/` populated, `.factory/` populated, `.augment/` populated, `.openhands/microagents/` populated, `.github/copilot-instructions.md` exists (team config, never overwrite).
>
> State which option fits this project and why. 500 words max with file-path evidence."

### Agent E — Rule 2 audit (Security + Correctness per 2026-04-20 standards)
> "Apply `~/.claude/shared/standards/security.md` (8-layer defense + § Agentic Security + § Browser Automation Security) and `~/.claude/shared/standards/correctness.md` (5 practices: trust-boundary validation, property-based tests, eval-driven dev for LLM, mutation testing, stateful simulation) to this project.
>
> For Security report ✅/🟡/🔴 per layer:
> - Layer 3 Authz (RLS / guards / role checks)
> - Layer 4 Input validation (Zod / class-validator / pydantic at every trust boundary)
> - Layer 7 Secrets (.env.example shape, .gitignore coverage, no hardcoded credentials)
> - Layer 9 Agentic (if AI code present: trust fence, bounded tool args, capability-scoped auth, destructive-op HITL, structured output validation, sandboxed code exec, consumption caps)
>
> For Correctness report ✅/🟡/🔴 per practice:
> - Practice 1 Trust boundaries (Zod/Pydantic on API routes, LLM outputs, webhooks, env parse, DB readbacks)
> - Practice 2 Property-based tests (fast-check / Hypothesis coverage on invariant code)
> - Practice 3 Eval suite (evals/ directory for LLM endpoints, promptfoo / braintrust / Inspect)
> - Practice 4 Mutation testing (Stryker / mutmut config, CI cadence)
> - Practice 5 Stateful simulation (RuleBasedStateMachine / fc.commands for retry/ledger/workflow)
>
> Cite file paths for every finding. Mark N/A per practice only when the stack clearly doesn't require it (e.g., Practice 3 Eval suite N/A if project has zero LLM integration). End with top 5 actionable recommendations by blast radius, each citing the relevant cortex-x standard section. 500 words max."

**Budget:** this 5-agent audit should cost ≤$1.00 at current Anthropic pricing. Skip cached agents if `.claude/retrofit-audit-<YYYY-MM-DD>.md` already contains their output.

## Coexistence decision matrix

**When Agent D reports existing populated AI context, choose a retrofit option:**

| Option | When | cortex-x artifact placement | AGENTS.md handling | `.claude/*` handling |
|--------|------|----------------------------|---------------------|---------------------|
| **1 — Full scaffold** | No existing `.claude/`/`.codex/`/`.cursor/` content | Standard: root `CLAUDE.md`, `.claude/agents/`, `.claude/settings.json` | Create if missing | Write project-level copies |
| **2 — Append-only** | Some populated AI files (e.g., only `CLAUDE.md` exists, no skills/docs) | Root-level adds OK; existing files **diff-and-append**, not replace | Append "## cortex-x Retrofit Context" section | Never overwrite existing; add missing subfolders |
| **3 — Sibling namespace** | Rich populated AI context (e.g., `.claude/CLAUDE.md` + `.claude/docs/*` + `.claude/skills/*` + `.codex/` all populated, and/or multi-tool routing via `AGENTS.md`) | All cortex-x artifacts under `.claude/cortex-x/` sibling dir; NEVER touch other `.claude/*` | Append "## cortex-x Retrofit Context" section at end | **Read-only**. Do not modify `CLAUDE.md`, `settings.local.json`, `settings.json`, `docs/*`, existing `skills/*`, non-cortex `agents/*` |

**Rule:** when in doubt, pick the more conservative option. You can upgrade 3 → 2 later if the user asks; reversing 2 → 3 means undoing edits.

**Detection cheat sheet (what "populated" means):**
- `.claude/CLAUDE.md` with >30 lines and project-specific content (not generic scaffold) = populated
- `.claude/docs/` with >5 files = populated
- `.claude/skills/` with custom skills (not just defaults from a cortex-x install) = populated
- `.codex/skills/` = populated by definition
- `AGENTS.md` at root with framework-specific rules = populated

## Phase 2 — Retrofit plan (single-threaded synthesis)

Merge Agent A+B+C+D+E outputs plus Phase 0 detector signals. Produce:

```markdown
# Retrofit plan — <project slug>

## Current state (one paragraph)
<what this project is, detected profile (Phase 0), stage (Phase 0), monorepo type if any, current Claude-facing maturity, whether existing AI context requires coexistence>

## Coexistence decision (from Agent D)
Selected option: <1 / 2 / 3> — <one-sentence reason>

## Additive scaffolding (will be applied in Phase 3)
- [ ] CLAUDE.md — <existing populated: read-only / existing scaffold: diff / missing: create at root (Option 1-2) OR at .claude/cortex-x/CLAUDE.md (Option 3)>
- [ ] PROGRESS.md — <existing / to create / to diff>
- [ ] MEMORY.md + memory/ stubs — <existing / to create / to diff>
- [ ] .claude/agents/ — <copy subset to .claude/agents/ (Option 1-2) OR .claude/cortex-x/agents/ (Option 3): list>
- [ ] .claude/settings.json — <merge into existing OR create (Option 1-2); NEVER modify .claude/settings.local.json; register hooks: list>
- [ ] AGENTS.md — <create (Option 1) / append "## cortex-x Retrofit Context" delimited section (Option 2-3, never replace)>
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

## Rule 1 violations (top 10, prioritized) — from Agent B
| # | Severity | Violation | Files | Fix sprint |
|---|---|---|---|---|
| 1 | BLOCKER | <...> | <paths> | 1 |
| ... | | | | |

## Rule 2 Critical gaps (from Agent E)
| # | Domain | Gap | Severity | Suggested sprint |
|---|---|---|---|---|
| 1 | Security Layer 9 | <...> | 🔴/🟡 | A2 |
| 2 | Correctness Practice 3 | <...> | 🔴/🟡 | A3 |
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

### 3.1 Scaffold missing files (placement depends on coexistence option)

**Option 1 (no existing AI context):**
- `CLAUDE.md` at project root — use `~/.claude/shared/templates/CLAUDE.md.hbs` with Phase 0 detector data (profile, stage, monorepo type) + Phase 1 Agent A data (stack, architecture, conventions). Bake absolute `{{cortex_source}}` paths.
- `PROGRESS.md` at root.
- `MEMORY.md` + `memory/project_overview.md` at root.

**Option 2 (partial existing AI context):**
- `CLAUDE.md` — if exists but is a non-personalized scaffold, propose diff; otherwise **do not touch**, add cortex-x state to new `.claude/cortex-x/CLAUDE.md` instead.
- `PROGRESS.md` / `MEMORY.md` — create at root if missing, never overwrite.
- Any cortex-x agents the project uses go to `.claude/agents/` (additive; dedup by filename).

**Option 3 (rich existing AI context — OrderMage-class):**
- `CLAUDE.md` — **DO NOT TOUCH** existing `.claude/CLAUDE.md`. Create `.claude/cortex-x/CLAUDE.md` instead with cortex-x-specific context. Add a 1-line reference in project-root `AGENTS.md` under appended section (see 3.4).
- `PROGRESS.md` / `MEMORY.md` — create at root if missing (these are cortex-x-owned, distinct from framework-specific agent docs).
- All cortex-x agents go to `.claude/cortex-x/agents/` — never mix with existing `.claude/agents/*` that belong to another framework.

### 3.2 Register hooks

**Option 1-2:** read existing `.claude/settings.json` (if any). Merge additively — preserve all existing keys, append hooks under their event type, dedup by command path:
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

**Option 3:** **NEVER modify `.claude/settings.local.json`** (it belongs to the existing framework — contains their permission allowlist). Instead, rely on **global hooks** via `~/.claude/shared/settings.json` at user level, or create `.claude/cortex-x/settings.json` pointing to cortex-x-specific hooks, and document in appended `AGENTS.md` section that Claude should load both.

### 3.3 Copy agents

**Option 1-2:** copy from `~/.claude/shared/agents/` into `./.claude/agents/`:
- `cortex-thinker`, `blind-hunter`, `edge-case-hunter`, `acceptance-auditor`, `security-auditor` (Layer 9 Agentic), `correctness-auditor`, `ssot-enforcer` — always
- Additional per-profile agents from detected profile (Phase 0): e.g., `browser-security-auditor` if `browser-agent` profile.

**Option 3:** copy to `./.claude/cortex-x/agents/` instead. **Do not overwrite existing `.claude/agents/*` from other frameworks** — they belong to someone else's flow.

Project-specific synthesis (Phase 4.3 from `new-project.md`) — SKIP on retrofit unless user explicitly asks. Retrofit is additive, not re-scaffold.

### 3.4 AGENTS.md handling (NEW — honor Option 1-2-3 strictly)

**Option 1:** create `AGENTS.md` from `~/.claude/shared/templates/AGENTS.md.hbs` (if template exists) or minimal boilerplate.

**Option 2-3:** **append** a delimited section to existing `AGENTS.md`. Never rewrite. Use the exact delimiter below. The `hash=` field is a sha256-12 of the section content — on re-run, recompute; if hash matches, skip rewrite (idempotent). The `version=` field gates upgrades across cortex-x versions:

```markdown
<!-- BEGIN cortex-x retrofit (date=2026-04-20 version=1.0 hash=<sha256-12> input-hash=<sha256-12>) -->
<!-- Do not edit manually. Regenerate with ~/.claude/shared/prompts/retrofit.md -->
## cortex-x Retrofit Context

cortex-x enhances this project without modifying the existing AI context layer.
- Framework: cortex-x `<version>` (see `~/.claude/shared/standards/RULE-1.md`)
- Coexistence mode: Option <1/2/3>
- cortex-x-owned files:
  - `CLAUDE.md` / `MEMORY.md` / `PROGRESS.md` (project root, cortex-x-owned)
  - `.claude/cortex-x/**` (if Option 3; cortex-x sibling namespace)
- Existing AI context (cortex-x treats as READ-ONLY):
  - `.claude/CLAUDE.md` / `.claude/settings.local.json` / `.claude/docs/**` / `.claude/skills/**` (existing framework IP)
  - `.codex/**`, `.cursor/**`, `.cursorrules`, `.continue/**`, `.windsurf/**`, `.openhands/**`, `.clinerules/**`, `.roo/**`, `.factory/**`, `.augment/**`, `.amazonq/**`, `.gemini/**`, `.aider.conf.yml`, `CONVENTIONS.md` (other AI frameworks — 2026 ecosystem)
  - `.github/copilot-instructions.md`, `.github/instructions/**` (Copilot SHARED TEAM config — never touch)
- Priority when rules conflict: Direct user request > existing `AGENTS.md` rules > existing framework skills > cortex-x standards
- Detector output (Phase 0): profile=`<name>` (confidence=`<score>`) · stage=`<stage>` · monorepo=`<type>` · language=`<lang>`
<!-- END cortex-x retrofit -->
```

**Idempotency rule:** before rewriting the block, compute sha256 of the would-be new block body (excluding the marker comments). Compare with `hash=` in existing marker. If identical → skip (no commit). If different → update block AND commit with message `chore(retrofit): refresh cortex-x AGENTS.md section (hash <old>→<new>)`. This prevents gratuitous commits on re-runs.

**Version gate:**
- If existing `version=` in marker **< current cortex-x version** → offer migration (print changelog highlights, ask y/N before updating)
- If existing `version=` **> current** → abort with "this project was retrofitted with a newer cortex-x (`<existing>`); upgrade your cortex-x first (`./install.sh`)"
- If existing `version=` **== current** → idempotency check via hash (above)

**Merge conflict recovery:** if parsing `AGENTS.md` finds >1 `<!-- BEGIN cortex-x retrofit -->` block (e.g., from a git merge), warn + keep the most recent (by `date=`), delete the others.

### 3.5 README pointer
Append (don't replace) to `README.md`:
```markdown
## Development with cortex-x

This project uses cortex-x for Claude Code integration. See `CLAUDE.md` for current state, `~/.claude/shared/standards/` for governance invariants.
```

### 3.6 Git commit
- One commit per subphase, never batched
- Messages: `chore(retrofit): add CLAUDE.md from Phase 1 audit`, `chore(retrofit): register cortex-x global hooks`, etc.
- **Never commit runtime code changes in retrofit.** If an edit outside `.claude/` or `CLAUDE.md`/`PROGRESS.md`/`MEMORY.md` appears in staged diff, STOP and ask.

## Dry-run mode

Invoke retrofit with `--dry-run` at the top of the initial prompt. Claude runs Phases 0-2 normally but **never applies** Phase 3 — instead produces a unified diff preview:

```bash
# User prompt: "[dry-run] retrofit this project"
```

Outputs:
- Full Phase 2 plan with all Option-3 decisions and coexistence matrix
- Proposed file contents for `CLAUDE.md` / `MEMORY.md` / `PROGRESS.md` / `AGENTS.md` append section
- List of every `.claude/settings.json` merge target
- No writes, no commits

Use dry-run on sensitive client projects to **review before committing** — standard practice in Ansible/Terraform/make-install UX.

## Platform-specific notes

**Windows:** detectors already use `path.join` + `os.homedir()` correctly. However, template-baked `{{cortex_source}}` paths may contain backslashes — these are valid for PowerShell but can break regex/grep in scripts. When writing paths into scaffolded files, **normalize to forward-slashes** via `.replace(/\\/g, '/')` before substitution.

**Yarn PnP (Zero-Installs):** `.pnp.cjs` at root indicates no `node_modules`. Note in CLAUDE.md so Claude doesn't try to `cd node_modules`. Tools resolve via `yarn node` wrapper or pnpapi.

**Corporate private registry:** if `.npmrc` / `.yarnrc.yml` / `.pypirc` contain auth tokens, verify `.gitignore` covers them. Cortex-x retrofit never reads or logs credential fields.

**Shallow clone:** if `.git/shallow` exists, Agent C's `git log` undercounts commits. Annotate `commit_count` as lower-bound.

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
- ❌ **Touching populated `.claude/CLAUDE.md` / `.claude/settings.local.json` / `.claude/docs/**` / `.codex/**` / `.cursorrules` / `.mcp.json`** when Option 3 applies — that's another framework's IP, cortex-x lives in the `.claude/cortex-x/` sibling namespace
- ❌ Skipping Phase 0 detectors "because we'll figure it out manually" — detectors are deterministic, <100ms, and inform every downstream agent. No skip.
- ❌ Skipping Agent D "because the project looks simple" — a populated `AGENTS.md` or `.cursorrules` at root is invisible until you scan. Always run D.
- ❌ Skipping Agent E "because this isn't AI-heavy" — Rule 2 Critical (Security + Correctness) applies to every production project regardless of AI presence

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
