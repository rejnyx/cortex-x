# cortex-x Discord bridge — Sprint 2.6

Mobile-thumb remote control for autonomous Steward via Discord slash
commands. Sibling-folder pattern preserves zero-deps `bin/steward/` core;
this folder has its own `package.json` with `discord.js` as the only
top-level dep.

## Status: v0 alpha

What ships in Sprint 2.6:

- ✅ `auth.cjs` — whitelist + HMAC token generation/verification (zero-deps, fully tested)
- ✅ `commands.cjs` — 6 slash command handlers + spec metadata + dispatcher (zero-deps, fully tested)
- ✅ `journal-tail.cjs` — channel routing rules + NDJSON parser + tail-follower factory (zero-deps, fully tested)
- ⏳ `bridge.cjs` — Gateway WebSocket wiring via `discord.js` ([Sprint 2.6.1 follow-up](#sprint-261-roadmap), requires operator setup)

## Why sibling folder

cortex-x's invariant is "Steward core must remain zero-runtime-deps."
discord.js (v14, ~30 MB transitive) violates that. Solution: bridge runs
as a separate process with its own dep graph, communicates with Steward
exclusively via the filesystem (cortex/journal NDJSON, recommendations.md
append, STEWARD_HALT sentinel).

This mirrors the Sprint 4.8 dashboard pattern (separate UI repo).

## Setup (operator runbook)

Prerequisites:
- Discord bot created at https://discord.com/developers/applications/
- 4 channels in your guild: `#steward-alerts`, `#steward-research`, `#steward-failures`, `#steward-cost`
- Bot invited to your guild with the `applications.commands` and `bot` scopes; permission set: `Send Messages`, `Use Slash Commands`

### 1. Install bridge deps

```bash
cd bin/discord-bridge
npm install
```

This pulls discord.js + transitive deps into `bin/discord-bridge/node_modules/`.
**Steward core remains untouched** — `bin/steward/_lib/*.cjs` still has
zero npm deps.

### 2. Configure env

```bash
# Bot token from Discord Developer Portal
export DISCORD_BOT_TOKEN="your-bot-token"

# Bot's application ID (for slash command registration)
export DISCORD_APPLICATION_ID="123456789012345678"

# Your Discord guild (server) ID
export DISCORD_GUILD_ID="987654321098765432"

# Whitelist of operator user IDs (comma-separated)
export STEWARD_DISCORD_ALLOWED_USER_IDS="111111111111111111,222222222222222222"

# 32+ byte secret for HMAC-signed mutation tokens
export STEWARD_DISCORD_SECRET="$(openssl rand -hex 32)"
```

### 3. Register slash commands

The first run of `bridge.cjs` registers commands per `commands.COMMAND_SPECS`.
Run once to register, then subsequent runs just connect.

### 4. Run bridge as a long-running process

**Windows (NSSM):**
```powershell
nssm install steward-discord-bridge "C:\Program Files\nodejs\node.exe" "C:\path\to\cortex-x\bin\discord-bridge\bridge.cjs"
nssm start steward-discord-bridge
```

**Linux (systemd):**
```ini
# /etc/systemd/system/steward-discord-bridge.service
[Unit]
Description=cortex-x Discord bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/cortex-x/bin/discord-bridge
ExecStart=/usr/bin/node bridge.cjs
EnvironmentFile=/etc/cortex-x/bridge.env
Restart=on-failure
User=cortex

[Install]
WantedBy=multi-user.target
```

## Commands

| Command | Mutation? | Purpose |
|---|---|---|
| `/status` | no | `cortex-steward status --json` summary |
| `/forecast` | no | Cap forecast block (Sprint 1.9.1) |
| `/why <sha>` | no | Render trailer + journal entry for commit |
| `/!halt <reason>` | yes | Write STEWARD_HALT (HMAC-confirmed) |
| `/!resume` | yes | Clear STEWARD_HALT (HMAC-confirmed) |
| `/!recommend <text>` | yes | Append to recommendations.md (HMAC-confirmed) |

Mutation flow: bot replies with an 8-char HMAC token; operator types it
back within 90 seconds; bot performs the action and replies with success.

## Channel routing

Journal events are routed to channels by `journal-tail.routeJournalEvent`:
- Cost / billing-leak / token-velocity → `#steward-cost`
- Autoresearch / prompt evolution → `#steward-research`
- Spec violations / npm test failures / destructive edits → `#steward-failures`
- Halt / breaker / loop / auth → `#steward-alerts`
- Routine success entries are not pushed.

## Sprint 2.6.1 roadmap

- `bridge.cjs` Gateway WebSocket wiring (depends on operator setup above)
- E2E test against a fixture Discord guild (manual)
- Voice attachment dispatch → Whisper → recommendations (Sprint 4.3 link)
- Token rotation runbook (90-day cadence)
- PATH-walk well-known-paths preference for `node` resolution
- Operator-tier opt-out signing (HMAC over `repoRoot + operator-secret`)

## Security model (R1 memo §2 layer-by-layer)

1. **Whitelist**: `STEWARD_DISCORD_ALLOWED_USER_IDS` — fail-closed; empty list = nobody allowed. Snowflake-shape regex (`^\d{10,32}$`) validates env values.
2. **HMAC**: `/!` mutations require operator to type back an 8-char token within 90s. Constant-time compare via `crypto.timingSafeEqual`. Replay protected by 90-second window indexing.
3. **Token rotation**: 90-day calendar entry; rotate `DISCORD_BOT_TOKEN` via Developer Portal + restart bridge.
4. **Read-only by default**: `/!` prefix marks mutations explicitly; non-prefixed commands cannot write to the filesystem regardless of args.

## Why discord.js (not raw WebSocket)

R1 §1 evaluated zero-deps Gateway implementation — heartbeat + identify +
zombie detection + resume + reconnect = ~400 LoC of fragile protocol code
for a single-operator bridge. discord.js encapsulates all of that and is
maintained by the discord.js team. The R6 backward-compat invariant
applies to **Steward core**, not to user-facing bridge processes.
