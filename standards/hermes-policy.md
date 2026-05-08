# Hermes Policy — Refusal List, Denylist, MUST patterns

> The autonomous **Hermes** runtime ([Phase 7](../README.md#status), RFC at [docs/hermes-rfc.md](../docs/hermes-rfc.md)) extends cortex-x from build-time to runtime. This policy defines the **inviolable safety contract** Hermes operates under — what it MUST refuse, what it MUST NOT modify, what it MUST do on every action.
>
> **Tier:** Rule 2 (Critical) for any project running Hermes. Review-pipeline flag = blocker.
>
> **Companion docs:** [`docs/hermes-rfc.md`](../docs/hermes-rfc.md) (motivation + open questions), [`docs/hermes-research-synthesis.md`](../docs/hermes-research-synthesis.md) (research-grounded design decisions), [`docs/hermes-runtime.md`](../docs/hermes-runtime.md) (5-component implementation).

## 1. Hardcoded refusals — non-negotiable

Hermes refuses the following at the tool-wrapper layer, **not via system prompt**. Promptword-only enforcement fails under prompt injection (Replit Agent prod-DB wipe, July 2025, is the canonical incident). All seven refusals are encoded in `block-destructive.cjs` denylist + Hermes own policy check:

1. **No force-push to protected branches.** `git push --force`, `git push -f`, `git push --force-with-lease` to `main`, `master`, or any branch matching `release/*` are blocked unconditionally.
2. **No merge without human review.** Hermes opens PRs (default: **draft**). Promotion to ready-for-review is allowed only after CI green + atomic-commit contract verified. **Merging is human-only.** Hermes never calls `gh pr merge` or `git merge` to an integration branch.
3. **No data deletion.** `rm -rf`, `rm -fr`, `git reset --hard`, `git clean -f`, `git branch -D`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `supabase db reset` — all blocked. (Already enforced by `block-destructive.cjs` for the human; Hermes inherits.)
4. **No prod restart / migration.** No `vercel deploy --prod`, no `supabase db push` against production, no kubectl rollout against prod namespace, no infra-as-code apply against prod state.
5. **No tool-call beyond declared budget.** Per-session USD soft/hard caps. Per-action retry budget. Same-tool-same-args-three-times = loop trip → halt.
6. **No silent context modification.** Every memory write to `~/.cortex/journal/<slug>/<date>.jsonl` is structured + timestamped + replayable. No journal rewrite (append-only). No deletion of journal entries by Hermes.
7. **No source-of-truth mutation.** The `human_only:` paths in [`config/evolve.yaml`](../config/evolve.yaml) — `standards/`, `prompts/`, `profiles/`, `agents/`, `module.yaml`, `CLAUDE.md`, `README.md` — are read-only to Hermes. v1+ may add an opt-in flag; v0 hard-blocks.

## 2. The seven MUST patterns

Hermes inherits the seven MUST agentic-security patterns from [`standards/security.md`](./security.md) § Agentic Security 2026. This section adds the **seven Hermes-specific MUSTs** that operationalize them.

### MUST-H1 — Atomic commit-per-action contract (Aider gold standard)

Every Hermes action is exactly one Git commit. Pre-action gate, single staged change, post-commit verification:

```
1. PRE-ACTION:    git status --porcelain  → must be empty (or stash + restore around action)
2. ACT:           edit specific files only
3. STAGE:         git add -- <explicit-paths>  (NEVER git add -A or git add .)
4. COMMIT:        git commit with Conventional Commits subject + Git trailers
5. POST-VERIFY:   git status --porcelain → must be empty
                  git rev-parse HEAD     → must match journaled SHA
```

If verification fails, the action is marked `tainted` in the journal and Hermes halts (T2 ping + pause). No retry without human review.

### MUST-H2 — Branch-per-action with mutex-by-slug

Branch naming: `hermes/<YYYY-MM-DD>-<action-slug>-<short-id>` (e.g. `hermes/2026-05-07-bump-zod-a3f2`).

Mutex enforcement: a **lock file** at `cortex/journal/<slug>/.lock` containing `{pid, start_ts, action_id}`. Hermes refuses to start action B if the lock is held; on stale-lock detection (`>2× declared action timeout`) it logs `lock_recovered` and proceeds.

**Forbidden:** daily-rolling branches (`hermes/2026-05-07` covering N actions), parallel Hermes runs on the same project, multiple open Hermes PRs against the same project at the same time.

### MUST-H3 — Git trailers on every commit

Every Hermes commit carries machine-parseable trailers (`git interpret-trailers --parse` parses without regex):

```
Hermes-Action-Id: <ulid>
Hermes-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl#L<n>
Hermes-Trigger: cron|incident|pr-merged|manual
Hermes-Recommendation-Source: cortex/recommendations.md#<heading-anchor>
Co-Authored-By: Hermes <hermes@cortex-x.local>
```

Reverts add `Hermes-Reverts: <original-sha>` so the audit chain is bidirectional. Future-Hermes reads its own history via trailer queries, not commit-message regex.

### MUST-H4 — Append-only structured journal

Journal at `~/.cortex/journal/<slug>/<date>.jsonl`. Every line is a JSON object validated against a Zod schema (per [`standards/correctness.md`](./correctness.md) § Trust boundaries):

```typescript
const HermesJournalEntry = z.object({
  ts: z.string().datetime(),
  trigger: z.enum(['cron', 'incident', 'pr-merged', 'manual']),
  tier: z.enum(['T0', 'T1', 'T2', 'T3']),
  event: z.string(),
  cost_usd: z.number().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  tool: z.string().optional(),
  args_hash: z.string().optional(),
  outcome: z.enum(['success', 'failure', 'skipped', 'halted']).optional(),
  replay_seed: z.string().optional(),
  actor: z.enum(['hermes', 'investigate-subagent']).default('hermes'),
})
```

**No rewrite, no delete by Hermes.** Append-only is the audit guarantee. PII guard: paths under `~/`, environment variables, and any string matching common credential patterns (`sk-…`, `ghp_…`, `Bearer …`) are redacted before write.

### MUST-H5 — File-based kill switch

Two paths checked at every tool-call boundary:
- `~/.cortex/HERMES_HALT` (fleet-wide, halts every Hermes run)
- `<repo>/.cortex/HERMES_HALT` (per-project)

Presence = immediate clean shutdown, journal entry `{event: "halted_by_sentinel"}`, exit code 75 (`EX_TEMPFAIL`).

**Hermes cannot remove either file.** `block-destructive.cjs` denylist extended to block any `rm`/`unlink`/`Remove-Item` of either path. Removal is human-only — typically `rm ~/.cortex/HERMES_HALT` after the human resolves whatever caused the halt.

### MUST-H6 — Draft PR by default, promote on green

Every Hermes PR is opened as **draft** (`gh pr create --draft`). Hermes promotes draft → ready only when:

1. All required CI checks green (project's existing branch protection set)
2. Hermes-specific check `hermes/atomic-commit-contract` green:
   - Exactly N commits where N = declared action count
   - Every commit has `Hermes-Action-Id` trailer
   - Revert chain intact if reverts present
3. (When applicable) project's eval suite passes the `required_score_threshold` from `config/evolve.yaml`

Promotion itself is journaled. **Humans merge** — Hermes never calls `gh pr merge`.

### MUST-H7 — Conflict-on-pull halts, never auto-resolves

When `git pull --rebase` (or equivalent) fails with a merge conflict on Hermes's working branch:
- Hermes does NOT call `git checkout --theirs/--ours`
- Hermes does NOT invoke an LLM to draft a resolution into the action branch
- Hermes journals `{event: "conflict_on_pull", conflict_files: [...]}` and **halts** (T2 ping + pause)

v1+ may opt-in to LLM-drafted resolutions on a **side-branch** (`hermes/<...>-conflict-resolution`) that humans review and merge. v0 is halt-only.

## 3. Denylist — three-layer defense

Hermes layers three independent denylists. They cover different attack surfaces and are intentionally NOT consolidated into one source — defense-in-depth requires that any one layer breaking does not collapse the others.

### Layer 1 — Engine file-write denylist (`bin/hermes/_lib/action-engine.cjs`)
Enforced inside `applyEditsToFilesystem` over `edit.path`. Blocks **file-WRITE** to: `.env*`, `*.pem`, `*.key`, `secrets/`, `package(-lock).json`, `bin/hermes/**`, `bin/cortex-hermes*`, `.github/workflows/**`, `standards/hermes-*`, `.git/`, `.ssh/`, `.gnupg/`. Source: `HERMES_HARD_DENYLIST` constant.

### Layer 2 — Policy-check subprocess denylist (`bin/hermes/_lib/policy-check.cjs`)
Enforced before any tool call. Pattern-matches over flattened args. Blocks **subprocess READ + EXFIL + production mutation**:
- Sentinel preservation (Hermes cannot delete its own kill switch)
- Source-of-truth protection (human_only paths in standards/, prompts/, profiles/, agents/, top-level CLAUDE.md / README.md / module.yaml — list comes from `config/evolve.yaml`)
- Auto-merge prevention (`gh pr merge`, `git merge main`)
- Production-mutation prevention (`vercel deploy --prod`, `supabase db push --linked`, `kubectl apply ... prod`)
- Force-push / hard-reset / `rm -rf` (already covered by Ring 2 below; Ring 1 catches first)
- **Secrets exfiltration** (Sprint pre-2.0 housekeeping): `cat`, `less`, `more`, `tail`, `head`, `Get-Content` against any path containing `.env*`, `*.pem`, `*.key`, `secrets/`, `.ssh/`, `.gnupg/` → `NO_SECRET_READ`. Plus pipe-out variants → `NO_SECRET_PIPE`. The intent is "Hermes can never round-trip a key through a subprocess body" (defense against future LLM-authored gh-issue body that quotes a secret).

Source: `HERMES_DENY` array. Cross-layer invariant tested in [`tests/contract/denylist-ssot.test.cjs`](../tests/contract/denylist-ssot.test.cjs).

### Layer 3 — Global block-destructive hook (`shared/hooks/block-destructive.cjs`)
Pre-existing project-wide hook. Blocks for **the human + any subagent + Hermes**: `git push --force`, `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout .`, `git restore .`, `git stash drop|clear`, `rm -rf`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `supabase db reset`. Hermes inherits all of those.

### Why three layers, not one consolidated source

Engine denylist is path-shaped (`/^\.env(\.|$)/i.test(rel)`), policy-check is command-shaped (`/\bcat\b.*\.ssh\//`), and block-destructive is a Bash-tool hook. Trying to express all three as one regex array would either: (a) match too broadly and break legitimate operations, or (b) need a context-aware matcher that re-parses every shell call. The current split lets each layer use the matching style appropriate to its scope. The cross-layer invariant (no secret category covered by only one layer) is enforced by [`tests/contract/denylist-ssot.test.cjs`](../tests/contract/denylist-ssot.test.cjs) — when a new secret category is added, the test fails until both engine + policy-check are updated.

## 4. Cost ceilings — loop guards (not bankruptcy protection)

v0 assumes Hermes runs on the human's MAX subscription (`CORTEX_BUDGET_DISABLED=1` env var honored). USD ceilings are **runaway-loop blast-radius limits**, not bill-bomb guards. If Hermes is ever moved to its own API key (`HERMES_API_KEY` env var set), the same ceilings become hard-meaningful.

| Bucket | Soft warn | Hard halt |
|---|---|---|
| Per session | $0.50 | $2.00 |
| Per project / day | $3.00 | $5.00 |
| Per Hermes-fleet / day | $10.00 | $15.00 |
| Tool-call retry budget | 3 retries | 5 same-tool-same-args → loop trip |
| Iterations per session | 15 warn | 25 hard cap |

Defaults override-able in `~/.cortex/hermes.yaml`. Soft-cap = T1 journal flag. Hard-cap = T2 ping + pause.

## 5. Escalation tiers

| Tier | Trigger | Action |
|---|---|---|
| **T0 silent journal** | Soft warning (50 % cost, 1 retry, low-stakes ambiguity) | Append to `~/.cortex/journal/<slug>/<date>.jsonl` and continue |
| **T1 needs_review flag** | 80 % budget, 3 retries, confidence < 85 % on Rule-2 action | Journal entry with `needs_review: true`; surface in next `cortex doctor` |
| **T2 human ping + pause** | Hard cap reached, forbidden-action blocked, loop tripped, `MUST-H1` verification failed, conflict-on-pull | Slack DM (or email fallback after 10 min) with replayable journal pointer; **agent pauses**, no auto-retry |
| **T3 halt** | T2 unanswered ≥ 30 min, OR `HERMES_HALT` sentinel present, OR same incident triggers within rolling hour | Full stop, state saved, `~/.cortex/journal/<slug>/HALTED` sentinel written, `cortex doctor` blocks further runs until human clears |

## 6. Hermes policy checklist (verified on every Hermes run)

- [ ] Pre-action `git status --porcelain` empty (or stash applied)
- [ ] Branch name matches `hermes/<YYYY-MM-DD>-<slug>-<id>`
- [ ] Lock file `cortex/journal/<slug>/.lock` acquired
- [ ] Every commit carries `Hermes-Action-Id` + `Hermes-Journal-Entry` + `Hermes-Trigger` trailers
- [ ] Post-commit `git rev-parse HEAD` matches journal SHA
- [ ] Journal entry validates against Zod schema (no PII)
- [ ] PR opened as draft, not ready-for-review
- [ ] No write-attempt to `human_only:` paths (denylist enforced)
- [ ] No `gh pr merge` invocation
- [ ] `HERMES_HALT` checked at every tool-call boundary
- [ ] Cost meter under hard-cap; tool-call retry under budget
- [ ] On exit, lock file released; journal `outcome` recorded

## 7. Red flags — block on review

- ❌ Hermes commits without `Hermes-Action-Id` trailer
- ❌ Branch name `hermes/<date>` (daily-rolling, not action-scoped)
- ❌ Multiple commits per action without explicit declaration
- ❌ Force-push from Hermes (any form, even `--force-with-lease`)
- ❌ Hermes calls `gh pr merge` or `git merge main`
- ❌ Edit to `standards/`, `prompts/`, `profiles/`, `agents/`, `CLAUDE.md`, `README.md`, `module.yaml` from a Hermes branch
- ❌ Journal write that contains absolute paths under `~/` or env-var values
- ❌ `HERMES_HALT` removal in Hermes commit
- ❌ `git reset --hard` or `git push --force` in Hermes journal (should be impossible — `block-destructive.cjs` blocks; if it appears, the hook regressed)
- ❌ Hermes runs without `cortex/journal/<slug>/.lock` acquired

## 8. Cross-references

- [`docs/hermes-rfc.md`](../docs/hermes-rfc.md) — motivation + 5 architecture components + open questions
- [`docs/hermes-research-synthesis.md`](../docs/hermes-research-synthesis.md) — research-grounded decisions
- [`docs/hermes-runtime.md`](../docs/hermes-runtime.md) — implementation design + sequence flows
- [`config/evolve.yaml`](../config/evolve.yaml) — `auto_improves` / `human_only` SSOT
- [`shared/hooks/block-destructive.cjs`](../shared/hooks/block-destructive.cjs) — global denylist
- [`standards/security.md`](./security.md) § Agentic Security 2026 — 7 MUST agentic patterns
- [`standards/observability.md`](./observability.md) § Runtime SLOs — burn-rate alerts apply to Hermes cost meters
- [`standards/correctness.md`](./correctness.md) § Trust boundaries — Zod schema for journal

---

*Drafted 2026-05-07 alongside [`docs/hermes-research-synthesis.md`](../docs/hermes-research-synthesis.md). Aligned with the seven MUST agentic-security patterns in [`standards/security.md`](./security.md). Reviewed by Dave Rajnoha before first Hermes runtime code merges.*
