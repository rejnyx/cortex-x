# cortex-x — AI-Agentic-First Claude Code Framework

> **AI-agentic-first** personal Claude Code framework by Rejnyx. Bootstraps new projects with agentic-ready architecture + senior-level orchestration + safety + standards in under 3 minutes.

## Core positioning (2026)

**Agentic-ready by default.** Every new SaaS/tool/platform gets safe-tool wrapper, three-layer memory scaffold, `/api/chat` reserved, cost guards ready — even if MVP has no AI.

**Agentic-heavy by intent.** Use `ai-agent` or `chatbot-platform` profiles for projects where AI IS the product.

**Opt-out explicitly.** Static blog, portfolio, landing page → `astro-static` or `minimal` profiles. Don't force AI where it's not needed.

See [standards/ai-patterns.md](./standards/ai-patterns.md) for the 10 agentic patterns every project should respect, and [standards/ai-sdks.md](./standards/ai-sdks.md) for the decision tree across Vercel AI SDK, Claude Agent SDK, and OpenAI Agents SDK (every profile declares `ai_sdk:` explicitly).

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

## Principles — tiered rule system

cortex-x doesn't flatten all standards into one list. It uses a **tier hierarchy** (see [standards/RULE-1.md](./standards/RULE-1.md)):

### Rule 0 — Distribution gate
**[Ship-Ready](./standards/ship-ready.md)** — no personal data in generic code, clear licensing, stranger-reproducible install. Precedes everything else.

### Rule 1 — Inviolable architectural invariants
The **3 pillars** every scaffolded project respects from day 1:

1. **SSOT** — [standards/ssot.md](./standards/ssot.md) — one authoritative source per knowledge piece
2. **Modular** — [standards/modular.md](./standards/modular.md) — clean interfaces, swappable subsystems
3. **Scalable** — [standards/scalable.md](./standards/scalable.md) — 10x-safe patterns from day 1

**Rule 1 violations = automatic PR block.** Enforced by `ssot-enforcer` + `blind-hunter` agents.

### Rule 1.5 — Coding behavior contract
**[Coding Behavior](./standards/coding-behavior.md)** — Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution.

### Rule 2 — Critical (must-have)
**Security + Testing + Observability + Correctness**. Review pipeline flag = blocker.

1. **[Security](./standards/security.md)** — 8-layer defense + § Agentic Security 2026 (lethal trifecta, 7 MUST patterns for LLM/agent)
2. **[Testing](./standards/testing.md)** — layered pyramid, 5 pillars per test, AI-specific tests
3. **[Observability](./standards/observability.md)** — logs/metrics/traces + Runtime SLOs (burn-rate) + circuit breakers + LLM obs stack
4. **[Correctness](./standards/correctness.md)** — Zod at boundaries, property-based tests, eval-driven dev, mutation testing, stateful simulation

### Rule 3 — Process (should-have)
Accessibility, Performance, Error handling, Git workflow, Docs, [AI patterns](./standards/ai-patterns.md), [Skills](./standards/skills.md). Review pipeline flag = warning.

**Mental model:** Rule 1 guarantees structure. Rule 2 guarantees the code works correctly, securely, observably. Rule 3 is polish. Rule 0 is "can you distribute it at all." Don't flatten — the tier priority matters when budgets are constrained.

## Development Workflow

1. Edit files in cortex-x repo
2. Run `npm test` to confirm nothing regressed (~16 sec, unit + contract + integration)
3. Run `./install.ps1` (Windows) or `./install.sh` (Unix) to sync to `~/.claude/shared/`
4. Changes propagate to all projects using cortex-x hooks/skills/agents

## Testing

cortex-x has its own QA infrastructure landed in 4 commits (Tier 0-3, 2026-05-07). See [tests/README.md](./tests/README.md) for the full layout + 8-tier roadmap, and [CONTRIBUTING.md](./CONTRIBUTING.md) § Code contributors for the pre-PR gate.

```bash
npm test                  # full suite — unit + contract + integration, ~16 sec
npm run test:fast         # unit + contract only, dot reporter, ~5 sec
npm run test:smoke        # post-install verification (also called from install.{sh,ps1})
npm run test:detectors    # 11 profile fixtures + 3 stage fixtures + schema invariants
npm run test:audit        # tools/verify-audit-output.cjs against 5 audit fixtures
npm run test:coverage     # c8 → coverage/ HTML + lcov
```

CI lanes (every PR + push to main):

- **`.github/workflows/test.yml`** — Linux fast lane (full suite + coverage)
- **`.github/workflows/install-smoke.yml`** — 5-lane matrix: ubuntu-bash, macos-bash, windows-gitbash, windows-pwsh7, windows-ps5.1
- **`.github/workflows/no-pii.yml`** — PII scanner (pre-existing)

The 8-tier QA architecture (Tier 4 hook contract + Tier 5 prompt regression are HARD gates before Hermes runtime; Tier 6-8 gate public launch) is documented in [tests/README.md](./tests/README.md) § Tier mapping.

## Roadmap

**Phase 1 — Foundation** ✅ shipped (foundation + Tier 0-5 QA infrastructure landed 2026-05-07: 207 tests, 5-lane CI matrix, hook contract + prompt regression as hard gates)
- Shared hooks (block-destructive, session-start [+ detector integration 2026-04-20], pre-compact, auto-orchestrate, post-tool-use, **tirith-scan** — context-file injection scanner wrapper, optional MIT Rust binary)
- Templates (CLAUDE.md, PROGRESS.md, MEMORY.md, settings.json, README.md, **SKILL.md** — agentskills.io spec scaffold)
- Rule 1 standards (SSOT, Modular, Scalable) + Rule 1.5 (Coding Behavior + **Auto-Optimization** wizard philosophy) + Rule 2 Critical (Security, Testing, Observability, **Correctness**, **Self-Correction**) — all added or extended 2026-04-20
- Rule 2 Security extensions: § Agentic Security (lethal trifecta, 7 MUST patterns) + § **Browser Automation Security** (3 browser-specific MUSTs) — added 2026-04-20
- Rule 2 Observability extension: § Runtime SLOs + circuit breakers + LLM obs — added 2026-04-20
- Rule 3 **Skills** standard — agentskills.io SKILL.md open spec (portable Claude Code ↔ Hermes ↔ Codex ↔ Cursor) — added 2026-04-20
- **`detectors/`** (NEW 2026-04-20) — deterministic profile + stage classifiers, <100ms, fail-open, feed session-start hook + cortex-doctor drift flow
- **ai-patterns safe-tool v2** — adds loop detector + circuit breaker + per-tool retry budget (OWASP LLM10 defense) — 2026-04-20
- Profiles: nextjs-saas + minimal fallback + `ai-agent` (7 MUST agentic-security + skills + tirith hook) + **`browser-agent`** (extends ai-agent with 3 browser MUSTs)

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

**Phase 5 — Self-improvement loop** ✅ designed + specs (v1 — 2026-04-17) · ⏳ automated runtime in Phase 7
- 4-cadence (daily/weekly/monthly/quarterly) via `prompts/cortex-evolve.md` — **specified, not yet cron-wired**
- Hard evidence gates via `config/evolve.yaml` — enforced when prompt is manually invoked
- Aider-style eval suite in `evals/` — 10 task rubrics shipped, `evals/results/` empty pending first automated run
- PR-only mutations, never auto-edits source of truth — discipline encoded, no automated PR pipeline yet
- See `docs/self-improvement-rfc.md`

**Phase 6 — Memory upgrades** ⏳ designed (awaits Phase 7)
- 6-signal scoring for autoDream promotion
- Graph expansion (2-hop) over memories
- `DREAMS.md` human-readable consolidation output

**Phase 7 — Hermes runtime** 🆕 RFC stub
- Autonomous loop inside scaffolded projects
- Reads `recommendations.md` → executes verified steps → atomic commit → opens PR (humans merge)
- Pre-Hermes hard gates Tier 4 + Tier 5 ✅ closed 2026-05-07
- See [docs/hermes-rfc.md](./docs/hermes-rfc.md). Implementation 2-3 sessions ahead.

## License

PolyForm Noncommercial 1.0.0. See [LICENSE](./LICENSE).
