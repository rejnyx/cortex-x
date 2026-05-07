# Hermes evals (Sprint 1.6.22)

Golden eval cases for the Hermes runtime — validate that the OpenRouter
engine + execute pipeline correctly handle real-world LLM output shapes.

## What's in scope

These evals validate **plumbing + safety**, not prompt quality:

- LLM output → JSON parsing (with/without markdown fences)
- Edit shape gate (`OPENROUTER_PLAN_SHAPE_INVALID`)
- Path safety (absolute, traversal, NUL byte, denylist)
- Empty edits handling
- Cost capture on success + failure paths

Each case feeds a hand-crafted "model output" via `HERMES_MOCK_PLAN` and
asserts the pipeline's response (result.code, touched_files, journal
entries). **No real OpenRouter API calls** — mock engine routes the
behavior identically because it shares `applyEditsToFilesystem` and
all guards with openrouter engine.

## What's NOT in scope

- Real-LLM prompt quality (would need `openrouter` engine + actual API
  calls; gated by cost + flakiness — see Sprint 1.6.23+ for `eval:llm`
  with `OPENROUTER_API_KEY` opt-in)
- Cron trigger semantics (covered by `tests/integration/hermes-dryrun`)
- Lock semantics (covered by `tests/unit/hermes/lock.test.cjs`)

## How to run

```bash
npm test                         # eval cases run as part of full suite
node tools/run-hermes-evals.cjs  # CLI runner with report output
```

## Adding a case

Drop a JSON file in `cases/` matching the schema:

```json
{
  "name": "kebab-case-id",
  "description": "Human description",
  "plan_overrides": { "action": { "title": "..." } },
  "mock_plan": { "edits": [...] },
  "assertions": {
    "result_ok": true,
    "result_code": "ACTION_COMPLETED",
    "touched_files": ["a.js"],
    "forbidden_paths": [".env"],
    "journal_event": "action_completed"
  }
}
```

The loader at `tests/integration/hermes-evals.test.cjs` discovers cases
via `fs.readdirSync` — no code change needed to add a case.

## Case naming

`{phase}-{outcome}-{detail}.json`

- `phase`: `parse` | `apply` | `verify` | `commit`
- `outcome`: `success` | `failure`
- `detail`: short kebab description

Example: `apply-failure-denylist-env.json`
