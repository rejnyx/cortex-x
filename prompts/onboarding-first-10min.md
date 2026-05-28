# Onboarding — first 10 minutes after fresh install

> **Status:** canonical spec for cortex-x's first-run UX. Skills consuming this: `cortex-init` (loads on every invocation, branches on marker presence).
>
> **Voice charter:** see [`standards/voice.md`](standards/voice.md). All output below respects: no greetings, no emoji, no emotion words, counts-not-praise.

## The aha-moment target (one sentence)

> **"My next Claude session opens this project and already knows what it is."**

The user reads a real generated `CLAUDE.md` or `cortex/AUDIT.md` they recognize as accurate, and understands it auto-loads forever. Everything below this line serves that one moment.

## The first-run marker

Location: `$CORTEX_DATA_HOME/state.json` (defaults `~/.cortex/state.json`).

Schema:

```json
{
  "version": 1,
  "firstRunCompletedAt": "2026-05-13T18:42:00Z",
  "mode": "new|existing|framework",
  "lastSyncedAt": "2026-05-13T18:42:00Z"
}
```

Rules:

- **Lazy-create on first `/cortex-init` invocation.** No init at install time.
- **Detection: `fs.existsSync` only.** Fail-open — if the directory is unwritable, proceed without writing the marker (manifesto shows again next time, which is acceptable degraded UX).
- **Write happens at the END of the first run** (when `/cortex-init` chains complete OR when user picks "Framework only"). Crashed/cancelled runs leave the marker absent; manifesto re-shows next time.
- **Read at the START of every `/cortex-init`.** Marker present + `firstRunCompletedAt` set → skip manifesto, jump straight to AskUserQuestion.
- **Returning-user nudge:** if `lastSyncedAt` is > 30 days old, print one line above AskUserQuestion: *"cortex-x has N new capabilities since last init — `/cortex-help` to view."* Compute N from `cortex/capabilities.md` registry vs. last seen.

## The 5-step sequence

### Minute 0 — `install.sh` / `install.ps1` (pre-existing tail)

Already prints concrete next-step instructions. **Do not bloat with vision.** Tail stays factual:
- Paths installed (framework / agents / skill / user data / bootstrap)
- Profile selected
- Three opt-in consent prompts (each interactive Y/n, skipped silently in CI):
  - **Hooks registration** (`cortex-hooks-register`) — Sprint 2.21. Without this, SessionStart context injection + block-destructive + auto-orchestrate are inactive. `CORTEX_REGISTER_HOOKS=0|1` env to skip the prompt.
  - **Discipline block append** (`cortex-claude-md-augment`) — Sprint 2.21+2.21.1, block v5 (2026-05-28 research-before-assert broadening). Appends R1+R2+task-list+voice+surgical-changes block to `~/.claude/CLAUDE.md` between BEGIN/END markers. `CORTEX_AUGMENT_CLAUDE_MD=0|1` env.
  - **Safety-floor permissions** (`cortex-permissions-register`) — Sprint 2.28. Registers curated `deny` floor + `allow` baseline in `~/.claude/settings.json`. Replaces `--dangerously-skip-permissions`: same speed, but Claude Code's `deny > ask > allow > defaultMode` precedence means the operator cannot accidentally invoke a destructive command via typo, even if their `allow` widens to a catch-all. Reference: [code.claude.com/docs/en/settings](https://code.claude.com/docs/en/settings). `CORTEX_REGISTER_PERMISSIONS=0|1` env.
- Next command (`claude` → `/cortex-init`)
- Steward + PATH info as informational footer

Keep verbose tail. The manifesto belongs in Minute 1, not Minute 0 — install is acknowledgment; the aha-moment opportunity is the **first interactive run**, not the install log.

### Minute 1 — first `/cortex-init` (manifesto, shown once)

Marker check fails (no `state.json`). Print this **above** the AskUserQuestion picker:

```
cortex-x is institutional memory for Claude Code sessions.
Today: scaffold + audit + nightly Steward agent.
In 6 months: a CLAUDE.md that compounds with every commit.
```

Three lines. Declarative present-tense. No superlatives, no "revolutionary", no emoji. Czech-native operator → translate the manifesto to Czech (read language signal from prior turns):

```
cortex-x je institucionální paměť pro Claude Code sessions.
Dnes: scaffold + audit + noční Steward agent.
Za 6 měsíců: CLAUDE.md který se nabaluje s každým commitem.
```

Then **immediately** the existing 3-option AskUserQuestion picker (New / Existing / Framework). No "Press Enter to continue", no pause.

### Minute 3 — first concrete action (status line BEFORE the plan)

Whichever path the user picked, before kicking off Phase 1, print a single Aider-style status line. Examples:

**Existing project:**

```
Detected: Next.js 16 · 1,847 files · 23 routes · Supabase · no CLAUDE.md
Plan: 12-dimension audit, 4 parallel agents, ~5 min.
```

**New project:**

```
Detected: empty folder. Plan: 6-question discover, 3-4 parallel research agents, scaffold, adapt. ~3 min.
```

Counts, no praise. Replit-style "plan first" pattern. The plan is its own act of value — user sees cortex thinking before cortex acts.

### Minute 7 — first artifact lands

Whichever skill ran (`/start` Phase 4 or `/audit` Phase 5), the FIRST disk artifact lands here. Announce it with a single concrete line:

**New project:**

```
Wrote CLAUDE.md (7 sections, 142 lines). Open it in your editor.
```

**Existing project:**

```
Wrote cortex/AUDIT.md (12 sections, 4 P0/P1 priorities). Open it in your editor.
```

Concrete path. Concrete count. No praise. No "great job!". This is the aha-moment — the file IS the demo.

### Minute 10 — single nudge + marker write

After the chained skill completes its `## Phase N — Final on_complete` block, write the marker:

```json
{
  "version": 1,
  "firstRunCompletedAt": "<ISO now>",
  "mode": "<new|existing|framework>",
  "lastSyncedAt": "<ISO now>"
}
```

Then print one nudge — NOT a feature list:

```
Done. Next Claude session in this folder will auto-load CLAUDE.md.
What compounds next: /cortex-help · /sync at end of session · /designer for UI work.
```

That's it. End the turn. No "Star us on GitHub", no Discord, no Steward setup CTA — Steward belongs to a later compound-value moment (post-first-PR), not minute 10.

## Returning user (marker present)

Skip manifesto + skip Aider status line (the operator has seen them). Jump straight to AskUserQuestion. The reasoning: returning users want speed, not re-explanation.

If `lastSyncedAt` is > 30 days old, ONE line above the picker:

```
cortex-x has N new capabilities since last init — /cortex-help to view.
```

Update `lastSyncedAt` after AskUserQuestion completes.

## Anti-patterns (explicit forbidden)

1. **Don't reveal the 4-tier roadmap on first run.** Tier 2-4 vision (persistent entity, home-server, compound learners) is energizing to returning users; to a first-timer it reads as scope creep. Defer to `/cortex-help --vision` or README. Linear, Stripe, Cursor — none show vision deck in onboarding.
2. **Don't list capabilities / standards / profiles by name in stdout.** Counts only (`14 capabilities · 11 profiles · 28 standards`). Names belong in `/cortex-help`, not the install tail or first-run manifesto. Walls of feature lists are the #1 cited dev-tool-onboarding anti-pattern (80-95 % drop after "Get Started", 68 % cite "too much setup time").
3. **Don't ask for cost-cap config, API keys, or Steward setup in the first 10 minutes.** Steward is a power-user feature. Touching it pre-aha = "too much setup time" failure.
4. **Don't print "join Discord" / "star on GitHub" before the first artifact lands.** Premature community CTAs erode trust in a CLI context.
5. **Don't make the user read docs before the first action.** Doc links go in the minute-10 nudge, never before. The whole point: cortex generates CLAUDE.md for them, not the inverse.
6. **Don't run two tutorials** (one in install.sh, one in `/cortex-init`). One canonical place: this prompt, consumed by `/cortex-init`.
7. **Don't repeat the manifesto.** Marker exists for a reason. Returning users have seen it; re-showing erodes trust.

## Implementation contract for `/cortex-init`

Skill modifications required (in `shared/skills/cortex-init/SKILL.md`):

- **New Step 0:** read `$CORTEX_DATA_HOME/state.json` (fall back to `~/.cortex/state.json`). If absent OR `firstRunCompletedAt` missing → print manifesto (Minute 1 block above) before existing Step 1 detection. If present → skip manifesto, proceed to Step 1.
- **Existing Step 2 AskUserQuestion** unchanged.
- **New Step 4-bis (after chained workflow completes):** write the marker JSON. Use Write tool to `$CORTEX_DATA_HOME/state.json`. Fail-open if write errors.
- **Step 3 → Minute-3 status line:** insert before reading `new-project.md` / `existing-project-audit.md`. Format from §Minute 3 above.

Marker write is **idempotent** — re-running `/cortex-init` re-writes `lastSyncedAt`. Only `firstRunCompletedAt` is set-once.

## References — sources for this design

- [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) — `claude` first-run sequence, "what does this project do?" as canonical first prompt
- [Aider usage](https://aider.chat/docs/usage.html) — 5-line status pattern, zero marketing
- [Replit Agent docs](https://docs.replit.com/core-concepts/agent) — plan-first pattern
- [GitHub Copilot quickstart](https://docs.github.com/copilot/quickstart) — aha in <30s, no tour
- [Evil Martians — dev-tool onboarding anti-patterns](https://evilmartians.com/chronicles/easy-and-epiphany-4-ways-to-stop-misguided-dev-tools-users-onboarding) — Vercel CLI gold-standard, deploy in <60s
- [Appcues — time-to-value case study](https://www.appcues.com/blog/time-to-value) — 13 % → 32 % completion via aha-redirect
- [daily.dev — developer onboarding optimization](https://business.daily.dev/resources/developer-onboarding-optimization-from-first-click-to-paying-customer/) — 80-95 % drop after Get Started, 68 % "too much setup time"
- [XDG Base Directory spec](https://wiki.archlinux.org/title/XDG_Base_Directory) — marker file location convention
