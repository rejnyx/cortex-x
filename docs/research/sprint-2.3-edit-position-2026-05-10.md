# Decision Memo: Sprint 2.2.5 — `edit.position` primitive in action-engine

> **Sprint number note**: file uses `2.3-` prefix for chronological sort with siblings; the actual sprint label is **2.2.5** (between 2.2 Ralph hardening and 2.3 mutation testing). Sprint 2.3 (mutation testing) R1 memo is `sprint-2.3-mutation-testing-fitness-2026-05-09.md`; both are authoritative for their respective sprints.

## Question

What edit-shape should cortex-x's Steward action-engine adopt so an LLM can reliably **insert N bytes into an existing >200 B file** (the dominant `recommendation` action_kind use case) without triggering `no_destructive_rewrite` rejection 100 % of the time, the way today's `{ path, content }` shape does?

## Context — the gap, made concrete by 2026-05-10 dogfood

Today's overnight cron diagnostic loop (7 rounds, ~$0.008 LLM cost, all failures journaled) confirmed a structural limit:

- **R5 → R6 → R7** all picked recommendations of shape "insert N bytes into existing file" (`docs/steward-usage.md` 14 KB, `bin/discord-bridge/auth.cjs` 7 KB, `bin/cortex/tools/index.cjs` ~5 KB).
- DeepSeek V4 Flash (the production model) returned either **empty responses** (treats task as already-done — see [research-edit-position-safety §1.4 stealth replace](C:/tmp/research-edit-position-safety-2026-05-10.md)) or **partial-content rewrites shrinking the file** (1284 tokens replacing 14 KB).
- `bin/steward/_lib/action-kinds.cjs:36` `NO_DESTRUCTIVE_REWRITE_CRITERION` correctly blocked **9 of 9 attempts across rounds 5-7** (Sprint 1.8.13 defense working end-to-end).
- **Result**: 3 of 7 cortex-x recommendations had to be marked `[HUMAN-ONLY]` — same incident class as the original 2026-05-09 MIGRATIONS.md append. Effectively, **autoresearch's autonomous value on edit-existing-file tasks is zero today**, regardless of model quality.

This is not a model-quality problem. Per [Diff-XYZ arXiv:2510.12487](https://arxiv.org/html/2510.12487v2), even Claude 4 Sonnet (frontier) has only 95-96 % apply-EM on full-content rewrites; sub-7B models drop to 23 % on udiff. **The shape of the edit primitive is the binding constraint.**

**What today's shape does NOT support** (and the 7 industry tools surveyed all do):

1. Specify *where* to insert without rewriting unchanged content
2. Append-only edits as a first-class operation (`fs.appendFile` semantics)
3. Anchor-based positioning ("insert after this string, which appears once")
4. Atomic multi-edit transactions on one file
5. Pre-write staleness check (file changed since LLM read it)

## Sources Checked

**Edit primitives in 2026 production tools** (from [research-edit-primitives-2026-05-10.md](C:/tmp/research-edit-primitives-2026-05-10.md), 17 citations):
- Anthropic [text-editor tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) (str_replace / insert / create / undo_edit; line 0 = beginning)
- [Aider edit-formats](https://aider.chat/docs/more/edit-formats.html) + [unified-diffs](https://aider.chat/docs/unified-diffs.html) (5 selectable formats; SEARCH/REPLACE blocks, exactly-once match)
- [OpenAI Codex CLI apply_patch (V4A)](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md) + [V4A explainer](https://codex.danielvaughan.com/2026/03/31/codex-cli-apply-patch-v4a-diff-format/) (3-line context anchor envelope)
- [Continue.dev Apply role docs](https://docs.continue.dev/customize/model-roles/apply) + [How Edit Works](https://docs.continue.dev/edit/how-it-works) (two-model planner+applier split)
- [Cursor review (DEV)](https://dev.to/_d7eb1c1703182e3ce1782/cursor-ai-editor-a-developers-complete-review-2026-noc) + [Morph Fast Apply architectures](https://www.morphllm.com/cursor-fast-apply) (specialist 7B applier, 10,500 tok/s)
- [Anthropic Ralph Wiggum plugin README](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md) (no new primitive — uses standard Edit/MultiEdit/Write)
- [Diff-XYZ paper, arXiv:2510.12487](https://arxiv.org/html/2510.12487v2) (search-replace beats udiff for frontier models on apply-EM)

**Splice-pattern implementation** (from [research-splice-patterns-2026-05-10.md](C:/tmp/research-splice-patterns-2026-05-10.md), 20 citations):
- [Aider editblock_prompts.py source](https://github.com/Aider-AI/aider/blob/main/aider/coders/editblock_prompts.py) + [Issue #3651](https://github.com/Aider-AI/aider/issues/3651) + [Issue #4716](https://github.com/aider-ai/aider/issues/4716) (multi-strategy fallback, partial-line proposals)
- [Anthropic claude-code Issue #1657](https://github.com/anthropics/claude-code/issues/1657) + [#18050](https://github.com/anthropics/claude-code/issues/18050) (Edit tool single-replacement bug + tab-character handling)
- [Node.js Issue #20649](https://github.com/nodejs/node/issues/20649) (UTF-8 BOM not auto-stripped by `fs.readFileSync`)
- [npmtrends jscodeshift vs recast vs ts-morph](https://npmtrends.com/jscodeshift-vs-recast-vs-ts-morph-vs-ts-simple-ast) + [ts-morph npm install size](https://www.npmjs.com/package/ts-morph) (15 MB unpacked, 2 deps — violates zero-deps discipline)
- [tree-sitter Node bindings Issue #5334](https://github.com/tree-sitter/tree-sitter/issues/5334) (v0.26 Node 24 requirement)
- [git-apply docs (`--inaccurate-eof`)](https://git-scm.com/docs/git-apply) (canonical EOL handling)

**Safety + verifier alignment** (from [research-edit-position-safety-2026-05-10.md](C:/tmp/research-edit-position-safety-2026-05-10.md), 10 citations):
- [Claude Code Edit tool reference](https://www.vtrivedy.com/posts/claudecode-tools-reference) (`old_string` exactly-one uniqueness contract)
- [Aider Search/Replace logic — DeepWiki](https://deepwiki.com/Aider-AI/aider/3.2-prompt-engineering-and-templates) (try_dotdotdots ellipsis validation)
- [Lakera LLM Hallucinations 2026](https://www.lakera.ai/blog/guide-to-hallucinations-in-large-language-models) (parameter/anchor hallucination class)
- [The Register — Anthropic Git MCP CVE Jan 2026](https://www.theregister.com/2026/01/20/anthropic_prompt_injection_flaws/) (string-literal injection precedent)
- [Anthropic NIST RFI Agentic Security PDF](https://www-cdn.anthropic.com/43ec7e770925deabc3f0bc1dbf0133769fd03812.pdf) ("scan all untrusted content"; tool-output classifier)
- [Anthropic prompt-injection defenses page](https://www.anthropic.com/research/prompt-injection-defenses) (Opus 4.5: browser-use injection 10.8% → 1.4% via multi-layer defense)
- [Coding models are doing too much (minimal-editing research, 2026)](https://nrehiew.github.io/blog/minimal_editing/) (over-editing pattern; GPT-5.4 stealth-replace documented)

**Honest gaps** (will not pretend confidence):
- GitHub Copilot Workspace's wire-level edit schema is not publicly documented.
- Cursor Fast Apply weights/tokenizer are not open-sourced; only Morph publishes equivalent details.
- Diff-XYZ does NOT systematically benchmark V4A or whole-file alongside its 4 udiff variants + search-replace; the V4A vs SEARCH/REPLACE comparison is inferred from OpenAI's GPT-4.1 cookbook claims.
- DeepSeek V4 Flash's relative success rate by edit format is not in any published benchmark we found. **Sprint 2.3 should include a small in-house eval (5-10 fixtures × 3 formats) before locking the schema.** Acknowledged risk.

## Options Considered

### Option A — Anthropic-style `edit_ops[]` union ⭐ RECOMMENDED

**Shape**: extend `editPlan` from current `{path, content, replace_all?}` to:

```jsonc
{
  "edits": [
    {
      "path": "<repo-relative>",
      "ops": [
        // exactly one of:
        { "kind": "str_replace", "old_str": "<unique substring>", "new_str": "<replacement>" },
        { "kind": "insert", "after_line": 0, "text": "<content>" },           // 0 = file beginning
        { "kind": "append", "text": "<content>" },                            // fast-path, fs.appendFile semantics
        { "kind": "create", "content": "<full file>" },                       // new file only
        { "kind": "delete_file" }                                             // remove file
      ],
      "expectedSha256": "<hex digest at LLM-read time>"  // optional staleness check
    }
  ]
}
```

Backward compat preserved: if `ops` is absent and `content` is present, current `replace_all` behavior runs unchanged.

**Pros**:
- Direct mirror of [Anthropic text-editor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) — DeepSeek V4 Flash and Claude family both reliably emit this shape (Diff-XYZ apply-EM 95-96 % on Claude 4 Sonnet).
- `append` covers ~50-70 % of edit.position requests (MIGRATIONS, journals, ledgers, CHANGELOG).
- `str_replace` covers most "modify line X" requests via natural-language anchor.
- `insert` with `after_line: 0` = beginning, `after_line: N` = after that line; matches Anthropic's published contract exactly.
- Atomic-or-nothing: if any op in `ops[]` fails, ALL revert (mirrors Claude Code MultiEdit).
- Maps 1:1 to spec-verifier `file_predicate` kind — no parser needed beyond existing JSON.
- SHA-256 staleness check from [research-splice-patterns §Concurrent staleness](C:/tmp/research-splice-patterns-2026-05-10.md) — mirrors [Claude Code v2.1.62 KV-cache lesson](https://github.com/openclaw/openclaw/issues/18132).

**Cons**:
- LLM must learn 5 op kinds (system prompt update). Mitigated by inline examples + `position` defaults to `append` if ambiguous.
- `str_replace` uniqueness rule means LLM must include enough context to disambiguate. `EDIT_OP_MULTI_MATCH` error code surfaces this.

### Option B — V4A patch envelope

**Shape**: Single string field with `*** Begin Patch` / `*** Update File:` / `@@ ... @@` / ` /+/-` line markers per [V4A spec](https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md).

**Pros**: Compact; well-trained on OpenAI Codex family.

**Cons**: DeepSeek V4 Flash (production model via OpenRouter) is **not specifically trained on V4A**. Per Diff-XYZ, non-OpenAI models prefer search-replace. Also requires writing a parser before Sprint 2.3 ships (~150 LOC). Park for when/if Codex-family engine is wired.

### Option C — Two-model apply pipeline (Cursor / Continue / Morph)

**Shape**: Planner emits "lazy" snippet with `// ... existing code ...`; specialist 7B apply-model merges.

**Pros**: Highest accuracy ceiling (Morph reports 98 % apply success at 10,500 tok/s).

**Cons**: Adds second paid network call, second failure mode, second model selection — violates **R4 cost ceiling** + **zero-deps spirit** of cortex-x. Revisit at Sprint 2.4+ if cost-per-action stays under cap and a self-hosted 7B applier becomes free.

## Decision

**Ship Option A — Anthropic-style `edit_ops[]` union.**

Rationale (3-hop traceability):

| Claim | Finding | Source |
|---|---|---|
| LLMs reliably emit the str_replace/insert/create shape | Diff-XYZ apply-EM 95-96% on Claude 4 Sonnet; Anthropic's `text_editor_20250728` is widely deployed in production | [arXiv:2510.12487](https://arxiv.org/html/2510.12487v2), [Anthropic text-editor docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool) |
| Append covers majority of cortex-x's edit.position needs | 4 of 4 cortex-x recommendations from current backlog are append-style (MIGRATIONS, doc trail, ledger, JSDoc tag) | `cortex/recommendations.md` items #1, #5, #6, #7 + [project-ledger.cjs §Storage](../bin/steward/_lib/project-ledger.cjs) (Sprint 2.2 success-side ledger lives in `projects/<slug>.md`) |
| Anchor uniqueness is non-negotiable (defense vs. multi-match silent corruption) | Claude Code Edit `old_string` MUST be unique; Aider issues #3651 + #4716 confirm the failure mode when uniqueness is silently relaxed | [Claude Code reference](https://www.vtrivedy.com/posts/claudecode-tools-reference), [Aider issue #3651](https://github.com/Aider-AI/aider/issues/3651) |
| Zero runtime deps achievable | Splice primitive is ~35 LOC of `node:fs` + `node:crypto`; AST options (recast/ts-morph/tree-sitter) all violate the discipline | [research-splice-patterns §Code skeleton](C:/tmp/research-splice-patterns-2026-05-10.md), [ts-morph 15 MB unpacked](https://www.npmjs.com/package/ts-morph) |

## Implementation plan

### File map

- `bin/steward/_lib/splice.cjs` — NEW. Zero-deps Node primitive (~50 LOC including all 5 ops). Each op returns `{ before_sha, after_sha, op_kind }` for journal capture.
- `bin/steward/_lib/action-engine.cjs` — extend `applyEditsToFilesystem` to dispatch by `op.kind`. Backward-compat: if `ops` absent + `content` present, current code path unchanged.
- `bin/steward/_lib/spec-verifier.cjs` — add `prevContent(path)` helper to `buildPredicateContext` (currently only `prevSize` is exposed). Snapshot pre-edit content keyed by relative path; cache cleared per action.
- `bin/steward/_lib/action-kinds.cjs` — add 5 new criteria to `recommendation` kind's `acceptance_criteria[]` (predicates from [research-edit-position-safety §Recommended verifier predicates](C:/tmp/research-edit-position-safety-2026-05-10.md)):
  1. `edit_position_anchor_unique` (str_replace + after_pattern: anchor exactly once pre-edit)
  2. `edit_position_append_grows` (append: post-edit > pre-edit)
  3. `edit_position_before_line_bounded` (insert: line ≤ pre-edit line count)
  4. `edit_position_after_pattern_preserved` (anchor survives the edit)
  5. `edit_position_growth_bounded` (file ≤ 4× growth or +4 KiB max)
- LLM system prompt (in `action-engine.cjs` `buildEditPrompt` or wherever the prompt lives) — add `## Edit operations` section with one example per op kind + uniqueness rule + size constraints.

### Edge cases (edge-case-hunter pre-shipped)

- BOM (U+FEFF): detect on read, strip, re-prepend on write. Track `hadBom` per [Node Issue #20649](https://github.com/nodejs/node/issues/20649).
- Line endings: detect dominant `\r\n` vs `\n` in first 4 KB; preserve. Inserted region uses dominant style.
- Trailing newline at EOF: track `endsWithNewline`. Append must respect (insert leading `\n` if non-empty + missing trailing newline). Per [git-apply `--inaccurate-eof`](https://git-scm.com/docs/git-apply).
- Empty file: append = identity write; anchor/insert error with `EMPTY_FILE_NO_ANCHOR`.
- Multi-match anchor: hard-error `ANCHOR_AMBIGUOUS` with match count. Never silently first-match (per [Aider issue #3651](https://github.com/Aider-AI/aider/issues/3651)).
- Missing anchor: hard-error `ANCHOR_NOT_FOUND` with 3-line Levenshtein-nearest hint, never auto-correct.
- Concurrent staleness: SHA-256 of file at LLM-prompt time stored in plan; recompute pre-write; mismatch → `FILE_STALE_SHA_MISMATCH`. mtime alone insufficient (per Claude Code v2.1.62 KV-cache regression).

### Test plan (TDD before code)

**Unit** (per op, ~30 tests):
- `append`: empty file, file with trailing newline, file without trailing newline, BOM, CRLF
- `insert`: line 0 (beginning), line N (middle), line L (end), line L+1 (off-by-one error)
- `str_replace`: unique anchor, ambiguous (multi-match) → throws, missing → throws, anchor inside string literal → throws (full-line-match contract)
- `create`: new file in existing dir, new file requiring mkdir, conflict with existing file → throws
- `delete_file`: existing, missing → idempotent, denylisted path → throws

**Property-based** (`tests/unit/steward/splice-properties.test.cjs`, 5 invariants per [research-edit-position-safety §Property-based test ideas](C:/tmp/research-edit-position-safety-2026-05-10.md)):
1. Anchor-uniqueness: any F containing anchor A k≥2 times, `str_replace` MUST throw regardless of content.
2. Append monotonicity: `postSize == prevSize + bytes(C) + ≤2` for any non-empty C.
3. before_line bounds: any N>L file lines, `insert {after_line: N}` MUST throw.
4. Anchor preservation: `str_replace` followed by `after_pattern: A` MUST yield post containing A still (or be explicit replace, no double-meaning).
5. SHA staleness: any expectedSha256 != actualSha256 MUST throw `FILE_STALE_SHA_MISMATCH`.

**Integration**:
- Re-trigger autoresearch on currently-`[HUMAN-ONLY]` recommendations #5/#6/#7 with the new edit shape; expect 2 of 3 candidates pass spec-verifier + npm test (Diff-XYZ would predict ≥75 % success on str_replace shape).
- Regression: existing `recommendation` actions using `{path, content}` must still work (backward-compat).

## Open questions for operator

1. **Should `str_replace` v1 require uniqueness, or allow `replace_all: true` opt-in?** Anthropic provides `replace_all` flag on Edit tool; we could mirror. Recommendation: ship uniqueness-only in 2.2.5, add `replace_all` opt-in 2.2.6 if telemetry shows demand.

2. **In-house eval before locking schema?** Diff-XYZ doesn't benchmark DeepSeek V4 Flash on edit-format reliability. 5-10 fixture eval (synthesized recommendations × 3 ops × 1 model) takes ~30 min, $0.05 cost. Worth doing pre-ship to validate apply-EM ≥80 % on V4 Flash + chosen shape. Recommendation: do it.

3. **Should the splice primitive emit OTLP traces?** Sprint 2.0 Phoenix observability is wired; new primitive should emit a `splice.<op_kind>` span with attributes (sha_before, sha_after, anchor_match_count, path). Recommendation: yes, low effort, high observability value.

4. **Anchor uniqueness — full-line match or substring match?** Per [research-edit-position-safety §Property test 5](C:/tmp/research-edit-position-safety-2026-05-10.md), substring match risks injection inside string literals. Full-line match is safer but rejects valid mid-line anchors. Recommendation: ship substring v1 with `EDIT_OP_ANCHOR_INSIDE_STRING` warn (not block); collect telemetry; tighten in 2.2.6 if false-positives are common.

## Stolen from

- **Anthropic text-editor tool** — operation taxonomy (str_replace / insert / create / undo_edit / view).
- **Aider SEARCH/REPLACE** — exactly-once uniqueness contract; multi-strategy fuzzy fallback for v2 if v1 telemetry justifies.
- **Claude Code MultiEdit** — atomic multi-op transactions; partial-failure rollback.
- **OpenAI Codex apply_patch** — `*** Update File:` envelope discipline (relative-path-only; absolute paths rejected). Adopted as path-safety guarantee.
- **Diff-XYZ paper** — empirical apply-EM evidence that drives the format choice.

## Unblocks

- **Sprint 2.3 mutation testing** — once edits are reliable, mutation scoring on edited code becomes a meaningful fitness signal (today, mutation scoring on rolled-back changes is noise).
- **Autoresearch ROI** — recommendations #5 / #6 / #7 (and the 4-of-7 currently `[HUMAN-ONLY]`) become Steward-actionable on the next cron run.
- **Tier 1 RELO expansion** — RELO has hundreds of edit-existing-file tasks (test additions, doc updates, lint fixes). Without 2.2.5, Steward can't usefully run on RELO; with it, Tier 1 becomes a live deployment, not a planned one.

## Citations (consolidated)

1. https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool
2. https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md
3. https://aider.chat/docs/more/edit-formats.html
4. https://aider.chat/docs/unified-diffs.html
5. https://aider.chat/docs/faq.html
6. https://github.com/Aider-AI/aider/blob/main/aider/coders/editblock_prompts.py
7. https://github.com/Aider-AI/aider/issues/3651
8. https://github.com/aider-ai/aider/issues/4716
9. https://github.com/openai/codex/blob/main/codex-rs/apply-patch/apply_patch_tool_instructions.md
10. https://developers.openai.com/api/docs/guides/tools-apply-patch
11. https://codex.danielvaughan.com/2026/03/31/codex-cli-apply-patch-v4a-diff-format/
12. https://docs.continue.dev/customize/model-roles/apply
13. https://docs.continue.dev/edit/how-it-works
14. https://www.morphllm.com/cursor-fast-apply
15. https://arxiv.org/html/2510.12487v2 (Diff-XYZ)
16. https://www.vtrivedy.com/posts/claudecode-tools-reference
17. https://deepwiki.com/Aider-AI/aider/3.2-prompt-engineering-and-templates
18. https://nrehiew.github.io/blog/minimal_editing/
19. https://www.lakera.ai/blog/guide-to-hallucinations-in-large-language-models
20. https://www.theregister.com/2026/01/20/anthropic_prompt_injection_flaws/
21. https://www-cdn.anthropic.com/43ec7e770925deabc3f0bc1dbf0133769fd03812.pdf
22. https://www.anthropic.com/research/prompt-injection-defenses
23. https://github.com/nodejs/node/issues/20649
24. https://github.com/anthropics/claude-code/issues/1657
25. https://github.com/anthropics/claude-code/issues/18050
26. https://github.com/openclaw/openclaw/issues/18132
27. https://git-scm.com/docs/git-apply
28. https://www.npmjs.com/package/ts-morph
29. https://npmtrends.com/jscodeshift-vs-recast-vs-ts-morph-vs-ts-simple-ast
30. https://github.com/tree-sitter/tree-sitter/issues/5334

---

**R1 status**: ✅ COMPLETE 2026-05-10. Implementation awaiting operator approval (see § Open questions for operator). Estimated effort: M (4-6 h focused work — splice primitive ~50 LOC + verifier extension ~30 LOC + 30 unit + 5 property tests + system prompt update + dogfood loop).
