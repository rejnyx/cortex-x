# QA Retrofit — Deep Test-Strategy Audit + Risk Worm-Through + Cited Gap Backlog

> **How to use:** Open Claude Code at the root of an established project, paste this prompt (or run the `/test-audit` skill, auto-loaded after `install.sh` mode `[E]`). cortex-x does a senior-QA-consultant-grade audit, then web-researches the stack-specific testing landscape, then produces a prioritized gap backlog with cited 2026 sources.
>
> **Sibling prompts:** `/audit` (existing-project-audit) for general 12-dim audit; this one is the **testing lens**. Run both for a comprehensive engagement; run JUST this one if testing is the only concern.

---

## When to use this prompt

✅ **Use `/test-audit` (this prompt) when:**
- You inherited a codebase and need a deep testing-readiness assessment before changing code
- Your team has a tester (junior or senior) who needs an AI-augmented playbook for a project
- You suspect tests exist but don't actually verify the right things ("test smell" detection)
- You want a stack-specific 2026-cited testing strategy (not generic "write more tests")
- You're prepping a project for an audit, certification (ISO 25010, SOC 2), or regulated-industry release

🚫 **Don't use `/test-audit` when:**
- The project is empty / pre-MVP (< 5 source files) → use `/start` (new-project) instead — testing is part of the scaffold
- You only need a 5-section institutional summary → use `/scan` (project-scan)
- You want a comprehensive 12-dim audit (not testing-only) → use `/audit` (existing-project-audit) — this one is narrower

---

## Philosophy — AI-augmented tester, not tester-replacement

cortex-x is built on the assumption that **a senior QA + AI > AI alone > tester alone**. This prompt amplifies a tester's worm-through, doesn't replace the human's business-risk judgment. Specifically:

- The audit phase produces evidence (file:line, commit hashes, mutation scores) — the tester evaluates which evidence maps to real business impact
- Phase 3 has 5 questions ONLY a human can answer (top business risk this quarter, who paid us last incident, what areas can't break, where is regulatory pressure, what does "done" look like)
- Phase 5 outputs a backlog, not a fix — the tester decides which P0 to tackle first based on team capacity and risk appetite

If you're tempted to read this prompt as "AI does the QA job," reread it as "AI prepares a senior QA's first 2 weeks of a new engagement in 30 minutes."

---

## Phases (seven)

| Phase | Goal | Output |
|---|---|---|
| **P0 — Detect** | What kind of project? What's the test surface? | `cortex/qa-context.md` (profile, stage, test runner, coverage estimate) |
| **P1 — Test inventory** | What tests EXIST? What do they actually verify? | `cortex/qa/test-inventory.md` (file:line catalog by layer) |
| **P2 — Quality-model audit (4 parallel agents, 12 ISO-25010-aligned dims)** | Where are the gaps mapped to quality characteristics? | `cortex/qa/AUDIT.md` (12-section senior QA deliverable) |
| **P3 — Human gate** | What CAN'T be derived from code (business risk, regulatory, social map) | 5 questions, answers folded into `cortex/qa/AUDIT.md` |
| **P4 — Auto-research (testing-only topics)** | What does 2026 say about testing THIS stack? | `$CORTEX_DATA_HOME/research/<slug>-qa-<date>.md` |
| **P5 — Synthesis** | What testing gaps to close, in what order, with which tools? | `cortex/qa/testing-strategy.md` + `cortex/qa/testing-gaps.md` (P0/P1/P2 backlog) + 2-3 sample test files |
| **P6 — Sample-test seeding (opt-in)** | Concrete test files for top-3 gaps | `tests/qa-retrofit/<gap-id>.test.{ts,cjs}` |

---

## Phase 0 — Detect

Run cortex-x's deterministic detectors:

```bash
node ~/.claude/shared/detectors/detect-profile.cjs
node ~/.claude/shared/detectors/detect-stage.cjs
node ~/.claude/shared/detectors/detect-sister-env.cjs
```

If any detector fails-open, record + proceed with degraded mode.

### Slug derivation

Same plain-language slug gate as `/audit` Phase 0 (folder basename → sanitize → confirm in Czech). Default: take the project folder basename. Auto-mode: skip the gate and use the default; surface in Phase 7 closing summary.

### Test surface detection

In addition to standard detectors, run a **test-surface scan**:

```bash
# Test runner detection (in priority order)
grep -l "vitest\|jest\|mocha\|node:test\|playwright\|cypress\|@testing-library" package.json
ls -la jest.config.* vitest.config.* playwright.config.* cypress.config.* 2>/dev/null

# Test file count by layer (Glob)
**/*.{test,spec}.{ts,tsx,js,jsx,cjs,mjs}     # unit + integration combined
**/e2e/**/*.{ts,js}, **/playwright/**, **/cypress/**  # E2E
**/*.bench.{ts,js}                            # benchmarks
**/evals/**/*.{ts,js,json,yaml}               # AI evals (cortex-x convention)

# Coverage report freshness
ls -la coverage/ .nyc_output/ 2>/dev/null
```

### Writing qa-context.md

Write `cortex/qa-context.md`:

```markdown
---
phase: 0-qa-detect
date: <YYYY-MM-DD>
slug: <slug>
---

# QA audit context

## Detected
- **Profile:** <profile>
- **Stage:** <stage>
- **Languages:** <ts, js, ...>
- **Stack signature:** <Next.js 16 / Express + Prisma / Astro 5 / ...>

## Test surface
- **Unit/integration runner:** <vitest 4.0.5 / jest 30.x / node:test / pytest 8 / ...>
- **E2E runner:** <playwright 1.50 / cypress 14 / none>
- **Component testing:** <@testing-library/react 16 / vue-test-utils / none>
- **Mutation testing:** <stryker 9 / pitest / none>
- **Property-based:** <fast-check 4 / hypothesis / none>
- **Load testing:** <k6 / artillery / none>
- **Visual regression:** <percy / chromatic / playwright snapshots / none>
- **A11y testing:** <axe-core / lighthouse / none>

## Test counts (Phase 0 estimate, refined in P1)
- **Unit/integration test files:** <count>
- **E2E test files:** <count>
- **Total test files:** <count>
- **Source files (non-test):** <count>
- **Approx test:source ratio:** <ratio>

## Coverage report
- **Last coverage run:** <date or "no coverage report found">
- **Line coverage:** <% or "unknown">
- **Branch coverage:** <% or "unknown">
- **CI coverage gate:** <enforced at X% / no gate>
```

---

## Phase 1 — Test inventory (what actually exists vs. what's claimed)

Walk every test file and extract: **what does this test actually assert?** Many "test" files only call functions and never `expect`/`assert` — those are smoke imports, not tests. Detect that.

```bash
# For each test file, count assertions
grep -c "expect\|assert\|toEqual\|toBe\|toMatch\|should\." <file> | sort -n
# Files with 0-1 assertions are suspicious (smoke-only or trivially-passing)
```

Write `cortex/qa/test-inventory.md`:

```markdown
---
phase: 1-qa-inventory
date: <YYYY-MM-DD>
slug: <slug>
---

# Test inventory

## By layer

### Unit (N files, M assertions)
| File | Assertions | Smell |
|---|---|---|
| `tests/foo.test.ts` | 12 | none |
| `tests/bar.test.ts` | 0 | **smoke-only — no assertions** |

### Integration (N files, M assertions)
…

### E2E (N files, M assertions)
…

### AI evals (N files, M cases)
…

## Hot files vs. test coverage map

For each file in §3 of `cortex/AUDIT.md` "hot spots" (or top-20 churn files if `/audit` not run):

| Hot file | Churn (12mo) | Tests covering | Coverage est | Risk |
|---|---|---|---|---|
| `src/cart/pricing.ts` | 47 commits | 0 tests | unknown | **HIGH — top churn, no tests** |
| `src/auth/middleware.ts` | 31 commits | 4 tests | partial | MED |

## Test smell summary (5-detector starter, per tsDetect FSE'20)

The full tsDetect catalog is 19 detectors at 85-100% precision. The 5-detector starter captures ~80% of signal cheaply:

- **Assertion Roulette** — multiple unrelated assertions in one test, no per-assertion message → which one failed?
- **Eager Test** — test exercising multiple production methods → unclear what's actually under test
- **Empty Test / Smoke-only** — files with 0 assertions (just imports + function calls); detectable via `grep -c "expect\|assert"` = 0
- **Conditional Test Logic** — `if`/`for`/`switch` inside tests → branches make tests non-deterministic
- **Duplicate Assert** — same assertion repeated in same test → masks failures behind early-exit

Plus cortex extras worth flagging:
- `<count>` files with `.skip` or `.todo` left in main branch
- `<count>` files using `any` types in test bodies (lossy assertion)
- `<count>` snapshots > 100 lines (likely meaningless — too noisy to fail on diff)
- `<count>` tests mocking the same module they import (tight-coupling smell)
```

---

## Phase 1b — Existing-tests modernization analysis (NEW Sprint 2.10.6, qa-tester profile default ON)

> **For repos with existing tests:** before auditing for gaps, evaluate the existing test posture against 2026 best practices for the detected test frameworks/tools. Surfaces "your tests pass but pattern X is deprecated" + "your snapshot strategy violates 2026 anti-pattern Y" + concrete modernization recipes per test file.

**When this fires:**
- `profile: qa-tester` (per `~/.claude/cortex/user.yaml`), AND
- Phase 1 inventory found > 0 existing test files (skip for greenfield repos — those go to `/start` instead)

When OFF (default for `dev` / `ai-engineer` / `minimal` profiles), Phase 1b is skipped — Phase 2 audit alone is enough for general-purpose use.

### Phase 1b workflow

1. **Detect existing test frameworks + tools** from `package.json` + test config files + test-file imports:
   - Test runners: Vitest / Jest / node:test / pytest / mocha
   - E2E: Playwright / Cypress / WebdriverIO / Selenium
   - Component: @testing-library/{react,vue,svelte,angular}
   - A11y: axe-core / jest-axe / @axe-core/playwright / pa11y
   - Visual: Chromatic / Percy / Playwright `toHaveScreenshot()`
   - Mutation: Stryker / PIT / mutpy
   - Property-based: fast-check / Hypothesis / jqwik
   - Contract: Pact / Schemathesis / consumer-driven test framework
   - Mocking: MSW / nock / Sinon / Jest auto-mock
   - Storybook: + addon-a11y / addon-interactions / test-runner
   - Build/test orchestration: Nx / Turbo / Lerna / Bazel

2. **Parallel web research dispatch (cap 5 tools per audit run)** — for each detected tool/framework, spawn a research agent:
   ```
   "Research best practices 2026 for <tool>: 
    - 3 modern usage patterns with 2026 cited URLs
    - 3 anti-patterns / smells specific to this tool (with detection regex / static check if possible)
    - 1 concrete migration recipe for the most common deprecation in 2026
    - Min 5 cited URLs, recency-biased to last 12 months"
   ```
   Output: `$CORTEX_DATA_HOME/research/<slug>-tooling-<tool>-<date>.md` per tool.

3. **Apply findings to existing test files** — for each test file:
   - Match anti-patterns (e.g. Vitest `describe.only` left in main, Playwright CSS-class selectors, snapshot > 100 lines, Jest manual mocks of own modules)
   - Match deprecated patterns (e.g. Cypress `cy.wait(5000)` without locator, Stryker config without incremental mode, jest-axe without `expect.extend`)
   - Match upgrade opportunities (e.g. `@testing-library/react` < 16 → 16+ has `act()` baked in)
   - Cite the research URL for each match

4. **Output**: extend `cortex/qa/test-inventory.md` with a new section **"Modernization opportunities (Phase 1b)"**:

   ```markdown
   ## Modernization opportunities (Phase 1b — qa-tester profile only)

   Tooling research caches:
   - Vitest 4 → `$CORTEX_DATA_HOME/research/<slug>-tooling-vitest-<date>.md`
   - Playwright 1.50+ → `$CORTEX_DATA_HOME/research/<slug>-tooling-playwright-<date>.md`
   - … (one per detected tool, cap 5)

   ### Per-file findings

   | File | Tool | Finding | Severity | Catalog ID | Recipe |
   |---|---|---|---|---|---|
   | `tests/cart.spec.ts` | Playwright | CSS-class selectors (brittle per Playwright 2026 [src]) | MED | e2e-browser-flow | replace with role/label getters; see recipe at [research URL] |
   | `tests/payment.spec.ts` | Vitest | Snapshot 187 lines (anti-pattern per tsDetect [src]) | LOW | smell-flag | extract dynamic regions to `mask:` config |
   | `tests/auth.test.ts` | Jest | Manual mock of own module (tight-coupling smell [src]) | MED | smell-flag | refactor to dependency-inject test fixture |
   ```

5. **Feed into Phase 5b backlog** — high-severity Phase 1b findings become P1 gaps with `[type: smell-modernization]` tag. Low-severity = P2 backlog. Don't escalate Phase 1b to P0 by default — the existing tests still pass; modernization is improvement, not block-release-worthy.

### Why this matters specifically for tester onboarding

When a junior tester inherits a repo with existing tests, they default to "the tests work, why touch them?" That preserves bit-rot. Phase 1b surfaces:

- **Patterns that were 2024-best-practice but deprecated in 2025-2026** (e.g. Cypress single-engine model post-Playwright industry shift)
- **Anti-patterns that ship green tests but mask real defects** (e.g. snapshot tests on dynamic regions, Jest manual mocks of own modules)
- **Upgrade paths the original author didn't track** (e.g. Stryker pre-incremental-mode config = 10× CI cost)

The tester learns by review: "ok, my repo uses pattern X; cortex says 2026 standard is Y; here's the 1-paragraph 'why' with sources." That's calibration. Over weeks the tester internalizes which patterns to question.

### Cost guard

5 tools × ~60K tokens per research run = ~300K tokens added to audit. Max x20 covers easily; metered API gets warning. Cap at 5 detected tools (if 8 tools detected, pick 5 by usage frequency in the repo's test files). Skip Phase 1b entirely with `--no-existing-tests-analysis` flag.

### Privacy note

Research queries derived from generic tool names (e.g. "Playwright 2026 best practices") + generic anti-pattern detection. Repo-internal code is NOT sent in queries. Per-file findings reference local file paths only in the local deliverable — not in research queries.

---

## Phase 2 — Quality-model audit (4 parallel agents, 9 ISO-25010:2023 chars + 3 cortex extras)

**This is the load-bearing phase.** Spawn four parallel general-purpose agents via the Agent tool, each owning 3 of the 12 sections. The first 9 sections map directly to **ISO/IEC 25010:2023** product-quality characteristics (Functional Suitability, Performance Efficiency, Compatibility, Interaction Capability, Reliability, Security, Maintainability, Flexibility, Safety — Safety promoted to top-level in the 2023 revision). Sections 10-12 are cortex extras (correctness invariants, AI-specific testing, test observability) the standard doesn't yet cover at the right granularity for 2026 stacks.

The breadth phase is paired with a depth-first **Bach Heuristic Test Strategy Model (HTSM)** traversal: each agent walks the **SFDPOT** guidewords (Structure, Function, Data, Platform, Operations, Time) against its assigned characteristics. SFDPOT is the canonical "worm-through" — walk every guideword × every component to surface unknown unknowns.

> **Why parallel:** breadth-first audit (anthropic 90.2% lift). Cap at 4 agents.

### Agent A — Functional + reliability + correctness (dims 1-3)

Reads:
- `tests/` directory structure (output of Phase 1)
- Top-20 source files by churn (from `git log --numstat`)
- Acceptance criteria sources (`PROGRESS.md`, story files, JIRA/Linear if accessible via `gh api`)
- Bug history: `gh issue list --label bug --state closed --limit 50`

Produces sections:
1. **Functional suitability** — do tests verify the documented features? Pick 5 features from CLAUDE.md / README.md, map each to test files, flag features with zero coverage
2. **Reliability** — error path coverage (network failures, DB timeouts, malformed input). Sample 10 try/catch blocks; check if catch branches have tests
3. **Correctness invariants** — are domain invariants tested? (cart total = sum(line_items) − discounts + tax; user.email is unique; order.status transitions are valid). Property-based test candidates flagged here

### Agent B — Performance + portability + maintainability (dims 4-6)

Reads:
- Bundle output if `dist/` or `.next/` available; lighthouse history if `gh api` shows it
- E2E test setup files (Playwright/Cypress configs)
- CI matrix (`.github/workflows/`) — what OS / Node versions / browsers are tested
- Test runtime stats (`npm test --reporter=verbose` output if cheap to run)

Produces sections:
4. **Performance efficiency** — perf budget tests (k6, Lighthouse CI, web-vitals)? Flag missing budget for: page-load, API p99, bundle size, cold-start
5. **Portability + compatibility** — cross-browser, cross-node, cross-OS tested? Mobile viewport tested? Flag CI matrix gaps
6. **Maintainability of the test suite itself** — flake rate (parse `gh api` for re-run stats), test runtime trend, fixture sprawl, brittle selectors (CSS class deps, text-content assertions on translated strings)

### Agent C — Security + compatibility + data integrity (dims 7-9)

Reads:
- Authn/authz code paths (route handlers, middleware)
- Admin/back-office code (if `admin/` or similar dir exists)
- DB migration files (Supabase / Prisma / Drizzle / raw SQL)
- `npm audit --json` output if accessible
- Tests directory for `*-security.test.*`, `*rbac*`, `*authz*`, `*injection*` patterns

Produces sections:
7. **Security testing** — OWASP ASVS 5.0 Level 2 coverage check: authn tests, authz tests (BOLA/IDOR), injection tests (SQL/XSS/SSTI/prompt-injection if AI), secret-handling tests, session-management tests. Flag missing layers
8. **Compatibility / contract** — between front-end and back-end (Pact / OpenAPI-driven / typed-API-client), between services, between client and DB schema. Look for type drift between TS types and DB schema
9. **Data integrity** — referential integrity tests (foreign-key cascades, soft-delete vs. hard-delete), migration roll-forward + roll-back tests, RLS policy tests (Supabase) or row-security equivalents

### Agent D — Usability + AI-specific + observability-of-tests (dims 10-12)

Reads:
- A11y test markers (`axe-core`, `@testing-library/jest-axe`, lighthouse-ci configs)
- AI evals folder (`evals/`, `tests/ai/`) if AI features present (look for OpenAI/Anthropic/Vercel-AI imports)
- Test reporter config (junit XML, GitHub annotations, Phoenix OTLP)
- Test data fixtures (`tests/fixtures/`, `__fixtures__/`)

Produces sections:
10. **Usability + accessibility** — a11y assertions in component / E2E tests? Lighthouse a11y score gated in CI? Keyboard navigation tested? Focus-management on dynamic content? i18n / locale tests?
11. **AI-specific testing** (skip if no AI in stack) — eval suite present? Prompt injection tests? Hallucination guards? Cost guards in tests? Determinism via seed/temperature=0?
12. **Test observability** — when a test fails in CI, can you debug it from the artifact? Are screenshots/videos saved? Trace files? Are flake rates tracked? Test impact analysis (which tests cover which files)?

### Synthesis into `cortex/qa/AUDIT.md`

Once all four agents return, write `cortex/qa/AUDIT.md`:

```markdown
---
phase: 2-qa-audit
date: <YYYY-MM-DD>
slug: <slug>
quality_model: ISO/IEC 25010:2023
agents: [functional-reliability-correctness, performance-portability-maintainability, security-compatibility-integrity, usability-ai-observability]
---

# Test Audit — <project name>

> 12-dimension QA audit aligned to ISO/IEC 25010:2023 quality model.
> Citations are file:line + commit hash. This is a deliverable, not a chat scrollback.

## Executive summary (5 bullets)
- <strongest weakness #1 with severity>
- <strongest weakness #2 with severity>
- <single biggest risk if shipped today>
- <single highest-leverage fix (cost vs. value)>
- <one positive finding — what's already good>

## Quality scorecard (1-5 per ISO 25010 char)

| Characteristic | Score | Evidence |
|---|---|---|
| Functional suitability | 3/5 | tests cover happy paths, gaps in error paths (§1) |
| Reliability | 2/5 | … |
| Performance efficiency | 1/5 | no perf budget anywhere (§4) |
| Usability | 2/5 | no a11y assertions in component tests (§10) |
| Security | 2/5 | RBAC matrix not tested (§7) |
| Compatibility | 3/5 | … |
| Maintainability | 4/5 | … |
| Portability | 2/5 | … |

(Optional 9-10: AI-specific, Test observability — meta-characteristics)

## 1. Functional suitability
…
## 2. Reliability
…
[… all 12 dims …]

## Cross-dimension patterns (top 3)
- <pattern that appears in multiple dims, with citations>

## Open questions (handed to Phase 3)
- <thing the audit can't answer; needs human>
```

---

## Phase 3 — Human gate (5 irreducible QA questions)

After P2, ask the user the 5 questions no amount of code reading can derive. Update `cortex/qa/AUDIT.md` § "Open questions" with the answers.

> "QA audit je hotov v `cortex/qa/AUDIT.md` — projdi si ho. 5 otázek, co kód neumí říct:"

### Auto-mode behavior

**Q1 + Q5 are NEVER auto-filled** — they re-prioritize the entire P5 backlog. **Q2-Q4 may be auto-filled** with `_(reasonable-assumption)_` markers.

### Q1 — Top business risk this quarter
> "Co je věc, která kdyby v produkci selhala, byl by to PRŮŠVIH? (Konkrétně: 'checkout selže pro 1 % uživatelů a my to nevidíme', 'admin smaže omylem objednávku bez audit logu', 'AI agent leakne PII v odpovědi'.)"
>
> **In auto-mode**: present audit's top-3 risk candidates from §7 + §1 + §11 as numbered options, free-text fallback.

### Q2 — Last 3 production incidents
> "Jaké byly poslední 3 incidenty v produkci? Krátký popis + co se rozbilo + jestli máš na to teď test."
>
> Used to seed regression tests in P5.

### Q3 — Regulatory / compliance pressure
> "Jste pod nějakou regulací? (GDPR článek 32 → audit log, PSD2 → strong customer auth, AI Act → high-risk system tests, SOC 2 → access control tests, HIPAA, PCI-DSS Level 2…) Co konkrétně auditor vyžaduje?"
>
> Maps to OWASP ASVS Level (1, 2, or 3) for security tests in P5.

### Q4 — Off-limits / fragile zones
> "Co je v projektu, čeho se test-retrofit nemá dotýkat bez svolení? Modul/oblast — typicky: 'legacy admin export, refactoring na příští quarter', 'třetí strana hostuje payment, integraci nemockáme'."
>
> Respected by P5 — gaps in off-limits zones surface as FYI, not as backlog items.

### Q5 — Tester capacity + skill profile
> "Kdo bude na tomhle backlogu pracovat? (Solo junior tester / senior QA / dev tým / kombinace.) Kolik hodin/týden? Tools, které UMÍ používat (Playwright? Stryker? k6?)."
>
> Used to right-size the P5 backlog: junior solo gets 5 P0 + 10 P1; senior team gets full 30-item backlog with parallelization plan.

Append answers to `cortex/qa/AUDIT.md` § "Phase 3 — Human input":

```markdown
## Phase 3 — Human input

**Top business risk:** <Q1>
**Recent incidents:** <Q2 list>
**Compliance:** <Q3 — regulator + control list, mapped to ASVS L1/L2/L3>
**Off-limits zones:** <Q4 list>
**Tester profile:** <Q5 — capacity, skill stack>
```

---

## Phase 4 — Auto-research (testing-only topics, planner-driven)

**The planner agent** reads `cortex/qa/AUDIT.md` § Executive summary + § Phase 3, computes `topic_matrix = {detected_stack} × {qa_concerns}` (NOT the standard 6 concerns from `agents/planner.md` — see specialized matrix below).

### QA-specific concern taxonomy (overrides planner's default 6)

For QA retrofit, the concerns split into **testing-only (10)** + **DevOps/CI quality (5)**. Testing without DevOps quality gates = false confidence; DevOps without testing = unreliable substrate. The qa-engineer profile owns BOTH because they together determine "is the system actually verified end-to-end" — and a great tester learns this combination as a single skill.

**Testing concerns (10):**
- `e2e-strategy` — Playwright vs Cypress, browser matrix, video/trace, parallelization
- `unit-fitness` — coverage thresholds, mutation testing (StrykerJS), property-based (fast-check)
- `contract-testing` — Pact / OpenAPI / Schemathesis, FE-BE drift, type generation
- `security-testing` — OWASP ASVS 5.0, BOLA/IDOR, RBAC matrix, injection, audit logging
- `perf-testing` — k6, Lighthouse CI, Web Vitals, bundle budget
- `a11y-testing` — axe-core, lighthouse-ci a11y, keyboard, ARIA
- `ai-eval` — eval suites for LLM features, prompt injection, hallucination guards
- `test-observability` — flake tracking, test impact analysis, CI artifact discipline
- `mutation-fitness` — StrykerJS, threshold strategy, incremental mode
- `risk-based-prioritization` — ISO 25010 mapping, risk-coverage tradeoff

**DevOps/CI quality concerns (5) — added Sprint 2.10.1 per operator request:**
- `ci-pipeline-testing` — workflow correctness (`actionlint`), action pinning (`pinact`), gate consistency (does PR run what main runs?), secret hygiene
- `iac-testing` — Terraform/Pulumi/k8s YAML linting (`kubeval`, `kube-linter`, `tflint`), policy gates (OPA/Conftest), drift detection
- `container-security` — Dockerfile lint (`hadolint`), image scan (`Trivy`/`grype`), SBOM generation (`syft`), provenance (SLSA)
- `deploy-safety` — canary/blue-green/rollback discipline, post-deploy smoke synthetic checks, observability assertion (logs/metrics reach pipeline), DORA metrics dashboard
- `secret-supply-chain` — `gitleaks` PR + history scan, `osv-scanner` / `Snyk` dependency gate, npm-audit policy, `pinact` for action pinning

A great tester in 2026 owns the full "is the verification real" surface — not just the test code. The testing pyramid is a subset of the assurance pyramid; the qa-engineer profile names both.

Topic naming: `{stack-or-profile}-qa-{concern}-{year}`. Examples:
- `nextjs16-qa-e2e-strategy-2026`
- `supabase-qa-rls-rbac-matrix-2026`
- `vercel-ai-sdk-qa-eval-suite-2026`

### Selection rules (QA-specific)

1. **Max 5 topics** (same as default planner cap). Often 4 for narrow stacks.
2. **Heaviest weight on Q1 (top business risk).** If Q1 says "checkout failure" → 2 topics on e2e-strategy + perf-testing for checkout funnel.
3. **Compliance-driven topics** (Q3) get one slot if regulated.
4. **Tester capacity (Q5) caps tool variety.** Solo junior → don't research 4 different mutation testing frameworks; pick one.
5. **Profile overrides:** `chatbot-platform` → add `multi-tenant-test-isolation`. `ai-agent` → add `eval-driven-development-2026`. `astro-static` → drop to 2 topics (E2E + a11y).

Spawn the picked topics as parallel general-purpose agents (max 5). Each: 400-word report with citations to `$CORTEX_DATA_HOME/research/<slug>-qa-<date>.md` (single concatenated file, frontmatter `phase: 4-qa-research`).

**Hallucination guards:** same as standard planner — `min_sources_per_claim: 2`, HEAD-verify URLs, recency bias (12-month preference for fast-moving testing tools).

---

## Phase 5 — Synthesis (testing-strategy + testing-gaps backlog)

The synthesizer agent reads:
- `cortex/qa/AUDIT.md` (12 dims + Phase 3 input)
- `cortex/qa/test-inventory.md` (Phase 1)
- `$CORTEX_DATA_HOME/research/<slug>-qa-<date>.md` (Phase 4)

Writes **two artifacts** (plus Phase 6 if opt-in):

### 5a) `cortex/qa/testing-strategy.md`

High-level plan. Stack-specific. Cited.

```markdown
---
phase: 5-qa-strategy
date: <YYYY-MM-DD>
based_on:
  audit: cortex/qa/AUDIT.md
  inventory: cortex/qa/test-inventory.md
  research: $CORTEX_DATA_HOME/research/<slug>-qa-<date>.md
---

# Testing strategy — <project name>, <date>

Stack: <detected — Next.js 16.0.3 / Supabase 2.45 / OpenAI gpt-5.4 / ...>
Top business risk (Q1): <user's Q1 answer>
Compliance target (Q3): <ASVS Level / regulator>
Tester capacity (Q5): <hours/week, skill profile>

## Pyramid target (12-month plan)

|         | Now | 3 months | 12 months |
|---|---|---|---|
| Unit | <count, % cov> | <target> | <target> |
| Integration | … | … | … |
| Contract | <0 typically> | <target> | <target> |
| E2E | … | … | … |
| Perf | <0 typically> | <target> | <target> |
| A11y | … | … | … |

## Tool decisions (cited)
- **Unit:** <vitest 4 — keep or migrate; cite> [src: <URL>] [research: <topic>]
- **E2E:** <playwright 1.50 — recommendation; cite> [src: <URL>] [research: <topic>]
- **Mutation:** <stryker 9 incremental mode, threshold X for module Y; cite>
- **Contract:** <Pact / openapi-typescript / schemathesis; cite>
- **Perf:** <k6 + Lighthouse CI; cite>
- **A11y:** <axe-core in component tests + lighthouse a11y in CI; cite>

## CI gating philosophy
- **Block on:** <unit + integration + critical-path E2E>
- **Soft-block on:** <perf budget regression > X%>
- **Inform-only:** <mutation score, a11y score>

## Coverage thresholds (risk-tiered)
- High-risk modules (payment, auth, RLS): <80% line + 70% branch + 75% mutation>
- Mid-risk (orchestrators, business logic): <70% line + 60% branch>
- Low-risk (UI presentation, glue): <50% line>
- Excluded (generated, vendored, configs): <listed>

## Out-of-scope (cited reasoning)
- <"Don't add visual regression yet because team is solo junior" Q5 + cost analysis>
- <"Don't migrate from Jest to Vitest yet — keep velocity, do it post-Q3">

## Three-month execution plan (paired with backlog in §5b)
- Week 1-2: <P0 items 1-3>
- Week 3-4: <P0 items 4-5 + P1 items 1-2>
- Month 2: …
- Month 3: …
```

### 5a-bis) Test-types-catalog selection oracle (Sprint 2.10.4)

Before writing `cortex/qa/testing-gaps.md`, run the **catalog-selection oracle** against `~/.claude/shared/standards/test-types-catalog.md` (the exhaustive 112-entry SSOT):

1. **Evidence-driven match.** For each audit § N finding, traverse the catalog and match `when_to_use` triggers. E.g. audit § 1 says "no E2E for full guest checkout" → match `e2e-browser-flow` + `e2e-mobile-viewport`.
2. **Stack negative filter.** Drop entire categories irrelevant to the stack:
   - `package.json` has no LLM SDK → drop **Category 8 (AI-specific, 12 entries)**
   - No Postgres + RLS → drop `security-rls-bypass`
   - No GraphQL → drop `contract-graphql-schema`
   - No Docker → drop `devops-dockerfile-lint` + `devops-container-scan`
3. **Q5 capacity floor.** Read `cortex/qa/AUDIT.md § Phase 3 Q5` (tester profile). Compare against catalog entry's `tester_skill_floor`:
   - Q5 = "junior solo" → drop `senior-required` types from P0/P1 (surface as P2 with ratchet plan), keep `junior` + `mid-with-pairing`
   - Q5 = "senior team" → keep all tiers; recommend the senior-only types where applicable
4. **Q3 compliance escalation.** Read `cortex/qa/AUDIT.md § Phase 3 Q3` (regulatory target). For each catalog entry tagged with the matching compliance bucket, ESCALATE one priority tier:
   - Q3 = "GDPR Art. 32" → `security-audit-log-contract` + `compliance-gdpr-art32` move to P0 (regardless of audit signal)
   - Q3 = "ASVS L2" → all `security-*` entries with ASVS L2 mapping become P0/P1 minimum
   - Q3 = "WCAG 2.2 AA + EAA 2025" → `a11y-axe-component` + `a11y-keyboard-nav` + `compliance-wcag-22-aa` to P0
5. **Q1 risk-tier override.** Phase 3 Q1 (top business risk) trumps audit-signal priority. If Q1 = "tenant data leak", `security-tenant-isolation` + `security-bola-idor` + `security-rls-bypass` are P0 even if audit didn't surface them.
6. **Cap output.** Right-size by tester capacity per Q5:
   - Junior solo (≤ 15h/week): max 5 P0 + 10 P1 + 15 P2
   - Mid pair (~25h/week): max 7 P0 + 15 P1 + 20 P2
   - Senior team (40+h/week): full backlog

Document the SELECTION OUTCOME in `cortex/qa/AUDIT.md` § "Catalog selection (Phase 5a-bis)":

```markdown
## Catalog selection (Phase 5a-bis)

Catalog source: ~/.claude/shared/standards/test-types-catalog.md (112 entries)

**Categories filtered out** (stack-irrelevant):
- Category 8 — AI-specific (no LLM SDK in deps)
- Category 9.* — IaC subset (PaaS deploy, no Terraform/k8s)

**Selected types: <N> of 112**

| Catalog ID | Category | Audit § | Q3 escalation | Q5 tier | Priority |
|---|---|---|---|---|---|
| e2e-browser-flow | functional | §1 (money-path gap) | — | junior | P0 |
| security-rbac-matrix | security | §7 (RBAC tests = 0) | ASVS L2 → P0 | mid | P0 |
| ... | ... | ... | ... | ... | ... |

**Skipped with rationale:**
- `security-pen-test` — Q5 capacity (junior solo can't sponsor); revisit in 6 months
- `compliance-iso-25010-coverage` — Q3 didn't flag ISO 9001 in scope
```

Then write Phase 5b backlog using the selected catalog IDs as `[type: <id>]` tags on each gap entry. Tester clicks through to the catalog for tool decision tree + 2026 best practices per type.

### 5b) `cortex/qa/testing-gaps.md`

Prioritized backlog. Format mirrors `cortex/recommendations.md` but with QA semantics.

```markdown
---
phase: 5-qa-gaps
date: <YYYY-MM-DD>
based_on:
  audit: cortex/qa/AUDIT.md
  research: $CORTEX_DATA_HOME/research/<slug>-qa-<date>.md
---

# Testing gaps — <project name>, <date>

Stack: <detected>
Q1 top risk: <answer>
Tester profile (Q5): <answer>

## P0 — block-release-worthy (must close before next prod release)
- **GAP-001** — `<title>`. **Type:** <missing E2E / missing security test / missing perf budget>. **Risk if unfixed:** <one sentence>. **Estimate:** <2-4h>. **Owner skill:** <junior+pairing / senior solo / dev with QA review>. [audit: §<X>] [src: <URL>] [research: <topic>]
- **GAP-002** — …

## P1 — sprint-worthy (close in next 2-week sprint)
- **GAP-N** — …

## P2 — backlog (close opportunistically, track but don't gate)
- **GAP-N** — …

## SKIP — researched and intentionally NOT recommended (cited)
- <"Don't add Stryker yet because team is solo junior; revisit after first 5 P0 close" [src: cite] [research: <topic>]>

## OPEN QUESTIONS (sources disagree or context-dependent)
- <"Pact vs. openapi-typescript for contract tests" — recommendation lean: <X> because Q5 says senior team comfortable with TS codegen. [src A] vs [src B]>

## Off-limits zones (Phase 3 Q4) — flagged but NOT actionable
- FYI: <gap in off-limits area>; surface for human decision, do NOT add to backlog
```

### 5c) Three-hop citation traceability (mandatory)

Same as `agents/synthesizer.md` rule. Every claim → finding ID → source URL. Run the synthesizer's `pair-citation enforcer` bash check against `cortex/qa/testing-gaps.md` before declaring synthesis complete.

### 5d) Projects library entry update

Append a `## QA audit history` section (or update if exists) to `$CORTEX_DATA_HOME/projects/<slug>.md`:

```markdown
## QA audit history
- <date> — qa-retrofit (P0: <count>, P1: <count>, P2: <count>); Q1: <one-line risk>; see `<project_path>/cortex/qa/AUDIT.md` and `<project_path>/cortex/qa/testing-gaps.md`
```

---

## Phase 6 — Sample-test seeding (OPT-IN, requires `--seed-tests` flag)

Skip Phase 6 unless the user invoked the prompt with `--seed-tests` or explicitly asks "vygeneruj sample testy" after Phase 5.

If invoked: pick top 3 P0 gaps from `cortex/qa/testing-gaps.md` and write executable test files to `tests/qa-retrofit/<gap-id>.test.{ts,cjs}`. Each file:

- Imports from the actual source code (not stubs)
- Uses the project's existing test runner (detected in P0)
- Includes `// QA-RETROFIT GAP-XXX` header comment with backlog cross-link
- **MUST run** with `npm test` (or detected equivalent) — verify by running once before declaring done
- Marked `.skip` if implementation requires fixtures the audit can't generate (e.g. real Stripe sandbox key) — with a TODO line explaining

Don't seed more than 3 — past that, the AI is generating speculative tests that the human won't review. 3 high-quality sample tests >> 30 boilerplate ones.

---

## Phase 5f — Auto-research-PER-GAP (Sprint 2.10.3, qa-tester profile default ON)

> **For junior testers without prior experience** — every gap gets a 200-word web-research memo attached inline, fetched + cited at audit time. Tester opens the deliverable and finds the implementation know-how next to the gap; no separate research step required.

**When this fires automatically:**
- `~/.claude/cortex/user.yaml` has `profile: qa-tester` (set by `install.{sh,ps1} --profile=qa-tester`), OR
- prompt invoked with `--auto-research-gaps` flag, OR
- `cortex/qa-context.md` frontmatter has `auto_research_gaps: true`

When this is OFF (default for `dev` / `ai-engineer` / `minimal` profiles), Phase 5e nudge-only behavior applies — the tester paste-runs research themselves.

### Behavior

1. **Cap at 15 gaps total** (P0 + top P1 by risk). Past that = budget-prohibitive (15 parallel WebSearch agents ≈ ~5-8 minutes added to audit). SKIP / OPEN / off-limits / FYI gaps NEVER auto-research (they're context-dependent or already researched).
2. **Dispatch in waves of 5** (max 5 parallel agents at once per anthropic multi-agent paper budget). 15 gaps = 3 waves, ≈ 90s per wave with Sonnet-class agent.
3. **Per-gap query template** (built from gap's existing `**Research nudge:**` line):
   ```
   Research best practices 2026 for <gap.title> in <stack>:
   - 3 concrete implementation patterns with cited URLs (min 2 sources per claim)
   - 2 anti-patterns to avoid (cited)
   - 1 minimal-working-example code/config snippet
   - 200-word memo, 5+ cited URLs, recency-biased to last 12 months
   ```
4. **Each agent writes to** `$CORTEX_DATA_HOME/research/<slug>-qa-gap-<gap-id>-<date>.md`
5. **Synthesizer pulls each memo** + appends inline under the gap entry as:
   ```markdown
   - **GAP-NNN** — <title>. <existing fields>. [audit: …] [src: …] [research: …]
     **Research nudge:** <existing nudge line>
     **Research findings (auto-fetched 2026-MM-DD):**
     - **3 implementation patterns:** <bullet list with cited URLs>
     - **Anti-patterns:** <bullet list with cited URLs>
     - **Minimum working example:**
       ```<lang>
       <code/config snippet>
       ```
     **Sources:** <5+ cited URLs>
     Full memo: `$CORTEX_DATA_HOME/research/<slug>-qa-gap-<gap-id>-<date>.md`
   ```

### Why this matters specifically for junior testers

Per Sprint 2.10 R1 research [Shekhar 2026]: when LLMs write tests without grounding, ~30% suffer semantic drift (test passes but doesn't verify what the tester meant). The fix is **research-first, code-second** — but a junior tester doesn't yet know which sources to trust, what query to run, or how to filter for recency. Pre-fetching + inlining the research:

- **Removes the cold-start tax** — tester opens GAP-001 and sees Playwright CI patterns + Stripe-mock examples + the exact code stub, with sources
- **Calibrates the tester's "what's a good source?" judgment** — every research finding shows a citation chain (claim → cited URL); over weeks, the tester learns to spot quality
- **Reduces hallucination class of bug** — fewer "Claude wrote a test using Playwright API X" when X doesn't exist (the inlined memo references real X from Playwright docs)
- **Builds confidence** — junior sees "I'm not making this up, here's the source" when reviewing AI-suggested fixes with senior teammates

### Cost guard

Auto-research per gap dispatches up to 15 parallel WebSearch agents ≈ ~50K-80K tokens per gap (research output is small but reasoning is real). 15 × 60K ≈ 900K tokens per audit run. On flat-subscription plans (Claude Max x20) this is fine. On metered API: hard stop after 15 gaps; warn in `cortex/qa/AUDIT.md § Phase 7 closing`. Operator can opt out via `--no-auto-research-gaps` even with `profile: qa-tester` set.

### Privacy note

Research queries are derived from gap titles, NOT from the audit's findings text. So `GAP-002 — Full guest-checkout E2E flow` becomes a generic Playwright e-commerce checkout query, NOT `Research how to test <colleague-company>'s checkout that uses ComGate`. Keeps the audit's repo-internal findings off the public web.

---

## Phase 5e — Auto-research-nudge pattern (NEW Sprint 2.10.1 per operator request)

The biggest leap a junior tester makes when adopting cortex-x is **internalizing that web research is a first-class step**, not a luxury. To accelerate that learning, every gap in `cortex/qa/testing-gaps.md` ends with an explicit *"Research nudge:"* line that proposes a 1-paragraph WebSearch query the tester can paste into Claude Code BEFORE writing the first line of the fix.

Pattern format (added inline at the end of each gap entry):

```markdown
- **GAP-NNN** — <title>. <existing fields>. [audit: …] [src: …] [research: …]
  **Research nudge:** Before starting this gap, paste into Claude Code:
  > "Research best practices 2026 for <specific concern>: <2-3 specific sub-questions>. Min 5 cited URLs. 200-word memo."
```

Example for a real gap from this audit:

```markdown
- **GAP-002** — Full guest-checkout E2E flow. …
  **Research nudge:** Before starting, paste:
  > "Research best practices 2026 for Playwright E2E full e-commerce checkout flow including 3DS challenge handling, payment gateway sandbox patterns (Stripe-mock equivalent for ComGate/CSOB), and address validation interplay with 3DS2 risk fields. Min 5 cited URLs. 200-word memo."
```

**Why this matters (per Sprint 2.10 R1 research):** testdevlab 2026 found that orgs which ran an audit-then-research-first loop closed the 75/16 AI-testing-adoption gap. Junior testers in particular benefit from this nudge because the alternative ("LLM, write me a Playwright test for checkout") produces hallucinated APIs (~30% semantic-drift rate per Shekhar 2026). The nudge teaches the discipline by example.

**Backlog generator behavior:** when synthesizing `cortex/qa/testing-gaps.md` in Phase 5b, append a `**Research nudge:**` line under EVERY gap (P0/P1/P2). For SKIP entries, the nudge becomes *"Verify SKIP rationale stays current — re-research:"* so the deferral isn't permanent.

**Don't over-nudge:** for trivial gaps (e.g. "add `npm run test:coverage` script") skip the nudge — adding research overhead to a 5-minute task is friction, not value.

---

## Phase 7 — Final on_complete

```
QA retrofit done. Created in this directory:
- cortex/qa-context.md             — P0 detect output (test surface, runner, coverage)
- cortex/qa/test-inventory.md      — P1 file:line catalog with smell flags
- cortex/qa/AUDIT.md               — 12-dim ISO 25010 audit (senior QA deliverable)
- cortex/qa/testing-strategy.md    — high-level plan (pyramid, tools, CI gates, 3-month roadmap)
- cortex/qa/testing-gaps.md        — prioritized backlog (P0/P1/P2 + SKIP + OPEN)
- tests/qa-retrofit/*.test.*       — sample tests (only if --seed-tests)

Plus in cortex data home:
- $CORTEX_DATA_HOME/research/<slug>-qa-<date>.md — raw research cache
- $CORTEX_DATA_HOME/projects/<slug>.md — updated with QA audit history

Co dál?
- Začni s P0 v cortex/qa/testing-gaps.md (top 3 jsou block-release-worthy)
- Přijmi/uprav cortex/qa/testing-strategy.md — žije v repu, edituj v PR
- Pokud chceš sample testy: paste tento prompt s flagem `--seed-tests`
- Re-run za 3 měsíce: paste tento prompt znovu — diff bude vidět progres
- Sync na konci sezení: paste ~/.claude/shared/prompts/cortex-sync.md
```

---

## Rules

- **Never overwrite existing test files** without explicit approval. P6 sample tests go to `tests/qa-retrofit/<gap-id>.test.*` — a dedicated namespace; don't put them in existing test directories without the user's say-so
- **Never block on detector failure** — fail-open and proceed with degraded mode
- **Always cite findings** — file:line, commit hash, or research URL
- **Three-hop traceability** for every backlog item (`testing-gaps.md` claim → finding in `AUDIT.md` or `research/...md` → source URL)
- **Respect the social map** (Q4) — gaps in off-limits zones surface as FYI, not as backlog items
- **Right-size to tester capacity (Q5)** — solo junior backlog ≤ 15 items; senior team can absorb 30+
- **Synthesis is evidence-gated** — no citation = no backlog item

## Anti-patterns

- ❌ Generic backlog ("add more unit tests") → useless; specific or skip
- ❌ Recommending tools the team can't use → respect Q5 skill profile
- ❌ Coverage % as goal in itself → coverage is a fitness function, not a target. The strategy doc says WHY each threshold
- ❌ Skipping P3 → "do testing better" without business risk = backlog of guesses
- ❌ Writing P6 sample tests for off-limits zones → respect Q4
- ❌ Treating `/audit` and `/test-audit` as overlapping → they share P0 detect, but `/audit` is breadth-first 12-dim general; this is depth-first 12-dim ISO 25010 quality model
- ❌ Forgetting AI-specific tests when AI is in the stack → `evals/`, prompt injection, cost guards aren't optional for AI features

## Philosophy

A senior QA on day 1 of a new engagement does this in 2 weeks: read the code, ask 5 hard questions, document gaps mapped to a quality model, prioritize against business risk, and walk in on day 14 with a 3-month plan. cortex-x compresses that to 30 minutes — but doesn't skip any of the steps.

The goal is not "AI replaces tester." The goal is: **a tester walks into a new project with a senior consultant's first-2-weeks deliverable already on disk.** They spend day 1 reviewing it, not building it. That's the bar.

---

## Grounded in

- ISO/IEC 25010:2023 software quality model (8 characteristics + sub-characteristics)
- OWASP ASVS 5.0 Level 1/2/3 control list
- James Bach + Michael Bolton — Rapid Software Testing methodology (risk-based)
- Janet Gregory + Lisa Crispin — Agile Testing 2nd ed. (whole-team approach)
- Kent Beck — TDD by Example (write test first when fixing bug)
- Anthropic multi-agent research paper (parallel breadth-first 90.2% lift)
- cortex-x SSOT, Modular, Scalable, Correctness, Testing standards
- StrykerJS 9 documentation (mutation testing as fitness function)
- fast-check property-based testing patterns
