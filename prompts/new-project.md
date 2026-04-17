# New Project — Discovery + Auto-Research + Scaffold

> **How to use:** Create empty folder, open Claude Code, paste this prompt. Claude vede Dave přes discovery → automatický web research → proposal → scaffold. Kompletní flow ~15 min.

---

## Your task

Dave začíná nový projekt. Tvá práce: **nejdřív porozumět co chce stavět, pak research, pak teprve scaffold**. Nikdy neskakuj přímo do scaffoldu bez discovery (pokud Dave explicitně neřekne `skip`).

## Režimy (auto-detect)

**BAIL → QUICK SCAFFOLD** (když Dave už ví všechno):
- Initial message obsahuje název + popis + profil ("3 questions answered")
- Nebo obsahuje slovo `skip` / `quick`
- Nebo initial message má ≥80 slov (Dave už promyslel)
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

### Branching rules

| Trigger | Action |
|---|---|
| User typed `skip` at any Q | Jump to Phase 2 with current info |
| User answered `nevím` to Q6 | Propose 2 measurable criteria, user picks |
| Q3 = "já sám" | Tag as `dogfood`, raise bar on Q6 |

---

## Phase 2 — Auto-Research (parallel agents, 2-3 min)

**NEVER ask "chceš research?" — always do it.** Research je cortex-x killer feature, silent by default.

Spawn **3 parallel research agents** via Agent tool (subagent_type: general-purpose). Queries derived from Phase 1 answers:

### Agent 1 — Domain research
Query based on Q1 + Q3:
> "Research 2026 best practices for `<Q1 project type>` targeting `<Q3 user>`. What are the common features, architectural patterns, pitfalls to avoid? Top 3 existing products and what they do well/poorly. 300-word report with URLs."

### Agent 2 — Technical research
Query based on pre-selected profile (derived from Q1):
> "Research 2026 implementation patterns for `<type>` using `<stack>`. Key libraries, architectural decisions, recent gotchas. Cite specific resources from anthropic.com, vercel.com, supabase.com, github.com trending. 300-word report."

### Agent 3 — Competitive/differentiator research
Query based on Q4 + Q5 (MVP + out-of-scope):
> "Research existing solutions that do `<Q4 MVP core>` specifically NOT doing `<Q5 out-of-scope>`. Who's in this space? What's their weakness Dave could exploit as differentiator? 300-word report with URLs."

**While agents run:** continue Phase 3 drafting in parallel, merge research when it arrives.

### Cache research

After agents return, save to:
```
~/Desktop/APPs/cortex-x/research/<slug>-<YYYY-MM-DD>.md
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

1. Scaffold dle `profiles/<selected>.yaml` (struktura, package.json, configs, Next.js/Astro/etc.)
2. Render templates s **daty z Phase 1 + 3** (ne generic placeholders):
   - `CLAUDE.md` — vlastní popis, stack, architektura zmíněná v Phase 3
   - `PROGRESS.md` — 5 stories z Phase 3, konkrétní k jeho projektu
   - `MEMORY.md` + `memory/user_profile.md` + `memory/project_overview.md` s Q1-Q6 odpověďmi
   - `README.md` — jednovětná description z Q1
3. Copy hooks z `~/.claude/shared/hooks/` (block-destructive, session-start, pre-compact)
4. Link research: v `CLAUDE.md` přidat referenci na `cortex-x/research/<slug>-<date>.md`
5. `git init` + first commit s message odrážející vision (ne generic)
6. Report + ask about cortex library entry

---

## Rules

- **Never skip discovery** unless auto-bail triggers (user explicit skip / already has all 3 questions / ≥80 word first message)
- **Never ask "chceš research?"** — vždy run Phase 2 parallel. Research je silent + automatic.
- **Never use generic placeholders** — každý soubor musí být personalized by Phase 1 answers
- **Never skip cortex-x standards** — všechny projekty dědí 11 pillars
- **Cache research** — re-scan use se vyvaruje duplicitním web callům
- **Respect SSOT** — CLAUDE.md drží current state, research je pointer ne duplicate
- **Čeština v Q1-Q6 + proposal** — Dave's jazyk

## Anti-patterns

- ❌ Scaffold bez discovery → generic výstup, Dave musí vše přepisovat
- ❌ Asking "do you want research?" → slows flow, research by měl být default
- ❌ Research AFTER scaffold → pozdě, rozhodnutí už jsou udělaná
- ❌ 10+ questions → completion rate drop za 7 (research)
- ❌ Persona thinking → "malé firmy v ČR" = useless, "Vojta Žižka, makléř" = actionable
- ❌ Future-tense questions → "would you use?" useless, "kdy naposled?" actionable (Mom Test)

## Philosophy

Každý nový projekt začíná **6 otázkami co donutí Dave přemýšlet** + **auto-research který mu ušetří 2 hodiny googlování** + **research-backed scaffold co je personalizovaný**.

Cortex-x je osobní senior product partner, ne template engine.

## Research methodology reference

Flow design inspirován:
- Mom Test (Rob Fitzpatrick) — past-tense questions
- Lean Canvas (Ash Maurya) — 1-pager validation
- Cagan 4 big risks (SVPG) — risk tagging framework
- Pieter Levels indie hacker workflow — MVP boundary thinking
- Teresa Torres opportunity solution tree — user-problem-solution mapping
