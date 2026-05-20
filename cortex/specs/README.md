# cortex/specs/ — per-action_kind acceptance criteria archive

**Status**: Sprint 1.9.0 shipped 2026-05-09. Active source of truth is **`bin/steward/_lib/action-kinds.cjs`** — every shipped kind declares its `acceptance_criteria[]` array there directly. This directory now holds the **human-readable archive + extension specs** for kinds that need richer documentation than fits in the registry.

## Authoritative location

`bin/steward/_lib/action-kinds.cjs` is the single source of truth. Each kind's `acceptance_criteria: [...]` array is loaded at runtime by `bin/steward/_lib/spec-verifier.cjs` and gated by:

- **Contract test** [`tests/contract/action-kinds-acceptance.test.cjs`](../../tests/contract/action-kinds-acceptance.test.cjs) — every shipped kind declares ≥ 1 criterion; every criterion validates; ids are unique within a kind.
- **Integration test** [`tests/integration/steward-spec-verification.test.cjs`](../../tests/integration/steward-spec-verification.test.cjs) — end-to-end PR #3 / PR #4 reproductions through `execute.cjs`.

If you need to read what criteria fire for a given kind right now, read the registry directly. The R1 decision memo deliberately rejected a parallel YAML schema to avoid two sources of truth diverging.

## What lives here

This directory is reserved for files that *extend* (never duplicate) the registry:

- **Per-kind expanded EARS contracts** — when a kind grows beyond ~5 criteria and the inline `description` field in `action-kinds.cjs` becomes cramped, lift the human-readable narrative here. Filename: `<kind>.spec.md` (markdown, not YAML).
- **Plan-level override examples** — illustrative `plan.acceptance_criteria` overrides showing how a one-off `recommendation` action can strengthen the registry's defaults (e.g. "this specific edit requires 80% byte preservation, not 50%").
- **Cross-kind invariants** — criteria that should fire on EVERY kind (e.g. denylist-untouched, no-secrets-in-content). Naming: `_common.spec.md`.

## Schema (criterion shape — quick reference)

The full schema lives in [`bin/steward/_lib/spec-verifier.cjs`](../../bin/steward/_lib/spec-verifier.cjs) at the top of the file. Quick reference:

```js
{
  id: 'no_destructive_rewrite',           // stable string key, unique within kind
  kind: 'shell' | 'file_predicate' | 'regex' | 'ears_text' | 'llm_judge',
  description: 'human-readable purpose',  // surfaces in journal + PR body
  severity: 'block' | 'warn',             // default 'block'
  applies_to: ['docs/**'],                // optional glob; null/missing = all touched
  // kind-specific:
  cmd: 'npm run lint -- --no-fix',                                      // shell
  predicate: 'touchedFiles.every(p => fileSize(p) >= prevSize(p)*0.5)', // file_predicate
  pattern: '^Sprint 1\\.[78]\\.', flags: 'm',                           // regex
  ears: 'WHEN edit.replace_all=false THE SYSTEM SHALL preserve >= 50%', // ears_text
  timeoutMs: 30000,                                                     // shell timeout cap
}
```

### file_predicate context (curated argument list)

Inside a predicate string, these helpers are in scope (no `require`, no `process`, no module-scope bindings):

- `touchedFiles` — array of relative paths edited this action
- `fileSize(rel)` — current size in bytes (post-edit)
- `fileExists(rel)` — boolean
- `fileContent(rel)` — UTF-8 string
- `prevSize(rel)` — pre-edit size in bytes (0 if file did not exist)
- `edits` — array of `{ path, replace_all }` from `applyEditsToFilesystem`
- `plan` — full plan object

### EARS patterns (5 canonical forms, runtime no-op in 1.9.0)

| # | Form | Pattern |
|---|------|---------|
| 1 | Ubiquitous | `THE SYSTEM SHALL <response>` |
| 2 | Event-driven | `WHEN <trigger> THE SYSTEM SHALL <response>` |
| 3 | State-driven | `WHILE <state> THE SYSTEM SHALL <response>` |
| 4 | Optional feature | `WHERE <feature> THE SYSTEM SHALL <response>` |
| 5 | Unwanted behaviour | `IF <bad cond>, THEN [the system\|<actor>] SHALL <response>` |

`validateCriterion` rejects clauses that don't match one of the five patterns. The runtime regex array lives in `EARS_PATTERNS` at [`bin/steward/_lib/spec-verifier.cjs`](../../bin/steward/_lib/spec-verifier.cjs) and is the SSOT — this table is narrative documentation kept in sync with that array.

## Failure-mode taxonomy

Every spec-verifier failure surfaces as `result.code` from `execute.cjs`:

| Code | When |
|------|------|
| `SPEC_VIOLATION` | A `severity: 'block'` criterion failed → atomic rollback |
| `SPEC_WARNING` | Only `severity: 'warn'` criteria failed → ok=true, warnings logged |
| `SPEC_MALFORMED` | Registry typo, missing kind-specific field, unknown action_kind |
| `SPEC_PREDICATE_THREW` | `file_predicate` JS threw at compile or runtime |
| `SPEC_SHELL_TIMEOUT` | `shell` cmd exceeded `timeoutMs` |
| `SPEC_REGEX_NO_MATCH` | `regex` pattern absent from target file post-edit |
| `SPEC_OVERRIDE_REJECTED` | Plan override tried to weaken (downgrade / change kind) |
| `SPEC_LLM_JUDGE_NOT_IMPLEMENTED` | `kind: llm_judge` reserved for v2.0+ |

## Reference

- [`bin/steward/_lib/action-kinds.cjs`](../../bin/steward/_lib/action-kinds.cjs) — registry (authoritative)
- [`bin/steward/_lib/spec-verifier.cjs`](../../bin/steward/_lib/spec-verifier.cjs) — runner + validator
- `docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md` — R1 decision memo
- [`docs/troubleshooting.md`](../../docs/troubleshooting.md) — operator-facing remediation guide
- [`MIGRATIONS.md`](../../MIGRATIONS.md) § Sprint 1.9.0 — migration notes
