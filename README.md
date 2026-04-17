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

## Design principles (11 standards)

Every scaffolded project inherits these — see [standards/](./standards/README.md) for full docs:

1. **[SSOT](./standards/ssot.md)** — One source of truth per piece of knowledge
2. **[Modular](./standards/modular.md)** — Isolated subsystems with clean interfaces
3. **[Scalable](./standards/scalable.md)** — Patterns that survive 10x growth
4. **[Security](./standards/security.md)** — Layered defense, 8-layer model, RLS from day 1
5. **[Testing](./standards/testing.md)** — Test pyramid, 5 pillars per test (happy/error/edge/security/integration)
6. **[Observability](./standards/observability.md)** — Structured logs, metrics, traces, Sentry from day 1
7. **[Performance](./standards/performance.md)** — Core Web Vitals, DB indexes, streaming, bundle budgets
8. **[Accessibility](./standards/accessibility.md)** — WCAG 2.2 AA, keyboard, screen reader, reduced motion
9. **[Error handling](./standards/error-handling.md)** — Classify, recover, user-friendly messages
10. **[Git workflow](./standards/git-workflow.md)** — Atomic commits, safety, conventional commits
11. **[Documentation](./standards/documentation.md)** — README + CLAUDE.md + PROGRESS.md + ADRs

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

## Installation

```bash
git clone https://github.com/Rejnyx/cortex-x.git ~/cortex-x
cd ~/cortex-x
./install.sh    # Unix / Git Bash / WSL
# or
.\install.ps1   # Windows PowerShell
```

## Usage — no CLI needed, Claude IS the CLI

Three core prompts (paste into Claude Code):

### 🌱 Start NEW project
```
Empty folder → open Claude Code → paste ~/cortex-x/prompts/new-project.md
→ answer 3 questions → full project scaffolded in ~3 minutes
```

### 🔍 Scan EXISTING project (populate cortex library)
```
Project root → Claude Code → paste ~/cortex-x/prompts/project-scan.md
→ Claude scans codebase, writes ~/cortex-x/projects/<slug>.md
```

### 🔄 Sync knowledge after work session
```
End of sprint → paste ~/cortex-x/prompts/cortex-sync.md
→ Claude captures decisions, lessons, cross-project insights
```

### 📚 Load context at start of ongoing project session
Add to project's `CLAUDE.md`:
```markdown
## Cross-project context
See ~/cortex-x/prompts/cortex-load.md before starting work.
```

## Available profiles

Every scaffolded project picks ONE profile that defines its stack + conventions:

| Profile | Use case | Example Dave project |
|---------|----------|---------------------|
| **nextjs-saas** | Next.js + Supabase + OpenAI SaaS | RELO, Chatbot Platform |
| **waas-template** | Website-as-a-Service, multi-tenant | Champions Barber |
| **chatbot-platform** | Multi-tenant chatbot with channel adapters | Amici, Objednáme |
| **ai-agent** | Autonomous multi-step AI agent | RELO |
| **tauri-desktop** | Cross-platform desktop app (Rust + Web) | Future |
| **astro-static** | Portfolio, blog, docs (zero-JS) | portfolio-uxui |
| **cli-tool** | Node.js CLI published to npm | cortex-x itself |
| **kiosek** | Restaurant touch kiosk PWA | Kiosek |
| **minimal** | Quick prototype, no ceremony | Experiments |

Pick via `cortex init` → interactive selector → scaffolds everything.

## Cross-platform (Windows + macOS + Linux)

- `.gitattributes` enforces LF for shell/Node.js, CRLF for PowerShell
- Install scripts: `install.sh` (Unix/Git Bash/WSL) + `install.ps1` (Windows PowerShell)
- Hooks use `os.homedir()` — never hardcoded paths
- `path.join()` everywhere — handles Windows spaces
- Tested on: Windows 11, macOS 14+, Ubuntu 22+

## Status

**Phase 1 — Foundation** ✅
- 3 universal hooks (block-destructive, session-start, pre-compact)
- 9 project profiles (nextjs-saas, waas, chatbot, ai-agent, tauri, astro, cli, kiosek, minimal)
- 11 standards (SSOT, Modular, Scalable, Security, Testing, Observability, Performance, A11y, Error handling, Git, Docs)
- 5 templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md)
- Cross-platform install scripts

**Phase 2 — Bootstrap skill** — `/init-project` with Clack CLI

**Phase 3 — Multi-agent** — Shared orchestrator + review pipeline (code-reviewer, security-checker, architecture-guard, design-checker, test-writer, db-reviewer, doc-updater)

**Phase 4 — Web research** — Live 2026 best practices per use case via `--research` flag

**Phase 5 — Memory upgrades** — 6-signal scoring, graph expansion, DREAMS.md (port back to RELO)

## License

Proprietary. See [LICENSE](./LICENSE).

---

**Author:** David Rajnoha (Rejnyx) · davidrajnoha@gmail.com
