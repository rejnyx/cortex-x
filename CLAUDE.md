# cortex-x — Claude Code Project Framework

> Personal Claude Code framework by Rejnyx. Bootstraps new projects with senior-level orchestration, safety, and standards in under 3 minutes.

## Core Mental Model (SSOT)

cortex-x holds **institutional wisdom that doesn't change** (Lessons Learned, Key Decisions, Cross-Project Dependencies, Glossary, Identity).

Project `CLAUDE.md` holds **current state that does change** (Tech Stack, Architecture, Commands, Env Vars, Stats, Directory Structure).

**Zero overlap.** If info rots in weeks, it's CLAUDE.md's job. Cortex stays valid for years.

See [prompts/cortex-load.md](./prompts/cortex-load.md) for the authoritative mental model.

## Status

Phase 1 — Foundation (in progress)

## Tech Stack

- **Framework:** Node.js / TypeScript (future CLI)
- **Distribution:** Git repo + install.sh / install.ps1
- **Templates:** Handlebars (.hbs)
- **Profiles:** YAML
- **Target platform:** Claude Code 2.x

## Repo Structure

```
cortex-x/
├── bin/              CLI entrypoint (Phase 2)
├── profiles/         Project-type profiles (nextjs-saas, minimal, ...)
├── templates/        Handlebars templates (CLAUDE.md, PROGRESS.md, ...)
├── standards/        Principle docs (SSOT, Modular, Scalable, Security)
├── shared/
│   ├── hooks/        Universal safety + context hooks
│   ├── skills/       Reusable skills (Phase 2)
│   └── agents/       Reusable subagents (Phase 3)
├── detectors/        Auto-detect project type from package.json (Phase 2)
├── research/         Cached 2026 best-practices per profile (Phase 4)
├── docs/             Design docs, RFCs
└── install.sh/.ps1   One-command install to ~/.claude/shared/
```

## Principles

This framework enforces four standards in every scaffolded project:

1. **SSOT** — [standards/ssot.md](./standards/ssot.md)
2. **Modular** — [standards/modular.md](./standards/modular.md)
3. **Scalable** — [standards/scalable.md](./standards/scalable.md)
4. **Security** — [standards/security.md](./standards/security.md)

## Development Workflow

1. Edit files in cortex-x repo
2. Run `./install.ps1` (Windows) or `./install.sh` (Unix) to sync to `~/.claude/shared/`
3. Changes propagate to all projects using cortex-x hooks/skills/agents

## Roadmap

**Phase 1 — Foundation** (current)
- Shared hooks (block-destructive, session-start, pre-compact)
- Templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md)
- Standards (SSOT, Modular, Scalable, Security)
- First profile (nextjs-saas) + minimal fallback

**Phase 2 — Bootstrap skill**
- `/init-project` skill with Clack-based CLI
- Auto-detection via `detectors/`
- Profile resolution + template rendering
- `doctor` healthcheck command

**Phase 3 — Multi-agent**
- Shared reviewer agents (code, security, architecture, design, test, db)
- Orchestrator agent (coordinates pipeline)
- Agent Teams integration

**Phase 4 — Web research during init**
- `--research` flag uses WebSearch+WebFetch
- Cached per-profile, versioned
- Inject 2026 best practices into scaffolded CLAUDE.md

**Phase 5 — Memory upgrades**
- 6-signal scoring for autoDream promotion
- Graph expansion (2-hop) over memories
- `DREAMS.md` human-readable consolidation output

## License

Proprietary. See [LICENSE](./LICENSE).
