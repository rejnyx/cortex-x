---
title: Sprint 2.6 R1 — Discord remote-control bridge for Steward (research memo)
status: research-only — informs implementation, not a commit
created: 2026-05-08
research_dispatched_by: cortex-x autonomous workflow per R1 principle
sprint: 2.6
---

# Sprint 2.6 R1 — Discord remote-control bridge for Steward

## TL;DR

Sprint 2.6 gives the operator mobile-thumb control of an autonomous Steward
across `#alerts`, `#research`, `#failures`, `#cost` channels with 4-layer
security (whitelist + Ed25519/HMAC + token rotation + read-only-by-default
with `/!` mutation prefix). The dominant architectural question is *where* the
Discord client lives relative to the zero-runtime-deps CJS invariant of
`bin/steward/`. Research converges on:

- **Sibling-folder pattern: `bin/discord-bridge/`** with `discord.js` as its
  own (single) dep, communicating with Steward core via filesystem
  (recommendations/, journal, halt-flag). Mirrors the Sprint 4.5 dashboard
  sibling pattern. Steward core stays zero-deps; bridge is a separable
  process the operator can supervise independently.
- **Gateway WebSocket, not HTTP interactions endpoint.** HTTP-only mode
  requires a public reachable URL (ngrok/Cloudflare tunnel) — bad for a
  single-operator on a Windows laptop or future home NAS behind NAT. Gateway
  works from any egress-only host.
- **`@discordjs/core` (lightweight subset)** is the right level if we want a
  zero-deps-ish posture, but the maintenance burden of writing identify +
  resume + zombie detection ourselves is unjustified for a single-operator
  bridge. **Recommendation: use full `discord.js` 14.x.** It is a single
  top-level dep (transitive ~30MB), the most-maintained surface, and the
  bridge process isolation already protects the core invariant.
- **Ed25519 + Discord-signed payloads** make user-id spoofing
  cryptographically infeasible on the HTTP path; on the Gateway path the TLS
  channel + bot-token authentication serve the same role. **Whitelist enforced
  at message receipt** (drop silently for non-allowed user_id) is the right
  layer.
- **HMAC-signed `/!` mutation tokens with 90s replay window** — trivial via
  `node:crypto`, 8-hex-char display token, full 32-byte secret stored
  server-side.
- **Process supervision: NSSM on Windows now, systemd on Linux home server
  later.** Bridge is a long-running process; cron-only Steward keeps working
  unchanged (bridge is read-only side-channel + on-demand mutation trigger,
  not a replacement for nightly cron).
- **Bot rate limit risk: zero.** Discord global cap is 50 req/sec; a
  single-operator personal bot peaks at maybe 1 req/min.

---

## §1 — Connection model: Gateway WebSocket vs HTTP interactions endpoint

Discord supports two mutually-exclusive bot connection models
([Discord Gateway docs][gateway-docs], [HTTP serverless example][serverless]):

- **Gateway (WebSocket)**: persistent connection, push-based events, can read
  messages and react. Required for anything beyond direct slash-command
  responses. Egress-only — works behind NAT, on laptops, on home NAS.
- **Interactions endpoint URL (HTTP webhook)**: Discord POSTs to a public URL
  you provide, signed with Ed25519. Cheaper to host (serverless), but the
  endpoint must be publicly reachable. For a single-operator on a Windows
  laptop or future home NAS behind a residential ISP, this means an ngrok /
  Cloudflare-tunnel hop, an extra DNS dependency, and a third-party trust
  surface that the operator does not control.

**Decision: Gateway.** The cortex-x roadmap explicitly targets a home-NAS-
hosted persistent entity (Sprint 5.0+); a persistent WebSocket process matches
that trajectory natively. Cron-based Steward stays on GHA for now; the bridge
process runs in parallel as a side-channel, not a replacement.

The minimal Gateway lifecycle ([opcodes ref][opcodes],
[lifecycle deepwiki][lifecycle]):

1. GET `/gateway/bot` → `wss://gateway.discord.gg/?v=10&encoding=json`.
2. Open WS. Receive **op 10 Hello** with `heartbeat_interval`.
3. Schedule heartbeat (op 1) every `heartbeat_interval * jitter` ms; include
   last received sequence in `d`.
4. Send **op 2 Identify** with token + intents + properties.
5. Receive **READY** dispatch — capture `session_id` + `resume_gateway_url`.
6. Loop on **op 0 Dispatch** events (INTERACTION_CREATE for slash commands).
7. On disconnect: if close code is resumable, reconnect to
   `resume_gateway_url`, send **op 6 Resume** with token + session_id +
   sequence. On **op 9 Invalid Session** with `d=true` resume, otherwise
   re-Identify ([resume docs][resume]).
8. Zombie detection: if no **op 11 Heartbeat ACK** between sends, terminate
   with non-1000/1001 close code and reconnect+resume.

Approximate handwritten LoC for a correct minimal client (heartbeat, identify,
resume, zombie detection, reconnect with backoff): **~400 LoC** of careful
code. Not blocked by any missing primitive — Node 22+ has stable built-in
`WebSocket` ([Node 22 announcement][node22-ws]). But every Discord library
post-mortem ever written says "the resume/reconnect path is where bugs hide
for months." For a single-operator bridge with zero performance pressure, the
maintenance cost of owning that surface ourselves is hard to justify.

---

## §2 — Library tradeoffs: discord.js vs alternatives

| Library | Weekly DL | Stars | Posture | Verdict for 2.6 |
|---|---|---|---|---|
| `discord.js` 14.x | 577K | 26.7K | Full-coverage, opinionated | **Recommended.** One dep at the top level; ~30MB unpacked transitive. Best docs, slash-command helpers, embed builders. Operator productivity > byte count. |
| `eris` 0.18.x | 2.8K | 1.5K | Lightweight, fewer helpers | Memory-efficient at scale; cortex-x scale is "1 user, 1 server." No advantage. |
| `oceanic.js` | low | low | Modern alt, ESM-first | Smaller community, less battle-tested. Skip. |
| `@discordjs/core` + `@discordjs/ws` + `@discordjs/rest` | medium | n/a | Lightweight subset (gateway + REST, no client wrapper) | **Tempting.** ~3 deps instead of 1; we own the cache layer. Worth a Sprint 2.6.1 follow-up if `discord.js` weight irritates the operator, but not a v1 blocker. |
| Hand-rolled (Node `WebSocket` + `fetch`) | n/a | n/a | Zero deps | ~400 LoC of fragile resume/reconnect we have to maintain. Punts complexity into our own surface. **Only worthwhile if Steward core itself imports it**, which §3 says it shouldn't. |

Sources: [npm trends][npmtrends], [Discord lib comparison][libs-advaith],
[discord.js npm][discordjs-npm], [@discordjs/core docs][djs-core].

---

## §3 — Architectural separation (the real question)

Three options:

### Option A — Sibling folder `bin/discord-bridge/` with discord.js dep

```
cortex-x/
├── bin/
│   ├── steward/              ← stays zero-deps CJS
│   │   ├── _lib/             ← halt-check, lock, journal, ...
│   │   └── execute.cjs
│   └── discord-bridge/       ← NEW
│       ├── package.json      ← own deps: discord.js, that's it
│       ├── bridge.cjs        ← main process
│       └── _lib/
│           ├── auth.cjs      ← whitelist + HMAC verify
│           ├── commands.cjs  ← slash command handlers
│           └── steward-fs.cjs ← read journal/, write recommendations/
└── package.json              ← workspaces: ["bin/discord-bridge"]
```

The bridge reads/writes `~/.cortex/` via filesystem just like the operator's
hands would. No new IPC, no new protocol. The Steward core remains testable in
the existing CI matrix without ever pulling in a Discord library, even
transitively.

**Pros:** Mirrors the Sprint 4.5 dashboard sibling pattern. Steward zero-deps
invariant preserved. Bridge can be supervised, restarted, version-bumped,
crash-looped, or temporarily killed without touching the cron path. Discord-
specific tests run in their own lane (no impact on `npm test` 1134-test
budget).
**Cons:** Two `package.json` files; operator runs install in two places.
Workspaces solve that. Some duplication in shared utilities (a thin
`@cortex-x/shared` workspace package can absorb that in Sprint 2.6.1).

### Option B — Inline in Steward core with raw WebSocket

Adds ~400 LoC of WebSocket + Discord protocol handling to `bin/steward/_lib/`.
Preserves zero-deps but drags Discord protocol concerns into the Steward
codepath, complicates the lock + halt-check primitives (do they apply to the
bridge process?), and makes the cron-only `execute.cjs` flow accidentally
import gateway code via siblings.

**Verdict: rejected.** Couples concerns that should be orthogonal. The cron
path should not know Discord exists.

### Option C — Sibling repo `cortex-discord-bridge`

A separate npm package and git repo. Overkill for a single-operator personal
framework. No public consumers will ever install just-the-bridge. Adds
release-coupling friction (bridge change → bump cortex-x SDK dep → re-release).

**Verdict: defer to Sprint 4.x marketplace if a third party ever wants the
bridge standalone. Not 2.6 scope.**

**Recommendation: Option A — `bin/discord-bridge/` sibling folder, npm
workspaces, single `discord.js` dep, filesystem IPC with Steward core.**

---

## §4 — Slash command UX

Mobile-friendly command set (capped at Discord's 32-char/100-char limits, all
with ephemeral default unless explicitly channel-visible):

| Command | Args | Channel | Ephemeral? | Mutation? |
|---|---|---|---|---|
| `/status` | none | any | yes | no |
| `/forecast` | none | `#cost` | yes | no |
| `/why` | `<commit-sha>` | `#research` | yes | no |
| `/recent` | `[count=10]` | any | yes | no |
| `/!halt` | `<reason>` | any | no (channel-visible audit) | **yes** |
| `/!resume` | none | any | no | **yes** |
| `/!recommend` | `<text>` | `#research` | no | **yes** |
| `/!retry` | `<run-id>` | `#failures` | no | **yes** |

The `/!` prefix is a UX convention, not a Discord enforcement — Discord lets
slash command names start with any letter/digit, and `!` is *not* permitted in
the command name itself ([app commands ref][app-commands]). **Mechanism: name
the commands `halt`, `resume`, etc., and require an HMAC token argument
exclusively for those whose entry in a server-side mutation registry has
`mutation: true`.** The `/!` is purely for operator mental model in docs.

### Rich embeds vs plaintext

Discord embeds are 6000-char total per message (sum of all fields)
([embed limits][embed-limits], [pagination guide][pagination]).
`cortex-steward status` JSON output today is ~1500 chars typical; under the
single-message limit. Use embeds with structured fields (color-coded by
state: green=ok, yellow=halted, red=failure). For longer outputs (multi-
window cost forecast, journal tail with > 10 entries), follow-up messages
with reaction-based pagination ([discord-message-pagination][pag-lib]) work
well; ephemeral follow-ups stay private to the operator.

### 2000-char body limit

Bot-message `content` is hard-capped at 2000 chars even with deferred
responses ([char-limits ref][char-limits], [API discussion][char-disc]). Embed
fields (≤1024 char each, total ≤6000) are the bypass. JSON dumps that exceed
6000 chars (rare, but `cortex-steward status --forecast --verbose` could
breach it) should be uploaded as a `.txt` attachment using the **8MB bot
upload cap** (free tier — see §9). Bridge code: if `content.length > 5500`,
auto-attach as file with embed pointing at it.

### Ephemeral default

`MessageFlags.Ephemeral` (`1 << 6 = 64`) makes responses operator-only
([ephemeral docs][ephemeral]). Default to ephemeral for read commands;
explicit channel-visible for `/!halt` and `/!resume` (audit trail in
`#alerts`). One caveat: ephemeral state is set at first reply and **cannot be
edited later** ([djs ephemeral notes][djs-eph]).

---

## §5 — Authentication: 4-layer

### L1 — Whitelist `STEWARD_DISCORD_ALLOWED_USER_IDS`

Comma-separated Discord user IDs (snowflake strings, no @). Enforced at
**INTERACTION_CREATE handler entry** before any command parse. Drop silently
(no reply) for non-allowed IDs to avoid confirming bot existence to scanners.
Log to journal as `event: 'discord_unauthorized'` for forensic trail.

**Spoofing posture**: on the Gateway path, Discord delivers events over our
authenticated WS connection — the `interaction.member.user.id` and
`interaction.user.id` fields are guaranteed authentic by the channel itself
(equivalent to TLS + bot token = mutual trust with Discord). On the HTTP
interactions path, Ed25519 signature verification ([discord-interactions-js
README][interactions-js]) provides the same guarantee. No additional spoofing
mitigation needed at our layer beyond TLS hygiene + bot-token secrecy.

### L2 — HMAC-signed mutation tokens

Per ([Discord token rotation guide][token-rotation]):

- Server-side secret `STEWARD_DISCORD_HMAC_SECRET` (32 random bytes, hex).
- For each mutation request: `expected = HMAC-SHA256(secret, action_id || ts)`
  where `action_id` is one of `halt|resume|recommend|retry` plus the args
  hash.
- Token displayed to operator: first 8 hex chars of `expected` for thumb-
  friendly entry. Mobile thumb-tappable, still 32 bits of entropy gated by
  the 90s window.
- Replay window: 90s from issuing `/get-token` command. Discord message
  timestamps are reliable to ~ms ([Discord rate-limit guide][rate-limits])
  but server `Date.now()` is the authoritative clock; trust message time
  only as advisory.

Trivial implementation:

```js
const crypto = require('node:crypto');
function makeToken(actionId, ts) {
  return crypto.createHmac('sha256', process.env.STEWARD_DISCORD_HMAC_SECRET)
    .update(`${actionId}|${ts}`).digest('hex').slice(0, 8);
}
```

8-hex-char tokens have 16M-space; with 90s window and per-IP rate limit, brute
force is infeasible. For paranoid operators a `STEWARD_DISCORD_TOKEN_LENGTH=16`
env knob is a Sprint 2.6.1 tunable.

### L3 — Read-only-by-default

Mutation registry hardcoded in `bin/discord-bridge/_lib/commands.cjs`. Any
command not in the registry's `mutation: true` set is a pure read; HMAC token
is silently ignored if provided. Reduces operator habit risk ("oh wait was
that a mutation").

### L4 — Bot token rotation

Operator-suggested cadence: 90 days, matching general industry guidance
([token rotation guide][token-rotation]). No native Discord auto-rotation
primitive — token reset must be manual through the developer portal, which
invalidates the old token instantly. Plan: `bin/discord-bridge/rotate-token.md`
runbook + a `STEWARD_DISCORD_TOKEN_ISSUED_AT` journal note that
`cortex-steward status` warns on after 90 days.

---

## §6 — Reconnect, supervision, scale

### Gateway reconnect

Minimum-correctness checklist ([userdoccers using-gateway][using-gateway],
[lifecycle][lifecycle]):

- Capture `session_id` + `resume_gateway_url` from READY.
- On disconnect, decode close code; resumable codes (4000/4001/4002/4005
  etc.) → reconnect to `resume_gateway_url`, send op 6 Resume.
- Non-resumable (4004 auth failed, 4014 disallowed intents) → halt + log,
  do not retry. Surface in `#alerts` once via webhook (out-of-band path
  since the bot itself is broken).
- Op 9 Invalid Session: if `d=true` resume; else fresh Identify after 1-5s
  random delay.
- Heartbeat ACK timeout (no op 11 between two op 1 sends) → close 4900,
  resume.
- Discord.js implements all of this correctly; this list is for the
  Sprint 2.6.1 hand-roll fork option.

### Process supervision

- **Windows (current)**: NSSM (Non-Sucking Service Manager) wraps the
  `node bin/discord-bridge/bridge.cjs` invocation as a real Windows service
  with auto-restart and start-on-boot ([NSSM guide][nssm]). Setup is one-
  command. Less pain than Task Scheduler for a long-running process.
  Fallback: just run in a Windows Terminal tab and let it die when the
  laptop sleeps — acceptable for a single-operator dogfood while iterating.
- **Linux home server (Sprint 5.0+)**: systemd unit. `Restart=always`,
  `RestartSec=5`, `EnvironmentFile=` for the token + HMAC secret with
  mode 0600 ([systemd guide][systemd-bot]).
- **PM2** is a third option. Not necessary if NSSM/systemd already chosen.

### Rate limits

Discord global cap is **50 req/sec per bot** (with 1200/sec available for
larger bots by application) ([rate-limit docs][rate-limits-docs]). Single-
operator bridge will peak at maybe 1 req/min during active use. **No risk
whatsoever.** The only realistic 429 path is a logic bug in retry code;
respect the `Retry-After` header and journal as `event: 'discord_429'`.

### Startup time

`READY` event arrives within 1-3s of Identify on average ([gist client
example][gist-client]). Bridge cold start under 5s is realistic.

---

## §7 — Observability

Each Discord command emits two artifacts:

- **Journal**: `event: 'discord_command'`, `command: '/status'`, `user_id`,
  `channel_id`, `ts`, `result: 'ok' | 'unauthorized' | 'invalid_token' |
  'error'`, `latency_ms`. Reuses `journal.cjs` SSOT primitive — bridge writes
  to the same `~/.cortex/journal/<slug>/<date>.jsonl`. Phoenix OTLP emitter
  (Sprint 2.0/2.0.1) auto-picks up these journal lines at next batch.
- **Phoenix OTLP span** (Sprint 2.0): one span per command, attributes
  `discord.command`, `discord.user_id`, `discord.channel`, `discord.ephemeral`,
  `result.code`. Wrap mutation paths (`/!halt` etc.) as parent spans whose
  children are the resulting Steward action spans (already emitted by
  `execute.cjs`). Cost-vs-forensics: spans are ~200 bytes each, < 1MB/year
  of trace at 1 cmd/min — emit unconditionally.

---

## §8 — Failure UX

| Failure | Operator-facing UX | Journal entry |
|---|---|---|
| Bot crash | NSSM/systemd restart within seconds; on next `/status`, an embed shows "uptime: 12s" → operator notices | `event: 'bridge_restart'` with crash signal |
| Discord API 5xx | Bot retries with exponential backoff per `Retry-After`. Slow but recovers. | `event: 'discord_5xx'` |
| Steward HALT | `/status` returns red embed with `STEWARD_HALT` reason + lessons tail | already journaled by Steward |
| HMAC token wrong | Ephemeral reply: "Invalid token. Use /get-token to refresh." | `event: 'discord_invalid_token'` |
| Whitelist miss | Silent drop (no reply) | `event: 'discord_unauthorized'` |
| Generic command error | Ephemeral embed with error code + journal pointer (`run_id`) | `event: 'discord_command_error'` |

---

## §9 — Voice messages + file uploads (Sprint 4.3 forward-compat)

Sprint 4.3's "voice → recommendation" pipeline needs:

- Discord voice attachments are standard files with `content_type:
  audio/ogg`. Fetch via `attachment.url` (CDN URL signed, 24h validity).
- **Bot upload limit is 8MB** ([file-attachments FAQ][file-faq],
  [bot upload issue][bot-upload]) — significantly tighter than the user
  25MB. Voice notes are typically 10-60s ≈ 200KB-1MB OGG; comfortably
  inside 8MB.
- Whisper API accepts file URLs directly; no need to download-and-reupload.

The Sprint 2.6 bridge architecture cleanly extends: register a
`MESSAGE_CREATE` listener (in addition to `INTERACTION_CREATE`) on
`#research` channel, filter to attachments with audio mime, dispatch to
Whisper, write resulting transcript as a recommendation. **No new primitive
needed for Sprint 4.3** — bridge becomes the unified entry point.

---

## §10 — Cron coexistence

The bridge is a long-running side-channel process. The existing GHA cron
flow (`steward.yml` 04:00 UTC nightly, `steward-autoresearch.yml` Sunday
02:00 UTC) keeps running unchanged on GitHub-hosted runners. The bridge
process runs on the operator's Windows laptop / home NAS and provides:

- Read-only forensic UI (`/status`, `/forecast`, `/why`).
- Mutation triggers (`/!halt`, `/!resume`, `/!retry`) that write to the same
  filesystem primitives the cron path reads (halt-flag, lock, recommendations
  queue).
- A live channel for `event: 'spec_failure'` and similar journal entries to
  push notify into `#failures` — eliminates the "I have to ssh in to check"
  failure mode.

Two journals → one journal: bridge writes its own events to the existing
journal file. Cron journal entries are pushed to Discord channels by a
separate `journal-tail.cjs` watcher inside the bridge (1s polling on
`fs.watchFile`, batched per channel). No protocol — just filesystem.

---

## §11 — Recommended commit shape

Sprint 2.6 deliverables (single commit, ~1500 LoC + ~400 test LoC):

1. `bin/discord-bridge/package.json` — single dep `discord.js@^14`.
2. `bin/discord-bridge/bridge.cjs` — main entry; Gateway client + intent
   registration + slash-command dispatcher.
3. `bin/discord-bridge/_lib/auth.cjs` — whitelist + HMAC verify + token
   issue.
4. `bin/discord-bridge/_lib/commands.cjs` — registry of all slash commands;
   `mutation: true|false` flag drives HMAC enforcement.
5. `bin/discord-bridge/_lib/steward-fs.cjs` — read-only journal/halt/lock
   accessors + recommendation-queue writer.
6. `bin/discord-bridge/_lib/journal-tail.cjs` — push journal events to
   per-channel Discord webhooks.
7. `bin/discord-bridge/register-commands.cjs` — one-shot script to register
   slash commands via `POST /applications/{id}/commands` REST
   ([command registration][cmd-reg]).
8. `bin/discord-bridge/install-windows.ps1` + `install-linux.sh` —
   NSSM/systemd unit installers.
9. `tests/unit/discord-bridge/*` — auth + commands contract tests, no
   live Discord (mock the `discord.js` client interface).
10. `docs/discord-bridge-usage.md` — operator runbook.
11. **No changes to `bin/steward/`** — invariant preserved.

New env vars:

- `STEWARD_DISCORD_BOT_TOKEN` (secret)
- `STEWARD_DISCORD_HMAC_SECRET` (32-byte hex)
- `STEWARD_DISCORD_ALLOWED_USER_IDS` (comma-separated snowflakes)
- `STEWARD_DISCORD_GUILD_ID`
- `STEWARD_DISCORD_CHANNEL_ALERTS`, `_RESEARCH`, `_FAILURES`, `_COST`
- `STEWARD_DISCORD_TOKEN_TTL_SEC=90`
- `STEWARD_DISCORD_TOKEN_ISSUED_AT` (auto-managed by `rotate-token` script)

---

## §12 — Top 3 risks

### Risk 1 — Bot token leak

**Mechanism**: token committed to git, leaked via screenshot, exfiltrated by
malware on operator's laptop. Discord auto-resets tokens it detects on
public GitHub but the window between leak and reset is unbounded.

**Mitigation**: env-only via `.env.local` (gitignored). Pre-commit hook
scans for `M[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,38}`
(Discord bot token regex) and blocks. 90-day rotation reminder via
`cortex-steward status` warning. GitHub secret scanning enabled.

### Risk 2 — HMAC replay outside 90s window

**Mechanism**: operator copies a token from one channel to another after
90s; bridge rejects. Mild UX paper-cut but fail-safe direction.

**Mitigation**: error reply gives clear next step ("Use /get-token to
refresh"). Journal entry. No security-side mitigation needed because the
window is *the* mitigation.

### Risk 3 — Bridge process crash during HALT-flag write

**Mechanism**: bridge process receives `/!halt`, begins writing
`~/.cortex/halt`, gets killed mid-write → partial file, Steward reads and
mis-parses.

**Mitigation**: write-then-rename pattern (write to `halt.tmp`, fsync,
rename to `halt`). Already a Sprint 1.6.6 pattern in `bin/steward/_lib/
halt-check.cjs`; reuse the same primitive. Test: kill -9 mid-write contract
test.

---

## §13 — Open questions (operator decision required)

1. **Library: `discord.js` (recommended) or `@discordjs/core` lower-level
   stack?** Default proposal: `discord.js` for v1; reassess if 30MB
   transitive dep weight irritates after dogfood.
2. **Bridge supervision on Windows: NSSM-as-service, or terminal-tab while
   iterating?** Default: terminal tab through Sprint 2.6 ship + NSSM
   conversion in Sprint 2.6.1 once command set is stable.
3. **Mutation prefix `/!` displayed in command name (e.g. `/halt`) or in
   help text only?** Default: name is `halt`/`resume`/etc., `/!` lives in
   docs. Discord doesn't allow `!` in command names.
4. **Journal tail webhook frequency: 1s polling (real-time) or 30s batched
   (cheap)?** Default: 1s for `#failures`, 30s for `#cost`. Configurable.
5. **Voice attachment auto-transcribe in `#research` (Sprint 4.3 prep) ship
   in 2.6 or wait for 4.3?** Default: defer; bridge architecture supports
   it cleanly later, no need to ship Whisper integration now.
6. **Token rotation: manual runbook (recommended) or scheduled GHA
   workflow that auto-resets via developer portal scraping?** Default:
   manual. No portal API for rotation; scraping is fragile.

---

## §14 — Sources

Discord protocol + reference:

- [Discord Gateway documentation][gateway-docs]
- [Discord Userdoccers — Using Gateway][using-gateway]
- [Gateway Connection Lifecycle (DeepWiki)][lifecycle]
- [Discord opcodes + close codes][opcodes]
- [Discord Application Commands][app-commands]
- [Receiving and Responding to Interactions][interactions]
- [Discord rate limits][rate-limits-docs]
- [Discord file attachments FAQ][file-faq]
- [Discord bot upload limit issue][bot-upload]
- [Embed limits — Python Discord][embed-limits]
- [Bot character limits guide][char-limits]
- [Char limit API discussion][char-disc]
- [Ephemeral messages FAQ][ephemeral]
- [Slash command registration via REST][cmd-reg]

Library landscape:

- [discord.js npm][discordjs-npm]
- [npm trends discord.js vs eris][npmtrends]
- [Discord library comparison][libs-advaith]
- [@discordjs/core docs][djs-core]
- [discord.js ephemeral notes][djs-eph]
- [discord-message-pagination][pag-lib]

Authentication + signing:

- [discord-interactions-js README][interactions-js]
- [Discord serverless bot example (HTTP path)][serverless]
- [Token rotation best practices 2026][token-rotation]

Process management:

- [systemd Discord bot guide][systemd-bot]
- [NSSM RustDesk usage][nssm]
- [PM2 discord.js guide][pm2-djs]

Node platform:

- [Node 22 — stable WebSocket announcement][node22-ws]

Worked examples:

- [Building a Discord Gateway client gist][gist-client]
- [Resume opcode reference][resume]

[gateway-docs]: https://docs.discord.com/developers/events/gateway
[using-gateway]: https://docs.discord.food/gateway/using-gateway
[lifecycle]: https://deepwiki.com/discord-userdoccers/discord-userdoccers/8.1-gateway-connection-lifecycle
[opcodes]: https://docs.discord.food/gateway/opcodes-and-close-codes
[app-commands]: https://discord.com/developers/docs/interactions/application-commands
[interactions]: https://discord.com/developers/docs/interactions/receiving-and-responding
[rate-limits-docs]: https://docs.discord.com/developers/topics/rate-limits
[rate-limits]: https://space-node.net/blog/discord-bot-rate-limiting-guide-2026
[file-faq]: https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ
[bot-upload]: https://github.com/discord/discord-api-docs/issues/6058
[embed-limits]: https://www.pythondiscord.com/pages/guides/python-guides/discord-embed-limits/
[char-limits]: https://lettercounter.org/blog/discord-character-limit/
[char-disc]: https://github.com/discord/discord-api-docs/discussions/4070
[ephemeral]: https://support-apps.discord.com/hc/en-us/articles/26501839512855-Ephemeral-Messages-FAQ
[cmd-reg]: https://dev.to/cedricmkl/register-discord-slash-commands-via-the-discord-rest-api-3l0f
[discordjs-npm]: https://www.npmjs.com/package/discord.js
[npmtrends]: https://npmtrends.com/discord.js-vs-eris
[libs-advaith]: https://libs.advaith.io/
[djs-core]: https://discord.js.org/docs/packages/core/main
[djs-eph]: https://discordjs.guide/slash-commands/response-methods
[pag-lib]: https://github.com/larrrssss/discord-message-pagination
[interactions-js]: https://github.com/discord/discord-interactions-js/blob/main/README.md
[serverless]: https://oneuptime.com/blog/post/2026-02-12-build-a-serverless-discord-bot-on-aws/view
[token-rotation]: https://www.gitguardian.com/remediation/discord-bot-token
[systemd-bot]: https://gist.github.com/comhad/de830d6d1b7ae1f165b925492e79eac8
[nssm]: https://rustdesk.com/docs/en/self-host/rustdesk-server-oss/windows/
[pm2-djs]: https://discordjs.guide/improving-dev-environment/pm2
[node22-ws]: https://blog.risingstack.com/nodejs-22/
[gist-client]: https://gist.github.com/i0bs/6804b334ce2f2ef292d3f6ec0fc1b9f0
[resume]: https://docs.discord.com/developers/events/gateway
