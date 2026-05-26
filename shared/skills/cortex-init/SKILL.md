---
name: cortex-init
description: Initialize cortex-x in the current project — interactively pick mode (New / Existing / Framework-only) via AskUserQuestion, write .cortex-bootstrap-pending marker, chain to /start or /audit. RECOMMENDED entry point after install.sh; replaces shell-level cortex-bootstrap CLI. Auto-discovered from ~/.claude/skills/cortex-init/SKILL.md (user-level), works in any project directory. INVOKE PROACTIVELY when user signals installing or using cortex-x — natural-language triggers EN+CZ are load-bearing, don't wait for explicit slash command. Triggers (EN): "let's start", "set up cortex", "init this project", "I installed cortex", "where is cortex installed", "is cortex set up?", "does cortex work?", "/cortex-init". Triggers (CZ): "začni", "nastav cortex", "nainstaloval jsem cortex", "kde je cortex", "je cortex nainstalovaný", "funguje cortex?", "spusť cortex".
disable-model-invocation: false
---

# /cortex-init — cortex-x project initializer

You are running the cortex-x initialization flow. The user has installed cortex-x and pasted `/cortex-init` (or invoked it implicitly via "let's start"). Your job: pick a mode, persist the marker, and chain to the correct workflow — all in this session.

**Voice charter:** see [`standards/voice.md`](../../../standards/voice.md). No greetings, no emoji, no emotion words, counts-not-praise.

## Step 0a — Verify cortex-x install when user asks about it

If the user's message expresses uncertainty about whether cortex-x is installed or where ("nainstaloval jsem cortex", "kde je cortex", "is cortex set up?", "where does cortex live?", "does this even work?"), DO NOT skip ahead to the picker. First verify and report the install state by reading `~/.claude/shared/cortex-source.yaml` via the Bash or Read tool:

```bash
cat ~/.claude/shared/cortex-source.yaml
```

Expected output:
```yaml
cortex_source: <absolute path to source clone, default ~/cortex-x>
cortex_data_home: <absolute path to user data, default ~/.cortex>
```

Report concisely (match prior-turn language; default Czech for Dave):

> "Cortex je nainstalovaný — source v `<cortex_source>`, data v `<cortex_data_home>`. Slash commands `/cortex-init`, `/cortex-help`, `/audit`, `/designer`, `/start`, `/test-audit` jsou aktivní v této session. Tahle složka ještě nemá setup — spustím `/cortex-init`?"

If `cortex-source.yaml` does NOT exist:

> "Cortex není nainstalovaný na této mašině. Install: `curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash` (macOS/Linux/WSL) nebo `iwr https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex` (Windows PowerShell). Pak `claude` restart aby Claude Code načetl skills."

Then either continue to Step 1 (if user confirmed) or stop (if they were only asking the question).

## Step 0 — First-run detection (one-shot manifesto)

Before Step 1 detection, read `$CORTEX_DATA_HOME/state.json` (resolves to `~/.cortex/state.json` by default). Two branches:

**A) Marker absent OR `firstRunCompletedAt` missing → FIRST RUN.** Print this **3-line manifesto** above the AskUserQuestion picker that Step 2 will show. Read the language signal from prior turns; if operator wrote Czech, use the Czech version:

English:
```
cortex-x is institutional memory for Claude Code sessions.
Today: scaffold + audit + nightly Steward agent.
In 6 months: a CLAUDE.md that compounds with every commit.
```

Czech:
```
cortex-x je institucionální paměť pro Claude Code sessions.
Dnes: scaffold + audit + noční Steward agent.
Za 6 měsíců: CLAUDE.md který se nabaluje s každým commitem.
```

Three lines. Declarative present-tense. No emoji, no "revolutionary", no superlatives. **Show once, ever.** Then proceed directly to Step 1.

**B) Marker present + `firstRunCompletedAt` set → RETURNING USER.** Skip manifesto, jump to Step 1. If `lastSyncedAt` is more than 30 days old, print ONE line above AskUserQuestion in Step 2:

```
cortex-x has N new capabilities since last init — /cortex-help to view.
```

Compute N from `cortex/capabilities.md` (the auto-generated registry) — count of entries added/changed since last marker timestamp. If unable to compute, skip the nudge silently.

**Fail-open:** if reading state.json fails (permission, missing dir), treat as first-run. Better to over-show manifesto than crash init.

Full design: [`prompts/onboarding-first-10min.md`](../../../prompts/onboarding-first-10min.md).

## Step 1 — Detect existing context

Before asking, do a quick read-only scan of `$PWD`:

- Does `cortex/discovery.md`, `cortex/proposal.md`, or `cortex/AUDIT.md` exist? → cortex-x already initialized in this directory. STOP, ask the user: *"Cortex je už inicializovaný v této složce (našel jsem `<file>`). Chceš: [r]e-run init / [s]ync session / [d]octor healthcheck / [c]ancel?"* Branch accordingly. Do not silently re-init.
- Is there a `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` / `Gemfile` / source tree? → existing project signal (default to "Existing project" in Step 2).
- Is the directory empty or near-empty (only `.git/`, `README.md`, `.gitignore` at most)? → new-project signal (default to "New project").

## Step 2 — Ask via AskUserQuestion

Use the `AskUserQuestion` tool (it gives Claude Code's native UI with arrow-key + Enter selection — much nicer than a shell prompt). Present three choices:

| Option | When |
|---|---|
| **New project** | Empty / near-empty folder. Walk through brief → research → architect → scaffold → adapt. |
| **Existing project** | Established codebase. Deep 12-dimension audit + recommendations. |
| **Framework only** | I'll paste prompts manually as needed. No auto-flow. |

The default-highlighted choice should match what Step 1 detected. Make the question Czech if user's earlier turns were Czech, English otherwise (read the language signal — don't ask explicitly).

## Step 2.5 — Aider-style status line (before chaining)

Immediately after AskUserQuestion resolves, BEFORE reading the chained prompt, print ONE concrete status line that names what was detected + plan summary. Counts, no praise. Examples:

**Existing project:**
```
Detected: Next.js 16 · 1,847 files · 23 routes · Supabase · no CLAUDE.md
Plan: 12-dimension audit, 4 parallel agents, ~5 min.
```

**New project:**
```
Detected: empty folder. Plan: 6-question discover, 3-4 parallel research agents, scaffold, adapt. ~3 min.
```

**Framework only:**
```
Detected: framework-only mode. Plan: list 8 available prompts and exit.
```

This is the "plan first" pattern (Replit Agent precedent). Operator sees cortex thinking before cortex acts. Skip ONLY if first-run manifesto was just shown AND mode is "Framework only" (redundant).

## Step 3 — Branch on the choice

### Path resolution contract (read this first)

The chained prompts live at `~/.claude/shared/prompts/<name>.md`. Some Claude Code versions don't auto-expand `~` for the Read tool — resolve to an **absolute path** before calling Read:

- **Unix/macOS/WSL/Git Bash:** `/home/<user>/.claude/shared/prompts/<name>.md` (or use `$HOME`)
- **Windows native:** `C:/Users/<user>/.claude/shared/prompts/<name>.md` (Claude Code accepts forward slashes on all platforms — avoid backslashes which agentskills.io spec disallows for portability)

**Do NOT** fall back to the cortex-x source repo (`$CORTEX_HOME/prompts/`) if the installed path is missing — that masks an install regression. If Read fails on the installed path, **stop and tell the user**:

> ⚠ *"`~/.claude/shared/prompts/<name>.md` is missing. The cortex-x install is incomplete. Run `/doctor` to diagnose, or re-run `install.sh` / `install.ps1` from `$CORTEX_HOME`."*

Then exit `/cortex-init`. Do not continue with stale assets.

### If "New project"

1. Use the `Write` tool to create `.cortex-bootstrap-pending` in `$PWD` with content:
   ```
   mode=new
   at=<current ISO timestamp, e.g. 2026-05-06T20:30:00Z>
   ```
2. Read `~/.claude/shared/prompts/new-project.md` (resolved to absolute path per contract above) and execute it from Phase 1 (Discover). Do not ask the user "do you want to start?" — they already chose; just begin Phase 1's first question.

### If "Existing project"

1. Write `.cortex-bootstrap-pending` with `mode=existing` + timestamp.
2. Read `~/.claude/shared/prompts/existing-project-audit.md` (resolved to absolute path per contract above) and execute from Phase 0 (Detect). Begin immediately.

### If "Framework only"

1. Do **not** write a marker file.
2. Print the available prompt list:
   - `/start` — new-project bootstrap (Discover → Research → Architect → Scaffold → Adapt)
   - `/audit` — existing-project deep audit (12 dimensions)
   - `/sync` — end-of-session knowledge capture
   - `/doctor` — healthcheck (cortex-x install integrity, drift detection)
   - `/retrofit` — apply cortex-x patterns to an existing project (after `/audit`)
3. End the turn. The user can paste any prompt next.

## Step 4 — Cleanup contract

The chained prompt (`new-project.md` Phase 5 §5.5 / `existing-project-audit.md` final section) is responsible for deleting `.cortex-bootstrap-pending` on completion. You do NOT delete it from `/cortex-init` itself — the marker has to survive across phase boundaries inside the chained prompt.

## Step 5 — On_complete + marker write

After the chained workflow finishes (Phase 5 finalize / Phase 7 audit final), do two things:

1. **Write the first-run marker.** Use the `Write` tool to create/update `$CORTEX_DATA_HOME/state.json` (default `~/.cortex/state.json`). Schema:

   ```json
   {
     "version": 1,
     "firstRunCompletedAt": "<ISO 8601 timestamp of THIS completion>",
     "mode": "<new|existing|framework>",
     "lastSyncedAt": "<ISO 8601 timestamp of THIS completion>"
   }
   ```

   If the file already exists (returning user), **preserve `firstRunCompletedAt`** and only update `lastSyncedAt` + `mode`. The marker write is idempotent. Fail-open on write errors (don't block the user's session over a marker write).

2. **Print the minute-10 nudge** (single line, no feature list):

   ```
   Done. Next Claude session in this folder will auto-load CLAUDE.md.
   What compounds next: /cortex-help · /sync at end of session · /designer for UI work.
   ```

   Czech variant:

   ```
   Hotovo. Příští session v této složce auto-loaduje CLAUDE.md.
   Co se nabaluje dál: /cortex-help · /sync na konci sezení · /designer pro UI práci.
   ```

3. **Print the Sprint 2.21 three-tier memory + Steward briefing (30-second explainer).** Most operators have zero idea WHY they end up with `CLAUDE.md` + `PROGRESS.md` + `MEMORY.md` + `cortex/AUDIT.md` + `~/.cortex/projects/<slug>.md` on disk. They need ONE sentence per tier so they know what each does. Print in the operator's prior-turn language; default Czech for this operator. Format must be a table OR compact list, NEVER prose paragraphs (voice charter — counts not narrative).

   English:

   ```
   Where your knowledge accumulates from here:
   • PROGRESS.md      sprint state (what's next, what's blocked)        manual edit during work
   • CLAUDE.md        current state (tech, conventions, env vars)       manual edit when stack shifts
   • MEMORY.md        per-project memory index                          you populate, Claude auto-loads
   • cortex/AUDIT.md  + cortex/recommendations.md                       audit deliverables (read-only after Phase 5)
   • ~/.cortex/projects/<slug>.md  cross-project library entry          paste prompts/cortex-sync.md at end of session

   Steward (nightly autopilot) reads cortex/recommendations.md and opens draft PRs while you sleep.
   Activate: paste ~/.claude/shared/prompts/steward-setup.md  (needs OPENROUTER_API_KEY GitHub secret).
   ```

   Czech:

   ```
   Kde se ti znalost nabaluje:
   • PROGRESS.md      sprint state (co je další, co je blocked)         manuální edit za běhu
   • CLAUDE.md        current state (tech, konvence, env vars)          manuální edit když se mění stack
   • MEMORY.md        per-project memory index                          ty populujes, Claude auto-loaduje
   • cortex/AUDIT.md  + cortex/recommendations.md                       audit deliverables (read-only po Phase 5)
   • ~/.cortex/projects/<slug>.md  cross-project library entry          paste prompts/cortex-sync.md na konci session

   Steward (noční autopilot) přečte cortex/recommendations.md a otevře draft PRs zatímco spíš.
   Aktivuj: paste ~/.claude/shared/prompts/steward-setup.md  (potřebuje OPENROUTER_API_KEY GitHub secret).
   ```

4. **Offer Steward activation as inline Y/n** (only if `cortex/recommendations.md` was just written by Phase 5 — i.e. mode=new or mode=existing actually finished, AND `.github/workflows/steward.yml` doesn't already exist). Use `AskUserQuestion` with two options:

   - **Activate Steward now** — chain to `~/.claude/shared/prompts/steward-setup.md`. Walks operator through Phase 1-4 of steward-setup. Includes the OPENROUTER_API_KEY secret-create reminder + workflow file copy.
   - **Maybe later** — exits cleanly with reminder: *"Re-run anytime: paste prompts/steward-setup.md. Steward stays dormant until you do."*

5. **Hooks + CLAUDE.md status reminder** (only if either is missing). Quick check:
   - `cortex-hooks-register --status --json` → if `cortex_entries_total === 0`, suggest `cortex-hooks-register`.
   - `cortex-claude-md-augment --status --json` → if `cortex_block_present === false`, suggest `cortex-claude-md-augment`.

   Print ONE consolidated line per missing piece. Skip silently if both registered. Examples:

   English: *"Cortex hooks not registered — block-destructive + SessionStart + auto-orchestrate are inactive. Activate: `cortex-hooks-register`."*

   Czech: *"Cortex hooks nejsou registrované — block-destructive + SessionStart + auto-orchestrate jsou neaktivní. Aktivuj: `cortex-hooks-register`."*

6. **Sprint 2.29 — Profile MCP recommendations** (skip if `CORTEX_SUGGEST_MCP=0` or if `~/.cortex/.first-run-mcp-suggested` exists). After hooks status:

   - Resolve the project's profile (from `cortex/cortex-source.yaml` or last-known scaffold profile).
   - If profile YAML has a `recommended_mcp_servers:` block, surface ONE consolidated suggestion per server with its install command + caveats.
   - Ask `AskUserQuestion` "Want to walk through MCP setup?" — Yes → print each server's install line individually + the caveats; No → write `~/.cortex/.first-run-mcp-suggested` marker so we don't nag again.

   Example output (ai-agent profile, Czech):
   > *Profile `ai-agent` doporučuje 2 MCP servers: `context7` (live docs, dodge training-cutoff drift) + `supabase` (read-only DB introspection). Free-tier Context7 je od 1/2026 cut na ~1,000 req/měsíc; Supabase MCP je pre-1.0 — never connect to production. Procházet setup? [y/N]*

   Source: `docs/research/sprint-2.29-mcp-recommendations-2026-05-14.md`. Note MCP config path is `~/.claude.json` (single file at home), NOT `~/.claude/mcp.json`.

The chained prompt's own "Phase 6 — Final on_complete" / "Phase 7 — Final on_complete" block runs BEFORE this; the marker write + nudge here is `/cortex-init`'s outer cleanup. **Don't repeat the chained prompt's "Co dál?" block.**

## Edge cases

**User invoked `/cortex-init` in cortex-x source repo itself.** Detect by checking ANY of these — multiple signals because the CLAUDE.md first line evolves; rely on structure:
- `$PWD/install.sh` AND `$PWD/install.ps1` BOTH exist (cortex-x ships both)
- `$PWD/bin/cortex-bootstrap.cjs` exists (uniquely cortex-x)
- `$PWD/templates/CLAUDE.md.hbs` exists (cortex-x template seed)
- git remote `origin` URL matches `/cortex-x(\.git)?$/` — `git remote get-url origin 2>/dev/null`

If two or more match: you're inside cortex-x source. Tell the user: *"You're inside the cortex-x source repository. `/cortex-init` is for end-user projects, not for hacking on cortex-x itself. Try `/doctor` for installation drift checks, `cortex-update --check` to compare against origin/main, or paste `~/.claude/shared/prompts/cortex-evolve.md` if you want to run the self-improvement loop."*

**User cloned cortex-x INSIDE their project (e.g., `myapp/cortex-x/`).** If the cortex-x signals above match but `$PWD` is a subdirectory and the parent dir has its own `package.json` / `pyproject.toml` / `Cargo.toml`, then ask: *"You're in a cortex-x clone nested inside `<parent>`. Did you mean to run `/cortex-init` in `<parent>` instead? [s]witch to parent / [c]ontinue here anyway / cancel."* This prevents the most common "blbeček path" — user `git clone`s cortex-x in their project root, then types `/cortex-init` not realizing they're in the wrong dir.

**User invoked `/cortex-init` mid-session in a project that already has CLAUDE.md.** This means they want to ADD cortex-x to a project that previously bootstrapped without it. Default to "Existing project" (deep audit) — the audit is non-destructive and `/retrofit` afterwards is the additive-apply step.

**`AskUserQuestion` not available (older Claude Code).** Fall back to a plain-text question: *"Píšeš [N]ew / [E]xisting / [F]ramework-only? (1 písmeno)"* — wait for the user's reply, branch the same way.

**Marker file already exists from a previous run.** Read it. If `mode` matches the new choice, ask: *"Marker už existuje pro mode=<X>. Pokračovat / přepsat / zrušit?"*. If different mode, propose overwriting and confirm.

## When NOT to use

- The user is already in a running cortex-x workflow (Phase 1-5 in progress). They should NOT paste `/cortex-init` again — they should answer the current phase's question.
- Debug / development of cortex-x itself — use `/doctor` instead.
- Mid-implementation of a story (PROGRESS.md item in progress). Resume the story; don't re-init.

## Reference

- Full design: `$CORTEX_HOME/docs/sprint-1.5-design.md` §2.1, §2.2, §2.3
- Shell-level alternative: `~/.claude/shared/bin/cortex-bootstrap` — same semantics but invoked from terminal before launching Claude. Useful for scripts / CI / users who prefer terminal flow.
- Marker contract: `cortex/.adapt-pending` (recovery if Phase 5 was interrupted) is separate; SessionStart hook surfaces it on next session.
