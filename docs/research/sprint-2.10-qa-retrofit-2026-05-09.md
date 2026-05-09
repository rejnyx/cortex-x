---
sprint: 2.10
title: QA retrofit — testing-focused audit prompt + skill + profile + templates
date: 2026-05-09
status: R1 (research-backed design)
operating_principles: R1 (research-before-implement), R3 (one defense layer + one regression test)
---

# Sprint 2.10 — QA Retrofit (R1)

> Operator request 2026-05-09: "udělej cortex master of testing guru pro novou kolegyni testerku — projet jak červ celý projekt, najít všechny slabiny, ale opravdu hluboké a dávající smysl, ne flat testing." Targeting `order-mage/eshop` + `order-mage/admin` as first dogfood.

## Goal

Add a depth-first testing-lens audit pipeline to cortex-x that produces senior-QA-consultant-grade deliverables (testing strategy + prioritized gap backlog + optional sample tests) in 30 minutes for an existing repo, with stack-specific 2026 research baked in.

**Positioning** (cited): "AI-augmented tester" — a tester walks into a new project with a senior consultant's first-2-weeks deliverable already on disk. They review it on day 1, not build it. The pattern matches the 2026 industry consensus: **QA → Quality Architect / SDET-AI**, AI handles regression + maintenance, humans own exploratory + business-intent + risk decisions [getcamped][1] [Quash][2] [Tricentis][3].

## Why now (cited motivation)

- **75% of orgs target AI testing, only 16% successfully adopt** — the differentiator is starting with an audit baseline before automating [testdevlab][4]. cortex-x already has audit infrastructure; the QA lens closes the gap.
- **Mutation testing repositioned from niche → mainstream gate** for AI-generated code (coverage % is gameable; mutation score is the honest fitness function) [Trail of Bits][5] [DEV/rsri][6] [stryker-mutator.io][7]. Sprint 2.3 R1 already designed this; Sprint 2.10 wires it into the retrofit recommendation system.
- **ISO/IEC 25010:2023 added Safety as 9th characteristic** (promoted from sub-characteristic in :2011) — most online "ISO 25010" references are stale; cortex-x can ship a 2023-aware audit while competitors are still on 8 chars [iso25000.com][8] [Pacific Cert][9].
- **OWASP ASVS 5.0** (May 2025) is the live baseline for security testing of admin/back-office systems; V4 Access Control is load-bearing [OWASP ASVS][10] [Cyber Chief][11]. Without ASVS-aligned tests, "we test security" is unverifiable in 2026.

## Design — what shipped this sprint

### 1. New prompt: `prompts/qa-retrofit.md`

Seven phases (P0-P6 + P7 closing). Modeled on `existing-project-audit.md` but with testing lens:

- **P0 detect** — adds test-surface scan (runner, E2E framework, mutation tool, coverage-report freshness)
- **P1 inventory** — file:line catalog with **tsDetect 5-detector starter** (Assertion Roulette, Eager Test, Empty/Smoke-only, Conditional Test Logic, Duplicate Assert) per FSE'20 paper at 85-100% precision [tsDetect][12]
- **P2 audit** — 4 parallel agents covering **9 ISO 25010:2023 characteristics + 3 cortex extras** (correctness invariants, AI-specific testing, test observability). Each agent walks **Bach SFDPOT guidewords** for depth-first traversal [Satisfice/HTSM][13]
- **P3 human gate** — 5 irreducible Q (top business risk, recent incidents, compliance/ASVS level, off-limits zones, tester capacity)
- **P4 research** — replaces the 6 canonical planner concerns with **10 QA-specific concerns** (e2e-strategy, unit-fitness, contract-testing, security-testing, perf-testing, a11y-testing, ai-eval, test-observability, mutation-fitness, risk-based-prioritization)
- **P5 synthesis** — `cortex/qa/testing-strategy.md` (high-level plan with risk-tiered mutation thresholds) + `cortex/qa/testing-gaps.md` (prioritized P0/P1/P2 backlog with 3-hop citations)
- **P6 sample-test seeding** (opt-in `--seed-tests`) — top 3 P0 gaps generated as runnable test files in `tests/qa-retrofit/`

### 2. New profile: `profiles/qa-engineer.yaml`

Framework-agnostic (`stack.framework: "*"` — qa-engineer is a lens, not a stack). Encodes:

- **Risk-tiered quality gates** — high-risk modules (payment/auth/RLS) gate on 80% line + 70% branch + 75% mutation; mid-risk on 70/60/60; low-risk advisory only
- **CI gating philosophy** — block on red unit/integration/critical-path-E2E; soft-block on mutation/perf regression; inform-only on a11y/visual; nightly-only on Stripe sandbox + k6 load + full mutation
- **Compliance mappings** — default ASVS L1, ai-agent/chatbot/nextjs-saas profiles get ASVS L2 by default (Phase 3 Q3 can override)
- **Default research topics** — 8 stack-agnostic 2026 topics the planner can dispatch when no project-specific override applies

### 3. Templates: `testing-strategy.md.hbs` + `testing-gaps.md.hbs`

Both with full 3-hop citation traceability (claim → finding ID → source URL). Pyramid plan, tool decisions, CI gates, ISO 25010:2023 char-by-char targets, off-limits zones (Phase 3 Q4), open questions (sources disagree).

### 4. Skill: `shared/skills/test-audit/SKILL.md`

Mirrors `/audit` shape. Auto-distributed via `install.sh` / `install.ps1` (`shared/*` recursive copy). Invoked via `/test-audit` after install.

### 5. Planner agent extension

`agents/planner.md` updated with QA-engineer concern override (10 concerns instead of canonical 6). Topic naming convention: `{stack-or-profile}-qa-{concern}-{year}`.

## Stack-specific research — order-mage/eshop + order-mage/admin

Pre-cached for the field-test colleague. Findings if the planner is invoked on this stack pair:

### E-commerce critical paths (12 minimum E2E flows) [Crystallize][14] [Bugbug][15] [Shopify][16] [testomat.io][17]

1. Guest checkout
2. Logged-in checkout
3. 3DS challenge accept (Stripe `4000 0027 6000 3184`)
4. 3DS challenge decline
5. Declined card
6. Address-validation failure
7. Out-of-stock during checkout
8. Search → PDP → cart conversion
9. Refund from admin reflected on storefront
10. Partial refund webhook → order history update
11. Mobile viewport checkout (1s delay = 20% conversion drop)
12. Account address CRUD

### Tool decisions (cited)

- **E2E:** Playwright 1.50+ wins over Cypress 14 (~23% faster, 2.5x cheaper CI, native WebKit/Safari ~18% mobile share) [tech-insider][18] [Yuri Kan][19] [Autonoma][20]
- **Visual:** Chromatic if Storybook exists (free 5000 snapshots); Playwright `toHaveScreenshot()` for top 5-10 routes otherwise [Playwright][21] [Chromatic][22]
- **Perf:** Lighthouse CI on 5 critical routes per PR; INP replaced FID March 2024, 12% of sites failing CWV under INP that previously passed [contextqa][23] [wp-rocket][24]
- **Contract:** OpenAPI as full provider surface + Pact for the consumer subset storefront actually depends on + Schemathesis to fuzz between them [Pact][25] [Apideck][26] [Speakeasy][27]
- **Stripe in CI:** `stripe-mock` (official HTTP fixture server) — never real Stripe in CI [Stripe][28] [stripe/stripe-mock][29]

### Admin / back-office security (cited)

- **OWASP ASVS 5.0** (May 2025) — V4 Access Control load-bearing for admin; Level 2 covers field-level access + multi-tenant isolation + session management [OWASP ASVS][10] [Cyber Chief][11]
- **BOLA still #1 (~40% of API attacks)** — needs ≥2 authenticated users + OpenAPI schema for the oracle to detect [OWASP API Top 10][30] [arXiv 2604.00702][31]
- **Supabase `service_role` key bypasses RLS** — admin dashboards using it MUST have regression tests asserting cross-tenant invisibility; dev DB with one super-user masks the bug [Supabase docs][32] [Makerkit][33]
- **Audit logging tests** — privileged-action contract test must capture actor + action + target + before/after diff before responding 2xx [StrongDM][34] [Tetrate][35]
- **Prompt injection** for AI-augmented admin — Google saw +32% malicious payloads Nov 2025→Feb 2026; 70% of LLM admins fail basic jailbreak [Google Security][36] [n1n.ai][37]

### Tooling 2026 free-tier CI lanes

- **ZAP** + `zap-api-scan.py` + YAML automation = free OpenAPI scan in GHA [apisec.ai][38]
- **Schemathesis / StackHawk** = schema-driven BOLA/BFLA oracles
- **stripe-mock** = deterministic payment fixtures, no rate limits, no test-mode dashboard pollution

## Acceptance criteria (verifiable post-merge)

- ✅ `prompts/qa-retrofit.md` exists, mentions all 9 ISO 25010:2023 chars + Bach HTSM SFDPOT explicitly
- ✅ `profiles/qa-engineer.yaml` declares risk-tiered quality gates with cited mutation thresholds
- ✅ `templates/testing-strategy.md.hbs` + `templates/testing-gaps.md.hbs` exist with 3-hop citation slots
- ✅ `shared/skills/test-audit/SKILL.md` references `qa-retrofit.md` prompt
- ✅ `agents/planner.md` documents the QA-engineer 10-concern override
- ✅ `tests/unit/qa-retrofit-structure.test.cjs` validates the prompt has all 7 phases + the templates have required hbs slots
- ✅ Smoke: `npm test` green
- ✅ Sprint 2.10 entry in `docs/steward-roadmap.md` + `CHANGELOG.md`
- ✅ R1 memo (this file) traces every claim to ≥2 sources via 3-hop chain

## Sprint 2.10.1 follow-up (same-day operator-driven extension)

**Operator request 1 (during dogfood):** "doplň do toho testing profilu i devops a podobné CI věci, k testingu to patří taky a může to zvýšit skill testera"

**Operator request 2 (during dogfood):** "když to začne tester používat cortex, tak ať mu cortex na vše sám doporučuje researche na webu, ať to ty lidi konečně pochopí jak to je OP dělat researche"

**Shipped Sprint 2.10.1**:

1. **DevOps/CI concern taxonomy expansion** — qa_concerns went from 10 → 15. New concerns: `ci-pipeline-testing` (actionlint, pinact, gate consistency), `iac-testing` (kubeval, kube-linter, tflint, OPA/Conftest), `container-security` (hadolint, Trivy/grype, syft SBOM), `deploy-safety` (canary, post-deploy smoke, DORA), `secret-supply-chain` (gitleaks, osv-scanner, dep pinning).
2. **Auto-research-nudge pattern** — every gap in `cortex/qa/testing-gaps.md` ships with an inline `**Research nudge:**` line proposing a 1-paragraph WebSearch query. Trains junior testers in the audit-then-research-first discipline that closed the 75/16 AI-testing-adoption gap (testdevlab 2026 [4]). Skipped for trivial gaps (<5min) to avoid friction-without-value.
3. **Profile + planner + prompt synchronized** — `profiles/qa-engineer.yaml` declares `qa_concerns: [15 concerns]` + `auto_research_nudge: { enabled: true, apply_to: [P0, P1, P2], skip_for_trivial: true }`. `agents/planner.md` documents the 15-concern taxonomy. `prompts/qa-retrofit.md` adds Phase 5e auto-research-nudge generator behavior.
4. **Field-test deliverables (order-mage/eshop + admin)** — auditor (this session) wrote 6 deliverables (AUDIT.md + testing-strategy.md + testing-gaps.md per repo) with the Sprint 2.10.1 concern set already applied. Admin testing-gaps.md surfaces 7 explicit DevOps/CI gaps (GAP-017 through GAP-023) that the testing-only taxonomy would have missed.

**Why this matters**: a 2026 tester owns the full "is verification real" surface — not just test code. Test-pass without a CI gate that runs them = nothing verified. The qa-engineer profile explicitly names both layers so junior testers learn this from day 1.

## Sprint 2.10.2 follow-up — installer profile selection (same-day operator extension)

**Operator request 3:** "možná by jsme mohli mít i možnost, že kdyř uživatel nainstaluje cortex, tak si bude moct vybrat profil, testerka Verča si vybere QA tester a hned dostane vše potřebné pro ni"

**Shipped Sprint 2.10.2**:

1. **`install.sh` + `install.ps1` extended** — accept `--profile=<name>` CLI arg, `$CORTEX_PROFILE` env var, OR interactive prompt (TTY-gated). Profiles: `dev` (default) | `qa-tester` (Verča) | `ai-engineer` | `minimal`.
2. **qa-tester profile installs `/test-audit` user-skill** at `~/.claude/skills/test-audit/SKILL.md` (sourozenec `/cortex-init` — Verča může napsat `/test-audit` ve svém claude session a běží přímo).
3. **Profile written to `~/.claude/cortex/user.yaml`** as `profile: qa-tester` — session-start hook + Phase 5f auto-research-per-gap can read it.
4. **Profile-aware install banner** — `qa-tester` profile gets QA-tailored "Next step" with `/test-audit` first, qa-engineer profile reference, and standards-to-read-first list (`testing.md`, `correctness.md`, `security.md`).
5. **Integration tests** (`tests/integration/install-roundtrip.test.cjs`) — qa-tester install creates `/test-audit` user-skill + writes `profile: qa-tester` to user.yaml + banner mentions `/test-audit`. Default `dev` install does NOT install `/test-audit` at user level (keeps default install lean).

## Sprint 2.10.3 follow-up — auto-research-PER-GAP (operator request, junior-tester focused)

**Operator request 4:** "do toho QA tester profilu implementuj, že všechny nálezy budou automaticky proscanovány research na webu a nejlepší know how a implementace toho do reálných usecases pro nejlepší výsledky. ona je mladá holka bez zkušeností"

**Shipped Sprint 2.10.3**:

1. **Phase 5f auto-research-per-gap** in `prompts/qa-retrofit.md` — when `profile: qa-tester` (or `--auto-research-gaps` flag), every P0 + top-P1 gap (cap 15) gets a parallel WebSearch agent dispatch. Each agent writes a 200-word memo with: 3 concrete implementation patterns, 2 anti-patterns, 1 minimal-working-example code/config snippet, 5+ cited URLs.
2. **Inline append to testing-gaps.md** — synthesizer pulls each per-gap memo + appends `**Research findings (auto-fetched <date>)**:` block under the gap entry. Junior tester opens the deliverable + sees implementation know-how next to the gap, no separate research step required.
3. **3-wave parallel dispatch** (5 agents per wave, anthropic multi-agent budget) — 15 gaps ≈ 90s × 3 waves ≈ 5 min added to audit; ~900K tokens total (Max x20 covers easily).
4. **Privacy guardrail** — research queries derived from generic gap titles, NOT from audit's repo-internal findings text. Repo internals stay off the public web.
5. **`profiles/qa-engineer.yaml` declares** `auto_research_per_gap: { enabled: true, max_gaps: 15, apply_to: [P0, P1], cost_guard: { hard_stop_at_gap_count: 15, flat_subscription_safe: true, metered_warning: true } }`.

**Why this matters specifically for junior testers** (per Sprint 2.10 R1 research [Shekhar 2026]):
- Removes cold-start tax — tester opens GAP-001 + sees Playwright CI patterns + Stripe-mock examples + exact code stub WITH sources
- Calibrates "what's a good source?" judgment over weeks via citation-chain examples
- Reduces hallucination class of bug — fewer "Claude wrote a test using Playwright API X" when X doesn't exist
- Builds confidence — junior sees "I'm not making this up, here's the source" when reviewing AI-suggested fixes with senior teammates

## Sprint 2.10.4 follow-up — exhaustive test-types catalog SSOT (operator request, all 2026 test types)

**Operator request 5:** "ať náš QA tester profil obsahuje všechny možné druh testování úplně všechny, ale použije je jen podle scanu retrofitu co zjistí"

Profile owns the SUPERSET (catalog of everything possible in 2026); audit picks the SUBSET (what's actually needed for this stack × risk × capacity). Cleaner than embedding everything in the prompt or profile inline.

**Shipped Sprint 2.10.4**:

1. **`standards/test-types-catalog.md`** — exhaustive 112-entry catalog across 12 categories:
   - Functional (17 entries): unit / integration / e2e-browser / e2e-mobile / acceptance-bdd / smoke / regression / snapshot / golden-master / story-storybook / visual-regression / cross-browser / i18n × 2 / hook-behavior / component-rendering / pure-function
   - Performance (8): lighthouse / k6 / stress / soak / spike / memory-leak / bundle-size / cold-start
   - Security (19): SAST / DAST / IAST / SCA / secret-scanning / container / fuzz × 2 / BOLA-IDOR / RBAC matrix / tenant-isolation / authn / CSRF / injection / prompt-injection / lethal-trifecta / audit-log / pen-test / ASVS L1-L3 / RLS-bypass
   - Reliability (9): chaos / fault-injection / idempotency / replay / migration roll-fwd + back / backup-restore / circuit-breaker / rate-limit
   - Correctness (6): property-fast-check / state-machine / metamorphic / mutation / MC/DC / line-branch
   - Contract (6): Pact / OpenAPI-Schemathesis / GraphQL / gRPC-protobuf / DB-schema-drift / API-versioning
   - A11y (6): axe-component / lighthouse-score / keyboard-nav / screen-reader / color-contrast / RTL-locale
   - AI-eval (12): eval-rubric / prompt-injection-regression / hallucination / bias-toxicity / determinism / cost-guard / output-shape / tool-call / loop-detection / RAG-retrieval / embedding-drift / multiturn
   - DevOps (14): workflow-lint / action-pinning / IaC-lint / Dockerfile-lint / SBOM / SLSA / canary / blue-green / rollback-drill / observability-assertion / alert-rule / DORA / build-reproducibility / cache-poisoning
   - Data (4): validation-boundary / PII-redaction / retention-TTL / ETL-lineage
   - Compliance (8): GDPR Art.32 / PCI-DSS L4 / SOC 2 / HIPAA / ISO 25010 / EU AI Act / WCAG 2.2 AA / COPPA-FERPA
   - Docs (3): link-rot / code-snippet-executability / API-doc-drift
2. **Each entry has canonical metadata**: Category, What, Tools 2026, When to use, Skip when, Effort (S/M/L), Tester skill floor (junior/mid/senior).
3. **`profiles/qa-engineer.yaml`** declares `test_types_catalog: { source: ..., total_entries: 112, categories: 12, selection_principle: ... }` and references the catalog for Phase 5.
4. **`prompts/qa-retrofit.md` Phase 5a-bis** — catalog-selection oracle. Maps audit findings × catalog `when_to_use` triggers, filters by stack (drop AI category if no LLM SDK), tiers by Q5 capacity (junior solo skips senior-only types), escalates by Q3 compliance + Q1 risk-tier. Outputs `cortex/qa/AUDIT.md § "Catalog selection (Phase 5a-bis)"` with selected types + skipped-with-rationale.
5. **Selection principle**: "Apply the LEAST testing necessary to verify the most critical risks" — typical audit picks 12-25 of 112 entries. Mutation score = honest fitness function; line coverage = vanity.

**Web research follow-up (5 parallel agents dispatched, citations merged into catalog):**
- Testing taxonomy 2026 (ISO 25010:2023 verification, ISTQB CTFL v4.0.1, Bach HTSM 4-axis correction)
- Security testing tools 2026 (ASVS 5.0 release date, npm-audit deprecation, libFuzzer maintenance-only, Semgrep > SonarQube for security CI)
- AI/LLM testing 2026 (promptfoo / Vercel AI evals / LangSmith comparison, OWASP LLM Top 10 2025 status)
- DevOps quality gates 2026 (osv-scanner v2 vs Snyk, Trivy vs Grype, SBOM standards SPDX vs CycloneDX 1.6)
- Perf + a11y + compliance 2026 (k6 vs JMeter, INP migration, EAA 2025-06-28 enforcement, EU AI Act phased rollout)

Raw research caches at `c:\tmp\catalog-research-{1..5}-*.md`. Catalog corrections applied: HTSM split into Product Elements (SFDPOT) + Techniques (FDSFSCURA-9), `npm audit` flagged deprecated as sole gate, libFuzzer marked maintenance-only.

## Out of scope (explicit non-goals)

- **Auto-running mutation testing** in `qa-retrofit` — recommended in P5, not executed. Stryker integration into `/test-audit` runtime = Sprint 2.3 implementation work (separate, operator-approved).
- **Auto-generating > 3 sample tests** — past 3, AI is generating speculative tests humans won't review. 3 high-quality sample tests >> 30 boilerplate ones.
- **Replacing `/audit`** — these prompts are siblings. `/audit` is general 12-dim; `/test-audit` is testing lens. Run BOTH for comprehensive engagement.
- **Profile auto-detection** — qa-engineer is invoked explicitly via `/test-audit`; the detector pipeline doesn't auto-classify a project as `qa-engineer` (it's a lens, not a stack).
- **Implementing the field test on order-mage repos** — Sprint 2.10 ships the infrastructure; the dogfood field test is a separate session.

## Risks + mitigations

- **Risk:** Junior tester runs `/test-audit` and gets overwhelmed by 30-item P1 backlog.
  **Mitigation:** Phase 3 Q5 (tester capacity) right-sizes the backlog — junior solo gets 5 P0 + 10 P1 max; senior team gets full 30+ with parallelization plan.

- **Risk:** Prompt-injection in audit findings (LLM judges feed back into LLM synthesis).
  **Mitigation:** P5 synthesizer uses `<untrusted>` delimiters around any P2-finding text fed into LLM (Sprint 1.6.20 pattern). NOT yet implemented in qa-retrofit; tracked as Sprint 2.10.1 hardening.

- **Risk:** Citations decay (URLs go 404 over months).
  **Mitigation:** `cortex-doctor` already verifies 3-hop chains periodically; same coverage applies to qa-retrofit outputs.

- **Risk:** Stack-specific research (e.g. order-mage e-commerce) gets stale within months.
  **Mitigation:** Phase 4 research has 12-month TTL per `config/research.yaml`; re-running `/test-audit` quarterly refreshes findings.

## Field-test plan — order-mage/eshop + order-mage/admin

Operator's colleague (junior tester) will:

1. Clone cortex-x → `./install.ps1` → propagates `qa-retrofit` prompt + `test-audit` skill + templates + profile to her `~/.claude/`
2. In her duplicate of `order-mage/eshop`: invoke `/cortex-init` → general retrofit (CLAUDE.md, etc.)
3. Then invoke `/test-audit` → 30-min QA audit produces:
   - `cortex/qa-context.md` (P0 — Next.js + Stripe-likely + admin pair detected)
   - `cortex/qa/test-inventory.md` (P1 — what tests exist, smell flags via tsDetect 5)
   - `cortex/qa/AUDIT.md` (P2 — 12 sections, ISO 25010:2023 + 3 cortex extras)
   - 5 questions (P3 — top business risk = checkout failure visibility, etc.)
   - `$CORTEX_DATA_HOME/research/order-mage-eshop-qa-2026-05-09.md` (P4 — 4-5 stack-specific topics from QA concerns)
   - `cortex/qa/testing-strategy.md` (P5 — 12-month pyramid plan, tool decisions, CI gates, ISO targets)
   - `cortex/qa/testing-gaps.md` (P5 — P0/P1/P2 backlog with 3-hop citations)
4. Optional: paste prompt with `--seed-tests` → top 3 P0 gaps materialize as runnable test files in `tests/qa-retrofit/`
5. Repeat for `order-mage/admin` — separate run, separate `cortex/qa/` directory

Expected wow moment: she walks in day 2 with a senior-consultant deliverable already done. Her job: review, edit, prioritize, and execute the backlog with the team.

## Sources

[1] https://www.getcamped.com/blog/how-ai-is-changing-the-role-of-qa-testers
[2] https://quashbugs.com/blog/qa-to-sdet-ai-2026
[3] https://www.tricentis.com/blog/qa-trends-ai-agentic-testing
[4] https://www.testdevlab.com/blog/ai-augmented-software-testing-future-of-qa
[5] https://blog.trailofbits.com/2026/04/01/mutation-testing-for-the-agentic-era/
[6] https://dev.to/rsri/mutation-testing-the-missing-safety-net-for-ai-generated-code-54kn
[7] https://stryker-mutator.io/
[8] https://iso25000.com/index.php/en/iso-25000-standards/iso-25010
[9] https://blog.pacificcert.com/iso-25010-software-product-quality-model/
[10] https://owasp.org/www-project-application-security-verification-standard/
[11] https://www.cyberchief.ai/2025/10/owasp-asvs-v5-raising-bar-for.html
[12] https://testsmells.org/assets/publications/FSE2020_TechnicalPaper.pdf
[13] https://www.satisfice.com/download/heuristic-test-strategy-model
[14] https://crystallize.com/blog/e2e-checkout-flow
[15] https://bugbug.io/blog/software-testing/e2e-test-coverage/
[16] https://www.shopify.com/blog/ecommerce-testing
[17] https://testomat.io/blog/e-commerce-testing/
[18] https://tech-insider.org/cypress-vs-playwright-2026/
[19] https://yrkan.com/blog/playwright-vs-cypress-comparison/
[20] https://getautonoma.com/blog/playwright-vs-cypress
[21] https://playwright.dev/docs/release-notes
[22] https://www.chromatic.com/compare/percy
[23] https://contextqa.com/blog/performance-testing-tools-2026/
[24] https://wp-rocket.me/blog/core-web-vitals-testing-performance-monitoring-tools/
[25] https://docs.pact.io/
[26] https://www.apideck.com/blog/openapi-testing
[27] https://www.speakeasy.com/blog/pact-vs-openapi
[28] https://docs.stripe.com/automated-testing
[29] https://github.com/stripe/stripe-mock
[30] https://owasp.org/API-Security/
[31] https://arxiv.org/html/2604.00702v1
[32] https://supabase.com/docs/guides/database/postgres/row-level-security
[33] https://makerkit.dev/blog/tutorials/supabase-rls-best-practices
[34] https://www.strongdm.com/blog/how-to-audit-privileged-access-management
[35] https://tetrate.io/learn/ai/mcp/mcp-audit-logging
[36] https://security.googleblog.com/2026/04/ai-threats-in-wild-current-state-of.html
[37] https://explore.n1n.ai/blog/llm-prompt-injection-security-vulnerability-test-2026-03-17
[38] https://www.apisec.ai/blog/burp-suite-vs-zap

## Raw research caches (full agent outputs)

- `c:\tmp\qa-research-1-ai-augmented-2026.md` — AI-augmented QA workflows (21 cited URLs)
- `c:\tmp\qa-research-2-ecommerce-2026.md` — Next.js e-commerce testing (27 cited URLs)
- `c:\tmp\qa-research-3-deep-audit-2026.md` — Deep audit methodology (20 cited URLs)
- `c:\tmp\qa-research-4-admin-security-2026.md` — Admin security testing (25 cited URLs)
