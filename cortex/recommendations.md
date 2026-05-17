---
phase: 2-active
date: 2026-05-14
slug: cortex-x
based_on:
  audit: docs/steward-roadmap.md § Sprint 2.21.3 R2 hardening follow-up (6-agent review MEDs, 2026-05-13) + 2026-05-14 CI audit of nightly run 25841360716
  research: docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md; memory/project_cortex_week_plan_14_17_may_2026.md; memory/project_cortex_boris_cherny_transcript_2026_05_13.md
---

# Recommendations — cortex-x

Live recommendations queue Steward reads each nightly cron. Items derive from (a) Sprint 2.21.3 R2 hardening MEDs deferred 2026-05-13, (b) the 2026-05-14 CI audit that flagged Node 20 deprecation in workflow artifacts, (c) Sprint LR.9 and Sprint 2.31 strategic items operator owns. Format follows `bin/steward/_lib/recommendations.cjs` parser contract (`### N.` H3 items per section).

For a worked historical example see [`docs/dogfood-examples/recommendations-cortex-x-2026-05-09.md`](../docs/dogfood-examples/recommendations-cortex-x-2026-05-09.md).

## DO this week (cited)

- [ ] Investigate recurring steward nightly workflow failures [src: https://github.com/Rejnyx/cortex-x/actions/runs/25953368873]
### 1. (DONE 2026-05-14) Add Terminal CLIs subsection to shared/skills/cortex-help/SKILL.md
~~Original task: open `shared/skills/cortex-help/SKILL.md` and insert a new H3 subsection listing 5 operator-facing terminal CLIs.~~ **Shipped in commit `4a8f65a` 2026-05-14 morning during the cortex-help index drift fix, BEFORE this recommendations.md item was authored.** When Steward picked it up at 09:05 UTC on the manual `workflow_dispatch` run (action_id `01KRJVQNT9YRGQXMNE5T52DKXZ`, $0.00097 OpenRouter cost), the LLM read the item literally and added a duplicate subsection alongside the existing one (PR #10, closed without merge 2026-05-14). The existing section from `4a8f65a` is strictly better — more detailed flag info, mentions internal CLIs in the bin/README.md link. Lesson: when seeding recommendations.md from operator backlog, verify each item against current filesystem state before writing it; consider a spec-verifier criterion that fails when the insertion target already exists with similar content (backlog item below).
[audit: PR #10 diff + commit 4a8f65a] [src: shared/skills/cortex-help/SKILL.md:60-71]

### 2. (DONE 2026-05-14) Tighten backup file permissions to 0o600 in cortex-hooks-register.cjs and cortex-claude-md-augment.cjs
~~Original task: pass `{ mode: 0o600 }` to backup writes so OAuth tokens / API keys in `~/.claude/settings.json` are not exposed via umask default, extend both unit-test files with assertion.~~ **Shipped manually 2026-05-14 after Steward run `25851983569` failed at the engine with `Error: edit bin/cortex-claude-md-augment.cjs: ops include str_replace/insert which require expectedSha256 (64-char hex)`** — the LLM (deepseek/deepseek-v4-flash) generated str_replace/insert ops without the SHA-injected `expectedSha256` field that Sprint 2.2.5 v1.5 requires. The safety mechanism worked correctly (atomic rollback, no commit, no PR). Manual implementation: `fs.writeFileSync(backupPath, raw, { encoding: 'utf8', mode: 0o600 })` in both CJS, plus `if (process.platform !== 'win32') { assert.strictEqual(stat.mode & 0o777, 0o600) }` in both test files (Windows skip — mode bits not honored). 2697/2697 tests pass.
[audit: PR (none) + Steward run 25851983569 failure log] [src: bin/cortex-hooks-register.cjs:138 + bin/cortex-claude-md-augment.cjs:179]

### 3. Preserve input EOL style in bin/cortex-claude-md-augment.cjs
Open `bin/cortex-claude-md-augment.cjs` near lines 165-167 where the augment block injects `\n` separators. Add a helper `detectEol(content)` that returns `'\r\n'` if `content.match(/\r\n/g).length > content.match(/(?<!\r)\n/g).length / 2`, else `'\n'`. Sniff once on read, use the detected EOL throughout write operations. Today the implementation unconditionally writes `\n` which produces mixed-EOL output on Windows CRLF files and noisy git diffs. Add a fixture test `tests/unit/cortex-claude-md-augment.test.cjs` with a CRLF-input CLAUDE.md, run `--apply`, assert resulting file has zero lone-LF lines. Net change: ~20 lines of CJS + ~25 lines of test.
[audit: docs/steward-roadmap.md § Sprint 2.21.3 MED 3 CRLF preservation] [src: bin/cortex-claude-md-augment.cjs:165-167]

### 4. Open backup + tmp paths with wx flag in hooks-register and claude-md-augment
Open `bin/cortex-hooks-register.cjs` (lines 138 and 150) and `bin/cortex-claude-md-augment.cjs` (lines 139 and 153). At each `fs.writeFile` / `fs.copyFile` call that produces a tmp or backup file, add `flag: 'wx'` to the options object. The `wx` flag aborts the write if the target path already exists or is a symlink, providing defense-in-depth against TOCTOU symlink swaps. Target dir is user-owned so practical attack surface is low, but the fix is one option object change per call site. Add a fixture test per CJS that pre-creates a symlink at the expected backup path and asserts the apply step exits with a clear error rather than overwriting through the symlink.
[audit: docs/steward-roadmap.md § Sprint 2.21.3 MED 1 TOCTOU symlink safety] [src: bin/cortex-hooks-register.cjs:138,150 + bin/cortex-claude-md-augment.cjs:139,153]

### 5. Bump actions/upload-artifact pinned SHA across all steward workflows
Open every `.github/workflows/steward-*.yml` plus `.github/workflows/install-smoke.yml`. Locate every `uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` line and replace it with the current Node-24-compatible release pinned by SHA. Web-research the latest `actions/upload-artifact` v4 release SHA at https://github.com/actions/upload-artifact/releases before writing the new value. Keep the inline `# v4` (or appropriate version) comment. Node 20 deprecation in GitHub Actions runners lands 2026-06-02; after that, the artifact upload step warns and eventually fails. Do NOT change any other workflow logic. Approximately 16 files touched, one-line edit each.
[audit: Node 20 deprecation warning in workflow log of nightly run 25841360716 (2026-05-14)] [src: .github/workflows/steward-*.yml uses: lines + GitHub blog 2025-09-19 deprecation announcement]

### 6. Add fast-check property tests for computePlan and computeNext reducers
Add `tests/unit/cortex-hooks-register-properties.test.cjs` and `tests/unit/cortex-claude-md-augment-properties.test.cjs`. Each file uses `fast-check@4` (already in dev deps) to assert three invariants on the relevant pure reducer (`computePlan` for hooks-register; `computeNext` for claude-md-augment): (a) idempotency — `reduce(reduce(x)) === reduce(x)`, (b) user-content preservation — for any user input that contains no cortex-owned markers, `reduce(x).userEntries === x.entries`, (c) roundtrip — `apply` then `remove` returns byte-identical original modulo trailing newline. Cap shrunk-input size at 4 KiB; aim for ≥50 random cases per property. The reducer functions are exported from their CJS module via `module.exports = { ..., computePlan }` / `computeNext` — if not already exported, add the named export. Do NOT modify the reducer logic; only add tests + export if missing.
[audit: docs/steward-roadmap.md § Sprint 2.21.3 MED 7 property tests on pure reducers] [src: standards/correctness.md § Practice 2 property-based testing + fast-check@4 dev dep]

## DO this sprint (cited)

### 7. [HUMAN-ONLY] Sprint LR.9 Story D — write docs/positioning-evolution.md strategic memo
Boris Cherny (Sequoia transcript) explicitly stated "the harness kind of gets less important [as model improves]... all the safety mechanisms will just be less important cuz the model will just do the right thing." This forces a positioning evolution for cortex's launch pitch — current pitch leans ~60% on harness/safety + ~40% on wisdom encoding; 12-month-stable pitch must invert to ~20% harness + ~80% wisdom. Write `docs/positioning-evolution.md` with sections: (1) Today vs 12-months-out value split with table, (2) what cortex doubles down on (lessons-jsonl Sprint 2.8.1+, projects library, cross-project pattern detection Sprint 3.4, wiki consolidate Sprint 2.8.2, cortex-thinker insights, Steward as wisdom-applier not safety-net), (3) what cortex deprioritizes (rigid behavior enforcement, additional safety hooks, deny-list expansion stays tier-1 not tier-0). This memo is upstream SSOT for LR.9 Stories A/B/C content drafts (README hero, Show HN body, Product Hunt tagline). Operator-owned because it's strategic positioning, not autonomous-actionable.
[audit: docs/steward-roadmap.md § Sprint LR.9 Story D] [src: memory/project_cortex_boris_cherny_transcript_2026_05_13.md + docs/transcripts/boris-black-vibecoding.md]

### 8. [HUMAN-ONLY] Sprint 2.31 — Cost-safety abstraction for engine-aware budget tracking
Generalize `bin/steward/_lib/cost-safety.cjs` from USD-only tracking to a multi-currency abstraction. Today `STEWARD_DAILY_USD_CAP` / `WEEKLY_USD_CAP` / `MONTHLY_USD_CAP` assume OpenRouter pay-as-you-go USD pricing. After 2026-06-15 the operator's Max x20 Anthropic Agent SDK $200/mo credit becomes claimable, and the `claude-cli` engine (`bin/steward/_lib/action-engine.cjs:1416-1465`, already implemented, uses `CLAUDE_CODE_OAUTH_TOKEN`) is the natural credit-eligible path. Introduce a `BudgetTracker` interface with `getCurrency()`, `consume(amount)`, `getRemaining()`, and per-engine implementations. Wait for Anthropic to publish the claim flow before locking the credit-units tracking shape. Then ship the abstraction + onboarding docs in `prompts/onboarding-first-10min.md`. Update `cortex-doctor` to surface remaining credit budget when `STEWARD_ENGINE=claude-cli`. Operator-owned because Anthropic's claim flow may modify terms.
[audit: memory/project_cortex_week_plan_14_17_may_2026.md § Anthropic Agent SDK credit signal 2026-05-14] [src: Anthropic Help Center article 15036540 + bin/steward/_lib/cost-safety.cjs current USD-only impl]

## Backlog (someday)

(Wishes — promote to `## DO this week (cited)` and assign a number when ready.)

- Sprint 2.27 + 2.30 co-ship — augment BLOCK_VERSION 2→3 (verification discipline + plan-mode + ultrathink mentions) + worktree-aware Steward (`bin/steward/_lib/worktree-guard.cjs` refuses non-primary worktree)
- Sprint 2.28 — `cortex-permissions-register` CLI shipping safety-floor deny + allow baseline to `~/.claude/settings.json`
- Sprint 2.29 — Profile-level `recommended_mcp_servers:` field, Context7 default for ai-agent / chatbot-platform / nextjs-saas / browser-agent / qa-engineer
- Markers inside fenced code blocks fix — `bin/cortex-claude-md-augment.cjs` `CORTEX_BLOCK_RE` should not match inside fenced code blocks (Sprint 2.21.3 MED 4)
- Concurrent-mutate lockfile (`~/.cortex/.cortex-mutate.lock`) for hooks-register + claude-md-augment (Sprint 2.21.3 MED 5)
- Install partial-failure rollback hint (`install.sh:649-706`) — print "partial-install state — rollback with `cortex-hooks-register --remove`" on inter-step error (Sprint 2.21.3 MED 8)
- `--remove` whitespace preservation — collapse `\n{3,}` only inside the stripped block region, not the whole file (`bin/cortex-claude-md-augment.cjs:202`, Sprint 2.21.3 MED 6)
- Fix scaffold template at `cortex/recommendations.md` (or wherever the template lives in profiles/) — current scaffold uses `- [ ]` checkbox format but parser at `bin/steward/_lib/recommendations.cjs:77` expects `### N.` H3 headings. Drift caught 2026-05-14 when filling cortex's own recs file.
- Spec-verifier `no_duplicate_insertion` criterion — fail action if the proposed H2/H3 heading or anchor already exists in the target file with similar (Levenshtein ≤ 3 from title) content. Caught 2026-05-14 when Steward duplicated the Terminal CLIs subsection in PR #10 because recommendations.md item #1 was stale relative to file state shipped earlier same day in commit 4a8f65a.
- Reconcile `action_kinds` count discrepancy: `cortex/capabilities.md` = 19, `CLAUDE.md` Status block = 17 (definitional gap; align CLAUDE.md to capabilities since capabilities.md is auto-generated from filesystem)
- Sprint 4.0.1 — agentskills.io ecosystem participation (README ecosystem section + cortex-doctor third-party-skill awareness + cortex-skills registry publish)
