# Claude Code ecosystem reference card

> **Audience:** cortex-x contributors deciding "should we add feature X?" or "is this already in Claude Code?". Index of native Claude Code features cortex composes with, reimplements deliberately, or stays out of.

Last verified: 2026-05-26 (Claude Code 2.x, tools reference). When a feature ships on Anthropic's side that cortex previously substituted, this card updates first and `docs/steward-roadmap.md` follows.

## Compose with (cortex enhances, doesn't replace)

These are Claude Code primitives cortex builds on top of. **Do not reimplement.** When a request smells like one of these, route it to the native feature first.

| Feature | Native role | What cortex adds |
|---|---|---|
| **SessionStart hooks** | Per-project shell hook on session open | Universal `session-start.cjs` that auto-detects profile, surfaces sprint state, suggests scaffold |
| **Pre/Post-tool hooks** | Shell hook around tool calls | `block-destructive` (8-pattern denylist) + `post-tool-use` (journal traces for evolve) |
| **PreCompact hook** | Shell hook before context compaction | `pre-compact.cjs` writes recovery state to `.claude/compact-state.md` so next session reads where you were |
| **Skills (`.claude/skills/`)** | Reusable agent skills with frontmatter triggers | 13 cortex skills: cortex-init · cortex-help · cortex-doctor · cortex-goal · cortex-update · cortex-uninstall · audit · designer · start · test-audit · ux-copywriter · ralph-loop · external-adapter-hyperframes |
| **Sub-agents (`.claude/agents/`)** | Specialized agents with isolated context windows | 6-agent parallel review pipeline (acceptance / blind / correctness / edge / security / ssot) auto-dispatched on non-trivial diffs |
| **Task tools** (`TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate`) | Session task checklist; default since v2.1.142 (replaced `TodoWrite`, which is now disabled unless `CLAUDE_CODE_ENABLE_TASKS=0`) | Augment block v4 + `verification-loop.md` reference the task list tool-agnostically (Task tools default, TodoWrite fallback). Implementation+verification task pairing is the cortex layer |
| **Agent tool `isolation: worktree`** | Run a writing subagent in a throwaway git worktree; auto-cleaned if no changes | `/ralph-loop` documents this as the native containment for the lethal-trifecta risk; augment v4 hints it for any writing subagent |
| **Monitor tool** (v2.1.98+) | Background-watch a log/command, interject on events without pausing | `/ralph-loop` Phase 4 offers it as the native alternative to hand-tailing journal.jsonl |
| **PushNotification** | Desktop + phone push when Remote Control connected | `/ralph-loop` + Steward overnight runs pair it with Monitor for "run done / cost spike" alerts |
| **`/goal`** (haiku verifier) | Native 14h–5d session-loop with haiku-driven verification | `/cortex-goal` plans the run with R1-grounded plan, hands off to native `/goal` execution — does NOT reimplement the loop |
| **`/loop`** | Schedule a recurring or self-paced prompt | Operator-side; cortex docs reference it for autonomous Steward dogfooding |
| **MCP servers (`~/.claude.json`)** | Model Context Protocol clients | `cortex-doctor` info-severity check + per-profile `recommended_mcp_servers:` (Context7 default for agentic profiles) |
| **Plan mode** | Read-only exploration before any write | Cortex `/start` enters plan mode by default; voice charter respects plan-mode constraints |
| **Worktrees** | `git worktree add` parallel checkouts | Steward refuses to run inside detached or non-primary worktrees (`STEWARD_WORKTREE_DENIED`) unless `STEWARD_ALLOW_WORKTREE=1` |
| **Cloud Routines** | Anthropic-hosted scheduled runs | Composition pattern documented in [`steward-vs-routines.md`](./steward-vs-routines.md) — Routines call cortex skills; cortex doesn't replicate Routines |
| **Permissions (`settings.json`)** | `deny > ask > allow > defaultMode` rule precedence | `cortex-permissions-register` CLI seeds a safety-floor denylist (20+ patterns); install opt-in |

## Cortex equivalent exists (use cortex's version)

Where cortex ships a deliberately different implementation because the native version is the wrong fit for cortex's use case.

| Concern | Native (Claude Code) | Cortex equivalent | Why cortex's |
|---|---|---|---|
| **Code review** | Single sub-agent invocation (serial) | 6-agent parallel pipeline (review-orchestrate) | Latency + coverage; six perspectives in one wall-clock window > one perspective serially |
| **Memory** | Single-file `CLAUDE.md` | 4-tier (`projects/<slug>.md` institutional · `MEMORY.md` index · `journal/` append-only · `insights/` consolidated) | Plain-text + citable + 3-hop traceable; Notion AI / ChatGPT memory failure modes avoided |
| **Discipline enforcement** | None at framework level | R1 (research-before-implement) + R2 (review pipeline) cadence rules + `cortex-doctor` checks | Multi-session cohesion; survive context compaction |
| **Cron / scheduling** | Cloud Routines (subscription) | GitHub Actions `steward-*.yml` (operator-owned) | OpenRouter billing + atomic rollback + 17 typed action_kinds |
| **Verification loop** | Operator instructs in prompt | `standards/verification-loop.md` + augment block v4 pairs implementation tasks with verification tasks | Survives across sessions; enforced via session-start hint, not per-session reminder |
| **95%-confidence prompt** | Operator types it inline | `prompts/95-confidence.md` reusable fragment | One source of truth; consistent phrasing across `/cortex-init`, `/start`, ad-hoc |

## Explicit NOT-do (already documented elsewhere)

When a contributor asks "should we add X?", these are the active "no, see this doc" answers:

- ❌ **Reimplement `/goal` loop** — Sprint 2.24 wraps native `/goal`, never replaces it. Native haiku verifier is Anthropic-billed and tuned; cortex would lose more than it gains.
- ❌ **Reimplement Cloud Routines** — see [`steward-vs-routines.md`](./steward-vs-routines.md). Different value props; composition not replacement.
- ❌ **Cron-schedule `/goal`** — Sessions are 14h–5d; cron-firing them violates the session model. Use Steward for cron-mutation; `/goal` for long single-task focus.
- ❌ **Reimplement haiku verifier** — same reasoning as `/goal` loop. Cortex's spec-verifier is fundamentally different (acceptance-criteria-driven, not verifier-LLM-driven).
- ❌ **Reimplement Plan Mode** — native does it. Cortex `/start` enters it.
- ❌ **Reimplement permissions schema** — native `settings.json` `deny > ask > allow > defaultMode` is correct; cortex just seeds the deny list (Sprint 2.28).
- ❌ **Reimplement MCP** — native protocol + native `~/.claude.json` config. Cortex recommends servers per profile (Sprint 2.29), never wraps the protocol.

## Worth installing alongside (not bundled by cortex)

External-but-aligned tools that compose well with cortex but ship through their own channels:

- **[Claude Design](https://www.anthropic.com/labs/design)** — Anthropic Labs design assistant. Cortex's `/designer` skill is complementary, not redundant.
- **[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)** — official Anthropic Labs collab. Listed in browser-agent profile's `recommended_mcp_servers:`.
- **[Ralph Loop plugin](https://github.com/anthropics/ralph)** — autonomous loop with planning. Sprint 2.24 documents the composition pattern (cortex plans, Ralph loops, native `/goal` verifies).
- **[anthropics/skills examples](https://github.com/anthropics/skills)** — first-party skill examples worth reading before authoring cortex skills.
- **[Tirith](https://github.com/repello-ai/tirith)** — context-file injection scanner (MIT Rust binary). Wrapped by cortex `shared/hooks/tirith-scan.cjs` when present; opt-in.
- **LSP / code-intelligence plugin** — Claude Code's native `LSP` tool stays inert until a language plugin + server are installed. For TS-strict projects (cortex's default profile target), this gives Claude type-error feedback after every edit without a separate build step. Worth installing per stack; cortex doesn't bundle it but profiles could recommend it (candidate roadmap entry).
- **PowerShell tool** (`CLAUDE_CODE_USE_POWERSHELL_TOOL=1`) — on Windows with Git Bash it's a progressive rollout; opt-in on Linux/macOS/WSL (needs pwsh 7+). cortex hooks + CLIs are all `node` invocations so they run cross-platform regardless, but Windows operators who prefer native PowerShell over Git Bash can enable it without breaking cortex.

## How this card evolves

When Anthropic ships a feature:
1. **First check** — is this a cortex equivalent we should now defer to? (e.g., if Anthropic ships parallel sub-agents natively, cortex's review-orchestrate becomes redundant).
2. **Update this table** before changing implementation; the table is the SSOT.
3. **Open a sprint** for the cortex side migration if the native version supersedes ours.

When a contributor asks "can we add X?":
1. Search this card for X.
2. If listed under "Compose with" — route to native, don't add.
3. If listed under "Cortex equivalent" — explain why cortex's version exists.
4. If listed under "NOT-do" — link to the rationale doc.
5. If unlisted — investigate, then add the entry (this card is append-mostly).

## See also

- [`docs/steward-vs-routines.md`](./steward-vs-routines.md) — Cloud Routines positioning
- [`docs/steward-roadmap.md`](./steward-roadmap.md) — full sprint backlog incl. ecosystem-driven items
- [`standards/skills.md`](../standards/skills.md) — agentskills.io spec for skill authoring
- [`prompts/cortex-load.md`](../prompts/cortex-load.md) — mental model cheat sheet
- [Claude Code official docs](https://code.claude.com/docs)
