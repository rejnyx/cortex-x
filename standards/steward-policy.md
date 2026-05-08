# Steward Policy — Refusal List, Denylist, MUST patterns

> The autonomous **Steward** runtime ([Phase 7](../README.md#status), RFC at [docs/steward-rfc.md](../docs/steward-rfc.md)) extends cortex-x from build-time to runtime. This policy defines the **inviolable safety contract** Steward operates under — what it MUST refuse, what it MUST NOT modify, what it MUST do on every action.
>
> **Tier:** Rule 2 (Critical) for any project running Steward. Review-pipeline flag = blocker.
>
> **Companion docs:** [`docs/steward-rfc.md`](../docs/steward-rfc.md) (motivation + open questions), [`docs/steward-research-synthesis.md`](../docs/steward-research-synthesis.md) (research-grounded design decisions), [`docs/steward-runtime.md`](../docs/steward-runtime.md) (5-component implementation).

## 1. Hardcoded refusals — non-negotiable

Steward refuses the following at the tool-wrapper layer, **not via system prompt**. Promptword-only enforcement fails under prompt injection (Replit Agent prod-DB wipe, July 2025, is the canonical incident). All seven refusals are encoded in `block-destructive.cjs` denylist + Steward own policy check:

1. **No force-push to protected branches.** `git push --force`, `git push -f`, `git push --force-with-lease` to `main`, `master`, or any branch matching `release/*` are blocked unconditionally.
2. **No merge without human review.** Steward opens PRs (default: **draft**). Promotion to ready-for-review is allowed only after CI green + atomic-commit contract verified. **Merging is human-only.** Steward never calls `gh pr merge` or `git merge` to an integration branch.
3. **No data deletion.** `rm -rf`, `rm -fr`, `git reset --hard`, `git clean -f`, `git branch -D`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `supabase db reset` — all blocked. (Already enforced by `block-destructive.cjs` for the human; Steward inherits.)
4. **No prod restart / migration.** No `vercel deploy --prod`, no `supabase db push` against production, no kubectl rollout against prod namespace, no infra-as-code apply against prod state.
5. **No tool-call beyond declared budget.** Per-session USD soft/hard caps. Per-action retry budget. Same-tool-same-args-three-times = loop trip → halt.
6. **No silent context modification.** Every memory write to `~/.cortex/journal/<slug>/<date>.jsonl` is structured + timestamped + replayable. No journal rewrite (append-only). No deletion of journal entries by Steward.
7. **No source-of-truth mutation.** The `human_only:` paths in [`config/evolve.yaml`](../config/evolve.yaml) — `standards/`, `prompts/`, `profiles/`, `agents/`, `module.yaml`, `CLAUDE.md`, `README.md` — are read-only to Steward. v1+ may add an opt-in flag; v0 hard-blocks.

## 2. The seven MUST patterns

Steward inherits the seven MUST agentic-security patterns from [`standards/security.md`](./security.md) § Agentic Security 2026. This section adds the **seven Steward-specific MUSTs** that operationalize them.

### MUST-H1 — Atomic commit-per-action contract (Aider gold standard)

Every Steward action is exactly one Git commit. Pre-action gate, single staged change, post-commit verification:

```
1. PRE-ACTION:    git status --porcelain  → must be empty (or stash + restore around action)
2. ACT:           edit specific files only
3. STAGE:         git add -- <explicit-paths>  (NEVER git add -A or git add .)
4. COMMIT:        git commit with Conventional Commits subject + Git trailers
5. POST-VERIFY:   git status --porcelain → must be empty
                  git rev-parse HEAD     → must match journaled SHA
```

If verification fails, the action is marked `tainted` in the journal and Steward halts (T2 ping + pause). No retry without human review.

### MUST-H2 — Branch-per-action with mutex-by-slug

Branch naming: `steward/<YYYY-MM-DD>-<action-slug>-<short-id>` (e.g. `hermes/2026-05-07-bump-zod-a3f2`).

Mutex enforcement: a **lock file** at `cortex/journal/<slug>/.lock` containing `{pid, start_ts, action_id}`. Steward refuses to start action B if the lock is held; on stale-lock detection (`>2× declared action timeout`) it logs `lock_recovered` and proceeds.

**Forbidden:** daily-rolling branches (`hermes/2026-05-07` covering N actions), parallel Steward runs on the same project, multiple open Steward PRs against the same project at the same time.

### MUST-H3 — Git trailers on every commit

Every Steward commit carries machine-parseable trailers (`git interpret-trailers --parse` parses without regex):

```
Steward-Action-Id: <ulid>
Steward-Journal-Entry: ~/.cortex/journal/<slug>/<date>.jsonl#L<n>
Steward-Trigger: cron|incident|pr-merged|manual
Steward-Recommendation-Source: cortex/recommendations.md#<heading-anchor>
Co-Authored-By: Steward <steward@cortex-x.local>
```

Reverts add `Steward-Reverts: <original-sha>` so the audit chain is bidirectional. Future-Steward reads its own history via trailer queries, not commit-message regex.

### MUST-H4 — Append-only structured journal

Journal at `~/.cortex/journal/<slug>/<date>.jsonl`. Every line is a JSON object validated against a Zod schema (per [`standards/correctness.md`](./correctness.md) § Trust boundaries):

```typescript
const StewardJournalEntry = z.object({
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

**No rewrite, no delete by Steward.** Append-only is the audit guarantee. PII guard: paths under `~/`, environment variables, and any string matching common credential patterns (`sk-…`, `ghp_…`, `Bearer …`) are redacted before write.

### MUST-H5 — File-based kill switch

Two paths checked at every tool-call boundary:
- `~/.cortex/STEWARD_HALT` (fleet-wide, halts every Steward run)
- `<repo>/.cortex/STEWARD_HALT` (per-project)

Presence = immediate clean shutdown, journal entry `{event: "halted_by_sentinel"}`, exit code 75 (`EX_TEMPFAIL`).

**Steward cannot remove either file.** `block-destructive.cjs` denylist extended to block any `rm`/`unlink`/`Remove-Item` of either path. Removal is human-only — typically `rm ~/.cortex/STEWARD_HALT` after the human resolves whatever caused the halt.

### MUST-H6 — Draft PR by default, promote on green

Every Steward PR is opened as **draft** (`gh pr create --draft`). Steward promotes draft → ready only when:

1. All required CI checks green (project's existing branch protection set)
2. Steward-specific check `hermes/atomic-commit-contract` green:
   - Exactly N commits where N = declared action count
   - Every commit has `Steward-Action-Id` trailer
   - Revert chain intact if reverts present
3. (When applicable) project's eval suite passes the `required_score_threshold` from `config/evolve.yaml`

Promotion itself is journaled. **Humans merge** — Steward never calls `gh pr merge`.

### MUST-H7 — Conflict-on-pull halts, never auto-resolves

When `git pull --rebase` (or equivalent) fails with a merge conflict on Steward's working branch:
- Steward does NOT call `git checkout --theirs/--ours`
- Steward does NOT invoke an LLM to draft a resolution into the action branch
- Steward journals `{event: "conflict_on_pull", conflict_files: [...]}` and **halts** (T2 ping + pause)

v1+ may opt-in to LLM-drafted resolutions on a **side-branch** (`hermes/<...>-conflict-resolution`) that humans review and merge. v0 is halt-only.

## 3. Denylist — three-layer defense

Steward layers three independent denylists. They cover different attack surfaces and are intentionally NOT consolidated into one source — defense-in-depth requires that any one layer breaking does not collapse the others.

### Layer 1 — Engine file-write denylist (`bin/steward/_lib/action-engine.cjs`)
Enforced inside `applyEditsToFilesystem` over `edit.path`. Blocks **file-WRITE** to: `.env*`, `*.pem`, `*.key`, `secrets/`, `package(-lock).json`, `bin/steward/**`, `bin/cortex-steward*`, `.github/workflows/**`, `standards/hermes-*`, `.git/`, `.ssh/`, `.gnupg/`. Source: `HERMES_HARD_DENYLIST` constant.

### Layer 2 — Policy-check subprocess denylist (`bin/steward/_lib/policy-check.cjs`)
Enforced before any tool call. Pattern-matches over flattened args. Blocks **subprocess READ + EXFIL + production mutation**:
- Sentinel preservation (Steward cannot delete its own kill switch)
- Source-of-truth protection (human_only paths in standards/, prompts/, profiles/, agents/, top-level CLAUDE.md / README.md / module.yaml — list comes from `config/evolve.yaml`)
- Auto-merge prevention (`gh pr merge`, `git merge main`)
- Production-mutation prevention (`vercel deploy --prod`, `supabase db push --linked`, `kubectl apply ... prod`)
- Force-push / hard-reset / `rm -rf` (already covered by Ring 2 below; Ring 1 catches first)
- **Secrets exfiltration** (Sprint pre-2.0 housekeeping): `cat`, `less`, `more`, `tail`, `head`, `Get-Content` against any path containing `.env*`, `*.pem`, `*.key`, `secrets/`, `.ssh/`, `.gnupg/` → `NO_SECRET_READ`. Plus pipe-out variants → `NO_SECRET_PIPE`. The intent is "Steward can never round-trip a key through a subprocess body" (defense against future LLM-authored gh-issue body that quotes a secret).

Source: `HERMES_DENY` array. Cross-layer invariant tested in [`tests/contract/denylist-ssot.test.cjs`](../tests/contract/denylist-ssot.test.cjs).

### Layer 3 — Global block-destructive hook (`shared/hooks/block-destructive.cjs`)
Pre-existing project-wide hook. Blocks for **the human + any subagent + Steward**: `git push --force`, `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout .`, `git restore .`, `git stash drop|clear`, `rm -rf`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, `supabase db reset`. Steward inherits all of those.

### Why three layers, not one consolidated source

Engine denylist is path-shaped (`/^\.env(\.|$)/i.test(rel)`), policy-check is command-shaped (`/\bcat\b.*\.ssh\//`), and block-destructive is a Bash-tool hook. Trying to express all three as one regex array would either: (a) match too broadly and break legitimate operations, or (b) need a context-aware matcher that re-parses every shell call. The current split lets each layer use the matching style appropriate to its scope. The cross-layer invariant (no secret category covered by only one layer) is enforced by [`tests/contract/denylist-ssot.test.cjs`](../tests/contract/denylist-ssot.test.cjs) — when a new secret category is added, the test fails until both engine + policy-check are updated.

## 4. Cost ceilings — loop guards (not bankruptcy protection)

v0 assumes Steward runs on the human's MAX subscription (`CORTEX_BUDGET_DISABLED=1` env var honored). USD ceilings are **runaway-loop blast-radius limits**, not bill-bomb guards. If Steward is ever moved to its own API key (`HERMES_API_KEY` env var set), the same ceilings become hard-meaningful.

| Bucket | Soft warn | Hard halt |
|---|---|---|
| Per session | $0.50 | $2.00 |
| Per project / day | $3.00 | $5.00 |
| Per Steward-fleet / day | $10.00 | $15.00 |
| Tool-call retry budget | 3 retries | 5 same-tool-same-args → loop trip |
| Iterations per session | 15 warn | 25 hard cap |

Defaults override-able in `~/.cortex/hermes.yaml`. Soft-cap = T1 journal flag. Hard-cap = T2 ping + pause.

## 5. Escalation tiers

| Tier | Trigger | Action |
|---|---|---|
| **T0 silent journal** | Soft warning (50 % cost, 1 retry, low-stakes ambiguity) | Append to `~/.cortex/journal/<slug>/<date>.jsonl` and continue |
| **T1 needs_review flag** | 80 % budget, 3 retries, confidence < 85 % on Rule-2 action | Journal entry with `needs_review: true`; surface in next `cortex doctor` |
| **T2 human ping + pause** | Hard cap reached, forbidden-action blocked, loop tripped, `MUST-H1` verification failed, conflict-on-pull | Slack DM (or email fallback after 10 min) with replayable journal pointer; **agent pauses**, no auto-retry |
| **T3 halt** | T2 unanswered ≥ 30 min, OR `STEWARD_HALT` sentinel present, OR same incident triggers within rolling hour | Full stop, state saved, `~/.cortex/journal/<slug>/HALTED` sentinel written, `cortex doctor` blocks further runs until human clears |

## 6. Steward policy checklist (verified on every Steward run)

- [ ] Pre-action `git status --porcelain` empty (or stash applied)
- [ ] Branch name matches `steward/<YYYY-MM-DD>-<slug>-<id>`
- [ ] Lock file `cortex/journal/<slug>/.lock` acquired
- [ ] Every commit carries `Steward-Action-Id` + `Steward-Journal-Entry` + `Steward-Trigger` trailers
- [ ] Post-commit `git rev-parse HEAD` matches journal SHA
- [ ] Journal entry validates against Zod schema (no PII)
- [ ] PR opened as draft, not ready-for-review
- [ ] No write-attempt to `human_only:` paths (denylist enforced)
- [ ] No `gh pr merge` invocation
- [ ] `STEWARD_HALT` checked at every tool-call boundary
- [ ] Cost meter under hard-cap; tool-call retry under budget
- [ ] On exit, lock file released; journal `outcome` recorded

## 6.5. Routing profile policy (Sprint 2.0b)

Steward picks an LLM model per action_kind via [`bin/steward/_lib/routing-table.cjs`](../bin/steward/_lib/routing-table.cjs). Operator-facing guide: [`docs/steward-routing.md`](../docs/steward-routing.md). R1 memo: [`docs/research/sprint-2.0b-action-kind-model-routing-2026-05-08.md`](../docs/research/sprint-2.0b-action-kind-model-routing-2026-05-08.md).

### Override hierarchy (high → low precedence)

1. CLI `--model <slug>` (one-shot; bypasses profile-allowlist).
2. `STEWARD_ROUTING_<ACTION_KIND>` env (per-kind override).
3. `STEWARD_MODEL` env (legacy global pin; pre-2.0b backward compat).
4. `STEWARD_ROUTING_PROFILE` env (selects profile; default `balanced`).
5. Routing-table default per `(action_kind, profile)`.

### Profile-allowlist gate

Some kinds restrict allowed profiles to defend against config errors that
escalate a low-stakes action to an expensive model. Currently:

- `release_notes_drafter` allowed: `cheap`, `balanced`, `premium` (no `ensemble`).
- All other kinds: all 4 profiles allowed.

Denials surface as `ROUTING_PROFILE_NOT_ALLOWED`. CLI `--model` is the
explicit operator escape hatch (logged via `steward.routing.source = "cli"`).

### Per-action USD cap (defense layered above 1.9.1's daily/weekly/monthly)

- `STEWARD_PER_ACTION_USD_CAP=1.00` global default.
- `STEWARD_PER_ACTION_USD_CAP_<KIND>=N` per-kind override.
- `0` = explicit opt-out.
- 24-hour rolling window per action_kind.
- Tripped cap returns `PER_ACTION_BUDGET_CAP_REACHED`, journals
  `execute_per_action_budget_capped`, exits cleanly without acquiring lock.

### MUST patterns added by 2.0b

- **MUST-R1.** Premium tier MUST NOT pin Opus 4.7 until Anthropic ships
  tokenizer-overhead billing parity (R1 memo §1.3 caveat — 4.7 generates
  ~35% more input tokens for the same prompt). Use Opus 4.6 instead.
  Enforced by `tests/unit/steward/routing-table.test.cjs`.
- **MUST-R2.** Routing decisions MUST emit trace tags (`steward.routing.profile`,
  `steward.routing.source`, `steward.routing.model`) on the AGENT span so
  Phoenix can group by profile. Enforced by `tests/integration/steward-observability.test.cjs`.
- **MUST-R3.** Profile-allowlist denials MUST NOT silently demote to a
  permitted profile — they MUST return a clean `ROUTING_PROFILE_NOT_ALLOWED`
  code so the operator sees what they hit.

### Red flags — block on review

- ❌ Premium-tier slot pinned to `anthropic/claude-opus-4.7` (use 4.6).
- ❌ Routing-table entry without all 4 profile slots (cheap/balanced/premium/ensemble).
- ❌ `selectModel()` callsite that bypasses the profile validation.
- ❌ Per-action USD cap turned off via `STEWARD_PER_ACTION_USD_CAP=0` in
  workflow files (operator override on dev machines OK).

## 7. Red flags — block on review

- ❌ Steward commits without `Steward-Action-Id` trailer
- ❌ Branch name `hermes/<date>` (daily-rolling, not action-scoped)
- ❌ Multiple commits per action without explicit declaration
- ❌ Force-push from Steward (any form, even `--force-with-lease`)
- ❌ Steward calls `gh pr merge` or `git merge main`
- ❌ Edit to `standards/`, `prompts/`, `profiles/`, `agents/`, `CLAUDE.md`, `README.md`, `module.yaml` from a Steward branch
- ❌ Journal write that contains absolute paths under `~/` or env-var values
- ❌ `STEWARD_HALT` removal in Steward commit
- ❌ `git reset --hard` or `git push --force` in Steward journal (should be impossible — `block-destructive.cjs` blocks; if it appears, the hook regressed)
- ❌ Steward runs without `cortex/journal/<slug>/.lock` acquired

## 8. Cross-references

- [`docs/steward-rfc.md`](../docs/steward-rfc.md) — motivation + 5 architecture components + open questions
- [`docs/steward-research-synthesis.md`](../docs/steward-research-synthesis.md) — research-grounded decisions
- [`docs/steward-runtime.md`](../docs/steward-runtime.md) — implementation design + sequence flows
- [`config/evolve.yaml`](../config/evolve.yaml) — `auto_improves` / `human_only` SSOT
- [`shared/hooks/block-destructive.cjs`](../shared/hooks/block-destructive.cjs) — global denylist
- [`standards/security.md`](./security.md) § Agentic Security 2026 — 7 MUST agentic patterns
- [`standards/observability.md`](./observability.md) § Runtime SLOs — burn-rate alerts apply to Steward cost meters
- [`standards/correctness.md`](./correctness.md) § Trust boundaries — Zod schema for journal

---

*Drafted 2026-05-07 alongside [`docs/steward-research-synthesis.md`](../docs/steward-research-synthesis.md). Aligned with the seven MUST agentic-security patterns in [`standards/security.md`](./security.md). Reviewed by Dave Rajnoha before first Steward runtime code merges.*
