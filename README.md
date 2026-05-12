# cortex-x

> **A persistent agent, not just a tool.** AI-agentic-first personal Claude Code framework by **Rejnyx**. Bootstrap new projects with agentic-ready architecture, senior-level orchestration, safety, and standards in under 3 minutes — then let Steward maintain them autonomously, every night, forever.

## 🧠 Mission

cortex-x is on a trajectory from "framework that scaffolds projects" to **persistent autonomous entity that lives alongside its operator** — curating knowledge, maintaining code, learning from every iteration, and improving itself while the operator sleeps. The endgame is not "an excellent dev tool" — it's **the operator's second brain in markdown form, running 24/7 on home infrastructure, with the engineering rigor of a senior team.**

Every sprint moves us toward one of three north-star metrics:

1. **Verification fidelity** — % of agent edits that don't introduce regressions undetected by `npm test`.
2. **Throughput per operator-hour** — net useful PRs Steward opens per hour of operator review time.
3. **Self-evolution rate** — # of new capabilities/skills/strategies the agent itself contributes per week.

Roadmap: [`docs/steward-roadmap.md`](./docs/steward-roadmap.md) (Tier 1 Foundation → Tier 2 Compound learners → Tier 3 Productization → Tier 4 Personal AI entity).

## 🧠 Positioning (2026)

**In 2026, starting a new SaaS/tool/platform without AI-agentic-ready architecture is a bet against the grain.** cortex-x defaults to agentic-ready (safe-tool wrapper, three-layer memory scaffold, `/api/chat` reserved, cost guards ready) even if MVP has no AI features yet.

**Agentic-ready by default. Agentic-heavy by intent. Opt-out for static sites & prototypes.**

Retrofitting agentic patterns into a CRUD codebase = architecture rewrite. 30 min of scaffolding earns back 10x when AI feature comes 3 months later. (See [standards/ai-patterns.md](./standards/ai-patterns.md).)

## What it does

Opens a new empty project folder → one command → you get:

- **CLAUDE.md** tailored to your stack (one of 11 profiles — see below)
- **PROGRESS.md** sprint tracking template
- **.claude/** folder with hooks, subagents, skills, settings
- **MEMORY.md** multi-layer memory scaffold
- **README.md**, **LICENSE**, **.gitignore** — stack-appropriate
- Principles injected: **SSOT, Modular, Scalable, Security**
- Optional: web research of 2026 best practices for your use case

## Two AI surfaces — Claude Code by day, Steward by night

cortex-x runs on **two AI surfaces** that share the same project memory.

**Claude Code (interactive).** Your IDE-side AI partner — drives feature work, code review, refactors. Reads cortex-x hooks · skills · agents · standards from `~/.claude/`. Use it dev-time.

**Steward (autonomous nightly).** AI nightly autopilot — designed. Drop a `cortex/recommendations.md` in your repo. Steward reads it overnight, runs the LLM (~$0.0008/run via OpenRouter, or $0 marginal via Anthropic Max sub on `claude-cli` engine), applies edits, gates on `npm test`, opens a draft PR. You wake up, review the diff, merge or reject. **Today, Steward runs as manual dogfood on cortex-x itself; v1 cron wiring (`OPENROUTER_API_KEY` repo secret + workflow enablement) is pending — see Status section.** (Steward shipped under the codename **Hermes** through Sprint 1.9.1; renamed in Sprint 4.7 to clear the 139k-star NousResearch/hermes-agent collision before public launch.)

> **Safety primitives baked in.** Every Steward run: ① always opens **draft PR**, never pushes to main · ② **halt switch** `touch ~/.cortex/STEWARD_HALT` stops it immediately · ③ **$5/day spend cap** + 3-failure-per-action circuit breaker · ④ atomic rollback on any phase failure.

See [docs/steward-usage.md](./docs/steward-usage.md) to activate Steward for your repo.

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

## Design principles (25 standards across 4 tiers)

Every scaffolded project inherits these — see [standards/](./standards/README.md) for the full set. **Tiered rule hierarchy** (RULE-1 doc explains priority):

**Rule 0 — Distribution gate:** [ship-ready](./standards/ship-ready.md)

**Rule 1 — Architectural invariants (block PR if violated):**
1. **[SSOT](./standards/ssot.md)** — One source of truth per piece of knowledge
2. **[Modular](./standards/modular.md)** — Isolated subsystems with clean interfaces
3. **[Scalable](./standards/scalable.md)** — Patterns that survive 10x growth

**Rule 1.5 — Coding behavior contract:** [coding-behavior](./standards/coding-behavior.md), [auto-optimization](./standards/auto-optimization.md), [self-correction](./standards/self-correction.md)

**Rule 2 — Critical (must-have, review-pipeline blocker):**
4. **[Security](./standards/security.md)** — 8-layer + agentic-security §, RLS from day 1
5. **[Testing](./standards/testing.md)** — Test pyramid, 5 pillars per test
6. **[Observability](./standards/observability.md)** — Logs/metrics/traces + Runtime SLOs + circuit breakers + LLM obs
7. **[Correctness](./standards/correctness.md)** — Zod boundaries, property tests, eval-driven, mutation testing

**Rule 3 — Process (should-have):** [performance](./standards/performance.md), [accessibility](./standards/accessibility.md), [error-handling](./standards/error-handling.md), [git-workflow](./standards/git-workflow.md), [documentation](./standards/documentation.md), [ai-patterns](./standards/ai-patterns.md), [ai-sdks](./standards/ai-sdks.md), [skills](./standards/skills.md), [steward-policy](./standards/steward-policy.md), [auto-orchestration](./standards/auto-orchestration.md), [story-sizing](./standards/story-sizing.md), [test-types-catalog](./standards/test-types-catalog.md), [coding-behavior-examples](./standards/coding-behavior-examples.md)

## Repo structure

```
cortex-x/
├── bin/                  CLI entrypoints (cortex-bootstrap, cortex-steward, cortex-capabilities, cortex-gap-report)
│   ├── steward/          Steward autonomous-maintenance runtime (dry-run + execute + status + _lib/ primitives)
│   ├── cortex/           Skill-side tools invoked by /cortex-init, /cortex-help, etc.
│   └── discord-bridge/   Discord remote-control surface (optional, Sprint 2.6)
├── profiles/             11 project-type profiles (nextjs-saas, chatbot-platform, waas-template, ai-agent, browser-agent, cli-tool, tauri-desktop, kiosek, qa-engineer, astro-static, minimal)
├── templates/            Handlebars templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, SKILL.md, ...)
├── standards/            25 standards across 4 tiers (Rule 0/1/1.5/2/3)
├── prompts/              15 reusable prompts (bound to slash commands or paste-style)
├── agents/               9 specialized subagents (review pipeline + planner + synthesizer + cortex-thinker)
├── shared/
│   ├── hooks/            7 universal Claude Code hooks (session-start, block-destructive, post-tool-use, ...)
│   ├── skills/           Reusable agentskills.io-format skills shipped to ~/.claude/skills/
│   └── agents/           (mirrored from agents/ at install time)
├── detectors/            Deterministic profile + stage classifiers + per-action_kind detectors (fail-open <100ms)
├── tools/                Validators (verify-prompts, verify-skills, verify-audit-output, verify-no-pii, ...)
├── tests/                Tier 0-8 QA infrastructure (2339 tests, 5-lane CI matrix, hook contract + prompt regression as hard gates)
├── evals/                Aider-style eval suite (10 canonical task rubrics)
├── cortex/               Auto-generated capabilities registry + qa/ + recommendations.md template
├── docs/                 Long-form docs + research memos + dogfood-examples/
├── config/               evolve.yaml + research.yaml + ship-ready denylist
├── insights/             Cortex-thinker auto-observations (gitignored timestamps)
├── journal/              Tool-use traces (gitignored)
├── projects/             README only — actual project entries land in $CORTEX_DATA_HOME/projects/
├── .github/
│   ├── workflows/        17 GitHub Actions workflows (3 CI lanes + 15 Steward cron schedules + 1 PR template)
│   ├── ISSUE_TEMPLATE/   bug-report + beta-feedback + config (security → Private Vuln Reporting)
│   └── PULL_REQUEST_TEMPLATE.md
└── install.{sh,ps1}      One-command install to ~/.claude/shared/
```

> **XDG separation (Sprint 1.6, 2026-04).** The repo holds **framework code only**. Personal data — your project library entries, journal traces, research cache, insights — lives in `$CORTEX_DATA_HOME/projects/` (defaults to `~/.cortex/projects/`). The empty-looking `projects/` in the repo is intentional: it documents the contract; data is per-machine.

## Installation

> **Status: v0.3-pre, public.** Repo is public under Apache 2.0 (2026-05-12). Framework code, install pipeline, and **2339 tests** are real. Steward (autonomous nightly maintenance runtime) is **wired and running** — 15 cron workflows shipped, producing real auto-PRs on this repo since 2026-05-09. To activate Steward on your own repo: see [docs/steward-runtime.md](./docs/steward-runtime.md).

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
line for your shell. Run with `--dry-run` (when added) or read the script
before executing if you want to see what it touches.

### Profile selection at install time (Sprint 2.10.2)

Pick a profile to tailor the post-install slash-skill priming. Profiles:

| Profile | Primes | Best for |
|---|---|---|
| **`dev`** (default) | `/cortex-init` → arrow-key New / Existing / Framework | full-stack developer, general use |
| **`qa-tester`** | `/test-audit` (front-loaded) + `/cortex-init` (chain after) | QA engineer / tester onboarding to a new repo |
| **`ai-engineer`** | `/cortex-init` with ai-agent profile emphasis | AI / agent-heavy projects |
| **`minimal`** | framework only, no extra slash-skill | power users with bespoke flows |

**Three ways to set it:**

```bash
# Option 1 — interactive (default if TTY)
./install.sh                            # prompts: "Profile [dev]:"

# Option 2 — env var
CORTEX_PROFILE=qa-tester ./install.sh

# Option 3 — CLI arg
./install.sh --profile=qa-tester
```

For `qa-tester` specifically, the profile activates **auto-research-per-gap** in `/test-audit` runs (every P0/P1 gap gets a 200-word web-fetched memo with implementation patterns + cited URLs). Removes the cold-start tax for junior testers. See [docs/qa-tester-onboarding.md](./docs/qa-tester-onboarding.md) for the day-1 walkthrough.

### After install — three commands per project

```bash
cd ~/your-project
cortex-bootstrap      # interactive: [N]ew / [E]xisting / [F]ramework
claude                # auto-primes /start (new) or /audit (existing)
```

> **Forgot what's available?** Type `/cortex-help` inside Claude Code — one-screen menu of every invokable slash command (`/cortex-init`, `/start`, `/audit`, `/designer`, `/test-audit`, `/sync`, `/doctor`, `/cortex-reflect`, etc.) with a project-state-aware "default next" nudge. (Namespaced as `/cortex-help` because `/help` is Claude Code's built-in help command.)

### After install (qa-tester profile) — one command per repo

```bash
cd ~/repo-to-audit
claude                # /test-audit produces a senior-QA-consultant deliverable in 30 min
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

> **Phase 5 evidence base — honest disclaimer (Sprint LR.3, 2026-05-10).**
> The statistical gates above (`min_support=3`, `≥2 projects`, `>7d spread`,
> Bonferroni correction, citations required) are **specified in code + prose**
> but the empirical base is currently a **paper baseline** ([`evals/results/2026-05-01-01d9013-paper-baseline.json`](./evals/results/)) —
> per-task scores predicted from prompt + standard review at commit `01d9013`,
> NOT from real Claude session executions. Real-execution baseline (5 runs ×
> 3 canonical tasks recommended per Sprint LR.1) lands once `evals/results/`
> populates with `2026-05-*-real-*.json` artifacts. **Claims of "framework
> improves itself" are designed but not yet measured.** Track in
> [`docs/research/cortex-x-housekeeping-audit-2026-05-10.md`](./docs/research/cortex-x-housekeeping-audit-2026-05-10.md) §1
> Sprint LR track.

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
| **browser-agent** | Browser-automation agent (Playwright / browser-use) | scraping + form-filling agent |
| **qa-engineer** | QA-tester-oriented project setup | repo-audit + test-strategy generation |
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
- Tier 0-8 QA infrastructure (started at 207 tests 2026-05-07, now 2339 tests, hook contract + prompt regression as hard gates)

**Phase 2 — Bootstrap skill** ⚠️ partial — prompt-driven scaffold (`prompts/new-project.md`) shipped; Clack-based interactive CLI deferred

**Phase 3 — Multi-agent** ⚠️ partial — 5-agent parallel code-review pipeline (`prompts/code-review.md` → blind-hunter, edge-case-hunter, acceptance-auditor, security-auditor, ssot-enforcer) shipped; standalone orchestrator agent deferred

**Phase 4 — Web research** ✅ shipped — `prompts/new-project.md` Phase 5 dispatches 3-5 parallel research agents, `research-protocol.md` defines the contract, results cached at `$CORTEX_DATA_HOME/research/<slug>-<date>.md`

**Phase 5 — Self-improvement loop** ✅ Designed + specs (v1 — 2026-04-17) · ⏳ Automated runtime via Phase 7 (Steward)
- 4-cadence architecture (daily ingest / weekly mining / monthly eval / quarterly audit) — **specified in `config/evolve.yaml`, not yet cron-wired**
- Hard anti-hallucination gates (min_support=3, ≥2 projects, >7d spread, Bonferroni, citations required) — enforced when `cortex-evolve` prompt is manually invoked
- Aider-style eval suite (10 canonical task rubrics in `evals/`, `evals/results/` empty pending first automated run)
- PR-only mutations (framework never auto-edits its own source of truth) — discipline encoded, no automated PR pipeline yet
- Meta-loop: every 30 insights → effectiveness review → threshold tuning — designed, awaits Steward

**Phase 6 — Memory upgrades** ⏳ designed — 6-signal scoring, graph expansion, DREAMS.md consolidation; awaits Phase 7

**Phase 7 — Steward runtime (originally codenamed Hermes)** ✅ v0.5b shipped 2026-05-07 · ⏳ v1 cron triggers pending
- ✅ All 5 pre-launch RFC gates closed (Tier 4 hook contract + Tier 5 prompt regression + steward-policy.md + steward-runtime.md design + fixture)
- ✅ 6 zero-dep CJS primitives in `bin/steward/_lib/` (halt-check, lock, journal, recommendations parser, git-trailer builder, policy denylist)
- ✅ `bin/steward/dry-run.cjs` orchestrator — reads recommendations.md, picks next action, builds Conventional-Commits-shaped commit message with Git trailers, journals run, releases lock
- ✅ `bin/steward/status.cjs` observability CLI — reports halt + lock + recommendations + journal rollup with cost ledger
- ✅ **`bin/steward/execute.cjs` (v0.5a)** — async runtime: dry-run plan → branch → engine apply → npm test gate → atomic commit → rollback on failure → journal cost
- ✅ **OpenRouter engine (v0.5b)** — real LLM via `fetch()` (Node ≥18), zero-deps preserved. 8 distinct error codes, configurable timeout, JSON-mode response_format, default `deepseek/deepseek-v4-flash` (~$0.0008/run). Pluggable seam: mock / openrouter / claude-sdk.
- ✅ **First real OpenRouter call validated end-to-end** (Sprint 1.6.13 dogfood): LLM → JSON → edits → test gate → atomic rollback proven safe by reality.
- ✅ **Sprint 1.6.14–1.6.18 hardening** from real-world signal + 6-agent review pipeline: `STEWARD_MAX_TOKENS` (legacy `STEWARD_MAX_TOKENS` honored), cost capture on all failure paths (`addCostFields` + `extractUsage`), JSON-fence stripping for cross-model robustness, tightened path-traversal (NUL byte + flag-injection + realpath containment), editPlan shape gate (`OPENROUTER_PLAN_SHAPE_INVALID`), null-body guard, default-model SSOT alignment, MIGRATIONS.md backfill.
- ✅ **2339 tests** across `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/smoke/`. All 3 CI workflows green (test / install-smoke / no-pii).
- ✅ **v0.5b finalization (Sprint 1.6.19):** `gh pr create --draft` integration in execute.cjs (push + PR open), daily spend cap (`STEWARD_DAILY_USD_CAP`) + consecutive-failure circuit breaker — all shipped.
- ⏳ **v1 enablement (your repo):** the workflow files in `.github/workflows/steward-*.yml` exist as templates. Set `OPENROUTER_API_KEY` (or Anthropic Max sub via `claude-cli` engine) + the appropriate per-workflow secrets, then enable the workflows on your fork. Manual `cortex-steward dry-run` works today without cron.
- ⏳ **v1.5+ hardening:** hardcode endpoint, extractUsage string coercion, detached HEAD pre-flight, `<untrusted>` delimiters, denylist expansion, eval suite + property tests + stateful simulation.

See [docs/steward-rfc.md](./docs/steward-rfc.md), [docs/steward-runtime.md](./docs/steward-runtime.md), [standards/steward-policy.md](./standards/steward-policy.md).

## License

[Apache License 2.0](./LICENSE) — SPDX `Apache-2.0`. Permissive use including commercial, with patent grant and attribution requirement. See [LICENSE](./LICENSE) for full text and [NOTICE](./NOTICE) for the attribution notice.

---

**Author:** David Rajnoha (Rejnyx) · contact via [GitHub](https://github.com/Rejnyx/cortex-x)
