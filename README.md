# cortex-x

> **A persistent agent, not just a tool.** AI-agentic-first personal Claude Code framework by **Rejnyx**. Bootstrap new projects with agentic-ready architecture, senior-level orchestration, safety, and standards in under 3 minutes — then let Hermes maintain them autonomously, every night, forever.

## 🧠 Mission

cortex-x is on a trajectory from "framework that scaffolds projects" to **persistent autonomous entity that lives alongside its operator** — curating knowledge, maintaining code, learning from every iteration, and improving itself while the operator sleeps. The endgame is not "an excellent dev tool" — it's **the operator's second brain in markdown form, running 24/7 on home infrastructure, with the engineering rigor of a senior team.**

Every sprint moves us toward one of three north-star metrics:

1. **Verification fidelity** — % of agent edits that don't introduce regressions undetected by `npm test`.
2. **Throughput per operator-hour** — net useful PRs Hermes opens per hour of operator review time.
3. **Self-evolution rate** — # of new capabilities/skills/strategies the agent itself contributes per week.

Roadmap: [`docs/hermes-roadmap.md`](./docs/hermes-roadmap.md) (Tier 1 Foundation → Tier 2 Compound learners → Tier 3 Productization → Tier 4 Personal AI entity).

## 🧠 Positioning (2026)

**In 2026, starting a new SaaS/tool/platform without AI-agentic-ready architecture is a bet against the grain.** cortex-x defaults to agentic-ready (safe-tool wrapper, three-layer memory scaffold, `/api/chat` reserved, cost guards ready) even if MVP has no AI features yet.

**Agentic-ready by default. Agentic-heavy by intent. Opt-out for static sites & prototypes.**

Retrofitting agentic patterns into a CRUD codebase = architecture rewrite. 30 min of scaffolding earns back 10x when AI feature comes 3 months later. (See [standards/ai-patterns.md](./standards/ai-patterns.md).)

## What it does

Opens a new empty project folder → one command → you get:

- **CLAUDE.md** tailored to your stack (one of 9 profiles — see below)
- **PROGRESS.md** sprint tracking template
- **.claude/** folder with hooks, subagents, skills, settings
- **MEMORY.md** multi-layer memory scaffold
- **README.md**, **LICENSE**, **.gitignore** — stack-appropriate
- Principles injected: **SSOT, Modular, Scalable, Security**
- Optional: web research of 2026 best practices for your use case

## Two AI surfaces — Claude Code by day, Hermes by night

cortex-x runs on **two AI surfaces** that share the same project memory.

**Claude Code (interactive).** Your IDE-side AI partner — drives feature work, code review, refactors. Reads cortex-x hooks · skills · agents · standards from `~/.claude/`. Use it dev-time.

**Hermes (autonomous nightly).** Your AI nightly autopilot. Drop a `cortex/recommendations.md` in your repo. Hermes reads it overnight, runs the LLM (~$0.0008/run), applies edits, gates on `npm test`, opens a draft PR. You wake up, review the diff, merge or reject.

> **Safety primitives baked in.** Every Hermes run: ① always opens **draft PR**, never pushes to main · ② **halt switch** `touch ~/.cortex/HERMES_HALT` stops it immediately · ③ **$5/day spend cap** + 3-failure-per-action circuit breaker · ④ atomic rollback on any phase failure.

See [docs/hermes-usage.md](./docs/hermes-usage.md) to activate Hermes for your repo.

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
├── profiles/         Project-type profiles (Next.js SaaS, Chatbot, Website-as-a-Service, ...)
├── templates/        Handlebars templates (CLAUDE.md, PROGRESS.md, ...)
├── standards/        Principle docs (SSOT, Modular, Scalable, Security)
├── shared/
│   ├── hooks/        Universal safety + context hooks
│   ├── skills/       Reusable skills (init, doctor, memory-consolidate)
│   └── agents/       Reusable subagents (reviewer, security, architect)
├── detectors/        Auto-detect project type from package.json
├── research/         Cached 2026 best-practices per profile
├── tests/            Tier 0-5 QA infrastructure (207 tests, 5-lane CI matrix)
├── tools/            Verifiers (verify-prompts, verify-skills, verify-audit-output, verify-install)
├── projects/         README only — actual project entries land in $CORTEX_DATA_HOME/projects/
└── install.sh        One-command install to ~/.claude/
```

> **XDG separation (Sprint 1.6, 2026-04).** The repo holds **framework code only**. Personal data — your project library entries, journal traces, research cache, insights — lives in `$CORTEX_DATA_HOME/projects/` (defaults to `~/.cortex/projects/`). The empty-looking `projects/` in the repo is intentional: it documents the contract; data is per-machine. See [docs/SSOT-architecture.md](./docs/SSOT-architecture.md) if it exists, or `cortex-source.yaml` after install.

## Installation

### Public install (after v0.1.0 — when this repo is public)

**Linux / macOS / WSL / Git Bash:**

```bash
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
iwr https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex
```

The installer self-clones to `~/cortex-x` (override with `CORTEX_HOME=...`),
copies framework assets to `~/.claude/shared/`, prints the final PATH-add
line for your shell.

### Closed-beta install (current — repo is private)

Public `raw.githubusercontent.com` URLs return 404 for private repos. Beta
testers should use either of these:

**Option 1 — `gh` CLI (recommended; you're probably already authed):**

```bash
gh repo clone Rejnyx/cortex-x ~/cortex-x
~/cortex-x/install.sh        # or ~/cortex-x/install.ps1 on Windows
```

The installer's stream-detection block also tries `gh repo clone` and
`GITHUB_TOKEN`-authenticated HTTPS as fallbacks if anonymous clone 404s,
so the curl|bash one-liner *does* work for closed-beta testers who have
`gh` authenticated — but starting from a manual `gh repo clone` is simpler.

**Option 2 — `GITHUB_TOKEN` env var:**

```bash
export GITHUB_TOKEN=ghp_yourtoken
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
```

(Token needs `repo` read scope on `Rejnyx/cortex-x`.)

### After install — three commands per project

```bash
cd ~/your-project
cortex-bootstrap      # interactive: [N]ew / [E]xisting / [F]ramework
claude                # auto-primes /start (new) or /audit (existing)
```

### Manual install (after a clone)

```bash
git clone https://github.com/Rejnyx/cortex-x ~/cortex-x
~/cortex-x/install.sh        # Unix / Git Bash / WSL
# or
~/cortex-x/install.ps1       # Windows PowerShell
```

This is the path to take when you want to read the source before running
it, or when contributing patches.

## Usage — no CLI needed, Claude IS the CLI

Three core prompts (paste into Claude Code):

### 🌱 Start NEW project
```
Empty folder → open Claude Code → paste ~/.claude/shared/prompts/new-project.md
→ answer 3 questions → full project scaffolded in ~3 minutes
```

### 🔍 Scan EXISTING project (populate cortex library)
```
Project root → Claude Code → paste ~/.claude/shared/prompts/project-scan.md
→ Claude scans codebase, writes $CORTEX_DATA_HOME/projects/<slug>.md
```

### 🔄 Sync knowledge after work session
```
End of sprint → paste ~/.claude/shared/prompts/cortex-sync.md
→ Claude captures decisions, lessons, cross-project insights
```

### 📚 Load context at start of ongoing project session
Add to project's `CLAUDE.md`:
```markdown
## Cross-project context
See ~/.claude/shared/prompts/cortex-load.md before starting work.
```

### 🧠 Deep reflection (when something feels off)
```
Paste ~/.claude/shared/prompts/cortex-reflect.md → cortex-thinker subagent
analyzes current project + library state, surfaces 0-3 grounded insights,
writes to $CORTEX_DATA_HOME/insights/<date>.md
```

### 🔬 Code review (BMAD-inspired parallel adversarial pipeline)
```
After feature work, paste ~/.claude/shared/prompts/code-review.md
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
Paste ~/.claude/shared/prompts/cortex-doctor.md → diagnose cortex-x installation,
identify drift, suggest fixes. Run weekly or after system migration.
```

### 📊 Sprint status
```
Paste ~/.claude/shared/prompts/sprint-status.md → parse PROGRESS.md,
surface active sprint, next actionable story, drift detection.
Fast (<5s), runs at session start.
```

### 📝 Retrospective
```
End of sprint → paste ~/.claude/shared/prompts/retrospective.md
→ 4 questions, distill TRANSFERABLE lessons into cortex library.
Only path that compounds institutional memory across 6+ projects.
```

### 🔬 Auto-research (cortex primitive)
```
Cortex sám spouští web research před velkými rozhodnutími — bez tvého zásahu.

Triggers (SSOT v $CORTEX_HOME/config/research.yaml):
- new project bootstrap → 4 paralelní agenti
- unknown domain → 2 agenti
- stale cache (>180 dní) → refresh
- security-sensitive prompt → 1 security-focused agent
- explicit --research flag

Cache do $CORTEX_DATA_HOME/research/<slug>-<date>.md. TTL per topic
(tech: 90d, security: 60d, competitive: 180d, domain: 365d).

Budget: max 1 research batch/session, 10/week celkem.
Protokol: ~/.claude/shared/shared/research-protocol.md
```

### 🧬 Evolve (self-improvement loop)
```
Weekly → paste ~/.claude/shared/prompts/cortex-evolve.md "weekly"
→ Mining algoritmic (PrefixSpan + TF-IDF contrast) → hard evidence gate
  (min 3 events, ≥2 projects, >7 days spread) → LLM validation (not generation)
  → 0-3 proposals do $CORTEX_DATA_HOME/insights/proposals/ (PR, nikdy auto-merge)

Monthly → paste ~/.claude/shared/prompts/cortex-evolve.md "monthly"
→ Eval suite run (10 canonical tasks, Aider-style) → score delta vs baseline
  → if regression: auto-attribute → rollback proposal PR.

Framework se zlepšuje sám, ale NIKDY nepřepisuje standards/prompts/profiles —
jen navrhuje diffy přes PR. Viz $CORTEX_HOME/docs/self-improvement-rfc.md.
```

## The Thinking Layer

Cortex isn't just templates — it **thinks**:

- **SessionStart hook** auto-detects if current project has cortex entry, mentions it
- **cortex-thinker subagent** reflects on cross-project patterns, grounds every insight in file paths
- **insights/** directory captures proactive observations (standard violations, transferable patterns, repeated mistakes, stale entries, security regressions)
- **journal/** tracks tool-use traces (privacy-safe metadata only) for repeat-mistake detection
- **Budget:** max 1 insight per session, max 3 per week — silence > noise

Cortex acts as **senior engineer partner** — catches what the user misses, politely, once, moves on.

## Available profiles

Every scaffolded project picks ONE profile that defines its stack + conventions:

| Profile | Use case | Typical example |
|---------|----------|-----------------|
| **nextjs-saas** | Next.js + Supabase + OpenAI SaaS | back-office AI agent, admin platform |
| **waas-template** | Website-as-a-Service, multi-tenant | barbershop / gym / restaurant landing template |
| **chatbot-platform** | Multi-tenant chatbot with channel adapters | e-commerce assistant, booking agent |
| **ai-agent** | Autonomous multi-step AI agent | domain-specific assistant with tool use |
| **tauri-desktop** | Cross-platform desktop app (Rust + Web) | local-first productivity tool |
| **astro-static** | Portfolio, blog, docs (zero-JS) | personal portfolio, changelog site |
| **cli-tool** | Node.js CLI published to npm | dev tooling, scripts-as-a-CLI |
| **kiosek** | Restaurant / retail touch kiosk PWA | self-service ordering screen |
| **minimal** | Quick prototype, no ceremony | experiments, spikes |

Pick via `cortex init` → interactive selector → scaffolds everything.

## Cross-platform (Windows + macOS + Linux)

- `.gitattributes` enforces LF for shell/Node.js, CRLF for PowerShell
- Install scripts: `install.sh` (Unix/Git Bash/WSL) + `install.ps1` (Windows PowerShell)
- Hooks use `os.homedir()` — never hardcoded paths
- `path.join()` everywhere — handles Windows spaces
- Tested on: Windows 11, macOS 14+, Ubuntu 22+

## Status

> **Shipped infra vs designed patterns.** Items below split by *what runs today* (✅) vs *what's specified but awaits Phase 7 runtime* (⏳ designed). Read the status mark before betting on a feature.

**Phase 1 — Foundation** ✅ shipped
- 5 universal hooks (block-destructive, session-start, pre-compact, pre-tool-use, post-tool-use) — Tier 4 contract-tested
- 9 project profiles (nextjs-saas, waas, chatbot, ai-agent, tauri, astro, cli, kiosek, minimal) — schema-validated
- 11 standards (SSOT, Modular, Scalable, Security, Testing, Observability, Performance, A11y, Error handling, Git, Docs) — Rule 1/1.5/2/3 tier system
- 5 templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md)
- Cross-platform install scripts (5-lane CI matrix: ubuntu-bash, macos-bash, win-gitbash, win-pwsh7, win-ps5.1)
- Tier 0-5 QA infrastructure (207 tests, hook contract + prompt regression — 2026-05-07)

**Phase 2 — Bootstrap skill** ⚠️ partial — prompt-driven scaffold (`prompts/new-project.md`) shipped; Clack-based interactive CLI deferred

**Phase 3 — Multi-agent** ⚠️ partial — 5-agent parallel code-review pipeline (`prompts/code-review.md` → blind-hunter, edge-case-hunter, acceptance-auditor, security-auditor, ssot-enforcer) shipped; standalone orchestrator agent deferred

**Phase 4 — Web research** ✅ shipped — `prompts/new-project.md` Phase 5 dispatches 3-5 parallel research agents, `research-protocol.md` defines the contract, results cached at `$CORTEX_DATA_HOME/research/<slug>-<date>.md`

**Phase 5 — Self-improvement loop** ✅ Designed + specs (v1 — 2026-04-17) · ⏳ Automated runtime via Phase 7 (Hermes)
- 4-cadence architecture (daily ingest / weekly mining / monthly eval / quarterly audit) — **specified in `config/evolve.yaml`, not yet cron-wired**
- Hard anti-hallucination gates (min_support=3, ≥2 projects, >7d spread, Bonferroni, citations required) — enforced when `cortex-evolve` prompt is manually invoked
- Aider-style eval suite (10 canonical task rubrics in `evals/`, `evals/results/` empty pending first automated run)
- PR-only mutations (framework never auto-edits its own source of truth) — discipline encoded, no automated PR pipeline yet
- Meta-loop: every 30 insights → effectiveness review → threshold tuning — designed, awaits Hermes

**Phase 6 — Memory upgrades** ⏳ designed — 6-signal scoring, graph expansion, DREAMS.md consolidation; awaits Phase 7

**Phase 7 — Hermes runtime** ✅ v0.5b shipped 2026-05-07 · ⏳ v1 cron triggers pending
- ✅ All 5 pre-Hermes RFC gates closed (Tier 4 hook contract + Tier 5 prompt regression + hermes-policy.md + hermes-runtime.md design + fixture)
- ✅ 6 zero-dep CJS primitives in `bin/hermes/_lib/` (halt-check, lock, journal, recommendations parser, git-trailer builder, policy denylist)
- ✅ `bin/hermes/dry-run.cjs` orchestrator — reads recommendations.md, picks next action, builds Conventional-Commits-shaped commit message with Git trailers, journals run, releases lock
- ✅ `bin/hermes/status.cjs` observability CLI — reports halt + lock + recommendations + journal rollup with cost ledger
- ✅ **`bin/hermes/execute.cjs` (v0.5a)** — async runtime: dry-run plan → branch → engine apply → npm test gate → atomic commit → rollback on failure → journal cost
- ✅ **OpenRouter engine (v0.5b)** — real LLM via `fetch()` (Node ≥18), zero-deps preserved. 8 distinct error codes, configurable timeout, JSON-mode response_format, default `deepseek/deepseek-v4-flash` (~$0.0008/run). Pluggable seam: mock / openrouter / claude-sdk.
- ✅ **First real OpenRouter call validated end-to-end** (Sprint 1.6.13 dogfood): LLM → JSON → edits → test gate → atomic rollback proven safe by reality.
- ✅ **Sprint 1.6.14–1.6.18 hardening** from real-world signal + 6-agent review pipeline: `HERMES_MAX_TOKENS`, cost capture on all failure paths (`addCostFields` + `extractUsage`), JSON-fence stripping for cross-model robustness, tightened path-traversal (NUL byte + flag-injection + realpath containment), editPlan shape gate (`OPENROUTER_PLAN_SHAPE_INVALID`), null-body guard, default-model SSOT alignment, MIGRATIONS.md backfill.
- ✅ **489 tests** across `tests/unit/hermes/` + `tests/integration/hermes-dryrun.test.cjs`. All 3 CI workflows green.
- ⏳ **v0.5b finalization (Sprint 1.6.19):** `gh pr create --draft` integration in execute.cjs (push + PR open), daily spend cap (`HERMES_DAILY_USD_CAP`) + consecutive-failure circuit breaker.
- ⏳ **v1:** uncomment `.github/workflows/hermes.example.yml`, set `OPENROUTER_API_KEY` repo secret, expand from cortex-x dogfood → RELO + Kiosek.
- ⏳ **v1.5+ hardening:** hardcode endpoint, extractUsage string coercion, detached HEAD pre-flight, `<untrusted>` delimiters, denylist expansion, eval suite + property tests + stateful simulation.

See [docs/hermes-rfc.md](./docs/hermes-rfc.md), [docs/hermes-runtime.md](./docs/hermes-runtime.md), [standards/hermes-policy.md](./standards/hermes-policy.md).

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — SPDX `PolyForm-Noncommercial-1.0.0`. Noncommercial use is broadly permitted; commercial use requires a separate grant. See [LICENSE](./LICENSE) for full text.

---

**Author:** David Rajnoha (Rejnyx) · contact via [GitHub](https://github.com/Rejnyx/cortex-x)
