# Migrations

> Per-version migration notes. Empty until first breaking change.
>
> When a tag introduces a breaking change (config schema, hook contract, prompt path, standard that existing projects depended on), add a section here keyed by the target version. `cortex doctor --migrate` (when implemented) reads this file to guide users.

## Format

```markdown
## vX.Y.Z (YYYY-MM-DD)

### Breaking
- [WHAT changed] — [WHY]
- **Migrate:** [concrete steps]
- **Rollback:** [if applicable]

### Deprecated
- [WHAT is scheduled for removal] — [target version]
```

## Current

### Sprint 2.1 — Steward autoresearch / overnight burst (2026-05-08, commit `b3e6656`)

⭐ TRANSFORMATIVE — non-breaking. Autoresearch is opt-in; default flow stays single-shot. Existing nightly cron (`steward.yml`) runs unchanged. Operators opt in by:

#### Engage autoresearch — 4 paths

```bash
# 1. Ad-hoc CLI (one-off)
node bin/steward/execute.cjs --plan-file=plan.json --mode=autoresearch

# 2. Ad-hoc env (env-driven driver)
STEWARD_MODE=autoresearch node bin/steward/execute.cjs --plan-file=plan.json

# 3. Weekly Sunday cron (recommended)
cp .github/workflows/steward-autoresearch.example.yml .github/workflows/steward-autoresearch.yml
# Cron will run automatically next Sunday 02:00 UTC; first run is informational.

# 4. Premium judge override
STEWARD_AUTORESEARCH_JUDGE_MODEL=anthropic/claude-opus-4.6 \
  node bin/steward/execute.cjs --plan-file=plan.json --mode=autoresearch
```

#### Tunable knobs (all optional, defaults mark the production setting)

| Env | Default | Purpose |
|-----|---------|---------|
| `STEWARD_AUTORESEARCH_N` | `3` | Number of candidate strategies (clamped [1, 10]) |
| `STEWARD_AUTORESEARCH_RUN_USD_CAP` | `1.00` | Per-run hard cap (0 = opt-out) |
| `STEWARD_AUTORESEARCH_MAX_TIME_MIN` | `60` | Wall-clock cap (max 300, GHA 6 h fits) |
| `STEWARD_AUTORESEARCH_JUDGE_MODEL` | `anthropic/claude-sonnet-4.6` | Cross-family judge (must match vendor allowlist) |
| `STEWARD_AUTORESEARCH_SIMILARITY_THRESHOLD` | `0.85` | Jaccard collapse threshold |
| `STEWARD_AUTORESEARCH_DELTA_ANOMALY_MULTIPLIER` | `3.0` | Soft-flag threshold |

#### Rollback

Drop `--mode=autoresearch` flag / `STEWARD_MODE` env / `steward-autoresearch.yml` workflow. Single-shot path is unchanged.

See `docs/steward-autoresearch.md` for the full operator guide.

---

### Sprint 2.0b — Action-kind based model routing (2026-05-08, commit `79c101a`)

Non-breaking. Existing `STEWARD_MODEL=...` pins keep working as the legacy global override (3rd precedence, between per-kind env and profile table).

#### Engage routing

```bash
# Profile (env or CLI)
STEWARD_ROUTING_PROFILE=premium node bin/steward/execute.cjs --plan-file=plan.json
node bin/steward/execute.cjs --plan-file=plan.json --routing-profile=ensemble

# Per-kind override
STEWARD_ROUTING_RECOMMENDATION=anthropic/claude-sonnet-4.6 \
  node bin/steward/execute.cjs --plan-file=plan.json

# One-shot CLI override (bypasses profile allowlist — audited via trace tag)
node bin/steward/execute.cjs --plan-file=plan.json --model=anthropic/claude-opus-4.6

# Per-action USD cap (defense above 1.9.1 daily/weekly/monthly)
STEWARD_PER_ACTION_USD_CAP=1.00 \
STEWARD_PER_ACTION_USD_CAP_RECOMMENDATION=0.05 \
  node bin/steward/execute.cjs --plan-file=plan.json
```

#### Disengage routing (drop back to pre-2.0b behaviour)

Set `STEWARD_MODEL=deepseek/deepseek-v4-flash` (or whatever your pin was). Legacy global wins over the routing table.

See `docs/steward-routing.md` for the full operator guide.

---

### v0.2.0 platform hardening — drop Sprint 4.7 backward-compat shims (2026-05-08)

⭐ BREAKING for operators still using `HERMES_*` names. Sprint 4.7 (2026-05-08 morning) shipped the Hermes → Steward rebrand with a full backward-compat layer scheduled for v0.2.0 removal. v0.2.0 ships now (afternoon), removing those shims atomically.

#### Removed

- **10 hermes-prefixed file shims** (`git rm`'d): `bin/cortex-hermes`, `bin/cortex-hermes.cjs`, `bin/cortex-hermes.ps1`, `prompts/hermes-setup.md`, `standards/hermes-policy.md`, `docs/hermes-roadmap.md`, `docs/hermes-runtime.md`, `docs/hermes-usage.md`, `docs/hermes-rfc.md`, `docs/hermes-research-synthesis.md`. Each was a 1-line redirect to the canonical `steward-*` equivalent — content lives in the `steward-*` files unchanged.
- **`HERMES_*` env-var aliases**: `env.cjs readEnv` now reads only `STEWARD_<NAME>`. No fall-through, no deprecation warning.
- **Legacy `HERMES_HALT` sentinel filename**: halt-check checks only `STEWARD_HALT`. Pre-rebrand halt files in operator state no longer halt the runtime.
- **`Hermes-*` trailer normalization**: `buildCommitMessage` writes `Steward-*` only. `normalizeTrailerPrefixes()` removed. `parseTrailers` and `getTrailer` stay prefix-agnostic for walking pre-rebrand commit history (read-only path preserved).
- **`'hermes'` actor in journal `VALID_ACTORS`**: writes must use `'steward'` (or `'investigate-subagent'`). Existing journal entries with `actor: 'hermes'` remain readable.
- **Engine HARD_DENYLIST legacy patterns**: `bin/hermes/`, `bin/cortex-hermes`, `standards/hermes-` regexes removed.
- **Module-export aliases**: `HERMES_DENY` (policy-check), `HERMES_SYSTEM_PROMPT` (action-engine), `isHermesArtifact` (execute), `getHermesOpenPRs` + `isHermesAuthor` (pr-review-responder).
- **`HERMES_HALT_PRESERVE` policy-check rule**: only `STEWARD_HALT_PRESERVE` is enforced now.
- **Session-start hook legacy probes**: `.github/workflows/hermes.yml` + `~/.cortex/HERMES_HALT` no longer block the activation nudge.
- **PR-review-responder legacy author detection**: `Hermes (cortex-x)` author + `hermes-cortex-x` login + `name.includes('Hermes')` removed; only `Steward (cortex-x)` / `steward-cortex-x` / `name.includes('Steward')` recognized.

#### Migrate (REQUIRED for operators with HERMES_* in flight)

```bash
# 1. Rename env vars in .env / cron scripts / CI configs
sed -i 's/HERMES_/STEWARD_/g' .env.local your-cron-script.sh

# 2. Rename cortex-hermes invocations
sed -i 's/cortex-hermes/cortex-steward/g' your-cron-script.sh

# 3. Move halt sentinels if you have ones in flight
[ -f ~/.cortex/HERMES_HALT ] && mv ~/.cortex/HERMES_HALT ~/.cortex/STEWARD_HALT
[ -f ./.cortex/HERMES_HALT ]  && mv ./.cortex/HERMES_HALT ./.cortex/STEWARD_HALT

# 4. Rename forked workflow files
[ -f .github/workflows/hermes.yml ] && git mv .github/workflows/hermes.yml .github/workflows/steward.yml
```

#### Rollback

`git revert <this-commit>` restores all shims + backward-compat. No data is lost — the changes are pure behavior-strip + file deletions. The pre-rebrand commit history is untouched.

#### Test surface

953 → 973 tests (+20). Halt-check test gains a regression assertion that legacy `HERMES_HALT` is **not** honored (locks the new contract). Existing tests migrated to `STEWARD_*` env vars and `'steward'` actor.

### Sprint 2.0 — Phoenix observability via zero-deps OTLP emitter (2026-05-08)

⭐ TIER 1 OBSERVABILITY GATE. R1-grounded by [`docs/research/sprint-2.0-langfuse-observability-2026-05-08.md`](./docs/research/sprint-2.0-langfuse-observability-2026-05-08.md). Pivots default observability stack from Langfuse (6-container, ClickHouse disk-growth footgun, Tier-2 features paywalled) to Phoenix (1-container, SQLite, native OpenInference + native OpenRouter, Tier-2 features open). Helicone parked as RIP (Mintlify acquisition 2026-03-03).

#### Non-breaking (off by default; opt-in via env var)

**New module — `bin/steward/_lib/otel-emitter.cjs`** (~530 LoC)
- `createTracer({ runId, agentName, serviceVersion, fetchImpl, allowRemote })` returns a `Tracer` instance. Reads `STEWARD_OTEL_ENDPOINT` (legacy `HERMES_OTEL_ENDPOINT` alias through v0.2.0).
- `tracer.startSpan({ name, kind, parent, attributes })` returns a `Span`; emits OpenInference (`openinference.span.kind`, `llm.*`, `tool.*`) AND OTel `gen_ai.*` semconv on every span.
- `tracer.flush()` → batched OTLP HTTP/JSON POST. Idempotent (returns `{reason:'already-flushed'}` on second call). Fail-open everywhere — no endpoint → `{reason:'no-endpoint'}`, unreachable → `{reason:'fetch-failed'}`, oversized payload → `{reason:'payload-too-large'}`, JSON-encode failure → `{reason:'serialize-failed'}`.
- `tracer.withSpan({...}, fn)` convenience: auto-end on resolve/reject; respects callers that already set a status (does NOT overwrite UNSET → OK if caller set ERROR for soft-failure return values).

**Endpoint allow-list (security regression vs Sprint 1.6.20 H2)**
- Loopback only by default: `127.0.0.1`, `localhost`, `::1`. Path must end with `/v1/traces` or `/v1/logs`. Scheme must be `http` or `https`.
- `STEWARD_OTEL_ALLOW_REMOTE=1` opts in to non-loopback hosts (cron / shared dev contexts).
- Validation rejection emits one stderr warning per process and disables the tracer; **never fails the run**.
- Defends against the same threat model as Sprint 1.6.20 H2 (operator-controllable egress URL → SSRF + reconnaissance + data exfil via span attributes).

**Wire-format hardening**
- `toAnyValue` handles NaN/Infinity (→ stringValue, JSON-safe), Symbol/Function (→ named placeholder), Date (→ ISO string), Buffer (→ base64), BigInt (→ string). Object recursion depth-limited to 4 levels.
- Per-attribute string truncation: 8 KB max (any value beyond is suffixed `…`).
- Per-payload size cap: 1 MB total per flush. Oversized payload returns `{reason:'payload-too-large'}` BEFORE any HTTP call.
- `setStatus` redacts absolute filesystem paths from error messages (POSIX `/Users|/home|/opt|...`, Windows `C:\Users\…`, UNC `\\share\…` → `<path>`) and truncates to 200 bytes (CWE-117/209 mitigation).
- NoopSpan as parent (all-zero spanId from a disabled tracer) is treated as no parent — avoids invalid parent_span_id on the wire.

**Plumbing in `bin/steward/execute.cjs`**
- AGENT root span created at the very top of `runExecute` outer wrapper, BEFORE any pre-flight gate. Every exit path — halt-check fail, plan-load fail, daily/weekly/monthly cap, token velocity, loop-detector, lock-held, dirty tree, detached HEAD — produces a trace.
- Plan-derived attributes (`steward.action_kind`, `steward.action_id`, `steward.action_key`, `steward.trigger`, `steward.slug`) are added once the plan is loaded.
- Outer wrapper runs `tracer.flush()` in `finally` regardless of throw / early-return; result-shape (`steward.code`, `steward.commit_sha`, `steward.branch`, `steward.exit_code`) tagged on the AGENT span before flush.
- TOOL spans (`spec_verifier.runChecks`, `verifier.npm_test`, `gh.push_and_pr`) wrapped in try/finally so spans always end even if the wrapped call throws. Throws still propagate.

**LLM span in `bin/steward/_lib/action-engine.cjs`**
- `openrouterEngine` is now a thin try/catch/finally wrapper over `_openrouterEngineInner`. The wrapper emits an LLM-kind span around the call; tags `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `llm.token_count.{prompt,completion,total}`, `llm.cost_usd`, `llm.error_code`. Coerces string-shaped numbers (some OpenRouter providers return `prompt_tokens` as a string).
- Defaults to `0` for missing usage fields so cost dashboards differentiate "no LLM call attempted" from "LLM call, no usage reported".

**Phoenix template — `templates/observability/docker-compose.phoenix.yml` + README**
- Single-container Phoenix recipe. Bound to `127.0.0.1:6006` (web + OTLP HTTP/JSON), `127.0.0.1:4317` (OTLP gRPC, unused but available), `127.0.0.1:4318` (alt OTLP HTTP).
- SQLite at `/mnt/data/phoenix.db` via named volume `cortex-phoenix-data`. Postgres backend optional via `PHOENIX_SQL_DATABASE_URL`.
- README documents bring-up, tear-down, span tree shape, fail-open contract, and the Langfuse-vs-Phoenix decision rationale.

**Operator docs — `docs/steward-usage.md` § Observability**
- Privacy posture, fail-open contract, span tree shape, env var reference.

#### Migrate (non-blocking, opt-in)

```bash
# 1. Start Phoenix:
docker compose -f templates/observability/docker-compose.phoenix.yml up -d

# 2. Tell Steward where to flush spans:
export STEWARD_OTEL_ENDPOINT=http://localhost:6006/v1/traces

# 3. Run a Steward action — spans flush at run end:
cortex-steward execute --plan-file=plan.json

# 4. Inspect: open http://localhost:6006 → projects → cortex-x → traces.
```

#### Rollback

Trivial — unset `STEWARD_OTEL_ENDPOINT` and Steward runs identically to pre-2.0. Journal SSOT preserved; no Phoenix data is load-bearing.

#### Test surface

924 → 978 tests (+54). 49 unit tests (`tests/unit/steward/otel-emitter.test.cjs`), 5 integration tests (`tests/integration/steward-observability.test.cjs`). Coverage: AGENT span structure, parent-child propagation, OTLP wire format, dual-attribute set, attribute coercion (NaN/Infinity/Symbol/Function/Date/Buffer/BigInt), endpoint allow-list (8 allow/deny variants), STEWARD_OTEL_ALLOW_REMOTE opt-in, /v1/logs path, NoopSpan parent skip, payload-too-large cap, withSpan-doesn't-overwrite-status, service.version semconv, path-redaction in setStatus, fail-open under unset/unreachable/non-loopback.

#### R2 review pipeline (pre-merge)

4 specialized agents in parallel: blind-hunter, security-auditor, correctness-auditor, edge-case-hunter. Surfaced 12 must-fix items (3 HIGH SSRF/lifecycle, 6 MED hardening, 3 LOW polish), all applied + regression-tested before commit. Critical regression dodged: Sprint 1.6.20 H2 hardcoded `OPENROUTER_ENDPOINT` precisely because operator-controllable egress is an SSRF + reconnaissance vector; the OTLP path reintroduced the same threat model and is now closed by the allow-list.

### Sprint 4.7 — Hermes → Steward rebrand (2026-05-08)

⭐ PRE-PUBLIC-TAG MUST. The 2026-05-09 web-research audit (see `docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md` and `docs/steward-roadmap.md` § Sprint 4.7) confirmed [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent) is a **139k-star MIT project shipped Feb 2026** with dedicated `hermes-agent.nousresearch.com/.org/.ai` domains. Releasing cortex-x v0.1.0 with a `bin/hermes/` directory would compete in tag-search and brand recognition against an established project. Rebrand cost today (1 day mechanical refactor) is far cheaper than the same refactor in v0.2 plus undoing brand confusion in user docs.

#### Non-breaking (everything works under both names through v0.2.0)

**Directory + file renames** (history preserved via `git mv`):
- `bin/hermes/` → `bin/steward/`
- `bin/cortex-hermes{.cjs,.ps1,}` → `bin/cortex-steward{.cjs,.ps1,}` — old paths exist as 1-line shims that emit a stderr deprecation banner and forward to the new entrypoint.
- `prompts/hermes-setup.md` → `prompts/steward-setup.md` — old path is a redirect markdown stub.
- `standards/hermes-policy.md` → `standards/steward-policy.md` — same shim pattern.
- `docs/hermes-{roadmap,runtime,usage,rfc,research-synthesis}.md` → `docs/steward-*.md` — same shim pattern.
- `.github/workflows/hermes{,-todo-triage,-dep-patch,-harvest}.yml` → `.github/workflows/steward*.yml` (no shim — workflow filenames are not user-callable; cron schedules transfer with the rename).
- `tests/unit/hermes/` → `tests/unit/steward/`, `tests/integration/hermes-*.test.cjs` → `tests/integration/steward-*.test.cjs`, `tests/fixtures/hermes-dryrun/` → `tests/fixtures/steward-dryrun/`, `evals/hermes/` → `evals/steward/`.

**Env vars** `HERMES_*` → `STEWARD_*` with backward-compat layer in `bin/steward/_lib/env.cjs`:
- `STEWARD_DAILY_USD_CAP` ⇐ `HERMES_DAILY_USD_CAP`
- `STEWARD_WEEKLY_USD_CAP` ⇐ `HERMES_WEEKLY_USD_CAP`
- `STEWARD_MONTHLY_USD_CAP` ⇐ `HERMES_MONTHLY_USD_CAP`
- `STEWARD_TOKEN_VELOCITY_CAP` ⇐ `HERMES_TOKEN_VELOCITY_CAP`
- `STEWARD_LOOP_THRESHOLD` ⇐ `HERMES_LOOP_THRESHOLD`
- `STEWARD_LOOP_WINDOW_DAYS` ⇐ `HERMES_LOOP_WINDOW_DAYS`
- `STEWARD_FAILURE_BREAKER` ⇐ `HERMES_FAILURE_BREAKER`
- `STEWARD_MAX_TOKENS` ⇐ `HERMES_MAX_TOKENS`
- `STEWARD_MODEL` ⇐ `HERMES_MODEL`
- `STEWARD_ENGINE` ⇐ `HERMES_ENGINE`
- `STEWARD_MOCK_PLAN` ⇐ `HERMES_MOCK_PLAN`
- `STEWARD_NO_PUSH` ⇐ `HERMES_NO_PUSH`

**`readEnv(name)` semantics** (SSOT helper): reads `STEWARD_<name>` first, falls back to `HERMES_<name>` with a one-time `[steward:deprecation]` warning to stderr. Set `STEWARD_SUPPRESS_DEPRECATION=1` to silence the banner (CI/test envs do this).

**Halt sentinel** `.cortex/HERMES_HALT` → `.cortex/STEWARD_HALT`:
- `halt-check.cjs` reads both filenames; the new name takes precedence when both exist in the same scope.
- `execute.cjs` writes only the new name when the loop detector trips.
- `policy-check.cjs` denylist preserves both `STEWARD_HALT_PRESERVE` (current) and `HERMES_HALT_PRESERVE` (legacy) rules so neither sentinel can be `rm`'d by Steward itself.

**Git trailers** `Hermes-*` → `Steward-*`:
- `git-trailers.cjs` `buildCommitMessage` writes `Steward-Action-Id`, `Steward-Trigger`, `Steward-Journal-Entry`, `Steward-Recommendation-Source`, `Co-Authored-By: Steward <steward@cortex-x.local>`.
- `normalizeTrailerPrefixes(trailers)` (NEW export) auto-renames legacy `Hermes-<suffix>` keys passed in by pre-rebrand callers — no breaking change for external plan generators.
- `parseTrailers` is prefix-agnostic; `getTrailer(parsed, 'Action-Id')` (NEW export) reads either prefix with `Steward-*` taking precedence.
- Past commits in repo history retain their original `Hermes-*` trailers — those are immutable; future-Steward walks both prefixes via `getTrailer`.

**Branch prefix** `hermes/<date>-<slug>-<id>` → `steward/<date>-<slug>-<id>`. Future PRs use the new prefix; pre-rebrand PRs keep their original branch names.

**Engine HARD_DENYLIST** keeps both old and new patterns:
- `bin/steward/`, `bin/cortex-steward` — protect current self-modification path
- `bin/hermes/`, `bin/cortex-hermes` — protect projects forked from pre-rebrand cortex-x
- `standards/steward-`, `standards/hermes-` — same
- All other patterns (.env, .git, .ssh, .gnupg, package.json, .github/workflows) unchanged.

**Detectors** `pr-review-responder.cjs` recognizes both `Steward (cortex-x)` and `Hermes (cortex-x)` as valid PR authors so cross-rename PR follow-up still works. Detectors that emit issue-body templates (todo-triage, doc-drift, lint-fix, flaky-test-repair, etc.) now sign off as "Filed by Steward (cortex-x)".

**Test surface** 924 tests / 0 fail / 1 skipped post-rebrand. Net: +5 new tests covering backward-compat (legacy halt sentinel, legacy trailer prefix, prefix normalization).

#### Migrate (non-blocking; existing setups keep working)

```bash
# 1. Update env-var names in your setup (CI / .env.local / cron):
sed -i 's/HERMES_DAILY_USD_CAP/STEWARD_DAILY_USD_CAP/g' .env.local
sed -i 's/HERMES_FAILURE_BREAKER/STEWARD_FAILURE_BREAKER/g' .env.local
# (...repeat for other HERMES_* vars; the deprecation warning lists the exact key.)

# 2. Replace `cortex-hermes` invocations:
sed -i 's/cortex-hermes/cortex-steward/g' your-cron-script.sh

# 3. (Optional) Move halt sentinel to the new name:
mv ~/.cortex/HERMES_HALT ~/.cortex/STEWARD_HALT 2>/dev/null || true

# 4. Rebrand any project-side workflow file you forked:
# .github/workflows/hermes.yml → .github/workflows/steward.yml
# (or just leave the old filename — GHA cron schedules transfer fine.)
```

#### Rollback

The rebrand is unidirectional — `git revert` of the rebrand commit is large but mechanical. There is no anti-rollback hazard because every backward-compat shim is additive (alias reads, dual-prefix parsers). If a downstream project rolled back to v0.1.0-pre-Sprint-4.7 to investigate a regression, all the legacy paths still work.

#### Deprecated (v0.2.0 removal)

- `bin/cortex-hermes{.cjs,.ps1,}` — removed
- `prompts/hermes-setup.md` — removed
- `standards/hermes-policy.md` — removed
- `docs/hermes-*.md` — removed
- `.github/workflows/hermes*.yml` — removed
- `HERMES_*` env-var aliases in `env.cjs` `readEnv` — removed; only `STEWARD_*` honored.
- `.cortex/HERMES_HALT` legacy filename read in `halt-check.cjs` — removed; only `STEWARD_HALT` honored.
- `Hermes-*` trailer prefix backward-compat in `normalizeTrailerPrefixes` — removed; only `Steward-*` keys accepted in trailer dicts (parsing past commits via `parseTrailers` + `getTrailer` remains supported indefinitely).
- Engine `HARD_DENYLIST` legacy patterns (`bin/hermes/`, `bin/cortex-hermes`, `standards/hermes-`) — removed.
- Backward-compat module exports `policy-check.HERMES_DENY`, `action-engine.HERMES_SYSTEM_PROMPT`, `execute.isHermesArtifact`, `pr-review-responder.{getHermesOpenPRs,isHermesAuthor}` — removed.
- `'hermes'` as a valid `actor` value in `journal.cjs VALID_ACTORS` — removed; only `'steward'` and `'investigate-subagent'` honored. Existing journal entries with `actor: 'hermes'` remain readable (validation is on write, not on read).

### Sprint 1.9.1 — Multi-window cost safety + cross-session loop detector (2026-05-09)

⭐ PRE-2.x POJISTKA. Operator-suggested during 2026-05-09 audit. Today's `HERMES_DAILY_USD_CAP` ($5/day) + `HERMES_FAILURE_BREAKER` (3 fails/1h per-action_key) miss mid-week burst patterns and month-long slow drift. Real-incident anchor: April 2026 dev's $437 retry-loop bill ([Medium post-mortem](https://medium.com/@mohamedmsatfi1/i-spent-0-20-reproducing-the-multi-agent-loop-that-cost-someone-47k-7f57c51f3c06)). Daily cap $5 × 30 = $150/month would have passed without alarm.

#### Non-breaking (env-additive, safe defaults)

**New module — `bin/steward/_lib/cost-safety.cjs`** (~280 LoC)

Five new pre-flight gates layered above existing daily cap + per-action_key failure breaker. All gates honor `0` as explicit opt-out:

- **`HERMES_WEEKLY_USD_CAP`** (default $25) — sliding 7-day window sum across journal `cost_usd` entries.
- **`HERMES_MONTHLY_USD_CAP`** (default $80) — calendar-month window (UTC first-of-month boundary).
- **`HERMES_TOKEN_VELOCITY_CAP`** (default 50,000 tokens / 5min sliding) — sub-daily burst protection (RouteLLM ensemble, Sprint 2.1 autoresearch).
- **`HERMES_LOOP_THRESHOLD`** (default 5) + **`HERMES_LOOP_WINDOW_DAYS`** (default 7) — cross-session loop detector counts `spec_failures[].id` × `action_key` occurrences; on threshold trip, writes `.cortex/HERMES_HALT` with `LOOP_DETECTED:<criterion_id>:<action_key>`. Operator-cleared (manual `rm` per existing kill-switch UX).

Pipeline order in `bin/steward/execute.cjs`: daily → failure-breaker → weekly → monthly → velocity → loop-detector. All gates run BEFORE lock acquisition (same posture as existing daily cap).

**Forecast** — `cortex-steward status --forecast` opt-in flag adds a `cost_forecast` block:
- Daily: spent / cap / percent / projected (rate × 24h scaled by hours-elapsed-today).
- Weekly: spent / cap / percent (sliding window, no projected).
- Monthly: spent / cap / percent / projected (rate × days-in-month / day-of-month).

JSON mode passes through unchanged; human-readable mode renders one line per window.

#### New error codes

- `BUDGET_WEEKLY_CAP_REACHED` — 7-day spend ≥ weekly cap.
- `BUDGET_MONTHLY_CAP_REACHED` — calendar-month spend ≥ monthly cap.
- `TOKEN_VELOCITY_CAP_REACHED` — tokens in last 5min ≥ velocity cap.
- `LOOP_DETECTED` — same criterion id × action_key fired ≥ threshold times in window. Halt is written; operator must manually clear.

#### Tests (+23 across 6 suites; 901 → 924)

- **Unit** [`tests/unit/steward/cost-safety.test.cjs`](tests/unit/steward/cost-safety.test.cjs) — 18 tests across env readers (defaults / opt-out / clamp negative+NaN), spend window readers (daily / weekly / monthly), token velocity (sums / window-cutoff), loop detector (below threshold / at threshold / cross-action_key isolation / threshold=0 disabled / outside window), gate evaluators (ok / cap-reached / 0=disabled), spendForecast shape.
- **Integration** [`tests/integration/steward-cost-safety-pipeline.test.cjs`](tests/integration/steward-cost-safety-pipeline.test.cjs) — 5 end-to-end through `execute.cjs`: weekly cap trips with daily fine + 7-day accumulation, monthly cap trips, token velocity trips on 60K/min, loop detector writes `HERMES_HALT` on 5×SPEC_VIOLATION, daily cap regression preserved.
- One existing test (`HERMES_DAILY_USD_CAP=0 disables cap`) updated to also disable new gates so its "$1000 spend allowed" premise stays valid.

#### Migration impact for downstream consumers

Non-breaking by default. The new caps are conservative ($25/week, $80/month) and any project that runs more than that will trip the cap on first sprint and need to either raise or disable the cap. To preserve pre-1.9.1 semantics exactly:

```bash
# Disable all new gates — pre-1.9.1 behaviour
export HERMES_WEEKLY_USD_CAP=0
export HERMES_MONTHLY_USD_CAP=0
export HERMES_TOKEN_VELOCITY_CAP=0
export HERMES_LOOP_THRESHOLD=0
```

`.github/workflows/steward.yml` does NOT set the new env vars yet — production cron uses the defaults, so any month exceeding $80 will hard-halt and require operator review. This is the intentional safety posture; raise the caps explicitly if/when the project legitimately spends more.

#### Follow-ups

- **Sprint 2.0 (Langfuse)** — Langfuse alerts at 80% cap (replacing the journal-only warning today).
- **Sprint 2.1 (autoresearch)** — autoresearch overnight burst respects velocity cap; tune `--max-budget-usd` per run vs persistent monthly budget.
- **Sprint 5.0 (Steward on home server)** — replace HERMES_HALT file sentinel with systemd unit pause-resume.

---

### Sprint 1.9.0 — Spec-driven verification: per-kind acceptance criteria gate (2026-05-09)

The verification gap that produced PR #3 (−347 / +32 on `docs/steward-usage.md`) and PR #4 (−609 / +28 on `MIGRATIONS.md` with fabricated history) generalizes from "one hardcoded shrink-rule in `applyEditsToFilesystem`" to "per-kind declarative `acceptance_criteria[]` enforced by a new `bin/steward/_lib/spec-verifier.cjs` module." See [`docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md`](docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md) for the R1 decision memo (Option D, sub-rec A — operator approved 2026-05-09 with all 5 default answers).

#### Non-breaking (registry-additive)

**New module — `bin/steward/_lib/spec-verifier.cjs`** (~430 LoC)

- Five criterion kinds: `shell` (cmd exit 0), `file_predicate` (sandboxed JS expression over a curated context: `touchedFiles`, `fileSize(p)`, `fileExists(p)`, `fileContent(p)`, `prevSize(p)`, `edits`, `plan`), `regex` (must-match in target file with optional `applies_to` glob filter), `ears_text` (5 EARS pattern syntax-validation at registry load time, **runtime no-op in 1.9.0** — full runtime semantics deferred to 1.9.1+ per memo Q4), `llm_judge` (declared, throws `SPEC_LLM_JUDGE_NOT_IMPLEMENTED` until v2.0+). The R1 memo's Decision section preferred deferring the `ears_text` validator to 1.9.1; the AC list said "ships with structural validation in 1.9.0." Implementation follows the AC: kind authors who add an `ears_text` entry must hand-write a clause matching one of the 5 EARS patterns or registry load fails (`SPEC_MALFORMED`). This is documented here so a future sprint owner doesn't trip over the apparent contradiction.
- Predicate sandboxing via `new Function` over a curated argument list (operator approved Q1=A). `require` is NOT in scope (module-level binding doesn't propagate into `new Function`'s `[[Scope]]`).
- Fail-closed defaults (Q2=YES strict mode): unknown action_kind → `SPEC_MALFORMED`; kind without `acceptance_criteria` array → `SPEC_MALFORMED`; predicate compile error → caught at registry-validate time → `SPEC_MALFORMED`; predicate runtime throw → `SPEC_PREDICATE_THREW`.
- Plan-level overrides via `plan.acceptance_criteria` (Q3=A): MAY add new ids, MAY strengthen existing ids (severity warn → block, predicate stricter), MAY NOT downgrade severity, MAY NOT change kind for an existing id (`SPEC_OVERRIDE_REJECTED`).
- Glob support (`applies_to: ['docs/**', '*.md']`) for regex/predicate scoping. `**` cross-segment, `*` within-segment, escapes regex metacharacters in literal segments. Windows backslash paths normalize to forward-slash before match.

**Registry migration — `bin/steward/_lib/action-kinds.cjs`**

- Every shipped kind (9 total: `recommendation`, `recommendation_harvest`, `dep_update_patch`, `flaky_test_repair`, `doc_drift`, `todo_triage`, `test_coverage_gap`, `lint_fix_shipper`, `pr_review_responder`) + the v1.0+ placeholder `release_notes_drafter` declares a non-empty `acceptance_criteria` array. Contract test [`tests/contract/action-kinds-acceptance.test.cjs`](tests/contract/action-kinds-acceptance.test.cjs) gates the invariant.
- Shared exports `NO_DESTRUCTIVE_REWRITE_CRITERION` + `NO_DESTRUCTIVE_REWRITE_EARS` reused by `recommendation`, `flaky_test_repair`, and `release_notes_drafter`. The other deterministic kinds whose flow legitimately shrinks files (lockfile updates, lint-fix dead-code removal) intentionally omit the predicate.
- Issue-only kinds (`doc_drift`, `todo_triage`, `test_coverage_gap`, `pr_review_responder`) declare `no_working_tree_edits` (`touchedFiles.length === 0`) so any future regression that starts editing files trips the gate immediately.

**Engine seam — `bin/steward/_lib/action-engine.cjs`**

- `applyEditsToFilesystem` now captures `previousSizes: { [path]: bytes }` BEFORE writing each edit, and returns `edits: [{ path, replace_all }]` so spec-verifier predicates can read both the pre-edit baseline and the LLM's `replace_all` opt-in flag.
- The Sprint 1.8.13 inline `EDIT_DESTRUCTIVE_REWRITE` rejection path is **REMOVED**. Single source of truth for the rule is now the `recommendation` kind's `no_destructive_rewrite` criterion (predicate: `touchedFiles.every(p => prevSize(p) < 200 || fileSize(p) >= prevSize(p) * 0.5 || ((edits.find(e => e && e.path === p) || {}).replace_all === true))`). Mock + OpenRouter engines no longer pass `shrinkCode` to `applyEditsToFilesystem`.

**Pipeline wire — `bin/steward/execute.cjs`**

- New phase between successful `applyAction` and `runNpmTest` (Q5=BEFORE — fail fast on cheap deterministic checks). On `SPEC_VIOLATION` (block-severity criterion failed) or any fail-closed code, `execute.cjs`:
  1. Discards working-tree edits (`git checkout -- . && git clean -fd`)
  2. Returns to original branch + deletes the dead branch
  3. Journals `event: execute_spec_failed`, `outcome: failure`, with the full `spec_failures: [...]` payload
  4. Records a lesson via `safeRecordLesson` with `root_cause: 'SPEC_VIOLATION'` and the criterion id encoded into the lesson text
  5. Returns `{ ok: false, code: 'SPEC_VIOLATION', spec_failures: [...] }` to the caller
- Skip flag `opts.skipSpecVerifier` for tests that need to bypass (no production code path uses it).

#### New error codes (all surfaced via `result.code`)

- `SPEC_VIOLATION` — at least one `severity: 'block'` criterion failed; rolled back. Successor to the old `EDIT_DESTRUCTIVE_REWRITE`.
- `SPEC_WARNING` — only `severity: 'warn'` criteria failed; the action commits but the result carries `warnings: N` and `spec_failures: [...]`.
- `SPEC_MALFORMED` — registry typo, missing kind-specific field, or unknown action_kind. Fail-closed BEFORE edits.
- `SPEC_PREDICATE_THREW` — `file_predicate` JS threw at compile or runtime. Fail-closed.
- `SPEC_SHELL_TIMEOUT` — `kind: shell` exceeded `timeoutMs` (default 30s, max 5min).
- `SPEC_REGEX_NO_MATCH` — `kind: regex` required pattern absent from target file post-edit.
- `SPEC_OVERRIDE_REJECTED` — plan-level override tried to weaken (downgrade severity, change kind).
- `SPEC_LLM_JUDGE_NOT_IMPLEMENTED` — `kind: llm_judge` placeholder; reserved for v2.0+.

#### Tests

- **Unit** [`tests/unit/steward/spec-verifier.test.cjs`](tests/unit/steward/spec-verifier.test.cjs) — 57 tests across `validateCriterion` (every kind + every malformed shape), glob matching, `mergeCriteria` (add/strengthen/reject-downgrade/reject-kind-change/reject-malformed), each runner happy + sad path, end-to-end `runChecks` (registry contract, strict-mode default, happy path, block + warn severity, plan override add, llm_judge runtime throw, malformed criterion).
- **Contract** [`tests/contract/action-kinds-acceptance.test.cjs`](tests/contract/action-kinds-acceptance.test.cjs) — 6 invariants: every shipped kind declares ≥ 1 criterion; every criterion validates; ids unique within a kind; descriptions present; `recommendation` inherits `no_destructive_rewrite`; issue-only kinds declare `no_working_tree_edits`.
- **Integration** [`tests/integration/steward-spec-verification.test.cjs`](tests/integration/steward-spec-verification.test.cjs) — 7 end-to-end through `execute.cjs` against fresh tmp git repos: PR #3 reproduction (1000 → 4 bytes), PR #4 reproduction (~720 → 28 bytes), happy path (700/1000 = 70% preserved), `replace_all: true` escape hatch, small-file (< 200 bytes) bypass via predicate `prevSize(p) < 200` clause, journal `execute_spec_failed` payload, lesson `root_cause: SPEC_VIOLATION`.
- Existing 1.8.13 unit tests in `tests/unit/steward/action-engine.test.cjs` migrated from "engine returns `MOCK_EDIT_DESTRUCTIVE_REWRITE`" to "engine writes; `previousSizes` and `edits[]` returned correctly." End-to-end shrink rejection now lives in the integration suite.
- Total suite: 790 → **859 tests** (+69), all 3 CI lanes (test, install-smoke, no-pii) green locally.

#### Migration impact for downstream cortex-x consumers

This is non-breaking for any project that DOESN'T override `action-kinds.cjs`. For projects that have forked the registry:

1. Add an `acceptance_criteria: []` field to every custom kind (strict mode requires it). Minimum: copy `NO_DESTRUCTIVE_REWRITE_CRITERION` for LLM kinds; copy `no_working_tree_edits` for issue-only kinds.
2. If any custom code in `applyEditsToFilesystem` relied on the old `EDIT_DESTRUCTIVE_REWRITE` rejection, it will no longer fire. The replacement is the `no_destructive_rewrite` criterion at the registry level — express the rule there instead.
3. The result shape from `applyAction` now includes `previousSizes` and `edits` keys. Existing callers that did not destructure those keys are unaffected.

#### Follow-ups unlocked

- **Sprint 1.9.1** — `kind: 'ears_text'` per-kind contract documentation (every kind authors a human-readable EARS clause beside its predicate). Most kinds already have it from this sprint.
- **Sprint 1.9.2** — render `spec_failures` block in PR body so reviewers see which criterion fired without diving into the journal.
- **Sprint 2.0** — `kind: 'llm_judge'` implementation. Requires judge model selection + Cronbach's-α calibration per [arXiv 2510.24367](https://arxiv.org/pdf/2510.24367).
- **Sprint 2.1 (autoresearch)** — autoresearch's `recommendation` output flows through the same spec-verifier; no additional wiring needed.
- **Sprint 2.3 (mutation testing)** — property-based tests for spec-verifier itself.

---

### Sprint 1.6.19 — v0.5b finalization: push + draft PR + budget gates (2026-05-07 night)

The phase that turns "v0.5b mostly works" into "v0.5b done": local-only execute now closes the loop with `git push` + `gh pr create --draft`, and a security-required pair of pre-flight gates (daily spend cap + consecutive-failure circuit breaker) shipped as defense-in-depth before Phase 7 cron triggers can land safely.

#### Non-breaking (additive — zero new npm deps)

**Push + draft PR pipeline** (3 new modules + execute.cjs Phase 10 wire)

- `bin/steward/_lib/git-ops.cjs:117-138` — `pushBranch(repoRoot, branch, opts)` + `hasRemote(repoRoot, remote='origin')`. Push uses `--set-upstream` so subsequent `gh pr create` knows the head ref. Both reject flag-shaped branch/remote names (defense in depth).
- `bin/steward/_lib/gh-ops.cjs` (new file, ~140 LOC) — wraps `gh` CLI via `spawnSync`. Exports `hasGhCli()` (cached), `createDraftPR(opts)` (writes body to tmpfile + uses `--body-file` to avoid quoting issues with multi-line content). Returns `{ ok, url?, error?, code? }` matching git-ops contract. **gh CLI is OPTIONAL** — module degrades gracefully when absent (returns `code: 'GH_CLI_MISSING'`).
- `bin/steward/execute.cjs` — new helper `maybePushAndOpenPR()` between Phase 9 (post-verify) and Phase 11 (success journal). Best-effort, non-blocking: commit + journal always succeed; push/PR step adds `pr` substruct to result with status from one of:
  - `skipped` — `--no-push` CLI flag or `HERMES_NO_PUSH=1` env
  - `no_remote` — no `origin` remote configured (fresh `git init`)
  - `push_failed` — git push exited non-zero (auth, conflict, permission)
  - `no_gh_cli` — branch pushed but gh CLI not on PATH
  - `pr_failed` — gh `pr create` exited non-zero (no GH_TOKEN, repo permission)
  - `created` — `{url: '<PR url>', pushed: true}`
- Journal `action_completed` entry now includes `pr_url` and `pr_status` for cron observability — status command can audit "Hermes ran 12 actions today, 10 created PRs, 2 fell back to no_gh_cli".
- CLI: `--no-push` flag added to `hermes execute` help.

**Budget gates** (Sprint 1.6.19 Phase 2.5)

Two pre-flight gates run BEFORE lock acquisition. A tripped gate journals the refusal and exits cleanly — leaving no lock for next run, and giving cron drivers an exit code + journal trail to back off until conditions clear.

- **`HERMES_DAILY_USD_CAP`** (default $5, set to `0` to disable):
  - `checkDailyBudget(slug)` reads today's journal (timestamps starting with current `YYYY-MM-DD`), sums `cost_usd` across all entries (success + failure paths — Sprint 1.6.15 ensured failures journal cost too), refuses if `>= cap`.
  - Defense in depth over OpenRouter's UI-level per-key spend limit.
  - Refusal journals `execute_budget_capped` event, `outcome: skipped`.
  - Real-incident anchor: April 29 2026 dev's $437 retry-loop bill ([Medium post-mortem](https://medium.com/@mohamedmsatfi1/i-spent-0-20-reproducing-the-multi-agent-loop-that-cost-someone-47k-7f57c51f3c06)).

- **`HERMES_FAILURE_BREAKER`** (default 3, set to `0` to disable):
  - `checkFailureBreaker(slug, actionKey)` counts `execute_*_failed` events for the same `action_key` in the last 1 hour. Refuses if `>= breaker`.
  - Window is **per-action_key** so a wedged Tier 8 action doesn't block other healthy actions.
  - Refusal journals `execute_breaker_tripped`, `outcome: skipped`.
  - Real-incident anchor: today's V4 Flash dogfood produced 4 failed attempts on Tier 8 multi-file action before halt — without breaker, cron would keep retrying every Sunday.

#### Tests

**+9 unit tests** (489 → 498 pass):

`tests/unit/steward/execute.test.cjs`:
- Push + PR (4 tests): no-remote degrades, `--no-push` opts out, `HERMES_NO_PUSH=1` env opts out, bare-repo origin → push succeeds + status reflects gh-CLI presence
- Budget cap (2 tests): blocks when today's spend >= cap, `HERMES_DAILY_USD_CAP=0` opt-out
- Failure breaker (3 tests): trips at threshold, scoped to action_key (different keys don't trip), 1-hour window expires

#### Documentation

- `CLAUDE.md` Phase 7 status: `⚠️ v0 dry-run shipped` → `✅ v0.5b shipped` (full reality: OpenRouter engine + cost ledger + path-safety hardening + push+PR + budget gates)
- `README.md` Phase 7 section mirror-aligned
- Field-test memory entry: `project_cortex_hermes_v05b_review_pipeline_2026_05_07.md` (institutional learning — 7 real-world incidents, 6-agent review pipeline as validated workflow)

Local: npm test → 498/498 pass
       node tools/verify-prompts.cjs --strict → 83 pass
       node tools/verify-skills.cjs --strict → 19 pass
       node tools/verify-standards.cjs --strict → 24 pass

#### What v0.5b "DONE" means after this sprint

L2 Execution autonomy is now **fully production-shaped**:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export HERMES_MODEL=deepseek/deepseek-v4-flash
export HERMES_MAX_TOKENS=16384
export HERMES_DAILY_USD_CAP=5         # safety
cortex-steward dry-run --slug=$(basename $PWD) --json > /tmp/plan.json
cortex-steward execute --plan-file=/tmp/plan.json
# → real OpenRouter call → file edits → npm test gate → atomic commit
# → git push origin <branch> → gh pr create --draft
# → journal logs cost_usd + tokens + pr_url
# → if today's spend >= cap, refuses with BUDGET_CAP_REACHED
# → if action_key has 3+ failures in last hour, refuses with FAILURE_BREAKER_TRIPPED
```

L3 (cron triggers) is now **safe to enable**: uncomment `.github/workflows/steward.example.yml`, set `OPENROUTER_API_KEY` repo secret, rename to `hermes.yml`. The two budget gates close the cost-runaway risk class.

#### Out of scope (Sprint 1.6.20+ candidates)

Hardening tier (Security MEDIUM, deferred):
- H2: Hardcode endpoint (drop `opts.endpoint` test seam)
- H4: `extractUsage` coerce string costs (some routes return `"0.42"` instead of `0.42`)
- H5: Detached HEAD pre-flight check
- H10: Clamp timeoutMs/maxTokens upper bounds

Eval-suite + property tests + mutation testing + stateful simulation (T1, T2, T4) remain Phase 7 launch-tier work.

### Sprint 1.6.18 — Hermes review-pipeline-surfaced hardening (2026-05-07 ultra-closing)

#### Non-breaking (corrections + new error code + tightened guards)

- **B1 — `applyEditsToFilesystem` path-safety hardened** (`bin/steward/_lib/action-engine.cjs:95-128`):
  Old `edit.path.includes('..')` substring check produced false-positives on legitimate paths like `docs/v1.2/notes.md` AND missed real attacks (NUL byte, leading-dash flag injection). New flow:
  1. Reject NUL bytes explicitly (`includes('\0')`)
  2. Reject `path.isAbsolute` and `startsWith('-')` (flag-injection defense)
  3. `path.resolve(repoRoot, edit.path)` then `path.relative` containment check
  Catches symlink composition that the old substring approach missed. Surfaced by Correctness Tier 1 + Security H3 + Edge Case audits.
- **B2 — editPlan shape gate** (`bin/steward/_lib/action-engine.cjs:316-326`): new `OPENROUTER_PLAN_SHAPE_INVALID` error code emitted when `JSON.parse(stripJsonFences(content))` returns a non-object, an array, or an object missing `edits[]`. Prior behaviour passed `editPlan.edits === undefined` to `applyEditsToFilesystem` which masked LLM-format-failures as NO_EDITS.
- **B3 — `DEFAULT_MODEL` aligned with docs**: changed from `anthropic/claude-sonnet-4.5` to `deepseek/deepseek-v4-flash` (`bin/steward/_lib/action-engine.cjs:39`). All three doc sources (`hermes-usage.md`, `hermes-runtime.md`, `MIGRATIONS.md`) recommend V4 Flash since Sprint 1.6.13 — code default was the SSOT outlier.
- **B4 — `execute.cjs` CLI help corrected** (3 sites): "default: claude-sdk" / "fallback to claude-sdk" → "default: openrouter" / "fallback to openrouter". Help was actively misleading users since Sprint 1.6.13 default-engine pivot.
- **B5 — `data === null` guard** (`bin/steward/_lib/action-engine.cjs:301`): `data && data.choices && ...` prevents uncaught TypeError when OpenRouter returns HTTP 200 with null body.

#### Tests

- **+9 unit tests** (480 → 489 pass):
  - `action-engine.test.cjs`: B1 — accepts legit `docs/v1.2/notes.md`, rejects NUL byte, rejects leading-dash, catches `./sub/../../escape.js`. B2 — primitive root, missing edits[], array root. B5 — null body returns EMPTY_RESPONSE.
  - `execute.test.cjs`: D6 — `addCostFields` exported and contract-tested for all 4 journal entry shapes including `execute_post_verify_failed` (1.6.15's missing test).

#### Why now

External review pipeline (acceptance + blind + correctness + security + ssot + edge-case agents in parallel) flagged these as MUST-FIX before Phase 7 cron triggers land. Detail: today's first-real-OpenRouter dogfood + cross-model Haiku 4.5 retry exposed gaps in:
- Trust-boundary correctness (B1 — symlink/NUL bypass)
- Failure observability (B5 — null crash bypasses journal)
- User-facing accuracy (B4 — help text lying about defaults)

Hardening items H1-H10 (daily spend cap, opts.endpoint hardcode, extractUsage string coercion, etc.) ticketed for Sprint 1.6.19. Eval-suite + property-tests + stateful simulation (T1, T2, T4) are tier-gate work for Phase 7 launch.

### Sprint 1.6.17 — JSON-fence stripping + cost capture pre-parse (2026-05-07 late-closing)

Surfaced by today's Haiku 4.5 dogfood: Anthropic models on OpenRouter ignore `response_format: json_object` and wrap output in markdown fences. Two-layer fix:

- **`stripJsonFences(content)`** (`action-engine.cjs:42`): unwraps ` ```json ... ``` ` (or generic ` ``` ... ``` `). No-op on bare JSON (DeepSeek/OpenAI no-regression).
- **`extractUsage(data)`** (`action-engine.cjs:53`): SSOT for OpenRouter wire-shape → engine-contract shape (cost/tokens). Forwarded on 3 early-exit paths (PLAN_NOT_JSON, EMPTY_RESPONSE, applyEditsToFilesystem failures). Sprint 1.6.15 captured cost in journal — but the engine wasn't passing usage on parse-failed paths, so journal had nothing to capture. Two-layer fix needed.
- Tests: +5 (475 → 480) — fenced JSON parses, generic fence parses, bare JSON no-regression, PLAN_NOT_JSON forwards usage, EMPTY_RESPONSE forwards usage.

### Sprint 1.6.16 — Docs alignment with v0.5b reality (2026-05-07 evening)

After Sprints 1.6.13-1.6.15 shipped, `hermes-usage.md` + `hermes-runtime.md` still described v0.5b as "what will do" and pointed users to `ANTHROPIC_API_KEY`. Aligned with the working code:

- "L2 walkthrough" rewrites in present tense ("v0.5b does today")
- Setup section: explicit "inference key, NOT provisioning" guidance (today's first-test surfaced 401 "User not found" trap)
- One-shot setup commands for both bash + PowerShell with persistence
- Model selection table (DeepSeek V4 Flash default → Claude Sonnet 4.5 expensive)
- "What gets captured in journal" — explicit Sprint 1.6.15 cost guarantee
- Troubleshooting: 4 real failure modes from today's dogfood
- L3 GHA setup: `OPENROUTER_API_KEY` secret (not `ANTHROPIC_API_KEY`)
- `hermes-runtime.md`: env vars table updated with `HERMES_MAX_TOKENS` row + inference-key callout

No code changes — pure doc-reality alignment after 3 ship sprints.

### Sprint 1.6.15 — Cost capture on failure paths (2026-05-07 late-evening)

First-real-OpenRouter-call dogfood (Sprints 1.6.13/14) surfaced silent observability gap: when execute incurred OpenRouter spend but failed at apply or verify gates, the journal entry omitted `cost_usd`/`tokens_in`/`tokens_out` entirely. Status's `cost_usd_total` under-reported real spend.

- **`addCostFields(entry, applyResult)` helper** (`execute.cjs:90`): SSOT, conditional add (only number values), used at all 4 sites: `execute_action_failed`, `execute_verify_failed`, `execute_post_verify_failed`, `action_completed`.
- **Mock engine extended**: `HERMES_MOCK_PLAN` JSON envelope now optionally includes `usage: { cost_usd, tokens_in, tokens_out }` so tests can inject cost without spinning up real fetch infrastructure.
- Tests: +3 (472 → 475) — verify_failed cost capture, action_failed cost capture, no null-contamination when no usage envelope.

Real-world signal: today's 4 failed runs DID consume DeepSeek tokens — without this fix, cron-driven Hermes would silently exceed budget on repeated verify failures.

### Sprint 1.6.14 — `HERMES_MAX_TOKENS` env var support (2026-05-07 evening)

First real OpenRouter call hit truncation: DeepSeek V4 Flash returned ~3700 tokens of JSON but hardcoded `max_tokens: 4096` truncated mid-string. Multi-file edit plans need bigger output budgets.

One-line fix: `max_tokens: opts.maxTokens || parseInt(process.env.HERMES_MAX_TOKENS, 10) || 4096`. Precedence: opts (test injection) > env > 4096 default. Production recommendation: 16384 (`HERMES_MAX_TOKENS=16384`).

No new tests (additive env override; existing test count preserved at 472).

### Sprint 1.6.13 — Hermes v0.5b: OpenRouter engine implementation (2026-05-07 closing-closing)

#### Non-breaking (additive — zero new npm deps)

- **What landed:** v0.5b LLM-provider engine in `bin/steward/_lib/action-engine.cjs`. Full pipeline now works with a real LLM via OpenRouter's OpenAI-compatible API. **Zero-deps preserved** — uses `fetch()` built into Node ≥18. +12 tests (460 → 472), all CI-green.

  **Key change:** default engine pivoted from `claude-sdk` (stub) to `openrouter` (real implementation behind `OPENROUTER_API_KEY` env var). `claude-sdk` engine remains reachable via explicit `--engine=claude-sdk` flag for the alternative path described in `docs/steward-runtime.md` § 4.5.

  Three deliverables:

  1. **`openrouterEngine` (~100 LOC)** in `bin/steward/_lib/action-engine.cjs`. Async, `fetch`-based. Calls `https://openrouter.ai/api/v1/chat/completions` with `response_format: { type: "json_object" }`, parses LLM-returned `{edits: [...]}` JSON, applies via shared `applyEditsToFilesystem()`. Captures `cost_usd` + `tokens_in` + `tokens_out` from `data.usage`. Configurable timeout (default 2 min) via `AbortController`. 8 distinct error codes for observability:
     - `OPENROUTER_KEY_MISSING` — env var not set
     - `NO_FETCH` — Node < 18
     - `OPENROUTER_TIMEOUT` — request exceeded timeout
     - `OPENROUTER_NETWORK_ERROR` — fetch threw
     - `OPENROUTER_HTTP_ERROR` — 4xx/5xx with httpStatus
     - `OPENROUTER_RESPONSE_NOT_JSON` — body wasn't JSON
     - `OPENROUTER_EMPTY_RESPONSE` — choices array empty
     - `OPENROUTER_PLAN_NOT_JSON` — LLM emitted non-JSON despite json_object mode
     - `OPENROUTER_EDIT_UNSAFE` / `OPENROUTER_EDIT_INVALID` / `OPENROUTER_NO_EDITS` — same path-safety guards as mock engine

     Plus: `HERMES_SYSTEM_PROMPT` (rules: JSON-only output, no human_only paths, zero-deps, smallest-change), `buildUserPrompt()` (action body + citations + best-effort CLAUDE.md inclusion, capped at 4000 chars), test-injectable `opts.fetch` for mocked-fetch unit tests.

  2. **Async refactor.** `applyAction()` becomes `async`. Sync engines (mock, claude-sdk-stub) are wrapped in `Promise.resolve(...)` for shape compatibility — they continue to return immediately. `bin/steward/execute.cjs` `runExecute()` becomes async; `await actionEngine.applyAction(...)`. CLI wraps `runExecute()` call in an async IIFE chained with `.then(handleResult).catch(...)`.

  3. **`applyEditsToFilesystem` extracted as shared helper** + exported. Both mock + openrouter engines reduce to "write a list of edits to the filesystem with path-safety guards". Helper accepts custom error codes per caller (e.g. `MOCK_NO_EDITS` vs `OPENROUTER_NO_EDITS`) so failure observability stays distinguishable.

- **Tests:**
  - **+8 openrouter mock-fetch tests** in `tests/unit/steward/action-engine.test.cjs` — all paths covered without making real API calls (test injects `opts.fetch`):
    - happy path with cost capture
    - correct headers + model + JSON-mode passed to OpenRouter
    - 4xx/5xx HTTP error handling
    - LLM-emits-non-JSON
    - fetch-throws (network error)
    - empty response
    - LLM-emits-path-traversal (defense in depth still applies to LLM output)
    - missing API key
  - **+1 OpenRouter PII redaction test** in `tests/unit/steward/journal.test.cjs` — explicit verification that `sk-or-v1-...` keys are caught by existing `sk-` regex (no separate pattern needed).
  - **+2 default-engine tests** in `tests/unit/steward/execute.test.cjs` — confirms post-Sprint-1.6.13 default is `openrouter`; `claude-sdk` still reachable via explicit `--engine=claude-sdk` flag.
  - All existing tests refactored to `async test(...)` + `await execute.runExecute(...)`. The `withEnv()` helper became async too (returns `await fn()` in the try block).

- **Bugs caught by tests during implementation:**
  1. Async refactor: `withEnv()` returned the value of `fn()` but didn't await it, so when `fn` was async, the test ended before assertions ran → asynchronous-activity-after-test-ended file-level error. Fix: `await fn()` in `withEnv` + every test now `await withEnv(...)` (sed batch).
  2. `sed -i 's|}, () => {|}, async () => {|g'` only matched single-line; multi-line `withEnv({...}, () => {...})` patterns needed a separate pass.
  3. Default engine pivot from `claude-sdk` → `openrouter` broke the existing "claude-sdk default" test. Updated to test the new default + added explicit-flag test for the SDK path.

- **Safety still in place:**
  - LLM-generated edits go through `applyEditsToFilesystem` → same path-safety guards (no absolute paths, no `..` traversal) as mock engine. The fact that an LLM produced the diff doesn't grant any policy bypass.
  - All Hermes-policy.md MUST-H1 to MUST-H7 guarantees preserved unchanged.
  - `block-destructive.cjs` (Ring 2) still enforces at the Bash-tool layer.
  - `OPENROUTER_API_KEY` redacted in journal (sk-or-v1- caught by existing `sk-` regex; explicit test added).
  - First REAL API call deliberately requires user-set `OPENROUTER_API_KEY` env var — no API calls happen in CI (tests use `opts.fetch` injection).

- **What's autonomous TODAY (post-Sprint-1.6.13):**
  ```bash
  # End-to-end Hermes execution with real LLM via OpenRouter:
  export OPENROUTER_API_KEY=sk-or-v1-...
  export HERMES_MODEL=anthropic/claude-sonnet-4.5  # or openai/gpt-5.4, etc.

  cortex-steward dry-run --slug=$(basename $PWD) --json > /tmp/plan.json
  cortex-steward execute --plan-file=/tmp/plan.json
  # → real OpenRouter call → file edits → npm test gate → atomic commit + trailers
  ```

  **L2 Execution autonomy is now real.** L3 (cron triggers) is the next milestone — uncomment `schedule:` in `.github/workflows/steward.example.yml`, add `OPENROUTER_API_KEY` repo secret, copy to `hermes.yml`.

- **Migrate:** none — additive. All existing tests refactored to async but signatures unchanged from the caller's perspective. Existing `mock` engine path unchanged. `claude-sdk` engine still reachable via `--engine=claude-sdk` (alternative path retained per docs/steward-runtime.md § 4.5).

- **Rollback:** revert this commit. v0.5a (mock engine + execute pipeline) preserved.

- **Pending Dave's go for first REAL API call:**
  - Set `OPENROUTER_API_KEY` env var on local machine OR as GitHub Actions secret
  - Set `HERMES_MODEL` to preferred model
  - Run a single dogfood `cortex-steward execute` against a fresh clone with a small action
  - Validate: PR opens, journal records `cost_usd` + tokens, branch is correct shape, trailers parseable
  - If green for 1-2 weeks: enable GHA cron schedule

### Sprint 1.6.12 — dogfood follow-ups + OpenRouter pivot for v0.5b (2026-05-07 final-final)

#### Non-breaking (additive — docs + .gitignore only, no code changes)

- **What landed:** four small follow-ups closing the day's loose ends. No tests added (no code changes), 460/460 still pass, all 3 validators (--strict) green.

  1. **`.gitignore` adds `package-lock.json` + `yarn.lock` + `pnpm-lock.yaml`.** Sprint 1.6.11 dogfood discovered that `npm install` on a fresh clone creates `package-lock.json`, which then trips Hermes pre-flight `DIRTY_TREE` check. cortex-x intentionally ships no lockfile (single dev dep `c8`, no runtime deps). Lockfile is now gitignored so future dogfooders + CI clones don't hit the same friction. Comment block in .gitignore explains the why for future contributors.

  2. **`docs/steward-runtime.md` § 4.5 "v0.5b LLM provider — OpenRouter via fetch (zero-deps preserved)"** (NEW section, ~80 lines). Documents the architectural pivot from `@anthropic-ai/claude-agent-sdk` to OpenRouter's OpenAI-compatible chat-completions endpoint via built-in `fetch()`. Same `{edits: [...]}` JSON shape as the mock engine — same code path, no SDK lock-in. Includes pseudocode sketch, env vars (`OPENROUTER_API_KEY`, `HERMES_MODEL`, `HERMES_ENGINE`), bonus-over-direct-SDK comparison, async-refactor notes, safety considerations.

  3. **`docs/steward-rfc.md` step 9 updated** — "v0.5 milestone" now distinguishes v0.5a (mock engine + full pipeline, shipped Sprint 1.6.11) from v0.5b (real LLM provider, OpenRouter preferred path). `@anthropic-ai/claude-agent-sdk` documented as fallback alternative if OpenRouter ever stops being suitable.

  4. **`docs/steward-usage.md` rewritten L2 walkthroughs** — split into "L2 walkthrough — what v0.5a does TODAY (mock engine)" + "L2 walkthrough — what v0.5b will do (real LLM via OpenRouter)". Concrete commands for both. The "TODAY" section is the dogfood-validated path (Sprint 1.6.11 commit 2cf2ae0). File-by-file reference table updated to reflect Sprint 1.6.11's new primitives (verifier, git-ops, action-engine).

- **Why these specifically:** Dave: "jinak udělej všechny ty drobnosti co jsi navrhnul" — closing the loose ends from the dogfood report (gitignore lockfile) and the OpenRouter conversation (document the pivot before any v0.5b code lands). No new code crosses zero-deps; v0.5b implementation deferred to a separate sprint.

- **Pivot rationale (OpenRouter over direct Anthropic SDK):**
  - **Zero-deps preserved** — `fetch()` is built into Node ≥18, no npm dep adds
  - **Multi-model** — switch `HERMES_MODEL` env var to compare Claude / GPT / Gemini / Llama on the same action with same prompt
  - **Cost ceiling at provider layer** — OpenRouter UI exposes per-key spend limits, an extra ring over Hermes's own `cost_usd` journal rollup
  - **Cost capture** — response includes `usage.prompt_tokens` + `usage.completion_tokens` + `usage.cost`, wires straight into journal
  - **No SDK lock-in** — engine layer accepts any provider returning the same `{edits: [{path, content}]}` JSON shape (direct Anthropic, direct OpenAI, Together, vLLM self-hosted, etc.)

- **Migrate:** none — additive.

- **Rollback:** revert this commit; .gitignore + 3 doc updates form one logical unit.

- **What's next (v0.5b):** implement `openrouterEngine` in `bin/steward/_lib/action-engine.cjs` per the design at `docs/steward-runtime.md` § 4.5. Make `applyAction` async, update `execute.cjs` to await it, mock `global.fetch` in tests. ~3-4h, single sprint.

### Sprint 1.6.11 — Hermes v0.5a: full execute infrastructure with mock engine (2026-05-07 night)

#### Non-breaking (additive)

- **What landed:** Hermes execute pipeline complete end-to-end with a mock action engine. v0.5b (real Claude Agent SDK) becomes a one-line swap. +40 tests (420 → 460).

  1. **`bin/steward/_lib/verifier.cjs`** (NEW, ~70 LOC) — runs `npm test` (or any npm script) via `spawnSync`, captures stdout/stderr/exitCode/durationMs, configurable timeout (default 5min). Windows compatibility: `npm.cmd` requires `shell: true` on Win since Node 16+ closed CVE-2024-27980 — args are static enums, no injection surface. Includes `summarizeResult()` that extracts test counts from `node --test` output for compact journal entries ("192/192 pass · 8.7s").

  2. **`bin/steward/_lib/git-ops.cjs`** (NEW, ~110 LOC) — atomic git operations wrapper. Provides `getCleanTreeStatus`, `getCurrentSha`, `getCurrentBranch`, `isInGitRepo`, `checkoutNewBranch`, `stage`, `commitWithMessageFile`, `revertCommit`. Defense in depth: rejects branch/path names starting with `-` (flag injection), validates SHA shape before revert, no shell invocation (spawnSync with array argv + `shell: false`), all paths passed after `--` separator.

  3. **`bin/steward/_lib/action-engine.cjs`** (NEW, ~120 LOC) — pluggable engine interface. Two engines:
     - **`mock`** — env-driven (`HERMES_MOCK_PLAN` JSON). Writes specified files, returns touched paths. Defense: rejects absolute paths + path traversal (`..`).
     - **`claude-sdk`** — stub returning `CLAUDE_SDK_NOT_IMPLEMENTED`. v0.5b plugs the actual SDK call here (single function body change).
     Engine selection: `opts.engine` flag > `HERMES_ENGINE` env > default `claude-sdk`. The pluggable shape means v0.5b is a clean isolated PR — no architectural change.

  4. **`bin/steward/execute.cjs` rewritten** (~250 LOC, was ~140 LOC stub). Full 10-phase flow: halt check → plan validation → repo check → pre-flight clean-tree (filtering Hermes's own `cortex/journal/` runtime artifacts) → lock acquire → branch checkout → action-engine.applyAction → verifier.runNpmTest → stage → commit-with-message-file → post-commit verify → journal success → lock release. Rollback semantics for every failure mode: action engine fail → checkout original branch + delete dead branch; verify fail → `git checkout -- .` + `git clean -fd` + return original branch; lock collision → preserve held lock; halt → exit 75.

  5. **+40 tests across 4 files:**
     - `tests/unit/steward/verifier.test.cjs` — 10 tests (npm test ok/fail, stdout capture, durationMs, timeoutMs, runNpmScript, summarizeResult variants)
     - `tests/unit/steward/git-ops.test.cjs` — 13 tests (introspection, branch ops, stage+commit, revert, flag-injection rejection, invalid-SHA rejection)
     - `tests/unit/steward/action-engine.test.cjs` — 13 tests (mock single+multi edit, env vars, JSON parse errors, empty edits, path traversal defense, claude-sdk stub, engine selection precedence)
     - `tests/unit/steward/execute.test.cjs` rewritten — 15 tests (plan validation, halt detection, claude-sdk default returns 64, mock happy path commits + journals success, dirty tree blocks, verify failure rolls back, mock-not-set rolls back to original branch, NOT_GIT_REPO, lock collision, CLI happy path)

- **3 real bugs caught by tests during implementation:**
  1. Windows `spawnSync('npm.cmd', ...)` requires `shell: true` (CVE-2024-27980). Without it: EINVAL on every npm invocation. Fix: conditional `shell: isWindows`.
  2. Post-commit clean-tree check failed because lock file at `cortex/journal/<slug>/.lock` showed up as untracked → `POST_VERIFY_DIRTY` false-positive. Fix: pre-flight + post-verify both filter Hermes's own runtime artifacts (`cortex/journal/`).
  3. Same filter needed in pre-flight too — test setup pre-creates lock file (to test collision) which was being treated as untracked-user-file, blocking on `DIRTY_TREE` before lock acquire could detect collision.

- **What's autonomous TODAY (post-Sprint-1.6.11):**
  ```bash
  # Mock-engine end-to-end execute (real git commits in temp repo):
  cortex-steward dry-run --slug=hermes-dryrun --json > /tmp/plan.json
  HERMES_ENGINE=mock HERMES_MOCK_PLAN='{"edits":[...]}' \
    cortex-steward execute --plan-file=/tmp/plan.json
  # → real branch checkout → real edit → real npm test gate → real commit
  ```
  This is L2 (Execution autonomy) **with a mock LLM**. Real LLM = swap 1 file (`action-engine.cjs` claude-sdk stub) when Dave decides on zero-deps.

- **Pre-launch tier gates:** all 3 still ✓ (Tier 6+7+8). v0 + v0.5a complete.

- **Why:** Dave's "pojdme to dotáhnout celé do finishe, ať to máme nadupané" — closes the v0.5 architecture surface entirely so v0.5b is no-architectural-change. The mock engine path is dogfood-able today (no API keys), proves the full loop works (verify gate, commit semantics, rollback paths), generates real journal entries.

- **Migrate:** none — additive.

- **Rollback:** revert this sprint's commit; previous v0.5-stub state preserved.

- **What's next (per RFC roadmap):**
  - **v0.5b** = `bin/steward/_lib/action-engine.cjs` `claudeSdkEngine` stub → real `@anthropic-ai/claude-agent-sdk` call. ~1 file changed substantively, ~1 dep added. Requires Dave's zero-deps decision.
  - **v1** = Enable `.github/workflows/steward.yml` (uncomment schedule + add `ANTHROPIC_API_KEY` secret).
  - **D-1** = git history PII purge (destructive force-push, Dave-only) before v0.1.0 tag.

### Sprint 1.6.10 — v0.5 seam stub + execute subcommand + user guide (2026-05-07 final)

#### Non-breaking (additive)

- **What landed:** three deliverables wrapping up Hermes v0 day-end:

  1. **`bin/steward/execute.cjs`** (NEW, ~140 LOC) — the v0.5 LLM seam, intentionally a stub. Returns `{ ok: false, code: 'V05_NOT_IMPLEMENTED' }` and exits 64 (`EX_USAGE`). Validates plan-file shape (5 error codes: MISSING_PLAN_FILE, PLAN_FILE_NOT_FOUND, PLAN_PARSE_ERROR, PLAN_INVALID, PLAN_INCOMPLETE), runs halt-check first, journals an `execute_not_implemented` entry so observability shows Hermes was invoked but didn't act. Why ship a stub: locks the CLI surface (`cortex-steward execute --plan-file=...`) so the v0.5 PR is a clean SDK-integration patch instead of architectural change; documents the seam visibly so Dave reviews the boundary BEFORE deciding on the `@anthropic-ai/claude-agent-sdk` dependency that crosses zero-deps; lets `.github/workflows/steward.example.yml` reference the execute step today. 11 unit tests covering plan validation, halt detection, journal contract, CLI exit codes.

  2. **`execute` subcommand wired into `bin/cortex-steward.cjs`** dispatcher. `cortex-steward execute --plan-file=...` now reachable; `cli-dispatch.test.cjs` extended with one test asserting reachability.

  3. **`docs/steward-usage.md`** (NEW, ~250 LOC) — the user guide. Defines the **4-level autonomy ladder** (L1 Planning ✅ shipped / L2 Execution ⏳ v0.5 / L3 Triggers ⏳ v1 / L4 Recommendations ⏳ Phase 5 + v1) + hardcoded NEVER autonomous (auto-merge, MUST-H6). Concrete commands for L1 dogfood, L2 preview walkthrough, L3 setup, troubleshooting (MISSING_RECOMMENDATIONS, LOCK_HELD, SLUG_MISMATCH, HALTED), file-by-file reference table.

- **Full suite:** 408 → 420 tests (+12 from execute.test.cjs).
- **`npm run test:hermes`:** 132 tests in ~700ms.

- **Why:** Dave's "dodělej vše co je potřeba" + "můj otázka: může být Hermes autonomní?" — the user guide's autonomy ladder answers the autonomy question with concrete L1-L4 levels + explicit NEVER (auto-merge); the execute stub is the architectural commitment that L2 is one-PR away (not a refactor); the dispatcher wiring closes the CLI surface.

- **Migrate:** none — additive.

- **Rollback:** revert this commit; Sprint 1.6.9 stays intact.

- **Final v0 state:** all 3 pre-launch tier gates closed (Tier 6+7+8). All 5 pre-Hermes RFC gates closed. Hermes v0 ships L1 (Planning autonomy) end-to-end. v0.5 (L2) = 1 PR. v1 (L3) = workflow uncomment + secret. L4 = Phase 5 cortex-evolve runtime wiring (separate milestone).

### Sprint 1.6.9 — Dogfood + GitHub Actions pivot + PII helper + Tier 8 (2026-05-07 closing)

#### Non-breaking (additive)

- **What landed:** five deliverables in one autonomous run, +24 tests (384 → 408 full suite, 364 → 388 test:fast).

  1. **`cortex/recommendations.md`** for cortex-x itself. Six DO-* items (3 week + 3 sprint) derived from external review + Sprint 1.6.7-1.6.8 architectural decisions. cortex-x is now Hermes-targetable.

  2. **First successful Hermes dry-run on the real cortex-x repo.** `node bin/cortex-steward.cjs dry-run --slug=cortex-x --json` picked DO-this-week #1 ("Pivot v1 trigger to GitHub Actions"), generated branch name `hermes/2026-05-07-pivot-v1-trigger-model-from-crontab-to-g-bz83`, emitted Conventional-Commits-shaped commit message with valid Git trailers, journaled the run. Dogfood proved the v0 plumbing works on a non-fixture project.

  3. **v1 trigger model pivoted from local crontab to GitHub Actions** (commit message body of the planned commit became this commit's body — manual Hermes mode).
     - `docs/steward-runtime.md` § 1.2 expanded to v0a (local crontab, cortex-x dogfood only) + v0b (GitHub Actions cron, production projects) + rationale + reference workflow + when-to-self-host-runner.
     - `docs/steward-rfc.md` "Architecture sketch" §2 trigger model rewritten to lead with GitHub Actions.
     - `.github/workflows/steward.example.yml` (NEW, ~85 LOC) — disabled-by-default reference workflow with `concurrency:` group for mutex-by-repo, `permissions:` for contents+PR write, `actions/checkout@v5` + `actions/setup-node@v5` + `npm ci` + `bin/cortex-steward.cjs dry-run`, journal artifact upload, commented-out v0.5 Claude Agent SDK + PR creation steps.

  4. **Self-referential PII helper** (`tools/lib/denylist-examples.cjs` + 12 tests). Single-line opt-out marker `<!-- denylist-example -->` — any line containing the marker is excluded from PII scan. All 3 verifiers (verify-prompts, verify-skills, verify-standards) now strip marker-bearing lines before applying the PII denylist regex. Closes the recurring self-bug pattern caught 3 times this week (Tier 5 fixture README, Tier 7 ship-ready.md, cortex-doctor §13.7 — each documented a denylist by quoting forbidden strings, regex caught them). Markers preserve line numbers for error messages by replacing matched lines with empty strings rather than removing them.

  5. **Tier 8 — agentskills.io v1 spec extensions** (`tools/verify-skills.cjs` extended + `tests/contract/skill-extensions.test.cjs` 12 tests). Four Anthropic Claude Code extensions validated when present:
     - `allowed-tools:` — inline array `[Bash, Edit]` or block-list (dash-prefixed) format; empty arrays warn
     - `disable-model-invocation:` — must be `true` or `false`
     - `model:` — kebab-case identifier ≤80 chars (e.g. `claude-sonnet-4-6`)
     - `license:` — short SPDX-ish identifier (1-100 chars)
     - `metadata:` — already validated as nested object; tightened
     Real `start/SKILL.md` (Anthropic-style with `disable-model-invocation: false`) now shows up in verify output as a passing check.

- **Bug caught by tests during implementation:** Tier 8 first regex used `\s*` for the gap between `:` and value, which matches newlines. So `allowed-tools:\n  - Bash` got parsed with `val = '- Bash'` instead of empty (which would trigger dash-list-block parsing). Fix: use `[ \t]*` (horizontal whitespace only) for the inline-value gap. Caught by the contract test specifically for dash-list format — would have shipped silently otherwise.

- **npm scripts:** none added (all run via existing `npm test`, `test:fast`, `test:standards`, `test:bin`).

- **Pre-launch tier gates:** Tier 6 ✓ · Tier 7 ✓ · Tier 8 ✓. **All three pre-launch tier gates closed.** Remaining ship-blockers: D-1 (PII purge, Dave-only) + v0.5 (Claude Agent SDK, zero-deps decision pending).

- **Why:** Dave's "udělej nejlepší postup verzi" mandate post-isolation discussion. Combined the dogfood validation + the architectural decision (GitHub Actions for production) + the meta-fix for the 3-times-bitten PII pattern + the last pre-launch tier into one coherent sprint. Manual Hermes mode (Claude played the LLM seam) actually executed DO-this-week item #1 from the new recommendations.md.

- **Migrate:** none — additive. Existing installs unaffected. `.github/workflows/steward.example.yml` is disabled (no `schedule:` block) until v0.5 ships.

- **Rollback:** revert this sprint's commit. The five deliverables form one logical unit.

### Sprint 1.6.8 — Unified Hermes CLI + Tier 6 + Tier 7 (2026-05-07 late night)

#### Non-breaking (additive — no migration required)

- **What landed:** three additive deliverables across one autonomous run:
  - **`bin/cortex-steward.cjs`** — unified entrypoint that dispatches `dry-run` and `status` subcommands to existing `bin/steward/<sub>.cjs` scripts. Single CLI surface for users; underlying scripts remain individually invocable. `cortex-steward help` and `cortex-steward --version` both implemented. 10 contract tests in `tests/unit/steward/cli-dispatch.test.cjs`.
  - **Tier 6 — bin/ tools contract tests** (`tests/contract/bin-tools-shape.test.cjs`, 13 tests). Black-box invocations of `cortex-bootstrap` (env-driven mode-new/existing/framework, marker-file shape, marker-overwrite, invalid-mode exit-2, non-interactive exit-2) + `cortex-gap-report` (graceful empty-log, --json schema, --help, --since filter, seeded-aggregate, --raw output). Closes one of the three pre-launch gates.
  - **Tier 7 — standards link integrity** (`tools/verify-standards.cjs` + `tests/contract/standards-shape.test.cjs`, 13 tests). Validator scans every `standards/*.md` for: file exists + non-empty, internal markdown link resolution (relative-to-file OR repo-root), code-fence balance, PII denylist (matcher matches the maintainer's local path + personal email). First run surfaced **3 real issues** in `standards/ship-ready.md`: 2 broken links to `research/beta-distribution-2026-04-17.md` (file moved to `$CORTEX_DATA_HOME/research/` per Sprint 1.6 XDG separation but standards/ kept the stale ../research/ relative link) + 1 PII self-reference (the file mentioned `davidrajnoha@` in a "what NOT to commit" example, which itself matched the denylist). All 3 fixed in this sprint. Tier 7 closes the second of the three pre-launch gates.
  - `prompts/cortex-doctor.md` gets new §13.7 "Standards link integrity" between §13.6 (prompt + SKILL.md regression) and §14 (citation drift). The three §13.x sections now form a complete structural-validation triad: §13.5 audit deliverables, §13.6 prompts + skills, §13.7 standards.
  - `tests/smoke/verify-install.cjs` extended to require `tools/verify-standards.cjs` as a warning-severity check (mirrors verify-prompts + verify-skills install verification).

- **npm scripts added:**
  - `npm run hermes` — passthrough to `bin/cortex-steward.cjs`
  - `npm run hermes:status` — passthrough to `bin/steward/status.cjs`
  - `npm run test:standards` — Tier 7 contract tests only
  - `npm run test:bin` — Tier 6 contract tests only
  - `npm run verify:standards` — direct invocation of `tools/verify-standards.cjs`

- **Self-bug-catching pattern repeated for the third time this week.** First run of `verify-prompts.cjs` after wiring §13.7 into `cortex-doctor.md` failed because the new section listed `davidrajnoha@` and `c:/Users/david/` as denylist examples — same regex caught the documentation. Same pattern as Tier 5 in fixture README and Tier 7 in `ship-ready.md`. Fixed by switching the prompt language to "the maintainer's personal email" and "local-machine path under `c:/Users/<name>/`". The pattern itself ("validators that document their denylist by quoting forbidden strings") may deserve a generic helper in v0.5+ — current fix is per-file.

- **Test count:** 348 → 384 (+36 across 3 contract test files). Full suite ~9s, test:fast ~1.6s.

- **Pre-launch tier gates:** Tier 6 ✓ (bin/ tools), Tier 7 ✓ (standards), Tier 8 (full agentskills.io spec coverage with Anthropic extensions) remains.

- **Why:** review (2026-05-07) flagged "v0.1.0 launch readiness" as the post-Hermes priority. Tier 6 + 7 are the lowest-effort, highest-leverage of the remaining pre-launch tiers — both are pure plumbing, zero-deps, and Tier 7 immediately surfaced 3 real issues.

- **Migrate:** none — purely additive.

- **Rollback:** revert this sprint's commit. The validator + tests + cortex-doctor edit + ship-ready.md fixes form one logical unit.

### Sprint 1.6.7 — Hermes v0 primitives + dry-run orchestrator (2026-05-07 night)

#### Non-breaking (additive — no migration required)

- **What landed:** Hermes runtime v0 minus the Claude Agent SDK call. Six zero-dep CJS primitives in `bin/steward/_lib/` + one orchestrator at `bin/steward/dry-run.cjs` + 6 unit-test files (95 unit tests) + 1 integration suite (16 fixture-driven tests). Total +111 tests; full suite 227 → 338 green.
  - **`bin/steward/_lib/halt-check.cjs`** — file-based kill switch detection (MUST-H5). Two sentinel paths checked at every tool-call boundary: `~/.cortex/HERMES_HALT` (fleet) and `<repo>/.cortex/HERMES_HALT` (per-project). CLI mode exits 75 (EX_TEMPFAIL) if halted. Fleet sentinel takes precedence when both present.
  - **`bin/steward/_lib/lock.cjs`** — per-project mutex (MUST-H2). Atomic acquire via `fs.writeFileSync({flag: 'wx'})` to `cortex/journal/<slug>/.lock`. Stale-lock recovery if mtime > 2× action timeout (default 30 min). EEXIST_FRESH error with held-by metadata when lock is fresh.
  - **`bin/steward/_lib/journal.cjs`** — append-only structured writer (MUST-H4). Manual schema validation (zero-dep equivalent of Zod) on every entry: ts/trigger/tier/event required, cost_usd/tokens optional with non-negative constraints, outcome/actor enum-validated. PII redaction at write time: homedir → `<HOME>`, sk-…/ghp_…/Bearer …/eyJ… all replaced with `<REDACTED>` tokens. Per-day JSONL files at `$CORTEX_DATA_HOME/journal/<slug>/<YYYY-MM-DD>.jsonl`.
  - **`bin/steward/_lib/recommendations.cjs`** — parser for `cortex/recommendations.md`. Extracts YAML frontmatter (slug required), parses `## DO this week (cited)` and `## DO this sprint (cited)` sections, extracts numbered action items (`### N. Title`) with [audit:] / [src:] citations. `pickNextAction()` returns first DO-this-week item not yet present in journal-derived processed-actions set.
  - **`bin/steward/_lib/git-trailers.cjs`** — Conventional Commits + Git trailer builder (MUST-H3). ULID generator (zero-dep, monotonic), subject validation (≤72 chars, valid type), trailer validation (required keys present, no newlines in values), `parseTrailers()` round-trip-safe parser that mirrors `git interpret-trailers --parse` for cases we care about.
  - **`bin/steward/_lib/policy-check.cjs`** — Hermes Ring 1 denylist (over `block-destructive.cjs` Ring 2). 9 rules: HERMES_HALT preservation, human_only path protection (standards/, prompts/, profiles/, agents/, CLAUDE.md, README.md, module.yaml), auto-merge prevention (`gh pr merge`, `git merge main`), prod-mutation prevention (vercel deploy --prod, supabase db push --linked, kubectl prod), force-push + hard-reset (also caught by block-destructive.cjs at Ring 2). Tool-aware check separates Edit/Write/MultiEdit (file_path argument) from Bash (free-text command).
  - **`bin/steward/dry-run.cjs`** — orchestrator that wires all six primitives end-to-end. CLI invocation: `node bin/steward/dry-run.cjs --slug=<slug> [--repo-root=<path>] [--trigger=cron|incident|pr-merged|manual] [--json]`. Library invocation: `runDryRun(opts)` returns the structured plan. Steps: halt check → lock acquire → recommendations parse → action pick (skip already-processed via journal) → build branch name (`hermes/<YYYY-MM-DD>-<slug>-<id>`) → build Conventional Commits + trailers commit message → policy pre-flight on action body → journal entry append → lock release. No Claude Agent SDK call; outputs WHAT Hermes would do, not the actual edits.

- **Tests landed:**
  - `tests/unit/steward/halt-check.test.cjs` — 7 tests (clean-state default, project sentinel, fleet sentinel + precedence, contract surfaces)
  - `tests/unit/steward/lock.test.cjs` — 9 tests (acquire/release, idempotent release, EEXIST_FRESH collision, multi-slug isolation, stale-lock recovery, fresh-lock-not-recovered, lock dir mkdir)
  - `tests/unit/steward/journal.test.cjs` — 21 tests (8 schema validations, 5 PII-redaction scenarios, 4 append+read, 2 append-only contract, 1 contract surface, 1 PII at write-not-read)
  - `tests/unit/steward/recommendations.test.cjs` — 14 tests (frontmatter parse, action item extraction, citations, full parse, slug-required, DO-this-week-required, action picker dedup, fixture integration)
  - `tests/unit/steward/git-trailers.test.cjs` — 19 tests (ULID, subject validation, trailer validation, buildSubject, buildCommitMessage end-to-end, parseTrailers round-trip, contract surfaces)
  - `tests/unit/steward/policy-check.test.cjs` — 25 tests (sentinel preservation, source-of-truth protection per path family, auto-merge prevention, prod-mutation prevention, git destructive ops, allow-paths, utilities)
  - `tests/integration/steward-dryrun.test.cjs` — 16 tests (happy path, dedupe across runs, halt + lock semantics, error paths, journal contract, CLI entry)

- **Bugs caught by tests during implementation:**
  - `parseTrailers` mishandled commit messages with trailing newlines (the canonical case — `git commit -F -` always trails) — fixed by stripping trailing empties before scanning, plus rewriting the algorithm to find the LAST blank line and walk forward instead of finding the first blank from end
  - `policy-check` HUMAN_ONLY_PATH/HUMAN_ONLY_TOPLEVEL regexes required `\b(write|edit|delete|rm)\b` BEFORE the path, but `flattenArgs` produced unpredictable arg-value order. Fix: introduce tool-aware `checkWriteTool()` that matches on `args.file_path` directly when toolName is Edit/Write/MultiEdit/NotebookEdit. Pattern-based regex layer kept for Bash command rules.

- **npm scripts added:**
  - `npm run test:hermes` — runs unit + integration tests for Hermes only (~110 tests in ~1s)
  - `npm run hermes:dry-run` — CLI passthrough to `bin/steward/dry-run.cjs`

- **Why:** Hermes RFC pre-merge checklist gate 5 ("First Hermes-driven PR auto-generated against a fixture project") needed to land before runtime code. Dry-run orchestrator IS the first deliverable: it produces a valid Conventional-Commits-shaped commit message with Git trailers, identifies the action to take, journals the run — every step EXCEPT the Claude Agent SDK call. The remaining LLM integration becomes a single seam to wire in v0.5.

- **Migrate:** none — purely additive. Existing installs unaffected.

- **Rollback:** revert this commit. The 6 primitives + dry-run orchestrator + 7 test files form one logical unit; revert removes them all together.

- **What's next (v0.5):** integrate Claude Agent SDK so the dry-run plan drives an actual `git commit -F -` + `gh pr create --draft`. The dry-run already produces a valid commit message; v0.5 wires the LLM-driven file edits + verification (`npm test`) gate. Estimated 4-8h, single session.

### Sprint 1.6.6 — README↔reality alignment + Hermes pre-work (2026-05-07)

#### Non-breaking (additive — no migration required)

- **What landed:** three commits closing the third pre-Hermes RFC gate:
  - **README/CLAUDE.md alignment** (commit `58857bf`) — external senior review flagged Phase 5 as overpromising ("✅ v1 done 2026-04-17" implied an automated runtime; reality is prompts + config + eval rubrics). Status calibrated to "✅ designed + specs / ⏳ runtime in Phase 7". Phase 7 — Hermes runtime added explicitly. Phase 1 marked ✅ shipped (Tier 0-5 QA infrastructure landed). Phase 2-4 marked ⚠️ partial with concrete what-ships-vs-what-defers. New "XDG separation (Sprint 1.6)" callout under repo structure explains the empty-looking `projects/` dir holds README only; actual project library entries live in `$CORTEX_DATA_HOME/projects/`.
  - **Hermes pre-work design pass** (commit `a4844c1`) — three parallel background research agents dispatched (topology, triggers/safety, git workflow), each returned 800-1200 word brief grounded in production-agent precedent (Devin, Sweep, Copilot, Aider, Cline, Cognition essay, Anthropic SDK docs, OWASP LLM10, Temporal mutex). Three new files: `docs/steward-research-synthesis.md` (decisions taken — 11-row table per architectural concern, 9 RFC open questions answered), `standards/steward-policy.md` (Tier 2 — 7 hardcoded refusals + 7 Hermes-specific MUST patterns + denylist + cost ceilings + 4-tier escalation), `docs/steward-runtime.md` (5 components + 4 ASCII sequence flows + v0 explicit non-scope). Three architectural pivots from RFC stub: (1) `hermes/<date>` daily-rolling → `hermes/<YYYY-MM-DD>-<slug>-<id>` branch-per-action (matches Devin/Sweep/Copilot precedent); (2) free-text journal lookup → Git trailers (`Hermes-Action-Id`, `Hermes-Journal-Entry`, `Hermes-Trigger`, `Hermes-Reverts` parseable via `git interpret-trailers`); (3) vague safety layer → file-based poison pill at `~/.cortex/HERMES_HALT` + `<repo>/.cortex/HERMES_HALT`. RFC checklist updated: 4 of 5 gates closed (fixture remains).
  - **hermes-dryrun fixture + 18-test contract** (commit `9fc3a5b`) — `tests/fixtures/steward-dryrun/` shipped: README, CLAUDE.md, package.json, src/index.js, tests/smoke.test.cjs, cortex/recommendations.md (frontmatter + ## DO this week section with 3 trivial action items + citation markers). New contract test `tests/contract/steward-fixture-shape.test.cjs` with 18 assertions across 5 describe blocks (structural shape, recommendations.md parseable contract, PII + env safety, package.json hygiene, smoke-test sanity). First run caught a self-bug: README documented "no davidrajnoha@" as PII example, which itself matched the PII regex — fixed by switching to generic phrasing. Suite: 207 → 227 tests, all green; test:fast 197 → 217 tests in ~1.6s.

- **Why:** external review (2026-05-07) ranked README↔reality alignment as the #1 next move; honest status is also a prerequisite to Hermes runtime work (you can't tell users "Hermes runs Phase 5 cron" if Phase 5 is ⏳ pending). Hermes pre-work: per RFC, both `standards/steward-policy.md` + `docs/steward-runtime.md` had to land before any runtime code merges. Fixture: per RFC checklist gate 5, "First Hermes-driven PR auto-generated against a fixture project" needs the fixture to exist first.

- **Migrate:** none — purely additive. Existing installs unaffected.

- **Rollback:** revert commits `9fc3a5b` `a4844c1` `58857bf` (in any order — they don't depend on each other).

- **Pre-Hermes RFC checklist (per `docs/steward-rfc.md`):**
  - [x] Tier 4 hook contract (Sprint 1.6.5)
  - [x] Tier 5 prompt + SKILL.md regression (Sprint 1.6.5)
  - [x] hermes-policy.md drafted (this sprint, commit `a4844c1`)
  - [x] hermes-runtime.md design doc (this sprint, commit `a4844c1`)
  - [x] First Hermes-driven PR fixture (this sprint, commit `9fc3a5b`)

  All five gates green. **Hermes runtime implementation can land in next session(s).**

### Sprint 1.6.5 — QA infrastructure (Tier 0-3, 2026-05-07)

#### Non-breaking (additive — no migration required for existing installs)

- **What landed:** cortex-x own QA infrastructure across 4 commits (Tier 0-3 of an 8-tier architecture):
  - **Tier 0** (commit `a5a5f57`) — `node --test` foundation, `tests/` layout, `c8` coverage, helpers (`fixture-utils.cjs`, `run-detector.cjs`, `snapshot-helpers.cjs`), `tools/lib/resolve-cortex-home.cjs` (SSOT extracted from `session-start.cjs`)
  - **Tier 1** (commit `3d7980a`) — `tests/smoke/verify-install.cjs` (single source of truth for "is install correct"). `install.sh` + `install.ps1` refactored to delegate (~70 LOC of duplicate verification deleted). `.github/workflows/install-smoke.yml` 5-lane matrix (ubuntu/macos bash + windows gitbash/pwsh7/ps5.1). `tests/integration/install-roundtrip.test.cjs` (idempotent re-install + backup rotation).
  - **Tier 2** (commit `a067a53`) — 50 schema-invariant tests across 10 profile YAMLs, 11 real-shape fixtures (10 profiles + monorepo-edge), 3 stage fixtures (greenfield 0c, prototype 30c, mvp 100c), detect-profile/stage/sister-env tests (71/71 pass). Caught and fixed 2 production bugs in same commit:
    - `parseProfileYaml` init-mismatch (`{}` vs `[]` for files/config_files/negative_signals) — meant `browser-agent.yaml` was silently dropped from candidates since it shipped 2026-04-20 (17 days)
    - `tauri-desktop.yaml` had `files:` containing config-file paths — meant the profile would never match a real Tauri project in production
  - **Tier 3** (commit `e20ffb9`) — `tools/verify-audit-output.cjs` (zero-dep CLI, 10 structural checks, plain/JSON/TAP modes, exit 0/1/2). 5 audit fixtures (good + 4 bad cases). 9 validator tests. `cortex-doctor.md` §13.5 wired to invoke validator. `install.{sh,ps1}` extended to copy `tools/` → `~/.claude/shared/tools/`.
  - **CI fix-up** (commit `702c926`) — first push-to-origin run revealed 3 environment-specific bugs the local suite couldn't catch: (1) `setup-node@v5 cache:'npm'` requires lockfile we don't commit → drop cache option; (2) `./install.sh` failed with "Permission denied" on macos-15-arm64 because `actions/checkout@v5` doesn't preserve +x bit → use `bash install.sh` (and `pwsh -File`/`powershell.exe -File` for Windows lanes); (3) `install.ps1`'s `Set-Content -Encoding UTF8` emitted a UTF-8 BOM that made `^cortex_source:` regex fail on PS 5.1 → use `[System.IO.File]::WriteAllText` with `UTF8Encoding($false)` + defensive `readYamlBomSafe` helper in 3 consumers (resolve-cortex-home, verify-install, session-start).
  - **CI fix-up #2** (commit `f57623e`) — `npm run test:fast` was passing `tests/unit tests/contract` as positional dir args to `node --test`, which the runner reports as failed test units regardless of contents. Fix: use `--test-skip-pattern='install\.sh roundtrip'` to exclude integration test by describe-name; let auto-discovery handle the rest.
  - **Tier 4** (commit `2766fce`) — hook contract suite. 92 unit tests + 35 contract tests, 183/183 green. Validators per hook: block-destructive (28 tests across rm/git/db destructive ops + fail-open + allow-cases), session-start (7 tests on output schema + sprint detection + $CORTEX_DATA_HOME override + PII guard), auto-orchestrate (16 tests on triggers + skip patterns + fail-open + budget-disabled), pre-compact (6 tests on state-snapshot write + sprint extraction + idempotency). Plus generic hook-shape contract running across all 7 hooks (5s timeout enforcement, no-PII-leak, fail-open on malformed JSON, critical-hook-present hard list). verify-install.cjs extended to require pre-compact, auto-orchestrate, pre-tool-use, post-tool-use as blocker-severity (was just session-start + block-destructive).
  - **CI fix-up #3 + T4 strengthening** (commit `7a067e1`) — first Tier 4 push surfaced that `node --test` default discovery picks up `scripts/test-all-detectors.cjs` and `scripts/test-all-profiles.cjs` because their filenames match the `**/test-*.cjs` glob. They are dev utilities, not tests. Renamed to `regression-*.cjs`. Same commit strengthens 3 hook tests per a self-audit (Dave: "jsou ty testy kvalitní, nebo na oko?"): session-start asserts both sprint name AND story id (was either-or), guards against `{{...}}` template-placeholder leaks; auto-orchestrate adds 3 content-quality assertions (research-cache state surfaced, decision tree present, no `undefined`/`{{...}}` in output); pre-compact adds 3 resilience tests (malformed PROGRESS.md, 10k-line stress, ASCII-only state file).
  - **Tier 5** (commit `a70bdd8`) — prompt + SKILL.md regression suite. tools/verify-prompts.cjs (zero-dep, 280 LOC, 8 invariants per prompt: phase contiguity, link resolution, agent/standards refs, fence balance, PII guard) + tools/verify-skills.cjs (agentskills.io v1 spec — name kebab-case + matches dir, description ≥30 chars, body non-empty, PII guard). 17 contract tests across both validators (10 prompt-shape + 8 skill-shape including hidden inventory tests). Surfaced 5 real warnings on first run, all fixed in same commit (4 `../path/foo.md` links converted to repo-root-relative + 1 broken `agentic-security.md` reference repointed to `security.md` § Agentic Security). cortex-doctor.md gets new §13.6 wiring both validators into the doctor flow. verify-install.cjs adds 2 soft checks for the new tools/ files. Local suite: 207/207 pass on Win native Node 25.0.0 in ~8s.

- **Why:** field tests #4–#8 surfaced regression clusters across install, detection, and audit-output paths. Manual field testing as primary QA doesn't scale beyond ~10 tests/week. Tier 0-3 closes the three highest-impact failure surfaces (install, detector, audit output) before Hermes runtime layer lands. Tier 4-5 (hooks + prompts) are pre-Hermes hard gates; Tier 6-8 are pre-launch gates.

- **Migrate:** none — purely additive. Existing installs gain `~/.claude/shared/tools/` on next install run; old installs continue working without it (validator checks are warning-severity in `verify-install.cjs` for backward compat).

- **Rollback:** revert commits `e20ffb9` `a067a53` `3d7980a` `a5a5f57`. Inline verification block in `install.{sh,ps1}` is preserved in pre-Tier-1 git history.

#### Deprecated

- **Inline 70-LOC verification block in `install.sh` + `install.ps1`** — removed in Tier 1, replaced with single-line `node verify-install.cjs` delegation. SSOT now in `tests/smoke/verify-install.cjs`. Anyone who copy-pasted those blocks for their own forks: switch to invoking the verifier directly.

- **`detect-profile.cjs` `parseProfileYaml` `{}`-only init** — pre-Tier-2 form silently failed on `config_files:` / `negative_signals:` blocks (TypeError caught + swallowed by load-time fail-open). Post-Tier-2 it discriminates by subsection name. Profile YAML authors no longer need to avoid `config_files:` — it now works.

#### Coverage thresholds

Coverage is informational at Sprint 1.6.5. The plan ("measure first, ratchet later" per `standards/testing.md`) is to wait 2-3 sprints for a baseline, then ratchet thresholds upward. Don't add hard gates to CI until Tier 4+5 land.

### Sprint 1.6 — `$CORTEX_DATA_HOME` separation (2026-05-06)

#### Breaking (for pre-Sprint-1.6 dev installs only — no released version yet)
- **What changed:** user-personal data dirs (`research/`, `projects/`, `insights/`, `journal/`, `evals/`) moved out of the cortex-x source repo into `$CORTEX_DATA_HOME` (default `~/.cortex/`). Path placeholders changed across all prompts/agents from `$CORTEX_HOME/<dir>/` to `$CORTEX_DATA_HOME/<dir>/`.
- **Why:** field test #5 (osvc-tax-helper, then test-phase-5) surfaced that mixing framework distribution with user data violates SoC. For other users post-public-flip the design breaks: `git status` permanently dirty, `git pull` conflicts with their own data, reinstall = data loss, multi-machine sync impossible. Fix: three independent path roots — `cortex_root` (source), `cortex_assets_root` (installed read-only), `cortex_data_home` (user read-write).
- **Migrate:**
  ```bash
  bash $CORTEX_HOME/install.sh         # creates ~/.cortex/{research,projects,insights/proposals,journal,evals}
  bash $CORTEX_HOME/bin/cortex-migrate-data.sh    # moves existing dirs
  # or on Windows:
  & "$Env:CORTEX_HOME\install.ps1"
  & "$Env:CORTEX_HOME\bin\cortex-migrate-data.ps1"
  ```
  Migration script is idempotent (safe to re-run), skips empty dirs, renames conflicts to `<file>.pre-sprint-1-6` instead of overwriting.
- **Verify:** `ls ~/.cortex/{research,projects}/` should contain previously-accumulated `*.md` files. `git status` in cortex-x source should show clean (or only your own dev changes).
- **Rollback:** `mv ~/.cortex/research/*.md $CORTEX_HOME/research/` (etc.) — but you'd then need to revert path placeholders in prompts/agents too.

#### Deprecated
- Legacy `~/cortex-x/projects/` fallback in `shared/hooks/session-start.cjs` — kept for one release cycle, removable after Sprint 1.7. Targets pre-Sprint-1.6 installs that haven't run the migration script.

---

_Released migrations land below this line at first `v*` tag._

---

## Pre-public-tag debt (MUST resolve before first `v*` tag on a public repo)

These items are **intentionally not fixed** in working-tree commits — they require one-time destructive git operations or signing infrastructure that needs separate approval.

### D-1. Git history purge (third-party PII + private project data)

**Status:** OPEN. Last review pipeline flagged as 🔴 Critical (security-auditor C1).

Commits before 2026-04-19 contain these files in blob history:
- `projects/relo.md` — **contains a third-party personal identifier** (real name + role; mapping held only in gitignored `scripts/sanitize-rules.json`, never in source-tree narrative docs) plus stakeholder counts + business context
- `projects/amd-hackathon-2026.md` — hackathon strategy, prize target, infrastructure plan
- `insights/2026-04-17-amd-retrofit-gaps.md` — framework meta-analysis with private project references
- `docs/framework-rfc.md` — original design doc citing private client repos (back-office-bot, custom-chatbot, kiosek-main)
- `research/amd-hackathon-2026-2026-04-17.md` — project-specific research cache
- `research/food-banner-builder-2026-04-17.md` — project-specific research cache

HEAD working tree is clean (all 6 are gitignored + `git rm --cached`-ed). But `git log -p` / `git show <old-commit>:projects/relo.md` on any clone reveals the content.

**Fix before first public `v*` tag:**

```bash
# Step 1: Backup
git branch main-pre-filter-backup

# Step 2: Purge (git-filter-repo recommended; git filter-branch deprecated but built-in)
git filter-branch --force --prune-empty --index-filter \
  'git rm --cached --ignore-unmatch \
     projects/relo.md \
     projects/amd-hackathon-2026.md \
     insights/2026-04-17-amd-retrofit-gaps.md \
     docs/framework-rfc.md \
     research/amd-hackathon-2026-2026-04-17.md \
     research/food-banner-builder-2026-04-17.md' \
  --tag-name-filter cat -- --all

# Step 3: Verify tree + hooks still work
node shared/hooks/_lib/redact.test.cjs

# Step 4: Force-push (destroys remote history — only safe because no external clones)
git push --force origin main

# Step 5: Tell any local clones to re-clone (if there are any) — their commits are now orphaned
```

**Why deferred:** history rewrite is one-way destructive. Repo is currently private, closed-beta, no external clones — so waiting doesn't increase blast radius. Must happen before the first invited tester clones OR before flipping the repo to public, whichever comes first.

### D-2. Signed-tag verification in install scripts

**Status:** OPEN. security-auditor M1 finding.

`install.sh` / `install.ps1` with `CORTEX_CHANNEL=stable` run `git checkout $LATEST_TAG` without `git tag -v`. If the maintainer's GitHub account is compromised (phish / stolen token / device theft), an attacker can push `v99.0.0` containing a malicious hook; every beta tester on stable pulls it on next install.

**Fix before first public `v*` tag:**
1. Generate GPG signing key, publish fingerprint in `SECURITY.md`
2. Sign all `v*` tags: `git tag -s v0.1.0 -m "..."`
3. Add to `install.sh` / `install.ps1` before `git checkout`:
   ```bash
   git tag -v "$LATEST" || { echo "ERROR: tag signature invalid"; exit 1; }
   ```

**Why deferred:** needs signing infrastructure + documented key rotation policy. v0.1 scope.

### D-4. Residual `~/cortex-x/` refs in source docs/prompts (non-user-facing)

**Status:** RESOLVED 2026-05-06. Mechanical rewrite via `scripts/fix-d4-paths.mjs` — 14 files, 55 lines, single commit "path convention normalized."

Path convention enforced:
- `~/.claude/shared/<subdir>/` — **installed read-only assets** (`prompts`, `standards`, `agents`, `profiles`, `templates`, `shared`, `skills`, `detectors`, `hooks`) after `install.sh`/`install.ps1`
- `$CORTEX_HOME/<subdir>/` — **live source dir** (`projects`, `insights`, `research`, `journal`, `evals`, `config`, `docs`)

Files rewritten: `README.md`, `projects/README.md`, `config/evolve.yaml`, `prompts/{sprint-status,cortex-sync,cortex-evolve,cortex-load,cortex-reflect,project-scan,retrospective,code-review,cortex-doctor}.md`, `evals/eval-001-scaffold-nextjs-saas.md`, `evals/README.md`.

Files intentionally NOT rewritten — they document the migration or contain legacy diagnostic mentions: `MIGRATIONS.md` (this file), `CHANGELOG.md`, `docs/public-launch-plan.md`, `evals/results/2026-05-01-01d9013-paper-baseline.json`, and the four lines in `prompts/cortex-doctor.md` that describe the legacy-broken-prefix detector (preserved by the script's `doctorPreserveLines` allow-list).

**Pre-resolution context:** original 2026-04-19 fix landed in `templates/CLAUDE.md.hbs`, `agents/cortex-thinker.md`, `agents/security-auditor.md`, `prompts/new-project.md`, partial `prompts/cortex-doctor.md`, `install.sh`, `install.ps1`. The 14 source files above were missed in that pass; without this rewrite, fresh-install users with no `~/cortex-x/` directory would have hit runtime path-resolution failures (e.g. cortex-sync trying to write `~/cortex-x/insights/`).

---

### D-3. Windows ACL on `.hook-errors.log`

**Status:** OPEN. security-auditor M3, documented as advisory.

`fs.writeFileSync(...mode: 0o600)` is a no-op on Windows. If cortex-x is cloned under a world-readable path (e.g., `C:\Users\Public\`, a shared OneDrive folder, network share), the error log inherits parent ACL which may be readable by other accounts on the host.

**Fix before first public `v*` tag:** add to `SECURITY.md`:

> **Windows users:** do not install cortex-x under `C:\Users\Public\` or any world-readable shared directory. `.hook-errors.log` mode 0o600 is honored only on Unix; on Windows it inherits the parent directory's ACL. Install under `$HOME` (typically `C:\Users\<you>\`) to keep error logs private.

Optional: detect + refuse install under problematic paths.
