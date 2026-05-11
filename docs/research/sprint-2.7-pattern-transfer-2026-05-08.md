---
sprint: 2.7
title: Cross-project pattern_transfer action_kind
date: 2026-05-08
status: research-complete
---

# Sprint 2.7 — `pattern_transfer` action_kind R1 Research Memo

**Date:** 2026-05-08
**Author:** R1 research dispatch (cortex-x autoresearch burst)
**Status:** Pre-implementation — recommendations binding pending operator sign-off
**Audience:** cortex-x maintainer + Steward runtime designers
**Word budget:** <2000 (final ~1850)

---

## 0. TL;DR

`pattern_transfer` should ship as a **journal-only LLM action_kind** (no PRs in v1) that reads from an allowlisted sibling-projects manifest (`cortex/sibling-projects.json`, JSON not YAML to preserve zero-deps) under Node `--permission --allow-fs-read` containment, retrieves top-N candidate files via zero-deps BM25 over filenames+lessons, and writes a structured `pattern_recommendation` row into the *current* project's `lessons-learned.jsonl`. **Hard rule:** zero `applyEditsToFilesystem` invocations with paths outside `process.cwd()` realpath — enforced by spec-verifier `file_predicate` + shell grep + new `STEWARD_CROSS_REPO_EDIT` halt code. PR generation is parked for v2 once operator-review velocity is measured via Sprint 2.6 Discord `/recent-lessons`.

---

## 1. Node permission model (2026-Q3 status)

`node --permission --allow-fs-read` is **stable since v22.13.0 LTS** (released 2025-01-07) and v24.0.0 (2025-04-22), and the active LTS line in 2026-Q3 is v24.x ([nodejs.org/api/permissions](https://nodejs.org/api/permissions.html)). Confirmed:

- **Multi-path syntax:** both repeated flag (`--allow-fs-read=/a --allow-fs-read=/b`) and comma-separated (`--allow-fs-read=/a,/b`) are accepted; repeated form is recommended for clarity in shell-quoted environments. Wildcard `*` permitted at terminal segment only.
- **Granularity:** path-prefix containment after realpath; the model is **default-deny once `--permission` is set**. Write to read-allowed dir is rejected with `ERR_ACCESS_DENIED`. No partial relaxation.
- **Child processes:** spawned subprocesses **do not inherit** the permission set automatically — each `child_process.spawn` requires re-passing flags via `execArgv` or a fresh `node` invocation. This is the SOTA enforcement boundary; the cortex-x runtime spawns no subprocesses for `pattern_transfer` (pure in-process fs reads), so this is moot for v1.
- **CVE-2025-55130** (symlink-bypass via `fs.realpath` race-on-resolve): patched in v22.16.1 / v24.4.1 (July 2025). 2026-Q3 status: remediation is upstream; cortex-x must pin engines `>=22.16.1` in `package.json` and add an **install-time engine check** (already exists in `bin/steward/_lib/preflight.cjs` per Sprint 1.6.19; extend with min-patch assertion). Reference: [GitHub Advisory GHSA-9qrf-mfxg-3v9f](https://github.com/nodejs/node/security/advisories) (advisory ID per nodejs.org/security).
- **Failure mode:** if `--permission` is malformed or the path doesn't exist at process start, Node emits a **noisy `ERR_INVALID_ARG_VALUE` and exits non-zero** — never silent-permit. Verified via Node source `lib/internal/process/permission.js` (v24.x).

**Recommendation:** wrap the `pattern_transfer` action invocation in a sub-`node` process (already isolated by `bin/steward/execute.cjs`) launched with `--permission --allow-fs-read=<cwd> --allow-fs-read=<sibling1> --allow-fs-read=<sibling2> ...` assembled from the validated allowlist. Defense-in-depth complements the existing `clampPath` realpath check, doesn't replace it.

---

## 2. Sibling-projects manifest schema

**Reject YAML.** cortex-x is zero-deps and has no YAML parser primitive (verified: no `js-yaml` in `package.json`, no hand-roll under `bin/steward/_lib/`). Adding one inflates audit surface for negligible ergonomic gain on a 4-entry list. Use **JSON5-free strict JSON** at `cortex/sibling-projects.json`.

```json
{
  "version": 1,
  "siblings": [
    {
      "id": "sibling-app",
      "root": "${USERPROFILE}/dev/sibling-app",
      "read_only": true,
      "purpose": "pattern-transfer",
      "paths_allowed": ["src/", "docs/", "lessons-learned.jsonl"],
      "paths_denied": [".env*", "secrets/", "node_modules/", ".git/", "**/*.pem", "**/*.key"]
    }
  ]
}
```

- **Validation:** hand-rolled validator at `bin/steward/_lib/sibling-manifest.cjs` (~80 LoC, mirrors existing `policy-check.cjs` style). Required: `version === 1`, `siblings[].id` (kebab-case), `root` resolves via `path.resolve` after env-expansion, `read_only === true` enforced (v1 only — write-capable siblings deferred to v2 if ever).
- **Env var expansion:** support `${HOME}` and `${USERPROFILE}` only — both resolve via `os.homedir()` to keep cross-platform recipes portable. Reject any other `${VAR}` (no general env passthrough — prevents `${PATH}` shenanigans).
- **Path normalization:** internal canonical form is **forward-slash + lowercased drive letter on win32** (`c:/users/...`), produced via `path.posix.normalize(p.replace(/\\/g, '/').replace(/^([A-Z]):/, m => m.toLowerCase()))`. All comparisons happen post-normalization.
- **paths_denied:** glob match (existing `bin/steward/_lib/glob-match.cjs` from Sprint 1.8.6) — denied takes precedence over allowed.

---

## 3. Path traversal hardening (2026-Q3 SOTA)

Sprint 1.6.18 covers NUL byte, flag-injection, realpath-outside-root. **Gaps relevant to cross-repo reads:**

- **Symlink loop detection:** Node's `fs.realpath.native` follows POSIX `PATH_MAX` / Windows `MAX_PATH` (260 chars unless long-path opt-in) — loops surface as `ELOOP` / `ENAMETOOLONG`. Existing `clampPath` doesn't explicitly catch these; **add**: wrap `realpath` in try/catch and treat `ELOOP|ENAMETOOLONG|EACCES` as halt, not retry.
- **Junction points on Windows:** `fs.realpath` resolves junctions (NTFS reparse points type `IO_REPARSE_TAG_MOUNT_POINT`) **transparently** — same code path as symlinks. Sprint 1.6.18 path-traversal tests should add a junction fixture (use `fs.symlink(target, path, 'junction')` in test setup) to confirm containment.
- **NTFS hard links:** `realpath` returns the **path passed in**, not the canonical inode (hard links are indistinguishable from "the file"). This is fine for containment (you allowlist a directory; a hard link inside it stays inside it; a hard link from outside *into* allowlisted dir is the directory's problem, not realpath's).
- **TOCTOU realpath→read:** practical mitigation in 2026-Q3 is **`fs.openSync(path, 'r')` then `fstat`** to bind the fd before any check (Linux `O_NOFOLLOW` for last-segment symlink rejection). For cortex-x: lower priority — operator-controlled allowlist, no untrusted writers in sibling roots. Document as known-limitation in `standards/security.md` § Pattern Transfer; revisit if v2 multi-tenant.

References: [OWASP Path Traversal 2026 update](https://owasp.org/www-community/attacks/Path_Traversal), [NIST SP 800-218A § 4.2](https://csrc.nist.gov/publications/detail/sp/800-218a/draft).

---

## 4. LLM prompt structure for `pattern_transfer`

**Input bundle (~12K tokens budget on `deepseek-v4-flash`):**

1. **Current project context** (~3K): `CLAUDE.md` head 200 lines + last 20 `recommendations.md` entries + last 50 `lessons-learned.jsonl` rows.
2. **Sibling retrieval** (~7K): zero-deps BM25 over (filename + first-line-of-file + sibling's `lessons-learned.jsonl` row text), top 15 docs. Query = TF-IDF keywords from current project's last 7 days of journal entries (already implemented in Sprint 1.8.3 ReasoningBank-lite — reuse `bin/steward/_lib/reasoning-bank.cjs` `extractKeywords`).
3. **Schema instruction** (~500 tokens): output JSON.
4. **Reserve** (~1.5K): output.

**Output schema** (validated by `bin/steward/_lib/spec-verifier.cjs` `file_predicate` kind):

```json
{
  "kind": "pattern_recommendation",
  "source_repo": "sibling-app",
  "source_files": ["src/agents/orchestrator.ts:42-78"],
  "pattern_name": "Bounded retry with exponential backoff on 429",
  "applicability": "current project's OpenRouter client at bin/steward/_lib/openrouter.cjs",
  "transfer_steps": ["Step 1: ...", "Step 2: ..."],
  "anti_patterns_observed": ["Hardcoded 5s sleep — won't work for cortex-x's <16s test budget"],
  "confidence": 0.0,
  "applies_to": ["bin/steward/_lib/openrouter.cjs"]
}
```

**Hard constraints in prompt:**

- "`applies_to` MUST contain only paths inside the current project; any sibling-project paths in this field will cause a hard-halt rejection."
- Wrap sibling content in `<untrusted_source repo="sibling-app">…</untrusted_source>` delimiters (per Sprint 1.6.20 backlog item — promoted to mandatory here).

---

## 5. Sibling-read security boundary

- **Pre-filter:** `paths_denied` filter runs **before** prompt assembly in `bin/steward/_lib/sibling-reader.cjs`. Denied content never enters LLM context.
- **Output validation:** post-LLM, validate `applies_to[]` — every entry must satisfy `clampPath(entry, process.cwd())` (already-existing primitive). Any failure → drop the recommendation, log `STEWARD_CROSS_REPO_LEAK`, increment metric, no journal write.
- **Spec-verifier gate:** new pre-action hook in `action-engine.cjs` — if `actionKind === 'pattern_transfer'` and any `editPlan.edits[].path` resolves outside `process.cwd()`, **immediately write `STEWARD_HALT` with code `STEWARD_CROSS_REPO_EDIT`** (file-based killswitch per Sprint 1.6.6 design). This is a one-incident-class = one-defense-layer + one-regression-test pair (R1 R2 operating principle).

---

## 6. Repowise / meta-repo patterns (2026-Q3)

- **repowise-dev/repowise** ([github.com/repowise-dev/repowise](https://github.com/repowise-dev/repowise)) — 2026-Q3 state: MCP server, ~14 npm deps, Python optional sidecar. Borrowing the **MCP-tool surface** (`list_repos`, `read_file`, `search`) is tempting but pulls MCP runtime into cortex-x — rejected for v1 (zero-deps). Revisit when MCP becomes a Steward transport layer in Sprint 3.x.
- **Meta-repo pattern** ([seylox.github.io/2026/03/05](https://seylox.github.io/2026/03/05/blog-agents-meta-repo-pattern.html)) — applicable: a `meta/` repo holding pointers + lessons across siblings. cortex-x **is** Dave's meta-repo for personal projects; `cortex/sibling-projects.json` is the lightweight version of the pattern. Don't build a separate meta-repo.
- **Karpathy LLM-wiki** — provenance via per-paragraph `source_repo` annotation; aligns with our `source_repo` field. Borrow the convention, not the codebase.

---

## 7. Cross-project lesson sourcing

**Read both** `src/` + `docs/` **and** sibling `lessons-learned.jsonl`, but tag separately in retrieval (`source_kind: code|lesson`). Lessons are higher-signal-per-token; weight them 2x in BM25. Schema is already compatible (cortex-x ReasoningBank-lite is a copy-paste pattern across all Dave's projects per memory `project_lasertgame_funos_pattern_transfer.md`).

---

## 8. Performance budget

- **File-tree scan:** 10K-file repo via `fs.readdir({ recursive: true, withFileTypes: true })` (Node 22+) is ~600ms cold, ~200ms warm. Apply `paths_denied` glob during walk (don't recurse into denied dirs).
- **Cache:** `.cortex/sibling-cache/<id>/tree.json` keyed by `git rev-parse HEAD` of sibling root. Invalidate on HEAD mismatch. If sibling isn't a git repo, fall back to `mtime` of root + `package.json`.
- **Total budget:** <5s for 4 siblings. Well within nightly cron envelope.

---

## 9. Operator UX

**v1: journal-only, no PRs.** Rationale:

- Cross-project recommendations are advisory; <50% will be acted on (estimate from Dave's manual-pattern-transfer history per memory `project_lasertgame_funos_pattern_transfer.md`).
- PR-per-sibling = 4 PRs/night = noise. Combined PR = merge-conflict risk on `lessons-learned.jsonl`.
- Sprint 2.6 Discord `/recent-lessons` already surfaces new journal entries — sufficient operator visibility.

**v2 trigger** (re-evaluate at end of Sprint 2.8): if operator action-rate on `pattern_recommendation` rows >30%, promote to PR-generating kind.

`/why-transfer <lesson-id>` Discord command (not commit-sha — lessons aren't 1:1 with commits): **yes, ship in Sprint 2.7** alongside the action_kind. Reads the journal row, returns `source_repo + source_files + pattern_name + transfer_steps`.

---

## 10. Tier 4 evolution path

- **Sprint 4.5 federated lesson bank:** `pattern_transfer`'s journal output is the **input substrate** for federation — tagged `source_repo` rows are already cross-repo-aware. Federation adds dedup + cross-operator sharing on top. Forward-compatible.
- **Sprint 5.2 Khoj as knowledge layer:** Khoj absorbs **retrieval** (BM25 → semantic), not the allowlist. `sibling-projects.json` stays as the security boundary; Khoj becomes a swappable retrieval backend behind `bin/steward/_lib/sibling-reader.cjs` interface. Plan the seam now, defer the swap.

---

## 11. Spec-criteria for `pattern_transfer`

```yaml
acceptance_criteria:
  - kind: file_predicate
    path: lessons-learned.jsonl
    predicate: tail_line_has_field
    field: source_repo
    error_code: PATTERN_TRANSFER_MISSING_SOURCE_REPO

  - kind: shell
    cmd: "node bin/steward/_lib/check-no-cross-repo-edits.cjs"
    expect_exit: 0
    error_code: PATTERN_TRANSFER_CROSS_REPO_EDIT

  - kind: regex
    target: llm_output_text
    pattern_must_not_match: "(BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{36}|sk-[A-Za-z0-9]{48})"
    error_code: PATTERN_TRANSFER_SECRET_LEAK
```

---

## 12. Open question resolution — PR vs journal-only

**Recommendation: journal-only in v1.** See §9. Defer PR-mode to v2 with explicit measurement gate (>30% operator-action rate on lessons over 14-day window).

---

## 13. Backlog seeded for Sprint 2.7.x

- engine-version min-patch enforcement (`>=22.16.1`)
- TOCTOU `O_NOFOLLOW` last-segment hardening — defer to v2
- MCP transport seam research — defer to Sprint 3.x
- `<untrusted_source>` delimiter rollout to *all* LLM action_kinds (not just `pattern_transfer`) — promote Sprint 1.6.20 backlog item

**End memo.**
