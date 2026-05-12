---
name: cortex-help
description: One-screen menu of what cortex-x can do right now — list of invokable slash commands (cortex-init, audit, start, test-audit, designer, sync, evolve, doctor), a 1-line summary of what each does, and a count of underlying capabilities (action_kinds, profiles, standards). Auto-discovered after install.{sh,ps1} sync. Invoke as "/cortex-help", "what can cortex do?", or when the user asks "co umíš?" / "jaké jsou skills?" / "ukaž mi capabilities". NOTE: namespaced as cortex-help because /help is reserved as a Claude Code built-in slash command. Defers full machine-readable registry to cortex/capabilities.md.
disable-model-invocation: false
---

# /cortex-help — what can cortex-x do right now

You are running the cortex-x help menu. The user wants a one-screen answer to *"what can I type next?"* — NOT a wall of documentation. Print the menu, suggest a sensible default action based on detected project state, stop.

## Step 1 — language signal

Read the user's language from prior turns. If they wrote Czech, answer in Czech. Otherwise English. Don't ask explicitly.

## Step 2 — detect current state (one quick scan)

Before printing the menu, peek at `$PWD`:

- `.cortex-bootstrap-pending` exists → bootstrap was started, point them at the next step
- `cortex/AUDIT.md` exists → audit already ran; suggest `/retrofit` next
- `cortex/discovery.md` or `cortex/proposal.md` exists → new-project in flight; suggest resuming
- `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` present → existing project; default = `/audit`
- Folder near-empty → new project; default = `/cortex-init`

You do NOT block on this — if any check fails, fall through to "no detection signal."

## Step 3 — print the menu

Print this menu, with the "**default**" tag on whichever option Step 2 indicated. Format as table-or-list, choose what renders cleanly in the user's chat surface.

### Slash commands you can type right now

| Command | What it does | When to use |
|---|---|---|
| **`/cortex-init`** | Interactive picker — New / Existing / Framework — primes the right flow | Just installed cortex-x; not sure what to do |
| **`/start`** | New-project bootstrap (Discover → Research → Architect → Scaffold → Adapt) | Empty folder, want a full project scaffold |
| **`/audit`** | Existing-project deep audit (12 dimensions, 4 parallel agents) | Established codebase, want to know what's there |
| **`/test-audit`** | Senior-QA-consultant audit → P0/P1/P2 gap list with research memos | Repo needs a testing-strategy review |
| **`/designer`** | Designer flow — intake + library palette + parallel worktree exploration | Front-end / landing-page / dashboard design session |
| **`/retrofit`** | Apply cortex-x patterns to an audited project | After `/audit` finishes |
| **`/sync`** | End-of-session knowledge capture — decisions + lessons → cortex library | After a sprint or notable work session |
| **`/doctor`** | Healthcheck — cortex install integrity + drift detection | Weekly, or after migration / new machine |
| **`/cortex-reflect`** | Deep reflection — surfaces grounded cross-project insights | When something feels off, or after big refactor |
| **`/cortex-help`** | This menu | Anytime you forget what's available |

### Default behaviors (these run without being asked)

| Behavior | When | Override |
|---|---|---|
| **Web research** | Whenever a task depends on external state (framework versions, library APIs, CVEs, design trends, a11y standards) — Claude is expected to dispatch parallel research subagents first, cache under `$CORTEX_DATA_HOME/research/`, cite URLs | `--no-research` flag · `CORTEX_OFFLINE=1` env |
| **Session-start context injection** | Every Claude Code session — sprint state, git state, capability tip (once / 18h), pending insights | uninstall hooks or `CORTEX_HOOKS_DISABLED=1` |
| **Block destructive** | `rm -rf /`, force-push to main, `DROP TABLE`, `--no-verify` are refused | run outside Claude Code |
| **Auto-orchestrate review** | Multi-agent parallel review pipeline auto-dispatches on non-trivial diffs | `CORTEX_AUTO_ORCHESTRATE_DISABLED=1` |

### What's under the hood (read-only summary)

The above are user-facing skills. Underneath, cortex-x ships:

- **Steward action_kinds** — typed actions the autonomous nightly runtime can execute (`dep_update_patch`, `recommendation`, `pattern_transfer`, `senior_tester_review`, etc.)
- **Steward primitives** — zero-deps CJS modules implementing safety, dispatch, memory layers
- **Universal hooks** — block-destructive, session-start, pre-compact, post-tool-use, etc.
- **Standards** — Rule 0 (Ship-Ready) → Rule 1 (SSOT / Modular / Scalable) → Rule 2 (Security / Testing / Observability / Correctness) → Rule 3 (process incl. web-research)
- **Profiles** — project-type templates (nextjs-saas, waas-template, chatbot-platform, ai-agent, browser-agent, kiosek, qa-engineer, tauri-desktop, astro-static, cli-tool, minimal)
- **Review-pipeline agents** — blind-hunter, edge-case-hunter, acceptance-auditor, security-auditor, ssot-enforcer, correctness-auditor, etc.
- **GitHub workflows** — `steward-*.yml` cron lanes per action_kind

Full machine-readable registry with exact counts + descriptions: [`cortex/capabilities.md`](../../../cortex/capabilities.md) (auto-generated; refresh via `npm run capabilities`).

### Don't see what you want?

- For autonomous nightly runs (Steward), see [`docs/steward-usage.md`](../../../docs/steward-usage.md)
- For the full project trajectory roadmap, see [`docs/steward-roadmap.md`](../../../docs/steward-roadmap.md)
- For one-line summary of "what is cortex-x", see [`README.md`](../../../README.md)
- For mental model + SSOT contract, see [`CLAUDE.md`](../../../CLAUDE.md)

## Step 4 — single-line nudge

Below the menu, print ONE line: the suggested next move based on Step 2 detection. Examples:

- "Detekoval jsem `package.json` v této složce → doporučuji **`/audit`**."
- "Folder vypadá prázdně → doporučuji **`/cortex-init`** nebo přímo **`/start`**."
- "Vidím `cortex/AUDIT.md` z předchozího běhu → **`/retrofit`** by byl logický další krok."
- "Žádný signál — vyber si z menu výše."

## Step 5 — stop

After the menu + nudge, end the turn. Do NOT auto-invoke another skill. The user picks what they want.

## Anti-patterns

- **Don't dump capability registry verbatim.** That's `npm run capabilities` territory; this skill is the human-facing menu.
- **Don't explain how each command works in detail.** One line per command, full docs are linked.
- **Don't repeat the README.** README is for first-time discovery; `/help` is for "I forgot what's here."
- **Don't ask follow-up questions.** Print, nudge, stop.

## Composes with

- `/cortex-init` — natural follow-up if user is fresh-installed
- `cortex/capabilities.md` (Sprint 2.15 auto-registry) — the machine-readable detailed view this skill links to
