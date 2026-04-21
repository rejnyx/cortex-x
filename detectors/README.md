# detectors/ — cortex-x auto-optimization layer

> Deterministic, read-only, fail-open scanners that classify a project's state so cortex-x can surface suggestions, apply safe defaults, or guide the user through ambiguous decisions. **No LLM. No network. No process spawn.** <100ms per detector.

See `../standards/auto-optimization.md` for the wizard philosophy this layer implements.

## Files

- `_lib/score.cjs` — shared scoring + ranking library
- `detect-profile.cjs` — matches CWD signals against `profiles/*.yaml` `detect:` blocks (workspace-aware: Nx/Turbo/Lerna/Rush/Moon/pnpm, language gate for non-JS stacks)
- `detect-stage.cjs` — classifies project maturity (greenfield / prototype / mvp / growth / mature), with no-git structural fallback
- `detect-sister-env.cjs` — scans sibling `.claude/settings.json` files for env flags present in ≥2 siblings but missing from target; surfaces as suggestions for retrofit. Prevents the failure mode from portfolio retrofit 2026-04-21 (sister-project env pattern missed).
- (future) `detect-stack.cjs` — drills into stack subsystems (DB provider, AI provider, deploy target)

## Usage — CLI

```bash
# In a cortex-x scaffolded project
node ~/.claude/shared/detectors/detect-profile.cjs
node ~/.claude/shared/detectors/detect-stage.cjs

# JSON output for programmatic consumption
node ~/.claude/shared/detectors/detect-profile.cjs --json

# Different working directory
node ~/.claude/shared/detectors/detect-profile.cjs --cwd /path/to/project
```

## Usage — from code

```js
const { detect } = require('./detectors/detect-profile.cjs')
const result = detect(process.cwd())

if (result.top && result.top.confidence === 'high') {
  // auto-apply eligible
  console.log(`Detected profile: ${result.top.name}`)
} else if (result.top && result.top.confidence === 'medium') {
  // surface suggestion, let Claude offer to user
} else {
  // ambiguous — fall back to discovery questions
}
```

## Contract (all detectors)

Every detector under this directory MUST respect:

| Requirement | Why |
|---|---|
| **Deterministic** — same inputs → same outputs | reproducibility, no surprise behavior |
| **<100ms per run** | runs at SessionStart; cannot block session |
| **No LLM calls** | detectors are the fast path; LLM classifier is fallback elsewhere |
| **No network** | zero latency, zero cost, offline-safe |
| **No process spawn** (except short `git` commands in detect-stage) | predictable, no shell surface |
| **Read-only** — never mutate fs | safe to run repeatedly |
| **Fail-open** — return `{ candidates: [], error: "..." }` on any failure | a detector outage never breaks a session |
| **Evidence-backed** — every candidate carries `matched` + `evidence` | user can see WHY cortex-x picked a result |

## Confidence levels (shared across detectors)

From `_lib/score.cjs`:

| Score | Label | Action |
|---|---|---|
| `≥ 0.9` | `high` | auto-apply eligible (if change is reversible + not Rule-1 SSOT) |
| `0.6–0.9` | `medium` | SUGGEST — surface in Claude context, user decides |
| `0.3–0.6` | `low` | GUIDE — ambiguous, ask user directly |
| `< 0.3` | `none` | no signal, ignore |

## Output schema

`detect-profile.cjs`:
```json
{
  "candidates": [
    {
      "name": "nextjs-saas",
      "score": 0.91,
      "confidence": "high",
      "evidence": ["2/2 expected deps present", "1/1 expected paths present"],
      "matched": ["deps:next,@supabase/ssr", "files:supabase/migrations/"],
      "missed": []
    }
  ],
  "top": { "...same shape..." },
  "elapsed_ms": 47,
  "cwd": "/abs/path"
}
```

`detect-stage.cjs`:
```json
{
  "stage": "mvp",
  "confidence": 0.85,
  "evidence": ["commits:127", "tests:yes", "ci:yes"],
  "signals": { "is_git": true, "commit_count": 127, "...": "..." },
  "suggestions": ["add evals/ directory (correctness.md → eval-driven dev)"],
  "elapsed_ms": 34
}
```

## How to add a new detector

1. Create `detectors/<name>.cjs`
2. Follow the contract above — deterministic, fast, fail-open, evidence-backed
3. Export `detect(cwd, options)` returning a structured result
4. Add CLI block (`require.main === module`) for standalone invocation
5. Wire into `shared/hooks/session-start.cjs` if surface-worthy at session boot
6. Document in this README

## How to add a new signal to detect-profile

1. Add the signal to `profiles/<name>.yaml` under `detect:`:
   ```yaml
   detect:
     package_json:
       dependencies:
         - "@anthropic-ai/sdk"
     files:
       - src/lib/ai/tools/
     config_files:
       - next.config.ts
     negative_signals:
       - jquery  # if present, this is NOT a modern SaaS
   ```
2. The scorer in `_lib/score.cjs` picks it up automatically — deps 40%, files 30%, configs 20%, negative 10%.
3. Run the detector in a test project to validate confidence scores.

## Not in scope (explicitly)

- **LLM-based project classification** — lives in `prompts/` (e.g., retrofit.md uses LLM for ambiguous existing projects). Detectors are deterministic only.
- **Continuous file-watcher re-scan** — detectors run at SessionStart + explicit `cortex-doctor` invocation. Not on every file change.
- **Writing to `standards/` / `agents/` / `prompts/`** — Rule 1 SSOT blocker. Detectors only READ.
- **Running `pnpm install` / `git init` / mutations** — detectors never install deps or modify state.

## Cross-references

- `standards/auto-optimization.md` — wizard philosophy, when auto vs ask
- `standards/self-correction.md` — why detectors are deterministic, not LLM-based
- `shared/hooks/session-start.cjs` — surfaces detector output in session context
- `prompts/cortex-doctor.md` — uses detectors for drift checks
- `prompts/new-project.md` — uses detectors at scaffold for retrofit branch
- `prompts/retrofit.md` — detectors ARE the Phase 1 audit in retrofit flow
