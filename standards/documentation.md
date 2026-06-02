# Standard - Documentation (living docs + cortex-doc-regen)

> Documentation that rots is worse than no documentation. cortex-x splits docs into two layers: **hand-curated wisdom** (principles, decisions, rationale) and **auto-regenerated state** (counts, paths, LOC, test stats). The state layer is owned by `bin/cortex-doc-regen.cjs` via managed-block markers. The wisdom layer is owned by you.

This standard codifies the contract. It supersedes the legacy "Documentation - Knowledge That Outlives Your Memory" guidance for cortex-x repo docs; project-level docs (README, CLAUDE.md, PROGRESS.md, ADRs) keep their original conventions and add managed blocks opt-in.

## When to use auto-regeneration

**Decision tree — what goes where:**

| Content type | Layer | Owner | Example |
|---|---|---|---|
| Counts (capabilities, tests, action_kinds) | auto | `cortex-doc-regen` | "18 action_kinds in registry" |
| File paths + LOC tables | auto | `cortex-doc-regen` | "bin/steward/execute.cjs - 412 LOC" |
| Test/coverage stats | auto | `cortex-doc-regen` | "2955 tests passing, 0 failing" |
| CI lane status | auto | `cortex-doc-regen` | "test.yml: green, install-smoke.yml: green" |
| Recent commit list (last N) | auto | `cortex-doc-regen` | "Last 10 commits: ..." |
| File-size tables / module inventory | auto | `cortex-doc-regen` | "Top 20 largest files by LOC" |
| Dependency snapshot | auto | `cortex-doc-regen` | "deps: zod@4.x, handlebars@5.x" |
| Principles / philosophy | hand | operator | "SSOT means one authoritative source" |
| Architectural decisions + rationale | hand | operator | "Why we chose Phoenix over Langfuse" |
| Mental models | hand | operator | "cortex holds wisdom, CLAUDE.md holds state" |
| When-to-use guidance | hand | operator | "Use ai-agent profile when AI IS the product" |
| Identity / voice / positioning | hand | operator | "agentic-ready by default" |
| Categorization with curated labels | semi-auto | operator approves | "this capability is observability vs safety" |

**Rule of thumb:** if the value can rot in a week (because code changed), it's auto. If it stays valid for months/years (because intent is stable), it's hand. Semi-auto = the regen tool proposes a categorization, operator commits or edits before the block is finalized.

**When NOT to auto-regenerate:**

- Inside ADRs (decisions are immutable once accepted)
- Inside `standards/` principle docs (rules don't have counts)
- Inside `LESSONS-LEARNED.md` / journal entries (those are append-only)
- Inside `README.md` first 20 lines (front-door messaging stays hand-curated)

## State block convention

All managed regions in cortex-x markdown files MUST use this exact markup contract. Deviation breaks `cortex-doc-regen.cjs`.

**Canonical form:**

```
<!-- BEGIN cortex-x <block-id> (v<N>) - managed by <tool-name> -->
<!-- Do not edit between markers - regenerate via: <command> -->
<rendered content>
<!-- END cortex-x <block-id> -->
```

**Block-id naming (non-negotiable):**

- kebab-case, ASCII only
- no double-dash `--` (breaks HTML comment parsing)
- reserved IDs Sprint 2.45: `state-snapshot`, `capability-counts`, `test-counts`, `coverage`, `loc-summary`, `git-activity`, `deps`
- snake_case forms also reserved for renderer-internal lookup: `state:snapshot`, `state:counts`, `state:loc` (these are tool-internal keys, NOT used in marker IDs)

**Version suffix:**

- `(v1)` MANDATORY in BEGIN marker
- bump on schema break (e.g., column rename in a table)
- regen detects stale versions via regex `BEGIN cortex-x ([a-z-]+) \(v(\d+)\)`

**Tool suffix:**

- `managed by cortex-doc-regen` for state blocks
- enables `grep -r "managed by"` audit across the repo
- other CLIs that ship later (e.g., `cortex-capabilities`) use their own tool name

**Indentation rules:**

- markers MUST live at column 0
- markers MUST NOT be nested inside lists, tables, blockquotes, code fences (CommonMark parsers break on nested HTML comments)
- content between markers preserves its own indentation
- markdown headings, lists, tables permitted inside markers
- no trailing whitespace on any marker line

**Whitespace contract:**

- exactly one blank line before BEGIN
- exactly one blank line after END
- inside markers: leading + trailing single newline
- content lines as needed between

**Allowed content types inside markers:**

- markdown tables (most common — counts, file lists, test summaries)
- markdown lists (capability rosters, recent commits)
- prose paragraphs with auto-generated values
- code fences with language tag for diagrams (mermaid acceptable)

**Forbidden content types inside markers:**

- nested `<!-- BEGIN cortex-x ... -->` markers
- hand-edits that the next regen run will overwrite
- prose that contradicts the rendered facts (e.g., "we have 5 action_kinds" outside the marker while marker shows 18)
- HTML other than the marker comments themselves

**Replacement semantics:**

- regen replaces ONLY content strictly between matched BEGIN/END pair
- content above BEGIN and below END is preserved byte-for-byte
- orphan BEGIN without END = skip + log warning, never auto-repair
- mismatched block-id (BEGIN says `state-snapshot`, END says `capability-counts`) = skip + log
- duplicate BEGIN with same ID = use first, log warning

**Load-bearing match regex:**

```
/<!-- BEGIN cortex-x ([a-z][a-z0-9-]*) \(v(\d+)\) - managed by ([a-z-]+) -->\n([\s\S]*?)\n<!-- END cortex-x \1 -->/g
```

Backreference `\1` enforces matched IDs. Any state-block tooling MUST use this exact regex shape.

**Reference SSOT:** This standard (`standards/documentation.md`) is the single source of truth for the marker contract. Sprint 2.45.1 may extract to `standards/state-blocks.md` if a second consumer beyond `cortex-doc-regen` emerges (currently only `cortex-claude-md-augment` uses a similar but distinct marker pattern).

## Hand-curated vs auto-generated

**Why both matter:**

The two layers serve different lifecycles. Hand-curated content captures intent (why we built X, what trade-offs we accepted, what assumptions hold). Auto-generated content captures snapshot (what exists right now, how big, how green). Mix them in the same doc, separated by markers, and you get a single readable artifact that is 100% accurate on state without losing the wisdom.

**The split enables three properties:**

1. **No drift between docs and reality.** When a sprint adds a new action_kind, the count in the docs is wrong until somebody manually edits. With managed blocks, the next `cortex-doc-regen --apply` (or pre-commit hook) corrects it automatically. Operator never edits the count by hand.
2. **Wisdom survives refactors.** Hand-curated sections (rationale, principles, ADR references) are not touched by regen. A reorganization of `bin/steward/_lib/` can shuffle file paths inside auto blocks while the prose explaining *why* the steward exists stays put.
3. **Reviewable diffs.** When reviewing a PR, the operator sees `state-snapshot` updates as line-noise (expected churn) and concentrates on the hand-curated diff (the actual intent change). Without the split, every doc PR mixes both and the eye can't separate signal from churn.

**Test for whether content belongs inside markers:**

Ask "if I rerun cortex-doc-regen tomorrow without any code change, will this content be identical?"

- Yes → goes outside markers (hand-curated)
- No, it might change because code/tests/deps shifted → goes inside markers (auto)

If it would change but you DON'T want it auto-regenerated (e.g., a count you want to lag behind reality for narrative reasons), keep it outside markers AND add a `<!-- HAND-CURATED-COUNT: rationale -->` HTML comment explaining why. Future maintainers will see the deliberate choice.

## Composition with cortex-doc-regen

**Where to run:**

- **Manual:** `node bin/cortex-doc-regen.cjs --apply` after a sprint commit, before `git push`. Fast (<2s on cortex-x repo). Idempotent — second run is a no-op.
- **Pre-commit hook (opt-in):** install via `cortex-hooks-register --include-doc-regen`. Hook runs `--check` and refuses commit on drift; operator runs `--apply` then re-commits. Recommended for repos where doc accuracy is load-bearing for distribution (cortex-x itself, public-facing READMEs).
- **Weekly Steward cron:** `.github/workflows/steward-doc-regen.yml` runs `--apply` every Monday at 04:00 UTC, opens PR if drift detected. Closes the gap when operator forgets after a hot sprint.
- **CI verification:** `--check` runs in `.github/workflows/test.yml` and fails the PR if managed blocks are stale. Forces the operator to regen before merge.

**`/cortex-sprint` integration:**

The cortex-sprint skill (`shared/skills/cortex-sprint/SKILL.md`) integrates doc-regen as step 6 of its pipeline:

1. R1 web-research the topic
2. Decompose into sprint slices
3. Implement with one verification todo per implementation todo
4. R2 review pipeline (6 agents in parallel)
5. Update `CLAUDE.md` + `MEMORY.md` + sprint memory file
6. **Run `cortex-doc-regen --apply` to refresh all managed blocks**
7. Commit with conventional commit message + trailers

Step 6 is non-optional for sprints that ship new capabilities, action_kinds, or test infrastructure. For prose-only sprints (writing standards, docs, ADRs without code change), step 6 is a no-op (idempotent) so it stays in the pipeline.

**Failure mode:** if step 6 surfaces drift that wasn't caused by the current sprint (e.g., a previous sprint forgot to regen), include the drift fix in the same commit and note it in the commit body. Don't open a separate PR for orphan drift — folds in cleanly.

## Authoring patterns for new docs

**Template for a new doc that uses managed blocks:**

```markdown
# <Title>

> <One-sentence purpose statement - hand-curated, never auto>

## Overview

<Hand-curated context, rationale, when to use this doc>

## Current state

<!-- BEGIN cortex-x state-snapshot (v1) - managed by cortex-doc-regen -->
<!-- Do not edit between markers - regenerate via: node bin/cortex-doc-regen.cjs --apply -->
| Metric | Value |
|---|---|
| Tests | 2955 |
| Action kinds | 18 |
| LOC (bin/) | 12,400 |
<!-- END cortex-x state-snapshot -->

## How to use

<Hand-curated guidance, examples, anti-patterns>

## Composition

<Hand-curated cross-links to related docs>
```

**Where to put state blocks:**

- usually near the top, in a "Current state" or "Snapshot" section, so readers see the live numbers before reading the prose
- only one block per ID per file (regen warns on duplicates)
- group related auto facts inside ONE block rather than scattering — easier to scan, fewer regex matches at regen time

**How to write hand-curated content that complements auto sections:**

- describe the *meaning* of the numbers (e.g., "2955 tests across 8 tier gates" — the tier-gate context is hand-curated, the count is auto)
- avoid restating numbers that appear in markers (would drift the moment regen runs)
- use phrases like "as of last regen" or "see snapshot above" when referencing auto values in prose
- explain *thresholds* and *targets* in hand-curated prose (e.g., "we target <300 LOC per CLI"); the snapshot table shows the current values

## Anti-patterns

- **Nested state blocks** — putting `<!-- BEGIN cortex-x foo -->` inside a `<!-- BEGIN cortex-x bar -->`. Regex match fails; regen skips both. Always flat, sibling blocks at column 0.
- **Prose with inline counts that contradicts state block** — writing "we currently have 5 action_kinds" in the section above a marker that renders "18 action_kinds". The prose rots; the marker stays accurate. Move the count into the marker or remove it from prose entirely.
- **Hand-edits inside state markers** — editing the rendered content between BEGIN/END thinking it'll stick. The next regen overwrites. If you need to keep a hand-curated value visible, move it outside the marker.
- **Block-id collisions across files** — using `state-snapshot` as the ID in two different files is fine (regen scopes per-file). But using `state-snapshot` and `state_snapshot` (snake_case) as separate IDs in the same file is forbidden — pick one form.
- **Stale version suffix** — leaving `(v1)` in the marker after the renderer schema bumped to v2. Regen detects the version mismatch and refuses to write (loud failure). Bump deliberately.
- **Missing END marker** — accidentally deleting the END line during a merge. Orphan BEGIN logs a warning but content downstream is preserved. Repair by re-adding the END line manually.
- **Auto-format reflow** — Prettier / VSCode markdown formatters can reflow HTML comments onto new lines or strip blank lines around markers. Add `<!-- prettier-ignore -->` if your editor enforces formatting, or configure the formatter to skip files matching `**/managed/*.md`.

## Failure modes and recovery

**Stale blocks (count says 5, reality is 18):**

Cause: forgot to run `--apply` after a sprint that added capabilities.

Recovery: `node bin/cortex-doc-regen.cjs --apply` then commit the resulting diff. If the drift is large, note it in commit body ("regen catches up after Sprint 2.X-2.Y forgot to run").

Prevention: install the pre-commit hook OR rely on weekly Steward cron.

**Conflict with editor auto-format:**

Cause: Prettier reflowed HTML comments or stripped blank lines around markers.

Recovery: revert the auto-format change, add `<!-- prettier-ignore -->` directly above BEGIN, re-save.

Prevention: configure project `.prettierignore` to exclude `docs/operator-pov/*.md` and other managed files; document in `CONTRIBUTING.md`.

**Merge conflict inside state block:**

Cause: two PRs both ran `--apply` against different parent states; the block content diverged.

Recovery: accept either side (doesn't matter — `--apply` is deterministic on a given tree). Run `node bin/cortex-doc-regen.cjs --apply` post-merge to converge. Commit the result.

Prevention: rebase frequently; treat auto-block conflicts as no-op merges (always regen-able).

**Orphan BEGIN logged but commit allowed:**

Cause: deleted END line accidentally during a manual edit.

Recovery: re-add the END line manually with the matching block-id, then `--apply`.

Prevention: keep `--check` in CI; it warns on orphan BEGIN. Don't ignore the warning.

**Regen tool itself is broken (CLI crashes):**

Cause: extractor function threw on an unexpected repo shape (e.g., missing `package.json`, malformed git log).

Recovery: each extractor is fail-open by design — returns a sentinel value, never crashes the run. If a hard crash occurs, file an issue with the repo state and pass `--strict=false` to skip strict mode while debugging.

Prevention: extractors wrapped in `try/catch` per the `bin/cortex-doc-regen.cjs` design contract; CI exercises the fail-open path against fixture repos.

## Cross-links

- **`standards/documentation.md` § State block convention** — the SSOT for the marker contract lives here (Sprint 2.45). `standards/state-blocks.md` extraction deferred to 2.45.1+ if a second consumer emerges
- **`standards/auto-orchestration.md`** — how doc-regen fits into the parallel-by-default agent orchestration model
- **`standards/workflows.md`** — Steward cron workflow specifications including `steward-doc-regen.yml` cadence
- **`bin/cortex-doc-regen.cjs`** — the CLI implementation; header SSOT carries invocation details, exit codes, env vars
- **`shared/skills/cortex-sprint/SKILL.md`** — sprint pipeline that wires doc-regen in as step 6
- **`templates/CLAUDE.md.hbs`** — project-level CLAUDE.md template; new projects opt into managed blocks via the `with_managed_blocks` profile flag
- **`docs/operator-pov/atlas-*.md`** + **`docs/operator-pov/capability-tree-*.md`** — first operator-facing docs to adopt managed blocks (Sprint 2.45)

## Legacy guidance (project-level docs)

The original doc-philosophy content (README front-door rules, CLAUDE.md structure, PROGRESS.md sprint-state format, ADR template, JSDoc rules, comment hygiene) still applies to **scaffolded project repos** — those use plain markdown without managed blocks by default. cortex-x repo docs (this repo) layer managed blocks on top. Project repos can opt in per-file via `cortex-doc-regen --init <file>` (Sprint 2.46+).

Key rules from the legacy standard that remain in force everywhere:

- update docs in the same PR as code; don't defer
- docs in version control, not Notion/Confluence where they die
- docs close to code (`lib/ai/README.md` > centralized wiki)
- diagrams over prose for complex systems (Mermaid in markdown)
- examples over specs; show, don't tell
- delete stale docs; wrong info is worse than missing info

Anti-patterns from the legacy standard that remain forbidden:

- "TODO: document this" sitting for a year
- wiki pages nobody reads or updates
- comments explaining obvious code
- docs that contradict current behavior
- "see the code" as documentation
- massive docs nobody reads (shorter is better)
- documentation in language no one on team speaks
