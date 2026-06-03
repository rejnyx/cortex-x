---
title: Cortex-x — operator recap 2026-06-03
purpose: 1-page kontext snapshot kdy operator ztrácí přehled. Číst za 5 min, rozhodovat za další 5.
generated: 2026-06-03 hand-curated (Sprint 2.47+ bude `/cortex-overview` auto-generovat)
expires: review za 7 dní (2026-06-10) nebo po dalších 2 sprintech
---

# Cortex-x — kde jsi a co tě čeká (recap k 2026-06-03)

> **Čti tohle když:** ztrácíš kontext po multi-sprint dni · vracíš se po pauze · připravuješ se na strategic rozhodnutí. Zdroje: `atlas-2026-06-01.md`, `capability-tree-2026-06-01.md`, 3× `sprint-2-XX-r2-summary.md`, `docs/steward-roadmap.md`, `git log --since=2026-05-30`.

## 1. TL;DR — co je cortex-x dnes (1 odstavec)

Personal Claude Code framework + persistent agent ecosystem. **15 skills · 9 review agents · 21 CLIs · 35 standards · 23 workflows · 11 profiles** spuštěných nad **3326 testy** (0 fail · 2 skip · CI 4/4 zelená). Tier 0 (Foundation) + Tier 1 (Verification + multi-agent) ✅ shippnuté. Tier 2 (Compound learners) z většiny ✅. Tier 3 (Productization) ⏳ rozpracované. Aktuální **5-průměrný North Star**: ~95% verification fidelity · 5 PRs/5 review-min Steward throughput · měřitelná self-evolution. Pozice: "developer OS pro AI era" + autonomní nightly Steward + signed-verdict commit gate (Sprint 2.46 dnes).

## 2. Co cortex umí dnes — one-screen view

| Vrstva | Capability | Status |
|---|---|---|
| **Bootstrap** | `/cortex-init` 3-otázek scaffold nového projektu, 11 profiles, auto-detector | ✅ |
| **Slash skills** (15) | cortex-init / cortex-help / cortex-doctor / cortex-update / cortex-goal / **cortex-sprint** / cortex-uninstall / start / audit / designer / improve-codebase-architecture / ralph-loop / test-audit / ux-copywriter / external-adapter-hyperframes | ✅ shipped |
| **CLIs** (21) | cortex-bootstrap · cortex-capabilities · cortex-claude-md-augment · cortex-doc-audit · **cortex-doc-regen** · cortex-doctor · cortex-dream · cortex-evolve-ab · cortex-export-lessons · cortex-gap-report · cortex-hooks-register · cortex-insights · cortex-lessons-search · cortex-permissions-register · cortex-propose-skill · cortex-skill-validate · cortex-steward · cortex-update · cortex-usage · cortex-wiki + cortex-wiki-consolidate | ✅ |
| **Steward runtime** | 18-kind action palette · 6 criterion kinds (incl. read_set) · OpenRouter engine + claude-cli engine · 15 active cron workflows · multi-window USD caps · loop detector · spec-driven verification | ✅ v1 |
| **R2 review pipeline** | 6 agents paralelně (security / correctness / acceptance / ssot / blind / edge-case) + Pass-2 skeptic + dedupe + **signed r2-verdict.json** (Sprint 2.46 nový) | ✅ s replay-defense backlog |
| **Workflows** (23) | dynamic Claude Code Workflow tool integration · `shared/workflows/r2-review.js` + `audit.js` + Sprint 2.46+ | ✅ Sprint 2.44 |
| **Memory & wisdom** | lessons.jsonl + FTS5 index + Karpathy wiki + AlphaEvolve + 40+ memories index | ✅ Tier 2 |
| **Observability** | Phoenix OTLP self-hosted + zero-dep protobuf encoder + cost ledger + status CLI | ✅ Sprint 2.0 |
| **Verification** | spec-verifier 6 criterion kinds + mutation testing baseline (Stryker measure-only) + 3326 tests | ✅ |
| **Living docs** | atlas + capability-tree + state-snapshot blocks auto-refresh via cortex-doc-regen | ✅ Sprint 2.45 |

## 3. Co shipnulo posledních 72h (Sprint 2.44 → 2.46)

Třídenní intenzivní arc — tři sprinty postupně stavěly verdict-gate pipeline:

| Sprint | Commit | Co | Tests delta | R2 |
|---|---|---|---|---|
| **2.44** (2026-06-02) | `04280b6` | Dynamic workflows integration — `shared/workflows/r2-review.js` + `audit.js` + standards/workflows.md + hook-bypass empirický probe (workflow runtime nepropaguje na PostToolUse) | +400 | 28 validated, 14 applied, 14 deferred → 2.44.1 |
| **2.45** (2026-06-02) | `15aa4ea` | `/cortex-sprint` skill (7-step pipeline wrapper) + `cortex-doc-regen` CLI living-docs (state-snapshot auto-refresh) + standards/documentation.md + state-block convention | +35 | 19 validated, 11 applied, 8 deferred → 2.45.1 |
| **2.46** (2026-06-03 dnes) | `5df034a` | Signed `r2-verdict.json` (HMAC-SHA256, zero-dep) + `pre-commit-review-gate` extension + standards/sprint-pipeline.md SSOT + untrusted fencing in skill + FIRST commit shipped via verdict-path (not `[skip-review]`) | +36 | 27 validated, 14 applied, 6 deferred → 2.46.1 |

**Meta-recursive moment Sprint 2.46:** R2 pipeline našel HIGH bugs v souborech ten samý sprint shipoval — fictional gate-behavior table v `standards/sprint-pipeline.md`, over-promised commitSha binding v SKILL.md, path drift v 6 reviewers najednou. Sprint si **sám zkontroloval vlastní deliverables a fixnul je před commitem**. Důkaz že R2 review není ceremoniální — je load-bearing.

Před tím (2026-05-28+): Sprint 2.36 (Opus 4.8 routing) · 2.38 (cortex-usage telemetry) · 2.40 (visual-taste vendor) · CI hardening (cost-safety + stryker) · 2.27 (verification discipline) · 2.30 (Claude Code mode hints).

## 4. Open backlog — **26 deferred items rozdělených**

### 4a. ČEKÁ NA ADR / TVOJE ROZHODNUTÍ (9 items) — žádný agent to nevyřeší sám

| # | Origin | Item | Decision required |
|---|---|---|---|
| D-1 | 2.44.1 | Lethal trifecta reader-writer split v `audit.js` | Architektura — split `audit.js` na reader-agent + writer-agent per `standards/security.md` Pattern 2 |
| D-2 | 2.44.1 | AUDIT_DIMENSIONS SSOT extrakce | 3 různé partitions napříč 3 soubory — který je canonical (prompts/ vs workflow vs skill)? |
| D-3 | 2.45.1 | Sprint pipeline duplikace SSOT v 4 souborech (částečně řešeno Sprint 2.46) | Zbytek — kompletně extrahovat trifáze-popisky z SKILL.md do standards |
| D-4 | 2.46.1 | `resolveSecret()` security model — env-required pro CI / persisted random key pro local-dev / současný host-derived | Bezpečnostní volba (3 cesty, každá má tradeoffs) |
| D-5 | 2.46.1 | Asymmetric crypto (Ed25519 promotion, schema_version 2) | Kdy spustit cross-machine verification — multi-operator / klient-facing scénáře |
| D-6 | 3.X | Anthropic Memory Tool integration | 3 ze 4 blockerů aktivní (claude-cli engine collision · value/ceremony · OpenRouter beta-header) |
| D-7 | 2.37 | `mid_conv_system` Steward reinjection | BLOCKED on engine-passthrough verification |
| D-8 | 2.2.1 | Worktree-supervisor spawner v1 | Deferred ze 2.2 — kdy aktivovat spawner |
| D-9 | LR | Launch positioning shift "wisdom over harness" (Boris Cherny signal) | Pre-launch — content + venue + license rozhodnutí |

### 4b. ČISTÝ IMPLEMENTAČNÍ DEBT (12 items) — agent shippuje, ale je třeba zadat

| # | Origin | Item | Effort |
|---|---|---|---|
| I-1 | 2.46.1 | commit_sha binding + workflow_run_id nonce journal | M |
| I-2 | 2.44.1 | reviewMarkerPath SSOT extrakce (4-way duplication) | S |
| I-3 | 2.45.1 | Untrusted-fencing contract test pro sprint-*-plan.md | S |
| I-4 | 2.46.1 | sprintId/workflow_run_id match commit-message cross-check | S |
| I-5 | 2.44.1 | Property tests pro `mergeFindings` reducer | XS |
| I-6 | 2.44.1 | workflow ARGS_SCHEMA Zod validation | S |
| I-7 | 2.46.1 | STRICT_SECRET=1 opt-in fail-CLOSED mode | XS |
| I-8 | 2.45.1 | Hash-pinned `--check` pro non-deterministic surfaces | S |
| I-9 | 2.45.1 | replaceBlock duplicate-marker detection + `\1` backreference | XS |
| I-10 | 2.44.1 | Tokenizer-inflated cost cap re-evaluation | S |
| I-11 | 2.45.1 | Atlas inline-count refactor → reference state-block | M |
| I-12 | 2.45.1 | SOURCE_DATE_EPOCH bound validation | XS |

### 4c. NICE-TO-HAVE / LOG ONLY (5 items)

I-13 (`_resolveSecret` underscore rename) · I-14 (Stryker schedule restoration) · I-15 (workflow Probe 2/3 reproducers) · I-16 (4-tier trajectory SSOT extrakce) · I-17 (Anti-pattern #3 alias variants).

## 5. STRATEGIC DECISION POINTS — tvoje rozhodnutí pro další 1-2 týdny

| Fork | Co to znamená | Tradeoff | Kdy se to vyplatí |
|---|---|---|---|
| **A: Sprint 2.46.1** (close architectural debt) | Závěr 6 deferred items (commit_sha binding · resolveSecret security model · Ed25519 promotion · STRICT_SECRET mode · fencing contract test · sprintId match) | Strukturální — zavírá replay window + posiluje verdict security model. **Meta-meta-dogfood:** /cortex-sprint zavírá svůj vlastní backlog. | Pokud preferuješ closure infrastructure před dalším building |
| **B: Sprint 2.47** (research-harvest) | Read 9 research cache + 26 deferred + 40+ memories + roadmap → synthesizer napíše `cortex/roadmap-2026-06-03.md` s ranked listem 5-10 budoucích sprintů | Strategic — nahradí gut-based pickování empirickým ranked-roadmap. Bez tohohle je každý další sprint guess. | Pokud chceš data-driven roadmap pro další měsíc+ |
| **C: Sprint 2.47** (/cortex-overview tool) | Slash skill + CLI co auto-emituje tento recap denně. ~30 řádků skill + ~150 řádků CLI. | Operator UX — solves "ztrácím kontext" strukturálně. Reusable, ne single-shot markdown. | Pokud tento recap ti ulevil a chceš ho každý den jedním gestem |
| **D: LR.9** (wisdom-pitch positioning) | Pre-launch content shift z "automating sprints" na "institutional wisdom library" + 4 LR.8 venue cards | Strategic — launch readiness. Boris Cherny transcript signal (memory). | Pokud myslíš na launch v horizont 4-8 týdnů |
| **E: Sprint 4.9** (Ambient PWA) | Local-first Next.js morning-briefing PWA s email-draft surface | Product — první operator-facing UI, defensible whitespace. Multi-sprint arc. | Pokud chceš product surface a máš čas na L effort |
| **F: /clear pauza** | Zachovat context bytí · vrátit se zítra/po víkendu s čistou hlavou. Recap funguje jako anchor. | Žádný ship — recovery investice | Když smart-zone reálně degrované |

**Moje pořadí kdyby ses zeptal jen jednou:** A (2.46.1, M effort, závěr aktuální arc) → C (cortex-overview, S effort, fix operator UX) → B (research-harvest, M effort, info pro další 1-2 měsíce) → D (launch) → E (PWA). F kdykoli mezi.

## 6. Smart-zone checkpoint

Indikátory (per `feedback_autonomous_run_discipline` memory):

| Indikátor | Stav |
|---|---|
| Multi-sprint den (≥2 sprinty + R2 + commit) | ✅ ANO (Sprint 2.46 dnes + tato session) |
| Context window utilization | Vysoký (3 sprinty + plný R2 history v jedné session) |
| Operator self-report ("ztrácím kontext") | ✅ ANO (explicitní signál výše v této session) |
| Decision quality risk | Medium-High — large architectural decisions (D-4 secret model, D-5 Ed25519) by měly počkat na čistou hlavu |
| Doporučení | `/clear` po dočtení tohoto recapu **nebo** dokončit jeden malý sprint (cortex-overview S effort) a pak `/clear` |

## 7. Cross-links — kam jít hloubš

- **Engineer atlas (current state):** `cortex/atlas-2026-06-01.md` (12 sekcí, 51 _lib primitives, 8 hooks, complexity hot-spots, seam map)
- **Operator capability tree:** `cortex/capability-tree-2026-06-01.md` (14 větví, cz vysvětlivky)
- **Sprint disposition tables:** `cortex/sprint-2-44-r2-summary.md` + `2-45-r2-summary.md` + `2-46-r2-summary.md`
- **Roadmap (living document):** `docs/steward-roadmap.md` (4 tiers, 21+ sprintů, R1-R6 principles)
- **Mental model SSOT:** `prompts/cortex-load.md` (cortex = institutional wisdom · CLAUDE.md = current state)
- **Memory index:** `MEMORY.md` (40+ memories per `~/.claude/projects/c--Users-david-Desktop-APPs-cortex-x/memory/`)
- **Identity & North Star:** `CLAUDE.md` § 0. North Star (4-tier trajectory)
- **Per-sprint plans (audit trail):** `cortex/sprint-2-44-plan.md` · `sprint-2-45-plan.md` · `sprint-2-46-plan.md`

## 8. Dnešní data lineage (transparency)

- Counts (15 skills · 21 CLIs · etc.) — `node bin/cortex-doc-regen.cjs --json` (live, 2026-06-03 08:54+02:00)
- Recent commits — `git log --since=2026-05-30 --oneline` (live)
- Deferred items — 3× `r2-summary.md` § Sprint X.1 backlog (validated against source)
- Strategic forks — `docs/steward-roadmap.md` + Sprint 2.46 in-context decisions
- Smart-zone — explicit operator signal v této session 2026-06-03

Žádný invented data. Pokud něco vypadá nepřesně, je to drift mezi hand-prose tohoto souboru a zdrojovými files — flag a fix.

---

*Tento recap je hand-curated 2026-06-03. Sprint 2.47 navrh (option C výše) tento file nahradí auto-generovaným `/cortex-overview` view co lze regenerovat jedním gestem. Do té doby je tohle anchor.*
