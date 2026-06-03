---
sprint: 2.46.1
name: Sprint 2.46.1 — Verdict path hardening (commit_sha binding + nonce journal + secret model + Ed25519 + STRICT_SECRET + fencing contract test)
date: 2026-06-03
status: in-progress
owner: cortex-x maintainers
discovery_source: cortex/sprint-2-46-r2-summary.md § Deferred to Sprint 2.46.1 (D-1 through D-7) + standards/sprint-pipeline.md § Sprint 2.46.1 backlog
arc: Arc 1 (Verification & verdict hardening) — Sprint 1 of 3
generated_by: cortex-sprint
untrusted_fencing: not-required
fencing_rationale: Auto Mode discovery from cortex/sprint-2-46-r2-summary.md + standards/sprint-pipeline.md § Sprint 2.46.1 backlog; no operator paste input — discovery sources are internal cortex artifacts, not untrusted.
---

# Sprint 2.46.1 — Verdict path hardening

> **Operator brief (verbatim):** "Ok tak udělej Arc 1 — Verification & verdict hardening (close current arc)" + "přidej ještě analýzu a web researchers na všechny usecases."
>
> **Discovery (auto-selected, Auto Mode):** zavírá 6 architectural items deferred Sprint 2.46 — replay window v signed verdict path je živý (verdict on disk může unblock kterýkoli subsequent commit dokud file existuje). Tento sprint to fixne strukturálně.

## Goal

Zavřít replay window v `cortex/r2-verdict.json` signed-verdict gate path. Bind verdict k `commit_sha` (HEAD cross-check), implementovat workflow_run_id nonce journal (single-use semantics), přepracovat resolveSecret() security model (env-required > persisted random key > host-derived fallback s explicit warning), promovat Ed25519 jako schema_version 2 alongside HMAC v1, implementovat STRICT_SECRET=1 fail-CLOSED mode, a doplnit untrusted-fencing contract test pro `cortex/sprint-*-plan.md`.

Tento sprint odstraní strukturální nedostatek Sprint 2.46 v0 — "single-operator local continuity" trade-off byl pragmatický pro v0, ale dnes ho zavíráme jako bezpečnostní gap, ne feature.

## Deliverables (11)

1. **`bin/steward/_lib/r2-verdict.cjs` v2 schema** — backward-compatible upgrade s `schema_version=2`:
   - `buildVerdict()` accepts + signs `commit_sha`, `seen_run_check` (boolean signaling nonce-journal opt-in)
   - `verifyVerdict(json, secret, { headSha, journalLookup, strictSecret })` — nový options parameter
   - Ed25519 signature path: `signature.alg === 'Ed25519'`, value = base64url-encoded signature, additional `signature.public_key_id` field
   - STRICT_SECRET=1 env: when set + secret resolution fails → throw `CORTEX_R2_VERDICT_STRICT_SECRET_MISSING`
   - Schema v1 (HMAC-only, no commit_sha) zůstává verifiable; v2 je nový default pro builders
2. **`bin/steward/_lib/r2-verdict-journal.cjs`** — NEW zero-dep nonce journal:
   - `appendSeen(rootDir, workflowRunId, sprintId, commitSha)` — atomic append-only write to `cortex/.r2-seen-runs.json`
   - `wasSeen(rootDir, workflowRunId)` — O(N) scan (N capped at 1000 most-recent entries; FIFO eviction)
   - `loadJournal(rootDir) → {entries, capacity}` — read with file-lock retry
   - Journal format: `{ schema_version: 1, entries: [{ workflow_run_id, sprint_id, commit_sha, seen_at }] }`
   - Empty entries on first run; ENOENT → return empty journal (fail-OPEN for first-use UX)
3. **`bin/steward/_lib/r2-verdict-keys.cjs`** — NEW Ed25519 key persistence helper:
   - `loadOrCreateSigningKey({ dataHome, generateIfMissing }) → { privateKeyPem, publicKeyPem, publicKeyId }`
   - Storage: `$CORTEX_DATA_HOME/r2-verdict/ed25519-sign.pem` (private, 0600) + `cortex/r2-verdict-pubkey.pem` (public, committed to repo)
   - `publicKeyId` = first 16 hex chars of sha256(publicKeyPem) — stable identifier
   - Generation: `crypto.generateKeyPair('ed25519', ...)` — built-in, zero npm deps
4. **`shared/hooks/pre-commit-review-gate.cjs` v2 extension**:
   - `decide()` accepts new inputs: `commitShaMismatch`, `runIdBurned`, `strictSecretMissing`
   - New deny paths: when verdict present + signature OK but commit_sha mismatch HEAD → deny with reason "stale verdict (commit_sha mismatch)"
   - When verdict workflow_run_id is in journal → deny with reason "verdict replay (workflow_run_id already seen)"
   - When STRICT_SECRET=1 + secret missing → throw to operator (fail-CLOSED hard mode)
   - Otherwise existing logic preserved (verdictValid path + marker path + 5 escape hatches)
5. **`bin/steward/_lib/r2-verdict.cjs` resolveSecret() v2 resolution order**:
   - (1) `$CORTEX_R2_VERDICT_SECRET` env (HMAC fallback) — same as v0
   - (2) `$CORTEX_DATA_HOME/r2-verdict/hmac.key` persisted random key (auto-generated on first use, 0600) — NEW
   - (3) Host-derived `sha256(hostname + '|' + username)` — preserved as last-resort fallback for tests/CI with explicit warning
   - STRICT_SECRET=1 only allows (1) or (2); rejects (3) with error
6. **`standards/sprint-pipeline.md` updates**:
   - § Verdict-driven gate table updated to enumerate v2 properties (commit_sha binding ENFORCED, journal lookup ENFORCED, STRICT_SECRET mode supported)
   - § Sprint 2.46.1 backlog removed (items now shipped — replaced with "Closed Sprint 2.46.1" note + reference to this plan)
   - New § Replay-defense semantics subsection explaining single-use journal + commit_sha binding contract
7. **`shared/skills/cortex-sprint/SKILL.md` step 6 update**:
   - `buildVerdict()` call site documents commit_sha input (compute via `git rev-parse HEAD`)
   - `workflowRunId` MUST be unique (UUIDv4 documented; if reused, journal will reject second commit)
   - STRICT_SECRET=1 callout in operator-facing notes
8. **`tests/unit/steward/r2-verdict.test.cjs` extension** — minimum +15 tests:
   - v2 schema_version build + verify round-trip (commit_sha preserved)
   - v1 verdict still verifies (backward compatibility regression)
   - Ed25519 sign + verify round-trip
   - Ed25519 tamper detection (3 vectors)
   - STRICT_SECRET=1 throws on missing secret
   - STRICT_SECRET=1 + env present → ok
   - Persisted-key path: round-trip after key auto-generation
   - Persisted-key path: subsequent invocations reuse same key
   - Public-key-id determinism (same publicKey → same id)
9. **`tests/unit/steward/r2-verdict-journal.test.cjs`** — NEW ≥10 tests:
   - appendSeen + wasSeen round-trip
   - Journal capacity FIFO eviction at >1000 entries
   - Concurrent append safety (write-lock retry)
   - ENOENT on first read → empty journal (no throw)
   - Malformed JSON → quarantine + start fresh (fail-OPEN)
   - Schema_version mismatch → reject (no silent migration)
10. **`tests/integration/sprint-pipeline-verdict-gate.test.cjs` extension** — minimum +4 cases:
   - Case 7: valid v2 verdict + commit_sha matches HEAD → ALLOW
   - Case 8: valid v2 verdict + commit_sha DIFFERS from HEAD → DENY (stale verdict)
   - Case 9: valid verdict + workflow_run_id already in journal → DENY (replay burn)
   - Case 10: STRICT_SECRET=1 + secret unset → hook hard-deny with CORTEX_R2_VERDICT_STRICT_SECRET_MISSING reason
11. **`tests/contract/sprint-plan-untrusted-fencing.test.cjs`** — NEW lint:
   - Scan `cortex/sprint-*-plan.md` for frontmatter `generated_by: cortex-sprint`
   - When found, assert plan contains at least one `<untrusted source=` block OR explicit `untrusted_fencing: skipped` frontmatter with rationale
   - Closes M-9 from Sprint 2.45.1 + Sprint 2.46.1 backlog

## Acceptance criteria (15)

- **AC-1** `file_predicate` — `cortex/sprint-2-46-1-plan.md` exists with 8 required sections.
- **AC-2** `file_predicate` — `bin/steward/_lib/r2-verdict-journal.cjs` exists and exports `appendSeen`, `wasSeen`, `loadJournal`.
- **AC-3** `file_predicate` — `bin/steward/_lib/r2-verdict-keys.cjs` exists and exports `loadOrCreateSigningKey`.
- **AC-4** `regex` — `bin/steward/_lib/r2-verdict.cjs` contains `SCHEMA_VERSION_V2 = 2` AND `crypto.sign('Ed25519'` (or `crypto.createPrivateKey` + Ed25519 path).
- **AC-5** `regex` — `bin/steward/_lib/r2-verdict.cjs` `verifyVerdict` signature accepts options object with `headSha`, `journalLookup`, `strictSecret`.
- **AC-6** `regex` — `shared/hooks/pre-commit-review-gate.cjs` `decide()` adds 3 new inputs (`commitShaMismatch`, `runIdBurned`, `strictSecretMissing`).
- **AC-7** `regex` — `standards/sprint-pipeline.md` no longer contains "Sprint 2.46.1 backlog" heading (items closed); contains "Replay-defense semantics" heading.
- **AC-8** `regex` — `shared/skills/cortex-sprint/SKILL.md` step 6 mentions `commit_sha` input + `workflow_run_id` uniqueness + STRICT_SECRET.
- **AC-9** `shell` — `node --test tests/unit/steward/r2-verdict.test.cjs` passes with ≥35 total tests (22 existing + ≥15 new).
- **AC-10** `shell` — `node --test tests/unit/steward/r2-verdict-journal.test.cjs` passes with ≥10 tests.
- **AC-11** `shell` — `node --test tests/integration/sprint-pipeline-verdict-gate.test.cjs` passes with ≥10 cases (6 existing + ≥4 new).
- **AC-12** `shell` — `node --test tests/contract/sprint-plan-untrusted-fencing.test.cjs` passes.
- **AC-13** `shell` — `npm test` exits 0 (baseline 3326 → expect ≥3370).
- **AC-14** `shell` — `node bin/cortex-doc-regen.cjs --check` exits 0 after `--apply`.
- **AC-15** `file_predicate` — `cortex/sprint-2-46-1-r2-summary.md` exists with HIGH/MEDIUM disposition.

## Workflow phases

| Phase | Scope | Output |
|---|---|---|
| **Research** | 3 parallel R1 dispatches: (a) commit_sha binding patterns in CI gates 2026 + replay-defense idioms (cosign, in-toto, SLSA), (b) Ed25519 in Node.js zero-dep + asymmetric key persistence in dev tools 2026, (c) Secret rotation + STRICT_SECRET fail-closed patterns + CI/local-dev hybrid models | Inline research output → Synthesize |
| **Synthesize** | 1 agent merges 3 research outputs → per-impl-agent concrete specs (canonical payload v2 + Ed25519 wire format + journal schema + key persistence path + STRICT_SECRET semantics) | Inline spec |
| **Implement** | 4 parallel impl agents: (1) r2-verdict.cjs v2 + tests, (2) r2-verdict-journal.cjs + tests, (3) r2-verdict-keys.cjs + pre-commit-review-gate v2 + integration tests, (4) standards/sprint-pipeline.md + SKILL.md + contract test for fencing | Edits to repo |
| **Review** | 6 R2 reviewers in parallel: security / correctness / acceptance / ssot / blind / edge | Per-agent JSON findings |
| **Confidence** | Pass-2 skeptic re-derivation + filter <75 + dedupe | Final triaged list |

## Risks (8) — each with mitigation

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Ed25519 key generation slow on first-use (Node generateKeyPair is ~100-200ms) | Lazy: only generate on first sign-attempt; cache in memory per process |
| R-2 | Schema_version=2 verdict written but verifier on older machine has only v1 code path | Verifier MUST tolerate v2 schema (read commit_sha, ignore if not implemented) — graceful degradation for transition window |
| R-3 | Journal file growth unbounded | FIFO eviction at 1000 entries hard-coded; capacity tunable via env |
| R-4 | Concurrent verdict writes from parallel sprints → journal lost-update | File-lock retry pattern (3 attempts with 50ms backoff); fallback to sequential write |
| R-5 | STRICT_SECRET=1 in CI without env set → CI lane breaks | Document opt-in in standards/sprint-pipeline.md + cortex-doctor check; default = OFF |
| R-6 | Persisted-key migration: existing v0 verdicts signed with host-derived become unverifiable after key persistence rolls in | v0 verdicts retain host-derived fallback resolution; persistence is additive layer, not replacement |
| R-7 | Public key (committed to repo) leaks before private key rotates | Public key is by definition not secret — leak is no-op. Private key never leaves $CORTEX_DATA_HOME. |
| R-8 | Fencing contract test false-positives on plan files with hand-curated content (no AskUserQuestion input) | Frontmatter `generated_by` field opt-in; plans without it are skipped |

## Out of scope (deliberately not in 2.46.1)

- **Multi-reviewer attestation chains** — single signer per verdict (operator's local Steward) sufficient for v0/v1; multi-sig deferred to 2.46.2+ or 4.0 capability marketplace
- **Key rotation tooling** (regenerate + re-sign historical verdicts) — historical verdicts immutable per audit-trail discipline; future verdicts use new key
- **CI lane key provisioning** (GitHub Actions secret integration with `$CORTEX_R2_VERDICT_SECRET`) — documented as operator task, no automation this sprint
- **Verdict TTL / `maxAgeSec`** — single-use journal makes TTL redundant for replay defense; freshness is workflow-run-id uniqueness
- **Cross-platform key portability** (laptop → server) — single-machine model preserved; portable keys would need separate trust framework
- **Public-key publication infrastructure** (transparency log, key directory) — out of scope for personal framework; relevant only if Tier 3 ecosystem ships

## References

- `cortex/sprint-2-46-r2-summary.md` § Deferred to Sprint 2.46.1 — origin of every deliverable
- `bin/steward/_lib/r2-verdict.cjs` (v0 module from Sprint 2.46) — target of v2 schema extension
- `shared/hooks/pre-commit-review-gate.cjs:125-130` — author's own honest comment acknowledging the gap this sprint closes
- `standards/sprint-pipeline.md § Verdict-driven gate` — current spec, to be updated
- `bin/steward/_lib/journal.cjs` — pattern reference for atomic append-only journal (precedent inside cortex)
- `standards/security.md § Agentic Security 2026` — relevant for STRICT_SECRET fail-closed pattern
- `cortex/operator-recap-2026-06-03.md § 4a (D-4, D-5)` — operator-facing context

## Triage policy

Mirror Sprint 2.46 r2-summary.md disposition convention. HIGH apply in-commit, MEDIUM if surgical, Architectural defer to 2.46.2+.

---

*Plan finalized 2026-06-03 by `/cortex-sprint` (Arc 1 sprint 1 of 3). Auto Mode active; sprint 2.46.2 + 2.3.1 follow sequentially after 2.46.1 ships + CI 4/4 green.*
