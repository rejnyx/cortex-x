# Changelog

All notable changes to cortex-x. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

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
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 (canonical text via curl, contact `davidrajnoha@gmail.com`)
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
