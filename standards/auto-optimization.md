# Auto-Optimization — Wizard Philosophy

> **Goal:** user of cortex-x should NOT need to remember profile names, decide which standards apply, or manually wire hooks. cortex-x detects project state, suggests upgrades, applies safe defaults, and guides through ambiguous decisions. **Think > Ask > Act** collapses into **Detect > Suggest > (Auto-apply OR Guide)**.

## Tier

**Rule 1.5 extension.** Not inviolable (Rule 1), but a contract on how cortex-x behaves. Violations degrade UX; don't break projects.

## Philosophy — the four levels

cortex-x operates at four behavioral levels. Each level has a clear boundary:

| Level | cortex-x action | HITL gate? | Examples |
|---|---|---|---|
| **DETECT** | Scans state (deterministic, fast, <100ms) | ❌ None — passive | `detectors/detect-profile.cjs` reads `package.json` + file patterns |
| **SUGGEST** | Surfaces findings + upgrade options in Claude's context | ❌ None — info only | SessionStart shows "detected profile: nextjs-saas (confidence 0.91)" |
| **AUTO-APPLY** | Applies safe, reversible defaults silently | ❌ None — reversible | Auto-register session-start hook if `.claude/settings.json` missing it |
| **GUIDE** | Interactive prompt, user picks path | ✅ Explicit choice | "Ambiguous profile — is this AI-heavy or AI-ready?" (Czech, conversational) |
| **MUTATE** | Writes to `standards/`, `agents/`, institutional memory | ✅ **Always HITL** (Rule 1) | User must PR-approve changes to cortex-x governance |

**Rule:** auto-apply ONLY when:
1. Detection confidence ≥ 0.9
2. Change is reversible (user can undo without data loss)
3. Change does not touch Rule-1 SSOT sources (standards/, agents/, institutional wisdom)

If ANY of 1-3 fails, downgrade to **SUGGEST** or **GUIDE**.

## When auto wins vs when ask wins

**Auto-DETECT / SUGGEST / AUTO-APPLY wins when:**
- Project has signal (package.json deps, file patterns, git history). Signal > heuristic.
- Retrofit: user has a messy existing project and can't answer "what profile" precisely
- Drift over time: user scaffolded as `minimal`, has since added AI — should surface "looks like you'd benefit from `ai-agent` profile"
- SessionStart: returning to a known project, no need to re-ask

**GUIDE wins when:**
- Greenfield (empty folder). Nothing to detect. User knowledge > any classifier.
- Ambiguous state (confidence 0.4-0.7). Force a decision rather than risk wrong auto-pick.
- Irreversible consequence (scaffolding 30 new files, sending destructive commit, publishing a tag).

**ASK only in new-project discovery phase.** The 6 Czech questions in `new-project.md` ARE the intent parser. Don't try to detect intent from an empty folder — ask.

## Detection signal taxonomy (reliability matrix)

| Signal | Cost | Accuracy | Best for |
|---|---|---|---|
| `package.json` dependencies (weighted) | near-zero | high (85-95%) | framework + stack detection |
| Lockfile (pnpm-lock / bun.lock / Cargo.lock) | zero | high for tooling | runtime selection |
| Config files (`next.config.*`, `astro.config.*`, `tauri.conf.json`) | zero | very high | framework confirmation |
| Folder structure (`src/app/api/`, `supabase/migrations/`) | zero | medium-high | feature presence (AI endpoint, DB) |
| Git history (commit count, age, active contributors) | low | medium | project maturity / stage |
| README / docs (first 200 lines) | zero | medium | grounding when deps ambiguous |
| `CLAUDE.md` / `AGENTS.md` / `.cursorrules` | zero | very high | explicit user declaration trumps heuristics |
| Natural-language user prompt | zero | high *if articulate* | greenfield discovery |
| LLM classifier on top-10 files | medium (1 LLM call) | medium-high | **FALLBACK only** when deterministic confidence < 0.6 |

**Rule:** deterministic signals FIRST. LLM classifier ONLY as fallback for ambiguity. Never LLM on greenfield (empty folder = no signal to classify).

## The detector contract

Every detector module under `detectors/` conforms to a contract:

```js
// detectors/<name>.cjs
// Contract:
//   Input:  cwd (string), options (optional)
//   Output: { candidates: [{ name, confidence, evidence }], elapsed_ms }
//   Rules:  <100ms, no LLM calls, no file writes, no network, no process spawn
//           Fail-open: any error → return { candidates: [], error: <msg> }
//
// Usage:
//   const { detect } = require('./detectors/detect-profile.cjs')
//   const result = detect(process.cwd())
//   // result.candidates[0] = most likely profile with evidence

module.exports.detect = function(cwd, options) { /* ... */ }
```

**Strict rules:**
- **Deterministic.** No LLM, no network, no external process.
- **Fast.** <100ms per detector (measure via `elapsed_ms`).
- **Read-only.** Never mutate files, never create directories, never spawn processes.
- **Fail-open.** Return `{ candidates: [], error: "..." }` on any failure. A detector outage must never break a session.
- **Evidence-backed.** Every candidate has explicit `evidence` — the user can see WHY cortex-x picked it.

## Lifecycle — where auto-optimization runs

### At SessionStart (hook)

`session-start.cjs` runs detectors, surfaces findings silently (no blocking):

```
=== myproject — Session Context ===

Auto-detected profile: nextjs-saas (confidence 0.91)
  Evidence: deps:next,@supabase/ssr; files:supabase/migrations/
  Drift: none (matches scaffold profile)
```

If drift detected:
```
Profile drift: scaffolded as 'minimal' (2026-01), current state looks like 'nextjs-saas' (0.88)
  New deps since scaffold: next, @supabase/ssr, openai
  Suggest: `/cortex-doctor` to review upgrade options
```

### At scaffold time (new-project.md)

1. Detectors run on current folder before Phase 1
2. If folder is NON-empty (retrofit scenario) and profile detected with confidence ≥0.7 → skip profile question, use detected
3. If folder is empty (greenfield) → proceed to 6 discovery questions (user is the classifier)

### At retrofit time (retrofit.md)

Detectors ARE the Phase 1. Skip manual questions. Generate retrofit plan from detected state + Rule 1 audit.

### At doctor time (cortex-doctor.md)

Periodic drift check. Compare current detection vs scaffolded profile (captured in `projects/<slug>.md`). Propose upgrade path if drift crosses threshold.

### At review time (code-review.md)

Detectors inform WHICH review agents to spawn:
- Detected AI heavy → spawn correctness-auditor + security-auditor with agentic Layer 9 focus
- Detected browser automation → add browser-security-auditor
- Detected minimal static → skip AI-specific agents

## Safe auto-apply — what's in scope

These are reversible, no-data-loss changes cortex-x MAY auto-apply:

1. **Register session-start hook** in `.claude/settings.json` if missing
2. **Create `.claude/agents/` directory** if project has detected `ai-agent` profile and dir is missing
3. **Add `.claude/settings.json.schema`** pointer (ephemeral, zero risk)
4. **Create empty `evals/` folder** for AI-agent profiles (zero risk, removes friction)
5. **Surface `projects/<slug>.md` stub suggestion** via additionalContext (info only, user writes)

Anything NOT in this list requires SUGGEST or GUIDE, never auto-apply.

## Explicit not-in-scope (auto-apply NEVER)

- Modifying `standards/*.md`, `agents/*.md`, `prompts/*.md` — Rule 1 SSOT blocker
- Editing `package.json` (adding deps) — irreversible install, user intent required
- Running migrations / schema changes
- Creating PRs / commits without user command
- Publishing to npm / calling external APIs
- Any change that touches `~/.claude/` user global config

## Anti-patterns — what wizard philosophy is NOT

- ❌ **Guessing from vibes.** No vibes detection. Deterministic signals or fall back to explicit ask.
- ❌ **Auto-choosing profile on greenfield folder.** Empty state = user knows better, ask via `new-project.md`.
- ❌ **Silent LLM classification on every file change.** Classifier is expensive + opinionated. Use only when static signals are ambiguous.
- ❌ **Continuous re-scan loop.** Detectors run at session-start + explicit `cortex-doctor` invocation. Not every keystroke.
- ❌ **Auto-apply irreversible changes.** Ever.
- ❌ **Detection becomes lock-in.** Always show detection output + allow manual override (`--profile <name>`).

## Failure modes (designed-for)

### FM-1: Confidence too high, detector wrong
**Mitigation:** show evidence + allow override. User sees "deps:next → nextjs-saas (0.95)" and can say "no, this is actually a browser-agent project" — cortex-x trusts the user.

### FM-2: All candidates <0.6 confidence
**Mitigation:** fall back to GUIDE mode. Ask user directly. Better to ask than to pick wrong.

### FM-3: Monorepo breaks detection
**Mitigation:** detector walks workspace definitions (`pnpm-workspace.yaml`, `turbo.json`) + accepts `--cwd apps/web` flag.

### FM-4: Detector takes >100ms
**Mitigation:** timeout + cache `.claude/detected-profile.json` with TTL 24h. Re-run on explicit `cortex-doctor` or when `package.json` mtime changes.

### FM-5: Detector crashes
**Mitigation:** fail-open. Return `{ candidates: [], error: "..." }`. Hook absorbs, session proceeds without detection output.

## Verification

- [ ] Every detector respects contract: `<100ms, no LLM, no network, read-only, fail-open`
- [ ] SessionStart surfaces detection without blocking
- [ ] Low-confidence (<0.6) triggers GUIDE, not silent pick
- [ ] Drift detection compares current state vs scaffolded profile
- [ ] User can override any auto-decision with `--profile <name>`
- [ ] No auto-mutation of Rule 1 SSOT sources

## Philosophy — one-liner

**cortex-x does not ask what it can detect. It does not detect what it cannot verify. It never acts destructively without explicit consent.**

Guide the user when ambiguous. Act silently when confident. Surface evidence for every decision. Let the user override anything.

## Cross-references

- Detector implementations: `detectors/` (`detect-profile.cjs`, `detect-stack.cjs`, `detect-stage.cjs`)
- Profile YAML `detect:` blocks: `profiles/*.yaml`
- SessionStart hook: `shared/hooks/session-start.cjs`
- Drift command: `prompts/cortex-doctor.md`
- Self-healing discipline: `standards/self-correction.md`
- Wizard discovery (greenfield): `prompts/new-project.md`
- Wizard retrofit (existing): `prompts/retrofit.md`
