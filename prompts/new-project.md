# New Project — Discovery + Auto-Research + Scaffold

> **How to use:** Create empty folder, open Claude Code, paste this prompt. Claude vede the user přes discovery → automatický web research → proposal → scaffold. Kompletní flow ~15 min.

---

## Your task

Uživatel začíná nový projekt. Tvá práce: **nejdřív porozumět co chce stavět, pak research, pak teprve scaffold**. Nikdy neskakuj přímo do scaffoldu bez discovery (pokud uživatel explicitně neřekne `skip`).

## Režimy (auto-detect)

**BAIL → QUICK SCAFFOLD** (když uživatel už ví všechno):
- Initial message obsahuje název + popis + profil ("3 questions answered")
- Nebo obsahuje slovo `skip` / `quick`
- Nebo initial message má ≥80 slov (the user už promyslel)
→ Přeskoč Phase 1, jdi na Phase 2 (research) a Phase 4 (scaffold)

**FULL FLOW (default):**
Phase 1 (discovery) → Phase 2 (research) → Phase 3 (proposal) → Phase 4 (scaffold)

---

## Phase 1 — Discovery (6 otázek, česky, konverzační)

**Opener:**
> "Pojď si to rozmyslet. Projdu tě 6 otázkama — když na něco neznáš odpověď, řekni 'nevím' a jedu dál. Když už víš všechno a chceš scaffoldovat, napiš **skip** a přeskočím na konec."

### Q1 — Seed (always)
> "Popiš mi jednou větou, co ten projekt dělá. Klidně syrově — 'appka co X', 'nástroj pro Y'."

### Q2 — Pain (Mom Test, past-tense)
> "Kdy naposled jsi narazil na ten problém ty osobně (nebo někdo, kdo ti ho řekl)? Co jsi v tu chvíli udělal místo toho?"
> *Skip if* Q1 already names concrete user + event.

### Q3 — User (singular, not persona)
> "Kdo je ten JEDEN člověk, pro kterýho to primárně stavíš? Jméno, role, nebo 'já sám' — ne 'malé firmy v ČR'."

### Q4 — Scope (MVP boundary, Levels-style)
> "Kdyby sis za víkend měl postavit nejošklivější fungující verzi — co je to ONO jádro? Všechno ostatní je v2."

### Q5 — Not-doing list (explicit OUT)
> "Co tenhle projekt vědomě NEBUDE řešit? Napiš 2-3 věci, co by ses mohl nechat svést udělat, ale teď nechceš."
> *Skip if* Q4 gave tight scope (≤15 words + specific feature).

### Q6 — Success signal (validation, not vanity)
> "Jak poznáš za 2 týdny, že to má smysl pokračovat? Reálný metric — ne 'je to hezký', ale 'X lidí použilo' / 'mám prvního platícího' / 'ušetřilo mi to 2h týdně'."

### Q7 — AI integration (2026 default, not optional)
> "Jak AI zapadne do tohoto projektu? 3 možnosti:
> a) **AI-heavy** — je to agentic tool / chatbot / AI-powered feature jako core value prop (použij profil `ai-agent` nebo `chatbot-platform`)
> b) **AI-ready** — MVP bez AI, ale struktura připravená na budoucí AI features (safe-tool wrapper, memory scaffold, /api/chat endpoint reserved) — **tohle je 2026 default pro SaaS**
> c) **No AI** — skutečně nepotřebuje AI (static blog, landing page, portfolio) — použij profil `astro-static` nebo `minimal`
>
> Výchozí hodnota: **b) AI-ready**. Pokud řekneš 'nevím', default je b."

**Skip if:** Q1 + Q3 clearly indicates AI-heavy (e.g., "AI assistant", "chatbot", "autonomous agent") → auto-assume `a) AI-heavy`.
**Skip if:** profile je už `astro-static` / `minimal` → auto-assume `c) No AI`.

### Branching rules

| Trigger | Action |
|---|---|
| User typed `skip` at any Q | Jump to Phase 2 with current info |
| User answered `nevím` to Q6 | Propose 2 measurable criteria, user picks |
| Q3 = "já sám" | Tag as `dogfood`, raise bar on Q6 |

---

## Phase 2 — Auto-Research (parallel agents, 2-3 min)

**NEVER ask "chceš research?" — always do it.** Research je cortex-x killer feature, silent by default.

**Protokol:** [`shared/research-protocol.md`](../shared/research-protocol.md). Config: [`config/research.yaml`](../config/research.yaml). Cache: `research/<slug>-<date>.md`. Opt-out: `--no-research` v initial prompt.

Spawn **3 parallel research agents** via Agent tool (subagent_type: general-purpose). Queries derived from Phase 1 answers:

### Agent 1 — Domain research
Query based on Q1 + Q3:
> "Research 2026 best practices for `<Q1 project type>` targeting `<Q3 user>`. What are the common features, architectural patterns, pitfalls to avoid? Top 3 existing products and what they do well/poorly. 300-word report with URLs."

### Agent 2 — Technical research
Query based on pre-selected profile (derived from Q1):
> "Research 2026 implementation patterns for `<type>` using `<stack>`. Key libraries, architectural decisions, recent gotchas. Cite specific resources from anthropic.com, vercel.com, supabase.com, github.com trending. 300-word report."

### Agent 3 — Competitive/differentiator research
Query based on Q4 + Q5 (MVP + out-of-scope):
> "Research existing solutions that do `<Q4 MVP core>` specifically NOT doing `<Q5 out-of-scope>`. Who's in this space? What's their weakness the user could exploit as differentiator? 300-word report with URLs."

### Agent 4 — AI integration research (NEW, 2026 default)
Query based on Q1 + Q7:
> "Research AI integration points for `<Q1 project type>` in 2026. What AI features are:
> - **Table stakes** (competitors have them, users expect them) — must-have for parity
> - **Differentiator** (nobody does well yet) — opportunity for unique value
> - **Over-hyped** (sounds good, doesn't ship) — skip traps
> - **Technical patterns** specific to this project type (memory architecture, tool design, streaming UX)
> 300-word report with specific model recommendations (OpenAI/Anthropic/Gemini/local) and agentic architecture suggestions. Cite 2026 examples."

**Skip Agent 4 if** Q7 = `c) No AI`.

**While agents run:** continue Phase 3 drafting in parallel, merge research when it arrives.

### Cache research

After agents return, save to:
```
{cortex_root}/research/<slug>-<YYYY-MM-DD>.md
```

Structure:
```markdown
---
project: <slug>
date: <YYYY-MM-DD>
agents: [domain, technical, competitive]
---

# Research: <project name>

## Domain (2026 best practices)
<300 words from Agent 1>

## Technical (<stack> patterns)
<300 words from Agent 2>

## Competitive landscape
<300 words from Agent 3>

## Key insights (1-3 bullets from all 3)
- ...
```

---

## Phase 3 — Proposal (research-backed)

Shrň co slyšíš + co research našel:

```markdown
## Shrnutí

**PROJEKT:** <3 name candidates, kebab-case>
**UŽIVATEL:** <Q3, one sentence>
**PROBLÉM:** <from Q2, one sentence>
**MVP JÁDRO:** <from Q4, max 5 bullets>
**EXPLICITNĚ MIMO:** <from Q5>
**DEFINITION OF DONE (sprint 1):** <from Q6, measurable>

## Doporučený stack (profile: <cortex-x profile name>)

<1-line reason pro profil>
- Framework: <e.g., Next.js 16>
- DB: <e.g., Supabase>
- Styling: <e.g., Tailwind 4 + shadcn/ui>
- Testing: <e.g., Vitest + Playwright>

## 🔍 Co říká research (CRITICAL)

**Domain:**
- <insight 1 z Agent 1>
- <insight 2 z Agent 1>

**Technical:**
- <insight 1 z Agent 2>
- <insight 2 z Agent 2>

**Competitive:**
- <insight 1 z Agent 3>
- <differentiator — what to leverage>

**→ Doporučení z research:**
- <concrete action item 1 — e.g., "add feature X from day 1, it's table stakes">
- <concrete action item 2 — e.g., "avoid common mistake Y">

## Rizika (Cagan 4 big risks)

Tag pouze **reálná** rizika (ne všechny 4):
- 🟡 **VALUE:** <if value proposition unclear — from Q2>
- 🟡 **USABILITY:** <if UX is risky — from Q3>
- 🟡 **FEASIBILITY:** <if tech is risky — from research>
- 🟡 **VIABILITY:** <if business model is risky — from Q6>

## První sprint (5 stories, každá ≤1 den)

| # | Popis | Stav |
|---|-------|------|
| 1.1 | <foundation story> | pending |
| 1.2 | <...> | pending |
| 1.3 | <...> | pending |
| 1.4 | <...> | pending |
| 1.5 | <first measurable outcome from Q6> | pending |

---

**Pokračovat scaffoldem?** [y / uprav X / začni znovu / přejmenuj projekt na X]
```

---

## Phase 4 — Scaffold (when confirmed)

Po `y`:

### 4.1 Render scaffold
1. Scaffold dle `profiles/<selected>.yaml` (struktura, package.json, configs, Next.js/Astro/etc.)
2. Render templates s **daty z Phase 1 + 3** (ne generic placeholders):
   - `CLAUDE.md` — vlastní popis, stack, architektura zmíněná v Phase 3
   - `PROGRESS.md` — 5 stories z Phase 3, konkrétní k jeho projektu
   - `MEMORY.md` + `memory/user_profile.md` + `memory/project_overview.md` s Q1-Q6 odpověďmi
   - `README.md` — jednovětná description z Q1

### 4.2 Copy DEFAULT hooks + agents (baseline)
3. Copy hooks z `~/.claude/shared/hooks/` (block-destructive, session-start, pre-compact, post-tool-use)
4. Copy agents z `{cortex_root}/agents/*.md` → `.claude/agents/` (sada z profile YAML `agents:` listu)
   - Default: `cortex-thinker`, `blind-hunter`, `edge-case-hunter`, `acceptance-auditor`, `security-auditor`, `ssot-enforcer`

### 4.3 SYNTHESIZE project-specific agents + hooks (research-driven)

**This is the killer feature.** Default agents pokrývají generic risks. Tenhle krok přidá **PROJECT-SPECIFIC strážce** na základě research findings z Phase 2 a proposalu z Phase 3.

#### 4.3.1 Gap analysis
Přečti:
- Phase 2 research (domain/technical/competitive/AI výstupy)
- Phase 3 proposal (stack, risks, MVP core)
- `{cortex_root}/agents/*.md` (co už pokrývají default agenti)
- `{cortex_root}/shared/hooks/*.cjs` (co už pokrývají default hooky)

Urči **gaps** — project-specific invariants, které default set NEPOKRYJE. Příklady:

| Project type | Research finding | Synthesize |
|---|---|---|
| Deterministic agent runtime (ReplayAgent) | "same seed must produce same output byte-exactly" | `determinism-auditor` agent + `pre-commit-seed-check` hook |
| Fraud detection (MirrorPay) | "PII must never leak into logs or traces" | `pii-leak-auditor` agent + `block-pii-in-commit` hook |
| Website-as-a-Service multi-tenant | "tenant isolation is business-critical" | `tenant-isolation-auditor` agent + `rls-policy-validator` hook |
| Kiosek touch PWA | "must work offline; service worker critical" | `offline-first-auditor` agent + `sw-registration-validator` hook |
| AMD ROCm workload | "ROCm + Ubuntu 22.04, not 24.04" | `rocm-env-validator` hook (pre-deploy check) |
| CLI tool on npm | "supply chain security (postinstall scripts)" | `postinstall-audit` hook |

**Pravidlo:** Synthesize **POUZE** když:
- Research explicitně identifikoval constraint/risk
- Default set to nepokrývá
- Constraint je domain-specific (ne generic)

Minimum: 0 nových agentů/hooků (pokud research nic nepřinesl nad rámec defaults).
Maximum: 3 nové agenty + 2 nové hooks (přes = overengineered).

#### 4.3.2 Agent synthesis (pokud gap = behavioral audit)

Pro každý agent gap, generuj soubor `.claude/agents/<slug>.md` s frontmatter pattern z `{cortex_root}/agents/blind-hunter.md` (template). Struktura:

```markdown
---
name: <slug>
description: One-sentence purpose. Invoke via Task tool when <trigger>.
model: sonnet  # default; opus pro kritické audity
---

# <Name>

## Role
<What this agent checks — specific to this project>

## Context needed
<What files/dirs to read before auditing>

## Detection rules
1. <Concrete rule 1 with example>
2. <Concrete rule 2 with example>
...

## Evidence requirements
<Every finding must cite: file:line, expected vs actual, severity (blocker/warning/info)>

## Output format
<Structured markdown with verdict + findings list>

## Grounded in
- Phase 2 research: {URL from research cache}
- Phase 3 decision: {ADR reference}
```

#### 4.3.3 Hook synthesis (pokud gap = deterministic pre/post-check)

Pro každý hook gap, generuj `.claude/hooks/<slug>.cjs`. Pattern z `{cortex_root}/shared/hooks/block-destructive.cjs`:
- CommonJS, cross-platform (používej `os.homedir()`, `path.join()`)
- Return hook JSON output se správným `hookEventName`
- Log rozhodnutí (allow/deny/warn) do stderr
- **Nikdy** neblokuj bez jasného důvodu — research citation v komentáři

Registrace v `.claude/settings.json` pod správným event name (PreToolUse, PostToolUse, SessionStart, atd.).

#### 4.3.4 Documentation
Vytvoř `.claude/README.md`:
```markdown
# .claude — Project-specific Claude Code config

## Agents (default + synthesized)
- **Default** (z cortex-x/agents/): cortex-thinker, blind-hunter, ...
- **Synthesized** (project-specific, based on Phase 2 research):
  - `<name>` — <one-liner>. Grounded in: <research citation>

## Hooks
- **Default** (z ~/.claude/shared/hooks/): block-destructive, session-start, ...
- **Synthesized**:
  - `<name>` — <one-liner>. Grounded in: <research citation>

## Kdy co použít
<quick guide>
```

### 4.4 Rule 1 validation (BLOCKER — scaffold fails if violated)

Před finalizací ověř scaffold vs [`standards/RULE-1.md`](../standards/RULE-1.md) checklist. Pokud **kterékoliv** selže → regeneruj, ne push dál.

**SSOT gate:**
- [ ] Existuje jedno `config/` (ne `src/config/` + `src/settings/` + `app/config/`)
- [ ] Design tokens mají SSOT soubor (`config/design-tokens.ts` nebo ekvivalent)
- [ ] Žádný string literal duplikovaný ≥2× v scaffoldu (labels, URLs, constants)
- [ ] DB schema je SSOT (migrace) — žádné hand-written types co drift-nou

**Modular gate:**
- [ ] Feature folders struktura `src/features/<slug>/` nebo jasný module boundary
- [ ] Adapter folder pro externí SDKs (`src/lib/<service>/`, ne přímý import v UI)
- [ ] Žádný kruhový import (grep nebo dep cruiser check)

**Scalable gate (pro profiles s backend):**
- [ ] RLS enabled na všech user-facing tabulkách (i v MVP)
- [ ] Indexy na FK + query predikátech v initial migraci
- [ ] Rate-limit stub existuje (`src/lib/rate-limit.ts`)
- [ ] Paginace pattern v API route template (neposílat vše)

Pokud **kterýkoliv gate** selže:
1. Loguj detail do stdout (který, proč)
2. Regeneruj dotčenou část
3. Re-validuj
4. **Nikdy** nepokračuj do 4.5 s violation

### 4.5 Finalize
8. Link research: v `CLAUDE.md` přidat referenci na `cortex-x/research/<slug>-<date>.md`
9. `git init` + first commit s message odrážející vision (ne generic)
10. Report + ask about cortex library entry

### 4.5 Audit output
Na konci scaffoldu vypiš:
```
Scaffold done. Created:
- N files total
- K default agents + L synthesized agents (grounded in research)
- M default hooks + P synthesized hooks (grounded in research)

Synthesized artifacts:
- .claude/agents/<name>.md — "<purpose>" (from research finding: <cite>)
- .claude/hooks/<name>.cjs — "<purpose>" (from research finding: <cite>)
```

**uživatel reviewuje: pokud synthesized agent/hook vypadá overengineered → řekne "remove <name>" → smažeš + zapíšeš do `insights/` co nefungovalo (learning material pro příští scaffold).**

---

## Rules

- **Never skip discovery** unless auto-bail triggers (user explicit skip / already has all 3 questions / ≥80 word first message)
- **Never ask "chceš research?"** — vždy run Phase 2 parallel. Research je silent + automatic.
- **Never use generic placeholders** — každý soubor musí být personalized by Phase 1 answers
- **Never skip cortex-x standards** — všechny projekty dědí 11 pillars
- **Cache research** — re-scan use se vyvaruje duplicitním web callům
- **Respect SSOT** — CLAUDE.md drží current state, research je pointer ne duplicate
- **Čeština v Q1-Q6 + proposal** — uživatelův jazyk
- **Synthesis is evidence-gated** — new agent/hook vzniká POUZE s research citation. No citation = žádná synthesis.
- **Synthesis budget** — max 3 agenti + 2 hooky navíc k default set. Přes = overengineered.

## Anti-patterns

- ❌ Scaffold bez discovery → generic výstup, the user musí vše přepisovat
- ❌ Asking "do you want research?" → slows flow, research by měl být default
- ❌ Research AFTER scaffold → pozdě, rozhodnutí už jsou udělaná
- ❌ 10+ questions → completion rate drop za 7 (research)
- ❌ Persona thinking → "small businesses in country X" = useless, "a specific named user at a specific role" = actionable
- ❌ Future-tense questions → "would you use?" useless, "kdy naposled?" actionable (Mom Test)
- ❌ Synthesizing agents/hooks "for completeness" → generic `code-quality-auditor` = default set už to má. Synthesize jen když research říká "tenhle projekt potřebuje něco specifického, co default nepokryje"
- ❌ Generating agent bez citace do research → halucinace, smazat

## Philosophy

Každý nový projekt začíná **6 otázkami co donutí the user přemýšlet** + **auto-research který mu ušetří 2 hodiny googlování** + **research-backed scaffold co je personalizovaný**.

Cortex-x je osobní senior product partner, ne template engine.

## Research methodology reference

Flow design inspirován:
- Mom Test (Rob Fitzpatrick) — past-tense questions
- Lean Canvas (Ash Maurya) — 1-pager validation
- Cagan 4 big risks (SVPG) — risk tagging framework
- Pieter Levels indie hacker workflow — MVP boundary thinking
- Teresa Torres opportunity solution tree — user-problem-solution mapping
