---
sprint: 2.4
title: Anthropic claude-cli engine via Max subscription
date: 2026-05-08
status: research-complete
---

# Sprint 2.4 — claude-cli engine R1 memo

## 1. Question

Sprint 2.4 introduces a fourth Steward LLM engine (`engine-claude-cli`) that shells out to the local `claude` CLI in headless mode (`-p`) instead of hitting OpenRouter HTTPS. Goal: under the operator's Max x20 subscription, drive the marginal LLM cost of an autonomous Steward run to **$0** while preserving the existing engine seam, the cost-safety mechanics, and the R6 backward-compat invariants. The dominant risk is silent fallback to API-key billing (Anthropic GH issue #43333, #37686 — documented $1,800 incident in 2 days). This memo settles the 10 design questions the operator dispatched, with citations.

## 2. Findings

### 2.1 `claude -p` headless mode current behavior (2026-Q3)

Per the official headless docs the CLI was renamed from "headless mode" to "Agent SDK CLI" but the `-p`/`--print` flag is unchanged and remains stable. Confirmed flags relevant to Steward:

- `-p` / `--print` — non-interactive
- `--output-format json | text | stream-json` — JSON returns a single object with `type:"result", subtype:"success", result, duration_ms, total_cost_usd, session_id, usage` and a per-model cost breakdown
- `--allowedTools "Read,Edit,Bash"` — tool allowlist (Steward keeps this empty for plan-only calls, broader for execute calls)
- `--permission-mode dontAsk` — locks to allowlist + read-only set; correct for non-interactive Steward
- `--append-system-prompt` / `--append-system-prompt-file` — system prompt injection
- `--settings` / `--mcp-config` / `--agents` — pass JSON config inline
- `--json-schema '{...}'` — schema-constrained output goes into `structured_output` field
- `--continue` / `--resume <session_id>` — multi-turn (unused by Steward v0)
- `--bare` — **DO NOT USE**: skips OAuth/keychain reads. "Anthropic authentication must come from `ANTHROPIC_API_KEY` or an `apiKeyHelper`." This is the silent-billing path. Operator was correct.

Breaking changes vs Aug 2025: piped stdin capped at 10MB (v2.1.128); `thinking.type.enabled` rejected on Opus 4.7 (use `--effort` instead, requires CLI ≥ v2.1.111). Neither affects Steward's plan-shape calls.

Exit codes / stderr: not exhaustively documented. Empirical pattern from the error reference — runtime errors are surfaced as printable strings on stderr (e.g. `API Error: 500 ...`, `Not logged in · Please run /login`, `OAuth token has expired`). On `--output-format json` failures, the JSON envelope itself can carry retry events (`system/api_retry` with `error` category in: `authentication_failed`, `oauth_org_not_allowed`, `billing_error`, `rate_limit`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`). Treat exit code 0 + valid JSON as success; nonzero or unparseable JSON as failure.

### 2.2 `CLAUDE_CODE_OAUTH_TOKEN` lifecycle

Token format on disk: `~/.claude/.credentials.json` → `{"accessToken": "sk-ant-oat01-…", "refreshToken": "…", "expiresAt": "<ISO8601>"}`. Access tokens are **short-lived (~60 minutes)**; the refresh token is long-lived and theoretically auto-refreshes.

Reality (GH #22602, #12447, #33811, #47092, #19078, #19456): refresh is fragile. Reported failure modes: keychain permission errors (macOS), refreshed token not persisted to keychain, multi-window contention, "expired immediately after fresh login," OAuth token silently expiring during long autonomous workflows. **The CLI does NOT reliably auto-refresh in headless contexts** — when expired it throws `OAuth token has expired · Please run /login` (a 401-class error category `authentication_failed`).

Acquisition for headless: operator runs `claude setup-token` interactively once, copies the long-lived token, exports it as `CLAUDE_CODE_OAUTH_TOKEN` env var (this is the supported long-lived path; distinct from the per-session OAuth dance). Revocation: `/logout` in any interactive session invalidates it; web logout cascades.

**Steward implication:** treat any `authentication_failed` / `oauth_*` stderr or `error` category as `CLAUDE_CLI_AUTH_REJECTED`, halt with `STEWARD_HALT`, do **not** retry. Surface a recovery hint in the journal: "run `claude setup-token` then re-export `CLAUDE_CODE_OAUTH_TOKEN`."

### 2.3 Concurrent invocations

GH #53922 is the canonical signal: parallel Claude Code sessions started right after the 5-hour reset succeed for the first 3–4, then the rest fail with `Server is temporarily limiting requests (not your usage limit) · Rate limited`. This is a server-side burst limiter independent of plan tier. Max x20 is throughput-tier multiplied (~20× Pro's ~45 prompts/5h baseline) but the concurrency limiter still bites.

Steward autoresearch (Sprint 2.1, N=3 candidates) is **serial within a single process**, so concurrent-call collision is not a concern under current architecture. Worktree supervisor (planned Sprint 2.2) could push 3–4 parallel `claude -p` invocations and cross the threshold — flag as a Sprint 2.2 design constraint, not a 2.4 blocker. Defensive choice: hardcode `STEWARD_CLAUDE_CLI_MAX_CONCURRENCY=1` for v0.

### 2.4 Subprocess hardening (Node.js 22 LTS, 2026)

Use `child_process.spawn` (not `exec` — no shell, no `ENOENT` ambiguity, no command-injection seam). Standard pattern:

- `spawn(cmd, args, { env: scrubbedEnv, signal: ac.signal, stdio: ['pipe','pipe','pipe'], windowsHide: true, shell: <see 2.7> })`
- Build `scrubbedEnv` by **cloning** `process.env`, then **deleting** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` (don't override → silent precedence; delete → CLI uses `CLAUDE_CODE_OAUTH_TOKEN` from disk). Keep `CLAUDE_CODE_OAUTH_TOKEN`, `PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`/`TMP`, `SystemRoot`. Drop everything else by default for least-privilege.
- Timeout: `const ac = new AbortController(); const t = setTimeout(() => ac.abort(), STEWARD_CLAUDE_CLI_TIMEOUT_MS); ... unref()` — and `clearTimeout` on close. Per Node #37273 the AbortSignal aborts spawn cleanly.
- Close stdin explicitly (`child.stdin.end()`) — critical: a `claude` invocation that thinks stdin might still produce input can hang past the timeout in rare cases.
- On parent exit: wire `process.on('SIGTERM' | 'SIGINT', () => child.kill('SIGTERM'))` then SIGKILL escalation after grace.
- Buffer stdout / stderr separately, cap each at e.g. 8 MB to refuse runaway outputs.

### 2.5 `total_cost_usd === 0` as the billing-leak tripwire

Per the operator's research (GH #43333 + #37686 narrative), the canonical failure is: `ANTHROPIC_API_KEY` set in the environment → `claude -p` prefers it over OAuth → bills the API account silently. The `total_cost_usd` field then surfaces a nonzero number (subscription path renders `0` because Max usage isn't billed per-call).

Reliability of the `=== 0` assertion under valid Max use:
- **Subscription path:** Max usage is included; `total_cost_usd` is consistently `0` or `0.0` per the Agent SDK cost-tracking docs ("Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes").
- **Edge case — model fallback:** "Opus is experiencing high load, please use /model to switch to Sonnet." Auto-mode fallback inside the CLI swaps the model for *the same auth*; the cost field stays consistent with the auth path, not the model. So fallback alone should not flip the assertion.
- **Real risk:** stale `ANTHROPIC_API_KEY` from a `.env`, a `direnv`, an inherited shell, or a future "API top-up" scenario. The env-scrubbing in 2.4 closes this. The `total_cost_usd` check is the **belt** to that suspenders.

Decision: assert `total_cost_usd === 0` **after** we confirm the JSON envelope itself is well-formed. On nonzero, write `STEWARD_HALT` immediately with `CLAUDE_CLI_BILLING_LEAK`, capture the offending payload (with token redacted) in the journal, and refuse subsequent runs until the operator acks. Use strict `===` against numeric `0`; accept `0.0`. Reject if field is missing — that's protocol drift, treat as `CLAUDE_CLI_PROTOCOL_DRIFT`.

### 2.6 JSON output schema stability + mapping to OpenRouter return shape

`--output-format json` envelope (verified 2026-Q3):

```
{ "type": "result", "subtype": "success",
  "result": "<text>", "session_id": "...",
  "duration_ms": <int>, "total_cost_usd": <float>,
  "usage": { "input_tokens": …, "output_tokens": …, "cache_read_input_tokens": …, … },
  "model": "claude-sonnet-…" or alias,
  "stop_reason": "end_turn" | "max_tokens" | "tool_use" | …,
  "structured_output": { … }    // present iff --json-schema passed
}
```

OpenRouter engine returns `{ data, usage, model, raw }`. Mapping for `engine-claude-cli`:
- `data` ← parse(`structured_output`) when `--json-schema` was passed; else parse(`result`) after `stripJsonFences()` (Sonnet still occasionally fences JSON, the same Anthropic-via-OpenRouter quirk)
- `usage` ← `{ prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: input+output, cost_usd: total_cost_usd }` via `addCostFields` SSOT helper
- `model` ← envelope `.model` (canonicalize to alias if full ID)
- `raw` ← entire envelope (for journal capture)

Reuse `extractUsage`, `addCostFields`, `stripJsonFences`, plan-shape Zod gate. Don't re-implement.

### 2.7 Path resolution for the `claude` binary on Windows

The reality is hostile (GH #1469, #7470, #9450, #14464):

- Default install drops the binary at `%USERPROFILE%\.local\bin\claude.cmd` (a batch wrapper) in 2026; older npm-global installs drop `claude.cmd` and `claude.ps1` under the npm prefix.
- Node's `spawn('claude', …)` with default options **fails with `ENOENT`** because PATHEXT resolution requires `shell: true` for `.cmd`. But `shell: true` + a path containing spaces (e.g. `C:\Users\david\Desktop\…`) misparses and breaks differently.

Defensive resolution order:
1. If `STEWARD_CLAUDE_CLI_PATH` env set → use it verbatim, assert it exists, choose `shell` based on extension (`.cmd`/`.bat` → `shell: true`; `.exe`/no-ext → `shell: false`).
2. Else, walk `PATH` looking for `claude.cmd`, `claude.exe`, `claude` (in that order on win32; reversed on POSIX). Pick the first hit, store the absolute path, choose shell flag by extension.
3. Cache the resolved path in-process for the session.
4. If unresolvable, emit `CLAUDE_CLI_NOT_FOUND` with a recovery hint pointing at `claude doctor`.

When passing args with spaces on Windows under `shell: true`, double-quote each arg via a tiny `quoteWinArg` helper rather than relying on Node's auto-escaping. Or, preferred: resolve to absolute path, then `shell: false`, which sidesteps cmd.exe entirely.

### 2.8 Error code mapping

New error codes (mirror the `OPENROUTER_*` set, keep cardinality identical):

| Trigger | Code | Halt? |
| --- | --- | --- |
| OAuth expired / revoked / 401 / `authentication_failed` | `CLAUDE_CLI_AUTH_REJECTED` | yes |
| `total_cost_usd !== 0` | `CLAUDE_CLI_BILLING_LEAK` | yes (write `STEWARD_HALT`) |
| Binary not on PATH / `STEWARD_CLAUDE_CLI_PATH` invalid | `CLAUDE_CLI_NOT_FOUND` | yes |
| AbortController fires (timeout) | `CLAUDE_CLI_TIMEOUT` | no (retry budget) |
| `Server is temporarily limiting requests` / 429 | `CLAUDE_CLI_RATE_LIMITED` | no (back off) |
| `You've hit your session/weekly limit` | `CLAUDE_CLI_QUOTA_EXHAUSTED` | yes |
| `API Error: 5xx` | `CLAUDE_CLI_SERVER_ERROR` | no |
| Unparseable JSON / missing field | `CLAUDE_CLI_PROTOCOL_DRIFT` | yes |
| Plan shape (Zod) mismatch | `CLAUDE_CLI_PLAN_SHAPE_INVALID` | no (retry once) |
| Spawn failed for any other reason | `CLAUDE_CLI_SPAWN_FAILED` | yes |
| Stdout/stderr buffer cap exceeded | `CLAUDE_CLI_OUTPUT_TOO_LARGE` | no |

### 2.9 R6 backward-compat

Engine selection table — additive only:

```
STEWARD_ENGINE=mock          → mockEngine            (test)
STEWARD_ENGINE=openrouter    → openrouterEngine      (default, unchanged)
STEWARD_ENGINE=claude-cli    → claudeCliEngine       (NEW)
STEWARD_ENGINE=claude-sdk    → claudeSdkEngine       (stub, kept reachable)
```

CLI flag `--engine claude-cli` mirrors. Default stays `openrouter` so existing CI workflows don't change behavior. No breaking changes to the engine interface.

### 2.10 Test patterns under `node:test`

cortex-x uses Node's built-in test runner. For deterministic subprocess tests:

- **Don't mock `child_process.spawn` directly.** Easier and more honest: parameterize the engine on a `spawnImpl` argument (defaults to `require('child_process').spawn`) and inject a fake in tests. Same pattern as the OpenRouter engine's injectable `fetchImpl`.
- The fake returns an EventEmitter with `.stdout` / `.stderr` (each a `Readable.from([Buffer.from(…)])`), `.stdin` (a `Writable` no-op), and emits `'close'` with the desired exit code on `process.nextTick`. ~30 LoC helper in `tests/helpers/fake-spawn.cjs`.
- Test matrix (target ~12 cases): success path → parse + cost mapping; `total_cost_usd > 0` → `CLAUDE_CLI_BILLING_LEAK` + halt-file written; OAuth expired stderr → `CLAUDE_CLI_AUTH_REJECTED`; rate-limit stderr → `CLAUDE_CLI_RATE_LIMITED`; timeout (fake never closes) → AbortController fires → `CLAUDE_CLI_TIMEOUT`; spawn `ENOENT` → `CLAUDE_CLI_NOT_FOUND`; JSON-fence wrapped output → `stripJsonFences` reused; plan shape invalid; missing `total_cost_usd` field → `CLAUDE_CLI_PROTOCOL_DRIFT`; env-scrubbing assertion (fake captures the env, test asserts `ANTHROPIC_API_KEY` is absent); Windows `.cmd` resolution; concurrency cap = 1 enforced.
- Add a smoke-style integration test guarded by `STEWARD_E2E_CLAUDE_CLI=1` env that actually shells out to a real `claude -p --version` (no token cost). Off by default in CI; on for the operator's manual dogfood lane.

## 3. Decision recommendations

- **Ship `claudeCliEngine` inline in `bin/steward/_lib/action-engine.cjs`** alongside `openrouterEngine` / `mockEngine` / `claudeSdkEngine`. Engine-seam contract identical.
- **NEVER pass `--bare`.** Comment in code explaining why (cite GH #43333). Lint test asserts the literal string `'--bare'` does not appear in built argv.
- **Always pass `--output-format json`** plus `--permission-mode dontAsk`. No `--allowedTools "*"`-style blanket grants.
- **Three-layer billing-leak defense:** (1) env-scrub `ANTHROPIC_*` keys before spawn, (2) assert `total_cost_usd === 0` after parse, (3) write `STEWARD_HALT` on assertion failure plus journal capture.
- **Auth model:** require `CLAUDE_CODE_OAUTH_TOKEN` env var (long-lived, from `claude setup-token`). On `CLAUDE_CLI_AUTH_REJECTED` halt and surface the recovery command, do not auto-retry.
- **Path resolution:** prefer `STEWARD_CLAUDE_CLI_PATH` env override, fall back to PATH walk. Use absolute path + `shell: false` whenever extension is `.exe`/none; only enable `shell: true` for `.cmd`/`.bat`.
- **Subprocess hardening:** AbortController-based timeout (`STEWARD_CLAUDE_CLI_TIMEOUT_MS`, default 120 000), explicit `stdin.end()`, `windowsHide: true`, parent-signal forwarding, 8 MB stdout/stderr caps, scrubbed env.
- **Concurrency:** `STEWARD_CLAUDE_CLI_MAX_CONCURRENCY=1` (in-process semaphore) for v0; revisit at Sprint 2.2 worktree supervisor.
- **Reuse SSOT helpers:** `addCostFields`, `extractUsage`, `stripJsonFences`, plan-shape Zod gate. Don't re-implement.
- **Testing:** inject `spawnImpl`; ship 12 unit tests + one gated E2E. Reuse `fake-spawn.cjs` helper across future engines.

## 4. Acceptance criteria refinements (vs roadmap entry)

- Roadmap entry pegs the file at ~80 LoC. Realistic estimate after env-scrub + path resolution + error-code mapping is **~140–160 LoC**, plus ~30 LoC helper.
- Add explicit acceptance criterion: `kind: shell` test invokes the engine with a fake spawn that emits `{"total_cost_usd": 0.001}` and asserts `STEWARD_HALT` file is written and exit code is nonzero.
- Add `kind: regex` criterion that grep-asserts `'--bare'` never appears in the built argv string of any test fixture.
- Add `kind: file_predicate` that asserts the engine returns the same 4-key result shape as `openrouterEngine`.

## 5. Open questions for operator

Default-resolved by Auto mode (Auto-mode was active at memo write):

- **Auth-not-set behavior:** hard error with `CLAUDE_CLI_AUTH_NOT_CONFIGURED` (distinct from `_REJECTED`).
- **Cron context:** `CLAUDE_CODE_OAUTH_TOKEN` will be a GHA secret per Anthropic's documented setup-token flow.
- **Default engine flip:** keep default `openrouter` for v0.2.x; cortex-x dogfood flips via `.steward/.env` after validation.
- **Concurrency in worktree supervisor:** per-process semaphore = 1 for v0; revisit at Sprint 2.2 with global vs per-worktree decision.

## 6. References

- [Run Claude Code programmatically (headless)](https://code.claude.com/docs/en/headless)
- [Error reference — Claude Code](https://code.claude.com/docs/en/errors)
- [Track cost and usage — Agent SDK](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [Structured outputs — Claude API](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Manage costs effectively — Claude Code](https://code.claude.com/docs/en/costs)
- [Rate limits — Claude API](https://platform.claude.com/docs/en/api/rate-limits)
- [GH anthropics/claude-code#43333 — silent API billing in `-p`](https://github.com/anthropics/claude-code/issues/43333)
- [GH anthropics/claude-code#37686 — $1,800 silent fallback](https://github.com/anthropics/claude-code/issues/37686)
- [GH anthropics/claude-code#22602 — token reused across windows without refresh](https://github.com/anthropics/claude-code/issues/22602)
- [GH anthropics/claude-code#12447 — refresh token handling needed](https://github.com/anthropics/claude-code/issues/12447)
- [GH anthropics/claude-code#33811 — login/logout fail with 401](https://github.com/anthropics/claude-code/issues/33811)
- [GH anthropics/claude-code#47092 — token expires despite refresh_token](https://github.com/anthropics/claude-code/issues/47092)
- [GH anthropics/claude-code#19078 — token expired immediately after login](https://github.com/anthropics/claude-code/issues/19078)
- [GH anthropics/claude-code#19456 — Keychain permission errors on refresh](https://github.com/anthropics/claude-code/issues/19456)
- [GH anthropics/claude-code#53922 — parallel sessions rate-limited after reset](https://github.com/anthropics/claude-code/issues/53922)
- [GH anthropics/claude-code#7470 — Windows spawnSync ENOENT regression](https://github.com/anthropics/claude-code/issues/7470)
- [GH anthropics/claude-code#9450 — Failed to spawn Claude Code process: ENOENT](https://github.com/anthropics/claude-code/issues/9450)
- [GH anthropics/claude-code#14464 — pathToClaudeCodeExecutable in Docker](https://github.com/anthropics/claude-code/issues/14464)
- [GH affaan-m/everything-claude-code#1469 — claude.cmd shell: true on Windows](https://github.com/affaan-m/everything-claude-code/issues/1469)
- [GH nodejs/node#37273 — AbortSignal in child_process.spawn](https://github.com/nodejs/node/issues/37273)
- [Node.js Child process docs (v26)](https://nodejs.org/api/child_process.html)
- [Node.js Test runner docs (v26)](https://nodejs.org/api/test.html)
- [Daveswift — Claude Code OAuth Token Expiry](https://daveswift.com/claude-oauth-update/)
- [Claude Code Headless Mode self-hosting guide 2026 (amux.io)](https://amux.io/guides/claude-code-headless/)
- [Claude Code Rate Limits 2026 (sitepoint)](https://www.sitepoint.com/claude-code-rate-limits-explained/)
