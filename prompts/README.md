# prompts/

Reusable prompts shipped to `~/.claude/shared/prompts/`. Some bind to slash commands (`/cortex-init`, `/test-audit`, etc.); others are paste-style operator prompts (you paste them into Claude when you want that workflow).

## Slash-command-bound

These map 1:1 to a skill registered under `~/.claude/skills/`:

| Prompt | Slash command | What it does |
|---|---|---|
| [`new-project.md`](prompts/new-project.md) | `/cortex-init` | Bootstrap a new project (3 questions + scaffold). |
| [`retrofit.md`](prompts/retrofit.md) | `/retrofit` (project-level) | Install cortex-x scaffolding on an existing repo without overwriting. |
| [`qa-retrofit.md`](prompts/qa-retrofit.md) | `/test-audit` (qa-engineer profile only) | ISO 25010 + OWASP ASVS + Bach HTSM grounded test-suite audit. |
| [`existing-project-audit.md`](prompts/existing-project-audit.md) | _(skill TBD)_ | 5-section summary of an existing project's state. |
| [`project-scan.md`](prompts/project-scan.md) | _(skill TBD)_ | Scan a repo and produce a one-page situational summary. |

## Paste-style operator prompts

These you paste into Claude Code manually. No slash binding (intentional — they're occasional, not daily).

| Prompt | Cadence | Purpose |
|---|---|---|
| [`cortex-evolve.md`](prompts/cortex-evolve.md) | weekly / monthly | Self-improvement loop: mining, validation, proposal generation. See [`docs/self-improvement-rfc.md`](docs/self-improvement-rfc.md). |
| [`cortex-load.md`](prompts/cortex-load.md) | as-needed | Mental-model cheat sheet (institutional wisdom vs current state SSOT). |
| [`cortex-sync.md`](prompts/cortex-sync.md) | post-work | Capture decisions / lessons from a session into cortex memory. |
| [`cortex-doctor.md`](prompts/cortex-doctor.md) | when something drifts | Healthcheck against profile expectations + standards gaps. |
| [`cortex-reflect.md`](prompts/cortex-reflect.md) | weekly | Deep reflection on cross-project patterns. |
| [`steward-setup.md`](prompts/steward-setup.md) | one-shot | Wire Steward autonomous runtime on a project (cron + recommendations.md + smoke test). |
| [`retrospective.md`](prompts/retrospective.md) | post-sprint | Sprint retrospective scaffold. |
| [`sprint-status.md`](prompts/sprint-status.md) | mid-sprint | Status check against sprint plan. |
| [`code-review.md`](prompts/code-review.md) | ad-hoc | Single-agent code review prompt. |
| [`auto-review.md`](prompts/auto-review.md) | ad-hoc | Auto-orchestrated multi-agent review (6 reviewers parallel). |

## Discovery

Use `/cortex-help` inside Claude Code for a one-screen capability menu rendered from `cortex/capabilities.{md,json}` (auto-generated from this directory + skills + standards).
