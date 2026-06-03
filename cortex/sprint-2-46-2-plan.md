---
sprint: 2.46.2
name: Sprint 2.46.2 — Doc-currency lint (stale-prose detector + frontmatter expiry + hand-prose vs state-block drift)
date: 2026-06-03
status: in-progress
owner: cortex-x maintainers
arc: Arc 1 (Verification & verdict hardening) — Sprint 2 of 3
discovery_source: cortex/sprint-2-45-r2-summary.md M-14 (atlas inline counts contradicting state-block) + standards/documentation.md § State block convention (hand-prose rot follow-up)
generated_by: cortex-sprint
untrusted_fencing: not-required
fencing_rationale: Auto Mode discovery from cortex/sprint-2-45-r2-summary.md + standards/documentation.md; no operator paste.
---

# Sprint 2.46.2 — Doc-currency lint

> **Operator brief (Arc 1 Sprint 2 of 3):** Zavřít druhou polovinu Sprint 2.45 doc-currency story. Sprint 2.45 zashippoval auto-state-blocks (auto-refresh přes cortex-doc-regen). Hand-curated prose okolo state-blocks může rotovat — Sprint 2.45 R2 finding M-14 chytil reálný příklad: atlas inline prose říkalo "30 standards" ale state-block už ukazoval 34. Sprint 2.46.2 shippuje detection layer pro tento class drift.

## Goal

Postavit doc-currency lint co detekuje (a) numeric-count claims v hand-prose které contradiktují cortex-doc-regen state-block (např. "20 CLIs" v atlas prose vs `clis: 21` v state-block JSON), (b) frontmatter expiry — files s `last_human_review:` nebo `expires:` field nad jejich expiry warn-period. Plus standards/documentation.md § Hand-prose currency convention definující kdy použít state-block reference vs inline count vs hand-prose narrative.

## Deliverables (9)

1. **`bin/cortex-doc-currency.cjs`** — NEW zero-dep CJS CLI
   - `--check` exit 1 on any stale claim or expired frontmatter
   - `--json` machine-readable output (file, line, claim, expected, actual, severity)
   - `--apply` autofix safe drift (numeric counts where unambiguous; never rewrites prose)
   - `--help` usage
   - Scans: `cortex/atlas-*.md`, `cortex/capability-tree-*.md`, `cortex/operator-recap-*.md`, `standards/*.md`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`
   - Number-extraction: regex matches like `(\d+)\s+(skills|agents|CLIs|standards|workflows|profiles|detectors|prompts|tests)` in hand-prose; deliberately excludes content inside `<!-- BEGIN cortex-x ... -->` markers (those are auto-managed)
   - Cross-check against `node bin/cortex-doc-regen.cjs --json` live counts
   - Frontmatter expiry: parse `last_human_review:` or `expires:` ISO-8601 dates; warn if today > expiry date
2. **`bin/cortex-doc-currency.cjs`** — exports `lintFile(filePath, snapshot, today)`, `detectClaims(content)`, `checkExpiry(frontmatter, today)` for testability (today is INPUT, not generated inside module per cortex deterministic convention)
3. **`standards/documentation.md` § Hand-prose currency convention** — new subsection
   - Decision tree: when to use auto state-block reference vs inline count vs narrative prose
   - `last_human_review: <ISO date>` frontmatter convention with recommended 90-day expiry default
   - `expires: <ISO date>` for time-bounded docs
   - Approved hand-prose patterns (e.g. "See state-snapshot block above for current count" — ALWAYS-OK reference)
   - Forbidden hand-prose patterns (e.g. inline numeric counts without state-block citation)
4. **`tests/unit/tools/cortex-doc-currency.test.cjs`** — ≥12 unit tests
   - lintFile detects mismatched numeric count
   - lintFile ignores counts inside `<!-- BEGIN cortex-x ... -->` markers
   - lintFile honors `last_human_review:` frontmatter as expiry source
   - lintFile honors `expires:` frontmatter
   - lintFile passes when no claims present
   - lintFile passes when claim matches state-block
   - lintFile output is JSON-serializable with file/line/claim/expected/actual/severity
   - --apply fixes numeric counts in-place (idempotent)
   - --apply does NOT rewrite narrative prose (only digit substitution)
   - --check exit code 0 when clean, 1 when stale
   - Determinism: lintFile produces identical output across runs (no Date.now in module body)
   - CRLF/LF input parity
5. **`tests/contract/doc-currency-baseline.test.cjs`** — current repo baseline guard
   - Runs cortex-doc-currency on full repo, asserts no UNEXPECTED stale claims
   - Maintains explicit allowlist of EXPECTED stale claims (e.g. historical sprint plans)
   - Fails CI if NEW drift introduced (regression gate)
6. **install.sh + install.ps1** — register `cortex-doc-currency` shim
7. **`shared/skills/cortex-doctor/SKILL.md` (if exists) or `bin/cortex-doctor.cjs`** — add doc-currency check to health audit (cross-link, not duplicate logic)
8. **`cortex/sprint-2-46-2-plan.md`** — this file
9. **`cortex/sprint-2-46-2-r2-summary.md`** — to be written after R2

## Acceptance criteria (12)

- **AC-1** `file_predicate` — `cortex/sprint-2-46-2-plan.md` exists with 8 required sections.
- **AC-2** `file_predicate` — `bin/cortex-doc-currency.cjs` exists and exports `lintFile`, `detectClaims`, `checkExpiry`, `main` (4 named).
- **AC-3** `regex` — `bin/cortex-doc-currency.cjs` contains `--check`, `--json`, `--apply`, `--help` flag handling.
- **AC-4** `regex` — `bin/cortex-doc-currency.cjs` excludes content inside `BEGIN cortex-x` markers from claim detection.
- **AC-5** `file_predicate` — `standards/documentation.md` contains heading "Hand-prose currency convention".
- **AC-6** `regex` — `standards/documentation.md` mentions both `last_human_review:` and `expires:` frontmatter conventions.
- **AC-7** `shell` — `node --test tests/unit/tools/cortex-doc-currency.test.cjs` passes with ≥12 tests.
- **AC-8** `shell` — `node --test tests/contract/doc-currency-baseline.test.cjs` passes.
- **AC-9** `shell` — `node bin/cortex-doc-currency.cjs --check` exit code is documented (0 clean, 1 stale).
- **AC-10** `shell` — `npm test` exits 0 (baseline 3380 → expect ≥3395).
- **AC-11** `regex` — `install.sh` and `install.ps1` register `cortex-doc-currency` shim.
- **AC-12** `file_predicate` — `cortex/sprint-2-46-2-r2-summary.md` exists with HIGH/MEDIUM disposition.

## Workflow phases

| Phase | Scope | Output |
|---|---|---|
| **Research** | 3 parallel R1: (a) doc-currency lint patterns in OSS (mkdocs/Sphinx/Docusaurus link-checkers, terraform-docs drift), (b) frontmatter expiry / staleness conventions in technical writing, (c) prose-vs-data SSOT patterns in living docs | Inline → Synthesize |
| **Synthesize** | 1 agent merges research → concrete impl spec | Inline spec |
| **Implement** | 4 parallel impl: (1) cortex-doc-currency.cjs + unit tests, (2) standards/documentation.md update + contract test, (3) install.sh + install.ps1 shim, (4) cortex-doctor integration (read-only) | Edits to repo |
| **Review** | 6 R2 reviewers in parallel | Per-agent JSON findings |
| **Confidence** | Pass-2 skeptic + dedupe | Final triaged list |

## Risks (7)

| # | Risk | Mitigation |
|---|---|---|
| R-1 | False-positive claim detection — narrative prose mentioning numbers ("approximately 30", "between 20 and 30") flagged as stale | Conservative regex: only `(\d+)\s+(noun)` shapes with exact word match; ignore qualified "approximately/around/over"; allowlist legitimate historical references |
| R-2 | Allowlist becomes maintenance burden (every sprint plan claim must be added) | Allowlist scoped to `cortex/sprint-*-plan.md` + `cortex/sprint-*-r2-summary.md` patterns (historical artifacts, expected to drift) by default |
| R-3 | --apply autofix corrupts prose by silent rewrite | --apply ONLY substitutes single-token digits; never touches surrounding words; idempotent (running twice produces same output) |
| R-4 | Baseline contract test breaks when expected counts change between sprints | Baseline accepts `cortex-doc-regen --json` AT TIME OF TEST as source of truth; only flags hand-prose vs that snapshot, not absolute numbers |
| R-5 | Frontmatter expiry warning fires on legitimately-stable docs (CLAUDE.md, README.md) | These files don't ship with `last_human_review:`; only files that explicitly opt-in via frontmatter get expiry checks |
| R-6 | cortex-doc-regen.cjs JSON output schema drift breaks doc-currency parser | doc-currency parses defensively — missing keys treated as "unknown count", no crash; smoke test asserts integration |
| R-7 | --apply on Windows produces CRLF→LF rewrites of unchanged lines | Read file as-is, edit only matching numeric tokens, preserve all surrounding bytes (line-endings + whitespace) |

## Out of scope

- Cross-language number conversion (Czech "tři" vs "3") — English numerals only
- Date-based currency claims in prose (e.g. "as of 2026-05-01") — separate sprint
- Word-count / length-target enforcement
- Markdown link-check / broken-link detection — separate concern
- Cross-file consistency (atlas mentions "11 hooks" but cap-tree says "8 hooks") — defer to 2.46.2.1
- Rich state-block reference parsing (only flat numeric counts in v0)

## References

- `cortex/sprint-2-45-r2-summary.md § M-14` — origin (atlas inline counts vs state-block drift)
- `standards/documentation.md § State block convention` — auto-state-block contract this sprint extends
- `bin/cortex-doc-regen.cjs --json` — SSOT for live counts (consumed via execFileSync)
- `cortex/atlas-2026-06-01.md` — primary test target (has both state-block + hand-prose)
- `cortex/capability-tree-2026-06-01.md` — secondary test target
- `standards/sprint-pipeline.md` — canonical Sprint pipeline (this sprint follows it)

## Triage policy

Mirror Sprint 2.46.1 r2-summary.md disposition convention. HIGH apply in-commit, MEDIUM if surgical, Architectural defer to 2.46.2.1+.

---

*Plan finalized 2026-06-03 by /cortex-sprint pipeline (Arc 1 sprint 2 of 3, /cortex-sprint Skill tool reports skill unknown → fallback per memory `feedback_use_cortex_sprint_skill_for_all_sprints`: read SKILL.md + follow pipeline verbatim).*
