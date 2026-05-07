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

### Sprint 1.6.8 — Unified Hermes CLI + Tier 6 + Tier 7 (2026-05-07 late night)

#### Non-breaking (additive — no migration required)

- **What landed:** three additive deliverables across one autonomous run:
  - **`bin/cortex-hermes.cjs`** — unified entrypoint that dispatches `dry-run` and `status` subcommands to existing `bin/hermes/<sub>.cjs` scripts. Single CLI surface for users; underlying scripts remain individually invocable. `cortex-hermes help` and `cortex-hermes --version` both implemented. 10 contract tests in `tests/unit/hermes/cli-dispatch.test.cjs`.
  - **Tier 6 — bin/ tools contract tests** (`tests/contract/bin-tools-shape.test.cjs`, 13 tests). Black-box invocations of `cortex-bootstrap` (env-driven mode-new/existing/framework, marker-file shape, marker-overwrite, invalid-mode exit-2, non-interactive exit-2) + `cortex-gap-report` (graceful empty-log, --json schema, --help, --since filter, seeded-aggregate, --raw output). Closes one of the three pre-launch gates.
  - **Tier 7 — standards link integrity** (`tools/verify-standards.cjs` + `tests/contract/standards-shape.test.cjs`, 13 tests). Validator scans every `standards/*.md` for: file exists + non-empty, internal markdown link resolution (relative-to-file OR repo-root), code-fence balance, PII denylist (matcher matches the maintainer's local path + personal email). First run surfaced **3 real issues** in `standards/ship-ready.md`: 2 broken links to `research/beta-distribution-2026-04-17.md` (file moved to `$CORTEX_DATA_HOME/research/` per Sprint 1.6 XDG separation but standards/ kept the stale ../research/ relative link) + 1 PII self-reference (the file mentioned `davidrajnoha@` in a "what NOT to commit" example, which itself matched the denylist). All 3 fixed in this sprint. Tier 7 closes the second of the three pre-launch gates.
  - `prompts/cortex-doctor.md` gets new §13.7 "Standards link integrity" between §13.6 (prompt + SKILL.md regression) and §14 (citation drift). The three §13.x sections now form a complete structural-validation triad: §13.5 audit deliverables, §13.6 prompts + skills, §13.7 standards.
  - `tests/smoke/verify-install.cjs` extended to require `tools/verify-standards.cjs` as a warning-severity check (mirrors verify-prompts + verify-skills install verification).

- **npm scripts added:**
  - `npm run hermes` — passthrough to `bin/cortex-hermes.cjs`
  - `npm run hermes:status` — passthrough to `bin/hermes/status.cjs`
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

- **What landed:** Hermes runtime v0 minus the Claude Agent SDK call. Six zero-dep CJS primitives in `bin/hermes/_lib/` + one orchestrator at `bin/hermes/dry-run.cjs` + 6 unit-test files (95 unit tests) + 1 integration suite (16 fixture-driven tests). Total +111 tests; full suite 227 → 338 green.
  - **`bin/hermes/_lib/halt-check.cjs`** — file-based kill switch detection (MUST-H5). Two sentinel paths checked at every tool-call boundary: `~/.cortex/HERMES_HALT` (fleet) and `<repo>/.cortex/HERMES_HALT` (per-project). CLI mode exits 75 (EX_TEMPFAIL) if halted. Fleet sentinel takes precedence when both present.
  - **`bin/hermes/_lib/lock.cjs`** — per-project mutex (MUST-H2). Atomic acquire via `fs.writeFileSync({flag: 'wx'})` to `cortex/journal/<slug>/.lock`. Stale-lock recovery if mtime > 2× action timeout (default 30 min). EEXIST_FRESH error with held-by metadata when lock is fresh.
  - **`bin/hermes/_lib/journal.cjs`** — append-only structured writer (MUST-H4). Manual schema validation (zero-dep equivalent of Zod) on every entry: ts/trigger/tier/event required, cost_usd/tokens optional with non-negative constraints, outcome/actor enum-validated. PII redaction at write time: homedir → `<HOME>`, sk-…/ghp_…/Bearer …/eyJ… all replaced with `<REDACTED>` tokens. Per-day JSONL files at `$CORTEX_DATA_HOME/journal/<slug>/<YYYY-MM-DD>.jsonl`.
  - **`bin/hermes/_lib/recommendations.cjs`** — parser for `cortex/recommendations.md`. Extracts YAML frontmatter (slug required), parses `## DO this week (cited)` and `## DO this sprint (cited)` sections, extracts numbered action items (`### N. Title`) with [audit:] / [src:] citations. `pickNextAction()` returns first DO-this-week item not yet present in journal-derived processed-actions set.
  - **`bin/hermes/_lib/git-trailers.cjs`** — Conventional Commits + Git trailer builder (MUST-H3). ULID generator (zero-dep, monotonic), subject validation (≤72 chars, valid type), trailer validation (required keys present, no newlines in values), `parseTrailers()` round-trip-safe parser that mirrors `git interpret-trailers --parse` for cases we care about.
  - **`bin/hermes/_lib/policy-check.cjs`** — Hermes Ring 1 denylist (over `block-destructive.cjs` Ring 2). 9 rules: HERMES_HALT preservation, human_only path protection (standards/, prompts/, profiles/, agents/, CLAUDE.md, README.md, module.yaml), auto-merge prevention (`gh pr merge`, `git merge main`), prod-mutation prevention (vercel deploy --prod, supabase db push --linked, kubectl prod), force-push + hard-reset (also caught by block-destructive.cjs at Ring 2). Tool-aware check separates Edit/Write/MultiEdit (file_path argument) from Bash (free-text command).
  - **`bin/hermes/dry-run.cjs`** — orchestrator that wires all six primitives end-to-end. CLI invocation: `node bin/hermes/dry-run.cjs --slug=<slug> [--repo-root=<path>] [--trigger=cron|incident|pr-merged|manual] [--json]`. Library invocation: `runDryRun(opts)` returns the structured plan. Steps: halt check → lock acquire → recommendations parse → action pick (skip already-processed via journal) → build branch name (`hermes/<YYYY-MM-DD>-<slug>-<id>`) → build Conventional Commits + trailers commit message → policy pre-flight on action body → journal entry append → lock release. No Claude Agent SDK call; outputs WHAT Hermes would do, not the actual edits.

- **Tests landed:**
  - `tests/unit/hermes/halt-check.test.cjs` — 7 tests (clean-state default, project sentinel, fleet sentinel + precedence, contract surfaces)
  - `tests/unit/hermes/lock.test.cjs` — 9 tests (acquire/release, idempotent release, EEXIST_FRESH collision, multi-slug isolation, stale-lock recovery, fresh-lock-not-recovered, lock dir mkdir)
  - `tests/unit/hermes/journal.test.cjs` — 21 tests (8 schema validations, 5 PII-redaction scenarios, 4 append+read, 2 append-only contract, 1 contract surface, 1 PII at write-not-read)
  - `tests/unit/hermes/recommendations.test.cjs` — 14 tests (frontmatter parse, action item extraction, citations, full parse, slug-required, DO-this-week-required, action picker dedup, fixture integration)
  - `tests/unit/hermes/git-trailers.test.cjs` — 19 tests (ULID, subject validation, trailer validation, buildSubject, buildCommitMessage end-to-end, parseTrailers round-trip, contract surfaces)
  - `tests/unit/hermes/policy-check.test.cjs` — 25 tests (sentinel preservation, source-of-truth protection per path family, auto-merge prevention, prod-mutation prevention, git destructive ops, allow-paths, utilities)
  - `tests/integration/hermes-dryrun.test.cjs` — 16 tests (happy path, dedupe across runs, halt + lock semantics, error paths, journal contract, CLI entry)

- **Bugs caught by tests during implementation:**
  - `parseTrailers` mishandled commit messages with trailing newlines (the canonical case — `git commit -F -` always trails) — fixed by stripping trailing empties before scanning, plus rewriting the algorithm to find the LAST blank line and walk forward instead of finding the first blank from end
  - `policy-check` HUMAN_ONLY_PATH/HUMAN_ONLY_TOPLEVEL regexes required `\b(write|edit|delete|rm)\b` BEFORE the path, but `flattenArgs` produced unpredictable arg-value order. Fix: introduce tool-aware `checkWriteTool()` that matches on `args.file_path` directly when toolName is Edit/Write/MultiEdit/NotebookEdit. Pattern-based regex layer kept for Bash command rules.

- **npm scripts added:**
  - `npm run test:hermes` — runs unit + integration tests for Hermes only (~110 tests in ~1s)
  - `npm run hermes:dry-run` — CLI passthrough to `bin/hermes/dry-run.cjs`

- **Why:** Hermes RFC pre-merge checklist gate 5 ("First Hermes-driven PR auto-generated against a fixture project") needed to land before runtime code. Dry-run orchestrator IS the first deliverable: it produces a valid Conventional-Commits-shaped commit message with Git trailers, identifies the action to take, journals the run — every step EXCEPT the Claude Agent SDK call. The remaining LLM integration becomes a single seam to wire in v0.5.

- **Migrate:** none — purely additive. Existing installs unaffected.

- **Rollback:** revert this commit. The 6 primitives + dry-run orchestrator + 7 test files form one logical unit; revert removes them all together.

- **What's next (v0.5):** integrate Claude Agent SDK so the dry-run plan drives an actual `git commit -F -` + `gh pr create --draft`. The dry-run already produces a valid commit message; v0.5 wires the LLM-driven file edits + verification (`npm test`) gate. Estimated 4-8h, single session.

### Sprint 1.6.6 — README↔reality alignment + Hermes pre-work (2026-05-07)

#### Non-breaking (additive — no migration required)

- **What landed:** three commits closing the third pre-Hermes RFC gate:
  - **README/CLAUDE.md alignment** (commit `58857bf`) — external senior review flagged Phase 5 as overpromising ("✅ v1 done 2026-04-17" implied an automated runtime; reality is prompts + config + eval rubrics). Status calibrated to "✅ designed + specs / ⏳ runtime in Phase 7". Phase 7 — Hermes runtime added explicitly. Phase 1 marked ✅ shipped (Tier 0-5 QA infrastructure landed). Phase 2-4 marked ⚠️ partial with concrete what-ships-vs-what-defers. New "XDG separation (Sprint 1.6)" callout under repo structure explains the empty-looking `projects/` dir holds README only; actual project library entries live in `$CORTEX_DATA_HOME/projects/`.
  - **Hermes pre-work design pass** (commit `a4844c1`) — three parallel background research agents dispatched (topology, triggers/safety, git workflow), each returned 800-1200 word brief grounded in production-agent precedent (Devin, Sweep, Copilot, Aider, Cline, Cognition essay, Anthropic SDK docs, OWASP LLM10, Temporal mutex). Three new files: `docs/hermes-research-synthesis.md` (decisions taken — 11-row table per architectural concern, 9 RFC open questions answered), `standards/hermes-policy.md` (Tier 2 — 7 hardcoded refusals + 7 Hermes-specific MUST patterns + denylist + cost ceilings + 4-tier escalation), `docs/hermes-runtime.md` (5 components + 4 ASCII sequence flows + v0 explicit non-scope). Three architectural pivots from RFC stub: (1) `hermes/<date>` daily-rolling → `hermes/<YYYY-MM-DD>-<slug>-<id>` branch-per-action (matches Devin/Sweep/Copilot precedent); (2) free-text journal lookup → Git trailers (`Hermes-Action-Id`, `Hermes-Journal-Entry`, `Hermes-Trigger`, `Hermes-Reverts` parseable via `git interpret-trailers`); (3) vague safety layer → file-based poison pill at `~/.cortex/HERMES_HALT` + `<repo>/.cortex/HERMES_HALT`. RFC checklist updated: 4 of 5 gates closed (fixture remains).
  - **hermes-dryrun fixture + 18-test contract** (commit `9fc3a5b`) — `tests/fixtures/hermes-dryrun/` shipped: README, CLAUDE.md, package.json, src/index.js, tests/smoke.test.cjs, cortex/recommendations.md (frontmatter + ## DO this week section with 3 trivial action items + citation markers). New contract test `tests/contract/hermes-fixture-shape.test.cjs` with 18 assertions across 5 describe blocks (structural shape, recommendations.md parseable contract, PII + env safety, package.json hygiene, smoke-test sanity). First run caught a self-bug: README documented "no davidrajnoha@" as PII example, which itself matched the PII regex — fixed by switching to generic phrasing. Suite: 207 → 227 tests, all green; test:fast 197 → 217 tests in ~1.6s.

- **Why:** external review (2026-05-07) ranked README↔reality alignment as the #1 next move; honest status is also a prerequisite to Hermes runtime work (you can't tell users "Hermes runs Phase 5 cron" if Phase 5 is ⏳ pending). Hermes pre-work: per RFC, both `standards/hermes-policy.md` + `docs/hermes-runtime.md` had to land before any runtime code merges. Fixture: per RFC checklist gate 5, "First Hermes-driven PR auto-generated against a fixture project" needs the fixture to exist first.

- **Migrate:** none — purely additive. Existing installs unaffected.

- **Rollback:** revert commits `9fc3a5b` `a4844c1` `58857bf` (in any order — they don't depend on each other).

- **Pre-Hermes RFC checklist (per `docs/hermes-rfc.md`):**
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
