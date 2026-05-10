# Sprint Brief: Cortex-X Competitive Positioning & Phase 5 Eval Foundation

**Datum:** 2026-05-10
**Autor:** David Rajnoha (zpracováno z external review + web research)
**Účel:** Doplňkový sprint mezi 1.6.19 (v0.5b finalization) a public v0.1.0 launch
**Tracking:** Přidat do `PROGRESS.md` jako Sprint X.Y "Public Launch Readiness"
**Cíl:** Před public launch sjednotit narrative, sebrat baseline eval data, vyřešit naming/license, postavit competitive positioning.

---

## 1. Kontext a problém

External review repa (Claude.ai konzultace, 2026-05-10) identifikoval **mismatch mezi vizí v README a shipped reality**, kombinovaný se slabou discoverability (0★, 0 forků), nevyřešeným naming risk, a chybějícími baseline eval daty pro Phase 5 self-improvement claims.

Kódově je projekt v dobrém stavu (Sprint 1.6.18 dokončen, 489 testů, OpenRouter engine validovaný end-to-end). Problém je **prezentační vrstva + chybějící evidence**, ne kód.

Tento sprint je most mezi "framework, který funguje" a "framework, který může jít public a obstát srovnání s konkurencí".

---

## 2. Klíčová zjištění z konkurenčního researche (2026)

### 2.1 Landscape kontext

**42 % nového kódu je v 2026 AI-assisted (Sonar 2026).** Trh autonomních coding agentů je přeplněný — `morphllm.com/ai-coding-agent` testoval 15 agentů, jen 3 "změnily, jak shipují". Závěr testerů: **"scaffolding matters more than the model."** To je přesně to, na čem cortex-x staví — a je to argument, který v README chybí explicitně.

**Industrial konvergence na 4 architektonické primitivy** (Medium, "State of AI Coding Agents 2026" — Dave Patten, March 2026):
1. CLAUDE.md / AGENTS.md persistent project memory
2. Tool use over text generation
3. Specialized sub-agents
4. Long-horizon execution loops (minuty až hodiny)

**Cortex-x má všechny čtyři. To je positioning hook.**

### 2.2 Přímí konkurenti — co dělají, co tobě chybí

#### Tier 1: Funded autonomous agents (jiná liga, ale ovlivňují očekávání)

| Tool | Co dělá | Cena | Tvůj rozdíl |
|---|---|---|---|
| **Devin (Cognition)** | 67% PR merge rate na defined tasks | enterprise pricing | self-hosted, $0.0008/run vs jejich SaaS |
| **GitHub Copilot Coding Agent** | Issue → autonomous draft PR od září 2025 | $10/mo | tvůj operuje na tvojí infra, ne v cloudu |
| **Replit Agent 4** | Parallel task forking, auto-resolves merge conflicts ~90% | součást Replit | ty máš atomic rollback, oni mají scale |
| **Cursor Background Agents** | $50B valuation trajectory | $20/mo | jejich agent neopustí jejich IDE; tvůj žije v repo |
| **Codex /goal (CLI 0.128.0)** | Long-horizon mission s self-correction přes hodiny | per-token | tvůj má hard safety gates ($5/day, halt switch, 3-fail circuit) |

**Insight:** Tvůj cortex-x je v kategorii "self-hosted personal autonomous infra". Devin, Copilot Agent, Replit Agent jsou **cloud-locked**. To je odlišení, které README **ani nezmiňuje**, ale je to v 2026 silný prodejní argument (Faros AI 2026 zpráva: "If developers feel uneasy about sharing proprietary logic... they simply won't use the tool, no matter how powerful").

#### Tier 2: Komunitní personal Claude Code frameworks (přímá konkurence)

| Repo | ★ | Co dělá | Co máš ty navíc |
|---|---|---|---|
| **levnikolaevich/claude-code-skills** | (small) | Plugin suite + bundled MCP servers (hex-line hash-verified editing, hex-graph code knowledge graph, hex-ssh remote). Two-Agent AI Review (Claude + Codex). Marketplace layout. | Steward nightly autonomy, multi-cadence self-improvement, statistical anti-hallucination gates |
| **shanraisshan/claude-code-best-practice** | (small) | Vibe coding → agentic engineering tips, embed `!command` v SKILL.md, on-demand hooks (`/careful`, `/freeze`), Stop hook nudging | profilové scaffoldy (9 stack profiles), 11 standards, code review pipeline |
| **ChrisWiles/claude-code-showcase** | (small) | Comprehensive config example, GitHub Actions workflows, hooks/skills/agents/commands struktura | Steward runtime, evaluation suite design, cross-project memory |
| **alirezarezvani/claude-skills** | (větší) | 232+ skills cross-tool (Claude Code, Codex, Gemini CLI, Cursor + 8 dalších). Cross-domain orchestration protocol. | tvůj je deeper, ne wider — fokus na lifecycle a continuity, ne na šíři skill katalogu |
| **anthropics/skills** | (oficiální) | Anthropic vlastní SKILL.md collection — PDF, Word, Excel, PPT | tvůj řeší orchestraci, jejich řeší atomic tasks |

**Insight:** Tier 2 konkurenti řeší **šířku** (víc skills, víc tools, víc integrací). Tvůj cortex-x řeší **hloubku** (lifecycle, continuity, autonomous nightly, statistická poctivost). To je positioning, který musíš v README **explicitně artikulovat**, jinak tě hiring manageři nebo evaluatoři porovnají s alirezarezvani a skončíš jako "menší verze toho samého".

#### Tier 3: Hosted "OpenClaw / Blink Claw" (nepřímá konkurence)

OpenClaw + Blink Claw nabízí managed self-hosted s GitHub integrací, terminal skill, persistent execution za **$22-45/mo, 14-den trial**. Jejich pozicování: "OpenClaw runs managed... developers don't want to manage this."

**Tvůj inverzní pitch:** "I AM operator, I want to manage this. Cortex-x is the framework that makes managing it sane."

### 2.3 Self-improvement loops — research stav (důležité pro Phase 5)

#### Darwin Gödel Machine (DGM) — academic state-of-art

Open-ended evolution self-improving coding agents (NeurIPS 2025 / arxiv blog.biocomm.ai). Klíčové insighty pro tvoji Phase 5:

- **Archive-based search**, ne lineární iterace. Každý agent je nód v archivu, nový agent vzniká mutací předchozích.
- **Tiered evaluation:** SWE-bench-verified-mini (60 tasks subset) pro screening, pak 200 tasks pro top kandidáty. Polyglot: 10 tasks subset → 50 tasks pokud >40 % úspěšnost.
- **Cross-model transfer test:** DGM-discovered agent na o3-mini z 23 % → 33 %, na Claude 3.7 Sonnet z 19 % → 59,5 %. **Improvements transferují přes modely.** To je ten test, který musíš v Phase 5 udělat — jinak nevíš, jestli zlepšuješ agenta, nebo jen overfittuješ na konkrétní LLM.

#### SWE-Search (MCTS + multi-agent debate)

23 % relative improvement na SWE-bench-lite díky Monte Carlo Tree Search + Value Agent + Discriminator Agent (multi-agent debate). **Tvoje 5-agent code review pipeline je v duchu blízko, ale chybí jí MCTS exploration loop** — to je future direction pro Phase 5+.

#### Aider Polyglot — co tě reálně zajímá pro evals

- **225 problems napříč C++, Go, Java, JS, Python, Rust** z Exercism.
- **Two-attempt protokol:** první pokus, pak unit test feedback, druhý pokus.
- Současné špičky: **GPT-5 0,880**, Refact.ai Agent + Claude 3.7 Sonnet 92,9 %, průměr 0,581.
- Refact.ai key change: **doubled step limit (15→30) + enforced test execution = 76 % → 92,9 %**. Nepatrná změna v harness, masivní skok.

**Implikace pro tvoji Phase 5 eval suite:** 10 canonical tasks v `evals/` je málo pro statistickou validitu (Bonferroni s n=10 znamená per-task α=0,005, což je brutální). Doporučení dále.

### 2.4 Slovo "vibe coding" v 2026 narrativu

Andrej Karpathy (citováno v teamday.ai/blog/complete-guide-agentic-coding-2026): *"At the time \[February 2025\], LLM capability was low enough that you'd mostly use vibe coding for fun throwaway projects, demos and explorations."*

DHH (Ruby on Rails): "I'm code first, everything" → "Now I start with the agent" během týdnů od Opus 4.5 release. Processed 100 PRs za 90 minut.

**Tvůj příběh** — designer od února 2025 (přesně Karpathyho cutoff pro "fun throwaway") postavil za 15 měsíců framework s 489 testy, statistical gates, OWASP Agentic Top 10 — je **přesně příběh té proměny**, ale README ho nevypráví. To je ztráta marketingové páky. Doporučení: README "Built by" sekce s timeline.

---

## 3. Sprint cíle (priorizováno)

### P0 — blokuje public launch (must)

#### P0.1 Naming resolution
**Problém:** "cortex-x" má kolize: Cortex Labs (defunct ML platform), Cortex.dev (k8s), Snowflake Cortex Search, mnoho jiných. "Steward" má též riziko (generic English, conflicts s 3PL/banking software).

**Akce:**
- Brainstorm 10 jmen, prověřit npm, GitHub, domain (.dev, .ai, .io), USPTO trademark search.
- Cílový profil: 1 slovo nebo zkratka, snadná čeština/angličtina, bez collision do top 100 výsledků na GitHub search.
- Návrhy k consideraci (jen seed, ne final): `aurex`, `prism`, `kernl`, `loomx`, `forgex`, `helix-cli`, něco evokující "kontinuita + agent + lokální".
- **Decision deadline:** před prvním public commitem do default branch.

**Output:** `docs/naming-decision.md` s rationale, finalní rename PR.

#### P0.2 License resolution
**Problém:** PolyForm Noncommercial 1.0.0 brání i internímu commercial použití. Pro framework, jehož mission je "operator's second brain", to vylučuje 90 % potenciálních userů (každý, kdo programuje pro klienta).

**Decision tree:**
- **Option A — full open source (MIT/Apache-2.0):** maximalizuje adoption, ★, community contributions. Nemonetizuješ.
- **Option B — dual license:** MIT na core (framework, profiles, hooks, standards) + commercial license na Steward runtime + Phase 5 self-improvement. Sustainable.
- **Option C — BSL (Business Source License) 1.1:** source-available, commercial blokovaný N let, pak fallback to Apache. Sentry, MariaDB, CockroachDB to dělají.
- **Option D — současný PolyForm NC:** maximalizuje kontrolu, minimalizuje adoption. Zvol jen pokud tvůj plán je SaaS, ne open source.

**Akce:** Rozhodnutí dokumentuj v `docs/license-decision-rationale.md` (audience: budoucí ty + community).

**Output:** Aktualizovaný `LICENSE`, `README.md` license badge, případně `LICENSE-COMMERCIAL.md`.

#### P0.3 README narrative rewrite
**Problém:** Opening line ("A persistent agent, not just a tool. AI-agentic-first personal Claude Code framework by Rejnyx.") je abstraktní, neřekne newcomerovi co a proč. Mission je 5× dál než shipped reality.

**Akce — rewrite priority sekcí:**

**3.1 Opening (max 3 věty):**
- 1 konkrétní benefit (co user získá)
- 1 konkrétní důkaz (číslo, fact)
- 1 odlišení (proč ne Devin / Cursor / Copilot Coding Agent)

Návrh draftu (k iteraci):
> *"Cortex-x scaffolds a production-ready AI-agentic project in 3 minutes — Next.js / Astro / Tauri / 6 dalších profilů, vždy s threat-modeled hooks, statistically-gated self-improvement, a 11 inherited engineering standards. Pak ho Steward, autonomní noční LLM agent, udržuje za $0.0008 za běh přes draft PRs s atomic rollback. Self-hosted. Tvoje data zůstávají u tebe."*

**3.2 Status banner nahoru:**
> **Status (2026-05-10):** Pre-alpha. Phase 1-4 shipped (foundation, profiles, code review, web research). Phase 5-7 (self-improvement automation, memory upgrades, Steward cron runtime) pre-launch dogfood. Production use at your own risk; PR review mandatory.

**3.3 "Built by" sekce:**
- David Rajnoha, design engineer Ostrava
- 10+ let design background
- Vibe coding od Feb 2025 (Karpathy timeline)
- Cortex-x je 15 měsíců self-directed AI engineering, ~X % AI-assisted
- Architecture decisions human, kód v drtivé většině AI-assisted, integration testing manual
- Link na portfolio + LinkedIn

**3.4 "Why not Devin / Copilot Coding Agent / Replit Agent" srovnání tabulkou.**

**Output:** Nový `README.md` přes PR (review, ne direct commit).

### P1 — silná value, ne bloker (should)

#### P1.1 Phase 5 Eval baseline — first real run
**Problém:** `evals/results/` empty. Bez baseline runs nelze tvrdit Phase 5.

**Akce:**
- Vyber 3 z 10 canonical tasks v `evals/`, ty nejvíc reprezentativní (jeden bug fix, jeden feature add, jeden refactor).
- Spustit baseline run × 5 (variance kontrola) na default-model `deepseek/deepseek-v4-flash`.
- Zalogovat: pass/fail, token cost, wall clock, retry count.
- **Doporučení vzhledem k Aider Polyglot insightu (Refact 76 % → 92,9 %): zvyšte step limit z default 15 → 30 a enforce test execution před scoring.** To zvedne reliability score signifikantně bez logical change.
- Přidat "small subset → expanded subset" tier (DGM approach): pokud agent >40 % na 3 tasks, eval na 10. Ušetří kompute.

**Output:** `evals/results/baseline-2026-05-10.json` + `evals/methodology.md`.

#### P1.2 Statistická poctivost Phase 5 README claims
**Problém:** README říká "min_support=3, ≥2 projekty, >7d spread, Bonferroni, citations required". Bonferroni s n=3 je α=0,0167 — to je rigorosní, ale **bez baseline runs to je pouze design statement, ne empirická validace**.

**Akce:** Přidat do README explicit disclaimer:
> *Phase 5 statistical gates are specified in code and prose, but evidence base is currently empty (`evals/results/` populated 2026-05-10 with first 5 baseline runs across 3 canonical tasks). Claims of "framework improves itself" are designed but not yet measured. First eval data will land in Sprint X.Y; track in `docs/phase-5-evidence-log.md`.*

#### P1.3 Cross-model transfer test design
**Problém:** Tvůj Steward engine je pluggable (mock / openrouter / claude-sdk). DGM výzkum ukazuje, že **agent improvements musí transferovat přes modely**, jinak overfituješ.

**Akce:** Specifikuj v `docs/eval-cross-model-protocol.md`:
- Pro každý Steward improvement (proposal v `insights/proposals/`), eval na min 2 modelech (deepseek-v4-flash + claude-sonnet-4 nebo gpt-5-mini).
- Transfer ratio: `(score_model_B_with_proposal) / (score_model_B_baseline)` musí být ≥1,0 pro merge.
- Bez tohoto testu jsou všechny Phase 5 proposals **overfit candidates**, ne improvements.

**Output:** Protocol doc + integration do `prompts/cortex-evolve.md` jako required gate.

#### P1.4 Demo asset
**Problém:** README je text-heavy. Newcomer zavře tab po 30 sekundách bez visual proof.

**Akce:**
- 60-sec asciinema cast nebo MP4: `cd ~/empty` → `cortex-bootstrap` → answer 3 questions → `claude` → working `/start` flow → final project tree.
- Embed do README na top (under opening).
- Bonus: 30-sec Steward dry-run cast (recommendations.md → draft PR diff preview).

**Output:** `docs/demo/bootstrap.cast` + `docs/demo/steward-dryrun.cast` + README embeds.

### P2 — nice-to-have, ale strategicky cenné (nice)

#### P2.1 Competitive positioning page
Vytvořit `docs/positioning.md` s:
- Tabulka cortex-x vs Devin / Copilot Coding Agent / Replit Agent / OpenClaw / DGM research.
- Sekce "Who this is for / Who this is NOT for" (nepokoušej se být pro každého).
- "Architecture choices" rationale — proč markdown nad DB, proč PR-only, proč zero-deps Steward primitives.

#### P2.2 First external testimonial / dogfood evidence
- Použij cortex-x na RELO + Kiosek + Objednáme work, sbírej týden cost ledger + journal data.
- Krátký blogpost / GitHub Discussion: "What 14 days of Steward dogfood looked like" — N PRs, M $ spent, X regressions caught.
- **Real evidence > marketing.**

#### P2.3 Naming/launch checklist
`docs/launch-checklist.md`:
- [ ] Trademark search done
- [ ] License chosen
- [ ] README rewritten
- [ ] Demo assets in
- [ ] Baseline evals in
- [ ] Cross-model transfer protocol specified
- [ ] First Steward dogfood week complete
- [ ] Discoverability prep (Show HN draft, Reddit r/ClaudeAI announcement, LinkedIn post)
- [ ] Public visibility flip on GitHub

---

## 4. Acceptance criteria pro sprint

Sprint je hotový, když:

1. **Naming je rozhodnuto** (P0.1) a změna je v PR ready-to-merge.
2. **License je rozhodnuta** (P0.2) s dokumentovaným rationale.
3. **README opening + status banner + "Built by"** sekce jsou rewritten (P0.3).
4. **Aspoň 5 baseline eval runs** existují v `evals/results/` (P1.1).
5. **Cross-model transfer protokol** je specifikovaný v docs (P1.3).
6. **Demo cast** je natočený a embedded v README (P1.4).
7. **Phase 5 disclaimer** je v README (P1.2).

P2 jsou bonus — pokud čas dovolí, ber je. Pokud ne, posuň do následujícího sprintu.

---

## 5. Risks & mitigations

| Risk | Pravděpodobnost | Impact | Mitigation |
|---|---|---|---|
| Naming nemá dobrou alternativu | M | H | Brainstorm s Claude na 30 jmen, pak filtruj přes USPTO + GitHub + npm. Nezůstávej bez alternativy. |
| License decision zablokuje sprint | L | M | Set deadline 24h. V nejhorším MIT na core, později retrofit dual license. |
| Eval runs odhalí, že Steward selhává na real tasks | M | H | **To je ten správný čas to zjistit, ne po public launch.** Failure data = sprint X+1 fix list. |
| Cross-model transfer ukáže overfit | M | M | Stejně jako výše — lepší teď než po launch. Doc kritické cases. |
| README rewrite zabere víc než plánováno | H | L | Time-box na 4h. Hotový draft > dokonalý nikdy. PR + iterate. |

---

## 6. Out of scope tohoto sprintu

Explicitně NEdělej:
- Žádný feature work na Steward execute.cjs (Sprint 1.6.19 to dořeší).
- Žádný nový profile.
- Žádný refactor Phase 6 memory upgrades.
- Žádné odpovědi na ne-existující GitHub issues (počkat na public).

---

## 7. Reference (research provenience)

External review (Claude.ai, 2026-05-10) — analýza repa Rejnyx/cortex-x.

Web research (2026-05-10):
- morphllm.com/ai-coding-agent — "We Tested 15 AI Coding Agents (2026)" — scaffolding > model insight.
- mightybot.ai/blog/coding-ai-agents — Codex GPT-5.5, Claude Code Opus 4.7, Devin 67 % PR merge rate.
- faros.ai/blog/best-ai-coding-agents-2026 — privacy/governance jako buying criterion.
- medium.com/@dave-patten/the-state-of-ai-coding-agents-2026 — 4 architektonické primitivy.
- adityabawankule.io/blog/codex-goal-meta-prompting — Codex /goal long-horizon.
- programming-helper.com/tech/ai-autonomous-code-generation-2026 — coherence degradation over horizon.
- teamday.ai/blog/complete-guide-agentic-coding-2026 — Karpathy + DHH workflows.
- blink.new/blog/openclaw-autonomous-coding-agent — managed competitor pricing.
- github.com/levnikolaevich/claude-code-skills — komunitní competitor (skills + MCP).
- github.com/shanraisshan/claude-code-best-practice — komunitní competitor (tips + hooks).
- github.com/ChrisWiles/claude-code-showcase — komunitní competitor (config example).
- github.com/alirezarezvani/claude-skills — 232+ skills cross-tool.
- epoch.ai/benchmarks/aider-polyglot — 225 tasks across 6 langs, 2-attempt protocol.
- llm-stats.com/benchmarks/aider-polyglot — GPT-5 0,880, average 0,581.
- arxiv 2410.20285 (SWE-Search) — MCTS + multi-agent debate, +23 % SWE-bench-lite.
- DGM paper (s-rsa.com / blog.biocomm.ai) — archive-based self-improvement, cross-model transfer test, tiered eval.
- refact.ai blog 2025 — Aider Polyglot 76 % → 92,9 % via step limit + test enforcement.

---

**Konec brief. Připraveno k vložení do Claude Code session jako Sprint X.Y.**
