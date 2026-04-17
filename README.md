# cortex-x

> Personal Claude Code framework by **Rejnyx**. Bootstrap new projects with senior-level orchestration, safety, and standards in under 3 minutes.

## What it does

Opens a new empty project folder → one command → you get:

- **CLAUDE.md** tailored to your stack (Next.js+Supabase / Chatbot / WaaS / Kiosek / Minimal)
- **PROGRESS.md** sprint tracking template
- **.claude/** folder with hooks, subagents, skills, settings
- **MEMORY.md** multi-layer memory scaffold
- **README.md**, **LICENSE**, **.gitignore** — stack-appropriate
- Principles injected: **SSOT, Modular, Scalable, Security**
- Optional: web research of 2026 best practices for your use case

## Design principles

1. **SSOT** — Every piece of knowledge lives in exactly one place
2. **Modular** — Each subsystem replaceable without breaking others
3. **Scalable** — Default to patterns that survive 10x growth
4. **Security** — Block destructive ops, never commit secrets, RLS from day 1

## Repo structure

```
cortex-x/
├── bin/              CLI entrypoint (init, doctor, sync)
├── profiles/         Project-type profiles (Next.js SaaS, Chatbot, WaaS, ...)
├── templates/        Handlebars templates (CLAUDE.md, PROGRESS.md, ...)
├── standards/        Principle docs (SSOT, Modular, Scalable, Security)
├── shared/
│   ├── hooks/        Universal safety + context hooks
│   ├── skills/       Reusable skills (init, doctor, memory-consolidate)
│   └── agents/       Reusable subagents (reviewer, security, architect)
├── detectors/        Auto-detect project type from package.json
├── research/         Cached 2026 best-practices per profile
└── install.sh        One-command install to ~/.claude/
```

## Installation (coming in Phase 2)

```bash
git clone https://github.com/Rejnyx/cortex-x.git ~/cortex-x
cd ~/cortex-x && ./install.sh
```

## Usage (coming in Phase 2)

```bash
cd my-new-project
cortex init              # interactive wizard
cortex init --research   # with 2026 web research
cortex doctor            # healthcheck your setup
```

## Status

**Phase 1 — Foundation** (in progress)
- Shared hooks (block-destructive, session-start, pre-compact)
- Templates + standards
- First profile: Next.js + Supabase

**Phase 2 — Bootstrap skill** — `/init-project` with Clack CLI

**Phase 3 — Multi-agent** — Orchestrator + review pipeline

**Phase 4 — Web research** — Live 2026 best practices per use case

**Phase 5 — RELO upgrades** — 6-signal memory scoring, graph expansion, DREAMS.md

## License

Proprietary. See [LICENSE](./LICENSE).

---

**Author:** David Rajnoha (Rejnyx) · REDACTED@redacted.invalid
