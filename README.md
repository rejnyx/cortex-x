# cortex-x

> **AI-agentic-first** personal Claude Code framework by **Rejnyx**. Bootstrap new projects with agentic-ready architecture, senior-level orchestration, safety, and standards in under 3 minutes.

## 🧠 Positioning (2026)

**In 2026, starting a new SaaS/tool/platform without AI-agentic-ready architecture is a bet against the grain.** cortex-x defaults to agentic-ready (safe-tool wrapper, three-layer memory scaffold, `/api/chat` reserved, cost guards ready) even if MVP has no AI features yet.

**Agentic-ready by default. Agentic-heavy by intent. Opt-out for static sites & prototypes.**

Retrofitting agentic patterns into a CRUD codebase = architecture rewrite. 30 min of scaffolding earns back 10x when AI feature comes 3 months later. (See [standards/ai-patterns.md](./standards/ai-patterns.md).)

## What it does

Opens a new empty project folder → one command → you get:

- **CLAUDE.md** tailored to your stack (Next.js+Supabase / Chatbot / WaaS / Kiosek / Minimal)
- **PROGRESS.md** sprint tracking template
- **.claude/** folder with hooks, subagents, skills, settings
- **MEMORY.md** multi-layer memory scaffold
- **README.md**, **LICENSE**, **.gitignore** — stack-appropriate
- Principles injected: **SSOT, Modular, Scalable, Security**
- Optional: web research of 2026 best practices for your use case

## Core Mental Model — SSOT respected

**cortex-x holds institutional wisdom. Project `CLAUDE.md` holds current state.**

| Lives in project CLAUDE.md (changes) | Lives in cortex-x (stable) |
|--------------------------------------|----------------------------|
| Tech Stack (versions change) | Lessons Learned (what failed) |
| Architecture (refactors) | Key Decisions (why we chose X) |
| Commands (new scripts) | Cross-Project Dependencies |
| Env Vars (new integrations) | Glossary (domain terms) |
| Directory Structure | Identity (one-liner + URL) |
| Stats (LOC, tests) | |

**Rule:** If the info ROTS (changes in weeks), it's CLAUDE.md's job. Cortex stays valid for years.

No duplication = no drift = no lying cortex entries.

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

### 🧠 Deep reflection (when something feels off)
```
Paste ~/cortex-x/prompts/cortex-reflect.md → cortex-thinker subagent
analyzes current project + library state, surfaces 0-3 grounded insights,
writes to ~/cortex-x/insights/<date>.md
```

### 🔬 Code review (BMAD-inspired parallel adversarial pipeline)
```
After feature work, paste ~/cortex-x/prompts/code-review.md
→ spawns 5 agents in parallel with DIFFERENTIATED context scoping:
   - blind-hunter (diff ONLY — catches what contextual reviewers rationalize)
   - edge-case-hunter (diff + project — boundary condition enumeration)
   - acceptance-auditor (diff + PROGRESS.md — spec drift)
   - security-auditor (diff + standards/security.md — 8-layer audit)
   - ssot-enforcer (diff + config/ — duplication detection)
→ triages findings by severity, verdict: ship / fix / block
```

### 🩺 Healthcheck
```
Paste ~/cortex-x/prompts/cortex-doctor.md → diagnose cortex-x installation,
identify drift, suggest fixes. Run weekly or after system migration.
```

### 📊 Sprint status
```
Paste ~/cortex-x/prompts/sprint-status.md → parse PROGRESS.md,
surface active sprint, next actionable story, drift detection.
Fast (<5s), runs at session start.
```

### 📝 Retrospective
```
End of sprint → paste ~/cortex-x/prompts/retrospective.md
→ 4 questions, distill TRANSFERABLE lessons into cortex library.
Only path that compounds institutional memory across 6+ projects.
```

### 🔬 Auto-research (cortex primitive)
```
Cortex sám spouští web research před velkými rozhodnutími — bez tvého zásahu.

Triggers (SSOT v ~/cortex-x/config/research.yaml):
- new project bootstrap → 4 paralelní agenti
- unknown domain → 2 agenti
- stale cache (>180 dní) → refresh
- security-sensitive prompt → 1 security-focused agent
- explicit --research flag

Cache do ~/cortex-x/research/<slug>-<date>.md. TTL per topic
(tech: 90d, security: 60d, competitive: 180d, domain: 365d).

Budget: max 1 research batch/session, 10/week celkem.
Protokol: ~/cortex-x/shared/research-protocol.md
```

### 🧬 Evolve (self-improvement loop)
```
Weekly → paste ~/cortex-x/prompts/cortex-evolve.md "weekly"
→ Mining algoritmic (PrefixSpan + TF-IDF contrast) → hard evidence gate
  (min 3 events, ≥2 projects, >7 days spread) → LLM validation (not generation)
  → 0-3 proposals do ~/cortex-x/insights/proposals/ (PR, nikdy auto-merge)

Monthly → paste ~/cortex-x/prompts/cortex-evolve.md "monthly"
→ Eval suite run (10 canonical tasks, Aider-style) → score delta vs baseline
  → if regression: auto-attribute → rollback proposal PR.

Framework se zlepšuje sám, ale NIKDY nepřepisuje standards/prompts/profiles —
jen navrhuje diffy přes PR. Viz ~/cortex-x/docs/self-improvement-rfc.md.
```

## The Thinking Layer

Cortex isn't just templates — it **thinks**:

- **SessionStart hook** auto-detects if current project has cortex entry, mentions it
- **cortex-thinker subagent** reflects on cross-project patterns, grounds every insight in file paths
- **insights/** directory captures proactive observations (standard violations, transferable patterns, repeated mistakes, stale entries, security regressions)
- **journal/** tracks tool-use traces (privacy-safe metadata only) for repeat-mistake detection
- **Budget:** max 1 insight per session, max 3 per week — silence > noise

Cortex acts as **senior engineer partner** — catches what Dave misses, politely, once, moves on.

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
- 5 universal hooks (block-destructive, session-start, pre-compact, pre-tool-use, post-tool-use)
- 9 project profiles (nextjs-saas, waas, chatbot, ai-agent, tauri, astro, cli, kiosek, minimal)
- 11 standards (SSOT, Modular, Scalable, Security, Testing, Observability, Performance, A11y, Error handling, Git, Docs)
- 5 templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md)
- Cross-platform install scripts

**Phase 2 — Bootstrap skill** — `/init-project` with Clack CLI

**Phase 3 — Multi-agent** — Shared orchestrator + review pipeline (code-reviewer, security-checker, architecture-guard, design-checker, test-writer, db-reviewer, doc-updater)

**Phase 4 — Web research** — Live 2026 best practices per use case via `--research` flag

**Phase 5 — Self-improvement loop** ✅ (v1 — 2026-04-17)
- 4-cadence architecture (daily ingest / weekly mining / monthly eval / quarterly audit)
- Hard anti-hallucination gates (min_support=3, ≥2 projects, >7d spread, Bonferroni, citations required)
- Aider-style eval suite (10 canonical tasks, scored per commit)
- PR-only mutations (framework never auto-edits its own source of truth)
- Meta-loop: every 30 insights → effectiveness review → threshold tuning

**Phase 6 — Memory upgrades** — 6-signal scoring, graph expansion, DREAMS.md (port back to RELO)

## License

Proprietary. See [LICENSE](./LICENSE).

---

**Author:** David Rajnoha (Rejnyx) · REDACTED@redacted.invalid
