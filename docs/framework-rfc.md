# Dave's Project Framework — RFC

> Status: DRAFT | Autor: Dave + Claude | 2026-04-11
> Toto je design dokument. Nic z toho zatim neni implementovane.

---

## Problem

Z 28 projektu v `Desktop/APPs/` ma jen 4 plne nastaveny Claude orchestraci (CLAUDE.md, PROGRESS.md, hooks, skills, memory). Zbytek bezi na defaultech. Kazdy novy projekt zacina od nuly — rucne se kopiruje session-start hook, block-destructive, CLAUDE.md struktura, PROGRESS.md format.

Co funguje, je roztrousene ve 4 projektech. Co chybi, je **spolecny zaklad**, ktery se automaticky aplikuje vsude.

---

## Cil

Jeden osobni framework, kde:

1. **Zaklad orchestrace je vzdy stejny** — jak se ridi sprint, jak se trackuje progress, jak se chrani kontext, jak se blokuji destruktivni operace
2. **Project-specific veci se pridavaji modularni** — tech stack, architektura, custom hooks, domain-specific skills
3. **Novy projekt okamzite ziska senior-level rizeni** bez manualni prace
4. **Standard se vyviji na jednom miste** a propaguje vsude

---

## Anatomie soucasneho "Gold Standard"

Co maji lablab, kiosek, back-office-bot, custom-chatbot spolecneho:

### Vzdy pritomne (CORE)
| Artefakt | Ucel | Kde zije |
|----------|------|----------|
| `CLAUDE.md` | Projektova bible — tech stack, architektura, konvence, pravidla | repo root |
| `PROGRESS.md` | Sprint tracking — faze, stories, stav | repo root |
| `.claude/settings.json` | Permissions, hooks registrace | `.claude/` |
| `.claude/hooks/session-start.cjs` | Inject sprint stav + git kontext na zacatku session | `.claude/hooks/` |
| `.claude/hooks/block-destructive.cjs` | Blokuje `git reset --hard`, `rm -rf`, `push --force` | `.claude/hooks/` |
| `.claude/hooks/pre-compact.cjs` | Ulozi stav pred context compaction | `.claude/hooks/` |
| `.claude/compact-state.md` | Recovery po compaction — co jsem delal, kde jsem skoncil | `.claude/` |

### Casto pritomne (EXTENDED)
| Artefakt | Ucel | Projekty |
|----------|------|----------|
| `MEMORY.md` + memory soubory | Cross-session pamet (user, feedback, project, reference) | lablab |
| `.claude/hooks/post-compact.cjs` | Post-compaction akce | lablab |
| `.claude/skills/` | BMAD suite, WDS suite, custom skills | kiosek, back-office-bot, custom-chatbot |
| `.claude/agents/` | Specializovani agenti | kiosek, back-office-bot, custom-chatbot |
| `.claude/hooks/design-token-enforcer.cjs` | Domain-specific enforcer | kiosek |

### Spolecne principy (IMPLICIT — nikde nepsane)
- SSOT, Modularita, Skalovatelnost filtr
- Cestina v UI, anglictina v kodu
- Type hints na vsem, Pydantic/Zod pro data modely
- Strukturovane logovani
- Sprint = stories v tabulce, stavy: ⬜ → 🔄 → ✅
- Agent nesmaze bez potvrzeni, nesmi force-push, nesmi commitovat .env

---

## Navrzena architektura

### Vrstva 1: Global CLAUDE.md (`~/.claude/CLAUDE.md`)

Nactena do KAZDE konverzace, v KAZDEM projektu. Obsahuje:

```
# Dave's Project Standard

## Governance pravidla
- Kazdy netrivialni projekt musi mit CLAUDE.md (projekt bible) a PROGRESS.md (sprint tracking)
- SSOT, Modularita, Skalovatelnost filtr na kazde rozhodnuti
- Cestina v UI, anglictina v kodu (pokud neni projekt jen CS nebo jen EN)

## Sprint tracking format
- PROGRESS.md s tabulkami: | Story | Popis | Stav |
- Stavy: ⬜ (todo) → 🔄 (in progress) → ✅ (done)
- Faze/Sprinty jako ### headingy, dokoncene oznaceny ✅

## Session management
- SessionStart hook injektuje aktivni sprint + git stav
- PreCompact hook uklada compact-state.md pro recovery
- Block-destructive hook chrani pred `git reset --hard`, `rm -rf`, `push --force`

## Memory system
- MEMORY.md = index (vzdy v kontextu, max 200 radku)
- Kazda memory = samostatny soubor s frontmatter (name, description, type)
- Typy: user, feedback, project, reference
- NIKDY neduplikovat — nejdriv hledej existujici memory k updatu

## Novy projekt bootstrap
Pokud CLAUDE.md neexistuje a projekt neni trivialni, navrhnout jeho vytvoreni.
Pokud .claude/hooks/ neexistuji, navrhnout setup zakladnich hooku.

## Univerzalni pravidla
- NIKDY commitovat .env nebo credentials
- NIKDY force-push bez explicitniho potvrzeni
- NIKDY mazat bez potvrzeni (soubory, branche, DB tabulky)
- Preferovat novy commit pred --amend
- Typ hints na vsech funkcich
```

### Vrstva 2: Global Hooks (`~/.claude/settings.json`)

Spolecne hooks presunout z per-project do globalu:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node ~/.claude/shared/hooks/session-start.cjs",
        "timeout": 10
      }]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node ~/.claude/shared/hooks/block-destructive.cjs",
        "timeout": 5
      }]
    }],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node ~/.claude/shared/hooks/pre-compact.cjs"
      }]
    }]
  }
}
```

**Genericka verze `session-start.cjs`:**
- Auto-detekuje PROGRESS.md (libovolny format — tabulky, checklisty)
- Auto-detekuje CLAUDE.md, MEMORY.md, .claude/compact-state.md
- Cte git stav (branch, commits, uncommitted)
- Funguje v KAZDEM projektu bez uprav
- Pokud neni PROGRESS.md → misto kontextu vypise "No PROGRESS.md found"

### Vrstva 3: Shared Assets (`~/.claude/shared/`)

```
~/.claude/shared/
├── DAVE-FRAMEWORK-RFC.md        ← TENTO DOKUMENT
├── hooks/
│   ├── session-start.cjs        ← Genericka verze (auto-detect)
│   ├── block-destructive.cjs    ← Univerzalni
│   └── pre-compact.cjs          ← Univerzalni
├── skills/
│   ├── bmad-*/                  ← BMAD suite (jedna kopie)
│   └── wds-*/                   ← WDS suite (jedna kopie)
└── templates/
    ├── CLAUDE.template.md       ← Skeleton pro novy projekt
    ├── PROGRESS.template.md     ← Sprint tracking template
    └── settings.template.json   ← .claude/settings.json zaklad
```

### Vrstva 4: Project-Level Overrides (beze zmeny)

Lokalni `.claude/settings.json`, `CLAUDE.md`, hooks, skills — vse zustava.
Claude cte GLOBAL + LOCAL CLAUDE.md, hooks se stackuji.

Project-specific veci:
- Tech stack (Next.js vs Python vs Edge Functions)
- Architektura diagram
- Domain-specific hooks (design-token-enforcer)
- Domain-specific skills (api-conventions, design-system)
- Project-specific memory

---

## Priorita implementace

### Faze 1: Foundation (nejvetsi dopad, nejmensi usili)
1. **Vytvorit `~/.claude/CLAUDE.md`** — governance pravidla, sprint format, memory system, bootstrap instrukce
2. **Generalizovat `session-start.cjs`** — jeden hook co funguje vsude
3. **Presunout `block-destructive.cjs` do globalu** — univerzalni ochrana

### Faze 2: Consolidation
4. **Presunout spolecne hooks do `~/.claude/settings.json`** — odstranit duplikaty z projektu
5. **Vytvorit templates** — CLAUDE.md, PROGRESS.md, settings.json skeletony
6. **Konsolidovat BMAD/WDS skills** — jedna kopie, symlinky nebo globalni skills

### Faze 3: Evolution
7. **"New project" skill** — `/init-project` co vytvori cely scaffold
8. **"Audit project" hook/skill** — pri SessionStart zkontroluje, co chybi oproti standardu
9. **Cross-project memory** — sdilene feedback/user memories (uz existuje v `~/.claude/projects/*/memory/`)

---

## Otevrene otazky

### Q1: Global vs local hooks — stackovani?
Claude Code hooks se stackuji (global + local). Ale co kdyz local projekt chce JINY session-start?
- **Moznost A:** Global hook je dostatecne genericky, local se nepotrebuje
- **Moznost B:** Global hook posila ENV promennou, local muze override
- **Moznost C:** Nechat to na projektu — kdyz chce custom, definuje local a global se preskoci

### Q2: Skills sharing mechanismus?
- **Symlinky:** `project/.claude/skills/bmad-help -> ~/.claude/shared/skills/bmad-help` — funguji na Windows? (mklink /D)
- **Globalni skills:** `~/.claude/skills/` — existuje tenhle path v Claude Code?
- **Copy script:** `init-project` nakopiruje z templates — ale pak se neaktualizuji

### Q3: Jak moc prescriptive ma byt global CLAUDE.md?
- Prilis striktni = bude omezovat na projektech kde to nedava smysl (quick prototyp, experiment)
- Prilis volny = nebude mit efekt
- **Navrh:** Rozlisovat "MUST" (bezpecnost, git pravidla) vs "SHOULD" (PROGRESS.md, sprint tracking) vs "CONSIDER" (memory system, skills)

### Q4: Co s 20+ "bare" projekty?
- Zpetne doplnovat CLAUDE.md do vsech? Asi ne — hodne z nich jsou dead/archived
- Nechat global CLAUDE.md aby je pokryl zakladnim standardem? Ano
- Aktivne auditovat jen pri otevreni? Ano — "lazy bootstrap"

### Q5: Verzovani frameworku?
- `~/.claude/shared/` neni v zadnem git repu
- Ma to byt vlastni repo (`dave-claude-framework`)? Pak se da verzovat, branchovat, rollbackovat
- Nebo staci ze je to v `~/.claude/` a Claude sam provadi zmeny? Jednodussi, ale bez historie

---

## Metriky uspechu

Jak pozname ze to funguje:

1. **Novy projekt za < 5 min ma plne nastaveny Claude orchestraci**
2. **Zadny projekt nema `git reset --hard` incident** (global block-destructive)
3. **Kazda session zacina s kontextem** (global session-start)
4. **Standard se vyviji na jednom miste** — zmena v global = zmena vsude
5. **Dave nikdy nemusi vysvetlovat "jak tady ritime projekt"** — Claude to uz vi

---

## Inspirace z toho co uz funguje

### lablab-ai-challenge (nejlepsi orchestrace)
- Session-start hook s PROGRESS.md parserem
- Memory system s MEMORY.md indexem
- Pre/Post compact hooks pro context recovery
- CLAUDE.md s architekturou, konvencemi, model routing

### kiosek-main (nejlepsi design enforcement)
- Design-token-enforcer hook (domain-specific PreToolUse)
- 75+ BMAD/WDS skills
- Oddelene agents/

### back-office-bot (nejvetsi projekt, 5669 testu)
- Multi-prompt system (.claude/*.md)
- Review pipeline prompt
- Orchestrator start prompt
- Debug sprint prompt

### custom-chatbot (nejstarsi, nejvic iteraci)
- MCP server integrace
- v2-architecture skill
- 10 memory souboru — zrale project knowledge

---

## Dalsi kroky

1. Dave promysli tento RFC
2. Rozhodnout otevrene otazky (Q1-Q5)
3. Implementovat Fazi 1 (global CLAUDE.md + genericke hooks)
4. Validovat na 2-3 projektech
5. Iterovat
