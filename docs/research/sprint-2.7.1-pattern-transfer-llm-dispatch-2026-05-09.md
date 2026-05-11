---
sprint: 2.7.1
title: pattern_transfer LLM dispatch wire-up
date: 2026-05-09
status: research-complete (autonomous evening session)
based_on: existing Sprint 2.7 v0 implementation + ACTION_KIND_NOT_DISPATCHABLE marker in execute.cjs
---

# Sprint 2.7.1 — pattern_transfer LLM dispatch R1 memo

## 1. Question

Sprint 2.7 shipped pattern_transfer as the 11th action_kind:
- Registry entry in `bin/steward/_lib/action-kinds.cjs` (description, acceptance_criteria, blast_radius=minimal)
- Sibling-manifest validator + sibling-reader primitives in `bin/steward/_lib/`
- Spec-verifier criterion `pattern_transfer_no_cross_repo_edit` (Sprint 2.7.1 hardening: UNC + drive-letter + `..` segment defense)
- Routing-table entry across all 4 profile slots

But the executor at `bin/steward/execute.cjs` line ~1762 returns:
```js
applyResult = {
  ok: false,
  code: 'ACTION_KIND_NOT_DISPATCHABLE',
  error: 'pattern_transfer kind is registered but executor not yet implemented. Wait for Sprint 2.7.1 dedicated commit that wires sibling-reader + LLM dispatch + assertEditWithinCwd spec-verifier hook.',
};
```

Sprint 2.7.1 closes this gap.

## 2. Constraints (from existing v0 work)

- **`requires_llm: true`** — uses LLM (default openrouter engine; claude-cli engine via Sprint 2.4)
- **`cost_envelope: 'normal'`** — ~$0.0008/run on V4 Flash, $0 under Max sub
- **`blast_radius: 'minimal'`** — only appends to `cortex/lessons-learned.jsonl` (current project's file). NEVER edits sibling repos. NEVER edits files outside cwd.
- **`source: 'cortex/sibling-projects.json + sibling repos read-only via sibling-reader.cjs'`** — manifest must exist; if missing, `no_actionable_step` clean exit.
- **Spec-verifier criteria**:
  - `lessons_jsonl_grew_with_source_repo` — output must include `source_repo` field (provenance)
  - `pattern_transfer_no_cross_repo_edit` — touchedFiles must contain ONLY paths inside cwd

## 3. Design

### 3.1 dry-run dispatch

Replace the current `pattern_transfer` no_actionable_step stub in `bin/steward/dry-run.cjs` with:

1. Read `cortex/sibling-projects.json` via `sibling-manifest.cjs` validator. If missing → `no_actionable_step` (cron exits clean, journal `no_actionable_step` event).
2. Read each sibling's `cortex/lessons-learned.jsonl` (or fallback `cortex/journal/`) via `sibling-reader.cjs` with depth + visited-inode caps (already implemented).
3. Build a synthetic plan:
   ```js
   {
     ok: true,
     mode: 'dry-run',
     slug,
     action_kind: 'pattern_transfer',
     action: { num: null, title: 'Distill cross-project patterns', body: ..., action_key: ... },
     branch: `steward/${isoDate}-pattern-transfer-${shortId(actionId)}`,
     planned_commit: { ... 'Steward-Action-Kind': 'pattern_transfer' ... },
     pattern_transfer: {
       siblings_read: [{ repo, lessons_count, harvested_at }, ...],
       harvest_signals: total_signals,
     },
   }
   ```

### 3.2 execute dispatch

Replace the `ACTION_KIND_NOT_DISPATCHABLE` stub in `bin/steward/execute.cjs` with `runPatternTransferAction(plan, opts)`:

1. **Read sibling manifest** (already validated at dry-run time; re-read at execute time for atomic semantics).
2. **Read sibling lessons** via `sibling-reader.cjs` — collect text + source_repo metadata.
3. **Build LLM prompt** with:
   - `<untrusted>...</untrusted>` markers around sibling content (Pattern 1 lethal-trifecta defense)
   - System prompt: "You are reading lessons from sibling cortex-x projects. Distill ANY pattern that applies to the current project. Output JSON: `{ summary, applies_to_kind, source_repo, lesson_text }`. NEVER suggest editing files. NEVER reference paths outside `cortex/lessons-learned.jsonl`."
   - User prompt: concatenated sibling lessons (token-budgeted; if too large, sample N per sibling).
4. **LLM call** via existing `actionEngine.applyAction()` → `engine-openrouter.cjs` or `engine-claude-cli.cjs`. Cost capped via Sprint 2.0b routing-policy (per-action $1 cap).
5. **Apply edit** — append the JSON-formatted lesson(s) to `cortex/lessons-learned.jsonl` ONLY. The applied edit must include path = `cortex/lessons-learned.jsonl`. Any other path triggers spec-verifier `pattern_transfer_no_cross_repo_edit` rejection.
6. **assertEditWithinCwd hook** — already exists in `bin/steward/_lib/sibling-reader.cjs`; integrate into spec-verifier as a final-pass check (Sprint 2.7.1 backlog item — not yet wired).
7. Spec-verifier runs `lessons_jsonl_grew_with_source_repo` + `pattern_transfer_no_cross_repo_edit`. Blocks failure → atomic rollback → exitCode:0 (Sprint 2.9.7 defense-clean exit).

### 3.3 Acceptance criteria

```yaml
- id: lessons_jsonl_grew_with_source_repo
  kind: file_predicate
  predicate: touchedFiles.includes("cortex/lessons-learned.jsonl") && fileSize("cortex/lessons-learned.jsonl") >= prevSize("cortex/lessons-learned.jsonl")
  severity: block

- id: pattern_transfer_no_cross_repo_edit
  kind: file_predicate
  predicate: touchedFiles.every((p) => /* UNC + drive + traversal defense */)
  severity: block

- id: source_repo_field_present  # NEW — Sprint 2.7.1
  kind: regex
  pattern: '"source_repo":'
  applies_to: 'cortex/lessons-learned.jsonl'
  severity: block
```

## 4. Implementation effort estimate

- `dry-run.cjs` dispatch: ~80 LoC
- `execute.cjs` runPatternTransferAction: ~150 LoC
- `assertEditWithinCwd` integration into spec-verifier: ~30 LoC
- Tests (unit + integration): ~200 LoC, ~15 tests
- R2 review pipeline: 3 agents (security + correctness + edge-case) — ~$0.03

**Total: ~460 LoC + ~$0.05 R2. Single evening session.**

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Sibling repo prompt injection (lethal trifecta) | HIGH | `<untrusted>...</untrusted>` markers + system prompt prohibits file edits beyond lessons-learned.jsonl |
| LLM hallucinates fake `source_repo` | MEDIUM | spec-verifier `source_repo_field_present` regex check |
| Sibling repo path traversal via manifest | LOW | sibling-manifest validator restricts env expansion to `${HOME}` / `${USERPROFILE}` only (Sprint 2.7) |
| Cost spike when N siblings × M lessons exceeds token budget | LOW | per-action cost cap (Sprint 2.0b) + sample N per sibling at dry-run time |
| Output overwrites existing lessons-learned.jsonl entries | MEDIUM | Append-only contract enforced by spec-verifier `lessons_jsonl_grew` predicate |

## 6. Out of scope

- **Cross-project pattern propagation** — v1 is journal-only; never edits sibling repos. Bidirectional sync deferred to Sprint 4.5 (federated lesson bank).
- **LLM-suggested code transfer** — v1 distills text patterns only. Code-level transfer is Sprint 3.x (capability marketplace).
- **Multi-sibling LLM aggregation strategies** — v1 reads each sibling separately; ensemble strategies in Sprint 2.2 worktree supervisor.

## 7. Decision

**Awaiting operator approval.** Proposed sequencing if green-lit:
1. R2 review on this memo (security + correctness focus)
2. Implementation: dry-run dispatch first → execute runner → spec-verifier hook → tests
3. Manual smoke test against a real sibling (e.g. a Next.js SaaS project repo)
4. R2 review pipeline (6 agents)
5. Hardening pass
6. Push + CI verify

## 8. References

- Sprint 2.7 v0 implementation: commit `b80ebdf`
- Sprint 2.7.1 hardening: commit `b90e070` (UNC + drive-letter defense)
- Sibling-reader: `bin/steward/_lib/sibling-reader.cjs`
- Sibling-manifest: `bin/steward/_lib/sibling-manifest.cjs`
- Routing-policy per-action cap: `bin/steward/_lib/routing-policy.cjs` (Sprint 2.0b)
- Lethal trifecta + Pattern 1 untrusted markers: `standards/security.md` § Agentic Security
