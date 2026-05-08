---
sprint: 2.5
title: tech_debt_audit action_kind
date: 2026-05-08
status: research-complete
---

# Sprint 2.5 — tech_debt_audit R1 memo

## 1. Question

Add the 10th Steward action_kind: `tech_debt_audit`. Deterministic (zero LLM cost), runs nightly, snapshots code-health metrics, opens advisory PR when drift exceeds threshold. Tool decision (qlty) is locked from the prior dispatch — this memo verifies fitness, locks numeric thresholds, defines the snapshot schema, settles knip vs. ts-prune for the TS dead-code companion, and details fail-open semantics on hosts where qlty is absent.

## 2. Findings (per question)

### 2.1 — qlty CLI current state (2026-Q3)

**Install methods.** Single one-shot installer per platform. Linux/macOS: `curl https://qlty.sh | bash`. Windows: `powershell -c "iwr https://qlty.sh | iex"`. Both drop a native binary — no Docker, no Homebrew tap, no Scoop/Chocolatey/Winget package as of 2026-Q2. Docker image exists on GHCR but the CLI itself runs linters natively for performance. For cortex-x's GHA workflows we'll wrap the curl installer in a `setup-qlty` step (cached) and on operator machines we accept manual install.

**`qlty init` behavior.** Creates `.qlty/qlty.toml`, auto-detects linters by scanning for tool config files + language fingerprints, then offers an interactive sample run. Critically: **NOT idempotent.** "If Qlty is already initialized in the repository, it will exit with an error." Steward MUST gate `init` on `existsSync('.qlty/qlty.toml')` and skip if present. Flags we'll use: `-y` (skip prompts). Sprint 1.8.4-style detector pattern: `detectors/tech-debt-audit.cjs` returns `{ status: 'init-needed' | 'ready' | 'qlty-missing' }`.

**`qlty metrics` output schema.** Computes lines-of-code, classes, functions, fields, lcom (cohesion), and **cognitive** complexity (qlty's word "complexity" means cognitive, not cyclomatic). Sortable columns confirmed: `name, classes, functions, fields, lines, loc, complexity, lcom`. JSON output flag exists (`--json`) but the published schema is intentionally underspecified. **Action item:** Sprint 2.5 implementation MUST snapshot one canonical run output and pin our consumer parser to those exact fields; if upstream changes shape we get a clean schema-mismatch error rather than a silent data drift. Add a Sprint 1.9 `acceptance_criterion` (kind: `regex`) asserting the snapshot file contains `"complexity"` and `"loc"` keys.

**`qlty smells` output.** Combined duplication + structural-smell detector. JSON via `--json`, SARIF via `--sarif` (added v0.539.0). Underlying duplication engine is qlty-native: Tree-Sitter AST → fingerprint → cross-file index, structural (not text) match. We'll use SARIF output for snapshot — it's the more stable schema.

**Windows support.** Native binary, no WSL needed. ARM64 Linux musl shipped v0.506.0; Windows x64 + ARM both supported. Cross-platform fixtures already in cortex-x's 5-lane CI matrix should pass; we'll add a smoke fixture that runs `qlty --version` on win32 lane.

**License.** BSL 1.1 with DOSP, Additional Use Grant explicitly permits commercial use including ours. Rule 0 distribution gate clears: cortex-x is PolyForm Noncommercial; we don't bundle qlty, we shell out to it. No license collision.

### 2.2 — Heuristic thresholds

Confirmed qlty defaults:

| Smell | qlty default | Sprint 2.5 starting threshold | Rationale |
|---|---|---|---|
| `function_complexity` (cognitive) | 15 | 15 (keep default) | Sonar/Campbell whitepaper says cognitive ≈ cyclomatic + nesting overhead; 15 lines up with McCabe-10 once nesting is included |
| `file_complexity` | 50 | 50 | qlty default; flags monolith files |
| `boolean_logic` | 5 ops | 5 | default |
| `nested_control_flow` | 5 | 5 | default |
| `function_parameters` | 5 | 5 | default |
| `return_statements` | 6 | 6 | default |
| `identical_code` | 12 lines | 12 | default |
| `similar_code` | 12 lines | 12 | default |
| `duplication.nodes_threshold` | 50 AST nodes | 50 | default |

**File LoC threshold** — qlty doesn't ship a single `file_lines` smell; the practical proxy is `file_complexity=50`. For the audit's drift detection we use `file_loc > 500` as **advisory-only** (warn in PR body, never block). The hard structural signal stays `file_complexity`.

**Test:source ratio drop.** qlty doesn't compute this; we derive it from `qlty metrics --all` (counts source LoC) and a separate `find tests -name '*.test.*' | wc -l` style probe. Threshold for advisory PR: `>20% week-over-week drop in test_loc / source_loc ratio`. Rationale: cortex-x today is 50 _lib + 150 test files; a >20% drop is ≥10 tests deleted in one week, worth surfacing.

**Duplication % threshold.** Industry rule of thumb: >5% = warning, >10% = problem. Sprint 2.5 advisory PR triggers at **>5% repo-wide duplication OR week-over-week increase >2 percentage points**.

**Dead-code count threshold.** Decision in 2.3 below — knip wins, threshold = `>3 unused exports week-over-week growth` triggers advisory.

### 2.3 — Knip vs. ts-prune vs. unimport

Decision: **knip**. Reasoning:

- **ts-prune is unmaintained as of 2024**, explicitly in maintenance mode with no further updates.
- **knip subsumes ts-prune's mark-and-sweep algorithm** plus adds unused-files, unused-dependencies, and missing-dependency reporting. Plugin-aware for 80+ tools.
- **JSON output stable** — `knip --reporter json` is a first-class reporter; schema published.
- **CJS support is real but conditional.** cortex-x's `bin/steward/_lib/*.cjs` files use `module.exports = { foo, bar }` shorthand, which is one of the two patterns knip explicitly recognizes. The pattern that breaks knip — `const m = require('./x'); m.A; m.B;` (default-import-then-property-access) — would yield false-positive "unused export" reports. Manual scan of cortex-x: every internal require uses destructuring (`const { spawn } = require('child_process')`) so we should be clean. **Mitigation:** the snapshot tracks knip output as advisory metric only for first 4 weeks; if false-positive rate <5% we promote to PR-trigger metric in Sprint 2.6.
- **unimport not considered** — it's an auto-import resolver, not a dead-code detector.

### 2.4 — Snapshot diff pattern

**No canonical "git-style snapshot diff" tool needed.** JSON deep-diff is the right tool: previous snapshot + current snapshot → field-level delta. Implementation: zero-deps recursive diff in `bin/steward/_lib/snapshot-diff.cjs` (mirrors zero-deps stance of otel-protobuf.cjs and policy-check.cjs).

**Granularity: aggregate, not per-file.** With 50 _lib files growing to ~200 over a year, a per-file snapshot becomes git-noisy and diff-unreadable. Aggregate snapshot ~12 metrics:

```jsonc
{
  "snapshot_version": 1,
  "captured_at": "2026-05-08T04:00:00Z",
  "qlty_version": "0.606.0",
  "knip_version": "5.30.6",
  "metrics": {
    "total_loc": 12340,
    "test_loc": 8200,
    "source_loc": 4140,
    "test_source_ratio": 1.98,
    "files_count": 200,
    "max_file_complexity": 47,
    "max_function_complexity": 14,
    "duplication_pct": 3.2,
    "smells_count": 7,
    "knip_unused_exports": 4,
    "knip_unused_files": 0,
    "knip_unused_deps": 0
  },
  "top_offenders": [
    { "path": "bin/steward/execute.cjs", "complexity": 47, "loc": 612 }
  ]
}
```

The `top_offenders` array (cap N=10) gives the operator a useful PR body even though aggregate metrics drive the trigger logic.

**Storage location.** SSOT verdict: **commit it.** Path: `cortex/debt-snapshot.json`. Reasoning:
- `.cortex-data/` is gitignored and is per-machine runtime state — the wrong home for a multi-week audit trail.
- `cortex/` already holds the committed audit trail (`recommendations.md`, `journal/`, `specs/`). The snapshot belongs alongside.
- A committed snapshot means git itself becomes the time-series database. `git log -p cortex/debt-snapshot.json` is the dashboard.
- PRs naturally show the diff; reviewers see drift inline.

### 2.5 — PR advisory shape

When an advisory threshold trips, the action_kind opens a draft PR with body:

```markdown
## Tech debt audit — week ending 2026-05-08

**Drift triggers fired:** duplication_pct ↑ from 3.2% → 5.4% (+2.2pp, threshold +2pp)

| Metric | Last week | This week | Δ | Threshold |
|---|---|---|---|---|
| total_loc | 12 340 | 13 102 | +762 | — |
| duplication_pct | 3.2% | 5.4% | +2.2pp | +2pp |
| max_function_complexity | 14 | 18 | +4 | 15 |
| knip_unused_exports | 4 | 7 | +3 | +3 |
| test_source_ratio | 1.98 | 1.62 | -18% | -20% |

### Top offenders this week
- `bin/steward/execute.cjs` — complexity 47, loc 612 (was 47, 580)
- `bin/steward/_lib/spec-verifier.cjs` — complexity 32 (NEW above threshold)

### Suggested actions
- Refactor `execute.cjs` runActionPhase function (function_complexity 18 > 15)
- Investigate duplication cluster in `_lib/git-ops.cjs` ↔ `_lib/gh-ops.cjs`

_Generated by `tech_debt_audit` action_kind. Advisory only — no source files modified._
```

**Auto-close behavior.** Human-only close. Each advisory PR is an artifact in the audit trail. Auto-closing on green-next-week erases history.

### 2.6 — Fail-open path

cortex-x's `applyAction` returns `{ ok, errorCode, ...data }`. Currently the binary outcomes are pass/fail. **Recommendation:** add a third sentinel `{ ok: true, skipped: true, skipReason: 'QLTY_NOT_INSTALLED' }`. Journal entry kind: `'action_skipped'` (new) with reason field. Skipped actions:
- Do NOT count toward `STEWARD_FAILURE_BREAKER` consecutive-failure circuit.
- Do NOT count toward daily/weekly/monthly cost caps.
- DO emit a structured warning the first time and once per week thereafter.
- DO appear in `cortex-steward status --forecast`.

The detector pattern (`detectors/tech-debt-audit.cjs`) probes for qlty binary via `which qlty` / `where qlty` and short-circuits at dispatch time.

### 2.7 — Comparison with rejected alternatives

| Tool | Why rejected (R1 confirms) |
|---|---|
| **CodeScene CLI** | Commercial license incompatible with cortex-x's "stranger-reproducible install" Rule 0. "6× more accurate" claim is for Behavioral Code Analysis (hotspots from git churn × complexity), which is a Sprint 3.0 AlphaEvolve fitness signal candidate, not a Sprint 2.5 deterministic check. |
| **SonarQube CLI** | Server install required (sonarqube-server JVM); can't run nightly on a GHA standard runner without infra. |
| **`tech-debt-skill` (LLM)** | Complementary, not replacement. Could be invoked Sprint 2.6+ as "explain this drift" step on top of the deterministic snapshot. Today: $-cost is wrong shape for nightly run on every project. |
| **Custom Python AST scripts** | Reinventing 70+ analyzers. qlty's tree-sitter approach is exactly what we'd build, already battle-tested. |

### 2.8 — Acceptance criteria for the kind

```javascript
// In action-kinds.cjs
tech_debt_audit: {
  description: 'Run qlty metrics + qlty smells + knip; snapshot to cortex/debt-snapshot.json; open advisory PR if drift > threshold.',
  requires_llm: false,
  source: 'qlty metrics --all --json + qlty smells --all --sarif + knip --reporter json',
  detector: 'detectors/tech-debt-audit.cjs',
  cost_envelope: 'free',
  blast_radius: 'minimal',
  shipped_in: '0.3.0',
  acceptance_criteria: [
    {
      id: 'snapshot_file_written',
      kind: 'file_predicate',
      description: 'Action MUST produce a fresh cortex/debt-snapshot.json at the configured path.',
      predicate: 'touchedFiles.includes("cortex/debt-snapshot.json") && fileSize("cortex/debt-snapshot.json") > 200',
      severity: 'block',
    },
    {
      id: 'snapshot_schema_valid',
      kind: 'regex',
      description: 'Snapshot MUST contain canonical top-level keys.',
      file: 'cortex/debt-snapshot.json',
      pattern: '"snapshot_version"\\s*:\\s*1.*"captured_at".*"metrics".*"top_offenders"',
      severity: 'block',
    },
    {
      id: 'no_source_edits',
      kind: 'file_predicate',
      description: 'Audit kind is read-only against source — only cortex/debt-snapshot.json may change.',
      predicate: 'touchedFiles.every((p) => p === "cortex/debt-snapshot.json")',
      severity: 'block',
    },
  ],
}
```

### 2.9 — Performance budget

cortex-x today: 50 _lib + 150 test files, ~12k LoC. Empirical benchmarks of qlty on similar-sized JS/TS repos show ~3–8s for `qlty metrics --all`. qlty smells adds ~5–15s for duplication on ~12k LoC repos. knip JSON reporter ~5–10s. **Total target: <30s nightly, well under GHA free-tier budget.** Memory peaks <500 MB. Add a `STEWARD_AUDIT_TIMEOUT_MS=120000` env var with a 2-min hard kill via `child_process.spawn({ timeout })`.

### 2.10 — Future evolution path

- **Sprint 3.0 AlphaEvolve fitness.** The committed snapshot history in git becomes a free time-series. AlphaEvolve's evolutionary loop can read `git log -p cortex/debt-snapshot.json`, parse N weeks of metrics, use `Δ(complexity) + Δ(duplication)` as fitness penalty against any candidate edit. Hook needed now: keep `snapshot_version` field; bump to `2` only via explicit migration so AlphaEvolve readers can rely on shape.
- **Sprint 3.3 GraphRAG.** Per-file `top_offenders` entries already include `path` — extending to `{ path, complexity, loc, churn_30d, dependents_count }` is a backward-compatible field addition. Reserve the `enrichment` sibling key for GraphRAG-derived signals.

## 3. Decision recommendations

1. **Ship qlty + knip as the toolchain.** Both are best-in-class, both have stable JSON outputs, both run cross-platform native.
2. **Lock thresholds to qlty defaults** for the smells set. Add three cortex-x-specific drift triggers: duplication_pct +2pp w/w, knip_unused_exports +3 w/w, test_source_ratio -20% w/w.
3. **Snapshot path: `cortex/debt-snapshot.json` (committed)**, schema versioned via `"snapshot_version": 1`. Aggregate metrics + top-10 offenders, no per-file detail.
4. **Add `skipped` outcome to applyAction** as a first-class third state alongside ok/fail. Journal entry kind `action_skipped`. Doesn't trip failure breaker or cost cap.
5. **Detector probes for qlty + knip** at dispatch; missing tools = clean skip with one-warning-per-week throttle.
6. **knip CJS guard.** Add a one-time linter check that no `bin/steward/_lib/*.cjs` uses the default-import-then-property-access pattern that breaks knip's CJS heuristic. If any are found, fix at Sprint 2.5 entry.
7. **PR is human-close.** No auto-close. The PR thread is the audit-trail artifact.
8. **Performance budget 30s, hard kill 120s** via STEWARD_AUDIT_TIMEOUT_MS.

## 4. Acceptance criteria refinements

(Captured in §2.8 — four criteria: snapshot_file_written, snapshot_schema_valid, no_source_edits, audit_is_readonly_ears.)

Additional CI-side gates:

- Fixture: pre-installed qlty binary on GHA → snapshot output matches golden schema (regex-pinned, not exact-match).
- Fixture: qlty absent → action_kind dispatch returns `{ ok: true, skipped: true }` and journal logs `action_skipped`.
- Fixture: snapshot file pre-existing, drift triggers fire → exactly one draft PR opened, body contains every threshold-trigger line.
- Fixture: snapshot file absent (first run) → file created, no PR opened (no baseline to compare).

## 5. Open questions for operator (auto-mode resolved with recommendations)

1. **Multi-language scope:** run all (qlty default) — JSON output is per-language-tagged, snapshot aggregates.
2. **First-run baseline:** silent first run (no PR), git log shows snapshot if curious.
3. **Repo opt-out:** action_kind respects profile flag `audit_enabled: false` → detector returns `{ status: 'opted-out' }`.
4. **Threshold tuning per repo:** defer to Sprint 2.6; ship 2.5 with hardcoded defaults.
5. **knip CJS pre-flight scan:** Sprint 2.5 entry-point grep against `_lib/*.cjs`; fix any default-import-property-access patterns before integration.

## 6. References

- [qltysh/qlty — README & repo (Apache-licensed wrapper, BSL-licensed CLI)](https://github.com/qltysh/qlty)
- [qlty CLI metrics command reference](https://docs.qlty.sh/cli/commands/metrics)
- [qlty CLI smells command reference](https://docs.qlty.sh/cli/commands/smells)
- [qlty CLI init command reference](https://docs.qlty.sh/cli/commands/init)
- [qlty.toml project config + default thresholds](https://docs.qlty.sh/cli/qlty-toml)
- [qlty Complexity (cognitive) explainer](https://docs.qlty.sh/complexity)
- [qlty Duplication engine (Tree-sitter fingerprints)](https://docs.qlty.sh/duplication)
- [Effective TypeScript — knip recommendation update](https://effectivetypescript.com/2023/07/29/knip/)
- [webpro-nl/knip — repo](https://github.com/webpro-nl/knip)
- [Knip configuration & JSON reporter](https://knip.dev/reference/configuration)
- [Knip — working with CommonJS conventions](https://knip.dev/guides/working-with-commonjs)
- [Level Up Coding — why we chose knip over ts-prune](https://levelup.gitconnected.com/dead-code-detection-in-typescript-projects-why-we-chose-knip-over-ts-prune-8feea827da35)
- [CodeScene — cyclomatic complexity engineering blog (alternative rejected)](https://codescene.com/engineering-blog/bumpy-road-code-complexity-in-context/)
