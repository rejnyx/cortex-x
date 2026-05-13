# cortex-x

> **AI-agentic-first Claude Code framework.** Bootstrap a new project in 3 minutes with safety + standards + memory baked in. Let **Steward** maintain it autonomously every night — branch, edit, gate on `npm test`, open a draft PR, roll back on failure.

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE) [![Tests: 2339](https://img.shields.io/badge/tests-2339_green-brightgreen)](./tests/README.md) [![CI](https://img.shields.io/badge/CI-5--lane_matrix-brightgreen)](./.github/workflows/) [![Status: public preview](https://img.shields.io/badge/status-v0.3--pre_public_preview-orange)](#status)

---

## What it does in 30 seconds

1. **Scaffolds** a new project with one of 11 stack profiles (Next.js SaaS, chatbot platform, AI agent, CLI tool, static site, …) — `CLAUDE.md` + `PROGRESS.md` + `.claude/` hooks + memory scaffold + 26 standards, in ~3 minutes.
2. **Audits** an existing repo across 12 dimensions via 4 parallel subagents, returns a senior-consultant-grade report.
3. **Maintains** the repo overnight via **Steward** — read `cortex/recommendations.md`, run the LLM, apply edits, gate on tests, open a draft PR. Safety primitives: draft-only PRs, `STEWARD_HALT` killswitch, daily/weekly/monthly USD caps, atomic rollback.

Built for the operator who runs **many repos** and wants a maintenance autopilot on their own infra — not a hosted SaaS junior engineer. Short comparison below; full per-competitor profiles (incl. Sakana DGM and OpenClaw) in [`docs/positioning.md`](./docs/positioning.md).

## Status — what runs today vs what's ahead

| Surface | State |
|---|---|
| One-command install (`install.sh` / `install.ps1`) | ✅ shipped, 5-lane CI green |
| 11 project profiles, 26 standards, 9 review agents, 15 reusable prompts | ✅ shipped |
| Claude Code hooks (session-start, block-destructive, post-tool-use, …) | ✅ shipped, contract-tested |
| 6-agent parallel code-review pipeline (`prompts/code-review.md`) | ✅ shipped |
| Web-research-before-implement default (`standards/web-research.md`) | ✅ shipped |
| Steward runtime (`bin/steward/execute.cjs`) — atomic commit, rollback, cost ledger | ✅ shipped (v0.5b) |
| 15 active nightly cron workflows running on this repo | ✅ shipped — real auto-PRs since 2026-05-09 |
| Spec-driven verification (6 acceptance-criterion kinds incl. `read_set` coverage proof) | ✅ shipped (Sprint 1.9.0 + 2.18) |
| Multi-window cost safety (D/W/M USD caps + token velocity + loop detector) | ✅ shipped (Sprint 1.9.1) |
| Full real-LLM eval suite captured (Sprint LR.1) | ⏳ operator-run, 1 pass pending |
| Daily "Dreaming" consolidation cron (Phase 5 Phase A, deterministic) | ✅ shipped (Sprint 2.19 v0 — `evolve_daily` action_kind, daily 03:00 UTC). Industry slovník: "Dreaming" (OpenClaw), "Auto Dream" (Anthropic). |
| Weekly mining + monthly eval (Phase 5 Phase B+C, LLM-driven) | ⏳ designed, awaits enablement |
| Compound learners + capability marketplace (Tier 2/3) | ⏳ Sprint 3.0+ |

**Honesty disclaimer.** Repo is a fresh public preview under Apache 2.0 (relicensed 2026-05-12, public 2026-05-12). 0 GitHub stars on day 1 is structural, not a quality signal. The 2339-test suite, 5-lane CI matrix, and 15 nightly cron workflows are real and verifiable.

See [`docs/vision.md`](./docs/vision.md) for the full four-tier roadmap (Foundation → Verification → Compound learners → Productization → Persistent entity).

## Why not Devin / Copilot Coding Agent / Cursor BG / Replit Agent / Aider?

cortex-x sits in a slot none of these occupy: **self-hosted, zero-deps, cron-driven, atomic-rollback maintenance autopilot for an operator's existing repos**.

| | Devin | Copilot CA | Cursor BG | Replit Agent | Aider | **cortex-x Steward** |
|---|---|---|---|---|---|---|
| Self-host (operator infra) | ❌ | ❌ | ⚠️ IDE only | ❌ | ✅ | ✅ |
| Cron-driven unattended | ❌ | ⚠️ via Actions | ⚠️ manual | ❌ | ⚠️ OS cron | ✅ first-class |
| Multi-window USD caps (D/W/M) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cross-session loop detection | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 5x / 7d |
| Per-kind spec verifier | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ 6 kinds |
| File-based killswitch | ❌ | ⚠️ revoke token | ❌ | ❌ | ❌ | ✅ `STEWARD_HALT` |
| Typical operator cost / run | ~$2 / 15min ACU | credit pool | $0.50–7.50 / Mtok | $0.25 / checkpoint | ~$0.01 / file | **~$0.0008 / run** |
| License | proprietary | proprietary | proprietary | proprietary | Apache-2 | **Apache-2** |
| Target | mid-market eng | GitHub orgs | IDE-first devs | builders | terminal solo | **operator w/ many repos** |

Full per-competitor profiles + sourcing in [`docs/positioning.md`](./docs/positioning.md).

## Install

**Linux / macOS / WSL / Git Bash:**

```bash
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
```

**Windows PowerShell:**

```powershell
iwr https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex
```

Prefer to read first? `git clone https://github.com/Rejnyx/cortex-x ~/cortex-x && ~/cortex-x/install.sh` — the installer is ~600 lines of bash / PowerShell, self-clones to `~/cortex-x`, copies framework assets to `~/.claude/shared/`, never auto-touches your `~/.claude/settings.json` or `~/.claude/CLAUDE.md`. Walkthrough at [`docs/install-walkthrough.md`](./docs/install-walkthrough.md).

### Profile selection at install time

Pick one of four post-install profiles: `dev` (default) · `qa-tester` · `ai-engineer` · `minimal`. Set via interactive prompt, `CORTEX_PROFILE=...` env, or `--profile=...` flag. The `qa-tester` profile front-loads `/test-audit` (auto-research-per-gap) and is documented in [`docs/qa-tester-onboarding.md`](./docs/qa-tester-onboarding.md). The `ai-engineer` profile emphasizes the `ai-agent` and `chatbot-platform` profiles for new-project bootstrap.

## First three minutes after install

```bash
cd ~/your-project
cortex-bootstrap         # interactive: [N]ew / [E]xisting / [F]ramework
claude                   # opens Claude Code — auto-primes /start or /audit
```

Inside Claude Code:

- `/cortex-help` — one-screen menu of every invokable slash command + a "default next" nudge based on detected project state
- `/start` — new-project bootstrap (Discover → Research → Architect → Scaffold → Adapt)
- `/audit` — existing-project deep audit (12 dimensions, 4 parallel agents)
- `/test-audit` — senior-QA-consultant audit, P0/P1/P2 gap list with research memos (`qa-tester` profile)
- `/designer` — design flow (intake + library palette + parallel worktree exploration)
- `/sync` — end-of-session knowledge capture → cortex library
- `/doctor` — install integrity + drift detection
- `/cortex-reflect` — deep reflection, grounds insights in file paths

## Two AI surfaces — Claude Code by day, Steward by night

**Claude Code (interactive).** Your IDE-side AI partner — feature work, code review, refactors. Reads cortex-x hooks · skills · agents · standards from `~/.claude/`.

**Steward (autonomous nightly).** Drop a `cortex/recommendations.md` in your repo. Steward reads it overnight, runs the LLM (~$0.0008/run via OpenRouter + DeepSeek V4 Flash, or $0 marginal via Anthropic Max sub on `claude-cli` engine), applies edits, gates on `npm test`, opens a draft PR. You wake up, review the diff, merge or reject.

Every Steward run: draft PR (never pushes to main) · `STEWARD_HALT` killswitch · daily / weekly / monthly USD caps · 3-failure circuit breaker · atomic rollback on any phase failure. See [`docs/steward-usage.md`](./docs/steward-usage.md) to activate Steward on your repo.

> Steward shipped under the codename **Hermes** through Sprint 1.9.1; renamed in Sprint 4.7 to clear the 139k-star NousResearch/hermes-agent collision before public launch.

## Design principles — 26 standards across 4 tiers

| Tier | Examples | Enforced by |
|---|---|---|
| **Rule 0 — Distribution gate** | [ship-ready](./standards/ship-ready.md) | install prerequisite check |
| **Rule 1 — Architectural invariants** | [SSOT](./standards/ssot.md), [Modular](./standards/modular.md), [Scalable](./standards/scalable.md) | `ssot-enforcer` + `blind-hunter` agents — PR-blocking |
| **Rule 1.5 — Coding behavior** | [coding-behavior](./standards/coding-behavior.md), [auto-optimization](./standards/auto-optimization.md), [self-correction](./standards/self-correction.md) | review-pipeline guideline |
| **Rule 2 — Critical** | [Security](./standards/security.md) (8-layer + agentic §), [Testing](./standards/testing.md), [Observability](./standards/observability.md), [Correctness](./standards/correctness.md) | `security-auditor` + `correctness-auditor` — PR-blocking |
| **Rule 3 — Process** | [performance](./standards/performance.md), [a11y](./standards/accessibility.md), [git-workflow](./standards/git-workflow.md), [ai-patterns](./standards/ai-patterns.md), [ai-sdks](./standards/ai-sdks.md), [web-research](./standards/web-research.md), … | warning, not blocker |

Browse the full set at [`standards/README.md`](./standards/README.md).

## Available profiles

| Profile | Use case |
|---|---|
| `nextjs-saas` | Next.js + Supabase + OpenAI SaaS |
| `waas-template` | Website-as-a-Service, multi-tenant |
| `chatbot-platform` | Multi-tenant chatbot with channel adapters |
| `ai-agent` | Autonomous multi-step AI agent |
| `browser-agent` | Browser-automation agent (Playwright / browser-use) |
| `cli-tool` | Node.js CLI published to npm |
| `tauri-desktop` | Cross-platform desktop app (Rust + Web) |
| `kiosek` | Restaurant / retail touch kiosk PWA |
| `qa-engineer` | QA-tester-oriented audit-first setup |
| `astro-static` | Portfolio, blog, docs (zero-JS) |
| `minimal` | Quick prototype, no ceremony |

Each profile is a YAML file in `profiles/` declaring stack defaults, security posture, AI SDK choice, and tailored CLAUDE.md sections. Inspect or fork at [`profiles/`](./profiles/).

## Repo structure (high-level)

```
cortex-x/
├── bin/                 CLI: cortex-bootstrap, cortex-steward, cortex-capabilities, cortex-gap-report
│   └── steward/         Autonomous runtime — dry-run + execute + status + _lib/ primitives
├── profiles/            11 project profiles (YAML)
├── templates/           Handlebars templates (CLAUDE.md, PROGRESS.md, MEMORY.md, …)
├── standards/           26 standards (Rule 0/1/1.5/2/3)
├── prompts/             15 reusable prompts bound to slash commands
├── agents/              9 specialized subagents (review pipeline + planner + thinker)
├── shared/hooks/        7 universal Claude Code hooks
├── detectors/           Profile + stage classifiers (<100ms, fail-open)
├── tests/               2339 tests across 8 tier gates
├── evals/               Aider-style eval suite (10 canonical task rubrics)
├── docs/                Long-form docs (vision, positioning, install walkthrough, …)
└── install.{sh,ps1}     One-command install to ~/.claude/shared/
```

**XDG separation (Sprint 1.6).** The repo holds framework code only. Personal data — your project library entries, journal traces, research cache, insights — lives in `$CORTEX_DATA_HOME/projects/` (defaults to `~/.cortex/projects/`).

## Cross-platform

- `.gitattributes` enforces LF for shell/Node.js, CRLF for PowerShell
- Hooks use `os.homedir()` and `path.join()` — no hardcoded paths
- Tested on Windows 11, macOS 14+, Ubuntu 22+ via 5-lane CI matrix

## Built by

**David Rajnoha (Rejnyx)** — full-stack developer + agentic engineer + designer (17 years of graphics). Built cortex-x over 2026 Q1–Q2 to scale his own multi-repo workflow (back-office AI agent · multi-tenant chatbot platform · website-as-a-service template · restaurant kiosk · portfolio). Two top-5% AI hackathon finishes (fraud-detection 91/1979, RELO 5/70). Public preview is the first time the framework leaves his laptop. Contact via [GitHub](https://github.com/Rejnyx) · [davidrajnoha.dev](https://davidrajnoha.dev).

## Contributing & security

- Bug reports & beta feedback: see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/)
- Security vulnerabilities: **do not file a public issue** — see [`SECURITY.md`](./SECURITY.md) for private disclosure via GitHub Private Vulnerability Reporting
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- Pre-PR gate: `npm test` (~16 sec, 2339 tests across unit + contract + integration)

## License

[Apache License 2.0](./LICENSE) — SPDX `Apache-2.0`. Permissive use including commercial, with patent grant and attribution requirement. See [LICENSE](./LICENSE) for full text and [NOTICE](./NOTICE) for the attribution notice.
