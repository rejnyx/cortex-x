# Skills — Portable, Progressive-Disclosure Agent Instructions

> A **skill** is a reusable, markdown-format instruction set that agents load **on-demand** when their description matches the user's intent. Skills let you package expertise once and run it across Claude Code, Hermes Agent, Codex, Cursor, VS Code Copilot, and any other tool that speaks the [agentskills.io](https://agentskills.io/) open standard.

## Tier

**Rule 3 (Process)** — should-have convention. Skills are optional for trivial projects but deliver large leverage when you have repeatable procedures.

## Why skills (not another standard, not another prompt)

Skills sit in a specific slot:

| Artifact | Purpose | When loaded |
|---|---|---|
| **Standards** (`~/.claude/shared/standards/`) | Inviolable rules + conventions | Always, via CLAUDE.md reference |
| **Prompts** (`~/.claude/shared/prompts/`) | One-shot flows (scaffold, review, sync) | Pasted manually or triggered by name |
| **Agents** (`~/.claude/shared/agents/`) | Specialized reviewer roles (subagents) | Spawned by the orchestrator |
| **Skills** (`~/.claude/shared/skills/`) | **Reusable procedures the agent itself activates mid-task** | On-demand, by description match |

A standard says "use RLS from day 1." A skill says "when a user asks for a Supabase migration, here's the exact procedure — read schema, draft SQL, write migration file, generate types, re-run RLS verification." Agent reads the description, decides it matches, loads the full body.

## The agentskills.io open standard

Anthropic published the **Agent Skills** specification in late 2025. NousResearch Hermes Agent adopted it in March 2026. Codex, VS Code Copilot, and Cursor are converging. Writing skills to this spec gives you **free portability across the 2026 agent ecosystem**.

**Spec source:** [agentskills.io/specification](https://agentskills.io/specification) · [Anthropic spec on GitHub](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md)

### Required frontmatter

```yaml
---
name: supabase-migration
description: Create or modify a Supabase Postgres migration with RLS. Use when the user asks to "add a column," "create a table," "modify the schema," or similar database structure changes. Do NOT use for data fixes (INSERT/UPDATE queries).
---
```

**name:** kebab-case slug, unique within skill directory.
**description:** 1-3 sentences describing **when the skill applies and when it doesn't**. This is what the agent matches against user intent during Level 0 scan. Quality here = skill usefulness.

### Optional frontmatter

```yaml
---
name: supabase-migration
description: ...
version: 0.2.0            # semver; bump on behavior change
platforms: [claude-code, hermes, codex]  # which hosts this is tested on
tags: [supabase, database, migrations]   # for search/indexing
---
```

### Body structure (recommended sections)

```markdown
# Supabase Migration Skill

## When to use

- User asks to add/modify a Postgres table, column, index, or RLS policy
- User says "migration," "schema change," "db:push"

## When NOT to use

- Data-only changes (INSERT/UPDATE/DELETE on existing rows) — use `supabase-data-op` skill
- Queries for reading data — use regular SQL, no skill needed

## Prerequisites

- Supabase CLI installed (`supabase --version` returns ≥2.10)
- `supabase/` directory exists in project root

## Procedure

1. Read existing schema: `cat supabase/migrations/*.sql | tail -200`
2. Draft new migration SQL — include RLS policies from day 1
3. Write to `supabase/migrations/<timestamp>_<slug>.sql`
4. Run `supabase db push` (local) or guide user to staging deploy
5. Regenerate types: `supabase gen types typescript --local > src/lib/supabase/types.ts`
6. Verify: `supabase inspect db table-sizes | grep <new_table>`

## Pitfalls

- Do not skip RLS — even for "internal" tables. Retrofit is painful.
- Index foreign keys at migration time, not later.
- Never edit a migration after it's been run in prod — write a new one.

## Verification

- New migration file exists under `supabase/migrations/`
- `supabase gen types` completes without errors
- New table appears in `src/lib/supabase/types.ts`
- RLS policies listed via `supabase inspect db table-rls`

## References

- Project SSOT (if present): `docs/db-conventions.md`
- Standards: `~/.claude/shared/standards/scalable.md` § Database
```

## Progressive disclosure (Level 0 / Level 1)

The agent does **not** read full skill bodies up-front. Two-level loading:

- **Level 0** (always loaded): `skills/index.md` lists all `name` + `description` fields
- **Level 1** (on-demand): agent loads full body when description matches current intent

This keeps the context window clean. 50 skills ≈ 3-5KB in Level 0, each full body stays lazy.

`index.md` is generated — don't hand-maintain it. Run `~/.claude/shared/prompts/skills-reindex.md` after adding or editing skills.

## Directory layout

```
~/.claude/shared/skills/
├── index.md                       # auto-generated Level 0 digest
├── supabase-migration/
│   └── SKILL.md
├── add-api-route/
│   └── SKILL.md
├── write-eval-suite/
│   ├── SKILL.md
│   └── examples/
│       └── chat-refund.yaml       # referenced artifacts
└── next-route-migration/
    └── SKILL.md
```

One directory per skill. `SKILL.md` is the entry point (frontmatter + body). Supplementary files (examples, templates, reference data) live in the same directory.

## Rules

1. **One skill = one procedure.** Don't bundle "do X and also Y." Split.
2. **Description must distinguish when-to-use from when-NOT-to-use.** Vague descriptions mis-fire; the agent activates the wrong skill.
3. **Skills are for procedures, not knowledge.** Facts go in standards or CLAUDE.md. Skills are steps.
4. **No secrets in skill files.** Skills are committed, distributed, sometimes shared. Env-var references OK; never the values.
5. **Version on behavior change.** If step 3 changes from "run `supabase db push`" to "run `supabase db push --include-all`," bump the version.
6. **Verification step is mandatory.** How does the agent confirm the skill succeeded? No verification = no skill.
7. **Describe pitfalls from real incidents.** The "Pitfalls" section is where institutional wisdom lives. This is why skills exist.

## Portability matrix (2026)

Skills written to the agentskills.io spec run in:

| Host | Status | Notes |
|---|---|---|
| Claude Code | ✅ Native | Reads `.claude/skills/` + `~/.claude/shared/skills/` |
| Hermes Agent (NousResearch) | ✅ Native | agentskills.io-compat since v0.8.0 |
| Codex (Anthropic) | ✅ Native | Same spec author |
| Cursor | 🟡 Via MCP skills server | Indirect, not native |
| VS Code Copilot | 🟡 Via extensions | Spec support announced, rolling out |
| AutoGen / CrewAI / LangChain | ❌ No native support | Convert to their tool format manually |

## Anti-patterns

- ❌ **Mega-skill** that tries to do 5 things conditionally (split into 5 skills)
- ❌ **"Helpful tips" skill** with 20 bullet points and no procedure (that's a standard, not a skill)
- ❌ **Description fused with body** — description should fit in 3 sentences that make activation deterministic
- ❌ **Copying standards into skills** — skills reference standards, don't duplicate them (SSOT)
- ❌ **Skills that require editing themselves mid-run** — this is the browser-harness anti-framework pattern; cortex-x treats agent-authored tool mutation as a destructive-op requiring HITL (see [security.md](./security.md) § Browser Automation Security)

## When a new skill is worth it

Rule of three: if you've paste-walked Claude through the same 5+ step procedure **three times**, it's a skill. If you've done it twice, it's ad-hoc. If it's a one-off, it's a prompt or a manual edit.

## Quality validation

cortex ships [`bin/cortex-skill-validate.cjs`](../bin/cortex-skill-validate.cjs) — a 3-tier validator that checks every shared SKILL.md against:

- **Tier A (FAIL)** — agentskills.io spec violations (name regex, length caps, body ≤ 500 lines, forward-slash paths)
- **Tier B (WARN)** — Claude-Code-only constraints (combined `description + when_to_use` ≤ 1536 chars listing budget, reserved-token bans on `anthropic`/`claude`, no XML tags, 3rd-person heuristic)
- **Tier C (SCORE)** — cortex opinion (verb-first description, trigger-last surface, no internal jargon, sufficient density)

Plus optional `--security` mode regex-grepping for ToxicSkills payload classes (credential exfiltration, base64-decode-and-exec, password-protected archives, `eval $(curl …)`). Citation in every rule message; details in [`standards/skill-validate.md`](./skill-validate.md).

cortex does NOT reimplement broad spec lint — that's `agnix` (npm, 414 rules). Run `agnix` first, then cortex-skill-validate adds the opinion layer.

## Cross-references

- agentskills.io spec: https://agentskills.io/specification
- Anthropic Agent Skills GitHub: https://github.com/anthropics/skills
- Anthropic skill authoring guide: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Anthropic Skill Creator: https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- agnix (broad spec lint): https://github.com/agent-sh/agnix
- ToxicSkills audit (Snyk Feb 2026): https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- Hermes Agent skill system: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- cortex-x template: `~/.claude/shared/templates/SKILL.md.hbs`
- cortex-x validator: `~/.claude/shared/bin/cortex-skill-validate.cjs`
- Skill scaffold prompt: `~/.claude/shared/prompts/new-skill.md` (future)
