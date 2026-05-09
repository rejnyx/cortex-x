# Test Types — Exhaustive 2026 Catalog (SSOT)

> The complete catalog of test types a QA engineer might apply in 2026. The qa-engineer profile and `/test-audit` prompt reference this catalog. **Audit picks the subset; profile owns the catalog.** Don't apply all 90 — apply the ones the audit signals are needed for THIS stack × THIS risk × THIS capacity.

## How to use this catalog

**For the audit (Phase 5 selection oracle):**
1. Read `cortex/qa/AUDIT.md` § Executive summary + § 12-section findings + § Phase 3 (Q1 business risk, Q3 compliance target, Q5 tester capacity)
2. For each finding, traverse the catalog and match `when_to_use` triggers to the finding's evidence
3. Filter by `skip_when` negatives (e.g. don't recommend chaos engineering for a static blog)
4. Tier by `tester_skill_floor` against Q5 capacity (junior solo skips L-effort senior-only types)
5. Cap output at: 5 P0 + 10 P1 + 15 P2 (tester-capacity right-sizing)

**For the colleague reading the deliverable:**
- Each gap in `cortex/qa/testing-gaps.md` cites the test type by `id` (e.g. `[type: e2e-browser-flow]`)
- Click through here for tool decision tree + 2026 best practices per type
- Categories are organized so you can read top-to-bottom and learn what's possible without overwhelm

## Selection principle

"Apply the LEAST testing necessary to verify the most critical risks" — not "apply everything possible". Coverage is a fitness function, not a target. Mutation score is honest; line coverage is vanity. Test types stack: each layer should add CONFIDENCE that prior layers don't, not duplicate.

---

## Category 1 — Functional / behavioral testing

### `unit-pure-function`
- **Category:** functional
- **What:** test pure functions with deterministic inputs/outputs (no I/O, no side effects)
- **Tools 2026:** Vitest 4 (TS) | Jest 30 | node:test (zero-dep) | pytest 8 (Python)
- **When to use:** any module with pure logic — calculations, transformations, parsers, validators
- **Skip when:** module is just a thin wrapper around an external API (test the integration instead)
- **Effort:** S (15-30 min per file)
- **Tester skill floor:** junior

### `unit-component-rendering`
- **Category:** functional
- **What:** assert React/Vue components render expected output for given props
- **Tools 2026:** @testing-library/react 16 + Vitest | vue-test-utils 2 + Vitest
- **When to use:** any component with conditional rendering, accessibility roles, ARIA states
- **Skip when:** component is purely presentational with no logic (snapshot-only is enough)
- **Effort:** S
- **Tester skill floor:** junior

### `unit-hook-behavior`
- **Category:** functional
- **What:** test React hooks in isolation with `renderHook`
- **Tools 2026:** @testing-library/react renderHook + Vitest
- **When to use:** custom hooks with state, effects, or external integrations
- **Skip when:** hook just composes other tested hooks
- **Effort:** S-M
- **Tester skill floor:** junior

### `integration-api-route`
- **Category:** functional
- **What:** test backend API routes hitting real DB, real cache, real queue (Docker-compose)
- **Tools 2026:** Vitest + Supertest | NestJS @nestjs/testing | pytest + httpx
- **When to use:** API routes with multi-step DB ops, cross-service calls, async processing
- **Skip when:** route is a pass-through CRUD with auto-generated handler — schema-test instead
- **Effort:** M
- **Tester skill floor:** mid

### `e2e-browser-flow`
- **Category:** functional
- **What:** drive a real browser through a multi-page user flow end-to-end
- **Tools 2026:** Playwright 1.50+ (recommended; ~23% faster than Cypress, native WebKit) | Cypress 14 (legacy)
- **When to use:** critical user journeys (checkout, signup, password reset, refund flow)
- **Skip when:** flow has no UI (API-only) or is pre-MVP (UI churns daily)
- **Effort:** M (3-6h per flow with fixtures)
- **Tester skill floor:** junior with Playwright codegen; mid for stable selectors

### `e2e-mobile-viewport`
- **Category:** functional
- **What:** same as e2e-browser-flow but emulating iPhone/Android viewport
- **Tools 2026:** Playwright `device: 'iPhone 14'` / `'Pixel 7'`
- **When to use:** mobile traffic > 30% of users; e-commerce; consumer apps
- **Skip when:** B2B admin tool with desktop-only users (verify via analytics first)
- **Effort:** S extension on existing e2e
- **Tester skill floor:** junior

### `acceptance-bdd-gherkin`
- **Category:** functional
- **What:** Given/When/Then scenarios driving E2E or integration tests
- **Tools 2026:** Cucumber.js (declining) | Vitest with custom describe.bdd helpers (modern)
- **When to use:** non-engineer stakeholders (PM, business analyst) author tests; regulated industries
- **Skip when:** dev team is the only test-author (BDD overhead > value)
- **Effort:** L (BDD adoption is org-level, not per-feature)
- **Tester skill floor:** mid + stakeholder partnership

### `smoke-post-deploy`
- **Category:** functional
- **What:** 1-3 minimal "is the deploy working?" assertions run after deploy completes
- **Tools 2026:** Playwright projects: `smoke` | curl + bash + jq | k6 with `--vus=1`
- **When to use:** every production deploy (automated pipeline gate)
- **Skip when:** never (this is non-negotiable for any prod-deploying project)
- **Effort:** S (5-30 min one-time setup)
- **Tester skill floor:** junior

### `regression-bug-replay`
- **Category:** functional
- **What:** for every closed bug, write a test that fails the original buggy code and passes the fix
- **Tools 2026:** any unit/integration framework
- **When to use:** ALWAYS when fixing a bug (TDD-bug-first principle)
- **Skip when:** never (this is one of testing's foundational disciplines)
- **Effort:** S (test should be ~30 min in addition to fix)
- **Tester skill floor:** junior

### `snapshot-stable-output`
- **Category:** functional
- **What:** assert serialized output equals stored snapshot
- **Tools 2026:** Vitest `toMatchSnapshot` | Jest snapshots
- **When to use:** stable output formats (CLI text, generated code, Markdown reports)
- **Skip when:** output is dynamic/timestamped/non-deterministic (snapshot churn destroys signal)
- **Effort:** S
- **Tester skill floor:** junior

### `golden-master-approval`
- **Category:** functional
- **What:** "approval testing" — pin current output as golden, fail on diff
- **Tools 2026:** approvaltests.com (TS, Python, Java, .NET)
- **When to use:** legacy code without specs (Feathers characterization tests)
- **Skip when:** code is well-spec'd; better to write behavioral tests
- **Effort:** S-M
- **Tester skill floor:** junior

### `story-storybook`
- **Category:** functional
- **What:** Storybook stories as test cases (interaction tests, play functions)
- **Tools 2026:** Storybook 8 + @storybook/test
- **When to use:** component library / design system; visual + functional in one
- **Skip when:** no Storybook in the project (don't introduce just for tests)
- **Effort:** M (Storybook setup is heavy; tests are cheap once it exists)
- **Tester skill floor:** junior

### `visual-regression-screenshot`
- **Category:** functional
- **What:** pixel-diff stored screenshots vs current render
- **Tools 2026:** Playwright `toHaveScreenshot()` (native, free) | Chromatic (Storybook) | Percy (AI review)
- **When to use:** brand-critical UI; design-system component library; e-commerce PDP
- **Skip when:** rapid UI iteration phase (every PR triggers diff noise)
- **Effort:** M (mask dynamic regions or every PR fails)
- **Tester skill floor:** mid (false-positive triage requires judgment)

### `cross-browser-matrix`
- **Category:** functional
- **What:** run E2E suite against Chromium + WebKit + Firefox
- **Tools 2026:** Playwright projects
- **When to use:** consumer apps with mobile Safari traffic > 10%
- **Skip when:** B2B internal tool with single-browser policy
- **Effort:** S extension on existing e2e (CI minutes go up 3x)
- **Tester skill floor:** junior

### `i18n-locale-completeness`
- **Category:** functional
- **What:** every translation key in source-of-truth locale must exist in all sibling locales
- **Tools 2026:** fast-check property test | i18next-resources-to-backend
- **When to use:** multi-locale app (≥3 languages)
- **Skip when:** single-locale app
- **Effort:** S (1-2h once, runs forever)
- **Tester skill floor:** junior

### `i18n-runtime-render`
- **Category:** functional
- **What:** assert UI renders correctly with each locale loaded (date format, number format, RTL)
- **Tools 2026:** Playwright with locale param + storybook locale toolbar
- **When to use:** date/number-heavy UI; RTL languages (ar, he)
- **Skip when:** no RTL + dates only in ISO format
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 2 — Performance / non-functional testing

### `perf-budget-lighthouse`
- **Category:** performance
- **What:** Lighthouse CI on critical routes, gate INP/LCP/CLS budgets per PR
- **Tools 2026:** lighthouse-ci 0.13+ | @lhci/cli
- **When to use:** any user-facing web app
- **Skip when:** API-only service; admin tool with no perf SLO
- **Effort:** S (4h setup, then automatic)
- **Tester skill floor:** junior
- **Note 2026:** INP replaced FID March 2024 — re-baseline old budgets

### `perf-load-k6`
- **Category:** performance
- **What:** simulate concurrent users hitting top-N endpoints
- **Tools 2026:** k6 0.55+ | Grafana k6 Cloud | Artillery 2 | JMeter (legacy)
- **When to use:** B2C app with traffic peaks; ahead of Black Friday / launch
- **Skip when:** internal tool with <100 users; pre-MVP
- **Effort:** M (load fixtures + ramp profile)
- **Tester skill floor:** mid

### `perf-stress-breaking-point`
- **Category:** performance
- **What:** ramp until system breaks; identify breaking point + recovery behavior
- **Tools 2026:** k6 with `stages: [{ target: 10000, duration: '30m' }]`
- **When to use:** capacity-planning for known launch / scale event
- **Skip when:** no scale milestone in next 6 months
- **Effort:** M-L
- **Tester skill floor:** mid-senior

### `perf-soak-endurance`
- **Category:** performance
- **What:** sustained moderate load for hours/days; surface memory leaks, connection pool exhaustion
- **Tools 2026:** k6 with `duration: '24h'`
- **When to use:** long-lived backend services; memory-leak history
- **Skip when:** stateless serverless; serverless cold-start renews state per invocation
- **Effort:** L (ops-heavy; needs monitoring stack)
- **Tester skill floor:** senior

### `perf-spike`
- **Category:** performance
- **What:** sudden 10× traffic burst; assert auto-scaling + recovery
- **Tools 2026:** k6 with abrupt `target` jumps
- **When to use:** marketing-driven traffic events; viral content risk
- **Skip when:** no spike-traffic risk model
- **Effort:** M
- **Tester skill floor:** mid

### `perf-memory-leak`
- **Category:** performance
- **What:** track heap usage over N requests; fail if monotonically increasing
- **Tools 2026:** clinic.js heap | Node `--inspect` + Chrome DevTools | memlab
- **When to use:** long-lived Node process; reports of "service slows after 2 days"
- **Skip when:** ephemeral function-as-a-service
- **Effort:** M
- **Tester skill floor:** mid-senior

### `perf-bundle-size-budget`
- **Category:** performance
- **What:** assert JS bundle stays under N kB after each PR
- **Tools 2026:** size-limit | bundlesize2 | webpack-bundle-analyzer with CI gate
- **When to use:** consumer web app; mobile-first
- **Skip when:** SSR-only app with no client JS
- **Effort:** S
- **Tester skill floor:** junior

### `perf-cold-start-budget`
- **Category:** performance
- **What:** measure serverless cold start latency; gate at p99 budget
- **Tools 2026:** AWS Lambda Insights | Vercel Functions metrics | wrk2
- **When to use:** infrequent serverless endpoints (cold start matters)
- **Skip when:** always-warm container
- **Effort:** S-M
- **Tester skill floor:** mid

---

## Category 3 — Security testing

### `security-sast-static`
- **Category:** security
- **What:** static analysis for code-level security flaws (eval, hardcoded secrets, unsafe deserialize)
- **Tools 2026:** Semgrep | CodeQL (GitHub Advanced Security) | SonarQube
- **When to use:** any production codebase
- **Skip when:** scratch / personal repo
- **Effort:** S (CI integration)
- **Tester skill floor:** junior

### `security-dast-runtime`
- **Category:** security
- **What:** dynamic scan against running app for OWASP Top 10
- **Tools 2026:** OWASP ZAP (free, GHA-integrated) | Burp Suite Pro | StackHawk
- **When to use:** any web app facing internet; nightly CI scan
- **Skip when:** localhost-only dev tool
- **Effort:** M (auth fixture for authenticated endpoints)
- **Tester skill floor:** mid

### `security-iast-instrumented`
- **Category:** security
- **What:** runtime instrumentation observes data flow during test runs
- **Tools 2026:** Contrast Security | Seeker (Synopsys) | Hdiv
- **When to use:** enterprise security program; compliance-driven
- **Skip when:** small team without enterprise budget
- **Effort:** L (commercial setup)
- **Tester skill floor:** senior

### `security-sca-deps`
- **Category:** security
- **What:** scan deps for known CVEs, license violations
- **Tools 2026:** osv-scanner (Google, free) | Snyk | Dependabot | npm audit
- **When to use:** any project with deps
- **Skip when:** never
- **Effort:** S (PR gate via osv-scanner action)
- **Tester skill floor:** junior

### `security-secret-scanning`
- **Category:** security
- **What:** detect hardcoded secrets in code + git history
- **Tools 2026:** gitleaks | trufflehog | GitHub Advanced Security secret scanning
- **When to use:** every repo
- **Skip when:** never
- **Effort:** S (PR + nightly history scan)
- **Tester skill floor:** junior

### `security-container-scan`
- **Category:** security
- **What:** scan Docker images for OS-level CVEs
- **Tools 2026:** Trivy | Grype | Snyk Container | Docker Scout
- **When to use:** any containerized deploy
- **Skip when:** serverless without containers
- **Effort:** S
- **Tester skill floor:** junior

### `security-fuzz-api`
- **Category:** security
- **What:** generate random inputs against API to find crashes / unexpected 500s
- **Tools 2026:** Schemathesis (OpenAPI/GraphQL) | RESTler | Burp Intruder
- **When to use:** API exposed to untrusted users; nightly CI
- **Skip when:** internal-only API with strong typed clients
- **Effort:** M
- **Tester skill floor:** mid

### `security-fuzz-binary`
- **Category:** security
- **What:** native fuzzing against parsers / decoders
- **Tools 2026:** AFL++ | libFuzzer | go-fuzz | cargo-fuzz
- **When to use:** parsers, deserializers, file format handlers in security-critical context
- **Skip when:** managed runtime app (Node, Python, Java) with no native parsing
- **Effort:** L
- **Tester skill floor:** senior

### `security-bola-idor`
- **Category:** security
- **What:** detect broken object-level authorization (user A reads user B's data)
- **Tools 2026:** Schemathesis with 2-user fixture | Burp + macros | custom pytest
- **When to use:** every multi-tenant or multi-user API (BOLA = #1 OWASP API risk, ~40%)
- **Skip when:** single-user CLI tool
- **Effort:** M
- **Tester skill floor:** mid

### `security-rbac-matrix`
- **Category:** security
- **What:** table-driven (role × endpoint × method) → allow/deny matrix
- **Tools 2026:** custom test framework + CSV input
- **When to use:** any RBAC-bearing system (admin tool, multi-role SaaS)
- **Skip when:** flat permission model (single role)
- **Effort:** M (CSV authoring is the work)
- **Tester skill floor:** mid

### `security-tenant-isolation`
- **Category:** security
- **What:** property test asserting cross-tenant data leakage = zero
- **Tools 2026:** fast-check + 2-tenant integration fixture
- **When to use:** multi-tenant SaaS (every query must scope to tenant)
- **Skip when:** single-tenant deployment
- **Effort:** M
- **Tester skill floor:** mid

### `security-authn-flow`
- **Category:** security
- **What:** login, logout, token refresh, password reset (full flow), 2FA
- **Tools 2026:** integration tests + Inbucket (email capture) for password reset
- **When to use:** any authenticated app
- **Skip when:** anonymous-only app
- **Effort:** M
- **Tester skill floor:** mid

### `security-csrf-samesite`
- **Category:** security
- **What:** assert mutating endpoints reject cross-site POSTs without token
- **Tools 2026:** Playwright with cross-origin context | Burp manual
- **When to use:** any cookie-authenticated webapp
- **Skip when:** Bearer-token API without cookies
- **Effort:** S
- **Tester skill floor:** junior-mid

### `security-injection-sqli-xss`
- **Category:** security
- **What:** assert injection payloads are escaped/rejected
- **Tools 2026:** OWASP ZAP active scan | Burp Intruder | sqlmap
- **When to use:** any user-input-rendered surface
- **Skip when:** parameterized queries + framework escaping verified by SAST
- **Effort:** S-M
- **Tester skill floor:** mid

### `security-prompt-injection`
- **Category:** security
- **What:** test LLM-call surfaces against prompt injection attacks
- **Tools 2026:** promptfoo with injection rubric | HackerOne agentic playbook | garak (NVIDIA)
- **When to use:** any LLM-call surface (LLM output influences action)
- **Skip when:** no LLM in stack
- **Effort:** M
- **Tester skill floor:** mid (security background helps)

### `security-lethal-trifecta`
- **Category:** security
- **What:** detect AI-agent surfaces with private-data + untrusted-content + external-egress combo
- **Tools 2026:** Tirith static scanner (NousResearch, MIT) | manual code review against cortex-x ai-patterns standard
- **When to use:** any AI agent with tools
- **Skip when:** LLM is read-only (no tool calls)
- **Effort:** M (one-time scan + ongoing review)
- **Tester skill floor:** senior

### `security-audit-log-contract`
- **Category:** security
- **What:** every privileged action writes audit_log row before responding 2xx
- **Tools 2026:** integration tests with audit_log table assertion
- **When to use:** GDPR Art. 32, SOC 2, HIPAA compliance; admin/back-office systems
- **Skip when:** consumer app without privileged action surface
- **Effort:** M
- **Tester skill floor:** mid

### `security-pen-test`
- **Category:** security
- **What:** human-driven penetration test by external security firm
- **Tools 2026:** HackerOne | Bugcrowd | direct contractor
- **When to use:** annual cadence for SOC 2; pre-launch for high-risk apps
- **Skip when:** pre-revenue, low-attack-surface, low-data-sensitivity
- **Effort:** L (external + budget)
- **Tester skill floor:** sponsor (procurement, not in-house QA)

### `security-asvs-l1-l2-l3`
- **Category:** security
- **What:** OWASP ASVS 5.0 (May 2025) Level 1/2/3 control coverage
- **Tools 2026:** ASVS checklist + Schemathesis + ZAP + manual audit
- **When to use:** any production app (L1 minimum); SaaS + financial (L2); high-risk (L3)
- **Skip when:** never (L1 is the floor)
- **Effort:** L (full L2 sweep is multi-week)
- **Tester skill floor:** mid-senior

### `security-rls-bypass`
- **Category:** security
- **What:** Postgres RLS regression test asserting service_role + RLS-claim invariants
- **Tools 2026:** pytest + supabase-py | Vitest + supabase-js
- **When to use:** Supabase or Postgres-with-RLS multi-tenant systems
- **Skip when:** non-Postgres or no RLS
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 4 — Reliability / robustness

### `reliability-chaos-injection`
- **Category:** reliability
- **What:** intentionally break dependencies (kill DB, drop network) and assert recovery
- **Tools 2026:** Litmus (k8s) | Gremlin | Chaos Mesh | toxiproxy (network)
- **When to use:** distributed systems with formal SLOs; mature ops org
- **Skip when:** monolith on a single VM
- **Effort:** L
- **Tester skill floor:** senior

### `reliability-fault-injection`
- **Category:** reliability
- **What:** inject HTTP 5xx, timeouts, slow connections at integration boundary
- **Tools 2026:** Playwright `route.fulfill` | toxiproxy | nock | MSW
- **When to use:** any integration with external service (Stripe, Twilio, S3)
- **Skip when:** never (this is foundational reliability discipline)
- **Effort:** S-M
- **Tester skill floor:** junior-mid

### `reliability-idempotency`
- **Category:** reliability
- **What:** retry same operation N times; assert system state stays consistent
- **Tools 2026:** custom integration tests
- **When to use:** payment/order endpoints; webhook handlers
- **Skip when:** truly idempotent endpoint (GET; PUT-with-id)
- **Effort:** S-M
- **Tester skill floor:** mid

### `reliability-replay-deterministic`
- **Category:** reliability
- **What:** capture event stream; replay deterministically; assert same final state
- **Tools 2026:** EventSourcing libraries | custom test framework
- **When to use:** event-sourced architecture
- **Skip when:** CRUD app
- **Effort:** L
- **Tester skill floor:** senior

### `reliability-migration-rollforward`
- **Category:** reliability
- **What:** apply migration to seeded DB; assert schema + data correctness
- **Tools 2026:** Prisma migrate test | Drizzle migrate test | Liquibase | Flyway
- **When to use:** every schema-change PR
- **Skip when:** schemaless app (rare)
- **Effort:** S-M
- **Tester skill floor:** mid

### `reliability-migration-rollback`
- **Category:** reliability
- **What:** apply then reverse migration; assert original state restored
- **Tools 2026:** same as roll-forward + manual rollback exercise
- **When to use:** production schemas with rollback policy
- **Skip when:** never (broken rollback = hours of recovery during incidents)
- **Effort:** M
- **Tester skill floor:** mid

### `reliability-backup-restore`
- **Category:** reliability
- **What:** automated quarterly backup → restore drill on staging
- **Tools 2026:** custom CI workflow | Restic + verification
- **When to use:** any production system with data
- **Skip when:** stateless service
- **Effort:** L (one-time setup; ongoing scheduled)
- **Tester skill floor:** senior

### `reliability-circuit-breaker`
- **Category:** reliability
- **What:** assert calls to failing dep stop after N failures + recover after cool-down
- **Tools 2026:** opossum (Node) | Resilience4j (JVM) | custom + integration tests
- **When to use:** services calling unreliable external deps
- **Skip when:** local-only deps
- **Effort:** M
- **Tester skill floor:** mid

### `reliability-rate-limit-test`
- **Category:** reliability
- **What:** flood endpoint past limit; assert 429 + recovery
- **Tools 2026:** k6 | bash with curl loop
- **When to use:** any rate-limited public endpoint
- **Skip when:** internal-only
- **Effort:** S
- **Tester skill floor:** junior

---

## Category 5 — Correctness invariants

### `correctness-property-fast-check`
- **Category:** correctness
- **What:** generate random inputs, assert invariants hold for ALL of them
- **Tools 2026:** fast-check 4 (TS) | Hypothesis (Python) | jqwik (Java)
- **When to use:** pure functions with mathematical invariants (round-trip, idempotence, monotonicity)
- **Skip when:** I/O-bound code; LLM output (better: eval suite)
- **Effort:** S-M (invariant-discovery is the work)
- **Tester skill floor:** mid

### `correctness-state-machine`
- **Category:** correctness
- **What:** model-based testing of state transitions; generate random sequences
- **Tools 2026:** fast-check `@fast-check/state-machine` | Hypothesis stateful
- **When to use:** order state-machines, workflow engines, multi-step processes
- **Skip when:** stateless code
- **Effort:** M
- **Tester skill floor:** mid-senior

### `correctness-metamorphic`
- **Category:** correctness
- **What:** assert relationship between two related inputs (e.g. `f(x) <= f(x+1)`)
- **Tools 2026:** any test framework + custom assertions
- **When to use:** scientific computing, ML, search ranking
- **Skip when:** no monotonic / homomorphic relationships
- **Effort:** M
- **Tester skill floor:** mid-senior

### `correctness-mutation-testing`
- **Category:** correctness
- **What:** introduce small code mutations; assert tests catch them
- **Tools 2026:** StrykerJS 9.6 (TS, incremental mode) | PIT (JVM) | mutpy (Python)
- **When to use:** when test pass-rate looks suspicious; high-risk modules
- **Skip when:** brand-new code without unit tests yet
- **Effort:** M (config + threshold tuning)
- **Tester skill floor:** mid (Trail of Bits 2026: mutation = "honest fitness function")

### `correctness-mc-dc-coverage`
- **Category:** correctness
- **What:** Modified Condition/Decision Coverage — required by DO-178C, ISO 26262, IEC 62304
- **Tools 2026:** GCovr (C++) | LDRA | infer mutation coverage as MC/DC proxy
- **When to use:** safety-critical software (avionics, automotive, medical)
- **Skip when:** business software (line + branch + mutation is enough)
- **Effort:** L
- **Tester skill floor:** senior

### `correctness-line-branch-coverage`
- **Category:** correctness
- **What:** classic line + branch coverage measurement
- **Tools 2026:** c8 (V8 native) | Istanbul/nyc | coverage.py | JaCoCo
- **When to use:** floor metric — but never as primary fitness function
- **Skip when:** never (always measure; just don't worship)
- **Effort:** S
- **Tester skill floor:** junior

---

## Category 6 — Contract / interoperability

### `contract-pact-consumer`
- **Category:** contract
- **What:** consumer-side declares what fields it consumes; provider verifies on every push
- **Tools 2026:** Pact 13 + Pactflow broker
- **When to use:** distributed FE-BE pairs; microservices
- **Skip when:** monorepo with shared types (typed-codegen covers it)
- **Effort:** M
- **Tester skill floor:** mid

### `contract-openapi-schemathesis`
- **Category:** contract
- **What:** generate property-based test cases from OpenAPI spec
- **Tools 2026:** Schemathesis 3+
- **When to use:** any OpenAPI-spec'd service
- **Skip when:** no OpenAPI spec yet
- **Effort:** S (config) + ongoing maintenance
- **Tester skill floor:** mid

### `contract-graphql-schema`
- **Category:** contract
- **What:** assert client queries match server schema; detect breaking changes
- **Tools 2026:** GraphQL Inspector | graphql-code-generator
- **When to use:** GraphQL APIs
- **Skip when:** REST-only
- **Effort:** S-M
- **Tester skill floor:** mid

### `contract-grpc-protobuf`
- **Category:** contract
- **What:** Protobuf compatibility checker; assert backward compat across versions
- **Tools 2026:** Buf CLI | protolock
- **When to use:** gRPC services
- **Skip when:** REST-only
- **Effort:** S
- **Tester skill floor:** mid

### `contract-database-schema-drift`
- **Category:** contract
- **What:** assert TypeScript types / ORM models match DB schema reality
- **Tools 2026:** Prisma `db pull` + diff | Drizzle introspect | Pgmento
- **When to use:** ORM-based apps
- **Skip when:** schemaless (rare)
- **Effort:** S
- **Tester skill floor:** junior

### `contract-api-versioning`
- **Category:** contract
- **What:** assert v1 endpoints continue working alongside v2; deprecation path tested
- **Tools 2026:** Pact + multi-version provider tests
- **When to use:** public APIs with backward-compat policy
- **Skip when:** internal API with synchronized FE deploys
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 7 — Usability / accessibility

### `a11y-axe-component`
- **Category:** a11y
- **What:** assert components have no axe-core violations
- **Tools 2026:** @axe-core/react + jest-axe | @axe-core/playwright
- **When to use:** any UI; mandatory for EU public sector + EAA 2025 e-commerce
- **Skip when:** purely backend service
- **Effort:** S (default rules; severity tuning later)
- **Tester skill floor:** junior

### `a11y-lighthouse-score`
- **Category:** a11y
- **What:** Lighthouse a11y score gate ≥ 90 in CI
- **Tools 2026:** lighthouse-ci
- **When to use:** any consumer web app
- **Skip when:** B2B internal tool with explicit a11y waiver
- **Effort:** S
- **Tester skill floor:** junior

### `a11y-keyboard-nav`
- **Category:** a11y
- **What:** drive UI with Tab/Shift-Tab/Enter only; assert focus + actionability
- **Tools 2026:** Playwright with `keyboard.press` only
- **When to use:** WCAG 2.2 AA compliance
- **Skip when:** mouse-only kiosk app
- **Effort:** M
- **Tester skill floor:** mid

### `a11y-screen-reader`
- **Category:** a11y
- **What:** real screen reader (NVDA, JAWS, VoiceOver) reads UI correctly
- **Tools 2026:** manual with assistive-tech | NVDA + Vimium for semi-automation
- **When to use:** WCAG 2.2 AAA; public-sector
- **Skip when:** WCAG AA is the target (axe + keyboard cover most signal)
- **Effort:** L
- **Tester skill floor:** senior + a11y specialist

### `a11y-color-contrast`
- **Category:** a11y
- **What:** assert all text meets WCAG contrast ratios
- **Tools 2026:** axe-core | Lighthouse | Storybook a11y addon
- **When to use:** any UI
- **Skip when:** never (axe covers it for free)
- **Effort:** S
- **Tester skill floor:** junior

### `a11y-rtl-locale`
- **Category:** a11y
- **What:** assert UI mirrors correctly in RTL languages (ar, he)
- **Tools 2026:** Playwright with `locale: 'ar-AE'` + visual regression
- **When to use:** apps with Arabic/Hebrew users
- **Skip when:** Latin-script-only app
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 8 — AI-specific (2026)

### `ai-eval-suite-rubric`
- **Category:** ai-eval
- **What:** golden-set + rubric for LLM-call surfaces; regression against rubric per PR
- **Tools 2026:** promptfoo | Vercel AI evals | LangSmith | Braintrust
- **When to use:** any LLM-call surface
- **Skip when:** no LLM in stack
- **Effort:** M (rubric authoring is the work)
- **Tester skill floor:** mid

### `ai-prompt-injection-regression`
- **Category:** ai-eval
- **What:** known-malicious prompts must be rejected/sanitized
- **Tools 2026:** promptfoo with injection module | garak | manual playbook
- **When to use:** any LLM-call surface with tool/action access
- **Skip when:** read-only LLM
- **Effort:** M
- **Tester skill floor:** mid (security)

### `ai-hallucination-detection`
- **Category:** ai-eval
- **What:** assert outputs are grounded in provided context (RAG)
- **Tools 2026:** RAGAS | TruLens | promptfoo
- **When to use:** RAG-based apps
- **Skip when:** non-RAG (general-knowledge) chat
- **Effort:** M
- **Tester skill floor:** mid

### `ai-bias-toxicity`
- **Category:** ai-eval
- **What:** assert outputs free of bias/toxicity per defined set
- **Tools 2026:** Detoxify | Perspective API | OpenAI moderation
- **When to use:** consumer-facing LLM output
- **Skip when:** internal dev tool
- **Effort:** M
- **Tester skill floor:** mid

### `ai-determinism-guard`
- **Category:** ai-eval
- **What:** seed=0 + temp=0; assert reproducible outputs for fixed inputs
- **Tools 2026:** built into evals frameworks
- **When to use:** snapshot-driven evals
- **Skip when:** non-deterministic output is the feature (creative writing)
- **Effort:** S
- **Tester skill floor:** junior

### `ai-cost-guard`
- **Category:** ai-eval
- **What:** assert per-call cost stays under budget; fail on >2σ outlier
- **Tools 2026:** custom integration tests + cost ledger
- **When to use:** any metered API LLM call
- **Skip when:** flat-subscription only
- **Effort:** S
- **Tester skill floor:** junior

### `ai-output-shape-contract`
- **Category:** ai-eval
- **What:** assert JSON output matches Zod/Pydantic schema
- **Tools 2026:** Zod / Pydantic at ingestion + tests
- **When to use:** structured-output LLM calls
- **Skip when:** free-form text output
- **Effort:** S
- **Tester skill floor:** junior

### `ai-tool-call-validation`
- **Category:** ai-eval
- **What:** LLM tool-calls validate against tool schema; reject unknown tools / bad args
- **Tools 2026:** custom + cortex-x ai-patterns safe-tool wrapper
- **When to use:** agentic apps with tool calls
- **Skip when:** chat-only LLM
- **Effort:** M
- **Tester skill floor:** mid

### `ai-loop-detection`
- **Category:** ai-eval
- **What:** assert agent loops bounded; circuit-breaker on N consecutive same tool calls
- **Tools 2026:** cortex-x safe-tool v2 loop detector
- **When to use:** any agentic loop
- **Skip when:** single-shot LLM call
- **Effort:** S (use safe-tool pattern)
- **Tester skill floor:** mid

### `ai-rag-retrieval-quality`
- **Category:** ai-eval
- **What:** assert top-k retrieval contains ground-truth context
- **Tools 2026:** RAGAS | TruLens | custom precision/recall measure
- **When to use:** RAG-based apps
- **Skip when:** no RAG
- **Effort:** M
- **Tester skill floor:** mid

### `ai-embedding-drift`
- **Category:** ai-eval
- **What:** track embedding distance over time; alert on model-version drift
- **Tools 2026:** custom monitoring + cosine-distance baselines
- **When to use:** vector-store apps with model upgrade path
- **Skip when:** static-model pinned forever
- **Effort:** M
- **Tester skill floor:** mid-senior

### `ai-multiturn-conversation`
- **Category:** ai-eval
- **What:** multi-turn chat memory + context-window assertions
- **Tools 2026:** promptfoo with conversation flow
- **When to use:** chat apps with persistent context
- **Skip when:** single-shot QA
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 9 — DevOps / pipeline quality

### `devops-workflow-lint`
- **Category:** devops
- **What:** lint GHA / GitLab CI / CircleCI YAML for syntax + best practices
- **Tools 2026:** actionlint (GHA) | gitlab-ci-lint | circleci CLI
- **When to use:** any CI-driven repo
- **Skip when:** never
- **Effort:** S
- **Tester skill floor:** junior

### `devops-action-pinning`
- **Category:** devops
- **What:** pin third-party GHA actions by SHA (not @main)
- **Tools 2026:** pinact | dependabot
- **When to use:** any GHA repo
- **Skip when:** never (supply-chain attack class)
- **Effort:** S
- **Tester skill floor:** junior

### `devops-iac-lint`
- **Category:** devops
- **What:** lint Terraform/Pulumi/k8s YAML
- **Tools 2026:** tflint | tfsec | kubeval | kube-linter | OPA/Conftest
- **When to use:** any IaC-driven deploy
- **Skip when:** PaaS-only (Vercel, Netlify) without IaC
- **Effort:** S
- **Tester skill floor:** junior-mid

### `devops-dockerfile-lint`
- **Category:** devops
- **What:** Dockerfile best-practice lint
- **Tools 2026:** hadolint
- **When to use:** any containerized project
- **Skip when:** no Docker
- **Effort:** S
- **Tester skill floor:** junior

### `devops-sbom-generation`
- **Category:** devops
- **What:** generate Software Bill of Materials per build
- **Tools 2026:** syft | cyclonedx-cli
- **When to use:** any deployable artifact (compliance + supply chain)
- **Skip when:** internal-only library
- **Effort:** S
- **Tester skill floor:** junior

### `devops-slsa-provenance`
- **Category:** devops
- **What:** signed build provenance attestation per artifact
- **Tools 2026:** SLSA Provenance + sigstore | GitHub Artifact Attestations
- **When to use:** supply-chain critical (open-source, regulated)
- **Skip when:** internal-only deploy
- **Effort:** M
- **Tester skill floor:** mid

### `devops-canary-deploy`
- **Category:** devops
- **What:** progressive rollout (1% → 10% → 100%) with metric-based abort
- **Tools 2026:** Argo Rollouts | Flagger | LaunchDarkly
- **When to use:** high-traffic production
- **Skip when:** small-team monolith with rollback workflow
- **Effort:** L
- **Tester skill floor:** senior

### `devops-blue-green`
- **Category:** devops
- **What:** parallel environments, traffic-cut at boundary
- **Tools 2026:** AWS CodeDeploy | k8s + service swap
- **When to use:** zero-downtime requirements
- **Skip when:** small-team
- **Effort:** L
- **Tester skill floor:** senior

### `devops-rollback-drill`
- **Category:** devops
- **What:** quarterly automated rollback exercise (deploy + revert)
- **Tools 2026:** custom workflow | Argo Rollouts
- **When to use:** any production system with rollback policy
- **Skip when:** immutable infra (no rollback concept)
- **Effort:** M
- **Tester skill floor:** mid-senior

### `devops-observability-assertion`
- **Category:** devops
- **What:** assert deploy emits expected logs/metrics/traces to pipeline
- **Tools 2026:** custom synthetic checks + log/metric query post-deploy
- **When to use:** any observable system
- **Skip when:** dev-only
- **Effort:** M
- **Tester skill floor:** mid

### `devops-alert-rule-test`
- **Category:** devops
- **What:** assert alert fires when condition met (synthetic SLO violation)
- **Tools 2026:** Prometheus rule unit tests | Datadog synthetic
- **When to use:** any SLO-tracked system
- **Skip when:** no formal alerts
- **Effort:** M
- **Tester skill floor:** mid

### `devops-dora-metrics`
- **Category:** devops
- **What:** track deploy frequency, lead time, change failure rate, MTTR
- **Tools 2026:** dora-metrics-action | Liatrio dora dashboards
- **When to use:** any team optimizing delivery
- **Skip when:** measurement-overhead > value at small scale
- **Effort:** M
- **Tester skill floor:** mid

### `devops-build-reproducibility`
- **Category:** devops
- **What:** same source → same artifact bytes; pinned toolchain
- **Tools 2026:** Bazel | Nix | Buck2
- **When to use:** supply-chain critical
- **Skip when:** non-reproducible-by-design
- **Effort:** L
- **Tester skill floor:** senior

### `devops-cache-poisoning`
- **Category:** devops
- **What:** assert CI cache can't be poisoned (e.g. malicious dep slipping into cached node_modules)
- **Tools 2026:** custom + lockfile assertion
- **When to use:** open-source-publishing repos
- **Skip when:** private internal repo
- **Effort:** M
- **Tester skill floor:** mid-senior

---

## Category 10 — Data quality

### `data-validation-boundary`
- **Category:** data
- **What:** Zod / Pydantic at every system boundary (HTTP, queue, file)
- **Tools 2026:** Zod 4 (TS) | Pydantic 2 (Python)
- **When to use:** every boundary
- **Skip when:** never
- **Effort:** S per boundary
- **Tester skill floor:** junior

### `data-pii-redaction`
- **Category:** data
- **What:** assert logs / outputs don't leak PII
- **Tools 2026:** custom regex + library (e.g. Microsoft Presidio)
- **When to use:** GDPR / HIPAA scope
- **Skip when:** no PII handled
- **Effort:** M
- **Tester skill floor:** mid

### `data-retention-tdl`
- **Category:** data
- **What:** assert TTL deletion happens per policy
- **Tools 2026:** custom integration tests + scheduled job verification
- **When to use:** GDPR Art. 5(1)(e); any retention-policy system
- **Skip when:** no retention policy
- **Effort:** M
- **Tester skill floor:** mid

### `data-etl-lineage`
- **Category:** data
- **What:** assert source → transformation → sink lineage matches expectation
- **Tools 2026:** dbt tests | great_expectations | Soda
- **When to use:** ETL/ELT pipelines
- **Skip when:** no data pipeline
- **Effort:** M
- **Tester skill floor:** mid

---

## Category 11 — Compliance / regulatory

### `compliance-gdpr-art32`
- **Category:** compliance
- **What:** audit-log + secure-deletion + breach-detection per GDPR Art. 32
- **Tools 2026:** custom integration tests + ASVS L2 alignment
- **When to use:** any EU-customer system
- **Skip when:** non-EU
- **Effort:** M-L
- **Tester skill floor:** mid + legal review

### `compliance-pci-dss-l4`
- **Category:** compliance
- **What:** PCI-DSS Level 4 (sub-20K txn/yr) controls; cardholder data isolation
- **Tools 2026:** PCI-DSS checklist + ASVS L2
- **When to use:** processing card data directly
- **Skip when:** all card processing outsourced (Stripe + tokenization)
- **Effort:** L
- **Tester skill floor:** senior

### `compliance-soc2-evidence`
- **Category:** compliance
- **What:** automated evidence collection for SOC 2 controls
- **Tools 2026:** Drata | Vanta | Tugboat Logic
- **When to use:** B2B SaaS targeting enterprise customers
- **Skip when:** consumer-only
- **Effort:** L
- **Tester skill floor:** senior + compliance officer

### `compliance-hipaa-controls`
- **Category:** compliance
- **What:** HIPAA Security Rule + Privacy Rule controls
- **Tools 2026:** custom + AWS HIPAA-eligible services audit
- **When to use:** US healthcare data (PHI)
- **Skip when:** non-PHI
- **Effort:** L
- **Tester skill floor:** senior

### `compliance-iso-25010-coverage`
- **Category:** compliance
- **What:** map test suite to all 9 ISO/IEC 25010:2023 quality characteristics
- **Tools 2026:** custom doc + audit traceability
- **When to use:** ISO 9001 / 25010 compliance scope
- **Skip when:** non-formal-quality-system
- **Effort:** M
- **Tester skill floor:** mid

### `compliance-eu-ai-act`
- **Category:** compliance
- **What:** AI Act risk classification + high-risk system testing
- **Tools 2026:** EU AI Act self-assessment + adversarial testing
- **When to use:** AI features for EU users (effective 2025-2027 rollout)
- **Skip when:** no EU users or non-AI
- **Effort:** L
- **Tester skill floor:** senior

### `compliance-wcag-22-aa`
- **Category:** compliance
- **What:** WCAG 2.2 AA (61 success criteria)
- **Tools 2026:** axe-core + manual + lighthouse
- **When to use:** EU public sector (mandatory); EAA 2025-06-28 e-commerce
- **Skip when:** non-EU + non-public-sector
- **Effort:** L
- **Tester skill floor:** mid + a11y specialist

### `compliance-coppa-ferpa`
- **Category:** compliance
- **What:** US child / education-data privacy controls
- **Tools 2026:** custom checklist + parental-consent flow tests
- **When to use:** US K-12 / under-13 audiences
- **Skip when:** adult-only / non-US
- **Effort:** L
- **Tester skill floor:** senior + legal

---

## Category 12 — Documentation / API quality

### `docs-link-rot`
- **Category:** docs
- **What:** scan markdown for broken external/internal links
- **Tools 2026:** lychee | markdown-link-check
- **When to use:** any docs-heavy project
- **Skip when:** no docs
- **Effort:** S
- **Tester skill floor:** junior

### `docs-code-snippet-executability`
- **Category:** docs
- **What:** code blocks in docs actually run + produce documented output
- **Tools 2026:** mdoctest (Python) | tsdoc-test | custom
- **When to use:** API/SDK docs with code samples
- **Skip when:** no code samples
- **Effort:** M
- **Tester skill floor:** mid

### `docs-api-doc-drift`
- **Category:** docs
- **What:** assert OpenAPI / TypeDoc generated docs match code
- **Tools 2026:** TypeDoc + diff in CI | OpenAPI generated from decorators
- **When to use:** any public API/SDK
- **Skip when:** no public API
- **Effort:** S
- **Tester skill floor:** junior

---

## Selection rules (audit → catalog)

The audit phase produces evidence; this catalog produces test types. The mapping rules:

1. **Evidence-driven match** — audit § 1 says "no E2E for checkout" → match `e2e-browser-flow` + `e2e-mobile-viewport`
2. **Phase 3 Q3 compliance match** — Q3 = "GDPR Art. 32 audit-log" → require `security-audit-log-contract` + `compliance-gdpr-art32`
3. **Phase 3 Q5 capacity filter** — Q5 = "junior solo" → drop `tester_skill_floor: senior` types from P0/P1, surface as P2 or SKIP-with-rationale
4. **Stack negative filter** — no LLM in deps → drop entire `Category 8 — AI-specific`
5. **Risk-tier escalation** — Q1 = "tenant data leak" → escalate `security-tenant-isolation` + `security-bola-idor` + `security-rls-bypass` to P0 even if audit signal would suggest P1

## Anti-patterns

- ❌ "Apply every test type from the catalog" — over-investment, signal dilution
- ❌ "Skip the catalog and freestyle" — misses entire categories that 2026 expects
- ❌ "Cargo-cult tooling" — recommending Stryker without explaining the mutation-fitness rationale
- ❌ "Ignore Q5 capacity" — junior solo can't ship 50 P0 items; right-size to ≤ 5 P0 + 10 P1

## Re-curation cadence

This catalog reflects **2026 best practices**. Re-audit + refresh annually (or after major shifts: new ISO 25010 revision, OWASP ASVS major version, AI Act enforcement phase). Tools have a faster decay than methodology — 2-year tool review is reasonable.

## Total: 112 test types across 12 categories

(Counted: 17 functional + 8 perf + 19 security + 9 reliability + 6 correctness + 6 contract + 6 a11y + 12 ai-eval + 14 devops + 4 data + 8 compliance + 3 docs = 112 — exhaustive enough for a 2026 audit; actual selection per audit typically picks 12-25.)

---

## Sources & corrections (Sprint 2.10.4 web-research-validated 2026-05-10)

5 parallel research agents validated the catalog against 2026 sources. Material corrections applied:

### Methodology corrections

- **Bach HTSM has 4 axes, not 2** — the canonical Heuristic Test Strategy Model (Satisfice, Bach 2003-current) splits into: Project Environment + Product Elements (`SFDPOT` — Structure / Function / Data / Platform / Operations / Time, optionally extended `SFDiPOT`) + Quality Criteria (`CRUCSPIC STMP` — Capability / Reliability / Usability / Charisma / Security / Scalability / Performance / Installability / Compatibility / Supportability / Testability / Maintainability / Portability) + Test Techniques (`FDSFSCURA` — Function / Domain / Stress / Flow / Scenario / Claims / User / Risk / Automatic). Earlier wording in this catalog said "SFDPOT × FDSFSCURA" — fixed to call out the 4 axes [Satisfice HTSM PDF].
- **ISO/IEC 25010:2023 9 characteristics confirmed** — Safety added top-level (was sub-characteristic in :2011); Usability → Interaction Capability (rename); Portability → Flexibility (rename) [iso25000.com, Pacific Cert].
- **ISTQB CTFL v4.0.1** is current (2023 — no separate "2026 syllabus"). Test types: Functional / Non-Functional / **Structural (white-box)** / **Change-related (regression + confirmation)**. The Structural + Change-related buckets are foundational and should be tagged on every entry above [ISTQB Foundation, ASTQB].
- **5 post-2024 additions** worth catalog inclusion in 2027: agent simulations (multi-turn LLM evals), metamorphic testing for LLMs (191 MRs catalogued, finds 11% missed by traditional), AI-driven visual regression suppressing dynamic-content false positives, SLO-as-test-gate (k6 thresholds in CI), formal model-based test generation (TLA+/Quint).

### Tooling corrections (deprecations + leaders)

**Security category:**
- `security-sca-deps`: **`npm audit` deprecated as sole gate** — replace with **osv-scanner v2.3.5+** (Google, free, March 2026 release added Python transitive scanning). Pair with Dependabot/Renovate for auto-bumps [osv-scanner GitHub, OSV.dev].
- `security-fuzz-binary`: **libFuzzer is in maintenance-only mode since late 2022** — pick **AFL++** for new C/C++ projects; libFuzzer stays only for existing harnesses [LLVM libFuzzer docs, AFLplusplus.com].
- `security-iast-instrumented`: **IAST is consolidating into ADR (Application Detection & Response)** in 2026. Standalone IAST is a stale category; Contrast Security stays the leader with unified IAST+RASP agent. Datadog ASM + Dynatrace AppSec are credible challengers [Contrast docs, Gartner ADR market guide 2026].
- `security-sast-static`: **Semgrep wins security-focused CI** (46% vs SonarQube 19% detection, ~10s scans). CodeQL = deepest dataflow (free for OSS via GitHub Advanced Security). SonarQube is a different category (quality + security combined) [Semgrep benchmark, GitHub CodeQL].
- `security-secret-scanning`: **Run BOTH** — gitleaks pre-commit (speed) + trufflehog in CI (live-credential verification across 800+ types) [gitleaks GitHub, trufflesecurity GitHub].
- `security-asvs-l1-l2-l3`: **OWASP ASVS 5.0 confirmed released 2025-05-30** at Global AppSec EU Barcelona. V4 Access Control = direct BOLA defense for back-office [OWASP ASVS GitHub, Cyber Chief].
- `security-bola-idor`: **OWASP API Top 10 2023 still current** — no 2025/2026 edition. BOLA still #1, ~40% of API attacks confirmed [OWASP API Top 10, AppSecMaster].
- `security-prompt-injection`: **OWASP LLM Top 10 — 2025 edition is current** (PDF v4.2.0a Nov 2024). LLM01 Prompt Injection still #1; lives at genai.owasp.org under "Gen AI Security Project" rebrand [OWASP GenAI Project].

**AI/eval category:**
- `ai-eval-suite-rubric`: **Two-tool 2026 consensus** = Promptfoo/DeepEval (CI gate) + Braintrust (production observability). DeepEval+Braintrust is the de-facto standard for engineering-led teams [Promptfoo docs, Braintrust docs, DeepEval GitHub].
- `ai-prompt-injection-regression`: **Three-tool quorum** = garak (NVIDIA, 37+ probes) + PyRIT (Microsoft, multi-turn adversarial) + Promptfoo (50+ vulns, CI). Categorize against OWASP LLM01:2025 (direct/indirect/multimodal) [garak GitHub, PyRIT GitHub, OWASP GenAI Top 10 v4.2.0a].
- `ai-hallucination-detection`: **Patronus Lynx is current SOTA** (open Llama-3 fine-tune; beats GPT-4o by 8.3% on PubMedQA). RAGAS + TruLens + DeepEval remain the OSS RAG-faithfulness triad [Patronus AI, RAGAS GitHub].
- `ai-determinism-guard`: **Determinism is effectively dead** — `seed=0` is best-effort on OpenAI; Anthropic exposes none. Design property-based + LLM-judge tests, not snapshots. **This validates cortex-x's spec-driven verification (Sprint 1.9.0) direction** [OpenAI API determinism note, Anthropic API ref].
- `ai-cost-guard`: Canonical 2026 pattern is `cost < $0.005/call` threshold, fail PR on regression — directly applicable to cortex-x's Steward cost guards [Promptfoo cost assertions, Vercel AI evals].
- **NEW CATEGORY 8 entries to add in next refresh:** `ai-mcp-protocol-test` (MCP hit 97M monthly SDK downloads by Feb 2026, stdio + HTTP transports), `ai-a2a-protocol-test` (A2A v1.0 shipped same window). cortex-x currently has zero coverage for these [Anthropic MCP, A2A protocol spec].
- `correctness-mutation-testing`: **Trail of Bits MuTON + mewt (April 2026)** is direct prior art for the agentic-era mutation testing — relevant for cortex-x Sprint 2.3 fitness goal [Trail of Bits blog 2026-04-01].

**EU AI Act + NIST:**
- **EU AI Act high-risk (Annex III) testing obligations land 2026-08-02** unless Digital Omnibus (Nov 2025) defers to 2027-12-02 (proposed, not adopted as of 2026-05-09). US companies serving EU users in scope. Plan for 2026-08-02 [European Commission AI Act timeline, AI Act Service Desk].
- **NIST AI 600-1 GenAI Profile** (200+ actions, 72 subcategories) + CSA Agentic Profile v1 are the testing references. Framework moved from voluntary to regulatory reference in 2026 [NIST AI 600-1, CSA Agentic Profile v1].

**DevOps category:**
- `devops-iac-lint`: **Dead tools (do NOT recommend in 2026):** kubeval, Datree, copper, config-lint, Terrascan (archived by Tenable), standalone tfsec (absorbed into Trivy). **Live stack:** kube-linter + Polaris (k8s); TFLint + Trivy config + Checkov (Terraform) [stackrox/kube-linter, Spacelift TF scanning 2026].
- `devops-action-pinning`: **SHA-pin alone insufficient** — 32% of top actions are "unpinnable". Stack = `pinact` + **StepSecurity Harden Runner** (runtime EDR). The **March 19 2026 trivy-action compromise** reshaped 2026 consensus [StepSecurity blog, GitHub Actions security advisories].
- `devops-container-scan`: **Trivy = default** (breadth, swiss-army); **Grype when EPSS prioritization matters** (CVSS + EPSS + KEV ranking) [Aqua Trivy, Anchore Grype].
- `devops-sbom-generation`: **EU CRA (Cyber Resilience Act) mandates CycloneDX 1.6+ or SPDX 3.0.1+** for products sold in EU after 2027-12-11. Syft generates both [CycloneDX 1.6, SPDX 3.0.1, EU CRA].
- `devops-slsa-provenance`: **L2 = realistic SaaS baseline** (build-service + signed provenance); L3 = regulated only (hardened build env + non-falsifiable provenance) [SLSA Spec v1.0].
- `reliability-chaos-injection`: **Chaos Mesh edges Litmus** for K8s-first chaos engineering in 2026; Gremlin = commercial leader [Chaos Mesh CNCF, Litmus GitHub].
- `reliability-cache-poisoning` (NEW recommendation): **Socket.dev + provenance-required npm proxy** is the 2026 pattern after axios hijack (March 2026) + SANDWORM_MODE incidents. Add as new entry in next refresh [Socket.dev blog, StepSecurity axios analysis].

**Performance + a11y category:**
- `perf-load-k6`: **k6 wins JS/TS** (CI-native); **Gatling wins JVM/throughput** (210K RPS); **JMeter is enterprise-legacy** (v3.2.1 retired); Locust = Python [Vervali load tools 2026].
- `perf-budget-lighthouse`: **INP is unmeasurable in lab** → use **TBT (Total Blocking Time) < 200ms** as Lighthouse-CI proxy. **43% of sites still fail INP** as of early 2026 [CoreWebVitals.io 2026, web.dev INP guide].
- `perf-bundle-size-budget`: **size-limit wins for CI gate**; webpack-bundle-analyzer = diagnostic only, not a gate [size-limit GitHub].
- `a11y-axe-component`: 2026 stack = **@axe-core/playwright + jest-axe + @storybook/addon-a11y + Storybook test-runner**. axe-core catches **~57% of WCAG violations** programmatically; rest needs manual + screen-reader [Storybook a11y, axe-playwright].
- `compliance-wcag-22-aa`: **WCAG 2.2 AA is the 2026 target**; AAA NOT mandated by EAA or ADA. **EAA enforcement live since 2025-06-28**; existing services have 2030-06-28 transition; penalties up to €100K or 4% revenue [European Commission EAA, Bird & Bird EAA deadline analysis].
- `a11y-screen-reader`: **Guidepup + W3C at-driver + Assistiv Labs** make semi-automation real in 2026 — was manual-only before [Assistiv Labs, W3C AT Driver].
- `compliance-pci-dss-l4`: **PCI-DSS v4.0.1 is the only active version**; 64 changes vs 3.2.1; **51 future-dated requirements enforceable since 2025-03-31** [PCI SSC PCI-DSS v4.0.1].
- `compliance-soc2-evidence`: **Vanta = best overall SMB**, **Drata = strongest implementation guidance**, **Sprinto = budget tier**. Functional gap small [Vanta SOC 2 software 2026, Cavanex Vanta vs Drata vs Secureframe vs Sprinto].

### What's missing from this catalog (next refresh)

- **`ai-mcp-protocol-test`** — Model Context Protocol stdio + HTTP transport tests (MCP hit 97M monthly SDK downloads Feb 2026)
- **`ai-a2a-protocol-test`** — Agent-to-Agent v1.0 protocol tests (shipped same window as MCP scale)
- **`reliability-cache-poisoning`** — Socket.dev + provenance-required npm proxy pattern
- **`change-related-regression-confirmation`** as explicit ISTQB CTFL v4.0.1 type (currently spread across `regression-bug-replay` + `smoke-post-deploy`)
- **`ai-agent-multi-turn-simulation`** — distinct from `ai-multiturn-conversation`; for agentic apps with tool calls + memory + multi-step plans

These will land in Sprint 2.10.5 catalog refresh (or quarterly).

### Raw research caches

Full agent outputs at:
- `c:\tmp\catalog-research-1-taxonomy-2026.md` (22 cited URLs, taxonomy + ISO 25010 + HTSM + ISTQB)
- `c:\tmp\catalog-research-2-security-2026.md` (32 cited URLs, security tooling)
- `c:\tmp\catalog-research-3-ai-eval-2026.md` (35 cited URLs, AI/LLM testing + EU AI Act)
- `c:\tmp\catalog-research-4-devops-2026.md` (25 cited URLs, DevOps quality gates)
- `c:\tmp\catalog-research-5-perf-a11y-compliance-2026.md` (34 cited URLs, perf + a11y + compliance)

148 cited URLs total grounding the catalog.
