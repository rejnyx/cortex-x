# Changelog

All notable changes to cortex-x. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

### Added (2026-05-09 evening — Sprint 2.9.7 + 2.9.7a + 2.9.7b property tests + bug fix)

**Sprint 2.9.7 (commit `dec9acf`)** — three coordinated tracks for "all-green cron":
- **Track 1**: 3 fresh LLM-able items in `cortex/recommendations.md` (TROUBLESHOOTING section append, JSDoc on `loadAllowedUserIds`, `CORTEX_TOOL_SPEC_VERSION` constant) — append-only edits well under spec-verifier shrink threshold.
- **Track 2**: Surgical exitCode=0 fix — `SPEC_VIOLATION` block-criterion failures (defense layer working as designed) + `STEWARD_AUTORESEARCH_ALL_CANDIDATES_FAILED` (ensemble defense) now return `exitCode:0` so cron dashboards don't false-fail. Result shape stays `ok:false + code:SPEC_VIOLATION` (existing test contract intact). Other SPEC_* codes (MALFORMED, PREDICATE_THREW, etc.) stay exit 1 — those indicate internal bugs, not defense doing its job.
- **Track 3**: 6 new cron workflow YAMLs for action_kinds without cron coverage (`steward-doc-drift`, `steward-test-coverage-gap`, `steward-pr-review-responder`, `steward-flaky-test-repair`, `steward-lint-fix`, `steward-tech-debt-audit`). Cron schedules staggered to avoid concurrent runs.

**Sprint 2.9.7a (commit `47cc2a7`)** — R2 hardening pass (3 reviewers in parallel: blind-hunter + security-auditor + edge-case-hunter):
- **R2 edge-case HIGH (NaN/Infinity exitCode)**: `typeof NaN === 'number'` passed naive guard; `process.exit(NaN)` coerces to 1, `process.exit(256)` wraps to 0. New helper `validExitCodeOrDefault(value, fallback)` enforces `Number.isInteger(x) && x >= 0 && x <= 255`. Both CLI exit + orchestrator propagation now route through it.
- **R2 security HIGH (qlty pipe-to-shell)**: `curl … | bash` from `qlty.sh` removed from `steward-tech-debt-audit.yml`. With `contents: write` + `pull-requests: write` permissions, a compromised qlty.sh could execute arbitrary code with full PR-write. Detector already fail-opens cleanly when qlty is missing (`status:'qlty-missing'` → `code:TECH_DEBT_QLTY_MISSING` → journal records skip). Operators install qlty manually if they want full audit.
- **R2 security MEDIUM (flaky_test_repair path allow-list)**: detector now restricts edits to `*.test.* / *.spec.* / __tests__/ / tests/ / test/` paths via `isTestFilePath()` predicate. Production source files with misplaced `HERMES-FLAKY` markers are simply skipped (operator error gets ignored, not amplified into a `.skip` on real test suites).
- Plus minor cleanups: cost-cap env on deterministic skip_commit workflows (shared-ledger gate against prior LLM spend), recommendations Item 7 wording clarification, unused import drop, `idx > 0` → `idx >= 0`.

**Sprint 2.9.7b (commit `2c8a290`)** — property-based test pass + bug fix:
- 78 new hand-rolled property tests (zero-deps, same pattern as Sprint 1.6.21):
  - annotation-routing 16-permutation exhaustive sweep
  - bash forbidden-pattern: 32 known-bad commands all detected; 24 known-safe commands (legitimate cleanup, mentions of dangerous patterns in strings) all NOT false-positive; idempotency
  - glob.globToRegex: literal match, single-star path-separator boundary, double-star recursive crossing, brace alternation recursive translate, question-mark single-char, 50 random patterns no-throw, malformed char-class surfaces typed `TOOL_GLOB_PATTERN_INVALID` at handler boundary
  - memory-decay: importance score non-negative + finite for 100 random items, decay floor prevents underflow on extremely old items (1970-era ts), impact ordering at equal age+freq, monotonicity in frequency, monotonicity in age, decayPass partition completeness
- **Real bug surfaced + fixed**: `bin/steward/_lib/memory-decay.cjs decayPass()` now actually enforces Sprint 2.8 R1 acceptance criterion "zero blocker lessons archived". Old behavior took bottom N% scored items irrespective of impact (could archive blockers if their score was low — e.g. very old + low frequency). New behavior: filter scored into nonBlockers + blockers; archive ONLY from nonBlockers pool capped at nonBlockers.length; blockers always kept.

**Sprint 2.7.1 R1 memo (autonomous evening session)** — `docs/research/sprint-2.7.1-pattern-transfer-llm-dispatch-2026-05-09.md`. Design for closing `pattern_transfer` `ACTION_KIND_NOT_DISPATCHABLE` gap (sibling-reader + LLM dispatch + assertEditWithinCwd hook + 3 acceptance criteria). Awaiting operator approval before implementation.

**Sprint 2.3 R1 memo (autonomous evening session)** — `docs/research/sprint-2.3-mutation-testing-fitness-2026-05-09.md`. Web-research-dispatch-backed (10 sources). Recommendation: StrykerJS 9.6 incremental mode + risk-tiered thresholds (80% `bin/steward/_lib`, 70% orchestrators, 75% `bin/cortex/tools`, 60% advisory `detectors/`). Companion fast-check property tests (already established pattern via Sprint 2.9.7b). Defer Meta ACH LLM mutation generation to Sprint 3.x. GHA quota burn flagged HIGH; mitigation = weekly nightly only OR self-hosted runner.

**OPERATOR_HANDOVER.md** — tomorrow-morning checklist for billing/quota fix + workflow re-trigger sequence.

**Tests**: 1349 → 1601 (+252 today total — 2026-05-09 marathon session: Sprint 2.9 + 2.9.0a + 2.9.6{a-e} + 2.9.7 + 2.9.7a + 2.9.7b + 4.7 rebrand + property tests + bug fix).

### Fixed (2026-05-09 — Sprint 2.9.6 dry-run dispatcher gap)

Pre-existing v0.7-era bug surfaced during the "turn on all crons" session
manual triggers: `bin/steward/dry-run.cjs` only handled `recommendation` and
`recommendation_harvest` kinds. Cron workflows for `todo_triage` (Sprint 1.8.7)
and `dep_update_patch` (Sprint 1.8.4) had been registered for months but never
ran successfully end-to-end — both fell through to the default LLM path and
failed with `OpenRouter response did not contain message content` or wasted
the daily cap by picking unrelated recommendations.

Fix: added `buildDeterministicPlan` helper + dispatch branches for all 9
deterministic kinds (`todo_triage`, `dep_update_patch`, `flaky_test_repair`,
`doc_drift`, `lint_fix_shipper`, `test_coverage_gap`, `pr_review_responder`,
`tech_debt_audit`, `pattern_transfer`). Each kind builds a synthetic plan
that the executor (`execute.cjs`) picks up + dispatches to its dedicated
runner; the runner re-detects against the live tree at execute-time for
atomic rollback semantics.

`pattern_transfer` is registered but its executor is `ACTION_KIND_NOT_DISPATCHABLE`
per Sprint 2.7.1; the new dispatcher mirrors that as `no_actionable_step` so
operators see the gap explicitly rather than getting surprise LLM costs.

Also: `recommendations.md` existence + parse + slug-check is now gated to
kinds that actually read it (only `recommendation` + `recommendation_harvest`).
Deterministic kinds run cleanly on bare repos without `cortex/recommendations.md`.

10 new unit tests in `tests/unit/steward/dry-run-dispatcher.test.cjs` lock
the fix in place. Tests: 1502 → 1512 (+10).

### Added (2026-05-09 — Sprint 2.9 Tools Foundation v0 ⭐ STRATEGIC)

Sprint 2.9 ships a portable, MCP-shaped tool descriptor format + 6 reference tools + 4 runtime adapters + annotation routing. Strategic interoperability moat: same descriptor runs in Steward, Claude Agent SDK, Vercel AI SDK, OpenAI Agents, and any MCP client (Cursor, Codex, Aider, Windsurf). Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) auto-wire into Sprint 1.9.0 spec-verifier + 1.9.1 cost windows + halt-check.

R1 memo: [`docs/research/sprint-2.9-tools-foundation-2026-05-09.md`](docs/research/sprint-2.9-tools-foundation-2026-05-09.md) — 14 sources cited, recommendation Option (b) neutral spec + adapters, MCP as the spec format (donated to Linux Foundation Dec 2025; Anthropic's own Claude Agent SDK already speaks MCP via `createSdkMcpServer`).

**Files added (`bin/cortex/tools/`)**:
- `_spec.md` — descriptor format + JSON Schema example + cross-runtime mapping table.
- `_lib/validate-descriptor.cjs` (~280 LoC) — strict validator with cross-checks: name regex, additionalProperties:false, $ref walker (no false-positives on enum values), AsyncFunction.constructor.name strict check, annotation consistency cross-check.
- `_lib/path-safety.cjs` (~150 LoC) — `isWithinCwd` (target + parent modes), `assertPathSafe`, NUL byte + UNC + Windows device-prefix rejection. SSOT for filesystem containment.
- `_lib/limits.cjs` — single source for MAX_FILE_BYTES, MAX_RESULTS, MAX_DEPTH, BASH_*, MCP_MAX_LINE_BYTES, GREP_PER_LINE_REGEX_DEADLINE_MS.
- `_lib/annotation-routing.cjs` (~120 LoC) — maps annotations to required safety gates (spec_verifier, halt_check, cost_windows, retry_safety).
- `read.cjs` / `write.cjs` / `edit.cjs` / `glob.cjs` / `grep.cjs` / `bash.cjs` — 6 reference tools borrowing Claude Code taxonomy in MCP-shaped descriptors.
- `_adapters/toMcpServer.cjs` (primary, stdio JSON-RPC) — protocolVersion 2025-11-25, full `tools/list` + `tools/call` + `initialize`, proto-pollution defense, 10 MiB buffer cap, JSON-RPC -32700 parse-error response, notifications get no response.
- `_adapters/toClaudeAgentSdk.cjs` — array for `createSdkMcpServer` + optional Claude Code capitalization (Read/Write/Edit/...).
- `_adapters/toOpenAiAgents.cjs` — `FunctionTool` POJOs with `strict_json_schema` default true.
- `_adapters/toVercelAiSdk.cjs` — JS stub (TS adapter with Zod re-wrap deferred to 2.9.5).
- `index.cjs` — palette + null-prototype `TOOL_BY_NAME` lookup + eager filename-match validation at module load.
- `templates/skills/example-using-cortex-tools.md` — operator-facing SKILL.md template.

**Tests added (`tests/unit/cortex-tools/`)**: 153 tests across 6 files (validator + tool handlers + adapter roundtrip + annotation routing + path-safety + Tier 5 catalog hash drift detector).

**Defense-in-depth surface (R2 hardening pass)**:
- TOCTOU symlink-swap defense in `write` + `edit` via POSIX `O_NOFOLLOW`.
- Bash forbidden-pattern REGEX list: rm -rf for `/{home,etc,usr,var,opt,root,boot,lib,sbin,bin,sys,proc}` + `/$` + `/*` + `$HOME` + `~`; disk-device writes to `> /dev/{sd*,nvme*,hd*,xvd*,vd*}`; pipe-to-shell across curl/wget/fetch → sh/bash/zsh/ksh/fish/python/ruby/perl/node; process substitution `bash <(curl)`; eval/source curl; halt with full trailing context; Windows `del /F /S /Q`, `format X: /Y`, `Remove-Item -Recurse -Force`.
- Bash env scrub switched from denylist (5 keys) to ALLOWLIST (PATH, HOME, USER, USERPROFILE, LANG, TZ, SHELL, TEMP, TMP, SystemRoot, COMSPEC + STEWARD_BASH_ENV_PASSTHROUGH).
- Bash output buffer = Buffer arrays sliced by bytes (UTF-8 multibyte truncation defense).
- Bash empty `STEWARD_BASH_ALLOWLIST` (after trim) FAIL-CLOSED instead of silent-disable.
- Bash spawn null-check stdout/stderr + sync-error handler.
- Bash `\s` Unicode whitespace + `/u` flag for NBSP/NNBSP/MMSP/IDEOGRAPHIC bypass defense.
- `read.cjs` magic-byte sniff for binary files (NUL byte in first 8 KiB → `TOOL_READ_BINARY`).
- `read.cjs` EOL detection (lf/crlf/mixed) for round-trip fidelity.
- `edit.cjs` non-overlapping count fix (`aa` in `aaaa` counts 2, not 3).
- `edit.cjs` shrink defense applied unconditionally (was inverted boolean — replace_all=true is MORE destructive, not less).
- `edit.cjs` directory-target rejection + `not-a-file` rejection.
- `write.cjs` directory-target rejection + parent-not-directory rejection.
- `glob.cjs` recursive alternative translation (`{*.cjs,*.js}` no longer crashes).
- `glob.cjs` Windows-friendly `dev:ino==0:0` path-key fallback.
- `grep.cjs` per-line regex deadline (50ms → ReDoS defense).
- `grep.cjs` count-mode `total_matches` accurate (was hardcoded 0).
- `grep.cjs` default-exclude `node_modules / .git / dist / build / .next / target / .venv / __pycache__ / ...` (opt-in via `include_noise=true`).
- `validate-descriptor.cjs` strict `AsyncFunction.constructor.name` check.
- `validate-descriptor.cjs` `$ref` walker (no JSON.stringify false-positive).
- `validate-descriptor.cjs` filename-match enforced via `index.cjs` `FILENAME_BY_TOOL` map.
- `toMcpServer.cjs` proto-pollution defense (`__proto__` / `constructor` / `prototype` keys rejected recursively + `Object.create(null)` for lookup).
- `toMcpServer.cjs` 10 MiB buffer cap → JSON-RPC `-32700` on overflow.
- `toMcpServer.cjs` JSON parse-error response (was stderr-only).
- `toMcpServer.cjs` notifications get no response per JSON-RPC spec.
- `toMcpServer.cjs` `additionalProperties: false` enforced when `properties` is empty.

**Out-of-v0-scope findings deferred** (acknowledged in roadmap entry):
- Pattern 2 architectural split (reader-only + writer-only MCP servers) — Sprint 4.0 marketplace.
- Pattern 5 HITL gate on raw MCP for destructive tools — Sprint 2.9.5.
- Pattern 1 `<untrusted>` markers around tool output — Sprint 2.9.5.
- Property-based tests (fast-check) — Sprint 2.3 / 2.9.5 territory.
- Stryker mutation testing config — Sprint 2.3 territory.
- Vercel AI SDK actual TS adapter with Zod re-wrap — Sprint 2.9.5.
- WebFetch + WebSearch tools — Sprint 2.9.5.
- Annotation-routing → action-engine integration — Sprint 2.9.5 (currently a contract module + tests verify it holds; Steward POV is dead code until 2.9.5 wires it).

**Tests**: 1349 → 1502 (+153). All 3 CI lanes green expected.

**R2 review pipeline (6 agents in parallel)** found 6 BLOCKER + 18 HIGH + 9 MEDIUM. All BLOCKERs and key HIGHs fixed in same-commit hardening pass; out-of-scope items documented above.

### Fixed (2026-05-09 — Hardening pass after retrospective R2 review of Sprints 2.6 / 2.7 / 2.8 + Opus 4.7 research)
Operator-requested hardening pass after the 5-sprint Tier-1-expansion run. Three retrospective R2 reviews + Opus 4.7 research dispatch surfaced findings that warranted same-day fixes rather than deferred 2.x.1 commits.

**Sprint 2.6.1 Discord bridge hardening** (R2 retro: 2 BLOCKER + 5 HIGH + 5 MAJOR; addressed BLOCKERs + HIGH-2/3/5 + MAJOR-1):
- **BLOCKER B1: HMAC token reuse defense.** `auth.cjs` now maintains a process-local `Map<actionId+token, expiresAt>` set with 6-minute TTL (4× HMAC window). Replay of an already-consumed `(actionId, token)` pair returns `false` even within the 90s+90s verify window. Test-only `_resetConsumedActionTokens` exposed for test isolation; `markConsumed: false` opt-out for read-only verification flows.
- **BLOCKER B2: `appendRecommendation` no-mkdir + symlink TOCTOU.** `commands.cjs defaultCtx` now `mkdirSync(cortexDir, { recursive: true })` before append (prevents ENOENT on first-ever `/recommend`) and `lstatSync` checks for symlinks (refuses with `DISCORD_RECOMMEND_SYMLINK_REFUSED` rather than following outside repoRoot).
- **HIGH H2: `crypto.randomBytes(8)` actionId** replaces `Math.random().toString(36)` (~30 bits → 128 bits entropy). Combined with B1 consumed-tokens Set, blocks actionId guessing attacks even if confirmation embeds leak.
- **HIGH H3: ephemeral mutation embeds.** All `/halt` / `/resume` / `/recommend` reply objects now `ephemeral: true` so token + reason text are operator-only — no leak to other guild members.
- **HIGH H5: SECRET ≥32 chars.** `HMAC_MIN_SECRET_LENGTH = 32` (was 16). Matches R1 spec ("32+ bytes recommended"). README's `openssl rand -hex 32` produces 64 chars so no operator setup breaks.
- **MAJOR M1: `!` prefix removed from Discord-side names.** Discord API spec rejects slash command names matching `!halt` (regex `[a-z0-9_-]{1,32}`). Renamed Discord-visible names to `halt` / `resume` / `recommend`; mutation flag now lives in `COMMAND_SPECS[].mutation` and `MUTATION_NAMES` Set rather than name-prefix inspection. Existing `isMutationCommand('!halt')` → `isMutationCommandName('halt')`.

**Sprint 2.7.1 pattern_transfer hardening** (R2 retro: 2 BLOCKER + 4 HIGH + 3 MAJOR; addressed BLOCKERs + HIGH-4):
- **BLOCKER B1: `pattern_transfer_no_cross_repo_edit` predicate UNC bypass.** Old predicate `!p.match(/^[A-Za-z]:/) && !p.startsWith("/")` accepted `\\server\share\file` (UNC paths — no leading `/`, no drive letter). New predicate splits on both `/` and `\\` separators, rejects `..` segments per-segment (not substring), rejects bare backslash (`\\`), and rejects UNC prefix (`\\\\`).
- **BLOCKER B2 + HIGH H4: dispatcher loud-fail.** `execute.cjs` now has `else if (plan.action_kind === 'pattern_transfer')` branch that returns `{ ok: false, code: 'ACTION_KIND_NOT_DISPATCHABLE' }` until Sprint 2.7.1 wires the LLM dispatch path. Without this, an operator dropping `cortex/sibling-projects.json` today would fall through to the default LLM branch with no sibling-reader gate. `assertEditWithinCwd` remains exposed as wired-but-dormant pending the dispatcher commit.

**Sprint 2.8.1 Memory Foundation hardening** (R2 retro: 0 BLOCKER + 5 HIGH + 4 MAJOR; addressed HIGH-1/3/5 + M4):
- **HIGH H1: Decay floor at 1e-12.** `memory-decay.cjs computeImportanceScore` previously had `Math.exp(-lambda * days)` underflow to 0 at age ≈ 14,300 days, losing relative ordering between blocker and advisory tiers (everything dropped to score 0 simultaneously, defeating `decayPass({thresholdScore: X})` retention logic). Floor at `Math.max(Math.exp(...), 1e-12)` keeps tier ordering visible across centuries while still ranking aged items below fresh ones. Test exercises ranking stability at 50,000-day age.
- **HIGH H3: Small-list archive policy.** `decayPass` previously archived `floor(items.length * 0.05)` = 0 items for any list under 20 entries (including the typical first-90-days ≤200/slug case). Now archives `Math.max(1, floor(...))` once `items.length >= minArchiveFloor` (default 10) — avoids "decay shock" where weeks 1-19 archive nothing then week 20 abruptly archives 1.
- **HIGH H5: SSOT impact classifier.** Two scattered regexes in `lessonFromExecuteResult` were missing every `CLAUDE_CLI_*`, `TECH_DEBT_*`, and `SIBLING_*` error code shipped in Sprints 2.4/2.5/2.7 — `TECH_DEBT_SNAPSHOT_CORRUPT` was classified as `advisory` instead of `blocker`. New `IMPACT_CLASSIFIER` frozen array (regex → impact) + `classifyImpact(code)` SSOT function covers 22 explicit code patterns. Adding a new code class is one freeze-list entry, no scattered regex drift.
- **M4: NaN-ts handling.** `ageDays` previously returned 0 for malformed `ts: 'garbage'` (silently treating corrupt journal entries as fresh). Now returns `Infinity` → score → 0 → archived. Distinguishes "missing field" (Sprint 1.8.3 backward compat, treat as fresh) from "corrupted journal".

**Anthropic Opus 4.7 hardening** (research dispatch 2026-05-09):
- New `bin/steward/_lib/action-engine.cjs buildOpenRouterRequestBody` strips `temperature`, `top_p`, `top_k`, and `thinking.budget_tokens` from the request body when the model matches `/opus-4-?7/i`. Per Anthropic platform docs (2026-04-16 release): Opus 4.7 returns 400 errors on these parameters. Defense-in-depth — Sprint 2.1 autoresearch sets temperature for diversity, but autoresearch is gated to `recommendation` kind which currently routes to Opus 4.6 in premium tier. The strip helper makes 4.7 routing safe for any future kind.
- Routing-table flip to Opus 4.7 in `recommendation.premium` / `pattern_transfer.premium` / `architecture_review.premium` deferred to Sprint 2.0c — operator-cost-validated canary first (Opus 4.7 has +10.9pp on SWE-bench Pro but +12-27% effective token cost via 35% tokenizer inflation).

**Roadmap markers updated**: ✅ SHIPPED tags on Sprints 2.4 / 2.5 / 2.6 / 2.7 / 2.8 with hardening-status callouts; original sprint memos retained below each marker for design-context preservation.

**Tests: 1337 → 1349 (+12 hardening tests).** All 3 CI lanes pending push.

### Added (2026-05-09 — Sprint 2.8: Memory Foundation v0 — decay primitive + lessons schema extension, ⭐ MEMORY GATE)
- **`bin/steward/_lib/memory-decay.cjs`** (zero-deps, ~150 LoC) — importance-weighted memory decay primitive replacing the Sprint 1.8.3 time-only "3-month unused → delete" rule:
  - Score formula per R1 §6: `U(item, t) = (w_freq × frequency + w_impact × impact) × e^(−λ × age_days)`
  - Default weights: `w_freq=1.0`, `w_impact=2.0` (impact dominates)
  - Half-lives: 30d advisory / 60d warning / 120d blocker (R1 §6 defensible defaults)
  - `computeImportanceScore(item, opts)` — pure function over `{ ts, impact, frequency }`
  - `decayPass(items, opts)` — sorts by score, archives bottom N (default 5%, configurable via `archiveBottomFraction` or absolute `thresholdScore`)
  - `archiveBucket(now)` → `YYYY-WNN` weekly key for archive grouping
  - `isBucketExpired(key, now, retentionWeeks=12)` — 12-week archive retention then hard-delete (R1 §7)
  - Pure logic; fs binding stays in lessons.cjs / journal.cjs callers.
- **`bin/steward/_lib/lessons.cjs` schema extension** (R1 §10):
  - `agent_id` field (default `'default'`) — forward-compat for per-agent memory split (Tier 2 Sprint 3.1 may revisit; for now everything is "default" agent).
  - `failure_origin` field — distinct provenance: `SPEC_VIOLATION:no_destructive_rewrite` for spec violations, `error_code:OPENROUTER_KEY_MISSING` for execute errors. Feeds retrieval-at-decision-time filtering.
  - `impact` field — `advisory` / `warning` / `blocker`, drives `memory-decay.cjs` half-life selection. Auto-derived in `lessonFromExecuteResult`:
    - `SPEC_VIOLATION` / `BILLING_LEAK` / `EDIT_DESTRUCTIVE` / `EDIT_DENYLISTED` / `FORBIDDEN_FLAG` → `blocker`
    - `AUTH_REJECTED` / `KEY_MISSING` / `KEY_MALFORMED` / `NOT_CONFIGURED` / `QUOTA_EXHAUSTED` → `warning`
    - All other transient/protocol-drift codes → `advisory`
  - `frequency` field (default `0`) — retrieval count for importance scoring (Sprint 2.8.1 will increment on every recall).
- **What's deferred to Sprint 2.8.1 (per R1 §13 + extracted from R2 implementation reality):**
  - Anthropic Memory Tool (`memory_20250818`) integration — required dedicated API surface work, defers until claude-cli engine (Sprint 2.4) Max-sub dogfood validates the auth model in production.
  - Retrieval-at-decision-time MaTTS pattern (R1 §5) — currently lessons load at boot; per-action pre-LLM retrieval with K=3 default + K=5 hard cap requires action-engine.cjs integration.
  - Weekly archive sweep cron — `decayPass` is the primitive but the scheduled invocation (operator's nightly cron + 12-week retention enforcement) wires in 2.8.1.
  - ReasoningBank failure-distillation LLM call — schema fields `impact` + `failure_origin` are in place; the actual LLM call (~$0.0002/op via cheap tier) that distills raw `spec_failures` into preventative principles is operator-cost-validated in 2.8.1.
- **Tests**: 30 unit tests covering halfLifeToLambda (NaN/zero/negative guards), impactValue, halfLifeForImpact, ageDays (negative + missing ts clamps), computeImportanceScore (blocker > advisory invariant, frequency boost, half-life decay validation at exact thresholds), scoreItems (no-mutation), decayPass (bottom-5% default + threshold variant + fraction clamping), archiveBucket, isBucketExpired (12-week default + custom retention), lessons schema extension end-to-end (agent_id default, lessonFromExecuteResult impact derivation by code class).
- **Manual verification**: blocker scoring at age=0 ≈ 2.0; advisory at age=30d ≈ 0.05 (1/2 of fresh advisory 0.1, confirms 30-day half-life); blocker at age=120d ≈ 1.0 (1/2 of fresh blocker 2.0, confirms 120-day half-life). `archiveBucket(2026-05-09)` → `2026-W19` (correct ISO-week-style numbering).

### Added (2026-05-09 — Sprint 2.7: pattern_transfer cross-project kind v0, ⭐ FEDERATION SEED)
- **New action_kind `pattern_transfer`** registered as 11th capability (LLM-driven, journal-only). Reads allowlisted sibling projects read-only via `cortex/sibling-projects.json`, distills cross-project patterns into the **current** project's `lessons-learned.jsonl`. **Never** edits sibling repos; spec-verifier guarantees touched files are within `cwd` only.
- **`bin/steward/_lib/sibling-manifest.cjs`** (zero-deps validator):
  - JSON schema (R1 §2 rejects YAML to preserve zero-deps invariant): `version: 1`, `siblings[]: { id (kebab-case), root, read_only: true, purpose, paths_allowed[], paths_denied[] }`.
  - Env expansion: `${HOME}` and `${USERPROFILE}` only — both resolve via `os.homedir()`. Other `${VAR}` references rejected (prevents `${PATH}` traversal).
  - Path normalization: forward-slash + lowercased drive letter on win32.
  - Duplicate-id detection at manifest level.
  - `read_only !== true` rejected (v1 enforces — write-capable siblings deferred forever).
- **`bin/steward/_lib/sibling-reader.cjs`** (zero-deps read facade):
  - `readSiblingFile(sib, relPath)` — allow-list prefix match → deny-list glob match (deny wins) → realpath containment → size cap (1 MB default) → returns content or distinct error code (`SIBLING_NOT_ALLOWLISTED`, `SIBLING_DENIED_PATH`, `SIBLING_REALPATH_OUTSIDE_ROOT`, `SIBLING_SYMLINK_LOOP`, `SIBLING_FILE_TOO_LARGE`, etc.).
  - `listSiblingFiles(sib)` — recursive walk capped at 5K files / depth 12; visited-inode set breaks symlink loops; `e.isSymbolicLink()` skip.
  - `assertEditWithinCwd(path, cwd)` — exposed for execute.cjs spec-verifier hook to enforce the "never edits sibling" invariant.
  - `matchesAnyGlob(relPath, patterns)` — hand-rolled glob matcher supporting `*`, `**`, trailing-slash subtree match, and bare-name match for patterns like `.env*` at any depth.
- **`pattern_transfer` action_kind acceptance criteria**:
  - `lessons_jsonl_grew_with_source_repo` (file_predicate): touched files include `cortex/lessons-learned.jsonl` and the file size ≥ prev size.
  - `pattern_transfer_no_cross_repo_edit` (file_predicate): touched files contain no `..` traversal, no absolute paths.
  - `pattern_transfer_journal_only_ears` (ears_text): WHEN pattern_transfer runs THE SYSTEM SHALL only append to current project lessons-learned.jsonl AND never edit any sibling project.
- **What's deferred to Sprint 2.7.1** (per R1 §13 backlog):
  - `detectors/pattern-transfer.cjs` (currently referenced in registry but not yet implemented; v1 detector is a no-op skip when manifest absent).
  - LLM dispatch in execute.cjs — operator must populate `cortex/sibling-projects.json` + sibling repos before this is dogfood-able. Hook will follow the existing routing-table model selection (Sprint 2.0b) + claude-cli engine (Sprint 2.4) for $0 marginal cost.
  - BM25 retrieval over filenames + first-line + sibling lessons (R1 §4 design); replaced in v0 by simple `listSiblingFiles` + per-file `readSiblingFile`.
  - `<untrusted_source>` delimiter rollout to all LLM action_kinds (Sprint 1.6.20 backlog item promoted by R1 §13).
  - Engine-version pin `>=22.16.1` in package.json (CVE-2025-55130 remediation).
  - TOCTOU `O_NOFOLLOW` last-segment hardening.
  - MCP transport seam research (defer to Sprint 3.x).
- **Tests**: 45 unit tests covering manifest validator (env expansion, kebab-case id, read_only enforcement, duplicate detection, JSON parse errors, schema rejection, env var allowlist) + sibling-reader (allow-list, deny-list precedence, realpath escape, traversal rejection, size cap, symlink loop, glob patterns) + registry presence.
- **Manual verification**: synthetic sibling fixture in `/tmp` exercised; readSiblingFile correctly rejects `secrets/api.key` via deny-list, `.env.local` via glob, traversal `src/../../../etc/passwd` via path validator, and a symlink to outside the sibling root via realpath containment.

### Added (2026-05-09 — Sprint 2.6: Discord remote-control bridge v0 alpha, sibling-folder pattern)
- **`bin/discord-bridge/` sibling folder** — Sprint 2.6 v0 alpha. Zero-deps Steward core (`bin/steward/_lib/*.cjs`) preserved; bridge has its own `package.json` with `discord.js` 14.x as the only top-level dep. Mirrors Sprint 4.8 dashboard sibling-repo pattern.
- **`auth.cjs`** (zero-deps, 100% testable) — 4-layer security per R1 §2:
  1. **Whitelist**: `STEWARD_DISCORD_ALLOWED_USER_IDS` snowflake-shape regex (`^\d{10,32}$`) — fail-closed (empty list = nobody allowed).
  2. **HMAC**: `crypto.createHmac` + `timingSafeEqual` against current + previous 90s window (replay protected). 8-hex-char display token; 32+ byte server secret.
  3. **Token rotation**: 90-day operator runbook in README.
  4. **Read-only by default**: `/!` prefix marks mutations explicitly via `isMutationCommand`.
- **`commands.cjs`** (zero-deps, fully testable) — 6 slash command handlers + dispatcher + `defaultCtx` factory:
  - `/status` — JSON summary of halt + last journal entry + cost ledger
  - `/forecast` — Sprint 1.9.1 cap forecast block
  - `/why <sha>` — render commit's journal entry as embed (validates SHA shape)
  - `/!halt <reason>` — write `STEWARD_HALT` (HMAC-confirmed two-step flow)
  - `/!resume` — clear `STEWARD_HALT` (HMAC-confirmed)
  - `/!recommend <text>` — append to `cortex/recommendations.md` (HMAC-confirmed)
  - All mutation handlers return `requiresHmac: true` on first call with displayable token; bridge dispatches second confirmation call.
- **`journal-tail.cjs`** (zero-deps, fully testable) — channel routing rules + NDJSON parser + tail-follower factory:
  - `routeJournalEvent(entry)` → 4-channel routing (`#steward-cost` / `#steward-research` / `#steward-failures` / `#steward-alerts`) per first-match-wins regex matching against `event` + `code` fields.
  - `parseNDJSON(content)` → resilient NDJSON parser (skips malformed lines silently).
  - `makeTailFollower(filePath, onEvent, opts)` → factory that wraps fs.statSync + readSync at offset for incremental tail; tests use injected `fs` for determinism.
- **`README.md`** — full operator setup guide (Discord bot creation, env config, NSSM Windows / systemd Linux supervision, slash command registration runbook).
- **What's deferred to Sprint 2.6.1** (per README "Sprint 2.6.1 roadmap" §):
  - `bridge.cjs` Gateway WebSocket wiring via discord.js (operator setup gated — needs bot token + guild ID).
  - E2E test against fixture Discord guild (manual).
  - Voice attachment dispatch → Whisper → recommendations (Sprint 4.3 link).
  - PATH-walk well-known-paths preference for `node` resolution.
  - Operator-tier opt-out signing (HMAC over `repoRoot + operator-secret`).
- **Tests**: 63 unit tests (auth + commands + journal-tail) — all zero-deps via `node:test`. discord.js itself NOT installed in this commit; operator runs `cd bin/discord-bridge && npm install` separately.
- **Manual verification**: `auth.generateActionToken('halt-test', { secret: 'a'.repeat(64) })` → 8-hex display token; `verifyActionToken` confirms in same + previous window. `routeJournalEvent` correctly maps cost / research / auth events to the right channels.
- **Why discord.js (not zero-deps WebSocket)**: R1 §1 evaluated zero-deps Gateway implementation — heartbeat + identify + zombie detection + resume + reconnect = ~400 LoC of fragile protocol code for a single-operator bridge. discord.js encapsulates all of that; sibling-folder isolation preserves the zero-deps invariant for **Steward core**, which is what the invariant actually covers.

### Added (2026-05-09 — Sprint 2.5: tech_debt_audit action_kind, deterministic 10th capability)
- **New action_kind `tech_debt_audit`** registered in `bin/steward/_lib/action-kinds.cjs` — deterministic, requires_llm=false, cost_envelope=free, blast_radius=minimal, shipped_in='0.3.0'. Runs nightly, snapshots code-health metrics to `cortex/debt-snapshot.json` (committed audit trail), computes drift triggers vs prior snapshot. v1 = snapshot-only (no PR opening); R1 §9 explicitly defers PR generation to v2 once operator action-rate is measured.
- **3-stage pipeline**: detector probe (`detectors/tech-debt-audit.cjs`) → snapshot capture (`bin/steward/_lib/tech-debt-audit.cjs`) → drift comparison (`bin/steward/_lib/snapshot-diff.cjs`).
- **Toolchain**: qlty (cognitive complexity, duplication, smells) + knip (unused exports/files/deps). Both shell-out via spawn; both fail-open on missing binary.
- **Fail-open semantics**: missing qlty → `{ ok: true, skipped: true, skipReason: 'QLTY_NOT_INSTALLED', code: 'TECH_DEBT_QLTY_MISSING' }`. Skipped runs do NOT count toward `STEWARD_FAILURE_BREAKER` consecutive-failure circuit or any cost cap.
- **Drift triggers (DEFAULT_TRIGGERS)**: `duplication_pct +2pp w/w`, `max_function_complexity > 15 absolute`, `knip_unused_exports +3 w/w`, `test_source_ratio -20% w/w`. Custom triggers supported via `computeSnapshotDrift(prev, curr, triggers)`.
- **Snapshot schema** (`snapshot_version: 1`): captured_at + qlty_path/version + knip_path/version + flat metrics object + top-10 offenders. Aggregate-only (not per-file) to keep git diffs readable. Per Sprint 3.0 forward-compat: schema versioned for AlphaEvolve fitness signal consumption.
- **`thresholdExceeded` advisory event**: when drift triggers fire, execute.cjs emits `tech_debt_threshold_exceeded` journal event with `code: TECH_DEBT_THRESHOLD_EXCEEDED` (advisory, never failure). Snapshot also surfaces `priorCorrupt: true` flag → `tech_debt_snapshot_corrupt` journal event when prior snapshot is malformed JSON or wrong version.
- **R2 hardening** (6-agent review pipeline → 2 BLOCKER + 3 HIGH + 11 MAJOR + many MINOR; 14 must-fix items applied):
  - **Acceptance BLOCKER**: dispatcher wire in `execute.cjs` (kind was registered but not callable).
  - **Acceptance BLOCKER + SSOT BLOCKER**: error codes reconciled per roadmap (`TECH_DEBT_QLTY_MISSING`, `TECH_DEBT_SNAPSHOT_CORRUPT`, `TECH_DEBT_THRESHOLD_EXCEEDED`).
  - **SSOT BLOCKER**: snapshot path drift in roadmap fixed (`.cortex/` → `cortex/` per R1 §2.4 commit-it decision).
  - **Security HIGH (CWE-200/526)**: `runCommand` now uses scrubbed env (`PATH`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `SystemRoot`, `LANG`, `LC_*`, `NODE_PATH/OPTIONS`) — prevents `OPENROUTER_API_KEY`, `ANTHROPIC_*`, `GITHUB_TOKEN` from leaking to qlty/knip subprocesses (knip in particular runs `knip.config.ts` with full `process.env` access).
  - **Security HIGH (CWE-770)**: 16 MB UTF-8 byte-length cap on subprocess stdout/stderr (mirror Sprint 2.4 pattern; multibyte-safe via `Buffer.byteLength`).
  - **Security HIGH (CWE-1325/674)**: `fallbackTestSourceRatio` hardened — `realpathSync`-tracked visited inodes break symlink loops; `isSymbolicLink()` skip; depth cap 20; file-count cap 20K; per-file 2 MB size cap; extended skip-list (`dist`, `build`, `coverage`, `out`, `.next`, `.cache`, `.turbo`, `target`).
  - **Correctness MAJOR**: `parseQltyMetrics` / `parseQltySmells` / `parseKnipReport` null-guard parsed root + `safeNonNegFinite` clamp (rejects NaN, Infinity, negative, non-number). Skips non-object rows in array.
  - **Correctness MINOR**: `runTechDebtAudit` validates `opts.now instanceof Date` before `.toISOString()`; prior-snapshot version check; `priorCorrupt` flag exposed to caller.
  - **Edge fix**: `probeBinary` rejects empty/non-string name; uses `statSync().isFile()` to prevent dir-as-binary match; on POSIX skips `.cmd`/`.exe` candidates.
  - **Edge fix**: `runCommand` clamps `timeoutMs` to `[1s, 10min]`, guards empty/NUL-byte cmd.
  - **Edge fix**: `isOptedOut` requires regular file (not directory or dangling symlink).
  - **Acceptance MAJOR**: 3 fixture-based integration tests added (drift end-to-end, priorCorrupt malformed, priorCorrupt wrong version).
  - **Edge fix**: `fallbackTestSourceRatio` regex broadened to `__tests__`, `spec`, `*.test.<ext>`, `*.spec.<ext>`.
- **Defer to Sprint 2.5.1 backlog**: PATH-hijack hardening (`STEWARD_QLTY_PATH` override), sentinel HMAC, `max_function_complexity` vs `max_file_complexity` decoupling (when qlty exposes per-function rows), `file_loc > 500` advisory trigger, knip CJS pre-flight scan, `repoRoot` path-traversal containment, journal `audit_opt_out_detected` event, semantic for negative `pct_drop` prev.
- **Tests**: 1187 → ~1199 (+12 R2 hardening + integration tests on top of original 23 = 35 total Sprint 2.5 tests). All 3 CI lanes pending push.
- **Manual verification**: `detectors/tech-debt-audit.cjs detect()` returns `qlty-missing` on operator's machine (qlty not installed) → executor's fail-open path triggers correctly with `code: TECH_DEBT_QLTY_MISSING`. `computeSnapshotDrift` exercised with prior+current pair: triggers fire as expected for duplication +2.2pp and max_function_complexity 18 vs threshold 15.

### Added (2026-05-09 — Sprint 2.4: Anthropic claude-cli engine via Max subscription, ⭐ COST PIVOT)
- **`claudeCliEngine` in `bin/steward/_lib/action-engine.cjs`** (~470 LoC including helpers + comments) — 4th LLM engine that spawns the local `claude -p` binary under the operator's Anthropic Max subscription OAuth token, driving marginal LLM cost to **$0** for all `recommendation`-class actions.
- **Three-layer billing-leak defense** to mitigate the GH `anthropics/claude-code#43333` / `#37686` ($1,800 incident) class:
  1. **Env scrub**: `scrubClaudeCliEnv` deletes `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` from spawned env. Win32 case-insensitive (catches lowercase `anthropic_api_key` from user dotfiles).
  2. **Strict billing assertion**: `total_cost_usd === 0` after JSON parse; rejects NaN/Infinity at parser via `Number.isFinite` (defense-in-depth).
  3. **Fleet halt on leak**: nonzero cost writes `STEWARD_HALT` (fleet sentinel) — refuses subsequent runs until operator clears the file.
- **CLI integration**: new `STEWARD_ENGINE=claude-cli` env / `--engine claude-cli` flag; default stays `openrouter` (R6 backward-compat). Help text derives engine list from `Object.keys(ENGINES)` (SSOT — no drift).
- **OAuth-only auth**: requires `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`); `--bare` flag is **explicitly forbidden** (would skip OAuth and force API billing). `CLAUDE_CLI_FORBIDDEN_FLAGS` freeze-list extracted as SSOT.
- **Hardened argv validation**: `extraArgs` rejects `--bare` variants (case-insensitive, with leading/trailing whitespace, `--bare=value`, `--BARE`) AND any arg containing shell metacharacters `& | ; < > " \` $ ( ) ^ \n \r \0` (CWE-77 defense for Windows `.cmd` `shell:true` invocation).
- **Subprocess hardening**: `child_process.spawn` (not exec), AbortController-based 120s timeout (clamped `[1s, 10min]`), explicit `stdin.end()`, `windowsHide: true`, scrubbed env, 8 MB stdout/stderr UTF-8 byte-length caps (multibyte-safe via `Buffer.byteLength`), no-op `'error'` handler post-resolve to prevent unhandled-error crashes.
- **Path resolution**: `STEWARD_CLAUDE_CLI_PATH` env override (verified via `fs.statSync().isFile()`) → PATH walk (`claude.cmd` → `.exe` → bare on win32; reversed POSIX). Rejects directory paths + paths with shell metacharacters when forced into `shell:true` (`.cmd`/`.bat`).
- **Concurrency semaphore**: in-process cap `STEWARD_CLAUDE_CLI_MAX_CONCURRENCY=1` for v0; Sprint 2.2 worktree supervisor revisits global vs per-worktree.
- **Span lifecycle**: tracer/parentSpan span tagging mirrors `openrouterEngine` — `gen_ai.usage.input_tokens` / `output_tokens` / `llm.cost_usd` / `llm.error_code` always tagged; idempotent end on every exit path.
- **Secret redaction**: `redactSecrets` masks Anthropic OAuth tokens (`sk-ant-oat##-…`) + `Bearer …` headers in all stderr surfaces flowing into journal/PR/halt-file content (CWE-532 defense).
- **11 new error codes**: `CLAUDE_CLI_AUTH_NOT_CONFIGURED`, `CLAUDE_CLI_AUTH_REJECTED`, `CLAUDE_CLI_BILLING_LEAK`, `CLAUDE_CLI_FORBIDDEN_FLAG`, `CLAUDE_CLI_NOT_FOUND`, `CLAUDE_CLI_OUTPUT_TOO_LARGE`, `CLAUDE_CLI_PLAN_NOT_JSON`, `CLAUDE_CLI_PLAN_SHAPE_INVALID`, `CLAUDE_CLI_PROTOCOL_DRIFT`, `CLAUDE_CLI_QUOTA_EXHAUSTED`, `CLAUDE_CLI_RATE_LIMITED`, `CLAUDE_CLI_SERVER_ERROR`, `CLAUDE_CLI_SPAWN_FAILED`, `CLAUDE_CLI_TIMEOUT`.
- **R1 memo**: `docs/research/sprint-2.4-anthropic-claude-cli-engine-2026-05-08.md` — full research + decision rationale + 25 GH issue / docs citations.
- **R2 review pipeline (6 agents in parallel)**: acceptance + blind + correctness + security + ssot + edge-case → consolidated **1 BLOCKER + 3 HIGH + 11 MAJOR + 14 MINOR** findings; 13 must-fix items applied pre-commit. Defer list (`Sprint 2.4.1`): E2E integration test under real `CLAUDE_CODE_OAUTH_TOKEN`, Windows SIGTERM grandchild via `taskkill /T /F`, PATH walk well-known-paths preference, semaphore concurrency stateful test, `parseClaudeCliResponse` adversarial fuzz table, transient-network stderr regex, parent-exit signal forwarding, spec-criteria registration in `action-kinds.cjs`.
- **Tests**: 1158 → 1187 (+29 unit tests covering all 14 R2 review-fix paths). All 3 CI lanes pending push.
- **Manual verification (operator-machine)**: `claude --version` (v2.1.119) + `resolveClaudeCliPath` finds `C:\Users\david\AppData\Roaming\npm\claude.cmd` (useShell:true) + helpers (scrubEnv / parse / categorize / matchForbiddenFlag / containsShellMetacharacters / redactSecrets) all return expected values. Real end-to-end against operator's Max sub deferred to operator dogfood gate (per Sprint 2.0.1 lesson §13: "Spec-permissive ≠ receiver-permissive").
- **New helper file**: `tests/helpers/fake-spawn.cjs` (~85 LoC) — reusable `EventEmitter`-based `spawn` fake for deterministic subprocess tests without requiring a real binary. Pattern reusable for future engines.

### Fixed (2026-05-08 — Sprint 2.0.1: OTLP protobuf encoder for Phoenix compatibility) — commit `2981ea7`
- **Zero-deps OTLP protobuf encoder** (`bin/steward/_lib/otel-protobuf.cjs`, ~370 LoC) — replaces Sprint 2.0's OTLP/JSON encoding that Phoenix 15.5.1 rejected with HTTP 415 Unsupported Media Type.
- Switched emitter `Content-Type: application/json` → `application/x-protobuf`. Wire format now spec-compliant binary OTLP per [`opentelemetry-proto`](https://github.com/open-telemetry/opentelemetry-proto).
- Encoder primitives: varint (BigInt-safe up to 2^64), tag, length-delimited, fixed64, double + AnyValue type dispatch (string/bool/int/double/array/kvlist/bytes/Uint8Array) + Span/ScopeSpans/Resource/ResourceSpans/ExportTraceServiceRequest.
- **Manual verification**: trace `aa105a439194024f65a0531befd82c53` lands in live Phoenix container with complete AGENT→TOOL span tree (`steward.run` + `spec_verifier.runChecks` + `verifier.npm_test` + `gh.push_and_pr`) and Sprint 2.0b routing tags (`steward.routing.{profile,source,model}`).
- R2 review pipeline (2 agents) surfaced 2 BLOCKER + 8 MAJOR findings, all fixed before commit:
  - Negative BigInt silently zero-coerced → `encodeSignedVarintInt64` does proto3 two's-complement
  - Hex traceId/spanId/parentSpanId unvalidated → regex gate before `Buffer.from`
  - Negative Number routed to doubleValue (type-tag corruption) → routes to int_value via BigInt promotion
  - Unused `encodeBoolField` (semantic conflict with AnyValue bool emission) → removed
  - `encodeString` silent "[object Object]" on objects → throws TypeError
  - `encodeFixed64Field` Number precision loss above 2^53 → throws TypeError; BigInt/digit-string only
  - `parent_span_id` absence not byte-level asserted → added `Buffer.indexOf` check
  - `Uint8Array` fell through to kvlist → routes to bytes_value
- 39 new unit tests on protobuf primitives + 7 R2 review-fix tests; integration tests migrated to `tracer._lastPayload` reads.
- **Tests: 1095 → 1134 / 0 fail / 1 skipped**.

### Added (2026-05-08 — Sprint 2.1: autoresearch / overnight burst, ⭐ TRANSFORMATIVE) — commit `b3e6656`
- **N-strategy serial autoresearch loop** as opt-in mode (`--mode=autoresearch` CLI flag, `STEWARD_MODE=autoresearch` env). Single-process serial; Sprint 2.2 will fan out to worktrees.
- **Default N=3 candidates** (clamped [1, 10]): minimize_edits (T=0.2) / balanced (interpolated) / exploratory (T=1.0). Each candidate applied + spec-verified + npm-tested + rolled back via `git checkout -- . && git clean -fd`. Judge picks among passing candidates with both-orderings (consensus or spec-margin fallback).
- **Cross-family judge** by default: DeepSeek V4 Flash candidates judged by `anthropic/claude-sonnet-4.6` (configurable via `STEWARD_AUTORESEARCH_JUDGE_MODEL`, validated against routing-table allowlist).
- **6 new env knobs**: `STEWARD_AUTORESEARCH_N`, `STEWARD_AUTORESEARCH_RUN_USD_CAP` ($1 default), `STEWARD_AUTORESEARCH_MAX_TIME_MIN` (60min default, max 300), `STEWARD_AUTORESEARCH_JUDGE_MODEL`, `STEWARD_AUTORESEARCH_SIMILARITY_THRESHOLD` (0.85), `STEWARD_AUTORESEARCH_DELTA_ANOMALY_MULTIPLIER` (3.0).
- **6 new error codes**: `STEWARD_AUTORESEARCH_VERIFIER_TAMPERED` / `_STRATEGY_COLLAPSE` (soft) / `_JUDGE_DISAGREEMENT` (soft) / `_RUN_USD_EXCEEDED` / `_TIME_EXCEEDED` / `_ALL_CANDIDATES_FAILED`. Plus `AUTORESEARCH_REPO_ROOT_MISSING` / `AUTORESEARCH_NO_WINNER` / `AUTORESEARCH_WINNER_REAPPLY_FAILED` / `AUTORESEARCH_JUDGE_MODEL_REJECTED`.
- **Validation hacking defense (Tennis-XGBoost class)**: SHA-256 hash check on `action-kinds.cjs` + `spec-verifier.cjs` + `policy-check.cjs` at run start + end. Mismatch halts with `STEWARD_AUTORESEARCH_VERIFIER_TAMPERED`.
- **Strategy collapse detection**: Jaccard similarity ≥ 0.85 across passing candidate diffs flags `collapse_detected: true`. First passing candidate becomes winner without judge call (no qualitative diversity to judge between).
- **Delta anomaly detector**: today's spec_margin > rolling 7-day mean × 3.0 flags `delta_anomaly: true` (soft signal, requires bootstrap of ≥ 3 prior winners to avoid noise on first runs).
- **PR labels** auto-applied based on autoresearch flags: `judge-disagreement` (Q2 operator decision), `autoresearch-delta-anomaly`, `autoresearch-collapse`. Operator-visible signal without blocking.
- **All-N lessons.jsonl writes** (Q1 operator decision): both winners + rejected candidates write to lessons.jsonl with distinct codes (`AUTORESEARCH_WINNER_CANDIDATE:<label>` vs `AUTORESEARCH_REJECTED:<reason_id>`). Seed corpus for Sprint 3.0 AlphaEvolve prompt evolution.
- **Per-candidate journal entries** (`event: 'autoresearch_candidate'`) with cost + tokens + spec_pass + npm_pass. Winner entry written AFTER re-apply confirms ok.
- **Cross-session loop detector** (Sprint 1.9.1) ticks at run-level via journal events. Honors action_kind + criterion_id to surface "5× same criterion in 7 days" → STEWARD_HALT.
- New module **`bin/steward/_lib/autoresearch.cjs`** (~570 LoC): pure primitives (jaccard, diversity prompts, hash check, judge prompt builder, run budget, reconcile) + orchestrator (`runAutoresearch`).
- New helper **`bin/steward/_lib/action-engine.cjs buildOpenRouterRequestBody`**: composes request body with optional `temperature` + `personaOverlay` (capped 2 KB, second system message). Powers per-candidate fan-out.
- New helpers in **`bin/steward/_lib/routing-table.cjs`**: `isAutoresearchEligible(actionKind)` + `isAllowedJudgeModel(slug)` SSOT. `AUTORESEARCH_ELIGIBLE_KINDS` set + `ALLOWED_JUDGE_VENDOR_PREFIXES` array exported.
- New helper in **`bin/steward/_lib/gh-ops.cjs createDraftPR`**: `opts.labels[]` filtered by safe-label regex.
- **`spec-verifier.cjs runChecks`** now always emits `criteria_passed` + `criteria_total` on success path (pre-fix: success returned `{ok:true, spec_failures:[]}` only — autoresearch's spec_margin was always 0, delta-anomaly was dead-on-arrival).
- **`.github/workflows/steward-autoresearch.example.yml`** — Sunday 02:00 UTC weekly cron (lowest-traffic GHA window). Coexists with nightly `steward.yml`.
- **`docs/steward-autoresearch.md`** — operator guide.
- R2 review pipeline (6 agents) surfaced 2 BLOCKER + 17 MAJOR findings, all fixed before commit.
- **Tests: 1041 → 1095** (+54 autoresearch tests covering primitives + orchestrator + R2 review fixes).

### Added (2026-05-08 — Sprint 2.0b: action-kind based model routing) — commit `79c101a`
- **4-profile routing knob**: `cheap` / `balanced` (default) / `premium` / `ensemble` via `STEWARD_ROUTING_PROFILE` env or `--routing-profile` CLI flag.
- **Per-action_kind override**: `STEWARD_ROUTING_<KIND>=<slug>` (e.g. `STEWARD_ROUTING_RECOMMENDATION=anthropic/claude-sonnet-4.6`).
- **CLI `--model <slug>`** flag for one-shot model override (highest precedence; bypasses profile-allowlist as documented escape hatch).
- **Override hierarchy**: CLI `--model` > `STEWARD_ROUTING_<KIND>` env > legacy `STEWARD_MODEL` env (backward compat) > profile-table[kind][profile] > balanced default.
- **Premium tier avoids Opus 4.7** per R1 memo §1.3 caveat (tokenizer overhead). Uses Opus 4.6 instead. Enforced by contract test.
- **Ensemble cross-family**: DeepSeek V4 Flash + Qwen3 Coder Flash + Mistral Small 4 → Claude Haiku 4.5 judge.
- **Profile-allowlist gate**: `release_notes_drafter` blocked from ensemble (commodity kind).
- **Per-action USD cap** layered above 1.9.1 daily/weekly/monthly: `STEWARD_PER_ACTION_USD_CAP` ($1 default), per-kind `STEWARD_PER_ACTION_USD_CAP_<KIND>` override. 24-h sliding window across UTC midnight (reads today + yesterday journal files). Future-timestamp clock-skew defense.
- **Trace tags** on AGENT span: `steward.routing.profile`, `steward.routing.source`, `steward.routing.model`. Enables Phoenix filtering by profile.
- New modules: `bin/steward/_lib/routing-table.cjs` (~340 LoC) + `bin/steward/_lib/routing-policy.cjs` (~135 LoC).
- New docs: `docs/steward-routing.md` + `standards/steward-policy.md` § 6.5 Routing profile policy with 3 MUST patterns.
- R2 review pipeline (6 agents) surfaced 10 MAJOR findings, all fixed: 24-h window read today only, hardcoded `llmKinds` Set duplicated SSOT, future-ts clock skew, CLI flag-eats-flag, whitespace env values, prototype pollution, legacy STEWARD_MODEL applies to deterministic kinds, fallback shape inconsistency, lenient parseFloat, stringly-typed routing.source enum.
- Tests: 972 → 1041 (+69 routing-table + routing-policy + SSOT contract tests).

### Removed (2026-05-08 — v0.2.0 platform hardening: drop Sprint 4.7 backward-compat shims)
- **Deleted 10 hermes-prefixed shim files** (1-line redirect stubs from Sprint 4.7 rename):
  - `bin/cortex-hermes`, `bin/cortex-hermes.cjs`, `bin/cortex-hermes.ps1`
  - `prompts/hermes-setup.md`, `standards/hermes-policy.md`
  - `docs/hermes-roadmap.md`, `docs/hermes-runtime.md`, `docs/hermes-usage.md`, `docs/hermes-rfc.md`, `docs/hermes-research-synthesis.md`
- **Stripped runtime backward-compat layer**:
  - `bin/steward/_lib/env.cjs` — `readEnv(NAME)` now reads only `STEWARD_<NAME>`. The `HERMES_<NAME>` fallback + deprecation-warning latch is gone. **Operators must rename `HERMES_*` env vars to `STEWARD_*` before upgrading.**
  - `bin/steward/_lib/halt-check.cjs` — sentinel filename is `STEWARD_HALT` only. Legacy `HERMES_HALT` files no longer halt the runtime; operators must `mv ~/.cortex/HERMES_HALT ~/.cortex/STEWARD_HALT`.
  - `bin/steward/_lib/git-trailers.cjs` — builder + validator emit and require `Steward-*` only. `normalizeTrailerPrefixes()` removed. `parseTrailers` stays prefix-agnostic and `getTrailer(parsed, suffix)` still reads either prefix from a parsed map for walking pre-rebrand commit history.
  - `bin/steward/_lib/journal.cjs` — `'hermes'` removed from `VALID_ACTORS`. Existing journal entries with `actor: 'hermes'` remain readable (validation is on write only).
  - `bin/steward/_lib/action-engine.cjs` — `STEWARD_HARD_DENYLIST` no longer carries `bin/hermes/`, `bin/cortex-hermes`, `standards/hermes-` patterns. Module-level `HERMES_SYSTEM_PROMPT` alias removed.
  - `bin/steward/_lib/policy-check.cjs` — `HERMES_HALT_PRESERVE` rule removed; `HERMES_DENY` module-export alias removed.
  - `bin/steward/execute.cjs` — `isHermesArtifact` module-export alias removed.
  - `detectors/pr-review-responder.cjs` — legacy `Hermes (cortex-x)` PR-author detection removed; `getHermesOpenPRs` and `isHermesAuthor` aliases removed. `externalComments` filter excludes `steward-cortex-x` self-comments only.
  - `shared/hooks/session-start.cjs` — Steward activation nudge checks only `steward.yml` workflow + `STEWARD_HALT` sentinel.
  - `bin/steward/dry-run.cjs` — emits `Steward-*` trailer keys only.
- **Tests updated**: 953 → 973 tests after migration. All assertions, fixtures, and env vars use `STEWARD_*` / `STEWARD_HALT` / `Steward-*` / `actor: 'steward'` / `service.namespace=cortex-x`. Halt-check test gains a regression assertion that legacy `HERMES_HALT` is **not** honored. All 3 CI lanes green.
- **Cross-ref hardening**: every active doc's markdown link points at `docs/steward-*.md` (no broken `./hermes-*.md` URLs); `docs/steward-usage.md`, `docs/why-openrouter-not-claude-oauth.md`, `standards/steward-policy.md`, `prompts/steward-setup.md`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `tests/README.md` all reference `STEWARD_*` env vars consistently.

**Migration for operators upgrading from Sprint 4.7:**
```bash
# 1. Rename env vars (STEWARD_DAILY_USD_CAP, STEWARD_FAILURE_BREAKER, etc.)
sed -i 's/HERMES_/STEWARD_/g' .env.local your-cron-script.sh

# 2. Replace cortex-hermes invocations:
sed -i 's/cortex-hermes/cortex-steward/g' your-cron-script.sh

# 3. Move halt sentinel if you have one in flight:
[ -f ~/.cortex/HERMES_HALT ] && mv ~/.cortex/HERMES_HALT ~/.cortex/STEWARD_HALT
[ -f ./.cortex/HERMES_HALT ]  && mv ./.cortex/HERMES_HALT ./.cortex/STEWARD_HALT

# 4. Rename project workflow file if you forked one:
[ -f .github/workflows/hermes.yml ] && git mv .github/workflows/hermes.yml .github/workflows/steward.yml
```

Pre-rebrand commit history (`Hermes-*` trailers, `actor: 'hermes'` journal entries, branches under `hermes/<date>-<slug>-<id>`) remains untouched and walk-able — those records are immutable. Only the *write-side* legacy honors are gone.

### Added (2026-05-08 — Sprint 2.0 self-hosted observability via Phoenix)
- **`bin/steward/_lib/otel-emitter.cjs`** — zero-deps OTLP HTTP emitter (Tracer + Span classes, OpenInference + OTel `gen_ai.*` dual-attribute set, fail-open everywhere). Activated by `STEWARD_OTEL_ENDPOINT` (legacy `HERMES_OTEL_ENDPOINT` alias honored through v0.2.0). Endpoint allow-list: loopback hosts only by default, `/v1/traces` or `/v1/logs` path required, `STEWARD_OTEL_ALLOW_REMOTE=1` opt-in for non-loopback. Validation rejects scheme/host/path violations and disables tracer with one stderr warning per process — never fails the run.
- **`templates/observability/docker-compose.phoenix.yml`** + **`templates/observability/README.md`** — single-container Phoenix sidecar (SQLite persistence, 127.0.0.1 bind, `PHOENIX_ENABLE_AUTH=false` only for local dev).
- **AGENT root span** in `execute.cjs` wraps every `runExecute` call (including pre-flight rejections — halt-check, budget caps, lock conflicts). Plumbing: `tracer + agentSpan` created at top of `runExecute` outer wrapper, refined with plan attributes once plan is loaded; flushed in outer `finally` regardless of exit path. Children: `spec_verifier.runChecks`, `verifier.npm_test`, `gh.push_and_pr`, all wrapped in try/finally so spans end even when the wrapped call throws.
- **LLM child span** in `action-engine.cjs` openrouter path — wraps `_openrouterEngineInner` via try/catch/finally; emits `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.{input,output}_tokens`, `llm.token_count.{prompt,completion,total}`, `llm.cost_usd`, `llm.error_code`. Defaults to `0` on missing usage so cost dashboards differentiate "no LLM call" from "LLM call, no usage".
- **Span hardening (review-driven)**: `toAnyValue` handles NaN/Infinity (→ stringValue), Symbol/Function/Date/Buffer/BigInt explicitly. Per-attribute string truncation (8 KB), per-payload size cap (1 MB → reason `payload-too-large`). `setStatus` redacts absolute filesystem paths (POSIX + Windows + UNC) and truncates to 200 bytes (CWE-117/209). `withSpan` no longer overwrites a status the inner function already set. NoopSpan as parent is treated as no parent (avoids all-zero spanId on the wire).
- **Resource attributes**: `service.name=steward`, `service.namespace=cortex-x`, `service.version` reads `package.json` (semver-shaped per OTel semconv).
- **Operator docs**: `docs/steward-usage.md § Observability — live trace view (Sprint 2.0)` with bring-up + fail-open contract.
- **Tests**: 49 unit tests at `tests/unit/steward/otel-emitter.test.cjs` + 5 integration tests at `tests/integration/steward-observability.test.cjs` (AGENT span structure, parent-child propagation, OTLP wire format, attribute coercion edge cases, allow-list validation, path redaction, NoopSpan parent skip, payload-too-large, fail-open under unset/unreachable/non-loopback). 924 → 978 tests (+54).

### Changed (2026-05-08 — Sprint 4.7 rebrand: Hermes → **Steward**)
- **All present-tense `Hermes` references renamed to `Steward`** across runtime, docs, tests, CI workflows, and standards. Motivated by the 139k-star [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent) collision (Feb 2026, MIT, dedicated `.com/.org/.ai`) — public launch under the same name was unrecoverable.
- **Directory renames** (history-preserving via `git mv`):
  - `bin/hermes/` → `bin/steward/`
  - `tests/unit/hermes/` → `tests/unit/steward/`
  - `tests/fixtures/hermes-dryrun/` → `tests/fixtures/steward-dryrun/`
  - `evals/hermes/` → `evals/steward/`
- **File renames**:
  - `bin/cortex-hermes{.cjs,.ps1,}` → `bin/cortex-steward{.cjs,.ps1,}` (one-line shims at the old paths emit a deprecation warning and forward; removed in v0.2.0)
  - `prompts/hermes-setup.md` → `prompts/steward-setup.md` (shim redirects)
  - `standards/hermes-policy.md` → `standards/steward-policy.md` (shim redirects)
  - `docs/hermes-{roadmap,runtime,usage,rfc,research-synthesis}.md` → `docs/steward-*.md` (each shim redirects)
  - `.github/workflows/hermes{,-todo-triage,-dep-patch,-harvest}.yml` → `.github/workflows/steward*.yml`
  - `tests/integration/hermes-*.test.cjs` → `tests/integration/steward-*.test.cjs`
- **Env vars** `HERMES_*` → `STEWARD_*` with backward-compat layer in `bin/steward/_lib/env.cjs`. `readEnv(name)` reads `STEWARD_<name>` first, falls back to `HERMES_<name>` with a one-time stderr deprecation warning. Set `STEWARD_SUPPRESS_DEPRECATION=1` to silence. Removed in v0.2.0.
- **Halt sentinel** `.cortex/HERMES_HALT` → `.cortex/STEWARD_HALT`. `halt-check.cjs` reads both filenames; new halts are written under the new name. Pre-rebrand halts in operator state continue to halt through v0.2.0.
- **Git trailers** `Hermes-Action-Id` / `Hermes-Trigger` / `Hermes-Journal-Entry` / `Hermes-Recommendation-Source` → `Steward-*`. `buildCommitMessage` auto-normalizes legacy `Hermes-*` keys; `parseTrailers` is prefix-agnostic so pre-rebrand commits still walk-able. `Co-Authored-By: Hermes <hermes@cortex-x.local>` → `Co-Authored-By: Steward <steward@cortex-x.local>`.
- **Branch prefix** `hermes/<date>-<slug>-<id>` → `steward/<date>-<slug>-<id>`.
- **Engine HARD_DENYLIST** keeps both old (`bin/hermes/`, `bin/cortex-hermes`, `standards/hermes-`) and new (`bin/steward/`, `bin/cortex-steward`, `standards/steward-`) patterns so projects forked from pre-rebrand cortex-x stay protected through v0.2.0.
- **PR-review-responder detector** recognizes both `Steward (cortex-x)` and legacy `Hermes (cortex-x)` PR authors so cross-rename PR follow-up still works.
- **External `Hermes Agent` references preserved** verbatim — `docs/public-launch-plan.md`, `docs/sprint-1.5-design.md`, `standards/skills.md`, `shared/hooks/tirith-scan.cjs` all refer to the NousResearch product, NOT to our internal runtime.
- **Tests**: 924 pass / 0 fail / 1 skipped after rebrand. `tests/unit/steward/halt-check.test.cjs` extended with backward-compat tests for the legacy sentinel filename; `tests/unit/steward/git-trailers.test.cjs` extended with prefix-normalization + dual-prefix `getTrailer` tests.

**v0.2.0 removal target** (next minor): all backward-compat shims + aliases + legacy env-var + legacy sentinel reads. Operators who still set `HERMES_*` env vars or `cortex-hermes` invocations after v0.2.0 ships will see hard failures.

### Added (2026-05-06 — Sprint 1.5 onboarding + audit + auto-research engine)
- **Install UX (`bin/cortex-bootstrap{,.ps1}`)** — per-project mode selector. Asks `[N]ew` / `[E]xisting` / `[F]ramework`. Writes `$PWD/.cortex-bootstrap-pending` with mode + ISO timestamp (1h TTL). One-shot semantics; the skill that runs deletes the marker on completion.
- **`shared/skills/start/SKILL.md` + `shared/skills/audit/SKILL.md`** — auto-discovered slash skills mapped to `prompts/new-project.md` and `prompts/existing-project-audit.md`. Auto-primed by `SessionStart` when the bootstrap marker is fresh.
- **`shared/hooks/session-start.cjs`** — extended to detect `.cortex-bootstrap-pending` (auto-prime `/start` or `/audit`) and `cortex/.adapt-pending` (recovery surface if Phase 5 was interrupted).
- **`prompts/existing-project-audit.md`** — NEW deep 12-dimension audit prompt. Six phases: P0 detect → P1 repo-map (with degraded grep+find fallback) → P2 four parallel agents owning three dimensions each → P3 five irreducible human questions → P4 planner-driven auto-research → P5 synthesis to `cortex/AUDIT.md` + `cortex/recommendations.md` + CLAUDE.md patches → P6 ADR backfill (opt-in via `--backfill-adrs`).
- **`agents/planner.md` + `agents/synthesizer.md`** — auto-research engine. Planner picks 3-5 topics from `{profile} × {concern}` matrix; synthesizer merges parallel research into `cortex/recommendations.md` and a `## Stack reality check` section in CLAUDE.md. Three-hop citation traceability mandatory (claim → finding ID → source URL).
- **`config/research.yaml`** — two new triggers: `post_install_adaptation` (Phase 5 Adapt for greenfield) and `existing_project_audit` (Phase 4 of `/audit`). Both `mode: dynamic` (planner-driven). Skip-for-profiles list includes `astro-static` + `minimal`.
- **`prompts/cortex-doctor.md` §14 + §15** — three-hop citation drift check (verifies every CLAUDE.md "Stack reality check" claim traces through finding ID to source URL via HEAD request); canonical-references freshness check (SHA-256 compares local `~/.claude/shared/standards/*` against GitHub raw URL hash, flags drift > 30 days).

### Changed (2026-05-06 — Sprint 1.5)
- **`prompts/new-project.md`** — restructured into FIVE explicit phases each saving an artifact: `cortex/discovery.md` (P1) → `$CORTEX_DATA_HOME/research/<slug>-<date>.md` (P2) → `cortex/proposal.md` (P3) → scaffolded filesystem (P4) → `cortex/recommendations.md` + CLAUDE.md `## Stack reality check` (P5 Adapt — NEW). Phase 3 architect approval gate is structured `[a/e/r/q]` not free-form. Phase 4 §4.1a adds dual-link standards (local path + canonical GitHub URL) in scaffolded CLAUDE.md. Phase 4 §4.5 step 12 writes `cortex/.adapt-pending` recovery marker; P5 §5.5 deletes it on completion.
- **`prompts/retrofit.md`** — added prerequisite gate: defer to `/audit` if `cortex/AUDIT.md` not present. Existing 5-phase retrofit-application flow preserved.
- **`install.sh` + `install.ps1`** — copy `bin/cortex-bootstrap{,.ps1}` to `~/.claude/shared/bin/`, print "next step" hint pointing the user at the per-project bootstrap command.

### Deferred (Sprint 1.5b)
- `detectors/repo-map.cjs` (tree-sitter + PageRank). Audit prompt P1 ships with degraded grep+find fallback; ranking quality is lower until repo-map detector lands.
- `detectors/hotspots.cjs` (git churn × cyclomatic complexity).
- Note: there is no `PostScaffold` event in Claude Code — Phase 5 dispatch happens in-prompt; recovery if the session is interrupted is handled by the existing `SessionStart` hook reading `cortex/.adapt-pending`.

### Added (2026-05-06 — Sprint 1 install-readiness checkpoint)
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 (canonical text via curl, contact `REDACTED@redacted.invalid`)
- `.github/workflows/no-pii.yml` — CI gate that runs `scripts/sync-to-public.mjs` + `validate-no-pii.mjs` + ship-ready denylist scan on every PR/push to `main`
- `scripts/fix-d4-paths.mjs` — one-shot rewriter that resolved D-4 (path convention `~/.claude/shared/` for installed assets, `$CORTEX_HOME` for live source)
- `scripts/sync-to-public.mjs` + `scripts/validate-no-pii.mjs` — public-snapshot tooling (sanitize-rules-driven find/replace + blacklist scan; rules data itself stays gitignored per `scripts/sanitize-rules.json`)
- `module.yaml` — separated `cortex_root` (live source, default `~/cortex-x`) from `cortex_assets_root` (installed, default `~/.claude/shared`); removed Dave's local `~/Desktop/APPs/` default

### Changed (2026-05-06)
- D-4 RESOLVED — 14 source files (README, prompts/*, evals/*, projects/README.md, config/evolve.yaml) rewritten from `~/cortex-x/<subdir>/` to either `~/.claude/shared/<subdir>/` (installed) or `$CORTEX_HOME/<subdir>/` (live); see MIGRATIONS.md §D-4
- `scripts/sync-to-public.mjs` — replacement engine now honors `scope: all-but-authorship`, preserving maintainer contact in `SECURITY.md` and `CODE_OF_CONDUCT.md`
- `.gitignore` — added `/docs/pohovor-*.md` (maintainer interview-prep pattern; mirrors sanitize-rules `fileExclusions`)

### Added
- **Auto-orchestration layer (MVP).** Claude is now prompted automatically to parallelize research + review and single-thread implementation on new-feature prompts. Evidence-grounded in Anthropic's multi-agent research paper, Cognition's counter-position, and 2025–2026 benchmarks (SWE-bench, PlanCraft, ICSE 2025 deprecated-API study). Soft-gate only; never spawns agents silently.
  - `shared/hooks/auto-orchestrate.cjs` — UserPromptSubmit hook with new-implementation detection (cs + en patterns), research cache freshness lookup with topic-aware TTL, session budget warning injection
  - `shared/hooks/_lib/budget.cjs` — token cost estimation (2026 pricing table), session total tracking, `$CORTEX_DATA_HOME/journal/.budget.jsonl` writer
  - `shared/hooks/post-tool-use.cjs` — extended to record Agent/Task/WebSearch/WebFetch token usage when exposed by Claude Code
  - `shared/hooks/session-start.cjs` — surfaces last 3 session budgets at session start
  - `standards/auto-orchestration.md` — 3-fronta rule (research parallel / implementation serial / review parallel), 2-minute rule, task-type taxonomy, anti-patterns, evidence trail with citations
  - `prompts/auto-review.md` — scope-classified parallel review pipeline (trivial/small/medium/large → 1–5 agents), anti-slop merge
  - `docs/archive/auto-orchestration-rfc.md` — full design rationale + research transcript (archived 2026-05-09 during pre-Sprint-2.0 audit; the MVP shipped 2026-04-19 and the file is now historical-only)
- `CORTEX_SESSION_BUDGET_USD` env var (default `$5.00`)
- `standards/ship-ready.md` — governance invariants for beta/stable distribution
- `research/beta-distribution-2026-04-17.md` — research-grounded staging/prod decision matrix
- `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATIONS.md`, `CHANGELOG.md` — ship-ready artifacts
- PolyForm Noncommercial 1.0.0 license (replaces `Proprietary` stub)

### Changed
- `prompts/cortex-doctor.md` §9 — research hygiene now checks per-topic TTL (hot frameworks 30d, regulations 180d, architecture 365d) instead of blanket 180 days

### Added (continued)
- `prompts/retrofit.md` — apply cortex-x structure to an existing (messy) project without touching runtime code. Four phases: parallel audit → retrofit plan → additive application (user-gated) → post-retrofit report. Strict non-destruction contract: no runtime edits, no overwrites without diff, no auto-fix of Rule 1 violations (those become sprints). Closes the gap between `new-project.md` (greenfield) and `project-scan.md` (library capture) for legacy/client projects
- **Eval suite expanded from 1 → 10 canonical tasks.** Aider-style benchmark (Paul Gauthier 2024-2026) now covers all major prompt + standard surfaces:
  - `eval-002` BAIL-flow scaffold respect (canary for scope creep in `new-project.md`)
  - `eval-003` project-scan slim 5-section schema (canary for SSOT-drift in `project-scan.md`)
  - `eval-004` cortex-sync architectural decision capture
  - `eval-005` code-review SSOT violation BLOCK (Rule 1 enforcement canary)
  - `eval-006` security-auditor SQL injection + RLS bypass (Rule 2 Critical canary)
  - `eval-007` cortex-doctor missing-hook drift detection
  - `eval-008` sprint-status PROGRESS.md parser correctness
  - `eval-009` retrospective [TRANSFERABLE] tagging discipline
  - `eval-010` evolve hard-gate enforcement (framework-honesty canary, prevents pattern hallucination)
- `evals/runner.md` — manual + future-automated execution instructions, result schema, cadence policy (monthly full suite, per-PR for touched prompts, pre-tag full + weakest-3 manual)
- `evals/results/2026-05-01-01d9013-paper-baseline.json` — first baseline established. Paper-baseline mode (per-task scores predicted from prompt review, NOT from real Claude session execution). Total: 8.25 / 10 (82.5%). Weakest: eval-002 (0.65). Strongest: eval-008, eval-010 (0.90). ADVISORY status until 3+ real-execution runs accumulate

### Changed
- LICENSE from "Proprietary" to **PolyForm Noncommercial 1.0.0**. Backwards-incompatible license change; prior collaborators with any access receive the new terms on any subsequent pull.
- Personal data (private project entries, dated insights, journal, dated research caches) moved out of the shipped distribution via `.gitignore` patterns. Files remain on maintainer's local install.

### Fixed
- `prompts/new-project.md`, `prompts/cortex-doctor.md` — replaced hardcoded `~/Desktop/APPs/cortex-x/` with `{cortex_root}` placeholder / `~/cortex-x/` default.
- Personal email removed from public `README.md`.

## [0.0.0] — Pre-beta (pre-2026-04-17)

Internal development. Phases 1–5 foundations: hooks, standards, agents, profiles, self-improvement loop, auto-research primitive. Not distributed.
