# Standard - Sprint pipeline (canonical 8-step sprint shape)

> Rule 3 process standard. The cortex-x sprint pipeline is the canonical
> shape for sprint-sized integration work: Discovery → Plan artifact →
> Workflow dispatch → Empirical → Triage → Signed verdict emit → Doc-regen
> + commit → Status report. Extracted to its own standard in Sprint 2.46 so
> SKILL.md, plans, and tooling can reference one SSOT instead of restating
> the pipeline each time it appears.
>
> Status: extracted Sprint 2.46. Canonical implementation lives in
> `shared/skills/cortex-sprint/SKILL.md`; this standard codifies the shape
> the skill operationalizes.

## Pipeline overview {#pipeline-overview}

A cortex-x sprint is a bounded unit of integration work (typically 5–15
deliverables across framework code + standards + tests) shipped through one
operator gesture as a single coherent commit. The pipeline that gesture runs
has eight ordered steps. Each step is mandatory unless the per-step
"skippable" column says otherwise.

| # | Step | One-line purpose | Skippable? |
|---|---|---|---|
| 1 | Discovery | Operator brief → questionnaire → confirmed scope + AC. | No — every sprint must answer the discovery questions. |
| 2 | Plan artifact | Write `cortex/sprint-<N>-plan.md` (brief / scope / DoD / AC / R2 / risks / rollback). | No — plan-first discipline is load-bearing. |
| 3 | Workflow dispatch | Run the 5-phase workflow (Research → Synthesize → Implement → Review → Confidence). | No — the workflow IS the sprint. |
| 4 | Empirical | Run probes / measurements / spike scripts; write `cortex/sprint-<N>-probe-verdict.md`. | Yes — only if the sprint has no probe deliverable. |
| 5 | Triage | Classify R2 findings (HIGH / MEDIUM / LOW / Architectural) and apply or defer per policy. | No — even a clean review is triaged (zero-findings is a valid verdict). |
| 6 | Signed verdict emit | Write `cortex/r2-verdict.json` with HMAC-SHA256 signature over `{sprint_id, workflow_run_id, timestamp, agent_roster, findings, applied, deferred, refuted, decision}`. (Commit-SHA binding + replay journal deferred to Sprint 2.46.1 — see § Verdict-driven gate.) | No — primary pre-commit unblock path (Sprint 2.46+). |
| 7 | Doc-regen + commit | Run `cortex-doc-regen --apply`, stage diff, commit with conventional subject + `R2-verdict: <hash8>` trailer. | No — managed blocks must converge before commit. |
| 8 | Status report | Emit operator-facing summary (deliverables shipped, R2 stats, deferred items, next-sprint pointer). | No — the report is the operator's checkpoint. |

The 5-phase workflow inside step 3 (Research / Synthesize / Implement /
Review / Confidence) is the sub-pipeline that the cortex-sprint skill
dispatches via the Workflow tool. Steps 1–2 set it up; steps 4–8 land its
output.

## Phase contract {#phase-contract}

Inside step 3 (Workflow dispatch), the 5 phases each have a tight
input/output contract. Operators do not interleave phases; the workflow
runtime enforces the sequence.

| Phase | Input | Output | Mutates tree? | Typical model |
|---|---|---|---|---|
| Research | Plan artifact + topic list extracted from scope | `cortex/sprint-<N>-research.md` + cached `$CORTEX_DATA_HOME/research/<topic>.md` per topic | No | sonnet for breadth, opus if R1 depth flag set |
| Synthesize | Research markdown + plan AC | Concrete per-agent implementation specs (inline or `cortex/sprint-<N>-synthesis.md`) | No | opus (synthesis is the bottleneck) |
| Implement | Synthesis output + repo state | Edits to working tree across N parallel impl agents | **YES** (only phase that mutates) | sonnet |
| Review | Diff (staged or unstaged) | 6-agent findings + judge ranking + Pass-2 dissent on uncertain HIGH | No | sonnet for fan-out, opus for judge |
| Confidence | Review output + AC checklist + test status | Final go/no-go verdict; if go, payload feeds step 6 (verdict emit) | No | opus |

**Strict ordering invariants:**

1. Research MUST complete before Synthesize (synthesize without research is
   speculation; the R1 discipline exists for a reason).
2. Implement is the only mutating phase. Review reads the diff Implement
   produced; Review never writes.
3. Confidence is non-optional. A sprint that "looks done" without an
   explicit Confidence verdict has not finished step 3.
4. Phase outputs persist to disk OR to typed return values; never to
   "agent remembers from earlier turn". Inter-phase state is on the
   filesystem so the workflow is restart-safe.

## Workflow vs session runtime {#workflow-vs-session-runtime}

Sprint 2.44 Probe 3 empirically established that **Claude Code's workflow
runtime does not propagate `~/.claude/settings.json` PostToolUse /
PreToolUse hooks to subagent dispatches**. Workflow run `wf_d2f0c3a4-2c7`
ran 22 subagents on 2026-06-02; the cortex journal at
`journal/2026-06-02-cortex-x.jsonl` showed 305 entries from main-session
tool calls but ZERO entries with `tool=Task` from workflow dispatches. The
hook code path is correct (probes T1–T4 pass against synthesized
fixtures); the workflow runtime simply does not dispatch through it.

**Implications for sprint pipelines:**

- The cortex hook safety floor (block-destructive, tirith-scan,
  pre-commit-review-gate marker propagation) does NOT apply inside step 3
  (Workflow dispatch). Workflow subagents are a separate trust domain.
- Sprint commits that ran R2 inside the workflow cannot rely on the
  session-marker pre-commit gate. Marker is written by
  `post-tool-use.cjs` when it sees `tool_name=Task`; workflow Task calls
  bypass that path.

**Structural fix: the signed verdict (step 6).** Instead of relying on a
fragile marker side-effect, the cortex-sprint pipeline emits
`cortex/r2-verdict.json` — a JSON artifact that explicitly records "R2 ran,
findings were X/Y/Z, decision is PASS, signed against this commit SHA". The
pre-commit hook then reads the file, verifies HMAC, and allows the commit.
This decouples the gate from the runtime path of the R2 agents.

**Fallback: `[skip-review]`.** When the verdict pipeline is unavailable (CI
lane, hot-fix, broken signing chain), the commit message tag
`[skip-review]` remains a supported escape hatch. It is no longer the
default for sprint commits — for Sprint-shaped work, emit the verdict.

## Verdict-driven gate {#verdict-driven-gate}

**Schema SSOT:** `bin/steward/_lib/r2-verdict.cjs` (verdict builder +
verifier + secret resolver). See that file's header comment for the wire
format; see this section for the gate behavior contract.

**Gate behavior table** (`shared/hooks/pre-commit-review-gate.cjs`).
v0 shipped in Sprint 2.46 covers ONLY signature + schema_version + `decision`
PASS/FAIL semantics; rows reflect the actually shipped code, not aspirational
properties.

| State of `cortex/r2-verdict.json` | Gate decision | Reason returned |
|---|---|---|
| File absent | Fall through to marker check | n/a |
| File present, malformed JSON | Fall through silently | n/a (not an error — gate is permissive) |
| File present, signature verifies, `decision: "PASS"` | **ALLOW** | "signed R2 verdict present" |
| File present, signature verifies, `decision: "FAIL"` | Fall through to other gates | n/a |
| File present, signature mismatch (tampered) | Fall through silently | n/a (treated same as absent — verdict is informational, not enforced as deny) |
| File present, schema_version mismatch | Fall through silently | n/a |
| Secret unset (`CORTEX_R2_VERDICT_SECRET`) AND no host-fallback path | Fail-OPEN with `CORTEX_R2_VERDICT_NO_SECRET_WARNING` | "signed R2 verdict present (no secret to verify; warning logged)" |
| Secret unset, falls back to hostname-derived key (default for local dev) | Signer + verifier both use the same fallback → signature matches normally | "signed R2 verdict present" |

**Why the gate is permissive on tamper/mismatch:** the verdict is one of
*four* allow paths (`[skip-review]` tag, `CORTEX_REVIEW_GATE=0` env,
session-marker, signed verdict). A tampered verdict simply does not satisfy
this path; the commit still has three other unblock options. Refusing the
commit on tamper would couple the gate to the verdict path and undo the
structural separation step 6 was designed to enable.

**HMAC vs Ed25519:** Sprint 2.46 ships HMAC-SHA256 because signer +
verifier run on the same machine, single principal, zero-deps,
Windows-portable. Ed25519 is deferred until cross-machine verification
becomes a requirement (multi-operator setups, signed verdicts shipped to
clients, public-attestation use cases).

### Sprint 2.46.1 backlog (deferred verdict properties) {#verdict-deferred}

The v0 shipped in Sprint 2.46 deliberately defers the following bindings;
they are NOT enforced by the gate today. Operators relying on these
properties before Sprint 2.46.1 lands are relying on bindings that do not
exist:

- **commit_sha binding** — the signed payload does NOT include `commit_sha`,
  and the gate does NOT cross-check against `git rev-parse HEAD`. A
  freshly-signed verdict can unblock any subsequent commit on the same
  machine until the file is overwritten. Cross-commit replay defense lands
  in Sprint 2.46.1 alongside Ed25519 promotion.
- **Age / expiry (`maxAgeSec`)** — verdict has no TTL field. Operators
  rotate verdicts by overwriting `cortex/r2-verdict.json`.
- **STRICT_SECRET=1 hard-fail mode** — no such env var is read. Missing
  secret today fails-OPEN with a warning code (see table above). Strict
  mode for CI deferred to Sprint 2.46.1.
- **Workflow-run-id nonce journal** — verdict can be re-applied without a
  per-`workflow_run_id` burn check. Single-use semantics deferred.

These deferred items are tracked in
`cortex/sprint-2-46-r2-summary.md § Deferred to Sprint 2.46.1`.

## Triage discipline {#triage-discipline}

Step 5 classifies every R2 finding into one of four buckets. The
classification rules are mechanical so operators do not negotiate severity
mid-triage.

| Bucket | Definition | Cap-time per finding | Defer rationale (must be recorded) |
|---|---|---|---|
| **HIGH** | Correctness, security, or AC-violating defect. Affects committed contract. | ~15 min apply effort; escalate if exceeded. Beyond cap = defer with explicit rationale. | "Larger than 30 LoC + spans 3+ files" OR "requires new dependency" OR "blocks on architectural decision deferred to next sprint". |
| **MEDIUM** | Quality, ergonomics, or non-AC robustness gap. | ~30 min apply effort if surgical (1–2 files, <30 LoC, no API change). Otherwise defer. | "Non-surgical scope" OR "below threshold for this sprint's AC". |
| **LOW** | Nit, style, or speculative concern without concrete repro. | Do not apply in-sprint. Log only. | Default = "logged for future sprint pass; not load-bearing for AC". |
| **Architectural** | Touches Rule 1 pillars (SSOT / Modular / Scalable) OR cross-sprint contract. Cannot be applied surgically. | Always defer. | "Cross-sprint architectural decision; opens follow-up sprint <N.X>". |

**Triage output format** (machine + human readable, lives in
`cortex/sprint-<N>-r2-summary.md`):

```
HIGH (applied): <list of finding IDs with 1-line each + commit ref>
HIGH (deferred): <list with rationale per finding, target sprint <N>.1>
MEDIUM (applied): <list>
MEDIUM (deferred): <list with rationale>
LOW (logged): <list>
Architectural (opens follow-up): <list with new sprint number reservation>
```

**Cap-time discipline:** if a HIGH consumes >15 min, stop applying, defer
with rationale, file follow-up sprint. Do not silently overrun. The
discipline exists because sprints with one finding that eats the whole
budget produce worse outcomes than sprints that defer cleanly and ship.

## Doc-regen step {#doc-regen-step}

Step 7 runs `node bin/cortex-doc-regen.cjs --apply` before the commit. This
refreshes every managed state-block in the repo: `state-snapshot`,
`capability-counts`, `test-counts`, `coverage`, `loc-summary`,
`git-activity`, `deps` (see `standards/documentation.md` § State block
convention for the marker contract).

**Integration with `cortex-doc-regen --apply`:**

- Run BEFORE `git add` so the regen diff is part of the sprint commit.
- Idempotent: a second run on the same tree is a no-op.
- Fast: <2s on the cortex-x repo.
- If the regen produces a diff that the sprint did NOT cause (orphan drift
  from a previous forgotten regen), fold the fix into the sprint commit
  and note "regen catches up after Sprint <X> forgot to run" in the
  commit body. Do not open a separate PR for orphan drift.

**For prose-only sprints** (writing standards / docs / ADRs without code
change), step 7 is still mandatory but is typically a no-op (the managed
blocks have nothing to update). It stays in the pipeline so it cannot be
forgotten on the next code-touching sprint.

**Failure mode — regen surfaces drift mid-sprint:** apply the drift fix
in the same commit, note it in commit body. The signed verdict (step 6)
was computed before regen — the v0 verdict does not bind to `commit_sha`
(Sprint 2.46.1 backlog) so no re-sign is needed after regen, but operators
should track the diff between the verdict's `findings`/`applied` counts
and the final commit's contents in the r2-summary.md audit trail.

**Reference SSOT:** `standards/documentation.md § State block convention`
owns the marker contract. This sprint-pipeline standard owns the
when-to-run-it discipline.

## Anti-patterns {#anti-patterns}

Patterns that look efficient but rot the pipeline:

1. **Inline-defining the pipeline inside `sprint-<N>-plan.md` instead of
   referencing this standard.** The 8-step shape is SSOT here. Plans cite
   it; they do not restate it. Restated copies drift the first time the
   pipeline evolves (e.g. step 6 was added Sprint 2.46 — every restated
   plan would now be stale).

2. **Skipping Triage (step 5) when R2 returns "no HIGH findings".** Zero
   findings is a valid triage outcome but it is still an explicit
   classification step. Skipping it loses the record that R2 actually
   ran with that outcome on that commit. Always emit the triage summary,
   even if every bucket is empty.

3. **Committing without a verdict OR `[skip-review]`.** One of the four
   pre-commit unblock paths must be satisfied: signed verdict, session
   marker, `[skip-review]` tag in commit message, or `CORTEX_REVIEW_GATE=0`
   env. A commit that none of those allow is a gate bypass attempt; the
   hook will block and the operator will paper over with `--no-verify`.
   Decide deliberately which unblock path applies and record it in the
   commit body.

4. **Editing past-sprint plans retroactively.** Plans are append-only
   artifacts. Add a "References" bullet pointing to follow-up sprints,
   but do not rewrite the brief / scope / DoD after the sprint shipped.
   Plans are the audit trail of what was decided when; mutation
   destroys that signal.

5. **Mixing workflow-driven and session-driven edits in one commit.** A
   commit either has its diff from a workflow's Implement phase (in
   which case R2 ran in the workflow and the gate needs the verdict
   path), OR it has session-driven edits (where the session-marker
   path applies). Mixing the two confuses the gate: the verdict was
   computed against the workflow diff but the actual `git diff` includes
   later session edits. If you need both, ship them as two commits.

## Cross-links

- **`standards/documentation.md`** — State block convention SSOT;
  doc-regen step (7) integration contract.
- **`standards/workflows.md`** — Workflow primitive (the step-3 runtime);
  hook-bypass empirical finding that motivates step 6.
- **`shared/skills/cortex-sprint/SKILL.md`** — Canonical implementation
  of the 8-step pipeline; this standard codifies what the skill runs.
- **`bin/steward/_lib/r2-verdict.cjs`** — Verdict builder + verifier;
  schema SSOT for step 6.
- **`shared/hooks/pre-commit-review-gate.cjs`** — Gate implementation
  that consumes the verdict per the table in § Verdict-driven gate.
- **`cortex/sprint-2-44-plan.md`** — first sprint to run the 8-step
  shape end-to-end (before extraction); backfill bullet added Sprint 2.46.
- **`cortex/sprint-2-45-plan.md`** — second validation of the pattern;
  backfill bullet added Sprint 2.46.
- **`cortex/sprint-2-46-plan.md`** — the extraction sprint; this
  standard is its primary deliverable.
